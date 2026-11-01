"""doodle time-mode spans: doodle_options.ends_at

Revision ID: a4f8c21d97be
Revises: e3b7a41c58d9
Create Date: 2026-10-31

Whole-day ("date" mode) options leave ends_at NULL; "time" mode slots
store one span (starts_at → ends_at) per option.
"""
from alembic import op
import sqlalchemy as sa

revision = "a4f8c21d97be"
down_revision = "e3b7a41c58d9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("doodle_options") as batch:
        batch.add_column(sa.Column("ends_at", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("doodle_options") as batch:
        batch.drop_column("ends_at")
