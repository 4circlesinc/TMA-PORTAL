/*
 * TMA — Catching up on applications.
 *
 * The pull half of working offline. portal-queue.js pushes what was done with
 * no network; this brings back what everybody else did in the meantime, so a
 * desktop that has been shut for a week opens on the firm's current book
 * rather than last Tuesday's.
 *
 * A CURSOR, NOT A REFETCH
 *
 * `GET /portal/cip/applications/sync` answers "what has moved since?" from a
 * timestamp-and-id pair, in pages. Eleven thousand clients is not something
 * to re-download because one dependant's date of birth was corrected, and the
 * pair rather than a timestamp alone is what makes a page boundary safe — see
 * the note on the controller.
 *
 * DESKTOP ONLY, AND FOR THE SAME REASON AS THE STORE
 *
 * This walks everything the account may see into the cache. On the desktop
 * that is the point: it is what makes the portal work on a plane. In a
 * browser the cache is memory that a reload empties, so the download would
 * cost the firm's bandwidth to warm something that cannot survive the next
 * refresh — and would put a citizenship client's details somewhere the firm
 * decided they should not be. So it does not run there at all.
 *
 * WHEN IT RUNS
 *
 * On sign-in, when the connection comes back, and after the write queue lands
 * something — the last because a replayed edit is the one change the server
 * has that this device is guaranteed not to have seen the final shape of.
 * Never on a timer: a cursor read that finds nothing still costs a round trip
 * per open tab, and the live signals already cover a portal somebody is
 * sitting in front of.
 *
 * Global: window.TMACipSync
 */
(function () {
  'use strict';

  var CURSOR_KEY = 'cip:sync-cursor';

  /*
   * How many pages one catch-up will walk before stopping.
   *
   * A first run against the whole book is thousands of records and must not
   * become an unbounded loop holding a connection open; it stops, keeps its
   * cursor, and carries on from there the next time it is woken. Resumable by
   * construction rather than by a separate resume path.
   */
  var MAX_PAGES = 20;

  var running = false;

  function persistent() {
    return !!(window.TMAStore && window.TMAStore.persistent);
  }

  function fetchPage(cursor) {
    var query = [];
    if (cursor && cursor.since) query.push('since=' + encodeURIComponent(cursor.since));
    if (cursor && cursor.after) query.push('after=' + encodeURIComponent(cursor.after));

    return fetch('/portal/cip/applications/sync' + (query.length ? '?' + query.join('&') : ''), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      // 404 is what the module answers an account that may not reach it —
      // most of the firm — and is not a failure worth reporting anywhere.
      if (!res.ok) throw new Error('sync ' + res.status);

      return res.json();
    });
  }

  /*
   * File one record everywhere a screen might look for it.
   *
   * Two keys because two screens ask different questions: the client profile
   * knows a client and asks what application they have, the wizard knows an
   * application and asks for it by id. Writing both here is what stops a
   * catch-up leaving one of them stale.
   */
  function keep(record) {
    if (!record) return Promise.resolve();

    var writes = [];
    if (record.clientUid) {
      writes.push(window.TMAStore.put('cip:application:' + record.clientUid, { application: record }));
    }
    if (record.id) {
      writes.push(window.TMAStore.put('cip:application-record:' + record.id, { application: record }));
    }

    return Promise.all(writes);
  }

  /**
   * Walk the cursor until it runs out, or the page budget does.
   *
   * Resolves with how many records were taken in, which is what decides
   * whether anything on the screen needs to be redrawn.
   */
  function run() {
    if (running || !persistent()) return Promise.resolve(0);
    if (window.TMAQueue && !window.TMAQueue.online()) return Promise.resolve(0);

    running = true;
    var taken = 0;

    return window.TMAStore.get(CURSOR_KEY).then(function (cursor) {
      var page = 0;

      var step = function (from) {
        if (page >= MAX_PAGES) return Promise.resolve();
        page += 1;

        return fetchPage(from).then(function (json) {
          var records = (json && json.applications) || [];

          return Promise.all(records.map(keep)).then(function () {
            taken += records.length;

            /*
             * The cursor is saved per page, not per run. A laptop lid closing
             * halfway through a first sync should cost the pages that were
             * left, not the ones that landed.
             */
            return window.TMAStore.put(CURSOR_KEY, json.cursor).then(function () {
              if (json.more) return step(json.cursor);

              return undefined;
            });
          });
        });
      };

      return step(cursor);
    }).then(function () {
      running = false;
      if (taken > 0) {
        document.dispatchEvent(new CustomEvent('tma:cip-synced', { detail: { count: taken } }));
      }

      return taken;
    }).catch(function () {
      // Offline, or an account with no reach into the module. Either way the
      // cursor is untouched and the next wake tries again from where it was.
      running = false;

      return taken;
    });
  }

  window.addEventListener('online', function () { run(); });

  document.addEventListener('tma:queue-applied', function (e) {
    if (e.detail && e.detail.kind === 'cip.application') run();
  });

  /* The first wake is current-user.js, once /me has said who this is — the
     moment the cache has an owner. Deliberately not TMACurrentUser.onChange,
     which fires on every navigation: a cursor read per page change is a round
     trip per page change to be told nothing has happened. */

  window.TMACipSync = { run: run };
})();
