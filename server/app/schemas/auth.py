"""认证相关 Pydantic 模型"""

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserInfo"


class UserInfo(BaseModel):
    id: str
    username: str
    name: str
    role: str
    department: str | None = None
    employee_id: str | None = None
    avatar: str | None = None

    class Config:
        from_attributes = True