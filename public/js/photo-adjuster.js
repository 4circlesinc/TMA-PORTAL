/*
 * TMAPhotoAdjuster: straighten, turn, zoom and reposition a photo inside a
 * fixed square, and hand the square back.
 *
 * A passport photo is 2×2 inches, so the frame never changes shape. What
 * moves is the picture behind it: dragged to reposition, zoomed by the slider,
 * the wheel or a pinch, turned in quarter turns, and tilted a few degrees
 * either way to bring a slanted scan upright. The frame is always covered.
 * Tilting a picture inside a square uncovers the square's corners, so the
 * picture is enlarged just enough to keep them filled, the way a phone's
 * straighten tool does it; a passport photo with a white wedge in one corner
 * is not one anybody can file.
 *
 * A grid lies over the frame to line the face up against: thirds while the
 * picture is at rest, and a finer one while it is being tilted, which is the
 * moment a reader is comparing an edge with a line. Hairlines, drawn light
 * with a soft dark edge so they read on a white studio background and on a
 * dark jacket alike without sitting heavily on either.
 *
 * No library (the portal's CSP allows none), and the dialog is the portal's
 * own modal, so it wears the same chrome as every other one.
 *
 *   TMAPhotoAdjuster.open(fileOrUrl, {
 *     name: 'photo.jpg',         // what to call the result
 *     minPx: 600,                // the smallest square worth handing back
 *     start: { … },              // where a previous adjustment left off
 *     onDone: function (file, dataUrl, info) { … },
 *     onCancel: function () { … },
 *     onError: function () { … } // the picture could not be read at all
 *   })
 *
 * `file` is a square image/jpeg, `info.size` its side in pixels, and
 * `info.state` how the reader left the picture. Hand `info.state` back as
 * `start` with the SAME picture and the dialog opens where they stopped, so
 * a second look is a small correction and not the whole job again.
 * A URL has to be one this page may read the
 * bytes of: it is fetched, never drawn straight from an <img>, because a
 * picture the browser will not let a canvas read back cannot be re-cut.
 */
