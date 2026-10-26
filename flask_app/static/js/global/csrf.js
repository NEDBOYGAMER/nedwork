/* csrf.js — global CSRF protection patch.
 *
 * Loaded on every HTML page (injected by the app factory right before
 * </head>, so it can't be forgotten by any page author). It attaches the
 * double-submit token to every same-origin state-changing request:
 *   - window.fetch() calls
 *   - XMLHttpRequest requests
 *
 * The server compares this header against the csrf_token cookie in a
 * global before_request hook. GET/HEAD requests are not modified.
 * Login/registration are exempt server-side (no session exists yet).
 *
 * If a page/tab was already open before a new token cookie was issued,
 * the token cookie is refreshed on the next full page load, so at worst
 * a single stale request receives a 403.
 */
(function () {
  "use strict";

  var TOKEN_COOKIE = "csrf_token";
  var HEADER_NAME = "X-CSRF-Token";
  var STATE_CHANGING = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };

  function readToken() {
    var match = document.cookie.match(
      /(?:^|;\s*)csrf_token=([^;]+)/
    );
    return match ? match[1] : "";
  }

  function sameOrigin(url) {
    try {
      var u = new URL(url, window.location.href);
      return u.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function wantsToken(url, method) {
    return (
      method &&
      STATE_CHANGING[method.toUpperCase()] &&
      sameOrigin(url)
    );
  }

  /* ---- fetch ---- */
  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var method =
          (init && init.method) || (input && input.method) || "GET";
        if (wantsToken(url, method)) {
          var token = readToken();
          if (token) {
            init = Object.assign({}, init || {});
            var headers = new Headers(
              (init.headers instanceof Headers ||
                (init.headers && init.headers.append))
                ? init.headers
                : (init.headers || null)
            );
            if (!headers.get(HEADER_NAME)) {
              headers.set(HEADER_NAME, token);
            }
            init.headers = headers;
          }
        }
      } catch (e) {
        /* never break a request because of token bookkeeping */
      }
      return originalFetch(input, init);
    };
  }

  /* ---- XMLHttpRequest ---- */
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__nedworkCsrf = { method: method, url: url };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    try {
      var ctx = this.__nedworkCsrf;
      if (ctx && wantsToken(ctx.url, ctx.method)) {
        var token = readToken();
        if (token) {
          this.setRequestHeader(HEADER_NAME, token);
        }
      }
    } catch (e) {
      /* ignore */
    }
    return originalSend.apply(this, arguments);
  };
})();
