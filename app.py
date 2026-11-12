import os

from flask_app import create_app, db
from flask_migrate import Migrate
from flask_app.permissions import ensure_all, grant_full_access

app = create_app()

with app.app_context():
    #db.drop_all()
    db.create_all()
    # seed permission rows + create the admin account on first boot
    try:
        ensure_all()
    except Exception as exc:
        # an older DB (no users.must_change_password) can't be bootstrapped;
        # tell the operator to migrate instead of bricking boot-up
        print(f"[bootstrap] skipped, DB needs migration first ({exc})")
        print("[bootstrap] run:  flask db upgrade  (or python -m flask db upgrade)")
        db.session.rollback()

migrate = Migrate(app, db)


# Local `python app.py` only: dev accounts that always hold every
# permission. rico is the primary local account; r1/r/r2 are the older
# local test accounts (any that don't exist yet are skipped until created).
# This block never runs under waitress/Docker (`waitress-serve --call
# app:create_app` imports this module without __name__ == "__main__").
LOCAL_FULL_ACCESS_USERS = ("rico", "r1", "r2", "r")


def _grant_local_full_access():
    with app.app_context():
        try:
            granted, missing = grant_full_access(LOCAL_FULL_ACCESS_USERS)
        except Exception as exc:
            db.session.rollback()
            print(f"[dev] full-permission bootstrap skipped ({exc})",
                  flush=True)
            return
        if granted:
            print(f"[dev] full permissions granted: {', '.join(granted)}",
                  flush=True)
        if missing:
            print(f"[dev] local full-access users not found: "
                  f"{', '.join(missing)}", flush=True)


def _start_ws_relay():
    import threading
    from flask_app.ws.server import run_server
    threading.Thread(
        target=run_server, args=("0.0.0.0", 5001), daemon=True).start()
    print("[dev] WebSocket relay: ws://0.0.0.0:5001 "
          "(TierForge + notifications)", flush=True)


if __name__ == '__main__':
    _grant_local_full_access()
    # The reloader runs this module in a parent and a serving child; only
    # the child must bind the WebSocket port.
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        _start_ws_relay()
    app.run(debug=True, use_reloader=True)
