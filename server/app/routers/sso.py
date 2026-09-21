"""SSO 单点登录路由：OA 系统 302 重定向登录 + 企业微信 OAuth 登录"""

import hashlib
import hmac
import uuid as _uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth_service import create_access_token, decode_access_token
from app.services.log_service import write_log
from app.models.system_log import SystemLog
from app.services.oa_client import fetch_employee_by_workcode, fetch_full_department_path
from app.services.wechat_service import get_user_info, get_user_detail
from app.services.department_sync import ensure_department_path
from app.routers.auth import require_admin
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["SSO"])

# 运行时可调的 SSO 时间窗口（秒），默认 30
_sso_time_window: int = settings.SSO_TIME_WINDOW

# 一次性 code 存储：code -> {token, user_id, expires_at}
_sso_codes: dict[str, dict] = {}
_SSO_CODE_TTL = 60  # 秒

# 防重放：最近已使用过的 (workcode, tokendate) 组合，避免 URL 被重复利用
_used_tickets: dict[str, float] = {}


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest().lower()


def _hmac_ticket(workcode: str, time_str: str, secret: str) -> str:
    """安全模式签名：HMAC-SHA256(secret, f"{workcode}:{time_str}")。

    与旧的 md5(时间) 方案的关键差别：**签名绑定了工号**。
    旧方案任何人自算一次 md5(当前时间) 就能伪造成任意工号的合法票据；
    新方案没有共享密钥就无法为指定工号生成签名。
    """
    msg = f"{workcode}:{time_str}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest().lower()


def _validate_sso_ticket(workcode: str, tokendate: str) -> bool:
    """校验 SSO 票据是否合法。

    支持两种模式：
    - 安全模式（推荐）：配置了 SSO_SHARED_SECRET 时，要求
      tokendate == HMAC-SHA256(secret, f"{workcode}:{YYYY-MM-DD HH:MM:SS}")，允许 ±窗口 秒时钟偏移。
    - 兼容模式（不安全）：未配置密钥时回退到 md5(时间字符串)，并记录 CRITICAL 日志。
      该模式任何人可自行推导票据，仅用于过渡期，必须尽快迁移。
    """
    if not tokendate:
        return False

    secret = settings.SSO_SHARED_SECRET
    now = datetime.now()
    window = _sso_time_window

    if secret:
        for offset in range(-window, window + 1):
            time_str = (now + timedelta(seconds=offset)).strftime("%Y-%m-%d %H:%M:%S")
            if hmac.compare_digest(_hmac_ticket(workcode, time_str, secret), tokendate):
                return True
        return False

    # 兼容模式：票据与工号无关，任何人可自行计算 —— 不安全，仅过渡
    logger.critical(
        "SSO 未配置 SSO_SHARED_SECRET，正在使用不安全的兼容校验（票据可被任意伪造），"
        "请尽快配置密钥并要求 OA 侧改用 HMAC 签名"
    )
    for offset in range(-window, window + 1):
        time_str = (now + timedelta(seconds=offset)).strftime("%Y-%m-%d %H:%M:%S")
        if _md5(time_str) == tokendate:
            return True
    return False


def _consume_ticket(workcode: str, tokendate: str) -> bool:
    """防重放：同一 (workcode, tokendate) 只允许使用一次。

    返回 True 表示首次使用；False 表示已用过（重放）。
    """
    now = datetime.now().timestamp()
    # 清理过期记录（2 倍时间窗之外的都可丢弃）
    ttl = max(_sso_time_window * 2, 60)
    for key in [k for k, t in _used_tickets.items() if now - t > ttl]:
        _used_tickets.pop(key, None)

    key = f"{workcode}:{tokendate}"
    if key in _used_tickets:
        return False
    _used_tickets[key] = now
    return True


def _find_user_by_workcode(db: Session, workcode: str) -> User | None:
    """按工号查找用户。

    修复：原先查询 `User.workcode_hash`，但该字段既未在 ORM 模型中定义，
    也不存在于数据库，导致 /sso/login 必然抛 AttributeError 返回 500。
    现改用已有的 employee_id / username 字段（employee_id 已有索引）。
    """
    return (
        db.query(User)
        .filter(or_(User.employee_id == workcode, User.username == workcode))
        .first()
    )


def _ensure_sso_ready() -> None:
    """启动/调用时的配置检查（替代原先每次登录都执行 ALTER TABLE 的做法）。"""
    if not settings.SSO_SHARED_SECRET:
        logger.warning(
            "SSO_SHARED_SECRET 未配置：OA 免密登录将以不安全的兼容模式运行"
        )


