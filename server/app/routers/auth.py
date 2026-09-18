"""认证路由：登录、获取当前用户"""

import time
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.system_log import SystemLog
from app.schemas.auth import LoginRequest, TokenResponse, UserInfo
from app.services.auth_service import verify_password, create_access_token, decode_access_token
from app.services.log_service import write_log

router = APIRouter(prefix="/api/auth", tags=["认证"])

# 用户缓存：减少 get_current_user 的重复数据库查询
_user_cache: dict[str, tuple[User, float]] = {}
_USER_CACHE_TTL = 60  # 秒


def invalidate_user_cache(user_id: str) -> None:
    """清除指定用户的缓存（在用户数据变更时调用）"""
    _user_cache.pop(user_id, None)

# 登录速率限制：内存存储，key 为客户端 IP
_login_attempts: dict[str, list[float]] = {}
_LOGIN_MAX_ATTEMPTS = 5      # 每分钟最多尝试次数
_LOGIN_WINDOW = 60            # 窗口秒数


def _check_login_rate(client_ip: str) -> None:
    """检查登录速率，超限则抛出 429"""
    now = time.time()
    attempts = _login_attempts.get(client_ip, [])
    # 清理过期记录
    attempts = [t for t in attempts if now - t < _LOGIN_WINDOW]
    _login_attempts[client_ip] = attempts
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后再试",
        )


def _record_login_attempt(client_ip: str) -> None:
    """记录一次登录尝试"""
    now = time.time()
    attempts = _login_attempts.get(client_ip, [])
    attempts = [t for t in attempts if now - t < _LOGIN_WINDOW]
    attempts.append(now)
    _login_attempts[client_ip] = attempts


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI 依赖：从 Authorization header 解析当前用户（带缓存）"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未提供认证 token")
    payload = decode_access_token(authorization[7:])
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效或已过期")

    user_id = payload["sub"]
    now = time.time()

    # 检查缓存（跨请求复用 User 对象会因 session 关闭导致 detached 错误，用 db.merge 重新绑定）
    cached = _user_cache.get(user_id)
    if cached and (now - cached[1]) < _USER_CACHE_TTL:
        user = db.merge(cached[0])
    else:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            _user_cache[user_id] = (user, now)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被禁用")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """FastAPI 依赖：要求 admin 角色"""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """用户名密码登录"""
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown").split(",")[0].strip()
    _check_login_rate(client_ip)

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not user.password_hash:
        _record_login_attempt(client_ip)
        write_log(
            db=db,
            operator=req.username,
            category="system",
            action="login",
            resource_type="系统",
            resource_name=req.username,
            description=f"用户 {req.username} 登录失败",
            level="warning",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not verify_password(req.password, user.password_hash):
        _record_login_attempt(client_ip)
        write_log(
            db=db,
            operator=req.username,
            category="system",
            action="login",
            resource_type="系统",
            resource_name=req.username,
            description=f"用户 {req.username} 登录失败",
            level="warning",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被禁用")

    write_log(
        db=db,
        operator=user.name,
        operator_id=user.id,
        category="system",
        action="login",
        resource_type="系统",
        resource_name=user.name,
        description=f"{user.name} 登录了系统",
        level="info",
    )

    # 首次登录检测：记录创建者信息
    if not user.has_logged_in:
        user.has_logged_in = True
        db.commit()
        creation_log = db.query(SystemLog).filter(
            SystemLog.category == "user",
            SystemLog.action == "create",
            SystemLog.resource_name == user.name,
        ).order_by(SystemLog.created_at.asc()).first()
        if creation_log:
            first_desc = f"用户「{user.name}」首次登录。该用户由 {creation_log.operator} 于 {creation_log.created_at.strftime('%Y-%m-%d %H:%M')} 创建。"
        else:
            first_desc = f"用户「{user.name}」首次登录。"
        write_log(
            db=db,
            operator=user.name,
            operator_id=user.id,
            category="system",
            action="first_login",
            resource_type="系统",
            resource_name=user.name,
            description=first_desc,
            level="info",
        )

    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        user=UserInfo(
            id=user.id,
            username=user.username,
            name=user.name,
            role=user.role,
            department=user.department,
            employee_id=user.employee_id,
            avatar=user.wechat_avatar,
        ),
    )


@router.get("/me", response_model=UserInfo)
def get_me(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        name=current_user.name,
        role=current_user.role,
        department=current_user.department,
        employee_id=current_user.employee_id,
        avatar=current_user.wechat_avatar,
    )