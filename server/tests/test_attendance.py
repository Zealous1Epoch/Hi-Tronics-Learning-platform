"""线下面授签到功能回归测试。

覆盖：场次 CRUD 约束、签到时间窗、动态码轮换与过期、重复签到、
可选网络/定位/设备去重、管理员补签与撤销、线下课程考试闸门、
多场次完成度、以及进度口径统一（完成项 = 场次）。
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401  确保所有模型注册到 Base.metadata
from app.models.attendance import AttendanceRecord, AttendanceSession
from app.models.course import Course, CourseAssignment
from app.models.exam import Exam, ExamPaper
from app.models.user import User
from app.services import attendance_service as att
from app.services.auth_service import hash_password
from tests.conftest import create_question


# ───────────────────────── 辅助 ─────────────────────────

def _make_offline_course(db: Session, title: str = "线下培训") -> Course:
    """构造「启用现场签到」的课程（require_attendance=True）。"""
    course = Course(
        id=str(uuid.uuid4()), title=title, status="published",
        course_type="offline",  # 历史字段保留
        require_attendance=True,
    )
    db.add(course)
    db.commit()
    return course


def _make_online_course(db: Session, title: str = "线上课程") -> Course:
    """构造纯线上课程（require_attendance 默认 False）。"""
    course = Course(
        id=str(uuid.uuid4()), title=title, status="published",
        course_type="online",  # 历史字段保留
        # require_attendance 默认 False
    )
    db.add(course)
    db.commit()
    return course


def _assign(client, admin_headers, course_id: str, user_id: str) -> None:
    client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [user_id], "department_ids": []},
        headers=admin_headers,
    )


def _student(db: Session, username: str = "student1") -> User:
    return db.query(User).filter(User.username == username).first()


def _make_session(
    db: Session,
    course: Course,
    *,
    title: str = "第一场",
    start_offset_min: int = -5,
    duration_min: int = 60,
    rotate: int = 30,
    **extra,
) -> AttendanceSession:
    """默认创建一个「已开放、尚未结束」的场次。"""
    now = datetime.now()
    session = AttendanceSession(
        id=str(uuid.uuid4()),
        course_id=course.id,
        title=title,
        start_time=now + timedelta(minutes=start_offset_min),
        end_time=now + timedelta(minutes=start_offset_min + duration_min),
        code_rotate_seconds=rotate,
        **extra,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _make_video(db: Session, course: Course, title: str = "测试视频") -> "Video":
    from app.models.course import Video
    v = Video(
        id=str(uuid.uuid4()), course_id=course.id, title=title,
        obs_key="test.mp4", duration=600, sort_order=0,
    )
    db.add(v); db.commit(); return v


def _make_exam_with_paper(db: Session, course: Course, *, status: str = "published") -> tuple[str, str]:
    q = create_question(db, "single_choice", "签到后考试题", {"correct": "A"})
    exam = Exam(
        id=str(uuid.uuid4()), course_id=course.id, title=f"{course.title} 考试",
        paper_type="fixed", duration=60, total_score=100, pass_score=60,
        max_attempts=None, status=status,
    )
    db.add(exam)
    db.flush()
    db.add(ExamPaper(
        id=str(uuid.uuid4()), exam_id=exam.id,
        questions=[{"question_id": q.id, "score": 100}],
    ))
    course.exam_id = exam.id
    db.commit()
    return exam.id, q.id


def _checkin(client, student_headers, session: AttendanceSession, code: str, **kwargs):
    return client.post(
        f"/api/student/attendance/{session.id}/checkin",
        json={"code": code, **kwargs},
        headers=student_headers,
    )


def _valid_code(session: AttendanceSession) -> str:
    """模拟投屏页取码：服务端按当前时间槽派生。"""
    return att.generate_code(session.id, session.code_rotate_seconds)


# ───────────────────────── 场次 CRUD 约束 ─────────────────────────

def test_online_course_cannot_have_sessions(client, admin_headers, db):
    """未开启「现场签到」的课程不应能建签到场次（避免给管理员造成「已配置签到」的错觉）。"""
    course = _make_online_course(db)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={course.id}",
        json={
            "title": "误建场次",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "现场签到" in res.json()["detail"]


def test_session_time_window_validated(client, admin_headers, db):
    """结束时间早于开始时间应被拒绝。"""
    course = _make_offline_course(db)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={course.id}",
        json={
            "title": "时间颠倒",
            "start_time": now.isoformat(),
            "end_time": (now - timedelta(hours=1)).isoformat(),
        },
        headers=admin_headers,
    )
    assert res.status_code == 422  # Pydantic 模型校验


def test_geofence_requires_coordinates(client, admin_headers, db):
    """启用定位校验却没填经纬度应被拒绝。"""
    course = _make_offline_course(db)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={course.id}",
        json={
            "title": "缺经纬度",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
            "require_geofence": True,
        },
        headers=admin_headers,
    )
    assert res.status_code == 422


def test_network_requires_allowlist(client, admin_headers, db):
    """启用网络校验却没填白名单应被拒绝。"""
    course = _make_offline_course(db)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={course.id}",
        json={
            "title": "缺白名单",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
            "require_network": True,
        },
        headers=admin_headers,
    )
    assert res.status_code == 422


# ───────────────────────── 签到核心校验 ─────────────────────────

def test_checkin_before_window_rejected(client, student_headers, admin_headers, db):
    """签到未开始时不允许提交。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course, start_offset_min=30, duration_min=60)

    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 400
    assert "尚未开始" in res.json()["detail"]


