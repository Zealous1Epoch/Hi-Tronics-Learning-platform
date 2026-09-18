"""用户模型"""

from __future__ import annotations
import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, comment="用户名")
    password_hash: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="密码哈希（企微用户为空）"
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="姓名")
    employee_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True, comment="工号")
    department: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True, comment="部门路径（如 IT部-开发组）")
    department_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True, comment="部门 ID"
    )

    # 关联关系
    department_rel: Mapped[Optional["Department"]] = relationship(
        "Department", back_populates="users", foreign_keys=[department_id]
    )
    role: Mapped[str] = mapped_column(
        String(20), default="student", nullable=False, index=True, comment="student / admin"
    )
    wechat_user_id: Mapped[str | None] = mapped_column(
        String(100), unique=True, nullable=True, comment="企业微信 userid"
    )
    wechat_avatar: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="企微头像 URL"
    )
    status: Mapped[str] = mapped_column(
        String(20), default="active", nullable=False, index=True, comment="active / disabled"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )