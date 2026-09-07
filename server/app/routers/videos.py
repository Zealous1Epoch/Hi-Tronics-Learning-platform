"""视频上传与播放"""

import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import Video
from app.routers.auth import get_current_user, require_admin
from app.services.auth_service import create_video_token, decode_video_token

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "videos")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500MB

# API 前缀，由 nginx 统一配置，不依赖客户端请求头
API_PREFIX = "/api/learning-platform"

router = APIRouter(prefix="/api", tags=["视频"])


@router.post("/videos/upload")
async def upload_video(
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """上传视频文件（本地存储）"""
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else "mp4"
    if ext not in ("mp4", "mov", "avi", "mkv", "webm"):
        raise HTTPException(status_code=400, detail="不支持的格式，支持: mp4, mov, avi, mkv, webm")

    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    file_size = 0
    with open(filepath, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            f.write(chunk)
            file_size += len(chunk)
            if file_size > MAX_VIDEO_SIZE:
                f.close()
                os.remove(filepath)
                raise HTTPException(status_code=400, detail=f"视频文件过大，最大支持 {MAX_VIDEO_SIZE // 1024 // 1024}MB")

    return {
        "filename": filename,
        "original_name": file.filename,
        "file_size": file_size,
        "url": f"{API_PREFIX}/videos/stream/{filename}",
    }


@router.get("/videos/play-url/{obs_key}")
def get_play_url(
    obs_key: str,
    request: Request = None,
    current_user: User = Depends(get_current_user),
):
    """获取视频播放 URL（含短期专用 token，避免主 token 暴露在 URL 中）"""
    filepath = os.path.join(UPLOAD_DIR, obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="视频不存在")
    video_token = create_video_token(current_user.id, obs_key)
    return {"url": f"{API_PREFIX}/videos/stream/{obs_key}?token={video_token}"}


@router.get("/videos/stream/{filename}")
async def stream_video(
    filename: str,
    request: Request,
    token: str = Query(..., description="认证 token"),
):
    """流式播放视频（支持 Range 请求，通过 query 参数 token 认证）"""
    # 浏览器 <video> 标签不支持自定义请求头，通过 URL query 参数传递短期专用 token
    payload = decode_video_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="token 无效或已过期")

    # 验证 token 中的文件名与请求的文件名匹配
    token_filename = payload.get("filename")
    if token_filename and token_filename != filename:
        raise HTTPException(status_code=403, detail="无权访问该视频")

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="视频不存在")

    file_size = os.path.getsize(filepath)
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(filepath, media_type="video/mp4")

    # 支持 Range 请求（拖动进度条）
    range_val = range_header.replace("bytes=", "")
    parts = range_val.split("-")
    start = int(parts[0])
    end = int(parts[1]) if parts[1] else file_size - 1
    chunk_size = end - start + 1

    def iterfile():
        with open(filepath, "rb") as f:
            f.seek(start)
            yield f.read(chunk_size)

    return StreamingResponse(
        iterfile(),
        status_code=206,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "video/mp4",
        },
    )
