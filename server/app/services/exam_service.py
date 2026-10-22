"""考试组卷共享逻辑

抽题/校验原本散在 student_exam.py 里（且只服务学员端开考），一键建考
（quick-create）、组卷预览、存量校验都要用同一套规则，统一收敛到这里：

- expand_bank_ids：题库分类 → 含全部后代的集合（与「可见性=整链」口径一致）
- draw_random_questions：按规则抽题（secrets 随机 + 题型/难度排序）
- validate_random_rules：抽题前校验题库存量是否够抽
"""

import secrets
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
