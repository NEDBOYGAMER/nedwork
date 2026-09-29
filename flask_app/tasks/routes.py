from datetime import datetime, timedelta
import secrets

from flask import Blueprint, render_template, request, jsonify, redirect, url_for

from ..models import *   # Task, User, Session, db, ... (same pattern as before)


tasks_bp = Blueprint('tasks', __name__, static_folder='../static')

# ---------------------------------------------------------------------------
# config / constants
# ---------------------------------------------------------------------------

VALID_IMPORTANCE = ("low", "medium", "high", "very high")
VALID_RECURRENCE = (None, "daily", "weekly", "monthly")

# Done tasks are kept for a week after completion, then removed. The purge
# runs on every list fetch, so no scheduler is needed.
DONE_RETENTION = timedelta(days=7)

# Private tasks are encrypted CLIENT-SIDE. The browser derives an AES-GCM key
# from the user's passphrase (PBKDF2 + the per-user salt below), encrypts
# name/text/subtasks/tags and sends ciphertext. The server never sees the
# passphrase or the key — it stores only envelopes like "enc:v1:<base64>".
# The salt is public by design (it must be readable to derive the key).
CIPHER_PREFIX = "enc:v1:"

_INVALID = object()   # sentinel for an unparseable deadline


def _is_ciphertext(value):
    return isinstance(value, str) and value.startswith(CIPHER_PREFIX)


# ---------------------------------------------------------------------------
# helpers - payload cleaning / validation
# ---------------------------------------------------------------------------

def _clean_name(value):
    name = str(value or "").strip()
    if _is_ciphertext(name):
        return name                       # opaque envelope - store as-is
    return name[:80]


def _clean_text(value):
    return None if value is None else str(value)


def _clean_tags(value):
    if _is_ciphertext(value):
        return value                      # encrypted envelope - store as-is
    if isinstance(value, str):
        raw = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        raw = [str(part).strip() for part in value]
    else:
        return []

    seen, tags = set(), []
    for tag in raw:
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def _clean_subtasks(value):
    """Plaintext form: [{"name": str, "done": bool}] - matches the JS.
    Encrypted form: a single "enc:v1:..." string - stored as-is."""
    if _is_ciphertext(value):
        return value
    if not isinstance(value, list):
        return []
    subtasks = []
    for item in value:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            done = bool(item.get("done"))
        else:
            name = str(item or "").strip()
            done = False
        if name:
            subtasks.append({"name": name[:200], "done": done})
    return subtasks


def _parse_deadline(value):
    """Naive local wall-clock times end to end: the client sends what
    datetime-local gives it, we store it as-is and return it via isoformat()."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)

    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return _INVALID
    return parsed.replace(tzinfo=None)   # keep the wall clock the sender used


def _validate_task_payload(payload, partial):
    """Returns (cleaned, error). partial=False -> every field must be present;
    partial=True -> only the keys actually in the payload are returned."""
    cleaned = {}

    if not partial or "name" in payload:
        name = _clean_name(payload.get("name"))
        if not name:
            return None, "name is required"
        cleaned["name"] = name

    if not partial or "text" in payload:
        cleaned["text"] = _clean_text(payload.get("text"))

    if not partial or "importance" in payload:
        importance = str(payload.get("importance") or "medium").strip().lower()
        if importance not in VALID_IMPORTANCE:
            return None, "importance must be one of: " + ", ".join(VALID_IMPORTANCE)
        cleaned["importance"] = importance

    if not partial or "tags" in payload:
        cleaned["tags"] = _clean_tags(payload.get("tags"))

    if not partial or "subtasks" in payload:
        cleaned["subtasks"] = _clean_subtasks(payload.get("subtasks"))

    if not partial or "deadline" in payload:
        deadline = _parse_deadline(payload.get("deadline"))
        if deadline is _INVALID:
            return None, "deadline must be an ISO datetime"
        cleaned["deadline"] = deadline

    if not partial or "private" in payload:
        cleaned["private"] = bool(payload.get("private", False))

    if not partial or "done" in payload:
        cleaned["done"] = bool(payload.get("done", False))

    if not partial or "working" in payload:
        cleaned["working"] = bool(payload.get("working", False))

    if not partial or "recurrence" in payload:
        recurrence = payload.get("recurrence") or None
        if recurrence is not None:
            recurrence = str(recurrence).strip().lower()
        if recurrence not in VALID_RECURRENCE:
            return None, "recurrence must be one of: daily, weekly, monthly"
        cleaned["recurrence"] = recurrence

    return cleaned, None


def _ensure_private_salt(user):
    """Create the user's PBKDF2 salt on first use. It is not secret — it only
    makes the passphrase derivation per-user. Must exist before the first
    encrypted task is stored so later sessions derive the same key."""
    if not user.encryption_key:
        user.encryption_key = secrets.token_hex(16)


def _next_occurrence(base, recurrence, now):
    """Advance base by the recurrence interval until it lies in the future
    (so a long-neglected daily task doesn't spawn a pile of overdue clones)."""
    if base is None:
        return None
    step = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}.get(recurrence)
    next_dt = base
    while next_dt <= now:
        if recurrence == "monthly":
            month = next_dt.month + 1
            year = next_dt.year + (month - 1) // 12
            next_dt = next_dt.replace(year=year, month=(month - 1) % 12 + 1)
        else:
            next_dt = next_dt + step
        if next_dt > base + timedelta(days=366 * 5):   # paranoia guard
            break
    return next_dt


