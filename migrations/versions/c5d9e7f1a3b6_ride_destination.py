"""ride destination column (car-share "to" field)

Revision ID: c5d9e7f1a3b6
Revises: a4f8c21d97be
Create Date: 2026-11-01
"""
from alembic import op
import sqlalchemy as sa

revision = "c5d9e7f1a3b6"
down_revision = "a4f8c21d97be"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("event_rides") as batch:
        batch.add_column(sa.Column("destination", sa.String(length=200),
                                   nullable=True))


def downgrade():
    with op.batch_alter_table("event_rides") as batch:
        batch.drop_column("event_rides", "destination")
