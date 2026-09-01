"""用户模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
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
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="姓名")
    employee_id: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="工号")
    department: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="部门")
    role: Mapped[str] = mapped_column(
        String(20), default="student", nullable=False, comment="student / admin"
    )
    wechat_user_id: Mapped[str | None] = mapped_column(
        String(100), unique=True, nullable=True, comment="企业微信 userid"
    )
    wechat_avatar: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="企微头像 URL"
    )
    status: Mapped[str] = mapped_column(
        String(20), default="active", nullable=False, comment="active / disabled"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )