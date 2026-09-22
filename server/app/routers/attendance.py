"""线下课程签到路由：管理端场次管理 + 学员端现场签到。

防代签分层（均为场次级开关，默认关闭以保证体验）：
1. 动态签到码（始终生效）：投屏轮播、按时间槽 HMAC 派生、过期作废、每人一次
2. require_network：只允许白名单 IP / 网段提交
3. require_geofence：必须上报定位且在半径内（1.5 倍内软放行但打标）
4. dedupe_device：同一设备不得为多个账号签到（防一人代签多人）
5. 管理员复核：名单中带异常标记，可补签与撤销
"""

from __future__ import annotations

import hashlib
import io
import uuid
from datetime import datetime

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from urllib.parse import quote

from app.database import get_db
from app.logger import get_logger
from app.models.attendance import AttendanceRecord, AttendanceSession
from app.models.course import Course
from app.models.user import User
from app.routers.auth import get_current_user, require_admin
from app.services.request_utils import get_client_ip
from app.config import settings
from app.schemas.attendance import (
    CheckInRequest,
    CheckInResultOut,
    CourseAttendanceOverview,
    ManualCheckInRequest,
    MyAttendanceOut,
    ProjectorCodeOut,
    PublicCheckInRequest,
    StudentCodeOut,
    RecordOut,
    RosterEntry,
    RosterOut,
    SessionCreate,
    SessionOut,
    SessionUpdate,
)
from app.services import attendance_service as att
from app.services.department_scope import (
    check_course_assignment,
    get_course_students,
)
from app.services.log_service import write_log
from app.services.wechat_service import get_user_info

logger = get_logger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["线下签到（管理端）"])
student_router = APIRouter(prefix="/api/student", tags=["线下签到（学员端）"])


# ───────────────────────── 通用辅助 ─────────────────────────

def _get_course_or_404(db: Session, course_id: str) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    return course


def _get_session_or_404(db: Session, session_id: str) -> AttendanceSession:
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="签到场次不存在")
    return session


def _session_payload(db: Session, session: AttendanceSession, expected_count: int | None = None) -> SessionOut:
    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).all()
    effective = [r for r in records if r.status in att.EFFECTIVE_STATUSES]
    risk = sum(1 for r in effective if r.risk_flags)
    if expected_count is None:
        expected_count = len(get_course_students(db, session.course_id))
    return SessionOut(
        id=session.id,
        course_id=session.course_id,
        title=session.title,
        start_time=session.start_time,
        end_time=session.end_time,
        late_after_minutes=session.late_after_minutes,
        location_name=session.location_name,
        latitude=session.latitude,
        longitude=session.longitude,
        radius_m=session.radius_m,
        ip_allowlist=session.ip_allowlist,
        require_network=session.require_network,
        require_geofence=session.require_geofence,
        dedupe_device=session.dedupe_device,
        code_rotate_seconds=session.code_rotate_seconds,
        remark=session.remark,
        created_at=session.created_at,
        state=att.session_state(session),
        checked_in_count=len(effective),
        expected_count=expected_count,
        risk_count=risk,
    )


def _record_out(record: AttendanceRecord, user: User) -> RecordOut:
    return RecordOut(
        id=record.id,
        user_id=record.user_id,
        user_name=user.name,
        username=user.username,
        employee_id=user.employee_id,
        department=user.department,
        status=record.status,
        source=record.source,
        checked_in_at=record.checked_in_at,
        client_ip=record.client_ip,
        device_id=record.device_id,
        distance_m=record.distance_m,
        risk_flags=record.risk_flags or [],
        remark=record.remark,
    )


# ───────────────────────── 管理端：场次 CRUD ─────────────────────────

