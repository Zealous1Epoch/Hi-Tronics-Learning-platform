"""公告通知 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel


class NoticeCreate(BaseModel):
    title: str
    content: str
    status: str = "draft"
    is_pinned: bool = False


class NoticeUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    status: str | None = None
    is_pinned: bool | None = None


class NoticeResponse(BaseModel):
    id: str
    title: str
    content: str
    author_id: str
    status: str
    is_pinned: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NoticeAdminResponse(NoticeResponse):
    read_count: int = 0
    total_users: int = 0


class NoticeStudentResponse(BaseModel):
    id: str
    title: str
    content: str
    is_pinned: bool
    created_at: datetime
    is_read: bool

    class Config:
        from_attributes = True


class UnreadCountResponse(BaseModel):
    unread_count: int


class NoticeListResponse(BaseModel):
    notices: list
    total: int