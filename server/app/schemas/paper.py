"""试卷 Pydantic Schema"""

from datetime import datetime
from pydantic import BaseModel


# ========== 试卷 ==========

class MandatoryQuestion(BaseModel):
    question_id: str
    score: int


class RandomRule(BaseModel):
    type: str
    difficulty: str
    count: int
    score: int
    category_id: str | None = None  # 可选：限制题库分类范围


class PaperCreate(BaseModel):
    title: str
    category_id: str | None = None
    paper_type: str = "fixed"
    mandatory_questions: list[MandatoryQuestion] | None = None
    random_rules: list[RandomRule] | None = None
    source_banks: list[str] | None = None
    total_score: int = 0


class PaperUpdate(BaseModel):
    title: str | None = None
    category_id: str | None = None
    paper_type: str | None = None
    mandatory_questions: list[MandatoryQuestion] | None = None
    random_rules: list[RandomRule] | None = None
    source_banks: list[str] | None = None
    total_score: int | None = None
    status: str | None = None


class PaperOut(BaseModel):
    id: str
    title: str
    category_id: str | None = None
    paper_type: str
    mandatory_questions: list | None = None
    random_rules: list | None = None
    source_banks: list | None = None
    total_score: int
    status: str
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}