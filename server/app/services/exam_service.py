"""考试组卷/评分共享逻辑

抽题/校验原本散在 student_exam.py 里（且只服务学员端开考），一键建考
（quick-create）、组卷预览、存量校验都要用同一套规则，统一收敛到这里：

- expand_bank_ids：题库分类 → 含全部后代的集合（与「可见性=整链」口径一致）
- draw_random_questions：按规则抽题（secrets 随机 + 题型/难度排序）
- validate_random_rules：抽题前校验题库存量是否够抽
- grade_question：自动打分（学员端交卷 / 管理端答卷回顾共用）
- build_result_review：逐题比对生成答卷回顾（学员端 review / 管理端答卷共用）
- aggregate_exam_results：按考试聚合全体考生成绩（成绩页/导出共用口径）
"""

import secrets
from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session

from app.models.question import Question
from app.models.question_category import QuestionCategory

# 组卷时的题目排序：按题型分组（单选→多选→判断→填空→问答），组内按难度升序
TYPE_ORDER = {"single_choice": 0, "multi_choice": 1, "true_false": 2, "fill_blank": 3, "essay": 4}
DIFFICULTY_ORDER = {"easy": 0, "medium": 1, "hard": 2}

TYPE_LABELS = {
    "single_choice": "单选题", "multi_choice": "多选题", "true_false": "判断题",
    "fill_blank": "填空题", "essay": "问答题",
}
DIFFICULTY_LABELS = {"easy": "简单", "medium": "中等", "hard": "困难"}


def expand_bank_ids(db: Session, source_banks: list[str] | None) -> set[str]:
    """把题库分类 id 列表扩展为「自身 + 全部后代」的集合。"""
    bank_ids: set[str] = set()
    if not source_banks:
        return bank_ids
    pending = list(source_banks)
    while pending:
        bank_id = pending.pop()
        if bank_id in bank_ids:
            continue
        bank_ids.add(bank_id)
        pending.extend(
            c.id for c in db.query(QuestionCategory.id)
            .filter(QuestionCategory.parent_id == bank_id).all()
        )
    return bank_ids


def _rule_pool(db: Session, rule: dict, bank_ids: set[str]) -> list[Question]:
    pool_query = db.query(Question).filter(
        Question.type == rule["type"],
        Question.difficulty == rule["difficulty"],
    )
    if bank_ids:
        pool_query = pool_query.filter(Question.category_id.in_(bank_ids))
    return pool_query.all()


def validate_random_rules(db: Session, rules: list[dict], source_banks: list[str] | None) -> list[str]:
    """逐规则检查题库存量。返回缺题说明列表（空 = 全部可抽）。"""
    bank_ids = expand_bank_ids(db, source_banks)
    problems: list[str] = []
    for rule in rules or []:
        count = int(rule.get("count") or 0)
        if count <= 0:
            continue
        pool = _rule_pool(db, rule, bank_ids)
        if len(pool) < count:
            problems.append(
                f"{TYPE_LABELS.get(rule['type'], rule['type'])}·{DIFFICULTY_LABELS.get(rule['difficulty'], rule['difficulty'])}"
                f"：需 {count} 题，题库仅有 {len(pool)} 题"
            )
    return problems


def draw_random_questions(db: Session, rules: list[dict], source_banks: list[str] | None) -> list[dict]:
    """按规则随机抽题，返回 [{id,type,stem,options,score,difficulty}]（不含答案）。"""
    bank_ids = expand_bank_ids(db, source_banks)
    picked_ids: set[str] = set()
    result: list[dict] = []
    for rule in rules or []:
        pool = [q for q in _rule_pool(db, rule, bank_ids) if q.id not in picked_ids]
        selected = secrets.SystemRandom().sample(pool, min(int(rule["count"]), len(pool)))
        for q in selected:
            picked_ids.add(q.id)
            result.append({
                "id": q.id,
                "type": q.type,
                "stem": q.stem,
                "options": q.options,
                "score": rule["score"],
                "difficulty": q.difficulty,
            })
    result.sort(key=lambda q: (TYPE_ORDER.get(q["type"], 99), DIFFICULTY_ORDER.get(q["difficulty"], 99)))
    return result


# ========== 评分与答卷回顾（学员端 / 管理端共用） ==========

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


def review_available(exam, result, attempts_used: int, now: datetime | None = None) -> tuple[bool, str]:
    """按 exam.review_policy 判定这份答卷的错题回顾是否对学员开放。

    背景：review 原本交卷即无条件返回每题正确答案——第一次没过的学员看完错题
    答案后重考（固定卷同题同序、随机卷也不排除已见题），等于开卷送分。
    三档策略见 schemas/exam.ReviewPolicy；「条件永不满足」的情形兜底放行，
    避免学员永远无法回顾：
    - after_exhausted：不限重考次数（max_attempts 空）→ 退化为可看；已及格 → 可看
      （成绩口径是按最高分及格，及格后重考刷分不改变结果，回顾无作弊收益）
    - after_window：未设截止时间（end_time 空）→ 退化为可看

    返回 (是否可看, 不可看时给学员的提示文案)。
    """
    policy = getattr(exam, "review_policy", None) or "always"
    if policy == "after_exhausted":
        if result.passed or not exam.max_attempts:
            return True, ""
        if attempts_used >= exam.max_attempts:
            return True, ""
        left = exam.max_attempts - attempts_used
        return False, f"错题回顾将在重考机会用完后开放（还剩 {left} 次机会）"
    if policy == "after_window":
        if not exam.end_time:
            return True, ""
        if (now or datetime.now()) >= exam.end_time:
            return True, ""
        return False, f"错题回顾将在考试截止（{exam.end_time:%Y-%m-%d %H:%M}）后开放"
    return True, ""


