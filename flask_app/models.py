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

    notify_events = db.Column(
        db.Boolean, nullable=False, default=True, server_default="1"
    )

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


# ── Events site ────────────────────────────────────────────────────────
# Small closed groups coordinate one gathering per event. The host owns
# the structure (module set, config, publish state), members fill the
# content (votes, claims, rides, chat). Claims/seats FK to EventMember so
# a member leaving auto-releases them; votes/chat FK to users so they
# survive a leave and show as "left".

EVENT_MODULE_TYPES = ("notes", "image", "location", "members",
                      "doodle", "bring", "rides", "chat", "announcement")

# modules that hold per-event state — only one instance per event allowed
EVENT_SINGLETON_MODULES = ("notes", "image", "location", "members",
                           "doodle", "bring", "rides", "chat",
                           "announcement")


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)

    host_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)
    title = db.Column(db.String(120), nullable=False)
    subtitle = db.Column(db.String(200))

    status = db.Column(db.String(20), nullable=False, default="draft")
    # "draft" | "published" | "archived" — archived events are invisible
    # to members (host-only); there is no hard delete in the MVP.

    event_date = db.Column(db.DateTime)     # canonical; None until set
    date_source = db.Column(db.String(20), default="manual")
    # "manual" (host set it) | "doodle" (set by finalization)

    invite_token = db.Column(db.String(64), unique=True)
    # lazy: generated when the host first requests an invite link

    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())
    updated_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now(), onupdate=db.func.now())

    host = db.relationship("User", foreign_keys=[host_id])
    members = db.relationship("EventMember", back_populates="event",
                              cascade="all, delete-orphan",
                              order_by="EventMember.id")
    modules = db.relationship("EventModule", back_populates="event",
                              cascade="all, delete-orphan",
                              order_by="EventModule.position")


class EventMember(db.Model):
    __tablename__ = "event_members"
    __table_args__ = (db.UniqueConstraint("event_id", "user_id"),)

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id"),
                         nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)

    role = db.Column(db.String(10), nullable=False, default="member")
    # "host" | "member" — exactly one host per event

    rsvp = db.Column(db.String(20), nullable=False, default="pending")
    # "attending" | "maybe" | "cant" | "pending"
    rsvp_stale = db.Column(db.Boolean, nullable=False, default=False)
    # set when the canonical date changes/finalizes → prompt re-confirm
    needs_ride = db.Column(db.Boolean, nullable=False, default=False)

    joined_at = db.Column(db.DateTime, nullable=False,
                          default=db.func.now())

    event = db.relationship("Event", back_populates="members")
    user = db.relationship("User", foreign_keys=[user_id])

    claims = db.relationship("BringClaim", back_populates="member",
                             cascade="all, delete-orphan")
    passengers = db.relationship("RidePassenger", back_populates="member",
                                 cascade="all, delete-orphan")


class EventModule(db.Model):
    __tablename__ = "event_modules"

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id"),
                         nullable=False)

    type = db.Column(db.String(20), nullable=False)
    # one of EVENT_MODULE_TYPES
    position = db.Column(db.Integer, nullable=False, default=0)
    hidden = db.Column(db.Boolean, nullable=False, default=False)
    # "hide instead of delete" — keeps data, removes from the page

    config = db.Column(db.JSON, nullable=False, default=dict)
    # content-only modules keep their data here:
    #   notes    {text, spacing}
    #   image    {url, caption}
    #   location {address, lat, lng, note}
    #   doodle   {anonymous, deadline, show_counts} — deadline as iso str

    event = db.relationship("Event", back_populates="modules")

    options = db.relationship("DoodleOption", back_populates="module",
                              cascade="all, delete-orphan",
                              order_by="DoodleOption.position")
    votes = db.relationship("DoodleVote", back_populates="module",
                            cascade="all, delete-orphan")
    items = db.relationship("BringItem", back_populates="module",
                            cascade="all, delete-orphan")
    rides = db.relationship("EventRide", back_populates="module",
                            cascade="all, delete-orphan")
    messages = db.relationship("ChatMessage", back_populates="module",
                               cascade="all, delete-orphan")


class DoodleOption(db.Model):
    __tablename__ = "doodle_options"

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("event_modules.id"),
                          nullable=False)
    starts_at = db.Column(db.DateTime, nullable=False)
    # "time" mode: one time span per option (ends_at set); "date" mode:
    # whole-day options (ends_at stays NULL).
    ends_at = db.Column(db.DateTime)
    position = db.Column(db.Integer, nullable=False, default=0)

    module = db.relationship("EventModule", back_populates="options")


class DoodleVote(db.Model):
    """Checkbox-yes votes: one row per (member-user, option) ticked.
    user_id (not member_id) so votes survive a leave — serializer marks
    them "left". The comment belongs to the "none of these work" vote."""
    __tablename__ = "doodle_votes"
    __table_args__ = (db.UniqueConstraint("module_id", "user_id",
                                          "option_id"),)

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("event_modules.id"),
                          nullable=False)
    option_id = db.Column(db.Integer, db.ForeignKey("doodle_options.id"),
                          nullable=True)
    # NULL option_id = the "none of these work" vote (comment optional)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)
    comment = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    module = db.relationship("EventModule", back_populates="votes")
    option = db.relationship("DoodleOption")
    user = db.relationship("User", foreign_keys=[user_id])


