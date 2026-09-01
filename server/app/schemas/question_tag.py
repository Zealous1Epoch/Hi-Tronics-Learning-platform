"""试题标签相关 Pydantic 模型"""

from pydantic import BaseModel


class TagCreate(BaseModel):
    name: str
    parent_id: str | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None


class TagOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    sort_order: int
    children: list["TagOut"] = []

    class Config:
        from_attributes = True