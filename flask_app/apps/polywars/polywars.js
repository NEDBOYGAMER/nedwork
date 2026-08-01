/* =========================================================================
   POLYWARS — frontend
   Talks to the polywars_bp routes in routes.py, polls game state, renders
   the board. Loaded as a module (see polywars.html), same as colors.js.
   ========================================================================= */

/* Uses the absolute app base path set in polywars.html (window.APP_BASE,
   e.g. "/apps/polywars/") rather than a relative '' base — see colors.js
   for why a relative base is unsafe here. */
const API_BASE = window.APP_BASE || "./";

const POLL_MS = 1400;

// Maps board tile index (0-27) to a position on an 8x8 CSS grid.
// Index 0 = bottom-right (HQ), travelling counter-clockwise.
const GRID_POS = [
  { r: 8, c: 8 }, { r: 8, c: 7 }, { r: 8, c: 6 }, { r: 8, c: 5 }, { r: 8, c: 4 }, { r: 8, c: 3 }, { r: 8, c: 2 },
  { r: 8, c: 1 },
  { r: 7, c: 1 }, { r: 6, c: 1 }, { r: 5, c: 1 }, { r: 4, c: 1 }, { r: 3, c: 1 }, { r: 2, c: 1 },
  { r: 1, c: 1 },
  { r: 1, c: 2 }, { r: 1, c: 3 }, { r: 1, c: 4 }, { r: 1, c: 5 }, { r: 1, c: 6 }, { r: 1, c: 7 },
  { r: 1, c: 8 },
  { r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }, { r: 7, c: 8 },
];

const CORNER_ICON = { go: "⌂", artillery: "⚔", stronghold: "⛨", siege: "⚠" };
const SPECIAL_ICON = { supply: "◈", skirmish: "✕" };
const TERR_ORDER = ["north", "east", "south", "west"]; // must mirror routes.py

// ---- state -----------------------------------------------------------
let session = { code: null, playerId: null, name: null };
let pollTimer = null;
let lastStatus = "lobby";

// ---- dom helpers -------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.redirected) { window.location.href = res.url; return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// ---- HOME screen -------------------------------------------------------
$("#btn-create").addEventListener("click", async () => {
  const name = $("#create-name").value.trim() || "Commander";
  try {
    const data = await api("create", { name });
    session = { code: data.code, playerId: data.player_id, name };
    enterLobby();
  } catch (e) {
    $("#home-error").textContent = e.message;
  }
});

$("#btn-join").addEventListener("click", async () => {
  const name = $("#join-name").value.trim() || "Commander";
  const code = $("#join-code").value.trim().toUpperCase();
  if (!code) { $("#home-error").textContent = "Enter a campaign code."; return; }
  try {
    const data = await api("join", { name, code });
    session = { code: data.code, playerId: data.player_id, name };
    enterLobby();
  } catch (e) {
    $("#home-error").textContent = e.message;
  }
});

// ---- LOBBY screen --------------------------------------------------------
function enterLobby() {
  $("#home-error").textContent = "";
  $("#lobby-code").textContent = session.code;
  showScreen("#screen-lobby");
  startPolling();
}

$("#btn-start").addEventListener("click", async () => {
  try {
    await api("start", { code: session.code, player_id: session.playerId });
  } catch (e) {
    $("#lobby-hint").textContent = e.message;
    $("#lobby-hint").style.color = "var(--danger)";
  }
});

function renderLobby(state) {
  const list = $("#lobby-player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = el("li");
    const dot = el("span", "dot");
    dot.style.color = p.color;
    dot.style.background = p.color;
    li.appendChild(dot);
    li.appendChild(document.createTextNode(p.name + (p.is_host ? " (host)" : "")));
    list.appendChild(li);
  });
  const me = state.players.find((p) => p.id === session.playerId);
  const isHost = me && me.is_host;
  $("#btn-start").classList.toggle("hidden", !isHost);
  $("#lobby-hint").classList.toggle("hidden", isHost);
  if (isHost && state.players.length < 2) {
    $("#btn-start").disabled = true;
    $("#lobby-hint").textContent = "Need at least 2 commanders to start.";
    $("#lobby-hint").classList.remove("hidden");
  } else {
    $("#btn-start").disabled = false;
  }
}

