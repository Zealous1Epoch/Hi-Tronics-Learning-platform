"""一键建考（POST /api/exams/quick-create）回归测试

覆盖：题库固定选题（含分值平摊）、随机规则（含题库范围/缺题校验）、
复用试卷、自动及格分、换绑提示、草稿、存模板、服务端预览抽题，
以及「向导直建的随机考试学员端能正常抽题」（exam_papers.source_banks 链路）。
"""

import uuid
from app.models.exam import Exam, ExamPaper
from app.models.question import Question
from app.models.question_category import QuestionCategory
from tests.conftest import create_question


def _q_single(db, stem, difficulty="medium", category_id=None):
    q = Question(
        id=str(uuid.uuid4()), type="single_choice", stem=stem,
        options={"A": "甲", "B": "乙", "C": "丙", "D": "丁"},
        answer={"correct": "A"}, difficulty=difficulty, category_id=category_id,
    )
    db.add(q)
    db.commit()
    return q


def _fixed_body(course_id, q_ids, scores=None, **kw):
    questions = [
        {"question_id": qid, "score": s}
        for qid, s in zip(q_ids, scores if scores is not None else [None] * len(q_ids))
    ]
    body = {
        "title": "一键考", "course_id": course_id,
        "content": {"source": "bank", "paper_type": "fixed", "questions": questions},
    }
    body.update(kw)
    return body


# ========== 题库固定选题 ==========

def test_quick_create_fixed_with_scores(client, admin_headers, course_id, db):
    """逐题设分值：总分自动累加，及格分默认 60%"""
    q1 = create_question(db, "single_choice", "1+1=?", {"correct": "A"})
    q2 = create_question(db, "true_false", "地球是圆的", {"correct": True})

    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q1.id, q2.id], [30, 70]))
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["total_score"] == 100
    assert data["pass_score"] == 60
    assert data["status"] == "published"
    assert data["replaced_exam_title"] is None

    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == data["id"]).first()
    assert paper is not None
    assert {q["question_id"] for q in paper.questions} == {q1.id, q2.id}

    from app.models.course import Course
    db.expire_all()
    course = db.query(Course).filter(Course.id == course_id).first()
    assert course.exam_id == data["id"]


def test_quick_create_fixed_even_split(client, admin_headers, course_id, db):
    """未设分值：默认按 100 分整数平摊，余数补给前面的题"""
    qs = [_q_single(db, f"题{i}") for i in range(3)]
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id for q in qs]))
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["total_score"] == 100
    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == data["id"]).first()
    scores = {q["question_id"]: q["score"] for q in paper.questions}
    assert scores[qs[0].id] == 34 and scores[qs[1].id] == 33 and scores[qs[2].id] == 33
    assert data["pass_score"] == 60


def test_quick_create_even_split_target(client, admin_headers, course_id, db):
    """显式 total_score 作为平摊目标"""
    qs = [_q_single(db, f"题{i}") for i in range(4)]
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id for q in qs], total_score=50))
    assert res.status_code == 201, res.text
    assert res.json()["total_score"] == 50
    assert res.json()["pass_score"] == 30


def test_quick_create_split_too_small(client, admin_headers, course_id, db):
    """总分不足以平摊时报错"""
    qs = [_q_single(db, f"题{i}") for i in range(5)]
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id for q in qs], total_score=3))
    assert res.status_code == 400
    assert "平摊" in res.json()["detail"]


def test_quick_create_missing_question(client, admin_headers, course_id, db):
    """题目不存在/已删除 → 400"""
    q = _q_single(db, "仅一题")
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id, str(uuid.uuid4())]))
    assert res.status_code == 400
    assert "不存在" in res.json()["detail"]


# ========== 随机规则 ==========

def test_quick_create_random_shortage(client, admin_headers, course_id, db):
    """题库存量不足 → 400，并说明缺多少"""
    _q_single(db, "只有一题", difficulty="easy")
    body = {
        "title": "随机考", "course_id": course_id,
        "content": {
            "source": "bank", "paper_type": "random",
            "random_rules": [{"type": "single_choice", "difficulty": "easy", "count": 5, "score": 10}],
        },
    }
    res = client.post("/api/exams/quick-create", headers=admin_headers, json=body)
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "题库缺题" in detail and "需 5 题" in detail and "仅有 1 题" in detail


