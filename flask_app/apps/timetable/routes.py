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
    TimetablePeriod,
    TimetableSchedule,
)

timetable_bp = Blueprint("timetable", __name__)


# ------------------------------------------------------------------
# constants / helpers
# ------------------------------------------------------------------

_tables_ready = False

PARITIES = ("all", "odd", "even")

# name, color, icon, start offset past the hour, default duration, split 45/15?
DEFAULT_TYPES = [
    ("V (Lecture)",    "#2563EB", "📘", 15, 90, True),
    ("U (Exercise)",   "#0D9488", "✏️", 15, 45, True),
    ("L (Self-study)", "#F59E0B", "🧠",  0, 60, False),
    ("Commute",        "#64748B", "🚆",  0, 45, False),
    ("Break",          "#65A30D", "☕",  0, 15, False),
]

# one-time rename for users who started on the old default set
_DEFAULT_RENAMES = {
    "Lecture":  ("V (Lecture)",    15, 90, True),
    "Exercise": ("U (Exercise)",   15, 45, True),
    "Learning": ("L (Self-study)", 0, 60, False),
}


def _require_user():
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return None
    return user


def _migrate_schema():
    """db.create_all() only creates MISSING tables — never new columns. This
    adds every column introduced after the first release. Idempotent."""
    insp = sa_inspect(db.engine)
    additions = {
        "timetable_configs": {
            "theme": "VARCHAR(8) DEFAULT 'dark'",
            "hour_px": "INTEGER DEFAULT 48",
            "day_ranges": "JSON",
            "split_on": "BOOLEAN DEFAULT 1",
            "split_min": "INTEGER DEFAULT 45",
            "split_break_min": "INTEGER DEFAULT 15",
            "stat_config": "JSON",
        },
        "timetable_schedules": {
            "day_ranges": "JSON",
        },
        "timetable_event_types": {
            "start_offset_min": "INTEGER DEFAULT 0",
            "default_duration_min": "INTEGER DEFAULT 60",
            "opacity": "INTEGER DEFAULT 100",
            "split_on": "BOOLEAN DEFAULT 0",
            "split_min": "INTEGER DEFAULT 45",
            "split_break_min": "INTEGER DEFAULT 15",
        },
        "timetable_events": {
            "days": "TEXT",
            "color": "VARCHAR(7)",
        },
        "timetable_periods": {
            "schedule_id": "INTEGER",
        },
    }
    backfill_days = False
    added_type_split = False
    added_period_schedule = False
    changed = False
    for table, cols in additions.items():
        if not insp.has_table(table):
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols.items():
            if name in existing:
                continue
            db.session.execute(sa_text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
            changed = True
            if table == "timetable_events" and name == "days":
                backfill_days = True
            if table == "timetable_event_types" and name == "split_on":
                added_type_split = True
            if table == "timetable_periods" and name == "schedule_id":
                added_period_schedule = True
    if backfill_days:
        db.session.execute(sa_text(
            "UPDATE timetable_events SET days = CAST(day AS VARCHAR) "
            "WHERE days IS NULL OR days = ''"
        ))
    if added_type_split:
        # carry the old global 45/15 rhythm over to the school-ish types,
        # but only for users who actually had the global split enabled
        db.session.execute(sa_text(
            "UPDATE timetable_event_types SET split_on = 1 "
            "WHERE (name LIKE 'V (%' OR name LIKE 'U (%') "
            "AND EXISTS (SELECT 1 FROM timetable_configs c "
            "WHERE c.id = timetable_event_types.config_id AND c.split_on = 1)"
        ))
    if added_period_schedule:
        # periods belonged to the config — attach them to that config's
        # active schedule (fallback: its first schedule)
        db.session.execute(sa_text(
            "UPDATE timetable_periods SET schedule_id = COALESCE("
            "(SELECT active_schedule_id FROM timetable_configs "
            " WHERE timetable_configs.id = timetable_periods.config_id),"
            "(SELECT MIN(id) FROM timetable_schedules "
            " WHERE timetable_schedules.config_id = timetable_periods.config_id)"
            ") WHERE schedule_id IS NULL"
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


def _normalize_day_ranges(raw, fallback_wake, fallback_sleep):
    """wake/sleep in minutes since midnight (0-1440). A sleep time <= wake
    is ALLOWED and means the sleep time is after midnight on the next day
    (wake 08:00 + sleep 01:00 = asleep 01:00–08:00). Old rows always stored
    sleep > wake, so they keep their exact meaning."""
    out = {}
    for item in (raw if isinstance(raw, list) else []):
        if not isinstance(item, dict):
            continue
        d = _clean_int(item.get("day"), 0, 6, None)
        if d is None or d in out:
            continue
        wake = _clean_int(item.get("wake"), 0, 1440, fallback_wake)
        sleep = _clean_int(item.get("sleep"), 0, 1440, fallback_sleep)
        out[d] = (wake, sleep)
    for d in range(7):
        out.setdefault(d, (fallback_wake, fallback_sleep))
    return out


def _day_ranges_of(config, schedule=None):
    """Effective wake/sleep for a schedule, with legacy fallbacks:
    schedule.day_ranges → config.day_ranges (old install) → grid bounds.
    Values are returned raw; a sleep <= wake is interpreted as after
    midnight (next day) by the frontend."""
    raw = {}
    if schedule is not None and isinstance(schedule.day_ranges, dict):
        raw = schedule.day_ranges
    elif isinstance(config.day_ranges, dict):
        raw = config.day_ranges
    out = []
    for d in range(7):
        entry = raw.get(str(d)) or raw.get(d) or {}
        wake = _clean_int(entry.get("wake"), 0, 1440, config.day_start)
        sleep = _clean_int(entry.get("sleep"), 0, 1440, config.day_end)
        out.append({"day": d, "wake": wake, "sleep": sleep})
    return out


def _normalize_period_days(raw, def_start, def_end):
    items = {}
    if isinstance(raw, dict):
        items = raw
    elif isinstance(raw, list):
        for it in raw:
            if isinstance(it, dict) and it.get("day") is not None:
                items[it["day"]] = it
    out = {}
    for d in range(7):
        it = items.get(str(d)) or items.get(d) or {}
        on = bool(it.get("on", True))
        start = _clean_int(it.get("start"), 0, 1440, def_start)
        end = _clean_int(it.get("end"), 0, 1440, def_end)
        if end <= start:
            end = min(1440, start + 60)
        out[str(d)] = {"on": on, "start": start, "end": end}
    return out


def _period_days_of(p):
    raw = p.days if isinstance(p.days, dict) else {}
    out = []
    for d in range(7):
        it = raw.get(str(d)) or raw.get(d) or {}
        on = bool(it.get("on", True))
        start = _clean_int(it.get("start"), 0, 1440, p.start_min)
        end = _clean_int(it.get("end"), 0, 1440, p.end_min)
        if end <= start:
            end = min(1440, start + 60)
        out.append({"day": d, "on": on, "start": start, "end": end})
    return out


def _sanitize_stat_config(raw):
    d = raw if isinstance(raw, dict) else {}
    out = {k: bool(d.get(k, True)) for k in
           ("showTypes", "showTotal", "showCount", "showBusiest", "showSleep", "showPeriods")}
    groups = []
    for g in (d.get("groups") if isinstance(d.get("groups"), list) else []):
        if not isinstance(g, dict):
            continue
        name = _clean_str(g.get("name"), 60)
        if not name:
            continue
        types = []
        for t in (g.get("types") if isinstance(g.get("types"), list) else []):
            ti = _clean_int(t, 0, 2**31, None)
            if ti is not None and ti not in types:
                types.append(ti)
        groups.append({"name": name, "on": bool(g.get("on", True)), "types": types})
    out["groups"] = groups
    return out


def _seed_stat_config(config):
    names = {t.name: t.id for t in config.event_types}

    def tid(prefix):
        for n, i in names.items():
            if n.startswith(prefix):
                return i
        return None

    school = [i for i in (tid("V"), tid("U")) if i is not None]
    learning = [i for i in (tid("C"), tid("U"), tid("L")) if i is not None]
    config.stat_config = _sanitize_stat_config({
        "showTypes": True, "showTotal": True, "showCount": True,
        "showBusiest": True, "showSleep": True, "showPeriods": True,
        "groups": [
            {"name": "School time", "on": True, "types": school},
            {"name": "Learning time", "on": True, "types": learning},
        ],
    })


def _get_or_create_config(user):
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

    # Append through the relationships — plain add() with only the FK set
    # leaves the collections empty until the next request.
    if not config.schedules:
        sched = TimetableSchedule(config_id=config.id, name="My Timetable", position=0)
        config.schedules.append(sched)
        db.session.add(sched)
        db.session.flush()
        config.active_schedule_id = sched.id

    if not config.event_types:
        for pos, (name, color, icon, offset, dur, split) in enumerate(DEFAULT_TYPES):
            etype = TimetableEventType(
                config_id=config.id, name=name, color=color, icon=icon,
                position=pos, start_offset_min=offset, default_duration_min=dur,
                opacity=100, split_on=split, split_min=45, split_break_min=15,
            )
            config.event_types.append(etype)
            db.session.add(etype)
        db.session.flush()

    for t in config.event_types:
        new = _DEFAULT_RENAMES.get(t.name)
        if new:
            t.name, t.start_offset_min, t.default_duration_min, t.split_on = new

    if config.stat_config is None:
        _seed_stat_config(config)

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
        "color": ev.color or None,
        "room": ev.room or "",
        "teacher": ev.teacher or "",
        "note": ev.note or "",
        "parity": ev.parity or "all",  # legacy — ignored by the UI
    }


def _state(config):
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

    active = _get_schedule(config, config.active_schedule_id)

    # periods + sleep times belong to the ACTIVE schedule
    periods = []
    if active is not None:
        periods = (TimetablePeriod.query
                   .filter_by(schedule_id=active.id)
                   .order_by(TimetablePeriod.position, TimetablePeriod.id)
                   .all())

    return {
        "settings": {
            "dayStart": config.day_start,
            "dayEnd": config.day_end,
            "dayRanges": _day_ranges_of(config, active),
            "showSaturday": bool(config.show_saturday),
            "showSunday": bool(config.show_sunday),
            "activeScheduleId": config.active_schedule_id,
            "theme": config.theme or "dark",
            "hourPx": config.hour_px or 48,
            "statConfig": _sanitize_stat_config(config.stat_config),
        },
        "schedules": [
            {"id": s.id, "name": s.name, "position": s.position or 0} for s in schedules
        ],
        "eventTypes": [
            {"id": t.id, "name": t.name, "color": t.color, "icon": t.icon or "",
             "position": t.position or 0,
             "startOffset": t.start_offset_min or 0,
             "duration": t.default_duration_min or 60,
             "opacity": t.opacity if t.opacity is not None else 100,
             "splitOn": bool(t.split_on),
             "splitMin": t.split_min if t.split_min is not None else 45,
             "splitBreak": t.split_break_min if t.split_break_min is not None else 15}
            for t in types
        ],
        "periods": [
            {"id": p.id, "name": p.name, "color": p.color, "icon": p.icon or "",
             "opacity": p.opacity if p.opacity is not None else 30,
             "start": p.start_min, "end": p.end_min,
             "days": _period_days_of(p)}
            for p in periods
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

    ds = _clean_int(data.get("dayStart"), 0, 1440, config.day_start)
    de = _clean_int(data.get("dayEnd"), 0, 1440, config.day_end)
    if de <= ds:
        de = min(1440, ds + 60)
    if de - ds < 60:
        ds = max(0, de - 60)
    config.day_start, config.day_end = ds, de

    # wake/sleep now belongs to the ACTIVE schedule
    if "dayRanges" in data:
        ranges = _normalize_day_ranges(data.get("dayRanges"), ds, de)
        payload = {str(d): {"wake": w, "sleep": s} for d, (w, s) in ranges.items()}
        sched = _get_schedule(config, config.active_schedule_id)
        if sched is not None:
            sched.day_ranges = payload
        else:
            config.day_ranges = payload  # legacy fallback

    config.show_saturday = bool(data.get("showSaturday", config.show_saturday))
    config.show_sunday = bool(data.get("showSunday", config.show_sunday))

    theme = data.get("theme", config.theme or "dark")
    config.theme = theme if theme in ("dark", "light") else "dark"
    config.hour_px = _clean_int(data.get("hourPx"), 24, 120, config.hour_px or 48)

    if "statConfig" in data:
        config.stat_config = _sanitize_stat_config(data.get("statConfig"))

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

    # sleep times + periods travel with the copy
    if isinstance(src.day_ranges, dict):
        copy.day_ranges = dict(src.day_ranges)
    for p in src.periods:
        db.session.add(TimetablePeriod(
            schedule_id=copy.id, config_id=copy.config_id,
            name=p.name, color=p.color, icon=p.icon, opacity=p.opacity,
            start_min=p.start_min, end_min=p.end_min,
            days=dict(p.days) if isinstance(p.days, dict) else None,
            position=p.position,
        ))

    for e in src.events:
        db.session.add(TimetableEvent(
            schedule_id=copy.id, type_id=e.type_id, title=e.title,
            day=e.day, days=e.days,
            start_min=e.start_min, end_min=e.end_min, color=e.color,
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

    db.session.delete(sched)  # cascades to events AND its periods
    if config.active_schedule_id == sched.id:
        config.active_schedule_id = remaining[0].id

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/schedules/copy-from", methods=["POST"])
def schedules_copy_from():
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
            start_min=e.start_min, end_min=e.end_min, color=e.color,
            room=e.room, teacher=e.teacher, note=e.note, parity=e.parity,
        ))
        count += 1

    db.session.commit()
    return jsonify({"status": "ok", "copied": count, "state": _state(config)})


@timetable_bp.route("/schedules/import-json", methods=["POST"])
def schedules_import_json():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "No JSON payload — send the contents of a JSON backup"}), 400

    schedules_in = data.get("schedules")
    events_in = data.get("events") or []
    types_in = data.get("eventTypes") or []
    periods_in = data.get("periods") or []
    if not isinstance(schedules_in, list) or not schedules_in:
        return jsonify({"error": "Backup contains no schedules"}), 400

    config = _get_or_create_config(user)

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
                opacity=_clean_int(t.get("opacity"), 10, 100, 100),
                split_on=bool(t.get("splitOn")),
                split_min=_clean_int(t.get("splitMin"), 20, 120, 45),
                split_break_min=_clean_int(t.get("splitBreak"), 0, 60, 15),
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
    last_sched = None

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
        last_sched = sched

        for e in events_in:
            if not isinstance(e, dict) or e.get("scheduleId") != s.get("id"):
                continue
            start = _clean_int(e.get("start"), 0, 1440, 480)
            end = _clean_int(e.get("end"), 0, 1440, start + 60)
            if end == start:
                end = min(1440, start + 60)
            # end < start stays as-is: the block runs past midnight
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
                color=_normalize_hex(e.get("color")),
                room=_clean_str(e.get("room"), 120),
                teacher=_clean_str(e.get("teacher"), 120),
                note=(e.get("note") or "")[:2000] if isinstance(e.get("note"), str) else "",
                parity=parity if parity in PARITIES else "all",
            ))
            imported_blocks += 1

        config.active_schedule_id = sched.id

    # the backup's sleep times & periods belonged to one schedule — attach
    # them to the last imported one (which is now active)
    if last_sched is not None:
        settings_in = data.get("settings")
        if isinstance(settings_in, dict) and isinstance(settings_in.get("dayRanges"), list):
            ranges = _normalize_day_ranges(settings_in["dayRanges"],
                                           config.day_start, config.day_end)
            last_sched.day_ranges = {
                str(d): {"wake": w, "sleep": s} for d, (w, s) in ranges.items()
            }
        for p in periods_in:
            if not isinstance(p, dict):
                continue
            name = _clean_str(p.get("name"), 60)
            if not name:
                continue
            start = _clean_int(p.get("start"), 0, 1440, 480)
            end = _clean_int(p.get("end"), 0, 1440, 1020)
            if end <= start:
                end = min(1440, start + 60)
            db.session.add(TimetablePeriod(
                schedule_id=last_sched.id, config_id=config.id,
                name=name,
                color=_normalize_hex(p.get("color")) or "#64748B",
                icon=_clean_str(p.get("icon"), 8),
                opacity=_clean_int(p.get("opacity"), 0, 100, 30),
                start_min=start, end_min=end,
                days=_normalize_period_days(p.get("days"), start, end),
            ))

    db.session.commit()
    return jsonify({"status": "ok", "blocks": imported_blocks, "state": _state(config)})


