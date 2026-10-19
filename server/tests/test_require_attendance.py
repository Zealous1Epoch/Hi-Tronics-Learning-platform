"""课程签到口径的端到端测试。

2026-10-19 起：签到与课程类型（require_attendance 旧开关）解绑，任何课程都可
配置签到场次，签到统计/闸门完全由「是否存在场次」驱动。require_attendance
字段本身保留（响应兼容、PUT 可写），本文件同时覆盖旧字段读写与新口径行为。
"""
import uuid
from datetime import datetime, timedelta

import pytest

import app.models  # noqa: F401
from app.models.attendance import AttendanceSession
from app.models.course import Course
from app.models.user import User
from app.models.learning_progress import LearningProgress
from tests.conftest import create_question


# ───────────────────────── 辅助 ─────────────────────────

def _make_course(db, *, require_attendance: bool) -> Course:
    c = Course(
        id=str(uuid.uuid4()),
        title=("启用签到" if require_attendance else "纯线上"),
        status="published",
        require_attendance=require_attendance,
    )
    db.add(c); db.commit(); return c


def _make_video(db, course: Course) -> str:
    from app.models.course import Video
    v = Video(
        id=str(uuid.uuid4()), course_id=course.id, title="第一节",
        obs_key="t.mp4", duration=600, sort_order=0,
    )
    db.add(v); db.commit(); return v.id


def _make_session(db, course: Course) -> AttendanceSession:
    now = datetime.now()
    s = AttendanceSession(
        id=str(uuid.uuid4()), course_id=course.id, title="第一场",
        start_time=now - timedelta(minutes=5),
        end_time=now + timedelta(minutes=55),
        code_rotate_seconds=30,
    )
    db.add(s); db.commit(); return s


def _assign(client, admin_headers, course_id: str, user_id: str) -> None:
    client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [user_id], "department_ids": []},
        headers=admin_headers,
    )


# ───────────────────────── 测试 ─────────────────────────

def test_require_attendance_field_default_false(db):
    """新课程的 require_attendance 默认 False（无需显式赋值）。"""
    c = Course(id=str(uuid.uuid4()), title="x", status="draft")
    db.add(c); db.commit()
    assert c.require_attendance is False


def test_require_attendance_can_be_toggled_via_api(client, admin_headers, db):
    """PUT 接口可切换 require_attendance。"""
    c = _make_course(db, require_attendance=False)
    res = client.put(
        f"/api/courses/{c.id}",
        json={"require_attendance": True},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["require_attendance"] is True


def test_course_without_flag_can_have_attendance_sessions(client, admin_headers, db):
    """2026-10-19 口径：签到与课程类型解绑，未开启旧开关的课程同样能建场次。"""
    c = _make_course(db, require_attendance=False)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={c.id}",
        json={
            "title": "任意课程签到", "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["title"] == "任意课程签到"


def test_sessions_drive_attendance_stats_without_flag(
    client, student_headers, admin_headers, db,
):
    """核心回归：require_attendance=False 但配了场次的课程，签到统计照常生效。

    场次是签到要求的唯一判定依据：progress 详情返回 attendance 明细、
    courses-with-progress 返回 attended/required，均不再看旧开关。
    """
    c = _make_course(db, require_attendance=False)
    _make_video(db, c)
    _make_session(db, c)
    user = db.query(User).filter(User.username == "student1").first()
    _assign(client, admin_headers, c.id, user.id)

    progress = client.get(f"/api/student/progress/{c.id}", headers=student_headers).json()
    assert progress["attendance"] is not None, "有场次的课程必须返回签到明细（与开关无关）"
    assert progress["attendance"]["required_count"] == 1
    assert progress["attendance"]["attended_count"] == 0

    rows = client.get("/api/student/courses-with-progress", headers=student_headers).json()
    row = next(r for r in rows if r["id"] == c.id)
    assert row["required_count"] == 1
    assert row["attended_count"] == 0
    assert row["session_count"] == 1


def test_no_session_course_has_no_attendance_detail(
    client, student_headers, admin_headers, db,
):
    """无场次课程的 attendance 为 None（旧开关 True 但没建场次同样不拦不显示）。"""
    c = _make_course(db, require_attendance=True)  # 历史脏数据：开关开着但没场次
    _make_video(db, c)
    user = db.query(User).filter(User.username == "student1").first()
    _assign(client, admin_headers, c.id, user.id)

    progress = client.get(f"/api/student/progress/{c.id}", headers=student_headers).json()
    assert progress["attendance"] is None


def test_exam_unlock_ignores_attendance(client, student_headers, admin_headers, db):
    """启用签到的课程，学员未签到 → 仍可开始考试（签到不再卡考试）。"""
    c = _make_course(db, require_attendance=True)
    _make_video(db, c)
    _make_session(db, c)
    user = db.query(User).filter(User.username == "student1").first()
    _assign(client, admin_headers, c.id, user.id)

    # 不签到，直接查 progress 接口：can_take_exam 应为 True
    progress = client.get(f"/api/student/progress/{c.id}", headers=student_headers).json()
    assert progress["can_take_exam"] is True, "签到不应再阻塞考试"


def test_progress_uses_videos_as_unit_even_when_attendance_enabled(
    client, student_headers, admin_headers, db,
):
    """启用签到的课程：进度 unit_label='节'（统一），签到信息作为附加项返回。"""
    c = _make_course(db, require_attendance=True)
    _make_video(db, c)
    _make_session(db, c)
    user = db.query(User).filter(User.username == "student1").first()
    _assign(client, admin_headers, c.id, user.id)

    progress = client.get(f"/api/student/progress/{c.id}", headers=student_headers).json()
    assert progress["unit_label"] == "节"
    assert progress["total_count"] == 1  # 1 个视频
    assert progress["completed_count"] == 0
    assert progress["require_attendance"] is True
    # 签到信息作为附加项
    assert progress["attendance"] is not None
    assert progress["attendance"]["required_count"] == 1
    assert progress["attendance"]["attended_count"] == 0


def test_courses_with_progress_includes_attendance_count(
    client, student_headers, admin_headers, db,
):
    """courses-with-progress 接口在启用签到的课程上额外返回 attended_count / required_count。"""
    c = _make_course(db, require_attendance=True)
    _make_video(db, c)
    _make_session(db, c)
    user = db.query(User).filter(User.username == "student1").first()
    _assign(client, admin_headers, c.id, user.id)

    rows = client.get("/api/student/courses-with-progress", headers=student_headers).json()
    row = next(r for r in rows if r["id"] == c.id)
    assert row["require_attendance"] is True
    assert row["attended_count"] == 0
    assert row["required_count"] == 1
    # 主进度仍按视频
    assert row["total_count"] == 1
    assert row["unit_label"] == "节"
