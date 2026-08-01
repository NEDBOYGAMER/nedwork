"""
POLYWARS - backend

Built as a Blueprint, the same way the Colors app does it: no `Flask`
import and no app.run() here — this module just defines routes and gets
mounted by the outer app, e.g.:

    from apps.polywars.routes import polywars_bp
    app.register_blueprint(polywars_bp, url_prefix="/apps/polywars")

Game state (rooms, board, players) is transient and lives in memory for
the lifetime of the process — unlike Colors' palettes, there's nothing
here that needs a user account or a database row, so there's no
_require_user()/db usage to borrow from routes.py in that app.
"""

import random
import string
import time
import threading
from flask import Blueprint, request, jsonify

polywars_bp = Blueprint("polywars", __name__)
LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# BOARD DEFINITION
# ---------------------------------------------------------------------------
# 28-tile loop (8x8 perimeter): 4 corners + 4 fronts of 6 tiles each
# (4 buyable properties + 2 special fields per front).
CORNERS = {
    0: {"type": "corner", "name": "HQ (GO)", "kind": "go"},
    7: {"type": "corner", "name": "Artillery Support", "kind": "artillery"},
    14: {"type": "corner", "name": "Stronghold", "kind": "stronghold"},
    21: {"type": "corner", "name": "Under Siege", "kind": "siege"},
}

# Each front is 6 tiles; relative position 2 is a Supply Drop, relative
# position 4 is a Skirmish (tax), the other four are buyable properties.
TERRITORIES = {
    "north": {
        "color": "#c0392b",
        "label": "Redmoor Front",
        "tiles": [1, 2, 3, 4, 5, 6],
        "base_price": 100,
        "next": "east",
        "prev": "west",
    },
    "east": {
        "color": "#2874a6",
        "label": "Bluewater Front",
        "tiles": [8, 9, 10, 11, 12, 13],
        "base_price": 140,
        "next": "south",
        "prev": "north",
    },
    "south": {
        "color": "#4e7a3f",
        "label": "Greenfield Front",
        "tiles": [15, 16, 17, 18, 19, 20],
        "base_price": 180,
        "next": "west",
        "prev": "east",
    },
    "west": {
        "color": "#b8860b",
        "label": "Goldpeak Front",
        "tiles": [22, 23, 24, 25, 26, 27],
        "base_price": 220,
        "next": "north",
        "prev": "south",
    },
}

PROPERTY_NAME_WORDS = {
    "north": ["Pass", "Ridge", "Hollow", "Bastion"],
    "east": ["Docks", "Strait", "Isle", "Keep"],
    "south": ["Farm", "Mill", "Grove", "Fort"],
    "west": ["Trail", "Mine", "Summit", "Citadel"],
}

PLAYER_COLORS = ["#e8b64c", "#7fd3c7", "#e26d5c", "#9b8ce6", "#8fd14f", "#f28fb2"]

STARTING_MONEY = 2000
PASS_GO_BASE = 250
TERRITORY_INCOME_BONUS = 70   # extra income per fully-owned front, collected on passing GO
MAX_ROUNDS = 40
ARTILLERY_CHANCE = 0.3
SUPPLY_MIN, SUPPLY_MAX = 60, 220


def build_board():
    """Returns dict: tile_index -> tile info (including property fields for property tiles)."""
    board = {}
    for idx, info in CORNERS.items():
        board[idx] = dict(info, index=idx, owner=None)

    for terr_id, terr in TERRITORIES.items():
        words = PROPERTY_NAME_WORDS[terr_id]
        prop_i = 0
        for rel, tile_idx in enumerate(terr["tiles"]):
            if rel == 2:
                board[tile_idx] = {
                    "type": "supply", "index": tile_idx, "name": "Supply Drop",
                    "territory": terr_id, "color": terr["color"], "owner": None,
                }
            elif rel == 4:
                board[tile_idx] = {
                    "type": "skirmish", "index": tile_idx, "name": "Skirmish",
                    "territory": terr_id, "color": terr["color"], "owner": None,
                }
            else:
                price = terr["base_price"] + prop_i * 20
                board[tile_idx] = {
                    "type": "property", "index": tile_idx,
                    "name": f"{terr_id.capitalize()} {words[prop_i]}",
                    "territory": terr_id, "color": terr["color"],
                    "price": price, "rent": price // 5, "owner": None,
                }
                prop_i += 1
    return board


