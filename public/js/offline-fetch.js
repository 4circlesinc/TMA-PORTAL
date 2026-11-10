/*
 * TMA. Every answer the firm gave, kept for when it cannot give one.
 *
 * The apps only (TMADesktop.isDesktop): every screen reads the firm through
 * fetch, and every screen used to need its own code to keep what it read
 * and to show it with no connection (Messages, the mailbox, Settings, the
 * rail…), so whatever had none (the Feed's other tabs, Signatures,
 * Reporting, a Settings page nobody had wired) said "Could not load"
 * offline. This keeps them all, underneath: a same-origin GET that answers
 * with JSON is kept on the device (TMAStore, `http:<path?query>`, on disk,
 * scoped to the account, wiped at sign-out), and when that same GET gets no
 * answer at all, the kept answer is what the screen receives, marked
 * `x-tma-kept: 1`. A refusal (the firm answering 403, 404, 500) is never
 * replaced: only "nothing answered".
 *
 * Network first, always: a screen online sees the firm, never the copy.
 * Chained over auth-session.js's wrapper, which only watches for 401/403.
 *
 * Never kept: sign-in, two-factor secrets and recovery codes, tokens, and
 * anything larger than ANSWER_LIMIT. Files are not kept here: their bytes
 * are kept by each app's own file store (desktop/file-cache.js; the iPhone's
 * FileStore.swift, asked through TMADesktop.readKeptFile when nothing
 * answers; Android's).
 *
 * Global: window.TMAOfflineFetch ({ enabled, keyFor })
 */
(function () {
  'use strict';

  if (window.TMAOfflineFetch) return;

  var host = window.TMADesktop;
  if (!(host && host.isDesktop) || typeof window.fetch !== 'function') {
    window.TMAOfflineFetch = { enabled: false };
    return;
  }

  var ANSWER_LIMIT = 4 * 1024 * 1024;
  // What a screen reads. The shell, sign-in and the like are not data.
  var READS = /^\/(portal|me|admin|security-settings|settings|notifications|people|users)(\/|$)/;
  // /me itself: who this is has its own remembered copy (current-user.js), and
  // the write queue asks it to learn whether the firm is there at all.
  var NEVER = /^\/(auth|r|design|desktop|broadcasting|sanctum)(\/|$)|^\/me$|two-factor|recovery-codes|secret-key|qr-code|\/tokens?(\/|$)|\/sync-status$|\/up$/;
  var FILES = /^\/portal\/files\/files\/[a-f0-9-]{36}\/(preview|thumb)$/;

  var original = window.fetch.bind(window);
  var lastKept = Object.create(null); // key -> length of the body last kept
  var keptServedAt = 0;

  function store() {
    var s = window.TMAStore;
    return s && s.persistent ? s : null;
  }

  function describe(input, init) {
    var request = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
    var method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
    if (method !== 'GET') return null;
    // Asking the network on purpose (a probe: is the firm there?): only it answers.
    if ((init && init.cache === 'no-store') || (request && request.cache === 'no-store')) return null;
    var url = new URL(request ? request.url : String(input), location.href);
    if (url.origin !== location.origin) return null;
    var path = url.pathname;
    if (NEVER.test(path)) return null;
    var file = FILES.test(path);
    if (!file && !READS.test(path)) return null;

    return { path: path, key: 'http:' + path + url.search, file: file };
  }

  function keptResponse(entry) {
    keptServedAt = Date.now();
    return new Response(entry.body, {
      status: entry.status || 200,
      headers: { 'Content-Type': entry.type || 'application/json', 'x-tma-kept': '1' },
    });
  }

  function keep(read, res) {
    var s = store();
    var type = res.headers.get('content-type') || '';
    if (!s || res.status !== 200 || type.indexOf('application/json') === -1) return;
    var length = Number(res.headers.get('content-length') || 0);
    if (length > ANSWER_LIMIT) return;
    res.clone().text().then(function (body) {
      if (body.length > ANSWER_LIMIT || lastKept[read.key] === body.length) return;
      lastKept[read.key] = body.length;
      s.put(read.key, { status: 200, type: type, body: body });
    }).catch(function () { /* kept next time */ });
  }

  /* Nothing answered: the kept answer, a kept file, or the failure as it was. */
  function fallback(read, res, err) {
    var fail = function () {
      if (res) return res;
      throw err;
    };
    if (read.file) {
      if (typeof host.readKeptFile !== 'function') return fail();
      return host.readKeptFile(read.path).then(function (blob) {
        if (!blob) return fail();
        keptServedAt = Date.now();
        return new Response(blob, {
          status: 200,
          headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-tma-kept': '1' },
        });
      }, fail);
    }
    var s = store();
    if (!s) return fail();

    return s.get(read.key).then(function (entry) {
      return entry && typeof entry.body === 'string' ? keptResponse(entry) : fail();
    }, fail);
  }

  window.fetch = function (input, init) {
    var read = null;
    try { read = describe(input, init); } catch (e) { read = null; }
    var request = original(input, init);
    if (!read) return request;

    return request.then(function (res) {
      // The desktop app's own "nothing answered" (x-tma-offline) is not the firm.
      if (res.headers.get('x-tma-offline') === '1') return fallback(read, res, null);
      if (!read.file) keep(read, res);
      return res;
    }, function (err) {
      // A request the page called off is not "offline".
      if (err && err.name === 'AbortError') throw err;
      return fallback(read, null, err);
    });
  };

  window.TMAOfflineFetch = {
    enabled: true,
    keyFor: function (path) { return 'http:' + path; },
    /* A screen was just given a kept answer: its "success" is not the firm
       answering, and the write queue must not read it as the link being back. */
    keptRecently: function (ms) { return Date.now() - keptServedAt < (ms || 3000); },
  };
})();