def test_checkin_after_window_rejected(client, student_headers, admin_headers, db):
    """签到已结束时不允许提交。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course, start_offset_min=-120, duration_min=60)

    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 400
    assert "已结束" in res.json()["detail"]


def test_checkin_wrong_code_rejected(client, student_headers, admin_headers, db):
    """签到码错误时拒绝。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course)

    res = _checkin(client, student_headers, session, "000000")
    # 极小概率恰好等于正确码，做一次保护性判断
    if res.status_code == 200:
        pytest.skip("随机码碰撞，跳过")
    assert res.status_code == 400
    assert "签到码" in res.json()["detail"]


def test_checkin_success_creates_record(client, student_headers, admin_headers, db):
    """正确签到码 → 成功并落库。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course, late_after_minutes=15)

    res = _checkin(client, student_headers, session, _valid_code(session), device_id="dev-aaa")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["status"] == "present"

    record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id,
        AttendanceRecord.user_id == user.id,
    ).first()
    assert record is not None
    assert record.status == "present"
    assert record.device_id == "dev-aaa"
    assert record.evidence and record.evidence["code_verified"] is True


def test_checkin_late_marked(client, student_headers, admin_headers, db):
    """超过 late_after_minutes 应记为迟到。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course, start_offset_min=-30, duration_min=60, late_after_minutes=10)

    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 200
    assert res.json()["status"] == "late"
    assert "late" in res.json()["risk_flags"]


