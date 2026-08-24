/*
 * TMA. Catching up on the File Library.
 *
 * A TMAReplica walker over `GET /portal/files/sync`: records land under
 * `files:folder:<uuid>` and `files:item:<uuid>`, a tombstone deletes its
 * key, and the two cursors (folders and files are separate id sequences)
 * ride together in one stored pair. The listing caches (`files:listing:`)
 * are untouched, they belong to the screens; this is the record layer
 * beneath them, and portal-files.js assembles offline listings from it.
 *
 * Desktop only, like everything that replicates: in a browser the store is
 * memory a reload empties, and walking thousands of records into it would
 * spend the firm's bandwidth warming something that cannot survive the next
 * refresh. The walker itself gates on TMAStore.persistent.
 *
 * Global: window.TMAFilesSync
 */
(function () {
  'use strict';

  function keep(record) {
    if (!record || !record.id) return Promise.resolve();

    var key = (record.type === 'folder' ? 'files:folder:' : 'files:item:') + record.id;

    return record.deleted
      ? window.TMAStore.invalidate(key)
      : window.TMAStore.put(key, record);
  }

  var walker = window.TMAReplica.make({
    name: 'files',
    cursorKey: 'files:sync-cursor',
    /* A first sync of a large library must not become an unbounded loop
       holding a connection open; it stops, keeps its cursors, and continues
       on the next wake. */
    maxPages: 30,
    fetchPage: function (cursor) {
      var folders = (cursor && cursor.folders) || {};
      var files = (cursor && cursor.files) || {};

      return window.TMAReplica.fetchJSON('/portal/files/sync' + window.TMAReplica.query({
        foldersSince: folders.since,
        foldersAfter: folders.after,
        filesSince: files.since,
        filesAfter: files.after,
      }));
    },
    records: function (json) {
      return ((json && json.folders) || []).concat((json && json.files) || []);
    },
    keep: keep,
    doneEvent: 'tma:files-synced',
  });

  window.TMAFilesSync = walker;
})();
