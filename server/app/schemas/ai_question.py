"""AI 出题相关 Pydantic 模型"""

from pydantic import BaseModel, Field, model_validator

from app.schemas.question import QuestionCreate

# 与 questions 路由 TYPE_MAP 的英文枚举保持一致
ALL_QTYPES = ("single_choice", "multi_choice", "true_false", "fill_blank", "essay")
TYPE_CN = {
    "single_choice": "单选题",
    "multi_choice": "多选题",
    "true_false": "判断题",
    "fill_blank": "填空题",
    "essay": "问答题",
}


class AIGenerateCounts(BaseModel):
    """各题型生成数量（0=不生成该题型）"""

    single_choice: int = Field(0, ge=0, le=30)
    multi_choice: int = Field(0, ge=0, le=30)
    true_false: int = Field(0, ge=0, le=30)
    fill_blank: int = Field(0, ge=0, le=30)
    essay: int = Field(0, ge=0, le=30)

    @property
    def total(self) -> int:
        return sum(getattr(self, t) for t in ALL_QTYPES)


class AIGenerateRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200, description="主题关键词")
    counts: AIGenerateCounts
    difficulty_mode: str = Field(
        "mixed", pattern="^(mixed|easy|medium|hard)$", description="难度策略"
    )
    extra_requirement: str | None = Field(None, max_length=500, description="补充要求（仅影响出题风格）")
    category_id: str | None = Field(None, description="入库目标题库分类（草稿阶段仅透传）")

    @model_validator(mode="after")
    def _check_total(self):
        if not 1 <= self.counts.total <= 30:
            raise ValueError("题目总数需在 1~30 之间")
        return self


class AIDraftItem(BaseModel):
    """LLM 生成并已通过校验的题目草稿（结构与 QuestionCreate 同构）"""

    type: str
    stem: str
    options: dict | None = None
    answer: dict
    keywords: list[str] | None = None
    difficulty: str = "medium"
    category_id: str | None = None
    dup_existing: bool = Field(False, description="疑似与题库现有题干重复，前端默认不勾选")


class AIGenerateResponse(BaseModel):
    drafts: list[AIDraftItem]
    warnings: list[str] = []
    meta: dict = {}


class AIStatusOut(BaseModel):
    enabled: bool
    model: str


class BulkCreateRequest(BaseModel):
    """审核通过后批量入库（上限 50 = 单次生成 30 题 + 余量）"""

    items: list[QuestionCreate] = Field(..., min_length=1, max_length=50)