def test_duplicate_checkin_rejected(client, student_headers, admin_headers, db):
    """同一场次不能重复签到（先由应用层拦截，数据库唯一约束兜底）。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course)

    assert _checkin(client, student_headers, session, _valid_code(session)).status_code == 200
    second = _checkin(client, student_headers, session, _valid_code(session))
    assert second.status_code == 400
    assert "无需重复" in second.json()["detail"]


def test_unassigned_student_cannot_checkin(client, student_headers, admin_headers, db):
    """未被分配课程的学员不能签到。"""
    course = _make_offline_course(db)
    session = _make_session(db, course)

    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 403


# ───────────────────────── 动态码轮换 ─────────────────────────

def test_code_rotates_and_previous_slot_accepted(db):
    """动态码随时间槽变化；上一槽仍被接受（容忍输码延迟），较早的槽失效。"""
    session_id = str(uuid.uuid4())
    rotate = 30
    now = datetime.now()

    code_now = att.generate_code(session_id, rotate, now)
    code_prev = att.generate_code(session_id, rotate, now - timedelta(seconds=rotate))
    code_old = att.generate_code(session_id, rotate, now - timedelta(seconds=rotate * 5))

    assert att.verify_code(session_id, rotate, code_now, now)["ok"] is True
    assert att.verify_code(session_id, rotate, code_prev, now)["ok"] is True
    assert att.verify_code(session_id, rotate, code_old, now)["ok"] is False

    # 跨槽后旧码自动失效
    later = now + timedelta(seconds=rotate * 3)
    assert att.verify_code(session_id, rotate, code_now, later)["ok"] is False


def test_code_differs_per_session(db):
    """不同场次在同一时间槽的码必须不同（防止串场次签到）。"""
    now = datetime.now()
    a = att.generate_code("session-a", 30, now)
    b = att.generate_code("session-b", 30, now)
    assert a != b


def test_code_is_six_digits():
    """投屏码为 6 位数字，便于人工读取。"""
    code = att.generate_code(str(uuid.uuid4()), 30)
    assert len(code) == 6 and code.isdigit()


def test_code_expires_in_within_rotate_window(db):
    assert 1 <= att.code_expires_in(30) <= 30


# ───────────────────────── 可选防代签开关 ─────────────────────────

def test_network_allowlist_enforced(client, student_headers, admin_headers, db):
    """开启网络校验后，非白名单来源 IP 不能签到。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    # 测试客户端来源 IP 为 "testclient"，白名单里放一个不匹配的网段
    session = _make_session(db, course, require_network=True, ip_allowlist=["10.0.0.0/8"])

    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 403
    assert "网络" in res.json()["detail"]


def test_geofence_enforced_when_out_of_range(client, student_headers, admin_headers, db):
    """开启定位校验且距离超限时拒绝。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(
        db, course,
        require_geofence=True, latitude=22.5431, longitude=114.0579, radius_m=100,
    )

    # 深圳 → 上海，远超半径
    res = _checkin(
        client, student_headers, session, _valid_code(session),
        latitude=31.2304, longitude=121.4737,
    )
    assert res.status_code == 403
    assert "超出允许范围" in res.json()["detail"]


def test_geofence_in_range_accepted(client, student_headers, admin_headers, db):
    """在半径内的定位应放行。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(
        db, course,
        require_geofence=True, latitude=22.5431, longitude=114.0579, radius_m=500,
    )

    # 与目标点相距约 30 米
    res = _checkin(
        client, student_headers, session, _valid_code(session),
        latitude=22.54340, longitude=114.05800,
    )
    assert res.status_code == 200, res.text


def test_geofence_requires_location_when_enforced(client, student_headers, admin_headers, db):
    """开启定位校验但未上报坐标 → 拒绝。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(
        db, course, require_geofence=True, latitude=22.5431, longitude=114.0579, radius_m=200,
    )
    res = _checkin(client, student_headers, session, _valid_code(session))
    assert res.status_code == 400
    assert "定位" in res.json()["detail"]


def test_device_dedupe_blocks_multi_account(client, student_headers, admin_headers, db):
    """开启设备去重后，同一设备为第 3 个账号签到应被拒绝。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, dedupe_device=True)

    # 造 3 个学员，共用同一台设备
    users = []
    for i in range(3):
        u = User(
            id=str(uuid.uuid4()), username=f"dev_user_{i}",
            password_hash=hash_password("Test12345!"), name=f"设备用户{i}",
            role="student", status="active",
        )
        db.add(u)
        users.append(u)
    db.commit()
    for u in users:
        _assign(client, admin_headers, course.id, u.id)

    codes = []
    for u in users:
        res = client.post(
            "/api/auth/login",
            json={"username": u.username, "password": "Test12345!"},
        )
        assert res.status_code == 200
        codes.append({"Authorization": f"Bearer {res.json()['access_token']}"})

    code = _valid_code(session)
    r1 = client.post(
        f"/api/student/attendance/{session.id}/checkin",
        json={"code": code, "device_id": "shared-phone"},
        headers=codes[0],
    )
    r2 = client.post(
        f"/api/student/attendance/{session.id}/checkin",
        json={"code": code, "device_id": "shared-phone"},
        headers=codes[1],
    )
    r3 = client.post(
        f"/api/student/attendance/{session.id}/checkin",
        json={"code": code, "device_id": "shared-phone"},
        headers=codes[2],
    )
    assert r1.status_code == 200
    assert r2.status_code == 200, "上限设为 2 个账号，第 2 个应放行"
    assert r3.status_code == 403
    assert "设备" in r3.json()["detail"]


