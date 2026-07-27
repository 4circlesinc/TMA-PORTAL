/*
 * TMA - Shared attachment lightbox (WhatsApp-style).
 *
 * A modern, dark, full-screen media viewer: a slim top bar with the file's
 * name and a download/close, big centered media, prev/next arrows, and a
 * thumbnail filmstrip along the bottom for stepping through a set. Used by
 * Messages, the Overview media strip and the File Library gallery.
 *
 * The older `.tma-portal-lightbox` chrome (still used by email.js and
 * portal-files.js's own copies) is left untouched; this viewer uses its own
 * `.tma-lightbox` namespace so restyling it here does not disturb those.
 *
 * Items are plain objects: { name, mime, size, url, downloadUrl, thumbUrl,
 *                            canDownload }
 *
 * Global: window.TMAPortalLightbox
 */
(function () {
  'use strict';

  var current = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do {
      n /= 1024;
      i += 1;
    } while (n >= 1024 && i < units.length - 1);
    return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + units[i];
  }

  function iconSrc(item) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(null, item.name);
    return '';
  }

  function is(item, prefix) {
    return String((item && item.mime) || '').indexOf(prefix) === 0;
  }

  function isImage(item) {
    return is(item, 'image/') && (item && item.mime) !== 'image/svg+xml';
  }

  function isPdf(item) {
    return ((item && item.mime) || '') === 'application/pdf';
  }

  /* Short human label for the subtitle line. */
  function typeLabel(item) {
    if (isImage(item)) return 'Photo';
    if (is(item, 'video/')) return 'Video';
    if (is(item, 'audio/')) return 'Audio';
    if (isPdf(item)) return 'PDF';
    var name = String((item && item.name) || '');
    var dot = name.lastIndexOf('.');
    if (dot > -1 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
    return 'File';
  }

  var SVG = {
    close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };

  /*
   * What to show for one item in the main stage.
   *
   * Anything the browser cannot render safely gets an honest "here is what this
   * is" card rather than a viewer that appears broken. SVG is deliberately not
   * treated as an image: rendering one inline would execute any script it
   * carries, which is why the File Library excludes it from previews too.
   */
  function stage(item) {
    if (isImage(item)) {
      return (
        '<img class="tma-lightbox__img" src="' + esc(item.url) +
        '" alt="' + esc(item.name) + '" data-lb-zoom>'
      );
    }

    if (isPdf(item)) {
      return (
        '<iframe class="tma-lightbox__frame" src="' + esc(item.url) +
        '" title="' + esc(item.name) + '"></iframe>'
      );
    }

    if (is(item, 'audio/')) {
      return (
        '<div class="tma-lightbox__audio">' +
        '<img src="' + esc(iconSrc(item)) + '" alt="" width="64" height="64">' +
        '<audio src="' + esc(item.url) + '" controls autoplay></audio></div>'
      );
    }

    if (is(item, 'video/')) {
      return (
        '<video class="tma-lightbox__media" src="' + esc(item.url) +
        '" controls autoplay playsinline></video>'
      );
    }

    return (
      '<div class="tma-lightbox__nopreview">' +
      '<img src="' + esc(iconSrc(item)) + '" alt="" width="72" height="72">' +
      '<p class="tma-lightbox__nopreview-title">' + esc(item.name) + '</p>' +
      '<p class="tma-lightbox__nopreview-text">' +
      esc(formatBytes(item.size)) + ' · no in-browser preview for this file type</p>' +
      '</div>'
    );
  }

  /* One filmstrip thumbnail. */
  function thumb(item, i, activeIdx) {
    var inner;
    if (isImage(item)) {
      inner = '<img src="' + esc(item.thumbUrl || item.url) + '" alt="" loading="lazy">';
    } else if (is(item, 'video/')) {
      inner = '<span class="tma-lightbox__thumb-play">' + SVG.play + '</span>';
    } else {
      inner = '<img class="tma-lightbox__thumb-icon" src="' + esc(iconSrc(item)) + '" alt="">';
    }
    return (
      '<button type="button" class="tma-lightbox__thumb' + (i === activeIdx ? ' is-active' : '') +
      '" data-lb-thumb="' + i + '" aria-label="' + esc(item.name) + '"' +
      (i === activeIdx ? ' aria-current="true"' : '') + '>' + inner + '</button>'
    );
  }

  function close() {
    if (!current) return;
    if (current.el.parentNode) current.el.parentNode.removeChild(current.el);
    document.body.style.overflow = current.overflow || '';
    document.removeEventListener('keydown', current.onKey);
    current = null;
  }

  function open(items, index) {
    if (!items || !items.length) return;
    close();

    var idx = Math.max(0, Math.min(index || 0, items.length - 1));

    var el = document.createElement('div');
    el.className = 'tma-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');

    function paint() {
      var item = items[idx];
      var many = items.length > 1;
      // Downloading is a separate URL only when the caller distinguishes them;
      // otherwise the same guarded route serves both.
      var download = item.downloadUrl || item.url;
      var subtitle = typeLabel(item) +
        (item.size ? ' · ' + formatBytes(item.size) : '') +
        (many ? ' · ' + (idx + 1) + ' of ' + items.length : '');

      var strip = many
        ? '<div class="tma-lightbox__filmstrip" data-lb-strip>' +
          items.map(function (it, i) { return thumb(it, i, idx); }).join('') +
          '</div>'
        : '';

      el.innerHTML =
        '<div class="tma-lightbox__backdrop" data-lb-close></div>' +
        '<div class="tma-lightbox__bar">' +
        '<button type="button" class="tma-lightbox__icon-btn" data-lb-close aria-label="Close">' + SVG.close + '</button>' +
        '<div class="tma-lightbox__meta">' +
        '<span class="tma-lightbox__title" title="' + esc(item.name) + '">' + esc(item.name) + '</span>' +
        '<span class="tma-lightbox__subtitle">' + esc(subtitle) + '</span>' +
        '</div>' +
        '<div class="tma-lightbox__actions">' +
        (item.canDownload === false
          ? ''
          : '<a class="tma-lightbox__icon-btn" data-lb-download href="' + esc(download) +
            '" download="' + esc(item.name) + '" aria-label="Download">' + SVG.download + '</a>') +
        '</div>' +
        '</div>' +
        (many
          ? '<button type="button" class="tma-lightbox__nav tma-lightbox__nav--prev"' +
            (idx <= 0 ? ' disabled' : '') + ' data-lb-prev aria-label="Previous">' + SVG.prev + '</button>' +
            '<button type="button" class="tma-lightbox__nav tma-lightbox__nav--next"' +
            (idx >= items.length - 1 ? ' disabled' : '') + ' data-lb-next aria-label="Next">' + SVG.next + '</button>'
          : '') +
        '<div class="tma-lightbox__stage" data-lb-stage>' + stage(item) + '</div>' +
        strip;
    }

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= items.length) return;
      idx = next;
      paint();
    }

    function jump(to) {
      if (to < 0 || to >= items.length || to === idx) return;
      idx = to;
      paint();
    }

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-download]')) return; // let the browser handle it
      if (e.target.closest('[data-lb-prev]')) return go(-1);
      if (e.target.closest('[data-lb-next]')) return go(1);
      var t = e.target.closest('[data-lb-thumb]');
      if (t) return jump(parseInt(t.getAttribute('data-lb-thumb'), 10));
      // Click-to-zoom: a plain toggle, enough to inspect a scan or a photo.
      var zoom = e.target.closest('[data-lb-zoom]');
      if (zoom) { zoom.classList.toggle('is-zoomed'); return; }
      if (e.target.closest('[data-lb-close]')) return close();
      // A click on the empty backdrop (the stage margins) also closes.
      if (e.target.closest('.tma-lightbox__stage') && !e.target.closest('img,video,iframe,audio,.tma-lightbox__nopreview')) {
        return close();
      }
    });

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }

    document.body.appendChild(el);
    var overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);

    current = { el: el, onKey: onKey, overflow: overflow };
    paint();

    // Entrance transition — added on the next frame so it animates in.
    requestAnimationFrame(function () {
      if (current && current.el === el) el.classList.add('is-open');
    });
  }

  window.TMAPortalLightbox = { open: open, close: close, formatBytes: formatBytes };
})();
