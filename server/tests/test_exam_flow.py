"""考试流程集成测试 — 覆盖 start_exam / submit_exam / 刷新恢复 / 计分正确性"""

import uuid
from sqlalchemy.orm import Session
from app.models.exam import Exam, ExamPaper, ExamResult
from app.models.question import Question
from app.models.course import CourseAssignment
from tests.conftest import create_question


def setup_exam(db: Session, course_id: str, paper_type: str = "fixed"):
    """创建考试 + 试卷 + 题目"""
    # 创建题目
    q1 = create_question(db, "single_choice", "1+1=?", {"correct": "A"})
    q2 = create_question(db, "true_false", "地球是圆的", {"correct": True})
    q3 = create_question(db, "single_choice", "水的化学式是?", {"correct": "C"})

    # 创建考试
    # 注意：必须 status="published"，否则学员无法开始考试（这是修复后的预期行为）
    exam = Exam(
        id=str(uuid.uuid4()),
        course_id=course_id,
        title="摸底测试",
        paper_type=paper_type,
        duration=60,
        total_score=100,
        pass_score=60,
        max_attempts=3,
        status="published",
    )
    db.add(exam)
    db.flush()

    # 创建试卷
    if paper_type == "fixed":
        exam_paper = ExamPaper(
            id=str(uuid.uuid4()),
            exam_id=exam.id,
            questions=[
                {"question_id": q1.id, "score": 30},
                {"question_id": q2.id, "score": 30},
                {"question_id": q3.id, "score": 40},
            ],
        )
    else:
        exam_paper = ExamPaper(
            id=str(uuid.uuid4()),
            exam_id=exam.id,
            random_rules=[
                {"type": "single_choice", "difficulty": "medium", "count": 2, "score": 50},
            ],
        )

    db.add(exam_paper)
    db.commit()
    return exam.id


def test_full_exam_flow(client, student_headers, admin_headers, course_id, db):
    """完整考试流程：开始 -> 提交 -> 查看成绩"""
    exam_id = setup_exam(db, course_id)

    # 分配课程给学员
    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    # 1. 开始考试
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["exam_title"] == "摸底测试"
    assert data["duration"] == 60
    assert len(data["questions"]) == 3
    # 回归：固定组卷按题型排序（单选→多选→判断→填空→问答），
    # 同题型内保持配置顺序 → 判断题应排到最后
    assert [q["type"] for q in data["questions"]] == [
        "single_choice", "single_choice", "true_false",
    ]
    result_id = data["result_id"]

    # 2. 提交答案（全对，按题干匹配，不依赖题目位置）
    answers = [
        {
            "question_id": q["id"],
            "answer": {"1+1=?": "A", "地球是圆的": True, "水的化学式是?": "C"}[q["stem"]],
        }
        for q in data["questions"]
    ]
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": answers},
        headers=student_headers,
    )
    assert res.status_code == 200
    result = res.json()
    assert result["score"] == 100
    assert result["passed"] is True
    assert result["total_score"] == 100

    # 3. 查看成绩
    res = client.get(f"/api/student/exams/{exam_id}/results", headers=student_headers)
    assert res.status_code == 200
    results = res.json()
    assert len(results) == 1
    assert results[0]["score"] == 100
    assert results[0]["passed"] is True


def test_exam_partial_score(client, student_headers, admin_headers, course_id, db):
    """部分正确时的计分"""
    exam_id = setup_exam(db, course_id)

    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    data = res.json()

    # 只答对「1+1=?」（30分），其余答错（各 0 分）
    # 按题干匹配：排序后题序为 单选30 / 单选40 / 判断30，不能按位置写死
    answers = [
        {
            "question_id": q["id"],
            "answer": {
                "1+1=?": "A",           # 正确
                "水的化学式是?": "A",    # 错误
                "地球是圆的": False,     # 错误
            }[q["stem"]],
        }
        for q in data["questions"]
    ]
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": answers},
        headers=student_headers,
    )
    assert res.status_code == 200
    result = res.json()
    # 试卷配分为 30/30/40（合计 100），答对第一题得 30 分，换算后 = 30*100/100 = 30
    # 修复前这里断言的是 33 —— 那是「每题硬编码 10 分」这一缺陷留下的错误期望值
    assert result["score"] == 30
    assert result["paper_total_score"] == 100
    assert result["passed"] is False


