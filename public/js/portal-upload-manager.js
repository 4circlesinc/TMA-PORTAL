/*
 * TMA - Global upload manager + shared file API helper.
 *
 * Lives at the shell level (not inside any single view) so uploads keep going
 * while the user switches portal views. Uploads are chunked (≤ 2 GB), resume
 * after a dropped connection, and a file is only reported "completed" once the
 * server has assembled + validated + saved every chunk.
 *
 * Globals: window.TMAUpload, window.TMAFilesNet
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/files';
  var CHUNK_SIZE = 8 * 1024 * 1024;         // 8 MB
  var MAX_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GB
  var MAX_ACTIVE_JOBS = 3;
  var MAX_CHUNK_RETRIES = 5;
  var STORE_KEY = 'tma.uploads.active';

  /* ── shared network helper (also used by portal-files.js) ─────── */

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function fetchJSON(url, opts) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (opts.method && opts.method !== 'GET') headers['X-XSRF-TOKEN'] = csrf();
    // Broadcasts from these endpoints go out with toOthers(), which needs the
    // sender's socket id to know which connection to skip. Without it the
    // author's own browser receives its own event and renders the change a
    // second time, on top of the copy it already drew optimistically.
    var rt = window.TMAMessagingRealtime;
    if (rt && rt.socketId) headers['X-Socket-ID'] = rt.socketId;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(url, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign(headers, opts.headers || {}),
      body: opts.body,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || 'Request failed');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        /*
         * Any write that succeeded makes every cached file listing suspect —
         * a rename changes a row, a move changes two folders, a delete
         * changes one and the recycle bin. Naming which listings each of the
         * forty-odd write endpoints touches would be a table that is wrong
         * the first time anyone adds one; dropping the lot costs a refetch
         * of whatever the reader looks at next, which the store absorbs.
         * This is the ONE choke point every File Library write goes through
         * (uploads included, completion posts here too), which is what
         * makes the blanket rule safe to rely on.
         */
        if (opts.method && opts.method !== 'GET' && window.TMAStore) {
          // The LISTING prefix, not files: whole, the record replica under
          // files:item / files:folder and the sync cursor live beside the
          // listings, and an own write must not wipe them: the cursor is
          // exactly how the authoritative version of this write arrives.
          window.TMAStore.invalidate('files:listing:');
        }
        return data;
      });
    });
  }

  window.TMAFilesNet = {
    base: BASE,
    csrf: csrf,
    fetchJSON: fetchJSON,
    url: function (path) { return BASE + path; },
  };


  /* ── library sync panel ────────────────────────────────────────
   *
   * A corner panel that shows while a connected SharePoint library is being
   * imported, using the same chrome as the upload panel and the mailbox's sync
   * panel so all three read as one thing.
   *
   * It lives HERE, in the globally loaded script, rather than in
   * portal-files.js: an import runs for minutes and the person who started it
   * will not sit on the File Library waiting. Following them across the portal
   * is the whole point, otherwise "is it still going?" has no answer unless
   * you navigate back.
   */

  var syncPanel = null;
  var syncTimer = null;
  var syncDismissed = false;
  var syncLastBusy = false;

  /*
   * Minimised state, remembered across pages.
   *
   * The panel deliberately follows you around the portal, so a collapse that
   * reset on every navigation would be worthless, you would re-minimise it on
   * every page.
   *
   * sessionStorage rather than localStorage: it survives navigation inside the
   * tab, which is the whole requirement, and it cannot carry one person's
   * choice into the next account to sign in on a shared machine. This script is
   * loaded on every shell and has no viewer id to key a localStorage entry
   * with, so a per-account key here would silently be a shared one.
   */
  var SYNC_COLLAPSE_KEY = 'tma.fileSync.collapsed';

  function syncCollapsed() {
    try { return sessionStorage.getItem(SYNC_COLLAPSE_KEY) === '1'; } catch (e) { return false; }
  }

  function setSyncCollapsed(value) {
    try {
      if (value) sessionStorage.setItem(SYNC_COLLAPSE_KEY, '1');
      else sessionStorage.removeItem(SYNC_COLLAPSE_KEY);
    } catch (e) { /* private browsing, it still collapses for this page */ }
  }

  function syncPoll() {
    fetchJSON(BASE + '/sync-status')
      .then(function (data) { renderSyncPanel(data); })
      .catch(function () { /* never worth interrupting anyone over */ })
      .finally(function () {
        // Fast while something is happening, slow when idle. An idle portal
        // must not sit polling every few seconds for no reason.
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncPoll, syncLastBusy ? 5000 : 60000);
      });
  }

  function renderSyncPanel(data) {
    var busy = (data.connections || []).filter(function (c) { return c.status === 'syncing'; });
    var failed = (data.connections || []).filter(function (c) {
      return c.status === 'error' || c.failedItems > 0;
    });

    syncLastBusy = busy.length > 0;

    var pausedLibs = (data.connections || []).filter(function (c) { return c.importsPaused; });

    // Finished since last time: say so briefly, then get out of the way.
    if (!busy.length && !failed.length) {
      if (pausedLibs.length && !syncDismissed) {
        ensureSyncPanel();
        delete syncPanel.dataset.done;
        var p = pausedLibs[0];
        paintSyncPanel(
          (pausedLibs.length === 1 ? p.name : 'Libraries') + ' paused',
          'Resume in Settings → Background Operations.',
          false,
          false,
          null,
          true
        );
        return;
      }
      if (syncPanel && !syncPanel.dataset.done) {
        syncPanel.dataset.done = '1';
        paintSyncPanel('Library up to date', '', false, true, 100);
        setTimeout(hideSyncPanel, 4000);
      } else if (!syncPanel) {
        hideSyncPanel();
      }

      return;
    }

    if (syncDismissed && !failed.length) return;

    var title, detail, isError = false, pct = null;

    if (busy.length) {
      var c = busy[0];
      title = (c.initialImport ? 'Importing ' : 'Syncing ') + c.name;
      /*
       * Two-phase progress: structure first, then content bytes.
       *
       * Phase 1, structure: folders and file records are created from Graph's
       * delta feed. done == items mapped so far, total == folder child-count
       * sum (Graph's own figure). This finishes quickly even for 150k files.
       *
       * Phase 2, content: bytes are fetched from SharePoint on demand. When
       * structure is 100% done but contentPending > 0 the library is already
       * fully browsable; files just download on first open (or via warm-content).
       * Showing "155,629 of 155,629 items" at 100% while 140k files have no
       * bytes yet is misleading, so we surface the content phase separately.
       *
       * itemsTotal is summed from folder child counts as folders arrive, so
       * early on it can be below the items already recorded, clamp to avoid
       * "780 of 500". Once structure is complete itemsTotal converges to items.
       */
      var structureDone = c.items || 0;
      var structureTotal = c.itemsTotal ? Math.max(c.itemsTotal, structureDone) : 0;
      var contentPending = c.contentPending || 0;

      var structureComplete = structureTotal > 0 && structureDone >= structureTotal;

      if (structureComplete && contentPending > 0) {
        // Phase 2: structure is in, bytes are coming.
        detail = num(structureDone) + ' items · ' + num(contentPending) + ' files still downloading';
        // Progress bar reflects content: full structure = content at 0%, so
        // show an indeterminate bar, we don't know total bytes, only count.
        pct = null;
      } else {
        // Phase 1: still building the record structure.
        var done = structureDone;
        var total = structureTotal;
        detail = total
          ? num(done) + ' of ' + num(total) + ' items'
          : num(done) + ' items so far';
        if (total) pct = Math.max(2, Math.min(100, Math.round((done / total) * 100)));
      }
      detail += (busy.length > 1 ? ' · ' + (busy.length - 1) + ' more queued' : '');
    } else {
      isError = true;
      var f = failed[0];
      title = f.name + ', sync problem';
      detail = f.lastError ? String(f.lastError).slice(0, 110)
        : f.failedItems + ' item(s) could not sync';
      pct = 100;
    }

    ensureSyncPanel();
    delete syncPanel.dataset.done;
    paintSyncPanel(title, detail, isError, false, pct, false);
  }

  function num(value) {
    try { return Number(value).toLocaleString(); } catch (e) { return String(value); }
  }

  /*
   * Same chrome as the Outlook “Syncing email…” toast (sync-toasts.js) —
   * OneDrive mark in a pale circle, title + detail, progress track, – / ×.
   * Naked white card; no watermark collage behind the copy.
   */
  function paintSyncPanel(title, detail, isError, done, pct, paused) {
    var collapsed = syncCollapsed();
    var fillClass = 'tma-sync-toast__fill';
    var fillStyle = '';
    if (done || isError) {
      fillStyle = ' style="width:100%"';
    } else if (pct != null) {
      fillStyle = ' style="width:' + pct + '%"';
    } else if (paused) {
      fillStyle = ' style="width:0%"';
    } else {
      fillClass += ' tma-sync-toast__fill--indeterminate';
    }

    syncPanel.className = 'tma-sync-toast tma-sync-toast--visible tma-portal-sync-panel' +
      (collapsed ? ' tma-sync-toast--min is-collapsed' : '') +
      (done ? ' tma-sync-toast--done' : '') +
      (isError ? ' tma-sync-toast--error' : '') +
      (paused ? ' tma-sync-toast--paused' : '');

    syncPanel.innerHTML =
      '<span class="tma-sync-toast__icon tma-sync-toast__icon--onedrive">' +
        '<img src="' + ROOT + '/images/icons/brands/OneDrive40.svg" alt="">' +
      '</span>' +
      '<div class="tma-sync-toast__body">' +
        '<span class="tma-sync-toast__title">' + esc(title) + '</span>' +
        (detail ? '<span class="tma-sync-toast__detail">' + esc(detail) + '</span>' : '') +
        '<div class="tma-sync-toast__track"><div class="' + fillClass + '"' + fillStyle + '></div></div>' +
      '</div>' +
      '<div class="tma-sync-toast__actions">' +
        (isError
          ? '<button type="button" class="tma-sync-toast__btn" data-sync-retry ' +
            'aria-label="Retry" title="Retry">↻</button>'
          : '') +
        (done ? '' :
          '<button type="button" class="tma-sync-toast__btn" data-sync-collapse ' +
            'aria-expanded="' + (collapsed ? 'false' : 'true') + '" ' +
            'aria-label="' + (collapsed ? 'Expand' : 'Minimise') + '">–</button>') +
        '<button type="button" class="tma-sync-toast__btn" data-sync-close aria-label="Hide">×</button>' +
      '</div>';
  }

  /**
   * Upload panel stack (files only). Sync cards live in the shared
   * sync-toast host so library + Smartsheet + mail stack as one column.
   */
  function dock() {
    var el = document.querySelector('.tma-portal-dock');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tma-portal-dock';
      document.body.appendChild(el);
    }
    return el;
  }

  /* Same column as sync-toasts.js, never a second fixed corner host. */
  function syncStack() {
    if (window.TMASyncToasts && window.TMASyncToasts.host) {
      return window.TMASyncToasts.host();
    }
    var el = document.querySelector('[data-sync-toast-host]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tma-sync-toast-host';
      el.setAttribute('data-sync-toast-host', '');
      document.body.appendChild(el);
    }
    return el;
  }

  function ensureSyncPanel() {
    if (syncPanel) return syncPanel;

    syncPanel = document.createElement('div');
    syncPanel.className = 'tma-sync-toast tma-sync-toast--visible tma-portal-sync-panel';
    syncPanel.setAttribute('role', 'status');
    syncPanel.setAttribute('aria-live', 'polite');
    syncStack().appendChild(syncPanel);

    syncPanel.addEventListener('click', function (e) {
      if (e.target.closest('[data-sync-collapse]')) {
        setSyncCollapsed(!syncCollapsed());
        // Repaint from what is already on screen; waiting for the next poll
        // would leave the button feeling dead for up to five seconds.
        syncPanel.classList.toggle('is-collapsed', syncCollapsed());
        syncPanel.classList.toggle('tma-sync-toast--min', syncCollapsed());
        var toggle = syncPanel.querySelector('[data-sync-collapse]');
        if (toggle) {
          toggle.setAttribute('aria-expanded', syncCollapsed() ? 'false' : 'true');
          toggle.setAttribute('aria-label', syncCollapsed() ? 'Expand' : 'Minimise');
        }

        return;
      }
      // Clicking a minimised chip expands it again, same as sync-toasts.js.
      if (syncCollapsed() && !e.target.closest('[data-sync-close]') && !e.target.closest('[data-sync-retry]')) {
        setSyncCollapsed(false);
        syncPanel.classList.remove('is-collapsed', 'tma-sync-toast--min');
        var expandBtn = syncPanel.querySelector('[data-sync-collapse]');
        if (expandBtn) {
          expandBtn.setAttribute('aria-expanded', 'true');
          expandBtn.setAttribute('aria-label', 'Minimise');
        }
        return;
      }
      if (e.target.closest('[data-sync-close]')) {
        // Dismiss this run only, a NEW sync will show the panel again.
        syncDismissed = true;
        hideSyncPanel();

        return;
      }
      if (e.target.closest('[data-sync-retry]')) {
        fetchJSON(BASE + '/sync-status/retry', { method: 'POST', json: {} })
          .then(function () { syncDismissed = false; syncPoll(); })
          .catch(function () {});
      }
    });

    return syncPanel;
  }

  function hideSyncPanel() {
    if (syncPanel) { syncPanel.remove(); syncPanel = null; }
  }

  // Start once the page is up. Staff-only is enforced server-side: the
  // endpoint returns an empty list for a client, so nothing ever renders.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(syncPoll, 2000); });
  } else {
    setTimeout(syncPoll, 2000);
  }

  /* ── upload manager ───────────────────────────────────────────── */

  var jobs = [];        // active + finished jobs (session lifetime)
  var seq = 0;
  var panel = null;
  var collapsed = false;
  var beforeUnloadBound = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function humanSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'];
    var p = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
    var v = bytes / Math.pow(1024, p);
    return (p === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[p];
  }

  function activeJobs() {
    return jobs.filter(function (j) {
      return j.status === 'uploading' || j.status === 'processing' || j.status === 'pending' || j.status === 'paused';
    });
  }

  /* Public: add File objects to the queue for a target folder (uuid or null). */
  function add(fileList, opts) {
    opts = opts || {};
    var added = [];
    Array.prototype.forEach.call(fileList, function (file) {
      var job = {
        id: ++seq,
        file: file,
        name: file.name,
        size: file.size,
        folderId: opts.folderId || null,
        sessionId: null,
        chunkSize: CHUNK_SIZE,
        totalChunks: 0,
        received: {},           // index -> true
        confirmed: 0,           // bytes confirmed saved
        sent: 0,                // bytes for the in-flight chunk (display)
        status: 'pending',
        error: '',
        retries: 0,
        xhr: null,
        speed: 0,
        _lastBytes: 0,
        _lastTime: 0,
      };

      if (file.size > MAX_BYTES) {
        job.status = 'failed';
        job.error = 'File exceeds the 2 GB limit.';
      }
      jobs.push(job);
      added.push(job);
    });

    ensurePanel();
    collapsed = false;
    render();
    pump();
    return added;
  }

  /* Start pending jobs up to the concurrency limit. */
  function pump() {
    var running = jobs.filter(function (j) { return j.status === 'uploading' || j.status === 'processing'; }).length;
    jobs.filter(function (j) { return j.status === 'pending'; }).forEach(function (j) {
      if (running < MAX_ACTIVE_JOBS) {
        running++;
        startJob(j);
      }
    });
  }

  function startJob(job) {
    job.status = 'uploading';
    job.error = '';
    render();
    persist();

    fetchJSON(BASE + '/uploads', {
      method: 'POST',
      json: {
        filename: job.name,
        size: job.size,
        folder: job.folderId,
        chunkSize: CHUNK_SIZE,
        mime: job.file.type || null,
      },
    }).then(function (res) {
      job.sessionId = res.id;
      job.chunkSize = res.chunkSize || CHUNK_SIZE;
      job.totalChunks = res.totalChunks;
      (res.received || []).forEach(function (i) { job.received[i] = true; });
      job.confirmed = Object.keys(job.received).length * job.chunkSize;
      persist();
      uploadNextChunk(job);
    }).catch(function (err) {
      failJob(job, err.message || 'Upload could not be started.');
    });
  }

  function nextIndex(job) {
    for (var i = 0; i < job.totalChunks; i++) {
      if (!job.received[i]) return i;
    }
    return -1;
  }

  function uploadNextChunk(job) {
    if (job.status === 'paused' || job.status === 'cancelled') return;

    var index = nextIndex(job);
    if (index === -1) { completeJob(job, null, null); return; }

    var start = index * job.chunkSize;
    var end = Math.min(start + job.chunkSize, job.size);
    var blob = job.file.slice(start, end);
    var chunkBytes = end - start;

    var fd = new FormData();
    fd.append('index', index);
    fd.append('chunk', blob, job.name + '.part');

    var xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open('POST', BASE + '/uploads/' + job.sessionId + '/chunk');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('X-XSRF-TOKEN', csrf());

    xhr.upload.onprogress = function (e) {
      job.sent = e.loaded;
      tickSpeed(job, job.confirmed + e.loaded);
      renderJob(job);
    };

    xhr.onload = function () {
      job.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        job.received[index] = true;
        job.confirmed = Object.keys(job.received).length * job.chunkSize;
        if (job.confirmed > job.size) job.confirmed = job.size;
        job.sent = 0;
        job.retries = 0;
        persist();
        renderJob(job);
        uploadNextChunk(job);
      } else {
        retryChunk(job, 'Upload interrupted.');
      }
    };

    xhr.onerror = function () { job.xhr = null; retryChunk(job, 'Network interruption during upload.'); };
    xhr.onabort = function () { job.xhr = null; };

    job.status = 'uploading';
    xhr.send(fd);
  }

  function retryChunk(job, message) {
    if (job.status === 'paused' || job.status === 'cancelled') return;
    if (job.retries >= MAX_CHUNK_RETRIES) { failJob(job, message); return; }
    job.retries++;
    var delay = Math.min(1000 * Math.pow(2, job.retries), 15000);
    job.error = 'Retrying… (' + job.retries + ')';
    renderJob(job);
    setTimeout(function () {
      if (job.status !== 'cancelled' && job.status !== 'paused') {
        job.error = '';
        uploadNextChunk(job);
      }
    }, delay);
  }

  function completeJob(job, conflict, newName) {
    job.status = 'processing';
    job.error = '';
    renderJob(job);

    fetchJSON(BASE + '/uploads/' + job.sessionId + '/complete', {
      method: 'POST',
      json: { conflict: conflict, newName: newName },
    }).then(function (file) {
      job.status = 'completed';
      job.confirmed = job.size;
      job.result = file;
      clearPersist(job);
      renderJob(job);
      document.dispatchEvent(new CustomEvent('tma:upload-complete', {
        detail: { folderId: job.folderId, file: file },
      }));
      pump();
      updateBeforeUnload();
    }).catch(function (err) {
      if (err.status === 409 && err.data && err.data.conflict) {
        promptConflict(job, err.data);
      } else {
        failJob(job, err.message || 'Upload could not be completed.');
      }
    });
  }

  function promptConflict(job, info) {
    job.status = 'paused';
    renderJob(job);
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) { completeJob(job, 'keep-both', null); return; }

    ui.openModal({
      title: 'File already exists',
      body:
        '<p class="tma-portal-modal__text">A file named <strong>' + esc(info.existingName) +
        '</strong> already exists here. What would you like to do?</p>' +
        '<div class="tma-portal-conflict">' +
        '<button type="button" class="tma-no-data__btn" data-conflict="keep-both">Keep both</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-conflict="replace">Replace existing</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-conflict="rename">Rename…</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-conflict="cancel">Cancel</button>' +
        '</div>',
      onMount: function (host) {
        host.querySelectorAll('[data-conflict]').forEach(function (b) {
          b.addEventListener('click', function () {
            var choice = b.getAttribute('data-conflict');
            ui.closeModal();
            if (choice === 'cancel') { cancel(job.id); return; }
            if (choice === 'rename') {
              var name = window.prompt('New file name', info.suggestion || job.name);
              if (!name) { cancel(job.id); return; }
              completeJob(job, 'rename', name);
              return;
            }
            completeJob(job, choice, null);
          });
        });
      },
    });
  }

  function failJob(job, message) {
    job.status = 'failed';
    job.error = message || 'Upload could not be completed.';
    if (job.xhr) { try { job.xhr.abort(); } catch (e) {} job.xhr = null; }
    persist();
    renderJob(job);
    pump();
    updateBeforeUnload();
  }

  function tickSpeed(job, totalBytes) {
    var now = Date.now();
    if (!job._lastTime) { job._lastTime = now; job._lastBytes = totalBytes; return; }
    var dt = (now - job._lastTime) / 1000;
    if (dt >= 0.4) {
      var inst = (totalBytes - job._lastBytes) / dt;
      job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst;
      job._lastTime = now;
      job._lastBytes = totalBytes;
    }
  }

  /* ── controls ─────────────────────────────────────────────────── */

  function retry(id) {
    var job = byId(id); if (!job) return;
    job.retries = 0; job.error = ''; job.received = {}; job.confirmed = 0;
    job.status = 'pending';
    render(); pump();
  }

  function pause(id) {
    var job = byId(id); if (!job) return;
    if (job.status !== 'uploading') return;
    job.status = 'paused';
    if (job.xhr) { try { job.xhr.abort(); } catch (e) {} job.xhr = null; }
    renderJob(job);
  }

  function resume(id) {
    var job = byId(id); if (!job || job.status !== 'paused') return;
    job.status = 'uploading';
    renderJob(job);
    if (job.sessionId) uploadNextChunk(job); else startJob(job);
  }

  function cancel(id) {
    var job = byId(id); if (!job) return;
    job.status = 'cancelled';
    if (job.xhr) { try { job.xhr.abort(); } catch (e) {} job.xhr = null; }
    if (job.sessionId) {
      fetchJSON(BASE + '/uploads/' + job.sessionId, { method: 'DELETE' }).catch(function () {});
    }
    clearPersist(job);
    renderJob(job);
    pump();
    updateBeforeUnload();
  }

  function remove(id) {
    var job = byId(id); if (!job) return;
    if (job.status === 'uploading' || job.status === 'processing' || job.status === 'pending') return;
    jobs = jobs.filter(function (j) { return j.id !== id; });
    render();
  }

  function clearFinished() {
    jobs = jobs.filter(function (j) {
      return j.status === 'uploading' || j.status === 'processing' || j.status === 'pending' || j.status === 'paused';
    });
    render();
  }

  function byId(id) { return jobs.filter(function (j) { return j.id === id; })[0]; }

  /* ── persistence (page-refresh recovery, best effort) ─────────── */

  function persist() {
    try {
      var records = activeJobs().filter(function (j) { return j.sessionId; }).map(function (j) {
        return { session: j.sessionId, name: j.name, size: j.size, folderId: j.folderId };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch (e) {}
  }

  function clearPersist(job) { persist(); }

  /* ── panel UI ─────────────────────────────────────────────────── */

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('section');
    panel.className = 'tma-portal-upload';
    panel.setAttribute('aria-label', 'Uploads');
    dock().appendChild(panel);

    panel.addEventListener('click', function (e) {
      var t = e.target.closest('[data-upload-action]');
      if (t) {
        var action = t.getAttribute('data-upload-action');
        var id = parseInt(t.getAttribute('data-upload-id'), 10);
        if (action === 'collapse') { collapsed = !collapsed; render(); }
        else if (action === 'close') { clearFinished(); if (!activeJobs().length) hidePanel(); }
        else if (action === 'retry') retry(id);
        else if (action === 'cancel') cancel(id);
        else if (action === 'pause') pause(id);
        else if (action === 'resume') resume(id);
        else if (action === 'remove') remove(id);
      }
    });
    updateBeforeUnload();
  }

  function hidePanel() {
    if (panel) { panel.remove(); panel = null; }
  }

  function jobStatusLabel(job) {
    switch (job.status) {
      case 'pending': return 'Waiting…';
      case 'uploading': return job.error || (pct(job) + '% · ' + (job.speed ? humanSize(job.speed) + '/s' : '…'));
      case 'processing': return 'Processing…';
      case 'completed': return 'Completed';
      case 'failed': return job.error || 'Failed';
      case 'cancelled': return 'Cancelled';
      case 'paused': return 'Paused';
      default: return '';
    }
  }

  function pct(job) {
    if (!job.size) return job.status === 'completed' ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((job.confirmed / job.size) * 100)));
  }

  function jobHTML(job) {
    var p = pct(job);
    var state = job.status;
    var actions = '';
    if (state === 'uploading') actions =
      '<button type="button" class="tma-portal-upload__act" data-upload-action="pause" data-upload-id="' + job.id + '" aria-label="Pause">Pause</button>' +
      '<button type="button" class="tma-portal-upload__act" data-upload-action="cancel" data-upload-id="' + job.id + '" aria-label="Cancel">✕</button>';
    else if (state === 'paused') actions =
      '<button type="button" class="tma-portal-upload__act" data-upload-action="resume" data-upload-id="' + job.id + '">Resume</button>' +
      '<button type="button" class="tma-portal-upload__act" data-upload-action="cancel" data-upload-id="' + job.id + '" aria-label="Cancel">✕</button>';
    else if (state === 'failed') actions =
      '<button type="button" class="tma-portal-upload__act" data-upload-action="retry" data-upload-id="' + job.id + '">Retry</button>' +
      '<button type="button" class="tma-portal-upload__act" data-upload-action="remove" data-upload-id="' + job.id + '" aria-label="Remove">✕</button>';
    else if (state === 'completed' || state === 'cancelled') actions =
      '<button type="button" class="tma-portal-upload__act" data-upload-action="remove" data-upload-id="' + job.id + '" aria-label="Remove">✕</button>';
    else if (state === 'processing' || state === 'pending') actions =
      '<button type="button" class="tma-portal-upload__act" data-upload-action="cancel" data-upload-id="' + job.id + '" aria-label="Cancel">✕</button>';

    return '<li class="tma-portal-upload__item tma-portal-upload__item--' + state + '" data-upload-item="' + job.id + '">' +
      '<div class="tma-portal-upload__row">' +
      '<span class="tma-portal-upload__name" title="' + esc(job.name) + '">' + esc(job.name) + '</span>' +
      '<span class="tma-portal-upload__actions">' + actions + '</span>' +
      '</div>' +
      '<div class="tma-portal-upload__bar"><span class="tma-portal-upload__fill" style="width:' + p + '%"></span></div>' +
      '<div class="tma-portal-upload__meta">' +
      '<span>' + esc(jobStatusLabel(job)) + '</span>' +
      '<span>' + humanSize(job.size) + '</span>' +
      '</div></li>';
  }

  function render() {
    if (!panel) { if (jobs.length) ensurePanel(); else return; }
    if (!jobs.length) { hidePanel(); return; }

    var active = activeJobs().length;
    var done = jobs.filter(function (j) { return j.status === 'completed'; }).length;
    var title = active > 0 ? ('Uploading ' + active + ' file' + (active === 1 ? '' : 's')) :
      (done + ' upload' + (done === 1 ? '' : 's') + ' complete');

    panel.innerHTML =
      '<header class="tma-portal-upload__head">' +
      '<span class="tma-portal-upload__title">' + esc(title) + '</span>' +
      '<span class="tma-portal-upload__head-actions">' +
      '<button type="button" class="tma-portal-upload__icon" data-upload-action="collapse" aria-label="' + (collapsed ? 'Expand' : 'Collapse') + '">' + (collapsed ? '▲' : '▼') + '</button>' +
      '<button type="button" class="tma-portal-upload__icon" data-upload-action="close" aria-label="Close">✕</button>' +
      '</span></header>' +
      (collapsed ? '' : '<ul class="tma-portal-upload__list">' + jobs.map(jobHTML).join('') + '</ul>');

    updateBeforeUnload();
  }

  /* Cheap single-item update during progress to avoid full re-render churn. */
  function renderJob(job) {
    if (!panel || collapsed) { render(); return; }
    var el = panel.querySelector('[data-upload-item="' + job.id + '"]');
    if (!el) { render(); return; }
    var tmp = document.createElement('div');
    tmp.innerHTML = jobHTML(job);
    el.replaceWith(tmp.firstChild);
    // Refresh header counts occasionally.
    var head = panel.querySelector('.tma-portal-upload__title');
    if (head) {
      var active = activeJobs().length;
      head.textContent = active > 0 ? ('Uploading ' + active + ' file' + (active === 1 ? '' : 's')) :
        (jobs.filter(function (j) { return j.status === 'completed'; }).length + ' upload(s) complete');
    }
  }

  function updateBeforeUnload() {
    if (beforeUnloadBound) return;
    beforeUnloadBound = true;
    window.addEventListener('beforeunload', function (e) {
      if (activeJobs().length > 0) {
        e.preventDefault();
        e.returnValue = 'Uploads are still in progress. Leave anyway?';
        return e.returnValue;
      }
    });
  }

  window.TMAUpload = {
    // Exported so the mailbox panel can join the same stack: three panels
    // that each pinned themselves to the corner is how they ended up
    // overlapping and needing hand-measured offsets to escape each other.
    dock: dock,
    add: add,
    cancel: cancel,
    retry: retry,
    pause: pause,
    resume: resume,
    activeCount: function () { return activeJobs().length; },
  };
})();
