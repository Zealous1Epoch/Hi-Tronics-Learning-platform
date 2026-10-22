"""exam_papers 表新增 source_banks 字段

一键建考（POST /api/exams/quick-create）的随机组卷可以不经过 papers 表直建考试，
此时抽题范围（题库分类 id 列表）没有落点——学员端抽题原本顺着 exam.paper_id 去
papers.source_banks 读。把范围冗余存到 exam_papers 上，抽题逻辑优先读它。

Revision ID: b4d8f0a27c31
Revises: f9a1b2c3d4e5
Create Date: 2026-10-21 14:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b4d8f0a27c31'
down_revision: Union[str, None] = 'f9a1b2c3d4e5'
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


def upgrade() -> None:
    if not _column_exists("exam_papers", "source_banks"):
        op.add_column(
            "exam_papers",
            sa.Column(
                "source_banks", sa.JSON(),
                nullable=True,
                comment="随机抽题范围的题库分类 [category_id]",
            ),
        )


def downgrade() -> None:
    if _column_exists("exam_papers", "source_banks"):
        op.drop_column("exam_papers", "source_banks")
