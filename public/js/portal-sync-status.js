/*
 * TMA — The sync indicator.
 *
 * One line, bottom-left, that appears only when there is something to say:
 * the connection has gone, or there is work parked in the write queue waiting
 * for it to come back. The rest of the time there is nothing on the screen at
 * all — an always-visible "Online ✓" is chrome that teaches the reader to
 * stop looking at exactly the corner they need to look at on the one day it
 * matters.
 *
 * WHY IT IS NOT A TOAST
 *
 * Being offline is a state, not an event. A toast says it once and goes, and
 * the reader who fills in an application ten minutes later has no way to know
 * where it is going. This stays for as long as it is true.
 *
 * OPENING IT SHOWS THE WORK
 *
 * Clicking lists what is waiting, in the order it will be sent, and anything
 * the server refused with its reason. A refusal cannot be retried into
 * working on its own, so those two buttons are the reader's: try it again, or
 * throw it away. The queue never throws anything away by itself.
 *
 * @see portal-queue.js — the queue this reports on.
 */
(function () {
  'use strict';

  var pill = null;

  var ui = function () { return window.TMAPortalUI; };

  function esc(s) {
    return ui() ? ui().esc(s) : String(s == null ? '' : s);
  }

  function label(status) {
    if (status.failed > 0) {
      return status.failed === 1
        ? '1 change needs attention'
        : status.failed + ' changes need attention';
    }
    if (status.syncing && status.waiting > 0) return 'Syncing…';
    if (status.waiting > 0) {
      return status.waiting === 1
        ? '1 change waiting to sync'
        : status.waiting + ' changes waiting to sync';
    }

    return 'You’re offline';
  }

  function tone(status) {
    if (status.failed > 0) return 'attention';
    if (!status.online) return 'offline';

    return 'waiting';
  }

  function paint(status) {
    var wanted = !status.online || status.waiting > 0 || status.failed > 0;

    if (!wanted) {
      if (pill) { pill.remove(); pill = null; }

      return;
    }

    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'tma-sync-pill';
      // Announced, but not urgently: a connection dropping is worth knowing
      // and not worth interrupting whatever is being read.
      pill.setAttribute('aria-live', 'polite');
      pill.addEventListener('click', openPanel);
      document.body.appendChild(pill);
    }

    pill.setAttribute('data-tone', tone(status));
    pill.innerHTML =
      '<span class="tma-sync-pill__dot" aria-hidden="true"></span>' +
      '<span class="tma-sync-pill__text">' + esc(label(status)) + '</span>';
  }

  function when(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    // The reader's own clock, like every other time in the portal.
    return d.toLocaleString([], {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  function rows(entries) {
    if (!entries.length) {
      return '<p class="tma-sync-panel__empty">Everything has been sent.</p>';
    }

    return '<ul class="tma-sync-panel__list">' + entries.map(function (entry) {
      var failed = entry.state === 'failed';

      return '<li class="tma-sync-panel__item' + (failed ? ' is-failed' : '') + '">' +
        '<div class="tma-sync-panel__what">' +
        '<span class="tma-sync-panel__label">' + esc(entry.label) + '</span>' +
        '<span class="tma-sync-panel__meta">' + esc(when(entry.at)) +
        (failed ? ' · ' + esc(entry.error) : '') + '</span>' +
        '</div>' +
        (failed
          ? '<div class="tma-sync-panel__actions">' +
            '<button type="button" class="tma-portal-link" data-sync-retry="' + entry.id + '">Try again</button>' +
            '<button type="button" class="tma-portal-link" data-sync-forget="' + entry.id + '">Discard</button>' +
            '</div>'
          : '<span class="tma-sync-panel__waiting">Waiting</span>') +
        '</li>';
    }).join('') + '</ul>';
  }

  function openPanel() {
    if (!ui() || !ui().openModal || !window.TMAQueue) return;

    window.TMAQueue.all().then(function (entries) {
      var status = window.TMAQueue.state();
      var head = status.online
        ? '<p class="tma-sync-panel__lead">These changes are on this device and are being sent to the firm.</p>'
        : '<p class="tma-sync-panel__lead">You’re offline. These changes are saved on this device and will be sent on their own once you have a connection.</p>';

      ui().openModal({
        title: 'Waiting to sync',
        body: '<div class="tma-sync-panel">' + head + rows(entries) + '</div>',
        onMount: function (host) {
          host.addEventListener('click', function (e) {
            var retry = e.target.closest('[data-sync-retry]');
            var forget = e.target.closest('[data-sync-forget]');
            if (!retry && !forget) return;
            e.preventDefault();

            var id = Number((retry || forget).getAttribute(
              retry ? 'data-sync-retry' : 'data-sync-forget',
            ));

            var done = retry
              ? window.TMAQueue.retry(id)
              // Deliberately no "are you sure": the reader is looking at a
              // change the server has already refused, with the reason next
              // to it. There is nothing left to be uncertain about.
              : window.TMAQueue.forget(id);

            done.then(function () {
              ui().closeModal();
              openPanel();
            });
          });
        },
      });
    });
  }

  function start() {
    if (!window.TMAQueue) return;
    window.TMAQueue.onChange(paint);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    // Deferred scripts run after parsing, so a listener on DOMContentLoaded
    // added from here can be added after it already fired.
    start();
  }
})();