# ------------------------------------------------------------------
# event types
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
        opacity = _clean_int(item.get("opacity"), 10, 100, 100)
        split_on = bool(item.get("splitOn"))
        split_min = _clean_int(item.get("splitMin"), 20, 120, 45)
        split_break = _clean_int(item.get("splitBreak"), 0, 60, 15)

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
        t.opacity = opacity
        t.split_on = split_on
        t.split_min = split_min
        t.split_break_min = split_break
        kept_ids.add(t.id)
        position += 1

    db.session.flush()

    for t in list(existing.values()):
        if t.id not in kept_ids:
            TimetableEvent.query.filter_by(type_id=t.id).update({"type_id": None})
            db.session.delete(t)

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


# ------------------------------------------------------------------
# time periods (per schedule)
# ------------------------------------------------------------------

@timetable_bp.route("/periods/save", methods=["POST"])
def periods_save():
    user = _require_user()
    if user is None:
        return redirect(url_for("auth.login_page"))

    config = _get_or_create_config(user)
    data = request.get_json(silent=True) or {}
    items = data.get("periods")
    if not isinstance(items, list):
        return jsonify({"error": "periods must be a list"}), 400

    target = _get_schedule(config, data.get("scheduleId", config.active_schedule_id))
    if target is None:
        target = _get_schedule(config, config.active_schedule_id)
    if target is None:
        return jsonify({"error": "No schedule to attach periods to"}), 400

    existing = {p.id: p for p in target.periods}
    kept_ids = set()
    position = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        name = _clean_str(item.get("name"), 60)
        if not name:
            continue
        color = _normalize_hex(item.get("color")) or "#64748B"
        icon = item.get("icon") if isinstance(item.get("icon"), str) else ""
        icon = icon.strip()[:8]
        opacity = _clean_int(item.get("opacity"), 0, 100, 30)
        start = _clean_int(item.get("start"), 0, 1440, 480)
        end = _clean_int(item.get("end"), 0, 1440, 1020)
        if end <= start:
            end = min(1440, start + 60)

        pid = item.get("id")
        p = existing.get(pid) if isinstance(pid, int) else None
        if p is None:
            p = TimetablePeriod(schedule_id=target.id, config_id=config.id)
            db.session.add(p)
        p.name = name
        p.color = color
        p.icon = icon
        p.opacity = opacity
        p.start_min = start
        p.end_min = end
        p.days = _normalize_period_days(item.get("days"), start, end)
        p.position = position
        kept_ids.add(p.id)
        position += 1

    db.session.flush()

    for p in list(existing.values()):
        if p.id not in kept_ids:
            db.session.delete(p)

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
    start = _clean_int(data.get("start"), 0, 1439, None)
    end = _clean_int(data.get("end"), 0, 1440, None)
    if start is None or end is None:
        return jsonify({"error": "Invalid time"}), 400
    if end == start:
        return jsonify({"error": "End must be after start"}), 400
    # end < start is allowed on purpose: the block runs past midnight
    # (e.g. start 22:00, end 01:00 → 22:00–25:00 internally)

    days = _parse_days_input(data.get("days"))
    if days is None:
        single = _clean_int(data.get("day"), 0, 6, None)
        days = [single] if single is not None else None
    if not days:
        return jsonify({"error": "Pick at least one day (Mon–Sun)"}), 400

    # parity: the UI no longer sends it — only touch the stored value when a
    # client explicitly provides one, so legacy odd/even rows survive edits
    new_parity = None
    if "parity" in data:
        parity = data.get("parity") or "all"
        new_parity = parity if parity in PARITIES else "all"

    type_id = data.get("typeId")
    if type_id is not None:
        etype = TimetableEventType.query.filter_by(id=type_id, config_id=config.id).first()
        type_id = etype.id if etype is not None else None

    note = data.get("note") if isinstance(data.get("note"), str) else ""
    color = _normalize_hex(data.get("color"))  # None = use the type color

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
    ev.color = color
    if new_parity is not None:
        ev.parity = new_parity
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
            start_min=e.start_min, end_min=e.end_min, color=e.color,
            room=e.room, teacher=e.teacher, note=e.note, parity=e.parity,
        ))

    db.session.commit()
    return jsonify({"status": "ok", "state": _state(config)})


