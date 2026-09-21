"""线下面授签到服务：动态签到码、时间窗校验、可选网络/定位校验、出勤汇总。

### 动态签到码（防代签的核心）

采用**无状态 HMAC** 方案，不落库：

    code = HMAC-SHA256(secret, f"att:{session_id}:{slot}") 取前 6 位十进制
    slot = int(unix_now / code_rotate_seconds)

服务端校验时接受 `slot` 与 `slot - 1` 两个时间槽（容忍学员输码慢与时钟抖动）。
好处：
- 每 30 秒不必写一次数据库；
- 管理员投屏页面轮询时也不会产生写入；
- 码由服务端密钥派生，前端与投屏页拿不到生成算法，无法自行推算未来码；
- 配合 `expires_in` 让学员看到剩余时间，过期即废。

**诚实的边界**：动态码挡得住截图转发和事后补签，但挡不住「在场同学用微信把码
发给不在场的人」。要堵这条路径需要叠加网络白名单 / 设备去重 / 管理员复核
（见 `require_network` / `dedupe_device` 与 records 接口），这些均为场次级开关。
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import math
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.logger import get_logger
from app.models.attendance import AttendanceRecord, AttendanceSession
from app.models.course import Course

logger = get_logger(__name__)

# 有效出勤状态（revoked 不计入）
EFFECTIVE_STATUSES = ("present", "late", "manual")

# 定位校验的宽容系数：半径的 1.5 倍内仍放行，但会打标提醒管理员复核。
# 纯 GPS 在城市楼宇内误差常有 50~150 米，硬卡半径会大量误杀。
GEOFENCE_SOFT_FACTOR = 1.5

# 同一设备「最多允许」几个账号签到（dedupe_device 开启时生效）
# 设为 2 而非 1：共用电脑/平板（如培训室固定终端）的场景下允许 2 个账号，
# 超过则判定为代签嫌疑。判定条件是「已有其他账号数 >= 上限」。
DEVICE_MAX_ACCOUNTS = 2


# ───────────────────────── 动态码 ─────────────────────────

def _secret() -> str:
    """动态码密钥。优先专用配置，其次 SSO 密钥，最后回退 JWT 密钥。"""
    secret = (
        getattr(settings, "ATTENDANCE_CODE_SECRET", "")
        or settings.SSO_SHARED_SECRET
        or settings.JWT_SECRET
    )
    return secret or ""


def current_slot(rotate_seconds: int, at: datetime | None = None) -> int:
    at = at or datetime.now()
    rotate = max(int(rotate_seconds or 30), 1)
    return int(at.timestamp()) // rotate


def generate_code(session_id: str, rotate_seconds: int, at: datetime | None = None) -> str:
    """按时间槽生成 6 位动态码。"""
    slot = current_slot(rotate_seconds, at)
    raw = hmac.new(
        _secret().encode("utf-8"),
        f"att:{session_id}:{slot}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{int(raw[:8], 16) % 1_000_000:06d}"


def verify_code(session_id: str, rotate_seconds: int, code: str, at: datetime | None = None) -> dict:
    """校验动态码，接受当前槽与上一槽。

    返回 {"ok": bool, "slot": int|None, "accepted_slots": [...]}，用于写入 evidence 留痕。
    """
    at = at or datetime.now()
    code = (code or "").strip()
    slot = current_slot(rotate_seconds, at)
    accepted = []
    for s in (slot, slot - 1):
        raw = hmac.new(
            _secret().encode("utf-8"),
            f"att:{session_id}:{s}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        expected = f"{int(raw[:8], 16) % 1_000_000:06d}"
        accepted.append(expected)
        if hmac.compare_digest(expected, code):
            return {"ok": True, "slot": s, "accepted_slots": accepted, "matched_slot": s}
    return {"ok": False, "slot": None, "accepted_slots": accepted, "matched_slot": None}


def code_expires_in(rotate_seconds: int, at: datetime | None = None) -> int:
    """当前动态码剩余有效秒数。"""
    at = at or datetime.now()
    rotate = max(int(rotate_seconds or 30), 1)
    elapsed = int(at.timestamp()) % rotate
    return rotate - elapsed


# ───────────────────────── 场次状态 ─────────────────────────

def session_state(session: AttendanceSession, at: datetime | None = None) -> str:
    """upcoming（未开始）/ open（签到中）/ closed（已结束）。"""
    at = at or datetime.now()
    if at < session.start_time:
        return "upcoming"
    if at > session.end_time:
        return "closed"
    return "open"


# ───────────────────────── 网络与定位 ─────────────────────────

def ip_in_allowlist(client_ip: str | None, allowlist: list[str] | None) -> bool:
    """判断 IP 是否落在 CIDR / 单 IP 白名单内。"""
    if not allowlist:
        return False
    if not client_ip:
        return False
    try:
        ip = ipaddress.ip_address(client_ip.strip())
    except ValueError:
        return False

    for entry in allowlist:
        entry = (entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if ip in ipaddress.ip_network(entry, strict=False):
                    return True
            elif ip == ipaddress.ip_address(entry):
                return True
        except ValueError:
            logger.warning("签到 IP 白名单中存在无法解析的条目: %s", entry)
    return False


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点间球面距离（米）。"""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ───────────────────────── 出勤汇总 ─────────────────────────