(function () {
  'use strict';
  if (window.TMAPhotoAdjuster) return;

  /* The longest side of the copy the dialog works on. A phone photo is twelve
     megapixels and redrawing that on every pointer move stutters; nothing the
     dialog hands back is larger than this anyway. */
  var WORK_MAX = 2400;
  /* The largest square handed back. Print needs 600; this leaves room. */
  var OUT_MAX = 2000;
  var ZOOM_MAX = 4;
  /* How far the straighten slider leans, each way. Past this it is a turn. */
  var TILT_MAX = 45;
  /* A hair over the exact fit, so rounding never shows a sliver of nothing
     along an edge of the frame. */
  var COVER = 1.002;

  function ui() { return window.TMAPortalUI; }

  function bytesOf(source) {
    if (typeof source !== 'string') return Promise.resolve(source);

    return fetch(source, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('photo');

      return res.blob();
    });
  }

  function decode(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('photo')); };
      img.src = url;
    });
  }

  /* The picture, once, on a canvas of its own. Everything after this reads
     the canvas, so the image element and its object URL can go. */
  function workingCopy(decoded) {
    var img = decoded.img;
    var nw = img.naturalWidth;
    var nh = img.naturalHeight;
    if (!nw || !nh) throw new Error('photo');

    var fit = Math.min(1, WORK_MAX / Math.max(nw, nh));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(nw * fit));
    canvas.height = Math.max(1, Math.round(nh * fit));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(decoded.url);

    return { canvas: canvas, shrunk: fit };
  }

  function open(source, opts) {
    opts = opts || {};

    bytesOf(source).then(decode).then(function (decoded) {
      build(workingCopy(decoded), opts);
    }).catch(function () {
      if (opts.onError) opts.onError();
    });
  }

  function build(work, opts) {
    var src = work.canvas;
    var w = src.width;
    var h = src.height;
    var m = Math.min(w, h);
    var minPx = opts.minPx || 600;

    /* What the reader has done to the picture. `dx`,`dy` is the point of the
       picture, measured from its own centre in its own pixels, that sits at
       the centre of the frame; kept in the picture's terms so a turn or a
       tilt leaves the reader looking at the same face. */
    var quarter = 0;
    var tilt = 0;
    var zoom = 1;
    var dx = 0;
    var dy = 0;
    /* Where a previous adjustment of this picture stopped. The position is
       kept as a share of the picture's size, so it means the same thing
       whatever size the working copy happens to be. */
    var start = opts.start || null;
    if (start) {
      quarter = ((Math.round(Number(start.quarter) || 0) % 4) + 4) % 4;
      tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, Number(start.tilt) || 0));
      zoom = Math.max(1, Math.min(ZOOM_MAX, Number(start.zoom) || 1));
      dx = (Number(start.x) || 0) * w;
      dy = (Number(start.y) || 0) * h;
    }
    var fine = false;
    var fineTimer = null;
    var settled = false;

    var host = ui().openModal({
      title: 'Adjust photo',
      cls: 'tma-photo-adjust__card',
      body:
        '<div class="tma-photo-adjust">' +
        '<div class="tma-photo-adjust__stage" data-pa-stage tabindex="0" role="img"' +
        ' aria-label="Photo. Drag to reposition, arrow keys to nudge.">' +
        '<canvas class="tma-photo-adjust__canvas" data-pa-canvas></canvas>' +
        '</div>' +
        '<label class="tma-photo-adjust__row">' +
        '<span class="tma-photo-adjust__label">Zoom</span>' +
        '<input type="range" class="tma-photo-adjust__range" data-pa-zoom' +
        ' min="1" max="' + ZOOM_MAX + '" step="0.01" value="' + zoom + '" aria-label="Zoom">' +
        '<span class="tma-photo-adjust__value" data-pa-zoom-value>100%</span>' +
        '</label>' +
        '<label class="tma-photo-adjust__row">' +
        '<span class="tma-photo-adjust__label">Straighten</span>' +
        '<input type="range" class="tma-photo-adjust__range" data-pa-tilt' +
        ' min="-' + TILT_MAX + '" max="' + TILT_MAX + '" step="0.1" value="' + tilt + '" aria-label="Straighten">' +
        '<span class="tma-photo-adjust__value" data-pa-tilt-value>0°</span>' +
        '</label>' +
        '<div class="tma-photo-adjust__turns">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-pa-turn="-1">Rotate left</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-pa-turn="1">Rotate right</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-pa-reset>Reset</button>' +
        '</div>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-pa-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-pa-apply>Use photo</button>' +
        '</div>' +
        '</div>',
    });

    var stage = host.querySelector('[data-pa-stage]');
    var canvas = host.querySelector('[data-pa-canvas]');
    var zoomEl = host.querySelector('[data-pa-zoom]');
    var zoomOut = host.querySelector('[data-pa-zoom-value]');
    var tiltEl = host.querySelector('[data-pa-tilt]');
    var tiltOut = host.querySelector('[data-pa-tilt-value]');
    var ctx = canvas.getContext('2d');
    var side = 0;
    var dpr = 1;

    /* The frame, measured rather than assumed: the dialog is narrower on a
       phone, and the picture is drawn at the device's own density so a
       hairline is a hairline on a dense screen too. */
    function measure() {
      side = Math.round(stage.clientWidth) || 320;
      dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
    }

    function angle() { return (quarter * 90 + tilt) * Math.PI / 180; }

    /* How much wider than the frame the picture has to be drawn to cover it
       at this angle: 1 when upright, √2 at 45°. */
    function spread(t) { return Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)); }

    /* Screen pixels per picture pixel. */
    function scale() { return (side * spread(angle()) / m) * zoom * COVER; }

    /*
     * Keep the frame inside the picture.
     *
     * The frame, seen from the picture, is a square turned by the angle;
     * its reach along each of the picture's own axes comes to m / (2·zoom)
     * whatever the angle, because the enlargement that covers the corners
     * (spread) is exactly what the turn adds to that reach. So the limit
     * depends on the zoom alone, and tilting never lets an edge in.
     */
    function clamp() {
      var reach = m / (2 * zoom);
      dx = Math.max(-(w / 2 - reach), Math.min(w / 2 - reach, dx));
      dy = Math.max(-(h / 2 - reach), Math.min(h / 2 - reach, dy));
    }

    function draw() {
      var t = angle();
      var s = scale();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, side, side);

      ctx.save();
      ctx.translate(side / 2, side / 2);
      ctx.rotate(t);
      ctx.scale(s, s);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, -w / 2 - dx, -h / 2 - dy);
      ctx.restore();

      grid();

      zoomOut.textContent = Math.round(zoom * 100) + '%';
      tiltOut.textContent = (Math.round(tilt * 10) / 10) + '°';
    }

    /*
     * The grid: thirds at rest, ninths while the picture is being tilted.
     *
     * Hairlines. Light, with a soft dark edge, so a line shows against a
     * white background and against dark hair without being drawn heavily
     * enough to get between the reader and the face. The finer lines are
     * fainter still; they are there to compare an edge with, not to look at.
     */
    function grid() {
      var lines = function (parts, alpha, shadow) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + alpha + ')';
        ctx.shadowColor = 'rgba(0, 0, 0, ' + shadow + ')';
        ctx.shadowBlur = 0.75 * dpr;
        ctx.beginPath();
        for (var i = 1; i < parts; i++) {
          // On the half pixel, so a one-pixel line is one pixel and not two
          // half-lit ones.
          var at = Math.round(side * i / parts) + 0.5;
          ctx.moveTo(at, 0);
          ctx.lineTo(at, side);
          ctx.moveTo(0, at);
          ctx.lineTo(side, at);
        }
        ctx.stroke();
        ctx.restore();
      };

      /*
       * Balanced, by measurement rather than by eye: a third line moves a
       * white background by about a tenth of the scale and a dark jacket by
       * about a third, where the first cut of these numbers left it all but
       * invisible on white and bright on black. The ninths are half that.
       */
      if (fine) lines(9, 0.18, 0.3);
      lines(3, 0.36, 0.6);
    }

    function showFineGrid() {
      fine = true;
      if (fineTimer) clearTimeout(fineTimer);
      fineTimer = setTimeout(function () {
        fine = false;
        if (host.isConnected) draw();
      }, 900);
    }

    function setZoom(value) {
      zoom = Math.max(1, Math.min(ZOOM_MAX, value));
      zoomEl.value = String(zoom);
      clamp();
      draw();
    }

    /* The pointer moved by this much on screen; move the picture with it. */
    function pan(px, py) {
      var t = angle();
      var s = scale();
      dx -= (Math.cos(t) * px + Math.sin(t) * py) / s;
      dy -= (-Math.sin(t) * px + Math.cos(t) * py) / s;
      clamp();
      draw();
    }

    /* ── pointer: one finger drags, two pinch ────────────────────── */
    var pointers = {};
    var pinch = null;

    function pointerList() {
      return Object.keys(pointers).map(function (id) { return pointers[id]; });
    }

    stage.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      stage.classList.add('is-dragging');
      var list = pointerList();
      pinch = list.length === 2
        ? { gap: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) || 1, zoom: zoom }
        : null;
    });

    stage.addEventListener('pointermove', function (e) {
      var held = pointers[e.pointerId];
      if (!held) return;
      var px = e.clientX - held.x;
      var py = e.clientY - held.y;
      held.x = e.clientX;
      held.y = e.clientY;

      var list = pointerList();
      if (pinch && list.length === 2) {
        var gap = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) || 1;
        setZoom(pinch.zoom * gap / pinch.gap);

        return;
      }

      pan(px, py);
    });

    function release(e) {
      delete pointers[e.pointerId];
      pinch = null;
      if (!pointerList().length) stage.classList.remove('is-dragging');
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06));
    }, { passive: false });

    stage.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 12 : 3;
      if (e.key === 'ArrowLeft') pan(step, 0);
      else if (e.key === 'ArrowRight') pan(-step, 0);
      else if (e.key === 'ArrowUp') pan(0, step);
      else if (e.key === 'ArrowDown') pan(0, -step);
      else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.06);
      else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.06);
      else return;
      e.preventDefault();
    });

    /* ── the controls ────────────────────────────────────────────── */
    zoomEl.addEventListener('input', function () { setZoom(parseFloat(zoomEl.value) || 1); });

    tiltEl.addEventListener('input', function () {
      tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, parseFloat(tiltEl.value) || 0));
      showFineGrid();
      clamp();
      draw();
    });

    Array.prototype.forEach.call(host.querySelectorAll('[data-pa-turn]'), function (btn) {
      btn.addEventListener('click', function () {
        quarter = (quarter + Number(btn.getAttribute('data-pa-turn')) + 4) % 4;
        clamp();
        draw();
      });
    });

    host.querySelector('[data-pa-reset]').addEventListener('click', function () {
      quarter = 0;
      tilt = 0;
      zoom = 1;
      dx = 0;
      dy = 0;
      tiltEl.value = '0';
      zoomEl.value = '1';
      draw();
    });

    host.querySelector('[data-pa-cancel]').addEventListener('click', function () { ui().closeModal(); });
    host.querySelector('[data-pa-apply]').addEventListener('click', apply);

    /*
     * Closed by Cancel, the X, Escape or the backdrop: all four are the
     * portal modal taking itself away, and none of them tells a caller. The
     * node leaving the page does.
     */
    var watcher = new MutationObserver(function () {
      if (host.isConnected) return;
      watcher.disconnect();
      window.removeEventListener('resize', onResize);
      if (fineTimer) clearTimeout(fineTimer);
      if (!settled && opts.onCancel) opts.onCancel();
    });
    watcher.observe(document.body, { childList: true });

    function onResize() {
      if (!host.isConnected) return;
      measure();
      draw();
    }
    window.addEventListener('resize', onResize);

    /*
     * Cut the square the frame is showing, at the picture's own detail.
     *
     * As many pixels across as the frame covers of the picture, so nothing
     * is thrown away by cutting it and nothing is invented either, held
     * between the smallest square worth filing and the largest worth
     * sending. A picture zoomed in past what it holds is enlarged to the
     * minimum: softer, but still a photo the form can take.
     */
    function apply() {
      var t = angle();
      var k = spread(t);
      var covered = (m / (k * zoom * COVER)) / work.shrunk;
      var size = Math.round(Math.max(minPx, Math.min(OUT_MAX, covered)));

      var out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      var c = out.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, size, size);
      c.translate(size / 2, size / 2);
      c.rotate(t);
      var s = (size * k / m) * zoom * COVER;
      c.scale(s, s);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, -w / 2 - dx, -h / 2 - dy);

      var name = String(opts.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      var dataUrl;
      try {
        dataUrl = out.toDataURL('image/jpeg', 0.92);
      } catch (err) {
        ui().closeModal();
        if (opts.onError) opts.onError();

        return;
      }

      var finish = function (blob) {
        var file;
        try {
          file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
        } catch (err) {
          file = blob;
        }
        settled = true;
        ui().closeModal();
        if (opts.onDone) {
          opts.onDone(file, dataUrl, {
            size: size,
            state: { quarter: quarter, tilt: tilt, zoom: zoom, x: dx / w, y: dy / h },
          });
        }
      };

      if (out.toBlob) {
        out.toBlob(function (blob) { finish(blob || blobOf(dataUrl)); }, 'image/jpeg', 0.92);
      } else {
        finish(blobOf(dataUrl));
      }
    }

    measure();
    clamp();
    draw();
  }

  function blobOf(dataUrl) {
    var parts = String(dataUrl).split(',');
    var binary = atob(parts[1] || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    return new Blob([bytes], { type: 'image/jpeg' });
  }

  window.TMAPhotoAdjuster = { open: open };
})();
