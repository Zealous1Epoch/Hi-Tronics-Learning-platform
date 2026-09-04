"""系统操作日志模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class SystemLog(Base):
    __tablename__ = "system_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    operator: Mapped[str] = mapped_column(String(100), nullable=False, comment="操作人姓名")
    operator_id: Mapped[str] = mapped_column(String(36), nullable=True, comment="操作人用户ID")
    category: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True, comment="分类: user/exam/paper/question/course/knowledge/system"
    )
    action: Mapped[str] = mapped_column(
        String(30), nullable=False, comment="操作: create/update/delete/login/import/export"
    )
    resource_type: Mapped[str] = mapped_column(
        String(30), nullable=False, comment="资源类型: 用户/试题/试卷/考试/课程/知识"
    )
    resource_name: Mapped[str | None] = mapped_column(String(200), nullable=True, comment="资源名称")
    description: Mapped[str] = mapped_column(String(500), nullable=False, comment="可读描述")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True, comment="额外详情(JSON)")
    level: Mapped[str] = mapped_column(
        String(10), default="info", nullable=False, comment="级别: info/warning/error"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True, comment="操作时间"
    )