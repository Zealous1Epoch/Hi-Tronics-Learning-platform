"""SSO 单点登录路由：OA 系统 302 重定向登录 + 企业微信 OAuth 登录"""

import hashlib
import uuid as _uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text

from app.config import settings
from app.database import get_db, engine
from app.models.user import User
from app.services.auth_service import create_access_token, decode_access_token
from app.services.oa_client import fetch_employee_by_workcode
from app.services.wechat_service import get_user_info, get_user_detail
from app.routers.auth import require_admin
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["SSO"])

# 运行时可调的 SSO 时间窗口（秒），默认 30
_sso_time_window: int = settings.SSO_TIME_WINDOW

# 一次性 code 存储：code -> {token, user_id, expires_at}
_sso_codes: dict[str, dict] = {}
_SSO_CODE_TTL = 60  # 秒


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest().lower()


def _ensure_workcode_hash_column():
    """确保 users 表有 workcode_hash 列（幂等）"""
    try:
        with engine.connect() as conn:
            conn.execute(
                sa_text(
                    "ALTER TABLE users ADD COLUMN workcode_hash VARCHAR(32) "
                    "GENERATED ALWAYS AS (MD5(username)) STORED, "
                    "ADD INDEX ix_users_workcode_hash (workcode_hash)"
                )
            )
            conn.commit()
            logger.info("已添加 workcode_hash 列和索引")
    except Exception:
        # 列或索引已存在，忽略
        pass


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

    # 步骤 3: 查找用户（通过 workcode_hash 索引）
    _ensure_workcode_hash_column()
    workcode_hash = _md5(workcode)
    user = db.query(User).filter(User.workcode_hash == workcode_hash).first()

    # 步骤 4: 用户不存在，从 OA 拉取并创建
    if not user:
        user = await _create_user_from_oa(db, workcode, workcode_hash)
        if not user:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 5: 检查用户状态
    if user.status != "active":
        logger.warning("SSO 用户已被禁用: username=%s", user.username)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 6: 生成 JWT 和一次性 code，通过 code 跳转（避免 token 暴露在 URL 中）
    token = create_access_token(user.id, user.role)
    code = str(_uuid.uuid4())
    _sso_codes[code] = {
        "token": token,
        "expires_at": datetime.now() + timedelta(seconds=_SSO_CODE_TTL),
    }
    logger.info("SSO 登录成功: username=%s, role=%s", user.username, user.role)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso/callback?code={code}")


@router.get("/sso/exchange")
def exchange_code(code: str, db: Session = Depends(get_db)):
    """用一次性 code 换取 JWT token（避免 token 出现在 URL 中）"""
    entry = _sso_codes.pop(code, None)
    if not entry:
        raise HTTPException(status_code=400, detail="code 无效或已过期")
    if datetime.now() > entry["expires_at"]:
        raise HTTPException(status_code=400, detail="code 已过期")
    return {"token": entry["token"]}


def _find_user_by_workcode_hash(db: Session, workcode_hash: str) -> User | None:
    """通过 workcode_hash 索引直接查询用户"""
    return db.query(User).filter(User.workcode_hash == workcode_hash).first()


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
        role="student",  # SSO 自动创建的用户默认角色为 student，非 admin
        status="active",
        password_hash=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("SSO 自动创建用户: username=%s, name=%s, role=student", workcode, name)
    return user


# --- 管理接口：调整 SSO 时间窗口 ---

@router.get("/api/admin/sso-timeout")
def get_sso_timeout(_: User = Depends(require_admin)):
    """获取当前 SSO 时间窗口（秒）"""
    return {"timeout_seconds": _sso_time_window}


@router.put("/api/admin/sso-timeout")
def set_sso_timeout(timeout: int, _: User = Depends(require_admin)):
    """设置 SSO 时间窗口（秒），由 admin 调用"""
    global _sso_time_window
    if timeout < 1 or timeout > 300:
        raise HTTPException(status_code=400, detail="时间窗口必须在 1-300 秒之间")
    _sso_time_window = timeout
    logger.info("SSO 时间窗口已调整为 %d 秒", timeout)
    return {"timeout_seconds": _sso_time_window, "message": "更新成功"}


# =============================================================================
# 企业微信 OAuth 登录
# =============================================================================

# 存储 state 用于 CSRF 校验（state -> timestamp）
_wechat_states: dict[str, float] = {}
_WECHAT_STATE_TTL = 300  # 秒


