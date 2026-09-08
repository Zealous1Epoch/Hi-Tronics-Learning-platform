"""考试相关模型"""

import uuid
from sqlalchemy import UniqueConstraint
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="关联课程"
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="考试名称")
    paper_type: Mapped[str] = mapped_column(
        String(20), default="fixed", nullable=False, comment="fixed / random"
    )
    duration: Mapped[int] = mapped_column(Integer, nullable=False, comment="考试时长(分钟)")
    total_score: Mapped[int] = mapped_column(Integer, nullable=False, comment="总分")
    pass_score: Mapped[int] = mapped_column(Integer, nullable=False, comment="及格分")
    max_attempts: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="最大重考次数，NULL 表示不限"
    )
    start_time: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="开放时间"
    )
    end_time: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="截止时间"
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="draft",
        nullable=False,
        comment="draft / published / ended",
    )
    paper_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="关联试卷（papers 表）"
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="创建者"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )


class ExamPaper(Base):
    __tablename__ = "exam_papers"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    exam_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("exams.id"), nullable=False, index=True, comment="关联考试"
    )
    questions: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="固定组卷: [{question_id, score}]"
    )
    random_rules: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="随机组卷: [{type, difficulty, count, score}]"
    )


class ExamResult(Base):
    __tablename__ = "exam_results"
    __table_args__ = (UniqueConstraint("exam_id", "user_id", "attempt_number", name="uq_exam_result_attempt"),)

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    exam_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("exams.id"), nullable=False, index=True, comment="关联考试"
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, comment="考生"
    )
    answers: Mapped[dict] = mapped_column(JSON, nullable=False, comment="作答记录")
    questions: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="题目快照 [{question_id, score}]"
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False, comment="得分")
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, comment="是否及格")
    attempt_number: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False, comment="第几次考试"
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, comment="开始时间"
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="交卷时间"
    )