"""全员名册镜像模型

数据来源：招聘系统 recruitment_db.org_members（HR 提供的组织架构快照）。
本表是**纯只读镜像**：由管理端「同步全员」按钮全量替换，不参与任何业务外键，
与平台 departments / users 体系零耦合（平台账号通过工号 employee_id 软匹配）。
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class OrgMember(Base):
    """全公司员工快照（镜像招聘系统 org_members，字段保真）"""

    __tablename__ = "org_members"

    emp_id: Mapped[str] = mapped_column(
        String(32), primary_key=True, comment="工号（源 emp_id 原样）"
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False, comment="姓名")
    position: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="职位")
    dept_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="部门全路径，'>' 分隔，如 生产部>闽侯厂区>装配组"
    )
    top_dept: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True, comment="一级部门（dept_path 首段冗余）"
    )
    supervisor_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="直属上级工号（根=自环，孤儿=NULL）"
    )
    seq: Mapped[int] = mapped_column(Integer, default=0, comment="源快照排序号")
    imported_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="源快照导入时间"
    )


class OrgSyncMeta(Base):
    """同步状态（单行表，id 恒为 1）"""

    __tablename__ = "org_sync_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, comment="本库成功同步时间")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="同步后的镜像行数")
    source_imported_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="源批次时间 MAX(imported_at)，用于展示数据新鲜度"
    )
