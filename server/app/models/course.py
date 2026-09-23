"""课程相关模型"""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, Index, UniqueConstraint, Boolean, func, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


# 多对多关联表：课程 ↔ 章节
# 一门课可同时属于多个章节，一章节也可包含多门课
# （目前产品逻辑是一课程属多章节，即同一视频可在多章节下展示）
course_chapters: Table = Table(
    "course_chapters",
    Base.metadata,
    Column("course_id", String(36), ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True),
    Column("chapter_id", String(36), ForeignKey("chapters.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_course_chapters_course_id", "course_id"),
)


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="课程标题")
    # 课程形态：online=线上（看视频 → 考试）；offline=线下（现场签到 → 考试）
    # 历史字段保留（不再写入新值）；新增「是否启用现场签到」开关以统一课程形态
    course_type: Mapped[str] = mapped_column(
        String(20), default="online", nullable=False, index=True,
        comment="online / offline（历史字段，仅保留兼容）",
    )
    # 启用现场签到的课程可选创建 attendance_sessions；进度仍按视频统计，签到作为可选项
    require_attendance: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True,
        comment="是否启用现场签到",
    )
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
    start_date: Mapped[date | None] = mapped_column(
        Date, nullable=True, comment="计划开始日期"
    )
    end_date: Mapped[date | None] = mapped_column(
        Date, nullable=True, comment="计划结束日期"
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
    # 章节归属（多对多 through course_chapters）
    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter", secondary=course_chapters, back_populates="courses"
    )


class CourseAssignment(Base):
    """课程分配记录：按学员（user_id）或按部门（department_id）二选一。

    新增唯一约束：原先依赖应用层「先查再插」，并发请求会写入重复分配行。
    MySQL 唯一索引允许多个 NULL，因此只填一侧的行不会互相冲突。
    """

    __tablename__ = "course_assignments"
    __table_args__ = (
        UniqueConstraint("course_id", "user_id", name="uq_assign_course_user"),
        UniqueConstraint("course_id", "department_id", name="uq_assign_course_dept"),
    )

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


class Chapter(Base):
    """课程章节（一章节可对应多门课程，同一视频可在多章节下展示）"""
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="章节标题")
    # 所属课程分类（关联 question_categories 节点），使章节挂在分类树下
    category_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("question_categories.id"), nullable=True, index=True,
        comment="所属课程分类（关联分类树节点）",
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    # 章节下的视频（章节 → 视频 是原有的一对多关系，不变）
    videos: Mapped[list["Video"]] = relationship(
        "Video", back_populates="chapter", lazy="selectin"
    )
    # 章节所属的课程（多对多 through course_chapters）
    courses: Mapped[list["Course"]] = relationship(
        "Course", secondary=course_chapters, back_populates="chapters"
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="关联课程"
    )
    chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id"), nullable=True, index=True, comment="关联章节"
    )
    chapter: Mapped["Chapter | None"] = relationship("Chapter", back_populates="videos")
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="视频标题")
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