from datetime import datetime

from flask_app import db


class TimetableConfig(db.Model):
    """Per-user timetable settings. One row per user, created lazily."""
    __tablename__ = "timetable_configs"

    id = db.Column(db.Integer, primary_key=True)

    # Points to apps_configs table (same pattern as colors_configs)
    apps_config_id = db.Column(db.Integer, db.ForeignKey("apps_configs.id"), nullable=False)

    # Day range shown on the grid, in minutes since midnight
    day_start = db.Column(db.Integer, nullable=False, default=420)   # 07:00
    day_end = db.Column(db.Integer, nullable=False, default=1320)    # 22:00

    show_saturday = db.Column(db.Boolean, nullable=False, default=True)
    show_sunday = db.Column(db.Boolean, nullable=False, default=True)

    # 'dark' | 'light' — default dark
    theme = db.Column(db.String(8), nullable=False, default="dark")

    # Grid zoom: pixel height of one hour (32 / 40 / 48 / 60 / 76)
    hour_px = db.Column(db.Integer, nullable=False, default=48)

    # Which schedule tab is open. Plain integer on purpose — a real FK here
    # would create a circular dependency with timetable_schedules.
    active_schedule_id = db.Column(db.Integer)

    schedules = db.relationship(
        "TimetableSchedule", backref="config", cascade="all, delete-orphan", lazy=True
    )
    event_types = db.relationship(
        "TimetableEventType", backref="config", cascade="all, delete-orphan", lazy=True
    )


class TimetableSchedule(db.Model):
    """A named week plan, e.g. 'Winter Semester', 'Week A', 'Week B'."""
    __tablename__ = "timetable_schedules"

    id = db.Column(db.Integer, primary_key=True)
    config_id = db.Column(db.Integer, db.ForeignKey("timetable_configs.id"), nullable=False)

    name = db.Column(db.String(120), nullable=False, default="My Timetable")
    position = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    events = db.relationship(
        "TimetableEvent", backref="schedule", cascade="all, delete-orphan", lazy=True
    )


class TimetableEventType(db.Model):
    """User-defined lecture types with a color, e.g. 'V (Lecture)'.

    start_offset_min     — blocks of this type snap to :MM past the hour
                           (15 -> starts at 8:15, 9:15, ...). 0 = free snapping.
    default_duration_min — length pre-filled for new blocks of this type.
    """
    __tablename__ = "timetable_event_types"

    id = db.Column(db.Integer, primary_key=True)
    config_id = db.Column(db.Integer, db.ForeignKey("timetable_configs.id"), nullable=False)

    name = db.Column(db.String(60), nullable=False)
    color = db.Column(db.String(7), nullable=False, default="#2563EB")  # '#RRGGBB'
    icon = db.Column(db.String(8), default="")                          # optional emoji
    position = db.Column(db.Integer, nullable=False, default=0)

    start_offset_min = db.Column(db.Integer, nullable=False, default=0)      # 0-59
    default_duration_min = db.Column(db.Integer, nullable=False, default=60)  # 15-720


class TimetableEvent(db.Model):
    """One weekly block: lecture, exercise, learning time, commute, break...

    A block can live on SEVERAL days at once (e.g. a commute every Mon/Wed/Fri):
    `days` holds the sorted, comma-separated list ("0,2,4"). `day` is kept in
    sync as the first day for legacy/compat purposes.
    """
    __tablename__ = "timetable_events"

    id = db.Column(db.Integer, primary_key=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey("timetable_schedules.id"), nullable=False)
    type_id = db.Column(db.Integer, db.ForeignKey("timetable_event_types.id"), nullable=True)

    title = db.Column(db.String(160), nullable=False, default="Untitled")

    day = db.Column(db.Integer, nullable=False, default=0)  # 0=Mon ... 6=Sun (first day)
    days = db.Column(db.Text, default="")                   # e.g. "0,2,4" — all days

    start_min = db.Column(db.Integer, nullable=False, default=480)  # minutes since midnight
    end_min = db.Column(db.Integer, nullable=False, default=540)

    room = db.Column(db.String(120), default="")      # for commutes: "Home → Campus"
    teacher = db.Column(db.String(120), default="")
    note = db.Column(db.Text, default="")

    parity = db.Column(db.String(8), nullable=False, default="all")  # all | odd | even (ISO weeks)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    type = db.relationship("TimetableEventType")