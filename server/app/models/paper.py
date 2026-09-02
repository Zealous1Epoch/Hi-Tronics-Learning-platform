"""试卷模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, func
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="试卷名称")
    category_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="题库分类ID（关联 question_categories）"
    )
    paper_type: Mapped[str] = mapped_column(
        String(20), default="fixed", nullable=False, comment="fixed / random"
    )
    mandatory_questions: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="必考题 [{question_id, score}]"
    )
    random_rules: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="随机策略 [{type, difficulty, count, score}]"
    )
    source_banks: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="随机试卷选题库范围 [category_id]"
    )
    total_score: Mapped[int] = mapped_column(Integer, default=0, comment="总分")
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False, comment="draft / published"
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="创建者"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )