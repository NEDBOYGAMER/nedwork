from werkzeug.security import generate_password_hash, check_password_hash

from flask_app.apps.app_models import *

from . import db
import random
import string
import secrets
from datetime import datetime, timedelta, timezone


class UserGroup(db.Model):
    __tablename__ = "user_groups"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), primary_key=True)

    role = db.Column(
        db.Enum("member", "admin", "owner", name="group_role"),
        nullable=False,
        default="member"
    )

    user = db.relationship("User", back_populates="group_memberships")
    group = db.relationship("Group", back_populates="user_memberships")


class Friendship(db.Model):
    __tablename__ = "friendships"

    request_sender_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        primary_key=True
    )
    request_receiver_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        primary_key=True
    )
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=db.func.now()
    )

    status = db.Column(
        db.Enum("pending", "accepted", "rejected", name="friendship_status"),
        nullable=False,
        default="pending"
    )

    sender = db.relationship(
        "User",
        foreign_keys=[request_sender_id]
    )

    receiver = db.relationship(
        "User",
        foreign_keys=[request_receiver_id]
    )



class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(40), unique=True, nullable=False)
    email = db.Column(db.String(80), unique=True)
    password_hash = db.Column(db.String(256), nullable=False)
    key = db.Column(db.String(9), unique=True, nullable=False) # automatically generated for searching for friends and is a seperate id but more easyily sharable (while not beeing 1, 2 ...)
    encryption_key = db.Column(db.String(256))

    # Set for the bootstrapped admin account (and whenever the admin panel
    # forces a reset): the user is redirected to a change-password page
    # on their next session until they chose their own password.
    must_change_password = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="0"
    )

    group_memberships = db.relationship(
        "UserGroup",
        back_populates="user"
    )

    global_permissions = db.relationship(
        "UserPermission",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    dashboards = db.relationship(
        "Dashboard",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    tasks = db.relationship(
        "Task",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    app_corner_configs = db.relationship(
        "AppCornerConfig",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan"
    )

    settings_config = db.relationship(
        "SettingsConfig",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan"
    )

    sessions = db.relationship(
        "Session",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    apps_config = db.relationship(
        "AppsConfig",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan"
    )




    @property
    def friends(self):

        friendships = Friendship.query.filter(
            (
                (Friendship.request_sender_id == self.id) |
                (Friendship.request_receiver_id == self.id)
            )
            & (Friendship.status == "accepted")
        ).all()

        result = []

        for f in friendships:
            if f.request_sender_id == self.id:
                result.append(f.receiver)
            else:
                result.append(f.sender)

        return result

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def generate_key(self):
        while True:
            key = ''.join(secrets.choice(string.ascii_letters) for _ in range(9))

            if not User.query.filter_by(key=key).first():
                self.key = key
                return

    # ------------------------------------------------------------------
    # authorization
    #   site-wide permissions live as named strings ("core", "tierforge",
    #   ...). The site admin is NOT a user — console credentials live in
    #   AdminCredential below and grant nothing on the normal site.
    # ------------------------------------------------------------------

    def is_admin(self):
        """Users can no longer hold the (removed) admin permission; kept
        so existing JS contracts (/auth/api/who) stay stable — always False."""
        return False

    def has_permission(self, name):
        """True if the user holds `name` directly or via a group."""
        return name in self._permission_names()

    def has_any(self, names):
        """True if the user holds ANY of the given permissions.
        An empty `names` list means "no permission required" (public)."""
        if not names:
            return True
        held = self._permission_names()
        return any(n in held for n in names)

    def _permission_names(self):
        """Set of permission names held directly or via group membership."""
        names = set()
        for link in self.global_permissions:
            names.add(link.permission.name)
        for membership in self.group_memberships:
            group = membership.group
            if group is None:
                continue
            for link in group.permissions:
                names.add(link.permission.name)
        return names

    def grant_permission(self, name):
        """Attach `name` to this user, creating the Permission row if needed."""
        permission = Permission.query.filter_by(name=name).first()
        if permission is None:
            permission = Permission(name=name)
            db.session.add(permission)
            db.session.flush()

        exists = UserPermission.query.filter_by(
            user_id=self.id, permission_id=permission.id
        ).first()
        if exists is None:
            db.session.add(UserPermission(user_id=self.id, permission_id=permission.id))

    def revoke_permission(self, name):
        permission = Permission.query.filter_by(name=name).first()
        if permission is not None:
            UserPermission.query.filter_by(
                user_id=self.id, permission_id=permission.id
            ).delete()


class Dashboard(db.Model):
    __tablename__ = "dashboards"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(20), nullable=False)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
    )

    user = db.relationship("User", back_populates="dashboards")

    # List of widget objects, one per widget on the dashboard. Each entry is:
    #   {
    #     "id": "uuid", "type": "time",
    #     "settings": {...}, "style": "tech",
    #     "x": 0, "y": 0, "w": 4, "h": 2     # grid layout, 12 columns
    #   }
    # Layout is stored per-widget here so drag/resize survives a refresh.
    widgets = db.Column(db.JSON, nullable=True)# no automatic fill


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(20), unique=True, nullable=False)

    user_memberships = db.relationship(
        "UserGroup",
        back_populates="group"
    )

    permissions = db.relationship(
        "GroupPermission",
        back_populates="group",
        cascade="all, delete-orphan"
    )

    def grant_permission(self, name):
        """Attach `name` to this group, creating the Permission row if needed."""
        permission = Permission.query.filter_by(name=name).first()
        if permission is None:
            permission = Permission(name=name)
            db.session.add(permission)
            db.session.flush()

        exists = GroupPermission.query.filter_by(
            group_id=self.id, permission_id=permission.id
        ).first()
        if exists is None:
            db.session.add(GroupPermission(group_id=self.id, permission_id=permission.id))

    def revoke_permission(self, name):
        permission = Permission.query.filter_by(name=name).first()
        if permission is not None:
            GroupPermission.query.filter_by(
                group_id=self.id, permission_id=permission.id
            ).delete()

    def set_permissions(self, names):
        """Replace the group's full permission set atomically."""
        names = list(dict.fromkeys(n for n in (names or []) if n))
        for link in list(self.permissions):
            self.permissions.remove(link)
        db.session.flush()
        for name in names:
            self.grant_permission(name)



class Permission(db.Model):
    __tablename__ = "permissions"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(40), unique=True, nullable=False)
    description = db.Column(db.String(200), nullable=True)
    # "access" (default): being linked to an app makes the key REQUIRED
    #   to open that app (any-of).
    # "function": the key gates ONE feature inside an app (enforced by the
    #   endpoint's own permission_required decorator). App links on a
    #   function key are documentation only - they are filtered out of the
    #   open requirement (see permissions.required_permissions_for).
    kind = db.Column(db.String(20), nullable=False, server_default="access",
                     default="access")

    user_permissions = db.relationship(
        "UserPermission",
        back_populates="permission",
        cascade="all, delete-orphan"
    )

    group_permissions = db.relationship(
        "GroupPermission",
        back_populates="permission",
        cascade="all, delete-orphan"
    )

    app_permissions = db.relationship(
        "AppPermission",
        back_populates="permission",
        cascade="all, delete-orphan"
    )


class UserPermission(db.Model):
    __tablename__ = "user_permissions"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    permission_id = db.Column(db.Integer, db.ForeignKey("permissions.id"), primary_key=True)

    user = db.relationship("User", back_populates="global_permissions")
    permission = db.relationship("Permission", back_populates="user_permissions")


class GroupPermission(db.Model):
    __tablename__ = "group_permissions"

    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), primary_key=True)
    permission_id = db.Column(db.Integer, db.ForeignKey("permissions.id"), primary_key=True)

    group = db.relationship("Group", back_populates="permissions")
    permission = db.relationship("Permission", back_populates="group_permissions")


class Session(db.Model):

    __tablename__ = "sessions"

    session_id = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    user = db.relationship("User", back_populates="sessions")
    expires = db.Column(db.DateTime(timezone=True), nullable=False)

    def create_session_id(self):
        while True:
            session_id = secrets.token_urlsafe(32)

            if not Session.query.filter_by(session_id=session_id).first():
                self.session_id = session_id
                return

    @staticmethod
    def check(id):
        if id is None:
            return False, None

        session = Session.query.filter_by(session_id=id).first()

        if session is None:
            return False, None

        if session.is_expired():
            db.session.delete(session)
            db.session.commit()
            return False, None

        return True, session.user

    def is_expired(self):
        expires = self.expires

        if expires is None:
            return True

        # SQLite stores naive UTC datetimes even though the column is
        # declared with timezone=True - normalize both sides so the
        # comparison never mixes aware and naive values.
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if expires.tzinfo is not None and expires.utcoffset() is not None:
            expires = expires.astimezone(timezone.utc).replace(tzinfo=None)

        return expires < now