def load_sessions(db: Session, course_id: str) -> list[AttendanceSession]:
    return (
        db.query(AttendanceSession)
        .filter(AttendanceSession.course_id == course_id)
        .order_by(AttendanceSession.start_time)
        .all()
    )


def load_records(db: Session, session_ids: list[str], user_id: str | None = None) -> list[AttendanceRecord]:
    if not session_ids:
        return []
    q = db.query(AttendanceRecord).filter(AttendanceRecord.session_id.in_(session_ids))
    if user_id:
        q = q.filter(AttendanceRecord.user_id == user_id)
    return q.all()


def effective_records(records: list[AttendanceRecord]) -> list[AttendanceRecord]:
    """过滤掉已撤销的记录。"""
    return [r for r in records if r.status in EFFECTIVE_STATUSES]


def offline_counts(db: Session, user_id: str, sessions: list[AttendanceSession]) -> tuple[int, int]:
    """返回 (已签到有效场次数, 应签到场次数)。"""
    if not sessions:
        return 0, 0
    session_ids = [s.id for s in sessions]
    records = effective_records(load_records(db, session_ids, user_id))
    return len({r.session_id for r in records}), len(sessions)


def attendance_blockers(
    db: Session, user_id: str, course: Course, sessions: list[AttendanceSession] | None = None
) -> tuple[bool, list[str]]:
    """签到闸门：仅对 require_attendance=True 的课程生效。

    返回 (是否满足, 阻止原因列表)。

    规则：
    - 未启用签到：直接放行，blockers 为空（不影响考试/进度）
    - 启用签到、全部场次签到 → 满足
    - 启用签到、未完成 → 返回具体提示
    - 启用签到、但一场都没配置 → 视为未就绪并阻止（避免管理员漏配导致闸门失效）
    """
    if not course.require_attendance:
        return True, []

    sessions = sessions if sessions is not None else load_sessions(db, course.id)
    if not sessions:
        return False, ["管理员尚未为本课程配置签到场次，请联系管理员"]

    session_ids = [s.id for s in sessions]
    records = effective_records(load_records(db, session_ids, user_id))
    if not records:
        now = datetime.now()
        pending = [s for s in sessions if session_state(s, now) != "closed"]
        if pending:
            nxt = pending[0]
            return False, [f"请先完成现场签到（{nxt.title}，{nxt.start_time:%m-%d %H:%M} 开始）"]
        return False, ["本课程需要现场签到，签到已结束且你没有签到记录，请联系管理员补签"]

    return True, []


