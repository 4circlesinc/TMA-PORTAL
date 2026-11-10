/*
 * TMA. The apps' copy for offline, downloaded behind the screen.
 *
 * What WhatsApp and Gmail do: once connected, everything a person reads is
 * on the phone, not only what they happened to open. The first-run download
 * (portal-replica.js) already keeps every application, client and file
 * record. This keeps the rest a person reads every day:
 *
 *   - Messages: the conversation list, and the newest page of each recent
 *     conversation (`messages:warm`, `messages:thread:<id>`, the same keys
 *     messages.js reads and writes).
 *   - Email: the inbox's first pages and the newest conversations, bodies
 *     included, through TMAEmailAPI's kept reads (email-api.js).
 *   - Your profile and security settings, as Settings asks for them
 *     (`settings:get:<url>`, portal-admin.js).
 *
 * Bounded so a phone is not filled: the newest page (100 messages) of the 50
 * most recent conversations, the newest 40 email conversations, a folder's
 * first pages. Files are not downloaded here: a document is kept when it is
 * opened (and on the desktop by its own cache), which is what the firm asked.
 *
 * Shown as a card beside the email sync ("Downloading for offline…", then
 * "Ready offline") the first time a device makes its copy, and after a long
 * time away; every later run is silent. Runs a little after the app opens,
 * when the connection comes back, and every half hour while it is open.
 * The apps only: a browser keeps no client data on its disk.
 *
 * Global: window.TMAOfflineDownload ({ run })
 */
