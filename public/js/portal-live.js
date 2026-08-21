/*
 * TMA - live data registry
 * Global: window.TMALive
 *
 * Keeps the list-and-table surfaces current without a refresh.
 *
 * A view hands over a resource name and a refresh function; when the server
 * says that resource changed, the refresh runs. That is the whole contract —
 * the event carries no rows (see App\Events\PortalDataChanged), so a view
 * refetches through the endpoint it already uses and keeps every access rule
 * that endpoint enforces.
 *
 * Refreshes must patch through TMAMorph rather than rewriting innerHTML.
 * These fire while somebody is *using* the page: an innerHTML swap throws away
 * their scroll position, their open menu and their half-typed input, which is
 * a worse interruption than the refresh they were avoiding.
 *
 * Rides the socket messaging and notifications already opened — one connection
 * per tab, many subscriptions. That matters: the WebSocket cluster is capped
 * on *connections*, so surfaces are cheap but tabs are not.
 */
(function () {
  'use strict';

  /* Shared with App\Support\Realtime\Live — a name on one side only is a
     surface that silently never updates. Add to both or neither. */
  var RESOURCES = {
    FILES: 'files',
    CLIENTS: 'clients',
    USERS: 'users',
    CONTACTS: 'contacts',
    CALENDAR: 'calendar',
    COMPANIES: 'companies',
    PROJECTS: 'projects',
    SIGNATURES: 'signatures',
    ACTIVITY: 'activity',
    CIP: 'cip',
    IDENTITY: 'identity',
  };

  /* Bursts are the normal case, not the exception — a bulk delete or a folder
     sync emits one event per row. Coalesce them into a single refetch. */
  var DEBOUNCE_MS = 300;

  /* resource -> [entry]. An entry is one view's refresh. */
  var registry = {};
  var timers = {};
  var started = false;
  var waiting = false;

  function socketId() {
    var rt = window.TMAMessagingRealtime;
    return (rt && rt.socketId) || '';
  }

  /*
   * Add the socket id to a write's headers.
   *
   * broadcast(...)->toOthers() can only leave the actor out if it knows which
   * socket they are — without this header the person who made the change gets
   * told about their own change and refetches on top of the render they just
   * did. Harmless, but it is a wasted round trip on every single write.
   */
  function headers(base) {
    var out = base || {};
    var id = socketId();
    if (id) out['X-Socket-ID'] = id;
    return out;
  }

  function entriesFor(resource) {
    return registry[resource] || (registry[resource] = []);
  }

  /**
   * Watch a resource.
   *
   * @param {string}   resource  One of RESOURCES.
   * @param {Function} refresh   Refetch + morph. May return a promise; if it
   *                             does, overlapping runs are suppressed.
   * @param {object}   [opts]    { active: () => boolean } — skip the refresh
   *                             when the view is registered but not on screen.
   * @returns {Function} off
   */
  function register(resource, refresh, opts) {
    if (!resource || typeof refresh !== 'function') return function () {};

    var entry = {
      refresh: refresh,
      active: (opts && opts.active) || null,
      running: false,
      dirty: false,
    };

    entriesFor(resource).push(entry);
    start();

    return function off() {
      var list = registry[resource];
      if (!list) return;
      var i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    };
  }

  /* Returns a promise that settles when this entry's refetch is done, so a
     caller driving a visible spinner (pull-to-refresh) knows when to stop. */
  function runEntry(entry) {
    if (entry.running) {
      // Something landed mid-refetch; the data we are about to receive may
      // already be stale, so remember to go again rather than dropping it.
      entry.dirty = true;
      return Promise.resolve();
    }

    if (entry.active && !entry.active()) return Promise.resolve();

    var result;
    entry.running = true;

    try {
      result = entry.refresh();
    } catch (err) {
      entry.running = false;
      return Promise.resolve();
    }

    if (!result || typeof result.then !== 'function') {
      entry.running = false;
      if (entry.dirty) { entry.dirty = false; return runEntry(entry); }
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      result.then(done, done);

      function done() {
        entry.running = false;
        if (entry.dirty) { entry.dirty = false; resolve(runEntry(entry)); return; }
        resolve();
      }
    });
  }

  function flush(resource) {
    var list = registry[resource];
    if (!list || !list.length) return Promise.resolve();

    // A background tab refetching is pure cost — nobody is looking at it, and
    // with many tabs open it multiplies every write into a burst of requests.
    // Defer to the visibility handler, which catches up on the way back.
    if (document.hidden) {
      list.forEach(function (entry) { entry.dirty = true; });
      return Promise.resolve();
    }

    return Promise.all(list.slice().map(runEntry));
  }

  function schedule(resource) {
    if (!registry[resource] || !registry[resource].length) return;

    clearTimeout(timers[resource]);
    timers[resource] = setTimeout(function () {
      timers[resource] = null;
      flush(resource);
    }, DEBOUNCE_MS);
  }

  function onSignal(data) {
    var resource = data && data.resource;
    if (resource) schedule(resource);
  }

  /* Refresh everything that is watching — used after a reconnect and when a
     hidden tab comes back, since both may have missed events entirely. */
  function refreshAll() {
    return Promise.all(Object.keys(registry).map(function (resource) {
      var list = registry[resource];
      return list && list.length ? flush(resource) : null;
    }));
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    // Events that arrived while hidden were only marked, and the socket may
    // have been asleep for longer than we know.
    refreshAll();
  });

  function bind(rt, me) {
    /*
     * Subscribe to both and let the server decide.
     *
     * portal.staff is refused for a client account, and the transport leaves a
     * refused channel unsubscribed without fuss. Deciding here instead would
     * mean a second copy of "who counts as staff" in the browser — and
     * client-side role checks in this portal have a habit of failing towards
     * the wrong answer.
     */
    rt.listen('private-portal.staff', 'data.changed', onSignal);
    rt.listen('private-App.Models.User.' + me.id, 'data.changed', onSignal);

    if (rt.onState) {
      rt.onState(function (state) {
        // Anything that changed while the socket was down was never delivered
        // and never will be — the only way back to correct is to refetch.
        if (state === 'connected') refreshAll();
      });
    }
  }

  function start() {
    if (started) return;

    /*
     * current-user.js loads after the views that register here, so the first
     * caller always arrives before TMACurrentUser exists. Waiting rather than
     * giving up matters: returning without arranging a retry leaves the socket
     * permanently unbound and every live surface silently dead.
     *
     * Do NOT gate the retry on readyState === 'loading'. Every script in this
     * shell is deferred, and deferred scripts run *after* parsing, when
     * readyState is already 'interactive' — that check is false exactly when
     * it is needed, which is the whole bug. DOMContentLoaded has still not
     * fired at that point, so listening for it is correct; the 'complete'
     * branch only covers a view registering long after load.
     */
    if (!window.TMACurrentUser || !window.TMACurrentUser.onChange) {
      if (!waiting) {
        waiting = true;

        var retry = function () {
          waiting = false;
          start();
        };

        if (document.readyState === 'complete') setTimeout(retry, 0);
        else document.addEventListener('DOMContentLoaded', retry, { once: true });
      }

      return;
    }

    started = true;

    // onChange fires immediately when /me has already answered, so this costs
    // no extra request — /me is fetched more than enough times already.
    window.TMACurrentUser.onChange(function (me) {
      if (!me || !me.id) return;

      var rt = window.TMAMessagingRealtime;
      var cfg = me.realtime;

      // No socket configured → the surfaces keep their existing behaviour.
      if (!rt || !cfg || !cfg.enabled) return;
      if (!rt.start(cfg)) return;

      bind(rt, me);
    });
  }

  /*
   * Your own account type changed.
   *
   * This reloads rather than re-applying the capability rules, because
   * TMAPortalAccess.apply() only ever *removes* nav rows. Re-running it after
   * a promotion cannot bring back rows it already deleted from the DOM, so the
   * newly-allowed sections would stay invisible until the next navigation —
   * the exact case someone changing an account type is watching for.
   *
   * A reload also settles the rest of it in one go: the shell re-inlines fresh
   * boot capabilities, and anyone demoted while sitting on a page they may no
   * longer open is moved off it instead of left looking at stale contents.
   *
   * Only when the capability set actually differs. Status changes and
   * re-approvals hit the same signal, and reloading somebody's page for a
   * change that grants and removes nothing is an interruption for no reason.
   */
  function watchIdentity() {
    register(RESOURCES.IDENTITY, function () {
      return fetch((window.__TMA_SITE_ROOT || '') + '/me', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) {
          if (!me || !window.TMAPortalAccess) return;

          var next = (me.capabilities || []).slice().sort().join('|');
          var current = window.TMAPortalAccess.capabilities().slice().sort().join('|');

          /*
           * Never during a sign-out. Signing out destroys the session, so the
           * very next /me is a different capability set — this fired, reloaded
           * the page out from under sign-out.js before it could navigate, and
           * the click read as "it just refreshed the page and I am still
           * signed in". sign-out.js raises the flag before it does anything.
           */
          if (window.__TMA_SIGNING_OUT) return;

          if (next !== current) window.location.reload();
        })
        .catch(function () {});
    });
  }

  watchIdentity();

  window.TMALive = {
    RESOURCES: RESOURCES,
    register: register,
    headers: headers,
    socketId: socketId,
    // Exposed for surfaces that need to force a sweep (e.g. after an import,
    // or a pull-to-refresh). Both resolve when the refetches have landed.
    refreshAll: refreshAll,
    flush: flush,
  };
})();
