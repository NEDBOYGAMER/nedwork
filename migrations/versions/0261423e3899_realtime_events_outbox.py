"""realtime events outbox

Revision ID: 0261423e3899
Revises: c3f7a2d9e6b1
Create Date: 2026-11-12 21:46:42.203312

"""
from alembic import op
import sqlalchemy as sa


revision = '0261423e3899'
down_revision = 'c3f7a2d9e6b1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    created = 'realtime_events' not in inspector.get_table_names()
    if created:
        op.create_table(
            'realtime_events',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('topic', sa.String(length=80), nullable=False),
            sa.Column('payload', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
    indexes = set()
    if not created:
        indexes = {index['name'] for index in
                   inspector.get_indexes('realtime_events')}
    if 'ix_realtime_events_user_id_id' not in indexes:
        op.create_index('ix_realtime_events_user_id_id', 'realtime_events',
                        ['user_id', 'id'], unique=False)
    if 'ix_realtime_events_created_at' not in indexes:
        op.create_index('ix_realtime_events_created_at', 'realtime_events',
                        ['created_at'], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'realtime_events' not in inspector.get_table_names():
        return
    indexes = {index['name'] for index in
               inspector.get_indexes('realtime_events')}
    if 'ix_realtime_events_created_at' in indexes:
        op.drop_index('ix_realtime_events_created_at',
                      table_name='realtime_events')
    if 'ix_realtime_events_user_id_id' in indexes:
        op.drop_index('ix_realtime_events_user_id_id',
                      table_name='realtime_events')
    op.drop_table('realtime_events')
