"""
TOWN CLAIM — backend (Monopoly-style board game).

All *content* lives in the JSON files under ./data and is re-read as soon
as you edit any file (mtime cache). Change a street rent, a tax amount, a
card, or the whole board layout and the game follows along next request.

Each new campaign snapshots the current data files, so mid-game edits only
affect games created after the change (as classic tabletop would).

Mounted by the outer app:
    from apps.townclaim.routes import townclaim_bp
    app.register_blueprint(townclaim_bp, url_prefix="/apps/townclaim")
"""

import json
import os
import random
import threading
import time
import string as _string

from flask import Blueprint, request, jsonify

townclaim_bp = Blueprint("townclaim", __name__)
LOCK = threading.Lock()

# --------------------------------------------------------------------------
# data loader
# --------------------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_CACHE = {}


def load(name):
    """Read data/<name>.json, cached by file mtime so edits go live."""
    path = os.path.join(DATA_DIR, name + ".json")
    mtime = os.path.getmtime(path)
    hit = _CACHE.get(name)
    if hit and hit[0] == mtime:
        return hit[1]
    with open(path, "r", encoding="utf-8-sig") as fh:
        data = json.load(fh)
    _CACHE[name] = (mtime, data)
    return data


def cfg():
    return load("config")


CORNER_NAMES = {
    "go": "GO",
    "jail": "JAIL / Just Visiting",
    "free_parking": "FREE PARKING",
    "go_to_jail": "GO TO JAIL",
}


def build_board():
    """Assemble the board from board.json + streets.json + railways.json."""
    board = {}
    street_data = load("streets")
    rail_data = load("railways")
    for spec in sorted(load("board")["tiles"], key=lambda s: s["i"]):
        i = spec["i"]
        t = spec["type"]
        if t == "corner":
            kind = spec["kind"]
            board[i] = {"index": i, "type": "corner", "kind": kind,
                        "name": CORNER_NAMES.get(kind, kind), "owner": None}
        elif t == "street":
            sid = spec["street"]
            s = street_data["streets"][sid]
            terr = street_data["territories"][s["territory"]]
            board[i] = {"index": i, "type": "street", "street_id": sid,
                        "name": s["name"], "territory": s["territory"],
                        "color": terr["color"], "price": s["price"],
                        "rents": list(s["rents"]), "houses": 0, "owner": None,
                        "build_price": terr["house_price"]}
        elif t == "railway":
            r = rail_data["stations"][spec["rail"]]
            board[i] = {"index": i, "type": "railway", "rail_id": spec["rail"],
                        "name": r["name"], "price": r["price"],
                        "color": r.get("color", "#8d99ae"),
                        "base_rent": r.get("base_rent", 25), "owner": None}
        elif t == "chance":
            board[i] = {"index": i, "type": "chance", "deck": spec.get("deck", "chance"),
                        "name": "CHANCE", "owner": None}
        elif t == "community":
            board[i] = {"index": i, "type": "community", "deck": spec.get("deck", "community"),
                        "name": "COMMUNITY", "owner": None}
        elif t == "tax":
            board[i] = {"index": i, "type": "tax", "name": spec.get("name", "TAX"),
                        "amount": spec.get("amount", 100), "owner": None}
        else:
            raise ValueError(f"unknown tile type {t!r} at position {i}")
    return board


def new_code():
    return "".join(random.choices(_string.ascii_uppercase + _string.digits, k=5))


PLAYER_COLORS = ["#e26d5c", "#3f9d63", "#2f7fb3", "#b8860b",
                 "#9b8ce6", "#e078b0", "#5fc8d5", "#d5a05f"]
TOKEN_NAMES = ["cat", "fox", "bear", "owl", "rabbit", "dog", "horse", "frog"]
TOKEN_EMOJI = {"cat": "🐱", "fox": "🦊", "bear": "🐻", "owl": "🦉",
               "rabbit": "🐰", "dog": "🐶", "horse": "🐴", "frog": "🐸"}
GAMES = {}