# ───────────────────────── 管理员补签 / 撤销 / 名单 ─────────────────────────

def test_admin_manual_checkin_and_roster(client, admin_headers, student_headers, db):
    """管理员补签后，名单里该学员状态为已签到，未签到者仍在名单中。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course)

    roster = client.get(f"/api/attendance/sessions/{session.id}/roster", headers=admin_headers)
    assert roster.status_code == 200
    assert roster.json()["present_count"] == 0
    assert any(e["status"] == "absent" for e in roster.json()["entries"])

    res = client.post(
        f"/api/attendance/sessions/{session.id}/records",
        json={"user_ids": [user.id], "status": "manual", "remark": "手机没电"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["created"] == 1

    roster = client.get(f"/api/attendance/sessions/{session.id}/roster", headers=admin_headers)
    body = roster.json()
    assert body["present_count"] == 1
    entry = next(e for e in body["entries"] if e["user_id"] == user.id)
    assert entry["status"] == "manual"
    assert entry["record"]["remark"] == "手机没电"


def test_revoke_restores_absent(client, admin_headers, student_headers, db):
    """撤销签到采用软撤销，学员回到未签到状态且出勤不再计入。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course)

    assert _checkin(client, student_headers, session, _valid_code(session)).status_code == 200
    record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id, AttendanceRecord.user_id == user.id
    ).first()

    res = client.delete(f"/api/attendance/records/{record.id}", headers=admin_headers)
    assert res.status_code == 200

    db.refresh(record)
    assert record.status == "revoked"          # 留痕仍在

    mine = client.get(f"/api/student/courses/{course.id}/attendance", headers=student_headers)
    assert mine.json()["attended_count"] == 0
    assert mine.json()["can_take_exam"] is False


def test_revoked_then_recheckin_restores(client, student_headers, admin_headers, db):
    """被撤销后，学员再次凭码签到应恢复出勤（而不是被永久卡死）。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course)

    assert _checkin(client, student_headers, session, _valid_code(session)).status_code == 200
    record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session.id, AttendanceRecord.user_id == user.id
    ).first()
    client.delete(f"/api/attendance/records/{record.id}", headers=admin_headers)

    again = _checkin(client, student_headers, session, _valid_code(session))
    assert again.status_code == 200
    db.refresh(record)
    assert record.status in att.EFFECTIVE_STATUSES


def test_delete_session_requires_confirm(client, admin_headers, db):
    course = _make_offline_course(db)
    session = _make_session(db, course)
    assert client.delete(f"/api/attendance/sessions/{session.id}", headers=admin_headers).status_code == 400


def test_delete_session_blocked_when_records_exist(client, admin_headers, student_headers, db):
    """已有签到记录时默认拒绝删除场次，保护出勤留痕。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course)
    _checkin(client, student_headers, session, _valid_code(session))

    res = client.delete(f"/api/attendance/sessions/{session.id}?confirm=true", headers=admin_headers)
    assert res.status_code == 409
    res = client.delete(
        f"/api/attendance/sessions/{session.id}?confirm=true&force=true", headers=admin_headers
    )
    assert res.status_code == 200


