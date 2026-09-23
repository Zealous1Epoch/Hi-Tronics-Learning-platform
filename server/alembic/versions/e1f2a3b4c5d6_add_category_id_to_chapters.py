"""add category_id to chapters

让章节（Chapter）关联到课程分类树（question_categories）的某个节点，
章节即可挂在分类树下，编辑课程时按分类树组织分配。

Revision ID: e1f2a3b4c5d6
Revises: d7e2f3a4b5c6
"""
from alembic import op
import sqlalchemy as sa


revision = "e1f2a3b4c5d6"
down_revision = "d7e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c["name"] for c in insp.get_columns("chapters")]
    if "category_id" in cols:
        return
    op.add_column(
        "chapters",
        sa.Column("category_id", sa.String(length=36), nullable=True),
    )
    op.create_index("ix_chapters_category_id", "chapters", ["category_id"])
    op.create_foreign_key(
        "fk_chapters_category_id",
        "chapters",
        "question_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c["name"] for c in insp.get_columns("chapters")]
    if "category_id" not in cols:
        return
    op.drop_constraint("fk_chapters_category_id", "chapters", type_="foreignkey")
    op.drop_index("ix_chapters_category_id", table_name="chapters")
    op.drop_column("chapters", "category_id")
