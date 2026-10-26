"""permission kind + multi-type apps

Revision ID: c7d1e4b9f205
Revises: a8f3c2e9d104
Create Date: 2026-10-25

1. permissions.kind ("access" | "function"): function keys (colors_ai)
   gate a single feature instead of app access; they can be linked to an
   app purely as documentation and are filtered out of the app's open
   requirement.

2. app_types: apps can live in several app-corner shelves. Existing
   singular App.type values are copied into the link table; the
   App.type column stays as the primary type (legacy consumers).
"""
from alembic import op
import sqlalchemy as sa

revision = 'c7d1e4b9f205'
down_revision = 'a8f3c2e9d104'
branch_labels = None
depends_on = None


def _has_column(conn, table, column):
    return column in [c['name'] for c in sa.inspect(conn).get_columns(table)]


def _has_table(conn, table):
    return table in sa.inspect(conn).get_table_names()


def upgrade():
    conn = op.get_bind()

    with op.batch_alter_table('permissions', schema=None) as batch_op:
        if not _has_column(conn, 'permissions', 'kind'):
            batch_op.add_column(
                sa.Column('kind', sa.String(20), nullable=False,
                          server_default='access')
            )

    if not _has_table(conn, 'app_types'):
        op.create_table(
            'app_types',
            sa.Column('app_id', sa.Integer(),
                      sa.ForeignKey('apps.id'), primary_key=True),
            sa.Column('type', sa.String(40), primary_key=True),
        )

    # copy the legacy singular type into the link table (idempotent)
    apps = conn.execute(sa.text("SELECT id, type FROM apps")).fetchall()
    for app_id, type_name in apps:
        if type_name and str(type_name).strip():
            conn.execute(sa.text("DELETE FROM app_types WHERE app_id = :a"), {"a": app_id})
            conn.execute(
                sa.text("INSERT INTO app_types (app_id, type, position) VALUES (:a, :t, 0)"),
                {"a": app_id, "t": str(type_name).strip()},
            )


def downgrade():
    with op.batch_alter_table('permissions', schema=None) as batch_op:
        batch_op.drop_column('kind')
    op.drop_table('app_types')