def new_game(code):
    return {
        "code": code,
        "status": "lobby",
        "board": build_board(),
        "chance_decks": {},
        "last_card": None,
        "card_seq": 0,
        "players": [],
        "turn": 0,
        "round": 0,
        "dice": None,
        "doubles": 0,
        "jackpot": 0,
        "pending_trades": [],
        "auction": None,
        "log": [],
        "winner": None,
        "created": time.time(),
    }


def new_player(pid, name, color, token):
    return {"id": pid, "name": name, "color": color, "token": token,
            "money": cfg()["starting_money"], "position": 0,
            "jail_turns": None, "bankrupt": False, "is_host": False,
            "get_out_of_jail": 0}


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------
def log(game, text):
    game["log"].insert(0, text)
    game["log"] = game["log"][:80]


def current_player(game):
    if not game["players"]:
        return None
    return game["players"][game["turn"] % len(game["players"])]


def player_by(game, pid):
    return next((p for p in game["players"] if p["id"] == pid), None)


def territory_streets(game, tid):
    return [t for t in game["board"].values()
            if t.get("type") == "street" and t.get("territory") == tid]


def has_full_territory(game, pid, tid):
    streets = territory_streets(game, tid)
    return bool(streets) and all(t.get("owner") == pid for t in streets)


def street_rent(game, tile):
    if tile["houses"] == 0 and has_full_territory(game, tile["owner"], tile["territory"]):
        return tile["rents"][0] * 2
    return tile["rents"][min(tile["houses"], len(tile["rents"]) - 1)]


def rail_rent(game, tile):
    owned = sum(1 for t in game["board"].values()
                if t.get("type") == "railway" and t.get("owner") == tile["owner"])
    return tile["base_rent"] * (2 ** (owned - 1))


def find_corner(game, kind):
    for t in game["board"].values():
        if t.get("type") == "corner" and t.get("kind") == kind:
            return t["index"]
    return 0


def salary(game, player):
    amt = cfg()["pass_go"]
    player["money"] += amt
    log(game, f"{player['name']} passes GO — collects {cur(game)}{amt}.")


def cur(game):
    return f"{cfg().get('currency', 'CHF')} "


def send_to_jail(game, player):
    player["position"] = find_corner(game, "jail")
    player["jail_turns"] = 0
    log(game, f"{player['name']} goes directly to JAIL — do not pass GO.")


def pay_bank(game, player, amount, label="Bank"):
    player["money"] -= amount
    if cfg().get("free_parking_jackpot", True):
        game["jackpot"] += amount
    log(game, f"{player['name']} pays {cur(game)}{amount} to {label}.")
    if player["money"] < 0:
        bankrupt(game, player)


def resolve_landing(game, player):
    tile = game["board"][player["position"]]
    t = tile["type"]
    if t == "corner":
        kind = tile["kind"]
        if kind == "jail":
            log(game, f"{player['name']} is visiting the lock-up — just visiting.")
        elif kind == "go":
            log(game, f"{player['name']} lands on GO.")
        elif kind == "free_parking":
            if cfg().get("free_parking_jackpot", True) and game["jackpot"] > 0:
                amt = game["jackpot"]
                game["jackpot"] = 0
                player["money"] += amt
                log(game, f"{player['name']} collects the FREE PARKING pot of {cur(game)}{amt}!")
            else:
                log(game, f"{player['name']} rests at FREE PARKING.")
        elif kind == "go_to_jail":
            send_to_jail(game, player)
    elif t == "chance":
        draw_card(game, player, tile["deck"])
    elif t == "tax":
        pay_bank(game, player, tile["amount"], tile["name"])
    elif t == "street":
        if tile["owner"] is None:
            log(game, f"{tile['name']} is unclaimed — {cur(game)}{tile['price']} to claim.")
        elif tile["owner"] != player["id"]:
            owner = player_by(game, tile["owner"])
            rent = street_rent(game, tile)
            pay(game, player, rent, owner)
            log(game, f"{player['name']} pays {cur(game)}{rent} rent to {owner['name']} at {tile['name']}.")
    elif t == "railway":
        if tile["owner"] is None:
            log(game, f"{tile['name']} is unowned — {cur(game)}{tile['price']} to open a station.")
        elif tile["owner"] != player["id"]:
            owner = player_by(game, tile["owner"])
            rent = rail_rent(game, tile)
            pay(game, player, rent, owner)
            log(game, f"{player['name']} pays {cur(game)}{rent} to {owner['name']} at {tile['name']}.")


