"""课程相关 Pydantic 模型"""

from datetime import datetime, date
from pydantic import BaseModel, model_validator


class ChapterCreate(BaseModel):
    title: str


class ChapterUpdate(BaseModel):
    title: str | None = None


class ChapterOut(BaseModel):
    id: str
    course_id: str
    title: str
    sort_order: int
    videos: list["VideoOut"] = []

    class Config:
        from_attributes = True


class ChapterReorder(BaseModel):
    chapter_ids: list[str]


class VideoCreate(BaseModel):
    title: str
    obs_key: str = ""
    file_size: int | None = None
    duration: int | None = None
    chapter_id: str | None = None


class VideoOut(BaseModel):
    id: str
    course_id: str
    chapter_id: str | None = None
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
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def check_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        return self


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def check_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        return self


class CourseOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    chapters: list[ChapterOut] = []
    videos: list[VideoOut] = []
    video_count: int = 0

    class Config:
        from_attributes = True