@router.get("/sso/wechat/login")
async def wechat_login():
    """跳转到企业微信 OAuth 授权页"""
    if not settings.WECHAT_CORP_ID or not settings.WECHAT_AGENT_ID or not settings.WECHAT_SECRET:
        logger.warning("企微 SSO 配置不完整，请检查 WECHAT_CORP_ID / WECHAT_AGENT_ID / WECHAT_SECRET")
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    callback_url = f"{settings.FRONTEND_URL}/sso/wechat/callback"
    state = str(_uuid.uuid4())
    _wechat_states[state] = datetime.now().timestamp()

    # 清理过期 state
    now = datetime.now().timestamp()
    expired = [s for s, t in _wechat_states.items() if now - t > _WECHAT_STATE_TTL]
    for s in expired:
        _wechat_states.pop(s, None)

    # 构建企微 OAuth URL
    # 文档: https://developer.work.weixin.qq.com/document/path/91335
    from urllib.parse import quote
    redirect_uri = quote(callback_url, safe="")
    oauth_url = (
        f"https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={settings.WECHAT_CORP_ID}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope=snsapi_privateinfo"
        f"&agentid={settings.WECHAT_AGENT_ID}"
        f"&state={state}"
        f"#wechat_redirect"
    )
    logger.info("跳转企微 OAuth 授权页")
    return RedirectResponse(url=oauth_url)


@router.get("/sso/wechat/callback")
async def wechat_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    """企业微信 OAuth 回调：用 code 换取用户信息，创建/查找用户，签发 JWT

    支持两种入口：
    1. 网页端点击"企业微信登录"按钮（state 由后端生成，用于 CSRF 校验）
    2. 企微客户端内点击应用直接打开（state 由企微客户端提供，不做 CSRF 校验）
    """
    # 步骤 1: 校验 state（CSRF 防护）
    # 只有 state 在我们缓存中时才做校验，否则忽略（来自企微客户端直接打开）
    if state and state in _wechat_states:
        _wechat_states.pop(state, None)
    elif state:
        logger.warning("企微回调 state 不在缓存中，跳过 CSRF 校验（可能是企微客户端直接打开）")

    if not code:
        logger.warning("企微回调缺少 code 参数")
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 2: 用 code 换取 user_ticket 和 userid
    try:
        user_info = await get_user_info(code)
    except Exception as e:
        logger.error("企微 getuserinfo 失败: %s", str(e))
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    user_ticket = user_info.get("user_ticket")
    userid = user_info.get("userid")
    if not user_ticket or not userid:
        logger.warning("企微 getuserinfo 返回缺少 user_ticket 或 userid: %s", user_info)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 3: 用 user_ticket 获取用户详细信息
    try:
        detail = await get_user_detail(user_ticket)
    except Exception as e:
        logger.error("企微 getuserdetail 失败: %s", str(e))
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    wechat_name = detail.get("name", "")
    wechat_avatar = detail.get("avatar", "")

    # 步骤 4: 查找或创建用户
    user = db.query(User).filter(User.wechat_user_id == userid).first()

    if not user:
        # 用户不存在，创建新用户
        username = f"wx_{userid}"
        user = User(
            username=username,
            name=wechat_name or userid,
            wechat_user_id=userid,
            wechat_avatar=wechat_avatar,
            role="student",
            status="active",
            password_hash=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info("企微 SSO 自动创建用户: username=%s, name=%s", username, wechat_name or userid)
    else:
        # 更新头像
        if wechat_avatar:
            user.wechat_avatar = wechat_avatar
        if wechat_name:
            user.name = wechat_name
        db.commit()
        logger.info("企微 SSO 登录成功: username=%s, name=%s", user.username, user.name)

    # 步骤 5: 检查用户状态
    if user.status != "active":
        logger.warning("企微 SSO 用户已被禁用: username=%s", user.username)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 6: 生成 JWT 和一次性 code
    token = create_access_token(user.id, user.role)
    code_value = str(_uuid.uuid4())
    _sso_codes[code_value] = {
        "token": token,
        "expires_at": datetime.now() + timedelta(seconds=_SSO_CODE_TTL),
    }
    logger.info("企微 SSO 登录成功: username=%s, role=%s", user.username, user.role)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso/callback?code={code_value}")