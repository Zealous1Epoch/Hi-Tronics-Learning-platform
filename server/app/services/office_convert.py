"""LibreOffice 办公文档转换服务（PPT/PPTX → PDF 预览产物）

原实现在 routers/knowledge.py 内部，抽取为共用服务供课程课件等模块复用，
行为保持不变：LibreOffice 不可用或转换失败只记日志并返回 None，不阻断上传。
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from shutil import which as shutil_which

from app.logger import get_logger

logger = get_logger(__name__)

# LibreOffice 路径（macOS App / Linux 命令行）
_SOFFICE_CANDIDATES = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
]
SOFFICE = next((p for p in _SOFFICE_CANDIDATES if os.path.exists(p) or shutil_which(p)), None)

# 专属 profile 目录：soffice 默认写 ~/.config/libreoffice，在无完整桌面环境的
# 服务进程（沙箱/受限 HOME/GUI 实例已占用锁）下会 exit 1。重定向到临时目录后
# 与 GUI 实例互不干扰，也是 headless 服务的标准做法。
_LO_PROFILE_DIR = os.path.join(tempfile.gettempdir(), "hitronics_lo_profile")


def soffice_available() -> bool:
    """检测 LibreOffice 是否可用"""
    if not SOFFICE:
        return False
    try:
        subprocess.run([SOFFICE, "--version"], capture_output=True, timeout=10)
        return True
    except Exception:
        return False


def convert_office_to_pdf(filepath: str, ext: str) -> str | None:
    """将 PPT/PPTX 转换为 PDF，返回 PDF 路径。失败返回 None。

    注意：转换失败不静默吞掉（历史教训：knowledge 旧实现 `except: pass` 导致
    运维无法发现 LibreOffice 缺失，表现为学员端 PPT 预览一直空白），统一记日志。
    """
    if ext not in ("ppt", "pptx"):
        return None
    if not soffice_available():
        logger.warning("LibreOffice 不可用，跳过 PPT→PDF 转换: %s", os.path.basename(filepath))
        return None
    try:
        outdir = os.path.dirname(filepath)
        subprocess.run(
            [SOFFICE, f"-env:UserInstallation=file://{_LO_PROFILE_DIR}",
             "--headless", "--convert-to", "pdf", "--outdir", outdir, filepath],
            capture_output=True, text=True, timeout=120,
            check=True,
        )
        # LibreOffice 输出为同名 .pdf
        pdf_path = os.path.splitext(filepath)[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
        logger.warning("PPT→PDF 转换未生成输出文件: %s", os.path.basename(filepath))
    except Exception as exc:  # noqa: BLE001 — 转换失败不应阻断上传
        logger.error("PPT→PDF 转换失败: %s, error=%s", os.path.basename(filepath), exc)
    return None
