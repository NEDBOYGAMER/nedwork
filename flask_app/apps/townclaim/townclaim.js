/* TOWN CLAIM frontend — data driven.
   All board content, prices, cards and station names come from the backend,
   which derives them from the JSON files under /data. */

const API_BASE = window.APP_BASE || "./";
const POLL_MS = 1200;

const CORNER_ICON = { go: "⌂", jail: "⚿", free_parking: "☰", go_to_jail: "⚠" };
const CORNER_ART = {
  go: "assets/go_art.svg",
  jail: "assets/jail_art.svg",
  free_parking: "assets/parking_art.svg",
  go_to_jail: "assets/tax_art.svg",
};
const RAIL_ICON = "🚉";
const CHANCE_ICON = "?";
const COMMUNITY_ICON = "✚";
const TAX_ICON = "₣";
const TOKEN_EMOJI = { cat: "🐱", fox: "🦊", bear: "🐻", owl: "🦉", rabbit: "🐰", dog: "🐶", horse: "🐴", frog: "🐸" };

let session = { code: null, playerId: null, name: null };
let pollTimer = null;
let lastStatus = "lobby";
let seenCardSeq = 0;
let auctionTimer = null;

const $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function money(n) {
  return "CHF " + Number(n || 0).toLocaleString("de-CH");
}

async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function flashError(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(flashError._t);
  flashError._t = setTimeout(() => t.classList.add("hidden"), 3200);
}

/* ---------- token art ---------- */
function tokenImg(token, cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.src = `${API_BASE}assets/token-${token || "cat"}.svg`;
  img.alt = "";
  img.addEventListener("error", () => {
    const s = document.createElement("span");
    s.className = cls + " token-emoji";
    s.textContent = TOKEN_EMOJI[token] || "🐱";
    img.replaceWith(s);
  });
  return img;
}

/* ---------- home ---------- */
$("#btn-create").addEventListener("click", async () => {
  const name = $("#create-name").value.trim() || "Mayor";
  try {
    const data = await api("create", { name });
    session = { code: data.code, playerId: data.player_id, name };
    enterLobby();
  } catch (e) { $("#home-error").textContent = e.message; }
});

$("#btn-join").addEventListener("click", async () => {
  const name = $("#join-name").value.trim() || "Mayor";
  const code = $("#join-code").value.trim().toUpperCase();
  if (!code) { $("#home-error").textContent = "Enter a town code."; return; }
  try {
    const data = await api("join", { name, code });
    session = { code: data.code, playerId: data.player_id, name };
    enterLobby();
  } catch (e) { $("#home-error").textContent = e.message; }
});

function enterLobby() {
  $("#home-error").textContent = "";
  $("#lobby-code").textContent = session.code;
  showScreen("#screen-lobby");
  startPolling();
}

$("#btn-start").addEventListener("click", async () => {
  try { await api("start", { code: session.code, player_id: session.playerId }); }
  catch (e) {
    $("#lobby-hint").textContent = e.message;
    $("#lobby-hint").style.color = "var(--danger)";
  }
});

function renderLobby(state) {
  const list = $("#lobby-player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = el("li");
    li.appendChild(tokenImg(p.token, "token-img"));
    li.appendChild(document.createTextNode(p.name + (p.is_host ? " (host)" : "")));
    list.appendChild(li);
  });
  const me = state.players.find((p) => p.id === session.playerId);
  const isHost = me && me.is_host;
  $("#btn-start").classList.toggle("hidden", !isHost);
  $("#lobby-hint").classList.toggle("hidden", isHost);
  if (isHost && state.players.length < 2) {
    $("#btn-start").disabled = true;
    $("#lobby-hint").textContent = "Need at least 2 players to start.";
    $("#lobby-hint").classList.remove("hidden");
  } else {
    $("#btn-start").disabled = false;
  }
}

