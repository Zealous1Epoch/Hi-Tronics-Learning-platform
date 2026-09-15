"""add knowledge_node fields and knowledge_files table

Revision ID: fb6787f0e680
Revises: 6a0d2b6893fe
Create Date: 2026-09-15 14:42:00.166917

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fb6787f0e680'
down_revision: Union[str, None] = '6a0d2b6893fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 扩展 knowledge_nodes 表
    op.add_column('knowledge_nodes', sa.Column('content', sa.Text(), nullable=True, comment='富文本正文 HTML'))
    op.add_column('knowledge_nodes', sa.Column('position_x', sa.Float(), nullable=True, comment='画布 X 坐标'))
    op.add_column('knowledge_nodes', sa.Column('position_y', sa.Float(), nullable=True, comment='画布 Y 坐标'))
    op.add_column('knowledge_nodes', sa.Column('status', sa.String(length=20), nullable=False, server_default='published', comment='draft / published'))
    op.create_index(op.f('ix_knowledge_nodes_status'), 'knowledge_nodes', ['status'], unique=False)
    # 移除 server_default 以便 SQLAlchemy 接管默认值
    op.alter_column('knowledge_nodes', 'status', server_default=None)

    # 2. 新建 knowledge_files 表
    op.create_table(
        'knowledge_files',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('node_id', sa.String(36), nullable=False, comment='归属节点'),
        sa.Column('original_name', sa.String(500), nullable=False, comment='原始文件名'),
        sa.Column('obs_key', sa.String(500), nullable=False, comment='存储路径/文件名'),
        sa.Column('file_size', sa.Integer(), nullable=True, comment='文件大小(字节)'),
        sa.Column('file_type', sa.String(20), nullable=False, comment='文件类型'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0', comment='排序'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
        sa.ForeignKeyConstraint(['node_id'], ['knowledge_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_knowledge_files_node_id'), 'knowledge_files', ['node_id'], unique=False)


def downgrade() -> None:
    op.drop_table('knowledge_files')
    op.drop_index(op.f('ix_knowledge_nodes_status'), table_name='knowledge_nodes')
    op.drop_column('knowledge_nodes', 'status')
    op.drop_column('knowledge_nodes', 'position_y')
    op.drop_column('knowledge_nodes', 'position_x')
    op.drop_column('knowledge_nodes', 'content')