def territory_property_tiles(terr_id):
    return [t for t in TERRITORIES[terr_id]["tiles"]]  # filtered per-board in territory_full_owner


def new_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=5))


GAMES = {}  # code -> game dict


def new_game(code):
    return {
        "code": code,
        "status": "lobby",  # lobby | active | finished
        "board": build_board(),
        "players": [],       # list of player dicts, order = turn order
        "turn": 0,
        "round": 0,
        "pot": 0,             # war chest, filled by Skirmish tiles, collected at Stronghold
        "dice": None,
        "log": [],
        "winner": None,
        "created": time.time(),
    }


def log(game, text):
    game["log"].insert(0, text)
    game["log"] = game["log"][:60]


def new_player(pid, name, color):
    return {
        "id": pid, "name": name, "color": color,
        "money": STARTING_MONEY, "position": 0,
        "bankrupt": False, "sieged": False, "is_host": False,
    }


def current_player(game):
    if not game["players"]:
        return None
    return game["players"][game["turn"] % len(game["players"])]


def territory_full_owner(game, terr_id):
    """Return player id if a single player owns every *buyable* tile in the
    territory (specials aren't ownable so they're excluded), else None."""
    prop_tiles = [t for t in TERRITORIES[terr_id]["tiles"] if game["board"][t]["type"] == "property"]
    owners = {game["board"][t]["owner"] for t in prop_tiles}
    if len(owners) == 1:
        return next(iter(owners))
    return None


def player_active_fronts(game, pid):
    return [t for t in TERRITORIES if territory_full_owner(game, t) == pid]


def player_property_count(game, pid):
    return sum(1 for t in game["board"].values() if t.get("type") == "property" and t.get("owner") == pid)


def advance_position(pos, steps):
    return (pos + steps) % 28


def pay(game, payer, amount, payee=None):
    payer["money"] -= amount
    if payee is not None:
        payee["money"] += amount
    if payer["money"] < 0:
        bankrupt(game, payer)


def bankrupt(game, player):
    if player["bankrupt"]:
        return
    player["bankrupt"] = True
    player["money"] = 0
    for tile in game["board"].values():
        if tile.get("type") == "property" and tile.get("owner") == player["id"]:
            tile["owner"] = None
    log(game, f"{player['name']} went bankrupt and lost all territory.")
    check_win(game)


def check_win(game):
    alive = [p for p in game["players"] if not p["bankrupt"]]
    if len(alive) == 1 and len(game["players"]) > 1:
        game["status"] = "finished"
        game["winner"] = alive[0]["id"]
        log(game, f"{alive[0]['name']} wins - last front standing!")
    elif game["round"] >= MAX_ROUNDS:
        def net_worth(p):
            props = sum(t["price"] for t in game["board"].values()
                        if t.get("type") == "property" and t.get("owner") == p["id"])
            return p["money"] + props
        best = max(game["players"], key=net_worth)
        game["status"] = "finished"
        game["winner"] = best["id"]
        log(game, f"Campaign over - {best['name']} wins on net worth!")