def _spawn_recurrence(task, now):
    """Completing a recurring task creates its next instance. Returns the new
    Task (unsaved) or None. Private fields are copied as ciphertext — the
    client re-encrypts nothing; the envelope decrypts with the same key."""
    if task.recurrence not in ("daily", "weekly", "monthly"):
        return None
    return Task(
        name=task.name,
        text=task.text,
        importance=task.importance,
        tags=task.tags,
        subtasks=task.subtasks,
        deadline=_next_occurrence(task.deadline, task.recurrence, now),
        private=task.private,
        done=False,
        working=False,
        recurrence=task.recurrence,
        created_at=now,
        last_updated_at=now,
        completed_at=None,
        user=task.user,
    )


def _purge_expired_done_tasks(user):
    """Remove done tasks whose completed_at is older than DONE_RETENTION.
    Called on every list fetch; returns how many were removed."""
    cutoff = datetime.now() - DONE_RETENTION
    expired = Task.query.filter(
        Task.user_id == user.id,
        Task.done.is_(True),
        Task.completed_at.isnot(None),
        Task.completed_at < cutoff,
    ).all()
    if not expired:
        return 0
    for task in expired:
        db.session.delete(task)
    db.session.commit()
    return len(expired)


def _task_to_dict(task):
    return {
        "id":              task.id,
        "name":            task.name,
        "text":            task.text,
        "importance":      task.importance,
        "private":         task.private,
        "done":            task.done,
        "working":         task.working,
        "recurrence":      task.recurrence,
        "position":        task.position,
        "tags":            task.tags,
        "subtasks":        task.subtasks,
        "deadline":        task.deadline.isoformat()        if task.deadline        else None,
        "created_at":      task.created_at.isoformat()      if task.created_at      else None,
        "last_updated_at": task.last_updated_at.isoformat() if task.last_updated_at else None,
        "completed_at":    task.completed_at.isoformat()    if task.completed_at    else None,
    }


# ---------------------------------------------------------------------------
# pages
# ---------------------------------------------------------------------------

@tasks_bp.route('/')
def tasks_page():
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return redirect(url_for('auth.login_page'))
    return render_template('main/tasks.html')


# ---------------------------------------------------------------------------
# api
#   GET    /tasks/api/get_tasks                -> list tasks (purges old done tasks first)
#   POST   /tasks/api/get_tasks                -> create task
#   PATCH  /tasks/api/get_tasks/<task_id>      -> partial update (may spawn recurrence)
#   DELETE /tasks/api/get_tasks/<task_id>      -> delete
#   POST   /tasks/api/get_tasks/reorder        -> set manual order (All tab)
#   POST   /tasks/api/get_tasks/private_salt   -> ensure + return the PBKDF2 salt
#   POST   /tasks/api/get_tasks/private_reset  -> delete ALL private tasks + clear the salt
#   GET    /tasks/api/get_tasks/me             -> user id (for client-side stats keying)
# ---------------------------------------------------------------------------

