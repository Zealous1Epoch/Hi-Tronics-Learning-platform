"""SSO 单点登录路由：处理 OA 系统 302 重定向登录"""

import hashlib
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth_service import create_access_token
from app.services.oa_client import fetch_employee_by_workcode
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["SSO"])

# 运行时可调的 SSO 时间窗口（秒），默认 30
_sso_time_window: int = settings.SSO_TIME_WINDOW


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest().lower()


def _validate_tokendate(tokendate: str) -> bool:
    """校验 tokendate 是否在 [now - window, now + window] 秒内"""
    now = datetime.now()
    window = _sso_time_window

    for offset in range(-window, window + 1):
        t = now + timedelta(seconds=offset)
        time_str = t.strftime("%Y-%m-%d %H:%M:%S")
        if _md5(time_str) == tokendate:
            return True
    return False


@router.get("/sso/login")
async def sso_login(
    request: Request,
    db: Session = Depends(get_db),
):
    """OA SSO 登录入口：校验 workcode + tokendate，完成登录并跳转"""
    workcode = request.query_params.get("workcode", "")
    tokendate = request.query_params.get("tokendate", "")

    # 步骤 1: 参数校验
    if not workcode or not tokendate:
        logger.warning("SSO 参数缺失: workcode=%s, tokendate=%s", bool(workcode), bool(tokendate))
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 2: 校验时间戳
    if not _validate_tokendate(tokendate):
        logger.warning("SSO 时间戳校验失败: tokendate=%s", tokendate)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 3: 查找用户
    workcode_hash = _md5(workcode)
    user = _find_user_by_workcode_hash(db, workcode_hash)

    # 步骤 4: 用户不存在，从 OA 拉取并创建
    if not user:
        user = await _create_user_from_oa(db, workcode, workcode_hash)
        if not user:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 5: 检查用户状态
    if user.status != "active":
        logger.warning("SSO 用户已被禁用: username=%s", user.username)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 6: 生成 JWT 并跳转
    token = create_access_token(user.id, user.role)
    logger.info("SSO 登录成功: username=%s, role=%s", user.username, user.role)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso/callback?token={token}")


def _find_user_by_workcode_hash(db: Session, workcode_hash: str) -> User | None:
    """遍历所有用户，查找 md5(username) == workcode_hash 的记录"""
    users = db.query(User).all()
    for user in users:
        if _md5(user.username) == workcode_hash:
            return user
    return None


async def _create_user_from_oa(db: Session, workcode: str, workcode_hash: str) -> User | None:
    """从 OA 获取员工信息并创建用户"""
    employee = await fetch_employee_by_workcode(workcode)
    if not employee:
        logger.warning("SSO 无法从 OA 获取员工信息: workcode=%s", workcode)
        return None

    # 防止并发创建（先检查是否已被其他请求创建）
    existing = _find_user_by_workcode_hash(db, workcode_hash)
    if existing:
        return existing

    name = employee.get("lastname", workcode)
    department = employee.get("departmentid", "")
    email = employee.get("email", "")

    user = User(
        username=workcode,
        name=name,
        employee_id=workcode,
        department=department,
        role="admin",
        status="active",
        password_hash=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("SSO 自动创建用户: username=%s, name=%s", workcode, name)
    return user


# --- 管理接口：调整 SSO 时间窗口 ---

@router.get("/api/admin/sso-timeout")
def get_sso_timeout():
    """获取当前 SSO 时间窗口（秒）"""
    return {"timeout_seconds": _sso_time_window}


@router.put("/api/admin/sso-timeout")
def set_sso_timeout(timeout: int):
    """设置 SSO 时间窗口（秒），由 super_admin 调用"""
    global _sso_time_window
    if timeout < 1 or timeout > 300:
        raise HTTPException(status_code=400, detail="时间窗口必须在 1-300 秒之间")
    _sso_time_window = timeout
    logger.info("SSO 时间窗口已调整为 %d 秒", timeout)
    return {"timeout_seconds": _sso_time_window, "message": "更新成功"}