"""学员端考试路由"""

import uuid
from datetime import datetime
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.exam import Exam, ExamPaper, ExamResult
from app.models.question import Question
from app.routers.auth import get_current_user
from app.services.department_scope import check_course_assignment

router = APIRouter(prefix="/api/student", tags=["学员考试"])

# 交卷宽限期：超时后仍允许在此时长内补交（网络抖动/自动交卷延迟），超出则记 0 分
SUBMIT_GRACE_SECONDS = 60


class SubmitAnswer(BaseModel):
    question_id: str
    answer: str | list[str] | bool | None = None  # 学生的答案


class SubmitRequest(BaseModel):
    answers: list[SubmitAnswer]


def _get_answer_value(correct: dict) -> Any:
    """从正确答案 JSON 中提取值，兼容 {"answer": ...} 和 {"correct": ...} 两种 key"""
    if not isinstance(correct, dict):
        return None
    return correct.get("answer") if "answer" in correct else correct.get("correct")


def _get_multi_correct_list(correct: dict) -> list[str] | None:
    """从多选题正确答案中提取选项列表，兼容两种格式：
    A) {"A": True, "B": False, "C": True} → ["A", "C"]
    B) {"correct": ["A", "C"]} → ["A", "C"]
    """
    if not isinstance(correct, dict):
        return None
    # 格式 B：{"correct": ["A", "B"]}
    if "correct" in correct and isinstance(correct["correct"], list):
        return sorted(correct["correct"])
    # 格式 A：{"A": True, "B": False, ...}
    return sorted([k for k, v in correct.items() if v])


def grade_question(question: Question, student_answer: str | list[str] | bool | None, total_points: int = 10) -> tuple[int, int]:
    """自动打分，返回 (得分, 满分)。

    修复：原先单选/多选/判断/填空题把满分硬编码为 10，导致试卷中配置的分值
    （如「本题 90 分 / 那题 10 分」）被完全忽略，题目权重失真。
    现统一以 total_points（来自试卷该题的分数配置）作为满分。
    """
    q_type = question.type
    correct = question.answer
    full_score = max(int(total_points or 0), 0)
    if full_score <= 0:
        return (0, full_score)

    if q_type == "single_choice":
        if student_answer and isinstance(correct, dict):
            correct_answer = _get_answer_value(correct)
            return (full_score if correct_answer is not None and str(student_answer) == str(correct_answer) else 0, full_score)
        return (0, full_score)

    elif q_type == "multi_choice":
        if student_answer and isinstance(correct, dict):
            correct_list = _get_multi_correct_list(correct)
            if correct_list is None:
                return (0, full_score)
            student_list = sorted(student_answer) if isinstance(student_answer, list) else []
            return (full_score if correct_list == student_list else 0, full_score)
        return (0, full_score)

    elif q_type == "true_false":
        # 未作答必须为 None（不能是 False），否则「留空」会被当成「选错误」而白送分
        if student_answer is not None and isinstance(correct, dict):
            student_bool = student_answer if isinstance(student_answer, bool) else str(student_answer).strip().lower() == "true"
            correct_answer = _get_answer_value(correct)
            return (full_score if correct_answer is not None and student_bool == correct_answer else 0, full_score)
        return (0, full_score)

    elif q_type == "fill_blank":
        if student_answer and isinstance(correct, dict):
            correct_answer = _get_answer_value(correct)
            return (full_score if correct_answer is not None and str(student_answer).strip().lower() == str(correct_answer).strip().lower() else 0, full_score)
        return (0, full_score)

    elif q_type == "essay":
        keywords: list[str] = question.keywords or []
        if not keywords or not student_answer:
            return (0, full_score)
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
        # 修复：原 `matched * (full_score // len(expanded))` 在关键词数多于满分时
        # 每词得分被整除为 0，导致永远得 0 分。改为按比例四舍五入并截断到满分。
        score = min(full_score, round(full_score * matched / len(expanded)))
        return (score, full_score)

    return (0, full_score)


