/*
 * TMA. Catching up on applications.
 *
 * A TMAReplica walker over `GET /portal/cip/applications/sync`. Each record
 * is filed everywhere a screen might look for it: the client profile knows a
 * client and asks what application they have (`cip:application:<clientUid>`),
 * the wizard knows an application and asks for it by id
 * (`cip:application-record:<id>`). Writing both here is what stops a
 * catch-up leaving one of them stale.
 *
 * Never on a timer: a cursor read that finds nothing still costs a round
 * trip per open tab, and the live signals already cover a portal somebody is
 * sitting in front of. The wakes are the walker's own (reconnect, a queued
 * write landing) plus /me answering, from current-user.js.
 *
 * Global: window.TMACipSync
 */
(function () {
  'use strict';

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

  var walker = window.TMAReplica.make({
    name: 'applications',
    cursorKey: 'cip:sync-cursor',
    maxPages: 20,
    fetchPage: function (cursor) {
      return window.TMAReplica.fetchJSON('/portal/cip/applications/sync' + window.TMAReplica.query({
        since: cursor && cursor.since,
        after: cursor && cursor.after,
      }));
    },
    records: function (json) {
      return (json && json.applications) || [];
    },
    keep: keep,
    doneEvent: 'tma:cip-synced',
  });

  window.TMACipSync = walker;
})();
