import json
import re
from datetime import date, datetime, time, timedelta

from flask import Blueprint, Response, jsonify, redirect, request, url_for
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text as sa_text

from ... import db
from ...models import *  # noqa: F401,F403 — User, Session, AppsConfig (same pattern colors uses)
from .models import (
    TimetableConfig,
    TimetableEvent,
    TimetableEventType,
    TimetableSchedule,
)

timetable_bp = Blueprint("timetable", __name__)


# ------------------------------------------------------------------
# constants / helpers
# ------------------------------------------------------------------

_tables_ready = False

PARITIES = ("all", "odd", "even")
ZOOM_LEVELS = (32, 40, 48, 60, 76)

# name, color, icon, start offset past the hour, default duration (min)
DEFAULT_TYPES = [
    ("V (Lecture)",    "#2563EB", "📘", 15, 90),
    ("U (Exercise)",   "#0D9488", "✏️", 15, 45),
    ("L (Self-study)", "#F59E0B", "🧠",  0, 60),
    ("Commute",        "#64748B", "🚆",  0, 45),
    ("Break",          "#65A30D", "☕",  0, 15),
]

# one-time rename for users who started on the old default set
_DEFAULT_RENAMES = {
    "Lecture":  ("V (Lecture)",    15, 90),
    "Exercise": ("U (Exercise)",   15, 45),
    "Learning": ("L (Self-study)",  0, 60),
}


def _require_user():
    """Returns the logged-in User, or None if the session is invalid."""
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return None
    return user