// ---- GAME screen --------------------------------------------------------
$("#btn-roll").addEventListener("click", async () => {
  try {
    await api("roll", { code: session.code, player_id: session.playerId });
  } catch (e) { flashError(e.message); }
});

$("#btn-buy").addEventListener("click", async () => {
  try {
    await api("buy", { code: session.code, player_id: session.playerId });
  } catch (e) { flashError(e.message); }
});

$("#btn-end").addEventListener("click", async () => {
  try {
    await api("end_turn", { code: session.code, player_id: session.playerId });
  } catch (e) { flashError(e.message); }
});

$("#btn-new-game").addEventListener("click", () => {
  stopPolling();
  session = { code: null, playerId: null, name: null };
  $("#winner-banner").classList.add("hidden");
  $("#create-name").value = "";
  $("#join-name").value = "";
  $("#join-code").value = "";
  showScreen("#screen-home");
});

function flashError(msg) {
  const box = $("#buy-box");
  box.classList.remove("hidden");
  $("#buy-text").textContent = msg;
  $("#btn-buy").classList.add("hidden");
}

function buildBoardSkeleton(state) {
  const board = $("#board");
  board.innerHTML = "";
  const emblem = el("div", "center-emblem");
  emblem.innerHTML = `<div class="em-mark">◆</div><div class="em-label">War Room</div><div class="em-pot" id="em-pot">War chest $0</div>`;
  board.appendChild(emblem);

  for (let i = 0; i < 28; i++) {
    const tile = state.board[i];
    const pos = GRID_POS[i];
    const div = el("div", "tile");
    div.style.gridRow = pos.r;
    div.style.gridColumn = pos.c;
    div.dataset.index = i;

    if (tile.type === "corner") {
      div.classList.add("corner");
      div.innerHTML = `<div class="tile-icon">${CORNER_ICON[tile.kind] || "•"}</div><div class="tile-name">${tile.name}</div>`;
    } else if (tile.type === "supply" || tile.type === "skirmish") {
      div.classList.add("special", `special-${tile.type}`);
      div.innerHTML = `<div class="tile-icon">${SPECIAL_ICON[tile.type]}</div><div class="tile-name">${tile.name}</div><div class="tile-tokens"></div>`;
    } else {
      div.classList.add("property");
      div.style.borderTopColor = tile.color;
      div.innerHTML = `
        <div class="tile-owner-bar" style="background:transparent"></div>
        <div class="tile-name">${tile.name}</div>
        <div class="tile-price">$${tile.price}</div>
        <div class="tile-tokens"></div>`;
    }
    board.appendChild(div);
  }
}

function borderTiles(state) {
  // Cosmetic: tiles that sit on the edge of a fully-owned front, for a pulse glow.
  const glow = new Set();
  TERR_ORDER.forEach((tid, i) => {
    const propTiles = state.territories[tid].tiles.filter((t) => state.board[t].type === "property");
    const owners = new Set(propTiles.map((t) => state.board[t].owner));
    if (owners.size === 1 && [...owners][0] !== null) {
      const nextId = TERR_ORDER[(i + 1) % 4];
      const prevId = TERR_ORDER[(i + 3) % 4];
      glow.add(state.territories[nextId].tiles[0]);
      glow.add(state.territories[prevId].tiles[state.territories[prevId].tiles.length - 1]);
    }
  });
  return glow;
}

