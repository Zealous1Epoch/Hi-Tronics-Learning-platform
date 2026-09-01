"""试题标签模型"""

import uuid
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class QuestionTag(Base):
    __tablename__ = "question_tags"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="标签名称")
    parent_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="父标签 ID"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序")