@router.get("/sso/login")
async def sso_login(
    request: Request,
    db: Session = Depends(get_db),
):
    """OA SSO 登录入口：校验 workcode + tokendate，完成登录并跳转。

    安全说明：票据校验见 `_validate_sso_ticket`。
    恢复的安全缺陷：原实现把校验错误一律 Redirect 到登录页，
    导致运维无法从日志区分「参数缺失 / 票据伪造 / 用户禁用」，
    且每次登录都会执行一次 ALTER TABLE。现已分别记录并移除运行时 DDL。
    """
    _ensure_sso_ready()
    workcode = (request.query_params.get("workcode") or "").strip()
    tokendate = (request.query_params.get("tokendate") or "").strip()

    # 步骤 1: 参数校验
    if not workcode or not tokendate:
        logger.warning("SSO 参数缺失: workcode=%s, tokendate=%s", bool(workcode), bool(tokendate))
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 2: 校验票据（含签名与时间窗）
    if not _validate_sso_ticket(workcode, tokendate):
        logger.warning("SSO 票据校验失败: workcode=%s", workcode)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 2.1: 防重放——同一票据只能使用一次
    if not _consume_ticket(workcode, tokendate):
        logger.warning("SSO 票据被重复使用（疑似重放）: workcode=%s", workcode)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 3: 查找用户（employee_id / username，均已有索引）
    user = _find_user_by_workcode(db, workcode)

    # 步骤 4: 用户不存在，从 OA 拉取并创建
    if not user:
        user = await _create_user_from_oa(db, workcode)
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


def _exchange_sso_code(code: str) -> dict:
    """用一次性 code 换取 JWT token（避免 token 暴露在 URL 中）。

    修复：原先只在取出时判断过期，过期条目无人清理，长期运行会缓慢泄漏内存。
    现顺带清理全部已过期 code。
    """
    now = datetime.now()
    # 惰性清理过期 code，避免字典无限增长
    for key in [k for k, v in _sso_codes.items() if now > v["expires_at"]]:
        _sso_codes.pop(key, None)

    entry = _sso_codes.pop(code, None)
    if not entry:
        raise HTTPException(status_code=400, detail="code 无效或已过期")
    if now > entry["expires_at"]:
        raise HTTPException(status_code=400, detail="code 已过期")
    return {"token": entry["token"]}


@router.get("/sso/exchange")
def exchange_code(code: str):
    """OA/企微回调后的 code 换取接口（保持原路径不变）。"""
    return _exchange_sso_code(code)


# 前端别名：前端使用 `${BASE}sso/exchange`（BASE = /api/learning-platform）调用。
# 经反向代理后落到 /api/sso/exchange，与其它业务接口走同一条路由规则，
# 这样生产环境无需为 /learning-platform/sso/* 单独配置 nginx location。
api_router = APIRouter(prefix="/api/sso", tags=["SSO"])


@api_router.get("/exchange")
def api_exchange_code(code: str):
    """前端换取 token 的接口（/sso/exchange 的 API 前缀别名）。"""
    return _exchange_sso_code(code)


def _sync_user_department(db: Session, user: User, department_path: str | None):
    """同步用户部门：将路径字符串同步到 Department 树，设置 department + department_id"""
    if not department_path:
        user.department = None
        user.department_id = None
        return

    user.department = department_path
    leaf = ensure_department_path(db, department_path)
    if leaf:
        user.department_id = leaf.id


