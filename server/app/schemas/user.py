"""用户相关 Pydantic 模型"""

from pydantic import BaseModel, Field, field_validator
from datetime import datetime


class UserOut(BaseModel):
    id: str
    username: str
    name: str
    employee_id: str | None = None
    department: str | None = None
    department_id: str | None = None
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
    password: str = Field(..., min_length=6, description="初始密码，至少 6 位")
    name: str
    employee_id: str | None = None
    department: str | None = None
    department_id: str | None = None
    role: str = "student"


class UserUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
    employee_id: str | None = None
    department: str | None = None
    department_id: str | None = None
    role: str | None = None
    password: str | None = None

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str | None) -> str | None:
        # None = 不修改密码（前端空密码输入框也会传 null）；
        # 显式空串或过短密码一律拒绝——历史上 "" 会被 hash 成合法
        # bcrypt 值，导致空密码账号可直接登录。
        if v is None:
            return v
        if v == "":
            raise ValueError("password 不能为空字符串；如需保持原密码请省略该字段")
        if len(v) < 6:
            raise ValueError("password 长度至少 6 位")
        return v


class UserUpdateStatus(BaseModel):
    status: str  # active / disabled