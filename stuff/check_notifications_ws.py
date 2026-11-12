"""Smoke test for the shared WebSocket relay's notification channel.

Throwaway SQLite DB, relay started in-process. Covers:
  - pre-accept auth: no cookie, missing Origin, foreign Origin, valid session
  - ready / notification / unread frames, UTC-tagged created_at
  - deleted session closes the socket (shortened revalidation window)
  - missing DB degrades notifications but not TierForge rooms, then recovers
  - TierForge cursor relay still works without auth

Usage:  python stuff/check_notifications_ws.py
"""
import json
import logging
import os
import socket
import sqlite3
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

tmp = tempfile.mkdtemp()
db_file = os.path.join(tmp, "app.db")
os.environ["NEDWORK_DB_PATH"] = db_file
os.environ["NEDWORK_WS_SWEEP_SECONDS"] = "0.25"
os.environ["NEDWORK_WS_AUTH_SECONDS"] = "1"
os.environ["SITE_BASE_URL"] = "https://nedwork.test"

FAILS = []


def check(name, cond, detail=""):
    print(f"{'  ok' if cond else 'FAIL'}  {name}"
          + ("" if cond else f" — {detail}"))
    if not cond:
        FAILS.append(name)


def now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def init_db():
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires TEXT NOT NULL
        );
        CREATE TABLE notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.execute("INSERT INTO users (id, username) VALUES (1, 'smoke')")
    conn.commit()
    conn.close()


def add_session(session_id):
    conn = sqlite3.connect(db_file)
    expires = (now_naive() + timedelta(hours=1)).isoformat(sep=" ")
    conn.execute(
        "INSERT INTO sessions (session_id, user_id, expires) VALUES (?, 1, ?)",
        (session_id, expires),
    )
    conn.commit()
    conn.close()


