"""代办任务 Pydantic 模型"""

from datetime import datetime, date
from pydantic import BaseModel


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    due_date: date
    sort_order: int = 0


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: date | None = None
    completed: bool | None = None
    sort_order: int | None = None


class TaskResponse(BaseModel):
    id: str
    title: str
    description: str | None
    due_date: date
    completed: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True