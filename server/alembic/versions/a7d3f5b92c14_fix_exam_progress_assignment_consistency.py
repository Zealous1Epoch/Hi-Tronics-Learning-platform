"""考试/进度/分配 数据一致性修复

- exam_results.submitted_at 允许 NULL 并去掉默认值，用于可靠标识"作答中"
- learning_progress 增加 (user_id, video_id) 唯一约束 + (user_id, course_id) 复合索引
- course_assignments 增加 (course_id, user_id) / (course_id, department_id) 唯一约束

Revision ID: a7d3f5b92c14
Revises: cb5b2af14c86
Create Date: 2026-09-20 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7d3f5b92c14'
down_revision: Union[str, None] = 'cb5b2af14c86'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(table: str, index: str) -> bool:
    """检查索引是否已存在。

    本项目历史上同时存在 alembic 迁移与 `Base.metadata.create_all` 两条建表路径，
    部分索引可能已由 create_all 创建，因此这里做存在性判断以保证幂等。
    """
    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
        ),
        {"t": table, "i": index},
    ).scalar()
    return bool(row)


def _column_nullable(table: str, column: str) -> bool:
    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
        ),
        {"t": table, "c": column},
    ).scalar()
    return row == "YES"


def _create_unique_index(table: str, index: str, columns: str) -> None:
    if _index_exists(table, index):
        return
    cols = [c.strip() for c in columns.split(",")]
    conn = op.get_bind()

    # 先清理历史重复数据（保留 id 最小的一行），否则唯一索引会创建失败。
    # MySQL 唯一索引允许多个 NULL，因此只对两侧都非 NULL 的重复行去重。
    on_clause = " AND ".join(f"t1.{c} = t2.{c}" for c in cols)
    not_null = " AND ".join(f"t1.{c} IS NOT NULL AND t2.{c} IS NOT NULL" for c in cols)
    conn.execute(
        sa.text(
            f"DELETE t1 FROM {table} t1 "
            f"INNER JOIN {table} t2 ON {on_clause} AND t1.id > t2.id "
            f"WHERE {not_null}"
        )
    )

    op.create_index(index, table, cols, unique=True)


def upgrade() -> None:
    # 1) exam_results.submitted_at → 可空、无默认值
    if not _column_nullable("exam_results", "submitted_at"):
        op.alter_column(
            "exam_results",
            "submitted_at",
            existing_type=sa.DateTime(),
            nullable=True,
            server_default=None,
            existing_comment="交卷时间",
            comment="交卷时间（NULL=作答中）",
        )

    # 2) learning_progress 唯一约束 + 复合索引
    _create_unique_index("learning_progress", "uq_progress_user_video", "user_id,video_id")
    if not _index_exists("learning_progress", "ix_progress_user_course"):
        op.create_index("ix_progress_user_course", "learning_progress", ["user_id", "course_id"])

    # 3) course_assignments 唯一约束（MySQL 唯一索引允许多个 NULL，两侧互不干扰）
    _create_unique_index("course_assignments", "uq_assign_course_user", "course_id,user_id")
    _create_unique_index("course_assignments", "uq_assign_course_dept", "course_id,department_id")


def downgrade() -> None:
    for table, index in (
        ("course_assignments", "uq_assign_course_dept"),
        ("course_assignments", "uq_assign_course_user"),
        ("learning_progress", "ix_progress_user_course"),
        ("learning_progress", "uq_progress_user_video"),
    ):
        if _index_exists(table, index):
            op.drop_index(index, table_name=table)

    if _column_nullable("exam_results", "submitted_at"):
        op.alter_column(
            "exam_results",
            "submitted_at",
            existing_type=sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
            comment="交卷时间",
        )
