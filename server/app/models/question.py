"""试题模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
        comment="single_choice / multi_choice / true_false / fill_blank / essay",
    )
    stem: Mapped[str] = mapped_column(Text, nullable=False, comment="题干")
    options: Mapped[dict | None] = mapped_column(JSON, nullable=True, comment="选项（选择题）")
    answer: Mapped[dict] = mapped_column(JSON, nullable=False, comment="正确答案")
    keywords: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="关键词（问答题用）"
    )
    difficulty: Mapped[str] = mapped_column(
        String(10), default="medium", nullable=False, index=True, comment="easy / medium / hard"
    )
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True, comment="知识点标签")
    section: Mapped[str | None] = mapped_column(
        String(200), nullable=True, comment="关联章节"
    )
    category_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="题库分类ID"
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="创建者"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )