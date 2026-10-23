"""安全与正确性回归测试。

本文件把「全量代码审查」中发现并已修复的每一个缺陷都固化为断言，
防止后续改动重新引入。每个测试的 docstring 都注明了修复前的错误行为。

覆盖：
- 考试评分绕过（只交部分题目即得满分）
- 试卷配分被忽略
- 开考时间/状态未校验
- 刷新重置倒计时 / 刷新重新抽题
- 越权读取未分配课程、越权参加考试
- 登录限流可被伪造 X-Forwarded-For 绕过
- 未开始即交卷
- 未鉴权端点
- SSO fail-open（无密钥时 md5 票据可伪造登录任意工号）→ 默认 503 + 显式兼容开关
- create_all 与 alembic 双轨（DEBUG=false 必须跳过 create_all）
- 空密码/短密码账号（创建与编辑路径 min_length=6、拒绝空串）
- admin 经通用编辑接口自降级绕过 /role 保护；最后启用态 admin 守卫
- DEBUG 默认值必须为 false（生产漏配不再静默放行弱校验）

注意：为了确保 SQLAlchemy 元数据完整，必须显式导入 app.models。
"""

import time
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401  确保所有模型注册到 Base.metadata
from app.models.course import Course, CourseAssignment
from app.models.exam import Exam, ExamPaper
from app.models.user import User
from app.services.auth_service import hash_password
from tests.conftest import create_question


# ───────────────────────── 辅助函数 ─────────────────────────

def _student_id(db: Session, username: str = "student1") -> str:
    return db.query(User).filter(User.username == username).first().id


def _assign(client, admin_headers, course_id: str, user_id: str) -> None:
    client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [user_id], "department_ids": []},
        headers=admin_headers,
    )


def _make_exam(
    db: Session,
    course_id: str,
    scores: list[int],
    *,
    status: str = "published",
    total_score: int = 100,
    pass_score: int = 60,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    duration: int = 60,
) -> tuple[str, list[str]]:
    """创建「固定组卷」考试，返回 (exam_id, [question_id...])。"""
    questions = [
        create_question(db, "single_choice", f"回归题 {i}", {"correct": "A"})
        for i in range(len(scores))
    ]
    exam = Exam(
        id=str(uuid.uuid4()),
        course_id=course_id,
        title="回归测试卷",
        paper_type="fixed",
        duration=duration,
        total_score=total_score,
        pass_score=pass_score,
        max_attempts=None,
        status=status,
        start_time=start_time,
        end_time=end_time,
    )
    db.add(exam)
    db.flush()
    db.add(ExamPaper(
        id=str(uuid.uuid4()),
        exam_id=exam.id,
        questions=[{"question_id": q.id, "score": s} for q, s in zip(questions, scores)],
    ))
    db.commit()
    return exam.id, [q.id for q in questions]


# ───────────────────────── P0：考试评分绕过 ─────────────────────────

def test_submit_partial_answers_does_not_inflate_score(client, student_headers, admin_headers, course_id, db):
    """只提交部分题目不能放大得分。

    修复前：换算分母取「已提交题目的满分和」，5 题卷只交 1 题可算出 100 分并判定通过。
    """
    exam_id, qids = _make_exam(db, course_id, [20, 20, 20, 20, 20])
    _assign(client, admin_headers, course_id, _student_id(db))

    data = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()
    assert len(data["questions"]) == 5
    assert data["paper_total_score"] == 100

    # 只提交第一题（正确答案 A），其余 4 题完全不提交
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": qids[0], "answer": "A"}]},
        headers=student_headers,
    )
    assert res.status_code == 200
    body = res.json()
    # 5 题各 20 分，仅答对 1 题 → 20 分，远低于及格线
    assert body["score"] == 20, f"分数被放大：{body}"
    assert body["passed"] is False


def test_per_question_score_is_respected(client, student_headers, admin_headers, course_id, db):
    """试卷中每题配置的分值必须生效。

    修复前：选择题满分被硬编码为 10 分，90/10 的配分被忽略，
    只答对 10 分题反而算出 100 分。
    """
    exam_id, qids = _make_exam(db, course_id, [90, 10])
    _assign(client, admin_headers, course_id, _student_id(db))

    data = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()
    score_map = {q["id"]: q["score"] for q in data["questions"]}
    assert score_map[qids[0]] == 90 and score_map[qids[1]] == 10

    # 只答对那道 10 分题
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": qids[1], "answer": "A"}]},
        headers=student_headers,
    )
    assert res.status_code == 200
    assert res.json()["score"] == 10, res.json()


def test_answers_outside_snapshot_are_rejected(client, student_headers, admin_headers, course_id, db):
    """提交不属于本次试卷的题目应被拒绝。"""
    exam_id, _ = _make_exam(db, course_id, [50, 50])
    _assign(client, admin_headers, course_id, _student_id(db))
    client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)

    outsider = create_question(db, "single_choice", "外部题", {"correct": "A"})
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": outsider.id, "answer": "A"}]},
        headers=student_headers,
    )
    assert res.status_code == 400
    assert "不属于本次考试" in res.json()["detail"]


def test_submit_without_start_is_rejected(client, student_headers, admin_headers, course_id, db):
    """未开始考试就交卷应被拒绝（修复前会凭空创建一条 attempt_number=1 的记录）。"""
    exam_id, qids = _make_exam(db, course_id, [100])
    _assign(client, admin_headers, course_id, _student_id(db))

    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": qids[0], "answer": "A"}]},
        headers=student_headers,
    )
    assert res.status_code == 400
    assert "请先开始考试" in res.json()["detail"]


# ───────────────────────── P1：考试时间窗与状态 ─────────────────────────

def test_expired_exam_cannot_start(client, student_headers, admin_headers, course_id, db):
    """已截止的考试不能开始（修复前 start_time/end_time 完全不校验）。"""
    exam_id, _ = _make_exam(
        db, course_id, [100],
        start_time=datetime(2020, 1, 1, 0, 0),
        end_time=datetime(2020, 1, 2, 0, 0),
    )
    _assign(client, admin_headers, course_id, _student_id(db))

    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 400
    assert "截止" in res.json()["detail"]


def test_not_yet_open_exam_cannot_start(client, student_headers, admin_headers, course_id, db):
    """尚未开放的考试不能开始。"""
    exam_id, _ = _make_exam(
        db, course_id, [100],
        start_time=datetime.now() + timedelta(days=1),
        end_time=datetime.now() + timedelta(days=2),
    )
    _assign(client, admin_headers, course_id, _student_id(db))
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 400
    assert "开放" in res.json()["detail"]


def test_draft_exam_cannot_start(client, student_headers, admin_headers, course_id, db):
    """未发布的考试不能开始。"""
    exam_id, _ = _make_exam(db, course_id, [100], status="draft")
    _assign(client, admin_headers, course_id, _student_id(db))
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 400
    assert "尚未发布" in res.json()["detail"]


def test_unassigned_student_cannot_start_exam(client, student_headers, admin_headers, db):
    """未分配课程的学生不能参加该课程的考试。"""
    course = Course(id=str(uuid.uuid4()), title="未分配课程", status="published")
    db.add(course)
    db.commit()
    exam_id, _ = _make_exam(db, course.id, [100])

    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 403


# ───────────────────────── P1：刷新行为 ─────────────────────────

def test_refresh_does_not_reset_countdown(client, student_headers, admin_headers, course_id, db):
    """刷新页面不能重置倒计时（修复前每次 start 都把 started_at 置为当前时间）。"""
    exam_id, _ = _make_exam(db, course_id, [100], duration=60)
    _assign(client, admin_headers, course_id, _student_id(db))

    first = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()
    time.sleep(1.2)
    second = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()

    assert second["result_id"] == first["result_id"]
    assert second["remaining_seconds"] < first["remaining_seconds"], (
        f"倒计时被重置：{first['remaining_seconds']} → {second['remaining_seconds']}"
    )


