"""视频上传与播放（阿里云 OSS 存储，客户端直连 OSS 播放）"""

import uuid
import oss2
import oss2.http as oss2_http
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.config import settings
from jose import JWTError, jwt
from app.routers.auth import get_current_user, require_admin
from app.services.auth_service import decode_video_token

MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500MB
OSS_VIDEO_PREFIX = "videos/"  # OSS 中视频对象的前缀
PRESIGNED_EXPIRE = 7200  # 签名 URL 有效期（秒），2 小时

router = APIRouter(prefix="/api", tags=["视频"])


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


@router.get("/videos/play-url/{obs_key}")
def get_play_url(
    obs_key: str,
    request: Request = None,
    current_user: User = Depends(get_current_user),
):
    """获取视频播放 URL（OSS 签名 URL，客户端直连 OSS 播放，2 小时有效）"""
    object_key = f"{OSS_VIDEO_PREFIX}{obs_key}"
    bucket = _get_oss_bucket()

    if not bucket.object_exists(object_key):
        raise HTTPException(status_code=404, detail="视频不存在")

    signed_url = bucket.sign_url("GET", object_key, PRESIGNED_EXPIRE)
    return {"url": signed_url}


@router.get("/videos/stream/{filename}")
async def stream_video(
    filename: str,
    request: Request,
    token: str = Query(..., description="认证 token"),
):
    """视频播放（验证 token 后重定向到 OSS 签名 URL）

    支持两种 token：
    - 视频专用 token（学员端 play-url 生成）
    - 主 auth token（后台管理预览）
    """
    # 先尝试视频专用 token，再 fallback 主 auth token
    payload = decode_video_token(token)
    if not payload:
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        except JWTError:
            raise HTTPException(status_code=401, detail="token 无效或已过期")

    # 视频专用 token 需校验文件名匹配
    if payload.get("purpose") == "video":
        token_filename = payload.get("filename")
        if token_filename and token_filename != filename:
            raise HTTPException(status_code=403, detail="无权访问该视频")

    object_key = f"{OSS_VIDEO_PREFIX}{filename}"
    bucket = _get_oss_bucket()

    if not bucket.object_exists(object_key):
        raise HTTPException(status_code=404, detail="视频不存在")

    signed_url = bucket.sign_url("GET", object_key, PRESIGNED_EXPIRE)
    return RedirectResponse(url=signed_url, status_code=302)