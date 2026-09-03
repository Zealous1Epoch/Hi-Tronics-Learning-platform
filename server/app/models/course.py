"""课程相关模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="课程标题")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="课程简介")
    cover_image: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="封面图 URL"
    )
    category_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="关联分类"
    )
    exam_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="关联考试"
    )
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False, index=True, comment="draft / published"
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="创建者"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )


class CourseAssignment(Base):
    __tablename__ = "course_assignments"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="课程"
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="学员（与 department_id 二选一）"
    )
    department_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="部门（与 user_id 二选一）"
    )
    assigned_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="分配人"
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="分配时间"
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="关联课程"
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="章节标题")
    obs_key: Mapped[str] = mapped_column(String(500), nullable=False, comment="OBS 存储 key")
    file_size: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="文件大小(字节)"
    )
    duration: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="视频时长(秒)"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )