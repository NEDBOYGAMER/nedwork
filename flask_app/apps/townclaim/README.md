# 🎲 Monopoly Amriswil

Ein komplettes, im Browser spielbares Monopoly, bei dem alle Felder nach
Städten und Dörfern rund um **Amriswil (Thurgau)** benannt sind:
Amriswil, Romanshorn, Arbon, Weinfelden, Frauenfeld, Altnau, Oberaach,
Niederaach, Steinach, Neukirch-Egnach, Sommeri, Dozwil, Lankrickenbach,
Bischofszell, Uttwil, Salmsach, Kesswil, Güttingen, Roggwil, Wittenbach,
Muolen, Wil … plus die Bahnhöfe und das E-Werk & Wasserwerk.

## Spielregeln (echtes Monopoly)
- 2–8 Spieler, Startgeld CHF 1'500, LOS gibt CHF 200.
- Würfeln, Kaufen, Mieten, Steuern, Gefängnis, Schicksal/Gemeinschaftsfeld,
  Häuser & Hotels, Hypotheken, Handeln – alles enthalten.
- Pasch = nochmal würfeln, 3× Pasch = ins Gefängnis.
- Bankrott ausscheiden, der letzte Spieler gewinnt.

## Dateien
- `index.html` – Einstieg (Menü, Lobby, Spielfeld)
- `css/style.css` – komplettes Layout
- `js/data.js`   – lädt alle JSON-Daten
- `js/board.js`  – zeichnet das 40-Felder-Brett
- `js/engine.js` – die komplette Spiellogik
- `js/ui.js`     – Menüs, Panels, Modals
- `js/net.js`    – Online-Mehrspieler (WebSocket)
- `data/config.json` – Geld, Steuern, Hausregeln
- `data/places.json` – alle 40 Felder mit Preisen/Mieten
- `data/cards.json`  – alle Schicksal- & Gemeinschaftsfeld-Karten
- `server.js`    – Room-Server für Online-Spiele
- `package.json` – Server-Abhängigkeiten
