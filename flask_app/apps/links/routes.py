import time
import uuid
import re

from flask import Blueprint, request, jsonify, redirect, url_for
from sqlalchemy.orm.attributes import flag_modified

from ...models import *
from ... import db

links_bp = Blueprint('links', __name__)


# ------------------------------------------------------------------
# seed data — shown the first time a user opens the app
# ------------------------------------------------------------------

def _default_links():
    """A handful of links everyone recognises, not just developers."""
    now = int(time.time() * 1000)
    seed = [
        {"title": "Gmail", "url": "https://mail.google.com", "desc": "Check and send email.", "tags": ["email"]},
        {"title": "YouTube", "url": "https://www.youtube.com", "desc": "Watch videos and music.", "tags": ["video", "entertainment"]},
        {"title": "Amazon", "url": "https://www.amazon.com", "desc": "Online shopping.", "tags": ["shopping"]},
        {"title": "Google Maps", "url": "https://maps.google.com", "desc": "Directions and local search.", "tags": ["maps", "travel"]},
        {"title": "Wikipedia", "url": "https://www.wikipedia.org", "desc": "Look almost anything up.", "tags": ["reference"]},
        {"title": "Netflix", "url": "https://www.netflix.com", "desc": "Stream movies and shows.", "tags": ["entertainment", "streaming"]},
        {"title": "Weather.com", "url": "https://weather.com", "desc": "Check the forecast.", "tags": ["weather"]},
        {"title": "Spotify", "url": "https://open.spotify.com", "desc": "Listen to music and podcasts.", "tags": ["music", "entertainment"]},
    ]
    # Stagger createdAt so the list has a sensible "recent first" order.
    return [
        {**item, "id": uuid.uuid4().hex[:10], "createdAt": now - i * 3600000}
        for i, item in enumerate(seed)
    ]


# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------

def _require_user():
    """Returns the logged-in User, or None if the session is invalid."""
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return None
    return user


def _get_or_create_linklist(user):
    """Every user gets exactly one AppsConfig + LinkList row, created lazily.

    Note: `link_list` is a relationship, not a physical column on
    apps_configs — the foreign key lives on the linklists side
    (linklists.apps_config_id), which is why you won't see a
    link_list column when browsing the apps_configs table directly."""
    apps_config = user.apps_config
    if apps_config is None:
        apps_config = AppsConfig(user_id=user.id)
        db.session.add(apps_config)
        db.session.flush()  # assign apps_config.id before we reference it

    if apps_config.link_list is None:
        link_list = LinkList(apps_config_id=apps_config.id, linklist=_default_links())
        db.session.add(link_list)
        apps_config.link_list = link_list
        db.session.flush()

    return apps_config.link_list


def _is_valid_string(s, max_len):
    return isinstance(s, str) and 0 < len(s.strip()) <= max_len


def _is_valid_url(url):
    if not isinstance(url, str):
        return False
    url = url.strip()
    if not url or len(url) > 2000:
        return False
    return re.match(r'^https?://\S+$', url, re.IGNORECASE) is not None


def _is_valid_tags(tags):
    if tags is None:
        return True
    if not isinstance(tags, list) or len(tags) > 20:
        return False
    return all(isinstance(t, str) and 0 < len(t.strip()) <= 40 for t in tags)


def _clean_tags(tags):
    return sorted({t.strip().lower() for t in (tags or []) if t.strip()})


# ------------------------------------------------------------------
# routes
# ------------------------------------------------------------------

@links_bp.route("/list", methods=["GET"])
def list_links():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    link_list = _get_or_create_linklist(user)
    db.session.commit()

    return jsonify({"links": link_list.linklist or []})


@links_bp.route("/save", methods=["POST"])
def save_link():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    link_id = data.get("id")
    title = data.get("title")
    url = data.get("url")
    desc = data.get("desc", "") or ""
    tags = data.get("tags", [])

    if not _is_valid_string(title, max_len=200):
        return jsonify({"error": "Title is required (max 200 characters)"}), 400
    if not _is_valid_url(url):
        return jsonify({"error": "URL must start with http:// or https://"}), 400
    if not isinstance(desc, str) or len(desc) > 500:
        return jsonify({"error": "Description must be text (max 500 characters)"}), 400
    if not _is_valid_tags(tags):
        return jsonify({"error": "Tags must be a list of short strings (max 20 tags)"}), 400

    clean_tags = _clean_tags(tags)

    link_list = _get_or_create_linklist(user)
    items = link_list.linklist or []

    if link_id:
        idx = next((i for i, l in enumerate(items) if l.get("id") == link_id), None)
        if idx is None:
            return jsonify({"error": "Link not found"}), 404
        items[idx] = {
            **items[idx],
            "title": title.strip(),
            "url": url.strip(),
            "desc": desc.strip(),
            "tags": clean_tags,
        }
        saved = items[idx]
    else:
        saved = {
            "id": uuid.uuid4().hex[:10],
            "title": title.strip(),
            "url": url.strip(),
            "desc": desc.strip(),
            "tags": clean_tags,
            "createdAt": int(time.time() * 1000),
        }
        items.append(saved)

    link_list.linklist = items
    flag_modified(link_list, "linklist")
    db.session.commit()

    return jsonify({"status": "ok", "link": saved})


@links_bp.route("/delete", methods=["POST"])
def delete_link():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    link_id = data.get("id")
    if not link_id or not isinstance(link_id, str):
        return jsonify({"error": "Missing id"}), 400

    link_list = _get_or_create_linklist(user)
    items = link_list.linklist or []
    new_items = [l for l in items if l.get("id") != link_id]

    if len(new_items) == len(items):
        return jsonify({"error": "Not found"}), 404

    link_list.linklist = new_items
    flag_modified(link_list, "linklist")
    db.session.commit()

    return jsonify({"status": "ok"})