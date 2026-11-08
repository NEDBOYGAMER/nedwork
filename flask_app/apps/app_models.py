from werkzeug.security import generate_password_hash, check_password_hash

from flask_app import db


class ColorsConfig(db.Model):
    __tablename__ = "colors_configs"

    id = db.Column(db.Integer, primary_key=True)
    
    # Points to apps_configs table
    apps_config_id = db.Column(db.Integer, db.ForeignKey("apps_configs.id"), nullable=False)

    # Put your color settings fields here
    palette = db.Column(db.JSON)


class LinkList(db.Model):
    __tablename__ = "linklists"

    id = db.Column(db.Integer, primary_key=True)
    
    # Points to apps_configs table
    apps_config_id = db.Column(db.Integer, db.ForeignKey("apps_configs.id"), nullable=False)

    linklist = db.Column(db.JSON)


class TierForgeSession(db.Model):
    """A live TierForge multiplayer session.

    `token` is the invite-link capability (holding the link = direct join).
    `board` holds the shared state:
      catalog  -- shared image refs [{id, owner, name}] (the shared pool set)
      coop     -- {"tiers": [...], "pool": [refs]} for one-screen mode
      split    -- {user_id: {"tiers": [...], "pool_order": [image ids]}} for
                  split-screen mode (same images, per-member ranking)
    `version` bumps on every board write so pollers cheaply detect changes.
    """
    __tablename__ = "tierforge_sessions"

    id = db.Column(db.Integer, primary_key=True)
    token = db.Column(db.String(32), unique=True, nullable=False)
    host_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    mode = db.Column(db.String(8), nullable=False, default="coop")
    title = db.Column(db.String(80), nullable=False, default="")
    status = db.Column(db.String(8), nullable=False, default="open")
    version = db.Column(db.Integer, nullable=False, default=0)
    board = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())
    updated_at = db.Column(db.DateTime, nullable=False,
                           default=db.func.now())

    members = db.relationship("TierForgeSessionMember",
                              back_populates="session",
                              cascade="all, delete-orphan")


class TierForgeSessionMember(db.Model):
    """Membership in a live TierForge session.

    A row with status "pending" is reserved for the future friend-invite
    flow (host approval) — the same pending-row-as-request pattern used by
    SocialGroupMember. Invite-link joins are "active" immediately."""
    __tablename__ = "tierforge_session_members"
    __table_args__ = (
        db.UniqueConstraint("session_id", "user_id",
                            name="uq_tfsm_session_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer,
                           db.ForeignKey("tierforge_sessions.id"),
                           nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    role = db.Column(db.String(8), nullable=False, default="member")
    status = db.Column(db.String(8), nullable=False, default="active")
    joined_at = db.Column(db.DateTime, nullable=False,
                          default=db.func.now())

    session = db.relationship("TierForgeSession", back_populates="members")
    user = db.relationship("User", foreign_keys=[user_id])