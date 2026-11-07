/*
 * TMA. The write queue.
 *
 * The other half of the offline work (docs/offline-plan.md). TMAStore lets a
 * screen paint with no network; this lets a screen be *changed* with no
 * network. A write that cannot reach the server is recorded here as an
 * intent, the screen carries on as though it had been accepted, and the
 * intent is replayed the moment there is a connection again.
 *
 * IT ALWAYS TRIES THE NETWORK FIRST
 *
 * Nothing here is in the way of a normal save. A caller posts as it always
 * did, and only reaches for the queue when the request could not be delivered
 * at all, a rejected fetch, or a browser that already knows it is offline.
 * A 422 is not a delivery failure, it is the server disagreeing, and queueing
 * it would turn "you missed a field" into a change that never lands.
 *
 * IT IS ON DISK IN A BROWSER TOO, AND THAT IS DELIBERATE
 *
 * The firm's decision was that the client book does not get written to a
 * browser's disk, and TMAStore honours that, its disk tier is the desktop
 * app alone. This queue does not, and the difference is the point: the store
 * holds a *copy* of something the server already has, so losing it costs a
 * round trip. The queue holds the only copy of work a person has done. A
 * reload, a crash or a closed laptop between the save and the reconnection
 * would silently destroy it, and "the portal ate my afternoon" is a worse
 * outcome than a few queued edits sitting in a profile until they sync. What
 * IS honoured is the scope: entries are keyed to the account that made them,
 * and a different account never sees or replays them.
 *
 * ORDER, AND WHY IT IS ABSOLUTE
 *
 * Replay is oldest-first and stops at the first entry that cannot be
 * delivered. Two edits to one application, applied out of order, leave the
 * older one winning; skipping past a blocked entry to reach a later one does
 * exactly that. So a run stops rather than steps over.
 *
 * WHAT CANNOT BE REPLAYED IS SHOWN, NOT DROPPED
 *
 * An entry the server refuses on its merits, a validation error, a record
 * that has since gone, a permission that has since been taken away, is
 * parked as `failed` and kept. Somebody has to look at it. Deleting it would
 * be the portal quietly discarding a person's work because a rule changed
 * while they were on a plane.
 *
 * Global: window.TMAQueue
 */
