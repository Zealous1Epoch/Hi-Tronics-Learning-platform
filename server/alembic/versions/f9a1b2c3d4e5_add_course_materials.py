"""add course_materials

课程课件表：PDF / PPT(PPTX) / HTML 等非视频的学习文件，
文件本体存服务器本地 uploads/courses/，obs_key 为存储文件名。
FK 与模型一致（无 ondelete，删除课程由 delete_course 手工级联并清理磁盘）。

Revision ID: f9a1b2c3d4e5
Revises: a2b7c9d4e6f8
"""
from alembic import op
import sqlalchemy as sa


revision = "f9a1b2c3d4e5"
down_revision = "a2b7c9d4e6f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "course_materials" in insp.get_table_names():
        return
    op.create_table(
        'course_materials',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('course_id', sa.String(36), nullable=False, comment='关联课程'),
        sa.Column('original_name', sa.String(500), nullable=False, comment='原始文件名'),
        sa.Column('obs_key', sa.String(500), nullable=False, comment='存储文件名'),
        sa.Column('file_size', sa.Integer(), nullable=True, comment='文件大小(字节)'),
        sa.Column('file_type', sa.String(20), nullable=False, comment='扩展名（pdf/pptx/html…）'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0', comment='排序'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_course_materials_course_id'), 'course_materials', ['course_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_course_materials_course_id'), table_name='course_materials')
    op.drop_table('course_materials')
