"""课程相关 Pydantic 模型"""

from datetime import datetime, date
from pydantic import BaseModel, model_validator


class ChapterCreate(BaseModel):
    title: str
    category_id: str | None = None  # 所属课程分类（关联分类树节点）


class ChapterAssign(BaseModel):
    chapter_ids: list[str] = []


class ChapterUpdate(BaseModel):
    title: str | None = None


class ChapterOut(BaseModel):
    id: str
    title: str
    sort_order: int
    category_id: str | None = None  # 所属课程分类（关联分类树节点）
    # 章节所属的课程 ID 列表（多对多，一章节可对应多门课）
    course_ids: list[str] = []
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


class CourseMaterialOut(BaseModel):
    id: str
    course_id: str
    original_name: str
    file_size: int | None = None
    file_type: str
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    title: str
    # 历史字段：保留以兼容老调用方，后端不再写入新值；统一改为 require_attendance
    course_type: str = "online"
    # 历史字段：保留兼容老调用方；签到要求已改由「签到场次」驱动（2026-10-19）
    require_attendance: bool = False
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    # 该课程所属的章节列表（一门课可同时属于多个章节）
    chapter_ids: list[str] = []

    @model_validator(mode="after")
    def check_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        return self


class CourseUpdate(BaseModel):
    title: str | None = None
    # 历史字段保留，PUT 时不再触发改写逻辑
    course_type: str | None = None
    # 历史字段：保留兼容；业务不再读取，签到要求由场次决定
    require_attendance: bool | None = None
    description: str | None = None
    cover_image: str | None = None
    category_id: str | None = None
    exam_id: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    # 该课程所属的章节列表（替换原有章节归属）
    chapter_ids: list[str] | None = None

    @model_validator(mode="after")
    def check_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        return self


class CourseOut(BaseModel):
    id: str
    title: str
    # 历史字段保留（响应兼容）
    course_type: str = "online"
    # 历史字段保留（响应兼容）；签到要求由该课程是否存在签到场次决定
    require_attendance: bool = False
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
    # 课程课件（PDF / PPT / HTML 等学习资料，本地 uploads/courses/）
    materials: list[CourseMaterialOut] = []
    # 该课程的签到场次数（>0 即表示该课需要签到，是签到要求的唯一判定依据）
    session_count: int = 0

    class Config:
        from_attributes = True