async def _create_user_from_oa(db: Session, workcode: str) -> User | None:
    """从 OA 获取员工信息并创建用户"""
    employee = await fetch_employee_by_workcode(workcode)
    if not employee:
        logger.warning("SSO 无法从 OA 获取员工信息: workcode=%s", workcode)
        return None

    # 防止并发创建（先检查是否已被其他请求创建）
    existing = _find_user_by_workcode(db, workcode)
    if existing:
        return existing

    name = employee.get("lastname", workcode)
    raw_dept_id = employee.get("departmentid", "")
    email = employee.get("email", "")

    # 将 OA 部门 ID 转为完整路径
    department_path = None
    if raw_dept_id:
        try:
            department_path = await fetch_full_department_path(raw_dept_id, operator=workcode)
        except Exception:
            logger.warning("无法获取部门完整路径: id=%s", raw_dept_id)

    user = User(
        username=workcode,
        name=name,
        employee_id=workcode,
        department=department_path or raw_dept_id,
        role="student",  # SSO 自动创建的用户默认角色为 student，非 admin
        status="active",
        password_hash=None,
    )
    db.add(user)
    db.flush()
    _sync_user_department(db, user, department_path)
    db.commit()
    db.refresh(user)
    write_log(db=db, operator="系统(OA)", operator_id="", category="user", action="create", resource_type="用户", resource_name=name, description=f"系统通过 OA 自动创建了用户「{name}」", level="info")
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

    两种入口：
    1. 网页端点击「企业微信登录」按钮 —— state 由后端生成并缓存，必须校验通过
    2. 企微客户端内直接打开应用 —— state 由企微客户端提供，服务端无法验证

    修复：原先「state 不在缓存中也继续放行」，等于 CSRF 防护形同虚设
    （仅打印一行 warning 就继续登录）。现在默认改为**失败即拒绝**（fail-closed）；
    若确实需要支持企微客户端直接打开，显式设置
    `WECHAT_ALLOW_UNVERIFIED_STATE=true` 才放行，并记录 warning。
    """
    # 步骤 1: 校验 state（CSRF 防护）
    if state and state in _wechat_states:
        _wechat_states.pop(state, None)
    elif settings.WECHAT_ALLOW_UNVERIFIED_STATE:
        logger.warning(
            "企微回调 state 未经校验（WECHAT_ALLOW_UNVERIFIED_STATE=true），已放行: state=%s",
            state or "<empty>",
        )
    else:
        logger.warning(
            "企微回调 state 校验失败，已拒绝: state=%s（若需支持企微客户端直接打开，"
            "请设置 WECHAT_ALLOW_UNVERIFIED_STATE=true）",
            state or "<empty>",
        )
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

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

    # 步骤 4: 查找或创建用户（优先按 wechat_user_id，其次按 employee_id，最后从 OA 同步）
    workcode = userid  # 企微 userid 即工号
    user = db.query(User).filter(User.wechat_user_id == userid).first()

    if not user:
        # 尝试按工号匹配已有用户（可能之前通过 OA SSO 创建过）
        user = db.query(User).filter(User.employee_id == workcode).first()
        if user:
            # 关联企微账号
            user.wechat_user_id = userid
            user.wechat_avatar = wechat_avatar or user.wechat_avatar
            if wechat_name:
                user.name = wechat_name
            db.commit()
            logger.info("企微 SSO 关联已有用户: username=%s, name=%s", user.username, user.name)

    if not user:
        # 从 OA 系统同步员工信息
        # 修复：原代码 dept_path 只在 oa_info 带 departmentid 时才赋值，
        # 若 OA 返回的员工没有部门，后面引用 dept_path 会抛 NameError → 500。
        oa_info = None
        dept_path = None
        try:
            oa_info = await fetch_employee_by_workcode(workcode)
            if oa_info and oa_info.get("departmentid"):
                dept_path = await fetch_full_department_path(oa_info["departmentid"], operator=workcode)
                if dept_path:
                    oa_info["departmentid"] = dept_path
        except Exception as e:
            logger.error("OA API 查询失败: workcode=%s, error=%s", workcode, str(e))
            oa_info = None

        if oa_info:
            username = workcode
            user = User(
                username=username,
                name=oa_info.get("lastname", workcode),
                employee_id=workcode,
                department=str(oa_info.get("departmentid", "")),
                wechat_user_id=userid,
                wechat_avatar=wechat_avatar,
                role="student",
                status="active",
                password_hash=None,
            )
            db.add(user)
            db.flush()
            # 如果路径未成功扩展（不含 "-"），说明是原始部门 ID，不创建部门节点
            sync_path = dept_path if dept_path and "-" in dept_path else None
            _sync_user_department(db, user, sync_path)
            db.commit()
            db.refresh(user)
            write_log(db=db, operator="系统(企微)", operator_id="", category="user", action="create", resource_type="用户", resource_name=oa_info.get("lastname", username), description=f"企微从 OA 同步创建了用户「{oa_info.get('lastname', username)}」", level="info")
            logger.info(
                "企微 SSO 从 OA 同步创建用户: username=%s, name=%s, dept=%s",
                username, oa_info.get("lastname"), oa_info.get("departmentid"),
            )
        else:
            # OA 不可用，用企微信息创建
            username = f"wx_{userid}"
            user = User(
                username=username,
                name=wechat_name or userid,
                employee_id=workcode,
                wechat_user_id=userid,
                wechat_avatar=wechat_avatar,
                role="student",
                status="active",
                password_hash=None,
            )
            db.add(user)
            db.flush()
            _sync_user_department(db, user, None)  # 无 OA 数据，无部门
            db.commit()
            db.refresh(user)
            write_log(db=db, operator="系统(企微)", operator_id="", category="user", action="create", resource_type="用户", resource_name=wechat_name or userid, description=f"企微自动创建了用户「{wechat_name or userid}」", level="info")
            logger.info("企微 SSO 直接创建用户: username=%s, name=%s", username, wechat_name or userid)
    else:
        # 更新信息
        if wechat_avatar:
            user.wechat_avatar = wechat_avatar
        if wechat_name:
            user.name = wechat_name
        # 每次登录尝试从 OA 同步最新信息
        dept_path = None
        try:
            oa_info = await fetch_employee_by_workcode(workcode)
            if oa_info:
                user.name = oa_info.get("lastname", user.name)
                user.employee_id = workcode
                dept_id = oa_info.get("departmentid", "")
                if dept_id:
                    dept_path = await fetch_full_department_path(dept_id, operator=workcode)
        except Exception:
            pass
        # 同步部门树
        if dept_path:
            _sync_user_department(db, user, dept_path)
        db.commit()
        logger.info("企微 SSO 登录成功: username=%s, name=%s", user.username, user.name)

    # 步骤 5: 检查用户状态
    if user.status != "active":
        logger.warning("企微 SSO 用户已被禁用: username=%s", user.username)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")

    # 步骤 6: 首次登录检测
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

    # 步骤 7: 生成 JWT 和一次性 code
    token = create_access_token(user.id, user.role)
    code_value = str(_uuid.uuid4())
    _sso_codes[code_value] = {
        "token": token,
        "expires_at": datetime.now() + timedelta(seconds=_SSO_CODE_TTL),
    }
    logger.info("企微 SSO 登录成功: username=%s, role=%s", user.username, user.role)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso/callback?code={code_value}")