/*
 * TMA - Real thumbnails for file rows, everywhere.
 *
 * Two jobs, one module, so every list in the portal shows the same thing for
 * the same file:
 *
 *   1. Images. The server generates those (Thumbnail.php, GD) and every
 *      listing already carries `thumbUrl`; this is just the one place that
 *      decides between a real preview and a type icon, and the one fallback
 *      when a thumbnail can't be produced.
 *
 *   2. PDFs. The stack has no imagick/ghostscript, so the server cannot
 *      rasterise a page and `thumbUrl` is null for every document. pdf.js is
 *      already on the page for the viewer, so page one is painted HERE, in the
 *      browser, and swapped in over the type icon.
 *
 * What keeps that from being expensive:
 *
 *   - Nothing is fetched until the row is on screen (IntersectionObserver),
 *     so a folder of 300 PDFs costs whatever is in the viewport.
 *   - Two renders at a time. The rest queue.
 *   - pdf.js is handed the URL with Range enabled (TMAPortalLightbox.
 *     pdfDocument), so a 40 MB scan costs the few hundred KB page one needs,
 *     and the document is destroyed the moment the thumbnail exists.
 *   - Results are cached by URL for the life of the page. The portal
 *     re-renders these lists constantly (every poll morphs the DOM). The
 *     cached picture is written into the markup itself, so a repaint never
 *     flashes the icon back. Applying it only after the morph was the blink:
 *     icon, thumbnail, icon, thumbnail, until the poll stopped.
 *
 * Rows are found by a MutationObserver rather than by each caller remembering
 * to hydrate: markup that carries `data-file-thumb-pdf` gets a thumbnail no
 * matter which module drew it.
 *
 * Global: window.TMAFileThumbs
 */
