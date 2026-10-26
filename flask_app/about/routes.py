import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, render_template, jsonify, request, current_app

from ..models import *
from ..auth.decorators import login_required, permission_required, admin_required, API

about_bp = Blueprint('about', __name__, static_folder='../static')


# ------------------------------------------------------------------ page
@about_bp.route('/')
def about():
    return render_template('main/about.html')


# --------------------------------------------------- json file storage
# changelog entries are public site content → static (the frontend also
# falls back to /static/data/updates.json when logged out). Suggestions
# are visitor submissions with names/details → stored OUTSIDE the
# publicly served static folder, under instance/data/ (only reachable
# through the authenticated API now).
def _updates_file() -> Path:
    return Path(current_app.static_folder) / 'data' / 'updates.json'


def _suggestions_file() -> Path:
    return Path(current_app.instance_path) / 'data' / 'suggestions.json'


def _read(path: Path) -> list:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return []


def _write(path: Path, items: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding='utf-8')


VALID_TAGS = {'feature', 'improvement', 'fix', 'heads-up', 'note'}
SUGGESTION_TYPES = {'reaction', 'suggestion', 'problem', 'error', 'other'}
TEXT_CAP = 2000


# ------------------------------------------------------------------- updates api
@about_bp.route('/api/updates', methods=['GET'])
def api_updates():
    """Public: the changelog is site content, readable by everyone."""
    items = sorted(_read(_updates_file()), key=lambda u: u.get('created_at', ''), reverse=True)
    return jsonify(items)


@about_bp.route('/api/updates', methods=['POST'])
@admin_required(API)
def api_add_update():
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or '').strip()[:80]
    body = (data.get('body') or '').strip()[:2000]
    tag = data.get('tag') if data.get('tag') in VALID_TAGS else 'note'
    if not title or not body:
        return jsonify(error='title and body are required'), 400

    item = {
        'id': uuid.uuid4().hex,
        'title': title,
        'body': body,
        'tag': tag,
        # ← the whole point: stamped server-side, never typed by a human
        'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }
    items = _read(_updates_file())
    items.append(item)
    _write(_updates_file(), items)
    return jsonify(item), 201


@about_bp.route('/api/updates/<item_id>', methods=['DELETE'])
@admin_required(API)
def api_delete_update(item_id):
    items = _read(_updates_file())
    remaining = [u for u in items if u.get('id') != item_id]
    if len(remaining) == len(items):
        return jsonify(error='not found'), 404
    _write(_updates_file(), remaining)
    return jsonify(ok=True)


# --------------------------------------------------------------- suggestions api
# reading submissions happens only in the console (/admin/api/suggestions);
# the about page only ever POSTs new ones.


@about_bp.route('/api/suggestions', methods=['POST'])
def api_add_suggestion():
    data = request.get_json(force=True, silent=True) or {}

    # honeypot: bots fill every field — pretend success, store nothing
    if (data.get('website') or '').strip():
        return jsonify(ok=True), 201

    stype = data.get('type') if data.get('type') in SUGGESTION_TYPES else 'other'
    name = (data.get('name') or '').strip()[:40] or 'anonymous'
    area = (data.get('area') or '').strip()[:60]
    what = (data.get('what') or '').strip()[:TEXT_CAP]
    how_why = (data.get('how_why') or '').strip()[:TEXT_CAP]
    if not what:
        return jsonify(error='the "what" field is required'), 400

    item = {
        'id': uuid.uuid4().hex,
        'type': stype,
        'name': name,
        'area': area,
        'what': what,
        'how_why': how_why,
        # stamped automatically, same principle as the changelog
        'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }
    items = _read(_suggestions_file())
    items.append(item)
    _write(_suggestions_file(), items)

    # fire-and-forget admin notification (bots/honeypot never reach this)
    try:
        from ..notify import notify
        preview = item['how_why'] or ''
        notify(
            f"New suggestion: {item['type']} from {name}",
            f"<p><b>{name}</b>"
            + (f" &middot; {item['area']}" if item['area'] else "")
            + f" &middot; {item['created_at']}</p>"
            + f"<p>{item['what']}</p>"
            + (f"<p><i>{preview}</i></p>" if preview else "")
            + f"<p><a href=\"{request.host_url}admin\" "
            + "style=\"display:inline-block;padding:14px 26px;background:#2E7D46;"
            + "color:#ffffff;border-radius:12px;font-weight:700;"
            + "text-decoration:none;\">Open console</a></p>",
            f"{name}" + (f" - {item['area']}" if item['area'] else "")
            + f" - {item['created_at']}\n\n{item['what']}\n\n{preview}\n\n"
            f"Console: {request.host_url}admin",
        )
    except Exception:
        pass

    return jsonify(ok=True, id=item['id']), 201