function renderBoard(state) {
  const glow = borderTiles(state);
  for (let i = 0; i < 28; i++) {
    const tile = state.board[i];
    const div = $(`.tile[data-index="${i}"]`);
    if (!div) continue;

    div.classList.toggle("contested-glow", glow.has(i));

    const tokWrap = div.querySelector(".tile-tokens");
    if (tokWrap) {
      tokWrap.innerHTML = "";
      state.players.forEach((p) => {
        if (p.position === i && !p.bankrupt) {
          const t = el("div", "token");
          t.style.background = p.color;
          tokWrap.appendChild(t);
        }
      });
    }

    if (tile.type === "property") {
      div.classList.toggle("owned", !!tile.owner);
      const bar = div.querySelector(".tile-owner-bar");
      const owner = tile.owner ? state.players.find((p) => p.id === tile.owner) : null;
      bar.style.background = owner ? owner.color : "transparent";
      bar.style.height = owner ? "5px" : "0";
    }
  }

  const potEl = $("#em-pot");
  if (potEl) potEl.textContent = `War chest $${state.pot}`;
  $("#ghdr-pot").textContent = `War chest $${state.pot}`;
}

function renderSidePanel(state) {
  const me = state.players.find((p) => p.id === session.playerId);
  const turnPlayer = state.players.find((p) => p.id === state.turn_player_id);
  const isMyTurn = state.turn_player_id === session.playerId;

  $("#turn-indicator").textContent = turnPlayer ? `${turnPlayer.name}'s move` : "—";
  $("#turn-indicator").style.color = turnPlayer ? turnPlayer.color : "var(--text)";
  $("#ghdr-round").textContent = `Round ${state.round}`;

  $("#die1").textContent = state.dice ? state.dice[0] : "–";
  $("#die2").textContent = state.dice ? state.dice[1] : "–";

  $("#btn-roll").disabled = !(isMyTurn && !state.dice);
  $("#btn-roll").classList.toggle("hidden", !isMyTurn);
  $("#btn-end").classList.toggle("hidden", !isMyTurn);
  $("#btn-end").disabled = !(isMyTurn && state.dice);

  // buy box
  const buyBox = $("#buy-box");
  if (isMyTurn && state.dice && me) {
    const tile = state.board[me.position];
    if (tile.type === "property" && tile.owner === null) {
      buyBox.classList.remove("hidden");
      $("#btn-buy").classList.remove("hidden");
      $("#buy-text").textContent = `${tile.name} is unclaimed — $${tile.price} (rent $${tile.rent})`;
    } else {
      buyBox.classList.add("hidden");
    }
  } else {
    buyBox.classList.add("hidden");
  }

  // player list
  const list = $("#player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = el("li");
    li.classList.toggle("active-turn", p.id === state.turn_player_id);
    li.classList.toggle("bankrupt", p.bankrupt);
    const left = el("div", "pl-left");
    const dot = el("span", "dot");
    dot.style.background = p.color;
    dot.style.color = p.color;
    left.appendChild(dot);
    left.appendChild(document.createTextNode(p.name + (p.id === session.playerId ? " (you)" : "")));
    const money = el("span", "pl-money", "$" + p.money);
    li.appendChild(left);
    li.appendChild(money);
    list.appendChild(li);
  });

  // log
  const logList = $("#log-list");
  logList.innerHTML = "";
  state.log.slice(0, 30).forEach((line) => {
    logList.appendChild(el("li", null, line));
  });

  // winner
  if (state.status === "finished") {
    const winner = state.players.find((p) => p.id === state.winner);
    $("#winner-text").textContent = winner ? `${winner.name} takes the board` : "Campaign over";
    $("#winner-banner").classList.remove("hidden");
  }
}

let boardBuilt = false;
function renderGame(state) {
  $("#ghdr-code-val").textContent = state.code;
  if (!boardBuilt) {
    buildBoardSkeleton(state);
    boardBuilt = true;
  }
  renderBoard(state);
  renderSidePanel(state);
}

// ---- polling loop --------------------------------------------------------
function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (!session.code) return;
  try {
    const state = await api(`state/${session.code}?player_id=${session.playerId}`);
    if (!state) return;
    if (state.status === "lobby") {
      renderLobby(state);
    } else {
      if (lastStatus === "lobby") {
        boardBuilt = false;
        showScreen("#screen-game");
      }
      renderGame(state);
    }
    lastStatus = state.status;
  } catch (e) {
    // transient network hiccup — ignore, next poll will retry
  }
}