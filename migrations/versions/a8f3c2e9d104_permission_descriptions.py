"""permissions gained descriptions + longer names

Revision ID: a8f3c2e9d104
Revises: ec4a1d2f7b35
Create Date: 2026-10-25

Permission keys become dot-namespaced ("files.read") → name column is
widened, and the description moves from the hardcoded BASE_PERMISSIONS
dict into the permissions table so the console can manage it. New tables
(pending_logins, apps, app_permissions) are handled by create_all().
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a8f3c2e9d104'
down_revision = 'ec4a1d2f7b35'
branch_labels = None
depends_on = None


def _has_column(conn, table, column):
    return column in [c['name'] for c in sa.inspect(conn).get_columns(table)]


def _name_is_short(conn):
    cols = sa.inspect(conn).get_columns('permissions')
    name = [c for c in cols if c['name'] == 'name'][0]
    return (name.get('length') or 0) <= 20


def upgrade():
    conn = op.get_bind()
    with op.batch_alter_table('permissions', schema=None) as batch_op:
        if _name_is_short(conn):
            batch_op.alter_column('name', existing_type=sa.String(20),
                                  type_=sa.String(40), existing_nullable=False)
        if not _has_column(conn, 'permissions', 'description'):
            batch_op.add_column(
                sa.Column('description', sa.String(200), nullable=True)
            )


def downgrade():
    with op.batch_alter_table('permissions', schema=None) as batch_op:
        batch_op.alter_column('name', existing_type=sa.String(40),
                              type_=sa.String(20), existing_nullable=False)
        batch_op.drop_column('description')
