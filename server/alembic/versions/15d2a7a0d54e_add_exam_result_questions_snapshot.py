"""add exam_result questions snapshot

Revision ID: 15d2a7a0d54e
Revises: 
Create Date: 2026-09-08 10:36:15.201347

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = '15d2a7a0d54e'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('exam_results', sa.Column('questions', mysql.JSON(), nullable=True, comment='题目快照 [{question_id, score}]'))


def downgrade() -> None:
    op.drop_column('exam_results', 'questions')
