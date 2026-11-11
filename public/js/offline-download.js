/*
 * TMA. The apps' copy for offline, downloaded once, kept up to date.
 *
 * What WhatsApp and Gmail do: once connected, everything is on the phone,
 * not only what was opened. The first-run download (portal-replica.js)
 * already keeps every application, client and file record, and
 * offline-fetch.js keeps every answer any screen has been given. This
 * fetches the rest ahead of time, and keeps all of it fresh:
 *
 *   - Settings: every page (an administrator's too; a page the account may
 *     not open is skipped), as Settings asks for them.
 *   - Messages: the whole conversation list, and the newest page of every
 *     conversation (`messages:warm`, `messages:thread:<id>`).
 *   - Email: the newest MAIL_TARGET conversations with their bodies, and
 *     the folder pages they are listed on (kept by email-api.js).
 *   - Everything any screen has read before (the `http:` answers): fetched
 *     again, so the Feed, the Calendar, Signatures, Reporting and every tab
 *     a person has opened is current, not just present.
 *   - Files: the newest documents' bytes, newest first, up to FILE_BUDGET,
 *     each app keeping them in its own file store (desktop/file-cache.js;
 *     FileStore.swift on the iPhone, through TMADesktop.keepFiles; Android's
 *     WebView store). A file is fetched again only when it changes.
 *
 * Downloaded once: the first copy on a device is the dashboard's first
 * section ("Downloading for offline…" with its parts, then "Ready offline"),
 * above the greeting, and carries on where it stopped if the app is closed
 * part way. After that it is kept current in the background without a word
 * on screen, fetching only what changed: a conversation with a new message,
 * new mail, a document with a new version, the oldest kept answers. Runs a
 * little after the app opens, when the connection comes back, every half
 * hour, and when the iPhone wakes the app in the background (BackgroundSync
 * .swift); one run at a time. The apps only: a browser keeps no client data
 * on its disk.
 *
 * Global: window.TMAOfflineDownload ({ run, paint, state })
 */
