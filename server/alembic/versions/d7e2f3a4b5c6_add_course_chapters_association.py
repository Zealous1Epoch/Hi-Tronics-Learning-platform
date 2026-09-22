"""课程-章节多对多关联表

将 Chapter.chapter_id → Course 外键（一章节属于一课程），
改为 course_chapters 关联表（课程 ↔ 章节，多对多）。
一门课可同时属于多个章节，避免同一视频重复上传。

存量数据迁移：chapters.course_id → course_chapters (course_id, chapter_id)
"""

from alembic import op
import sqlalchemy as sa

revision = "d7e2f3a4b5c6"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 建关联表（course_id + chapter_id 联合唯一索引）
    op.create_table(
        "course_chapters",
        sa.Column("course_id", sa.String(36), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chapter_id", sa.String(36), sa.ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, primary_key=True),
        sa.UniqueConstraint("course_id", "chapter_id", name="uq_course_chapter"),
        sa.Index("ix_course_chapters_course_id", "course_id"),
    )

    # 2. 迁移存量数据：chapters.course_id → course_chapters
    op.execute("""
        INSERT INTO course_chapters (course_id, chapter_id)
        SELECT course_id, id AS chapter_id FROM chapters WHERE course_id IS NOT NULL
    """)

    # 3. 删除 chapters.course_id 列（迁移后不再需要）
    op.drop_column("chapters", "course_id")


def downgrade() -> None:
    # downgrade 由下一个迁移处理，这里仅还原列
    op.add_column("chapters", sa.Column("course_id", sa.String(36), nullable=True))
    op.execute("""
        UPDATE chapters c
        INNER JOIN course_chapters cc ON cc.chapter_id = c.id
        SET c.course_id = cc.course_id
    """)
    op.drop_table("course_chapters")
