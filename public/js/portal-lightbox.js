/*
 * TMA - Shared attachment lightbox.
 *
 * Uses the existing `.tma-portal-lightbox` chrome from portal-files.css, so it
 * looks and behaves like the File Library's and the mailbox's viewers rather
 * than introducing a third appearance. email.js and portal-files.js still carry
 * their own copies of this logic; this is the shared one for anything new, and
 * what those two should eventually collapse into.
 *
 * Items are plain objects: { name, mime, size, url, downloadUrl }
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

  function isPdf(item) {
    return ((item && item.mime) || '') === 'application/pdf';
  }

  /*
   * What to show for one item.
   *
   * Anything the browser cannot render safely gets an honest "here is what this
   * is" card rather than a viewer that appears broken. SVG is deliberately not
   * treated as an image: rendering one inline would execute any script it
   * carries, which is why the File Library excludes it from previews too.
   */
  function stage(item) {
    if (is(item, 'image/') && item.mime !== 'image/svg+xml') {
      return (
        '<img class="tma-portal-lightbox__img" src="' + esc(item.url) +
        '" alt="' + esc(item.name) + '" data-lb-zoom>'
      );
    }

    if (isPdf(item)) {
      return (
        '<iframe class="tma-portal-lightbox__frame" src="' + esc(item.url) +
        '" title="' + esc(item.name) + '"></iframe>'
      );
    }

    if (is(item, 'audio/')) {
      return (
        '<div class="tma-portal-lightbox__audio">' +
        '<img src="' + esc(iconSrc(item)) + '" alt="" width="64" height="64">' +
        '<audio src="' + esc(item.url) + '" controls autoplay></audio></div>'
      );
    }

    if (is(item, 'video/')) {
      return (
        '<video class="tma-portal-lightbox__media" src="' + esc(item.url) +
        '" controls autoplay playsinline></video>'
      );
    }

    return (
      '<div class="tma-portal-lightbox__nopreview">' +
      '<img src="' + esc(iconSrc(item)) + '" alt="" width="72" height="72">' +
      '<p class="tma-portal-lightbox__nopreview-title">' + esc(item.name) + '</p>' +
      '<p class="tma-portal-lightbox__nopreview-text">' +
      esc(formatBytes(item.size)) + ' · no in-browser preview for this file type</p>' +
      '</div>'
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
    el.className = 'tma-portal-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');

    function paint() {
      var item = items[idx];
      var many = items.length > 1;
      // Downloading is a separate URL only when the caller distinguishes them;
      // otherwise the same guarded route serves both.
      var download = item.downloadUrl || item.url;

      el.innerHTML =
        '<div class="tma-portal-lightbox__backdrop" data-lb-close></div>' +
        '<div class="tma-portal-lightbox__head">' +
        '<span class="tma-portal-lightbox__title" title="' + esc(item.name) + '">' +
        '<img src="' + esc(iconSrc(item)) + '" alt="" width="18" height="18">' +
        esc(item.name) + '</span>' +
        '<div class="tma-portal-lightbox__head-actions">' +
        (item.canDownload === false
          ? ''
          : '<a class="tma-portal-tool" data-lb-download href="' + esc(download) +
            '" download="' + esc(item.name) + '"><span>Download</span></a>') +
        '<button type="button" class="tma-portal-tool tma-portal-tool--icon" ' +
        'data-lb-close aria-label="Close"><span aria-hidden="true">×</span></button>' +
        '</div></div>' +
        (many
          ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--prev" ' +
            'data-lb-prev aria-label="Previous">‹</button>'
          : '') +
        (many
          ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--next" ' +
            'data-lb-next aria-label="Next">›</button>'
          : '') +
        '<div class="tma-portal-lightbox__stage" data-lb-stage>' + stage(item) + '</div>' +
        '<div class="tma-portal-lightbox__foot">' +
        (many ? (idx + 1) + ' of ' + items.length + ' &middot; ' : '') +
        esc(formatBytes(item.size)) + '</div>';
    }

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= items.length) return;
      idx = next;
      paint();
    }

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-close]')) return close();
      if (e.target.closest('[data-lb-prev]')) return go(-1);
      if (e.target.closest('[data-lb-next]')) return go(1);
      // Click-to-zoom: a plain toggle, enough to inspect a scan or a photo.
      var zoom = e.target.closest('[data-lb-zoom]');
      if (zoom) zoom.classList.toggle('is-zoomed');
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
  }

  window.TMAPortalLightbox = { open: open, close: close, formatBytes: formatBytes };
})();
