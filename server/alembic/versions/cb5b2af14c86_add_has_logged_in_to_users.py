"""add has_logged_in to users

Revision ID: cb5b2af14c86
Revises: 50f9c5a5a8c8
Create Date: 2026-09-18 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cb5b2af14c86'
down_revision: Union[str, None] = '50f9c5a5a8c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('has_logged_in', sa.Boolean(), nullable=False, server_default=sa.text("0"), comment='是否已首次登录'))


def downgrade() -> None:
    op.drop_column('users', 'has_logged_in')