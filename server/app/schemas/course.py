"""课程相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    parent_id: str | None = None


class CategoryOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    sort_order: int
    children: list["CategoryOut"] = []

    class Config:
        from_attributes = True


class VideoCreate(BaseModel):
    title: str
    obs_key: str = ""
    file_size: int | None = None
    duration: int | None = None


class VideoOut(BaseModel):
    id: str
    course_id: str
    title: str
    obs_key: str
    file_size: int | None = None
    duration: int | None = None
    sort_order: int

    class Config:
        from_attributes = True


class VideoReorder(BaseModel):
    video_ids: list[str]  # 按新顺序排列的 video ID 列表


class CourseCreate(BaseModel):
    title: str
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    status: str | None = None


class CourseOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    status: str
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    videos: list[VideoOut] = []
    video_count: int = 0

    class Config:
        from_attributes = True