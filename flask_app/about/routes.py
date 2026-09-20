import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, render_template, jsonify, request, current_app

from ..models import *

about_bp = Blueprint('about', __name__, static_folder='../static')


# ------------------------------------------------------------------ page
@about_bp.route('/')
def about():
    return render_template('main/about.html')


# --------------------------------------------------- json file storage
def _data_file(name: str) -> Path:
    # files live inside the app's static folder, so what the api writes is
    # also what the frontend can fall back to at /static/data/<name>
    return Path(current_app.static_folder) / 'data' / name


def _read(name: str) -> list:
    f = _data_file(name)
    if f.exists():
        try:
            return json.loads(f.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _write(name: str, items: list) -> None:
    f = _data_file(name)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding='utf-8')


VALID_TAGS = {'feature', 'improvement', 'fix', 'heads-up', 'note'}
SUGGESTION_TYPES = {'reaction', 'suggestion', 'problem', 'error', 'other'}
TEXT_CAP = 2000


# ------------------------------------------------------------------- updates api
@about_bp.route('/api/updates', methods=['GET'])
def api_updates():
    items = sorted(_read('updates.json'), key=lambda u: u.get('created_at', ''), reverse=True)
    return jsonify(items)


@about_bp.route('/api/updates', methods=['POST'])
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
    items = _read('updates.json')
    items.append(item)
    _write('updates.json', items)
    return jsonify(item), 201


@about_bp.route('/api/updates/<item_id>', methods=['DELETE'])
def api_delete_update(item_id):
    items = _read('updates.json')
    remaining = [u for u in items if u.get('id') != item_id]
    if len(remaining) == len(items):
        return jsonify(error='not found'), 404
    _write('updates.json', remaining)
    return jsonify(ok=True)


# --------------------------------------------------------------- suggestions api
@about_bp.route('/api/suggestions', methods=['GET'])
def api_suggestions():
    # for the future /admin page — put an auth decorator on this before shipping it
    items = sorted(_read('suggestions.json'), key=lambda s: s.get('created_at', ''), reverse=True)
    return jsonify(items)


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
    items = _read('suggestions.json')
    items.append(item)
    _write('suggestions.json', items)
    return jsonify(ok=True, id=item['id']), 201