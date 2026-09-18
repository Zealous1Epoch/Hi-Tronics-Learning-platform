"""部门模型"""

from __future__ import annotations
import uuid
from typing import Optional
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="部门名称")
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True, comment="父部门 ID"
    )
    wechat_department_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="企业微信部门 ID"
    )

    # 关联关系
    parent: Mapped[Optional["Department"]] = relationship(
        "Department", back_populates="children", remote_side=[id], foreign_keys=[parent_id]
    )
    children: Mapped[list["Department"]] = relationship(
        "Department", back_populates="parent", foreign_keys=[parent_id]
    )
    users: Mapped[list["User"]] = relationship(
        "User", back_populates="department_rel", foreign_keys="User.department_id"
    )