def test_refresh_does_not_redraw_questions(client, student_headers, admin_headers, course_id, db):
    """刷新页面不能重新抽题（修复前随机组卷每次刷新换一套题，可反复刷简单题）。"""
    exam_id, _ = _make_exam(db, course_id, [20, 20, 20, 20, 20])
    _assign(client, admin_headers, course_id, _student_id(db))

    first = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()
    second = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()

    assert [q["id"] for q in first["questions"]] == [q["id"] for q in second["questions"]]


# ───────────────────────── P1：越权访问 ─────────────────────────

def test_unassigned_student_cannot_read_course(client, student_headers, db):
    """学员不能读取未分配给自己的课程详情（修复前只校验「已登录」）。"""
    course = Course(id=str(uuid.uuid4()), title="机密课程", status="published")
    db.add(course)
    db.commit()

    res = client.get(f"/api/courses/{course.id}", headers=student_headers)
    assert res.status_code == 403


def test_assigned_student_can_read_course(client, student_headers, admin_headers, course_id, db):
    """被分配课程的学员仍可正常读取（确保上面的收紧没有误伤）。"""
    _assign(client, admin_headers, course_id, _student_id(db))
    res = client.get(f"/api/courses/{course_id}", headers=student_headers)
    assert res.status_code == 200


# ───────────────────────── P1：登录限流 ─────────────────────────

def test_login_rate_limit_cannot_be_bypassed_by_forwarded_for(client):
    """伪造 X-Forwarded-For 不能绕过登录限流。

    修复前限流键直接取该请求头，攻击者每次换一个伪造 IP 即可无限爆破。
    修复后默认不信任该头部（未配置 TRUSTED_PROXY_IPS），因此仍会命中限流。
    """
    codes = []
    for i in range(8):
        res = client.post(
            "/api/auth/login",
            json={"username": "ratelimit_probe", "password": "WRONG"},
            headers={"X-Forwarded-For": f"10.0.0.{i + 1}"},
        )
        codes.append(res.status_code)

    assert 429 in codes, f"伪造 IP 绕过了限流，状态码序列={codes}"


# ───────────────────────── 未鉴权端点 ─────────────────────────

def test_questions_template_requires_admin(client):
    """题库导入模板接口需要管理员权限（修复前完全无鉴权）。"""
    assert client.get("/api/questions/template").status_code == 401


def test_wechat_callback_rejects_unknown_state(client):
    """企微回调遇到未知 state 必须拒绝（修复前仅打 warning 就继续登录）。"""
    res = client.get("/sso/wechat/callback?code=fake&state=forged-state", follow_redirects=False)
    assert res.status_code in (302, 307)
    assert "/login" in res.headers.get("location", "")


# ───────────────────────── 删除保护 ─────────────────────────

def test_delete_exam_requires_confirm(client, admin_headers, course_id, db):
    """删除考试必须显式确认。"""
    exam_id, _ = _make_exam(db, course_id, [100])
    assert client.delete(f"/api/exams/{exam_id}", headers=admin_headers).status_code == 400


def test_delete_exam_blocked_when_results_exist(client, student_headers, admin_headers, course_id, db):
    """考试已有作答记录时默认拒绝删除（保护历史成绩），需 force 才可强删。"""
    exam_id, qids = _make_exam(db, course_id, [100])
    _assign(client, admin_headers, course_id, _student_id(db))
    client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": [{"question_id": qids[0], "answer": "A"}]},
        headers=student_headers,
    )

    res = client.delete(f"/api/exams/{exam_id}?confirm=true", headers=admin_headers)
    assert res.status_code == 409

    res = client.delete(f"/api/exams/{exam_id}?confirm=true&force=true", headers=admin_headers)
    assert res.status_code == 200


# ───────────────────────── 数据一致性 ─────────────────────────

