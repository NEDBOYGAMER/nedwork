"""permissions system: users.must_change_password + group_permissions

Revision ID: b41c2d8a9f01
Revises: da526f22858a
Create Date: 2026-10-24

The group_permissions table is also created by create_all(), but the
column add on the existing users table is NOT - hence this migration.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b41c2d8a9f01'
down_revision = 'da526f22858a'
branch_labels = None
depends_on = None


def _has_table(conn, name):
    return sa.inspect(conn).has_table(name)


def _has_column(conn, table, column):
    return column in [c['name'] for c in sa.inspect(conn).get_columns(table)]


def upgrade():
    conn = op.get_bind()
    # create_all() may already have created the (empty) group_permissions
    # table and/or the column before a migration run - make it idempotent
    with op.batch_alter_table('users', schema=None) as batch_op:
        if not _has_column(conn, 'users', 'must_change_password'):
            batch_op.add_column(
                sa.Column('must_change_password', sa.Boolean(),
                          nullable=False, server_default=sa.text('0'))
            )

    if not _has_table(conn, 'group_permissions'):
        op.create_table(
            'group_permissions',
            sa.Column('group_id', sa.Integer(), nullable=False),
            sa.Column('permission_id', sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(['group_id'], ['groups.id']),
            sa.ForeignKeyConstraint(['permission_id'], ['permissions.id']),
            sa.PrimaryKeyConstraint('group_id', 'permission_id'),
        )


def downgrade():
    conn = op.get_bind()
    if _has_table(conn, 'group_permissions'):
        op.drop_table('group_permissions')
    with op.batch_alter_table('users', schema=None) as batch_op:
        if _has_column(conn, 'users', 'must_change_password'):
            batch_op.drop_column('must_change_password')