def _migrate_schema():
    """db.create_all() only creates MISSING tables — it never adds columns to
    existing ones. This adds the newer columns for installs created before
    themes / per-type scheduling / multi-day blocks existed. Idempotent,
    works on SQLite and Postgres, runs once per process."""
    insp = sa_inspect(db.engine)
    additions = {
        "timetable_configs": {
            "theme": "VARCHAR(8) DEFAULT 'dark'",
            "hour_px": "INTEGER DEFAULT 48",
        },
        "timetable_event_types": {
            "start_offset_min": "INTEGER DEFAULT 0",
            "default_duration_min": "INTEGER DEFAULT 60",
        },
        "timetable_events": {
            "days": "TEXT",
        },
    }
    backfill_days = False
    changed = False
    for table, cols in additions.items():
        if not insp.has_table(table):
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols.items():
            if name not in existing:
                db.session.execute(sa_text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                changed = True
                if table == "timetable_events" and name == "days":
                    backfill_days = True
    if backfill_days:
        # single-day rows from before multi-day existed → days = its day
        db.session.execute(sa_text(
            "UPDATE timetable_events SET days = CAST(day AS VARCHAR) "
            "WHERE days IS NULL OR days = ''"
        ))
    if changed:
        db.session.commit()


def _ensure_tables():
    global _tables_ready
    if not _tables_ready:
        db.create_all()
        _migrate_schema()
        _tables_ready = True


def _clean_int(value, lo, hi, default=None):
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _clean_str(value, limit, default=""):
    if not isinstance(value, str):
        return default
    v = value.strip()
    return v[:limit] if v else default


def _normalize_hex(value):
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", v):
        return None
    return ("#" + v.lstrip("#")).upper()


def _parse_days_input(value):
    """Client sends `days` as a list of ints (or a single int). Returns a
    sorted list of unique weekdays 0-6, or None if nothing usable was sent."""
    if value is None:
        return None
    items = value if isinstance(value, (list, tuple)) else [value]
    out = []
    for v in items:
        v = _clean_int(v, 0, 6, None)
        if v is not None and v not in out:
            out.append(v)
    return sorted(out) if out else None


def _days_of(ev):
    """Stored days of an event as a sorted list, falling back to its `day`."""
    out = []
    for part in str(ev.days or "").split(","):
        part = part.strip()
        if part.isdigit():
            v = int(part)
            if 0 <= v <= 6 and v not in out:
                out.append(v)
    if not out:
        out = [ev.day if ev.day is not None else 0]
    return sorted(out)


def _get_or_create_config(user):
    """Every user gets exactly one AppsConfig + TimetableConfig row, plus
    default event types and one starting schedule — created lazily."""
    _ensure_tables()

    apps_config = user.apps_config
    if apps_config is None:
        apps_config = AppsConfig(user_id=user.id)
        db.session.add(apps_config)
        db.session.flush()

    config = TimetableConfig.query.filter_by(apps_config_id=apps_config.id).first()
    if config is None:
        config = TimetableConfig(apps_config_id=apps_config.id)
        db.session.add(config)
        db.session.flush()

    # Append through the relationships (like colors does with
    # apps_config.colors_config = ...). Plain db.session.add() with only the
    # FK set leaves config.schedules / config.event_types empty until the
    # next request, which crashed on a user's very first visit.
    if not config.schedules:
        sched = TimetableSchedule(config_id=config.id, name="My Timetable", position=0)
        config.schedules.append(sched)
        db.session.add(sched)
        db.session.flush()
        config.active_schedule_id = sched.id

    if not config.event_types:
        for pos, (name, color, icon, offset, dur) in enumerate(DEFAULT_TYPES):
            etype = TimetableEventType(
                config_id=config.id, name=name, color=color, icon=icon,
                position=pos, start_offset_min=offset, default_duration_min=dur,
            )
            config.event_types.append(etype)
            db.session.add(etype)
        db.session.flush()

    # one-time migration of the old default type names to V/U/L
    for t in config.event_types:
        new = _DEFAULT_RENAMES.get(t.name)
        if new:
            t.name, t.start_offset_min, t.default_duration_min = new

    # make sure the active schedule always points at something valid
    ids = [s.id for s in config.schedules]
    if config.active_schedule_id not in ids:
        config.active_schedule_id = ids[0] if ids else None

    return config


def _get_schedule(config, sid):
    if sid is None:
        return None
    try:
        sid = int(sid)
    except (TypeError, ValueError):
        return None
    return TimetableSchedule.query.filter_by(id=sid, config_id=config.id).first()


def _get_event(config, eid):
    try:
        eid = int(eid)
    except (TypeError, ValueError):
        return None
    ev = TimetableEvent.query.filter_by(id=eid).first()
    if ev is not None and ev.schedule.config_id == config.id:
        return ev
    return None


def _event_to_dict(ev):
    return {
        "id": ev.id,
        "scheduleId": ev.schedule_id,
        "typeId": ev.type_id,
        "title": ev.title,
        "day": ev.day,
        "days": _days_of(ev),
        "start": ev.start_min,
        "end": ev.end_min,
        "room": ev.room or "",
        "teacher": ev.teacher or "",
        "note": ev.note or "",
        "parity": ev.parity or "all",
    }


def _state(config):
    # Read via explicit queries instead of lazy relationship collections:
    # rows created earlier in this same request are guaranteed to be
    # included, regardless of the session's expire_on_commit setting.
    schedules = (TimetableSchedule.query
                 .filter_by(config_id=config.id)
                 .order_by(TimetableSchedule.position, TimetableSchedule.id)
                 .all())
    types = (TimetableEventType.query
             .filter_by(config_id=config.id)
             .order_by(TimetableEventType.position, TimetableEventType.id)
             .all())
    events = (TimetableEvent.query
              .join(TimetableSchedule, TimetableEvent.schedule_id == TimetableSchedule.id)
              .filter(TimetableSchedule.config_id == config.id)
              .all())

    return {
        "settings": {
            "dayStart": config.day_start,
            "dayEnd": config.day_end,
            "showSaturday": bool(config.show_saturday),
            "showSunday": bool(config.show_sunday),
            "activeScheduleId": config.active_schedule_id,
            "theme": config.theme or "dark",
            "hourPx": config.hour_px or 48,
        },
        "schedules": [
            {"id": s.id, "name": s.name, "position": s.position or 0} for s in schedules
        ],
        "eventTypes": [
            {"id": t.id, "name": t.name, "color": t.color, "icon": t.icon or "",
             "position": t.position or 0,
             "startOffset": t.start_offset_min or 0,
             "duration": t.default_duration_min or 60}
            for t in types
        ],
        "events": [_event_to_dict(e) for e in events],
    }


# ------------------------------------------------------------------
# state / settings
# ------------------------------------------------------------------

@timetable_bp.route("/api/state", methods=["GET"])
def api_state():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    db.session.commit()
    return jsonify(_state(config))


@timetable_bp.route("/settings/save", methods=["POST"])
def settings_save():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "No data provided"}), 400

    # every field is optional — missing keys keep their current value,
    # so the theme toggle can POST {"theme": "light"} on its own.
    ds = _clean_int(data.get("dayStart"), 0, 1440, config.day_start)
    de = _clean_int(data.get("dayEnd"), 0, 1440, config.day_end)
    if de <= ds:
        de = min(1440, ds + 60)
    if de - ds < 60:
        ds = max(0, de - 60)
    config.day_start, config.day_end = ds, de

    config.show_saturday = bool(data.get("showSaturday", config.show_saturday))
    config.show_sunday = bool(data.get("showSunday", config.show_sunday))

    theme = data.get("theme", config.theme or "dark")
    config.theme = theme if theme in ("dark", "light") else "dark"
    config.hour_px = _clean_int(data.get("hourPx"), 24, 120, config.hour_px or 48)

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