def add_notification(title):
    conn = sqlite3.connect(db_file)
    created = now_naive().isoformat(sep=" ")
    cur = conn.execute(
        "INSERT INTO notifications (user_id, type, payload, read, created_at) "
        "VALUES (1, 'event_published', ?, 0, ?)",
        (json.dumps({"title": title}), created),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    return row_id


def mark_all_read():
    conn = sqlite3.connect(db_file)
    conn.execute("UPDATE notifications SET read = 1")
    conn.commit()
    conn.close()


def delete_session(session_id):
    conn = sqlite3.connect(db_file)
    conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def drain(websocket, seconds):
    end = time.time() + seconds
    while time.time() < end:
        try:
            websocket.recv(timeout=max(0.05, end - time.time()))
        except TimeoutError:
            continue
        except Exception:
            return


def recv_until(websocket, kind, timeout=4.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = websocket.recv(timeout=max(0.05, end - time.time()))
        except TimeoutError:
            continue
        except Exception:
            return None
        try:
            message = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if message.get("type") == kind:
            return message
    return None


def handshake_status(origin, cookie, path="/ws/notifications"):
    from websockets.exceptions import InvalidStatus
    from websockets.sync.client import connect

    headers = {"Cookie": f"session_id={cookie}"} if cookie else None
    try:
        with connect(f"ws://127.0.0.1:{PORT}{path}", origin=origin,
                     additional_headers=headers, open_timeout=5,
                     proxy=None):
            return 101
    except InvalidStatus as exc:
        return exc.response.status_code
    except Exception as exc:
        return f"error: {exc}"


init_db()
SESSION = "smoke-session-1"
add_session(SESSION)

PORT = free_port()
from flask_app.ws.server import run_server  # noqa: E402

logging.getLogger("websockets").setLevel(logging.CRITICAL)

threading.Thread(target=run_server, args=("127.0.0.1", PORT),
                 daemon=True).start()
if not wait_for_port(PORT):
    print("FAIL: relay did not start")
    sys.exit(1)

ORIGIN = "https://nedwork.test"
BASE = f"ws://127.0.0.1:{PORT}"

print("== pre-accept auth ==")
check("no cookie is refused before upgrade",
      handshake_status(ORIGIN, None) == 401,
      str(handshake_status(ORIGIN, None)))
check("missing Origin is refused",
      handshake_status(None, SESSION) == 403,
      str(handshake_status(None, SESSION)))
check("foreign Origin is refused",
      handshake_status("https://evil.test", SESSION) == 403,
      str(handshake_status("https://evil.test", SESSION)))
check("localhost Origin is allowed in dev",
      handshake_status("http://localhost:5000", SESSION) == 101,
      str(handshake_status("http://localhost:5000", SESSION)))

print("== notification flow ==")
from websockets.exceptions import ConnectionClosed  # noqa: E402
from websockets.sync.client import connect  # noqa: E402

with connect(f"{BASE}/ws/notifications", origin=ORIGIN,
             additional_headers={"Cookie": f"session_id={SESSION}"},
             open_timeout=5, proxy=None) as websocket:
    drain(websocket, 0.8)  # watermark initialisation (and stray ready frames)

    notification_id = add_notification("Socket smoke")
    pushed = recv_until(websocket, "notification")
    check("new row is pushed", pushed is not None, str(pushed))
    if pushed:
        row = pushed["notification"]
        check("pushed row has the right type", row["type"] == "event_published",
              str(row))
        check("pushed payload survives", row["payload"].get("title")
              == "Socket smoke", str(row))
        check("created_at is UTC-tagged",
              isinstance(row.get("created_at"), str)
              and row["created_at"].endswith("+00:00"),
              str(row.get("created_at")))

    mark_all_read()
    unread = None
    end = time.time() + 4
    while time.time() < end:
        message = recv_until(websocket, "unread", timeout=1)
        if message is None:
            break
        unread = message
        if message.get("unread") == 0:
            break
    check("unread count is pushed after read", unread is not None
          and unread.get("unread") == 0, str(unread))

print("== session revocation ==")
with connect(f"{BASE}/ws/notifications", origin=ORIGIN,
             additional_headers={"Cookie": f"session_id={SESSION}"},
             open_timeout=5, proxy=None) as websocket:
    drain(websocket, 0.4)
    delete_session(SESSION)
    close_code = None
    end = time.time() + 5
    while time.time() < end:
        try:
            websocket.recv(timeout=0.5)
        except ConnectionClosed as exc:
            close_code = exc.rcvd.code if exc.rcvd else None
            break
        except TimeoutError:
            continue
    check("deleted session closes with 4401", close_code == 4401,
          f"code={close_code}")

print("== TierForge path (unchanged) ==")
DEGRADED = "smoke-session-degraded"
add_session(DEGRADED)
with connect(f"{BASE}/apps/tierforge/ws?room=smoke&client=a",
             open_timeout=5, proxy=None) as sender, \
        connect(f"{BASE}/apps/tierforge/ws?room=smoke&client=b",
                open_timeout=5, proxy=None) as receiver, \
        connect(f"{BASE}/ws/notifications", origin=ORIGIN,
                additional_headers={"Cookie": f"session_id={DEGRADED}"},
                open_timeout=5, proxy=None) as websocket:
    drain(websocket, 0.4)
    sender.send(json.dumps({"type": "cursor", "x": 0.1, "y": 0.2,
                            "name": "Smoke"}))
    relayed = recv_until(receiver, "cursor", timeout=3)
    check("TierForge cursor still relays", relayed is not None
          and relayed.get("client") == "a", str(relayed))

    print("== missing DB degradation ==")
    backup = db_file + ".bak"
    moved = False
    for _ in range(50):
        try:
            os.replace(db_file, backup)
            moved = True
            break
        except OSError:
            time.sleep(0.05)
    check("DB file removed under the running relay", moved)
    time.sleep(1.0)
    sender.send(json.dumps({"type": "cursor", "x": 0.3, "y": 0.4,
                            "name": "Degraded"}))
    relayed = recv_until(receiver, "cursor", timeout=3)
    check("TierForge rooms survive a missing DB", relayed is not None,
          str(relayed))

    print("== recovery ==")
    for _ in range(50):
        try:
            os.replace(backup, db_file)
            break
        except OSError:
            time.sleep(0.05)
    add_notification("After recovery")
    pushed = recv_until(websocket, "notification", timeout=5)
    check("pushes resume after DB recovery", pushed is not None, str(pushed))

print(f"\n{len(FAILS)} failed")
if FAILS:
    for name in FAILS:
        print("FAILED:", name)
    sys.exit(1)
