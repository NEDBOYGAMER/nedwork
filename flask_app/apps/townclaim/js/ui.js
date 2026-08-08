/* ui.js — Menüs, Panels, Modals, Zentraler Aktions-Dispatcher für online/lokal */
(function (global) {
  'use strict';
  const Monopoly = global.Monopoly = global.Monopoly || {};

  const COLORS = ['#e2504f', '#3f8ef0', '#3bb273', '#f2a541', '#9b5de5', '#f15bb5', '#00bbf9', '#2b28b3'];

  Monopoly.ui = {
    myPlayerId: 0,
    myColorIdx: 0,
    isOnline: false,
    playerName: '',
    _seenPrompt: null,
    _gameEntered: false
  };

  const isMyTurn = () => !Monopoly.ui.isOnline || Monopoly.ui.myPlayerId === Monopoly.state.current;
  const currentPlayer = () => Monopoly.state ? Monopoly.state.players[Monopoly.state.current] : null;

  Monopoly.ui.isMyTurn = isMyTurn;

  /* ---------- Navigation ---------- */
  Monopoly.ui.show = function (id) {
    ['screen-main', 'screen-lobby', 'screen-game'].forEach(function (s) {
      document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
    });
  };

  Monopoly.ui.boot = function () {
    Monopoly.ui.show('screen-main');
    document.getElementById('playerNameInput').value = Monopoly.ui.playerName || 'Du';
    Monopoly.net.setConnected = function (ok, txt) {
      const el = document.getElementById('connStatus');
      if (el) { el.textContent = txt; el.style.color = ok ? '#8be08b' : '#ff9c9c'; }
    };
    /* Host: Aktionen von Remote-Spielern ausführen */
    Monopoly.net.onStateChange = function () { if (Monopoly.net.host) Monopoly.net.broadcastState(); };
    Monopoly.net.onAction = function (msg) {
      Monopoly.applyAction(msg.action.type, msg.action.payload || {});
      Monopoly.ui.refresh();
    };
    /* Nicht-Host: empfangenen Zustand übernehmen */
    Monopoly.net.onState = function (state) {
      Monopoly.replaceState(state);
      Monopoly.ui.isOnline = true;
      Monopoly.ui.myPlayerId = Monopoly.net.myIndex;
      Monopoly.ui.enterGame();
    };
  };

  Monopoly.ui.showLobbyStatus = function (txt) {
    document.getElementById('lobbyStatus').textContent = txt;
  };

  Monopoly.ui.enterGame = function () {
    if (!Monopoly.ui._gameEntered) {
      Monopoly.ui.show('screen-game');
      Monopoly.renderBoard();
      Monopoly.ui._gameEntered = true;
    }
    Monopoly.ui.refresh();
  };

  Monopoly.ui.showMenu = function () {
    if (!confirm('Menü / Spiel verlassen? Lokales Spiel geht verloren.')) return;
    Monopoly.ui._gameEntered = false;
    Monopoly.ui.show('screen-main');
  };

  /* ---------- Aktions-Dispatcher ----------
     Lokal/has host: direkt ausführen. Remote: an den Host senden. */
  Monopoly.doAction = function (type, payload) {
    if (!Monopoly.ui.isOnline || Monopoly.net.host) {
      Monopoly.applyAction(type, payload || {});
      if (Monopoly.ui.isOnline && Monopoly.net.host) Monopoly.net.broadcastState();
      Monopoly.ui.refresh();
    } else {
      Monopoly.net.sendAction({ type: type, payload: payload || {} });
    }
  };

  Monopoly.applyAction = function (type, payload) {
    const st = Monopoly.state; if (!st) return;
    const pl = st.players[st.current];
    switch (type) {
      case 'roll':      Monopoly.roll(); break;
      case 'buy':
        st.purchase = null; Monopoly.buy(); Monopoly.turnComplete(pl); break;
      case 'decline':
        st.purchase = null; Monopoly.turnComplete(pl); break;
      case 'tax': {
        const amt = st.tax; st.tax = null;
        Monopoly.payMoneyToBank(pl, amt);
        Monopoly.turnComplete(pl);
        break;
      }
      case 'bail':      Monopoly.payBail(); break;
      case 'free':      Monopoly.useGetOutOfJail(); break;
      case 'cardok':    Monopoly.applyCard(); break;
      case 'end':       Monopoly.endTurn(); break;
      case 'build':     Monopoly.build(payload.sid); break;
      case 'sell':      Monopoly.sellHouse(payload.sid); break;
      case 'mortgage':
        if (st.owned[payload.sid].mortgaged) Monopoly.unmortgage(payload.sid);
        else Monopoly.mortgage(payload.sid);
        break;
      case 'trade':
        Monopoly.trade(payload.fromId, payload.toId, payload.money1, payload.props1, payload.money2, payload.props2);
        break;
    }
  };

  /* ---------- Lokales Spiel ---------- */
  Monopoly.ui.addLocalPlayer = function (name, color) {
    const list = document.getElementById('playerList');
    if (list.children.length >= 7) { Monopoly.ui.toast('Maximal 8 Spieler.'); return; }
    const n = list.children.length;
    const row = document.createElement('div');
    row.className = 'player-row';
    const col = color || COLORS[(n + 1) % COLORS.length];
    row.innerHTML =
      '<span class="dot" style="background:' + col + '"></span>' +
      '<span>' + (name || ('Spieler ' + (n + 1))) + '</span>' +
      '<button class="mini">✕</button>';
    row.querySelector('.mini').onclick = function () { row.remove(); };
    list.appendChild(row);
  };

  Monopoly.ui.colorPreview = function (idx) {
    Monopoly.ui.myColorIdx = ((idx % COLORS.length) + COLORS.length) % COLORS.length;
    document.getElementById('colorDot').style.background = COLORS[Monopoly.ui.myColorIdx];
  };

  Monopoly.ui.startLocal = function () {
    const rows = document.querySelectorAll('#playerList .player-row');
    const players = [];
    let i = 0;
    const selfName = document.getElementById('playerNameInput').value.trim() || 'Du';
    players.push({ name: selfName, color: COLORS[0] });
    rows.forEach(function (row) {
      i++;
      players.push({ name: row.querySelector('span:nth-child(2)').textContent, color: COLORS[i % COLORS.length] });
    });
    if (players.length < 2) { Monopoly.ui.toast('Bitte mindestens 2 Spieler.'); return; }
    Monopoly.newGame(players);
    Monopoly.ui.isOnline = false;
    Monopoly.ui.myPlayerId = 0;
    Monopoly.ui.enterGame();
  };

  /* ---------- Lokal: TODOs? no ---------- */

  /* ---------- Online-Ablauf ---------- */
  Monopoly.ui.startOnlineFlow = function () {
    const name = document.getElementById('playerNameInput').value.trim() || 'Host';
    Monopoly.net.createRoom(name);
  };
  Monopoly.ui.showJoinPrompt = function () {
    const code = prompt('Room-Code eingeben (z.B. THUR-7K2Q):');
    if (!code) return;
    const name = document.getElementById('playerNameInput').value.trim() || 'Spieler';
    Monopoly.net.joinRoom(code, name);
  };
  Monopoly.ui.onRoomCreated = function (msg) {
    Monopoly.ui.isOnline = true;
    Monopoly.ui.myPlayerId = msg.you;
    Monopoly.ui.show('screen-lobby');
    document.getElementById('roomCode').textContent = msg.code;
    document.getElementById('roomCode').style.letterSpacing = '4px';
    document.getElementById('lobbyInfo').textContent =
      'Diesen Code an Ihre Freunde senden, damit sie beitreten können.';
    document.getElementById('btnStartOnline').style.display = 'inline-block';
    Monopoly.ui.renderLobbyPlayers([]);
  };
  Monopoly.ui.onRoomJoined = function (msg) {
    Monopoly.ui.isOnline = true;
    Monopoly.ui.myPlayerId = msg.you;
    Monopoly.ui.show('screen-lobby');
    document.getElementById('roomCode').textContent = msg.code;
    document.getElementById('lobbyInfo').textContent = 'Sie sind beigetreten. Warten auf Start…';
    document.getElementById('btnStartOnline').style.display = 'none';
    Monopoly.ui.renderLobbyPlayers([]);
  };
  Monopoly.ui.onRoomPlayers = function (players) {
    Monopoly.ui.renderLobbyPlayers(players);
  };
  Monopoly.ui.renderLobbyPlayers = function (players) {
    const el = document.getElementById('lobbyPlayers');
    el.innerHTML = '';
    (players || []).forEach(function (p) {
      const div = document.createElement('div');
      div.className = 'lobby-player' + (p.host ? ' host' : '');
      div.textContent = p.name + (p.host ? ' (Host)' : '');
      el.appendChild(div);
    });
  };
  Monopoly.ui.startOnline = function () {
    const list = Monopoly.net.roomPlayers;
    if (!list || list.length < 2) { Monopoly.ui.toast('Mindestens 2 Spieler im Raum.'); return; }
    const players = list.map(function (p, i) {
      return { name: p.name, color: COLORS[i % COLORS.length] };
    });
    Monopoly.newGame(players);
    Monopoly.ui.isOnline = true;
    Monopoly.ui.myPlayerId = Monopoly.net.myIndex;
    Monopoly.ui.enterGame();
    Monopoly.net.broadcastState();
  };

  /* ---------- Refresh ---------- */
  Monopoly.ui.refresh = function () {
    if (!Monopoly.state) return;
    Monopoly.renderTokens();
    Monopoly.renderOwnership();
    Monopoly.ui.renderPlayersPanel();
    Monopoly.ui.renderDice();
    Monopoly.ui.renderStatus();
    Monopoly.ui.renderControls();
    Monopoly.ui.handlePrompt();
  };

  Monopoly.ui.renderPlayersPanel = function () {
    const panel = document.getElementById('playersPanel');
    panel.innerHTML = '';
    Monopoly.state.players.forEach(function (p) {
      const div = document.createElement('div');
      div.className = 'panel-card' + (p.id === Monopoly.state.current ? ' active' : '') + (p.alive ? '' : ' dead');
      const wealth = Monopoly.totalWealth(p);
      const isMe = p.id === Monopoly.ui.myPlayerId;
      div.innerHTML =
        '<div class="p-name"><span class="dot" style="background:' + p.color + '"></span>' +
        (isMe ? '<b>' + p.name + ' (Du)</b>' : p.name) + (p.inJail ? ' 🚔' : '') + '</div>' +
        '<div class="p-money">CHF ' + p.money + '</div>' +
        '<div class="p-wealth">EW ' + wealth.toLocaleString('de-CH') + '</div>' +
        '<div class="p-props">' + p.properties.length + ' Objekte · ' + p.getOutOfJail + 'x Frei</div>';
      if (p.alive && p.id === Monopoly.ui.myPlayerId && !Monopoly.ui.isOnline) {
        const a = document.createElement('div'); a.className = 'p-actions';
        const mg = document.createElement('button'); mg.textContent = 'Bank';
        mg.onclick = function () { Monopoly.ui.showManage(p.id); };
        const tr = document.createElement('button'); tr.textContent = 'Handeln';
        tr.onclick = function () { Monopoly.ui.showTrade(p.id); };
        a.appendChild(mg); a.appendChild(tr); div.appendChild(a);
      } else if (p.alive && Monopoly.ui.isOnline && p.id === Monopoly.ui.myPlayerId) {
        const a = document.createElement('div'); a.className = 'p-actions';
        const mg = document.createElement('button'); mg.textContent = 'Bank';
        mg.onclick = function () { Monopoly.ui.showManage(p.id); };
        a.appendChild(mg); div.appendChild(a);
      } else if (p.alive && Monopoly.ui.isOnline && p.id !== Monopoly.ui.myPlayerId) {
        const a = document.createElement('div'); a.className = 'p-actions';
        const tr = document.createElement('button'); tr.textContent = 'Handeln';
        tr.onclick = function () { Monopoly.ui.showTrade(p.id); };
        a.appendChild(tr); div.appendChild(a);
      }
      panel.appendChild(div);
    });
  };

  Monopoly.ui.renderDice = function () {
    const st = Monopoly.state;
    if (!st) return;
    document.getElementById('die1').textContent = st.dice[0] || '';
    document.getElementById('die2').textContent = st.dice[1] || '';
    document.getElementById('diceInfo').textContent = st.lastDouble ? 'Pasch!' : '';
  };

  Monopoly.ui.renderStatus = function () {
    const st = Monopoly.state; if (!st) return;
    const pl = st.players[st.current];
    document.getElementById('turnPlayer').textContent = pl.name;
    document.getElementById('turnPlayer').style.color = pl.color;
    const status = document.getElementById('statusText');
    if (st.phase === 'over') status.textContent = '🏆 ' + st.players[st.winner].name + ' gewinnt!';
    else if (st.phase === 'card') status.textContent = 'Karte gezogen – bestätigen.';
    else if (pl.inJail) status.textContent = 'im Gefängnis (Versuch ' + pl.jailTurns + '/3)';
    else if (st.phase === 'decide') status.textContent = 'Entscheidung erforderlich…';
    else status.textContent = 'am Zug – würfeln';
    document.getElementById('log').innerHTML = st.log.slice(-8).map(l => '<div>' + l + '</div>').join('');
    document.getElementById('lobbyCodeTop').textContent = Monopoly.net.room ? ('Code: ' + Monopoly.net.room) : '';
  };

  Monopoly.ui.renderControls = function () {
    const st = Monopoly.state; if (!st) return;
    const pl = st.players[st.current];
    const area = document.getElementById('controlsArea');
    const roll = document.getElementById('btnRoll'), bail = document.getElementById('btnBail');
    const free = document.getElementById('btnFree'), end = document.getElementById('btnEnd');

    [roll, bail, free, end].forEach(b => b.style.display = 'none');

    if (st.phase === 'over') {
      area.style.display = 'block';
      end.style.display = 'inline-block'; end.textContent = 'Neues Spiel';
      end.onclick = function () { location.reload(); };
      return;
    }

    if (!isMyTurn()) { area.style.display = 'none'; return; }
    area.style.display = 'block';

    if (st.phase === 'pre' && pl.inJail) {
      bail.style.display = 'inline-block';
      bail.onclick = function () { Monopoly.doAction('bail'); };
      if (pl.getOutOfJail > 0) { free.style.display = 'inline-block'; free.onclick = function () { Monopoly.doAction('free'); }; }
      roll.style.display = 'inline-block';
      roll.textContent = 'Würfeln (Gefängnis)';
      roll.onclick = function () { Monopoly.doAction('roll'); };
      return;
    }
    if (st.phase === 'pre') {
      roll.style.display = 'inline-block';
      roll.textContent = 'Würfeln';
      roll.onclick = function () { Monopoly.doAction('roll'); };
      return;
    }
    /* moved / decide *ohne* Modal: einfach weiter */
    roll.style.display = 'inline-block';
    roll.textContent = 'Weiter';
    roll.onclick = function () { Monopoly.doAction('end'); };
  };

  /* Kleiner Helfer: zeige Betrag nur wenn Modal nötig ist */
  Monopoly.ui.handlePrompt = function () {
    const st = Monopoly.state; if (!st) return;
    const pl = st.players[st.current];
    if (!isMyTurn()) { Monopoly.ui._seenPrompt = null; return; }

    let candidate = null;
    if (st.purchase != null) candidate = 'buy:' + st.purchase;
    else if (st.tax != null) candidate = 'tax:' + st.tax;
    else if (st.phase === 'card' && st.lastCard) candidate = 'card:' + st.lastCard.card.id;

    if (candidate && candidate !== Monopoly.ui._seenPrompt) {
      Monopoly.ui._seenPrompt = candidate;
      if (st.purchase != null) Monopoly.ui.showBuyModal(pl, st.purchase);
      else if (st.tax != null) Monopoly.ui.showTaxModal(pl, st.tax);
      else if (st.phase === 'card' && st.lastCard) Monopoly.ui.showCardModal(pl, st.lastCard.card);
    } else if (!candidate) {
      Monopoly.ui._seenPrompt = null;
    }
  };

  Monopoly.ui.showBuyModal = function (pl, sid) {
    const place = Monopoly.DATA.places[sid];
    const box = document.getElementById('modalBox');
    box.innerHTML =
      '<h3>' + place.name + '</h3>' +
      '<p>Möchten Sie ' + place.name + ' für <b>CHF ' + place.price + '</b> kaufen?</p>' +
      '<div class="modal-btns">' +
      '<button id="mBuy">Kaufen</button><button id="mNo">Nicht kaufen</button></div>';
    document.getElementById('modal').classList.add('show');
    document.getElementById('mBuy').onclick = function () { close(); Monopoly.doAction('buy'); };
    document.getElementById('mNo').onclick = function () { close(); Monopoly.doAction('decline'); };
  };
  Monopoly.ui.showTaxModal = function (pl, amount) {
    const box = document.getElementById('modalBox');
    box.innerHTML =
      '<h3>Steuern</h3><p>Zahlen Sie <b>CHF ' + amount + '</b> an die Bank.</p>' +
      '<div class="modal-btns"><button id="mTax">OK</button></div>';
    document.getElementById('modal').classList.add('show');
    document.getElementById('mTax').onclick = function () { close(); Monopoly.doAction('tax'); };
  };
  Monopoly.ui.showCardModal = function (pl, card) {
    const box = document.getElementById('modalBox');
    box.innerHTML =
      '<h3>' + (card.deck === 'chance' ? 'Schicksal' : 'Gemeinschaftsfeld') + '</h3>' +
      '<p class="card-text">' + card.text + '</p>' +
      '<div class="modal-btns"><button id="mCard">OK</button></div>';
    document.getElementById('modal').classList.add('show');
    document.getElementById('mCard').onclick = function () { close(); Monopoly.doAction('cardok'); };
  };

  function close() { document.getElementById('modal').classList.remove('show'); }
  Monopoly.ui.closeModal = close;

  Monopoly.ui.showManage = function (pid) {
    const st = Monopoly.state; const pl = st.players[pid];
    if (!pl.frozen) {}
    const box = document.getElementById('modalBox');
    let html = '<h3>Bank – ' + pl.name + '</h3><div class="manage-list">';
    pl.properties.forEach(function (sid) {
      const place = Monopoly.DATA.places[sid];
      const o = st.owned[sid];
      let actions = '<button data-act="mortgage" data-sid="' + sid + '">' + (o.mortgaged ? 'Lösen' : 'Hypothek') + '</button>';
      if (place.type === 'property') {
        actions += '<button data-act="build" data-sid="' + sid + '">Haus</button>';
        actions += '<button data-act="sell" data-sid="' + sid + '">Verkauf</button>';
      }
      html += '<div class="manage-item"><span class="dot" style="background:' + Monopoly.color(place.color || '#888') + '"></span>' +
        '<span>' + place.name + ' <small>' + (o.houses === 5 ? 'Hotel' : (o.houses ? '×' + o.houses : '')) + '</small></span>' + actions + '</div>';
    });
    if (pl.properties.length === 0) html += '<p>Keine Objekte.</p>';
    html += '</div><div class="modal-btns"><button id="mClose">Schliessen</button></div>';
    box.innerHTML = html;
    document.getElementById('modal').classList.add('show');
    box.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        const act = b.dataset.act; const sid = +b.dataset.sid;
        if (act === 'mortgage') Monopoly.doAction('mortgage', { sid: sid });
        else if (act === 'build') Monopoly.doAction('build', { sid: sid });
        else if (act === 'sell') Monopoly.doAction('sell', { sid: sid });
      };
    });
    document.getElementById('mClose').onclick = close;
  };

  Monopoly.ui.showTrade = function (otherId) {
    const st = Monopoly.state;
    const me = st.players[Monopoly.ui.myPlayerId];
    const other = st.players[otherId];
    const box = document.getElementById('modalBox');
    let html = '<h3>Handel: ' + me.name + ' ⇄ ' + other.name + '</h3><div class="trade-grid"><div><h4>' + me.name + ' gibt</h4>' +
      '<label>CHF <input type="number" id="tMoney1" value="0" min="0"></label>';
    me.properties.forEach(function (sid) {
      html += '<label class="chk"><input type="checkbox" class="t1" value="' + sid + '">' + Monopoly.DATA.places[sid].name + '</label>';
    });
    html += '</div><div><h4>' + other.name + ' gibt</h4><label>CHF <input type="number" id="tMoney2" value="0" min="0"></label>';
    other.properties.forEach(function (sid) {
      html += '<label class="chk"><input type="checkbox" class="t2" value="' + sid + '">' + Monopoly.DATA.places[sid].name + '</label>';
    });
    html += '</div></div><div class="modal-btns"><button id="mTrade">Tausch</button><button id="mTC">Abbrechen</button></div>';
    box.innerHTML = html;
    document.getElementById('modal').classList.add('show');
    document.getElementById('mTrade').onclick = function () {
      const money1 = +document.getElementById('tMoney1').value || 0;
      const money2 = +document.getElementById('tMoney2').value || 0;
      const props1 = [].slice.call(box.querySelectorAll('.t1:checked')).map(c => +c.value);
      const props2 = [].slice.call(box.querySelectorAll('.t2:checked')).map(c => +c.value);
      Monopoly.doAction('trade', { fromId: me.id, toId: other.id, money1: money1, props1: props1, money2: money2, props2: props2 });
    };
    document.getElementById('mTC').onclick = close;
  };

  Monopoly.ui.toast = function (txt) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = txt; t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2500);
  };

})(window);