# ------------------------------------------------------------------
# schedules
# ------------------------------------------------------------------

@timetable_bp.route("/schedules/create", methods=["POST"])
def schedule_create():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)

    name = _clean_str(data.get("name"), 120, "New timetable")
    pos = max([s.position or 0 for s in config.schedules], default=-1) + 1
    sched = TimetableSchedule(config_id=config.id, name=name, position=pos)
    config.schedules.append(sched)
    db.session.add(sched)
    db.session.flush()

    config.active_schedule_id = sched.id
    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/rename", methods=["POST"])
def schedule_rename():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    sched = _get_schedule(config, data.get("id"))
    if sched is None:
        return jsonify({"error": "Schedule not found"}), 404

    sched.name = _clean_str(data.get("name"), 120, sched.name)
    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/activate", methods=["POST"])
def schedule_activate():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    sched = _get_schedule(config, data.get("id"))
    if sched is None:
        return jsonify({"error": "Schedule not found"}), 404

    config.active_schedule_id = sched.id
    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/duplicate", methods=["POST"])
def schedule_duplicate():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    src = _get_schedule(config, data.get("id"))
    if src is None:
        return jsonify({"error": "Schedule not found"}), 404

    pos = max([s.position or 0 for s in config.schedules], default=-1) + 1
    copy = TimetableSchedule(
        config_id=config.id, name=("{} (copy)".format(src.name))[:120], position=pos
    )
    config.schedules.append(copy)
    db.session.add(copy)
    db.session.flush()

    for e in src.events:
        db.session.add(TimetableEvent(
            schedule_id=copy.id, type_id=e.type_id, title=e.title,
            day=e.day, days=e.days,
            start_min=e.start_min, end_min=e.end_min,
            room=e.room, teacher=e.teacher, note=e.note, parity=e.parity,
        ))

    config.active_schedule_id = copy.id
    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/delete", methods=["POST"])
def schedule_delete():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    sched = _get_schedule(config, data.get("id"))
    if sched is None:
        return jsonify({"error": "Schedule not found"}), 404

    if len(config.schedules) <= 1:
        return jsonify({
            "error": "You need at least one schedule — clear its blocks instead."
        }), 400

    remaining = [s for s in config.schedules if s.id != sched.id]
    remaining.sort(key=lambda s: (s.position or 0, s.id))

    db.session.delete(sched)  # cascades to its events
    if config.active_schedule_id == sched.id:
        config.active_schedule_id = remaining[0].id

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/copy-from", methods=["POST"])
def schedules_copy_from():
    """Append every block of another one of the user's schedules into a
    target schedule — handy for building semester variants."""
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    src = _get_schedule(config, data.get("sourceId"))
    dst = _get_schedule(config, data.get("targetId", config.active_schedule_id))
    if src is None or dst is None:
        return jsonify({"error": "Schedule not found"}), 404
    if src.id == dst.id:
        return jsonify({"error": "Pick a different source timetable"}), 400

    count = 0
    for e in src.events:
        db.session.add(TimetableEvent(
            schedule_id=dst.id, type_id=e.type_id, title=e.title,
            day=e.day, days=e.days,
            start_min=e.start_min, end_min=e.end_min,
            room=e.room, teacher=e.teacher, note=e.note, parity=e.parity,
        ))
        count += 1

    db.session.commit()
    return jsonify({"status": "ok", "copied": count, "state": _state(config)})