@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    course_id: str = Query(..., description="课程 ID"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """列出某课程的全部签到场次（含应到/已到/异常人数）。"""
    _get_course_or_404(db, course_id)
    sessions = att.load_sessions(db, course_id)
    expected = len(get_course_students(db, course_id))
    return [_session_payload(db, s, expected) for s in sessions]


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreate,
    course_id: str = Query(..., description="课程 ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """创建签到场次。

    注意：只有开启了「现场签到」（course.require_attendance=True）的课程才能配置签到场次。
    未开启签到的课程若误建场次不会生效，但为避免混淆这里直接拒绝。
    """
    course = _get_course_or_404(db, course_id)
    if not course.require_attendance:
        raise HTTPException(
            status_code=400,
            detail="请先在课程设置中开启「现场签到」开关，再配置签到场次",
        )

    session = AttendanceSession(
        course_id=course_id,
        title=data.title,
        start_time=data.start_time,
        end_time=data.end_time,
        late_after_minutes=data.late_after_minutes,
        location_name=data.location_name,
        latitude=data.latitude,
        longitude=data.longitude,
        radius_m=data.radius_m,
        ip_allowlist=data.ip_allowlist,
        require_network=data.require_network,
        require_geofence=data.require_geofence,
        dedupe_device=data.dedupe_device,
        code_rotate_seconds=data.code_rotate_seconds,
        remark=data.remark,
        created_by=current_user.id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="attendance", action="create", resource_type="签到场次",
        resource_name=f"{course.title} / {session.title}",
        description=f"{current_user.name} 为课程「{course.title}」创建了签到场次「{session.title}」",
        level="info",
    )
    return _session_payload(db, session)


@router.put("/sessions/{session_id}", response_model=SessionOut)
def update_session(
    session_id: str,
    data: SessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """更新签到场次。"""
    session = _get_session_or_404(db, session_id)
    update = data.model_dump(exclude_unset=True)

    for field, value in update.items():
        setattr(session, field, value)

    if session.end_time <= session.start_time:
        raise HTTPException(status_code=400, detail="签到结束时间必须晚于开始时间")
    if session.require_geofence and (session.latitude is None or session.longitude is None):
        raise HTTPException(status_code=400, detail="启用定位校验前请先填写目标经纬度")
    if session.require_network and not session.ip_allowlist:
        raise HTTPException(status_code=400, detail="启用网络校验前请先填写允许的 IP / 网段")

    db.commit()
    db.refresh(session)
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="attendance", action="update", resource_type="签到场次",
        resource_name=session.title,
        description=f"{current_user.name} 修改了签到场次「{session.title}」",
        level="info",
    )
    return _session_payload(db, session)


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    confirm: bool = Query(False, description="必须显式传 true 才执行删除"),
    force: bool = Query(False, description="已有签到记录时需再传 force=true"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除签到场次（含其签到记录）。已有签到记录时默认拒绝，保护出勤留痕。"""
    if not confirm:
        raise HTTPException(status_code=400, detail="删除签到场次需要显式确认（confirm=true）")

    session = _get_session_or_404(db, session_id)
    record_count = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).count()
    if record_count and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"该场次已有 {record_count} 条签到记录，为避免误删出勤留痕已阻止删除。"
                "如确认要一并删除，请传 force=true。"
            ),
        )

    title = session.title
    db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).delete(
        synchronize_session=False
    )
    db.delete(session)
    db.commit()
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="attendance", action="delete", resource_type="签到场次",
        resource_name=title, description=f"{current_user.name} 删除了签到场次「{title}」",
        level="warning",
    )
    return {"ok": True, "removed_records": record_count}


# ───────────────────────── 管理端：投屏签到码 ─────────────────────────

@router.get("/sessions/{session_id}/code", response_model=ProjectorCodeOut)
def get_projector_code(
    session_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """投屏页轮询接口：返回当前动态签到码与剩余有效时间。

    该接口只做「读取 + 计算」，不写库，因此投屏页可以按秒轮询。
    """
    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)
    checked_in = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.status.in_(att.EFFECTIVE_STATUSES),
        )
        .count()
    )
    checkin_url = f"{settings.FRONTEND_URL}/checkin/{session.id}"
    return ProjectorCodeOut(
        session_id=session.id,
        session_title=session.title,
        course_title=course.title,
        location_name=session.location_name,
        code=att.generate_code(session.id, session.code_rotate_seconds),
        rotate_seconds=session.code_rotate_seconds,
        expires_in=att.code_expires_in(session.code_rotate_seconds),
        server_time=datetime.now(),
        state=att.session_state(session),
        checked_in_count=checked_in,
        expected_count=len(get_course_students(db, session.course_id)),
        checkin_url=checkin_url,
    )


# ───────────────────────── 管理端：名单 / 补签 / 撤销 ─────────────────────────

