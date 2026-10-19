"""视频本地磁盘存储（uploads/videos/，OSS 不可用时的服务器中转回退）

背景：视频主链路是「浏览器 → OSS 预签名 PUT 直传」，依赖有效的 OSS 凭证与
桶 CORS。本地开发/内网环境凭证不可用或桶策略拒绝时直传必败，中转端点在
OSS 上传失败后把文件落在这里，stream/play-url 端点优先本地回源，保证
「上传 → 落库 → 播放」全链路可用。生产 OSS 正常时本目录保持为空。

Router 层负责鉴权，本模块只收敛「文件名 → 磁盘路径 → 落盘/清理」，
测试可 monkeypatch UPLOAD_DIR 隔离磁盘依赖（与 course_files 同套路）。
"""

from __future__ import annotations

import os

from app.logger import get_logger

logger = get_logger(__name__)

# uploads/videos/（server 目录下，与课件的 uploads/courses 平级）
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "videos")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB，与 OSS 直传链路的视频上限一致

ALLOWED_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "webm"}

CONTENT_TYPES = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
}


def ext_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def resolve_path(filename: str) -> str:
    """文件名 → 磁盘路径。只取 basename，防目录穿越（stream 端点的 filename 来自 URL）"""
    return os.path.join(UPLOAD_DIR, os.path.basename(filename))


def exists(filename: str) -> bool:
    return os.path.isfile(resolve_path(filename))


def media_type_of(filename: str) -> str:
    return CONTENT_TYPES.get(ext_of(filename), "application/octet-stream")


def remove_from_disk(filename: str) -> bool:
    """删除本地视频文件（不存在返回 False，删除成功返回 True）"""
    path = resolve_path(filename)
    if not os.path.isfile(path):
        return False
    try:
        os.remove(path)
        return True
    except OSError as exc:
        logger.error("删除本地视频文件失败: %s, error=%s", path, exc)
        return False