def resolve_landing(game, player):
    tile = game["board"][player["position"]]
    ttype = tile.get("type")

    if ttype == "corner":
        kind = tile["kind"]
        if kind == "go":
            fronts = len(player_active_fronts(game, player["id"]))
            income = PASS_GO_BASE + fronts * TERRITORY_INCOME_BONUS
            player["money"] += income
            log(game, f"{player['name']} reports to HQ and draws {income} supply.")
        elif kind == "siege":
            player["sieged"] = True
            log(game, f"{player['name']} is pinned down under siege - skips next turn.")
        elif kind == "stronghold":
            if game["pot"] > 0:
                player["money"] += game["pot"]
                log(game, f"{player['name']} regroups at the stronghold and claims the {game['pot']} war chest.")
                game["pot"] = 0
            else:
                log(game, f"{player['name']} regroups at the stronghold.")
        elif kind == "artillery":
            targets = [t for t in game["board"].values()
                       if t.get("type") == "property" and t.get("owner") not in (None, player["id"])]
            if not targets:
                log(game, f"{player['name']} calls in artillery support but finds no targets.")
            else:
                target = random.choice(targets)
                defender = next(p for p in game["players"] if p["id"] == target["owner"])
                if random.random() < ARTILLERY_CHANCE:
                    target["owner"] = player["id"]
                    log(game, f"{player['name']} calls in an artillery strike and seizes {target['name']} from {defender['name']}!")
                else:
                    log(game, f"{player['name']} calls in an artillery strike on {target['name']}, but it misses.")

    elif ttype == "supply":
        bonus = random.randint(SUPPLY_MIN, SUPPLY_MAX)
        player["money"] += bonus
        log(game, f"{player['name']} finds a supply drop worth {bonus}.")

    elif ttype == "skirmish":
        tax = min(150, 25 + game["round"] * 10)
        player["money"] -= tax
        game["pot"] += tax
        log(game, f"{player['name']} is caught in a skirmish and loses {tax} to the war chest.")
        if player["money"] < 0:
            bankrupt(game, player)

    elif ttype == "property":
        owner_id = tile.get("owner")
        if owner_id is None:
            pass  # frontend offers "buy"
        elif owner_id != player["id"]:
            owner = next(p for p in game["players"] if p["id"] == owner_id)
            full_owner = territory_full_owner(game, tile["territory"])
            rent = tile["rent"] * (2 if full_owner == owner_id else 1)
            pay(game, player, rent, owner)
            log(game, f"{player['name']} pays {rent} rent to {owner['name']} at {tile['name']}.")


def expand_fronts(game, player):
    """Frontwars-style automatic territory expansion for the player who just
    finished their turn: each fully-owned front pushes its border outward."""
    fronts = player_active_fronts(game, player["id"])
    for terr_id in fronts:
        terr = TERRITORIES[terr_id]
        targets = [TERRITORIES[terr["next"]]["tiles"][0], TERRITORIES[terr["prev"]]["tiles"][-1]]
        for t_idx in targets:
            tile = game["board"][t_idx]
            if tile.get("type") != "property":
                continue
            owner = tile.get("owner")
            if owner == player["id"]:
                continue
            if owner is None:
                if random.random() < 0.35:
                    tile["owner"] = player["id"]
                    log(game, f"{player['name']}'s {terr['label']} annexes unclaimed {tile['name']}.")
            else:
                defender = next(p for p in game["players"] if p["id"] == owner)
                atk = player_property_count(game, player["id"])
                dfn = player_property_count(game, owner)
                chance = max(0.05, min(0.6, 0.15 + 0.05 * (atk - dfn)))
                if random.random() < chance:
                    tile["owner"] = player["id"]
                    log(game, f"{player['name']}'s {terr['label']} storms {tile['name']}, seizing it from {defender['name']}!")
                else:
                    log(game, f"{player['name']}'s {terr['label']} probes {tile['name']} but {defender['name']} holds the line.")


def public_state(game, viewer_id=None):
    cp = current_player(game)
    return {
        "code": game["code"],
        "status": game["status"],
        "round": game["round"],
        "pot": game["pot"],
        "board": game["board"],
        "territories": {k: {"color": v["color"], "label": v["label"], "tiles": v["tiles"]} for k, v in TERRITORIES.items()},
        "players": game["players"],
        "turn_player_id": cp["id"] if cp else None,
        "dice": game["dice"],
        "log": game["log"],
        "winner": game["winner"],
        "you": viewer_id,
    }


# ---------------------------------------------------------------------------
# ROUTES  (mounted by the outer app, e.g. url_prefix="/apps/polywars")
# ---------------------------------------------------------------------------
@polywars_bp.route("/create", methods=["POST"])
def create_game():
    data = request.get_json(force=True)
    name = (data.get("name") or "Commander").strip()[:20] or "Commander"
    with LOCK:
        code = new_code()
        while code in GAMES:
            code = new_code()
        game = new_game(code)
        pid = "p1"
        player = new_player(pid, name, PLAYER_COLORS[0])
        player["is_host"] = True
        game["players"].append(player)
        GAMES[code] = game
        log(game, f"{name} founded the campaign.")
    return jsonify({"code": code, "player_id": pid})


