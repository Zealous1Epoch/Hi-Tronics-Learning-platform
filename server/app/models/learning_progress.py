"""学习进度模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class LearningProgress(Base):
    __tablename__ = "learning_progress"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, comment="学员"
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="课程"
    )
    video_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("videos.id"), nullable=False, index=True, comment="视频章节"
    )
    watched_seconds: Mapped[int] = mapped_column(
        Integer, default=0, comment="已观看秒数"
    )
    total_seconds: Mapped[int] = mapped_column(Integer, default=0, comment="总时长")
    completed: Mapped[bool] = mapped_column(
        Boolean, default=False, index=True, comment="是否完成"
    )
    last_accessed: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="最近访问"
    )