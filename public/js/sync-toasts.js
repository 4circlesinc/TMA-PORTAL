/* Sync progress toasts — bottom-right cards that appear while email, calendar
   and OneDrive import in the background after a Microsoft connect. Always
   pinned bottom-right (independent of the notification-toast position
   preference), each card can be minimised to a chip or dismissed. Polls
   /me/sync-status while anything is running and goes quiet once done. */
(function () {
  'use strict';

  if (window.TMASyncToasts) return;

  var ENDPOINT = '/me/sync-status';
  var POLL_MS = 5000;
  var MAX_LIFETIME_MS = 15 * 60 * 1000; // stop polling eventually, whatever happens
  var DONE_LINGER_MS = 6000;

  var SERVICES = {
    email: { label: 'Email', syncing: 'Syncing email…', icon: '/images/icons/brands/Outlook.svg' },
    calendar: { label: 'Calendar', syncing: 'Syncing calendar…', icon: '/images/icons/brands/outlook_calendar.svg' },
    onedrive: { label: 'OneDrive', syncing: 'Syncing OneDrive…', icon: '/images/icons/brands/OneDrive40.svg' },
  };

  var host = null;
  var cards = {}; // key -> { el, minimized, dismissed, doneTimer }
  var timer = null;
  var startedAt = Date.now();

  function ensureHost() {
    if (!host) {
      host = document.createElement('div');
      host.className = 'tma-sync-toast-host';
      host.setAttribute('data-sync-toast-host', '');
      document.body.appendChild(host);
    }
    return host;
  }

  function fmt(n) {
    n = n || 0;
    return n >= 1000 ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(n);
  }

  function title(key, s) {
    var svc = SERVICES[key];
    if (s.state === 'done') return svc.label + ' synced';
    if (s.state === 'error') return svc.label + ' sync problem';
    return svc.syncing;
  }

  // Every card reads the same way: "synced of total <unit>".
  function detail(key, s) {
    if (s.state === 'error') return 'Check Settings → Connectors.';
    if (key === 'email') {
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
    return s.total
      ? fmt(s.synced) + ' of ' + fmt(s.total) + ' items'
      : fmt(s.synced) + ' items';
  }

  function pct(key, s) {
    var total = key === 'calendar' ? s.count : s.total;
    if (!total || !s.synced) return null;
    return Math.max(2, Math.min(100, Math.round((s.synced / total) * 100)));
  }

  function buildCard(key) {
    var el = document.createElement('div');
    el.className = 'tma-sync-toast';
    el.setAttribute('data-sync-key', key);
    el.innerHTML =
      '<span class="tma-sync-toast__icon"><img src="' + SERVICES[key].icon + '" alt=""></span>' +
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
    card.el.classList.add('tma-sync-toast--closing');
    (function (el) {
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    })(card.el);
    card.el = null;
  }

  function update(key, s) {
    var card = cards[key] || (cards[key] = { el: null, minimized: false, dismissed: false, doneTimer: null });
    if (card.dismissed) return;

    // Only surface done/error for a service we watched syncing — a mailbox
    // that finished importing last week doesn't need a toast on every load.
    if (!card.el && s.state !== 'syncing') return;

    if (!card.el) card.el = buildCard(key);
    var el = card.el;

    el.querySelector('.tma-sync-toast__title').textContent = title(key, s);
    el.querySelector('.tma-sync-toast__detail').textContent = detail(key, s);

    var fill = el.querySelector('.tma-sync-toast__fill');
    var p = pct(key, s);
    el.classList.toggle('tma-sync-toast--error', s.state === 'error');
    el.classList.toggle('tma-sync-toast--done', s.state === 'done');

    if (s.state === 'done') {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = '100%';
      if (!card.doneTimer) card.doneTimer = setTimeout(function () { dismiss(key); }, DONE_LINGER_MS);
    } else if (s.state === 'error') {
      fill.classList.remove('tma-sync-toast__fill--indeterminate');
      fill.style.width = '100%';
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
    return ['email', 'calendar', 'onedrive'].some(function (key) {
      return data[key] && data[key].state === 'syncing';
    });
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
        if (data[key]) update(key, data[key]);
      });

      if (anySyncing(data) && Date.now() - startedAt < MAX_LIFETIME_MS) {
        timer = setTimeout(poll, POLL_MS);
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

  function boot() {
    if (!document.body) return;
    poll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.TMASyncToasts = { poll: poll, dismiss: dismiss };
})();
