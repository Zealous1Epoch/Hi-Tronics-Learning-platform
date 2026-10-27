"""exams 表新增 review_policy 字段

错题回顾时机控制：此前交卷后 review 接口无条件返回每题正确答案，
第一次没考过的学员看完错题答案后重考（固定卷同题同序）等于开卷。
新增三档策略：always（默认，交卷即可看，兼容存量考试）/
after_exhausted（重考机会用完或及格后可看）/ after_window（考试截止后可看）。

Revision ID: c7e3a91d5842
Revises: b4d8f0a27c31
Create Date: 2026-10-27 10:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c7e3a91d5842'
down_revision: Union[str, None] = 'b4d8f0a27c31'
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
    if not _column_exists("exams", "review_policy"):
        op.add_column(
            "exams",
            sa.Column(
                "review_policy", sa.String(length=20),
                server_default="always", nullable=False,
                comment="错题回顾时机: always / after_exhausted / after_window",
            ),
        )


def downgrade() -> None:
    if _column_exists("exams", "review_policy"):
        op.drop_column("exams", "review_policy")
