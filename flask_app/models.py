from werkzeug.security import generate_password_hash, check_password_hash

from flask_app.apps.app_models import *

from . import db
import random
import string
import secrets
from datetime import datetime, timezone


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
            key = ''.join(random.choices(string.ascii_letters , k=9))

            if not User.query.filter_by(key=key).first():
                self.key = key
                return


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



class Permission(db.Model):
    __tablename__ = "permissions"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(20), unique=True, nullable=False)

    user_permissions = db.relationship(
        "UserPermission",
        back_populates="permission",
        cascade="all, delete-orphan"
    )


class UserPermission(db.Model):
    __tablename__ = "user_permissions"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    permission_id = db.Column(db.Integer, db.ForeignKey("permissions.id"), primary_key=True)

    user = db.relationship("User", back_populates="global_permissions")
    permission = db.relationship("Permission", back_populates="user_permissions")


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
        for key, value in data.items():
            if hasattr(self, key):
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
    show_recent = db.Column(db.Boolean, nullable=False)

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

    tags = db.Column(db.JSON, nullable = False)


    deadline = db.Column(db.DateTime)
    urgency = db.Column(db.String, nullable = False)

    private = db.Column(db.Boolean, nullable=False)

    done = db.Column(db.Boolean, nullable = False)

    importance = db.Column(db.String(20), nullable=False)

    created_at = db.Column(db.DateTime, nullable=False)
    last_updated_at = db.Column(db.DateTime, nullable=False)
    completed_at = db.Column(db.DateTime)

    user = db.relationship("User", back_populates="tasks")
