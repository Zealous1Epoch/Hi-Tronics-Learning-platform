"""系统日志查看路由"""

import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models.user import User
from app.models.system_log import SystemLog
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


@router.get("/system-logs")
def get_system_logs(
    category: str | None = Query(None, description="分类筛选"),
    level: str | None = Query(None, description="级别筛选"),
    search: str | None = Query(None, description="搜索关键词"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=200, description="每页条数"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取结构化操作日志"""
    q = db.query(SystemLog)

    if category:
        q = q.filter(SystemLog.category == category)
    if level:
        q = q.filter(SystemLog.level == level)
    if search:
        like = f"%{search}%"
        q = q.filter(
            SystemLog.description.like(like)
            | SystemLog.operator.like(like)
            | SystemLog.resource_name.like(like)
        )

    total = q.count()
    items = (
        q.order_by(desc(SystemLog.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [
            {
                "id": log.id,
                "operator": log.operator,
                "category": log.category,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_name": log.resource_name,
                "description": log.description,
                "level": log.level,
                "created_at": log.created_at.isoformat(),
            }
            for log in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/system-logs/categories")
def get_system_log_categories(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取所有日志分类列表"""
    from sqlalchemy import func as sa_func

    rows = (
        db.query(SystemLog.category, sa_func.count(SystemLog.id))
        .group_by(SystemLog.category)
        .order_by(sa_func.count(SystemLog.id).desc())
        .all()
    )
    return [{"category": c, "count": n} for c, n in rows]