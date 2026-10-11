/*
 * TMA - The local store.
 *
 * One read-through cache for everything the portal fetches, so a screen can
 * paint what it already knows and check with the server behind the paint. It
 * is the foundation of the offline work (docs/offline-plan.md) and, on its
 * own, the reason a folder opens now instead of in two seconds.
 *
 * THREE TIERS, AND WHY THEY DIFFER
 *
 * Memory, always. Disk (IndexedDB), only in the desktop app. That is the
 * firm's decision and it is a real one: the disk tier is what makes the portal
 * work with no network, and it is also a copy of a citizenship client's
 * personal details sitting in a browser profile. On an installed, managed
 * desktop that is a considered trade; on whatever browser somebody borrows it
 * is not. So browsers get no disk, and everything below reads `persistent`
 * rather than assuming.
 *
 * The tab (sessionStorage), in browsers only. Without it a reload started
 * every screen cold: each one had kept the answer it needed, in memory, and a
 * reload is exactly what empties memory. The mailbox kept a copy of its own in
 * sessionStorage and was the one page that opened with its data already there;
 * this is that, for everything the store holds, so the screens that already
 * paint from here (the Dashboard, the applications table, Calendar, Feed,
 * Messages, Overview, People, the File Library) do it after a reload too. It
 * is not the disk tier by another name: it belongs to one tab and goes when
 * the tab closes, signing out empties it, an entry lives for hours rather than
 * a week, and the largest answers are not kept in it at all. See THE TAB TIER.
 *
 * SCOPED TO THE ACCOUNT
 *
 * Every entry is stored under the signed-in user's id. Two accounts on one
 * machine never see each other's cache, and signing in as somebody else does
 * not warm the screen with the last person's clients, a bug that would look
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

  /* The disk tier is the desktop's alone, see the note at the top. */
  var persistent = isDesktop() && typeof indexedDB !== 'undefined';

  var memory = Object.create(null);

  /* Who the cache belongs to. Unknown until /me answers, and entries written
     before then are held in memory under a placeholder rather than dropped —
     the first screen paints before the account is known. */
  var accountId = null;

  /* ── THE TAB TIER ────────────────────────────────────────────────
   * One sessionStorage item per entry, filed under the same account-scoped
   * key as the other tiers. Reads are synchronous, which is the point: a
   * screen can have its rows before its first frame.
   */
  var SESSION_PREFIX = 'tma.store.v1::';

  /* A working day in one tab. Every screen that paints from here asks the
     server again behind the paint, so this bounds how old a first frame can
     be, not how long anything is trusted. */
  var SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

  /* An entry longer than this is not kept: the client directory is megabytes,
     and one of those would crowd everything else out of a quota of about
     five. It stays a memory-tier answer, as it was. */
  var SESSION_ENTRY_MAX_CHARS = 1000 * 1000;

  function sessionArea() {
    try {
      var area = window.sessionStorage;
      var probe = SESSION_PREFIX + 'probe';
      area.setItem(probe, '1');
      area.removeItem(probe);

      return area;
    } catch (e) {
      // Private mode, storage switched off, a sandboxed frame.
      return null;
    }
  }

  /* The desktop has the disk and does not need a second copy. */
  var tab = persistent ? null : sessionArea();

  function eachSessionKey(fn) {
    if (!tab) return;
    var keys = [];
    try {
      for (var i = 0; i < tab.length; i++) {
        var name = tab.key(i);
        if (name && name.indexOf(SESSION_PREFIX) === 0) keys.push(name);
      }
    } catch (e) { return; }
    keys.forEach(function (name) { fn(name.slice(SESSION_PREFIX.length), name); });
  }

  function dropSession(match) {
    eachSessionKey(function (key, name) {
      if (!match(key)) return;
      try { tab.removeItem(name); } catch (e) { /* nothing to drop */ }
    });
  }

  function readSession(key) {
    if (!tab) return undefined;
    try {
      var raw = tab.getItem(SESSION_PREFIX + key);
      if (!raw) return undefined;
      var held = JSON.parse(raw);
      if (!held || typeof held.at !== 'number' || (Date.now() - held.at) >= SESSION_MAX_AGE_MS) {
        tab.removeItem(SESSION_PREFIX + key);

        return undefined;
      }

      return { key: key, at: held.at, value: held.value };
    } catch (e) {
      return undefined;
    }
  }

  /*
   * Written when the browser is idle, the latest answer for a key winning.
   * Serialising a large listing is milliseconds of the main thread, and a
   * put() is made in the middle of a screen painting that very answer.
   */
  var sessionPending = Object.create(null);
  var sessionFlushQueued = false;

  function oldestSessionKeys() {
    var found = [];
    eachSessionKey(function (key, name) {
      var at = 0;
      try { at = (JSON.parse(tab.getItem(name)) || {}).at || 0; } catch (e) { /* treated as oldest */ }
      found.push({ name: name, at: at });
    });
    found.sort(function (a, b) { return a.at - b.at; });

    return found;
  }

  function writeSessionNow(entry) {
    if (!tab) return;
    var name = SESSION_PREFIX + entry.key;
    var raw;
    try {
      raw = JSON.stringify({ at: entry.at, value: entry.value });
    } catch (e) {
      return;
    }
    if (typeof raw !== 'string' || raw.length > SESSION_ENTRY_MAX_CHARS) {
      // Too large to keep, and whatever was kept for this key is now old.
      try { tab.removeItem(name); } catch (e) { /* nothing held */ }

      return;
    }
    try {
      tab.setItem(name, raw);
    } catch (e) {
      // Full. The oldest half goes, and this one gets a single second try.
      var old = oldestSessionKeys();
      old.slice(0, Math.ceil(old.length / 2)).forEach(function (item) {
        try { tab.removeItem(item.name); } catch (err) { /* already gone */ }
      });
      try { tab.setItem(name, raw); } catch (err) { /* a cold start next time */ }
    }
  }

  function flushSession() {
    sessionFlushQueued = false;
    var pending = sessionPending;
    sessionPending = Object.create(null);
    Object.keys(pending).forEach(function (key) { writeSessionNow(pending[key]); });
  }

  function writeSession(entry) {
    if (!tab) return;
    sessionPending[entry.key] = entry;
    if (sessionFlushQueued) return;
    sessionFlushQueued = true;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(flushSession, { timeout: 1500 });
    } else {
      setTimeout(flushSession, 200);
    }
  }

  if (tab) {
    /* A reload is the moment this tier exists for, and it can come before
       the browser was ever idle. Whatever is waiting is written on the way
       out. */
    window.addEventListener('pagehide', flushSession);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSession();
    });

    /*
     * The shell says who it was served to (PortalShell), so in a browser the
     * account is known before the first screen reads, and a copy kept from
     * before the reload is found on the first try. Anything in this tab that
     * is somebody else's, a second account signed in over an expired
     * session, is removed rather than left to age out.
     */
    if (window.TMABootUserId != null) {
      accountId = String(window.TMABootUserId);
      dropSession(function (key) { return key.indexOf(accountId + '::') !== 0; });
    }
  }

  /* Settles the first time the account is known. A screen that read before
     /me answered looked under the anonymous scope, where a copy kept from
     last time is not; this is how it asks again once that copy can be found. */
  var announceAccount = null;
  var accountKnown = new Promise(function (resolve) { announceAccount = resolve; });
  if (accountId !== null) announceAccount();

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
   * and a screen assembling a listing offline needs all of them, a store
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

    var kept = readSession(k);
    if (kept) {
      memory[k] = kept;

      return Promise.resolve(kept.value);
    }

    return readDisk(k).then(function (entry) {
      if (!fresh(entry)) return undefined;
      // Promoted, so a second read of the same screen does not go to disk.
      memory[k] = entry;

      return entry.value;
    });
  }

  /** The cached value if there is one, without waiting. Memory, then the tab:
      both answer at once. The disk cannot, so a desktop caller still awaits
      get(). */
  function peek(key) {
    var k = scoped(key);
    var hit = memory[k];
    if (fresh(hit)) return hit.value;

    var kept = readSession(k);
    if (!kept) return undefined;
    memory[k] = kept;

    return kept.value;
  }

  function put(key, value) {
    var entry = { key: scoped(key), at: Date.now(), value: value };
    memory[entry.key] = entry;
    writeSession(entry);

    return writeDisk(entry);
  }

  /** Forget everything whose key starts with `prefix`, one write invalidating
      the listings it changed. A missing prefix means the whole account. */
  function invalidate(prefix) {
    var start = scoped(prefix || '');
    Object.keys(memory).forEach(function (k) {
      if (k.indexOf(start) === 0) delete memory[k];
    });
    Object.keys(sessionPending).forEach(function (k) {
      if (k.indexOf(start) === 0) delete sessionPending[k];
    });
    dropSession(function (key) { return key.indexOf(start) === 0; });

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
    sessionPending = Object.create(null);
    dropSession(function () { return true; });

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

    var settled = had === null ? claimAnonymous() : clear();
    if (next !== null) settled.then(announceAccount, announceAccount);

    return settled;
  }

  /*
   * Adopt what was written before /me answered.
   *
   * The first screens do not wait for the account to be known, a directory
   * can be fetched, and cached, before /me returns. Those entries were
   * written under the anonymous scope, and once the account arrives every
   * read looks under the account's own: without this, whatever loaded in
   * that opening moment is not wrong, just permanently unfindable, a miss
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
      writeSession(entry);
    });
    Object.keys(sessionPending).forEach(function (k) {
      if (k.indexOf(anon) === 0) delete sessionPending[k];
    });
    dropSession(function (key) { return key.indexOf(anon) === 0; });

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
   * Hand a screen what was kept for it, as early as that can be done.
   *
   * For a list that draws a skeleton and then asks: call this first, and the
   * skeleton is only for a reader who has never seen the page. `paint` is
   * given the kept value at once where it can be had at once (memory, the
   * tab), which is before the first frame, and when the disk answers where it
   * is only there; `wanted` is asked again at that later moment, because the
   * server may have answered in between. Returns whether it painted now. The
   * caller still asks the server either way: this decides what is on screen
   * while it does, never what is true.
   */
  function first(key, wanted, paint) {
    var held = peek(key);
    if (held !== undefined) {
      paint(held);

      return true;
    }
    if (persistent) {
      get(key).then(function (value) {
        if (value !== undefined && (!wanted || wanted())) paint(value);
      });
    }

    return false;
  }

  /**
   * Paint from the cache, then from the server.
   *
   * `onData(value, meta)` is called with `meta.stale` true for a cached value
   * and false for the server's. It may be called once (nothing cached) or
   * twice. The returned promise settles on the server's answer, so a caller
   * that needs certainty can still wait for it.
   *
   * The fetch starts immediately, in parallel with the disk read. Waiting for
   * IndexedDB before even asking the server is how a large replica made the
   * File Library spin forever on the desktop: the listing sat behind a lock
   * held by the sync walker writing thousands of records.
   */
  function swr(key, fetcher, onData) {
    var delivered = false;
    var finished = false;

    get(key).then(function (value) {
      if (value === undefined || finished) return;
      delivered = true;
      if (onData) onData(value, { stale: true });
    });

    return fetcher().then(function (value) {
      finished = true;
      put(key, value);
      if (onData) onData(value, { stale: false });

      return value;
    }).catch(function (err) {
      finished = true;
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
    first: first,
    invalidate: invalidate,
    clear: clear,
    setAccount: setAccount,
    whenAccount: function () { return accountKnown; },
    /* Whether anything survives a restart. Screens use it to decide what to
       promise, "available offline" is a lie in a browser. */
    persistent: persistent,
    /* Whether a reload finds what was held: the disk on the desktop, the tab
       in a browser. Not a promise about a restart. */
    warm: persistent || !!tab,
  };
})();
