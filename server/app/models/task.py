"""代办任务模型"""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, Date, Boolean, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, comment="所属学员"
    )
    title: Mapped[str] = mapped_column(
        String(200), nullable=False, comment="任务标题"
    )
    description: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="任务描述"
    )
    due_date: Mapped[date] = mapped_column(
        Date, nullable=False, index=True, comment="截止日期"
    )
    completed: Mapped[bool] = mapped_column(
        Boolean, default=False, comment="是否完成"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, comment="排序"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )