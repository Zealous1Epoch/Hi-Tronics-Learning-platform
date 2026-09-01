"""视频上传与播放"""

import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import Video
from app.routers.auth import get_current_user, require_admin

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "videos")
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/api", tags=["视频"])


@router.post("/videos/upload")
async def upload_video(
    file: UploadFile = File(...),
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

    return {
        "filename": filename,
        "original_name": file.filename,
        "file_size": file_size,
        "url": f"/api/videos/stream/{filename}",
    }


@router.get("/videos/stream/{filename}")
async def stream_video(
    filename: str,
    request: Request,
    _: User = Depends(get_current_user),
):
    """流式播放视频（支持 Range 请求，需登录）"""
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="视频不存在")

    file_size = os.path.getsize(filepath)
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(filepath, media_type="video/mp4")

    # 支持 Range 请求（拖动进度条）
    start_bytes, end_bytes = range_header.replace("bytes=", "").split("-")
    start = int(start_bytes)
    end = int(end_bytes) if end_bytes else file_size - 1
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