@timetable_bp.route("/schedules/import-json", methods=["POST"])
def schedules_import_json():
    """Restore a JSON backup: matching types are merged by name, every
    schedule in the file becomes a new schedule and is set active."""
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "No JSON payload — send the contents of a JSON backup"}), 400

    schedules_in = data.get("schedules")
    events_in = data.get("events") or []
    types_in = data.get("eventTypes") or []
    if not isinstance(schedules_in, list) or not schedules_in:
        return jsonify({"error": "Backup contains no schedules"}), 400

    config = _get_or_create_config(user)

    # merge types by name; remap the file's type ids onto ours
    by_name = {t.name: t for t in config.event_types}
    type_map = {}
    for t in types_in:
        if not isinstance(t, dict):
            continue
        name = _clean_str(t.get("name"), 60)
        if not name:
            continue
        target = by_name.get(name)
        if target is None:
            target = TimetableEventType(
                config_id=config.id, name=name,
                color=_normalize_hex(t.get("color")) or "#2563EB",
                icon=_clean_str(t.get("icon"), 8),
                start_offset_min=_clean_int(t.get("startOffset"), 0, 59, 0),
                default_duration_min=_clean_int(t.get("duration"), 15, 720, 60),
                position=len(by_name),
            )
            db.session.add(target)
            config.event_types.append(target)
            by_name[name] = target
        type_map[t.get("id")] = target.id
    db.session.flush()

    taken_names = {s.name for s in config.schedules}
    next_pos = max([s.position or 0 for s in config.schedules], default=-1) + 1
    imported_blocks = 0

    for s in schedules_in:
        if not isinstance(s, dict):
            continue
        name = _clean_str(s.get("name"), 120) or "Imported"
        if name in taken_names:
            name = (name + " (imported)")[:120]
        sched = TimetableSchedule(config_id=config.id, name=name, position=next_pos)
        config.schedules.append(sched)
        db.session.add(sched)
        db.session.flush()
        taken_names.add(name)
        next_pos += 1

        for e in events_in:
            if not isinstance(e, dict) or e.get("scheduleId") != s.get("id"):
                continue
            start = _clean_int(e.get("start"), 0, 1440, 480)
            end = _clean_int(e.get("end"), 0, 1440, start + 60)
            if end <= start:
                end = min(1440, start + 60)
            days = _parse_days_input(e.get("days")) \
                or _parse_days_input(e.get("day")) or [0]
            parity = e.get("parity")
            db.session.add(TimetableEvent(
                schedule_id=sched.id,
                type_id=type_map.get(e.get("typeId")),
                title=_clean_str(e.get("title"), 160, "Untitled"),
                day=days[0],
                days=",".join(str(d) for d in days),
                start_min=start, end_min=end,
                room=_clean_str(e.get("room"), 120),
                teacher=_clean_str(e.get("teacher"), 120),
                note=(e.get("note") or "")[:2000] if isinstance(e.get("note"), str) else "",
                parity=parity if parity in PARITIES else "all",
            ))
            imported_blocks += 1

        config.active_schedule_id = sched.id

    db.session.commit()
    return jsonify({"status": "ok", "blocks": imported_blocks, "state": _state(config)})


# ------------------------------------------------------------------
# event types (name + color + scheduling rules per type)
# ------------------------------------------------------------------