class AdminCredential(db.Model):
    """The console operator's identity — deliberately out of the users
    table. The admin is not a site member: no username, no user row, no
    permission can ever reference this account. Single fixed row (id=1)."""
    __tablename__ = "admin_credential"

    id = db.Column(db.Integer, primary_key=True)
    password_hash = db.Column(db.String, nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash or "", password)


class AdminSession(db.Model):
    """Console sessions are their own thing (separate cookie) so that
    logging out of the site never touches the console and vice versa.

    The console login is deliberately a one-time thing: the cookie is a
    browser-session cookie (nothing on disk) and the server session is a
    15-minute SLIDING idle window — AdminSession.check() pushes the
    expiry forward on every successful console request. After 15 idle
    minutes (or a browser restart) the password is asked again. A strict
    per-tab re-login is not enforceable server-side (the server cannot
    see a tab closing); this is the practical equivalent."""
    __tablename__ = "admin_sessions"

    session_id = db.Column(db.String(64), primary_key=True)
    expires = db.Column(db.DateTime(timezone=True), nullable=False)

    IDLE_MINUTES = 15

    @staticmethod
    def check(id):
        if id is None:
            return False

        session = AdminSession.query.filter_by(session_id=id).first()
        if session is None:
            return False

        if session.is_expired():
            db.session.delete(session)
            db.session.commit()
            return False

        # sliding window: any console activity keeps the session alive
        session.expires = datetime.now(timezone.utc) + timedelta(
            minutes=AdminSession.IDLE_MINUTES)
        db.session.commit()

        return True

    def is_expired(self):
        expires = self.expires

        if expires is None:
            return True

        # SQLite stores naive UTC datetimes even though the column is
        # declared with timezone=True - normalize both sides so the
        # comparison never mixes aware and naive values.
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if expires.tzinfo is not None and expires.utcoffset() is not None:
            expires = expires.astimezone(timezone.utc).replace(tzinfo=None)

        return expires < now

class PendingLogin(db.Model):
    """A registration request waiting for console approval.

    Registration no longer creates a user: the request stores the
    credentials as submitted (password hash included) so an admin can
    promote it to a real account with one click. Denying just drops
    the row.
    """
    __tablename__ = "pending_logins"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(32), unique=True, nullable=False)
    email = db.Column(db.String, default="")
    password_hash = db.Column(db.String, nullable=False)
    requested_at = db.Column(db.DateTime(timezone=True), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)


class App(db.Model):
    """The appstore catalog — moved out of data/apps.json into the DB so
    the console can manage it. `id` values are stable: app_corner stores
    recent/favorites/disabled app ids and dashboard widgets embed them.

    `url` is the permission-gated page path ("/tierforge"); tiles with
    url "/placeholder" or empty render as a non-interactive placeholder
    slot. `image` is a /static/img/<image> filename.
    """
    __tablename__ = "apps"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(40), unique=True, nullable=False)
    slug = db.Column(db.String(40), unique=True, nullable=False)
    image = db.Column(db.String, nullable=True)
    url = db.Column(db.String, nullable=True)
    # primary (legacy) type: the first entry of `types`, kept in sync for
    # consumers that only read the singular field
    type = db.Column(db.String(20), nullable=True)
    description = db.Column(db.String, nullable=True)

    permissions = db.relationship(
        "AppPermission",
        back_populates="app",
        cascade="all, delete-orphan"
    )

    types = db.relationship(
        "AppType",
        back_populates="app",
        cascade="all, delete-orphan",
        order_by="AppType.position",
    )

    def _sync_primary_type(self):
        """Keep the legacy singular `type` column equal to the first entry
        of the app_types table (the app corner reads both)."""
        self.type = self.types[0].type if self.types else None

    def set_types(self, names):
        """Replace the app's whole type list atomically (deduped, trimmed)."""
        seen = []
        for raw in names or []:
            t = (raw or "").strip()
            if t and t.lower() not in [s.lower() for s in seen]:
                seen.append(t)
        for link in list(self.types):
            self.types.remove(link)   # drop from the live collection too,
            db.session.delete(link)   # or the stale entry skews the sync below
        db.session.flush()
        for position, t in enumerate(seen):
            link = AppType(type=t[:40], position=position)
            self.types.append(link)   # via the relationship so app_id cascades
        db.session.flush()
        self._sync_primary_type()

    def to_dict(self):
        """The legacy apps.json entry shape — every existing consumer
        (appstore UI, dashboard widgets, gating) keeps the same contract."""
        return {
            "id": self.id,
            "name": self.name,
            "image": self.image or "/placeholder",
            "permissions": [link.permission.name for link in self.permissions],
            "url": self.url or "/placeholder",
            "type": self.type or "",
            "types": [link.type for link in self.types],
            "description": self.description or "",
        }


