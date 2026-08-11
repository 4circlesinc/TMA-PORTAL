/* Sync progress toasts — bottom-right cards that appear while email, calendar,
   OneDrive and Smartsheet document import run in the background. Always
   pinned bottom-right (independent of the notification-toast position
   preference), each card can be minimised to a chip or dismissed. Polls
   /me/sync-status while anything is running and goes quiet once done. */
(function () {
  'use strict';

  if (window.TMASyncToasts) return;

  var ENDPOINT = '/me/sync-status';
  var POLL_MS = 5000;
  var PENDING_POLL_MS = 2000; // a run we just started: catch it starting
  var MAX_LIFETIME_MS = 15 * 60 * 1000; // stop polling eventually, whatever happens
  var DONE_LINGER_MS = 6000;
  /* A sync the user just asked for is queued, not running: the job may sit for
     a few seconds before a worker picks it up, and the status would answer
     'done' the whole time. Hold the card as syncing for this long, or until
     the server confirms a run — whichever comes first. */
  var QUEUE_GRACE_MS = 20000;

  var SERVICES = {
    email: { label: 'Email', syncing: 'Syncing email…', icon: '/images/icons/brands/Outlook.svg' },
    calendar: { label: 'Calendar', syncing: 'Syncing calendar…', icon: '/images/icons/brands/outlook_calendar.svg' },
    onedrive: { label: 'OneDrive', syncing: 'Syncing OneDrive…', icon: '/images/icons/brands/OneDrive40.svg' },
    smartsheet: {
      label: 'Smartsheet',
      syncing: 'Importing documents…',
      icon: '/images/icons/phosphor/Smart_sheet.svg',
    },
  };

  var host = null;
  var cards = {}; // key -> { el, minimized, dismissed, doneTimer }
  var timer = null;
  var startedAt = Date.now();

  function ensureHost() {
    if (!host || !host.isConnected) {
      host = document.querySelector('[data-sync-toast-host]') || document.createElement('div');
      host.className = 'tma-sync-toast-host';
      host.setAttribute('data-sync-toast-host', '');
      if (!host.parentNode) document.body.appendChild(host);
    }
    return host;
  }

  function fmt(n) {
    n = n || 0;
    return n >= 1000 ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(n);
  }

  function title(key, s) {
    var svc = SERVICES[key];
    if (s.state === 'paused' || s.importsPaused) return svc.label + ' paused';
    if (s.state === 'done') {
      return key === 'smartsheet' ? 'Documents imported' : (svc.label + ' synced');
    }
    if (s.state === 'error') return svc.label + ' sync problem';
    return svc.syncing;
  }

  // Every card reads the same way: "synced of total <unit>".
  function detail(key, s) {
    if (s.state === 'paused' || s.importsPaused) {
      return 'Resume in Settings → Background Operations.';
    }
    if (s.state === 'error') return 'Check Settings → Connectors.';
    // A run we started locally has no counts yet — say so rather than "0".
    if (s.synced == null && s.total == null && s.count == null) return 'Starting…';
    if (key === 'email') {
      // An incremental pass replays a change feed — the stored count is the
      // mailbox's size, not this run's progress, so don't imply it is.
      if (s.state === 'syncing' && s.mode === 'incremental') return 'Checking for new mail…';
      return s.total
        ? fmt(s.synced) + ' of ' + fmt(s.total) + ' messages'
        : fmt(s.synced) + ' messages';
    }
    if (key === 'calendar') {
      if (!s.count) return 'Finding your calendars…';
      return s.state === 'syncing'
        ? fmt(s.synced) + ' of ' + fmt(s.count) + ' calendars'
        : fmt(s.count) + ' calendar' + (s.count === 1 ? '' : 's');
    }
    if (key === 'smartsheet') {
      if (!s.total && !s.synced) return 'Copying into client folders…';
      var line = s.total
        ? fmt(s.synced) + ' of ' + fmt(s.total) + ' documents'
        : fmt(s.synced) + ' documents';
      if (s.clients) line += ' · ' + fmt(s.clients) + ' clients';
      return line;
    }
    return s.total
      ? fmt(s.synced) + ' of ' + fmt(s.total) + ' items'
      : fmt(s.synced) + ' items';
  }

  function pct(key, s) {
    var total = key === 'calendar' ? s.count : s.total;
    if (!total || s.synced == null) return null;
    return Math.max(2, Math.min(100, Math.round((s.synced / total) * 100)));
  }

  function buildCard(key) {
    var el = document.createElement('div');
    el.className = 'tma-sync-toast';
    el.setAttribute('data-sync-key', key);
    el.innerHTML =
      '<span class="tma-sync-toast__icon tma-sync-toast__icon--' + key + '"><img src="' + SERVICES[key].icon + '" alt=""></span>' +
      '<div class="tma-sync-toast__body">' +
      '<span class="tma-sync-toast__title"></span>' +
      '<span class="tma-sync-toast__detail"></span>' +
      '<div class="tma-sync-toast__track"><div class="tma-sync-toast__fill"></div></div>' +
      '</div>' +
      '<div class="tma-sync-toast__actions">' +
      '<button type="button" class="tma-sync-toast__btn" data-sync-min aria-label="Minimise">–</button>' +
      '<button type="button" class="tma-sync-toast__btn" data-sync-close aria-label="Dismiss">×</button>' +
      '</div>';

    el.querySelector('[data-sync-min]').addEventListener('click', function (e) {
      e.stopPropagation();
      cards[key].minimized = true;
      el.classList.add('tma-sync-toast--min');
    });
    el.querySelector('[data-sync-close]').addEventListener('click', function (e) {
      e.stopPropagation();
      dismiss(key);
    });
    // Clicking a minimised chip expands it again.
    el.addEventListener('click', function () {
      if (cards[key].minimized) {
        cards[key].minimized = false;
        el.classList.remove('tma-sync-toast--min');
      }
    });

    ensureHost().appendChild(el);
    requestAnimationFrame(function () { el.classList.add('tma-sync-toast--visible'); });
    return el;
  }

  function dismiss(key) {
    var card = cards[key];
    if (!card || !card.el) return;
    card.dismissed = true;
    card.pendingUntil = 0;
    card.el.classList.add('tma-sync-toast--closing');
    (function (el) {
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    })(card.el);
    card.el = null;
  }

  function cardFor(key) {
    return cards[key] || (cards[key] = {
      el: null, minimized: false, dismissed: false, doneTimer: null, pendingUntil: 0,
    });
  }

  /*
   * The mail page draws its own import panel — stage, ETA, retry — in the same
   * bottom-right dock. Two cards for one mailbox is noise, and the panel is
   * the more useful of the two, so the toast stands down while it is up.
   */
  function supersededByPagePanel(key) {
    return key === 'email' && !!document.querySelector('.tma-mail-sync');
  }

  function update(key, s) {
    if (!SERVICES[key] || !s) return;
    var card = cardFor(key);
    if (card.dismissed) return;

    if (supersededByPagePanel(key)) {
      if (card.el) dismiss(key);
      return;
    }

    // A run started from this page is queued, not running yet: keep the card
    // saying "syncing" until the server confirms one, or the grace runs out.
    if (card.pendingUntil) {
      if (s.state === 'syncing' || s.state === 'error') {
        card.pendingUntil = 0;
      } else if (Date.now() < card.pendingUntil) {
        s = {
          state: 'syncing',
          synced: s.synced,
          total: s.total,
          count: s.count,
          clients: s.clients,
          // No total means there is no first-import measurement to show — the
          // run we are waiting on is an incremental one.
          mode: s.mode || (s.total == null ? 'incremental' : null),
        };
      } else {
        card.pendingUntil = 0;
      }
    }

    // Only surface done/error/paused for a service we watched syncing — a
    // mailbox that finished importing last week doesn't need a toast on every load.
    if (!card.el && s.state !== 'syncing' && s.state !== 'paused') return;

    if (!card.el) card.el = buildCard(key);
    var el = card.el;

    el.querySelector('.tma-sync-toast__title').textContent = title(key, s);
    el.querySelector('.tma-sync-toast__detail').textContent = detail(key, s);

    var fill = el.querySelector('.tma-sync-toast__fill');
    var p = pct(key, s);
    el.classList.toggle('tma-sync-toast--error', s.state === 'error');
    el.classList.toggle('tma-sync-toast--done', s.state === 'done');
    el.classList.toggle('tma-sync-toast--paused', s.state === 'paused' || !!s.importsPaused);

    if (s.state === 'done') {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = '100%';
      if (!card.doneTimer) card.doneTimer = setTimeout(function () { dismiss(key); }, DONE_LINGER_MS);
    } else if (s.state === 'error') {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = '100%';
    } else if (s.state === 'paused' || s.importsPaused) {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = p !== null ? p + '%' : '0%';
    } else if (p !== null) {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = p + '%';
    } else {
      fill.classList.add('tma-sync-toast__fill--indeterminate');
      fill.style.width = '';
    }
  }

  /*
   * The card is only removed by a 'done' payload, so anything that ends the
   * poll loop early — the lifetime cap, a failed request, a service that stops
   * being reported — used to leave it pinned on screen for the rest of the
   * session with no way back except a reload. Whenever polling stops, retire
   * whatever is still showing: the Files and Mail pages own the real status.
   */
  function retireAll() {
    Object.keys(cards).forEach(function (key) {
      var card = cards[key];
      if (card && card.el && !card.doneTimer) {
        card.doneTimer = setTimeout(function () { dismiss(key); }, DONE_LINGER_MS);
      }
    });
  }

  function anySyncing(data) {
    return Object.keys(SERVICES).some(function (key) {
      return data[key] && data[key].state === 'syncing';
    });
  }

  function anyPaused(data) {
    if (data.importsPaused) return true;
    return Object.keys(SERVICES).some(function (key) {
      return data[key] && (data[key].state === 'paused' || data[key].importsPaused);
    });
  }

  function anyPending() {
    return Object.keys(cards).some(function (key) {
      return cards[key].pendingUntil && Date.now() < cards[key].pendingUntil;
    });
  }

  /* Smartsheet document import can run for hours; the short lifetime that
     covers mailbox/calendar first-connect must not kill that card mid-run. */
  function shouldKeepPolling(data) {
    if (data.smartsheet && data.smartsheet.state === 'syncing') return true;
    if (anyPaused(data)) return true;
    if (anyPending()) return true;
    return anySyncing(data) && Date.now() - startedAt < MAX_LIFETIME_MS;
  }

  function poll() {
    fetch(ENDPOINT, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    }).then(function (r) {
      if (!r.ok) throw new Error('sync-status ' + r.status);
      return r.json();
    }).then(function (data) {
      Object.keys(SERVICES).forEach(function (key) {
        if (!data[key]) return;
        var status = data[key];
        // Firm-wide pause applies to file imports, not mailbox/calendar.
        if (data.importsPaused && (key === 'onedrive' || key === 'smartsheet')) {
          status = Object.assign({}, status, { importsPaused: true });
          if (status.state === 'syncing') status.state = 'paused';
        }
        update(key, status);
      });

      var pending = anyPending();

      if (shouldKeepPolling(data)) {
        timer = setTimeout(poll, pending ? PENDING_POLL_MS : POLL_MS);
      } else {
        timer = null;
        retireAll();
      }
    }).catch(function () {
      // Signed out, offline, or the endpoint is unavailable — stop quietly.
      timer = null;
      retireAll();
    });
  }

  /*
   * "I just started a sync — show its card."
   *
   * The poll loop goes quiet once nothing is running, so a sync started later
   * in the session (the mailbox's Sync now, for one) would otherwise never be
   * seen. This paints the card straight away, forgives an earlier dismissal —
   * the user asked for this run — and restarts polling to take over the counts.
   */
  function watch(key) {
    if (!SERVICES[key] || !document.body || supersededByPagePanel(key)) return;

    var card = cardFor(key);
    card.dismissed = false;
    card.pendingUntil = 0;
    if (card.doneTimer) { clearTimeout(card.doneTimer); card.doneTimer = null; }

    // Paint first, then arm the grace — update() clears it on any 'syncing'
    // payload, and this one is ours rather than the server's.
    update(key, { state: 'syncing' });
    card.pendingUntil = Date.now() + QUEUE_GRACE_MS;

    startedAt = Date.now();
    if (timer) { clearTimeout(timer); timer = null; }
    poll();
  }

  function boot() {
    if (!document.body) return;
    poll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.TMASyncToasts = {
    poll: poll,
    watch: watch,
    dismiss: dismiss,
    // Push a status without waiting for /me/sync-status — CBI uses this so
    // the card tracks the same counts the Documents tab already fetched.
    update: update,
    // One bottom-right column for every sync card (library, mail, Smartsheet…).
    // Other scripts mount into this so toasts stack instead of overlapping.
    host: ensureHost,
  };
})();
