"""tierforge multiplayer sessions

Revision ID: c3f7a2d9e6b1
Revises: b6d2e4f8a1c3
Create Date: 2026-11-08

Live TierForge boards. `tierforge_sessions` is the capability-link session
(token = invite secret, mode coop/split, monotonic version for cheap
polling, client-authored JSON board); `tierforge_session_members` is the
per-user membership row (a "pending" status is reserved for the future
friend-invite flow, invite-link joins are active immediately).
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3f7a2d9e6b1'
down_revision = 'b6d2e4f8a1c3'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    return table in sa.inspect(conn).get_table_names()


def upgrade():
    conn = op.get_bind()

    if not _has_table(conn, 'tierforge_sessions'):
        op.create_table(
            'tierforge_sessions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('token', sa.String(32), nullable=False, unique=True),
            sa.Column('host_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('mode', sa.String(8), nullable=False,
                      server_default='coop'),
            sa.Column('title', sa.String(80), nullable=False,
                      server_default=''),
            sa.Column('status', sa.String(8), nullable=False,
                      server_default='open'),
            sa.Column('version', sa.Integer(), nullable=False,
                      server_default='0'),
            sa.Column('board', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )

    if not _has_table(conn, 'tierforge_session_members'):
        op.create_table(
            'tierforge_session_members',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('session_id', sa.Integer(),
                      sa.ForeignKey('tierforge_sessions.id'), nullable=False),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('role', sa.String(8), nullable=False,
                      server_default='member'),
            sa.Column('status', sa.String(8), nullable=False,
                      server_default='active'),
            sa.Column('joined_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('session_id', 'user_id',
                                name='uq_tfsm_session_user'),
        )


def downgrade():
    conn = op.get_bind()
    if _has_table(conn, 'tierforge_session_members'):
        op.drop_table('tierforge_session_members')
    if _has_table(conn, 'tierforge_sessions'):
        op.drop_table('tierforge_sessions')