def test_progress_unique_constraint_exists(db):
    """learning_progress 必须有 (user_id, video_id) 唯一约束，防止并发重复写入。"""
    from app.models.learning_progress import LearningProgress

    names = {c.name for c in LearningProgress.__table__.constraints}
    assert "uq_progress_user_video" in names


def test_assignment_unique_constraint_exists(db):
    """course_assignments 必须有唯一约束，防止重复分配。"""
    from app.models.course import CourseAssignment

    names = {c.name for c in CourseAssignment.__table__.constraints}
    assert "uq_assign_course_user" in names
    assert "uq_assign_course_dept" in names


def test_department_resolution_prefers_department_id(db):
    """同名叶子部门不应导致归属歧义：优先使用 department_id。"""
    from app.models.department import Department
    from app.services.department_scope import check_course_assignment

    # 两个不同父部门下的同名「综合部」
    p1 = Department(name="业务一部")
    p2 = Department(name="业务二部")
    db.add_all([p1, p2])
    db.flush()
    d1 = Department(name="综合部", parent_id=p1.id)
    d2 = Department(name="综合部", parent_id=p2.id)
    db.add_all([d1, d2])
    db.flush()

    course = Course(id=str(uuid.uuid4()), title="定向课程", status="published")
    db.add(course)
    db.flush()

    # 只把课程分配给「业务二部-综合部」
    db.add(CourseAssignment(
        id=str(uuid.uuid4()), course_id=course.id, department_id=d2.id,
    ))
    # 用户挂在「业务二部-综合部」（文本路径存在同名叶子，必须靠 department_id 定位）
    user = User(
        id=str(uuid.uuid4()), username="dup_dept_user",
        password_hash=hash_password("Test12345!"), name="同名部门用户",
        role="student", status="active",
        department="业务二部-综合部", department_id=d2.id,
    )
    db.add(user)
    db.commit()

    assert check_course_assignment(db, user, course.id) is True


# ───────────────── P0：SSO fail-open（md5 票据可被任意伪造） ─────────────────

def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _make_sso_user(db: Session, workcode: str) -> User:
    """预建一个 SSO 免密登录可命中的启用用户（按 employee_id 匹配）。"""
    user = User(
        id=str(uuid.uuid4()),
        username=f"sso_{workcode}",
        password_hash=None,
        name="SSO 测试用户",
        role="student",
        status="active",
        employee_id=workcode,
    )
    db.add(user)
    db.commit()
    return user


def test_sso_login_returns_503_when_unconfigured(client, db, monkeypatch):
    """修复前：未配置 SSO_SHARED_SECRET 时静默回退 md5(时间) 校验，
    任何人可构造 URL 登录任意工号（等同无认证入口）。
    修复后：无密钥且未开兼容开关 → 端点闸门 fail-closed 返回 503。
    """
    from app.config import settings
    from app.routers.sso import _md5

    monkeypatch.setattr(settings, "SSO_SHARED_SECRET", "")
    monkeypatch.setattr(settings, "SSO_ALLOW_INSECURE_COMPAT", False)
    # 即便带上「修复前可通过校验」的 md5 时间票据，也必须 503
    res = client.get(
        "/sso/login",
        params={"workcode": "100001", "tokendate": _md5(_now_str())},
        follow_redirects=False,
    )
    assert res.status_code == 503


def test_sso_rejects_md5_ticket_when_secret_configured(client, db, monkeypatch):
    """配置密钥后，md5(时间) 旧式票据必须被拒绝（302 回登录页）。"""
    from app.config import settings
    from app.routers.sso import _md5

    monkeypatch.setattr(settings, "SSO_SHARED_SECRET", "unit-test-secret")
    monkeypatch.setattr(settings, "SSO_ALLOW_INSECURE_COMPAT", False)
    _make_sso_user(db, "100002")
    res = client.get(
        "/sso/login",
        params={"workcode": "100002", "tokendate": _md5(_now_str())},
        follow_redirects=False,
    )
    assert res.status_code in (302, 307)  # Starlette RedirectResponse 默认 307
    assert res.headers["location"].endswith("/login")