# ───────────────────────── 考试闸门 ─────────────────────────

def test_offline_course_exam_blocked_before_checkin(client, student_headers, admin_headers, db):
    """启用签到的课程未签到不能开始考试。

    注：按新需求统一改为「考试只看视频进度」，签到不再卡考试。本用例改为
    验证「启用签到但学员没看视频，也能开始考试」——保留用例名以保持兼容性。
    """
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    _make_session(db, course)
    exam_id, _ = _make_exam_with_paper(db, course)

    # 签到不再阻塞考试；考试只看视频进度
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text


def test_offline_course_exam_unlocked_after_checkin(client, student_headers, admin_headers, db):
    """签到成功后即可开始考试（按新规则，签到不阻塞；本用例保留以兼容旧测试名）。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course)
    exam_id, _ = _make_exam_with_paper(db, course)

    assert _checkin(client, student_headers, session, _valid_code(session)).status_code == 200
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text


def test_offline_course_without_sessions_blocks_exam(client, student_headers, admin_headers, db):
    """新规则：考试只看视频进度，不卡签到。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    exam_id, _ = _make_exam_with_paper(db, course)

    # 旧断言：assert res.status_code == 403
    # 新规则下即使签到未配置，也不阻塞考试
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text


def test_online_course_exam_not_blocked(client, student_headers, admin_headers, db):
    """纯线上课程（require_attendance=False）不应被签到闸门影响。"""
    course = _make_online_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    exam_id, _ = _make_exam_with_paper(db, course)

    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text


def test_exam_status_reports_blocker(client, student_headers, admin_headers, db):
    """新规则：考试 status 不再因签到被 block。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    _make_session(db, course)
    exam_id, _ = _make_exam_with_paper(db, course)

    res = client.get(f"/api/student/exams/{exam_id}/status", headers=student_headers)
    assert res.status_code == 200
    body = res.json()
    # 旧断言：assert body["can_start"] is False and "签到" in body["reason"]
    # 新规则：签到不再阻塞考试，can_start 仍可能因其他原因（未发布/时间窗）false，
    # 但 reason 不应含「签到」字样
    if body["can_start"] is False and body["reason"]:
        assert "签到" not in body["reason"], f"签到不应再阻塞考试，但 reason={body['reason']}"


# ───────────────────────── 进度口径 ─────────────────────────

def test_offline_progress_uses_sessions_as_total(client, student_headers, admin_headers, db):
    """新规则：进度统一按视频统计；启用签到的课程签到信息作为附加项返回。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    s1 = _make_session(db, course, title="第一场")
    _make_session(db, course, title="第二场")

    res = client.get(f"/api/student/progress/{course.id}", headers=student_headers)
    body = res.json()
    # unit 统一为「节」（视频统计）；course_type 历史保留
    assert body["unit_label"] == "节"
    assert body["total_count"] == 0  # 无视频
    assert body["completed_count"] == 0
    # 启用签到 → 签到信息作为附加项返回
    assert body["require_attendance"] is True
    assert body["attendance"] is not None
    assert body["attendance"]["required_count"] == 2
    assert body["attendance"]["attended_count"] == 0

    _checkin(client, student_headers, s1, _valid_code(s1))
    body = client.get(f"/api/student/progress/{course.id}", headers=student_headers).json()
    assert body["completed_count"] == 0  # 视频未看 → 主进度仍 0
    assert body["attendance"]["attended_count"] == 1
    # 考试只看视频进度；但本课无视频，按"无完成项"处理；can_take_exam 恒为 True
    assert body["can_take_exam"] is True
    assert len(body["attendance"]["sessions"]) == 2


