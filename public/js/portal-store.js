/*
 * TMA - The local store.
 *
 * One read-through cache for everything the portal fetches, so a screen can
 * paint what it already knows and check with the server behind the paint. It
 * is the foundation of the offline work (docs/offline-plan.md) and, on its
 * own, the reason a folder opens now instead of in two seconds.
 *
 * TWO TIERS, AND WHY THEY DIFFER
 *
 * Memory, always. Disk (IndexedDB), only in the desktop app. That is the
 * firm's decision and it is a real one: the disk tier is what makes the portal
 * work with no network, and it is also a copy of a citizenship client's
 * personal details sitting in a browser profile. On an installed, managed
 * desktop that is a considered trade; on whatever browser somebody borrows it
 * is not. So browsers get the speed and none of the residue, and everything
 * below reads `persistent` rather than assuming.
 *
 * SCOPED TO THE ACCOUNT
 *
 * Every entry is stored under the signed-in user's id. Two accounts on one
 * machine never see each other's cache, and signing in as somebody else does
 * not warm the screen with the last person's clients — a bug that would look
 * exactly like a permissions failure.
 *
 * STALE IS SAID, NOT HIDDEN
 *
 * `swr` hands the caller the cached value with `stale: true` and then the
 * fresh one. Callers paint the first and repaint on the second. Nothing here
 * decides how old is too old: freshness is the screen's business, and a client
 * list a minute out of date is fine where a file's review status is not.
 *
 * Global: window.TMAStore
 */
