/* net.js — online multiplayer via a WebSocket room server. */
(function (global) {
  'use strict';
  const Monopoly = global.Monopoly = global.Monopoly || {};

  const CFG_DEFAULT = 'ws://' + location.hostname + ':8080';

  Monopoly.net = {
    socket: null,
    connected: false,
    host: false,
    room: null,
    playerId: null,
    onStateChange: null,  // set by ui.js
    onState: null,        // set by ui.js (received state)
    setConnected: null    // set by ui.js (lobby status)
  };

  function serverUrl() {
    const custom = document.getElementById('serverUrl').value.trim();
    return custom || CFG_DEFAULT + '/';
  }

  /* Connect (or reconnect) using the server URL field. */
  function connect() {
    if (Monopoly.net.socket) { try { Monopoly.net.socket.close(); } catch (e) {} }

    const url = serverUrl();
    // console.log('Connecting to ' + url);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      if (Monopoly.net.setConnected) Monopoly.net.setConnected(false, 'WebSocket nicht erreichbar: ' + e.message);
      return;
    }

    Monopoly.net.socket = ws;

    ws.onopen = function () {
      Monopoly.net.connected = true;
      if (Monopoly.net.setConnected) Monopoly.net.setConnected(true, 'Verbunden mit ' + url);
      // rejoin if we already had a room
    };

    ws.onclose = function () {
      Monopoly.net.connected = false;
      if (Monopoly.net.setConnected) Monopoly.net.setConnected(false, 'Verbindung geschlossen');
    };

    ws.onerror = function () {
      if (Monopoly.net.setConnected) Monopoly.net.setConnected(false, 'Verbindungsfehler');
    };

    ws.onmessage = function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
  }

  function send(obj) {
    if (Monopoly.net.socket && Monopoly.net.socket.readyState === 1) {
      Monopoly.net.socket.send(JSON.stringify(obj));
    } else {
      Monopoly.ui.toast('Nicht verbunden mit dem Server.');
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'created':
        Monopoly.net.room = msg.room;
        Monopoly.net.playerId = msg.you;
        Monopoly.net.host = true;
        Monopoly.ui.onRoomCreated(msg);
        break;
      case 'joined':
        Monopoly.net.room = msg.room;
        Monopoly.net.playerId = msg.you;
        Monopoly.net.host = false;
        Monopoly.ui.onRoomJoined(msg);
        break;
      case 'state':
        if (!Monopoly.net.host && Monopoly.net.onState) Monopoly.net.onState(msg.state);
        break;
      case 'action':
        /* host receives an action from a remote player */
        if (Monopoly.net.host && Monopoly.net.onAction) Monopoly.net.onAction(msg);
        break;
      case 'players':
        Monopoly.ui.onRoomPlayers(msg.players);
        break;
      case 'error':
        Monopoly.ui.toast(msg.message);
        break;
    }
  }

  /* --- Client-facing API --- */

  Monopoly.net.createRoom = function () {
    connect();
    // small delay then send create
    setTimeout(function () {
      send({ type: 'create' });
    }, 120);
    Monopoly.ui.showLobbyStatus('Room wird erstellt…');
  };

  Monopoly.net.joinRoom = function (code) {
    connect();
    setTimeout(function () {
      send({ type: 'join', code: code.toUpperCase() });
    }, 120);
    Monopoly.ui.showLobbyStatus('Beitreten ' + code.toUpperCase() + '…');
  };

  /* Non-host sends their intended action to the host. */
  Monopoly.net.sendAction = function (action) {
    send({ type: 'action', room: Monopoly.net.room, from: Monopoly.net.playerId, action: action });
  };

  /* Host broadcasts the current state to the whole room. */
  Monopoly.net.broadcastState = function () {
    if (Monopoly.net.host && Monopoly.state) {
      send({ type: 'state', room: Monopoly.net.room, state: Monopoly.state });
    }
  };

  Monopoly.net.disconnect = function () {
    if (Monopoly.net.socket) { try { Monopoly.net.socket.close(); } catch (e) {} }
    Monopoly.net.room = null;
    Monopoly.net.playerId = null;
    Monopoly.net.host = false;
    Monopoly.net.connected = false;
  };

})(window);