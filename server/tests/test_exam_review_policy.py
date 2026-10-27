"""错题回顾时机闸门（exam.review_policy）集成测试

背景：review 接口原本交卷即无条件返回每题正确答案——第一次没过的学员
看完错题答案后重考（固定卷同题同序）等于开卷送分。三档策略：
always（默认，兼容存量）/ after_exhausted（重考用完或及格后可看）/
after_window（考试截止后可看）。判定逻辑在 exam_service.review_available。
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.exam import Exam, ExamPaper
from app.models.user import User
from app.services.exam_service import review_available
from tests.conftest import create_question


def make_exam(db: Session, course_id: str, *, policy: str = "always",
              max_attempts: int | None = 3, end_time=None) -> tuple[str, dict]:
    """建一场固定卷考试（2 道单选，各 50 分），返回 (exam_id, 正确答案表)"""
    q1 = create_question(db, "single_choice", "下列做法正确的是?", {"correct": "A"})
    q2 = create_question(db, "single_choice", "发现火情应首先?", {"correct": "B"})
    exam = Exam(
        id=str(uuid.uuid4()),
        course_id=course_id,
        title="安全知识考核",
        paper_type="fixed",
        duration=60,
        total_score=100,
        pass_score=60,
        max_attempts=max_attempts,
        status="published",
        review_policy=policy,
        end_time=end_time,
    )
    db.add(exam)
    db.flush()
    db.add(ExamPaper(
        id=str(uuid.uuid4()),
        exam_id=exam.id,
        questions=[{"question_id": q1.id, "score": 50}, {"question_id": q2.id, "score": 50}],
    ))
    db.commit()
    return exam.id, {q1.id: "A", q2.id: "B"}


def _student_id(db: Session) -> str:
    return db.query(User).filter(User.username == "student1").first().id


def _assign(client, admin_headers, course_id: str, uid: str):
    client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [uid], "department_ids": []},
        headers=admin_headers,
    )


def _take_exam(client, student_headers, exam_id: str, answers_map: dict, *, pass_exam: bool) -> str:
    """完整走一遍 start→submit，返回 result_id。pass_exam=False 时故意全答错。"""
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text
    data = res.json()
    answers = [
        {"question_id": q["id"], "answer": answers_map[q["id"]] if pass_exam else "Z"}
        for q in data["questions"]
    ]
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": answers},
        headers=student_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["passed"] is pass_exam
    return data["result_id"], body


class TestPolicyAlways:
    def test_default_visible_immediately_after_submit(self, client, student_headers, admin_headers, course_id, db):
        """默认 always：交卷即看得到正确答案（存量行为不变）"""
        exam_id, amap = make_exam(db, course_id)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)

        assert body["review_available"] is True
        assert body.get("review_hint") is None
        res = client.get(f"/api/student/exams/{exam_id}/review/{result_id}", headers=student_headers)
        assert res.status_code == 200
        assert res.json()["questions"][0]["correct_answer"]

    def test_results_list_marks_available(self, client, student_headers, admin_headers, course_id, db):
        exam_id, amap = make_exam(db, course_id)
        _assign(client, admin_headers, course_id, _student_id(db))
        _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        res = client.get(f"/api/student/exams/{exam_id}/results", headers=student_headers)
        assert res.status_code == 200
        assert res.json()[0]["review_available"] is True


class TestAfterExhausted:
    def test_blocked_while_attempts_left(self, client, student_headers, admin_headers, course_id, db):
        """还有重考机会且未及格 → review 403，results 带提示"""
        exam_id, amap = make_exam(db, course_id, policy="after_exhausted", max_attempts=3)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)

        assert body["review_available"] is False
        assert "重考机会用完" in body["review_hint"]

        res = client.get(f"/api/student/exams/{exam_id}/review/{result_id}", headers=student_headers)
        assert res.status_code == 403
        assert "还剩 2 次机会" in res.json()["detail"]

        res = client.get(f"/api/student/exams/{exam_id}/results", headers=student_headers)
        item = res.json()[0]
        assert item["review_available"] is False
        assert "重考" in item["review_hint"]

    def test_visible_when_passed(self, client, student_headers, admin_headers, course_id, db):
        """已及格 → 可看（按最高分定及格，及格后回顾无作弊收益）"""
        exam_id, amap = make_exam(db, course_id, policy="after_exhausted", max_attempts=3)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=True)
        assert body["review_available"] is True
        res = client.get(f"/api/student/exams/{exam_id}/review/{result_id}", headers=student_headers)
        assert res.status_code == 200

    def test_visible_when_attempts_exhausted(self, client, student_headers, admin_headers, course_id, db):
        """两次机会都用完仍不及格 → 允许回顾（最后兜底，不会永远锁死）"""
        exam_id, amap = make_exam(db, course_id, policy="after_exhausted", max_attempts=2)
        _assign(client, admin_headers, course_id, _student_id(db))
        first_id, body1 = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body1["review_available"] is False  # 还剩 1 次

        _second, body2 = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body2["review_available"] is True  # used=2 → 闸门放开

        # 第一次的答卷此时也随闸门放开（策略按「当前剩余机会」整体判定）
        res = client.get(f"/api/student/exams/{exam_id}/review/{first_id}", headers=student_headers)
        assert res.status_code == 200

    def test_unlimited_attempts_falls_back(self, client, student_headers, admin_headers, course_id, db):
        """max_attempts 不限时 after_exhausted 条件永不满足 → 兜底放行"""
        exam_id, amap = make_exam(db, course_id, policy="after_exhausted", max_attempts=None)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body["review_available"] is True


class TestAfterWindow:
    def test_blocked_before_end(self, client, student_headers, admin_headers, course_id, db):
        future = datetime.now() + timedelta(hours=2)
        exam_id, amap = make_exam(db, course_id, policy="after_window", end_time=future)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body["review_available"] is False
        res = client.get(f"/api/student/exams/{exam_id}/review/{result_id}", headers=student_headers)
        assert res.status_code == 403
        assert "截止" in res.json()["detail"]

    def test_visible_after_end(self, client, student_headers, admin_headers, course_id, db):
        future = datetime.now() + timedelta(hours=2)
        exam_id, amap = make_exam(db, course_id, policy="after_window", end_time=future)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, _ = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)

        # 把截止时间推到过去（模拟考试窗口结束）
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        exam.end_time = datetime.now() - timedelta(minutes=1)
        db.commit()

        res = client.get(f"/api/student/exams/{exam_id}/review/{result_id}", headers=student_headers)
        assert res.status_code == 200

    def test_no_end_time_falls_back(self, client, student_headers, admin_headers, course_id, db):
        """after_window 但没设截止时间 → 兜底放行（防误配置锁死）"""
        exam_id, amap = make_exam(db, course_id, policy="after_window", end_time=None)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body["review_available"] is True


class TestPolicyApi:
    def test_create_and_update_roundtrip(self, client, admin_headers, course_id, db):
        """POST /exams 与 PUT /exams 能设置 review_policy"""
        res = client.post("/api/exams", json={
            "course_id": course_id, "title": "考核A", "paper_type": "fixed",
            "duration": 30, "total_score": 100, "pass_score": 60,
            "review_policy": "after_exhausted",
        }, headers=admin_headers)
        assert res.status_code == 201, res.text
        exam_id = res.json()["id"]
        assert res.json()["review_policy"] == "after_exhausted"

        res = client.put(f"/api/exams/{exam_id}", json={"review_policy": "after_window"}, headers=admin_headers)
        assert res.status_code == 200
        assert res.json()["review_policy"] == "after_window"

    def test_invalid_policy_422(self, client, admin_headers, course_id):
        res = client.post("/api/exams", json={
            "course_id": course_id, "title": "考核B", "paper_type": "fixed",
            "duration": 30, "total_score": 100, "pass_score": 60,
            "review_policy": "whenever_i_want",
        }, headers=admin_headers)
        assert res.status_code == 422

    def test_admin_side_unaffected(self, client, student_headers, admin_headers, course_id, db):
        """管理端答卷详情不受策略限制（闸门只约束学员端 review）"""
        exam_id, amap = make_exam(db, course_id, policy="after_exhausted", max_attempts=3)
        _assign(client, admin_headers, course_id, _student_id(db))
        result_id, body = _take_exam(client, student_headers, exam_id, amap, pass_exam=False)
        assert body["review_available"] is False  # 学员被拦

        res = client.get(f"/api/exams/{exam_id}/results/{result_id}", headers=admin_headers)
        assert res.status_code == 200, res.text

    def test_review_cross_exam_guard(self, client, student_headers, admin_headers, course_id, db):
        """result_id 必须属于 URL 里的 exam_id，否则 404（防拼错/越权拿他考回顾）"""
        e1, amap = make_exam(db, course_id, policy="always")
        e2, _ = make_exam(db, course_id, policy="always")
        _assign(client, admin_headers, course_id, _student_id(db))
        r1, _ = _take_exam(client, student_headers, e1, amap, pass_exam=True)
        res = client.get(f"/api/student/exams/{e2}/review/{r1}", headers=student_headers)
        assert res.status_code == 404


class TestReviewAvailableUnit:
    """直接调判定函数补齐文案/边界（不起 HTTP）"""

    def test_hint_wording(self, db, course_id):
        exam_id, _ = make_exam(db, course_id, policy="after_exhausted", max_attempts=5)
        exam = db.query(Exam).filter(Exam.id == exam_id).first()

        class _R:
            passed = False

        ok, hint = review_available(exam, _R(), attempts_used=1)
        assert not ok and "还剩 4 次机会" in hint
        ok, _ = review_available(exam, _R(), attempts_used=5)
        assert ok

        class _P:
            passed = True

        ok, _ = review_available(exam, _P(), attempts_used=1)
        assert ok  # 及格即可看

    def test_unknown_policy_defaults_open(self, db, course_id):
        exam_id, _ = make_exam(db, course_id)
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        exam.review_policy = "legacy_value"
        db.commit()

        class _R:
            passed = False

        ok, _ = review_available(exam, _R(), attempts_used=1)
        assert ok  # 未知值走 always 兜底，绝不因脏数据把学员锁死