(function () {
  'use strict';

  var DB_NAME = 'tma-portal';

  var DB_VERSION = 1;

  var STORE = 'cache';

  /* Entries older than this are ignored on read and dropped on the next sweep.
     A week is long enough that a fortnight away still opens instantly, and
     short enough that a record deleted while away does not haunt the screen. */
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function isDesktop() {
    return !!(window.TMADesktop && window.TMADesktop.isDesktop);
  }

  /* The disk tier is the desktop's alone — see the note at the top. */
  var persistent = isDesktop() && typeof indexedDB !== 'undefined';

  var memory = Object.create(null);

  /* Who the cache belongs to. Unknown until /me answers, and entries written
     before then are held in memory under a placeholder rather than dropped —
     the first screen paints before the account is known. */
  var accountId = null;

  var dbPromise = null;

  function openDb() {
    if (!persistent) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);

        return;
      }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      // A browser in private mode, a full disk, a corrupt profile: the portal
      // works without the disk tier, so a failure here is not an error the
      // reader should ever hear about.
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });

    return dbPromise;
  }

  function scoped(key) {
    return (accountId == null ? 'anon' : accountId) + '::' + key;
  }

  function fresh(entry) {
    return !!entry && (Date.now() - entry.at) < MAX_AGE_MS;
  }

  function readDisk(key) {
    return openDb().then(function (db) {
      if (!db) return undefined;

      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(STORE, 'readonly');
        } catch (e) {
          resolve(undefined);

          return;
        }
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(undefined); };
      });
    });
  }

  function writeDisk(entry) {
    return openDb().then(function (db) {
      if (!db) return;

      try {
        db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
      } catch (e) { /* see openDb: the disk tier is optional */ }
    });
  }

  function eachDiskKey(fn) {
    return openDb().then(function (db) {
      if (!db) return;

      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(STORE, 'readwrite');
        } catch (e) {
          resolve();

          return;
        }
        var store = tx.objectStore(STORE);
        var req = store.openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) { resolve(); return; }
          if (fn(cursor.value)) cursor.delete();
          cursor.continue();
        };
        req.onerror = function () { resolve(); };
      });
    });
  }

  /**
   * Everything held under a key prefix, as values.
   *
   * The replica's read. Records land one key per row (`files:folder:<uuid>`),
   * and a screen assembling a listing offline needs all of them — a store
   * that could only answer for keys the caller already knows would make the
   * replica write-only. Memory wins over disk for a key held in both, since
   * memory is where fresh server answers land first.
   */
  function list(prefix) {
    var start = scoped(prefix || '');
    var out = Object.create(null);

    return openDb().then(function (db) {
      if (!db) return;

      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(STORE, 'readonly');
        } catch (e) {
          resolve();

          return;
        }
        var req = tx.objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) { resolve(); return; }
          var entry = cursor.value;
          if (entry.key.indexOf(start) === 0 && fresh(entry)) out[entry.key] = entry.value;
          cursor.continue();
        };
        req.onerror = function () { resolve(); };
      });
    }).then(function () {
      Object.keys(memory).forEach(function (k) {
        if (k.indexOf(start) === 0 && fresh(memory[k])) out[k] = memory[k].value;
      });

      return Object.keys(out).map(function (k) { return out[k]; });
    });
  }

  /**
   * What is held for this key, or undefined.
   *
   * Memory answers without waiting where it can, but the signature is a
   * promise either way: a caller that had to branch on which tier answered
   * would be writing the cache's business into the screen's.
   */
  function get(key) {
    var k = scoped(key);
    var hit = memory[k];
    if (fresh(hit)) return Promise.resolve(hit.value);

    return readDisk(k).then(function (entry) {
      if (!fresh(entry)) return undefined;
      // Promoted, so a second read of the same screen does not go to disk.
      memory[k] = entry;

      return entry.value;
    });
  }

  /** The cached value if there is one, without waiting. Memory tier only. */
  function peek(key) {
    var hit = memory[scoped(key)];

    return fresh(hit) ? hit.value : undefined;
  }

  function put(key, value) {
    var entry = { key: scoped(key), at: Date.now(), value: value };
    memory[entry.key] = entry;

    return writeDisk(entry);
  }

  /** Forget everything whose key starts with `prefix` — one write invalidating
      the listings it changed. A missing prefix means the whole account. */
  function invalidate(prefix) {
    var start = scoped(prefix || '');
    Object.keys(memory).forEach(function (k) {
      if (k.indexOf(start) === 0) delete memory[k];
    });

    return eachDiskKey(function (entry) { return entry.key.indexOf(start) === 0; });
  }

  /**
   * Everything, for every account. What signing out runs.
   *
   * Not scoped: the point is to leave nothing behind, and "nothing" has to
   * include whatever was written before /me said who this was.
   */
  function clear() {
    memory = Object.create(null);

    return eachDiskKey(function () { return true; });
  }

  /**
   * Say who the cache belongs to.
   *
   * Changing account wipes what is held: the previous reader's clients are not
   * this one's to see, and a screen warmed from them would look like a
   * permissions failure rather than a cache bug.
   */
  function setAccount(id) {
    var next = id == null ? null : String(id);
    if (next === accountId) return Promise.resolve();

    var had = accountId;
    accountId = next;

    return had === null ? claimAnonymous() : clear();
  }

  /*
   * Adopt what was written before /me answered.
   *
   * The first screens do not wait for the account to be known — a directory
   * can be fetched, and cached, before /me returns. Those entries were
   * written under the anonymous scope, and once the account arrives every
   * read looks under the account's own: without this, whatever loaded in
   * that opening moment is not wrong, just permanently unfindable — a miss
   * that costs a refetch of exactly the biggest first-paint answers. Same
   * reasoning as the write queue's claimUnstamped: the requests were made
   * with this session's cookies, so what they returned belongs to whoever
   * the session turns out to be.
   */
  function claimAnonymous() {
    if (accountId == null) return Promise.resolve();

    var anon = 'anon::';
    Object.keys(memory).forEach(function (k) {
      if (k.indexOf(anon) !== 0) return;
      var entry = memory[k];
      delete memory[k];
      entry.key = accountId + '::' + k.slice(anon.length);
      memory[entry.key] = entry;
    });

    // Disk too, where there is one: re-filed under the account, and the
    // anonymous copy dropped so a later clear() has nothing to miss.
    var moved = [];
    return eachDiskKey(function (entry) {
      if (entry.key.indexOf(anon) !== 0) return false;
      moved.push({ key: accountId + '::' + entry.key.slice(anon.length), at: entry.at, value: entry.value });
      return true;
    }).then(function () {
      return Promise.all(moved.map(writeDisk));
    });
  }

  /**
   * Paint from the cache, then from the server.
   *
   * `onData(value, meta)` is called with `meta.stale` true for a cached value
   * and false for the server's. It may be called once (nothing cached) or
   * twice. The returned promise settles on the server's answer, so a caller
   * that needs certainty can still wait for it.
   *
   * The fetch runs whether or not there was a hit. A cache that skipped the
   * request when it had something would be a cache that goes out of date, and
   * the whole point of showing the stale copy is that the fresh one is coming.
   */
  function swr(key, fetcher, onData) {
    var delivered = false;

    var cached = get(key).then(function (value) {
      if (value === undefined) return;
      delivered = true;
      if (onData) onData(value, { stale: true });
    });

    return cached.then(function () {
      return fetcher();
    }).then(function (value) {
      put(key, value);
      if (onData) onData(value, { stale: false });

      return value;
    }).catch(function (err) {
      /*
       * A failed refresh over a good cached copy is not a failure the reader
       * needs to see — that is the offline case, and it is the whole point.
       * With nothing cached there is nothing to show, so the error travels.
       */
      if (delivered) return undefined;

      throw err;
    });
  }

  window.TMAStore = {
    get: get,
    peek: peek,
    list: list,
    put: put,
    swr: swr,
    invalidate: invalidate,
    clear: clear,
    setAccount: setAccount,
    /* Whether anything survives a restart. Screens use it to decide what to
       promise — "available offline" is a lie in a browser. */
    persistent: persistent,
  };
})();
