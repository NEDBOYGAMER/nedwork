# routes.py — Flask-Backend für "Monopoly Amriswil"
# Registrierung im Haupt-Webserver:
#   from apps.monopoly_amriswil import routes as mono
#   app.register_blueprint(mono.bp)
#   mono.attach_socketio(socketio)   # socketio = main app's SocketIO instance
#
# Alles liegt im App-Ordner – KEIN templates/ oder static/ Ordner.
# Der HTML wird als Jinja-Template gerendert: {{ app_name }} wird eingesetzt.

import os
import secrets
import threading

from flask import Blueprint, render_template_string, send_from_directory, request

app_name = "monopoly-amriswil"
APP_DIR = os.path.dirname(os.path.abspath(__file__))

bp = Blueprint("monopoly_amriswil", __name__, url_prefix="/apps/" + app_name)

HTML_FILE = os.path.join(APP_DIR, "index.html")

# --- Multiplayer-Room-Speicher (im Server-Prozess) ---
_rooms = {}          # code -> {"host_sid", "players": [{"sid","name"}], "state"}
_lock = threading.Lock()
_sio = None

def _gen_code():
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(chars) for _ in range(4))
        code = "THUR-" + code
        if code not in _rooms:
            return code

def _players_for(code):
    room = _rooms.get(code)
    if not room:
        return []
    return [{"sid": p["sid"], "name": p["name"], "index": i}
            for i, p in enumerate(room["players"])]

def _broadcast_players(code):
    if code not in _rooms:
        return
    _sio.emit("players", _players_for(code), to=code)


# ---------- HTTP-Routen ----------
@bp.route("/")
def index():
    with open(HTML_FILE, "r", encoding="utf-8") as f:
        html = f.read()
    return render_template_string(html, app_name=app_name)   # {{ app_name }} wird gefüllt

@bp.route("/<path:filename>")
def serve_file(filename):
    return send_from_directory(APP_DIR, filename)            # css/, js/, data/ aus dem App-Ordner


# ---------- SocketIO-Handler (Mehrspieler-Codes) ----------
def attach_socketio(sio):
    global _sio
    _sio = sio

    @sio.on("connect")
    def handle_connect(auth=None):
        return True

    @sio.on("disconnect")
    def handle_disconnect():
        sid = request.sid
        for code in list(_rooms.keys()):
            room = _rooms[code]
            room["players"] = [p for p in room["players"] if p["sid"] != sid]
            if room["host_sid"] == sid:
                if room["players"]:
                    room["host_sid"] = room["players"][0]["sid"]
                else:
                    _rooms.pop(code, None)
                    continue
            _broadcast_players(code)

    @sio.on("create_room")
    def handle_create(data):
        sid = request.sid
        name = (data or {}).get("name") or "Host"
        with _lock:
            code = _gen_code()
            _rooms[code] = {"host_sid": sid, "players": [{"sid": sid, "name": name}], "state": None}
        sio.enter_room(sid, code)
        sio.emit("created", {"code": code, "you": 0}, to=sid)
        _broadcast_players(code)

    @sio.on("join_room_code")
    def handle_join(data):
        sid = request.sid
        code = str((data or {}).get("code") or "").upper()
        name = (data or {}).get("name") or "Spieler"
        if code not in _rooms:
            sio.emit("error", {"message": "Raum nicht gefunden: " + code}, to=sid)
            return
        with _lock:
            room = _rooms[code]
            if len(room["players"]) >= 8:
                sio.emit("error", {"message": "Raum ist voll."}, to=sid)
                return
            idx = len(room["players"])
            room["players"].append({"sid": sid, "name": name})
        sio.enter_room(sid, code)
        sio.emit("joined", {"code": code, "you": idx}, to=sid)
        _broadcast_players(code)

    @sio.on("name")
    def handle_name(data):
        sid = request.sid
        name = (data or {}).get("name") or "Spieler"
        for code, room in _rooms.items():
            for p in room["players"]:
                if p["sid"] == sid:
                    p["name"] = name
                    _broadcast_players(code)
                    return

    @sio.on("state")
    def handle_state(data):
        code = (data or {}).get("room")
        state = (data or {}).get("state")
        if code and code in _rooms:
            _rooms[code]["state"] = state
            _sio.emit("state", {"state": state}, to=code, include_self=False)

    @sio.on("action")
    def handle_action(data):
        code = (data or {}).get("room")
        room = _rooms.get(code)
        if not room:
            return
        _sio.emit("action",
                  {"from": request.sid, "action": (data or {}).get("action")},
                  to=room["host_sid"])