"""试题相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel, Field


class QuestionCreate(BaseModel):
    type: str = Field(..., description="single_choice / multi_choice / true_false / fill_blank / essay")
    stem: str = Field(..., description="题干")
    options: dict | None = Field(None, description="选项（选择题）")
    answer: dict = Field(..., description="正确答案")
    keywords: list[str] | None = Field(None, description="关键词（问答题自动打分）")
    difficulty: str = Field("medium", description="easy / medium / hard")
    tags: list[str] | None = Field(None, description="知识点标签")
    section: str | None = Field(None, description="关联章节")
    category_id: str | None = Field(None, description="题库分类ID")


class QuestionUpdate(BaseModel):
    type: str | None = None
    stem: str | None = None
    options: dict | None = None
    answer: dict | None = None
    keywords: list[str] | None = None
    difficulty: str | None = None
    tags: list[str] | None = None
    section: str | None = None
    category_id: str | None = None


class QuestionOut(BaseModel):
    id: str
    type: str
    stem: str
    options: dict | None = None
    answer: dict | None = None
    keywords: list[str] | None = None
    difficulty: str
    tags: list[str] | None = None
    section: str | None = None
    category_id: str | None = None
    created_by: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True