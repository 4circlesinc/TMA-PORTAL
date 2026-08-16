/*
 * TMA — The replica walker, once.
 *
 * Three record types sync the same way — applications, the File Library,
 * the client book — and the walk is the same each time: desktop only, one
 * run at a time, follow the cursor page by page into the store, save the
 * cursor per page so a closed lid costs the pages that were left and never
 * the ones that landed, stop at a budget so a first sync cannot hold a
 * connection open unbounded. Written three times that is three chances for
 * one of them to save its cursor per run instead; written here it is one.
 *
 * What differs per record type is exactly what the config says: where to
 * ask, which key holds the cursor, how a page's records are read out of the
 * answer, and what keeping one record means. Everything else is the walk.
 *
 * PROGRESS IS ANNOUNCED, NOT POLLED
 *
 * Every page dispatches `tma:replica-progress` with the walker's name, the
 * running total, and whether it is still going — the plan's "progress the
 * reader can see" (docs/offline-plan.md, phase 3). Nothing here draws;
 * portal-sync-status.js decides what a person should be shown.
 *
 * Global: window.TMAReplica  ({ make })
 */
(function () {
  'use strict';

  function persistent() {
    return !!(window.TMAStore && window.TMAStore.persistent);
  }

  function online() {
    return !window.TMAQueue || window.TMAQueue.online();
  }

  function announce(name, taken, running) {
    document.dispatchEvent(new CustomEvent('tma:replica-progress', {
      detail: { source: name, taken: taken, running: running },
    }));
  }

  /**
   * @param {object} config
   * @param {string}   config.name       Short name, for progress and events.
   * @param {string}   config.cursorKey  Store key the cursor lives under.
   * @param {number}   config.maxPages   Pages one wake will walk.
   * @param {function} config.fetchPage  cursor -> Promise<json>
   * @param {function} config.records    json -> the page's records, as a list.
   * @param {function} config.keep       record -> Promise (store or delete it).
   * @param {string}   [config.doneEvent] Dispatched when a walk took anything.
   */
  function make(config) {
    var running = false;

    function run() {
      if (running || !persistent() || !online()) return Promise.resolve(0);

      running = true;
      var taken = 0;

      return window.TMAStore.get(config.cursorKey).then(function (cursor) {
        var page = 0;

        var step = function (from) {
          if (page >= config.maxPages) return Promise.resolve();
          page += 1;

          return config.fetchPage(from).then(function (json) {
            var records = config.records(json) || [];

            return Promise.all(records.map(config.keep)).then(function () {
              taken += records.length;
              announce(config.name, taken, true);

              return window.TMAStore.put(config.cursorKey, json.cursor).then(function () {
                if (json.more) return step(json.cursor);

                return undefined;
              });
            });
          });
        };

        return step(cursor);
      }).then(function () {
        running = false;
        announce(config.name, taken, false);
        if (taken > 0 && config.doneEvent) {
          document.dispatchEvent(new CustomEvent(config.doneEvent, { detail: { count: taken } }));
        }

        return taken;
      }).catch(function () {
        // Offline, or an account this record type answers 403/404 — either
        // way the cursor is untouched and the next wake tries again.
        running = false;
        announce(config.name, taken, false);

        return taken;
      });
    }

    /* Every walker wakes the same three ways: a connection returning, and a
       queued write landing — the one change the server holds that this
       device is guaranteed not to have seen the final shape of. (The third,
       /me answering, is current-user.js calling run() directly.) */
    window.addEventListener('online', function () { run(); });
    document.addEventListener('tma:queue-applied', function () { run(); });

    return { run: run };
  }

  /** The fetch every walker uses: same headers, same error contract. */
  function fetchJSON(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      if (!res.ok) throw new Error(url + ' ' + res.status);

      return res.json();
    });
  }

  /** Cursor fields onto a query string, skipping what is not there yet. */
  function query(parts) {
    var out = [];
    Object.keys(parts).forEach(function (name) {
      var value = parts[name];
      if (value !== undefined && value !== null && value !== '') {
        out.push(name + '=' + encodeURIComponent(value));
      }
    });

    return out.length ? '?' + out.join('&') : '';
  }

  window.TMAReplica = { make: make, fetchJSON: fetchJSON, query: query };
})();
