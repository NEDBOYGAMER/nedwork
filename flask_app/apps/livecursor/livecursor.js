(() => {
  'use strict';

  // Three fixed board levels. The largest one that fits the window wins;
  // if even the smallest does not fit, it is used anyway (the page scrolls).
  const LEVELS = [
    { name: 'large', w: 1260, h: 840 },
    { name: 'medium', w: 990, h: 660 },
    { name: 'small', w: 720, h: 480 },
  ];
  const PAGE_SIDE = 32;   // stage padding left + right
  const PAGE_VERT = 80;   // stage padding top + bottom

  const params = new URLSearchParams(location.search);
  let room = params.get('r');
  if (!room) {
    room = Math.random().toString(36).slice(2, 10);
    params.set('r', room);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  const clientId = sessionStorage.getItem('lc_client') || randomId();
  sessionStorage.setItem('lc_client', clientId);

  const nameInput = document.getElementById('name');
  nameInput.value = sessionStorage.getItem('lc_name')
    || `Player ${clientId.slice(0, 4)}`;
  nameInput.addEventListener('input', () => {
    sessionStorage.setItem('lc_name', nameInput.value);
  });

  const palette = ['#6c5ce7', '#22c58b', '#e5484d', '#f4a261',
                   '#4ea8de', '#e9c46a', '#ff6b9d'];
  let hash = 0;
  for (const ch of clientId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = palette[hash % palette.length];

  const board = document.getElementById('board');
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const coordsEl = document.getElementById('coords');
  const levelEl = document.getElementById('level');

  let boardW = 1200;
  let boardH = 800;

  const remote = new Map();   // client -> {name, color, nx, ny}
  const cursors = new Map();  // client -> cursor element

  const isLocalHost = location.hostname === 'localhost'
    || location.hostname === '127.0.0.1';
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const devPort = location.port ? Number(location.port) + 1 : 5001;
  const wsBase = (isLocalHost || location.port === '5000')
    ? `${wsProto}://${location.hostname}:${devPort}`
    : `${wsProto}://${location.host}`;
  const wsUrl = `${wsBase}/apps/livecursor/ws`
    + `?room=${encodeURIComponent(room)}`
    + `&client=${encodeURIComponent(clientId)}`;

  let socket = null;
  let reconnectTimer = null;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = `status ${cls || ''}`;
  }

  function chooseLevel() {
    const availW = document.documentElement.clientWidth - PAGE_SIDE;
    const availH = document.documentElement.clientHeight - PAGE_VERT;
    return LEVELS.find(l => l.w <= availW && l.h <= availH)
      || LEVELS[LEVELS.length - 1];
  }

  function positionCursor(el, data) {
    el.style.left = `${data.nx * boardW}px`;
    el.style.top = `${data.ny * boardH}px`;
    el.style.color = data.color || '#fff';
    const label = el.querySelector('.name');
    label.textContent = data.name || 'Guest';
    label.style.background = data.color || '#6c5ce7';
  }

  function renderAllCursors() {
    cursors.forEach((el, client) => {
      const data = remote.get(client);
      if (data) positionCursor(el, data);
    });
  }

  function applyLevel() {
    const level = chooseLevel();
    board.style.width = `${level.w}px`;
    board.style.height = `${level.h}px`;
    // The overlay lives inside the 1px border, so positions are in
    // clientWidth/clientHeight units.
    boardW = board.clientWidth || level.w;
    boardH = board.clientHeight || level.h;
    levelEl.textContent = `${level.name} · ${level.w}×${level.h}`;
    renderAllCursors();
  }

  function renderCursor(client, data) {
    remote.set(client, {
      name: data.name || 'Guest',
      color: data.color || '#6c5ce7',
      nx: Number(data.x) || 0,
      ny: Number(data.y) || 0,
    });
    let el = cursors.get(client);
    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24"'
        + ' fill="currentColor" aria-hidden="true">'
        + '<path d="M4 2l16 8.5-7 1.7-3.2 6.4L4 2z"/></svg>'
        + '<span class="name"></span>';
      overlay.appendChild(el);
      cursors.set(client, el);
    }
    positionCursor(el, remote.get(client));
  }

  function removeCursor(client) {
    remote.delete(client);
    const el = cursors.get(client);
    if (el) {
      el.remove();
      cursors.delete(client);
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    setStatus('connecting…', '');
    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
      setStatus(`connected · room ${room}`, 'connected');
      document.body.dataset.connected = '1';
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || !msg.client || msg.client === clientId) return;
      if (msg.type === 'cursor') renderCursor(msg.client, msg);
      else if (msg.type === 'leave') removeCursor(msg.client);
    });

    socket.addEventListener('close', () => {
      document.body.dataset.connected = '0';
      setStatus('disconnected — retrying…', 'error');
      reconnectTimer = setTimeout(connect, 1000);
    });
  }

  const last = { nx: 0, ny: 0 };
  let frame = 0;

  function sendCursor() {
    frame = 0;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'cursor',
      name: nameInput.value.trim() || 'Guest',
      color,
      x: last.nx,
      y: last.ny,
    }));
  }

  document.addEventListener('mousemove', (event) => {
    const rect = board.getBoundingClientRect();
    const bw = board.clientWidth || 1;
    const bh = board.clientHeight || 1;
    const nx = (event.clientX - rect.left - board.clientLeft) / bw;
    const ny = (event.clientY - rect.top - board.clientTop) / bh;
    const inside = nx >= 0 && ny >= 0 && nx <= 1 && ny <= 1;
    coordsEl.textContent = inside
      ? `${Math.round(nx * 1200)}, ${Math.round(ny * 800)}`
      : '–';
    if (!inside) return;
    last.nx = nx;
    last.ny = ny;
    if (!frame) frame = requestAnimationFrame(sendCursor);
  });

  document.getElementById('copy').addEventListener('click', async () => {
    const button = document.getElementById('copy');
    try {
      await navigator.clipboard.writeText(location.href);
      const old = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = old; }, 1200);
    } catch {
      prompt('Copy this invite link:', location.href);
    }
  });

  window.addEventListener('resize', applyLevel);

  window.addEventListener('beforeunload', () => {
    try { socket.close(); } catch { /* ignore */ }
  });

  applyLevel();
  connect();
})();
