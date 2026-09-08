"""学员端考试路由"""

import uuid
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func as sa_func, String as SAString, cast as sa_cast
from pydantic import BaseModel
from app.database import get_db
from app.models.user import User
from app.models.exam import Exam, ExamPaper, ExamResult
from app.models.question import Question
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/student", tags=["学员考试"])


class SubmitAnswer(BaseModel):
    question_id: str
    answer: str | list[str] | bool | None = None  # 学生的答案


class SubmitRequest(BaseModel):
    answers: list[SubmitAnswer]


def grade_question(question: Question, student_answer: str | list[str] | bool | None, total_points: int = 10) -> tuple[int, int]:
    """自动打分，返回 (得分, 满分)
    total_points: 该题在试卷中的配置分数（用于 essay 按关键词拆分）
    """
    q_type = question.type
    correct = question.answer

    if q_type == "single_choice":
        full_score = 10
        if student_answer and isinstance(correct, dict):
            correct_answer = correct.get("answer")
            return (full_score if correct_answer is not None and str(student_answer) == str(correct_answer) else 0, full_score)
        return (0, full_score)

    elif q_type == "multi_choice":
        full_score = 10
        if student_answer and isinstance(correct, dict):
            # 格式：{"A": True, "B": True, ...}，提取值为 True 的 key
            correct_list = sorted([k for k, v in correct.items() if v])
            student_list = sorted(student_answer) if isinstance(student_answer, list) else []
            return (full_score if correct_list == student_list else 0, full_score)
        return (0, full_score)

    elif q_type == "true_false":
        full_score = 10
        if student_answer is not None and isinstance(correct, dict):
            student_bool = student_answer if isinstance(student_answer, bool) else str(student_answer).lower() == "true"
            correct_answer = correct.get("answer")
            return (full_score if correct_answer is not None and student_bool == correct_answer else 0, full_score)
        return (0, full_score)

    elif q_type == "fill_blank":
        full_score = 10
        if student_answer and isinstance(correct, dict):
            correct_answer = correct.get("answer")
            return (full_score if correct_answer is not None and str(student_answer).strip().lower() == str(correct_answer).strip().lower() else 0, full_score)
        return (0, full_score)

    elif q_type == "essay":
        full_score = total_points
        keywords: list[str] = question.keywords or []
        if not keywords:
            return (0, full_score)  # 无关键词无法自动评分，需人工批阅
        if not student_answer:
            return (0, full_score)
        # 兼容旧数据：关键词可能存为 ["关键词1，关键词2"]（单元素含逗号）
        # 按逗号展开后去重
        import re
        expanded = []
        for kw in keywords:
            for sub in re.split(r"[,，]", kw):
                s = sub.strip()
                if s and s not in expanded:
                    expanded.append(s)
        if not expanded:
            return (0, full_score)
        answer_lower = str(student_answer).lower()
        matched = sum(1 for kw in expanded if kw.lower() in answer_lower)
        # 每命中一个关键词得 floor(总分 / 关键词数)，向下去整
        per_keyword = full_score // len(expanded)
        score = matched * per_keyword
        return (score, full_score)

    return (0, 10)


