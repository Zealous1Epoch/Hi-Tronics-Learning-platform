"""知识节点相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel


# ── KnowledgeFile ──

class KnowledgeFileCreate(BaseModel):
    original_name: str
    obs_key: str
    file_size: int | None = None
    file_type: str


class KnowledgeFileOut(BaseModel):
    id: str
    node_id: str
    original_name: str
    obs_key: str
    file_size: int | None = None
    file_type: str
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── KnowledgeNode ──

class KnowledgeNodeCreate(BaseModel):
    title: str
    description: str | None = None
    content: str | None = None
    parent_id: str | None = None
    sort_order: int = 0
    status: str = "draft"  # draft / published，支持创建时直接发布


class KnowledgeNodeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    content: str | None = None
    parent_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    sort_order: int | None = None
    status: str | None = None


class PositionUpdate(BaseModel):
    """批量更新节点坐标"""
    positions: list[dict]  # [{ id: str, x: float, y: float }]


class KnowledgeNodeOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    content: str | None = None
    parent_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    sort_order: int
    status: str
    created_at: datetime
    updated_at: datetime
    children: list["KnowledgeNodeOut"] = []
    files: list[KnowledgeFileOut] = []

    class Config:
        from_attributes = True