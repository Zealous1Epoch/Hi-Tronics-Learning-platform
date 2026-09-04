"""公告通知模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Notice(Base):
    __tablename__ = "notices"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="公告标题")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="公告内容")
    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, comment="发布者"
    )
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False, index=True, comment="draft / published"
    )
    is_pinned: Mapped[bool] = mapped_column(default=False, comment="是否置顶")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )


class NoticeRead(Base):
    __tablename__ = "notice_reads"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    notice_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("notices.id"), nullable=False, index=True, comment="关联公告"
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, comment="学员"
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="阅读时间"
    )

    __table_args__ = (
        UniqueConstraint("notice_id", "user_id", name="uq_notice_user_read"),
    )