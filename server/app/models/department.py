"""部门模型"""

import uuid
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="部门名称")
    parent_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="父部门 ID"
    )
    wechat_department_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="企业微信部门 ID"
    )