@polywars_bp.route("/join", methods=["POST"])
def join_game():
    data = request.get_json(force=True)
    code = (data.get("code") or "").strip().upper()
    name = (data.get("name") or "Commander").strip()[:20] or "Commander"
    with LOCK:
        game = GAMES.get(code)
        if not game:
            return jsonify({"error": "No campaign found with that code."}), 404
        if game["status"] != "lobby":
            return jsonify({"error": "That campaign has already started."}), 400
        if len(game["players"]) >= len(PLAYER_COLORS):
            return jsonify({"error": "Campaign is full."}), 400
        pid = f"p{len(game['players']) + 1}"
        color = PLAYER_COLORS[len(game["players"]) % len(PLAYER_COLORS)]
        player = new_player(pid, name, color)
        game["players"].append(player)
        log(game, f"{name} joined the campaign.")
    return jsonify({"code": code, "player_id": pid})


@polywars_bp.route("/start", methods=["POST"])
def start_game():
    data = request.get_json(force=True)
    code = data.get("code")
    pid = data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game:
            return jsonify({"error": "Unknown campaign."}), 404
        player = next((p for p in game["players"] if p["id"] == pid), None)
        if not player or not player["is_host"]:
            return jsonify({"error": "Only the host can start the campaign."}), 403
        if len(game["players"]) < 2:
            return jsonify({"error": "Need at least 2 commanders to start."}), 400
        game["status"] = "active"
        game["round"] = 1
        log(game, "The campaign begins! Roll to advance your front.")
    return jsonify(public_state(game, pid))


@polywars_bp.route("/state/<code>")
def get_state(code):
    pid = request.args.get("player_id")
    game = GAMES.get(code.upper())
    if not game:
        return jsonify({"error": "Unknown campaign."}), 404
    return jsonify(public_state(game, pid))


@polywars_bp.route("/roll", methods=["POST"])
def roll_dice():
    data = request.get_json(force=True)
    code = data.get("code")
    pid = data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Campaign not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if game["dice"] is not None:
            return jsonify({"error": "You already rolled this turn."}), 400
        d1, d2 = random.randint(1, 6), random.randint(1, 6)
        game["dice"] = [d1, d2]
        if cp["sieged"]:
            cp["sieged"] = False
            log(game, f"{cp['name']} breaks the siege but stays put this turn.")
        else:
            cp["position"] = advance_position(cp["position"], d1 + d2)
            log(game, f"{cp['name']} rolls {d1}+{d2} and advances to {game['board'][cp['position']]['name']}.")
            resolve_landing(game, cp)
        check_win(game)
    return jsonify(public_state(game, pid))


@polywars_bp.route("/buy", methods=["POST"])
def buy_property():
    data = request.get_json(force=True)
    code = data.get("code")
    pid = data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Campaign not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        tile = game["board"][cp["position"]]
        if tile.get("type") != "property" or tile.get("owner") is not None:
            return jsonify({"error": "This tile cannot be bought."}), 400
        if cp["money"] < tile["price"]:
            return jsonify({"error": "Not enough supply to purchase."}), 400
        cp["money"] -= tile["price"]
        tile["owner"] = cp["id"]
        log(game, f"{cp['name']} claims {tile['name']} for {tile['price']}.")
    return jsonify(public_state(game, pid))


@polywars_bp.route("/end_turn", methods=["POST"])
def end_turn():
    data = request.get_json(force=True)
    code = data.get("code")
    pid = data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Campaign not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if game["dice"] is None:
            return jsonify({"error": "Roll before ending your turn."}), 400
        expand_fronts(game, cp)
        check_win(game)
        game["dice"] = None
        if game["status"] == "active":
            n = len(game["players"])
            nxt = (game["turn"] + 1) % n
            tries = 0
            while game["players"][nxt]["bankrupt"] and tries < n:
                nxt = (nxt + 1) % n
                tries += 1
            if nxt <= game["turn"]:
                game["round"] += 1
            game["turn"] = nxt
    return jsonify(public_state(game, pid))