def course_attendance_detail(db: Session, user_id: str, course: Course) -> dict:
    """学员视角的签到明细，供课程详情页渲染。"""
    sessions = load_sessions(db, course.id)
    if not sessions:
        return {
            "sessions": [],
            "required_count": 0,
            "attended_count": 0,
            "satisfied": False,
        }

    records = {r.session_id: r for r in load_records(db, [s.id for s in sessions], user_id)}
    now = datetime.now()
    items = []
    attended = 0
    for s in sessions:
        rec = records.get(s.id)
        ok = rec is not None and rec.status in EFFECTIVE_STATUSES
        if ok:
            attended += 1
        items.append({
            "id": s.id,
            "title": s.title,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "location_name": s.location_name,
            "state": session_state(s, now),
            "require_geofence": bool(s.require_geofence),
            "checked_in": ok,
            "status": rec.status if rec else None,
            "checked_in_at": rec.checked_in_at if rec else None,
            "remark": rec.remark if rec else None,
        })

    return {
        "sessions": items,
        "required_count": len(sessions),
        "attended_count": attended,
        # 课程完成维度：全部场次都要签到
        "satisfied": attended >= len(sessions),
    }


def course_progress_counts(db: Session, user_id: str, course: Course) -> tuple[int, int, str]:
    """[已迁移] 统一进度口径请使用 services/progress_service.batch_progress_map。

    保留此薄封装以兼容单课程调用；内部直接复用 progress_service，避免两处口径漂移。
    """
    from app.services.progress_service import batch_progress_map

    row = batch_progress_map(db, user_id, [course]).get(course.id)
    if not row:
        return 0, 0, "节"
    return row.completed_count, row.total_count, row.unit_label


def batch_offline_counts(
    db: Session, user_ids: list[str], course_ids: list[str]
) -> dict[tuple[str, str], int]:
    """批量统计 (user_id, course_id) → 已签到有效场次数，用于管理端列表避免 N+1。"""
    if not user_ids or not course_ids:
        return {}
    rows = (
        db.query(
            AttendanceRecord.user_id,
            AttendanceRecord.course_id,
            AttendanceRecord.session_id,
        )
        .filter(
            AttendanceRecord.user_id.in_(user_ids),
            AttendanceRecord.course_id.in_(course_ids),
            AttendanceRecord.status.in_(EFFECTIVE_STATUSES),
        )
        .all()
    )
    counter: dict[tuple[str, str], set[str]] = {}
    for uid, cid, sid in rows:
        counter.setdefault((uid, cid), set()).add(sid)
    return {k: len(v) for k, v in counter.items()}


def session_ids_by_course(db: Session, course_ids: list[str]) -> dict[str, list[str]]:
    """课程 → 场次数量（分母）。"""
    if not course_ids:
        return {}
    rows = (
        db.query(AttendanceSession.course_id, AttendanceSession.id)
        .filter(AttendanceSession.course_id.in_(course_ids))
        .all()
    )
    out: dict[str, list[str]] = {}
    for cid, sid in rows:
        out.setdefault(cid, []).append(sid)
    return out


def compute_risk_flags(
    *,
    client_ip_ok: bool | None,
    geo_distance: float | None,
    radius_m: int,
    device_reuse: bool,
    late: bool,
    require_geofence: bool = False,
) -> list[str]:
    """生成异常标记，供管理员在名单里一眼看出可疑签到。

    「无定位」只在场次开启定位校验（require_geofence）时才标记：
    PC 签到等场景本身不要求定位，缺失坐标属正常情况，不应算异常。
    """
    flags: list[str] = []
    if client_ip_ok is False:
        flags.append("ip_mismatch")
    if geo_distance is None:
        if require_geofence:
            flags.append("no_geolocation")
    elif geo_distance > radius_m:
        flags.append("geo_soft_pass")
    if device_reuse:
        flags.append("device_reuse")
    if late:
        flags.append("late")
    return flags


