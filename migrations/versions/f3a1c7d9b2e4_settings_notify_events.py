"""settings notify_events column

Revision ID: f3a1c7d9b2e4
Revises: d2f4b8e6a9c1
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a1c7d9b2e4"
down_revision = "d2f4b8e6a9c1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("settings_configs") as batch:
        batch.add_column(sa.Column(
            "notify_events", sa.Boolean(),
            nullable=False, server_default=sa.true()
        ))


def downgrade():
    with op.batch_alter_table("settings_configs") as batch:
        batch.drop_column("settings_configs", "notify_events")