class BringItem(db.Model):
    __tablename__ = "bring_items"

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("event_modules.id"),
                          nullable=False)
    label = db.Column(db.String(120), nullable=False)
    target_qty = db.Column(db.Integer, nullable=False, default=1)
    added_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    module = db.relationship("EventModule", back_populates="items")
    claims = db.relationship("BringClaim", back_populates="item",
                             cascade="all, delete-orphan")


class BringClaim(db.Model):
    """Personal claims — FK to event_members so leaving the event
    releases them automatically (host removes member → same path)."""
    __tablename__ = "bring_claims"
    __table_args__ = (db.UniqueConstraint("item_id", "member_id"),)

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey("bring_items.id"),
                        nullable=False)
    member_id = db.Column(db.Integer, db.ForeignKey("event_members.id"),
                          nullable=False)
    qty = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    item = db.relationship("BringItem", back_populates="claims")
    member = db.relationship("EventMember", back_populates="claims")


class EventRide(db.Model):
    __tablename__ = "event_rides"

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("event_modules.id"),
                          nullable=False)
    driver_member_id = db.Column(db.Integer,
                                 db.ForeignKey("event_members.id"),
                                 nullable=False)
    # FK to the member row: when the driver leaves/is removed the ride
    # dies with them (passengers get released back to the board).
    seats = db.Column(db.Integer, nullable=False, default=1)
    departure = db.Column(db.String(40))     # free text, e.g. "18:30"
    pickup_note = db.Column(db.String(200))  # "from" — meeting point
    destination = db.Column(db.String(200))  # "to"
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    module = db.relationship("EventModule", back_populates="rides")
    driver = db.relationship("EventMember", foreign_keys=[driver_member_id])
    passengers = db.relationship("RidePassenger", back_populates="ride",
                                 cascade="all, delete-orphan")


class RidePassenger(db.Model):
    __tablename__ = "ride_passengers"
    __table_args__ = (db.UniqueConstraint("ride_id", "member_id"),)

    id = db.Column(db.Integer, primary_key=True)
    ride_id = db.Column(db.Integer, db.ForeignKey("event_rides.id"),
                        nullable=False)
    member_id = db.Column(db.Integer, db.ForeignKey("event_members.id"),
                          nullable=False)

    ride = db.relationship("EventRide", back_populates="passengers")
    member = db.relationship("EventMember", back_populates="passengers")


class ChatMessage(db.Model):
    """user_id (not member_id) so messages survive a leave."""
    __tablename__ = "chat_messages"

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("event_modules.id"),
                          nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)
    text = db.Column(db.String(2000), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    module = db.relationship("EventModule", back_populates="messages")
    user = db.relationship("User", foreign_keys=[user_id])


class Notification(db.Model):
    """Site-wide, user-targeted in-app notification (Events MVP consumer).
    payload JSON: {event_id, title, actor, ...} — read flag per user."""
    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)
    type = db.Column(db.String(40), nullable=False)
    # "event_published" | "date_finalized" | "date_changed" | "member_added"
    # | "event_reminder"
    payload = db.Column(db.JSON, nullable=False, default=dict)
    read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    user = db.relationship("User", foreign_keys=[user_id])


class SocialGroup(db.Model):
    """A social group (the Socials site) — NOT the permission-system Group
    above. Users organize friends into groups; joining happens by code or
    shareable link, admin-approved via join requests."""
    __tablename__ = "social_groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(60), nullable=False)
    description = db.Column(db.String(300))
    # 8-char code for "join by code"; also lives in the join link
    join_code = db.Column(db.String(8), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    members = db.relationship("SocialGroupMember",
                              back_populates="group",
                              cascade="all, delete-orphan")

    def admins(self):
        return [m for m in self.members if m.role in ("admin", "owner")]

    def member(self, user):
        return SocialGroupMember.query.filter_by(
            group_id=self.id, user_id=user.id).first()


class SocialGroupMember(db.Model):
    """Membership in a social group. A row with status "pending" IS the
    open join request (the requester inserted it); admins flip it to
    "active" or delete it to deny."""
    __tablename__ = "social_group_members"
    __table_args__ = (
        db.UniqueConstraint("group_id", "user_id",
                            name="uq_sgm_group_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("social_groups.id"),
                         nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                        nullable=False)
    role = db.Column(db.Enum("member", "admin", "owner",
                             name="social_group_role"),
                     nullable=False, default="member")
    status = db.Column(db.Enum("pending", "active",
                               name="social_group_member_status"),
                       nullable=False, default="pending")
    joined_at = db.Column(db.DateTime, nullable=False,
                          default=db.func.now())

    group = db.relationship("SocialGroup", back_populates="members")
    user = db.relationship("User")
