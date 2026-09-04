"""系统日志查看路由"""

import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from app.models.user import User
from app.routers.auth import require_admin
import app.logger

router = APIRouter(prefix="/api/admin", tags=["系统日志"])


def _get_log_file() -> str:
    """运行时获取日志文件路径，避免模块导入时 LOG_FILE 尚未设置"""
    return app.logger.LOG_FILE


@router.get("/logs")
def get_logs(
    lines: int = Query(200, ge=1, le=2000, description="返回最近 N 行"),
    _: User = Depends(require_admin),
):
    """返回最近 N 行日志"""
    log_file = _get_log_file()
    if not log_file or not os.path.exists(log_file):
        return PlainTextResponse("暂无日志文件", status_code=200)

    try:
        with open(log_file, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
        recent = all_lines[-lines:] if len(all_lines) > lines else all_lines
        return PlainTextResponse("".join(recent))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取日志失败: {str(e)}")


@router.get("/logs/download")
def download_logs(
    _: User = Depends(require_admin),
):
    """下载完整日志文件"""
    log_file = _get_log_file()
    if not log_file or not os.path.exists(log_file):
        raise HTTPException(status_code=404, detail="日志文件不存在")

    return FileResponse(
        log_file,
        media_type="text/plain",
        filename="app.log",
        headers={"Content-Disposition": "attachment; filename=app.log"},
    )