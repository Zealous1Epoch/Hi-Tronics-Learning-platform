"""知识节点模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="知识节点名称")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="描述")
    content: Mapped[str | None] = mapped_column(Text, nullable=True, comment="富文本正文 HTML")
    parent_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="父节点 ID"
    )
    position_x: Mapped[float | None] = mapped_column(
        Float, nullable=True, comment="画布 X 坐标"
    )
    position_y: Mapped[float | None] = mapped_column(
        Float, nullable=True, comment="画布 Y 坐标"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序")
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False, index=True, comment="draft / published"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )


class KnowledgeFile(Base):
    __tablename__ = "knowledge_files"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    node_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("knowledge_nodes.id"), nullable=False, index=True, comment="归属节点"
    )
    original_name: Mapped[str] = mapped_column(
        String(500), nullable=False, comment="原始文件名"
    )
    obs_key: Mapped[str] = mapped_column(
        String(500), nullable=False, comment="存储路径/文件名"
    )
    file_size: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="文件大小(字节)"
    )
    file_type: Mapped[str] = mapped_column(
        String(20), nullable=False, comment="文件类型: pdf/ppt/pptx/docx/xlsx/html/png/jpg"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )