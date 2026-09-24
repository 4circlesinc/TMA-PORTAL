/*
 * Bespoke AI Assistant — in-portal assistant.
 * Vanilla IIFE. Global: window.TMABespoke
 *
 * Corner launcher for help on the page you are on. /bespoke-ai is the
 * full page, with this account's past chats. FEATURE_BESPOKE off: no
 * launcher, no nav row, 404.
 */
(function () {
  'use strict';

  if (window.TMABespoke) return;

  var LS_OPEN = 'tma.bespoke.open';
  /*
   * The chat in progress, remembered for THIS page only.
   *
   * It used to live in localStorage, which outlives a reload and is shared
   * by every tab — so a refresh silently resumed the old thread, and
   * expanding the launcher to the full page carried that thread across with
   * it. A reload is the reader saying "start again", so the id is kept in
   * sessionStorage and cleared as this script loads: whatever is on screen
   * after a refresh is a new chat, on both surfaces. The old thread is not
   * lost — it is in History, which is where a reader looks for it.
   */
  var LS_CONV = 'tma.bespoke.conversationId';
  var LS_HELLO = 'tma.bespoke.helloDismissed';
  var MARK = 'images/brand/tma/bespoke-ai-mark.png';
  var PLUS = 'images/icons/phosphor/Plus.svg';
  var CLOSE = 'images/icons/phosphor/X.svg';
  var SEND = 'images/icons/phosphor/PaperPlaneTilt.svg';
  var COPY = 'images/icons/phosphor/Copy.svg';
  var CLOCK = 'images/icons/phosphor/ClockCounterClockwise.svg';
  var EXPAND = 'images/icons/phosphor/ArrowsOut.svg';
  var TRASH = 'images/icons/phosphor/Trash.svg';
  var PENCIL = 'images/icons/phosphor/PencilSimple.svg';
  var BACK = 'images/icons/phosphor/ArrowLeft.svg';
  var PENDING_COMPOSE_KEY = 'tma.mail.pending-compose';
  var CLIP = 'images/icons/phosphor/Paperclip.svg';
  var MIC = 'images/icons/phosphor/Microphone.svg';
  var LS_VOICE_ENGINE = 'tma.bespoke.voiceEngine';
  var ICON_PDF = 'images/icons/phosphor/FilePdf.svg';
  var ICON_IMAGE = 'images/icons/phosphor/Image.svg';
  var ICON_FILE = 'images/icons/phosphor/File.svg';
  var MAX_FILES = 5;
  var ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,application/pdf,image/jpeg,image/png,image/webp,text/plain';
  var PDF_MAX_PAGES = 40;
  var PDF_MAX_CHARS = 120000;

  var FALLBACK_FAQ = [
    {
      id: 'dashboard',
      q: 'What’s on this dashboard?',
      keywords: ['dashboard', 'home', 'tiles'],
      answer: 'The Dashboard is home after you sign in: greeting, tiles you can hide from Edit Dashboard, and Recent Files.\n\nOpen it: [/](/)'
    },
    {
      id: 'start-cip',
      q: 'How do I start a CIP application?',
      keywords: ['start', 'create', 'cip', 'application'],
      answer: 'Open [CIP Applications](/citizenship-applications) → Create New Application. Staff: Pre-Approval, Post-Approval, Add-On, New service provider, Import. Provider contacts: Pre-Approval, Post-Approval, Add-On. An Add-On needs the main applicant name, parent CIP number and COR number, relationship to the main applicant, and only one Add-On can be in progress per granted file.'
    },
    {
      id: 'file-library',
      q: 'Where is File Library?',
      keywords: ['file library', 'files', 'folders'],
      answer: 'File Library is in the sidebar. The Folders tab is Folder Shortcuts, not the full library.\n\nOpen [All Files](/folders/all).'
    },
    {
      id: 'autosave',
      q: 'How does draft autosave work?',
      keywords: ['autosave', 'draft saved'],
      answer: 'On a new CIP filing or a Draft file, the form saves about 1.2 seconds after you stop typing. Toast: Draft saved. Save as draft keeps Draft. Add files into New Applications when required fields are complete.'
    }
  ];

  var host = null;
  var panel = null;
  var fab = null;
  var widget = null;
  var page = null;
  var lastFocus = null;
  var open = false;
  var lightboxEl = null;
  var previewStore = {};
  var previewSeq = 1;
  var configured = false;
  var faq = FALLBACK_FAQ.slice();
  var allowedPaths = ['/', '/calendar', '/signatures', '/social/messages', '/account-settings', '/folders/recent', '/bespoke-ai'];

  function enabled() {
    if (window.TMACurrentUser && window.TMACurrentUser.get) {
      var me = window.TMACurrentUser.get();
      if (me && me.bespoke && me.bespoke.enabled === false) return false;
      if (me && me.bespoke && me.bespoke.enabled === true) return true;
    }
    return window.TMABootBespoke === true || window.TMABootBespoke === 'true';
  }

  function isComposePopout() {
    return document.documentElement.classList.contains('tma-dash--compose-popout');
  }

  function isPagePath(path) {
    var p = path || currentPath();
    return p === '/bespoke-ai' || p.indexOf('/bespoke-ai/') === 0;
  }

  /*
   * The chat named by the address bar, if any.
   *
   * The shell passes this in when it routes, but the assistant's view is
   * also mounted by paths that do not carry the options through, and a
   * /bespoke-ai/{id} link that opened an empty New chat is a broken link.
   * Reading the URL is the one answer both paths agree on.
   */
  function pathConversationId() {
    var p = currentPath();
    if (p.indexOf('/bespoke-ai/') !== 0) return '';
    var id = p.slice('/bespoke-ai/'.length).split('/')[0];

    return isUuid(id) ? id : '';
  }

  function storeGet(k, d) {
    try {
      var v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch (e) {
      return d;
    }
  }

  function storeSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* private mode */ }
  }

  /*
   * The conversation in progress: this tab, this page view, nothing longer.
   *
   * Everything else here is a preference and belongs in localStorage. This
   * one is a position in a thread, and keeping it that long is what made a
   * refresh resume the old chat instead of starting a new one.
   */
  function convGet() {
    try {
      return sessionStorage.getItem(LS_CONV) || '';
    } catch (e) {
      return '';
    }
  }

  function convSet(v) {
    try {
      if (v) sessionStorage.setItem(LS_CONV, v);
      else sessionStorage.removeItem(LS_CONV);
    } catch (e) { /* private mode */ }
  }

  /*
   * A load of this script is a fresh start.
   *
   * It runs once per full page load, so a refresh, a typed URL and a cold
   * open all land here; SPA navigation does not re-run it, which is what
   * lets the launcher keep its thread while the reader moves around the
   * portal. The stale localStorage key from earlier builds is cleared too,
   * or a reader who never clears their browser keeps resuming a chat from
   * before this fix shipped.
   */
  (function forgetLastConversation() {
    convSet('');
    try { localStorage.removeItem(LS_CONV); } catch (e) { /* private mode */ }
  }());

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (typeof window.TMACsrfToken === 'string' && window.TMACsrfToken) return window.TMACsrfToken;
    return '';
  }

  function currentPath() {
    var p = String(window.location.pathname || '/').replace(/\/+$/, '') || '/';
    return p;
  }

  function currentView() {
    var dash = document.querySelector('.tma-dash');
    var shown = dash && dash.querySelector('.tma-dash__view:not([hidden])');
    return (shown && shown.getAttribute('data-view')) || '';
  }

  function currentTitle() {
    var el = document.querySelector('[data-page-title]');
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function fieldHints() {
    var hints = [];
    var root = document.querySelector('.tma-dash__view:not([hidden])') || document;
    var labels = root.querySelectorAll('label');
    for (var i = 0; i < labels.length && hints.length < 40; i++) {
      var label = labels[i];
      var text = (label.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) {
        text = text.slice(0, 80);
      }
      if (!text) continue;
      var forId = label.getAttribute('for');
      var input = forId ? document.getElementById(forId) : label.querySelector('input, select, textarea');
      var empty = true;
      if (input) {
        if (input.type === 'checkbox' || input.type === 'radio') empty = !input.checked;
        else if (input.type === 'file') empty = !input.files || !input.files.length;
        else empty = !String(input.value || '').trim();
      }
      hints.push({ label: text, empty: empty });
    }
    return hints;
  }

  function go(path) {
    var dash = document.querySelector('.tma-dash');
    if (dash && typeof dash._portalNavigate === 'function') {
      dash._portalNavigate(path);
      return;
    }
    window.location.assign(path);
  }

  function replaceBespokeUrl(path, conversationId) {
    if (currentPath() === path) return;
    try {
      history.replaceState({
        navId: 'bespoke',
        view: 'bespoke',
        title: 'Bespoke AI Assistant',
        crumb: 'Bespoke AI Assistant',
        conversationId: conversationId || null
      }, '', path);
    } catch (e) { /* ignore */ }
  }

  function pushBespokeUrl(path, conversationId) {
    if (currentPath() === path) return;
    try {
      history.pushState({
        navId: 'bespoke',
        view: 'bespoke',
        title: 'Bespoke AI Assistant',
        crumb: 'Bespoke AI Assistant',
        conversationId: conversationId || null
      }, '', path);
    } catch (e) {
      go(path);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pathAllowed(href) {
    var path = String(href || '').split('?')[0];
    if (!path || path.charAt(0) !== '/' || path.charAt(1) === '/') return false;
    path = path.replace(/\/+$/, '') || '/';
    for (var i = 0; i < allowedPaths.length; i++) {
      var ok = allowedPaths[i];
      if (path === ok || path.indexOf(ok + '/') === 0) return true;
    }
    return false;
  }

  function renderLite(text) {
    var escaped = escapeHtml(text);
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      href = href.replace(/&amp;/g, '&');
      if (!pathAllowed(href)) return label;
      return '<a href="' + escapeHtml(href) + '" data-bespoke-nav="' + escapeHtml(href) + '">' + label + '</a>';
    });
    escaped = escaped.replace(/(^|\s)(\/(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=\-]|%[0-9A-Fa-f]{2})+)/g, function (_, pre, href) {
      var path = href.split('?')[0];
      if (!pathAllowed(path)) return pre + href;
      return pre + '<a href="' + escapeHtml(href) + '" data-bespoke-nav="' + escapeHtml(href) + '">' + href + '</a>';
    });
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    var lines = escaped.split(/\n/);
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = line.match(/^\s*[-*]\s+(.*)$/);
      var numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (bullet || numbered) {
        if (!inList) {
          html += numbered ? '<ol>' : '<ul>';
          inList = numbered ? 'ol' : 'ul';
        }
        html += '<li>' + (bullet ? bullet[1] : numbered[1]) + '</li>';
        continue;
      }
      if (inList) {
        html += '</' + inList + '>';
        inList = false;
      }
      if (line === '') html += '<p></p>';
      else html += '<p>' + line + '</p>';
    }
    if (inList) html += '</' + inList + '>';
    return html;
  }

  function fold(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s/'’-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function matchFaq(query) {
    var q = fold(query);
    if (!q) return null;
    if (q.indexOf('summarize this page') !== -1 || q.indexOf("what's on this") !== -1 || q.indexOf('whats on this') !== -1) {
      return { answer: 'This screen is **' + (currentTitle() || 'the current page') + '** (`' + currentPath() + '`). I describe what is on screen, not guessed case data.' };
    }
    var best = null;
    var bestScore = 0;
    faq.forEach(function (item) {
      var score = 0;
      var question = fold(item.q);
      if (question && (q.indexOf(question) !== -1 || question.indexOf(q) !== -1)) score += 12;
      (item.keywords || []).forEach(function (word) {
        var w = fold(word);
        if (w && q.indexOf(w) !== -1) score += w.length > 4 ? 4 : 2;
      });
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    });
    return bestScore >= 4 ? best : null;
  }

  function looksLikeDraft(text) {
    return /\*\*Subject:\*\*|^\s*Subject:/m.test(text);
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (opts.body || opts.method === 'PATCH' || opts.method === 'DELETE') {
      headers['X-XSRF-TOKEN'] = csrf();
    }
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 404) return Promise.reject({ notFound: true, status: 404 });
      if (!res.ok) return Promise.reject({ status: res.status });
      if (res.status === 204) return {};
      return res.json();
    });
  }

  function apiForm(path, formData) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf()
      },
      body: formData
    }).then(function (res) {
      if (res.status === 404) return Promise.reject({ notFound: true, status: 404 });
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) return Promise.reject({ status: res.status, data: data });
        return data;
      });
    });
  }

  /* pdf.js loads on first use, the same lazy import the lightbox uses. The
   * text layer is read here in the browser because nothing on the server
   * reads PDFs. */
  var pdfjsPromise = null;
  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    pdfjsPromise = import(root + '/js/vendor/pdf-loader.mjs?v=5').then(function (lib) {
      try {
        lib.GlobalWorkerOptions.workerSrc = new URL(root + '/js/vendor/pdf-worker.mjs?v=2', window.location.href).href;
      } catch (e) {
        lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf-worker.mjs?v=2';
      }
      return lib;
    }).catch(function (err) {
      pdfjsPromise = null;
      throw err;
    });
    return pdfjsPromise;
  }

  function extractPdfText(file) {
    return file.arrayBuffer().then(function (buffer) {
      return loadPdfjs().then(function (lib) {
        return lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      });
    }).then(function (doc) {
      var pages = doc.numPages || 0;
      var limit = Math.min(pages, PDF_MAX_PAGES);
      var out = '';
      var chain = Promise.resolve();
      for (var n = 1; n <= limit; n++) {
        (function (pageNo) {
          chain = chain.then(function () {
            if (out.length >= PDF_MAX_CHARS) return;
            return doc.getPage(pageNo).then(function (page) {
              return page.getTextContent();
            }).then(function (content) {
              var line = '';
              (content.items || []).forEach(function (item) {
                if (typeof item.str !== 'string') return;
                line += item.str;
                line += item.hasEOL ? '\n' : ' ';
              });
              out += (out ? '\n\n' : '') + line.replace(/[ \t]+\n/g, '\n').trim();
            });
          });
        })(n);
      }
      return chain.then(function () {
        try { doc.destroy(); } catch (e) { /* ignore */ }
        return { text: out.slice(0, PDF_MAX_CHARS), pages: pages };
      });
    });
  }

  function fileIcon(entry) {
    var mime = String(entry.mime || (entry.file && entry.file.type) || '');
    var name = String(entry.name || '').toLowerCase();
    if (mime === 'application/pdf' || /\.pdf$/.test(name)) return ICON_PDF;
    if (/^image\//.test(mime) || /\.(jpe?g|png|webp)$/.test(name)) return ICON_IMAGE;
    return ICON_FILE;
  }

  function entryMime(entry) {
    return String(entry.mime || (entry.file && entry.file.type) || '');
  }

  function entryName(entry) {
    return String(entry.name || (entry.file && entry.file.name) || 'file');
  }

  function isImageEntry(entry) {
    var mime = entryMime(entry);
    var name = entryName(entry).toLowerCase();
    return entry.isImage === true || /^image\//.test(mime) || /\.(jpe?g|png|webp)$/.test(name);
  }

  function isPdfEntry(entry) {
    var mime = entryMime(entry);
    var name = entryName(entry).toLowerCase();
    return entry.isPdf === true || mime === 'application/pdf' || /\.pdf$/.test(name);
  }

  function isTextEntry(entry) {
    var mime = entryMime(entry);
    var name = entryName(entry).toLowerCase();
    return /^text\//.test(mime) || /\.(txt|md|csv)$/.test(name);
  }

  function previewKey(entry) {
    if (!entry._key) {
      entry._key = 'p' + (previewSeq++);
      previewStore[entry._key] = entry;
    }
    return entry._key;
  }

  function acceptedFile(file) {
    var name = String(file && file.name || '').toLowerCase();
    var mime = String(file && file.type || '').toLowerCase();
    if (/\.(pdf|jpe?g|png|webp|txt|md|csv)$/.test(name)) return true;
    return mime === 'application/pdf' || mime === 'text/plain' || /^image\/(jpeg|png|webp)$/.test(mime);
  }

  function imageSrc(entry) {
    if (entry.thumb) return entry.thumb;
    if (entry.file) {
      entry.thumb = URL.createObjectURL(entry.file);
      entry.thumbRevoke = true;
      return entry.thumb;
    }
    return entry.url || '';
  }

  function rasterizePdfThumb(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      return loadPdfjs().then(function (lib) {
        return lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      });
    }).then(function (doc) {
      return doc.getPage(1).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var scale = 144 / Math.max(1, base.width);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        return page.render({ canvas: canvas, viewport: viewport, background: '#ffffff' }).promise.then(function () {
          try { doc.destroy(); } catch (e) { /* ignore */ }
          return canvas.toDataURL('image/jpeg', 0.8);
        });
      });
    });
  }

  function showThumb(media, src) {
    var img = document.createElement('img');
    img.className = 'tma-bespoke__preview-img';
    img.alt = '';
    img.src = src;
    media.innerHTML = '';
    media.classList.remove('is-text');
    media.appendChild(img);
  }

  function liveMedia(entry) {
    if (!entry._key) return null;
    return document.querySelector('[data-bespoke-preview="' + entry._key + '"] [data-bespoke-preview-media]');
  }

  function fillPreview(tile, entry) {
    var media = tile.querySelector('[data-bespoke-preview-media]');
    if (!media) return;
    if (isImageEntry(entry)) {
      var src = imageSrc(entry);
      if (src) showThumb(media, src);
      return;
    }
    if (isPdfEntry(entry)) {
      if (entry.thumb) {
        showThumb(media, entry.thumb);
        return;
      }
      media.innerHTML = '<img class="tma-bespoke__preview-icon" src="' + ICON_PDF + '" alt="" width="22" height="22">';
      if (entry.thumbPending) return;
      var blob = entry.file || null;
      var job = blob
        ? rasterizePdfThumb(blob)
        : (entry.url
          ? fetch(entry.url, { credentials: 'same-origin' }).then(function (res) {
            if (!res.ok) throw new Error('fetch');
            return res.blob();
          }).then(rasterizePdfThumb)
          : Promise.reject());
      entry.thumbPending = true;
      job.then(function (url) {
        entry.thumb = url;
        entry.thumbPending = false;
        var live = tile.isConnected ? media : liveMedia(entry);
        if (live) showThumb(live, url);
      }).catch(function () {
        entry.thumbPending = false;
      });
      return;
    }
    if (entry.snippet) {
      media.textContent = entry.snippet;
      media.classList.add('is-text');
      return;
    }
    if (isTextEntry(entry) && entry.file && entry.file.text) {
      entry.file.text().then(function (text) {
        var snip = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        entry.snippet = snip;
        var live = tile.isConnected ? media : liveMedia(entry);
        if (!live) return;
        live.textContent = snip || 'Text file';
        live.classList.add('is-text');
      }).catch(function () { /* icon stays */ });
      return;
    }
    if (isTextEntry(entry) && entry.url && !entry.snippetPending) {
      entry.snippetPending = true;
      fetch(entry.url, { credentials: 'same-origin' }).then(function (res) {
        return res.ok ? res.text() : '';
      }).then(function (text) {
        entry.snippetPending = false;
        var snip = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        entry.snippet = snip;
        var live = tile.isConnected ? media : liveMedia(entry);
        if (!live) return;
        live.textContent = snip || 'Text file';
        live.classList.add('is-text');
      }).catch(function () {
        entry.snippetPending = false;
      });
    }
    media.innerHTML = '<img class="tma-bespoke__preview-icon" src="' + fileIcon(entry) + '" alt="" width="22" height="22">';
  }

  function previewTile(entry, withRemove) {
    var tile = document.createElement('div');
    tile.className = 'tma-bespoke__file tma-bespoke__preview' + (entry.status ? ' tma-bespoke__file--' + entry.status : '');
    tile.setAttribute('data-bespoke-preview', previewKey(entry));
    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'tma-bespoke__preview-open';
    openBtn.setAttribute('data-bespoke-preview-open', '');
    openBtn.setAttribute('aria-label', 'Open ' + entryName(entry));
    if (entry.status === 'failed') openBtn.title = entry.error || 'Could not upload';
    var media = document.createElement('span');
    media.className = 'tma-bespoke__preview-media';
    media.setAttribute('data-bespoke-preview-media', '');
    var name = document.createElement('span');
    name.className = 'tma-bespoke__preview-name';
    name.textContent = entryName(entry);
    openBtn.appendChild(media);
    openBtn.appendChild(name);
    tile.appendChild(openBtn);
    if (withRemove) tile.appendChild(withRemove);

    /*
     * A 2×2 the portal made keeps its Adjust.
     *
     * The editor used to live only in the turn that produced it, so coming
     * back to a chat left the reader with a picture and no way to change
     * it — while the assistant's own reply was still promising Adjust. The
     * button re-opens the editor against the ORIGINAL upload (sourceId),
     * because re-cropping the crop would shed a little more of the picture
     * every time.
     */
    if (entry.kind === 'derived' && entry.sourceId && currentCtx()) {
      var adjust = document.createElement('button');
      adjust.type = 'button';
      adjust.className = 'tma-bespoke__preview-adjust';
      adjust.textContent = 'Adjust';
      adjust.setAttribute('data-bespoke-preview-adjust', '');
      adjust.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        reopenPhotoEditor(entry);
      });
      tile.appendChild(adjust);
    }

    fillPreview(tile, entry);
    return tile;
  }

  /* Whichever surface is on screen: the page when it is open, else the
     launcher. A card has to be appended to the log the reader is looking at. */
  function currentCtx() {
    if (isPagePath() && page) return page;

    return widget || page || null;
  }

  /*
   * Open the framing editor again for a 2×2 that is already in the thread.
   *
   * The card is appended to the end of the log rather than replacing the
   * old picture in place: the thread is a record of what was said, and
   * rewriting an earlier turn would make it lie. Saving supersedes the
   * previous crop, so the chat still ends up with one finished photo.
   */
  function reopenPhotoEditor(entry) {
    var ctx = currentCtx();
    if (!ctx || !ctx.logEl) return;

    renderPhotoCard(ctx, {
      type: 'photo2x2',
      reframe: true,
      attachment: {
        id: entry.sourceId,
        name: entry.name,
        url: '/portal/bespoke/attachments/' + entry.sourceId,
        isPdf: false
      }
    });
    ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
  }

  function mountFilePreviews(bubble, list) {
    if (!Array.isArray(list) || !list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'tma-bespoke__files';
    list.forEach(function (entry) {
      wrap.appendChild(previewTile(entry, null));
    });
    bubble.appendChild(wrap);
  }

  function lightboxSource(entry) {
    if (entry.url) return entry.url;
    if (entry.file) {
      if (!entry.objectUrl) entry.objectUrl = URL.createObjectURL(entry.file);
      return entry.objectUrl;
    }
    return entry.thumb || '';
  }

  function closeFileLightbox() {
    if (lightboxEl && lightboxEl.parentNode) lightboxEl.parentNode.removeChild(lightboxEl);
    lightboxEl = null;
  }

  function fillLightbox(stage, entry) {
    stage.innerHTML = '';
    if (isImageEntry(entry)) {
      var img = document.createElement('img');
      img.className = 'tma-bespoke-lightbox__img';
      img.alt = entryName(entry);
      img.src = lightboxSource(entry);
      stage.appendChild(img);
      return;
    }
    if (isPdfEntry(entry)) {
      var frame = document.createElement('iframe');
      frame.className = 'tma-bespoke-lightbox__frame';
      frame.title = entryName(entry);
      frame.src = lightboxSource(entry);
      stage.appendChild(frame);
      return;
    }
    var pre = document.createElement('pre');
    pre.className = 'tma-bespoke-lightbox__text';
    pre.textContent = 'Loading…';
    stage.appendChild(pre);
    var job = entry.file && entry.file.text
      ? entry.file.text()
      : (entry.url
        ? fetch(entry.url, { credentials: 'same-origin' }).then(function (res) {
          return res.ok ? res.text() : '';
        })
        : Promise.resolve(entry.snippet || ''));
    job.then(function (text) {
      if (!pre.isConnected) return;
      pre.textContent = String(text || '').slice(0, 20000) || 'Nothing to preview.';
    }).catch(function () {
      if (pre.isConnected) pre.textContent = entry.snippet || 'Nothing to preview.';
    });
  }

  function openFileLightbox(entry) {
    if (!entry) return;
    closeFileLightbox();
    var lb = document.createElement('div');
    lb.className = 'tma-bespoke-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', entryName(entry));
    lb.innerHTML =
      '<button type="button" class="tma-bespoke-lightbox__backdrop" data-bespoke-lb-close aria-label="Close preview"></button>' +
      '<div class="tma-bespoke-lightbox__head">' +
        '<p class="tma-bespoke-lightbox__title"></p>' +
        '<button type="button" class="tma-bespoke-lightbox__close" data-bespoke-lb-close aria-label="Close"><img src="' + CLOSE + '" alt="" width="16" height="16"></button>' +
      '</div>' +
      '<div class="tma-bespoke-lightbox__stage" data-bespoke-lb-stage></div>';
    lb.querySelector('.tma-bespoke-lightbox__title').textContent = entryName(entry);
    document.body.appendChild(lb);
    lightboxEl = lb;
    fillLightbox(lb.querySelector('[data-bespoke-lb-stage]'), entry);
    var closeBtn = lb.querySelector('.tma-bespoke-lightbox__close');
    if (closeBtn) closeBtn.focus();
    lb.addEventListener('click', function (e) {
      if (!(e.target.closest)) return;
      if (e.target.closest('[data-bespoke-lb-close]')) {
        closeFileLightbox();
        return;
      }
      if (e.target.closest('img, iframe, pre, video, a, button')) return;
      if (e.target.closest('[data-bespoke-lb-stage]')) closeFileLightbox();
    });
  }

  function onPreviewClick(e) {
    var btn = e.target.closest && e.target.closest('[data-bespoke-preview-open]');
    if (!btn) return;
    var tile = btn.closest('[data-bespoke-preview]');
    var entry = tile && previewStore[tile.getAttribute('data-bespoke-preview')];
    if (!entry) return;
    e.preventDefault();
    openFileLightbox(entry);
  }

  function dragHasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function bindFileDrop(ctx, el) {
    if (!el || el.getAttribute('data-bespoke-drop-bound')) return;
    el.setAttribute('data-bespoke-drop-bound', '1');
    function stillInside(e) {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return true;
      var rect = el.getBoundingClientRect();
      return e.clientX > rect.left && e.clientX < rect.right && e.clientY > rect.top && e.clientY < rect.bottom;
    }
    el.addEventListener('dragenter', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      el.classList.add('is-dropping');
    });
    el.addEventListener('dragover', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      el.classList.add('is-dropping');
    });
    el.addEventListener('dragleave', function (e) {
      if (!dragHasFiles(e)) return;
      if (stillInside(e)) return;
      el.classList.remove('is-dropping');
    });
    el.addEventListener('drop', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('is-dropping');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var list = Array.prototype.filter.call(files, acceptedFile);
      if (!list.length) {
        toast('Attach a PDF, an image (JPG, PNG, WebP), or a text file.', true);
        return;
      }
      if (list.length < files.length) toast('Some files were skipped. PDF, image, or text only.', true);
      attachFiles(ctx, list);
    });
  }

  function readyAttachments(ctx) {
    return (ctx && ctx.pending || []).filter(function (e) { return e.status === 'ready' && e.id; });
  }

  function renderAttachStrip(ctx) {
    if (!ctx || !ctx.attachEl) return;
    var list = ctx.pending || [];
    ctx.attachEl.innerHTML = '';
    ctx.attachEl.hidden = !list.length;
    list.forEach(function (entry) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tma-bespoke__file-remove';
      remove.setAttribute('aria-label', 'Remove ' + entryName(entry));
      remove.innerHTML = '<img src="' + CLOSE + '" alt="" width="10" height="10">';
      remove.addEventListener('click', function (e) {
        e.stopPropagation();
        if (entry.thumbRevoke && entry.thumb) URL.revokeObjectURL(entry.thumb);
        if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
        ctx.pending = ctx.pending.filter(function (item) { return item !== entry; });
        renderAttachStrip(ctx);
        resizeInput(ctx);
      });
      ctx.attachEl.appendChild(previewTile(entry, remove));
    });
    resizeInput(ctx);
  }

  /* Each file goes up as it is picked, a PDF with the text read out of it,
   * so the send itself only names what is already there. */
  function attachFiles(ctx, files) {
    if (!ctx || !files || !files.length) return;
    var room = MAX_FILES - (ctx.pending || []).length;
    var chosen = Array.prototype.slice.call(files, 0, Math.max(0, room));
    if (files.length > room) toast('Up to ' + MAX_FILES + ' files per message.', true);
    chosen.forEach(function (file) {
      var entry = { file: file, name: file.name, size: file.size, mime: file.type, status: 'uploading', id: null };
      ctx.pending.push(entry);
      renderAttachStrip(ctx);
      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      var read = isPdf
        ? extractPdfText(file).catch(function () { return { text: '', pages: null }; })
        : Promise.resolve({ text: null, pages: null });
      read.then(function (extracted) {
        var form = new FormData();
        form.append('file', file, file.name);
        form.append('conversationId', ensureConversation(ctx));
        if (extracted.text !== null && extracted.text !== undefined) form.append('text', extracted.text);
        if (extracted.pages !== null && extracted.pages !== undefined) form.append('pages', String(extracted.pages));
        return apiForm('/portal/bespoke/attachments', form);
      }).then(function (data) {
        var a = data && data.attachment;
        if (!a || !a.id) throw new Error('no attachment');
        entry.status = 'ready';
        entry.id = a.id;
        entry.url = a.url;
        entry.size = a.size;
        entry.mime = a.mime;
        entry.payload = a;
        renderAttachStrip(ctx);
      }).catch(function (err) {
        entry.status = 'failed';
        var msg = err && err.data && err.data.message ? String(err.data.message) : 'Could not upload';
        entry.error = msg.length > 48 ? 'Could not upload' : msg;
        renderAttachStrip(ctx);
        toast(msg, true);
      });
    });
  }

  function localChips() {
    var path = currentPath();
    var cip = path.indexOf('/citizenship-applications') === 0;
    if (cip && (path.indexOf('/new') !== -1 || /\/edit$/.test(path))) {
      return [
        { id: 'required', label: 'What’s required to file?', prompt: 'What’s required to file?' },
        { id: 'photo', label: 'Photo rules', prompt: 'What photo size is required?' },
        { id: 'dependents', label: 'How do dependents work?', prompt: 'How do dependents work?' }
      ];
    }
    if (cip) {
      return [
        { id: 'start-cip', label: 'Create a pre-approval application', prompt: 'How do I start a CIP application?' },
        { id: 'queues', label: 'What are the queues?', prompt: 'What are the queues?' }
      ];
    }
    if (path.indexOf('/folders') === 0) {
      return [
        { id: 'pin', label: 'Pin a folder shortcut', prompt: 'How do I pin a folder?' },
        { id: 'filebox', label: 'What’s File Box?', prompt: 'What’s File Box?' }
      ];
    }
    if (path === '/account-settings' || path === '/settings') {
      return [
        { id: '2fa', label: 'Turn on 2FA', prompt: 'How do I turn on two-factor?' },
        { id: 'sidebar', label: 'Change sidebar style', prompt: 'How do I change sidebar style?' }
      ];
    }
    if (isPagePath(path)) {
      return [
        { id: 'dash-what', label: 'What’s on this dashboard?', prompt: 'What’s on this dashboard?' },
        { id: 'start-cip', label: 'How do I start a CIP application?', prompt: 'How do I start a CIP application?' },
        { id: 'files-where', label: 'Where is File Library?', prompt: 'Where is File Library?' }
      ];
    }
    return [
      { id: 'dash-what', label: 'What’s on this dashboard?', prompt: 'What’s on this dashboard?' },
      { id: 'start-cip', label: 'How do I start a CIP application?', prompt: 'How do I start a CIP application?' },
      { id: 'files-where', label: 'Where is File Library?', prompt: 'Where is File Library?' },
      { id: 'autosave', label: 'How does draft autosave work?', prompt: 'How does draft autosave work?' }
    ];
  }

  function renderChips(ctx, chips) {
    if (!ctx || !ctx.chipsEl) return;
    ctx.chipsEl.innerHTML = '';
    if (!chips || !chips.length || ctx.messages.length) {
      ctx.chipsEl.hidden = true;
      return;
    }
    ctx.chipsEl.hidden = false;
    chips.forEach(function (chip, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-bespoke__chip is-rising';
      btn.style.animationDelay = (index * 70) + 'ms';
      btn.textContent = chip.label;
      btn.addEventListener('click', function () {
        if (chip.path && !chip.prompt) {
          go(chip.path);
          return;
        }
        ask(ctx, chip.prompt || chip.label);
      });
      ctx.chipsEl.appendChild(btn);
    });
  }

  function appendRow(ctx, role, html, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'tma-bespoke__row tma-bespoke__row--' + role;
    if (opts.arrive) row.classList.add('is-arriving');
    if (role === 'assistant') {
      var img = document.createElement('img');
      img.className = 'tma-bespoke__avatar tma-bespoke__mark';
      img.src = MARK;
      img.alt = '';
      img.width = 24;
      img.height = 24;
      row.appendChild(img);
    }
    var bubble = document.createElement('div');
    bubble.className = 'tma-bespoke__bubble';
    bubble.innerHTML = html;
    mountFilePreviews(bubble, opts.attachments);
    if (opts.copy) {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'tma-bespoke__copy';
      copy.innerHTML = '<img src="' + COPY + '" alt="" width="12" height="12"> Copy';
      copy.addEventListener('click', function () {
        var text = bubble.innerText || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            copy.textContent = 'Copied';
            setTimeout(function () { copy.innerHTML = '<img src="' + COPY + '" alt="" width="12" height="12"> Copy'; }, 1200);
          });
        }
      });
      bubble.appendChild(copy);
    }
    row.appendChild(bubble);
    ctx.logEl.appendChild(row);
    ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
    return bubble;
  }

  function typeInto(ctx, bubble, text) {
    var copy = looksLikeDraft(text);
    bubble.innerHTML = renderLite(text);
    if (copy) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-bespoke__copy';
      btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text.replace(/\*\*/g, ''));
          btn.textContent = 'Copied';
        }
      });
      bubble.appendChild(btn);
    }
    ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
    announce(ctx, text);
  }

  function announce(ctx, text) {
    if (!ctx.liveEl) return;
    ctx.liveEl.textContent = text.replace(/\s+/g, ' ').slice(0, 280);
  }

  function ensureConversation(ctx) {
    if (!isUuid(ctx.conversationId)) {
      ctx.conversationId = uuid();
      convSet(ctx.conversationId);
    }
    return ctx.conversationId;
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  function resizeInput(ctx) {
    if (!ctx.inputEl) return;
    ctx.inputEl.style.height = 'auto';
    ctx.inputEl.style.height = Math.min(ctx.inputEl.scrollHeight, 4 * 22 + 16) + 'px';
    if (ctx.sendBtn) {
      ctx.sendBtn.disabled = ctx.busy || (!String(ctx.inputEl.value || '').trim() && !readyAttachments(ctx).length);
    }
  }

  function paintLog(ctx) {
    if (!ctx.logEl) return;
    ctx.logEl.innerHTML = '';
    ctx.messages.forEach(function (row) {
      appendRow(ctx, row.role, renderLite(row.content), {
        copy: row.role === 'assistant' && looksLikeDraft(row.content),
        attachments: row.attachments
      });
    });
  }

  function refreshSuggestions(ctx) {
    var path = currentPath();
    var qs = '?path=' + encodeURIComponent(path) +
      '&view=' + encodeURIComponent(currentView()) +
      '&title=' + encodeURIComponent(currentTitle());
    return api('/portal/bespoke/suggestions' + qs).then(function (data) {
      configured = !!data.configured;
      if (Array.isArray(data.faq) && data.faq.length) faq = data.faq;
      if (Array.isArray(data.allowedPaths) && data.allowedPaths.length) allowedPaths = data.allowedPaths;
      if (ctx && ctx.bannerEl) ctx.bannerEl.hidden = configured;
      if (ctx && ctx.subEl) ctx.subEl.textContent = data.subtitle || 'How can I help?';
      if (ctx === widget) refreshHello(data.subtitle || '');
      if (ctx) renderChips(ctx, data.chips || []);
      if (window.TMACurrentUser && window.TMACurrentUser.get) {
        var me = window.TMACurrentUser.get();
        if (me && me.bespoke) me.bespoke.configured = configured;
      }
      return data;
    }).catch(function (err) {
      if (err && err.notFound) {
        destroy();
        return;
      }
      if (ctx) renderChips(ctx, localChips());
    });
  }

  function clearChoices(ctx) {
    if (!ctx || !ctx.logEl) return;
    ctx.logEl.querySelectorAll('[data-bespoke-choices]').forEach(function (el) { el.remove(); });
  }

  /* Reply buttons the model asked for: the reader picks one, and the label
   * goes back as their own message. Gone as soon as they type instead. */
  function renderChoices(ctx, choices) {
    clearChoices(ctx);
    if (!ctx || !ctx.logEl || !Array.isArray(choices) || !choices.length) return;
    var row = document.createElement('div');
    row.className = 'tma-bespoke__choices';
    row.setAttribute('data-bespoke-choices', '');
    choices.slice(0, 4).forEach(function (label) {
      label = String(label || '').trim();
      if (!label) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-bespoke__chip';
      btn.textContent = label;
      btn.addEventListener('click', function () { ask(ctx, label); });
      row.appendChild(btn);
    });
    ctx.logEl.appendChild(row);
    ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
  }

  function cardButton(label, kind) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tma-bespoke__card-btn' + (kind ? ' tma-bespoke__card-btn--' + kind : '');
    btn.textContent = label;
    return btn;
  }

  function cardShell(ctx, kind) {
    var row = document.createElement('div');
    row.className = 'tma-bespoke__row tma-bespoke__row--card';
    var card = document.createElement('div');
    card.className = 'tma-bespoke__card tma-bespoke__card--' + kind;
    card.setAttribute('data-bespoke-card', kind);
    row.appendChild(card);
    ctx.logEl.appendChild(row);
    ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
    return card;
  }

  function cardDone(card, html) {
    card.classList.add('is-done');
    card.innerHTML = '<p class="tma-bespoke__card-done">' + html + '</p>';
  }

  function toast(message, failed) {
    var ui = window.TMAPortalUI;
    if (ui && ui.toast) ui.toast(message, failed ? { state: 'failure' } : undefined);
  }

  /* A drafted portal message. Send asks once more, then the reader's own
   * click posts it — the model never sends anything. */
  function renderMessageCard(ctx, action) {
    var to = action.to || {};
    var card = cardShell(ctx, 'message');
    var who = escapeHtml(to.name || 'someone') + (to.jobTitle ? ' <span class="tma-bespoke__card-muted">· ' + escapeHtml(to.jobTitle) + '</span>' : '');
    card.innerHTML =
      '<p class="tma-bespoke__card-head">Message to ' + who + '</p>' +
      '<textarea class="tma-bespoke__card-body" rows="5" aria-label="Message text"></textarea>' +
      '<div class="tma-bespoke__card-foot" data-bespoke-card-foot></div>';
    var body = card.querySelector('.tma-bespoke__card-body');
    body.value = String(action.body || '');
    var foot = card.querySelector('[data-bespoke-card-foot]');

    function idle() {
      foot.innerHTML = '';
      var send = cardButton('Send', 'primary');
      var cancel = cardButton('Cancel', 'ghost');
      send.addEventListener('click', confirm);
      cancel.addEventListener('click', function () { cardDone(card, 'Draft discarded.'); });
      foot.appendChild(send);
      foot.appendChild(cancel);
    }

    function confirm() {
      if (!String(body.value || '').trim()) {
        body.focus();
        return;
      }
      foot.innerHTML = '<span class="tma-bespoke__card-ask">Send this to ' + escapeHtml(to.name || 'them') + '?</span>';
      var yes = cardButton('Yes, send', 'primary');
      var no = cardButton('No', 'ghost');
      yes.addEventListener('click', doSend);
      no.addEventListener('click', idle);
      foot.appendChild(yes);
      foot.appendChild(no);
      yes.focus();
    }

    function doSend() {
      var text = String(body.value || '').trim();
      body.disabled = true;
      foot.innerHTML = '<span class="tma-bespoke__card-ask">Sending…</span>';
      api('/portal/bespoke/actions/send-message', {
        method: 'POST',
        body: { userId: to.userId, body: text, conversationId: ctx.conversationId || null }
      }).then(function (data) {
        var url = data && data.url ? String(data.url) : '/social/messages';
        cardDone(card, 'Sent to ' + escapeHtml(to.name || 'them') + '. <a href="' + escapeHtml(url) + '" data-bespoke-nav="' + escapeHtml(url) + '">Open Messages</a>');
        toast('Message sent');
        var note = (data && data.note) || ('Sent to ' + (to.name || 'them') + '.');
        ctx.messages.push({ role: 'assistant', content: note });
        if (typeof ctx.afterReply === 'function') ctx.afterReply({});
      }).catch(function () {
        body.disabled = false;
        toast('The message could not be sent.', true);
        idle();
      });
    }

    idle();
    return card;
  }

  /* A drafted email. It opens in the Email page's composer, signature and
   * all, and the reader sends it from there. */
  function renderEmailCard(ctx, action) {
    var card = cardShell(ctx, 'email');
    var to = Array.isArray(action.to) ? action.to.join(', ') : String(action.to || '');
    var cc = Array.isArray(action.cc) ? action.cc.join(', ') : String(action.cc || '');
    card.innerHTML =
      '<p class="tma-bespoke__card-head">Email to ' + escapeHtml(to) + (cc ? ' <span class="tma-bespoke__card-muted">· cc ' + escapeHtml(cc) + '</span>' : '') + '</p>' +
      '<p class="tma-bespoke__card-subject">' + escapeHtml(action.subject || '(no subject)') + '</p>' +
      '<pre class="tma-bespoke__card-pre">' + escapeHtml(action.body || '') + '</pre>' +
      '<div class="tma-bespoke__card-foot" data-bespoke-card-foot></div>';
    var foot = card.querySelector('[data-bespoke-card-foot]');
    var openBtn = cardButton('Open in Email', 'primary');
    var cancel = cardButton('Cancel', 'ghost');
    openBtn.addEventListener('click', function () {
      try {
        sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify({
          to: to, cc: cc, subject: String(action.subject || ''), body: String(action.body || ''), at: Date.now()
        }));
      } catch (e) { /* private mode: the composer opens blank */ }
      cardDone(card, 'Opened in Email.');
      if (host && open) setOpen(false);
      go('/email');
    });
    cancel.addEventListener('click', function () { cardDone(card, 'Draft discarded.'); });
    foot.appendChild(openBtn);
    foot.appendChild(cancel);
    return card;
  }

  /* Invite a colleague at this Service Provider admin's firm. Add asks once
   * more, then the reader's own click posts it — the model never invites. */
  function renderInviteCard(ctx, action) {
    var email = String(action.email || '');
    var name = String(action.name || '');
    var company = action.company || {};
    var firm = String(company.name || 'your firm');
    var url = String(action.url || '/citizenship-applications');
    var existing = !!action.existingAccount;
    var resend = !!action.willResend;
    var who = name ? name + ' (' + email + ')' : email;
    var head = existing
      ? 'Add as service provider contact'
      : (resend ? 'Resend invitation' : 'Invite as service provider contact');
    var ask = existing
      ? 'Add ' + who + ' to ' + firm + '? They already have a portal account.'
      : (resend
        ? 'Resend the invitation to ' + email + ' for ' + firm + '?'
        : 'Invite ' + who + ' to ' + firm + '? They will join as a service provider contact.');

    var card = cardShell(ctx, 'invite');
    card.innerHTML =
      '<p class="tma-bespoke__card-head">' + escapeHtml(head) + ' <span class="tma-bespoke__card-muted">· ' + escapeHtml(firm) + '</span></p>' +
      '<p class="tma-bespoke__card-ask">' + escapeHtml(ask) + '</p>' +
      '<div class="tma-bespoke__card-foot" data-bespoke-card-foot></div>';
    var foot = card.querySelector('[data-bespoke-card-foot]');

    function idle() {
      foot.innerHTML = '';
      var add = cardButton('Add', 'primary');
      var cancel = cardButton('Cancel', 'ghost');
      add.addEventListener('click', confirm);
      cancel.addEventListener('click', function () { cardDone(card, 'Invitation discarded.'); });
      foot.appendChild(add);
      foot.appendChild(cancel);
    }

    function confirm() {
      foot.innerHTML = '<span class="tma-bespoke__card-ask">Add them to ' + escapeHtml(firm) + '?</span>';
      var yes = cardButton('Yes, add', 'primary');
      var no = cardButton('No', 'ghost');
      yes.addEventListener('click', doInvite);
      no.addEventListener('click', idle);
      foot.appendChild(yes);
      foot.appendChild(no);
      yes.focus();
    }

    function doInvite() {
      foot.innerHTML = '<span class="tma-bespoke__card-ask">Adding…</span>';
      api('/portal/bespoke/actions/invite-provider-contact', {
        method: 'POST',
        body: { email: email, name: name || null, conversationId: ctx.conversationId || null }
      }).then(function (data) {
        var dest = data && data.url ? String(data.url) : url;
        var done = data && data.existingAccount
          ? 'Added to ' + escapeHtml(firm) + '.'
          : 'Invitation sent.';
        cardDone(card, done + ' <a href="' + escapeHtml(dest) + '" data-bespoke-nav="' + escapeHtml(dest) + '">Open ' + escapeHtml(firm) + '</a>');
        toast(data && data.existingAccount ? 'Added to ' + firm : 'Invitation sent');
        var note = (data && data.note) || done;
        ctx.messages.push({ role: 'assistant', content: note });
        if (typeof ctx.afterReply === 'function') ctx.afterReply({});
      }).catch(function () {
        toast('They could not be added.', true);
        idle();
      });
    }

    idle();
    return card;
  }

  /* ── 2×2 passport photo ─────────────────────────────────────────
   * Done here in the browser: pdf.js paints page 1, canvas crops. A PDF page
   * is trimmed of its white margins first (a photo on a page); an image is
   * taken as it is, since a passport photo's own background is white too and
   * trimming would eat it. Then a centre square, scaled to 600–1200 px:
   * 600 is 2 inches at 300 dpi, the floor the CIP intake accepts. */
  var PHOTO_MIN = 600;
  var PHOTO_MAX = 1200;

  function loadImageBitmap(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return loadImageElement(blob); });
    }
    return loadImageElement(blob);
  }

  function loadImageElement(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  function rasterizePdfPage(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      return loadPdfjs().then(function (lib) {
        return lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      });
    }).then(function (doc) {
      return doc.getPage(1).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var scale = Math.min(4, Math.max(1, 1800 / Math.max(1, Math.min(base.width, base.height))));
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // pdf.js 6 takes the canvas itself and paints the white background;
        // taking a 2d context before render() leaves the page blank.
        return page.render({ canvas: canvas, viewport: viewport, background: '#ffffff' }).promise.then(function () {
          try { doc.destroy(); } catch (e) { /* ignore */ }
          return { canvas: canvas, trim: true };
        });
      });
    });
  }

  /* Bounding box of everything that is not near-white. Falls back to the
   * whole canvas when nothing is found or the box is nearly the page. */
  function trimWhite(canvas) {
    var w = canvas.width;
    var h = canvas.height;
    var full = { x: 0, y: 0, w: w, h: h };
    var data;
    try {
      data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    } catch (e) {
      return full;
    }
    var step = Math.max(1, Math.round(Math.min(w, h) / 900));
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var i = (y * w + x) * 4;
        if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return full;
    var pad = Math.round(Math.min(w, h) * 0.01);
    var box = {
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      w: Math.min(w, maxX + step + pad) - Math.max(0, minX - pad),
      h: Math.min(h, maxY + step + pad) - Math.max(0, minY - pad)
    };
    if (box.w * box.h > w * h * 0.92 || box.w < 40 || box.h < 40) return full;
    return box;
  }

  /* Where the face is. Three readings, best first:
   *
   * 1. FaceDetector, the browser's own, when it exists (Chrome/Edge behind
   *    a flag, and the desktop shells). Exact, so it wins outright.
   * 2. Skin-tone clustering. Passport scans are a face on a plain ground,
   *    often beside a form; the largest run of skin-coloured pixels is the
   *    head far more reliably than the middle of the sheet is.
   * 3. The largest non-white region, which is what the old code did to a
   *    PDF page, kept as the floor.
   *
   * Everything works on a downscaled copy: 200 px on the short side is
   * plenty to find a head and keeps a 4000 px scan under a few ms. */

  function detectorCanvas(canvas) {
    var w = canvas.width;
    var h = canvas.height;
    var scale = Math.min(1, 200 / Math.max(1, Math.min(w, h)));
    var sw = Math.max(1, Math.round(w * scale));
    var sh = Math.max(1, Math.round(h * scale));
    var small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    small.getContext('2d').drawImage(canvas, 0, 0, sw, sh);
    return { canvas: small, scale: scale, w: sw, h: sh };
  }

  /* Skin in YCbCr, the usual band, widened a little so it holds across
   * skin tones and the warm cast a scanner adds. Luma is bounded to drop
   * near-black hair and blown-out white paper. */
  function isSkin(r, g, b) {
    var y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < 40 || y > 245) return false;
    var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cb < 77 || cb > 133 || cr < 133 || cr > 180) return false;
    // Skin is never blue-dominant, whatever the tone.
    return r > b - 4;
  }

  /* Largest connected run of skin pixels, as a box in FULL-image pixels.
   * Flood fill on a flat mask; iterative, because a 200×200 region would
   * blow a recursive stack. */
  function skinBox(canvas) {
    var d = detectorCanvas(canvas);
    var data;
    try {
      data = d.canvas.getContext('2d').getImageData(0, 0, d.w, d.h).data;
    } catch (e) {
      return null; // tainted canvas
    }
    var w = d.w, h = d.h, n = w * h;
    var mask = new Uint8Array(n);
    var skinCount = 0;
    for (var i = 0; i < n; i++) {
      var p = i * 4;
      if (data[p + 3] > 128 && isSkin(data[p], data[p + 1], data[p + 2])) {
        mask[i] = 1;
        skinCount++;
      }
    }
    // Too little skin to be a portrait, or so much that the whole sheet
    // read as skin (a cream background): trust the other readings instead.
    if (skinCount < n * 0.005 || skinCount > n * 0.7) return null;

    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var best = null;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || seen[s]) continue;
      var top = 0;
      stack[top++] = s;
      seen[s] = 1;
      var count = 0, minX = w, minY = h, maxX = -1, maxY = -1;
      while (top > 0) {
        var c = stack[--top];
        var cx = c % w, cy = (c - cx) / w;
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        // 4-neighbourhood; 8 merges a face with a bare shoulder too eagerly.
        if (cx > 0 && mask[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack[top++] = c - 1; }
        if (cx < w - 1 && mask[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack[top++] = c + 1; }
        if (cy > 0 && mask[c - w] && !seen[c - w]) { seen[c - w] = 1; stack[top++] = c - w; }
        if (cy < h - 1 && mask[c + w] && !seen[c + w]) { seen[c + w] = 1; stack[top++] = c + w; }
      }
      if (count < n * 0.004) continue;
      var bw = maxX - minX + 1, bh = maxY - minY + 1;
      var ratio = bw / Math.max(1, bh);
      // A head is roughly as tall as it is wide. A long thin run is an arm,
      // a shadow, or a strip of background, so it is not a candidate.
      if (ratio < 0.35 || ratio > 2.6) continue;
      // Prefer the biggest, then the one nearer face-shaped.
      var shape = 1 - Math.min(1, Math.abs(ratio - 0.78) / 1.5);
      var score = count * (0.6 + 0.4 * shape);
      if (!best || score > best.score) {
        best = { score: score, x: minX, y: minY, w: bw, h: bh };
      }
    }
    if (!best) return null;
    var k = 1 / d.scale;
    return {
      x: best.x * k,
      y: best.y * k,
      w: best.w * k,
      h: best.h * k,
      source: 'skin'
    };
  }

  /* The browser's own detector, when the build carries one. */
  function nativeFaceBox(canvas) {
    if (typeof window.FaceDetector !== 'function') return Promise.resolve(null);
    var det;
    try {
      det = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
    } catch (e) {
      return Promise.resolve(null);
    }
    return det.detect(canvas).then(function (faces) {
      if (!faces || !faces.length) return null;
      // The largest face is the subject; a passport scan may catch a
      // second, smaller one in a signature or a stamp.
      var pick = null;
      faces.forEach(function (f) {
        var b = f.boundingBox || f;
        if (!b || !b.width) return;
        if (!pick || b.width * b.height > pick.width * pick.height) pick = b;
      });
      if (!pick) return null;
      return { x: pick.x, y: pick.y, w: pick.width, h: pick.height, source: 'native' };
    }).catch(function () { return null; });
  }

  /* A passport crop is not the face box: the face sits in the upper middle
   * with headroom above and shoulders below. ICAO-style proportions put the
   * head at about 70% of the frame height, eyes a little above centre —
   * these numbers come from that, rounded to something forgiving. */
  function frameFromFace(face, canvas) {
    // The detected skin is the face alone. The head with hair is taller
    // and a little wider, and the passport frame holds the head plus
    // headroom and shoulders, so the square is built from the larger of
    // the two dimensions with generous room around it.
    var side = Math.max(face.w / 0.52, face.h / 0.50);
    var cx = face.x + face.w / 2;

    // The box is placed from its TOP, not its centre: the skin reading
    // starts at the forehead, so hair sits above it and would be sliced
    // off by a centred frame. A fifth of the frame is left over the top
    // of the detected skin, which covers hair and the headroom a passport
    // photo wants. The native detector's box starts higher, so it needs
    // less — hence the smaller share when it is the one that found it.
    var above = side * (face.source === 'native' ? 0.16 : 0.26);
    var x = cx - side / 2;
    var y = face.y - above;

    // Keep the frame on the picture without letting it drift off the face:
    // clamp, and shrink only if the picture is genuinely smaller.
    side = Math.min(side, canvas.width, canvas.height);
    x = Math.max(0, Math.min(x, canvas.width - side));
    y = Math.max(0, Math.min(y, canvas.height - side));
    return { x: x, y: y, side: side, source: face.source };
  }

  /* The frame to cut, best reading first. Always resolves. */
  function findFrame(canvas, allowTrim) {
    return nativeFaceBox(canvas).then(function (face) {
      if (!face) {
        try { face = skinBox(canvas); } catch (e) { face = null; }
      }
      if (face) return frameFromFace(face, canvas);

      // Nothing face-like. Fall back to the old behaviour: the non-white
      // region for a rasterized page, the whole picture otherwise, then
      // its centre square.
      var box = allowTrim
        ? trimWhite(canvas)
        : { x: 0, y: 0, w: canvas.width, h: canvas.height };
      var side = Math.min(box.w, box.h);
      return {
        x: box.x + (box.w - side) / 2,
        y: box.y + (box.h - side) / 2,
        side: side,
        source: 'centre'
      };
    });
  }

  /* The picture itself, fetched once. An adjustment re-cuts from this
   * canvas rather than going back to the network. */
  function loadPhotoSource(a) {
    return fetch(a.url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('fetch ' + res.status);
      return res.blob();
    }).then(function (blob) {
      if (a.isPdf || blob.type === 'application/pdf') return rasterizePdfPage(blob);
      return loadImageBitmap(blob).then(function (img) {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        if (img.close) img.close();
        return { canvas: canvas, trim: false };
      });
    });
  }

  /* Cut one square out of the loaded picture. `frame` is in source pixels;
   * the output is always square and at least PHOTO_MIN on a side. */
  function cutSquare(canvas, frame) {
    var side = frame.side;
    if (side < 40) throw new Error('empty');
    var out = Math.round(Math.max(PHOTO_MIN, Math.min(PHOTO_MAX, side)));
    var outCanvas = document.createElement('canvas');
    outCanvas.width = out;
    outCanvas.height = out;
    var c = outCanvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out, out);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, frame.x, frame.y, side, side, 0, 0, out, out);
    return new Promise(function (resolve, reject) {
      outCanvas.toBlob(function (b) {
        if (b) resolve({ blob: b, size: out, upscaled: side < PHOTO_MIN, frame: frame });
        else reject(new Error('blob'));
      }, 'image/jpeg', 0.92);
    });
  }

  function renderPhotoCard(ctx, action) {
    var a = action.attachment || {};
    // A re-frame from the thread supersedes the crop already filed, from
    // its very first save; a fresh crop has nothing to replace yet.
    var supersedes = !!action.reframe;
    var card = cardShell(ctx, 'photo');
    card.innerHTML =
      '<p class="tma-bespoke__card-head">2\u00d72 photo from ' + escapeHtml(a.name || 'file') + '</p>' +
      '<p class="tma-bespoke__card-ask" data-bespoke-photo-status>Finding the face\u2026</p>' +
      '<div class="tma-bespoke__photo-making" data-bespoke-photo-making>' +
        '<div class="tma-bespoke__photo-making-frame">' +
          '<span class="tma-bespoke__photo-making-sweep"></span>' +
          '<span class="tma-bespoke__photo-making-corner tma-bespoke__photo-making-corner--tl"></span>' +
          '<span class="tma-bespoke__photo-making-corner tma-bespoke__photo-making-corner--tr"></span>' +
          '<span class="tma-bespoke__photo-making-corner tma-bespoke__photo-making-corner--bl"></span>' +
          '<span class="tma-bespoke__photo-making-corner tma-bespoke__photo-making-corner--br"></span>' +
        '</div>' +
      '</div>' +
      '<div class="tma-bespoke__photo" data-bespoke-photo hidden></div>' +
      '<div class="tma-bespoke__photo-editor" data-bespoke-photo-editor hidden>' +
        '<div class="tma-bespoke__photo-stage" data-bespoke-photo-stage>' +
          '<canvas class="tma-bespoke__photo-canvas" data-bespoke-photo-canvas></canvas>' +
        '</div>' +
        '<label class="tma-bespoke__photo-zoom">' +
          '<span class="tma-bespoke__photo-zoom-label">Zoom</span>' +
          '<input type="range" class="tma-bespoke__photo-range" data-bespoke-photo-range' +
            ' min="0" max="100" value="0" aria-label="Zoom">' +
        '</label>' +
        '<p class="tma-bespoke__photo-hint">Drag the bright square over the face; zoom to resize it.</p>' +
      '</div>' +
      '<div class="tma-bespoke__card-foot" data-bespoke-card-foot></div>';

    var status = card.querySelector('[data-bespoke-photo-status]');
    var making = card.querySelector('[data-bespoke-photo-making]');
    var slot = card.querySelector('[data-bespoke-photo]');
    var editor = card.querySelector('[data-bespoke-photo-editor]');
    var stage = card.querySelector('[data-bespoke-photo-stage]');
    var view = card.querySelector('[data-bespoke-photo-canvas]');
    var range = card.querySelector('[data-bespoke-photo-range]');
    var foot = card.querySelector('[data-bespoke-card-foot]');
    // "-2x2" only once, however many times this is re-opened: the name has
    // to keep matching so a re-frame supersedes the crop it replaces.
    var base = String(a.name || 'photo').replace(/\.[^.]+$/, '').replace(/-2x2$/, '');
    var filename = base + '-2x2.jpg';

    // Held across adjustments so moving the frame never refetches or re-detects.
    var source = null;
    var frame = null;
    var detected = null;
    var objectUrl = null;
    var link = null;
    var saveTimer = null;
    var savedOnce = supersedes;

    function describe(result) {
      var how = frame && frame.source === 'centre'
        ? 'No face found, so this is the middle of the picture'
        : frame && frame.source === 'manual'
          ? 'Framed by you'
          : 'Cropped around the face';
      return how + '; ' + result.size + '\u00d7' + result.size + ' px, 2\u00d72 in at '
        + Math.round(result.size / 2) + ' dpi'
        + (result.upscaled ? '. The original was small, so expect some softness.' : '.');
    }

    /*
     * Show the WHOLE picture, with the square that will be kept cut out of
     * a dim wash over it.
     *
     * The first go at this painted only the frame's contents, which looked
     * tidy and told the reader nothing: with no edges and no surroundings
     * there was no way to see what was being cut off, or that dragging
     * moved anything. A crop tool has to show what it is discarding.
     *
     * Every drag and zoom tick comes through here and nothing else — canvas
     * work in the browser, so it costs nothing. It deliberately does NOT save.
     */
    function paint() {
      if (!source || !frame) return;

      // The stage is a square by CSS; measure it, and fall back to the
      // width when height has not settled yet (a card painted in the same
      // frame it was appended has no laid-out height to read).
      var box = Math.round(Math.min(
        stage.clientWidth || 0,
        stage.clientHeight || stage.clientWidth || 0
      ) || stage.clientWidth || 260);
      if (box <= 0) return;
      var img = source.canvas;

      // The picture, letterboxed to fit the stage. `scale` and the offsets
      // convert source pixels to stage pixels, and back again when a drag
      // has to be turned into a move of the frame.
      var scale = Math.min(box / img.width, box / img.height);
      var drawW = img.width * scale;
      var drawH = img.height * scale;
      var offX = (box - drawW) / 2;
      var offY = (box - drawH) / 2;
      view._fit = { scale: scale, offX: offX, offY: offY, box: box };

      // A square backing store, or the picture is stretched into whatever
      // shape the canvas element happened to have.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var pixels = Math.round(box * dpr);
      if (view.width !== pixels || view.height !== pixels) {
        view.width = pixels;
        view.height = pixels;
      }

      var c = view.getContext('2d');
      c.save();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, box, box);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, img.width, img.height, offX, offY, drawW, drawH);

      // Everything outside the keep-square goes under a wash, so the edges
      // of the crop are the one thing the eye lands on.
      var fx = offX + frame.x * scale;
      var fy = offY + frame.y * scale;
      var fs = frame.side * scale;

      c.fillStyle = 'rgba(17, 17, 17, 0.55)';
      c.beginPath();
      c.rect(0, 0, box, box);
      c.rect(fx, fy, fs, fs);
      c.fill('evenodd');

      // The cut line, and thirds inside it to line the eyes up against.
      c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      c.lineWidth = 2;
      c.strokeRect(fx + 1, fy + 1, fs - 2, fs - 2);

      c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      c.lineWidth = 1;
      c.beginPath();
      for (var i = 1; i < 3; i++) {
        c.moveTo(fx + (fs / 3) * i, fy);
        c.lineTo(fx + (fs / 3) * i, fy + fs);
        c.moveTo(fx, fy + (fs / 3) * i);
        c.lineTo(fx + fs, fy + (fs / 3) * i);
      }
      c.stroke();

      // Corner ticks, so the square reads as a frame and not a border.
      var arm = Math.max(10, Math.min(22, fs * 0.18));
      c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(fx, fy + arm); c.lineTo(fx, fy); c.lineTo(fx + arm, fy);
      c.moveTo(fx + fs - arm, fy); c.lineTo(fx + fs, fy); c.lineTo(fx + fs, fy + arm);
      c.moveTo(fx, fy + fs - arm); c.lineTo(fx, fy + fs); c.lineTo(fx + arm, fy + fs);
      c.moveTo(fx + fs - arm, fy + fs); c.lineTo(fx + fs, fy + fs); c.lineTo(fx + fs, fy + fs - arm);
      c.stroke();
      c.restore();
    }

    /*
     * One photo in the chat, not one per nudge.
     *
     * Adjusting used to upload on every single frame, so a reader who
     * dragged the crop into place left a trail of half-framed photos behind
     * them. The save now waits until the adjusting stops, and replaces the
     * copy it saved before instead of adding another.
     */
    function saveSoon() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        save();
      }, 700);
    }

    function save() {
      if (!source || !frame) return Promise.resolve();
      return cutSquare(source.canvas, frame).then(function (result) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(result.blob);
        status.textContent = describe(result);
        if (link) link.href = objectUrl;

        var form = new FormData();
        form.append('file', result.blob, filename);
        form.append('conversationId', ensureConversation(ctx));
        form.append('kind', 'derived');
        // Replaces the copy kept for this card rather than filing another.
        if (savedOnce) form.append('replaces', filename);
        // Where it was cut from, so reopening the chat can offer Adjust.
        if (a.id) form.append('sourceId', a.id);
        return apiForm('/portal/bespoke/attachments', form).then(function (data) {
          savedOnce = true;
          var d = data && data.attachment;
          if (d && d.url && link) link.href = d.url + '?download=1';
        }).catch(function () { /* the blob link still works */ });
      }).catch(function () {
        status.textContent = 'That adjustment did not work. The photo above is unchanged.';
      });
    }

    /* Zoom runs from the detected frame out to the whole picture. */
    function sideFor(pct) {
      var canvas = source.canvas;
      var widest = Math.min(canvas.width, canvas.height);
      var tightest = Math.max(40, Math.min(detected.side, widest));
      return tightest + (widest - tightest) * (pct / 100);
    }

    function clampFrame(next) {
      var canvas = source.canvas;
      next.side = Math.max(40, Math.min(next.side, canvas.width, canvas.height));
      next.x = Math.max(0, Math.min(next.x, canvas.width - next.side));
      next.y = Math.max(0, Math.min(next.y, canvas.height - next.side));
      return next;
    }

    function zoomTo(pct) {
      if (!source || !frame || !detected) return;
      var side = sideFor(pct);
      // Zoom about the middle, so the face does not walk out of frame.
      var cx = frame.x + frame.side / 2;
      var cy = frame.y + frame.side / 2;
      frame = clampFrame({ x: cx - side / 2, y: cy - side / 2, side: side, source: 'manual' });
      paint();
      saveSoon();
    }

    /* Drag the picture under the frame. Pointer events cover mouse, pen and
       touch in one path, so a phone drags exactly like a desktop does. */
    var dragging = false;
    var dragId = null;
    var startX = 0;
    var startY = 0;
    var startFrameX = 0;
    var startFrameY = 0;

    stage.addEventListener('pointerdown', function (e) {
      if (!source || !frame) return;
      dragging = true;
      dragId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startFrameX = frame.x;
      startFrameY = frame.y;
      stage.classList.add('is-dragging');
      try { stage.setPointerCapture(dragId); } catch (err) { /* older engines */ }
      e.preventDefault();
    });

    stage.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== dragId) return;
      // The picture is still; the frame is what the finger carries, so the
      // square follows the pointer one-for-one. The fit scale converts
      // stage pixels back into source pixels.
      var fit = view._fit;
      if (!fit || !fit.scale) return;
      frame = clampFrame({
        x: startFrameX + (e.clientX - startX) / fit.scale,
        y: startFrameY + (e.clientY - startY) / fit.scale,
        side: frame.side,
        source: 'manual'
      });
      paint();
      e.preventDefault();
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== dragId)) return;
      dragging = false;
      stage.classList.remove('is-dragging');
      try { stage.releasePointerCapture(dragId); } catch (err) { /* ignore */ }
      saveSoon();
    }

    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    range.addEventListener('input', function () {
      zoomTo(Number(range.value) || 0);
    });

    // A wheel over the picture zooms, the way every other cropper does.
    stage.addEventListener('wheel', function (e) {
      if (!source || !frame) return;
      e.preventDefault();
      var next = Math.max(0, Math.min(100, (Number(range.value) || 0) + (e.deltaY > 0 ? 4 : -4)));
      range.value = String(next);
      zoomTo(next);
    }, { passive: false });

    function ready(result) {
      making.hidden = true;
      slot.hidden = true;
      editor.hidden = false;
      status.textContent = describe(result);
      if (!link) {
        link = document.createElement('a');
        link.className = 'tma-bespoke__card-btn tma-bespoke__card-btn--primary';
        link.textContent = 'Download';
        link.download = filename;
        foot.appendChild(link);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(result.blob);
      link.href = objectUrl;
      paint();
      return save();
    }

    loadPhotoSource(a).then(function (src) {
      source = src;
      return findFrame(src.canvas, src.trim).then(function (found) {
        frame = found;
        detected = { x: found.x, y: found.y, side: found.side, source: found.source };
        return cutSquare(src.canvas, found);
      });
    }).then(function (result) {
      return ready(result);
    }).then(function () {
      ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
    }).catch(function () {
      making.hidden = true;
      status.textContent = 'The photo could not be prepared from this file.';
    });
    return card;
  }

  function renderActions(ctx, actions) {
    if (!ctx || !ctx.logEl || !Array.isArray(actions)) return;
    actions.forEach(function (action) {
      if (!action || typeof action !== 'object') return;
      if (action.type === 'message') renderMessageCard(ctx, action);
      else if (action.type === 'email') renderEmailCard(ctx, action);
      else if (action.type === 'invite-provider-contact') renderInviteCard(ctx, action);
      else if (action.type === 'photo2x2') renderPhotoCard(ctx, action);
    });
  }

  function thinkingHtml() {
    return '<span class="tma-bespoke__typing">' +
      '<span class="tma-bespoke__thinking-label">Thinking</span>' +
      '<span class="tma-bespoke__thinking-by">Powered by Grok</span>' +
      '</span>';
  }

  function setThinking(ctx, on) {
    var el = ctx && ctx.dropEl;
    if (el) el.classList.toggle('is-thinking', !!on);
  }

  function pulseSend(ctx) {
    if (!ctx || !ctx.sendBtn) return;
    ctx.sendBtn.classList.remove('is-sent');
    void ctx.sendBtn.offsetWidth;
    ctx.sendBtn.classList.add('is-sent');
  }

  function ask(ctx, text) {
    text = String(text || '').trim();
    if (!ctx || ctx.busy) return;
    stopDictation(ctx);
    var files = readyAttachments(ctx);
    if ((ctx.pending || []).some(function (e) { return e.status === 'uploading'; })) {
      toast('Still uploading. One moment.', true);
      return;
    }
    if (!text && !files.length) return;
    if (!text) text = files.length === 1 ? 'Here is a file.' : 'Here are ' + files.length + ' files.';
    var sent = files.map(function (e) {
      var payload = e.payload ? Object.assign({}, e.payload) : { id: e.id, name: e.name, url: e.url, mime: e.mime };
      payload.name = payload.name || e.name;
      payload.url = payload.url || e.url;
      payload.mime = payload.mime || e.mime;
      if (e.thumb) payload.thumb = e.thumb;
      if (e.snippet) payload.snippet = e.snippet;
      if (isImageEntry(e)) payload.isImage = true;
      if (isPdfEntry(e)) payload.isPdf = true;
      return payload;
    });
    clearChoices(ctx);
    ctx.messages.push({ role: 'user', content: text, attachments: sent });
    appendRow(ctx, 'user', renderLite(text), { attachments: sent, arrive: true });
    renderChips(ctx, []);
    if (ctx.inputEl) ctx.inputEl.value = '';
    ctx.pending = [];
    renderAttachStrip(ctx);
    resizeInput(ctx);
    pulseSend(ctx);
    ctx.busy = true;
    setThinking(ctx, true);
    if (ctx.sendBtn) ctx.sendBtn.disabled = true;
    announce(ctx, 'Thinking. Powered by Grok.');
    var bubble = appendRow(ctx, 'assistant', thinkingHtml(), { arrive: true });
    var local = matchFaq(text);

    api('/portal/bespoke/chat', {
      method: 'POST',
      body: {
        messages: ctx.messages.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }),
        conversationId: ensureConversation(ctx),
        attachments: sent.map(function (a) { return a.id; }).filter(Boolean),
        clientContext: {
          path: currentPath(),
          view: currentView(),
          title: currentTitle(),
          fieldHints: fieldHints()
        }
      }
    }).then(function (data) {
      configured = !!data.configured;
      if (ctx.bannerEl) ctx.bannerEl.hidden = configured;
      if (data.conversationId) {
        ctx.conversationId = data.conversationId;
        convSet(ctx.conversationId);
      }
      if (data.title && ctx.setTitle) ctx.setTitle(data.title);
      var reply = data.reply || '';
      ctx.messages.push({ role: 'assistant', content: reply });
      typeInto(ctx, bubble, reply);
      renderActions(ctx, data.actions || []);
      renderChoices(ctx, data.choices || []);
      if (typeof ctx.afterReply === 'function') ctx.afterReply(data);
    }).catch(function (err) {
      if (err && err.notFound) {
        destroy();
        return;
      }
      var fallback = local && local.answer
        ? local.answer
        : 'I could not reach Bespoke AI. Try a suggestion, or ask an administrator.';
      ctx.messages.push({ role: 'assistant', content: fallback });
      typeInto(ctx, bubble, fallback);
    }).then(function () {
      ctx.busy = false;
      setThinking(ctx, false);
      if (ctx.sendBtn) ctx.sendBtn.disabled = !String(ctx.inputEl && ctx.inputEl.value || '').trim() && !readyAttachments(ctx).length;
      if (ctx.inputEl) ctx.inputEl.focus();
    });
  }

  /* ── Dictation ───────────────────────────────────────────────────
   * The microphone beside Send: tap it, speak, and the words land in the
   * box as they are heard; tap again, type, or send to stop. Nothing goes
   * anywhere until the reader presses Send. Two ears: the browser's own
   * recognition first — free, no round trip, words as you say them — but
   * Chromium's is a call to a Google service the desktop shell, Brave and
   * unbranded builds do not carry, and every start there ends in
   * `network`. Then a clip is recorded here, phrase by phrase, and
   * transcribed by the server through the chat provider. The switch is
   * remembered per browser so the next tap does not fail first. */

  function recognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function recorderSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof window.MediaRecorder === 'function');
  }

  function dictationSupported() {
    return !!(recognitionClass() || recorderSupported());
  }

  function preferredEngine() {
    if (storeGet(LS_VOICE_ENGINE, '') === 'server' && recorderSupported()) return 'server';
    return recognitionClass() ? 'browser' : 'server';
  }

  function recorderMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function recorderExt(mime) {
    mime = String(mime || '').toLowerCase();
    if (mime.indexOf('mp4') !== -1) return 'm4a';
    if (mime.indexOf('ogg') !== -1) return 'ogg';
    if (mime.indexOf('wav') !== -1) return 'wav';
    return 'webm';
  }

  function dictationLang() {
    var lang = String(document.documentElement.getAttribute('lang') || '').trim();
    var nav = navigator.language || 'en-US';
    if (!lang) return nav;
    if (lang.length === 2 && nav.toLowerCase().indexOf(lang.toLowerCase() + '-') === 0) return nav;
    return lang;
  }

  function dictationState(ctx) {
    if (!ctx.dictation) {
      ctx.dictation = {
        active: false,
        engine: 'browser',
        rec: null,
        capture: null,
        meter: null,
        level: 0,
        base: '',
        committed: '',
        interim: '',
        placeholder: '',
        restarts: 0,
        busy: false
      };
    }
    return ctx.dictation;
  }

  function toggleDictation(ctx) {
    var d = dictationState(ctx);
    if (d.active) stopDictation(ctx);
    else startDictation(ctx);
  }

  function startDictation(ctx) {
    var d = dictationState(ctx);
    if (d.active || !ctx.inputEl || ctx.busy || !dictationSupported()) return;
    d.active = true;
    d.engine = preferredEngine();
    d.restarts = 0;
    d.busy = false;
    var current = String(ctx.inputEl.value || '');
    d.base = current.trim() ? current.replace(/\s+$/, '') + ' ' : '';
    d.committed = '';
    d.interim = '';
    d.placeholder = ctx.inputEl.getAttribute('placeholder') || '';
    ctx.inputEl.setAttribute('placeholder', 'Listening…');
    paintDictation(ctx);
    // With a pointer, the box keeps focus so Enter sends what was said;
    // on a touch screen that would raise the keyboard over the words.
    try {
      if (window.matchMedia && window.matchMedia('(hover: hover)').matches) ctx.inputEl.focus();
    } catch (e) { /* no matchMedia */ }
    dictationListen(ctx);
  }

  /* Whatever was still tentative is kept: the reader tapped stop after
   * saying it, not instead of it. */
  function stopDictation(ctx) {
    var d = ctx && ctx.dictation;
    if (!d || !d.active) return;
    d.active = false;
    haltEar(ctx);
    stopMeter(ctx);
    if (d.interim && d.interim !== '…') d.committed += d.interim.replace(/\s+$/, '') + ' ';
    d.interim = '';
    renderDictation(ctx);
    if (ctx.inputEl) ctx.inputEl.setAttribute('placeholder', d.placeholder || 'Ask about this portal');
    paintDictation(ctx);
  }

  function failDictation(ctx, message) {
    stopDictation(ctx);
    toast(message, true);
  }

  function renderDictation(ctx) {
    var d = dictationState(ctx);
    if (!ctx.inputEl) return;
    ctx.inputEl.value = d.base + d.committed + d.interim;
    resizeInput(ctx);
    ctx.inputEl.scrollTop = ctx.inputEl.scrollHeight;
  }

  function paintDictation(ctx) {
    var d = ctx.dictation;
    if (!ctx.micBtn) return;
    var on = !!(d && d.active);
    ctx.micBtn.classList.toggle('is-listening', on);
    ctx.micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    ctx.micBtn.setAttribute('aria-label', on ? 'Stop dictating' : 'Dictate');
    ctx.micBtn.setAttribute('title', on ? 'Stop' : 'Dictate');
  }

  function dictationListen(ctx) {
    var d = dictationState(ctx);
    if (!d.active) return;
    if (d.engine === 'server') serverEar(ctx);
    else browserEar(ctx);
  }

  function haltEar(ctx) {
    var d = dictationState(ctx);
    var rec = d.rec;
    var capture = d.capture;
    d.rec = null;
    d.capture = null;
    if (capture) {
      if (capture.timer) clearInterval(capture.timer);
      if (capture.rec) {
        try {
          capture.rec.ondataavailable = null;
          capture.rec.onstop = null;
          if (capture.rec.state !== 'inactive') capture.rec.stop();
        } catch (e) { /* already stopped */ }
      }
    }
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch (e) { /* already stopped */ }
    }
  }

  /* The browser's ear: continuous, with the tentative words shown as
   * they form. Chrome ends a session after a stretch of silence; it is
   * started again until the reader stops. */
  function browserEar(ctx) {
    var d = dictationState(ctx);
    var Rec = recognitionClass();
    if (!Rec) {
      d.engine = 'server';
      serverEar(ctx);
      return;
    }
    var rec;
    try {
      rec = new Rec();
    } catch (e) {
      failDictation(ctx, 'Voice isn’t available in this browser.');
      return;
    }
    rec.lang = dictationLang();
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    d.rec = rec;
    var switched = false;
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex || 0; i < e.results.length; i++) {
        var r = e.results[i];
        var t = String((r[0] && r[0].transcript) || '');
        if (r.isFinal) {
          t = t.replace(/\s+/g, ' ').trim();
          if (t) d.committed += t + ' ';
        } else {
          interim += t;
        }
      }
      d.interim = interim.replace(/\s+/g, ' ').replace(/^\s+/, '');
      d.restarts = 0;
      renderDictation(ctx);
    };
    rec.onerror = function (e) {
      var code = (e && e.error) || '';
      if (code === 'aborted' || code === 'no-speech') return;
      if (code === 'network' || code === 'service-not-allowed') {
        if (recorderSupported() && configured) {
          d.engine = 'server';
          storeSet(LS_VOICE_ENGINE, 'server');
          switched = true;
          return;
        }
        failDictation(ctx, 'Voice recognition isn’t available here.');
        return;
      }
      if (code === 'not-allowed') failDictation(ctx, 'Microphone access is blocked. Allow it in your browser settings.');
      else if (code === 'audio-capture') failDictation(ctx, 'No microphone was found.');
      else failDictation(ctx, 'I couldn’t hear you. Tap the mic to try again.');
    };
    rec.onend = function () {
      if (d.rec !== rec) return;
      d.rec = null;
      if (!d.active) return;
      if (switched) {
        serverEar(ctx);
        return;
      }
      if (d.restarts++ < 20) {
        setTimeout(function () {
          if (d.active && !d.rec) browserEar(ctx);
        }, 120);
        return;
      }
      stopDictation(ctx);
    };
    try {
      rec.start();
    } catch (e) {
      d.rec = null;
      failDictation(ctx, 'Voice isn’t available right now.');
    }
  }

  /* The server ear: record until the reader has spoken and then paused
   * (the meter's level is the voice detector), send the phrase, put the
   * words in the box, record the next. Eight quiet seconds with no voice
   * is a silent pass; thirty seconds is the longest phrase. */
  var CAPTURE_VOICE = 0.1;
  var CAPTURE_QUIET_MS = 1100;
  var CAPTURE_WAIT_MS = 8000;
  var CAPTURE_MAX_MS = 30000;

  function serverEar(ctx) {
    var d = dictationState(ctx);
    if (!d.active || d.capture || d.busy) return;
    if (!recorderSupported()) {
      failDictation(ctx, 'Voice isn’t available in this browser.');
      return;
    }
    var ticket = {};
    d.capture = ticket;
    ensureMeter(ctx).then(function (meter) {
      if (d.capture !== ticket) return;
      if (!d.active) {
        d.capture = null;
        return;
      }
      if (!meter || !meter.stream) {
        d.capture = null;
        failDictation(ctx, 'Microphone access is blocked. Allow it in your browser settings.');
        return;
      }
      var mime = recorderMime();
      var rec;
      try {
        rec = mime ? new MediaRecorder(meter.stream, { mimeType: mime }) : new MediaRecorder(meter.stream);
      } catch (e) {
        d.capture = null;
        failDictation(ctx, 'Voice isn’t available in this browser.');
        return;
      }
      var chunks = [];
      var spoke = false;
      var voiced = 0;
      var startedAt = Date.now();
      var lastVoice = 0;
      ticket.rec = rec;
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onstop = function () {
        if (d.capture !== ticket) return;
        d.capture = null;
        if (!d.active) return;
        if (!spoke || !chunks.length) {
          if (d.restarts++ < 6) serverEar(ctx);
          else failDictation(ctx, 'I didn’t catch that. Tap the mic to try again.');
          return;
        }
        transcribeInto(ctx, new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      };
      ticket.timer = setInterval(function () {
        if (d.capture !== ticket) {
          clearInterval(ticket.timer);
          return;
        }
        var now = Date.now();
        if ((d.level || 0) > CAPTURE_VOICE) {
          voiced++;
          if (voiced >= 2) {
            spoke = true;
            lastVoice = now;
          }
        } else {
          voiced = 0;
        }
        var done = spoke
          ? now - lastVoice > CAPTURE_QUIET_MS
          : now - startedAt > CAPTURE_WAIT_MS;
        if (done || now - startedAt > CAPTURE_MAX_MS) {
          clearInterval(ticket.timer);
          try { rec.stop(); } catch (e) { rec.onstop(); }
        }
      }, 100);
      try {
        rec.start(250);
      } catch (e) {
        clearInterval(ticket.timer);
        d.capture = null;
        failDictation(ctx, 'Voice isn’t available right now.');
      }
    });
  }

  /* The phrase comes back as words. A reader who tapped stop while it was
   * on its way still said it, so it lands either way. */
  function transcribeInto(ctx, blob) {
    var d = dictationState(ctx);
    d.busy = true;
    d.interim = '…';
    renderDictation(ctx);
    var form = new FormData();
    form.append('audio', blob, 'speech.' + recorderExt(blob.type));
    form.append('language', dictationLang().slice(0, 2).toLowerCase());
    apiForm('/portal/bespoke/transcribe', form).then(function (data) {
      d.busy = false;
      d.interim = '';
      var text = String((data && data.text) || '').replace(/\s+/g, ' ').trim();
      if (text) {
        d.committed += text + ' ';
        d.restarts = 0;
      }
      renderDictation(ctx);
      if (d.active) serverEar(ctx);
    }).catch(function (err) {
      d.busy = false;
      d.interim = '';
      renderDictation(ctx);
      try { console.warn('Bespoke AI transcription failed', err && err.status, err && err.data ? err.data : err); } catch (e) { /* no console */ }
      failDictation(ctx, transcribeFailure(err));
    });
  }

  /* What to say when a phrase came back without words. Each server answer
   * has its own line, since "couldn't hear you" once hid a session that
   * had expired, a clip the server would not take, and a provider that was
   * down behind one sentence. */
  function transcribeFailure(err) {
    var status = err && err.status;
    if (!err || (err.notFound || status === 503)) return 'Voice isn’t available here.';
    if (status === 419 || status === 401) return 'Your session has expired. Reload and try again.';
    if (status === 413) return 'That was too long for one go. Try a shorter phrase.';
    if (status === 422) return 'The clip wasn’t accepted. Tap the mic to try again.';
    if (status === 429) return 'Too many tries at once. Wait a moment.';
    if (status === 502) return 'I couldn’t make out the words. Tap the mic to try again.';
    if (typeof status !== 'number') return 'I couldn’t reach the portal. Check the connection and try again.';
    return 'I couldn’t hear you. Tap the mic to try again.';
  }

  /* The microphone stream and a level from it, for the server ear's voice
   * detector. Best effort: a refused stream is reported by the caller. */
  function startMeter(ctx) {
    var d = dictationState(ctx);
    if (d.meter) return d.meter.ready;
    var meter = { stream: null, audio: null, raf: 0, dead: false, ready: null };
    d.meter = meter;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      meter.ready = Promise.resolve(meter);
      return meter.ready;
    }
    meter.ready = navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (meter.dead) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        return meter;
      }
      meter.stream = stream;
      var audio = new AC();
      meter.audio = audio;
      if (audio.resume) audio.resume().catch(function () { /* gesture needed */ });
      var analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      var data = new Uint8Array(analyser.fftSize);
      var smooth = 0;
      function tick() {
        if (meter.dead) return;
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) {
          var v = (data[i] - 128) / 128;
          sum += v * v;
        }
        var level = Math.min(1, Math.sqrt(sum / data.length) * 6);
        smooth = smooth * 0.7 + level * 0.3;
        d.level = smooth;
        meter.raf = requestAnimationFrame(tick);
      }
      tick();
      return meter;
    }).catch(function () {
      return meter;
    });
    return meter.ready;
  }

  function ensureMeter(ctx) {
    var d = dictationState(ctx);
    return d.meter ? d.meter.ready : startMeter(ctx);
  }

  function stopMeter(ctx) {
    var d = dictationState(ctx);
    var meter = d.meter;
    d.level = 0;
    if (!meter) return;
    d.meter = null;
    meter.dead = true;
    if (meter.raf) cancelAnimationFrame(meter.raf);
    if (meter.stream) meter.stream.getTracks().forEach(function (t) { t.stop(); });
    if (meter.audio && meter.audio.close) meter.audio.close().catch(function () { /* already closed */ });
  }

  function bindComposer(ctx) {
    if (!ctx.formEl) return;
    ctx.formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      ask(ctx, ctx.inputEl.value);
    });
    ctx.inputEl.addEventListener('input', function () { resizeInput(ctx); });
    if (ctx.clipBtn && ctx.fileEl) {
      ctx.clipBtn.addEventListener('click', function () { ctx.fileEl.click(); });
      ctx.fileEl.addEventListener('change', function () {
        attachFiles(ctx, ctx.fileEl.files);
        ctx.fileEl.value = '';
      });
    }
    if (ctx.micBtn) {
      if (!dictationSupported()) ctx.micBtn.hidden = true;
      else ctx.micBtn.addEventListener('click', function () { toggleDictation(ctx); });
    }
    // A key in the box means the reader is typing; the ear steps back.
    ctx.inputEl.addEventListener('input', function () {
      if (ctx.dictation && ctx.dictation.active) stopDictation(ctx);
    });
    ctx.inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask(ctx, ctx.inputEl.value);
      }
    });
    ctx.logEl.addEventListener('click', onNavClick);
    ctx.logEl.addEventListener('click', onPreviewClick);
    if (ctx.attachEl) ctx.attachEl.addEventListener('click', onPreviewClick);
    if (ctx.dropEl) bindFileDrop(ctx, ctx.dropEl);
  }

  function onNavClick(e) {
    var a = e.target.closest && e.target.closest('[data-bespoke-nav]');
    if (!a) return;
    var href = a.getAttribute('data-bespoke-nav') || a.getAttribute('href');
    if (!href || href.charAt(0) !== '/') return;
    e.preventDefault();
    go(href);
  }

  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function confirmDelete(title, onYes) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) {
      if (window.confirm('Delete “' + title + '”? This cannot be undone.')) onYes();
      return;
    }
    ui.openModal({
      title: 'Delete chat',
      body: '<p>Delete “' + escapeHtml(title) + '”? This cannot be undone.</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-bespoke-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--danger" data-bespoke-ok>Delete</button>' +
        '</div>',
      onMount: function (modalHost) {
        modalHost.querySelector('[data-bespoke-cancel]').addEventListener('click', ui.closeModal);
        modalHost.querySelector('[data-bespoke-ok]').addEventListener('click', function () {
          ui.closeModal();
          onYes();
        });
      }
    });
  }

  /* ── Full page ─────────────────────────────────────────────── */

  function pageMarkup() {
    return '<div class="tma-bespoke-page">' +
      '<aside class="tma-bespoke-page__rail">' +
        '<div class="tma-bespoke-page__rail-head">' +
          '<p class="tma-bespoke-page__rail-title">Past chats</p>' +
          '<button type="button" class="tma-bespoke-page__new" data-bespoke-page-new>' +
            '<img src="' + PLUS + '" alt="" width="14" height="14"> New chat' +
          '</button>' +
        '</div>' +
        '<div class="tma-bespoke-page__list" data-bespoke-page-list></div>' +
      '</aside>' +
      // Drag to set how much of the page the history takes, the same way
      // the mailbox and messaging panes are sized.
      '<div class="tma-bespoke-page__resizer" data-bespoke-page-resizer role="separator"' +
        ' aria-orientation="vertical" aria-label="Resize past chats" tabindex="0"></div>' +
      '<section class="tma-bespoke-page__thread">' +
        '<div class="tma-bespoke-page__thread-head">' +
          '<button type="button" class="tma-bespoke-page__back" data-bespoke-page-back aria-label="Past chats">' +
            '<img src="' + BACK + '" alt="">' +
          '</button>' +
          '<img class="tma-bespoke-page__thread-mark" src="' + MARK + '" alt="" width="28" height="28">' +
          '<h1 class="tma-bespoke-page__thread-title" data-bespoke-page-title>Bespoke AI Assistant</h1>' +
          '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-page-rename aria-label="Rename chat" hidden>' +
            '<img src="' + PENCIL + '" alt="">' +
          '</button>' +
          '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-page-delete aria-label="Delete chat" hidden>' +
            '<img src="' + TRASH + '" alt="">' +
          '</button>' +
        '</div>' +
        '<p class="tma-bespoke__banner" data-bespoke-page-banner hidden>Bespoke AI Assistant isn’t configured for live answers. Navigation and the user guide still work.</p>' +
        '<div class="tma-bespoke__log" data-bespoke-page-log></div>' +
        '<div class="sr-only" aria-live="polite" data-bespoke-page-live></div>' +
        '<div class="tma-bespoke__chips" data-bespoke-page-chips></div>' +
        '<div class="tma-bespoke__attach" data-bespoke-page-attach hidden></div>' +
        '<div class="tma-bespoke__drop" data-bespoke-page-drop>Drop files to attach</div>' +
        '<form class="tma-bespoke__composer" data-bespoke-page-form>' +
          '<button type="button" class="tma-bespoke__clip" data-bespoke-page-clip aria-label="Attach files"><img src="' + CLIP + '" alt=""></button>' +
          '<input type="file" data-bespoke-page-file multiple accept="' + ACCEPT + '" hidden>' +
          '<textarea class="tma-bespoke__input" data-bespoke-page-input rows="1" placeholder="Ask about this portal" aria-label="Message Bespoke AI Assistant"></textarea>' +
          '<button type="button" class="tma-bespoke__mic" data-bespoke-page-mic aria-label="Dictate" title="Dictate" aria-pressed="false"><img src="' + MIC + '" alt=""></button>' +
          '<button type="submit" class="tma-bespoke__send" data-bespoke-page-send disabled aria-label="Send"><img src="' + SEND + '" alt=""></button>' +
        '</form>' +
      '</section>' +
    '</div>';
  }

  function setPageTitle(ctx, title) {
    ctx.title = title || 'New chat';
    if (ctx.titleEl && !ctx.renaming) ctx.titleEl.textContent = ctx.title;
    var rename = ctx.root && ctx.root.querySelector('[data-bespoke-page-rename]');
    var del = ctx.root && ctx.root.querySelector('[data-bespoke-page-delete]');
    var show = !!(ctx.conversationId && ctx.messages.length);
    if (rename) rename.hidden = !show;
    if (del) del.hidden = !show;
  }

  /*
   * Which heading a chat sits under.
   *
   * The same buckets the mailbox uses, for the same reason: a list of forty
   * chats all reading "Sep 14" tells you nothing, while "Yesterday" and
   * "Previous 7 days" are how people actually remember when they asked
   * something. Pinned chats are pulled out before this is asked.
   */
  function historyBucket(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return { key: 'older', label: 'Older' };

    var startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    var days = Math.floor((startOfToday.getTime() - d.getTime()) / 86400000);

    if (days < 0) return { key: 'today', label: 'Today' };
    if (days === 0) return { key: 'yesterday', label: 'Yesterday' };
    if (days < 7) return { key: 'week', label: 'Previous 7 days' };
    if (days < 30) return { key: 'month', label: 'Previous 30 days' };

    return {
      key: 'm-' + d.getFullYear() + '-' + d.getMonth(),
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    };
  }

  /* A chat's row. Shared by the page rail and the launcher's history. */
  function historyRow(ctx, row, onOpen) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tma-bespoke-page__item'
      + (row.uuid === ctx.conversationId ? ' is-active' : '')
      + (row.pinned ? ' is-pinned' : '');
    btn.setAttribute('data-bespoke-open', row.uuid);
    btn.innerHTML =
      '<span class="tma-bespoke-page__item-title">' +
        (row.pinned ? '<span class="tma-bespoke-page__item-pin" aria-label="Pinned">\u25cf</span>' : '') +
        escapeHtml(row.title || 'New chat') +
      '</span>' +
      '<span class="tma-bespoke-page__item-time">' + escapeHtml(timeLabel(row.updatedAt)) + '</span>' +
      '<span class="tma-bespoke-page__item-preview">' + escapeHtml(row.preview || '') + '</span>';
    btn.addEventListener('click', function () { onOpen(row.uuid); });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openHistoryMenu(ctx, row, e.clientX, e.clientY);
    });

    return btn;
  }

  function renderPageList(ctx) {
    var list = ctx.listEl;
    if (!list) return;
    list.innerHTML = '';
    if (!ctx.conversations.length) {
      var empty = document.createElement('p');
      empty.className = 'tma-bespoke-page__empty';
      empty.textContent = 'No past chats yet. Ask a question to start one.';
      list.appendChild(empty);
      return;
    }

    var open = function (id) { openPageThread(ctx, id, true); };
    var groups = [];
    var seen = {};

    ctx.conversations.forEach(function (row) {
      var bucket = row.pinned
        ? { key: 'pinned', label: 'Pinned' }
        : historyBucket(row.updatedAt);
      if (!seen[bucket.key]) {
        seen[bucket.key] = { label: bucket.label, rows: [] };
        groups.push(seen[bucket.key]);
      }
      seen[bucket.key].rows.push(row);
    });

    groups.forEach(function (group) {
      var head = document.createElement('p');
      head.className = 'tma-bespoke-page__group';
      head.textContent = group.label;
      list.appendChild(head);
      group.rows.forEach(function (row) {
        list.appendChild(historyRow(ctx, row, open));
      });
    });
  }

  /* ── Right-click on a chat ─────────────────────────────────────
   * Pin, rename and delete, where the reader's hand already is. The menu
   * is one node reused: opening a second closes the first. */
  var historyMenuEl = null;

  function closeHistoryMenu() {
    if (!historyMenuEl) return;
    historyMenuEl.remove();
    historyMenuEl = null;
    document.removeEventListener('pointerdown', onHistoryMenuAway, true);
    document.removeEventListener('keydown', onHistoryMenuKey, true);
    window.removeEventListener('blur', closeHistoryMenu);
  }

  function onHistoryMenuAway(e) {
    if (historyMenuEl && historyMenuEl.contains(e.target)) return;
    closeHistoryMenu();
  }

  function onHistoryMenuKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeHistoryMenu();
    }
  }

  function openHistoryMenu(ctx, row, x, y) {
    closeHistoryMenu();

    var menu = document.createElement('div');
    menu.className = 'tma-bespoke-menu';
    menu.setAttribute('role', 'menu');

    [
      { key: 'pin', label: row.pinned ? 'Unpin' : 'Pin to top' },
      { key: 'rename', label: 'Rename' },
      { key: 'delete', label: 'Delete', danger: true }
    ].forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tma-bespoke-menu__item' + (item.danger ? ' tma-bespoke-menu__item--danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.addEventListener('click', function () {
        closeHistoryMenu();
        runHistoryAction(ctx, row, item.key);
      });
      menu.appendChild(b);
    });

    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    historyMenuEl = menu;

    // Keep it on screen when the click lands near an edge.
    var box = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - box.width - 8);
    var top = Math.min(y, window.innerHeight - box.height - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.style.visibility = '';

    document.addEventListener('pointerdown', onHistoryMenuAway, true);
    document.addEventListener('keydown', onHistoryMenuKey, true);
    window.addEventListener('blur', closeHistoryMenu);
  }

  /*
   * Pin, rename or delete, from either surface.
   *
   * The launcher and the full page keep separate contexts, and only the
   * page has a title bar to rename in — so the launcher refreshes its own
   * list and sends a rename out to the page rather than pretending to have
   * a control it does not.
   */
  function isPageCtx(ctx) {
    return !!(ctx && page && ctx === page);
  }

  function reloadHistory(ctx) {
    if (isPageCtx(ctx)) return loadPageList(ctx);

    return loadWidgetHistory();
  }

  function runHistoryAction(ctx, row, action) {
    if (action === 'pin') {
      api('/portal/bespoke/conversations/' + encodeURIComponent(row.uuid), {
        method: 'PATCH',
        body: { pinned: !row.pinned }
      }).then(function () {
        reloadHistory(ctx);
      }).catch(function () { /* the list is unchanged */ });
      return;
    }

    if (action === 'rename') {
      // Renaming happens in the thread's own title, which is the page's.
      if (!isPageCtx(ctx)) {
        setOpen(false);
        go('/bespoke-ai/' + row.uuid);
        return;
      }
      if (ctx.conversationId !== row.uuid) {
        openPageThread(ctx, row.uuid, true).then(function () { startRename(ctx); });
        return;
      }
      startRename(ctx);
      return;
    }

    if (action === 'delete') {
      confirmDelete(row.title || 'this chat', function () {
        api('/portal/bespoke/conversations/' + encodeURIComponent(row.uuid), { method: 'DELETE' })
          .then(function () {
            if (convGet() === row.uuid) convSet('');
            if (ctx.conversationId === row.uuid) {
              if (isPageCtx(ctx)) {
                resetPageThread(ctx);
                replaceBespokeUrl('/bespoke-ai', null);
              } else {
                newWidgetChat();
              }
            }
            reloadHistory(ctx);
          });
      });
    }
  }

  function loadPageList(ctx) {
    return api('/portal/bespoke/conversations').then(function (data) {
      ctx.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      renderPageList(ctx);
      return ctx.conversations;
    }).catch(function () {
      ctx.conversations = ctx.conversations || [];
      renderPageList(ctx);
      return ctx.conversations;
    });
  }

  function resetPageThread(ctx) {
    ctx.messages = [];
    ctx.pending = [];
    renderAttachStrip(ctx);
    ctx.conversationId = uuid();
    convSet(ctx.conversationId);
    ctx.busy = false;
    if (ctx.logEl) ctx.logEl.innerHTML = '';
    setPageTitle(ctx, 'New chat');
    ctx.shell.classList.add('is-thread');
    renderPageList(ctx);
    refreshSuggestions(ctx);
    if (ctx.inputEl) ctx.inputEl.focus();
  }

  /* Resolves once the thread is on screen, so a caller can act on it —
     Rename from the right-click menu opens the chat, then renames it. */
  function openPageThread(ctx, id, pushUrl) {
    if (!id) {
      resetPageThread(ctx);
      if (pushUrl) replaceBespokeUrl('/bespoke-ai', null);
      return Promise.resolve();
    }
    return api('/portal/bespoke/conversations/' + encodeURIComponent(id)).then(function (data) {
      var conv = data.conversation || {};
      ctx.conversationId = conv.uuid || id;
      convSet(ctx.conversationId);
      ctx.messages = Array.isArray(conv.messages) ? conv.messages.map(function (row) {
        return { role: row.role, content: row.content, attachments: row.attachments || [] };
      }) : [];
      paintLog(ctx);
      setPageTitle(ctx, conv.title || 'New chat');
      ctx.shell.classList.add('is-thread');
      renderChips(ctx, ctx.messages.length ? [] : localChips());
      renderPageList(ctx);
      if (pushUrl) pushBespokeUrl('/bespoke-ai/' + ctx.conversationId, ctx.conversationId);
      if (ctx.inputEl) ctx.inputEl.focus();
    }).catch(function () {
      resetPageThread(ctx);
    });
  }

  /* ── The rail's width ──────────────────────────────────────────
   * Dragged, and kept per reader, the same as the mailbox's reading pane.
   * A ratio rather than pixels, so a narrow laptop and a wide monitor each
   * get a sensible rail from the same stored number. */
  var LS_RAIL = 'tma.bespoke.railRatio';
  var RAIL_MIN = 0.16;
  var RAIL_MAX = 0.42;

  function railRatio() {
    var v = parseFloat(storeGet(LS_RAIL, ''));
    if (isNaN(v)) return 0.22;

    return Math.max(RAIL_MIN, Math.min(RAIL_MAX, v));
  }

  function applyRailRatio(shell, ratio) {
    if (!shell) return;
    shell.style.setProperty('--tma-bespoke-rail', (ratio * 100).toFixed(3) + '%');
  }

  function wireRailResizer(ctx) {
    var shell = ctx.shell;
    var handle = shell && shell.querySelector('[data-bespoke-page-resizer]');
    if (!handle) return;

    var ratio = railRatio();
    applyRailRatio(shell, ratio);
    handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

    var dragging = false;

    function setFrom(clientX) {
      var rect = shell.getBoundingClientRect();
      if (rect.width <= 0) return;
      ratio = Math.max(RAIL_MIN, Math.min(RAIL_MAX, (clientX - rect.left) / rect.width));
      applyRailRatio(shell, ratio);
      handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      shell.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
    });

    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      setFrom(e.clientX);
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      shell.classList.remove('is-resizing');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      storeSet(LS_RAIL, String(ratio));
    }

    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);

    // The keyboard reaches it too: a separator nobody can move without a
    // mouse is a control half the readers do not have.
    handle.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
      if (!step) return;
      e.preventDefault();
      ratio = Math.max(RAIL_MIN, Math.min(RAIL_MAX, ratio + step));
      applyRailRatio(shell, ratio);
      handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      storeSet(LS_RAIL, String(ratio));
    });
  }

  function startRename(ctx) {
    if (!ctx.conversationId || ctx.renaming) return;
    ctx.renaming = true;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tma-bespoke-page__title-input';
    input.value = ctx.title || 'New chat';
    input.setAttribute('maxlength', '80');
    input.setAttribute('aria-label', 'Chat title');
    ctx.titleEl.replaceWith(input);
    input.focus();
    input.select();
    function finish(save) {
      if (!ctx.renaming) return;
      ctx.renaming = false;
      var next = String(input.value || '').trim() || ctx.title || 'New chat';
      var titleEl = document.createElement('h1');
      titleEl.className = 'tma-bespoke-page__thread-title';
      titleEl.setAttribute('data-bespoke-page-title', '');
      ctx.titleEl = titleEl;
      input.replaceWith(titleEl);
      if (!save || next === ctx.title) {
        setPageTitle(ctx, ctx.title);
        return;
      }
      api('/portal/bespoke/conversations/' + encodeURIComponent(ctx.conversationId), {
        method: 'PATCH',
        body: { title: next }
      }).then(function (data) {
        var title = (data.conversation && data.conversation.title) || next;
        setPageTitle(ctx, title);
        loadPageList(ctx);
      }).catch(function () {
        setPageTitle(ctx, ctx.title);
      });
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  function mountPage(root, opts) {
    if (!root || !enabled()) return;
    opts = opts || {};
    if (page) stopDictation(page);
    root.innerHTML = pageMarkup();
    var shell = root.querySelector('.tma-bespoke-page');
    var ctx = {
      root: root,
      shell: shell,
      listEl: root.querySelector('[data-bespoke-page-list]'),
      logEl: root.querySelector('[data-bespoke-page-log]'),
      chipsEl: root.querySelector('[data-bespoke-page-chips]'),
      inputEl: root.querySelector('[data-bespoke-page-input]'),
      liveEl: root.querySelector('[data-bespoke-page-live]'),
      bannerEl: root.querySelector('[data-bespoke-page-banner]'),
      sendBtn: root.querySelector('[data-bespoke-page-send]'),
      formEl: root.querySelector('[data-bespoke-page-form]'),
      attachEl: root.querySelector('[data-bespoke-page-attach]'),
      clipBtn: root.querySelector('[data-bespoke-page-clip]'),
      fileEl: root.querySelector('[data-bespoke-page-file]'),
      micBtn: root.querySelector('[data-bespoke-page-mic]'),
      dropEl: root.querySelector('.tma-bespoke-page__thread'),
      pending: [],
      titleEl: root.querySelector('[data-bespoke-page-title]'),
      messages: [],
      conversations: [],
      conversationId: '',
      busy: false,
      renaming: false,
      title: 'New chat',
      setTitle: function (title) { setPageTitle(ctx, title); },
      afterReply: function () {
        ctx.shell.classList.add('is-thread');
        loadPageList(ctx);
        if (ctx.conversationId && currentPath().indexOf(ctx.conversationId) === -1) {
          replaceBespokeUrl('/bespoke-ai/' + ctx.conversationId, ctx.conversationId);
        }
      }
    };
    page = ctx;
    setPageTitle(ctx, 'New chat');
    bindComposer(ctx);
    wireRailResizer(ctx);
    if (ctx.bannerEl) ctx.bannerEl.hidden = configured;

    root.querySelector('[data-bespoke-page-new]').addEventListener('click', function () {
      resetPageThread(ctx);
      replaceBespokeUrl('/bespoke-ai', null);
    });
    root.querySelector('[data-bespoke-page-back]').addEventListener('click', function () {
      ctx.shell.classList.remove('is-thread');
    });
    root.querySelector('[data-bespoke-page-rename]').addEventListener('click', function () {
      startRename(ctx);
    });
    root.querySelector('[data-bespoke-page-delete]').addEventListener('click', function () {
      if (!ctx.conversationId) return;
      confirmDelete(ctx.title || 'this chat', function () {
        api('/portal/bespoke/conversations/' + encodeURIComponent(ctx.conversationId), { method: 'DELETE' })
          .then(function () {
            if (convGet() === ctx.conversationId) convSet('');
            resetPageThread(ctx);
            replaceBespokeUrl('/bespoke-ai', null);
            loadPageList(ctx);
          });
      });
    });

    loadPageList(ctx).then(function (list) {
      /*
       * A conversation in the URL is the reader asking for that thread — a
       * History click, an expanded launcher, a shared link — and always
       * wins. Otherwise we continue only what this page view already had
       * going, which after a reload is nothing. That is the point: a
       * refresh lands on a new chat rather than reopening the last one.
       */
      var fromPath = pathConversationId();
      var wanted = opts.conversationId || fromPath || '';
      if (!wanted) {
        var stored = convGet();
        var found = list.filter(function (row) { return row.uuid === stored; })[0];
        if (found) wanted = found.uuid;
      }
      if (wanted) {
        // Already at its own address when the URL is what named it, so
        // there is nothing to push.
        openPageThread(ctx, wanted, !opts.conversationId && wanted !== fromPath);
        return;
      }
      resetPageThread(ctx);
    });
  }

  function ensurePageChrome() {
    var dash = document.querySelector('.tma-dash');
    if (!dash || !enabled()) return;

    if (!dash.querySelector('.tma-dash__view[data-view="bespoke"]')) {
      var view = document.createElement('div');
      view.className = 'tma-dash__view';
      view.setAttribute('data-view', 'bespoke');
      view.hidden = true;
      view.innerHTML = '<div data-portal-mount></div>';
      var usersView = dash.querySelector('.tma-dash__view[data-view="users"]');
      if (usersView && usersView.parentNode) usersView.parentNode.insertBefore(view, usersView);
      else {
        var main = dash.querySelector('.tma-dash__main');
        if (main) main.appendChild(view);
      }
    }

    if (!dash.querySelector('.tma-dash__sidebar [data-nav="bespoke"]')) {
      var users = dash.querySelector('.tma-dash__sidebar [data-nav="users"]');
      var a = document.createElement('a');
      a.className = 'tma-dash__nav-item';
      a.href = '/bespoke-ai';
      a.setAttribute('data-nav', 'bespoke');
      a.setAttribute('data-title', 'Bespoke AI Assistant');
      a.setAttribute('data-crumb', 'Bespoke AI Assistant');
      a.setAttribute('data-view', 'bespoke');
      a.innerHTML = '<span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>' +
        '<span class="tma-dash__nav-icon tma-dash__nav-icon--mark" aria-hidden="true">' +
        '<img src="' + MARK + '" alt="" width="20" height="20"></span>' +
        '<span>Bespoke AI</span>';
      if (users && users.parentNode) users.parentNode.insertBefore(a, users);
    }

    var pagesCard = null;
    dash.querySelectorAll('.tma-dash__mmenu-card').forEach(function (card) {
      if (card.querySelector('[data-nav="users"]:not([hidden])')) pagesCard = card;
    });
    if (pagesCard && !pagesCard.querySelector('[data-nav="bespoke"]')) {
      var mUsers = pagesCard.querySelector('[data-nav="users"]');
      var m = document.createElement('button');
      m.type = 'button';
      m.className = 'tma-dash__mrow';
      m.setAttribute('data-mrow', '');
      m.setAttribute('data-nav', 'bespoke');
      m.setAttribute('data-title', 'Bespoke AI Assistant');
      m.setAttribute('data-crumb', 'Bespoke AI Assistant');
      m.setAttribute('data-view', 'bespoke');
      m.innerHTML = '<img class="tma-dash__mrow-icon tma-dash__mrow-icon--mark" src="' + MARK + '" alt=""><span>Bespoke AI</span>';
      if (mUsers) pagesCard.insertBefore(m, mUsers);
      else pagesCard.insertBefore(m, pagesCard.firstChild);
    }
  }

  /* ── Corner launcher ───────────────────────────────────────── */

  function widgetMarkup() {
    return '<div class="tma-bespoke__hello" data-bespoke-hello hidden>' +
      '<button type="button" class="tma-bespoke__hello-text" data-bespoke-hello-open></button>' +
      '<button type="button" class="tma-bespoke__hello-close" data-bespoke-hello-close aria-label="Dismiss"><img src="' + CLOSE + '" alt="" width="10" height="10"></button>' +
      '</div>' +
      '<button type="button" class="tma-bespoke__fab" data-bespoke-fab aria-label="Open Bespoke AI Assistant" aria-expanded="false" aria-controls="tma-bespoke-panel">' +
      '<img class="tma-bespoke__mark" src="' + MARK + '" alt="" width="32" height="32">' +
      '</button>' +
      '<div class="tma-bespoke__panel" id="tma-bespoke-panel" role="dialog" aria-modal="true" aria-labelledby="tma-bespoke-title" aria-hidden="true" inert>' +
        '<div class="tma-bespoke__head">' +
          '<div class="tma-bespoke__identity">' +
            '<img class="tma-bespoke__mark" src="' + MARK + '" alt="" width="28" height="28">' +
            '<div class="tma-bespoke__titles">' +
              '<p class="tma-bespoke__name" id="tma-bespoke-title">Bespoke AI Assistant</p>' +
              '<p class="tma-bespoke__sub" data-bespoke-sub>How can I help?</p>' +
            '</div>' +
          '</div>' +
          '<div class="tma-bespoke__head-actions">' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-history aria-label="Past chats"><img src="' + CLOCK + '" alt=""></button>' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-expand aria-label="Open full page"><img src="' + EXPAND + '" alt=""></button>' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-new aria-label="New chat"><img src="' + PLUS + '" alt=""></button>' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-close aria-label="Close"><img src="' + CLOSE + '" alt=""></button>' +
          '</div>' +
        '</div>' +
        '<p class="tma-bespoke__banner" data-bespoke-banner>Bespoke AI Assistant isn’t configured for live answers. Navigation and the user guide still work.</p>' +
        '<div class="tma-bespoke__log" data-bespoke-log></div>' +
        '<div class="tma-bespoke__history" data-bespoke-history-panel hidden>' +
          '<div class="tma-bespoke__history-head">' +
            '<p class="tma-bespoke__history-title">Past chats</p>' +
            '<button type="button" class="tma-bespoke-page__new" data-bespoke-history-new>' +
              '<img src="' + PLUS + '" alt="" width="14" height="14"> New chat' +
            '</button>' +
          '</div>' +
          '<div class="tma-bespoke-page__list" data-bespoke-history-list></div>' +
        '</div>' +
        '<div class="sr-only" aria-live="polite" data-bespoke-live></div>' +
        '<div class="tma-bespoke__chips" data-bespoke-chips></div>' +
        '<div class="tma-bespoke__attach" data-bespoke-attach hidden></div>' +
        '<div class="tma-bespoke__drop" data-bespoke-drop>Drop files to attach</div>' +
        '<form class="tma-bespoke__composer" data-bespoke-form>' +
          '<button type="button" class="tma-bespoke__clip" data-bespoke-clip aria-label="Attach files"><img src="' + CLIP + '" alt=""></button>' +
          '<input type="file" data-bespoke-file multiple accept="' + ACCEPT + '" hidden>' +
          '<textarea class="tma-bespoke__input" data-bespoke-input rows="1" placeholder="Ask about this portal" aria-label="Message Bespoke AI Assistant"></textarea>' +
          '<button type="button" class="tma-bespoke__mic" data-bespoke-mic aria-label="Dictate" title="Dictate" aria-pressed="false"><img src="' + MIC + '" alt=""></button>' +
          '<button type="submit" class="tma-bespoke__send" data-bespoke-send disabled aria-label="Send"><img src="' + SEND + '" alt=""></button>' +
        '</form>' +
      '</div>';
  }

  /* ── Greeting beside the launcher ─────────────────────────────
   * One line, to the left of the mark, until the reader opens the panel or
   * dismisses it. A dismissal lasts the day; the next day it says hello
   * again. Never on the Bespoke page itself, where the mark is hidden. */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function helloDismissed() {
    return storeGet(LS_HELLO, '') === todayKey();
  }

  function dismissHello() {
    storeSet(LS_HELLO, todayKey());
    var el = host && host.querySelector('[data-bespoke-hello]');
    if (el) el.hidden = true;
  }

  function firstName() {
    if (window.TMACurrentUser && window.TMACurrentUser.get) {
      var me = window.TMACurrentUser.get();
      var name = me && (me.firstName || me.name);
      if (name) return String(name).trim().split(/\s+/)[0];
    }
    return '';
  }

  function helloText(subtitle) {
    var name = firstName();
    var line = subtitle && subtitle !== 'How can I help?' ? subtitle : 'Need a hand?';
    return (name ? 'Hi ' + name + '. ' : '') + line;
  }

  function refreshHello(subtitle) {
    if (!host) return;
    var el = host.querySelector('[data-bespoke-hello]');
    var text = host.querySelector('[data-bespoke-hello-open]');
    if (!el || !text) return;
    if (open || isPagePath() || helloDismissed()) {
      el.hidden = true;
      return;
    }
    text.textContent = helloText(subtitle || (widget && widget.subEl ? widget.subEl.textContent : ''));
    el.hidden = false;
  }

  function newWidgetChat() {
    if (!widget) return;
    showWidgetHistory(false);
    widget.messages = [];
    widget.pending = [];
    renderAttachStrip(widget);
    widget.conversationId = uuid();
    convSet(widget.conversationId);
    if (widget.logEl) widget.logEl.innerHTML = '';
    refreshSuggestions(widget);
    if (widget.inputEl) widget.inputEl.focus();
  }

  /* ── Past chats, inside the launcher ──────────────────────────
   * The same list the full page shows, over the launcher's own log.
   * Picking one loads the thread here; the expand button is still the
   * only way out to /bespoke-ai. */
  function renderWidgetHistory() {
    if (!widget || !widget.historyListEl) return;
    var list = widget.historyListEl;
    list.innerHTML = '';
    var rows = widget.conversations || [];
    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'tma-bespoke-page__empty';
      empty.textContent = 'No past chats yet. Ask a question to start one.';
      list.appendChild(empty);
      return;
    }
    // Same grouping and same right-click as the full page: the launcher's
    // list is the same list, in less room.
    var groups = [];
    var seen = {};
    rows.forEach(function (row) {
      var bucket = row.pinned
        ? { key: 'pinned', label: 'Pinned' }
        : historyBucket(row.updatedAt);
      if (!seen[bucket.key]) {
        seen[bucket.key] = { label: bucket.label, rows: [] };
        groups.push(seen[bucket.key]);
      }
      seen[bucket.key].rows.push(row);
    });

    groups.forEach(function (group) {
      var head = document.createElement('p');
      head.className = 'tma-bespoke-page__group';
      head.textContent = group.label;
      list.appendChild(head);
      group.rows.forEach(function (row) {
        list.appendChild(historyRow(widget, row, openWidgetThread));
      });
    });
  }

  function openWidgetThread(id) {
    if (!widget || !id) return;
    api('/portal/bespoke/conversations/' + encodeURIComponent(id)).then(function (data) {
      var conv = data.conversation || {};
      widget.conversationId = conv.uuid || id;
      convSet(widget.conversationId);
      widget.messages = Array.isArray(conv.messages) ? conv.messages.map(function (row) {
        return { role: row.role, content: row.content, attachments: row.attachments || [] };
      }) : [];
      widget.pending = [];
      renderAttachStrip(widget);
      paintLog(widget);
      renderChips(widget, widget.messages.length ? [] : localChips());
      showWidgetHistory(false);
      if (widget.inputEl) widget.inputEl.focus();
    }).catch(function () {
      showWidgetHistory(false);
    });
  }

  function showWidgetHistory(next) {
    if (!widget || !widget.historyEl) return;
    widget.historyOpen = !!next;
    widget.historyEl.hidden = !widget.historyOpen;
    if (panel) panel.classList.toggle('is-history', widget.historyOpen);
    var btn = host && host.querySelector('[data-bespoke-history]');
    if (btn) btn.setAttribute('aria-pressed', widget.historyOpen ? 'true' : 'false');
    if (!widget.historyOpen) return;
    renderWidgetHistory();
    loadWidgetHistory();
  }

  function loadWidgetHistory() {
    if (!widget) return Promise.resolve([]);

    return api('/portal/bespoke/conversations').then(function (data) {
      widget.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      if (widget.historyOpen) renderWidgetHistory();

      return widget.conversations;
    }).catch(function () {
      // Keep whatever the list already shows.
      return widget.conversations || [];
    });
  }

  function focusables() {
    if (!panel) return [];
    return Array.prototype.filter.call(
      panel.querySelectorAll('button, [href], textarea, input'),
      function (el) { return !el.disabled && el.offsetParent !== null; }
    );
  }

  function trap(e) {
    if (!open || e.key !== 'Tab') return;
    var list = focusables();
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function setOpen(next) {
    open = !!next;
    if (!host) return;
    host.classList.toggle('is-open', open);
    storeSet(LS_OPEN, open ? '1' : '0');
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if ('inert' in panel) panel.inert = !open;
    if (open) {
      lastFocus = document.activeElement;
      dismissHello();
      refreshSuggestions(widget);
      setTimeout(function () {
        if (widget && widget.inputEl) widget.inputEl.focus();
      }, 40);
      return;
    }
    stopDictation(widget);
    showWidgetHistory(false);
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    } else if (fab) {
      fab.focus();
    }
  }

  function toggle() {
    if (isPagePath()) {
      go('/bespoke-ai');
      return;
    }
    setOpen(!open);
  }

  function onKey(e) {
    // Escape while dictating stops the ear and nothing else.
    var dictating = (open && widget && widget.dictation && widget.dictation.active) ? widget
      : (page && page.dictation && page.dictation.active) ? page : null;
    if (e.key === 'Escape' && lightboxEl) {
      e.preventDefault();
      e.stopPropagation();
      closeFileLightbox();
      return;
    }
    if (e.key === 'Escape' && dictating) {
      e.preventDefault();
      e.stopPropagation();
      stopDictation(dictating);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'j') {
      e.preventDefault();
      if (isPagePath()) {
        if (page && page.inputEl) page.inputEl.focus();
        return;
      }
      toggle();
    }
  }

  var historyWrapped = false;

  function wrapHistory() {
    if (window.history && !historyWrapped) {
      ['pushState', 'replaceState'].forEach(function (method) {
        var orig = history[method];
        history[method] = function () {
          var ret = orig.apply(this, arguments);
          window.dispatchEvent(new Event('tma:bespoke-route'));
          return ret;
        };
      });
      historyWrapped = true;
    }
    window.addEventListener('popstate', function () {
      window.dispatchEvent(new Event('tma:bespoke-route'));
    });
    window.addEventListener('tma:bespoke-route', function () {
      // The page's dictation ends with the page; the launcher's rides along.
      if (page && page.dictation && page.dictation.active && !isPagePath()) stopDictation(page);
      if (open && widget) refreshSuggestions(widget);
      else refreshHello('');
    });
  }

  function mountWidget() {
    if (host || !enabled() || isComposePopout()) return;
    var dash = document.querySelector('.tma-dash');
    if (!dash) return;

    host = document.createElement('div');
    host.className = 'tma-bespoke';
    host.innerHTML = widgetMarkup();
    document.body.appendChild(host);

    fab = host.querySelector('[data-bespoke-fab]');
    panel = host.querySelector('.tma-bespoke__panel');
    widget = {
      logEl: host.querySelector('[data-bespoke-log]'),
      chipsEl: host.querySelector('[data-bespoke-chips]'),
      inputEl: host.querySelector('[data-bespoke-input]'),
      liveEl: host.querySelector('[data-bespoke-live]'),
      bannerEl: host.querySelector('[data-bespoke-banner]'),
      subEl: host.querySelector('[data-bespoke-sub]'),
      sendBtn: host.querySelector('[data-bespoke-send]'),
      formEl: host.querySelector('[data-bespoke-form]'),
      attachEl: host.querySelector('[data-bespoke-attach]'),
      clipBtn: host.querySelector('[data-bespoke-clip]'),
      fileEl: host.querySelector('[data-bespoke-file]'),
      micBtn: host.querySelector('[data-bespoke-mic]'),
      dropEl: panel,
      historyEl: host.querySelector('[data-bespoke-history-panel]'),
      historyListEl: host.querySelector('[data-bespoke-history-list]'),
      historyOpen: false,
      conversations: [],
      pending: [],
      messages: [],
      conversationId: convGet(),
      busy: false
    };

    fab.addEventListener('click', toggle);
    host.querySelector('[data-bespoke-hello-open]').addEventListener('click', function () { setOpen(true); });
    host.querySelector('[data-bespoke-hello-close]').addEventListener('click', function (e) {
      e.stopPropagation();
      dismissHello();
    });
    setTimeout(function () { refreshHello(''); }, 1200);
    host.querySelector('[data-bespoke-close]').addEventListener('click', function () { setOpen(false); });
    host.querySelector('[data-bespoke-new]').addEventListener('click', newWidgetChat);
    host.querySelector('[data-bespoke-history]').addEventListener('click', function () {
      showWidgetHistory(!widget.historyOpen);
    });
    host.querySelector('[data-bespoke-history-new]').addEventListener('click', newWidgetChat);
    host.querySelector('[data-bespoke-expand]').addEventListener('click', function () {
      setOpen(false);
      var id = widget && widget.conversationId && widget.messages.length
        ? widget.conversationId
        : '';
      go(id ? '/bespoke-ai/' + id : '/bespoke-ai');
    });
    bindComposer(widget);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', trap, true);

    wrapHistory();
    renderChips(widget, localChips());

    if (storeGet(LS_OPEN, '') === '1' && !isPagePath()) setOpen(true);
    else refreshSuggestions(widget);
  }

  function destroy() {
    stopDictation(widget);
    closeFileLightbox();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', trap, true);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = panel = fab = widget = null;
    open = false;
  }

  /* The launcher and its greeting are not part of any page's first paint:
     they wait for the shell to go quiet, unless the reader arrived on the
     assistant's own page. The page chrome is DOM only and stays immediate. */
  var widgetAllowed = false;

  function consider() {
    if (isComposePopout()) return;
    if (enabled()) {
      ensurePageChrome();
      if (!host && widgetAllowed) mountWidget();
      if (widget && widget.bannerEl) widget.bannerEl.hidden = configured;
      return;
    }
    if (host) destroy();
  }

  function start() {
    if (isComposePopout()) return;
    consider();
    if (window.TMACurrentUser && window.TMACurrentUser.onChange) {
      window.TMACurrentUser.onChange(function (me) {
        if (me && me.bespoke) configured = !!me.bespoke.configured;
        consider();
      });
    }
    var allow = function () {
      widgetAllowed = true;
      consider();
      if (window.TMABootBespoke !== true && window.TMABootBespoke !== 'true') {
        api('/portal/bespoke/suggestions').then(function (data) {
          window.TMABootBespoke = true;
          configured = !!(data && data.configured);
          consider();
        }).catch(function () { /* 404 = still dark */ });
      }
    };
    if (window.TMABoot && window.TMABoot.deferUnless) window.TMABoot.deferUnless(['bespoke'], allow);
    else allow();
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('bespoke', mountPage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.TMABespoke = {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: toggle,
    mount: mountWidget,
    // The launcher's dictation state, for the browser harness.
    dictation: function () { return widget ? widget.dictation : null; }
  };
})();
