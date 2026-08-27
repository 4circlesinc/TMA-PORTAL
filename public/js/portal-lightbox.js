/*
 * TMA - Shared attachment lightbox (WhatsApp-style).
 *
 * A modern, dark, full-screen media viewer: a slim top bar with the file's
 * name and a download/close, big centered media, prev/next arrows, and a
 * thumbnail filmstrip along the bottom for stepping through a set. Used by
 * Messages, the Overview media strip, the Feed and the File Library gallery.
 *
 * The older `.tma-portal-lightbox` chrome (still used by email.js and
 * portal-files.js's own copies) is left untouched; this viewer uses its own
 * `.tma-lightbox` namespace so restyling it here does not disturb those.
 *
 * Documents render client-side: PDFs are painted page by page with pdf.js and
 * text files are fetched and shown on a white sheet. Both fetch the bytes
 * themselves, so they work against attachment routes that serve documents
 * download-only (an iframe there would trigger a download instead of a
 * preview, and Mac Safari can't be trusted to paint a PDF into an iframe at
 * all, which is why the File Library viewer moved to pdf.js too). The two
 * mounters are exported (pdfInto / textInto) so email.js's older chrome can
 * reuse them instead of keeping its iframe.
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

  function extOf(item) {
    var name = String((item && item.name) || '');
    var dot = name.lastIndexOf('.');
    return dot > -1 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function mimeOf(item) {
    return String((item && item.mime) || '').split(';')[0].trim().toLowerCase();
  }

  function isImage(item) {
    return is(item, 'image/') && (item && item.mime) !== 'image/svg+xml';
  }

  /* Uploads from mail clients and older tooling often arrive as
   * application/octet-stream, so the extension is the tiebreak there. */
  function isPdf(item) {
    var mime = mimeOf(item);
    if (mime === 'application/pdf') return true;
    if (!mime || mime === 'application/octet-stream') return extOf(item) === 'pdf';
    return false;
  }

  var TEXT_EXT = /^(txt|text|csv|tsv|md|markdown|json|log|ini|yml|yaml)$/;

  /* Previewed as fetched text on a sheet, never handed to the browser to
   * interpret, which is also why HTML and SVG stay out: shown as source
   * they'd only confuse, rendered they'd execute in our origin. */
  function isText(item) {
    var mime = mimeOf(item);
    if (mime === 'text/html' || mime === 'image/svg+xml') return false;
    if (mime.indexOf('text/') === 0) return true;
    if (mime === 'application/json' || mime === 'application/xml') return true;
    if (!mime || mime === 'application/octet-stream') return TEXT_EXT.test(extOf(item));
    return false;
  }

  /* Short human label for the subtitle line. */
  function typeLabel(item) {
    if (isImage(item)) return 'Photo';
    if (is(item, 'video/')) return 'Video';
    if (is(item, 'audio/')) return 'Audio';
    if (isPdf(item)) return 'PDF';
    var ext = extOf(item);
    return ext ? ext.toUpperCase() : 'File';
  }

  var SVG = {
    close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };

  /* pdf.js is ~1.7 MB with its worker, so it loads on first use, the same
   * lazy ESM import email.js and portal-files.js use for their viewers. */
  var pdfjsPromise = null;
  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    pdfjsPromise = import(root + '/js/vendor/pdf-loader.mjs?v=3').then(function (lib) {
      // An absolute worker URL: a path-only src is resolved against the
      // module, not the page, and that 404 leaves getDocument hanging forever.
      try {
        lib.GlobalWorkerOptions.workerSrc = new URL(root + '/js/vendor/pdf-worker.mjs', window.location.href).href;
      } catch (e) {
        lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf-worker.mjs';
      }
      return lib;
    }).catch(function (err) {
      pdfjsPromise = null; // let a later attempt retry
      throw err;
    });
    return pdfjsPromise;
  }

  /*
   * Same-origin path rather than whatever absolute URL the row carried: the
   * session cookie goes with it, and it survives APP_URL disagreeing with the
   * host in the address bar.
   */
  function pdfRequestUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.pathname + parsed.search;
    } catch (e) {
      return url;
    }
  }

  /*
   * Page one first, rather than the whole file first.
   *
   * This used to fetch every byte on the page and hand pdf.js the buffer,
   * because the old file route could not answer a Range request, so opening a
   * 40 MB scan meant waiting for all 40 MB before the first page could be
   * drawn, and the reader watched "Loading preview…" for ten seconds to look
   * at page one. The route speaks Range now (and object storage always did),
   * so pdf.js is given the URL and pulls what it needs: the trailer, the page
   * it is showing, and nothing else until the reader scrolls.
   *
   * The whole-file read is kept as the fallback. A file that is not a PDF is
   * not a PDF either way, so only a transport failure is worth a second try —
   * a proxy that strips Range, an ancient deploy, and there it is the same
   * code that always worked.
   */
  function loadPdfDocument(url) {
    var path = pdfRequestUrl(url);

    return loadPdfjs().then(function (pdfjs) {
      return pdfjs.getDocument({
        url: path,
        rangeChunkSize: 262144,
        // Only what is on screen. Without this pdf.js quietly keeps pulling
        // the rest of the document in the background, which on a long scan is
        // the very download this change exists to avoid.
        disableAutoFetch: true,
        isEvalSupported: false
      }).promise.catch(function (err) {
        var name = err && err.name;
        if (name === 'InvalidPDFException' || name === 'PasswordException' || name === 'MissingPDFException') {
          throw err;
        }

        return wholeFilePdf(pdfjs, path);
      });
    });
  }

  function wholeFilePdf(pdfjs, path) {
    return fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf' }
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('Could not load this PDF.');
      }
      return res.arrayBuffer();
    }).then(function (buf) {
      if (!buf || !buf.byteLength) {
        var empty = new Error('This file is not a valid PDF.');
        empty.name = 'InvalidPDFException';
        throw empty;
      }
      return pdfjs.getDocument({
        data: new Uint8Array(buf),
        disableRange: true,
        disableStream: true,
        useWorkerFetch: false,
        isEvalSupported: false
      }).promise;
    });
  }

  function docStatus(host, message) {
    host.innerHTML = '<p class="tma-lightbox__doc-status">' + esc(message) + '</p>';
  }

  /*
   * Paint a PDF into `host` as a scrollable stack of white pages.
   *
   * Pages are laid out immediately (page 1's aspect ratio stands in for the
   * rest so the scrollbar is honest) but only painted as they come into view,
   * which keeps a 200-page scan from melting the tab. Returns a cleanup
   * function; callers MUST run it before repainting or closing, or renders
   * land in detached DOM and the worker keeps the document alive.
   */
  function mountPdfInto(host, url) {
    var dead = false;
    var doc = null;
    var io = null;

    host.classList.add('tma-lightbox__doc');
    docStatus(host, 'Loading preview…');

    function renderPage(num, wrap) {
      if (dead || !doc) return;
      doc.getPage(num).then(function (page) {
        if (dead) return;
        var cssWidth = Math.min(host.clientWidth || 820, 900);
        var dpr = window.devicePixelRatio || 1;
        var unscaled = page.getViewport({ scale: 1 });
        var viewport = page.getViewport({ scale: Math.max(1, cssWidth * dpr) / unscaled.width });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        return page.render({ canvas: canvas, viewport: viewport }).promise
          .then(function () {
            if (dead) return;
            wrap.style.aspectRatio = '';
            wrap.innerHTML = '';
            wrap.appendChild(canvas);
          });
      }).catch(function () { /* page paint is best-effort */ });
    }

    loadPdfDocument(url)
      .then(function (pdf) {
        if (!pdf) return;
        if (dead) {
          try { pdf.destroy(); } catch (e) { /* ignore */ }
          return;
        }
        doc = pdf;
        return pdf.getPage(1).then(function (first) {
          if (dead) return;
          var unscaled = first.getViewport({ scale: 1 });
          var ratio = unscaled.width + ' / ' + unscaled.height;

          host.innerHTML = '';
          var wrappers = [];
          for (var i = 1; i <= pdf.numPages; i++) {
            var wrap = document.createElement('div');
            wrap.className = 'tma-lightbox__doc-page';
            wrap.setAttribute('data-lb-doc-page', String(i));
            wrap.style.aspectRatio = ratio;
            host.appendChild(wrap);
            wrappers.push(wrap);
          }

          if (typeof IntersectionObserver === 'function') {
            io = new IntersectionObserver(function (entries) {
              entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                io.unobserve(en.target);
                renderPage(parseInt(en.target.getAttribute('data-lb-doc-page'), 10), en.target);
              });
            }, { root: host, rootMargin: '900px 0px' });
            wrappers.forEach(function (w) { io.observe(w); });
          } else {
            wrappers.forEach(function (w, n) { renderPage(n + 1, w); });
          }
        });
      })
      .catch(function (err) {
        if (dead) return;
        // Distinguish a corrupt file from a failed fetch: "could not load"
        // sends people chasing the network when the file was never a PDF.
        docStatus(host, err && err.name === 'InvalidPDFException'
          ? 'This file is not a valid PDF.'
          : 'Could not load this PDF, download it instead.');
      });

    return function () {
      dead = true;
      if (io) {
        try { io.disconnect(); } catch (e) { /* ignore */ }
        io = null;
      }
      if (doc) {
        try { doc.destroy(); } catch (e) { /* ignore */ }
        doc = null;
      }
    };
  }

  /* Text sheets stay honest about size: past 2 MB the preview is refused
   * outright, and what does load is clipped at 200k characters, the same
   * ceiling the File Library viewer uses. Returns a cleanup function. */
  var TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
  var TEXT_PREVIEW_MAX_CHARS = 200000;

  function mountTextInto(host, url, size) {
    var dead = false;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;

    host.classList.add('tma-lightbox__doc');

    if (size && size > TEXT_PREVIEW_MAX_BYTES) {
      docStatus(host, 'Too large to preview, download it instead.');
      return function () { dead = true; };
    }

    docStatus(host, 'Loading preview…');

    fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (text) {
        if (dead) return;
        var pre = document.createElement('pre');
        pre.className = 'tma-lightbox__doc-pre';
        pre.textContent = text.length > TEXT_PREVIEW_MAX_CHARS
          ? text.slice(0, TEXT_PREVIEW_MAX_CHARS) + '\n…'
          : text;
        host.innerHTML = '';
        host.appendChild(pre);
      })
      .catch(function () {
        if (dead) return;
        docStatus(host, 'Could not load this file, download it instead.');
      });

    return function () {
      dead = true;
      if (controller) {
        try { controller.abort(); } catch (e) { /* ignore */ }
      }
    };
  }

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
      /*
       * The thumbnail first, when there is one.
       *
       * A photo off a phone is several megabytes and the stage stayed empty
       * until all of it arrived. The 400px thumbnail is already generated and
       * cached, so it lands almost at once and the reader sees their picture —
       * soft for a moment, then sharp when swapFullImage() puts the real one
       * in. Nothing is hidden: the full image is loading the whole time.
       */
      var start = item.thumbUrl || item.url;
      return (
        '<img class="tma-lightbox__img' + (item.thumbUrl ? ' is-preview' : '') +
        '" src="' + esc(start) + '" alt="' + esc(item.name) + '" decoding="async"' +
        (item.thumbUrl ? ' data-lb-full="' + esc(item.url) + '"' : '') + ' data-lb-zoom>'
      );
    }

    // Filled in after paint by mountPdfInto / mountTextInto, building a
    // string can't render a canvas.
    if (isPdf(item)) return '<div class="tma-lightbox__doc" data-lb-doc="pdf"></div>';

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

    if (isText(item)) return '<div class="tma-lightbox__doc" data-lb-doc="text"></div>';

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

  /* Replace the thumbnail with the real image once it has decoded, swapping
   * on `load` rather than on `src` means the picture never flashes empty. */
  function swapFullImage(el) {
    var img = el.querySelector('[data-lb-full]');
    if (!img) return;

    var full = img.getAttribute('data-lb-full');
    var loader = new Image();
    loader.decoding = 'async';
    loader.onload = function () {
      if (!img.isConnected) return;
      img.src = full;
      img.classList.remove('is-preview');
      img.removeAttribute('data-lb-full');
    };
    loader.src = full;
  }

  /* The next photo, fetched while this one is being looked at, so stepping
   * through a set with the arrows does not wait for the network each time. */
  function preloadNeighbours(items, idx) {
    [idx - 1, idx + 1].forEach(function (i) {
      var item = items[i];
      if (!item || !isImage(item) || !item.url) return;
      var warm = new Image();
      warm.decoding = 'async';
      warm.src = item.url;
    });
  }

  function cleanupStage() {
    if (current && current.stageCleanup) {
      current.stageCleanup();
      current.stageCleanup = null;
    }
  }

  function close() {
    if (!current) return;
    cleanupStage();
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
      cleanupStage();

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

      var docHost = el.querySelector('[data-lb-doc]');
      if (docHost && current) {
        current.stageCleanup = docHost.getAttribute('data-lb-doc') === 'pdf'
          ? mountPdfInto(docHost, item.url)
          : mountTextInto(docHost, item.url, item.size);
      }

      swapFullImage(el);
      preloadNeighbours(items, idx);
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
      if (e.target.closest('.tma-lightbox__stage') && !e.target.closest('img,video,iframe,audio,.tma-lightbox__nopreview,.tma-lightbox__doc')) {
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

    current = { el: el, onKey: onKey, overflow: overflow, stageCleanup: null };
    paint();

    // Entrance transition, added on the next frame so it animates in.
    requestAnimationFrame(function () {
      if (current && current.el === el) el.classList.add('is-open');
    });
  }

  window.TMAPortalLightbox = {
    open: open,
    close: close,
    formatBytes: formatBytes,
    pdfInto: mountPdfInto,
    pdfDocument: loadPdfDocument,
    textInto: mountTextInto,
    isPdfItem: isPdf,
    isTextItem: isText
  };
})();
