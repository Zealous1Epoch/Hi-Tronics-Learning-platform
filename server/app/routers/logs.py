"""系统日志查看路由"""

import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from app.models.user import User
from app.routers.auth import require_admin
from app.logger import LOG_FILE

router = APIRouter(prefix="/api/admin", tags=["系统日志"])


@router.get("/logs")
def get_logs(
    lines: int = Query(200, ge=1, le=2000, description="返回最近 N 行"),
    _: User = Depends(require_admin),
):
    """返回最近 N 行日志"""
    if not LOG_FILE or not os.path.exists(LOG_FILE):
        return PlainTextResponse("暂无日志文件", status_code=200)

    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
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
    if not LOG_FILE or not os.path.exists(LOG_FILE):
        raise HTTPException(status_code=404, detail="日志文件不存在")

    return FileResponse(
        LOG_FILE,
        media_type="text/plain",
        filename="app.log",
        headers={"Content-Disposition": "attachment; filename=app.log"},
    )