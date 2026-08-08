/* engine.js — die komplette Monopoly-Spiellogik */
(function (global) {
  'use strict';
  const Monopoly = global.Monopoly = global.Monopoly || {};

  const C = () => Monopoly.DATA.config;
  const P = () => Monopoly.DATA.places;

  Monopoly.newGame = function (players) {
    const cfg = C().game;
    const state = {
      players: players.map(function (pl, i) {
        return {
          id: i, name: pl.name, color: pl.color, money: cfg.startMoney,
          position: 0, inJail: false, doubles: 0, jailTurns: 0,
          properties: [], getOutOfJail: 0, alive: true, bankrupt: false
        };
      }),
      current: 0,
      phase: 'pre',            // pre | moved | decide | card | over
      dice: [0, 0],
      lastDouble: false,
      owned: {},
      purchase: null,          // offene Kauf-Entscheidung (space id)
      tax: null,               // offene Steuer-Entscheidung (Betrag)
      lastCard: null,
      pending: null,
      turnCount: 0,
      winner: null,
      log: []
    };
    P().forEach(function (pl) {
      if (pl.type === 'property' || pl.type === 'railroad' || pl.type === 'utility') {
        state.owned[pl.id] = { owner: null, houses: 0, mortgaged: false };
      }
    });
    Monopoly.state = state;
    Monopoly.log('Spiel gestartet!');
    return state;
  };

  Monopoly.replaceState = function (s) { Monopoly.state = s; };

  const currentPlayer = () => Monopoly.state.players[Monopoly.state.current];
  const findPlace = id => P().find(pl => pl.id === id);

  Monopoly.currentPlayer = currentPlayer;

  Monopoly.log = function (msg) {
    if (!Monopoly.state) return;
    Monopoly.state.log.push(msg);
    if (Monopoly.state.log.length > 120) Monopoly.state.log.shift();
  };

  Monopoly.payMoneyToBank = function (player, amount) {
    payMoney(player, amount, 'bank');
    broadcastIfOnline();
  };

  function groupOf(color) { return C().rents.property[color]; }

  function totalWealth(player) {
    let sum = player.money;
    for (const sid of player.properties) {
      const o = Monopoly.state.owned[sid];
      if (!o.mortgaged) sum += findPlace(sid).price;
    }
    return sum;
  }
  Monopoly.totalWealth = totalWealth;

  function raiseFunds(player, amount) {
    let tries = 0;
    while (player.money < amount && tries < 200) {
      tries++;
      let sold = false;
      for (const sid in Monopoly.state.owned) {
        const o = Monopoly.state.owned[sid];
        if (o.owner === player.id && o.houses > 0) {
          const wasHotel = o.houses === 5;
          const g = groupOf(findPlace(+sid).color);
          o.houses -= 1;
          player.money += wasHotel ? g.houseCost * 5 : g.houseCost;
          sold = true; break;
        }
      }
      if (sold) continue;
      let mort = false;
      for (const prop of player.properties) {
        const o = Monopoly.state.owned[prop];
        if (!o.mortgaged) {
          o.mortgaged = true;
          player.money += findPlace(prop).mortgage;
          mort = true; break;
        }
      }
      if (!mort) break;
    }
  }

  function payMoney(player, amount, to) {
    if (!player.alive) return;
    amount = Math.max(0, Math.round(amount));
    if (player.money + totalWealth(player) < amount) { declareBankrupt(player, to); return; }
    raiseFunds(player, amount);
    if (player.money < amount) { declareBankrupt(player, to); return; }
    player.money -= amount;
    if (to === 'bank') {
      Monopoly.log(player.name + ' zahlt CHF ' + amount + ' an die Bank.');
    } else if (Monopoly.state.players[to] && Monopoly.state.players[to].alive) {
      Monopoly.state.players[to].money += amount;
      Monopoly.log(player.name + ' zahlt CHF ' + amount + ' an ' + Monopoly.state.players[to].name + '.');
    } else {
      Monopoly.log(player.name + ' zahlt CHF ' + amount + ' an die Bank.');
    }
    broadcastIfOnline();
  }

  function declareBankrupt(player, creditor) {
    player.alive = false; player.bankrupt = true;
    for (const sid of player.properties) {
      const o = Monopoly.state.owned[sid];
      const g = groupOf(findPlace(sid).color);
      const value = o.houses === 5 ? g.houseCost * 5 : g.houseCost * o.houses;
      player.money += Math.floor(value / 2);
      o.houses = 0;
    }
    const props = player.properties.slice();
    for (const sid of props) {
      const o = Monopoly.state.owned[sid];
      o.mortgaged = false;
      if (creditor !== 'bank' && Monopoly.state.players[creditor] && Monopoly.state.players[creditor].alive) {
        o.owner = creditor;
        Monopoly.state.players[creditor].properties.push(sid);
      } else o.owner = null;
    }
    player.properties = [];
    if (creditor !== 'bank' && Monopoly.state.players[creditor] && Monopoly.state.players[creditor].alive) {
      Monopoly.state.players[creditor].money += player.money;
    }
    player.money = 0;
    Monopoly.log(player.name + ' ist bankrott!');
    const alive = Monopoly.state.players.filter(p => p.alive);
    if (alive.length === 1) {
      Monopoly.state.winner = alive[0].id;
      Monopoly.state.phase = 'over';
      Monopoly.log(alive[0].name + ' gewinnt das Spiel!');
    }
    broadcastIfOnline();
  }

  /* ---------- Würfeln & Bewegung ---------- */
  Monopoly.roll = function () {
    const st = Monopoly.state;
    const pl = currentPlayer();
    if (st.phase !== 'pre' && !(pl.inJail && st.phase === 'pre')) return false;
    if (pl.inJail) return handleJailRoll(pl);
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    st.dice = dice;
    const isDouble = dice[0] === dice[1];
    Monopoly.log(pl.name + ' würfelt ' + dice[0] + ' + ' + dice[1] + '.');
    if (isDouble) {
      pl.doubles += 1;
      if (pl.doubles >= C().game.maxDoublesForJail) {
        sendToJail(pl); pl.doubles = 0; st.phase = 'pre'; advanceTurn(); return;
      }
      st.lastDouble = true;
    } else { pl.doubles = 0; st.lastDouble = false; }
    movePlayer(pl, dice[0] + dice[1]);
  };

  function movePlayer(pl, steps, skipGo) {
    const st = Monopoly.state;
    let newPos = (pl.position + steps) % 40;
    if (newPos < 0) newPos += 40;
    if (!skipGo && newPos < pl.position) {
      pl.money += C().game.goSalary;
      Monopoly.log(pl.name + ' überquert LOS und erhält CHF ' + C().game.goSalary + '.');
    }
    pl.position = newPos;
    st.phase = 'moved';
    afterMove(pl);
    broadcastIfOnline();
  }

  function afterMove(pl) {
    const st = Monopoly.state;
    const place = findPlace(pl.position);
    switch (place.type) {
      case 'corner': turnComplete(pl); break;
      case 'tax':
        st.phase = 'decide';
        st.tax = place.amount;
        broadcastIfOnline();
        break;
      case 'property': case 'railroad': case 'utility': {
        const o = st.owned[place.id];
        if (!o.owner) {
          if (pl.money >= place.price) {
            st.phase = 'decide';
            st.purchase = place.id;
            broadcastIfOnline();
          } else {
            Monopoly.log(pl.name + ' kann sich ' + place.name + ' nicht leisten.');
            turnComplete(pl);
          }
        } else if (o.owner === pl.id) {
          turnComplete(pl);
        } else if (o.mortgaged) {
          Monopoly.log('Hypothek auf ' + place.name + ' – keine Miete.');
          turnComplete(pl);
        } else {
          payMoney(pl, rentFor(place, o, pl), o.owner);
          turnComplete(pl);
        }
        break;
      }
      case 'community': case 'chance':
        drawCard(pl, place.type);
        break;
      default: turnComplete(pl);
    }
  }

  function rentFor(place, o, payer) {
    const st = Monopoly.state; const owner = st.players[o.owner];
    if (place.type === 'railroad') {
      let owned = 0;
      P().forEach(p => { if (p.type === 'railroad' && st.owned[p.id].owner === owner.id) owned++; });
      let rent = C().rents.railroad.rent[owned - 1];
      if (st.doubleRail) { rent *= 2; st.doubleRail = false; }
      return rent;
    }
    if (place.type === 'utility') {
      let owned = 0;
      P().forEach(p => { if (p.type === 'utility' && st.owned[p.id].owner === owner.id) owned++; });
      const mult = owned === 1 ? C().rents.utility.oneRentMultiplier : C().rents.utility.twoRentMultiplier;
      return (st.dice[0] + st.dice[1]) * mult;
    }
    const group = groupOf(place.color);
    let rent = group.rent[o.houses] || group.rent[0];
    if (o.houses === 0) {
      const set = P().filter(p => p.color === place.color);
      if (set.every(p => st.owned[p.id].owner === owner.id &&
                         !st.owned[p.id].mortgaged)) rent *= 2;
    }
    return rent;
  }

  /* ---------- Kaufen ---------- */
  Monopoly.buy = function () {
    const st = Monopoly.state; const pl = currentPlayer();
    if (st.purchase == null) return;
    const place = findPlace(st.purchase);
    if (st.owned[place.id].owner !== null) return;
    if (pl.money < place.price) return;
    pl.money -= place.price;
    st.owned[place.id].owner = pl.id;
    pl.properties.push(place.id);
    st.purchase = null;
    Monopoly.log(pl.name + ' kauft ' + place.name + ' für CHF ' + place.price + '.');
    broadcastIfOnline();
  };

  /* ---------- Gefängnis ---------- */
  function sendToJail(pl) {
    pl.inJail = true; pl.position = 10; pl.jailTurns = 0;
    Monopoly.log(pl.name + ' geht ins Gefängnis.');
    broadcastIfOnline();
  }
  Monopoly.sendToJail = sendToJail;

  Monopoly.payBail = function () {
    const pl = currentPlayer();
    if (!pl.inJail) return;
    payMoney(pl, C().game.jailBail, 'bank');
    pl.inJail = false; pl.jailTurns = 0;
    Monopoly.roll();
  };

  Monopoly.useGetOutOfJail = function () {
    const pl = currentPlayer();
    if (!pl.inJail || pl.getOutOfJail < 1) return;
    pl.getOutOfJail -= 1; pl.inJail = false; pl.jailTurns = 0;
    Monopoly.log(pl.name + ' benutzt die Frei-Karte.');
    Monopoly.roll();
  };

  function handleJailRoll(pl) {
    const st = Monopoly.state;
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    st.dice = dice;
    if (dice[0] === dice[1]) {
      Monopoly.log(pl.name + ' würfelt einen Pasch im Gefängnis und kommt frei.');
      pl.inJail = false; pl.jailTurns = 0;
      movePlayer(pl, dice[0] + dice[1]);
    } else {
      pl.jailTurns += 1;
      if (pl.jailTurns >= C().game.jailTurnLimit) {
        Monopoly.log(pl.name + ' zahlt CHF ' + C().game.jailBail + ' und würfelt neu.');
        payMoney(pl, C().game.jailBail, 'bank');
        pl.inJail = false; pl.jailTurns = 0;
        const isDouble = dice[0] === dice[1];
        st.lastDouble = isDouble;
        movePlayer(pl, dice[0] + dice[1]);
      } else {
        Monopoly.log(pl.name + ' bleibt im Gefängnis (Versuch ' + pl.jailTurns + ').');
        st.phase = 'pre';
        advanceTurn();
      }
    }
    broadcastIfOnline();
    return true;
  }

  /* ---------- Zugablauf ---------- */
  Monopoly.turnComplete = function (pl) {
    const st = Monopoly.state;
    if (st.phase === 'over') return;
    if (pl.inJail) { st.phase = 'pre'; advanceTurn(); return; }
    if (st.lastDouble) { st.phase = 'pre'; broadcastIfOnline(); return; }
    advanceTurn();
  };

  Monopoly.endTurn = function () {
    const st = Monopoly.state;
    if (st.phase === 'card') return;
    st.lastDouble = false;
    st.pending = null;
    advanceTurn();
  };

  function advanceTurn() {
    const st = Monopoly.state;
    if (st.phase === 'over') return;
    st.current = nextPlayerIndex();
    st.phase = 'pre';
    st.purchase = null;
    st.tax = null;
    st.pending = null;
    st.turnCount += 1;
    Monopoly.log('— Zug von ' + currentPlayer().name + ' —');
    broadcastIfOnline();
  }
  Monopoly.advanceTurn = advanceTurn;

  function nextPlayerIndex() {
    const n = Monopoly.state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (Monopoly.state.current + i) % n;
      if (Monopoly.state.players[idx].alive) return idx;
    }
    return Monopoly.state.current;
  }

  /* ---------- Karten ---------- */
  function drawCard(pl, type) {
    const st = Monopoly.state;
    const deck = Monopoly.DATA.cards[type === 'chance' ? 'chance' : 'chest'];
    const card = deck[Math.floor(Math.random() * deck.length)];
    st.phase = 'card';
    st.lastCard = { type: type, card: card, player: pl.id };
    broadcastIfOnline();
  }

  Monopoly.applyCard = function () {
    const st = Monopoly.state;
    if (!st.lastCard) return;
    const { card, player: pid } = st.lastCard;
    const pl = st.players[pid];
    st.lastCard = null;

    switch (card.action) {
      case 'goto': movePlayer(pl, ((card.target - pl.position + 40) % 40) || 40); return;
      case 'goToJail': sendToJail(pl); turnComplete(pl); return;
      case 'getOutOfJail': pl.getOutOfJail += 1; break;
      case 'payFromBank': pl.money += card.amount; Monopoly.log(pl.name + ' erhält CHF ' + card.amount + '.'); break;
      case 'payToBank': payMoney(pl, card.amount, 'bank'); break;
      case 'collectFromAll':
        st.players.forEach(q => { if (q.alive && q.id !== pid) payMoney(q, card.amount, pid); });
        break;
      case 'gotoNearestRailroad': {
        let cur = pl.position, found = null;
        for (let i = 1; i <= 40; i++) { const t = (cur + i) % 40; if (findPlace(t).type === 'railroad') { found = t; break; } }
        const o = st.owned[found];
        st.doubleRail = (o && o.owner && o.owner !== pl.id && !o.mortgaged);
        movePlayer(pl, ((found - pl.position + 40) % 40) || 40);
        if (st.doubleRail) payMoney(pl, rentFor(findPlace(found), o, pl) * 2, o.owner);
        return;
      }
      case 'moveBack': movePlayer(pl, -Math.abs(card.steps)); return;
      case 'houseRepairs': {
        let houses = 0, hotels = 0;
        pl.properties.forEach(sid => { const h = st.owned[sid].houses; if (h === 5) hotels++; else houses += h; });
        payMoney(pl, houses * card.house + hotels * card.hotel, 'bank');
        break;
      }
      default: break;
    }
    turnComplete(pl);
    broadcastIfOnline();
  };

  /* ---------- Bauen ---------- */
  Monopoly.canBuildMore = function (sid) {
    const st = Monopoly.state;
    const place = findPlace(sid);
    if (place.type !== 'property') return false;
    const grp = P().filter(p => p.color === place.color);
    const owner = st.owned[sid].owner;
    if (grp.some(p => st.owned[p.id].owner !== owner)) return false;
    if (grp.some(p => st.owned[p.id].mortgaged)) return false;
    const target = st.owned[sid].houses;
    return grp.every(p => st.owned[p.id].houses >= target);
  };

  Monopoly.build = function (sid) {
    const st = Monopoly.state;
    const place = findPlace(sid);
    const g = groupOf(place.color);
    const owner = st.players[st.owned[sid].owner];
    if (!Monopoly.canBuildMore(sid)) return false;
    if (st.owned[sid].houses >= 5) return false;
    if (owner.money < g.houseCost) { if (Monopoly.ui.toast) Monopoly.ui.toast('Nicht genug Geld.'); return false; }
    owner.money -= g.houseCost;
    st.owned[sid].houses += 1;
    Monopoly.log(owner.name + ' baut ein ' + (st.owned[sid].houses === 5 ? 'Hotel' : 'Haus') + ' auf ' + place.name + '.');
    broadcastIfOnline();
    return true;
  };

  Monopoly.sellHouse = function (sid) {
    const st = Monopoly.state;
    const place = findPlace(sid);
    const g = groupOf(place.color);
    const owner = st.players[st.owned[sid].owner];
    if (st.owned[sid].houses <= 0) return;
    const max = Math.max.apply(null, P().filter(p => p.color === place.color).map(p => st.owned[p.id].houses));
    if (st.owned[sid].houses < max) { if (Monopoly.ui.toast) Monopoly.ui.toast('Reihenfolge: erst die höchsten Häuser.'); return; }
    const refund = st.owned[sid].houses === 5 ? g.houseCost * 5 : g.houseCost;
    st.owned[sid].houses -= 1;
    owner.money += refund;
    Monopoly.log(owner.name + ' verkauft ein Haus auf ' + place.name + '.');
    broadcastIfOnline();
  };

  /* ---------- Hypotheken ---------- */
  Monopoly.mortgage = function (sid) {
    const st = Monopoly.state; const place = findPlace(sid);
    if (!st.owned[sid]) return;
    if (st.owned[sid].houses > 0) { if (Monopoly.ui.toast) Monopoly.ui.toast('Zuerst Häuser verkaufen.'); return; }
    if (st.owned[sid].mortgaged) return;
    st.owned[sid].mortgaged = true;
    st.players[st.owned[sid].owner].money += place.mortgage;
    Monopoly.log(st.players[st.owned[sid].owner].name + ' hypothekiert ' + place.name + '.');
    broadcastIfOnline();
  };

  Monopoly.unmortgage = function (sid) {
    const st = Monopoly.state; const place = findPlace(sid);
    if (!st.owned[sid] || !st.owned[sid].mortgaged) return;
    const cost = Math.ceil(place.mortgage * C().rents.unmortgagePercentMultiplier);
    const owner = st.players[st.owned[sid].owner];
    if (owner.money < cost) { if (Monopoly.ui.toast) Monopoly.ui.toast('Nicht genug Geld.'); return; }
    owner.money -= cost; st.owned[sid].mortgaged = false;
    Monopoly.log(owner.name + ' löst die Hypothek von ' + place.name + '.');
    broadcastIfOnline();
  };

  /* ---------- Handel ---------- */
  Monopoly.trade = function (fromId, toId, money1, props1, money2, props2) {
    const st = Monopoly.state;
    const from = st.players[fromId], to = st.players[toId];
    if (!from || !to || !from.alive || !to.alive) return;
    if (from.money < money1 || to.money < money2) {
      if (Monopoly.ui.toast) Monopoly.ui.toast('Nicht genug Geld für den Tausch.'); return;
    }
    const moveProps = (src, dst, props) => {
      (props || []).forEach(sid => {
        if (st.owned[sid].owner !== src.id) return;
        const idx = src.properties.indexOf(sid);
        if (idx > -1) src.properties.splice(idx, 1);
        st.owned[sid].owner = dst.id;
        dst.properties.push(sid);
      });
    };
    from.money += wantToOffer(money2, money1);
    to.money += wantToOffer(money1, money2);
    moveProps(from, to, props1);
    moveProps(to, from, props2);
    Monopoly.log(from.name + ' und ' + to.name + ' handeln.');
    if (Monopoly.ui.closeModal) Monopoly.ui.closeModal();
    broadcastIfOnline();
  };
  function wantToOffer(want, give) { return want - give; }

  /* ---------- Netzwerk-Haken ---------- */
  function broadcastIfOnline() {
    if (Monopoly.net && Monopoly.net.onStateChange) Monopoly.net.onStateChange();
  }
  Monopoly._broadcast = broadcastIfOnline;

})(window);