/*
 * TMA - Notifications & Activity data layer.
 *
 * One in-memory store per stream (notifications, activity) shared by every
 * surface that shows them: the right sidebar, the header popups, and the
 * Overview activity log. Surfaces subscribe and re-render; they never fetch on
 * their own, so counts stay consistent and a single event updates every view
 * at once (§11, §24, §25).
 *
 * Globals: window.TMANotifyAPI, window.TMANotifications, window.TMAActivities
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function socketId() {
    var rt = window.TMAMessagingRealtime;
    return (rt && rt.socketId) || '';
  }

  /* Thin fetch wrapper, same contract as email-api / messaging-api. */
  function api(url, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (opts.method && opts.method !== 'GET') {
      headers['X-XSRF-TOKEN'] = csrf();
      var s = socketId();
      if (s) headers['X-Socket-ID'] = s;
    }
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(url, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign(headers, opts.headers || {}),
      body: opts.body,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || 'Request failed');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '' || v === false) return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  window.TMANotifyAPI = { api: api, qs: qs, root: ROOT };

  /* ── A tiny pub/sub base every store shares. ──────────────────────── */
  function createEmitter() {
    var subs = [];
    return {
      subscribe: function (cb) {
        if (typeof cb !== 'function') return function () {};
        subs.push(cb);
        return function () {
          var i = subs.indexOf(cb);
          if (i !== -1) subs.splice(i, 1);
        };
      },
      emit: function (payload) {
        subs.slice().forEach(function (cb) {
          try { cb(payload); } catch (e) { /* a bad subscriber must not break the rest */ }
        });
      },
    };
  }

  /* ── Notifications store ──────────────────────────────────────────── */
  var NOTIF_BASE = ROOT + '/portal/notifications';

  var notifications = (function () {
    var emitter = createEmitter();
    var state = {
      items: [],
      unread: 0,
      actionRequired: 0,
      cursor: null,
      hasMore: false,
      loaded: false,
      loading: false,
      error: false,
      filters: { unread: false, actionRequired: false, module: null, type: null, level: null, search: '' },
    };
    var loadPromise = null;

    function changed() { emitter.emit(state); }

    function indexOf(uid) {
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].id === uid) return i;
      }
      return -1;
    }

    function load(opts) {
      opts = opts || {};
      if (opts.filters) state.filters = Object.assign({}, state.filters, opts.filters);
      state.loading = true;
      state.error = false;
      changed();
      var params = Object.assign({ limit: opts.limit || 20 }, state.filters);
      loadPromise = api(NOTIF_BASE + qs(params)).then(function (data) {
        state.items = data.items || [];
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.unread = data.unread || 0;
        state.loaded = true;
        state.loading = false;
        loadPromise = null;
        changed();
        return state;
      }).catch(function () {
        state.loading = false;
        state.error = true;
        loadPromise = null;
        changed();
        return state;
      });
      return loadPromise;
    }

    /* Load once; later callers just re-sync the count and render from state. */
    function ensureLoaded(opts) {
      if (state.loaded) { refreshCount(); return Promise.resolve(state); }
      if (state.loading && loadPromise) return loadPromise;
      return load(opts);
    }

    function loadMore() {
      if (!state.hasMore || state.loading) return Promise.resolve(state);
      state.loading = true;
      changed();
      var params = Object.assign({ limit: 20, cursor: state.cursor }, state.filters);
      return api(NOTIF_BASE + qs(params)).then(function (data) {
        state.items = state.items.concat(data.items || []);
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.unread = data.unread != null ? data.unread : state.unread;
        state.loading = false;
        changed();
        return state;
      }).catch(function () {
        state.loading = false;
        state.error = true;
        changed();
      });
    }

    function refreshCount() {
      return api(NOTIF_BASE + '/count').then(function (data) {
        state.unread = data.unread || 0;
        state.actionRequired = data.actionRequired || 0;
        changed();
        return state;
      }).catch(function () { return state; });
    }

    function applyItem(item, unread) {
      var i = indexOf(item.id);
      if (i !== -1) state.items[i] = item;
      if (typeof unread === 'number') state.unread = unread;
      changed();
    }

    function markRead(uid) {
      var i = indexOf(uid);
      if (i !== -1 && state.items[i].read) return Promise.resolve(state);
      // Optimistic: flip locally, reconcile with server.
      if (i !== -1 && !state.items[i].read) { state.items[i].read = true; state.unread = Math.max(0, state.unread - 1); changed(); }
      return api(NOTIF_BASE + '/' + uid + '/read', { method: 'POST' })
        .then(function (data) { applyItem(data.item, data.unread); return state; })
        .catch(function () { return refreshCount(); });
    }

    function markUnread(uid) {
      var i = indexOf(uid);
      if (i !== -1 && state.items[i].read) { state.items[i].read = false; state.unread += 1; changed(); }
      return api(NOTIF_BASE + '/' + uid + '/unread', { method: 'POST' })
        .then(function (data) { applyItem(data.item, data.unread); return state; })
        .catch(function () { return refreshCount(); });
    }

    function complete(uid) {
      return api(NOTIF_BASE + '/' + uid + '/complete', { method: 'POST' })
        .then(function (data) { applyItem(data.item, data.unread); return state; })
        .catch(function () { return state; });
    }

    function markAllRead(module) {
      state.items.forEach(function (it) { if (!module || it.module === module) it.read = true; });
      state.unread = module ? state.items.filter(function (it) { return !it.read; }).length : 0;
      changed();
      return api(NOTIF_BASE + '/read-all', { method: 'POST', json: { module: module || null } })
        .then(function (data) { state.unread = data.unread || 0; changed(); return state; })
        .catch(function () { return refreshCount(); });
    }

    /*
     * One action across a selection: 'read', 'unread' or 'delete'.
     *
     * Applied locally first so the list responds to the click, then reconciled
     * with the server's authoritative unread total, a bulk change touches too
     * many rows for a local count to be worth trusting.
     */
    function bulk(ids, action) {
      var wanted = {};
      (ids || []).forEach(function (id) { wanted[id] = true; });
      if (!Object.keys(wanted).length) return Promise.resolve(state);

      if (action === 'delete') {
        state.items = state.items.filter(function (it) { return !wanted[it.id]; });
      } else {
        state.items.forEach(function (it) {
          if (wanted[it.id]) it.read = action === 'read';
        });
      }
      state.unread = state.items.filter(function (it) { return !it.read; }).length;
      changed();

      return api(NOTIF_BASE + '/bulk', { method: 'POST', json: { ids: Object.keys(wanted), action: action } })
        .then(function (data) {
          if (data && typeof data.unread === 'number') { state.unread = data.unread; changed(); }
          return state;
        })
        .catch(function () { return refreshCount(); });
    }

    function remove(uid) {
      var i = indexOf(uid);
      if (i !== -1) { var wasUnread = !state.items[i].read; state.items.splice(i, 1); if (wasUnread) state.unread = Math.max(0, state.unread - 1); changed(); }
      return api(NOTIF_BASE + '/' + uid, { method: 'DELETE' })
        .then(function (data) { state.unread = data.unread != null ? data.unread : state.unread; changed(); return state; })
        .catch(function () { return refreshCount(); });
    }

    /* Realtime: a fresh notification arrived, add to the top without a refetch. */
    function prepend(item) {
      if (!item || !item.id || indexOf(item.id) !== -1) return;
      state.items.unshift(item);
      if (!item.read) state.unread += 1;
      changed();
    }

    /*
     * Realtime with an authoritative unread total (§24, §25). Appends the new
     * item smoothly and trusts the server's count rather than a local delta, so
     * a reconnecting socket that replays or drops the event stays correct.
     */
    function applyRealtime(item, unread) {
      var added = false;
      if (item && item.id && indexOf(item.id) === -1) {
        state.items.unshift(item);
        added = true;
      }
      if (typeof unread === 'number') state.unread = unread;
      else if (added && item && !item.read) state.unread += 1;
      changed();

      // A notification arriving while the user is here deserves to be seen,
      // not just counted, surface it as a toast (dedupe lives in toast.js).
      if (added && item && !item.read && window.TMAToast && window.TMAToast.showNotificationToast) {
        window.TMAToast.showNotificationToast(item);
      }

      /*
       * Desktop banner. Deliberately not gated on `added`: the server collapses
       * repeats in a conversation into one row and re-broadcasts it (see
       * Notifier::refresh), so the second and every later message of the day
       * arrives as a *known* id. Each call here is one real event, and
       * desktop.notify() has its own guard against a socket delivering the same
       * one twice.
       */
      if (item && !item.read) desktop.notify(item);

      // Let open views (email, etc.) react to a specific arrival, e.g. a
      // snooze reminder should put the woken message back into the list.
      if (added && item) {
        try {
          window.dispatchEvent(new CustomEvent('tma:notification-arrived', { detail: item }));
        } catch (e) { /* CustomEvent unavailable in ancient browsers, ignore. */ }
      }
    }

    return {
      state: state,
      subscribe: emitter.subscribe,
      load: load,
      ensureLoaded: ensureLoaded,
      loadMore: loadMore,
      refreshCount: refreshCount,
      markRead: markRead,
      markUnread: markUnread,
      markAllRead: markAllRead,
      complete: complete,
      remove: remove,
      bulk: bulk,
      prepend: prepend,
      applyRealtime: applyRealtime,
      getUnreadCount: function () { return state.unread; },
      getActionRequiredCount: function () { return state.actionRequired; },
      isLoaded: function () { return state.loaded; },
    };
  })();

  /* ── Activity store ───────────────────────────────────────────────── */
  var ACT_BASE = ROOT + '/portal/activity';

  var activities = (function () {
    var emitter = createEmitter();
    var state = {
      items: [],
      cursor: null,
      hasMore: false,
      loaded: false,
      loading: false,
      error: false,
      isAdmin: false,
      newCount: 0,
      failedCount: 0,
      filters: { module: null, type: null, action: null, status: null, actor: null, client: null, system: false, from: null, to: null, search: '' },
    };
    var loadPromise = null;

    function changed() { emitter.emit(state); }

    function load(opts) {
      opts = opts || {};
      if (opts.filters) state.filters = Object.assign({}, state.filters, opts.filters);
      state.loading = true;
      state.error = false;
      changed();
      var params = Object.assign({ limit: opts.limit || 25 }, state.filters);
      loadPromise = api(ACT_BASE + qs(params)).then(function (data) {
        state.items = data.items || [];
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.isAdmin = !!data.isAdmin;
        state.loaded = true;
        state.loading = false;
        loadPromise = null;
        changed();
        return state;
      }).catch(function () {
        state.loading = false;
        state.error = true;
        loadPromise = null;
        changed();
        return state;
      });
      return loadPromise;
    }

    function ensureLoaded(opts) {
      if (state.loaded) { refreshCount(); return Promise.resolve(state); }
      if (state.loading && loadPromise) return loadPromise;
      return load(opts);
    }

    function loadMore() {
      if (!state.hasMore || state.loading) return Promise.resolve(state);
      state.loading = true;
      changed();
      var params = Object.assign({ limit: 25, cursor: state.cursor }, state.filters);
      return api(ACT_BASE + qs(params)).then(function (data) {
        state.items = state.items.concat(data.items || []);
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.loading = false;
        changed();
        return state;
      }).catch(function () {
        state.loading = false;
        state.error = true;
        changed();
      });
    }

    function refreshCount() {
      return api(ACT_BASE + '/count').then(function (data) {
        state.newCount = data.new || 0;
        state.failedCount = data.failed || 0;
        changed();
        return state;
      }).catch(function () { return state; });
    }

    function markSeen() {
      state.newCount = 0;
      changed();
      return api(ACT_BASE + '/seen', { method: 'POST' })
        .then(function () { return state; })
        .catch(function () { return state; });
    }

    function loadFilters() {
      return api(ACT_BASE + '/filters').catch(function () { return { modules: [], types: [], statuses: [], actors: [] }; });
    }

    function prepend(item) {
      if (!item || !item.id) return;
      for (var i = 0; i < state.items.length; i++) { if (state.items[i].id === item.id) return; }
      state.items.unshift(item);
      state.newCount += 1;
      changed();
    }

    return {
      state: state,
      subscribe: emitter.subscribe,
      load: load,
      ensureLoaded: ensureLoaded,
      loadMore: loadMore,
      refreshCount: refreshCount,
      markSeen: markSeen,
      loadFilters: loadFilters,
      prepend: prepend,
      getNewCount: function () { return state.newCount; },
      getFailedCount: function () { return state.failedCount; },
      isLoaded: function () { return state.loaded; },
    };
  })();

  /* ── Desktop notifications ────────────────────────────────────────────
   *
   * OS-level banners for arriving notifications, raised here rather than in
   * messages.js because this store runs on every shell: the messaging page
   * mounts on two of them, and "you are notified only while you are already
   * looking at Messages" is not a notification.
   *
   * Every module banners, not just messages. Which notifications a user gets
   * at all is already decided server-side by their per-type preferences, so
   * filtering again here only ever meant email, calendar and file activity
   * reached the bell and then died there, silently, which is the worst way
   * for a notification to fail.
   * ------------------------------------------------------------------- */
  /* Per-module delivery channels from Settings → Notifications ("Notify me
     about"). Loaded once; until it arrives, or for a module the grid doesn't
     know, the answer is "on", because a fetch hiccup must never mute a
     banner the user asked for. Sound is additionally behind the global
     notification-sounds switch, as before. */
  var channelPrefs = null;
  api(NOTIF_BASE + '/preferences').then(function (d) {
    if (d && d.preferences) channelPrefs = d.preferences;
  }).catch(function () { /* fail open */ });

  function channelOn(module, channel) {
    if (!channelPrefs || !module || !(module in channelPrefs)) return true;
    return !!channelPrefs[module][channel];
  }

  var desktop = (function () {
    var prefs = { enabled: false, preview: true };
    var live = [];
    var recent = {};
    var RECENT_MS = 30000;

    function supported() {
      return typeof window.Notification === 'function';
    }

    function permission() {
      if (!supported()) return 'unsupported';
      return Notification.permission;
    }

    /*
     * The window being *hidden* is not the same as the user not looking: a tab
     * that is frontmost in a window sitting behind another application reports
     * itself perfectly visible. Focus is the honest test, and the reason
     * notifications used to seem broken, they only ever fired for a minimised
     * or background tab.
     */
    function backgrounded() {
      if (document.hidden) return true;
      return typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
    }

    /*
     * The user's "Notification sounds" switch, published by messages.js onto
     * window.TMAMessagingSettings, the same channel messaging-calls.js reads
     * the ringtone from. Unset means on: someone who has never opened the
     * setting should still hear their notifications.
     */
    function soundOn() {
      var settings = window.TMAMessagingSettings || {};
      return settings.notificationSounds !== false;
    }

    /*
     * True when a banner raised right now would make a noise. messages.js asks
     * before playing its own tone, so an arriving message is announced once:
     * by the banner when the app is in the background, by the page when it is
     * in front. Without the check, backgrounding the app would double it.
     */
    function willSound(module) {
      return prefs.enabled && permission() === 'granted' && backgrounded() && soundOn()
        && channelOn(module || 'messages', 'sound');
    }

    function seenRecently(key) {
      var now = Date.now();
      Object.keys(recent).forEach(function (k) {
        if (now - recent[k] > RECENT_MS) delete recent[k];
      });
      if (recent[key]) return true;
      recent[key] = now;
      return false;
    }

    /* Same navigation contract the sidebar uses: in-shell when the shell
     * offers it, a full load otherwise. */
    function open(url) {
      try { window.focus(); } catch (e) { /* ignore */ }
      if (!url) return;
      var root = document.querySelector('.tma-dash');
      if (root && root._portalNavigate) root._portalNavigate(url);
      else window.location.assign((window.__TMA_SITE_ROOT || '') + url);
    }

    function closeAll() {
      live.forEach(function (note) {
        try { note.close(); } catch (e) { /* ignore */ }
      });
      live = [];
    }

    /* What a banner says when the preview is switched off. */
    var QUIET_BODY = {
      messages: 'New message',
      email: 'New email',
      calendar: 'Calendar update',
      files: 'File activity',
      clients: 'Client update',
      signatures: 'Signature update',
    };

    function notify(item) {
      if (!prefs.enabled || !item) return;
      if (permission() !== 'granted') return;
      if (!backgrounded()) return;
      // The per-module Desktop column in Settings → Notifications.
      if (!channelOn(item.module, 'desktop')) return;
      if (seenRecently(item.id + '@' + (item.createdAt || ''))) return;

      try {
        var note = new Notification(item.title || 'New notification', {
          body: prefs.preview
            ? (item.message || '')
            : (QUIET_BODY[item.module] || 'New notification'),
          // Per conversation, so a run of messages replaces its own banner
          // instead of stacking one per message.
          tag: 'tma-' + (item.id || 'notification'),
          renotify: true,
          icon: item.image || null,
          /*
           * This used to be hard-coded silent, on the reasoning that messages.js
           * plays the tone. It only ever did so for *messages*, and only for a
           * conversation it had already loaded, so an email, a calendar change
           * or a file update raised a banner with no sound at all, and a message
           * in an unloaded thread did too.
           *
           * The banner is raised here, for every module, so the sound belongs
           * here as well. The OS plays it: page audio is unreliable in exactly
           * the case that matters, since a hidden window is where autoplay
           * policy and background throttling apply. messages.js stands down
           * while we are sounding, see playIncomingMessageSound's caller.
           */
          // The per-module Sound column, on top of the global sounds switch.
          silent: !soundOn() || !channelOn(item.module, 'sound'),
        });
        note.onclick = function () {
          note.close();
          open(item.actionUrl);
        };
        live.push(note);
      } catch (e) {
        // Some browsers only permit notifications from a service worker. There
        // is nothing to fall back to; the bell and the toast already showed it.
      }
    }

    /*
     * Asking is only allowed from a user gesture, so this is called from the
     * settings toggle rather than on load. Resolves with the resulting
     * permission either way.
     */
    function requestPermission() {
      if (!supported()) return Promise.resolve('unsupported');
      if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
      try {
        var asked = Notification.requestPermission();
        // Older Safari passes the result to a callback and returns undefined.
        return asked && asked.then ? asked : new Promise(function (resolve) {
          Notification.requestPermission(resolve);
        });
      } catch (e) {
        return Promise.resolve(Notification.permission);
      }
    }

    function applyPrefs(next) {
      if (!next || typeof next !== 'object') return;
      if (typeof next.enabled === 'boolean') prefs.enabled = next.enabled;
      if (typeof next.preview === 'boolean') prefs.preview = next.preview;
      try { localStorage.setItem('tma.desktopNotifications', JSON.stringify(prefs)); } catch (e) { /* ignore */ }
    }

    // Last-known prefs, so a notification arriving before /me resolves is not
    // silently dropped. /me then overwrites this with the truth.
    try {
      var cached = JSON.parse(localStorage.getItem('tma.desktopNotifications') || 'null');
      if (cached && typeof cached === 'object') {
        prefs.enabled = !!cached.enabled;
        prefs.preview = cached.preview !== false;
      }
    } catch (e) { /* ignore */ }

    // A banner for something the user has come back to is stale.
    window.addEventListener('focus', closeAll);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) closeAll();
    });

    return {
      notify: notify,
      applyPrefs: applyPrefs,
      getPrefs: function () { return { enabled: prefs.enabled, preview: prefs.preview }; },
      permission: permission,
      requestPermission: requestPermission,
      isSupported: supported,
      // Asked by messages.js before it plays its arrival tone.
      willSound: willSound,
    };
  })();

  window.TMANotifications = notifications;
  window.TMAActivities = activities;
  window.TMADesktopNotify = desktop;

  /*
   * Fallback freshness + wake catch-up. The badge normally updates over the
   * websocket, but after long idle the socket can look "connected" while
   * dead (zombie). Stand down the poll only when the transport is healthy
   * recently; on visibility/focus always reconcile and toast newcomers.
   */
  var COUNT_POLL_MS = 60000;
  var catchingUp = false;

  function socketLooksHealthy() {
    var rt = window.TMAMessagingRealtime;
    if (!rt) return false;
    if (typeof rt.isHealthy === 'function') return rt.isHealthy();
    return !!(rt.connected && rt.socketId);
  }

  function catchUpNotifications(opts) {
    opts = opts || {};
    if (catchingUp) return;
    catchingUp = true;

    var prevUnread = notifications.state.unread;
    var knownIds = {};
    notifications.state.items.forEach(function (it) { knownIds[it.id] = true; });
    var hadList = notifications.state.loaded && notifications.state.items.length > 0;

    notifications.refreshCount().then(function () {
      var rose = notifications.state.unread > prevUnread;
      if (!rose && !opts.forceLoad) {
        catchingUp = false;
        return null;
      }
      return notifications.load();
    }).then(function () {
      catchingUp = false;
      if (!window.TMAToast || !window.TMAToast.showNotificationToast) return;
      // Only toast when we had a baseline list (or a prior count) so a cold
      // page load does not replay old history as brand-new toasts.
      if (!hadList && prevUnread === 0 && !opts.forceToast) return;
      notifications.state.items
        .filter(function (it) { return !knownIds[it.id] && !it.read; })
        .slice(0, 3)
        .forEach(function (it) { window.TMAToast.showNotificationToast(it); });
      var root = document.querySelector('.tma-dash');
      if (root && root._syncTabBarBadges) root._syncTabBarBadges();
    }).catch(function () {
      catchingUp = false;
    });
  }

  window.setInterval(function () {
    if (document.hidden) return;
    if (socketLooksHealthy()) return;
    catchUpNotifications();
  }, COUNT_POLL_MS);

  function onNotifyWake() {
    if (document.hidden) return;
    var rt = window.TMAMessagingRealtime;
    if (rt && typeof rt.ensureAlive === 'function') rt.ensureAlive();
    // Always reconcile after wake, even if the socket claims health.
    catchUpNotifications({ forceLoad: true });
  }
  document.addEventListener('visibilitychange', onNotifyWake);
  window.addEventListener('focus', onNotifyWake);
  window.addEventListener('online', onNotifyWake);

  notifications.catchUp = catchUpNotifications;
})();
