"""部门相关 Pydantic 模型"""

from pydantic import BaseModel


class DepartmentCreate(BaseModel):
    name: str
    parent_id: str | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None


class DepartmentOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    children: list["DepartmentOut"] = []

    class Config:
        from_attributes = True


class FlatDepartmentOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None

    class Config:
        from_attributes = True