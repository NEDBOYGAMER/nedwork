/* POLYWARS frontend — data driven.
   All board content, prices, cards and railway names come from the backend,
   which derives them from the JSON files under /data. */

const API_BASE = window.APP_BASE || "./";
const POLL_MS = 1400;

const CORNER_ICON = { go: "⌂", jail: "⚖", free_parking: "☰", go_to_jail: "⚠" };
const RAIL_ICON = "⛶";
const CHANCE_ICON = "?";

let session = { code: null, playerId: null, name: null };
let pollTimer = null;
let lastStatus = "lobby";
let seenCardSeq = 0;

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

/* ---------- home ---------- */
$("#btn-create").addEventListener("click", async () => {
  const name = $("#create-name").value.trim() || "Commander";
  try {
    const data = await api("create", { name });
    session = { code: data.code, playerId: data.player_id, name };
    enterLobby();
  } catch (e) { $("#home-error").textContent = e.message; }
});

$("#btn-join").addEventListener("click", async () => {
  const name = $("#join-name").value.trim() || "Commander";
  const code = $("#join-code").value.trim().toUpperCase();
  if (!code) { $("#home-error").textContent = "Enter a campaign code."; return; }
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
    dot.style.color = p.color; dot.style.background = p.color;
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

$("#btn-build").addEventListener("click", async () => {
  try { await api("build", { code: session.code, player_id: session.playerId }); }
  catch (e) { flashError(e.message); }
});

$("#btn-bail").addEventListener("click", async () => {
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

function flashError(msg) {
  const box = $("#buy-box");
  box.classList.remove("hidden");
  $("#buy-text").textContent = msg;
  $(".btn-buy").classList.add("hidden");
}

/* ---------- board geometry (data driven, any board.json size) ---------- */
function gridPositions(n) {
  const side = n / 4 + 1;
  const pos = new Array(n);
  let k = 0;
  for (let i = 0; i < side; i++) pos[k++] = { r: side, c: side - i };
  for (let j = 1; j <= side - 1; j++) pos[k++] = { r: side - j, c: 1 };
  for (let c = 2; c <= side; c++)   pos[k++] = { r: 1, c };
  for (let r = 2; r <= side - 1; r++) pos[k++] = { r, c: side };
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
  emblem.innerHTML = `<div class="em-mark">◆</div><div class="em-label">BANK OF POLYWARS</div><div class="em-pot" id="em-deck">Chance deck · —</div>`;
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
      div.innerHTML = `<div class="tile-icon">${CORNER_ICON[tile.kind] || "•"}</div><div class="tile-name">${tile.name}</div>`;
    } else if (tile.type === "chance") {
      div.classList.add("chance");
      div.innerHTML = `<div class="tile-icon">${CHANCE_ICON}</div><div class="tile-name">CHANCE</div><div class="tile-tokens"></div>`;
    } else {
      div.classList.add("property", tile.type);
      div.style.borderTopColor = tile.color;
      const railPrefix = tile.type === "railway" ? RAIL_ICON + " " : "";
      const houses = tile.type === "street" && tile.houses ? `<div class="tile-houses">${"■".repeat(Math.min(tile.houses, 5))}</div>` : "";
      div.innerHTML = `
        <div class="tile-owner-bar" style="background:transparent"></div>
        <div class="tile-name">${railPrefix}${tile.name}</div>
        <div class="tile-price">$${tile.price}</div>
        ${houses}
        <div class="tile-tokens"></div>`;
    }
    board.appendChild(div);
  }
}

function renderBoard(state) {
  for (let i = 0; i < state.board.length; i++) {
    const tile = state.board[i];
    const div = $(`.tile[data-index="${i}"]`);
    if (!div) continue;
    const tokens = div.querySelector(".tile-tokens");
    if (tokens) {
      tokens.innerHTML = "";
      state.players.forEach((p) => {
        if (p.position === i && !p.bankrupt) {
          const t = document.createElement("div");
          t.className = "token";
          t.style.background = p.color;
          tokens.appendChild(t);
        }
      });
    }
    if (tile.type === "street" || tile.type === "railway") {
      div.classList.toggle("owned", !!tile.owner);
      const bar = div.querySelector(".tile-owner-bar");
      const owner = tile.owner ? state.players.find((p) => p.id === tile.owner) : null;
      bar.style.background = owner ? owner.color : "transparent";
      bar.style.height = owner ? "4px" : "0";
    }
  }
  const deckCount = Object.values(state.chance_decks || {}).reduce((a, b) => a + b, 0);
  const em = $("#em-deck");
  if (em) em.textContent = `Chance deck · ${deckCount}`;
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

  $("#turn-indicator").textContent = turnP ? `${turnP.name}'s move` : "—";
  $("#turn-indicator").style.color = turnP ? (turnP.color) : "var(--text)";
  if (inJail) $("#turn-indicator").textContent = `${turnP.name} is IN JAIL`;
  $("#ghdr-round").textContent = `Round ${state.round}`;
  $("#die1").textContent = state.dice ? state.dice[0] : "–";
  $("#die2").textContent = state.dice ? state.dice[1] : "–";

  $("#btn-roll").classList.toggle("hidden", !isTurn);
  $("#btn-roll").disabled = !(isTurn && !hasDice);
  $("#btn-end").classList.toggle("hidden", !isTurn);
  $("#btn-end").disabled = !(isTurn && hasDice);

  /* bail */
  $("#btn-bail").classList.toggle("hidden", !(isTurn && inJail && !hasDice));
  if (!$(("#btn-bail")).classList.contains("hidden")) {
    $("#btn-bail").textContent = `Pay bail ${state.config.currency}${state.config.jail.bail}`;
    $("#btn-bail").disabled = !(me && me.money >= state.config.jail.bail);
  }

  /* buy */
  const buyBox = $("#buy-box");
  const buyable = isTurn && me && hasDice && tile &&
                  (tile.type === "street" || tile.type === "railway") && tile.owner === null;
  if (buyable) {
    buyBox.classList.remove("hidden");
    $("#buy-text").textContent = `${tile.type === "railway" ? "Station" : "Street"} ${tile.name} — ${state.config.currency}${tile.price}`;
    const buyBtn = $("#btn-buy");
    buyBtn.classList.remove("hidden");
    buyBtn.disabled = me.money < tile.price;
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
    $("#build-text").textContent = `Build house #${tile.houses + 1} on ${tile.name} — ${state.config.currency}${tile.build_price}`;
    const b = $("#btn-build");
    b.disabled = me.money < tile.build_price;
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
    const dot = el("span", "dot");
    dot.style.background = p.color; dot.style.color = p.color;
    left.appendChild(dot);
    const marker = p.id === session.playerId ? " (you)" : (p.jail_turns != null ? " 🔒" : "");
    left.appendChild(document.createTextNode(p.name + marker));
    const money = el("span", "pl-money", state.config.currency + p.money);
    li.appendChild(left);
    li.appendChild(money);
    list.appendChild(li);
  });

  /* log */
  const logList = $("#log-list");
  logList.innerHTML = "";
  state.log.slice(0, 30).forEach((line) => logList.appendChild(el("li", null, line)));

  /* winner */
  if (state.status === "finished") {
    const winner = state.players.find((p) => p.id === state.winner);
    $("#winner-text").textContent = winner ? `${winner.name} takes the board` : "Campaign over";
    $("#winner-banner").classList.remove("hidden");
  }
}

function renderGame(state) {
  $("#ghdr-code-val").textContent = state.code;
  buildBoard(state);
  renderBoard(state);
  renderSide(state);
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