@router.get("/sessions/{session_id}/roster", response_model=RosterOut)
def get_roster(
    session_id: str,
    include_absent: bool = Query(True, description="是否包含未签到学员"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """应到名单 + 签到状态 + 异常标记。"""
    session = _get_session_or_404(db, session_id)
    students = get_course_students(db, session.course_id)
    records = {
        r.user_id: r
        for r in db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
    }

    entries: list[RosterEntry] = []
    present = absent = risk = 0
    for s in students:
        rec = records.get(s.id)
        if rec is None:
            absent += 1
            if not include_absent:
                continue
            entries.append(RosterEntry(
                user_id=s.id, user_name=s.name, username=s.username,
                employee_id=s.employee_id, department=s.department,
                record=None, status="absent",
            ))
            continue

        if rec.status in att.EFFECTIVE_STATUSES:
            present += 1
            if rec.risk_flags:
                risk += 1
        else:
            absent += 1

        entries.append(RosterEntry(
            user_id=s.id, user_name=s.name, username=s.username,
            employee_id=s.employee_id, department=s.department,
            record=_record_out(rec, s), status=rec.status,
        ))

    # 有记录但不属于应到名单的（如课程分配后来被移除）也一并展示，便于核对
    known = {s.id for s in students}
    for uid, rec in records.items():
        if uid in known:
            continue
        u = db.query(User).filter(User.id == uid).first()
        if not u:
            continue
        entries.append(RosterEntry(
            user_id=u.id, user_name=u.name, username=u.username,
            employee_id=u.employee_id, department=u.department,
            record=_record_out(rec, u), status=rec.status,
        ))

    return RosterOut(
        session=_session_payload(db, session, len(students)),
        entries=entries,
        present_count=present,
        absent_count=absent,
        risk_count=risk,
    )


@router.post("/sessions/{session_id}/records")
def manual_check_in(
    session_id: str,
    data: ManualCheckInRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """管理员补签（学员手机没电、设备故障、事后核实的合理途径）。"""
    session = _get_session_or_404(db, session_id)
    if data.status not in ("manual", "late", "present"):
        raise HTTPException(status_code=400, detail="状态只能是 manual / late / present")

    created = 0
    updated = 0
    for uid in data.user_ids:
        user = db.query(User).filter(User.id == uid).first()
        if not user:
            continue
        existing = (
            db.query(AttendanceRecord)
            .filter(AttendanceRecord.session_id == session_id, AttendanceRecord.user_id == uid)
            .first()
        )
        if existing:
            # 已签到：只在「已撤销」时恢复，避免覆盖真实签到时间
            if existing.status == "revoked":
                existing.status = data.status
                existing.source = "manual"
                existing.operator_id = current_user.id
                existing.remark = data.remark or existing.remark
                updated += 1
            continue
        db.add(AttendanceRecord(
            id=str(uuid.uuid4()),
            session_id=session_id,
            course_id=session.course_id,
            user_id=uid,
            status=data.status,
            source="manual",
            checked_in_at=datetime.now(),
            operator_id=current_user.id,
            remark=data.remark or "管理员补签",
            risk_flags=["manual"],
        ))
        created += 1

    db.commit()
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="attendance", action="update", resource_type="签到记录",
        resource_name=session.title,
        description=f"{current_user.name} 在签到场次「{session.title}」补签 {created} 人、恢复 {updated} 人",
        level="warning",
    )
    return {"ok": True, "created": created, "restored": updated}


@router.delete("/records/{record_id}")
def revoke_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """撤销一条签到记录。

    采用**软撤销**（status=revoked）而非物理删除：既能让该学员回到未签到状态，
    又完整保留「谁在什么时候签的、被谁撤销」的审计链条。
    """
    record = db.query(AttendanceRecord).filter(AttendanceRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="签到记录不存在")
    if record.status == "revoked":
        return {"ok": True, "already_revoked": True}

    record.status = "revoked"
    record.operator_id = current_user.id
    db.commit()

    user = db.query(User).filter(User.id == record.user_id).first()
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="attendance", action="update", resource_type="签到记录",
        resource_name=user.name if user else record.user_id,
        description=f"{current_user.name} 撤销了 {user.name if user else record.user_id} 的签到记录",
        level="warning",
    )
    return {"ok": True}


@router.get("/courses/{course_id}/overview", response_model=CourseAttendanceOverview)
def course_overview(
    course_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """课程维度的签到汇总：全勤 / 部分出勤 / 未签到人数。"""
    course = _get_course_or_404(db, course_id)
    sessions = att.load_sessions(db, course_id)
    students = get_course_students(db, course_id)

    counts = att.batch_offline_counts(db, [s.id for s in students], [course_id])
    fully = partially = absent = 0
    for s in students:
        attended = counts.get((s.id, course_id), 0)
        if sessions and attended >= len(sessions):
            fully += 1
        elif attended > 0:
            partially += 1
        else:
            absent += 1

    return CourseAttendanceOverview(
        course_id=course.id,
        course_title=course.title,
        course_type=course.course_type,
        require_attendance=course.require_attendance,
        sessions=[_session_payload(db, s, len(students)) for s in sessions],
        expected_count=len(students),
        fully_attended_count=fully,
        partially_attended_count=partially,
        absent_count=absent,
    )


# ───────────────────────── 管理端：导出 ─────────────────────────

@router.get("/sessions/{session_id}/export")
def export_session(
    session_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """导出某场次的签到表（Excel），用于留档与抽查。"""
    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)
    students = get_course_students(db, session.course_id)
    records = {
        r.user_id: r
        for r in db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
    }

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "签到表"

    head_font = Font(name="微软雅黑", bold=True, size=11, color="FFFFFF")
    head_fill = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    thin = Border(
        left=Side(style="thin", color="C0C0C0"), right=Side(style="thin", color="C0C0C0"),
        top=Side(style="thin", color="C0C0C0"), bottom=Side(style="thin", color="C0C0C0"),
    )
    warn_fill = PatternFill(start_color="FFF3CD", end_color="FFF3CD", fill_type="solid")

    status_label = {
        "present": "已签到", "late": "迟到", "manual": "管理员补签",
        "revoked": "已撤销", "absent": "未签到",
    }
    flag_label = {
        "ip_mismatch": "IP 不符", "no_geolocation": "无定位",
        "geo_soft_pass": "定位偏远", "device_reuse": "设备重复",
        "late": "迟到", "manual": "人工补签",
    }

    # 标题行
    ws.merge_cells("A1:I1")
    title_cell = ws["A1"]
    title_cell.value = f"{course.title} · {session.title}  签到表"
    title_cell.font = Font(name="微软雅黑", bold=True, size=14, color="1B365D")
    title_cell.alignment = center
    ws.row_dimensions[1].height = 30

    ws.merge_cells("A2:I2")
    meta = ws["A2"]
    meta.value = (
        f"签到时间：{session.start_time:%Y-%m-%d %H:%M} ~ {session.end_time:%Y-%m-%d %H:%M}"
        f"    地点：{session.location_name or '未填写'}"
        f"    应到 {len(students)} 人"
    )
    meta.font = Font(name="微软雅黑", size=10, color="5F5E5A")
    meta.alignment = left

    headers = ["序号", "姓名", "工号", "部门", "签到状态", "签到时间", "客户端 IP", "异常标记", "备注"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=3, column=i, value=h)
        c.font = head_font
        c.fill = head_fill
        c.alignment = center
        c.border = thin

    row = 4
    for idx, s in enumerate(students, start=1):
        rec = records.get(s.id)
        flags = "、".join(flag_label.get(f, f) for f in (rec.risk_flags or [])) if rec else ""
        values = [
            idx,
            s.name,
            s.employee_id or "",
            s.department or "",
            status_label.get(rec.status, rec.status) if rec else status_label["absent"],
            rec.checked_in_at.strftime("%Y-%m-%d %H:%M:%S") if rec else "",
            rec.client_ip or "" if rec else "",
            flags,
            (rec.remark or "") if rec else "",
        ]
        for i, v in enumerate(values, start=1):
            c = ws.cell(row=row, column=i, value=v)
            c.font = Font(name="微软雅黑", size=10)
            c.alignment = center if i in (1, 3, 5, 6, 7) else left
            c.border = thin
            if rec and rec.risk_flags:
                c.fill = warn_fill
        row += 1

    widths = [6, 12, 12, 24, 12, 20, 16, 22, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A4"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"attendance_{session.start_time:%Y%m%d}_{session_id[:8]}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ───────────────────────── 学员端 ─────────────────────────

@student_router.get("/courses/{course_id}/attendance", response_model=MyAttendanceOut)
def my_attendance(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """我的签到状态（课程详情页用）。"""
    course = _get_course_or_404(db, course_id)
    if not check_course_assignment(db, current_user, course_id):
        raise HTTPException(status_code=403, detail="未分配该课程")

    detail = att.course_attendance_detail(db, current_user.id, course)
    satisfied, blockers = att.attendance_blockers(db, current_user.id, course)
    return MyAttendanceOut(
        course_id=course.id,
        course_type=course.course_type,
        require_attendance=course.require_attendance,
        sessions=detail["sessions"],
        required_count=detail["required_count"],
        attended_count=detail["attended_count"],
        satisfied=detail["satisfied"],
        can_take_exam=satisfied,
        blockers=blockers,
    )


@student_router.get("/attendance/sessions/{session_id}/code", response_model=StudentCodeOut)
def my_session_code(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """学员扫码页拉取当前动态签到码（只读，不写库）。

    二维码里只编码本签到链接与场次 ID，手机打开此页后再来取最新一轮的码，
    因此投影页的二维码可保持静态、无需随码重画。
    """
    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)
    if not check_course_assignment(db, current_user, session.course_id):
        raise HTTPException(status_code=403, detail="未分配该课程")

    return StudentCodeOut(
        session_id=session.id,
        course_id=session.course_id,
        session_title=session.title,
        course_title=course.title,
        location_name=session.location_name,
        code=att.generate_code(session.id, session.code_rotate_seconds),
        rotate_seconds=session.code_rotate_seconds,
        expires_in=att.code_expires_in(session.code_rotate_seconds),
        state=att.session_state(session),
    )


@student_router.post("/attendance/{session_id}/checkin", response_model=CheckInResultOut)
def check_in(
    session_id: str,
    data: CheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """现场签到（动态码方式）。

    校验顺序：课程分配 → 动态码正确且未过期 → 时间窗 → 重复 / 网络 / 定位 / 设备
    （后几项统一在 `att.record_check_in` 中完成）。
    """
    session = _get_session_or_404(db, session_id)
    _get_course_or_404(db, session.course_id)
    now = datetime.now()
    client_ip = get_client_ip(request)
    user_agent = (request.headers.get("User-Agent") or "")[:500]

    if not check_course_assignment(db, current_user, session.course_id):
        raise HTTPException(status_code=403, detail="未分配该课程")

    # ── 动态码校验（扫码/输码方式特有；企微方式跳过）──
    verify = att.verify_code(session.id, session.code_rotate_seconds, data.code, now)
    if not verify["ok"]:
        raise HTTPException(
            status_code=400,
            detail="签到码不正确或已过期，请重新查看投屏上的最新签到码",
        )

    try:
        result = att.record_check_in(
            db,
            session,
            current_user,
            client_ip=client_ip,
            user_agent=user_agent,
            device_id=data.device_id,
            latitude=data.latitude,
            longitude=data.longitude,
            source="code",
            evidence_extra={
                "code_verified": True,
                "matched_slot": verify.get("matched_slot"),
                "slot_now": att.current_slot(session.code_rotate_seconds, now),
                "window": [session.start_time.isoformat(), session.end_time.isoformat()],
            },
        )
    except HTTPException:
        raise

    return CheckInResultOut(
        ok=result["ok"],
        status=result["status"],
        checked_in_at=result["checked_in_at"],
        message=result["message"],
        risk_flags=result.get("risk_flags", []),
    )


# ───────────────────────── 学员端：扫码输工号签到（公开、不需登录） ─────────────────────────
#
# 适用：HTTP 公网、学员手机任意扫码 App、企业微信（不依赖 OAuth）。
# 流程：投屏页二维码编码「平台 H5 落地页」 → 学员扫码 → 落地页输入工号+姓名
#       → 服务端 (employee_id, name) 双重校验匹配账号 → 复用 record_check_in 签到。
# 安全：输入限频、按 session+IP 计数；失败仅提示账号不存在/姓名不符，不透露具体工号列表。

# 公开签到输入限频：每个 session_id + 客户端 IP 每分钟最多 5 次错误尝试，
# 防止暴力枚举工号。
_public_checkin_attempts: dict[tuple[str, str], list[float]] = {}
_PUBLIC_CHECKIN_LIMIT = 5
_PUBLIC_CHECKIN_WINDOW = 60.0


def _public_checkin_rate_limit(session_id: str, ip: str) -> bool:
    """True 表示允许；False 表示超限。"""
    now_ts = datetime.now().timestamp()
    key = (session_id, ip or "")
    bucket = _public_checkin_attempts.setdefault(key, [])
    # 滑动窗口：剔除过期
    bucket[:] = [t for t in bucket if now_ts - t < _PUBLIC_CHECKIN_WINDOW]
    if len(bucket) >= _PUBLIC_CHECKIN_LIMIT:
        return False
    bucket.append(now_ts)
    return True


@student_router.post("/checkin/by-credential")
def public_checkin_by_credential(
    session_id: str,
    data: PublicCheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """扫码输工号签到（公开、不需登录）。

    输入工号 + 姓名双重校验；复用 record_check_in 核心逻辑。
    """
    client_ip = get_client_ip(request) or "unknown"
    user_agent = (request.headers.get("User-Agent") or "")[:500]

    if not _public_checkin_rate_limit(session_id, client_ip):
        raise HTTPException(
            status_code=429,
            detail="尝试次数过多，请稍后再试",
        )

    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)

    # 时间窗（与动态码签到一致）
    now = datetime.now()
    state = att.session_state(session, now)
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

    # (employee_id, name) 双重匹配
    emp = (data.employee_id or "").strip()
    name = (data.name or "").strip()
    user = (
        db.query(User)
        .filter(User.employee_id == emp)
        .first()
    )
    # 姓名去空格、忽略全/半角差异，宽松匹配；同时要求大小写不敏感。
    name_norm = name.replace("　", "").replace(" ", "").lower()
    if not user or (
        user.name.replace("　", "").replace(" ", "").lower() != name_norm
    ):
        # 不泄露「工号存在但姓名错」与「工号不存在」的差别，避免被枚举
        raise HTTPException(
            status_code=400,
            detail="工号或姓名不正确，请核对后重试",
        )

    if user.status != "active":
        raise HTTPException(status_code=403, detail="该账号已被禁用，无法签到")

    if not check_course_assignment(db, user, session.course_id):
        raise HTTPException(
            status_code=403,
            detail="你未分配该课程，无法签到",
        )

    # 复用核心签到逻辑（device_id 用 IP+UA 派生，便于后续审计）
    derived_device_id = hashlib.sha1(
        f"{user.id}|{client_ip}|{user_agent[:80]}".encode("utf-8")
    ).hexdigest()[:32]

    try:
        result = att.record_check_in(
            db,
            session,
            user,
            client_ip=client_ip,
            user_agent=user_agent,
            device_id=derived_device_id,
            source="employee_no",
            evidence_extra={
                "credential": "employee_no+name",
                "client_ip": client_ip,
            },
        )
    except HTTPException:
        raise

    return CheckInResultOut(
        ok=result["ok"],
        status=result["status"],
        checked_in_at=result["checked_in_at"],
        message=result["message"] + "（输工号签到）",
        risk_flags=result.get("risk_flags", []),
    )


@student_router.get("/checkin/by-credential/info")
def public_checkin_info(
    session_id: str,
    db: Session = Depends(get_db),
):
    """扫码落地页拉取场次信息（公开）：标题/课程/地点/状态，便于学员确认是否签对了场次。"""
    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)
    now = datetime.now()
    state = att.session_state(session, now)
    return {
        "session_id": session.id,
        "session_title": session.title,
        "course_title": course.title,
        "location_name": session.location_name,
        "start_time": session.start_time.isoformat(),
        "end_time": session.end_time.isoformat(),
        "state": state,
    }


# ───────────────────────── 学员端：企业微信扫码签到 ─────────────────────────
#
# 流程（无需学员在手机上登录平台）：
#   1. 投屏页二维码编码「企业微信 OAuth 授权链接」，state 绑定 session_id（防篡改+过期）。
#   2. 学员用企业微信扫该码 → 企微静默授权 → 重定向到前端 /wecom/checkin?code=..&state=..
#   3. 前端回调页拿 code+state 调本接口 → 服务端用 code 换 userid → 匹配账号 → 签到。
# 该接口公开（不要求 JWT），身份完全由企微 OAuth 背书。

@student_router.get("/wecom/checkin-qr")
def wecom_checkin_qr(
    session_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理端投屏页调用：返回本场次的企业微信扫码授权链接。

    二维码只编码这个授权链接（静态、与轮播动态码无关），学员扫后由企微识别身份。
    """
    if not (settings.WECHAT_CORP_ID and settings.WECHAT_AGENT_ID and settings.WECHAT_SECRET):
        raise HTTPException(
            status_code=400,
            detail="企业微信未配置（WECHAT_CORP_ID / WECHAT_AGENT_ID / WECHAT_SECRET），无法生成扫码签到二维码",
        )
    session = _get_session_or_404(db, session_id)

    redirect_uri = f"{settings.FRONTEND_URL.rstrip('/')}/wecom/checkin"
    state = att.sign_wecom_state(session_id)
    # 文档: https://developer.work.weixin.qq.com/document/path/91335
    # scope=snsapi_base 为静默授权，企微内直接拿到 userid，无需学员任何输入。
    authorize_url = (
        "https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={settings.WECHAT_CORP_ID}"
        f"&redirect_uri={quote(redirect_uri, safe='')}"
        "&response_type=code"
        "&scope=snsapi_base"
        f"&agentid={settings.WECHAT_AGENT_ID}"
        f"&state={state}"
        "#wechat_redirect"
    )
    return {"authorize_url": authorize_url, "session_title": session.title}


@student_router.get("/wecom/exchange")
async def wecom_exchange(
    code: str,
    state: str = "",
    request: Request = None,
    db: Session = Depends(get_db),
):
    """企业微信扫码回调（公开，无需登录）：code → userid → 匹配账号 → 签到。

    由前端 /wecom/checkin 回调页调用，返回结构化结果供页面展示。
    """
    """企业微信扫码回调（公开，无需登录）：code → userid → 匹配账号 → 签到。

    由前端 /wecom/checkin 回调页调用，返回结构化结果供页面展示。
    """
    session_id = att.verify_wecom_state(state)
    if not session_id:
        raise HTTPException(status_code=400, detail="二维码已过期或无效，请重新扫描投屏上的二维码")

    session = _get_session_or_404(db, session_id)
    course = _get_course_or_404(db, session.course_id)

    # 1) 用 code 换取企微用户身份（userid）
    try:
        info = await get_user_info(code)
    except Exception as e:  # noqa: BLE001 — 企微接口异常统一转 502
        logger.error("企微 getuserinfo 失败: %s", str(e))
        raise HTTPException(status_code=502, detail="企业微信授权失败，请稍后重试")
    userid = (info or {}).get("userid")
    if not userid:
        raise HTTPException(status_code=400, detail="未能获取企业微信身份信息，请重试")

    # 2) 匹配平台账号：优先按企微 userid，其次按工号（企微 userid 通常即工号）
    user = db.query(User).filter(User.wechat_user_id == userid).first()
    if not user:
        user = db.query(User).filter(User.employee_id == userid).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="未找到对应的培训账号，请联系管理员（请确认企业微信账号已与系统工号绑定）",
        )
    if user.status != "active":
        raise HTTPException(status_code=403, detail="该账号已被禁用，无法签到")

    # 3) 课程分配校验
    if not check_course_assignment(db, user, session.course_id):
        raise HTTPException(status_code=403, detail="你未分配该课程，无法签到")

    # 4) 签到（复用核心逻辑，无需动态码）
    client_ip = get_client_ip(request) if request else None
    user_agent = (request.headers.get("User-Agent") or "")[:500] if request else ""
    try:
        result = att.record_check_in(
            db,
            session,
            user,
            client_ip=client_ip,
            user_agent=user_agent,
            source="wecom",
        )
    except HTTPException:
        raise

    return {
        "ok": True,
        "status": result["status"],
        "message": result["message"],
        "course_title": course.title,
        "session_title": session.title,
        "user_name": user.name,
        "checked_in_at": result["checked_in_at"].isoformat() if result.get("checked_in_at") else None,
        "risk_flags": result.get("risk_flags", []),
    }
