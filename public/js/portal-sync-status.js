/*
 * TMA. The sync indicator.
 *
 * Silent by design. Syncing, prefetching for offline, being offline, and
 * writes parked waiting for a connection are all the app doing its job, and
 * none of them put anything on screen. The work still happens; the commentary
 * does not.
 *
 * The single thing that still surfaces is a change the server REFUSED. That
 * one is not progress, it is the reader's own work, unsendable, held by the
 * queue until a person retries it or throws it away. Staying quiet about that
 * would not be tidy, it would be losing someone's edits without saying so.
 *
 * WHY IT IS NOT A TOAST
 *
 * A refusal is a state, not an event. A toast says it once and goes, and the
 * reader who looks up ten minutes later has no way to know something of theirs
 * never left the machine. This stays for as long as it is true.
 *
 * OPENING IT SHOWS THE WORK
 *
 * Clicking lists what is waiting, in the order it will be sent, and anything
 * the server refused with its reason. A refusal cannot be retried into
 * working on its own, so those two buttons are the reader's: try it again, or
 * throw it away. The queue never throws anything away by itself.
 *
 * @see portal-queue.js, the queue this reports on.
 */
(function () {
  'use strict';

  var pill = null;

  var ui = function () { return window.TMAPortalUI; };

  function esc(s) {
    return ui() ? ui().esc(s) : String(s == null ? '' : s);
  }

  /*
   * The replica walkers, while they walk. Still tracked, the panel and any
   * future diagnostic want to know a walk is in flight, but deliberately no
   * longer painted: a first sync pulling thousands of records is housekeeping,
   * not news. Keyed per source so two walkers running at once sum rather than
   * flicker over each other.
   */
  var replicating = Object.create(null);

  document.addEventListener('tma:replica-progress', function (e) {
    var d = e.detail || {};
    if (!d.source) return;
    if (d.running) replicating[d.source] = d.taken || 0;
    else delete replicating[d.source];
    if (window.TMAQueue) paint(window.TMAQueue.state());
  });

  function replicaCount() {
    return Object.keys(replicating).reduce(function (sum, k) { return sum + replicating[k]; }, 0);
  }

  function replicaActive() {
    return Object.keys(replicating).length > 0;
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
    if (!status.online) return 'You’re offline';

    var taken = replicaCount();

    return taken > 0
      ? 'Syncing for offline, ' + taken.toLocaleString() + ' records'
      : 'Syncing for offline…';
  }

  function tone(status) {
    if (status.failed > 0) return 'attention';
    if (!status.online) return 'offline';
    // A background download is activity, not a warning, the grey dot, the
    // same neutrality as offline, rather than amber asking to be looked at.
    if (status.waiting === 0) return 'busy';

    return 'waiting';
  }

  function paint(status) {
    /*
     * Nothing on screen for anything routine.
     *
     * Syncing, prefetching for offline, being offline, having writes parked
     * waiting for a connection, all of it is the app doing its job, and a
     * reader does not need a running commentary on its housekeeping. It syncs
     * in the background and says nothing.
     *
     * The one exception is a change the SERVER REFUSED. That is not progress,
     * it is work of the reader's that cannot be sent and that the queue will
     * not throw away on its own, it needs a person to retry it or discard it.
     * Hiding that would not be quiet, it would be losing someone's edits
     * without telling them.
     */
    var wanted = status.failed > 0;

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
