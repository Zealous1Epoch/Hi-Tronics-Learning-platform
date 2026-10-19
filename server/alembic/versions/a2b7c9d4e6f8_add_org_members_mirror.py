"""add org_members mirror tables

全公司人员名册镜像（源：招聘系统 recruitment_db.org_members）：
- org_members     全员快照，管理端「同步全员」全量替换，无外键
- org_sync_meta   单行同步状态表

Revision ID: a2b7c9d4e6f8
Revises: e1f2a3b4c5d6
"""
from alembic import op
import sqlalchemy as sa


revision = "a2b7c9d4e6f8"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "org_members" not in tables:
        op.create_table(
            "org_members",
            sa.Column("emp_id", sa.String(length=32), nullable=False, comment="工号（源 emp_id 原样）"),
            sa.Column("name", sa.String(length=50), nullable=False, comment="姓名"),
            sa.Column("position", sa.String(length=100), nullable=True, comment="职位"),
            sa.Column("dept_path", sa.String(length=500), nullable=True, comment="部门全路径，'>' 分隔"),
            sa.Column("top_dept", sa.String(length=100), nullable=True, comment="一级部门（dept_path 首段冗余）"),
            sa.Column("supervisor_id", sa.String(length=32), nullable=True, comment="直属上级工号"),
            sa.Column("seq", sa.Integer(), nullable=False, comment="源快照排序号"),
            sa.Column("imported_at", sa.DateTime(), nullable=True, comment="源快照导入时间"),
            sa.PrimaryKeyConstraint("emp_id"),
        )
        op.create_index("ix_org_members_top_dept", "org_members", ["top_dept"])
    if "org_sync_meta" not in tables:
        op.create_table(
            "org_sync_meta",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("synced_at", sa.DateTime(), nullable=False, comment="本库成功同步时间"),
            sa.Column("row_count", sa.Integer(), nullable=False, comment="同步后的镜像行数"),
            sa.Column("source_imported_at", sa.DateTime(), nullable=True, comment="源批次时间"),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "org_sync_meta" in tables:
        op.drop_table("org_sync_meta")
    if "org_members" in tables:
        op.drop_index("ix_org_members_top_dept", table_name="org_members")
        op.drop_table("org_members")