def test_sso_accepts_hmac_ticket_bound_to_workcode(client, db, monkeypatch):
    """安全模式：HMAC-SHA256(secret, "工号:时间") 票据放行，且与工号绑定。"""
    from app.config import settings
    from app.routers.sso import _hmac_ticket

    secret = "unit-test-secret"
    monkeypatch.setattr(settings, "SSO_SHARED_SECRET", secret)
    monkeypatch.setattr(settings, "SSO_ALLOW_INSECURE_COMPAT", False)
    _make_sso_user(db, "100003")

    ticket = _hmac_ticket("100003", _now_str(), secret)
    res = client.get(
        "/sso/login",
        params={"workcode": "100003", "tokendate": ticket},
        follow_redirects=False,
    )
    assert res.status_code in (302, 307)  # Starlette RedirectResponse 默认 307
    assert "/sso/callback?code=" in res.headers["location"]

    # 同一张票据换工号复用必须失败（旧 md5 方案票据与工号无关，可换任何人）
    res2 = client.get(
        "/sso/login",
        params={"workcode": "100099", "tokendate": ticket},
        follow_redirects=False,
    )
    assert res2.headers["location"].endswith("/login")


def test_sso_md5_compat_requires_explicit_flag(client, db, monkeypatch):
    """兼容模式仅在显式 SSO_ALLOW_INSECURE_COMPAT=true 时可用（OA 过渡期逃生口）。"""
    from app.config import settings
    from app.routers.sso import _md5

    monkeypatch.setattr(settings, "SSO_SHARED_SECRET", "")
    monkeypatch.setattr(settings, "SSO_ALLOW_INSECURE_COMPAT", True)
    _make_sso_user(db, "100004")
    res = client.get(
        "/sso/login",
        params={"workcode": "100004", "tokendate": _md5(_now_str())},
        follow_redirects=False,
    )
    assert res.status_code in (302, 307)  # Starlette RedirectResponse 默认 307
    assert "/sso/callback?code=" in res.headers["location"]


# ───────────────── P1：create_all 与 alembic 双轨 ─────────────────

def test_startup_skips_create_all_when_debug_false(db, monkeypatch):
    """生产（DEBUG=false）禁止 create_all——它只建缺失表、不加列/索引且
    绕过 alembic_version，导致 schema 漂移。seed 内置管理员仍须执行。
    """
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from app.config import settings
    from app.database import Base
    from app.main import app

    monkeypatch.setattr(settings, "DEBUG", False)
    with patch.object(Base.metadata, "create_all") as spy:
        with TestClient(app):
            pass
    spy.assert_not_called()
    # seed 不受门控：内置管理员存在
    assert (
        db.query(User)
        .filter(User.username == settings.BUILTIN_ADMIN_USERNAME)
        .first()
        is not None
    )


def test_startup_runs_create_all_when_debug_true(db, monkeypatch):
    """开发环境（DEBUG=true）保留 create_all 兜底建表体验。"""
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from app.config import settings
    from app.database import Base
    from app.main import app

    monkeypatch.setattr(settings, "DEBUG", True)
    with patch.object(Base.metadata, "create_all") as spy:
        with TestClient(app):
            pass
    assert spy.call_count >= 1


# ───────────────── P1：空密码 / 弱密码 ─────────────────

def test_create_user_rejects_short_password(client, admin_headers):
    """修复前：UserCreate.password 无非空/长度校验，可建出空密码账号。
    修复后：低于 6 位一律 422，6 位放行。
    """
    res = client.post(
        "/api/users",
        json={"username": "shortpwd", "password": "12345", "name": "短密码", "role": "student"},
        headers=admin_headers,
    )
    assert res.status_code == 422
    res = client.post(
        "/api/users",
        json={"username": "okpwd6", "password": "123456", "name": "六位密码", "role": "student"},
        headers=admin_headers,
    )
    assert res.status_code == 201


