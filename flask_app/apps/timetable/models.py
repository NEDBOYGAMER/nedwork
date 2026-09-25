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

    # LEGACY: wake/sleep used to live here; it is now per schedule
    # (timetable_schedules.day_ranges). Kept as a fallback for old rows.
    day_ranges = db.Column(db.JSON)

    show_saturday = db.Column(db.Boolean, nullable=False, default=True)
    show_sunday = db.Column(db.Boolean, nullable=False, default=True)

    # 'dark' | 'light' — default dark
    theme = db.Column(db.String(8), nullable=False, default="dark")

    # Grid zoom: pixel height of one hour
    hour_px = db.Column(db.Integer, nullable=False, default=48)

    # LEGACY: block splitting used to be global; it is now per type
    # (timetable_event_types.split_*). Kept for the migration check only.
    split_on = db.Column(db.Boolean, nullable=False, default=True)
    split_min = db.Column(db.Integer, nullable=False, default=45)
    split_break_min = db.Column(db.Integer, nullable=False, default=15)

    # Which stat chips to show + custom stat groups:
    # {"showTypes": true, ..., "groups": [{"name": "School time", "on": true,
    #   "types": [1, 2]}, ...]}
    stat_config = db.Column(db.JSON)

    # Which schedule tab is open. Plain integer on purpose — a real FK here
    # would create a circular dependency with timetable_schedules.
    active_schedule_id = db.Column(db.Integer)

    schedules = db.relationship(
        "TimetableSchedule", backref="config", cascade="all, delete-orphan", lazy=True
    )
    event_types = db.relationship(
        "TimetableEventType", backref="config", cascade="all, delete-orphan", lazy=True
    )

    # name of a *.css file in timetable/styles/ ('default' = base only)
    style = db.Column(db.String(40), nullable=False, default="default")


class TimetableSchedule(db.Model):
    """A named week plan, e.g. 'Winter Semester', 'Week A', 'Week B'.

    Sleep times (day_ranges) and the time periods belong to the schedule —
    different timetables can have completely different rhythms."""
    __tablename__ = "timetable_schedules"

    id = db.Column(db.Integer, primary_key=True)
    config_id = db.Column(db.Integer, db.ForeignKey("timetable_configs.id"), nullable=False)

    name = db.Column(db.String(120), nullable=False, default="My Timetable")
    position = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Per-day wake/sleep for THIS schedule:
    # {"0": {"wake": 420, "sleep": 1320}, ...} (JSON keys are strings).
    # A sleep value <= wake means the sleep time is AFTER midnight on the
    # next day (wake 08:00 + sleep 01:00 = asleep 01:00–08:00). Old rows
    # always have sleep > wake, so they keep their exact meaning.
    day_ranges = db.Column(db.JSON)

    events = db.relationship(
        "TimetableEvent", backref="schedule", cascade="all, delete-orphan", lazy=True
    )
    periods = db.relationship(
        "TimetablePeriod", backref="schedule", cascade="all, delete-orphan", lazy=True
    )


class TimetableEventType(db.Model):
    """User-defined lecture types with a color, e.g. 'V (Lecture)'.

    start_offset_min     — blocks of this type snap to :MM past the hour.
    default_duration_min — length pre-filled for new blocks of this type.
    opacity              — 10-100: how strongly the type color fills blocks.
    split_on/min/break   — per-type school rhythm: long blocks are rendered
                           as repeating `split_min` periods separated by
                           `split_break_min` pauses (e.g. 45/15 for V and U).
    """
    __tablename__ = "timetable_event_types"

    id = db.Column(db.Integer, primary_key=True)
    config_id = db.Column(db.Integer, db.ForeignKey("timetable_configs.id"), nullable=False)

    name = db.Column(db.String(60), nullable=False)
    color = db.Column(db.String(7), nullable=False, default="#2563EB")  # '#RRGGBB'
    icon = db.Column(db.String(8), default="")
    position = db.Column(db.Integer, nullable=False, default=0)

    start_offset_min = db.Column(db.Integer, nullable=False, default=0)      # 0-59
    default_duration_min = db.Column(db.Integer, nullable=False, default=60)  # 15-720
    opacity = db.Column(db.Integer, nullable=False, default=100)              # 10-100

    split_on = db.Column(db.Boolean, nullable=False, default=False)
    split_min = db.Column(db.Integer, nullable=False, default=45)         # 20-120
    split_break_min = db.Column(db.Integer, nullable=False, default=15)   # 0-60


class TimetablePeriod(db.Model):
    """A recurring daily time window ('At school', 'At home', ...) that
    belongs to ONE schedule, is hatched onto the grid like the sleep shading
    and badges every block inside it with its icon.

    `days` holds per-day overrides: {"0": {"on": true, "start": 480,
    "end": 1020}, ...} — defaults come from start_min/end_min."""
    __tablename__ = "timetable_periods"

    id = db.Column(db.Integer, primary_key=True)

    # LEGACY: periods used to hang off the config; they now belong to a
    # schedule. config_id is kept for the migration backfill only.
    config_id = db.Column(db.Integer, db.ForeignKey("timetable_configs.id"), nullable=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey("timetable_schedules.id"), nullable=True)

    name = db.Column(db.String(60), nullable=False, default="Period")
    color = db.Column(db.String(7), nullable=False, default="#64748B")
    icon = db.Column(db.String(8), default="")
    opacity = db.Column(db.Integer, nullable=False, default=30)  # 0-100

    start_min = db.Column(db.Integer, nullable=False, default=480)
    end_min = db.Column(db.Integer, nullable=False, default=1020)
    days = db.Column(db.JSON)

    position = db.Column(db.Integer, nullable=False, default=0)


class TimetableEvent(db.Model):
    """One weekly block: lecture, exercise, learning time, commute, break...

    A block can live on SEVERAL days at once (`days` = "0,2,4"); `day` stays
    in sync as the first day. `color` optionally overrides the type color.
    """
    __tablename__ = "timetable_events"

    id = db.Column(db.Integer, primary_key=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey("timetable_schedules.id"), nullable=False)
    type_id = db.Column(db.Integer, db.ForeignKey("timetable_event_types.id"), nullable=True)

    title = db.Column(db.String(160), nullable=False, default="Untitled")

    day = db.Column(db.Integer, nullable=False, default=0)  # 0=Mon ... 6=Sun (first day)
    days = db.Column(db.Text, default="")                   # e.g. "0,2,4" — all days

    start_min = db.Column(db.Integer, nullable=False, default=480)
    end_min = db.Column(db.Integer, nullable=False, default=540)

    color = db.Column(db.String(7))                   # optional per-entry override
    room = db.Column(db.String(120), default="")      # for commutes: "Home → Campus"
    teacher = db.Column(db.String(120), default="")
    note = db.Column(db.Text, default="")

    # LEGACY: odd/even ISO-week parity was removed from the UI entirely;
    # the column and stored values stay so old databases keep working.
    # The app and the .ics export treat every block as weekly. New blocks
    # get the column default 'all'.
    parity = db.Column(db.String(8), nullable=False, default="all")  # all | odd | even

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    type = db.relationship("TimetableEventType")