def test_offline_course_completed_after_all_sessions_and_exam(client, student_headers, admin_headers, db):
    """新规则：视频全部看完 + 考试通过 = 课程完成（不再以签到为准）。"""
    course = _make_offline_course(db)
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    _make_session(db, course, title="第一场")
    _make_session(db, course, title="第二场")
    exam_id, qid = _make_exam_with_paper(db, course)

    # 视频未上传 → 总数 0 → 不算完成
    body = client.get(f"/api/student/progress/{course.id}", headers=student_headers).json()
    assert body["total_count"] == 0
    assert body["completed"] is False, "无视频时课程不算完成"

    # 视频进度未达成前，completed 仍为 False
    client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": qid, "answer": "A"}]},
        headers=student_headers,
    )
    body = client.get(f"/api/student/progress/{course.id}", headers=student_headers).json()
    assert body["exam_passed"] is True
    # 总数 0 → 不算完成（与原测试"无视频就不算完成"语义一致）
    assert body["completed"] is False


def test_courses_with_progress_includes_offline(client, student_headers, admin_headers, db):
    """我的课程列表：unit_label='节'（统一）；session_count 仍返回场次数（兼容）。"""
    course = _make_offline_course(db)
    _assign(client, admin_headers, course.id, _student(db).id)
    session = _make_session(db, course)
    _checkin(client, student_headers, session, _valid_code(session))

    rows = client.get("/api/student/courses-with-progress", headers=student_headers).json()
    row = next(r for r in rows if r["id"] == course.id)
    assert row["course_type"] == "offline"
    assert row["unit_label"] == "节"
    # 无视频 → 主进度 0；签到作为附加项返回
    assert row["total_count"] == 0
    assert row["completed_count"] == 0
    assert row["session_count"] == 1
    assert row["attended_count"] == 1
    assert row["required_count"] == 1


def test_admin_progress_overview_counts_attendance(client, student_headers, admin_headers, db):
    """管理端进度概览：unit='节'，主进度按视频，签到作为附加项。"""
    course = _make_offline_course(db)
    _make_video(db, course)  # 加一个视频让课程被纳入概览
    user = _student(db)
    _assign(client, admin_headers, course.id, user.id)
    session = _make_session(db, course)
    _checkin(client, student_headers, session, _valid_code(session))

    res = client.get(f"/api/admin/progress/overview?course_id={course.id}", headers=admin_headers)
    assert res.status_code == 200
    rows = res.json()
    row = next(r for r in rows if r["user_id"] == user.id)
    c = next(x for x in row["courses"] if x["course_id"] == course.id)
    assert c["course_type"] == "offline"
    # 主进度：1 个视频、0 完成（没看过视频）；签到作为附加项
    assert c["total_count"] == 1
    assert c["completed_count"] == 0
    assert c["attended_count"] == 1
    assert c["required_count"] == 1
    assert c["progress_pct"] == 0


