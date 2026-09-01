"""考试相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel, Field


class ExamCreate(BaseModel):
    course_id: str = Field(..., description="关联课程 ID")
    title: str = Field(..., description="考试名称")
    paper_type: str = Field("fixed", description="fixed / random")
    duration: int = Field(..., description="考试时长(分钟)")
    total_score: int = Field(..., description="总分")
    pass_score: int = Field(..., description="及格分")
    max_attempts: int | None = Field(None, description="最大重考次数，NULL 表示不限")
    start_time: str | None = Field(None, description="开放时间 ISO 格式")
    end_time: str | None = Field(None, description="截止时间 ISO 格式")


class ExamUpdate(BaseModel):
    title: str | None = None
    paper_type: str | None = None
    duration: int | None = None
    total_score: int | None = None
    pass_score: int | None = None
    max_attempts: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    status: str | None = None


class ExamOut(BaseModel):
    id: str
    course_id: str
    title: str
    paper_type: str
    duration: int
    total_score: int
    pass_score: int
    max_attempts: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    status: str
    created_by: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class PaperRule(BaseModel):
    """随机组卷规则"""
    type: str = Field(..., description="single_choice / multi_choice / true_false / fill_blank / essay")
    difficulty: str = Field("medium", description="easy / medium / hard")
    count: int = Field(..., description="抽题数量")
    score: int = Field(..., description="每题分值")


class PaperQuestion(BaseModel):
    """固定组卷题目"""
    question_id: str
    score: int


class PaperCreate(BaseModel):
    """组卷"""
    questions: list[PaperQuestion] | None = Field(None, description="固定组卷题目列表")
    random_rules: list[PaperRule] | None = Field(None, description="随机组卷规则")


class PaperOut(BaseModel):
    id: str
    exam_id: str
    questions: list | None = None
    random_rules: list | None = None

    class Config:
        from_attributes = True


class ExamResultOut(BaseModel):
    id: str
    exam_id: str
    user_id: str
    answers: dict
    score: int
    passed: bool
    attempt_number: int
    started_at: datetime
    submitted_at: datetime

    class Config:
        from_attributes = True