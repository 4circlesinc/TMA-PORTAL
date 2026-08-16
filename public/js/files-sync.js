/*
 * TMA — Catching up on the File Library.
 *
 * The library's twin of cip-sync.js: walk `GET /portal/files/sync` and file
 * what it answers into the store, so the desktop holds the account's whole
 * library rather than the slice somebody happened to browse. Records land
 * under `files:folder:<uuid>` and `files:item:<uuid>`; a tombstone deletes
 * its key. The listing caches (`files:listing:`) are untouched — they belong
 * to the screens, this is the record layer beneath them, and assembling
 * listings from it is phase 3's remaining work (docs/offline-plan.md).
 *
 * TWO CURSORS RIDE TOGETHER
 *
 * Folders and files are separate id sequences, so each keeps its own
 * timestamp-and-id pair and the endpoint pages them side by side. The pair is
 * saved per page, not per run — a laptop lid closing mid-walk costs the pages
 * that were left, never the ones that landed.
 *
 * DESKTOP ONLY, LIKE EVERYTHING THAT REPLICATES
 *
 * In a browser the store is memory a reload empties; walking thousands of
 * records into it would spend the firm's bandwidth warming something that
 * cannot survive the next refresh — and put the client book somewhere the
 * firm decided it must not sit. `TMAStore.persistent` is the gate.
 *
 * Global: window.TMAFilesSync
 */
(function () {
  'use strict';

  var CURSOR_KEY = 'files:sync-cursor';

  /*
   * Pages one wake will walk before handing back. A first sync of a large
   * library must not become an unbounded loop holding a connection open; it
   * stops, keeps its cursors, and continues on the next wake — resumable by
   * construction rather than by a separate resume path.
   */
  var MAX_PAGES = 30;

  var running = false;

  function persistent() {
    return !!(window.TMAStore && window.TMAStore.persistent);
  }

  function fetchPage(cursor) {
    var query = [];
    var add = function (name, value) {
      if (value !== undefined && value !== null && value !== '') {
        query.push(name + '=' + encodeURIComponent(value));
      }
    };
    var folders = (cursor && cursor.folders) || {};
    var files = (cursor && cursor.files) || {};
    add('foldersSince', folders.since);
    add('foldersAfter', folders.after);
    add('filesSince', files.since);
    add('filesAfter', files.after);

    return fetch('/portal/files/sync' + (query.length ? '?' + query.join('&') : ''), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      if (!res.ok) throw new Error('files sync ' + res.status);

      return res.json();
    });
  }

  /* One record into the store — or, for a tombstone, out of it. */
  function keep(record) {
    if (!record || !record.id) return Promise.resolve();

    var key = (record.type === 'folder' ? 'files:folder:' : 'files:item:') + record.id;

    return record.deleted
      ? window.TMAStore.invalidate(key)
      : window.TMAStore.put(key, record);
  }

  /**
   * Walk both cursors until they run out, or the page budget does.
   * Resolves with how many records were taken in.
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
          var records = ((json && json.folders) || []).concat((json && json.files) || []);

          return Promise.all(records.map(keep)).then(function () {
            taken += records.length;

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
        document.dispatchEvent(new CustomEvent('tma:files-synced', { detail: { count: taken } }));
      }

      return taken;
    }).catch(function () {
      // Offline, or the portal is between deploys. The cursors are untouched
      // and the next wake carries on from where this one stood.
      running = false;

      return taken;
    });
  }

  window.addEventListener('online', function () { run(); });

  // A queued write landing is the one change the server holds that this
  // device is guaranteed not to have seen the final shape of.
  document.addEventListener('tma:queue-applied', function () { run(); });

  /* The first wake is current-user.js, once /me has said who this is — same
     contract as TMACipSync, and deliberately not an onChange listener, which
     fires per navigation. */

  window.TMAFilesSync = { run: run };
})();
