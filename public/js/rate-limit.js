/*
 * TMA. "Too many requests": everything in the background stands back.
 *
 * The firm's edge (Cloudflare) answers 429 to a connection that asks too
 * much too fast, and then refuses EVERYTHING from it for a while: icons,
 * messages, a send. The apps' offline download walked every conversation a
 * twelfth of a second apart and, refused, carried on to the next one, while
 * the catch-up walkers were started again on every failed /me; so once
 * refused, the apps kept themselves refused, and every screen said "Request
 * failed".
 *
 * This is the one place that hears a 429. It notes it and sets a cool-down
 * (the edge's Retry-After, else a minute, longer each time it happens again
 * inside one, up to ten), and the background work asks before each request:
 * offline-download.js stops, the replica walkers skip, and offline-fetch.js
 * gives screens the copy the app holds instead of the refusal. What a person
 * does (a send, a save) still goes; the write queue already parks a 429 as
 * "The server is busy" and tries again.
 *
 * Global: window.TMARateLimit ({ note, coolingDown, until })
 */
(function () {
  'use strict';

  if (window.TMARateLimit) return;

  var FIRST_MS = 60 * 1000;
  var MAX_MS = 10 * 60 * 1000;

  var until = 0;
  var strikes = 0;

  function retryAfterMs(res) {
    var header = res && res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    if (!header) return 0;
    var seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return seconds * 1000;
    var at = Date.parse(header);

    return isNaN(at) ? 0 : Math.max(0, at - Date.now());
  }

  /* A 429 arrived: stand back, longer when it keeps happening. */
  function note(res) {
    var now = Date.now();
    strikes = now < until ? strikes + 1 : 1;
    var wait = Math.max(retryAfterMs(res), Math.min(MAX_MS, FIRST_MS * Math.pow(2, strikes - 1)));
    until = Math.max(until, now + wait);
    try {
      document.dispatchEvent(new CustomEvent('tma:rate-limited', { detail: { until: until } }));
    } catch (e) { /* an old engine */ }
  }

  function coolingDown() {
    return Date.now() < until;
  }

  window.TMARateLimit = {
    note: note,
    coolingDown: coolingDown,
    until: function () { return until; },
  };

  /* Every answer passes here first, so no caller has to remember to ask. */
  if (typeof window.fetch === 'function') {
    var original = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return original(input, init).then(function (res) {
        if (res && res.status === 429) note(res);
        return res;
      });
    };
  }
})();
