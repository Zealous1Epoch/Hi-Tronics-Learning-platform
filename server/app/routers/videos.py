"""视频上传与播放（阿里云 OSS 存储，客户端直连 OSS 播放）"""

import os
import re
import uuid
import oss2
import oss2.http as oss2_http
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.course import Video
from app.models.user import User
from app.config import settings
from jose import JWTError, jwt
from app.routers.auth import get_current_user, require_admin
from app.services import video_files
from app.services.auth_service import decode_video_token
from app.services.department_scope import check_course_assignment
from app.logger import get_logger

logger = get_logger(__name__)

MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500MB
OSS_VIDEO_PREFIX = "videos/"  # OSS 中视频对象的前缀
PRESIGNED_EXPIRE = 7200  # 签名 URL 有效期（秒），2 小时

router = APIRouter(prefix="/api", tags=["视频"])


def _assert_can_watch(db: Session, user: User, filename: str) -> Video:
    """校验当前用户有权观看指定视频。

    安全修复：原先 `/videos/stream/{filename}` 在用主 auth token 访问时会跳过
    文件名比对，`/videos/play-url/{obs_key}` 更是只校验「已登录」——
    任意登录用户拿到文件名即可播放任意视频。现统一要求：
    视频必须存在，且用户被分配了该视频所属课程（管理员不受限）。
    """
    video = (
        db.query(Video)
        .filter(Video.obs_key == filename)
        .first()
    )
    if not video:
        # 兼容历史数据：obs_key 可能存成 videos/xxx.mp4
        video = (
            db.query(Video)
            .filter(Video.obs_key == f"{OSS_VIDEO_PREFIX}{filename}")
            .first()
        )
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")

    if not check_course_assignment(db, user, video.course_id):
        raise HTTPException(status_code=403, detail="未分配该课程，无权观看此视频")
    return video


def _load_user(db: Session, payload: dict) -> User:
    """从 token payload 载入用户并校验状态（视频流接口无 FastAPI 依赖注入用户）。"""
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="token 无效")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    return user


class _NoProxySession(oss2_http.Session):
    """OSS Session，直连 OSS 不走系统代理"""

    def __init__(self):
        super().__init__()
        self.session.trust_env = False
        self.session.proxies = {}


def _get_oss_bucket():
    """获取 OSS Bucket 实例"""
    auth = oss2.Auth(settings.OSS_ACCESS_KEY_ID, settings.OSS_ACCESS_KEY_SECRET)
    return oss2.Bucket(auth, settings.OSS_ENDPOINT, settings.OSS_BUCKET, session=_NoProxySession())


def delete_oss_object(filename: str) -> bool:
    """删除 OSS 中的视频对象（连带清理本地回退文件）。

    修复：原先删除视频/课程只清理数据库记录，OSS 上的对象永久残留，
    长期运行存储只增不减且无法对账。
    失败仅记录日志（不阻断业务），返回是否删除了任一存储中的对象。
    """
    removed_local = video_files.remove_from_disk(filename)
    if not settings.OSS_ACCESS_KEY_ID or not settings.OSS_ACCESS_KEY_SECRET:
        return removed_local
    object_key = filename if filename.startswith(OSS_VIDEO_PREFIX) else f"{OSS_VIDEO_PREFIX}{filename}"
    try:
        _get_oss_bucket().delete_object(object_key)
        logger.info("已删除 OSS 对象: %s", object_key)
        return True
    except Exception as exc:  # noqa: BLE001 — 外部存储失败不应影响业务流程
        logger.error("删除 OSS 对象失败: %s, error=%s", object_key, exc)
        return removed_local


@router.get("/videos/upload-token")
def get_upload_token(
    ext: str = Query("mp4", description="文件扩展名，不含点"),
    content_type: str = Query("video/mp4", description="文件 MIME 类型"),
    _: User = Depends(require_admin),
):
    """获取 OSS 直传凭证 —— 浏览器直接上传到 OSS，不经过服务器中转"""
    if ext not in ("mp4", "mov", "avi", "mkv", "webm"):
        raise HTTPException(status_code=400, detail="不支持的格式，支持: mp4, mov, avi, mkv, webm")

    filename = f"{uuid.uuid4()}.{ext}"
    object_key = f"{OSS_VIDEO_PREFIX}{filename}"
    bucket = _get_oss_bucket()

    # 预签名 PUT URL，Content-Type 参与签名，1 小时内有效
    upload_url = bucket.sign_url("PUT", object_key, 3600, headers={"Content-Type": content_type})

    return {
        "filename": filename,
        "upload_url": upload_url,
    }


@router.post("/videos/upload")
async def upload_video(
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """上传视频文件到阿里云 OSS"""
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else "mp4"
    if ext not in ("mp4", "mov", "avi", "mkv", "webm"):
        raise HTTPException(status_code=400, detail="不支持的格式，支持: mp4, mov, avi, mkv, webm")

    content = await file.read()
    if len(content) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail=f"视频文件过大，最大支持 {MAX_VIDEO_SIZE // 1024 // 1024}MB")

    object_key = f"{OSS_VIDEO_PREFIX}{uuid.uuid4()}.{ext}"
    bucket = _get_oss_bucket()
    bucket.put_object(object_key, content, headers={"Content-Type": "video/mp4"})

    filename = object_key.split("/")[-1]
    return {
        "filename": filename,
        "object_key": object_key,
        "original_name": file.filename,
        "file_size": len(content),
    }


