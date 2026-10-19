"""课程课件文件存储工具（本地 uploads/courses/，与知识库课件同套路）

Router 层负责鉴权与落库，本模块只收敛「文件名解析 → 磁盘路径 → 清理」，
测试可 monkeypatch UPLOAD_DIR / MAX_FILE_SIZE 模块属性隔离磁盘依赖。
"""

from __future__ import annotations

import os

from app.logger import get_logger
from app.models.course import CourseMaterial

logger = get_logger(__name__)

# uploads/courses/（server 目录下，与 knowledge 的 uploads/knowledge 平级）
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "courses")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB，与知识库课件一致

# 用户明确的学习资料格式：PDF / PPT(PPTX) / HTML；视频走 OSS 三步流不在这里
ALLOWED_EXTENSIONS = {"pdf", "ppt", "pptx", "html", "htm"}

MIME_MAP = {
    "pdf": "application/pdf",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "html": "text/html",
    "htm": "text/html",
}


def ext_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def resolve_path(obs_key: str) -> str:
    return os.path.join(UPLOAD_DIR, obs_key)


def resolve_preview_path(material: CourseMaterial) -> str:
    """预览路径：PPT/PPTX 优先返回转换后的 PDF，其他返回原文件"""
    if material.file_type in ("ppt", "pptx"):
        pdf_path = os.path.splitext(resolve_path(material.obs_key))[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
    return resolve_path(material.obs_key)


def remove_from_disk(obs_key: str, file_type: str) -> None:
    """删除课件磁盘文件，连带清理 PPT/PPTX 自动转换产生的 PDF 副本。

    参数用普通字符串而不是 ORM 对象：调用方通常在 commit 之后清理，
    此时实例属性已过期/已删除，再访问会触发 ObjectDeletedError。
    """
    filepath = resolve_path(obs_key)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except OSError as exc:
            logger.error("删除课件文件失败: %s, error=%s", filepath, exc)
    if file_type in ("ppt", "pptx"):
        pdf_path = os.path.splitext(filepath)[0] + ".pdf"
        if os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except OSError as exc:
                logger.error("删除课件转换 PDF 失败: %s, error=%s", pdf_path, exc)