@timetable_bp.route("/types/save", methods=["POST"])
def types_save():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True) or {}
    items = data.get("types")
    if not isinstance(items, list):
        return jsonify({"error": "types must be a list"}), 400

    existing = {t.id: t for t in config.event_types}
    kept_ids = set()
    position = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        name = _clean_str(item.get("name"), 60)
        if not name:
            continue
        color = _normalize_hex(item.get("color")) or "#2563EB"
        icon = item.get("icon") if isinstance(item.get("icon"), str) else ""
        icon = icon.strip()[:8]
        offset = _clean_int(item.get("startOffset"), 0, 59, 0)
        duration = _clean_int(item.get("duration"), 15, 720, 60)

        tid = item.get("id")
        t = existing.get(tid) if isinstance(tid, int) else None
        if t is None:
            t = TimetableEventType(config_id=config.id)
            db.session.add(t)
        t.name = name
        t.color = color
        t.icon = icon
        t.position = position
        t.start_offset_min = offset
        t.default_duration_min = duration
        kept_ids.add(t.id)
        position += 1

    db.session.flush()

    # types the user removed → detach their events (they become "Unsorted")
    for t in list(existing.values()):
        if t.id not in kept_ids:
            TimetableEvent.query.filter_by(type_id=t.id).update({"type_id": None})
            db.session.delete(t)

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


# ------------------------------------------------------------------
# events
# ------------------------------------------------------------------

@timetable_bp.route("/events/save", methods=["POST"])
def events_save():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "No data provided"}), 400

    schedule = _get_schedule(config, data.get("scheduleId"))
    if schedule is None:
        return jsonify({"error": "Unknown schedule"}), 400

    title = _clean_str(data.get("title"), 160, "Untitled")
    start = _clean_int(data.get("start"), 0, 1440, None)
    end = _clean_int(data.get("end"), 0, 1440, None)
    if start is None or end is None:
        return jsonify({"error": "Invalid time"}), 400
    if end <= start:
        return jsonify({"error": "End must be after start"}), 400

    # days: list of weekdays; `day` still accepted for old clients
    days = _parse_days_input(data.get("days"))
    if days is None:
        single = _clean_int(data.get("day"), 0, 6, None)
        days = [single] if single is not None else None
    if not days:
        return jsonify({"error": "Pick at least one day (Mon–Sun)"}), 400

    parity = data.get("parity") or "all"
    if parity not in PARITIES:
        parity = "all"

    type_id = data.get("typeId")
    if type_id is not None:
        etype = TimetableEventType.query.filter_by(id=type_id, config_id=config.id).first()
        type_id = etype.id if etype is not None else None

    note = data.get("note") if isinstance(data.get("note"), str) else ""

    event_id = data.get("id")
    if event_id is not None:
        ev = _get_event(config, event_id)
        if ev is None:
            return jsonify({"error": "Event not found"}), 404
    else:
        ev = TimetableEvent(schedule_id=schedule.id)
        db.session.add(ev)

    ev.schedule_id = schedule.id
    ev.type_id = type_id
    ev.title = title
    ev.day = days[0]
    ev.days = ",".join(str(d) for d in days)
    ev.start_min = start
    ev.end_min = end
    ev.parity = parity
    ev.room = _clean_str(data.get("room"), 120)
    ev.teacher = _clean_str(data.get("teacher"), 120)
    ev.note = note.strip()[:2000]

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/events/delete", methods=["POST"])
def events_delete():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True) or {}
    config = _get_or_create_config(user)
    ev = _get_event(config, data.get("id"))
    if ev is None:
        return jsonify({"error": "Event not found"}), 404

    db.session.delete(ev)
    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/events/copy-day", methods=["POST"])
def events_copy_day():
    """Copy every block that touches `fromDay` to `toDay` as single-day copies."""
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True) or {}
    schedule = _get_schedule(config, data.get("scheduleId"))
    from_day = _clean_int(data.get("fromDay"), 0, 6, None)
    to_day = _clean_int(data.get("toDay"), 0, 6, None)
    if schedule is None or from_day is None or to_day is None:
        return jsonify({"error": "Invalid request"}), 400

    for e in schedule.events:
        if from_day not in _days_of(e):
            continue
        db.session.add(TimetableEvent(
            schedule_id=schedule.id, type_id=e.type_id, title=e.title,
            day=to_day, days=str(to_day),
            start_min=e.start_min, end_min=e.end_min,
            room=e.room, teacher=e.teacher, note=e.note, parity=e.parity,
        ))

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/events/clear-day", methods=["POST"])
def events_clear_day():
    """Remove one weekday: single-day blocks on it are deleted, multi-day
    blocks just drop that day and keep the rest."""
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True) or {}
    schedule = _get_schedule(config, data.get("scheduleId"))
    day = _clean_int(data.get("day"), 0, 6, None)
    if schedule is None or day is None:
        return jsonify({"error": "Invalid request"}), 400

    for e in list(schedule.events):
        ds = _days_of(e)
        if day not in ds:
            continue
        if len(ds) == 1:
            db.session.delete(e)
        else:
            ds.remove(day)
            e.days = ",".join(str(d) for d in ds)
            e.day = ds[0]

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


