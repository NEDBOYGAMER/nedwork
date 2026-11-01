"""events site tables

Revision ID: e3b7a41c58d9
Revises: c7d1e4b9f205
Create Date: 2026-10-31

Tables for the Events site: events (draft/published/archived, canonical
date, invite token), event_members (role + RSVP + stale flag + needs
ride), event_modules (host-assembled module stack with JSON config),
and the relational state behind the stateful modules: doodle options +
votes, bring items + claims, ride offers + passengers, chat messages.
Plus the site-wide notifications table (Events MVP consumer).
"""
from alembic import op
import sqlalchemy as sa

revision = 'e3b7a41c58d9'
down_revision = 'c7d1e4b9f205'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    return table in sa.inspect(conn).get_table_names()


def upgrade():
    conn = op.get_bind()

    if not _has_table(conn, 'events'):
        op.create_table(
            'events',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('host_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('title', sa.String(120), nullable=False),
            sa.Column('subtitle', sa.String(200)),
            sa.Column('status', sa.String(20), nullable=False,
                      server_default='draft'),
            sa.Column('event_date', sa.DateTime()),
            sa.Column('date_source', sa.String(20),
                      server_default='manual'),
            sa.Column('invite_token', sa.String(64)),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('invite_token', name='uq_events_invite_token'),
        )

    if not _has_table(conn, 'event_members'):
        op.create_table(
            'event_members',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('event_id', sa.Integer(),
                      sa.ForeignKey('events.id'), nullable=False),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('role', sa.String(10), nullable=False,
                      server_default='member'),
            sa.Column('rsvp', sa.String(20), nullable=False,
                      server_default='pending'),
            sa.Column('rsvp_stale', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('needs_ride', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('joined_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('event_id', 'user_id',
                                name='uq_event_members_event_user'),
        )

    if not _has_table(conn, 'event_modules'):
        op.create_table(
            'event_modules',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('event_id', sa.Integer(),
                      sa.ForeignKey('events.id'), nullable=False),
            sa.Column('type', sa.String(20), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False,
                      server_default='0'),
            sa.Column('hidden', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('config', sa.JSON(), nullable=False),
        )

    if not _has_table(conn, 'doodle_options'):
        op.create_table(
            'doodle_options',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('module_id', sa.Integer(),
                      sa.ForeignKey('event_modules.id'), nullable=False),
            sa.Column('starts_at', sa.DateTime(), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False,
                      server_default='0'),
        )

    if not _has_table(conn, 'doodle_votes'):
        op.create_table(
            'doodle_votes',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('module_id', sa.Integer(),
                      sa.ForeignKey('event_modules.id'), nullable=False),
            sa.Column('option_id', sa.Integer(),
                      sa.ForeignKey('doodle_options.id'), nullable=True),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('comment', sa.String(200)),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('module_id', 'user_id', 'option_id',
                                name='uq_doodle_votes_module_user_option'),
        )

    if not _has_table(conn, 'bring_items'):
        op.create_table(
            'bring_items',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('module_id', sa.Integer(),
                      sa.ForeignKey('event_modules.id'), nullable=False),
            sa.Column('label', sa.String(120), nullable=False),
            sa.Column('target_qty', sa.Integer(), nullable=False,
                      server_default='1'),
            sa.Column('added_by', sa.Integer(),
                      sa.ForeignKey('users.id')),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )

    if not _has_table(conn, 'bring_claims'):
        op.create_table(
            'bring_claims',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('item_id', sa.Integer(),
                      sa.ForeignKey('bring_items.id'), nullable=False),
            sa.Column('member_id', sa.Integer(),
                      sa.ForeignKey('event_members.id'), nullable=False),
            sa.Column('qty', sa.Integer(), nullable=False,
                      server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('item_id', 'member_id',
                                name='uq_bring_claims_item_member'),
        )

    if not _has_table(conn, 'event_rides'):
        op.create_table(
            'event_rides',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('module_id', sa.Integer(),
                      sa.ForeignKey('event_modules.id'), nullable=False),
            sa.Column('driver_member_id', sa.Integer(),
                      sa.ForeignKey('event_members.id'), nullable=False),
            sa.Column('seats', sa.Integer(), nullable=False,
                      server_default='1'),
            sa.Column('departure', sa.String(40)),
            sa.Column('pickup_note', sa.String(200)),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )

    if not _has_table(conn, 'ride_passengers'):
        op.create_table(
            'ride_passengers',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('ride_id', sa.Integer(),
                      sa.ForeignKey('event_rides.id'), nullable=False),
            sa.Column('member_id', sa.Integer(),
                      sa.ForeignKey('event_members.id'), nullable=False),
            sa.UniqueConstraint('ride_id', 'member_id',
                                name='uq_ride_passengers_ride_member'),
        )

    if not _has_table(conn, 'chat_messages'):
        op.create_table(
            'chat_messages',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('module_id', sa.Integer(),
                      sa.ForeignKey('event_modules.id'), nullable=False),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('text', sa.String(2000), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )

    if not _has_table(conn, 'notifications'):
        op.create_table(
            'notifications',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('type', sa.String(40), nullable=False),
            sa.Column('payload', sa.JSON(), nullable=False),
            sa.Column('read', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )


def downgrade():
    conn = op.get_bind()

    for table in ('notifications', 'chat_messages', 'ride_passengers',
                  'event_rides', 'bring_claims', 'bring_items',
                  'doodle_votes', 'doodle_options', 'event_modules',
                  'event_members', 'events'):
        if _has_table(conn, table):
            op.drop_table(table)
