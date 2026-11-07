"""rename notes module type to description

Revision ID: b6d2e4f8a1c3
Revises: f3a1c7d9b2e4
Create Date: 2026-11-06

The free-text module was renamed "notes" → "description" in the app code
and templates (frontend + routes), but pre-rename rows kept the old
"notes" type in the DB. Those rows render as an unknown module in view
mode (no renderer for "notes") and can't be edited. This is a data-only
migration: rewrite the type so they behave like every description module
(empty → hidden in view mode; editable via the Description card; appears
once text is saved).
"""
from alembic import op
import sqlalchemy as sa

revision = 'b6d2e4f8a1c3'
down_revision = 'f3a1c7d9b2e4'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    return table in sa.inspect(conn).get_table_names()


def upgrade():
    conn = op.get_bind()
    if _has_table(conn, 'event_modules'):
        op.execute(
            "UPDATE event_modules SET type='description' WHERE type='notes'")


def downgrade():
    conn = op.get_bind()
    if _has_table(conn, 'event_modules'):
        op.execute(
            "UPDATE event_modules SET type='notes' WHERE type='description'")