def test_update_user_rejects_empty_password_and_keeps_omitted(client, admin_headers, db, student_token):
    """PUT 显式空串必须 422；省略 password 键保持原 hash 不变（None=不修改）。"""
    sid = db.query(User).filter(User.username == "student1").first().id
    old_hash = db.query(User).filter(User.id == sid).first().password_hash

    res = client.put(f"/api/users/{sid}", json={"password": ""}, headers=admin_headers)
    assert res.status_code == 422

    res = client.put(f"/api/users/{sid}", json={"name": "改名学员"}, headers=admin_headers)
    assert res.status_code == 200
    db.expire_all()
    assert db.query(User).filter(User.id == sid).first().password_hash == old_hash


def test_update_user_password_min_length_and_new_password_works(client, admin_headers, db, student_token):
    """PUT 改短密码 422；改成合规密码 200 且新密码可实际登录。"""
    sid = db.query(User).filter(User.username == "student1").first().id

    res = client.put(f"/api/users/{sid}", json={"password": "abc"}, headers=admin_headers)
    assert res.status_code == 422

    res = client.put(f"/api/users/{sid}", json={"password": "abcdef"}, headers=admin_headers)
    assert res.status_code == 200

    login = client.post("/api/auth/login", json={"username": "student1", "password": "abcdef"})
    assert login.status_code == 200


# ───────────────── P1：admin 自降级与最后管理员保护 ─────────────────

def test_admin_cannot_demote_self_via_update(client, admin_headers, db):
    """修复前：PUT /users/{id} 通用接口可绕过 /role 的 self 保护，
    把管理员自己降级为 student（配合改密造成自锁）。
    """
    me = db.query(User).filter(User.username == "admin").first()
    res = client.put(f"/api/users/{me.id}", json={"role": "student"}, headers=admin_headers)
    assert res.status_code == 400
    db.expire_all()
    assert db.query(User).filter(User.id == me.id).first().role == "admin"