/* ---------- game actions ---------- */
$("#btn-roll").addEventListener("click", async () => {
  try { await api("roll", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-buy").addEventListener("click", async () => {
  const lane = $("#rail-name");
  const name = lane && !lane.classList.contains("hidden") ? lane.value.trim() : undefined;
  try { await api("buy", { code: session.code, player_id: session.playerId, name }); }
  catch (e) { flashError(e.message); }
});

$("#btn-auction").addEventListener("click", async () => {
  try {
    await api("auction", { code: session.code, player_id: session.playerId });
    auctionDismissed = false;
    $("#auction-modal").classList.remove("hidden");
  } catch (e) { flashError(e.message); }
});

$("#btn-build").addEventListener("click", async () => {
  try { await api("build", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-bail").addEventListener("click", async () => {
  try { await api("bail", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-jail-free").addEventListener("click", async () => {
  try { await api("bail", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-end").addEventListener("click", async () => {
  try { await api("end_turn", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-new-game").addEventListener("click", () => {
  stopPolling();
  session = { code: null, playerId: null, name: null };
  $("#winner-banner").classList.add("hidden");
  $("#create-name").value = "";
  $("#join-name").value = "";
  $("#join-code").value = "";
  seenCardSeq = 0;
  showScreen("#screen-home");
});

$("#card-ok").addEventListener("click", () => $("#card-modal").classList.add("hidden"));
$("#auction-close").addEventListener("click", () => {
  auctionDismissed = true;
  $("#auction-modal").classList.add("hidden");
  clearInterval(auctionTimer);
});
$("#btn-bid").addEventListener("click", async () => {
  const bid = parseInt($("#auction-bid").value, 10);
  try {
    await api("bid", { code: session.code, player_id: session.playerId, bid });
    $("#auction-bid").value = "";
  } catch (e) { flashError(e.message); }
});
$("#trade-cancel").addEventListener("click", () => $("#trade-modal").classList.add("hidden"));
$("#trade-send").addEventListener("click", async () => {
  const to = $("#trade-target").value;
  const money_give = parseInt($("#trade-give-money").value || 0, 10);
  const money_want = parseInt($("#trade-want-money").value || 0, 10);
  const give = [...document.querySelectorAll("#trade-give-props .trade-prop.selected")]
    .map((n) => n.dataset.index);
  const want = [...document.querySelectorAll("#trade-want-props .trade-prop.selected")]
    .map((n) => n.dataset.index);
  if (!to) { flashError("Pick someone to trade with."); return; }
  if (give.length === 0 && want.length === 0 && money_give === 0 && money_want === 0) {
    flashError("Offer something."); return;
  }
  try {
    await api("trade", { code: session.code, player_id: session.playerId, to, give, want, money_give, money_want });
    $("#trade-modal").classList.add("hidden");
  } catch (e) { flashError(e.message); }
});
$("#btn-trade").addEventListener("click", () => openTradeModal());

/* ---------- dice pips ---------- */
const DICE_LAYOUT = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
function renderDie(el, value) {
  const grid = el.querySelector(".die-grid");
  grid.innerHTML = "";
  if (value == null) return;
  const cells = DICE_LAYOUT[value] || [];
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement("div");
    pip.className = "pip";
    pip.style.visibility = cells.includes(i) ? "visible" : "hidden";
    grid.appendChild(pip);
  }
}

/* ---------- board geometry ---------- */
/* GO sits in the bottom-left corner and travel goes clockwise:
   bottom edge left→right, up the right edge, top edge right→left,
   down the left edge. */
function gridPositions(n) {
  const side = n / 4 + 1;
  const pos = new Array(n);
  let k = 0;
  for (let c = 1; c <= side; c++) pos[k++] = { r: side, c };          // bottom edge: GO (bottom-left) → JAIL
  for (let r = side - 1; r >= 1; r--) pos[k++] = { r, c: side };      // right edge: bottom → top
  for (let c = side - 1; c >= 1; c--) pos[k++] = { r: 1, c };         // top edge: right → left
  for (let r = 2; r <= side - 1; r++) pos[k++] = { r, c: 1 };         // left edge: top → bottom
  return pos;
}

function buildBoard(state) {
  const board = $("#board");
  const n = state.board.length;
  const grid = Math.max(3, n / 4 + 1);
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${grid}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${grid}, 1fr)`;

  const emblem = document.createElement("div");
  emblem.className = "center-emblem";
  emblem.style.gridColumn = `2 / ${grid}`;
  emblem.style.gridRow = `2 / ${grid}`;

  const decks = Object.entries(state.chance_decks || {})
    .map(([k, v]) => `${k === "community" ? "Chest" : "Chance"} · ${v}`)
    .join(" · ");

  emblem.innerHTML = `
    <img class="em-logo" src="${API_BASE}assets/logo.svg" alt="" onerror="this.remove()">
    <div class="em-label">TOWN CLAIM</div>
    <div class="em-pot" id="em-pot">Jackpot · ${money(0)}</div>
    <div class="em-decks"><span>${decks || "Chance · —"}</span></div>`;
  board.appendChild(emblem);

  const positions = gridPositions(n);
  for (let i = 0; i < n; i++) {
    const tile = state.board[i];
    const pos = positions[i];
    const div = document.createElement("div");
    div.className = "tile";
    div.style.gridRow = pos.r;
    div.style.gridColumn = pos.c;
    div.setAttribute("data-index", i);

    if (tile.type === "corner") {
      div.classList.add("corner", "corner-" + tile.kind);
      const art = CORNER_ART[tile.kind];
      const icon = art
        ? `<img class="corner-art" src="${API_BASE}${art}" alt="" onerror="this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='">`
        : `<div class="tile-icon">${CORNER_ICON[tile.kind] || "•"}</div>`;
      div.innerHTML = `${icon}<div class="tile-name">${tile.name}</div><div class="tile-tokens"></div>`;
    } else if (tile.type === "chance") {
      div.classList.add("chance");
      div.innerHTML = `<div class="tile-icon">${CHANCE_ICON}</div><div class="tile-name">CHANCE</div><div class="tile-tokens"></div>`;
    } else if (tile.type === "community") {
      div.classList.add("community");
      div.innerHTML = `<div class="tile-icon">${COMMUNITY_ICON}</div><div class="tile-name">COMMUNITY</div><div class="tile-tokens"></div>`;
    } else if (tile.type === "tax") {
      div.classList.add("tax");
      div.innerHTML = `<div class="tile-icon">${TAX_ICON}</div><div class="tile-name">${tile.name || "TAX"}</div><div class="tile-tokens"></div>`;
    } else {
      div.classList.add("property", tile.type);
      const railPrefix = tile.type === "railway" ? RAIL_ICON + " " : "";
      const band = tile.type === "street" || tile.type === "railway"
        ? `<div class="tile-band" style="background:${tile.color}"></div>` : "";
      div.innerHTML = band + `
        <div class="tile-name">${railPrefix}${tile.name}</div>
        <div class="tile-price">${money(tile.price)}</div>
        <div class="tile-houses"></div>
        <div class="tile-tokens"></div>`;
    }
    board.appendChild(div);
  }
}

function renderBoard(state) {
  const emPot = $("#em-pot");
  if (emPot) emPot.textContent = `Jackpot · ${money(state.jackpot)}`;
  const emDecks = document.querySelector(".em-decks span");
  if (emDecks) {
    emDecks.textContent = Object.entries(state.chance_decks || {})
      .map(([k, v]) => `${k === "community" ? "Chest" : "Chance"} · ${v}`)
      .join(" · ");
  }

  const turnP = state.players.find((p) => p.id === state.turn_player_id);
  const landedIdx = turnP && !turnP.bankrupt ? turnP.position : -1;

  for (let i = 0; i < state.board.length; i++) {
    const tile = state.board[i];
    const div = document.querySelector(`.tile[data-index="${i}"]`);
    if (!div) continue;
    const tokens = div.querySelector(".tile-tokens");
    if (tokens) {
      tokens.innerHTML = "";
      state.players.forEach((p) => {
        if (p.position === i && !p.bankrupt) {
          const img = document.createElement("img");
          img.className = "token-svg";
          img.src = `${API_BASE}assets/token-${p.token}.svg`;
          img.alt = "";
          img.addEventListener("error", () => {
            const s = document.createElement("span");
            s.className = "token-svg token-emoji";
            s.textContent = TOKEN_EMOJI[p.token] || "🐱";
            img.replaceWith(s);
          });
          tokens.appendChild(img);
        }
      });
    }
    if (tile.type === "street" || tile.type === "railway") {
      div.classList.toggle("owned", !!tile.owner);
    }
    if (tile.type === "street") {
      const housesEl = div.querySelector(".tile-houses");
      if (housesEl) {
        housesEl.innerHTML = "";
        for (let h = 0; h < Math.min(tile.houses, 5); h++) {
          const pip = document.createElement("span");
          pip.className = "house-pip" + (tile.houses >= 5 ? " hotel-pip" : "");
          housesEl.appendChild(pip);
        }
      }
    }
    div.classList.toggle("landed", i === landedIdx);
    div.classList.toggle("landed-me", i === landedIdx && state.turn_player_id === session.playerId);
  }
}

function fullSet(state, pid, terr) {
  const tiles = state.board.filter((t) => t.type === "street" && t.territory === terr);
  return tiles.length > 0 && tiles.every((t) => t.owner === pid);
}

function renderSide(state) {
  const me = state.players.find((p) => p.id === session.playerId);
  const turnP = state.players.find((p) => p.id === state.turn_player_id);
  const isTurn = state.turn_player_id === session.playerId;
  const hasDice = !!state.dice;
  const inJail = me && me.jail_turns != null;
  const tile = (me && state.board[me.position]) || null;

  const turnToken = $("#turn-token");
  turnToken.innerHTML = "";
  if (turnP) turnToken.appendChild(tokenImg(turnP.token, "token-img"));

  $("#turn-indicator").textContent = turnP ? `${turnP.name}'s move` : "—";
  $("#turn-indicator").style.color = turnP ? turnP.color : "var(--cream)";
  if (inJail) $("#turn-indicator").textContent = `${turnP.name} is IN JAIL`;
  $("#ghdr-round").textContent = `Round ${state.round}`;

  const d1 = $("#die1"), d2 = $("#die2");
  renderDie(d1, state.dice ? state.dice[0] : null);
  renderDie(d2, state.dice ? state.dice[1] : null);

  const diceKey = state.dice ? state.dice.join("-") : "";
  if (diceKey && diceKey !== lastDiceKey) {
    d1.classList.add("rolling");
    d2.classList.add("rolling");
    setTimeout(() => {
      d1.classList.remove("rolling");
      d2.classList.remove("rolling");
    }, 420);
    lastDiceKey = diceKey;
  }

  $("#doubles-badge").classList.toggle("hidden", !(state.doubles > 0 && isTurn));

  $("#btn-roll").classList.toggle("hidden", !isTurn);
  $("#btn-roll").disabled = !(isTurn && !hasDice);
  $("#btn-end").classList.toggle("hidden", !isTurn);
  $("#btn-end").disabled = !(isTurn && hasDice);

  /* bail / jail-free */
  const canUseFree = inJail && me && me.get_out_of_jail > 0;
  const bailBtn = $("#btn-bail");
  const freeBtn = $("#btn-jail-free");
  bailBtn.classList.toggle("hidden", !(isTurn && inJail && !hasDice && !canUseFree));
  freeBtn.classList.toggle("hidden", !(isTurn && inJail && !hasDice && canUseFree));
  if (!bailBtn.classList.contains("hidden")) {
    bailBtn.textContent = `Pay bail ${money(state.config.jail.bail)}`;
    bailBtn.disabled = !(me && me.money >= state.config.jail.bail);
  }
  if (!freeBtn.classList.contains("hidden")) {
    freeBtn.textContent = `Use Get Out of Jail Free (${me.get_out_of_jail})`;
  }

  /* buy / auction */
  const buyBox = $("#buy-box");
  const buyable = isTurn && me && hasDice && tile &&
                  (tile.type === "street" || tile.type === "railway") && tile.owner === null;
  if (buyable && !state.auction) {
    buyBox.classList.remove("hidden");
    $("#buy-text").textContent = `${tile.type === "railway" ? "Station" : "Street"}: ${tile.name} — ${money(tile.price)}`;
    const buyBtn = $("#btn-buy");
    buyBtn.disabled = me.money < tile.price;
    const auctionBtn = $("#btn-auction");
    auctionBtn.disabled = !!state.auction;
    const stationRow = $("#station-name-row");
    if (tile.type === "railway") {
      stationRow.classList.remove("hidden");
      const lane = $("#rail-name");
      if (!lane.value) lane.value = tile.name;
    } else {
      stationRow.classList.add("hidden");
    }
  } else {
    buyBox.classList.add("hidden");
  }

  /* build */
  const buildBox = $("#build-box");
  const fullSetOwned = fullSet(state, me?.id, tile?.territory);
  const canBuild = isTurn && me && hasDice && tile && tile.type === "street" &&
                   tile.owner === me.id && fullSetOwned && tile.houses < 5;
  if (canBuild) {
    buildBox.classList.remove("hidden");
    $("#build-text").textContent = `Build house #${tile.houses + 1} on ${tile.name} — ${money(tile.build_price)}`;
    $("#btn-build").disabled = me.money < tile.build_price;
  } else {
    buildBox.classList.add("hidden");
  }

  /* players */
  const list = $("#player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = el("li");
    li.classList.toggle("active-turn", p.id === state.turn_player_id);
    li.classList.toggle("bankrupt", p.bankrupt);
    const left = el("div", "pl-left");
    left.appendChild(tokenImg(p.token, "pl-token"));
    const name = el("span", "pl-name", p.name + (p.id === session.playerId ? " (you)" : ""));
    left.appendChild(name);
    const right = el("div", "pl-right");
    if (p.jail_turns != null) right.appendChild(el("span", "pl-jail", "🔒"));
    if (p.get_out_of_jail > 0) right.appendChild(el("span", "pl-jail", "🃏"));
    const moneyEl = el("span", "pl-money", money(p.money));
    right.appendChild(moneyEl);
    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  });

  /* trades inbox */
  renderTradeInbox(state);

  /* log */
  const logList = $("#log-list");
  logList.innerHTML = "";
  state.log.slice(0, 30).forEach((line) => logList.appendChild(el("li", null, line)));

  /* auction modal */
  renderAuction(state);

  /* winner */
  if (state.status === "finished") {
    const winner = state.players.find((p) => p.id === state.winner);
    $("#winner-text").textContent = winner ? `${winner.name} owns the town!` : "Town over";
    $("#winner-banner").classList.remove("hidden");
  }
}

/* ---------- trades ---------- */
function renderTradeInbox(state) {
  const box = $("#trade-inbox");
  box.innerHTML = "";
  const mine = state.pending_trades || [];
  if (mine.length === 0) {
    box.appendChild(el("span", "dim", "No pending trades"));
    return;
  }
  mine.forEach((t) => {
    const isToMe = t.to === session.playerId;
    const wrap = el("div", "trade-offer");
    const desc = `💰 ${t.money_give || "—"} ⇄ 💰 ${t.money_want || "—"}`
      + (t.give.length ? ` · ${t.give.length} prop` : "")
      + (t.want.length ? ` · ${t.want.length} prop` : "");
    wrap.appendChild(el("p", null, `${t.from_name} → you: ${desc}`));
    if (isToMe) {
      const btns = el("div", "trade-btns");
      const acc = el("button", "btn btn-primary", "Accept");
      acc.addEventListener("click", () => respondTrade(t.id, true));
      const dec = el("button", "btn btn-ghost", "Decline");
      dec.addEventListener("click", () => respondTrade(t.id, false));
      btns.append(acc, dec);
      wrap.appendChild(btns);
    }
    box.appendChild(wrap);
  });
}

async function respondTrade(tid, accept) {
  try {
    await api("trade_response", { code: session.code, player_id: session.playerId, trade_id: tid, accept });
  } catch (e) { flashError(e.message); }
}

function openTradeModal() {
  const me = session.playerId;
  const target = $("#trade-target");
  target.innerHTML = "";
  const players = currentPlayers.filter((p) => p.id !== me && !p.bankrupt);
  players.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    target.appendChild(o);
  });
  if (players.length > 0) target.value = players[0].id;
  $("#trade-give-money").value = "";
  $("#trade-want-money").value = "";
  buildTradeProps("give");
  buildTradeProps("want");
  $("#trade-modal").classList.remove("hidden");
}

let currentPlayers = [];
let currentBoard = [];

function buildTradeProps(side) {
  const box = document.getElementById(`trade-${side}-props`);
  box.innerHTML = "";
  const me = currentPlayers.find((p) => p.id === session.playerId);
  currentBoard.forEach((tile) => {
    if (tile.type !== "street" && tile.type !== "railway") return;
    const own = (side === "give" && tile.owner === session.playerId) ||
                (side === "want" && tile.owner !== session.playerId && tile.owner != null &&
                 $("#trade-target").value === tile.owner);
    if (!own) return;
    const prop = el("div", "trade-prop");
    prop.dataset.index = tile.index;
    const band = el("span", "prop-band");
    band.style.background = tile.color;
    const label = el("span", null, tile.name + (tile.houses ? ` (${tile.houses}🏠)` : ""));
    prop.append(band, label);
    prop.addEventListener("click", () => prop.classList.toggle("selected"));
    box.appendChild(prop);
  });
}

$("#trade-target").addEventListener("change", () => buildTradeProps("want"));

/* ---------- auction ---------- */
let auctionDismissed = false;
let lastAuctionKey = null;

function renderAuction(state) {
  const a = state.auction;
  const modal = $("#auction-modal");
  if (!a) {
    modal.classList.add("hidden");
    clearInterval(auctionTimer);
    auctionDismissed = false;
    lastAuctionKey = null;
    return;
  }
  const key = `${a.tile_index}:${a.ends_at}`;
  if (key !== lastAuctionKey) {
    lastAuctionKey = key;
    auctionDismissed = false;   // a new auction instance pops up again
  }
  $("#auction-tile-name").textContent = a.tile_name;
  const me = state.players.find((p) => p.id === session.playerId);
  const hiPlayer = state.players.find((p) => p.id === a.highest_bidder);
  $("#auction-status").textContent = hiPlayer
    ? `Top bid: ${money(a.highest_bid)} by ${hiPlayer.name}`
    : `Opening bid: ${money(a.min_bid)}`;
  const tt = $("#auction-timer");
  const secs = Math.max(0, Math.ceil((a.ends_at - Date.now() / 1000)));
  tt.textContent = secs;
  tt.classList.toggle("low", secs <= 5);
  clearInterval(auctionTimer);
  auctionTimer = setInterval(() => {
    const s2 = Math.max(0, Math.ceil((a.ends_at - Date.now() / 1000)));
    $("#auction-timer").textContent = s2;
    $("#auction-timer").classList.toggle("low", s2 <= 5);
  }, 250);
  $("#btn-bid").disabled = !(me && !me.bankrupt);
  if (auctionDismissed) {
    modal.classList.add("hidden");
  } else {
    modal.classList.remove("hidden");
  }
}

/* ---------- board fits the viewport (square, always fully visible) ---------- */
function sizeBoard() {
  const board = $("#board");
  const main = document.querySelector(".game-main");
  if (!board || !main) return;
  const rect = main.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const cs = getComputedStyle(main);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const stacked = rect.width < 900;
  const gap = 16;
  const sideEl = document.querySelector(".side-panel");
  const sideW = (!stacked && sideEl) ? sideEl.getBoundingClientRect().width : 0;
  let size;
  const availW = rect.width - padL - padR;
  const availH = rect.height - padT - padB;
  if (stacked) {
    size = Math.min(availW - 8, availH * 0.44);
  } else {
    size = Math.min(availW - sideW - gap, availH);
  }
  const s = Math.max(220, Math.floor(size));
  board.style.width = s + "px";
  board.style.height = s + "px";
}

function initBoardResizer() {
  const main = document.querySelector(".game-main");
  if (!main || main.dataset.resizer) return;
  main.dataset.resizer = "1";
  const ro = new ResizeObserver(() => sizeBoard());
  ro.observe(main);
  window.addEventListener("resize", () => sizeBoard());
}

/* ---------- render ---------- */
let lastBoardTiles = 0;
let lastDiceKey = "";

function renderGame(state) {
  currentPlayers = state.players;
  currentBoard = state.board;
  $("#ghdr-code-val").textContent = state.code;
  if (state.board.length !== lastBoardTiles) {
    buildBoard(state);
    lastBoardTiles = state.board.length;
  }
  renderBoard(state);
  renderSide(state);
  sizeBoard();
  initBoardResizer();
  if (state.last_card && state.last_card.seq !== seenCardSeq) {
    $("#card-modal").classList.remove("hidden");
    $("#card-title").textContent = state.last_card.title;
    $("#card-text").textContent = state.last_card.text;
    $("#card-result").textContent = state.last_card.result || "";
    seenCardSeq = state.last_card.seq;
  }
}

/* ---------- polling ---------- */
function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  if (!session.code) return;
  try {
    const state = await api(`state/${session.code}?player_id=${session.playerId}`);
    if (!state) return;
    if (state.status === "lobby") {
      renderLobby(state);
    } else {
      if (lastStatus === "lobby") showScreen("#screen-game");
      renderGame(state);
    }
    lastStatus = state.status;
  } catch (e) { /* transient — next poll retries */ }
}