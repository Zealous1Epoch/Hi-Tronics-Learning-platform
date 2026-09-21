"""学习进度模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class LearningProgress(Base):
    """用户-视频维度的学习进度，每对 (user_id, video_id) 只应存在一条记录。

    新增 uq_progress_user_video 唯一约束：覆盖依赖应用层「先查再插」的并发漏洞
    （并发上报进度时原先会写出重复行，导致完成数被重复统计）。
    新增 ix_progress_user_course 复合索引：加速「某学员某课程全部进度」这类高频查询。
    """

    __tablename__ = "learning_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "video_id", name="uq_progress_user_video"),
        Index("ix_progress_user_course", "user_id", "course_id"),
    )

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