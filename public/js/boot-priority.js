/*
 * TMA - Boot priority.
 *
 * Every page module loads with the shell, and each used to start its own
 * boot work the moment it ran: the mailbox primed its inbox, Clients pulled
 * the whole directory, Overview asked for its four panels, the Feed for its
 * channels, all before the Dashboard had painted the row the browser scores
 * as its largest paint. On production that burst is a hundred requests from
 * twenty PHP workers, and the one request the Dashboard is waiting on queues
 * behind the rest.
 *
 * This file is the shell's one answer to "is this work needed now?". A module
 * wraps its speculative boot fetch in deferUnless(routes, fn): on a hard load
 * of one of those routes the work runs at once, exactly as before, and
 * everywhere else it waits until the page has loaded and the browser is idle,
 * or until the reader navigates into one of those routes, whichever comes
 * first. once(key, factory) is the companion: two modules asking for the same
 * GET in the same breath share one round trip.
 *
 * Loads right after dom-morph.js, so it exists before any page module runs.
 *
 * Global: window.TMABoot
 */
(function () {
  if (window.TMABoot) return;

  /* ── route ──────────────────────────────────────────────────────── */

  function siteRoot() {
    return window.__TMA_SITE_ROOT || '';
  }

  function normalizePath(path) {
    var p = String(path || '').replace(/\/index\.html$/i, '');
    var root = siteRoot();
    if (root && p.indexOf(root) === 0) p = p.slice(root.length) || '/';
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p || '/';
  }

  // Every one of these paths lands on the Clients view, the CIP applications
  // and the two legacy contact spellings alike.
  var CLIENT_PREFIXES = [
    '/citizenship-applications', '/user-profile/clients', '/clients',
    '/contacts', '/user-profile/contacts',
  ];

  /*
   * The view dashboard.js will show for a path: the name its routeFromPath
   * puts in `view`. dashboard.js is not loaded yet when the page modules run,
   * so this mirrors routeFromPath and must be kept in step with it. The
   * explicit rules come first, then the same fallback dashboard.js uses, the
   * sidebar leaf whose href is this path, so everything not named here is
   * read off the shell's own nav rather than copied.
   */
  function route(path) {
    var p = normalizePath(path == null ? window.location.pathname : path);
    if (p === '/') {
      // ?settings-page= opens Account settings (or Reporting) on the root.
      var page = null;
      try { page = new URLSearchParams(window.location.search).get('settings-page'); } catch (e) {}
      if (page === 'reporting') return 'reporting';
      if (page) return 'admin';
      return 'dashboard';
    }
    if (p === '/users/new') return 'add-data';
    if (p === '/users') return 'users';
    if (p === '/bespoke-ai' || p.indexOf('/bespoke-ai/') === 0) return 'bespoke';
    if (p === '/reporting') return 'reporting';
    if (p === '/overview') return 'overview';
    if (p === '/account') return 'account';
    if (p === '/settings' || p === '/settings/change-email') return 'settings';
    if (p === '/account-settings') return 'admin';
    if (p === '/email' || p === '/email/compose' || p === '/email/templates') return 'email';
    if (p === '/social/messages') return 'messages';
    if (p === '/social/feed') return 'feed';
    if (p === '/calendar') return 'calendar';
    if (p === '/pricing') return 'pricing';
    for (var i = 0; i < CLIENT_PREFIXES.length; i++) {
      var pre = CLIENT_PREFIXES[i];
      if (p === pre || p.indexOf(pre + '/') === 0) return 'clients';
    }
    var leaves = document.querySelectorAll('.tma-dash__nav-item[data-nav][href]');
    for (var j = 0; j < leaves.length; j++) {
      var href = leaves[j].getAttribute('href') || '';
      if (href.charAt(0) !== '/' || normalizePath(href) !== p) continue;
      return leaves[j].getAttribute('data-view') || 'dashboard';
    }
    return null;
  }

  /* ── deferred work ──────────────────────────────────────────────── */

  // Held back until the shell is quiet: nothing in here is needed to paint
  // the page the reader arrived on. The floor after `load` keeps the release
  // behind the Dashboard's own data, which lands after load on a real link.
  var IDLE_TIMEOUT_MS = 1200;
  var RELEASE_FLOOR_MS = 1200;

  var jobs = [];
  var released = false;
  var draining = false;

  function runJob(job) {
    if (job.ran) return;
    job.ran = true;
    try {
      job.fn();
    } catch (err) {
      if (window.console && console.error) console.error('[boot] deferred work failed', err);
    }
  }

  function wanted(job, view) {
    return !!view && job.routes.indexOf(view) !== -1;
  }

  function idle(fn) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
    } else {
      setTimeout(fn, IDLE_TIMEOUT_MS);
    }
  }

  // One job per idle slot: a trickle, not the burst this file exists to stop.
  function drain() {
    var next = null;
    for (var i = 0; i < jobs.length; i++) {
      if (!jobs[i].ran) { next = jobs[i]; break; }
    }
    if (!next) { draining = false; return; }
    runJob(next);
    idle(drain);
  }

  function release() {
    released = true;
    if (draining) return;
    draining = true;
    idle(drain);
  }

  function releaseAfterLoad() {
    setTimeout(release, RELEASE_FLOOR_MS);
  }

  if (document.readyState === 'complete') releaseAfterLoad();
  else window.addEventListener('load', releaseAfterLoad);

  /*
   * Run fn now when the page being entered is one of `routes` (view names as
   * route() answers them), otherwise after load and idle, or as soon as the
   * reader navigates into one of them. Returns a function that runs it now if
   * it has not run yet, for a module whose own activate path needs the data
   * before the URL changes. fn runs at most once either way.
   */
  function deferUnless(routes, fn) {
    var job = { routes: [].concat(routes || []), fn: fn, ran: false };
    var run = function () { runJob(job); };
    if (wanted(job, route())) {
      run();
      return run;
    }
    jobs.push(job);
    if (released && !draining) {
      draining = true;
      idle(drain);
    }
    return run;
  }

  // Work no page needs first: it only ever waits for the shell to go quiet.
  function afterIdle(fn) {
    return deferUnless([], fn);
  }

  /* Navigation: dashboard.js announces nothing, but every in-shell move ends
     in pushState and every back/forward in popstate. The check is put behind
     the current task so activate() has finished before a module's boot work
     runs inside it. */
  function onNavigate() {
    setTimeout(function () {
      var view = route();
      jobs.forEach(function (job) {
        if (!job.ran && wanted(job, view)) runJob(job);
      });
    }, 0);
  }

  if (window.history && typeof window.history.pushState === 'function') {
    var pushState = window.history.pushState;
    window.history.pushState = function () {
      var result = pushState.apply(this, arguments);
      onNavigate();
      return result;
    };
  }
  window.addEventListener('popstate', onNavigate);

  /* ── shared requests ────────────────────────────────────────────── */

  // Two modules asking for the same GET in the same breath share one answer:
  // the same promise while it is pending and for this long after it settles.
  var SHARE_MS = 2000;
  var shared = Object.create(null);

  /*
   * The factory must hand back parsed data, or a Response every consumer
   * clones before reading, since a body can only be read once. A rejection is
   * shared too, so each consumer catches its own.
   */
  function once(key, factory) {
    var hit = shared[key];
    if (hit && (hit.pending || Date.now() - hit.settledAt < SHARE_MS)) return hit.promise;
    var entry = { pending: true, settledAt: 0, promise: null };
    try {
      entry.promise = Promise.resolve(factory());
    } catch (err) {
      entry.promise = Promise.reject(err);
    }
    shared[key] = entry;
    var settle = function () {
      entry.pending = false;
      entry.settledAt = Date.now();
    };
    entry.promise.then(settle, settle);
    return entry.promise;
  }

  // A write that changes the answer drops the shared copy.
  function forget(key) {
    delete shared[key];
  }

  window.TMABoot = {
    route: route,
    deferUnless: deferUnless,
    afterIdle: afterIdle,
    // The Dashboard may call this once its board has painted, to let the
    // deferred work in before the floor after load has passed.
    release: release,
    once: once,
    forget: forget,
  };
})();
