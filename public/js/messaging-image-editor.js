/*
 * TMA - Pre-send image editor for Messages.
 *
 * Opens when an image is dropped or chosen. Crop, rotate, draw, and add text,
 * then hand a finished File back to the composer. Global: window.TMAMessagingImageEditor
 */
(function () {
  'use strict';

  var active = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function close() {
    if (!active) return;
    if (active.el && active.el.parentNode) active.el.parentNode.removeChild(active.el);
    if (active.url) URL.revokeObjectURL(active.url);
    document.removeEventListener('keydown', onKey);
    active = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (active && active.onCancel) active.onCancel();
      close();
    }
  }

  function drawScene(state) {
    var canvas = state.canvas;
    var ctx = canvas.getContext('2d');
    var img = state.img;
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var rot = ((state.rotation % 360) + 360) % 360;
    var swap = rot === 90 || rot === 270;
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2);
    ctx.restore();

    // Crop overlay preview is applied on export; strokes/text drawn in screen space.
    state.strokes.forEach(function (stroke) {
      if (!stroke.points.length) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach(function (pt, i) {
        var x = pt.x * canvas.width;
        var y = pt.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    state.texts.forEach(function (t) {
      ctx.fillStyle = t.color;
      ctx.font = 'bold ' + Math.round(canvas.width * 0.04) + 'px sans-serif';
      ctx.fillText(t.value, t.x * canvas.width, t.y * canvas.height);
    });
  }

  function exportFile(state) {
    var src = state.canvas;
    var out = document.createElement('canvas');
    var crop = state.crop;
    var sx = Math.round(crop.x * src.width);
    var sy = Math.round(crop.y * src.height);
    var sw = Math.round(crop.w * src.width);
    var sh = Math.round(crop.h * src.height);
    out.width = Math.max(1, sw);
    out.height = Math.max(1, sh);
    out.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);

    return new Promise(function (resolve) {
      out.toBlob(function (blob) {
        if (!blob) {
          resolve(state.file);
          return;
        }
        var name = state.file.name.replace(/\.[^.]+$/, '') + '-edited.jpg';
        resolve(new File([blob], name, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    });
  }

  function open(file, opts) {
    opts = opts || {};
    if (!file || !/^image\//.test(file.type) || file.type === 'image/svg+xml') {
      if (opts.onDone) opts.onDone(file);
      return;
    }

    close();

    var url = URL.createObjectURL(file);
    var el = document.createElement('div');
    el.className = 'tma-msg-image-editor';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Edit image');
    el.innerHTML =
      '<div class="tma-msg-image-editor__panel">' +
      '<div class="tma-msg-image-editor__head">' +
      '<strong>Edit image</strong>' +
      '<button type="button" class="tma-msg-image-editor__icon" data-ie-close aria-label="Close">×</button>' +
      '</div>' +
      '<div class="tma-msg-image-editor__stage">' +
      '<canvas class="tma-msg-image-editor__canvas" data-ie-canvas></canvas>' +
      '</div>' +
      '<div class="tma-msg-image-editor__tools" role="toolbar">' +
      '<button type="button" data-ie-tool="draw" class="is-active">Draw</button>' +
      '<button type="button" data-ie-tool="text">Text</button>' +
      '<button type="button" data-ie-tool="crop">Crop</button>' +
      '<button type="button" data-ie-rotate>Rotate</button>' +
      '<input type="color" data-ie-color value="#e11d48" aria-label="Color">' +
      '</div>' +
      '<label class="tma-msg-image-editor__caption">Caption' +
      '<input type="text" data-ie-caption placeholder="Add a message…" maxlength="2000">' +
      '</label>' +
      '<div class="tma-msg-image-editor__foot">' +
      '<button type="button" data-ie-cancel>Cancel</button>' +
      '<button type="button" class="tma-msg-image-editor__send" data-ie-done>Attach</button>' +
      '</div></div>';

    document.body.appendChild(el);
    document.addEventListener('keydown', onKey);

    var canvas = el.querySelector('[data-ie-canvas]');
    var state = {
      el: el,
      url: url,
      file: file,
      canvas: canvas,
      img: new Image(),
      rotation: 0,
      tool: 'draw',
      color: '#e11d48',
      strokes: [],
      texts: [],
      crop: { x: 0, y: 0, w: 1, h: 1 },
      drawing: null,
      onCancel: opts.onCancel,
      onDone: opts.onDone,
    };
    active = state;

    state.img.onload = function () {
      drawScene(state);
    };
    state.img.src = url;

    el.querySelector('[data-ie-close]').addEventListener('click', function () {
      if (opts.onCancel) opts.onCancel();
      close();
    });
    el.querySelector('[data-ie-cancel]').addEventListener('click', function () {
      if (opts.onCancel) opts.onCancel();
      close();
    });
    el.querySelector('[data-ie-done]').addEventListener('click', function () {
      var caption = el.querySelector('[data-ie-caption]').value || '';
      drawScene(state);
      exportFile(state).then(function (edited) {
        if (opts.onDone) opts.onDone(edited, caption);
        close();
      });
    });
    el.querySelector('[data-ie-rotate]').addEventListener('click', function () {
      state.rotation = (state.rotation + 90) % 360;
      drawScene(state);
    });
    el.querySelector('[data-ie-color]').addEventListener('input', function (e) {
      state.color = e.target.value;
    });
    el.querySelectorAll('[data-ie-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tool = btn.getAttribute('data-ie-tool');
        el.querySelectorAll('[data-ie-tool]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });

    function pointFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
    }

    function onStart(e) {
      e.preventDefault();
      var pt = pointFromEvent(e);
      if (state.tool === 'draw') {
        state.drawing = { color: state.color, width: Math.max(2, canvas.width * 0.008), points: [pt] };
        state.strokes.push(state.drawing);
      } else if (state.tool === 'text') {
        var value = window.prompt('Text to place on the image');
        if (value) {
          state.texts.push({ value: value, x: pt.x, y: pt.y, color: state.color });
          drawScene(state);
        }
      } else if (state.tool === 'crop') {
        state.drawing = { kind: 'crop', start: pt };
      }
    }

    function onMove(e) {
      if (!state.drawing) return;
      e.preventDefault();
      var pt = pointFromEvent(e);
      if (state.drawing.points) {
        state.drawing.points.push(pt);
        drawScene(state);
      } else if (state.drawing.kind === 'crop') {
        var s = state.drawing.start;
        state.crop = {
          x: Math.min(s.x, pt.x),
          y: Math.min(s.y, pt.y),
          w: Math.abs(pt.x - s.x) || 0.01,
          h: Math.abs(pt.y - s.y) || 0.01,
        };
        drawScene(state);
        // Crop guide
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(
          state.crop.x * canvas.width,
          state.crop.y * canvas.height,
          state.crop.w * canvas.width,
          state.crop.h * canvas.height
        );
        drawScene(state);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          state.crop.x * canvas.width,
          state.crop.y * canvas.height,
          state.crop.w * canvas.width,
          state.crop.h * canvas.height
        );
      }
    }

    function onEnd() {
      state.drawing = null;
    }

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('mouseleave', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
  }

  function openMany(files, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(files || []);
    var images = list.filter(function (f) {
      return /^image\//.test(f.type) && f.type !== 'image/svg+xml';
    });
    var others = list.filter(function (f) {
      return !(/^image\//.test(f.type) && f.type !== 'image/svg+xml');
    });

    if (!images.length) {
      if (opts.onDone) opts.onDone(list, '');
      return;
    }

    var edited = others.slice();
    var caption = '';
    var i = 0;

    function next() {
      if (i >= images.length) {
        if (opts.onDone) opts.onDone(edited, caption);
        return;
      }
      open(images[i], {
        onCancel: function () {
          // Skip remaining images; keep what is already edited plus non-images.
          if (opts.onDone) opts.onDone(edited, caption);
        },
        onDone: function (file, cap) {
          edited.push(file);
          if (cap) caption = cap;
          i += 1;
          next();
        },
      });
    }

    next();
  }

  window.TMAMessagingImageEditor = { open: open, openMany: openMany, close: close };
})();