def _require_user():
    valid, user = Session.check(request.cookies.get("session_id"))
    return user if valid else None


@tasks_bp.route('/api/get_tasks/me', methods=['GET'])
def me():
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({"user_id": user.id})


@tasks_bp.route('/api/get_tasks', methods=['GET', 'POST'])
def list_owned_tasks():
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    if request.method == 'POST':
        payload = request.get_json(silent=True) or {}
        cleaned, error = _validate_task_payload(payload, partial=False)
        if error:
            return jsonify({"error": error}), 400

        if cleaned["private"]:
            _ensure_private_salt(user)

        now = datetime.now()
        max_pos = db.session.query(db.func.max(Task.position)).filter_by(user_id=user.id).scalar()
        task = Task(
            name=cleaned["name"],
            text=cleaned["text"],
            importance=cleaned["importance"],
            tags=cleaned["tags"],
            subtasks=cleaned["subtasks"],
            deadline=cleaned["deadline"],
            private=cleaned["private"],
            done=False,
            working=False,
            recurrence=cleaned["recurrence"],
            position=(max_pos or 0) + 1,
            created_at=now,
            last_updated_at=now,
            completed_at=None,
            user=user,
        )
        db.session.add(task)
        db.session.commit()
        return jsonify({"task": _task_to_dict(task)}), 201

    _purge_expired_done_tasks(user)
    tasks = [_task_to_dict(t) for t in user.tasks]
    return jsonify({"tasks": tasks})


@tasks_bp.route('/api/get_tasks/reorder', methods=['POST'])
def reorder_tasks():
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    order = payload.get("order")
    if not isinstance(order, list):
        return jsonify({"error": "order must be a list of task ids"}), 400

    for index, task_id in enumerate(order):
        if not isinstance(task_id, int):
            continue
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()
        if task is not None:
            task.position = index

    db.session.commit()
    return jsonify({"ok": True})


@tasks_bp.route('/api/get_tasks/<int:task_id>', methods=['PATCH', 'DELETE'])
def task_detail(task_id):
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    task = Task.query.filter_by(id=task_id, user_id=user.id).first()
    if task is None:
        return jsonify({"error": "not found"}), 404

    if request.method == 'DELETE':
        db.session.delete(task)
        db.session.commit()
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    cleaned, error = _validate_task_payload(payload, partial=True)
    if error:
        return jsonify({"error": error}), 400
    if not cleaned:
        return jsonify({"error": "nothing to update"}), 400

    # salt must exist before anything encrypted can be stored
    if task.private or cleaned.get("private"):
        _ensure_private_salt(user)

    was_done = task.done
    for key, value in cleaned.items():
        setattr(task, key, value)

    now = datetime.now()
    task.last_updated_at = now
    spawned = None
    if "done" in cleaned:
        if cleaned["done"] and not was_done:
            task.completed_at = now
            spawned = _spawn_recurrence(task, now)
            if spawned is not None:
                db.session.add(spawned)
        elif not cleaned["done"] and was_done:
            task.completed_at = None

    db.session.commit()
    result = {"task": _task_to_dict(task)}
    if spawned is not None:
        result["spawned"] = _task_to_dict(spawned)
    return jsonify(result)


@tasks_bp.route('/api/get_tasks/private_salt', methods=['POST'])
def private_salt():
    """Idempotent: creates the user's salt if missing, always returns it.
    The client needs it to derive the AES key from the passphrase."""
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    _ensure_private_salt(user)
    db.session.commit()
    return jsonify({"salt": user.encryption_key})


@tasks_bp.route('/api/get_tasks/private_reset', methods=['POST'])
def private_reset():
    """Escape hatch for a forgotten passphrase: deletes ALL of the user's
    private tasks (the ciphertext is unreadable without the passphrase, so
    there is nothing to recover) and clears the salt so the next private
    task starts with a fresh passphrase. Regular tasks are untouched."""
    user = _require_user()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    deleted = Task.query.filter_by(user_id=user.id, private=True).delete(synchronize_session=False)
    user.encryption_key = None
    db.session.commit()
    return jsonify({"ok": True, "deleted": deleted})