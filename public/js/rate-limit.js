/*
 * TMA. "Too many requests": the page stops asking until the edge lets it.
 *
 * Laravel Cloud's edge (its Cloudflare firewall, "basic rate limiting")
 * blocks an IP that sends more than 100 requests a minute, for five
 * minutes, on every path: icons, avatars, messages, a send. The office
 * shares one IP, so one person's page load counts against everyone. While
 * blocked, every screen said "Request failed" and kept asking, and each
 * reload asked for everything again, which kept the block going.
 *
 * This is the one place that hears a 429, and it is the first script on
 * the page so every request passes it. A 429 from the edge sets a
 * cool-down (the edge's Retry-After, else a minute, longer each time it
 * happens again inside one, up to ten). While it lasts:
 *
 *   - a read (GET) is answered here, without asking, with a 429 that
 *     carries a readable message, so screens say "Too many requests"
 *     instead of "Request failed";
 *   - one read at a time is let through as a probe (after 15 s, then 30,
 *     then every minute); the first one answered normally ends the
 *     cool-down, so the page is back as soon as the edge is;
 *   - what a person does (a send, a save) still goes, and an answered
 *     write ends the cool-down too;
 *   - the background work asks coolingDown() before each request
 *     (offline-download, the replica walkers, offline-fetch's copies).
 *
 * The cool-down is kept in localStorage, so a reload and the other tabs
 * know it too: the edge blocks the IP, not the tab.
 *
 * A 429 from the portal itself (Laravel's throttle on one route: uploads,
 * signing, sign-in) is not the edge refusing everything. It carries
 * X-RateLimit-Limit and is passed through untouched.
 *
 * Global: window.TMARateLimit ({ note, coolingDown, until, clear })
 */
(function () {
  'use strict';

  if (window.TMARateLimit) return;

  var FIRST_MS = 60 * 1000;
  var MAX_MS = 10 * 60 * 1000;
  var PROBE_FIRST_MS = 15 * 1000;
  var PROBE_MAX_MS = 60 * 1000;
  var KEY = 'tma.rateLimit';
  var MESSAGE = 'Too many requests from this network. Trying again shortly.';

  var until = 0;
  var strikes = 0;
  var probeAt = 0;
  var probeGap = PROBE_FIRST_MS;
  var probing = null; // the probe in flight: resolves true when the edge let it through
  var told = false;

  function save() {
    try {
      if (until) localStorage.setItem(KEY, JSON.stringify({ until: until, strikes: strikes }));
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: this tab only */ }
  }

  /* A cool-down another tab (or this page before a reload) started. */
  function load() {
    try {
      var kept = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (kept && kept.until > Date.now()) {
        // A reload or a new tab asks at once (the block may have lifted
        // while it was away); a tab already cooling keeps its own pace.
        if (!until) probeAt = 0;
        until = kept.until;
        strikes = kept.strikes || 1;
      } else if (!kept && until) {
        // Another tab was answered normally.
        until = 0;
        strikes = 0;
        probeAt = 0;
        probeGap = PROBE_FIRST_MS;
        told = false;
      }
    } catch (e) { /* nothing kept */ }
  }

  function retryAfterMs(res) {
    var header = res && res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    if (!header) return 0;
    var seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return seconds * 1000;
    var at = Date.parse(header);

    return isNaN(at) ? 0 : Math.max(0, at - Date.now());
  }

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (e) { /* an old engine */ }
  }

  /* Once per cool-down per page: say why, instead of "Request failed". */
  function tell() {
    if (told) return;
    var toast = window.TMAToast;
    if (!toast || typeof toast.showFloatingToast !== 'function') {
      // Before the toasts have loaded (a held read at boot): say it once they have.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tell, { once: true });
      return;
    }
    told = true;
    try {
      toast.showFloatingToast(MESSAGE, { state: 'failure', durationMs: 8000 });
    } catch (e) { /* no toast host */ }
  }

  /* A 429 arrived: stand back, longer when it keeps happening. */
  function note(res) {
    var now = Date.now();
    var fresh = now >= until;
    strikes = fresh ? 1 : strikes + 1;
    var asked = retryAfterMs(res);
    var wait = Math.max(asked, Math.min(MAX_MS, FIRST_MS * Math.pow(2, strikes - 1)));
    until = Math.max(until, now + wait);
    probeGap = fresh ? PROBE_FIRST_MS : Math.min(PROBE_MAX_MS, probeGap * 2);
    probeAt = now + Math.max(Math.min(asked, MAX_MS), probeGap);
    save();
    emit('tma:rate-limited', { until: until, first: fresh });
    tell();
  }

  /* The edge answered normally: the cool-down is over. */
  function clear() {
    var was = Date.now() < until;
    until = 0;
    strikes = 0;
    probeAt = 0;
    probeGap = PROBE_FIRST_MS;
    told = false;
    save();
    if (was) emit('tma:rate-limit-cleared', {});
  }

  function coolingDown() {
    return Date.now() < until;
  }

  /* The edge refusing this IP, not one of the portal's own route limits. */
  function edgeRefusal(res) {
    return !!res && res.status === 429 && !(res.headers && res.headers.get('X-RateLimit-Limit'));
  }

  /* A 429 the screens can read: JSON with a message, like the portal's own. */
  function refusal(msLeft, held) {
    var headers = {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(1, Math.ceil(msLeft / 1000))),
    };
    if (held) headers['X-TMA-Held'] = '1';

    return new Response(JSON.stringify({ message: MESSAGE, rateLimited: true }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: headers,
    });
  }

  function describe(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    var same = false;
    try { same = new URL(url, location.href).origin === location.origin; } catch (e) { same = false; }
    method = String(method).toUpperCase();

    return { same: same, read: method === 'GET' || method === 'HEAD' };
  }

  load();
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) load();
  });

  window.TMARateLimit = {
    note: note,
    clear: clear,
    coolingDown: coolingDown,
    until: function () { return until; },
  };

  /* Every request passes here first, so no caller has to remember to ask. */
  if (typeof window.fetch === 'function') {
    var original = window.fetch.bind(window);

    var held = function () {
      tell();
      return refusal(until - Date.now(), true);
    };

    var guarded = function (input, init) {
      var ask;
      try { ask = describe(input, init); } catch (e) { ask = { same: false, read: false }; }
      if (!ask.same) return original(input, init);

      var settle = null;
      var now = Date.now();
      if (ask.read && now < until) {
        // A probe is out: wait for its answer rather than refuse a read
        // the edge may be about to let through.
        if (probing) {
          return probing.then(function (through) {
            return through ? guarded(input, init) : held();
          });
        }
        if (now < probeAt) return Promise.resolve(held());
        probing = new Promise(function (resolve) { settle = resolve; });
      }

      var done = function (through) {
        if (!settle) return;
        probing = null;
        settle(through);
      };

      return original(input, init).then(function (res) {
        if (edgeRefusal(res)) {
          note(res);
          done(false);
          return refusal(until - Date.now(), false);
        }
        // Any answer from past the edge (even the portal's own 429) means the
        // edge let it through. Only a probe or a write counts: a read can
        // come out of the browser's cache, and the desktop app answers for
        // itself when nothing does (x-tma-offline).
        var through = !!res && !(res.headers && res.headers.get('x-tma-offline') === '1');
        if ((settle || !ask.read) && through && coolingDown()) clear();
        done(through);
        return res;
      }, function (err) {
        done(false);
        throw err;
      });
    };

    window.fetch = guarded;
  }
})();