@router.get("/exams/{exam_id}/status")
def get_exam_status(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取考试状态（含是否可开始、原因、剩余作答时间、剩余重考次数）。"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    now = datetime.now()
    reason = _exam_time_window_error(exam, now)

    if not reason and current_user.role != "admin" and not check_course_assignment(db, current_user, exam.course_id):
        reason = "未分配该课程，无法参加考试"

    # 注：按需求确认，签到不再作为考试解锁的前置条件；考试只看视频进度。

    attempts_used = (
        db.query(ExamResult)
        .filter(ExamResult.exam_id == exam_id, ExamResult.user_id == current_user.id)
        .count()
    )
    attempts_left = None if not exam.max_attempts else max(0, exam.max_attempts - attempts_used)
    if not reason and attempts_left == 0:
        reason = "已达到最大重考次数"

    # 进行中的作答剩余时间
    remaining_seconds = None
    in_progress = (
        db.query(ExamResult)
        .filter(
            ExamResult.exam_id == exam_id,
            ExamResult.user_id == current_user.id,
            ExamResult.submitted_at.is_(None),
        )
        .order_by(ExamResult.started_at.desc())
        .first()
    )
    if in_progress and exam.duration:
        elapsed = (now - (in_progress.started_at or now)).total_seconds()
        remaining_seconds = max(0, int(exam.duration * 60 - elapsed))

    return {
        "status": exam.status,
        "can_start": reason is None,
        "reason": reason,
        "duration": exam.duration,
        "remaining_seconds": remaining_seconds,
        "attempts_used": attempts_used,
        "attempts_left": attempts_left,
        "start_time": exam.start_time.isoformat() if exam.start_time else None,
        "end_time": exam.end_time.isoformat() if exam.end_time else None,
    }


def _exam_time_window_error(exam: Exam, now: datetime) -> str | None:
    """校验考试状态与开放时间，返回错误提示（None 表示当前允许考试）。"""
    if exam.status != "published":
        if exam.status == "ended":
            return "考试已结束"
        return "考试尚未发布"
    if exam.start_time and now < exam.start_time:
        return f"考试将于 {exam.start_time:%Y-%m-%d %H:%M} 开放"
    if exam.end_time and now > exam.end_time:
        return f"考试已于 {exam.end_time:%Y-%m-%d %H:%M} 截止"
    return None


def _load_snapshot_questions(db: Session, snapshot: list[dict]) -> list[dict]:
    """根据题目快照重建题目列表（不重新抽题，保证同一次作答题目稳定）。"""
    if not snapshot:
        return []
    ids = [item["question_id"] for item in snapshot]
    score_map = {item["question_id"]: item.get("score", 0) for item in snapshot}
    questions = db.query(Question).filter(Question.id.in_(ids)).all()
    qmap = {q.id: q for q in questions}
    out: list[dict] = []
    for item in snapshot:
        q = qmap.get(item["question_id"])
        if not q:
            continue  # 题目已被删除，跳过
        out.append({
            "id": q.id,
            "type": q.type,
            "stem": q.stem,
            "options": q.options,
            "score": score_map.get(q.id, 0),
        })
    return out


def _draw_random_questions(db: Session, paper: ExamPaper, exam: Exam) -> list[dict]:
    """按规则随机抽题，返回 [{id,type,stem,options,score,difficulty}]。

    题库范围优先级：ExamPaper.source_banks（一键建考直建的考试没有 papers 记录，
    范围存在 exam_papers 上）→ papers.source_banks（旧「先建试卷再建考试」链路）。
    """
    from app.models.paper import Paper as PaperModel
    from app.services.exam_service import draw_random_questions

    source_banks = paper.source_banks
    if not source_banks and exam.paper_id:
        src_paper = db.query(PaperModel).filter(PaperModel.id == exam.paper_id).first()
        if src_paper and src_paper.source_banks:
            source_banks = src_paper.source_banks
    return draw_random_questions(db, paper.random_rules or [], source_banks)


def _draw_fixed_questions(db: Session, paper: ExamPaper) -> list[dict]:
    """固定组卷：按配置顺序取题。"""
    configs = paper.questions or []
    question_ids = [c["question_id"] for c in configs]
    score_map = {c["question_id"]: c.get("score", 0) for c in configs}
    questions = db.query(Question).filter(Question.id.in_(question_ids)).all()
    qmap = {q.id: q for q in questions}
    out: list[dict] = []
    for cid in question_ids:  # 保持配置顺序
        q = qmap.get(cid)
        if not q:
            continue
        out.append({
            "id": q.id,
            "type": q.type,
            "stem": q.stem,
            "options": q.options,
            "score": score_map.get(q.id, 0),
            # 不返回正确答案
        })
    return out


@router.get("/exams/{exam_id}/start")
def start_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """开始考试，返回试卷题目。

    修复项：
    - 校验考试状态与开放时间（原先 start_time/end_time 从不校验，已截止的考试仍可作答）
    - 校验学员是否被分配了该课程（原先任意学员可考任意考试）
    - 刷新页面不再重置倒计时（原先每次 start 都把 started_at 置为当前时间）
    - 刷新页面不再重新抽题（原先随机组卷每次刷新换一套题，可反复刷到简单题）
    - 返回 remaining_seconds 由服务端计算，前端不再自行重新计时
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    now = datetime.now()
    window_error = _exam_time_window_error(exam, now)
    if window_error:
        raise HTTPException(status_code=400, detail=window_error)

    if current_user.role != "admin" and not check_course_assignment(db, current_user, exam.course_id):
        raise HTTPException(status_code=403, detail="未分配该课程，无法参加考试")

    duration_seconds = max(int(exam.duration or 0), 0) * 60

    # ── 优先复用未提交的作答（刷新/断网恢复）────────────────────────
    existing_incomplete = (
        db.query(ExamResult)
        .filter(
            ExamResult.exam_id == exam_id,
            ExamResult.user_id == current_user.id,
            ExamResult.submitted_at.is_(None),
        )
        .order_by(ExamResult.started_at.desc())
        .first()
    )

    if existing_incomplete:
        started = existing_incomplete.started_at or now
        elapsed = (now - started).total_seconds()
        remaining = max(0, int(duration_seconds - elapsed)) if duration_seconds else 0

        if duration_seconds and remaining <= 0:
            # 超时未交卷：按超时归档为 0 分，避免反复重试
            existing_incomplete.answers = []
            existing_incomplete.score = 0
            existing_incomplete.passed = False
            existing_incomplete.submitted_at = now
            db.commit()
            raise HTTPException(status_code=400, detail="考试已超时，本次作答已按超时交卷（0 分）")

        snapshot = existing_incomplete.questions or []
        result = _load_snapshot_questions(db, snapshot)
        if result:
            exam_result = existing_incomplete
        else:
            # 快照丢失（历史脏数据）→ 作废该次尝试，重新抽题
            db.delete(existing_incomplete)
            db.commit()
            existing_incomplete = None

    if not existing_incomplete:
        # ── 新建一次作答 ──────────────────────────────────────────
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

        if exam.paper_type == "fixed" and paper.questions:
            result = _draw_fixed_questions(db, paper)
        elif exam.paper_type == "random" and paper.random_rules:
            result = _draw_random_questions(db, paper, exam)
        else:
            raise HTTPException(status_code=400, detail="试卷配置无效")

        if not result:
            raise HTTPException(
                status_code=400,
                detail="试卷未抽到任何题目，请管理员检查组卷规则的题型/难度/题库范围是否与题库匹配",
            )

        question_snapshot = [{"question_id": q["id"], "score": q["score"]} for q in result]
        remaining = duration_seconds

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
                started_at=now,
                submitted_at=None,
            )
            db.add(exam_result)
            try:
                db.commit()
                break
            except IntegrityError:
                db.rollback()
                continue
        else:
            raise HTTPException(status_code=409, detail="创建考试记录失败，请重试")

    return {
        "result_id": exam_result.id,
        "exam_title": exam.title,
        "duration": exam.duration,
        "remaining_seconds": remaining,
        "total_score": exam.total_score,
        "paper_total_score": sum(q["score"] for q in result),
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
    """交卷并自动打分。

    修复（P0）：原先换算分母 `max_score` 只累计「学生实际提交的题目」，
    导致 5 题卷只交 1 题也能算出 100 分并判定通过（已用 PoC 复现）。
    现在：
    - 以本次作答的题目快照为唯一评分依据
    - 分母 = 快照全部题目分值之和，未作答按 0 分计入，少交题不再有利
    - 提交的题目必须落在本次快照内（随机组卷原先按整个题库校验，范围过宽）
    - 服务端校验考试时长，超时交卷记 0 分
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    result = (
        db.query(ExamResult)
        .filter(
            ExamResult.exam_id == exam_id,
            ExamResult.user_id == current_user.id,
            ExamResult.submitted_at.is_(None),
        )
        .order_by(ExamResult.started_at.desc())
        .first()
    )
    if not result:
        raise HTTPException(status_code=400, detail="未找到进行中的考试，请先开始考试")

    snapshot = result.questions or []
    if not snapshot:
        raise HTTPException(status_code=400, detail="本次作答缺少题目快照，无法评分，请重新开始考试")

    now = datetime.now()
    duration_seconds = max(int(exam.duration or 0), 0) * 60
    timed_out = bool(
        duration_seconds
        and result.started_at
        and (now - result.started_at).total_seconds() > duration_seconds + SUBMIT_GRACE_SECONDS
    )

    score_map = {item["question_id"]: item.get("score", 0) for item in snapshot}
    expected_max = sum(score_map.values())
    if expected_max <= 0:
        raise HTTPException(status_code=400, detail="本次试卷分值为 0，请管理员检查组卷配置")

    submitted = {a.question_id: a.answer for a in data.answers if a.question_id in score_map}
    if not submitted:
        raise HTTPException(status_code=400, detail="提交的题目均不属于本次考试")

    questions = db.query(Question).filter(Question.id.in_(list(score_map.keys()))).all()
    question_map = {q.id: q for q in questions}

    total_score = 0
    grading_details = []
    for qid in score_map:                    # 遍历快照全部题目，未作答自然得 0
        question = question_map.get(qid)
        if not question:
            continue
        score, full = grade_question(
            question, submitted.get(qid), total_points=score_map.get(qid, 0)
        )
        total_score += score
        grading_details.append({
            "question_id": qid,
            "score": score,
            "max_score": full,
            "answered": qid in submitted,
        })

    # 分母固定为本次试卷应有总分 → 无法通过少交题放大得分
    final_score = 0 if timed_out else round(total_score * exam.total_score / expected_max)
    passed = final_score >= exam.pass_score

    result.answers = [a.model_dump() for a in data.answers if a.question_id in score_map]
    result.score = final_score
    result.passed = passed
    result.submitted_at = now
    db.commit()

    return {
        "score": final_score,
        "total_score": exam.total_score,
        "passed": passed,
        "pass_score": exam.pass_score,
        "timed_out": timed_out,
        "paper_total_score": expected_max,
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