def test_quick_create_random_with_source_banks(client, admin_headers, course_id, db):
    """题库范围按分类整链展开；source_banks 落到 exam_papers 上"""
    parent = QuestionCategory(id=str(uuid.uuid4()), name="安全生产")
    child = QuestionCategory(id=str(uuid.uuid4()), name="消防", parent_id=parent.id)
    db.add_all([parent, child])
    db.commit()
    for i in range(3):
        _q_single(db, f"消防题{i}", difficulty="easy", category_id=child.id)

    body = {
        "title": "消防随机考", "course_id": course_id,
        "content": {
            "source": "bank", "paper_type": "random",
            "random_rules": [{"type": "single_choice", "difficulty": "easy", "count": 2, "score": 10}],
            "source_banks": [parent.id],
        },
    }
    res = client.post("/api/exams/quick-create", headers=admin_headers, json=body)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["total_score"] == 20
    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == data["id"]).first()
    assert paper.source_banks == [parent.id]


def test_quick_created_random_exam_draws_for_student(client, admin_headers, student_headers, course_id, db):
    """端到端：向导直建的随机考试（无 papers 记录），学员开考能按范围抽到题"""
    from tests.test_exam_flow import _get_student_id, _assign_course
    parent = QuestionCategory(id=str(uuid.uuid4()), name="电气安全")
    db.add(parent)
    db.commit()
    for i in range(4):
        _q_single(db, f"电气题{i}", difficulty="easy", category_id=parent.id)

    body = {
        "title": "电气随机考", "course_id": course_id,
        "content": {
            "source": "bank", "paper_type": "random",
            "random_rules": [{"type": "single_choice", "difficulty": "easy", "count": 3, "score": 10}],
            "source_banks": [parent.id],
        },
    }
    res = client.post("/api/exams/quick-create", headers=admin_headers, json=body)
    assert res.status_code == 201, res.text
    exam_id = res.json()["id"]

    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["questions"]) == 3
    assert data["paper_total_score"] == 30
    assert all("answer" not in q for q in data["questions"])


# ========== 复用试卷 ==========

def test_quick_create_from_paper(client, admin_headers, course_id, db):
    """source=paper：拷贝已发布试卷，exam.paper_id 指向原试卷"""
    q1 = create_question(db, "single_choice", "1+1=?", {"correct": "A"})
    res = client.post("/api/papers", headers=admin_headers, json={
        "title": "既有试卷", "paper_type": "fixed", "status": "published", "total_score": 20,
        "mandatory_questions": [{"question_id": q1.id, "score": 20}],
    })
    assert res.status_code == 201, res.text
    paper_id = res.json()["id"]

    res = client.post("/api/exams/quick-create", headers=admin_headers, json={
        "title": "用既有试卷考", "course_id": course_id,
        "content": {"source": "paper", "paper_id": paper_id},
    })
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["paper_id"] == paper_id
    assert data["total_score"] == 20
    assert data["pass_score"] == 12  # round(20*0.6)


def test_quick_create_from_draft_paper_rejected(client, admin_headers, course_id, db):
    """未发布试卷不可复用"""
    q1 = create_question(db, "single_choice", "1+1=?", {"correct": "A"})
    res = client.post("/api/papers", headers=admin_headers, json={
        "title": "草稿试卷", "paper_type": "fixed",
        "mandatory_questions": [{"question_id": q1.id, "score": 10}],
    })
    paper_id = res.json()["id"]
    res = client.post("/api/exams/quick-create", headers=admin_headers, json={
        "title": "考", "course_id": course_id,
        "content": {"source": "paper", "paper_id": paper_id},
    })
    assert res.status_code == 400
    assert "尚未发布" in res.json()["detail"]


# ========== 默认值 / 状态 / 换绑 / 模板 ==========

def test_quick_create_draft_and_pass_override(client, admin_headers, course_id, db):
    q = _q_single(db, "题")
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [100], publish=False, pass_score=90))
    assert res.status_code == 201
    assert res.json()["status"] == "draft"
    assert res.json()["pass_score"] == 90


def test_quick_create_pass_above_total_rejected(client, admin_headers, course_id, db):
    q = _q_single(db, "题")
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [10], pass_score=50))
    assert res.status_code == 400
    assert "及格分" in res.json()["detail"]


def test_quick_create_replaces_previous_exam(client, admin_headers, course_id, db):
    """课程 1:1 换绑：旧考试自动置为已结束，响应携带其名称"""
    q = _q_single(db, "题")
    res1 = client.post("/api/exams/quick-create", headers=admin_headers,
                       json=_fixed_body(course_id, [q.id], [10], title="旧考试"))
    assert res1.status_code == 201
    old_id = res1.json()["id"]

    res2 = client.post("/api/exams/quick-create", headers=admin_headers,
                       json=_fixed_body(course_id, [q.id], [10], title="新考试"))
    assert res2.status_code == 201
    assert res2.json()["replaced_exam_title"] == "旧考试"

    db.expire_all()
    old = db.query(Exam).filter(Exam.id == old_id).first()
    assert old.status == "ended"