def check_late(session: AttendanceSession, at: datetime | None = None) -> bool:
    """是否迟到（按场次配置的 late_after_minutes）。"""
    if session.late_after_minutes is None:
        return False
    at = at or datetime.now()
    threshold = session.start_time + timedelta(minutes=session.late_after_minutes)
    return at > threshold


# ───────────────────────── 签到核心（多种入口共用） ─────────────────────────

def record_check_in(
    db: Session,
    session: AttendanceSession,
    user,
    *,
    client_ip: str | None = None,
    user_agent: str = "",
    device_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    source: str = "code",
    evidence_extra: dict | None = None,
    now: datetime | None = None,
) -> dict:
    """现场签到核心逻辑（时间窗 / 重复 / 可选网络·定位·设备 / 风险标记 / 落库）。

    被两类入口复用：
    - 动态码签到（source="code"）：调用方先校验动态码，再传入 evidence_extra。
    - 企业微信扫码签到（source="wecom"）：身份由企微 OAuth 解析，无需动态码。

    返回 dict；在以下情况直接抛 HTTPException（与旧 check_in 行为一致）：
      时间窗未开 / 已结束 / 已签到 / 网络不符 / 定位不符 / 设备重复。
    """
    now = now or datetime.now()

    # ── 1) 时间窗 ──
    state = session_state(session, now)
    if state == "upcoming":
        raise HTTPException(
            status_code=400,
            detail=f"签到尚未开始（{session.start_time:%Y-%m-%d %H:%M} 开始）",
        )
    if state == "closed":
        raise HTTPException(
            status_code=400,
            detail=f"签到已结束（{session.end_time:%Y-%m-%d %H:%M} 截止），请联系管理员补签",
        )

    # ── 2) 是否已签到 ──
    existing = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.session_id == session.id, AttendanceRecord.user_id == user.id)
        .first()
    )
    if existing and existing.status in EFFECTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="你已完成本场次签到，无需重复提交")

    # ── 3) 可选：网络校验 ──
    ip_ok: bool | None = None
    if session.require_network:
        ip_ok = ip_in_allowlist(client_ip, session.ip_allowlist)
        if not ip_ok:
            raise HTTPException(
                status_code=403,
                detail="当前网络不在允许范围内，请在培训现场连接指定网络后重试",
            )
    elif session.ip_allowlist:
        ip_ok = ip_in_allowlist(client_ip, session.ip_allowlist)

    # ── 4) 可选：定位校验 ──
    distance: float | None = None
    if session.latitude is not None and session.longitude is not None:
        if latitude is None or longitude is None:
            if session.require_geofence:
                raise HTTPException(
                    status_code=400,
                    detail="本场次需要定位校验，请在浏览器弹窗中选择「允许获取位置」后重试",
                )
        else:
            distance = haversine_m(session.latitude, session.longitude, latitude, longitude)
            if session.require_geofence and distance > session.radius_m * GEOFENCE_SOFT_FACTOR:
                raise HTTPException(
                    status_code=403,
                    detail=f"当前位置距签到点约 {int(distance)} 米，超出允许范围（{session.radius_m} 米）",
                )

    # ── 5) 可选：设备去重 ──
    device_reuse = False
    if session.dedupe_device and device_id:
        others = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.session_id == session.id,
                AttendanceRecord.device_id == device_id,
                AttendanceRecord.user_id != user.id,
                AttendanceRecord.status.in_(EFFECTIVE_STATUSES),
            )
            .count()
        )
        device_reuse = others >= DEVICE_MAX_ACCOUNTS
        if device_reuse:
            raise HTTPException(
                status_code=403,
                detail="该设备已为其他账号签到，请使用本人设备扫码/输码",
            )
    elif device_id:
        device_reuse = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.session_id == session.id,
                AttendanceRecord.device_id == device_id,
                AttendanceRecord.user_id != user.id,
                AttendanceRecord.status.in_(EFFECTIVE_STATUSES),
            )
            .count()
            >= DEVICE_MAX_ACCOUNTS
        )

    late = check_late(session, now)
    flags = compute_risk_flags(
        client_ip_ok=ip_ok,
        geo_distance=distance,
        radius_m=session.radius_m,
        device_reuse=device_reuse,
        late=late,
        require_geofence=session.require_geofence,
    )

    evidence = dict(evidence_extra or {})
    evidence.update({
        "ip_check_enforced": session.require_network,
        "ip_in_allowlist": ip_ok,
        "geofence_enforced": session.require_geofence,
        "distance_m": distance,
        "radius_m": session.radius_m,
        "dedupe_device_enforced": session.dedupe_device,
        "late": late,
        "source": source,
    })

    if existing:
        # 曾被撤销 → 恢复
        existing.status = "late" if late else "present"
        existing.source = source
        existing.checked_in_at = now
        existing.client_ip = client_ip
        existing.user_agent = user_agent
        existing.device_id = device_id
        existing.latitude = latitude
        existing.longitude = longitude
        existing.distance_m = distance
        existing.risk_flags = flags or None
        existing.evidence = evidence
        db.commit()
        return {
            "ok": True, "status": existing.status, "checked_in_at": now,
            "message": "签到成功", "risk_flags": flags or [], "restored": True,
        }

    record = AttendanceRecord(
        session_id=session.id,
        course_id=session.course_id,
        user_id=user.id,
        status="late" if late else "present",
        source=source,
        checked_in_at=now,
        client_ip=client_ip,
        user_agent=user_agent,
        device_id=device_id,
        latitude=latitude,
        longitude=longitude,
        distance_m=distance,
        risk_flags=flags or None,
        evidence=evidence,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        # 并发重复提交：唯一约束兜住
        db.rollback()
        raise HTTPException(status_code=400, detail="你已完成本场次签到，无需重复提交")

    logger.info(
        "签到成功(来源=%s): session=%s, user=%s, status=%s, ip=%s, flags=%s",
        source, session.id, user.username if hasattr(user, "username") else user.id,
        record.status, client_ip, flags,
    )
    return {
        "ok": True,
        "status": record.status,
        "checked_in_at": now,
        "message": "签到成功" + ("（迟到）" if late else ""),
        "risk_flags": flags or [],
        "restored": False,
    }


# ───────────────────────── 企业微信扫码 state 签名 ─────────────────────────

def _wecom_state_secret() -> str:
    """企微扫码 state 签名密钥（与动态码密钥同源，优先专用配置）。"""
    secret = (
        getattr(settings, "ATTENDANCE_CODE_SECRET", "")
        or settings.SSO_SHARED_SECRET
        or settings.JWT_SECRET
    )
    return secret or ""


def sign_wecom_state(session_id: str, ttl_minutes: int = 30) -> str:
    """为某个签到场次生成一个防篡改、带过期的 state（用于企微 OAuth 回调）。

    state 形如 `{session_id}.{exp}.{sig}`，sig = HMAC(secret, "{session_id}.{exp}")[:16]。
    企微回调时再用 verify_wecom_state 还原 session_id，从而把「扫码」绑定到具体场次，
    避免有人构造链接把受害者签到其他场次。
    """
    exp = int((datetime.now() + timedelta(minutes=ttl_minutes)).timestamp())
    payload = f"{session_id}.{exp}"
    sig = hmac.new(
        _wecom_state_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()[:16]
    return f"{payload}.{sig}"


def verify_wecom_state(state: str | None) -> str | None:
    """校验并还原 session_id；过期或签名不符返回 None。"""
    if not state or state.count(".") != 2:
        return None
    try:
        session_id, exp_s, sig = state.split(".")
        exp = int(exp_s)
    except (ValueError, TypeError):
        return None
    if int(datetime.now().timestamp()) > exp:
        return None
    payload = f"{session_id}.{exp_s}"
    expect = hmac.new(
        _wecom_state_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()[:16]
    if not hmac.compare_digest(expect, sig):
        return None
    return session_id
