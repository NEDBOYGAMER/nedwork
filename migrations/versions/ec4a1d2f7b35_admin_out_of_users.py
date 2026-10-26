"""admin identity moved out of the users system

Revision ID: ec4a1d2f7b35
Revises: b41c2d8a9f01
Create Date: 2026-10-25

The site admin is no longer a user: the bootstrapped 'admin' row in the
users table (and its sessions / permission / group links) is deleted, as
is the 'admin' permission row — no user or group can hold it anymore.
Console access now lives in admin_credential/login (created by
ensure_admin_credential at boot; the new identity tables themselves are
handled by create_all()).
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ec4a1d2f7b35'
down_revision = 'b41c2d8a9f01'
branch_labels = None
depends_on = None

# user-owned rows that may exist for the admin account (guarded per table)
_USER_OWNED_TABLES = [
    "sessions", "user_permissions", "user_groups", "dashboards",
    "settings_configs", "app_corner_configs", "apps_configs", "tasks",
]


def _has_table(conn, name):
    return sa.inspect(conn).has_table(name)


def _delete_admin_user_rows(conn):
    ids = [r[0] for r in conn.execute(
        sa.text("SELECT id FROM users WHERE username = 'admin'"))
    ]
    for uid in ids:
        for table in _USER_OWNED_TABLES:
            if _has_table(conn, table):
                conn.execute(sa.text(
                    f"DELETE FROM {table} WHERE user_id = :i"), {"i": uid})
        conn.execute(sa.text("DELETE FROM users WHERE id = :i"), {"i": uid})
    return ids


def _delete_admin_permission(conn):
    perm_id = conn.execute(sa.text(
        "SELECT id FROM permissions WHERE name = 'admin'")).scalar()
    if perm_id is None:
        return
    for table in ("user_permissions", "group_permissions"):
        if _has_table(conn, table):
            conn.execute(sa.text(
                f"DELETE FROM {table} WHERE permission_id = :i"),
                {"i": perm_id})
    conn.execute(sa.text(
        "DELETE FROM permissions WHERE id = :i"), {"i": perm_id})


def upgrade():
    conn = op.get_bind()
    _delete_admin_user_rows(conn)
    _delete_admin_permission(conn)


def downgrade():
    # the old admin account's password is not recoverable — nothing sane
    # to restore; recreate nothing. Console credential tables are owned
    # by create_all().
    pass
