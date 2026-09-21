"""courses 表新增 require_attendance 字段并数据迁移

- 新增 require_attendance BOOLEAN NOT NULL DEFAULT FALSE（带索引）
- data migration：course_type='offline' 的存量课程 require_attendance=TRUE
- 保留 course_type 字段不删，作为历史兼容

Revision ID: c1a2b3d4e5f6
Revises: b8e4c1d6f732
Create Date: 2026-09-21 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = 'b8e4c1d6f732'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    return bool(conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
        ),
        {"t": table, "c": column},
    ).scalar())


def _index_exists(table: str, index: str) -> bool:
    conn = op.get_bind()
    return bool(conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
        ),
        {"t": table, "i": index},
    ).scalar())


def upgrade() -> None:
    # 1) DDL: 加字段（幂等）
    if not _column_exists("courses", "require_attendance"):
        op.add_column(
            "courses",
            sa.Column(
                "require_attendance", sa.Boolean(),
                nullable=False, server_default=sa.text("0"),
                comment="是否启用现场签到",
            ),
        )

    # 2) DDL: 加索引（幂等）
    if not _index_exists("courses", "ix_courses_require_attendance"):
        op.create_index("ix_courses_require_attendance", "courses", ["require_attendance"])

    # 3) data migration：把历史的线下课程翻转为「启用签到」
    # 注意：必须放在 DDL 之后，否则新列不存在
    op.execute("UPDATE courses SET require_attendance = TRUE WHERE course_type = 'offline'")


def downgrade() -> None:
    if _index_exists("courses", "ix_courses_require_attendance"):
        op.drop_index("ix_courses_require_attendance", table_name="courses")
    if _column_exists("courses", "require_attendance"):
        op.drop_column("courses", "require_attendance")
