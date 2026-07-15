/*
 * TMAAvatarCropper — a small, dependency-free square photo cropper.
 *
 * The user drags to reposition and zooms (slider or wheel) inside a fixed 1:1
 * frame; on confirm we export a square JPEG. No external libraries (the portal's
 * CSP blocks them) and it injects its own styles, so it works on both the auth
 * screens and the portal shell.
 *
 *   window.TMAAvatarCropper.open(fileOrUrl, function (blob, dataUrl) { … }, onCancel)
 *
 * `blob` is a square image/jpeg ready to upload; `dataUrl` is handy for a preview.
 */
(function () {
  'use strict';
  if (window.TMAAvatarCropper) return;

  var FRAME = 288;   // on-screen crop square (px)
  var OUT = 640;     // exported square size (px) — server downsizes to its own
  var STYLE_ID = 'tma-cropper-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.tma-cropper{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.tma-cropper__backdrop{position:absolute;inset:0;background:rgba(15,23,32,.66)}' +
      '.tma-cropper__card{position:relative;background:var(--color-bg-surface,#fff);color:var(--color-text-primary,#101828);border-radius:16px;padding:20px;width:min(360px,100%);box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:16px}' +
      '.tma-cropper__title{font:600 16px/1.3 Inter,system-ui,sans-serif;margin:0}' +
      '.tma-cropper__stage{position:relative;width:' + FRAME + 'px;height:' + FRAME + 'px;max-width:100%;margin:0 auto;overflow:hidden;border-radius:50%;background:#000;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}' +
      '.tma-cropper__stage.is-drag{cursor:grabbing}' +
      '.tma-cropper__img{position:absolute;top:0;left:0;pointer-events:none;max-width:none;-webkit-user-drag:none}' +
      '.tma-cropper__ring{position:absolute;inset:0;border-radius:50%;outline:2px solid rgba(255,255,255,.85);outline-offset:-2px;pointer-events:none}' +
      '.tma-cropper__zoom{display:flex;align-items:center;gap:10px}' +
      '.tma-cropper__zoom span{opacity:.6;font:600 15px/1 Inter,system-ui,sans-serif}' +
      '.tma-cropper__zoom input{flex:1;accent-color:var(--color-primary,#03a5e9)}' +
      '.tma-cropper__hint{font:400 12px/1.4 Inter,system-ui,sans-serif;opacity:.65;margin:0;text-align:center}' +
      '.tma-cropper__actions{display:flex;justify-content:flex-end;gap:8px}' +
      '.tma-cropper__btn{font:600 14px/1 Inter,system-ui,sans-serif;padding:10px 16px;border-radius:10px;border:1px solid var(--color-border-medium,#d0d5dd);background:transparent;color:inherit;cursor:pointer}' +
      '.tma-cropper__btn--primary{background:var(--color-primary,#03a5e9);border-color:transparent;color:#fff}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function open(file, onDone, onCancel) {
    ensureStyle();
    var isUrl = typeof file === 'string';
    var url = isUrl ? file : URL.createObjectURL(file);

    var img = new Image();
    if (isUrl) img.crossOrigin = 'anonymous';
    img.onload = build;
    img.onerror = function () { revoke(); if (onCancel) onCancel(); };
    img.src = url;

    function revoke() { if (!isUrl) { try { URL.revokeObjectURL(url); } catch (e) {} } }

    var wrap, stage, imgEl, zoomEl;
    var nw, nh, baseScale, scale, ox, oy;
    var minZoom = 1, maxZoom = 4, z = 1;

    function setScale() { scale = baseScale * z; }

    function clamp() {
      var dw = nw * scale, dh = nh * scale;
      // The image must always cover the square.
      ox = Math.min(0, Math.max(FRAME - dw, ox));
      oy = Math.min(0, Math.max(FRAME - dh, oy));
    }

    function paint() {
      imgEl.style.width = (nw * scale) + 'px';
      imgEl.style.height = (nh * scale) + 'px';
      imgEl.style.left = ox + 'px';
      imgEl.style.top = oy + 'px';
    }

    function setZoom(newZ) {
      newZ = Math.max(minZoom, Math.min(maxZoom, newZ));
      // Keep the frame's centre point anchored while zooming.
      var cx = FRAME / 2, cy = FRAME / 2;
      var imgX = (cx - ox) / scale, imgY = (cy - oy) / scale;
      z = newZ; setScale();
      ox = cx - imgX * scale; oy = cy - imgY * scale;
      clamp(); paint();
      if (zoomEl) zoomEl.value = z;
    }

    function build() {
      nw = img.naturalWidth || 1;
      nh = img.naturalHeight || 1;
      baseScale = FRAME / Math.min(nw, nh);   // cover fit at zoom 1
      z = 1; setScale();
      ox = (FRAME - nw * scale) / 2;
      oy = (FRAME - nh * scale) / 2;

      wrap = document.createElement('div');
      wrap.className = 'tma-cropper';
      wrap.innerHTML =
        '<div class="tma-cropper__backdrop"></div>' +
        '<div class="tma-cropper__card" role="dialog" aria-modal="true" aria-label="Position your photo">' +
        '<h3 class="tma-cropper__title">Position your photo</h3>' +
        '<div class="tma-cropper__stage"><img class="tma-cropper__img" alt=""><span class="tma-cropper__ring"></span></div>' +
        '<div class="tma-cropper__zoom"><span aria-hidden="true">&minus;</span>' +
        '<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' +
        '<span aria-hidden="true">+</span></div>' +
        '<p class="tma-cropper__hint">Drag to reposition. Scroll or use the slider to zoom.</p>' +
        '<div class="tma-cropper__actions">' +
        '<button type="button" class="tma-cropper__btn" data-cr-cancel>Cancel</button>' +
        '<button type="button" class="tma-cropper__btn tma-cropper__btn--primary" data-cr-apply>Use photo</button>' +
        '</div></div>';
      document.body.appendChild(wrap);

      stage = wrap.querySelector('.tma-cropper__stage');
      imgEl = wrap.querySelector('.tma-cropper__img');
      zoomEl = wrap.querySelector('input[type=range]');
      imgEl.src = url;
      paint();

      var dragging = false, lastX = 0, lastY = 0;
      stage.addEventListener('pointerdown', function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        stage.classList.add('is-drag');
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      });
      stage.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        ox += e.clientX - lastX; oy += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        clamp(); paint();
      });
      function end() { dragging = false; stage.classList.remove('is-drag'); }
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
      stage.addEventListener('wheel', function (e) {
        e.preventDefault();
        setZoom(z + (e.deltaY < 0 ? 0.08 : -0.08));
      }, { passive: false });
      zoomEl.addEventListener('input', function () { setZoom(parseFloat(zoomEl.value)); });

      function cancel() { destroy(); if (onCancel) onCancel(); }
      wrap.querySelector('[data-cr-cancel]').addEventListener('click', cancel);
      wrap.querySelector('.tma-cropper__backdrop').addEventListener('click', cancel);
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-cr-apply]').addEventListener('click', apply);
    }

    function onKey(e) { if (e.key === 'Escape') { destroy(); if (onCancel) onCancel(); } }

    function destroy() {
      document.removeEventListener('keydown', onKey);
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      revoke();
    }

    function apply() {
      var canvas = document.createElement('canvas');
      canvas.width = OUT; canvas.height = OUT;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUT, OUT);
      // The frame shows a square window into the (scaled) image; map it back to
      // source pixels and paint that region into the output square.
      var sSize = FRAME / scale;
      var sx = (0 - ox) / scale;
      var sy = (0 - oy) / scale;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);

      var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      var done = function (blob) { destroy(); if (onDone) onDone(blob, dataUrl); };
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) { done(blob || dataUrlToBlob(dataUrl)); }, 'image/jpeg', 0.9);
      } else {
        done(dataUrlToBlob(dataUrl));
      }
    }
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  window.TMAAvatarCropper = { open: open };
})();