def test_course_out_exposes_type_and_session_count(client, admin_headers, db):
    """课程详情/列表应返回 course_type（兼容）+ require_attendance + session_count。"""
    course = _make_offline_course(db)
    _make_session(db, course)

    res = client.get(f"/api/courses/{course.id}", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["course_type"] == "offline"  # 历史字段保留
    assert body["require_attendance"] is True  # 新增字段
    assert body["session_count"] == 1


def test_course_type_switch_validated(client, admin_headers, db):
    """新规则：course_type 不再强校验（兼容老调用方），改为 require_attendance 可切换。"""
    course = _make_offline_course(db)
    # 老 API：传 course_type=hybrid 不再被拒（兼容）
    res = client.put(
        f"/api/courses/{course.id}", json={"course_type": "hybrid"}, headers=admin_headers
    )
    # 兼容：course_type=hybrid 不报错；老数据 course_type 保留
    assert res.status_code == 200, res.text
    # 新 API：require_attendance 可切换
    res2 = client.put(
        f"/api/courses/{course.id}", json={"require_attendance": False}, headers=admin_headers
    )
    assert res2.status_code == 200
    assert res2.json()["require_attendance"] is False


# ───────────────────────── 企业微信扫码签到 ─────────────────────────

from unittest.mock import AsyncMock, patch  # noqa: E402


def test_wecom_state_signing_roundtrip():
    """state 签名：正常还原 / 篡改拒绝 / 形参非法拒绝。"""
    s = att.sign_wecom_state("sess-9")
    assert att.verify_wecom_state(s) == "sess-9"
    # 篡改签名最后一位
    bad = s[:-1] + ("0" if s[-1] != "0" else "1")
    assert att.verify_wecom_state(bad) is None
    assert att.verify_wecom_state("not.valid.format") is None
    assert att.verify_wecom_state("") is None


def test_wecom_checkin_qr_not_configured(client, admin_headers, db):
    """企微未配置时，生成扫码二维码应明确报错。"""
    course = _make_offline_course(db)
    session = _make_session(db, course)
    res = client.get(
        f"/api/student/wecom/checkin-qr?session_id={session.id}", headers=admin_headers
    )
    assert res.status_code == 400
    assert "企业微信" in res.json()["detail"]


def test_wecom_checkin_qr_authorize_url(client, admin_headers, db, monkeypatch):
    """已配置时，返回的企业微信授权链接应包含 appid / 静默授权 / 回调地址。"""
    from app.config import settings as _settings
    monkeypatch.setattr(_settings, "WECHAT_CORP_ID", "corp123")
    monkeypatch.setattr(_settings, "WECHAT_AGENT_ID", "agent1")
    monkeypatch.setattr(_settings, "WECHAT_SECRET", "secret")
    monkeypatch.setattr(_settings, "FRONTEND_URL", "https://demo.example.com/learning-platform")
    course = _make_offline_course(db)
    session = _make_session(db, course)
    res = client.get(
        f"/api/student/wecom/checkin-qr?session_id={session.id}", headers=admin_headers
    )
    assert res.status_code == 200
    url = res.json()["authorize_url"]
    assert "appid=corp123" in url
    assert "scope=snsapi_base" in url
    assert "agentid=agent1" in url
    assert "learning-platform%2Fwecom%2Fcheckin" in url  # 回调地址已编码


def test_wecom_exchange_bad_state(client):
    """state 非法/过期 → 400，避免伪造场次签到。"""
    res = client.get("/api/student/wecom/exchange?code=x&state=garbage")
    assert res.status_code == 400


def test_wecom_exchange_unknown_user(client, admin_headers, db, monkeypatch):
    """企微 userid 无法匹配到培训账号 → 404 友好提示。"""
    async def _fake_get_user_info(code):
        return {"userid": "nobody"}
    monkeypatch.setattr("app.routers.attendance.get_user_info", _fake_get_user_info)
    course = _make_offline_course(db)
    session = _make_session(db, course)
    state = att.sign_wecom_state(session.id)
    res = client.get(f"/api/student/wecom/exchange?code=x&state={state}")
    assert res.status_code == 404
    assert "未找到" in res.json()["detail"]


def test_wecom_exchange_success(client, admin_headers, student_headers, db):
    """完整链路：企微 userid → 匹配账号 → 签到落库（source=wecom），无需登录。"""
    course = _make_offline_course(db)
    session = _make_session(db, course)
    student = db.query(User).filter(User.username == "student1").first()
    student.wechat_user_id = "wx-1"
    db.commit()
    _assign(client, admin_headers, course.id, student.id)

    state = att.sign_wecom_state(session.id)
    with patch("app.routers.attendance.get_user_info", new=AsyncMock(return_value={"userid": "wx-1"})):
        res = client.get(f"/api/student/wecom/exchange?code=x&state={state}")

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["user_name"] == "测试学员"
    assert body["course_title"] == course.title
    rec = (
        db.query(AttendanceRecord)
        .filter_by(session_id=session.id, user_id=student.id)
        .first()
    )
    assert rec is not None
    assert rec.source == "wecom"


def test_wecom_exchange_duplicate_blocked(client, admin_headers, student_headers, db):
    """同一学员重复企微签到 → 400 已签到提示（与动态码一致）。"""
    course = _make_offline_course(db)
    session = _make_session(db, course)
    student = db.query(User).filter(User.username == "student1").first()
    student.wechat_user_id = "wx-1"
    db.commit()
    _assign(client, admin_headers, course.id, student.id)

    state = att.sign_wecom_state(session.id)
    with patch("app.routers.attendance.get_user_info", new=AsyncMock(return_value={"userid": "wx-1"})):
        r1 = client.get(f"/api/student/wecom/exchange?code=x&state={state}")
        assert r1.status_code == 200
        r2 = client.get(f"/api/student/wecom/exchange?code=x&state={state}")
    assert r2.status_code == 400
    assert "已完成" in r2.json()["detail"]


# ───────────────────────── 公开签到：扫码输工号 ─────────────────────────

def test_public_checkin_info_ok(client, db):
    """扫码落地页拉取场次信息（公开，无需登录）。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    res = client.get(f"/api/student/checkin/by-credential/info?session_id={session.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"] == session.id
    assert body["course_title"] == course.title
    assert body["state"] in ("upcoming", "open", "closed")


def test_public_checkin_success(client, admin_headers, student_headers, db):
    """(employee_id, name) 双重校验通过 → 签到落库（source=employee_no）。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    student = _student(db)
    student.employee_id = "A001"
    db.commit()
    _assign(client, admin_headers, course.id, student.id)

    res = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "A001", "name": "测试学员"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert "输工号" in body["message"]
    rec = (
        db.query(AttendanceRecord)
        .filter_by(session_id=session.id, user_id=student.id)
        .first()
    )
    assert rec is not None
    assert rec.source == "employee_no"


def test_public_checkin_wrong_employee_id(client, db):
    """工号不存在 → 统一提示「工号或姓名不正确」。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    res = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "NOPE", "name": "任意"},
    )
    assert res.status_code == 400
    assert "工号或姓名不正确" in res.json()["detail"]


def test_public_checkin_name_mismatch(client, admin_headers, student_headers, db):
    """工号对、姓名错 → 同样 400（不泄露「工号存在但姓名错」与「工号不存在」的差别）。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    student = _student(db)
    student.employee_id = "A001"
    db.commit()
    _assign(client, admin_headers, course.id, student.id)

    res = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "A001", "name": "张冠李戴"},
    )
    assert res.status_code == 400
    assert "工号或姓名不正确" in res.json()["detail"]


