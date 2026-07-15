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
    document.body.appendChild(panel);

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
    add: add,
    cancel: cancel,
    retry: retry,
    pause: pause,
    resume: resume,
    activeCount: function () { return activeJobs().length; },
  };
})();