def test_admin_can_update_self_with_unchanged_role(client, admin_headers, db):
    """前端编辑表单总是携带 role 字段（DepartmentUserManage.tsx）——
    role 未变更时必须放行，否则管理员连改自己的姓名都会被 400。
    防止未来实现退化为「携带 role 即拦」。
    """
    me = db.query(User).filter(User.username == "admin").first()
    res = client.put(
        f"/api/users/{me.id}",
        json={"name": "系统管理员-改名", "role": "admin"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    db.expire_all()
    assert db.query(User).filter(User.id == me.id).first().name == "系统管理员-改名"


def test_second_admin_can_be_demoted(client, admin_headers, db):
    """存在两个启用态 admin 时，互相降级是正常运营操作，必须放行。"""
    admin2 = User(
        id=str(uuid.uuid4()), username="admin2",
        password_hash=hash_password("Admin2pass!"),
        name="第二管理员", role="admin", status="active",
    )
    db.add(admin2)
    db.commit()
    res = client.put(f"/api/users/{admin2.id}", json={"role": "student"}, headers=admin_headers)
    assert res.status_code == 200


def test_last_active_admin_guard_unit(db, client):
    """守卫函数单元直测（纵深防御，接口层 400 分支在现 API 面内不可达）。
    count 条件必须是 role=admin AND status=active。
    """
    from fastapi import HTTPException
    from app.routers.users import _assert_not_last_active_admin

    admin = db.query(User).filter(User.username == "admin").first()

    for kwargs in ({"leaving_admin": True}, {"disabling": True}, {"deleting": True}):
        with pytest.raises(HTTPException) as exc:
            _assert_not_last_active_admin(db, admin, **kwargs)
        assert exc.value.status_code == 400

    # 无消耗标志 → 放行
    _assert_not_last_active_admin(db, admin)

    # 补第二个启用态 admin 后 → 降级放行
    admin2 = User(
        id=str(uuid.uuid4()), username="admin_c",
        password_hash=hash_password("AdminC123!"),
        name="C 管理员", role="admin", status="active",
    )
    db.add(admin2)
    db.commit()
    _assert_not_last_active_admin(db, admin, leaving_admin=True)

    # 目标不是启用态 admin → 一律放行
    student = User(
        id=str(uuid.uuid4()), username="plain_student",
        name="学员", role="student", status="active",
    )
    db.add(student)
    db.commit()
    _assert_not_last_active_admin(db, student, deleting=True)

    disabled_admin = User(
        id=str(uuid.uuid4()), username="admin_d",
        password_hash=hash_password("AdminD123!"),
        name="D 管理员", role="admin", status="disabled",
    )
    db.add(disabled_admin)
    db.commit()
    _assert_not_last_active_admin(db, disabled_admin, deleting=True)


# ───────────────── P1：DEBUG 默认值翻转 ─────────────────

def test_debug_default_is_false():
    """修复前：DEBUG 默认 "true"——生产 .env 漏配即静默跳过全部启动强校验，
    且内置管理员回退已知弱口令 Ht12345!。默认值必须为 false（安全优先）。
    用源码文本断言而非 importlib.reload：后者会重读本地 .env，结果不可移植。
    """
    from pathlib import Path
    import app.config as config_module

    src = Path(config_module.__file__).read_text(encoding="utf-8")
    assert 'os.getenv("DEBUG", "false")' in src


def test_sso_compat_flag_default_false():
    """SSO 兼容开关默认必须为 false（fail-closed）。"""
    from pathlib import Path
    import app.config as config_module

    src = Path(config_module.__file__).read_text(encoding="utf-8")
    assert 'os.getenv("SSO_ALLOW_INSECURE_COMPAT", "false")' in src


# ───────────────── P1：删除用户 500（外键 RESTRICT 无清理）─────────────────

def test_delete_user_requires_confirm(client, admin_headers, db):
    """修复前：DELETE /users/{id} 无 confirm 参数直接删。
    现与课程/考试删除惯例对齐，必须显式 confirm=true。"""
    stu = User(
        id=str(uuid.uuid4()), username="del_no_hist",
        password_hash=hash_password("Del12345!"),
        name="无历史学员", role="student", status="active",
    )
    db.add(stu)
    db.commit()

    res = client.delete(f"/api/users/{stu.id}", headers=admin_headers)
    assert res.status_code == 400
    assert "confirm" in res.json()["detail"]

    # 无历史记录时 confirm=true 可直接删
    res = client.delete(f"/api/users/{stu.id}?confirm=true", headers=admin_headers)
    assert res.status_code == 200
    assert db.query(User).filter(User.id == stu.id).first() is None


def test_delete_user_with_history_409_then_force(client, admin_headers, db):
    """修复前：用户只要有 learning_progress 等任意关联记录，
    db.delete(user) 就撞 MySQL 外键 RESTRICT → 500。
    现应先 409，force=true 才连历史一并清理。"""
    from app.models.learning_progress import LearningProgress

    stu = User(
        id=str(uuid.uuid4()), username="del_with_hist",
        password_hash=hash_password("Del12345!"),
        name="有历史学员", role="student", status="active",
    )
    db.add(stu)
    db.commit()
    prog = LearningProgress(
        id=str(uuid.uuid4()), user_id=stu.id, course_id="c1", video_id="v1",
        watched_seconds=100, total_seconds=100, completed=True,
    )
    db.add(prog)
    db.commit()

    res = client.delete(f"/api/users/{stu.id}?confirm=true", headers=admin_headers)
    assert res.status_code == 409
    assert "学习记录" in res.json()["detail"]
    # 409 时用户与记录都必须还在
    assert db.query(User).filter(User.id == stu.id).first() is not None

    res = client.delete(
        f"/api/users/{stu.id}?confirm=true&force=true", headers=admin_headers
    )
    assert res.status_code == 200
    assert db.query(User).filter(User.id == stu.id).first() is None
    assert db.query(LearningProgress).filter(
        LearningProgress.user_id == stu.id
    ).count() == 0
