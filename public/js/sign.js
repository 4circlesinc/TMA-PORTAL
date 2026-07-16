/*
 * TMA - Public signing page.
 *
 * Standalone on purpose: this runs for people with no portal account, so it
 * shares no code with the dashboard and never touches the portal's APIs. The
 * only credential is the token in the URL.
 */
(function () {
  'use strict';

  var CFG = window.__SIGN || {};
  var TOKEN = CFG.token;
  var fields = (CFG.fields || []).slice();
  var doc = null;          // { kind, pageCount, ratios, pdf|image }
  var saveTimer = null;
  var submitting = false;

  var pagesHost = document.querySelector('[data-pages]');
  var progressEl = document.querySelector('[data-progress]');
  var finishBtn = document.querySelector('[data-finish]');
  var declineBtn = document.querySelector('[data-decline]');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function url(path) { return '/sign/' + encodeURIComponent(TOKEN) + path; }

  function post(path, body) {
    return fetch(url(path), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || 'Something went wrong. Please try again.');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ── document ─────────────────────────────────────── */

  function loadDocument() {
    if (CFG.isImage) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          doc = { kind: 'image', pageCount: 1, ratios: [img.naturalHeight / img.naturalWidth], image: img };
          resolve(doc);
        };
        img.onerror = function () { reject(new Error('Could not load the document.')); };
        img.src = url('/document');
      });
    }

    return import('/js/vendor/pdf.min.mjs').then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/js/vendor/pdf.worker.min.mjs';
      return pdfjs.getDocument({ url: url('/document'), withCredentials: true }).promise;
    }).then(function (pdf) {
      var ratios = [];
      var jobs = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        jobs.push(pdf.getPage(p).then(function (page) {
          var vp = page.getViewport({ scale: 1 });
          ratios[page.pageNumber - 1] = vp.height / vp.width;
        }));
      }
      return Promise.all(jobs).then(function () {
        doc = { kind: 'pdf', pageCount: pdf.numPages, ratios: ratios, pdf: pdf };
        return doc;
      });
    });
  }

  /* Every page is rendered up-front: a signer needs to read the whole thing
     before signing it, not just the pages that happen to hold their fields. */
  function renderPages() {
    var html = '';
    for (var i = 0; i < doc.pageCount; i++) {
      html += '<div class="sign-page" data-page="' + i + '">' +
        '<canvas class="page" data-canvas="' + i + '"></canvas>' +
        '<div class="sign-layer" data-layer="' + i + '"></div>' +
        '</div>';
    }
    pagesHost.innerHTML = html;

    for (var p = 0; p < doc.pageCount; p++) paintPage(p);
    renderFields();
  }

  function paintPage(index) {
    var canvas = pagesHost.querySelector('[data-canvas="' + index + '"]');
    if (!canvas) return Promise.resolve();

    var cssWidth = canvas.clientWidth || canvas.parentNode.clientWidth || 800;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssWidth * (doc.ratios[index] || 1.294) * dpr);

    var ctx = canvas.getContext('2d');
    if (doc.kind === 'image') {
      ctx.drawImage(doc.image, 0, 0, canvas.width, canvas.height);
      return Promise.resolve();
    }

    return doc.pdf.getPage(index + 1).then(function (page) {
      var unscaled = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: (cssWidth * dpr) / unscaled.width });
      if (canvas._task) canvas._task.cancel();
      var task = page.render({ canvasContext: ctx, viewport: viewport });
      canvas._task = task;
      return task.promise.then(function () { canvas._task = null; }, function (err) {
        canvas._task = null;
        if (!err || err.name !== 'RenderingCancelledException') throw err;
      });
    });
  }

  /* ── fields ───────────────────────────────────────── */

  function isFilled(f) {
    return f.value !== null && f.value !== undefined && f.value !== '';
  }

  function fieldInner(f) {
    if (!isFilled(f)) {
      return esc(f.label) + (f.type === 'checkbox' ? '' : '');
    }
    if (f.type === 'signature' || f.type === 'initials') {
      return '<img src="' + esc(f.value) + '" alt="' + esc(f.label) + '">';
    }
    if (f.type === 'checkbox') return '<span class="sign-field__text">✓</span>';
    return '<span class="sign-field__text">' + esc(f.value) + '</span>';
  }

  function renderFields() {
    for (var i = 0; i < doc.pageCount; i++) {
      var layer = pagesHost.querySelector('[data-layer="' + i + '"]');
      if (!layer) continue;
      var onPage = fields.filter(function (f) { return f.page === i + 1; });
      layer.innerHTML = onPage.map(function (f) {
        var cls = 'sign-field' + (isFilled(f) ? ' is-done' : (f.required ? ' is-required' : ''));
        return '<div class="' + cls + '" data-field="' + esc(f.id) + '" role="button" tabindex="0"' +
          ' aria-label="' + esc(f.label) + (f.required ? ' (required)' : ' (optional)') + '"' +
          ' style="left:' + (f.x * 100) + '%;top:' + (f.y * 100) + '%;' +
          'width:' + (f.width * 100) + '%;height:' + (f.height * 100) + '%">' +
          fieldInner(f) + '</div>';
      }).join('');
    }
    wireFields();
    updateProgress();
  }

  function wireFields() {
    pagesHost.querySelectorAll('[data-field]').forEach(function (el) {
      function open() { openField(el.getAttribute('data-field')); }
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  function fieldById(id) {
    return fields.filter(function (f) { return f.id === id; })[0];
  }

  function openField(id) {
    var f = fieldById(id);
    if (!f || f.autofilled) return; // autofilled values aren't the signer's to edit

    if (f.type === 'checkbox') {
      f.value = isFilled(f) ? null : '1';
      renderFields();
      queueSave();
      return;
    }
    if (f.type === 'signature' || f.type === 'initials') {
      openSignaturePad(f);
      return;
    }
    openTextPrompt(f);
  }

  function updateProgress() {
    var mine = fields.filter(function (f) { return !f.autofilled; });
    var required = mine.filter(function (f) { return f.required; });
    var done = required.filter(isFilled).length;
    var optionalDone = mine.filter(function (f) { return !f.required && isFilled(f); }).length;

    progressEl.textContent = required.length
      ? done + ' of ' + required.length + ' required field' + (required.length === 1 ? '' : 's') + ' complete'
      : (optionalDone ? optionalDone + ' field(s) complete' : 'Nothing required — you can finish');

    finishBtn.disabled = done < required.length;
  }

  /* Autosave: a signer who wanders off shouldn't lose their work. */
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  function save() {
    return post('/progress', { values: valuePayload() }).catch(function () {
      // Autosave is best-effort; Finish reports the real error.
    });
  }

  function valuePayload() {
    var out = {};
    fields.forEach(function (f) {
      if (f.autofilled) return;
      out[f.id] = isFilled(f) ? f.value : null;
    });
    return out;
  }

  /* ── signature capture: draw / type / upload ──────── */

  function openSignaturePad(field) {
    var mode = 'draw';
    var drawn = null;
    var host = document.createElement('div');
    host.className = 'modal';
    host.innerHTML =
      '<div class="modal__card" role="dialog" aria-modal="true" aria-label="Add your ' + esc(field.label) + '">' +
      '<div class="modal__head"><span class="modal__title">Add your ' + esc(field.label.toLowerCase()) + '</span>' +
      '<button type="button" class="btn--link" data-close>Cancel</button></div>' +
      '<div class="tabs">' +
      '<button type="button" class="tab is-active" data-mode="draw">Draw</button>' +
      '<button type="button" class="tab" data-mode="type">Type</button>' +
      '<button type="button" class="tab" data-mode="upload">Upload</button>' +
      '</div>' +
      '<div data-panel></div>' +
      '<p class="err" data-err hidden></p>' +
      '<div class="modal__foot">' +
      '<button type="button" class="btn--link" data-clear>Clear</button>' +
      '<button type="button" class="btn" data-apply disabled>Apply</button>' +
      '</div></div>';
    document.body.appendChild(host);

    var panel = host.querySelector('[data-panel]');
    var applyBtn = host.querySelector('[data-apply]');
    var errEl = host.querySelector('[data-err]');

    function fail(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    function ok() { errEl.hidden = true; }

    function setMode(next) {
      mode = next;
      drawn = null;
      applyBtn.disabled = true;
      ok();
      host.querySelectorAll('[data-mode]').forEach(function (t) {
        t.classList.toggle('is-active', t.getAttribute('data-mode') === next);
      });
      if (next === 'draw') return renderDraw();
      if (next === 'type') return renderType();
      renderUpload();
    }

    function renderDraw() {
      panel.innerHTML = '<canvas class="pad" data-pad></canvas>';
      var pad = panel.querySelector('[data-pad]');
      var dpr = window.devicePixelRatio || 1;
      // Size the bitmap to the element so strokes land under the cursor.
      pad.width = pad.clientWidth * dpr;
      pad.height = pad.clientHeight * dpr;
      var ctx = pad.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f1115';

      var drawing = false;
      var any = false;

      function pos(e) {
        var r = pad.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      pad.addEventListener('pointerdown', function (e) {
        drawing = true;
        pad.setPointerCapture(e.pointerId);
        var p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        e.preventDefault();
      });
      pad.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        any = true;
        applyBtn.disabled = false;
      });
      function end() {
        drawing = false;
        if (any) drawn = trimToPng(pad);
      }
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('pointerleave', end);
    }

    function renderType() {
      panel.innerHTML =
        '<input type="text" class="typed" data-typed placeholder="Type your name" ' +
        'value="' + esc(CFG.recipient ? CFG.recipient.name : '') + '" maxlength="60">' +
        '<div class="typed-preview" data-preview></div>';
      var input = panel.querySelector('[data-typed]');
      var preview = panel.querySelector('[data-preview]');

      function sync() {
        var v = input.value.trim();
        preview.textContent = v;
        applyBtn.disabled = !v;
        drawn = v ? textToPng(v) : null;
      }
      input.addEventListener('input', sync);
      sync();
      input.focus();
    }

    function renderUpload() {
      panel.innerHTML =
        '<div class="drop">' +
        '<input type="file" accept="image/png,image/jpeg" data-file>' +
        '<p style="margin:10px 0 0">PNG or JPG of your signature.</p>' +
        '</div><div class="typed-preview" data-preview style="display:none"></div>';
      var input = panel.querySelector('[data-file]');
      var preview = panel.querySelector('[data-preview]');

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg)$/.test(file.type)) {
          fail('Please choose a PNG or JPG image.');
          return;
        }
        if (file.size > 4 * 1024 * 1024) {
          fail('That image is too large — 4 MB maximum.');
          return;
        }
        ok();
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            // Normalise to a PNG the server will accept, and cap the size so a
            // photo doesn't become a megabyte of base64.
            drawn = imageToPng(img);
            preview.style.display = 'grid';
            preview.innerHTML = '<img src="' + drawn + '" alt="" style="max-height:80px">';
            applyBtn.disabled = false;
          };
          img.onerror = function () { fail('That image could not be read.'); };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    host.querySelectorAll('[data-mode]').forEach(function (t) {
      t.addEventListener('click', function () { setMode(t.getAttribute('data-mode')); });
    });
    host.querySelector('[data-clear]').addEventListener('click', function () { setMode(mode); });
    host.querySelector('[data-close]').addEventListener('click', close);
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    document.addEventListener('keydown', onKey);

    applyBtn.addEventListener('click', function () {
      if (!drawn) return;
      field.value = drawn;
      close();
      renderFields();
      queueSave();
    });

    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      document.removeEventListener('keydown', onKey);
      host.remove();
    }

    setMode('draw');
  }

  function openTextPrompt(field) {
    var host = document.createElement('div');
    host.className = 'modal';
    host.innerHTML =
      '<div class="modal__card" role="dialog" aria-modal="true" aria-label="' + esc(field.label) + '">' +
      '<div class="modal__head"><span class="modal__title">' + esc(field.label) + '</span>' +
      '<button type="button" class="btn--link" data-close>Cancel</button></div>' +
      '<input type="text" class="typed" data-input maxlength="500" value="' + esc(field.value || '') + '">' +
      '<div class="modal__foot"><span></span>' +
      '<button type="button" class="btn" data-apply>Apply</button></div></div>';
    document.body.appendChild(host);

    var input = host.querySelector('[data-input]');
    input.focus();

    function close() { host.remove(); }
    host.querySelector('[data-close]').addEventListener('click', close);
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    host.querySelector('[data-apply]').addEventListener('click', apply);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') close();
    });

    function apply() {
      field.value = input.value.trim() || null;
      close();
      renderFields();
      queueSave();
    }
  }

  /* ── image helpers ────────────────────────────────── */

  /* Crop a drawn signature to its ink, so the stroke fills the field box
     instead of floating in a mostly-empty canvas. */
  function trimToPng(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;

    var pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);

    var out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function textToPng(text) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var font = '64px "Segoe Script", "Brush Script MT", cursive';
    ctx.font = font;
    var w = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.width = Math.max(w, 40);
    canvas.height = 96;
    ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = '#0f1115';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }

  function imageToPng(img) {
    var max = 900;
    var scale = Math.min(1, max / img.naturalWidth);
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  /* ── finish / decline ─────────────────────────────── */

  /* Signing revokes the token, so reloading would land the signer on "this
     link isn't valid" straight after succeeding. The confirmation is rendered
     in place instead. */
  function showDone(heading, detail) {
    document.querySelector('.sign-bar').remove();
    document.querySelector('.sign-doc').innerHTML =
      '<div class="card" style="max-width:460px;margin:40px auto 0;padding:28px;text-align:center">' +
      '<div style="font-size:34px;line-height:1;margin-bottom:10px" aria-hidden="true">✓</div>' +
      '<h1>' + esc(heading) + '</h1>' +
      '<p class="sub">' + esc(detail) + '</p></div>';
    window.scrollTo(0, 0);
  }

  finishBtn.addEventListener('click', function () {
    if (submitting) return;
    submitting = true;
    finishBtn.disabled = true;
    finishBtn.textContent = 'Submitting…';
    clearTimeout(saveTimer);

    post('/submit', { values: valuePayload() })
      .then(function () {
        showDone(
          "Thanks — you're done",
          'Your signature has been recorded. You\'ll get a copy by email once everyone has signed.'
        );
      })
      .catch(function (err) {
        submitting = false;
        finishBtn.disabled = false;
        finishBtn.textContent = 'Finish';
        alert(err.message);
      });
  });

  declineBtn.addEventListener('click', function () {
    var host = document.createElement('div');
    host.className = 'modal';
    host.innerHTML =
      '<div class="modal__card" role="dialog" aria-modal="true" aria-label="Decline to sign">' +
      '<div class="modal__head"><span class="modal__title">Decline to sign</span>' +
      '<button type="button" class="btn--link" data-close>Cancel</button></div>' +
      '<p class="sub" style="margin-bottom:12px">The sender will be told, and nobody else will be able to sign this document.</p>' +
      '<input type="text" class="typed" data-reason maxlength="191" placeholder="Reason (optional)">' +
      '<div class="modal__foot"><span></span>' +
      '<button type="button" class="btn" data-confirm style="background:var(--danger)">Decline</button></div></div>';
    document.body.appendChild(host);

    function close() { host.remove(); }
    host.querySelector('[data-close]').addEventListener('click', close);
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    host.querySelector('[data-confirm]').addEventListener('click', function (e) {
      e.currentTarget.disabled = true;
      post('/decline', { reason: host.querySelector('[data-reason]').value.trim() || null })
        .then(function () {
          close();
          // Declining revokes the token too, so the same rule applies.
          showDone('You declined to sign', 'The sender has been told. You can close this page.');
        })
        .catch(function (err) { close(); alert(err.message); });
    });
  });

  /* ── boot ─────────────────────────────────────────── */

  loadDocument()
    .then(renderPages)
    .catch(function (err) {
      pagesHost.innerHTML = '<div class="card" style="padding:24px;text-align:center">' +
        '<p class="sub">' + esc(err.message || 'Could not load the document.') + '</p></div>';
    });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!doc) return;
    clearTimeout(resizeTimer);
    // Canvases are bitmap-sized from their CSS width, so a resize needs a
    // repaint or the document goes blurry.
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < doc.pageCount; i++) paintPage(i);
    }, 200);
  });
})();