def build_result_review(db: Session, exam, result) -> dict:
    """按题目快照逐题比对，构建答卷回顾数据（学员端 review 与管理端答卷详情共用）。

    注意：本函数只负责组装数据，「能不能看」的闸门由调用方先走 review_available()
    （学员端），管理端不受策略限制。
    调用方负责校验：result 属于 exam、已交卷（submitted_at 非空）、有题目快照。
    """
    question_ids = [q["question_id"] for q in result.questions]
    score_map = {q["question_id"]: q["score"] for q in result.questions}
    questions = db.query(Question).filter(Question.id.in_(question_ids)).all()
    question_map = {q.id: q for q in questions}

    answers_map: dict[str, Any] = {}
    if isinstance(result.answers, list):
        for ans in result.answers:
            if isinstance(ans, dict) and "question_id" in ans:
                answers_map[ans["question_id"]] = ans.get("answer")

    review_questions = []
    for qc in result.questions:
        qid = qc["question_id"]
        question = question_map.get(qid)
        if not question:
            continue  # 题目已被删除

        student_ans = answers_map.get(qid)
        total_points = score_map.get(qid, 10)
        got_score, max_score = grade_question(question, student_ans, total_points=total_points)

        review_questions.append({
            "id": question.id,
            "type": question.type,
            "stem": question.stem,
            "options": question.options,
            "difficulty": question.difficulty,
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
        "started_at": result.started_at.isoformat() if result.started_at else None,
        "submitted_at": result.submitted_at.isoformat() if result.submitted_at else None,
        "questions": review_questions,
    }


# ========== 成绩聚合（管理端成绩页 / Excel 导出共用） ==========

def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def aggregate_exam_results(db: Session, exam) -> dict:
    """按考试聚合考生成绩。

    口径（与产品确认）：
    - 应考 = 该考试所属课程的分配人数
    - 已交卷 / 通过：按人统计，一人多次作答取**最高分**为个人成绩，任一次及格即算通过
    - 作答中：存在 submitted_at 为 NULL 的作答记录（与「已交卷」可并存）
    - 未参考：已分配课程但**没有任何作答记录**（开始作答即不算缺考）
    - 成绩行包含所有作答者（含已移出分配名单的人，以 assigned=false 标记），
      未参考名单只来自当前分配名单
    """
    from app.models.course import Course, CourseAssignment
    from app.models.user import User
    from app.models.exam import ExamResult

    course = db.query(Course).filter(Course.id == exam.course_id).first()

    assigned_rows = (
        db.query(User.id, User.name, User.employee_id, User.department)
        .join(CourseAssignment, CourseAssignment.user_id == User.id)
        .filter(CourseAssignment.course_id == exam.course_id)
        .distinct()
        .all()
    )
    assigned_ids = {r.id for r in assigned_rows}

    attempt_rows = (
        db.query(ExamResult, User)
        .outerjoin(User, ExamResult.user_id == User.id)
        .filter(ExamResult.exam_id == exam.id)
        .order_by(ExamResult.started_at)
        .all()
    )

    rows_map: dict[str, dict] = {}
    for res, user in attempt_rows:
        row = rows_map.setdefault(res.user_id, {
            "user_id": res.user_id,
            "name": user.name if user else "(已删除用户)",
            "employee_id": user.employee_id if user else None,
            "department": user.department if user else None,
            "assigned": res.user_id in assigned_ids,
            "attempts": [],
        })
        row["attempts"].append({
            "id": res.id,
            "attempt_number": res.attempt_number,
            "score": res.score,
            "passed": res.passed,
            "started_at": _iso(res.started_at),
            "submitted_at": _iso(res.submitted_at),
        })

    rows: list[dict] = []
    for row in rows_map.values():
        submitted = [a for a in row["attempts"] if a["submitted_at"]]
        row["attempt_count"] = len(submitted)
        row["best_score"] = max((a["score"] for a in submitted), default=None)
        row["passed"] = any(a["passed"] for a in submitted)
        row["in_progress"] = any(not a["submitted_at"] for a in row["attempts"])
        rows.append(row)
    # 排序：有分在前按分数降序，无分（仅作答中）在后；同分按姓名
    rows.sort(key=lambda r: (-(r["best_score"] if r["best_score"] is not None else -1), r["name"] or ""))

    absent = [
        {"user_id": u.id, "name": u.name, "employee_id": u.employee_id, "department": u.department}
        for u in assigned_rows if u.id not in rows_map
    ]
    absent.sort(key=lambda x: x["name"] or "")

    scored_users = [r for r in rows if r["attempt_count"] > 0]
    summary = {
        "assigned": len(assigned_ids),
        "submitted_users": len(scored_users),
        "passed_users": sum(1 for r in rows if r["passed"]),
        "in_progress_users": sum(1 for r in rows if r["in_progress"]),
        "absent_users": len(absent),
        "avg_score": (
            round(sum(r["best_score"] for r in scored_users) / len(scored_users), 1)
            if scored_users else None
        ),
    }

    return {
        "exam": {
            "id": exam.id,
            "title": exam.title,
            "status": exam.status,
            "paper_type": exam.paper_type,
            "duration": exam.duration,
            "total_score": exam.total_score,
            "pass_score": exam.pass_score,
            "start_time": _iso(exam.start_time),
            "end_time": _iso(exam.end_time),
            "course_id": exam.course_id,
            "course_title": course.title if course else None,
        },
        "summary": summary,
        "rows": rows,
        "absent": absent,
    }
