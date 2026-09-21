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
from app.services.request_utils import get_client_ip
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["认证"])

# 用户缓存：减少 get_current_user 的重复数据库查询
_user_cache: dict[str, tuple[User, float]] = {}
_USER_CACHE_TTL = 60        # 秒
_USER_CACHE_MAX = 2000      # 条数上限，超出后淘汰最旧一半，避免长期运行内存单调增长


def invalidate_user_cache(user_id: str) -> None:
    """清除指定用户的缓存（在用户数据变更时调用）"""
    _user_cache.pop(user_id, None)


def _prune_user_cache(now: float) -> None:
    """清理用户缓存：先删过期项，超上限时再淘汰最旧一半。"""
    for key in [k for k, v in _user_cache.items() if now - v[1] >= _USER_CACHE_TTL]:
        _user_cache.pop(key, None)
    if len(_user_cache) > _USER_CACHE_MAX:
        items = sorted(_user_cache.items(), key=lambda kv: kv[1][1])
        for key, _ in items[: len(items) // 2 + 1]:
            _user_cache.pop(key, None)


# ── 登录速率限制 ──
# 修复两个问题：
# 1) 原先 IP 取自客户端可伪造的 X-Forwarded-For，攻击者每次换一个伪造 IP
#    即可完全绕过限流（已实测：连续 8 次伪造 IP 均未被拦截）。
# 2) 原先每 IP 每分钟仅 5 次额度，部署在 NAT / 反向代理后全公司共享额度，
#    正常用户会被误锁。现改为 IP 与「账号」双维度分别限制。
_LOGIN_MAX_PER_IP = 20          # 单 IP 每分钟最多尝试次数（容纳 NAT 后多人共用出口）
_LOGIN_MAX_PER_ACCOUNT = 5      # 单账号每分钟最多尝试次数（防定向爆破）
_LOGIN_WINDOW = 60              # 窗口秒数

_login_attempts_ip: dict[str, list[float]] = {}
_login_attempts_user: dict[str, list[float]] = {}


def _get_client_ip(request: Request) -> str:
    """解析真实客户端 IP。

    实现在 services/request_utils（签到等模块也要用，避免跨 router 导入私有函数），
    此处保留同名函数以兼容既有调用点。
    """
    return get_client_ip(request)


def _prune_attempts() -> None:
    """清理限流桶，避免按 IP / 账号无限累积。"""
    now = time.time()
    for bucket in (_login_attempts_ip, _login_attempts_user):
        for key in [k for k, v in bucket.items() if not v or now - max(v) >= _LOGIN_WINDOW]:
            bucket.pop(key, None)


def _check_login_rate(client_ip: str, username: str) -> None:
    """检查登录速率，超限则抛出 429（IP 与账号双维度）。"""
    now = time.time()
    _prune_attempts()
    for bucket, key, limit in (
        (_login_attempts_ip, client_ip, _LOGIN_MAX_PER_IP),
        (_login_attempts_user, (username or "").lower(), _LOGIN_MAX_PER_ACCOUNT),
    ):
        attempts = [t for t in bucket.get(key, []) if now - t < _LOGIN_WINDOW]
        bucket[key] = attempts
        if len(attempts) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="登录尝试过于频繁，请稍后再试",
            )


def _record_login_attempt(client_ip: str, username: str) -> None:
    """记录一次失败的登录尝试（IP 与账号各记一次）。"""
    now = time.time()
    for bucket, key in (
        (_login_attempts_ip, client_ip),
        (_login_attempts_user, (username or "").lower()),
    ):
        attempts = [t for t in bucket.get(key, []) if now - t < _LOGIN_WINDOW]
        attempts.append(now)
        bucket[key] = attempts


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
    _prune_user_cache(now)

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
    client_ip = _get_client_ip(request)
    _check_login_rate(client_ip, req.username)

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not user.password_hash:
        _record_login_attempt(client_ip, req.username)
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
        _record_login_attempt(client_ip, req.username)
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