def pay(game, payer, amount, payee=None):
    payer["money"] -= amount
    if payee:
        payee["money"] += amount
    if payer["money"] < 0:
        bankrupt(game, payer)


def advance(game, player, steps, collect_go=True):
    n = len(game["board"])
    old = player["position"]
    new = (old + steps) % n
    if collect_go and steps > 0 and old + steps >= n:
        salary(game, player)
    player["position"] = new
    log(game, f"{player['name']} moves {steps} to {game['board'][new]['name']}.")
    resolve_landing(game, player)


def bankrupt(game, player):
    if player["bankrupt"]:
        return
    player["bankrupt"] = True
    player["money"] = 0
    for tile in game["board"].values():
        if tile.get("owner") == player["id"]:
            tile["owner"] = None
            tile["houses"] = 0
    game["pending_trades"] = [t for t in game["pending_trades"] if t["from"] != player["id"] and t["to"] != player["id"]]
    log(game, f"{player['name']} goes bankrupt and loses all property.")
    check_win(game)


def check_win(game):
    alive = [p for p in game["players"] if not p["bankrupt"]]
    if len(alive) == 1 and len(game["players"]) > 1:
        game["status"] = "finished"
        game["winner"] = alive[0]["id"]
        log(game, f"{alive[0]['name']} wins — last one standing.")
    elif game["round"] >= cfg()["max_rounds"]:
        def net_worth(p):
            props = sum(t["price"] for t in game["board"].values()
                        if t.get("owner") == p["id"] and t.get("type") in ("street", "railway"))
            houses = sum(t.get("houses", 0) * t.get("build_price", 0)
                         for t in game["board"].values()
                         if t.get("owner") == p["id"] and t.get("type") == "street")
            return p["money"] + props + houses
        best = max(game["players"], key=net_worth)
        game["status"] = "finished"
        game["winner"] = best["id"]
        log(game, f"Round cap reached — {best['name']} wins on net worth.")


# --------------------------------------------------------------------------
# cards
# --------------------------------------------------------------------------
def deck_draw(game, deck_id):
    deck = game["chance_decks"].get(deck_id)
    if not deck:
        deck = list(load("cards")["decks"][deck_id]["cards"])
        random.shuffle(deck)
        game["chance_decks"][deck_id] = deck
    card = deck.pop(0)
    deck.append(card)          # recycle forever
    return card


def draw_card(game, player, deck_id):
    card = deck_draw(game, deck_id)
    game["card_seq"] += 1
    result = play_card(game, player, card)
    title = load("cards")["decks"][deck_id]["title"]
    game["last_card"] = {"seq": game["card_seq"], "title": title,
                         "text": card["text"], "result": result or "done"}
    log(game, f"{player['name']} draws: {card['text']} — {result or 'done'}.")


