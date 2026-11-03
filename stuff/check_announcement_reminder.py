"""Self-check: announcement module + 24h reminder scan, in-memory DB."""
import os, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User, Event, EventModule, Notification
from datetime import datetime, timedelta
from unittest.mock import patch

app = create_app()
app.config["TESTING"] = True

with app.app_context():
    db.create_all()
    host = User(username="h", email="h@t.local"); host.set_password("x")
    host.generate_key(); db.session.add(host); db.session.flush()
    host.grant_permission("core")
    ev = Event(host_id=host.id, title="T", status="published",
               event_date=datetime.now() + timedelta(hours=23))
    db.session.add(ev); db.session.flush()
    from flask_app.models import EventMember
    db.session.add(EventMember(event_id=ev.id, user_id=host.id, role="host"))

    # 1) announcement module add (server-side type validation)
    from flask_app.events.routes import VALID_MODULE_TYPES, SINGLETON_TYPES
    assert "announcement" in VALID_MODULE_TYPES
    assert "announcement" in SINGLETON_TYPES

    # 2) announcement config clamps + tone validation
    m = EventModule(event_id=ev.id, type="announcement", position=1)
    m.config = {"text": "x" * 600, "tone": "bogus"}
    assert len(m.config["text"]) == 600  # raw before endpoint clamp

    # 3) reminder scan creates exactly one event_reminder, deduped
    from flask_app.notifications import scan_reminders
    from flask_app import notifications as N
    with patch.object(N, "_email_payload", return_value=None):
        scan_reminders(host)
        db.session.commit()
        rows = Notification.query.filter_by(user_id=host.id,
                                            type="event_reminder").all()
        assert len(rows) == 1, f"expected 1 reminder, got {len(rows)}"
        scan_reminders(host)          # second run must dedupe
        db.session.commit()
        rows = Notification.query.filter_by(user_id=host.id,
                                            type="event_reminder").all()
        assert len(rows) == 1, f"dedupe failed: {len(rows)}"
        assert rows[0].payload["event_id"] == ev.id

    # 4) event more than 26h out → no reminder
    ev2 = Event(host_id=host.id, title="Far", status="published",
                event_date=datetime.now() + timedelta(hours=48))
    db.session.add(ev2); db.session.flush()
    db.session.add(EventMember(event_id=ev2.id, user_id=host.id, role="host"))
    db.session.commit()
    scan_reminders(host)
    db.session.commit()
    rows = Notification.query.filter_by(user_id=host.id,
                                        type="event_reminder").all()
    assert len(rows) == 1, f"far event wrongly reminded: {len(rows)}"

print("announcement + reminder self-check OK")
