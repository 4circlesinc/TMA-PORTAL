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

    function remove(uid) {
      var i = indexOf(uid);
      if (i !== -1) { var wasUnread = !state.items[i].read; state.items.splice(i, 1); if (wasUnread) state.unread = Math.max(0, state.unread - 1); changed(); }
      return api(NOTIF_BASE + '/' + uid, { method: 'DELETE' })
        .then(function (data) { state.unread = data.unread != null ? data.unread : state.unread; changed(); return state; })
        .catch(function () { return refreshCount(); });
    }

    /* Realtime: a fresh notification arrived — add to the top without a refetch. */
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

  window.TMANotifications = notifications;
  window.TMAActivities = activities;
})();
