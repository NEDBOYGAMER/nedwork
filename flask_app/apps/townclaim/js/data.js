/* data.js — loads every JSON file into Monopoly.DATA. */
(function (global) {
  'use strict';

  const Monopoly = global.Monopoly = global.Monopoly || {};

  Monopoly.DATA = {
    config: null,
    places: null,
    cards: null,
    ready: false
  };

  /* Fetch helper */
  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  /* Load all data files. Returns a Promise. */
  Monopoly.loadData = function (basePath) {
    basePath = basePath || '';
    return Promise.all([
      fetchJSON(basePath + 'data/config.json'),
      fetchJSON(basePath + 'data/places.json'),
      fetchJSON(basePath + 'data/cards.json')
    ]).then(function (results) {
      Monopoly.DATA.config = results[0];
      Monopoly.DATA.places = results[1];
      Monopoly.DATA.cards = results[2];
      Monopoly.DATA.ready = true;
      return Monopoly.DATA;
    });
  };

})(window);