(function () {
  'use strict';

  if (window.TMAOfflineDownload) return;

  // Well after the app opens: the screens a person is looking at come first.
  var START_AFTER_MS = 45000;
  /*
   * One request at a time, most of a second apart. A twelfth of a second
   * apart, through every conversation, was enough for the firm's edge to
   * answer 429 to the whole connection, and then nothing worked: not the
   * screens, not a send. A first copy now takes minutes instead of seconds,
   * in the background, which is what a background copy is for.
   */
  var GAP_MS = 750;
  // The iPhone downloads files natively: a handful at a time, then a breather.
  var FILE_BATCH = 20;
  var FILE_BATCH_PAUSE_MS = 30000;
  var EVERY_MS = 30 * 60 * 1000;
  var THREAD_KEEP = 100;
  var THREAD_FRESH_MS = 10 * 60 * 1000;
  var MAIL_TARGET = 500;
  // Kept answers refreshed per run: the oldest first, none younger than this.
  var REFRESH_LIMIT = 100;
  var REFRESH_AFTER_MS = 2 * 60 * 60 * 1000;
  // The device's file store holds 2.5 GB; the download fills most of it and
  // leaves the rest for what a person opens.
  var FILE_BUDGET = 2.2 * 1024 * 1024 * 1024;
  var FILE_MAX = 100 * 1024 * 1024;
  var SETTINGS = [
    '/me/profile', '/security-settings/data',
    '/admin/branding', '/admin/client-hub', '/admin/connectors', '/admin/notification-history',
    '/admin/permissions', '/admin/reports', '/admin/security-policies', '/admin/storage-usage',
    '/admin/background-ops',
  ];
  var DONE_KEY = 'offline:complete';
  var FILES_KEY = 'offline:files';

  var running = null; // the run in progress, as a promise
  // What the dashboard shows. `parts` in the order they run.
  var state = { phase: 'idle', parts: [], finishedAt: null };
  // Shown only while this device makes its first copy. After that the copy
  // is kept current in the background, without a word on screen.
  var visible = false;

  function store() {
    var s = window.TMAStore;
    return s && s.persistent ? s : null;
  }

  function online() {
    if (navigator.onLine === false) return false;
    var queue = window.TMAQueue;
    return !(queue && queue.online && !queue.online());
  }

  /* The edge said "too many requests": stop, and try again another run. */
  function cooling() {
    var limit = window.TMARateLimit;
    return !!(limit && limit.coolingDown && limit.coolingDown());
  }

  /* ── the dashboard's first section ─────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function size(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB';
  }

  function partLine(part) {
    if (part.bytes) return part.label + ' ' + size(part.doneBytes || 0) + ' of ' + size(part.bytes);
    if (!part.total) return part.label;
    return part.label + ' ' + Math.min(part.done, part.total) + ' of ' + part.total;
  }

  function percent() {
    var done = 0;
    state.parts.forEach(function (part) {
      if (part.finished) done += 1;
      else if (part.bytes) done += Math.min(1, (part.doneBytes || 0) / part.bytes);
      else if (part.total) done += Math.min(1, part.done / part.total);
    });
    // Five parts in all; the bar is the share of them done.
    return Math.round((done / 5) * 100);
  }

  function paint() {
    var mount = document.querySelector('[data-offline-status-mount]');
    if (!mount) return;
    if (state.phase === 'idle' || !visible) {
      mount.innerHTML = '';
      return;
    }
    var done = state.phase === 'done';
    var current = state.parts.filter(function (p) { return !p.finished; })[0];
    var finished = state.parts.filter(function (p) { return p.finished; }).map(function (p) { return p.label; });
    var detail = done
      ? 'Messages, email, applications, settings and files open with no connection.'
      : (current ? partLine(current) : 'Getting ready…');
    mount.innerHTML =
      '<section class="tma-offline-status' + (done ? ' tma-offline-status--done' : '') + '" role="status" aria-live="polite">' +
      '<img class="tma-offline-status__icon" src="/images/icons/phosphor/' + (done ? 'CheckCircle' : 'CloudArrowDown') + '.svg" alt="">' +
      '<div class="tma-offline-status__body">' +
      '<div class="tma-offline-status__title">' + (done ? 'Ready offline' : 'Downloading for offline') + '</div>' +
      '<div class="tma-offline-status__detail">' + esc(detail) +
      (!done && finished.length ? '<span class="tma-offline-status__done"> · ' + esc(finished.join(', ')) + ' done</span>' : '') +
      '</div>' +
      (done ? '' : '<div class="tma-offline-status__track"><div class="tma-offline-status__fill" style="width:' + Math.max(3, percent()) + '%"></div></div>') +
      '</div>' +
      (done ? '<button type="button" class="tma-offline-status__close" data-offline-status-close aria-label="Dismiss">×</button>' : '') +
      '</section>';
    var close = mount.querySelector('[data-offline-status-close]');
    if (close) {
      close.addEventListener('click', function () {
        visible = false;
        paint();
      });
    }
  }

  function part(key, label) {
    var p = { key: key, label: label, done: 0, total: 0, finished: false };
    state.parts.push(p);
    paint();
    return p;
  }

  function tick(p, n) {
    p.done += n || 1;
    paint();
  }

  function finish(p) {
    p.finished = true;
    paint();
  }

  /* ── the work ──────────────────────────────────────────────────── */

  /* One after another, a breath apart: the screen in front comes first. */
  function each(items, fn, gapMs) {
    var i = 0;
    return new Promise(function (resolve) {
      var next = function () {
        if (i >= items.length || !online() || cooling()) {
          resolve();
          return;
        }
        var item = items[i++];
        Promise.resolve().then(function () { return fn(item); }).catch(function () { /* the next */ }).then(function () {
          setTimeout(next, Math.max(GAP_MS, gapMs || 0));
        });
      };
      next();
    });
  }

  function getJSON(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
  }

  function settings(kept) {
    var p = part('settings', 'Settings');
    p.total = SETTINGS.length;
    return each(SETTINGS, function (url) {
      return getJSON(url).then(function (res) {
        // Only the firm's own answer; never a copy of a copy.
        if (!res.ok || res.headers.get('x-tma-kept') === '1' || res.headers.get('x-tma-offline') === '1') return null;
        return res.text().then(function (body) {
          kept.put('settings:get:' + url, { status: res.status, body: body });
        });
      }).then(function () { tick(p); });
    }).then(function () { finish(p); });
  }

  function messages(kept) {
    var api = window.TMAMessagingAPI;
    if (!api || !api.conversations || !api.messages) return Promise.resolve();
    var p = part('messages', 'Messages');

    return api.conversations().then(function (data) {
      var rows = (data && data.conversations) || [];
      kept.put('messages:warm', {
        threads: rows.slice(0, 300),
        me: data.me || null,
        settings: data.settings || {},
        tabCounts: data.tabCounts || {},
      });
      p.total = rows.length;
      paint();

      return each(rows, function (row) {
        var key = 'messages:thread:' + row.id;
        return kept.get(key).then(function (held) {
          // Nothing new in it since it was kept: left as it is.
          if (held && row.timestamp && held.timestamp === row.timestamp) return null;
          if (held && held.keptAt && Date.now() - held.keptAt < THREAD_FRESH_MS) return null;

          return api.messages(row.id).then(function (page) {
            var list = (page && page.messages) || [];
            if (!list.length) return null;
            return kept.put(key, {
              messages: list.slice(-THREAD_KEEP),
              hasMore: !!(page && page.hasMore) || list.length > THREAD_KEEP,
              keptAt: Date.now(),
              timestamp: row.timestamp || null,
            });
          });
        }).then(function () { tick(p); });
      });
    }).catch(function () { /* the next run */ }).then(function () { finish(p); });
  }

  function mailPerPage() {
    try {
      var saved = parseInt(localStorage.getItem('tma.mail.perPage.v1'), 10);
      if ([25, 50, 100, 200].indexOf(saved) !== -1) return saved;
    } catch (e) { /* the default */ }
    return 50;
  }

  function mail(kept) {
    var api = window.TMAEmailAPI;
    if (!api || !api.listMessages || !api.getThread) return Promise.resolve();
    var p = part('email', 'Email');
    var perPage = mailPerPage();
    var rows = [];

    // The pages, asked exactly as the Email screen asks, so they are the
    // ones it finds; then each conversation, bodies included.
    var page = function (n) {
      return api.listMessages({ folder: 'inbox', page: n, perPage: perPage }).then(function (data) {
        var got = (data && data.messages) || [];
        rows = rows.concat(got);
        var last = data && (data.lastPage || data.last_page);
        var more = got.length >= perPage && rows.length < MAIL_TARGET && (!last || n < last);
        return more ? page(n + 1) : null;
      });
    };

    return page(1).then(function () {
      var wanted = rows.slice(0, MAIL_TARGET);
      p.total = wanted.length;
      paint();
      return each(wanted, function (row) {
        if (!row || row.id == null) {
          tick(p);
          return null;
        }
        return kept.get('mail:thread:' + row.id).then(function (held) {
          return held ? null : api.getThread(row.id);
        }).then(function () { tick(p); });
      }, 120);
    }).catch(function () { /* no mailbox, or it needs reconnecting */ }).then(function () { finish(p); });
  }

  /* Everything any screen has read before, fetched again (offline-fetch.js keeps the answers). */
  function refresh(kept) {
    if (!kept.list) return Promise.resolve();
    var p = part('everything', 'Everything you have opened');

    return kept.list('http:').then(function (held) {
      var now = Date.now();
      var paths = Object.keys(held || {}).filter(function (k) {
        var at = held[k] && held[k].at;
        return !at || now - at > REFRESH_AFTER_MS;
      }).sort(function (a, b) {
        return ((held[a] && held[a].at) || 0) - ((held[b] && held[b].at) || 0);
      }).map(function (k) {
        return k.slice(k.indexOf('http:') + 5);
      }).filter(Boolean).slice(0, REFRESH_LIMIT);
      p.total = paths.length;
      paint();
      return each(paths, function (path) {
        return getJSON(path).then(function () { tick(p); }, function () { tick(p); });
      }, 60);
    }).catch(function () {}).then(function () { finish(p); });
  }

  /* The newest documents, within the budget, each fetched again only when it changes. */
  function files(kept) {
    if (!kept.list) return Promise.resolve();
    var host = window.TMADesktop || {};
    var p = part('files', 'Files');
    var had = {};

    return Promise.all([kept.list('files:item:'), kept.get(FILES_KEY)]).then(function (got) {
      var held = got[0] || {};
      had = got[1] || {};
      var records = Object.keys(held).map(function (k) { return held[k]; }).filter(function (r) {
        return r && r.id && !r.deleted && r.previewable !== false && (r.size || 0) > 0 && r.size <= FILE_MAX;
      }).sort(function (a, b) {
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });

      var chosen = [];
      var bytes = 0;
      records.forEach(function (r) {
        if (bytes + r.size > FILE_BUDGET) return;
        bytes += r.size;
        chosen.push(r);
      });
      var stale = chosen.filter(function (r) { return had[r.id] !== (r.updatedAt || ''); });
      p.bytes = bytes;
      p.doneBytes = bytes - stale.reduce(function (n, r) { return n + r.size; }, 0);
      paint();
      if (!stale.length) return null;

      var path = function (r) { return '/portal/files/files/' + r.id + '/preview'; };
      var mark = function (r) {
        had[r.id] = r.updatedAt || '';
        p.doneBytes += r.size;
        paint();
      };

      // The iPhone keeps them natively, downloading in its own session: in
      // small batches with a pause between, stopping if the edge pushes back.
      if (typeof host.keepFiles === 'function') {
        var batches = [];
        for (var b = 0; b < stale.length; b += FILE_BATCH) batches.push(stale.slice(b, b + FILE_BATCH));

        return batches.reduce(function (chain, batch, n) {
          return chain.then(function () {
            if (!online() || cooling()) return null;
            return new Promise(function (resolve) {
              host.keepFiles(batch.map(function (r) {
                return { path: path(r), version: r.updatedAt || '', size: r.size };
              }), function (index, ok) {
                if (ok && batch[index]) mark(batch[index]);
              }, resolve);
            }).then(function () {
              if (n === batches.length - 1) return null;
              return new Promise(function (resolve) { setTimeout(resolve, FILE_BATCH_PAUSE_MS); });
            });
          });
        }, Promise.resolve());
      }

      // The desktop and Android keep what passes through them: read it whole.
      return each(stale, function (r) {
        return fetch(path(r), { credentials: 'same-origin' }).then(function (res) {
          if (!res.ok || res.headers.get('x-tma-offline') === '1') return null;
          return res.arrayBuffer().then(function () { mark(r); });
        });
      }, 150);
    }).catch(function () {}).then(function () {
      kept.put(FILES_KEY, had);
      finish(p);
    });
  }

  function run() {
    var kept = store();
    if (running) return running;
    if (!kept || !online() || cooling()) return Promise.resolve();
    state = { phase: 'running', parts: [], finishedAt: null };
    var before = null;

    running = kept.get(DONE_KEY).then(function (last) {
      before = last || null;
      // The first copy on this device is the one worth saying; the rest is upkeep.
      if (!before) visible = true;
      paint();
      return settings(kept);
    })
      .then(function () { return messages(kept); })
      .then(function () { return mail(kept); })
      .then(function () { return refresh(kept); })
      .then(function () { return files(kept); })
      .then(function () {
        if (!online()) {
          // Cut short by the connection: nothing to pin on screen. Not marked
          // done, so the next run with a connection carries on.
          state.phase = 'idle';
          return;
        }
        kept.put(DONE_KEY, { at: Date.now() });
        state.phase = 'done';
        state.finishedAt = Date.now();
      })
      .catch(function () { state.phase = 'idle'; })
      .then(function () {
        running = null;
        paint();
      });

    return running;
  }

  if (!(window.TMADesktop && window.TMADesktop.isDesktop)) {
    window.TMAOfflineDownload = { run: function () { return Promise.resolve(); }, paint: function () {}, state: function () { return state; } };
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

  window.TMAOfflineDownload = { run: run, paint: paint, state: function () { return state; } };
})();