(function (global) {
  'use strict';

  /* Longest edge of the rendered page, in device pixels. The thumbnail is cut
     out of this, so it is rendered larger than the slot it lands in. */
  var PDF_MAX = 420;

  /* The side of the square taken out of the page, as a fraction of the page's
     width. See cropOf: the whole page in a 28px row is unreadable. */
  var PDF_CROP = 0.62;

  /* The square the crop is scaled into. */
  var PDF_THUMB = 256;

  /* The wide variant, for banner-shaped slots (the workflow card's preview).
     The whole width of the page, a band off the top: see bandOf. */
  var PDF_BAND_W = 640;
  var PDF_BAND_ASPECT = 2.6;
  /*
   * One at a time.
   *
   * Every render is a pdf.js document, and a document is a worker: a folder of
   * scans used to start a crowd of them, and the reader who then opened one of
   * those files was competing with the whole crowd for the same machine. A
   * thumbnail is never urgent — nothing on screen is waiting for it.
   */
  var MAX_PARALLEL = 1;

  /*
   * Never read a whole file for a thumbnail.
   *
   * This briefly did, for files under 12 MB, because a complete read is the
   * one certain way to make a scan's first page paint. It is also the one
   * certain way to bring the portal down: document bytes are streamed through
   * PHP (they are not a redirect to the bucket), so every thumbnail held a
   * worker for a whole download, and a couple of readers browsing folders of
   * scans starved every other request in the app — pages that would not load
   * at all, which is a far worse fault than a document wearing its type icon.
   *
   * Ranges only, then: page one costs a few hundred KB, and a page that comes
   * back empty keeps its icon.
   */
  var SKIP_ABOVE = 60 * 1024 * 1024;

  var cache = {};   // previewUrl -> data: URL
  var failed = {};  // previewUrl -> true, so a broken file is tried once
  var inflight = {}; // previewUrl -> true while it is being painted
  var queue = [];
  var running = 0;
  var io = null;
  var scanQueued = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function extOf(name) {
    var match = String(name || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function iconSrcFor(item) {
    if (global.TMAFileIcons && global.TMAFileIcons.fileIconSrc) {
      return global.TMAFileIcons.fileIconSrc(item.icon || '', item.name || '');
    }
    return 'images/icons/tma/DefaultIcon.svg';
  }

  function isPdf(item) {
    if (!item) return false;
    if (item.category === 'pdf') return true;
    if (String(item.mime || '').toLowerCase().indexOf('application/pdf') === 0) return true;
    return extOf(item.extension ? '.' + item.extension : item.name) === 'pdf';
  }

  /* The URL page one is painted from: the preview route, and only when this
     reader is allowed to preview at all. A row they may not open must not
     quietly fetch the document to draw a picture of it. */
  /* One document can be wanted in two shapes — the square row thumbnail and
     the wide banner — so everything keyed by document (cache, inflight,
     failed, the watched flag) is keyed by shape as well. */
  function keyOf(url, wide) {
    return wide ? url + '\u0000wide' : url;
  }

  function pdfUrl(item) {
    if (!isPdf(item)) return '';
    if (item.permissions && item.permissions.preview === false) return '';
    return item.previewUrl || '';
  }

  /* How big the file is, in bytes. Lists name that field differently — one of
     them keeps `size` for the human label ("1.8 MB") and the number in
     `bytes` — so both are read, and only a real number counts. */
  function sizeOf(item) {
    var n = Number(item && item.bytes);
    if (!Number.isFinite(n) || n <= 0) n = Number(item && item.size);

    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function bytesOf(img) {
    var n = Number(img.getAttribute('data-file-thumb-bytes'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /*
   * Is the reader looking at a document right now?
   *
   * If they are, nothing else may touch pdf.js. Painting thumbnails behind an
   * open viewer competes with the one document the reader actually asked for —
   * for the network, for memory, and for pdf.js's own workers — and the page
   * they are staring at is the one that loses. The queue simply waits; the
   * viewer closing pumps it again.
   */
  function viewerOpen() {
    return !!document.querySelector('.tma-portal-viewer, .tma-lightbox, .tma-portal-lightbox, .tma-dash__feed-gallery');
  }

  function canRenderPdf() {
    return !!(global.TMAPortalLightbox && typeof global.TMAPortalLightbox.pdfDocument === 'function');
  }

  /**
   * One <img> for a file: its real preview when there is one, its type icon
   * when there is not.
   *
   * opts: { size, iconSize, cls, iconCls, icon, alt, attrs }
   *   cls       classes for a real preview (cover-fitted artwork)
   *   iconCls   classes for the type icon (contain-fitted glyph)
   *   icon      icon src, when the caller has already chosen one
   *   iconSize  the glyph's own box, where a list draws it smaller than the
   *             picture it stands in for
   */
  function imgHtml(item, opts) {
    item = item || {};
    opts = opts || {};

    // `size: null` leaves the box to CSS, for slots (grid cards, the viewer
    // rail) that size the picture themselves and would be squared off by a
    // width/height pair.
    var size = opts.size === null ? 0 : (opts.size || 24);
    var iconSize = opts.iconSize === null ? 0 : (opts.iconSize || size);
    var cls = ((opts.cls || '') + ' tma-file-thumb').trim();
    var iconCls = opts.iconCls == null ? (opts.cls || '') : opts.iconCls;
    var icon = opts.icon || iconSrcFor(item);
    var alt = ' alt="' + esc(opts.alt || '') + '"';
    var box = size ? ' width="' + size + '" height="' + size + '"' : '';
    var iconBox = iconSize ? ' width="' + iconSize + '" height="' + iconSize + '"' : '';
    var extra = opts.attrs ? ' ' + opts.attrs : '';

    if (item.thumbUrl) {
      // A thumbnail that fails to generate must not leave a broken image in
      // the row: fall back to the icon, in the icon's own clothes.
      return '<img class="' + esc(cls) + '" src="' + esc(item.thumbUrl) + '"' + alt + box +
        ' loading="lazy"' + extra +
        ' onerror="this.onerror=null;this.className=\'' + esc(iconCls) + '\';this.src=\'' + esc(icon) + '\'">';
    }

    var pdf = canRenderPdf() ? pdfUrl(item) : '';
    if (pdf) {
      // A banner-shaped slot asks for the wide band instead of the square.
      var wide = !!opts.wide;
      var key = keyOf(pdf, wide);
      var wideAttr = wide ? ' data-file-thumb-wide="1"' : '';
      // Already painted this session: put the picture in the markup. Leaving
      // the icon here and swapping later is what made every list blink — the
      // morph re-drew the icon, then the observer put the page back, forever.
      if (cache[key]) {
        return '<img class="' + esc((cls + ' tma-file-thumb--doc').trim()) +
          '" src="' + esc(cache[key]) + '"' + alt + (size ? box : '') + extra + '>';
      }
      // The icon first, always. Page one replaces it if and when it renders,
      // so a document that can't be painted simply keeps its icon.
      return '<img class="' + esc(iconCls) + '" src="' + esc(icon) + '"' + alt + iconBox + extra +
        ' data-file-thumb-pdf="' + esc(pdf) + '"' + wideAttr +
        (sizeOf(item) ? ' data-file-thumb-bytes="' + sizeOf(item) + '"' : '') +
        ' data-file-thumb-cls="' + esc(cls + ' tma-file-thumb--doc') + '"' +
        (size ? ' data-file-thumb-size="' + size + '"' : '') +
        ' data-file-thumb-icon-cls="' + esc(iconCls) + '">';
    }

    return '<img class="' + esc(iconCls) + '" src="' + esc(icon) + '"' + alt + iconBox + extra + '>';
  }

  function apply(img, dataUrl) {
    var cls = img.getAttribute('data-file-thumb-cls');
    // The glyph and the picture are not always drawn at the same size: a row
    // that shows a 16px type mark shows a 24px thumbnail of the document.
    var size = img.getAttribute('data-file-thumb-size');
    img.removeAttribute('data-file-thumb-pdf');
    img.removeAttribute('data-file-thumb-wide');
    img.removeAttribute('data-file-thumb-cls');
    img.removeAttribute('data-file-thumb-size');
    img.removeAttribute('data-file-thumb-icon-cls');
    if (cls) img.className = cls;
    if (size) {
      img.setAttribute('width', size);
      img.setAttribute('height', size);
    } else {
      // The glyph's own box would square off a page. Slots that size their
      // picture in CSS get the attributes taken away with the icon.
      img.removeAttribute('width');
      img.removeAttribute('height');
    }
    if (img.getAttribute('src') !== dataUrl) img.src = dataUrl;
  }

  /*
   * Is there anything on this page?
   *
   * A first page that is blank — a cover sheet, a scan that starts on paper —
   * paints a white rectangle, and a white rectangle in a 28px row does not
   * read as "a document", it reads as a picture that failed to load. The type
   * icon is the better answer there, so the ink is counted before the
   * thumbnail is accepted.
   *
   * Counted over the whole rendered page (~28k pixels at this size, which is
   * nothing) rather than sampled: a single line of text is a few hundred
   * pixels and a grid would step straight over it.
   */
  function hasInk(canvas, ctx) {
    try {
      var w = canvas.width;
      var h = canvas.height;
      var data = ctx.getImageData(0, 0, w, h).data;
      var marked = 0;
      var total = w * h;

      for (var i = 0; i < data.length; i += 4) {
        // Anything meaningfully darker than paper. Antialiased text lands here
        // long before it reaches black.
        if (data[i] < 242 || data[i + 1] < 242 || data[i + 2] < 242) marked += 1;
      }

      // Deliberately low. This asks "is there anything on this page at all",
      // not "is there enough to see": a scan with one letterhead line is a
      // document, and a thumbnail of it is worth more than a red PDF mark.
      return total > 0 && (marked / total) > 0.0004;
    } catch (e) {
      // A tainted or oversized canvas cannot be read. Keep the picture rather
      // than throwing away a thumbnail that may well be fine.
      return true;
    }
  }

  /* Page one, painted onto a canvas and handed back as a data: URL. The page's
     own shape is kept (a portrait page stays portrait); the slot it lands in
     decides how it is cropped. */
  function renderPdf(url, bytes, wide) {
    // One document, read by range, once. A file this big is not worth reaching
    // into at all for a 28px picture.
    if (bytes && bytes > SKIP_ABOVE) throw new Error('too big to preview');

    return paintPage(url, wide);
  }

  function paintPage(url, wide) {
    return global.TMAPortalLightbox.pdfDocument(url).then(function (pdf) {
      if (!pdf) throw new Error('no document');

      return pdf.getPage(1).then(function (page) {
        var unscaled = page.getViewport({ scale: 1 });
        var scale = PDF_MAX / Math.max(unscaled.width, unscaled.height);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        return page.render({ canvas: canvas, viewport: viewport }).promise.then(function () {
          // Nothing on the page: the type icon says more than a white square,
          // and there is nowhere cheap left to look. pdf.js fills the bitmap
          // white itself; taking a 2d context before render() leaves it blank.
          var ctx = canvas.getContext('2d');
          if (!ctx || !hasInk(canvas, ctx)) throw new Error('blank first page');

          return (wide ? bandOf(canvas) : cropOf(canvas)).toDataURL('image/jpeg', 0.78);
        });
      }).then(function (dataUrl) {
        try { pdf.destroy(); } catch (e) { /* already gone */ }
        return dataUrl;
      }, function (err) {
        try { pdf.destroy(); } catch (e) { /* already gone */ }
        throw err;
      });
    });
  }

  /*
   * The top-left of the page, not the whole of it.
   *
   * A full A4 page squeezed into a 28px row is a white rectangle with a grey
   * smudge where the words are — which is exactly what "the PDF thumbnails
   * don't work" looks like, even though pdf.js rendered it perfectly. What
   * tells one document from another at that size is the top-left corner: the
   * letterhead, the title, the photograph on a passport page. So the thumbnail
   * is a square cut from there and blown up, ~1.6x what the whole page would
   * give, which is the difference between a smudge and a mark you recognise.
   *
   * Anchored with a small inset so a page border does not become the picture,
   * and clamped so a landscape or square page cannot ask for more than exists.
   */
  /*
   * The top of the page, full width, for a slot that is wider than it is
   * tall. cropOf's square is a left-hand crop: in a banner it shows the first
   * two thirds of every line and cuts the rest off mid-word, which reads as a
   * picture that is not centred. Here the whole width goes in and the page is
   * cut at the bottom instead, where a document has least to say about itself.
   */
  function bandOf(canvas) {
    var out = document.createElement('canvas');
    out.width = PDF_BAND_W;
    out.height = Math.round(PDF_BAND_W / PDF_BAND_ASPECT);

    // The slice of the page that fills the band at the page's own scale.
    var side = canvas.width;
    var sh = Math.min(canvas.height, Math.round(side / PDF_BAND_ASPECT));
    var inset = Math.round(canvas.height * 0.02);
    var sy = Math.min(inset, Math.max(0, canvas.height - sh));

    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, sy, side, sh, 0, 0, out.width, out.height);

    return out;
  }

  function cropOf(canvas) {
    var side = Math.max(1, Math.min(
      Math.round(canvas.width * PDF_CROP),
      canvas.width,
      canvas.height
    ));
    var inset = Math.round(side * 0.03);
    var sx = Math.min(inset, Math.max(0, canvas.width - side));
    var sy = Math.min(inset, Math.max(0, canvas.height - side));

    var out = document.createElement('canvas');
    out.width = PDF_THUMB;
    out.height = PDF_THUMB;

    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PDF_THUMB, PDF_THUMB);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, sx, sy, side, side, 0, 0, PDF_THUMB, PDF_THUMB);

    return out;
  }

  function pump() {
    /*
     * A tab nobody is looking at paints nothing.
     *
     * Left running, a portal open in a background tab kept asking the server
     * for documents while the person was working somewhere else — and those
     * requests come out of the same pool as the pages they are actually
     * waiting on.
     */
    // A cached picture still goes up — that costs nothing and the row is
    // otherwise wearing an icon it does not need.
    if (viewerOpen() || document.hidden) {
      queue = queue.filter(function (job) {
        var cached = cache[keyOf(job.url, job.wide)];
        if (!cached) return true;
        apply(job.img, cached);
        return false;
      });

      return;
    }

    while (running < MAX_PARALLEL && queue.length) {
      var job = queue.shift();
      var url = job.url;
      var wide = !!job.wide;
      var key = keyOf(url, wide);

      if (cache[key]) { apply(job.img, cache[key]); continue; }
      if (failed[key] || inflight[key]) { continue; }

      inflight[key] = true;
      running += 1;
      /* eslint-disable no-loop-func */
      (function (url, bytes, wide, key) {
        Promise.resolve().then(function () {
          return renderPdf(url, bytes, wide);
        }).then(function (dataUrl) {
          cache[key] = dataUrl;
          // Every row showing this file, not only the one that asked: a list
          // can hold the same document twice, and a repaint mid-render leaves
          // the original <img> detached.
          scan(document);
        }).catch(function () {
          failed[key] = true;
          // Only the rows waiting for THIS shape give up; the other variant
          // may still paint.
          document.querySelectorAll('[data-file-thumb-pdf="' + url.replace(/"/g, '\\"') + '"]')
            .forEach(function (img) {
              if (!!img.getAttribute('data-file-thumb-wide') !== wide) return;
              img.removeAttribute('data-file-thumb-pdf');
              img.removeAttribute('data-file-thumb-wide');
            });
        }).then(function () {
          delete inflight[key];
          running -= 1;
          // A breath between documents. Fifty scans in a folder is fifty
          // requests, and the reader is waiting on the page, not on them.
          setTimeout(pump, 250);
        });
      }(url, job.bytes, wide, key));
      /* eslint-enable no-loop-func */
    }
  }

  function observer() {
    if (io || typeof IntersectionObserver !== 'function') return io;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var img = entry.target;
        io.unobserve(img);
        var url = img.getAttribute('data-file-thumb-pdf');
        if (!url) return;
        queue.push({
          img: img,
          url: url,
          bytes: bytesOf(img),
          wide: !!img.getAttribute('data-file-thumb-wide'),
        });
      });
      pump();
    }, { rootMargin: '200px' });
    return io;
  }

  /** Give every pending row in `root` its thumbnail, or a place in the queue. */
  function scan(root) {
    if (!canRenderPdf()) return;
    var host = root && root.querySelectorAll ? root : document;
    var pending = host.querySelectorAll('[data-file-thumb-pdf]');
    if (!pending.length) return;

    var watcher = observer();

    Array.prototype.forEach.call(pending, function (img) {
      var url = img.getAttribute('data-file-thumb-pdf');
      if (!url) return;
      var wide = !!img.getAttribute('data-file-thumb-wide');
      var key = keyOf(url, wide);

      // Already painted once this session: apply it now, before the row is
      // ever seen empty.
      if (cache[key]) { apply(img, cache[key]); return; }
      if (failed[key]) {
        img.removeAttribute('data-file-thumb-pdf');
        img.removeAttribute('data-file-thumb-wide');
        return;
      }
      // Keyed on the URL, not a boolean: the render layer reuses row nodes, so
      // the same <img> can come back describing a different document, and a
      // once-watched flag would leave that one with its icon for ever.
      if (img.__fileThumbWatched === key) return;
      img.__fileThumbWatched = key;

      if (watcher) {
        watcher.observe(img);
        return;
      }
      queue.push({ img: img, url: url, bytes: bytesOf(img), wide: wide });
    });

    // Always: a job left in the queue by a viewer that was open has nothing
    // else to restart it.
    pump();
  }

  function scanSoon() {
    if (scanQueued) return;
    scanQueued = true;
    // Same frame as the morph, not 150ms later. Waiting was a visible flash
    // of the type icon on every list refresh, even when the thumbnail was
    // already in the cache.
    requestAnimationFrame(function () {
      scanQueued = false;
      scan(document);
    });
  }

  function start() {
    scan(document);
    // Coming back to the tab, or closing a viewer, releases whatever was held.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scanSoon();
    });
    if (typeof MutationObserver !== 'function') return;
    // The portal repaints these lists on every background poll, so rows arrive
    // long after load and go on arriving. Watching the document is what makes
    // this global: a new list anywhere is picked up without its module knowing
    // this file exists.
    new MutationObserver(scanSoon).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.TMAFileThumbs = {
    imgHtml: imgHtml,
    iconSrc: iconSrcFor,
    isPdf: isPdf,
    pdfUrl: pdfUrl,
    hydrate: scan,
  };
})(typeof window !== 'undefined' ? window : this);