def play_card(game, player, card):
    act = card["action"]
    c = cur(game)
    if act == "collect":
        player["money"] += card["amount"]
        return f"+{c}{card['amount']}"
    if act == "pay":
        pay(game, player, card["amount"])
        return f"-{c}{card['amount']}"
    if act == "pay_all":
        amt = card["amount"]
        others = [p for p in game["players"] if p is not player]
        for p in others:
            p["money"] += amt
        player["money"] -= amt * len(others)
        if player["money"] < 0:
            bankrupt(game, player)
        return f"-{c}{amt} to each rival"
    if act == "collect_all":
        amt = card["amount"]
        others = [p for p in game["players"] if p is not player]
        for p in others:
            p["money"] -= amt
            if p["money"] < 0:
                bankrupt(game, p)
        player["money"] += amt * len(others)
        return f"+{c}{amt} from each rival"
    if act == "move":
        advance(game, player, card["steps"], collect_go=False)
        return "moved"
    if act == "go_to":
        target = find_corner(game, card["tile"])
        player["position"] = target
        if card.get("collect"):
            player["money"] += card["collect"]
            return f"arrived at {game['board'][target]['name']}, +{c}{card['collect']}"
        return f"arrived at {game['board'][target]['name']}"
    if act == "jail":
        send_to_jail(game, player)
        return "straight to jail!"
    if act == "jail_free":
        player["get_out_of_jail"] += 1
        return "keep it — Get Out of Jail Free!"
    if act == "nearest_rail":
        n = len(game["board"])
        pos = player["position"]
        for step in range(1, n + 1):
            idx = (pos + step) % n
            if game["board"][idx]["type"] == "railway":
                player["position"] = idx
                resolve_landing(game, player)
                return "made it to the platform"
        return "no platforms open"
    if act == "repairs":
        houses = sum(min(t["houses"], 4) for t in game["board"].values()
                     if t.get("type") == "street" and t.get("owner") == player["id"])
        hotels = sum(1 for t in game["board"].values()
                     if t.get("type") == "street" and t.get("owner") == player["id"] and t.get("houses", 0) >= 5)
        cost = houses * card["house"] + hotels * card["hotel"]
        pay(game, player, cost)
        return f"-{c}{cost} for repairs"
    return ""


