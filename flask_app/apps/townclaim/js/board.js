/* board.js — draws the 11x11 Monopoly board and player tokens. */
(function (global) {
  'use strict';
  const Monopoly = global.Monopoly = global.Monopoly || {};

  /* Map a board space id (0-39) to an (col,row) on an 11x11 grid (0-based). */
  function positionOf(id) {
    if (id >= 0 && id <= 10)  return { col: id,     row: 10 }; // bottom row
    if (id >= 11 && id <= 20) return { col: 10,     row: 20 - id }; // right side going up
    if (id >= 21 && id <= 30) return { col: 30 - id, row: 0 }; // top row going left
    /* 31..39 left side going down */
    return { col: 0, row: id - 29 - 1 };
  }

  Monopoly.board = { positionOf: positionOf };

  /* Orientation helpers so the colour strip sits on the inner edge. */
  function orientationOf(id) {
    if (id >= 1 && id <= 9)  return 'bottom'; // strip at top
    if (id >= 11 && id <= 19) return 'right'; // strip at left
    if (id >= 21 && id <= 29) return 'top';   // strip at bottom
    if (id >= 31 && id <= 39) return 'left';  // strip at right
    return 'corner';
  }

  /* Build the board DOM once the places data is loaded. */
  Monopoly.renderBoard = function () {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    /* Central square */
    const center = document.createElement('div');
    center.className = 'board-center';
    center.innerHTML =
      '<div class="board-title">MONOPOLY</div>' +
      '<div class="board-title-sub">Amriswil und Umgebung</div>';
    boardEl.appendChild(center);

    const places = Monopoly.DATA.places;

    places.forEach(function (place) {
      const pos = positionOf(place.id);
      const tile = document.createElement('div');
      tile.className = 'space space-orient-' + orientationOf(place.id);
      tile.id = 'space-' + place.id;
      tile.dataset.id = place.id;

      if (place.type === 'property') {
        const strip = document.createElement('div');
        strip.className = 'color-strip';
        strip.style.background = Monopoly.color(place.color);
        tile.appendChild(strip);
      }

      const label = document.createElement('div');
      label.className = 'space-label';
      label.textContent = place.name;
      tile.appendChild(label);

      if (place.sub) {
        const sub = document.createElement('div');
        sub.className = 'space-sub';
        sub.textContent = place.sub;
        tile.appendChild(sub);
      }

      tile.style.gridColumn = (pos.col + 1);
      tile.style.gridRow = (pos.row + 1);

      tile.addEventListener('click', function () {
        Monopoly.ui.showSpaceInfo(place);
      });

      boardEl.appendChild(tile);
    });

    Monopoly.renderTokens();
    Monopoly.renderOwnership();
  };

  /* Colour map shared by board + UI. */
  Monopoly.color = function (name) {
    const map = {
      Brown: '#8b5a2b', LightBlue: '#a0d8ef', Pink: '#f4a7c2',
      Orange: '#f5a35c', Red: '#e4574f', Yellow: '#f7e464',
      Green: '#7ac47c', DarkBlue: '#3a6ea5'
    };
    return map[name] || '#bbb';
  };

  /* Draw each player's token onto its current space. */
  Monopoly.renderTokens = function () {
    const boardEl = document.getElementById('board');
    document.querySelectorAll('.player-token').forEach(function (t) { t.remove(); });

    const state = Monopoly.state;
    if (!state || !state.players) return;

    const boardRect = boardEl.getBoundingClientRect();

    state.players.forEach(function (p) {
      if (!p.alive) return;
      const tile = document.getElementById('space-' + p.position);
      if (!tile) return;
      const tr = tile.getBoundingClientRect();

      const token = document.createElement('div');
      token.className = 'player-token';
      token.style.background = p.color;
      token.textContent = p.name.charAt(0).toUpperCase();
      token.title = p.name;

      /* Offset multiple tokens on the same space. */
      const idx = state.players.filter(function (q) {
        return q.alive && q.position === p.position;
      }).indexOf(p);

      const dx = ((idx % 2) * 16) - 8;
      const dy = (Math.floor(idx / 2) * 16) - 8;

      token.style.left = (tr.left - boardRect.left + tr.width / 2 - 12 + dx) + 'px';
      token.style.top = (tr.top - boardRect.top + tr.height / 2 - 12 + dy) + 'px';
      boardEl.appendChild(token);
    });
  };

  /* Show ownership: coloured frame / dot + house count on each property tile. */
  Monopoly.renderOwnership = function () {
    const state = Monopoly.state;
    if (!state || !state.players) return;

    Monopoly.DATA.places.forEach(function (place) {
      const tile = document.getElementById('space-' + place.id);
      if (!tile) return;
      tile.classList.remove('owned');

      const owner = state.players.find(function (p) {
        return p.properties && p.properties.indexOf(place.id) !== -1;
      });

      const dot = tile.querySelector('.owner-dot');
      if (dot) dot.remove();
      const hc = tile.querySelector('.house-count');
      if (hc) hc.remove();

      if (owner) {
        const od = document.createElement('div');
        od.className = 'owner-dot';
        od.style.background = owner.color;
        tile.appendChild(od);

        const prop = state.owned[place.id];
        if (prop && prop.houses > 0) {
          const hd = document.createElement('div');
          hd.className = 'house-count';
          hd.textContent = (prop.houses === 5) ? 'H' : '🏠×' + prop.houses;
          tile.appendChild(hd);
        }
      }
    });
  };

})(window);