def test_public_checkin_duplicate(client, admin_headers, student_headers, db):
    """同一学员重复扫码签到 → 400 已签到。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    student = _student(db)
    student.employee_id = "A001"
    db.commit()
    _assign(client, admin_headers, course.id, student.id)

    r1 = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "A001", "name": "测试学员"},
    )
    assert r1.status_code == 200
    r2 = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "A001", "name": "测试学员"},
    )
    assert r2.status_code == 400
    assert "已完成" in r2.json()["detail"]


def test_public_checkin_rate_limit(client, db):
    """同一 session+IP 每分钟最多 5 次，超限 429。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    for i in range(5):
        r = client.post(
            f"/api/student/checkin/by-credential?session_id={session.id}",
            json={"employee_id": f"NO{i}", "name": "x"},
        )
        assert r.status_code == 400  # 不论对错都计入次数
    r6 = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "NO5", "name": "x"},
    )
    assert r6.status_code == 429


def test_public_checkin_not_assigned(client, admin_headers, student_headers, db):
    """账号匹配但未分配该课程 → 403。"""
    course = _make_offline_course(db)
    session = _make_session(db, course, start_offset_min=-5, duration_min=60)
    student = _student(db)
    student.employee_id = "A001"
    db.commit()
    # 不调用 _assign：故意不分配

    res = client.post(
        f"/api/student/checkin/by-credential?session_id={session.id}",
        json={"employee_id": "A001", "name": "测试学员"},
    )
    assert res.status_code == 403
    assert "未分配" in res.json()["detail"]