# --------------------------------------------------------------------------
# auctions
# --------------------------------------------------------------------------
def start_auction(game, tile):
    game["auction"] = {
        "tile_index": tile["index"],
        "highest_bidder": None,
        "highest_bid": 0,
        "min_bid": max(1, tile["price"] // 10),
        "ends_at": time.time() + 20,
        "last_bid": None,
    }
    log(game, f"Auction for {tile['name']} opens — starting bid {cur(game)}{game['auction']['min_bid']}.")


def public_auction(game):
    a = game.get("auction")
    if not a:
        return None
    tile = game["board"][a["tile_index"]]
    return {
        "tile_index": a["tile_index"],
        "tile_name": tile["name"],
        "tile_color": tile.get("color"),
        "highest_bidder": a["highest_bidder"],
        "highest_bid": a["highest_bid"],
        "min_bid": a["min_bid"],
        "ends_at": a["ends_at"],
    }


# --------------------------------------------------------------------------
# public state
# --------------------------------------------------------------------------
def public_state(game, viewer_id=None):
    c = cfg()
    cp = current_player(game)
    return {
        "code": game["code"],
        "status": game["status"],
        "round": game["round"],
        "players": game["players"],
        "board": [game["board"][k] for k in sorted(game["board"])],
        "turn_player_id": cp["id"] if cp else None,
        "dice": game["dice"],
        "doubles": game["doubles"],
        "jackpot": game["jackpot"],
        "log": game["log"],
        "winner": game["winner"],
        "last_card": game["last_card"],
        "chance_decks": {k: len(v) for k, v in game["chance_decks"].items()},
        "pending_trades": [t for t in game["pending_trades"]
                           if t["to"] == viewer_id or t["from"] == viewer_id],
        "auction": public_auction(game),
        "you": viewer_id,
        "config": {
            "game_name": c.get("game_name", "TOWN CLAIM"),
            "currency": c.get("currency", "CHF"),
            "pass_go": c["pass_go"],
            "max_rounds": c["max_rounds"],
            "starting_money": c["starting_money"],
            "jail": c["jail"],
        },
    }


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------
@townclaim_bp.route("/create", methods=["POST"])
def create_game():
    data = request.get_json(force=True)
    name = (data.get("name") or "Mayor").strip()[:20] or "Mayor"
    with LOCK:
        code = new_code()
        while code in GAMES:
            code = new_code()
        game = new_game(code)
        pid = "p1"
        player = new_player(pid, name, PLAYER_COLORS[0], TOKEN_NAMES[0])
        player["is_host"] = True
        game["players"].append(player)
        GAMES[code] = game
        log(game, f"{name} founded a new town.")
    return jsonify({"code": code, "player_id": pid})


@townclaim_bp.route("/join", methods=["POST"])
def join_game():
    data = request.get_json(force=True)
    code = (data.get("code") or "").strip().upper()
    name = (data.get("name") or "Mayor").strip()[:20] or "Mayor"
    with LOCK:
        game = GAMES.get(code)
        if not game:
            return jsonify({"error": "No town found with that code."}), 404
        if game["status"] != "lobby":
            return jsonify({"error": "That town has already started."}), 400
        if len(game["players"]) >= len(PLAYER_COLORS):
            return jsonify({"error": "Town is full (max 8 players)."}), 400
        if any(p["name"].lower() == name.lower() for p in game["players"]):
            return jsonify({"error": "That name is already taken."}), 400
        pid = f"p{len(game['players']) + 1}"
        color = PLAYER_COLORS[len(game["players"])]
        token = TOKEN_NAMES[len(game["players"])]
        player = new_player(pid, name, color, token)
        game["players"].append(player)
        log(game, f"{name} joined the town.")
    return jsonify({"code": code, "player_id": pid})


@townclaim_bp.route("/start", methods=["POST"])
def start_game():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game:
            return jsonify({"error": "Unknown town."}), 404
        player = next((p for p in game["players"] if p["id"] == pid), None)
        if not player or not player["is_host"]:
            return jsonify({"error": "Only the host can start the town."}), 403
        if len(game["players"]) < 2:
            return jsonify({"error": "Need at least 2 players to start."}), 400
        game["status"] = "active"
        game["round"] = 1
        log(game, "The town opens! Roll to move.")
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/state/<code>")
def get_state(code):
    pid = request.args.get("player_id")
    game = GAMES.get(code.upper())
    if not game:
        return jsonify({"error": "Unknown town."}), 404
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/roll", methods=["POST"])
def roll_dice():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if game["dice"] is not None:
            return jsonify({"error": "You already rolled this turn."}), 400
        d1, d2 = random.randint(1, 6), random.randint(1, 6)
        game["dice"] = [d1, d2]
        jail = cfg()["jail"]
        if cp["jail_turns"] is not None:
            if d1 == d2 and jail.get("doubles_free", True):
                cp["jail_turns"] = None
                log(game, f"{cp['name']} rolls doubles and leaves jail.")
                advance(game, cp, d1 + d2)
            else:
                cp["jail_turns"] += 1
                if cp["jail_turns"] >= jail["max_turns"]:
                    bail = jail["bail"]
                    if cp["money"] >= bail:
                        cp["money"] -= bail
                        cp["jail_turns"] = None
                        log(game, f"{cp['name']} pays {cur(game)}{bail} and is released.")
                        advance(game, cp, d1 + d2)
                    else:
                        log(game, f"{cp['name']} cannot afford {cur(game)}{bail} bail — stays in jail.")
                else:
                    log(game, f"{cp['name']} rolls {d1}+{d2} — still jailed (attempt {cp['jail_turns']}/{jail['max_turns']}).")
        else:
            if d1 == d2:
                game["doubles"] += 1
                if game["doubles"] >= 3:
                    game["doubles"] = 0
                    send_to_jail(game, cp)
                    game["dice"] = None
                    log(game, f"{cp['name']} rolls three doubles — straight to jail!")
                    check_win(game)
                    return jsonify(public_state(game, pid))
                log(game, f"{cp['name']} rolls doubles ({d1}+{d2}) — roll again!")
            else:
                game["doubles"] = 0
            advance(game, cp, d1 + d2)
        check_win(game)
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/buy", methods=["POST"])
def buy_property():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        tile = game["board"][cp["position"]]
        if tile["type"] not in ("street", "railway") or tile["owner"] is not None:
            return jsonify({"error": "This tile cannot be bought right now."}), 400
        if cp["money"] < tile["price"]:
            return jsonify({"error": "Not enough money."}), 400
        cp["money"] -= tile["price"]
        tile["owner"] = cp["id"]
        if tile["type"] == "railway":
            custom = (data.get("name") or "").strip()[:18]
            if custom:
                tile["name"] = custom
            log(game, f"{cp['name']} opens {tile['name']} as a station.")
        else:
            if has_full_territory(game, cp["id"], tile["territory"]):
                label = load("streets")["territories"][tile["territory"]]["label"]
                log(game, f"{cp['name']} now owns the whole {label} district!")
            log(game, f"{cp['name']} claims {tile['name']} for {cur(game)}{tile['price']}.")
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/auction", methods=["POST"])
def auction_property():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if game["auction"]:
            return jsonify({"error": "An auction is already running."}), 400
        tile = game["board"][cp["position"]]
        if tile["type"] not in ("street", "railway") or tile["owner"] is not None:
            return jsonify({"error": "This tile cannot be auctioned."}), 400
        start_auction(game, tile)
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/bid", methods=["POST"])
def bid():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    bid = int(data.get("bid") or 0)
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        a = game.get("auction")
        if not a:
            return jsonify({"error": "No auction running."}), 400
        if time.time() > a["ends_at"]:
            return jsonify({"error": "Auction already closed."}), 400
        player = player_by(game, pid)
        if not player or player["bankrupt"]:
            return jsonify({"error": "You cannot bid."}), 400
        min_bid = a["highest_bid"] + 1
        if bid < max(a["min_bid"], min_bid):
            return jsonify({"error": f"Bid at least {cur(game)}{max(a['min_bid'], min_bid)}."}), 400
        if player["money"] < bid:
            return jsonify({"error": "Not enough money."}), 400
        a["highest_bidder"] = pid
        a["highest_bid"] = bid
        a["last_bid"] = player["name"]
        a["ends_at"] = max(a["ends_at"], time.time() + 8)
        log(game, f"{player['name']} bids {cur(game)}{bid} for {game['board'][a['tile_index']]['name']}.")
    return jsonify(public_state(game, pid))


def close_auction(game):
    a = game.get("auction")
    if not a:
        return
    if time.time() < a["ends_at"]:
        return
    tile = game["board"][a["tile_index"]]
    winner = player_by(game, a["highest_bidder"]) if a["highest_bidder"] else None
    if winner:
        winner["money"] -= a["highest_bid"]
        tile["owner"] = winner["id"]
        log(game, f"{winner['name']} wins the auction for {tile['name']} at {cur(game)}{a['highest_bid']}.")
    else:
        log(game, f"No bids for {tile['name']} — it stays on the market.")
    game["auction"] = None


@townclaim_bp.route("/build", methods=["POST"])
def build_house():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        tile = game["board"][cp["position"]]
        if tile["type"] != "street" or tile["owner"] != cp["id"]:
            return jsonify({"error": "Build only on a street you already own."}), 400
        if not has_full_territory(game, cp["id"], tile["territory"]):
            return jsonify({"error": "Own the whole district first."}), 400
        if tile["houses"] >= 5:
            return jsonify({"error": "This street is fully upgraded."}), 400
        cost = tile["build_price"]
        if cp["money"] < cost:
            return jsonify({"error": "Not enough money to build."}), 400
        cp["money"] -= cost
        tile["houses"] += 1
        log(game, f"{cp['name']} builds a house on {tile['name']} (now level {tile['houses']}).")
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/bail", methods=["POST"])
def bail_player():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if cp["jail_turns"] is None:
            return jsonify({"error": "You're not in jail."}), 400
        if cp["get_out_of_jail"] > 0:
            cp["get_out_of_jail"] -= 1
            cp["jail_turns"] = None
            log(game, f"{cp['name']} uses a Get Out of Jail Free card and is released.")
            return jsonify(public_state(game, pid))
        bail = cfg()["jail"]["bail"]
        if cp["money"] < bail:
            return jsonify({"error": "Not enough money for bail."}), 400
        cp["money"] -= bail
        cp["jail_turns"] = None
        if cfg().get("free_parking_jackpot", True):
            game["jackpot"] += bail
        log(game, f"{cp['name']} posts bail and is released.")
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/trade", methods=["POST"])
def propose_trade():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    to = data.get("to")
    give = data.get("give") or []
    want = data.get("want") or []
    money_give = int(data.get("money_give") or 0)
    money_want = int(data.get("money_want") or 0)
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        sender = player_by(game, pid)
        target = player_by(game, to)
        if not sender or not target or sender["bankrupt"] or target["bankrupt"]:
            return jsonify({"error": "Invalid trade participants."}), 400
        if sender is target:
            return jsonify({"error": "You can't trade with yourself."}), 400
        if money_give < 0 or money_want < 0:
            return jsonify({"error": "Money amounts must be non-negative."}), 400
        if money_give > sender["money"] or money_want > target["money"]:
            return jsonify({"error": "A party can't afford this trade."}), 400
        for idx in list(give) + list(want):
            tile = game["board"].get(int(idx))
            if not tile or tile["type"] not in ("street", "railway"):
                return jsonify({"error": "Invalid property in trade."}), 400
        for idx in give:
            if game["board"][int(idx)].get("owner") != sender["id"]:
                return jsonify({"error": "You don't own something you're giving."}), 400
        for idx in want:
            if game["board"][int(idx)].get("owner") != target["id"]:
                return jsonify({"error": "You can't request property you don't own."}), 400
        game["pending_trades"].append({
            "id": f"t{int(time.time() * 1000)}",
            "from": sender["id"], "from_name": sender["name"],
            "to": target["id"], "to_name": target["name"],
            "give": [int(i) for i in give],
            "want": [int(i) for i in want],
            "money_give": money_give, "money_want": money_want,
            "created": time.time(),
        })
        log(game, f"{sender['name']} offers a trade to {target['name']}.")
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/trade_response", methods=["POST"])
def trade_response():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    tid = data.get("trade_id")
    accept = bool(data.get("accept"))
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        trade = next((t for t in game["pending_trades"] if t["id"] == tid), None)
        if not trade:
            return jsonify({"error": "Trade not found."}), 404
        if trade["to"] != pid:
            return jsonify({"error": "This trade is not addressed to you."}), 403
        a = trade
        sender = player_by(game, a["from"])
        target = player_by(game, a["to"])
        if accept:
            if sender["money"] < a["money_give"] or target["money"] < a["money_want"]:
                game["pending_trades"] = [t for t in game["pending_trades"] if t["id"] != tid]
                log(game, "Trade failed — one party can no longer afford it.")
                return jsonify(public_state(game, pid))
            for idx in a["give"]:
                tile = game["board"][idx]
                if tile.get("owner") != sender["id"]:
                    game["pending_trades"] = [t for t in game["pending_trades"] if t["id"] != tid]
                    log(game, "Trade failed — property ownership changed.")
                    return jsonify(public_state(game, pid))
            for idx in a["want"]:
                if game["board"][idx].get("owner") != target["id"]:
                    game["pending_trades"] = [t for t in game["pending_trades"] if t["id"] != tid]
                    log(game, "Trade failed — property ownership changed.")
                    return jsonify(public_state(game, pid))
            for idx in a["give"]:
                game["board"][idx]["owner"] = target["id"]
            for idx in a["want"]:
                game["board"][idx]["owner"] = sender["id"]
            sender["money"] -= a["money_give"]
            target["money"] += a["money_give"]
            target["money"] -= a["money_want"]
            sender["money"] += a["money_want"]
            log(game, f"{sender['name']} and {target['name']} complete a trade. 🤝")
        else:
            log(game, f"{target['name']} declines a trade from {sender['name']}.")
        game["pending_trades"] = [t for t in game["pending_trades"] if t["id"] != tid]
    return jsonify(public_state(game, pid))


@townclaim_bp.route("/end_turn", methods=["POST"])
def end_turn():
    data = request.get_json(force=True)
    code, pid = data.get("code"), data.get("player_id")
    with LOCK:
        game = GAMES.get(code)
        if not game or game["status"] != "active":
            return jsonify({"error": "Town not active."}), 400
        cp = current_player(game)
        if not cp or cp["id"] != pid:
            return jsonify({"error": "It is not your turn."}), 403
        if game["dice"] is None:
            return jsonify({"error": "Roll before ending your turn."}), 400
        close_auction(game)
        check_win(game)
        game["dice"] = None
        game["doubles"] = 0
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