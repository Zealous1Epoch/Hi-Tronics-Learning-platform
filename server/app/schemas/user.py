"""用户相关 Pydantic 模型"""

from pydantic import BaseModel
from datetime import datetime


class UserOut(BaseModel):
    id: str
    username: str
    name: str
    employee_id: str | None = None
    department: str | None = None
    role: str
    wechat_user_id: str | None = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdateRole(BaseModel):
    role: str  # student / admin


class UserCreate(BaseModel):
    username: str
    password: str
    name: str
    employee_id: str | None = None
    department: str | None = None
    role: str = "student"


class UserUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
    employee_id: str | None = None
    department: str | None = None
    role: str | None = None
    password: str | None = None