# ------------------------------------------------------------------
# exports
# ------------------------------------------------------------------

@timetable_bp.route("/export/json", methods=["GET"])
def export_json():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    payload = _state(config)
    payload["exportedAt"] = datetime.utcnow().isoformat()

    resp = Response(json.dumps(payload, indent=2), mimetype="application/json")
    resp.headers["Content-Disposition"] = 'attachment; filename="timetable-export.json"'
    return resp


def _slug(text):
    s = re.sub(r"[^A-Za-z0-9]+", "-", text or "").strip("-").lower()
    return s or "timetable"


def _ics_escape(text):
    return (str(text).replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n"))


def _ics_fold(line):
    """Fold long content lines the RFC-5545 way (continuation via CRLF + space)."""
    if len(line) <= 73:
        return line
    out, rest = line[:73], line[73:]
    while rest:
        out += "\r\n " + rest[:73]
        rest = rest[73:]
    return out


def _next_occurrence(day, parity, from_date):
    """First date >= from_date matching the weekday and ISO-week parity."""
    for i in range(14):
        d = from_date + timedelta(days=i)
        if d.weekday() != day:
            continue
        if parity in ("odd", "even"):
            week_odd = d.isocalendar()[1] % 2 == 1
            if (parity == "odd") != week_odd:
                continue
        return d
    return None


def _vevent_lines(e, day, first_date, stamp):
    etype = e.type
    start_dt = datetime.combine(first_date, time(0, 0)) + timedelta(minutes=e.start_min)
    end_dt = datetime.combine(first_date, time(0, 0)) + timedelta(minutes=e.end_min)
    interval = ";INTERVAL=2" if e.parity in ("odd", "even") else ""

    desc = []
    if etype is not None:
        desc.append(etype.name)
    if e.teacher:
        desc.append("Teacher: " + e.teacher)
    if e.note:
        desc.append(e.note)
    if e.parity in ("odd", "even"):
        desc.append("Occurs on %s ISO weeks" % e.parity)

    return [
        "BEGIN:VEVENT",
        "UID:timetable-%d-%d-%d@flask-app" % (e.schedule_id, e.id, day),
        "DTSTAMP:" + stamp,
        "DTSTART:" + start_dt.strftime("%Y%m%dT%H%M%S"),
        "DTEND:" + end_dt.strftime("%Y%m%dT%H%M%S"),
        "RRULE:FREQ=WEEKLY%s;COUNT=30" % interval,
        "SUMMARY:" + _ics_escape(e.title),
        "LOCATION:" + _ics_escape(e.room or ""),
        "DESCRIPTION:" + _ics_escape(" - ".join(desc)),
        "CATEGORIES:" + _ics_escape(etype.name if etype else "Unsorted"),
        "END:VEVENT",
    ]


@timetable_bp.route("/export/ics", methods=["GET"])
def export_ics():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    schedule = _get_schedule(config, request.args.get("schedule_id", type=int))
    if schedule is None:
        schedule = _get_schedule(config, config.active_schedule_id)
    if schedule is None:
        return jsonify({"error": "No schedule to export"}), 400

    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    today = date.today()
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flask Timetable//EN",
             "CALSCALE:GREGORIAN"]
    for e in sorted(schedule.events, key=lambda x: (x.day, x.start_min)):
        for d in _days_of(e):
            first = _next_occurrence(d, e.parity or "all", today)
            if first is None:
                continue
            lines.extend(_vevent_lines(e, d, first, stamp))
    lines.append("END:VCALENDAR")

    text = "\r\n".join(_ics_fold(l) for l in lines) + "\r\n"
    resp = Response(text, mimetype="text/calendar")
    resp.headers["Content-Disposition"] = 'attachment; filename="%s.ics"' % _slug(schedule.name)
    return resp