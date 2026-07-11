from werkzeug.security import generate_password_hash, check_password_hash

from . import db
import random
import string
import secrets

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

    sessions = db.relationship(
        "Session",
        back_populates="user",
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

    widgets = db.Column(db.JSON, nullable=True) # atm there is time, timer, weather, notes


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
        session = Session.query.filter_by(session_id=id).first()
        if session == None:
            return False, None
        else:
            return True, session.user