def test_exam_refresh_recovery(client, student_headers, admin_headers, course_id, db):
    """刷新页面后重新 start_exam 应复用原记录，不产生重复"""
    exam_id = setup_exam(db, course_id)

    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    # 第一次开始
    res1 = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    result_id_1 = res1.json()["result_id"]

    # 模拟刷新：再次开始
    res2 = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    result_id_2 = res2.json()["result_id"]

    # 应该复用同一条记录
    assert result_id_1 == result_id_2

    # 数据库中应该只有一条 ExamResult
    from app.models.exam import ExamResult
    count = db.query(ExamResult).filter(
        ExamResult.exam_id == exam_id,
    ).count()
    assert count == 1


def test_exam_max_attempts(client, student_headers, admin_headers, course_id, db):
    """达到最大考试次数后不能再考"""
    exam_id = setup_exam(db, course_id)
    # 设置最大 1 次
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    exam.max_attempts = 1
    db.commit()

    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    # 第一次考试并提交
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    data = res.json()
    answers = [{"question_id": q["id"], "answer": "A"} for q in data["questions"]]
    client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": answers},
        headers=student_headers,
    )

    # 第二次开始应被拒绝
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 400
    assert "最大重考次数" in res.json()["detail"]


def test_in_progress_result_does_not_break_profile_and_detail(
    client, student_headers, admin_headers, course_id, db
):
    """作答中（submitted_at=NULL）的答卷不得打挂学员档案 / 管理员学员详情。

    回归：get_student_profile 与 admin_progress_detail 曾直接
    r.submitted_at.isoformat()，学员开考未交卷后访问这两个端点必 500
    （AttributeError: 'NoneType' object has no attribute 'isoformat'）。
    口径与 exams.py 一致：历史列表只认已交卷的答卷。
    """
    from app.models.course import Course

    exam_id = setup_exam(db, course_id)
    user_id = _get_student_id(client, admin_headers, db)
    _assign_course(client, admin_headers, course_id, user_id)

    # 考试挂到课程（admin_progress_detail 按 Course.exam_id 查考试记录）
    course = db.query(Course).filter(Course.id == course_id).first()
    course.exam_id = exam_id
    db.commit()

    # 开考不交卷 → 产生 submitted_at=NULL 的作答中答卷
    res = client.get(f"/api/student/exams/{exam_id}/start", headers=student_headers)
    assert res.status_code == 200

    # 1) 学员档案：200 且历史不含未交卷记录
    res = client.get("/api/student/profile", headers=student_headers)
    assert res.status_code == 200
    assert res.json()["exam_history"] == []

    # 2) 管理员学员详情：200 且考试记录不含未交卷记录
    res = client.get(
        f"/api/admin/progress/detail/{user_id}/{course_id}", headers=admin_headers
    )
    assert res.status_code == 200
    assert res.json()["exams"] == []

    # 3) 交卷后两处应正常展示该记录
    started = client.get(
        f"/api/student/exams/{exam_id}/start", headers=student_headers
    ).json()
    answers = [{"question_id": q["id"], "answer": "A"} for q in started["questions"]]
    res = client.post(
        f"/api/student/exams/{exam_id}/submit",
        json={"answers": answers},
        headers=student_headers,
    )
    assert res.status_code == 200

    res = client.get("/api/student/profile", headers=student_headers)
    assert res.status_code == 200
    hist = res.json()["exam_history"]
    assert len(hist) == 1 and hist[0]["exam_id"] == exam_id
    assert hist[0]["submitted_at"]

    res = client.get(
        f"/api/admin/progress/detail/{user_id}/{course_id}", headers=admin_headers
    )
    assert res.status_code == 200
    assert len(res.json()["exams"]) == 1


def _get_student_id(client, admin_headers, db):
    """从数据库获取学员 user_id"""
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {_get_student_token_from_db(db)}"})
    # 直接查数据库
    from app.models.user import User
    student = db.query(User).filter(User.username == "student1").first()
    return student.id


def _get_student_token_from_db(db):
    """获取学员 token"""
    from app.models.user import User
    student = db.query(User).filter(User.username == "student1").first()
    return None  # 仅用于类型提示，实际通过 fixture 获取


def _assign_course(client, admin_headers, course_id, user_id):
    """分配课程给用户"""
    client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [user_id], "department_ids": []},
        headers=admin_headers,
    )