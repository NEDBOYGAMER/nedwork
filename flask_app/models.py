from werkzeug.security import generate_password_hash, check_password_hash

from . import db


class UserGroup(db.Model):
    __tablename__ = "user_groups"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), primary_key=True)

    role = db.Column(db.String(20), nullable=False, default="member")

    user = db.relationship("User", back_populates="group_memberships")
    group = db.relationship("Group", back_populates="user_memberships")


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(40), unique=True, nullable=False)
    email = db.Column(db.String(40), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)

    group_memberships = db.relationship(
        "UserGroup",
        back_populates="user"
    )

    dashboards = db.relationship(
        "Dashboard",
        back_populates="user"
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Dashboard(db.Model):
    __tablename__ = "dashboards"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(20), unique=True, nullable=False)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
    )

    user = db.relationship("User", back_populates="dashboards")


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(20), unique=True, nullable=False)

    user_memberships = db.relationship(
        "UserGroup",
        back_populates="group"
    )