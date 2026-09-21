"""统一线上课程 + 可选现场签到 的端到端测试。

覆盖：模型字段可读写、PUT 切换、签到闸门、考试不再卡签到、进度统一按视频统计。
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


def test_online_course_cannot_have_attendance_sessions(client, admin_headers, db):
    """未开启现场签到的课程建场次应被 400 拒绝。"""
    c = _make_course(db, require_attendance=False)
    now = datetime.now()
    res = client.post(
        f"/api/attendance/sessions?course_id={c.id}",
        json={
            "title": "误建", "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "现场签到" in res.json()["detail"]


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