@timetable_bp.route("/events/clear-day", methods=["POST"])
def events_clear_day():
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
    if len(line) <= 73:
        return line
    out, rest = line[:73], line[73:]
    while rest:
        out += "\r\n " + rest[:73]
        rest = rest[73:]
    return out


def _next_occurrence(day, from_date):
    for i in range(14):
        d = from_date + timedelta(days=i)
        if d.weekday() == day:
            return d
    return None


def _event_end_min(e):
    """Blocks may run past midnight: end before start means the next day."""
    return e.end_min + 1440 if e.end_min <= e.start_min else e.end_min


def _vevent_lines(e, day, first_date, stamp):
    etype = e.type
    start_dt = datetime.combine(first_date, time(0, 0)) + timedelta(minutes=e.start_min)
    end_dt = datetime.combine(first_date, time(0, 0)) + timedelta(minutes=_event_end_min(e))

    desc = []
    if etype is not None:
        desc.append(etype.name)
    if e.teacher:
        desc.append("Teacher: " + e.teacher)
    if e.note:
        desc.append(e.note)

    return [
        "BEGIN:VEVENT",
        "UID:timetable-%d-%d-%d@flask-app" % (e.schedule_id, e.id, day),
        "DTSTAMP:" + stamp,
        "DTSTART:" + start_dt.strftime("%Y%m%dT%H%M%S"),
        "DTEND:" + end_dt.strftime("%Y%m%dT%H%M%S"),
        "RRULE:FREQ=WEEKLY;COUNT=30",
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
            first = _next_occurrence(d, today)
            if first is None:
                continue
            lines.extend(_vevent_lines(e, d, first, stamp))
    lines.append("END:VCALENDAR")

    text = "\r\n".join(_ics_fold(l) for l in lines) + "\r\n"
    resp = Response(text, mimetype="text/calendar")
    resp.headers["Content-Disposition"] = 'attachment; filename="%s.ics"' % _slug(schedule.name)
    return resp