"""socials site tables

Revision ID: d2f4b8e6a9c1
Revises: c5d9e7f1a3b6
Create Date: 2026-11-01

Tables for the Socials site. NOTE: these are the SOCIAL groups — the
permission system's `groups` table (pre-dating the initial migration) is
untouched. `social_groups` (name, description, join code) +
`social_group_members` (role, status — a pending row IS the open join
request). Friendship data lives in the pre-existing `friendships` table
(no migration needed for it).
"""
from alembic import op
import sqlalchemy as sa

revision = 'd2f4b8e6a9c1'
down_revision = 'c5d9e7f1a3b6'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    return table in sa.inspect(conn).get_table_names()


def upgrade():
    conn = op.get_bind()

    if not _has_table(conn, 'social_groups'):
        op.create_table(
            'social_groups',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(60), nullable=False),
            sa.Column('description', sa.String(300)),
            sa.Column('join_code', sa.String(8), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('join_code', name='uq_social_groups_join_code'),
        )

    if not _has_table(conn, 'social_group_members'):
        op.create_table(
            'social_group_members',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('group_id', sa.Integer(),
                      sa.ForeignKey('social_groups.id'), nullable=False),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('role', sa.String(10), nullable=False,
                      server_default='member'),
            sa.Column('status', sa.String(10), nullable=False,
                      server_default='pending'),
            sa.Column('joined_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('group_id', 'user_id',
                                name='uq_sgm_group_user'),
        )


def downgrade():
    conn = op.get_bind()
    if _has_table(conn, 'social_group_members'):
        op.drop_table('social_group_members')
    if _has_table(conn, 'social_groups'):
        op.drop_table('social_groups')