def test_quick_create_save_paper_as(client, admin_headers, course_id, db):
    """save_paper_as：选题顺手存为已发布试卷模板"""
    cat = QuestionCategory(id=str(uuid.uuid4()), name="模板分类")
    db.add(cat)
    db.commit()
    q = _q_single(db, "题")
    body = _fixed_body(course_id, [q.id], [10])
    body["save_paper_as"] = "复用模板"
    body["content"]["category_id"] = cat.id
    res = client.post("/api/exams/quick-create", headers=admin_headers, json=body)
    assert res.status_code == 201
    saved_paper_id = res.json()["saved_paper_id"]
    assert saved_paper_id

    res = client.get("/api/papers/published", headers=admin_headers)
    titles = [p["title"] for p in res.json()]
    assert "复用模板" in titles


# ========== 建考即分配（assign_user_ids） ==========

def _mk_user(db, name):
    from app.models.user import User
    from app.services.auth_service import hash_password
    u = User(
        id=str(uuid.uuid4()),
        username=f"stu_{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("Student123!"),
        name=name, role="student", status="active",
    )
    db.add(u)
    db.commit()
    return u


def _assign_rows(db, course_id):
    from app.models.course import CourseAssignment
    db.expire_all()
    return db.query(CourseAssignment).filter(CourseAssignment.course_id == course_id).all()


def test_quick_create_assigns_users(client, admin_headers, course_id, db):
    """建考同时分配学员：生成 CourseAssignment 行，assigned_new 计数正确"""
    q = _q_single(db, "题")
    u1, u2 = _mk_user(db, "学员甲"), _mk_user(db, "学员乙")
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [10], assign_user_ids=[u1.id, u2.id]))
    assert res.status_code == 201, res.text
    assert res.json()["assigned_new"] == 2

    rows = _assign_rows(db, course_id)
    assert {r.user_id for r in rows} == {u1.id, u2.id}
    assert all(r.assigned_by for r in rows)


def test_quick_create_assign_skips_existing(client, admin_headers, course_id, db):
    """已分配过的学员不产生重复行（幂等）"""
    from app.models.course import CourseAssignment
    q = _q_single(db, "题")
    u1 = _mk_user(db, "已分配学员")
    db.add(CourseAssignment(id=str(uuid.uuid4()), course_id=course_id, user_id=u1.id))
    db.commit()

    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [10], assign_user_ids=[u1.id]))
    assert res.status_code == 201, res.text
    assert res.json()["assigned_new"] == 0
    assert len(_assign_rows(db, course_id)) == 1


def test_quick_create_invalid_user_rejected(client, admin_headers, course_id, db):
    """学员不存在 → 400，且不留下考试/试卷/分配等任何残留（同事务原子性）"""
    q = _q_single(db, "题")
    u = _mk_user(db, "有效学员")
    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [10],
                                       assign_user_ids=[u.id, str(uuid.uuid4())]))
    assert res.status_code == 400
    assert "学员" in res.json()["detail"]

    db.expire_all()
    assert db.query(Exam).filter(Exam.title == "一键考").count() == 0
    assert _assign_rows(db, course_id) == []
    from app.models.course import Course
    course = db.query(Course).filter(Course.id == course_id).first()
    assert course.exam_id is None


def test_quick_create_assigned_new_counts_distinct(client, admin_headers, course_id, db):
    """混合批次：batch 内重复的 user_id 只算一次，assigned_new=本次新增行数"""
    from app.models.course import CourseAssignment
    q = _q_single(db, "题")
    u1, u2 = _mk_user(db, "学员甲"), _mk_user(db, "学员乙")
    db.add(CourseAssignment(id=str(uuid.uuid4()), course_id=course_id, user_id=u1.id))
    db.commit()

    res = client.post("/api/exams/quick-create", headers=admin_headers,
                      json=_fixed_body(course_id, [q.id], [10],
                                       assign_user_ids=[u2.id, u1.id, u2.id]))
    assert res.status_code == 201, res.text
    assert res.json()["assigned_new"] == 1
    rows = _assign_rows(db, course_id)
    assert len(rows) == 2  # u1 旧行 + u2 新行，无重复


# ========== 服务端预览抽题 ==========

def test_preview_draw(client, admin_headers, db):
    for i in range(3):
        _q_single(db, f"题{i}", difficulty="easy")
    res = client.post("/api/exams/preview-draw", headers=admin_headers, json={
        "random_rules": [{"type": "single_choice", "difficulty": "easy", "count": 5, "score": 5}],
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["questions"]) == 3          # 按现有存量抽出
    assert data["total_score"] == 15
    assert data["shortages"] and "需 5 题" in data["shortages"][0]