class AppType(db.Model):
    __tablename__ = "app_types"

    app_id = db.Column(db.Integer, db.ForeignKey("apps.id"), primary_key=True)
    type = db.Column(db.String(40), primary_key=True)
    position = db.Column(db.Integer, nullable=False, default=0)

    app = db.relationship("App", back_populates="types")


class AppPermission(db.Model):
    __tablename__ = "app_permissions"

    app_id = db.Column(db.Integer, db.ForeignKey("apps.id"), primary_key=True)
    permission_id = db.Column(db.Integer, db.ForeignKey("permissions.id"), primary_key=True)

    app = db.relationship("App", back_populates="permissions")
    permission = db.relationship("Permission", back_populates="app_permissions")

class SettingsConfig(db.Model):
    __tablename__ = "settings_configs"

    id = db.Column(db.Integer, primary_key=True)

    dark_mode = db.Column(db.Boolean, default=True)
    grid = db.Column(db.Boolean, default=True)

    accent_color = db.Column(db.String, default="#55778e")
    accent_color_soft = db.Column(db.String, default="rgba(52, 49, 73, 0.14)")
    accent_color_ink = db.Column(db.String, default="#FFFFFF")

    language = db.Column(db.String, default="English")

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        unique=True
    )

    user = db.relationship(
        "User",
        back_populates="settings_config",
        uselist=False
    )

    def to_dict(self):
        return {
            c.name: getattr(self, c.name)
            for c in self.__table__.columns
            if c.name not in ("id", "user_id")
        }

    def to_var(self, data):
        """Apply a settings JSON payload — but only to real settings
        columns, never to id/user_id (mass-assignment protection)."""
        if not isinstance(data, dict):
            return
        allowed = {c.name for c in self.__table__.columns} - {"id", "user_id"}
        for key, value in data.items():
            if key in allowed:
                setattr(self, key, value)

class AppCornerConfig(db.Model):
    __tablename__ = "app_corner_configs"

    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
    )

    user = db.relationship("User", back_populates="app_corner_configs")

    shelves = db.Column(db.JSON, nullable=True)
    show_recent = db.Column(db.Boolean, nullable=False, default=True)

    recent_apps = db.Column(db.JSON, nullable=True)

    favorited_apps = db.Column(db.JSON, nullable=True)
    disabled_apps = db.Column(db.JSON, nullable=True)
    disabled_shelves = db.Column(db.JSON, nullable=True)


class AppsConfig(db.Model):
    __tablename__ = "apps_configs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    user = db.relationship("User", back_populates="apps_config")

    colors_config = db.relationship(   # <-- indent this into the class
        "ColorsConfig",
        backref="apps_config",
        uselist=False,
        cascade="all, delete-orphan"
    )

    link_list = db.relationship(   # <-- indent this into the class
        "LinkList",
        backref="apps_config",
        uselist=False,
        cascade="all, delete-orphan"
    )


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(80), nullable=False)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
    )
    text = db.Column(db.Text)

    subtasks = db.Column(db.JSON) # task name, done/notdone

    tags = db.Column(db.JSON, nullable=False, default=list)


    deadline = db.Column(db.DateTime)

    private = db.Column(db.Boolean, nullable=False)
    # private then consist of:
        #name, text, subtasks, tags
        #the rest(user, deadline, done, importance, and the metadata) remains unencrypted

    done = db.Column(db.Boolean, nullable = False)

    importance = db.Column(db.String(20), nullable=False)

    created_at = db.Column(db.DateTime, nullable=False)
    last_updated_at = db.Column(db.DateTime, nullable=False)
    completed_at = db.Column(db.DateTime)

    working = db.Column(db.Boolean, nullable=False, default=False)
    recurrence = db.Column(db.String(20))      # None | "daily" | "weekly" | "monthly"
    position = db.Column(db.Integer)           # manual order in the All tab

    user = db.relationship("User", back_populates="tasks")
