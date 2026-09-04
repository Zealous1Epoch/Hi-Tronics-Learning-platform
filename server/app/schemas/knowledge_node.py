"""知识节点相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel


class KnowledgeNodeCreate(BaseModel):
    title: str
    description: str | None = None
    parent_id: str | None = None
    sort_order: int = 0


class KnowledgeNodeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    parent_id: str | None = None
    sort_order: int | None = None


class KnowledgeNodeOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    parent_id: str | None = None
    sort_order: int
    created_at: datetime
    updated_at: datetime
    children: list["KnowledgeNodeOut"] = []

    class Config:
        from_attributes = True