@router.get("/exams/{exam_id}/status")
def get_exam_status(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取考试状态"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    return {"status": exam.status}


@router.get("/exams/{exam_id}/start")
def start_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """开始考试，返回试卷题目"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    # 检查是否已参加过（达到最大次数）
    if exam.max_attempts:
        attempt_count = (
            db.query(ExamResult)
            .filter(ExamResult.exam_id == exam_id, ExamResult.user_id == current_user.id)
            .count()
        )
        if attempt_count >= exam.max_attempts:
            raise HTTPException(status_code=400, detail="已达到最大重考次数")

    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).first()
    if not paper:
        raise HTTPException(status_code=400, detail="试卷尚未配置")

    # 获取题目
    if exam.paper_type == "fixed" and paper.questions:
        # 固定组卷
        question_configs = paper.questions
        question_ids = [q["question_id"] for q in question_configs]
        score_map = {q["question_id"]: q["score"] for q in question_configs}
        questions = db.query(Question).filter(Question.id.in_(question_ids)).all()
        # 按配置顺序排列
        questions.sort(key=lambda q: question_ids.index(q.id))
        result = []
        for q in questions:
            result.append({
                "id": q.id,
                "type": q.type,
                "stem": q.stem,
                "options": q.options,
                "score": score_map.get(q.id, 10),
                # 不返回正确答案
            })

    elif exam.paper_type == "random" and paper.random_rules:
        # 随机组卷：按规则动态抽题，限定题库范围
        result = []
        # 获取试卷的题库范围（从 Paper 或 ExamPaper 的 source_banks）
        source_banks = None
        if paper.random_rules and hasattr(paper, 'source_banks'):
            source_banks = getattr(paper, 'source_banks', None)
        if not source_banks:
            # 尝试从 Paper 表获取
            from app.models.paper import Paper as PaperModel
            src_paper = db.query(PaperModel).filter(PaperModel.id == exam.paper_id).first()
            if src_paper and src_paper.source_banks:
                source_banks = src_paper.source_banks

        for rule in paper.random_rules:
            pool_query = db.query(Question).filter(
                Question.type == rule["type"],
                Question.difficulty == rule["difficulty"],
            )
            # 限定题库范围
            if source_banks:
                from app.models.question_category import QuestionCategory
                bank_ids: set[str] = set()
                for bank_id in source_banks:
                    bank_ids.add(bank_id)
                    # 递归收集子分类
                    children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == bank_id).all()
                    for child in children:
                        bank_ids.add(child.id)
                pool_query = pool_query.filter(Question.category_id.in_(bank_ids))
            pool = pool_query.all()
            selected = secrets.SystemRandom().sample(pool, min(rule["count"], len(pool)))
            for q in selected:
                result.append({
                    "id": q.id,
                    "type": q.type,
                    "stem": q.stem,
                    "options": q.options,
                    "score": rule["score"],
                    "difficulty": q.difficulty,
                })
        # 按题型分组（单选→多选→判断→填空→问答），组内按难度升序
        TYPE_ORDER = {
            "single_choice": 0,
            "multi_choice": 1,
            "true_false": 2,
            "fill_blank": 3,
            "essay": 4,
        }
        DIFFICULTY_ORDER = {"easy": 0, "medium": 1, "hard": 2}
        result.sort(key=lambda q: (TYPE_ORDER.get(q["type"], 99), DIFFICULTY_ORDER.get(q["difficulty"], 99)))
    else:
        raise HTTPException(status_code=400, detail="试卷配置无效")

    # 构建题目快照（写回 ExamResult，供后续查看错题用）
    question_snapshot = [{"question_id": q["id"], "score": q["score"]} for q in result]

    # 检查是否有未提交的考试记录（刷新/断网恢复场景），有则复用
    existing_incomplete = (
        db.query(ExamResult)
        .filter(
            ExamResult.exam_id == exam_id,
            ExamResult.user_id == current_user.id,
            sa_cast(ExamResult.answers, SAString) == '{}',
        )
        .first()
    )

    if existing_incomplete:
        # 复用未完成的记录，刷新开始时间，同步更新题目快照
        existing_incomplete.started_at = datetime.now()
        existing_incomplete.questions = question_snapshot
        db.commit()
        exam_result = existing_incomplete
    else:
        # 新建考试记录（含并发安全处理）
        for _ in range(3):
            attempt_number = (
                db.query(ExamResult)
                .filter(ExamResult.exam_id == exam_id, ExamResult.user_id == current_user.id)
                .count()
            ) + 1

            exam_result = ExamResult(
                id=str(uuid.uuid4()),
                exam_id=exam_id,
                user_id=current_user.id,
                answers={},
                questions=question_snapshot,
                score=0,
                passed=False,
                attempt_number=attempt_number,
                started_at=datetime.now(),
            )
            db.add(exam_result)
            try:
                db.commit()
                break
            except IntegrityError:
                db.rollback()
                continue

    return {
        "result_id": exam_result.id,
        "exam_title": exam.title,
        "duration": exam.duration,
        "total_score": exam.total_score,
        "questions": result,
        "attempt_number": exam_result.attempt_number,
    }


@router.post("/exams/{exam_id}/submit")
def submit_exam(
    exam_id: str,
    data: SubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """交卷并自动打分"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    # 获取合法题目 ID 集合（防止提交不属于本次考试的题目）
    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).first()
    valid_question_ids: set[str] = set()
    if paper and paper.questions:
        valid_question_ids = {q["question_id"] for q in paper.questions}
    elif paper and paper.random_rules:
        # 随机组卷：只允许题库范围内符合规则的题目
        source_banks = getattr(paper, 'source_banks', None) or []
        from app.models.question_category import QuestionCategory
        bank_ids: set[str] = set()
        for bank_id in source_banks:
            bank_ids.add(bank_id)
            children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == bank_id).all()
            for child in children:
                bank_ids.add(child.id)
        for rule in paper.random_rules:
            q = db.query(Question).filter(
                Question.type == rule["type"],
                Question.difficulty == rule["difficulty"],
            )
            if bank_ids:
                q = q.filter(Question.category_id.in_(bank_ids))
            pool = q.all()
            valid_question_ids.update(q.id for q in pool)

    # 过滤掉非法题目
    question_ids = [a.question_id for a in data.answers if a.question_id in valid_question_ids]
    if not question_ids:
        raise HTTPException(status_code=400, detail="提交的题目均不属于本次考试")

    questions = db.query(Question).filter(Question.id.in_(question_ids)).all()
    question_map = {q.id: q for q in questions}

    # 获取试卷中每道题的配置分数
    score_map: dict[str, int] = {}
    if paper and paper.questions:
        for qc in paper.questions:
            if isinstance(qc, dict) and "question_id" in qc:
                score_map[qc["question_id"]] = qc.get("score", 10)

    # 打分
    total_score = 0
    max_score = 0
    grading_details = []

    for ans in data.answers:
        q = question_map.get(ans.question_id)
        if not q:
            continue
        score, full = grade_question(q, ans.answer, total_points=score_map.get(ans.question_id, 10))
        total_score += score
        max_score += full
        grading_details.append({
            "question_id": ans.question_id,
            "score": score,
            "max_score": full,
        })

    # 按比例换算到考试总分
    final_score = round(total_score * exam.total_score / max(max_score, 1))
    passed = final_score >= exam.pass_score

    # 查找未提交的考试记录（answers 为空即未提交）
    result = (
        db.query(ExamResult)
        .filter(
            ExamResult.exam_id == exam_id,
            ExamResult.user_id == current_user.id,
            sa_cast(ExamResult.answers, SAString) == '{}',
        )
        .order_by(ExamResult.started_at.desc())
        .first()
    )
    if result:
        result.answers = [a.model_dump() for a in data.answers]
        result.score = final_score
        result.passed = passed
        result.submitted_at = datetime.now()
    else:
        result = ExamResult(
            id=str(uuid.uuid4()),
            exam_id=exam_id,
            user_id=current_user.id,
            answers=[a.model_dump() for a in data.answers],
            score=final_score,
            passed=passed,
            attempt_number=1,
            started_at=datetime.now(),
            submitted_at=datetime.now(),
        )
        db.add(result)

    db.commit()

    return {
        "score": final_score,
        "total_score": exam.total_score,
        "passed": passed,
        "pass_score": exam.pass_score,
        "grading_details": grading_details,
    }