(function () {
  'use strict';

  var DB_NAME = 'tma-portal-queue';

  var DB_VERSION = 1;

  var STORE = 'intents';

  /* How long to wait before trying a stalled queue again, and the ceiling it
     doubles up to. Short enough that a connection coming back on its own is
     noticed within a minute; long enough that a server that is down is not
     hammered by every open tab in the firm. */
  var RETRY_MS = 5 * 1000;

  var RETRY_MAX_MS = 5 * 60 * 1000;

  /* A request that never answers must not hold the queue forever. `running`
     stays true for as long as a send is in flight, so one hung upload used to
     mean nothing behind it was ever sent again. Generous, because a queued
     filing can carry scans. */
  var REQUEST_TIMEOUT_MS = 30 * 1000;

  /* How many attempts an entry gets while the browser has a network: the
     first send and ONE automatic retry. After that it goes to the reader with
     its reason and Try again / Discard, instead of sitting on "Waiting" with
     no end and nothing to act on. Signed out, a stale token, a server error, a
     timeout and a failed connection all count. Only a browser that says it is
     offline does not: being offline is not a reason to give up. */
  var MAX_SERVER_STALLS = 2;

  var dbPromise = null;

  var accountId = null;

  /* What the last attempt learned. navigator.onLine says whether there is a
     network, not whether the server is at the end of it, a hotel wifi that
     has not been paid for is "online" and answers nothing. So a rejected
     request lowers this and a delivered one raises it, and `online()` is the
     two together. */
  var reachable = true;

  /* Set once a request actually gets an answer. The browser's own offline
     flag can stay stuck after the connection is back, and one failed send
     must not be described as having no connection when another filing just
     got an answer from the firm. */
  var reached = false;

  var running = false;

  /* Bumped when a person asks to send now. A send already in flight must not
     write over that request: its answer belongs to the attempt that started
     it, and a newer one is about to go out. */
  var attempt = 0;

  /* Set when a flush is asked for while one is already going. The one that
     is going finishes, then this runs, so a click is not thrown away. */
  var runAgain = false;

  /* A person asked to send now. That try goes out even when the browser
     still says there is no network, because that flag is often wrong and
     the click is the person saying the connection is back. */
  var forceNext = false;

  var retryTimer = null;

  var retryDelay = RETRY_MS;

  /* The last counted state, so a screen can ask without waiting. Kept in step
     by every path that changes the store below. */
  var summary = { online: true, waiting: 0, failed: 0, syncing: false };

  var listeners = [];

  function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
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
          // Auto-incrementing, because the key IS the order: replay walks the
          // store in key order and that has to be the order things happened.
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      /*
       * No disk, no queue. A private window, a full profile, a browser with
       * storage switched off: the portal still works, offline writes just are
       * not offered, which is why every caller checks `usable()` rather than
       * assuming a save can be parked.
       */
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });

    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      if (!db) return undefined;

      return new Promise(function (resolve) {
        var t;
        try {
          t = db.transaction(STORE, mode);
        } catch (e) {
          resolve(undefined);

          return;
        }
        fn(t.objectStore(STORE), resolve);
      });
    });
  }

  /** Everything queued by the signed-in account, oldest first. */
  function all() {
    return tx('readonly', function (store, resolve) {
      var out = [];
      var req = store.openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) { resolve(out); return; }
        // Somebody else's queue on a shared machine. Not this account's to
        // replay, not this account's to see.
        if (matchesAccount(cursor.value)) out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = function () { resolve(out); };
    }).then(function (out) { return out || []; });
  }

  /*
   * An entry written before /me answered belongs to whoever is signed in now.
   *
   * The alternative is losing it: the first screen can paint, and be edited,
   * before the account is known, and an entry stamped `null` that only ever
   * matched `null` would sit in the queue forever.
   */
  function matchesAccount(entry) {
    return entry.account == null || String(entry.account) === String(accountId);
  }

  function putEntry(entry) {
    return tx('readwrite', function (store, resolve) {
      var req = store.put(entry);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(undefined); };
    });
  }

  function deleteEntry(id) {
    return tx('readwrite', function (store, resolve) {
      var req = store.delete(id);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { resolve(false); };
    });
  }

  /* ── what the rest of the portal sees ───────────────────────────── */

  function browserOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function online() {
    // The sentence in the panel. A thrown send used to clear `reachable`
    // and the panel then said you were offline, including after the firm
    // had just answered. The browser flag is the only "no network" signal,
    // and a real answer overrides it when that flag is stuck.
    if (browserOnline()) return true;

    return reached;
  }

  /** Whether a write can be parked at all. False means saving needs a network. */
  function usable() {
    return typeof indexedDB !== 'undefined';
  }

  function notify() {
    var snapshot = state();
    listeners.forEach(function (fn) {
      try { fn(snapshot); } catch (e) { /* a screen's listener is its problem */ }
    });
  }

  function state() {
    return {
      online: online(),
      waiting: summary.waiting,
      failed: summary.failed,
      syncing: summary.syncing,
      pending: summary.waiting + summary.failed,
    };
  }

  function recount() {
    return all().then(function (entries) {
      summary.waiting = entries.filter(function (e) { return e.state !== 'failed'; }).length;
      summary.failed = entries.filter(function (e) { return e.state === 'failed'; }).length;
      notify();

      return entries;
    });
  }

  /**
   * Park a write.
   *
   * `intent` is the request, taken apart so it can survive a reload: a method,
   * a url, and the body as a list of parts. A part is `{name, value}` for a
   * field or `{name, file, filename}` for an upload. IndexedDB stores a Blob
   * as a Blob, so a queued scan is the actual scan and not a base64 copy of
   * it a third larger.
   *
   * `invalidate` lists the TMAStore key prefixes this write makes stale, so a
   * replay that lands hours later clears the screens it changed without the
   * queue having to know what any of them are.
   */
  function add(intent) {
    if (!usable()) return Promise.reject(new Error('no queue'));

    var entry = {
      account: accountId,
      kind: intent.kind || 'write',
      // What a person would call this change, for the "waiting to sync" list.
      // Without it the reader is told a number and a URL.
      label: intent.label || 'Change',
      method: intent.method || 'POST',
      url: intent.url,
      parts: intent.parts || [],
      invalidate: intent.invalidate || [],
      at: Date.now(),
      tries: 0,
      state: 'waiting',
      error: '',
    };

    return putEntry(entry).then(function (id) {
      if (id === undefined) throw new Error('no queue');
      entry.id = id;

      return recount().then(function () {
        // Worth a try immediately: `add` is also reached when one request
        // failed for its own reasons rather than the network being gone.
        schedule(0);

        return entry;
      });
    });
  }

  /* ── replay ─────────────────────────────────────────────────────── */

  /*
   * A file kept in the queue is a blob the browser stored on disk.
   *
   * Handing that blob straight to fetch sends an empty body, or a request
   * that never finishes. The server then says every field is missing (the
   * first of them is the service provider), and the queue stays on Waiting
   * because the send never ends. The bytes have to be copied out first.
   */
  function fileBytes(file) {
    if (!file || typeof file.arrayBuffer !== 'function') return Promise.resolve(file);

    return file.arrayBuffer().then(function (buf) {
      return new Blob([buf], { type: file.type || '' });
    }, function () {
      try { return file.slice(0, file.size, file.type || ''); }
      catch (e) { return file; }
    });
  }

  function bodyFor(entry) {
    // Rebuilt every attempt rather than stored: a FormData cannot be written
    // to disk, and its boundary is the browser's to choose anyway.
    var parts = entry.parts || [];

    return Promise.all(parts.map(function (part) {
      if (!part || !part.file) return Promise.resolve(part);

      return fileBytes(part.file).then(function (copy) {
        return {
          name: part.name,
          file: copy,
          filename: part.filename || part.file.name || 'upload',
        };
      });
    })).then(function (ready) {
      var form = new FormData();
      var files = 0;
      var declared = false;

      ready.forEach(function (part) {
        if (!part || !part.name) return;
        if (part.name === 'uploadCount') declared = true;
        if (part.file) {
          files += 1;
          form.append(part.name, part.file, part.filename || 'upload');
        } else {
          form.append(part.name, part.value == null ? '' : String(part.value));
        }
      });

      // The live save counts its files so the server can tell when some were
      // dropped. A replay has to do the same, or a short body looks complete.
      if (!declared) form.append('uploadCount', String(files));

      return form;
    });
  }

  function headers() {
    var out = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    var token = xsrf();
    if (token) out['X-XSRF-TOKEN'] = token;
    // The tab replaying a change raised the live signal for it; without this
    // it also reacts to it, and refetches what it already has.
    if (window.TMALive && window.TMALive.headers) {
      var live = window.TMALive.headers();
      Object.keys(live || {}).forEach(function (k) { out[k] = live[k]; });
    }

    return out;
  }

  function xsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    return m ? decodeURIComponent(m[1]) : '';
  }

  function invalidateFor(entry) {
    if (!window.TMAStore) return Promise.resolve();

    return Promise.all((entry.invalidate || []).map(function (prefix) {
      return window.TMAStore.invalidate(prefix);
    }));
  }

  /**
   * Send everything waiting, oldest first, stopping at the first one that
   * will not go.
   *
   * The return value is how many were applied, which is what tells a caller
   * whether it is worth saying anything to the reader.
   */
  function flush() {
    if (!usable()) return Promise.resolve(0);
    if (running) {
      runAgain = true;

      return Promise.resolve(0);
    }
    var force = forceNext;
    forceNext = false;
    /*
     * Only the browser's own "no network" skips the attempt, and a click
     * does not: the person is looking at the list and asking to send.
     * `reachable` is what the last attempt learned, and the only way to
     * unlearn it is to try again.
     */
    if (!force && !browserOnline()) return Promise.resolve(0);

    running = true;
    summary.syncing = true;
    notify();

    var applied = 0;

    return all().then(function (entries) {
      var queue = entries.filter(function (e) { return e.state !== 'failed'; });

      var step = function () {
        var entry = queue.shift();
        if (!entry) return Promise.resolve('done');

        return send(entry).then(function (result) {
          if (result === 'applied') { applied += 1; return step(); }

          // 'failed' is this entry's own problem and does not block the ones
          // behind it, nothing later depends on a change that will never
          // land. 'skipped' is an attempt a newer click replaced. Anything
          // else stopped the run.
          if (result === 'failed') return step();
          // A newer click owns the queue now. Stop this run so it cannot
          // send the same change a second time.
          if (result === 'skipped') return result;

          return result;
        });
      };

      return step();
    }).then(function (outcome) {
      running = false;
      summary.syncing = false;

      return recount().then(function () {
        if (runAgain) return applied;
        if (outcome === 'done') {
          retryDelay = RETRY_MS;
          if (summary.waiting > 0) schedule(retryDelay);
        } else {
          // Backed off: the network is gone, or the server is unwell.
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
        if (applied > 0) announce(applied);

        return applied;
      });
    }).catch(function () {
      running = false;
      summary.syncing = false;
      notify();
      if (!runAgain) {
        schedule(retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      }

      return applied;
    }).then(function (value) {
      if (!runAgain) return value;
      runAgain = false;
      if (force) forceNext = true;

      return flush().then(function () { return value; });
    });
  }

  /*
   * One entry, and what its answer means.
   *
   * Returns 'applied', 'failed' (parked for a person), or 'stop', the last
   * meaning the queue learned nothing about this entry, only that now is not
   * the time.
   */
  function deliver(entry) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var settled = false;

    // The timer covers the copy as well as the request. Aborting fetch does
    // not help when the hang is the blob read that happens before fetch, and
    // a send that never settles leaves `running` true so every later try,
    // including a click, returns without sending.
    var work = bodyFor(entry).then(function (body) {
      return fetch(entry.url, {
        method: entry.method,
        credentials: 'same-origin',
        // No Content-Type: multipart needs the browser's own boundary.
        headers: headers(),
        body: body,
        signal: controller ? controller.signal : undefined,
      });
    });

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (controller) {
          try { controller.abort(); } catch (e) { /* the request already ended */ }
        }
        var err = new Error('timeout');
        err.name = 'AbortError';
        reject(err);
      }, REQUEST_TIMEOUT_MS);

      work.then(function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /*
   * A fresh XSRF cookie. The token the queue sends is read from the cookie at
   * send time, and a tab left open past the session's rotation holds a stale
   * one: every replay then comes back 419, for ever. Any GET through the web
   * middleware sets a new cookie, and /me is the cheapest one there is.
   */
  function refreshToken() {
    return fetch((window.__TMA_SITE_ROOT || '') + '/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function () { return true; }, function () { return false; });
  }

  /*
   * The server answered, but not about this entry. Count it, keep the reason
   * where the panel can show it, and once it has happened often enough hand
   * the entry to a person rather than leave it "Waiting" with no end.
   */
  function stall(entry, reason) {
    entry.stalls = (entry.stalls || 0) + 1;
    entry.error = reason;
    if (entry.stalls >= MAX_SERVER_STALLS) {
      entry.state = 'failed';

      return putEntry(entry).then(function () { return 'failed'; });
    }

    return putEntry(entry).then(function () { return 'stop'; });
  }

  function stallReason(status) {
    if (status === 401) return 'You were signed out. Sign in again, then try again.';
    if (status === 419) return 'Your session expired. Reload the page, then try again.';
    if (status === 429) return 'The server is busy. Try again in a minute.';

    return 'The server had a problem saving this (error ' + status + ').';
  }

  function send(entry) {
    var mine = attempt;
    entry.tries += 1;

    return deliver(entry).then(function (res) {
      if (mine !== attempt) return 'skipped';
      if (res.status !== 419) return res;

      // One fresh token and one more go, before counting it against the entry.
      return refreshToken().then(function () { return deliver(entry); });
    }).then(function (res) {
      if (res === 'skipped') return res;
      if (mine !== attempt) return 'skipped';
      reachable = true;
      reached = true;

      /*
       * The session, or the server unwell. Not this change's fault, so it is
       * retried, but only so many times: see stall().
       */
      if (res.status === 401 || res.status === 419 || res.status === 429 || res.status >= 500) {
        return stall(entry, stallReason(res.status));
      }

      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          entry.state = 'failed';
          entry.error = messageFor(res.status, json);

          return putEntry(entry).then(function () { return 'failed'; });
        });
      }

      return res.json().catch(function () { return {}; }).then(function (json) {
        return deleteEntry(entry.id)
          .then(function () { return invalidateFor(entry); })
          .then(function () {
            document.dispatchEvent(new CustomEvent('tma:queue-applied', {
              detail: { kind: entry.kind, label: entry.label, response: json },
            }));

            return 'applied';
          });
      });
    }).catch(function (err) {
      if (mine !== attempt) return 'skipped';
      /*
       * Gave up waiting. The browser says there is a network, so this is the
       * server not answering in time, and it counts like any other stall,
       * otherwise an upload the server never finishes would retry for ever.
       */
      if (err && err.name === 'AbortError' && navigator.onLine !== false) {
        return stall(entry, 'The server took too long to answer.');
      }

      /*
       * The browser has a network and the send still failed: a refused
       * connection, a dropped tunnel, a scan that could not be read back off
       * the disk. Left uncounted, this was the "Waiting" that never ended and
       * never said why. It gets its one retry like everything else, then goes
       * to the reader with Try again and Discard.
       */
      if (navigator.onLine !== false) {
        return stall(entry, 'Could not send this to the server.');
      }

      // Nothing was delivered. Whether that is a dead wifi or a dropped
      // tunnel does not matter: the entry is untouched and the run stops.
      reachable = false;
      notify();

      return 'stop';
    });
  }

  function messageFor(status, json) {
    if (json && json.message) return json.message;
    if (status === 422) return 'The server would not accept this change.';
    if (status === 403 || status === 404) return 'You can no longer change this.';

    return 'This change could not be saved.';
  }

  function announce(count) {
    if (!window.TMAPortalUI || !window.TMAPortalUI.toast) return;
    window.TMAPortalUI.toast(count === 1
      ? 'Your offline change has been synced'
      : count + ' offline changes have been synced');
  }

  function schedule(ms) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      retryTimer = null;
      flush();
    }, ms);
  }

  /* ── the failed pile ────────────────────────────────────────────── */

  /** Put a parked entry back in the run, what a "Try again" button calls. */
  function retry(id) {
    return all().then(function (entries) {
      var entry = entries.filter(function (e) { return e.id === id; })[0];
      if (!entry) return false;
      entry.state = 'waiting';
      entry.error = '';
      entry.tries = 0;
      entry.stalls = 0;
      // A person asked: whatever the last attempt concluded, try now.
      // A send already in flight must not record its answer over this.
      attempt += 1;
      reachable = true;
      forceNext = true;
      retryDelay = RETRY_MS;

      return putEntry(entry)
        .then(recount)
        .then(function () { return flush(); })
        .then(function () { return true; });
    });
  }

  /** Throw one away. Only ever a person's decision, never the queue's. */
  function forget(id) {
    return deleteEntry(id).then(recount).then(function () { return true; });
  }

  /* ── account, and waking up ─────────────────────────────────────── */

  /**
   * Say who is signed in.
   *
   * Unlike the store, changing account does NOT wipe what is held: an entry
   * belongs to the person who wrote it, and if they sign back in on Monday
   * their Friday afternoon is still there. It stops being replayed, not
   * stored, and `all()` is what enforces that.
   */
  function setAccount(id) {
    var next = id == null ? null : String(id);
    if (next === accountId) return Promise.resolve();
    accountId = next;

    // Anything written before /me answered is this reader's, stamp it, so it
    // stops matching the next person to sign in on this machine.
    return claimUnstamped().then(recount).then(function () { return flush(); });
  }

  function claimUnstamped() {
    return tx('readwrite', function (store, resolve) {
      var req = store.openCursor();
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      // Moving the cursor while an update is still pending aborts the
      // transaction, and nothing here used to notice. The promise then never
      // settled, so the replay that should start when you sign in never did.
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) { finish(); return; }
        var next = function () { cursor.continue(); };
        if (cursor.value.account == null && accountId != null) {
          var entry = cursor.value;
          entry.account = accountId;
          var update = cursor.update(entry);
          update.onsuccess = next;
          update.onerror = next;
        } else {
          next();
        }
      };
      req.onerror = finish;
      if (req.transaction) {
        req.transaction.onabort = finish;
        req.transaction.oncomplete = finish;
      }
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    // Called straight away, so a screen paints the current state rather than
    // an empty one it only corrects on the next change.
    try { fn(state()); } catch (e) { /* as above */ }

    return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    };
  }

  window.addEventListener('online', function () {
    reachable = true;
    retryDelay = RETRY_MS;
    notify();
    flush();
  });

  window.addEventListener('offline', function () {
    reachable = false;
    reached = false;
    notify();
  });

  /* A tab that comes back to the front after a laptop was shut is the most
     common way a connection returns without an `online` event firing. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') flush();
  });

  window.TMAQueue = {
    add: add,
    all: all,
    flush: flush,
    retry: retry,
    forget: forget,
    state: state,
    online: online,
    usable: usable,
    onChange: onChange,
    setAccount: setAccount,
  };

  // Whatever was left from last time, before anyone asks.
  recount();
})();
