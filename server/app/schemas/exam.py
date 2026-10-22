"""考试相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel, Field


class ExamCreate(BaseModel):
    course_id: str = Field(..., description="关联课程 ID")
    title: str = Field(..., description="考试名称")
    paper_type: str = Field("fixed", description="fixed / random")
    paper_id: str | None = Field(None, description="关联试卷 ID（papers 表）")
    duration: int = Field(..., description="考试时长(分钟)")
    total_score: int = Field(..., description="总分")
    pass_score: int = Field(..., description="及格分")
    max_attempts: int | None = Field(None, description="最大重考次数，NULL 表示不限")
    start_time: str | None = Field(None, description="开放时间 ISO 格式")
    end_time: str | None = Field(None, description="截止时间 ISO 格式")
    status: str = Field("published", description="draft / published / ended")


class ExamUpdate(BaseModel):
    title: str | None = None
    paper_type: str | None = None
    paper_id: str | None = None
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
    paper_id: str | None = None
    duration: int
    total_score: int
    pass_score: int
    max_attempts: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    status: str
    created_by: str | None = None
    created_at: datetime
    # 仅列表接口返回（聚合统计），单查/创建响应为 None
    assigned_count: int | None = Field(None, description="应考人数（所属课程已分配学员数，仅列表接口）")
    submitted_user_count: int | None = Field(None, description="已交卷人数（去重，仅列表接口）")

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
    source_banks: list | None = None

    class Config:
        from_attributes = True


# ========== 一键建考（quick-create） ==========

class QuickQuestion(BaseModel):
    """固定组卷选题：score=0/None 表示未设分值，由服务端按总分平摊"""
    question_id: str
    score: int | None = Field(None, ge=0)


class QuickCreateContent(BaseModel):
    """考试内容来源：bank=直接从题库选题/配规则；paper=复用已有试卷"""
    source: str = Field("bank", description="bank / paper")
    paper_id: str | None = Field(None, description="source=paper 时必填")
    paper_type: str = Field("fixed", description="fixed / random（source=bank 时生效）")
    questions: list[QuickQuestion] | None = None
    random_rules: list[PaperRule] | None = None
    source_banks: list[str] | None = Field(None, description="随机抽题的题库分类范围（可含父级，服务端展开全部后代）")
    category_id: str | None = Field(None, description="选题所在分类（save_paper_as 时作为试卷分类）")


class ExamQuickCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_id: str
    content: QuickCreateContent
    duration: int = Field(60, ge=1, description="考试时长(分钟)")
    total_score: int | None = Field(None, ge=1, description="留空自动计算；固定组卷未设分值时作为平摊目标")
    pass_score: int | None = Field(None, ge=0, description="留空默认总分×60%")
    max_attempts: int | None = Field(None, ge=1)
    start_time: str | None = None
    end_time: str | None = None
    publish: bool = Field(True, description="true=创建即发布；false=存草稿")
    save_paper_as: str | None = Field(None, max_length=200, description="传入则顺手把本次选题存为可复用试卷")
    assign_user_ids: list[str] | None = Field(None, description="建考同时把这些学员分配到课程（幂等，已分配的跳过）")


class ExamQuickCreateOut(ExamOut):
    replaced_exam_title: str | None = Field(None, description="课程原绑定的考试被自动置为已结束时返回其名称")
    saved_paper_id: str | None = None
    assigned_new: int = Field(0, description="本次同步新分配到课程的学员数（已分配的不计）")


class PreviewDrawRequest(BaseModel):
    random_rules: list[PaperRule]
    source_banks: list[str] | None = None


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