@router.post("/videos/upload-relay")
async def upload_video_relay(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    """服务器中转上传（直传 OSS 的回退通道）：OSS 优先，OSS 不可用落本地磁盘。

    浏览器直传依赖有效的 OSS 凭证与桶 CORS；本地开发/内网环境直传失败时，
    前端自动降级调本端点。流式落盘不整读内存（视频上限 500MB）。
    返回 stored 标识实际存储位置：oss=已转存并清理本地副本，local=留在本地。
    """
    ext = video_files.ext_of(file.filename or "")
    if ext not in video_files.ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的格式，支持: mp4, mov, avi, mkv, webm")

    filename = f"{uuid.uuid4()}.{ext}"
    path = video_files.resolve_path(filename)
    size = 0
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > video_files.MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail=f"视频文件过大，最大支持 {video_files.MAX_FILE_SIZE // 1024 // 1024}MB")
                out.write(chunk)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise

    stored = "local"
    if settings.OSS_ACCESS_KEY_ID and settings.OSS_ACCESS_KEY_SECRET:
        try:
            _get_oss_bucket().put_object_from_file(f"{OSS_VIDEO_PREFIX}{filename}", path)
            os.remove(path)
            stored = "oss"
        except Exception as exc:  # noqa: BLE001 — OSS 不可用时回退本地存储是设计行为
            logger.warning("中转上传 OSS 转存失败，已回退本地存储: %s, error=%s", filename, exc)
    return {"filename": filename, "stored": stored, "file_size": size}


def _local_or_oss_object_key(filename: str) -> str | None:
    """判定视频文件的可服务来源。

    返回 "local"（本地磁盘命中）或 OSS object_key；两边都没有时返回 None。
    OSS 访问异常（凭证失效、网络不通）按「OSS 没有」处理——本地有则仍能播放。
    """
    if video_files.exists(filename):
        return "local"
    object_key = f"{OSS_VIDEO_PREFIX}{os.path.basename(filename)}"
    try:
        if _get_oss_bucket().object_exists(object_key):
            return object_key
    except Exception as exc:  # noqa: BLE001 — OSS 故障不应把本地可播视频打成 500
        logger.warning("OSS 对象探测失败: %s, error=%s", object_key, exc)
    return None


def _stream_local_file(request: Request, filename: str) -> StreamingResponse | FileResponse:
    """本地视频文件响应，支持 Range 请求（video 元素拖动进度条必需）"""
    path = video_files.resolve_path(filename)
    media_type = video_files.media_type_of(filename)
    file_size = os.path.getsize(path)

    range_header = request.headers.get("range")
    if range_header:
        m = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if m:
            start_s, end_s = m.group(1), m.group(2)
            if start_s:
                start = int(start_s)
                end = int(end_s) if end_s else file_size - 1
            else:
                # suffix range：bytes=-N 表示末尾 N 字节
                start = max(file_size - int(end_s), 0) if end_s else 0
                end = file_size - 1
            end = min(end, file_size - 1)
            if start > end or start >= file_size:
                return StreamingResponse(
                    iter(()), status_code=416,
                    headers={"Content-Range": f"bytes */{file_size}"},
                )
            chunk_size = 1024 * 1024
            length = end - start + 1

            def iterfile():
                with open(path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        data = f.read(min(chunk_size, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data

            return StreamingResponse(
                iterfile(), status_code=206, media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(length),
                },
            )
    return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})


@router.get("/videos/play-url/{obs_key}")
def get_play_url(
    obs_key: str,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取视频播放 URL（OSS 签名 URL，客户端直连 OSS 播放，2 小时有效）。

    修复：原先只校验「已登录」，任意登录用户拿到 obs_key 即可播放任意课程视频。
    现增加课程分配校验。

    本地回退：文件在本地磁盘（中转上传落盘）时返回 url=null + local=true，
    前端用 videoStreamUrl 走本站 /videos/stream 播放（含 Range 支持）。
    """
    _assert_can_watch(db, current_user, obs_key)

    source = _local_or_oss_object_key(obs_key)
    if source == "local":
        return {"url": None, "local": True}
    if not source:
        raise HTTPException(status_code=404, detail="视频文件不存在")

    bucket = _get_oss_bucket()
    signed_url = bucket.sign_url("GET", source, PRESIGNED_EXPIRE)
    return {"url": signed_url}


@router.get("/videos/stream/{filename}")
async def stream_video(
    filename: str,
    request: Request,
    db: Session = Depends(get_db),
    token: str = Query(..., description="认证 token"),
):
    """视频播放（验证 token 后重定向到 OSS 签名 URL）

    支持两种 token：
    - 视频专用 token（学员端 play-url 生成）：校验 token 与文件名绑定
    - 主 auth token（后台管理预览）：额外校验用户是否被分配了该视频所属课程

    修复：原先主 auth token 分支完全不校验文件名与归属，任何登录用户
    只要拿到文件名就能播放任意视频（越权）。

    本地回退：中转上传落盘的文件（或 OSS 探测失败但本地存在的文件）直接
    从磁盘流式返回并支持 Range；OSS 对象则维持原 302 签名 URL 跳转。
    """
    payload = decode_video_token(token)
    if payload:
        # 视频专用 token：必须与请求的文件名一致
        token_filename = payload.get("filename")
        if token_filename and token_filename != filename:
            raise HTTPException(status_code=403, detail="无权访问该视频")
        _assert_can_watch(db, _load_user(db, payload), filename)
    else:
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        except JWTError:
            raise HTTPException(status_code=401, detail="token 无效或已过期")
        _assert_can_watch(db, _load_user(db, payload), filename)

    source = _local_or_oss_object_key(filename)
    if source == "local":
        return _stream_local_file(request, filename)
    if not source:
        raise HTTPException(status_code=404, detail="视频不存在")

    bucket = _get_oss_bucket()
    signed_url = bucket.sign_url("GET", source, PRESIGNED_EXPIRE)
    return RedirectResponse(url=signed_url, status_code=302)