@router.get("/exams/{exam_id}/results")
def get_results(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取当前用户的考试记录"""
    results = (
        db.query(ExamResult)
        .filter(ExamResult.exam_id == exam_id, ExamResult.user_id == current_user.id)
        .order_by(ExamResult.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "score": r.score,
            "passed": r.passed,
            "attempt_number": r.attempt_number,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
        }
        for r in results
    ]


@router.get("/exams/{exam_id}/review/{result_id}")
def review_exam(
    exam_id: str,
    result_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """查看考试回顾：错题 + 正确答案"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    result = (
        db.query(ExamResult)
        .filter(ExamResult.id == result_id, ExamResult.user_id == current_user.id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="考试记录不存在")

    if not result.submitted_at:
        raise HTTPException(status_code=400, detail="考试尚未提交，无法查看回顾")

    if not result.questions:
        raise HTTPException(status_code=400, detail="该考试记录缺少题目快照，无法查看回顾")

    # 获取题目详情
    question_ids = [q["question_id"] for q in result.questions]
    score_map = {q["question_id"]: q["score"] for q in result.questions}
    questions = db.query(Question).filter(Question.id.in_(question_ids)).all()
    question_map = {q.id: q for q in questions}

    # 构建学生答案映射
    answers_map: dict[str, dict] = {}
    if isinstance(result.answers, list):
        for ans in result.answers:
            if isinstance(ans, dict) and "question_id" in ans:
                answers_map[ans["question_id"]] = ans

    # 逐题比对
    review_questions = []
    for qc in result.questions:
        qid = qc["question_id"]
        question = question_map.get(qid)
        if not question:
            continue

        student_ans = answers_map.get(qid, {}).get("answer")
        total_points = score_map.get(qid, 10)
        got_score, max_score = grade_question(question, student_ans, total_points=total_points)

        review_questions.append({
            "id": question.id,
            "type": question.type,
            "stem": question.stem,
            "options": question.options,
            "score": total_points,
            "student_answer": student_ans,
            "correct_answer": question.answer,
            "keywords": question.keywords,
            "is_correct": got_score >= max_score,
            "got_score": got_score,
            "max_score": max_score,
        })

    return {
        "exam_title": exam.title,
        "total_score": exam.total_score,
        "score": result.score,
        "passed": result.passed,
        "pass_score": exam.pass_score,
        "attempt_number": result.attempt_number,
        "submitted_at": result.submitted_at.isoformat() if result.submitted_at else None,
        "questions": review_questions,
    }