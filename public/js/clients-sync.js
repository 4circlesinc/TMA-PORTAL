/*
 * TMA. Catching up on the client book.
 *
 * A TMAReplica walker over `GET /portal/clients/sync`, the eleven thousand
 * records the offline plan's phase 3 was written about. Each arrives as the
 * same full record the profile screen fetches one at a time
 * (`Client::toRecord()`), and lands under `clients:record:<uid>`, which is
 * what lets a profile open offline for a client nobody has clicked before,
 * instead of only for the ones somebody happened to visit.
 *
 * The directory listing itself stays the one cached blob
 * (`clients:directory`, hydrated by clients.js): it is lean by design and
 * refreshed by its own swr; this replica is the deep layer under it.
 *
 * Staff only in effect: the endpoint answers 403 for a client account, the
 * walk fails quietly, and the cursor stays put, the same shape as an
 * account with no CIP reach walking the applications cursor.
 *
 * Global: window.TMAClientsSync
 */
(function () {
  'use strict';

  function keep(record) {
    // `id` IS the uid, toRecord()'s own naming, kept rather than translated.
    if (!record || !record.id) return Promise.resolve();

    var key = 'clients:record:' + record.id;

    return record.deleted
      ? window.TMAStore.invalidate(key)
      : window.TMAStore.put(key, record);
  }

  var walker = window.TMAReplica.make({
    name: 'clients',
    cursorKey: 'clients:sync-cursor',
    /* 200 a page × 40 pages is a comfortable first bite of an 11k book; the
       remainder arrives on the following wakes, cursor in hand. */
    maxPages: 40,
    fetchPage: function (cursor) {
      return window.TMAReplica.fetchJSON('/portal/clients/sync' + window.TMAReplica.query({
        since: cursor && cursor.since,
        after: cursor && cursor.after,
      }));
    },
    records: function (json) {
      return (json && json.clients) || [];
    },
    keep: keep,
    doneEvent: 'tma:clients-synced',
  });

  window.TMAClientsSync = walker;
})();