(function () {
  'use strict';

  if (window.TMAOfflineDownload) return;

  var START_AFTER_MS = 6000;
  var EVERY_MS = 30 * 60 * 1000;
  var SHOW_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
  var THREADS = 50;
  var THREAD_KEEP = 100;
  var THREAD_FRESH_MS = 10 * 60 * 1000;
  var MAIL_THREADS = 40;
  var SETTINGS = ['/me/profile', '/security-settings/data'];
  var DONE_KEY = 'offline:complete';

  var running = false;
  var shown = false;
  var progress = { synced: 0, total: 0, what: '' };

  function store() {
    var s = window.TMAStore;
    return s && s.persistent ? s : null;
  }

  function online() {
    if (navigator.onLine === false) return false;
    var queue = window.TMAQueue;
    return !(queue && queue.online && !queue.online());
  }

  function report(state) {
    if (!shown || !window.TMASyncToasts || !window.TMASyncToasts.update) return;
    // Cut short by the connection going: not a problem to pin on screen.
    // It is not marked done, so the next run with a connection says so again.
    if (state === 'error') {
      if (window.TMASyncToasts.dismiss) window.TMASyncToasts.dismiss('offline', { again: true });
      return;
    }
    window.TMASyncToasts.update('offline', {
      state: state, synced: progress.synced, total: progress.total, what: progress.what,
    });
  }

  function step(what, total) {
    progress.what = what;
    progress.total += total;
    report('syncing');
  }

  function done(n) {
    progress.synced += n || 1;
    report('syncing');
  }

  function text(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      if (res.headers.get('x-tma-offline') === '1') throw new TypeError('offline');
      return res.ok ? res.text().then(function (body) { return { status: res.status, body: body }; }) : null;
    });
  }

  /* One after another, a breath apart: the screen in front comes first. */
  function each(items, fn) {
    var i = 0;
    return new Promise(function (resolve) {
      var next = function () {
        if (i >= items.length || !online()) {
          resolve();
          return;
        }
        var item = items[i++];
        Promise.resolve().then(function () { return fn(item); }).catch(function () { /* next */ }).then(function () {
          setTimeout(next, 120);
        });
      };
      next();
    });
  }

  function settings(kept) {
    step('Your profile', SETTINGS.length);
    return each(SETTINGS, function (url) {
      return text(url).then(function (answer) {
        if (answer) kept.put('settings:get:' + url, answer);
        done();
      });
    });
  }

  function messages(kept) {
    var api = window.TMAMessagingAPI;
    if (!api || !api.conversations || !api.messages) return Promise.resolve();

    return api.conversations().then(function (data) {
      var rows = (data && data.conversations) || [];
      kept.put('messages:warm', {
        threads: rows.slice(0, 300),
        me: data.me || null,
        settings: data.settings || {},
        tabCounts: data.tabCounts || {},
      });
      var recent = rows.slice(0, THREADS);
      step('Messages', recent.length);

      return each(recent, function (row) {
        var key = 'messages:thread:' + row.id;
        return kept.get(key).then(function (held) {
          if (held && held.keptAt && Date.now() - held.keptAt < THREAD_FRESH_MS) return null;

          return api.messages(row.id).then(function (page) {
            var list = (page && page.messages) || [];
            if (!list.length) return null;
            return kept.put(key, {
              messages: list.slice(-THREAD_KEEP),
              hasMore: !!(page && page.hasMore) || list.length > THREAD_KEEP,
              keptAt: Date.now(),
            });
          });
        }).then(function () { done(); });
      });
    }).catch(function () { /* the next run */ });
  }

  function mail(kept) {
    var api = window.TMAEmailAPI;
    if (!api || !api.listMessages || !api.getThread) return Promise.resolve();

    // Kept by the reads themselves (email-api.js): the first pages, then the
    // newest conversations a person has not opened here yet.
    // Asked exactly as the Email screen asks (its page size included), so
    // the kept pages are the ones it finds.
    var perPage = 50;
    try {
      var saved = parseInt(localStorage.getItem('tma.mail.perPage.v1'), 10);
      if ([25, 50, 100, 200].indexOf(saved) !== -1) perPage = saved;
    } catch (e) { /* the default */ }
    return api.listMessages({ folder: 'inbox', page: 1, perPage: perPage }).then(function (data) {
      var rows = (data && data.messages) || [];
      return api.listMessages({ folder: 'inbox', page: 2, perPage: perPage }).catch(function () { return null; }).then(function () {
        return rows.slice(0, MAIL_THREADS);
      });
    }).then(function (rows) {
      step('Email', rows.length);
      return each(rows, function (row) {
        if (!row || row.id == null) return done();
        return kept.get('mail:thread:' + row.id).then(function (held) {
          if (held) return null;
          return api.getThread(row.id);
        }).then(function () { done(); });
      });
    }).catch(function () { /* no mailbox connected, or it needs reconnecting */ });
  }

  function run() {
    var kept = store();
    if (running || !kept || !online()) return Promise.resolve();
    running = true;
    progress = { synced: 0, total: 0, what: '' };

    return kept.get(DONE_KEY).then(function (last) {
      // A card the first time this device makes its copy, and after a long
      // time away; otherwise this is quiet upkeep.
      shown = !last || !last.at || Date.now() - last.at > SHOW_AGAIN_AFTER_MS;
      report('syncing');

      return settings(kept)
        .then(function () { return messages(kept); })
        .then(function () { return mail(kept); });
    }).then(function () {
      if (!online()) {
        report('error');
        return;
      }
      progress.what = '';
      kept.put(DONE_KEY, { at: Date.now() });
      report('done');
    }).catch(function () {
      report('error');
    }).then(function () {
      running = false;
      shown = false;
    });
  }

  if (!(window.TMADesktop && window.TMADesktop.isDesktop)) {
    window.TMAOfflineDownload = { run: function () { return Promise.resolve(); } };
    return;
  }

  var start = function () {
    // Signed-in pages only: the shell, never the sign-in screens.
    if (/^\/(auth|r|design)\//.test(location.pathname)) return;
    setTimeout(run, START_AFTER_MS);
    setInterval(run, EVERY_MS);
    window.addEventListener('online', function () { setTimeout(run, 2000); });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

  window.TMAOfflineDownload = { run: run };
})();
