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
  var VOICE = 'images/icons/phosphor/Waveform.svg';
  var MIC = 'images/icons/phosphor/Microphone.svg';
  var MIC_OFF = 'images/icons/phosphor/MicrophoneSlash.svg';
  var SPEAKER = 'images/icons/phosphor/SpeakerHigh.svg';
  var SPEAKER_OFF = 'images/icons/phosphor/SpeakerSlash.svg';
  var LS_VOICE_OFF = 'tma.bespoke.voiceOff';
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
      answer: 'Open [CIP Applications](/citizenship-applications) → Create New Application. Staff: Pre-Approval, Post-Approval, New service provider, Import. Provider contacts: Pre-Approval only.'
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

  function sizeLabel(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes >= 1048576) return (Math.round(bytes / 104857.6) / 10) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  /* Chips for the files on a sent message, in the bubble. */
  function attachmentsHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return '<div class="tma-bespoke__files">' + list.map(function (a) {
      var url = a.url ? escapeHtml(a.url) : '';
      var inner = '<img src="' + fileIcon(a) + '" alt="" width="14" height="14"><span>' + escapeHtml(a.name || 'file') + '</span>';
      return url
        ? '<a class="tma-bespoke__file" href="' + url + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<span class="tma-bespoke__file">' + inner + '</span>';
    }).join('') + '</div>';
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
      var chip = document.createElement('span');
      chip.className = 'tma-bespoke__file tma-bespoke__file--' + entry.status;
      var label = entry.status === 'uploading' ? 'Uploading…'
        : entry.status === 'failed' ? (entry.error || 'Failed')
        : sizeLabel(entry.size);
      chip.innerHTML = '<img src="' + fileIcon(entry) + '" alt="" width="14" height="14">' +
        '<span class="tma-bespoke__file-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="tma-bespoke__file-meta">' + escapeHtml(label) + '</span>';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tma-bespoke__file-remove';
      remove.setAttribute('aria-label', 'Remove ' + entry.name);
      remove.innerHTML = '<img src="' + CLOSE + '" alt="" width="10" height="10">';
      remove.addEventListener('click', function () {
        ctx.pending = ctx.pending.filter(function (e) { return e !== entry; });
        renderAttachStrip(ctx);
        resizeInput(ctx);
      });
      chip.appendChild(remove);
      ctx.attachEl.appendChild(chip);
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
    chips.forEach(function (chip) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-bespoke__chip';
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
    bubble.innerHTML = html + attachmentsHtml(opts.attachments);
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
      storeSet(LS_CONV, ctx.conversationId);
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

  function makeSquarePhoto(a) {
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
    }).then(function (src) {
      var canvas = src.canvas;
      var box = src.trim ? trimWhite(canvas) : { x: 0, y: 0, w: canvas.width, h: canvas.height };
      var side = Math.min(box.w, box.h);
      if (side < 40) throw new Error('empty');
      var sx = box.x + (box.w - side) / 2;
      var sy = box.y + (box.h - side) / 2;
      var out = Math.round(Math.max(PHOTO_MIN, Math.min(PHOTO_MAX, side)));
      var outCanvas = document.createElement('canvas');
      outCanvas.width = out;
      outCanvas.height = out;
      var c = outCanvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, out, out);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(canvas, sx, sy, side, side, 0, 0, out, out);
      return new Promise(function (resolve, reject) {
        outCanvas.toBlob(function (b) {
          if (b) resolve({ blob: b, size: out, upscaled: side < PHOTO_MIN });
          else reject(new Error('blob'));
        }, 'image/jpeg', 0.92);
      });
    });
  }

  function renderPhotoCard(ctx, action) {
    var a = action.attachment || {};
    var card = cardShell(ctx, 'photo');
    card.innerHTML =
      '<p class="tma-bespoke__card-head">2×2 photo from ' + escapeHtml(a.name || 'file') + '</p>' +
      '<p class="tma-bespoke__card-ask" data-bespoke-photo-status>Preparing…</p>' +
      '<div class="tma-bespoke__photo" data-bespoke-photo hidden></div>' +
      '<div class="tma-bespoke__card-foot" data-bespoke-card-foot></div>';
    var status = card.querySelector('[data-bespoke-photo-status]');
    var slot = card.querySelector('[data-bespoke-photo]');
    var foot = card.querySelector('[data-bespoke-card-foot]');
    var base = String(a.name || 'photo').replace(/\.[^.]+$/, '');
    var filename = base + '-2x2.jpg';

    makeSquarePhoto(a).then(function (result) {
      var objectUrl = URL.createObjectURL(result.blob);
      slot.innerHTML = '<img src="' + objectUrl + '" alt="2×2 photo" width="120" height="120">';
      slot.hidden = false;
      status.textContent = result.size + '×' + result.size + ' px, 2×2 in at ' + Math.round(result.size / 2) + ' dpi' +
        (result.upscaled ? '. The original was small; expect some softness.' : '.');
      var link = document.createElement('a');
      link.className = 'tma-bespoke__card-btn tma-bespoke__card-btn--primary';
      link.textContent = 'Download';
      link.href = objectUrl;
      link.download = filename;
      foot.appendChild(link);
      ctx.logEl.scrollTop = ctx.logEl.scrollHeight;

      // Keep a copy in the chat: it survives a reload and downloads from
      // the server, which the desktop shells prefer to a blob URL.
      var form = new FormData();
      form.append('file', result.blob, filename);
      form.append('conversationId', ensureConversation(ctx));
      form.append('kind', 'derived');
      return apiForm('/portal/bespoke/attachments', form).then(function (data) {
        var d = data && data.attachment;
        if (d && d.url) link.href = d.url + '?download=1';
      }).catch(function () { /* the blob link still works */ });
    }).catch(function () {
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
      else if (action.type === 'photo2x2') renderPhotoCard(ctx, action);
    });
  }

  function ask(ctx, text) {
    text = String(text || '').trim();
    if (!ctx || ctx.busy) return;
    var files = readyAttachments(ctx);
    if ((ctx.pending || []).some(function (e) { return e.status === 'uploading'; })) {
      toast('Still uploading. One moment.', true);
      return;
    }
    if (!text && !files.length) return;
    if (!text) text = files.length === 1 ? 'Here is a file.' : 'Here are ' + files.length + ' files.';
    var sent = files.map(function (e) { return e.payload || { id: e.id, name: e.name, url: e.url, mime: e.mime }; });
    clearChoices(ctx);
    ctx.messages.push({ role: 'user', content: text, attachments: sent });
    appendRow(ctx, 'user', renderLite(text), { attachments: sent });
    renderChips(ctx, []);
    if (ctx.inputEl) ctx.inputEl.value = '';
    ctx.pending = [];
    renderAttachStrip(ctx);
    resizeInput(ctx);
    ctx.busy = true;
    if (ctx.sendBtn) ctx.sendBtn.disabled = true;
    var bubble = appendRow(ctx, 'assistant', '<span class="tma-bespoke__typing" aria-hidden="true"><span></span><span></span><span></span></span>');
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
        storeSet(LS_CONV, ctx.conversationId);
      }
      if (data.title && ctx.setTitle) ctx.setTitle(data.title);
      var reply = data.reply || '';
      ctx.messages.push({ role: 'assistant', content: reply });
      typeInto(ctx, bubble, reply);
      renderActions(ctx, data.actions || []);
      renderChoices(ctx, data.choices || []);
      if (typeof ctx.afterReply === 'function') ctx.afterReply(data);
      liveAnswer(ctx, reply, data);
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
      liveAnswer(ctx, fallback, null);
    }).then(function () {
      ctx.busy = false;
      if (ctx.sendBtn) ctx.sendBtn.disabled = !String(ctx.inputEl && ctx.inputEl.value || '').trim();
      if (ctx.inputEl) ctx.inputEl.focus();
    });
  }

  /* ── Live voice ─────────────────────────────────────────────────
   * Talk to the assistant out loud. The browser's own speech recognition
   * hears the reader, the same chat endpoint answers, and the browser's own
   * speech synthesis reads the reply while the mark moves with it. Every
   * turn still lands in the log and the saved conversation as text, so
   * nothing is sent that typing would not have sent. Free of any outside
   * service: no browser support means no button. */

  function recognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /* Two ears. The browser's own recognition first: free, no round trip,
   * interim words. But Chromium's is a call to a Google service the
   * desktop shell, Brave and unbranded builds do not carry — every start
   * there ends in `network`. Then the clip is recorded here and
   * transcribed by the server through the chat provider. The switch is
   * remembered per browser so the next session does not fail first. */
  function recorderSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof window.MediaRecorder === 'function');
  }

  function liveSupported() {
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return false;
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

  function liveLang() {
    var lang = String(document.documentElement.getAttribute('lang') || '').trim();
    var nav = navigator.language || 'en-US';
    if (!lang) return nav;
    if (lang.length === 2 && nav.toLowerCase().indexOf(lang.toLowerCase() + '-') === 0) return nav;
    return lang;
  }

  /* The best voice the device has for the page's language: the natural /
   * cloud ones first, the novelty ones never. */
  function pickVoice(lang) {
    var synth = window.speechSynthesis;
    var voices = synth && synth.getVoices ? synth.getVoices() : [];
    if (!voices || !voices.length) return null;
    var want = String(lang || 'en').toLowerCase().replace('_', '-');
    var prefix = want.slice(0, 2);
    var best = null;
    var bestScore = -1;
    voices.forEach(function (v) {
      var vl = String(v.lang || '').toLowerCase().replace('_', '-');
      var name = String(v.name || '');
      var score = 0;
      if (vl === want) score += 6;
      else if (vl.indexOf(prefix) === 0) score += 3;
      else return;
      if (/natural|neural|premium|enhanced/i.test(name)) score += 4;
      if (/google/i.test(name)) score += 3;
      if (/samantha|karen|moira|tessa|daniel|aria|jenny|libby|sonia|zira|ava|allison/i.test(name)) score += 2;
      if (v.default) score += 1;
      if (/compact|eloquence|espeak|albert|bad news|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|organ|trinoids|whisper|zarvox|wobble|jester/i.test(name)) score -= 6;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    });
    return best;
  }

  /* The reply as it should be read aloud: links become their label, portal
   * paths and markdown marks go, arrows become "then". */
  function speakable(text) {
    var s = String(text || '');
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    s = s.replace(/(^|[\s(])\/[A-Za-z0-9._~\/-]+/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    s = s.replace(/^\s*[-*]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '');
    s = s.replace(/\s*(→|->)\s*/g, ', then ');
    s = s.replace(/[•←]/g, ' ');
    s = s.replace(/\(\s*\)/g, '');
    s = s.replace(/\s+([.,;:!?])/g, '$1');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /* Chrome stops a long utterance mid-sentence after about fifteen seconds,
   * so the text is read one short run of sentences at a time. */
  function sentences(text) {
    var MAX = 200;
    var pieces = String(text || '').match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [];
    var flat = [];
    pieces.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      if (p.length <= MAX) {
        flat.push(p);
        return;
      }
      p.split(/,\s+/).forEach(function (part) {
        part = part.trim();
        while (part.length > MAX) {
          var cut = part.lastIndexOf(' ', MAX);
          if (cut < 40) cut = MAX;
          flat.push(part.slice(0, cut).trim());
          part = part.slice(cut).trim();
        }
        if (part) flat.push(part);
      });
    });
    var out = [];
    var buf = '';
    flat.forEach(function (p) {
      if (buf && (buf + ' ' + p).length > MAX) {
        out.push(buf);
        buf = p;
      } else {
        buf = buf ? buf + ' ' + p : p;
      }
    });
    if (buf) out.push(buf);
    return out;
  }

  function liveMarkup() {
    return '<div class="tma-bespoke__live-stage">' +
        '<div class="tma-bespoke__orb" data-bespoke-orb>' +
          '<span class="tma-bespoke__orb-ring"></span>' +
          '<span class="tma-bespoke__orb-ring"></span>' +
          '<img class="tma-bespoke__orb-mark" src="' + MARK + '" alt="" width="72" height="72">' +
        '</div>' +
        '<div class="tma-bespoke__bars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>' +
        '<p class="tma-bespoke__live-status" data-bespoke-live-status aria-live="polite"></p>' +
        '<div class="tma-bespoke__live-caption tma-bespoke__bubble" data-bespoke-live-caption hidden></div>' +
      '</div>' +
      '<div class="tma-bespoke__live-controls">' +
        '<button type="button" class="tma-bespoke__live-btn" data-bespoke-live-speaker aria-label="Mute the voice" title="Voice" aria-pressed="false"><img src="' + SPEAKER + '" alt=""></button>' +
        '<button type="button" class="tma-bespoke__live-mic" data-bespoke-live-mic aria-label="Talk" title="Microphone" aria-pressed="false"><img src="' + MIC + '" alt=""></button>' +
        '<button type="button" class="tma-bespoke__live-btn" data-bespoke-live-end aria-label="Back to chat" title="Back to chat"><img src="' + CLOSE + '" alt=""></button>' +
      '</div>';
  }

  function liveState(ctx) {
    if (!ctx.live) {
      ctx.live = {
        active: false,
        mode: 'idle',
        view: null,
        rec: null,
        engine: 'browser',
        capture: null,
        level: 0,
        listening: false,
        speaking: false,
        speech: null,
        utter: null,
        micOff: false,
        speakerOff: storeGet(LS_VOICE_OFF, '') === '1',
        noSpeech: 0,
        meter: null
      };
    }
    return ctx.live;
  }

  function liveView(ctx) {
    var live = liveState(ctx);
    if (live.view) return live.view;
    var el = document.createElement('div');
    el.className = 'tma-bespoke__live';
    el.setAttribute('data-bespoke-stage', '');
    el.setAttribute('data-mode', 'idle');
    el.hidden = true;
    el.innerHTML = liveMarkup();
    ctx.surfaceEl.appendChild(el);
    live.view = el;
    live.orbEl = el.querySelector('[data-bespoke-orb]');
    live.statusEl = el.querySelector('[data-bespoke-live-status]');
    live.captionEl = el.querySelector('[data-bespoke-live-caption]');
    live.micBtn = el.querySelector('[data-bespoke-live-mic]');
    live.speakerBtn = el.querySelector('[data-bespoke-live-speaker]');
    live.micBtn.addEventListener('click', function () { toggleMic(ctx); });
    live.speakerBtn.addEventListener('click', function () { toggleSpeaker(ctx); });
    el.querySelector('[data-bespoke-live-end]').addEventListener('click', function () { closeLive(ctx); });
    live.captionEl.addEventListener('click', onNavClick);
    paintSpeaker(ctx);
    paintMic(ctx);
    return el;
  }

  function setLiveMode(ctx, mode, status) {
    var live = liveState(ctx);
    live.mode = mode;
    if (live.view) {
      live.view.setAttribute('data-mode', mode);
      if (mode !== 'listening') live.view.style.setProperty('--level', '0');
      if (live.statusEl && status !== undefined && status !== null) live.statusEl.textContent = status;
    }
    paintMic(ctx);
  }

  function showCaption(ctx, who, text) {
    var live = ctx.live;
    if (!live || !live.captionEl) return;
    text = String(text || '').trim();
    live.captionEl.hidden = !text;
    live.captionEl.className = 'tma-bespoke__live-caption tma-bespoke__bubble' + (who ? ' tma-bespoke__live-caption--' + who : '');
    live.captionEl.innerHTML = who === 'ai' ? renderLite(text) : '<p>' + escapeHtml(text) + '</p>';
    live.captionEl.scrollTop = 0;
  }

  function openLive(ctx) {
    if (!ctx || !ctx.surfaceEl || !liveSupported()) return;
    var live = liveState(ctx);
    var view = liveView(ctx);
    if (live.active) return;
    live.active = true;
    live.noSpeech = 0;
    live.micOff = false;
    live.engine = preferredEngine();
    view.hidden = false;
    ctx.surfaceEl.classList.add('is-live');
    showCaption(ctx, '', '');
    startMeter(ctx);
    try { window.speechSynthesis.getVoices(); } catch (e) { /* voices arrive later */ }
    setLiveMode(ctx, 'idle', 'Say something. I’m listening.');
    liveListen(ctx);
    if (live.micBtn) live.micBtn.focus();
  }

  function closeLive(ctx) {
    var live = ctx && ctx.live;
    if (!live || !live.active) return;
    live.active = false;
    stopListening(ctx);
    stopSpeaking(ctx);
    stopMeter(ctx);
    if (live.view) live.view.hidden = true;
    if (ctx.surfaceEl) ctx.surfaceEl.classList.remove('is-live');
    setLiveMode(ctx, 'idle', '');
    showCaption(ctx, '', '');
    if (ctx.logEl) ctx.logEl.scrollTop = ctx.logEl.scrollHeight;
    if (ctx.inputEl) ctx.inputEl.focus();
  }

  function liveListen(ctx) {
    var live = liveState(ctx);
    if (!live.active || live.micOff || live.listening || ctx.busy) return;
    if (live.engine === 'server') {
      captureListen(ctx);
      return;
    }
    var Rec = recognitionClass();
    if (!Rec) {
      live.engine = 'server';
      captureListen(ctx);
      return;
    }
    stopSpeaking(ctx);
    var rec;
    try {
      rec = new Rec();
    } catch (e) {
      live.micOff = true;
      setLiveMode(ctx, 'idle', 'Voice isn’t available in this browser.');
      return;
    }
    rec.lang = liveLang();
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    var heard = '';
    var finalText = '';
    live.rec = rec;
    live.listening = true;
    setLiveMode(ctx, 'listening', 'Listening…');
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex || 0; i < e.results.length; i++) {
        var r = e.results[i];
        var t = (r[0] && r[0].transcript) || '';
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      heard = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
      showCaption(ctx, 'you', heard);
    };
    rec.onerror = function (e) {
      var code = (e && e.error) || '';
      if (code === 'aborted') return;
      if (code === 'no-speech') {
        live.noSpeech++;
        return;
      }
      if (code === 'network' || code === 'service-not-allowed') {
        // No service behind the browser's ear: the server has one.
        if (recorderSupported() && configured) {
          live.engine = 'server';
          storeSet(LS_VOICE_ENGINE, 'server');
          return;
        }
        live.micOff = true;
        setLiveMode(ctx, 'idle', 'Voice recognition isn’t available here.');
        return;
      }
      live.micOff = true;
      if (code === 'not-allowed') {
        setLiveMode(ctx, 'idle', 'Microphone access is blocked. Allow it in your browser settings.');
      } else if (code === 'audio-capture') {
        setLiveMode(ctx, 'idle', 'No microphone was found.');
      } else {
        setLiveMode(ctx, 'idle', 'I couldn’t hear you. Tap the mic to try again.');
      }
    };
    rec.onend = function () {
      if (live.rec !== rec) return;
      live.rec = null;
      live.listening = false;
      if (!live.active) return;
      var text = String(finalText || heard || '').replace(/\s+/g, ' ').trim();
      if (text) {
        live.noSpeech = 0;
        liveHeard(ctx, text);
        return;
      }
      afterSilence(ctx);
    };
    try {
      rec.start();
    } catch (e) {
      live.rec = null;
      live.listening = false;
      live.micOff = true;
      setLiveMode(ctx, 'idle', 'Voice isn’t available right now.');
    }
  }

  /* A pass that heard nothing: try again, and after two of them rest the
   * mic rather than listen to an empty room forever. Either ear. */
  function afterSilence(ctx) {
    var live = liveState(ctx);
    if (!live.active) return;
    if (live.micOff) {
      paintMic(ctx);
      return;
    }
    if (live.noSpeech >= 2) {
      live.noSpeech = 0;
      live.micOff = true;
      setLiveMode(ctx, 'idle', 'I didn’t catch that. Tap the mic to talk.');
      return;
    }
    setTimeout(function () { liveListen(ctx); }, 150);
  }

  /* The server ear: record until the reader has spoken and then gone quiet
   * (the meter's level is the voice detector), send the clip, take the
   * words back. Seven quiet seconds with no voice at all is a silent pass;
   * thirty seconds is the longest clip. */
  var CAPTURE_VOICE = 0.1;
  var CAPTURE_QUIET_MS = 1100;
  var CAPTURE_WAIT_MS = 7000;
  var CAPTURE_MAX_MS = 30000;

  function captureListen(ctx) {
    var live = liveState(ctx);
    if (!recorderSupported()) {
      live.micOff = true;
      setLiveMode(ctx, 'idle', 'Voice isn’t available in this browser.');
      return;
    }
    stopSpeaking(ctx);
    live.listening = true;
    setLiveMode(ctx, 'listening', 'Listening…');
    var ticket = {};
    live.capture = ticket;
    ensureMeter(ctx).then(function (meter) {
      if (live.capture !== ticket) return;
      if (!live.active || live.micOff || ctx.busy) {
        live.capture = null;
        live.listening = false;
        paintMic(ctx);
        return;
      }
      if (!meter || !meter.stream) {
        live.capture = null;
        live.listening = false;
        live.micOff = true;
        setLiveMode(ctx, 'idle', 'Microphone access is blocked. Allow it in your browser settings.');
        return;
      }
      var mime = recorderMime();
      var rec;
      try {
        rec = mime ? new MediaRecorder(meter.stream, { mimeType: mime }) : new MediaRecorder(meter.stream);
      } catch (e) {
        live.capture = null;
        live.listening = false;
        live.micOff = true;
        setLiveMode(ctx, 'idle', 'Voice isn’t available in this browser.');
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
        if (live.capture !== ticket) return;
        live.capture = null;
        live.listening = false;
        if (!live.active) return;
        if (!spoke || !chunks.length) {
          live.noSpeech++;
          afterSilence(ctx);
          return;
        }
        transcribe(ctx, new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      };
      ticket.timer = setInterval(function () {
        if (live.capture !== ticket) {
          clearInterval(ticket.timer);
          return;
        }
        var now = Date.now();
        if ((live.level || 0) > CAPTURE_VOICE) {
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
        live.capture = null;
        live.listening = false;
        live.micOff = true;
        setLiveMode(ctx, 'idle', 'Voice isn’t available right now.');
      }
    });
  }

  function transcribe(ctx, blob) {
    var live = liveState(ctx);
    setLiveMode(ctx, 'thinking', 'Thinking…');
    var form = new FormData();
    form.append('audio', blob, 'speech.' + recorderExt(blob.type));
    form.append('language', liveLang().slice(0, 2).toLowerCase());
    apiForm('/portal/bespoke/transcribe', form).then(function (data) {
      if (!live.active) return;
      var text = String((data && data.text) || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        live.noSpeech++;
        afterSilence(ctx);
        return;
      }
      live.noSpeech = 0;
      liveHeard(ctx, text);
    }).catch(function (err) {
      if (!live.active) return;
      live.micOff = true;
      var gone = err && (err.notFound || err.status === 503);
      setLiveMode(ctx, 'idle', gone ? 'Voice isn’t available here.' : 'I couldn’t hear you. Tap the mic to try again.');
    });
  }

  function stopListening(ctx) {
    var live = liveState(ctx);
    var rec = live.rec;
    var capture = live.capture;
    live.rec = null;
    live.capture = null;
    live.listening = false;
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
    if (!rec) return;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
    } catch (e) { /* already stopped */ }
  }

  function liveHeard(ctx, text) {
    showCaption(ctx, 'you', text);
    setLiveMode(ctx, 'thinking', 'Thinking…');
    ask(ctx, text);
  }

  /* Called from ask() with every answer, spoken or typed; only a live
   * session acts on it. */
  function liveAnswer(ctx, text, data) {
    var live = ctx && ctx.live;
    if (!live || !live.active) return;
    var spoken = speakable(text);
    if (data && Array.isArray(data.actions) && data.actions.length) spoken += ' The draft is in the chat.';
    showCaption(ctx, 'ai', text);
    if (live.speakerOff || !spoken) {
      setLiveMode(ctx, 'idle', '');
      setTimeout(function () { liveListen(ctx); }, 800);
      return;
    }
    liveSpeak(ctx, spoken);
  }

  function liveSpeak(ctx, text) {
    var live = liveState(ctx);
    var synth = window.speechSynthesis;
    stopSpeaking(ctx);
    var chunks = sentences(text);
    if (!chunks.length) {
      setLiveMode(ctx, 'idle', '');
      setTimeout(function () { liveListen(ctx); }, 300);
      return;
    }
    var lang = liveLang();
    var voice = pickVoice(lang);
    var token = {};
    live.speech = token;
    live.speaking = true;
    setLiveMode(ctx, 'speaking', 'Speaking…');
    var i = 0;
    function next() {
      if (live.speech !== token || !live.active) return;
      if (i >= chunks.length) {
        live.speaking = false;
        live.speech = null;
        live.utter = null;
        setLiveMode(ctx, 'idle', '');
        setTimeout(function () { liveListen(ctx); }, 250);
        return;
      }
      var u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1;
      u.pitch = 1;
      u.onboundary = function () { bump(ctx); };
      u.onend = next;
      u.onerror = function (e) {
        var code = (e && e.error) || '';
        if (code === 'interrupted' || code === 'canceled') return;
        next();
      };
      // Chrome drops the callbacks of an utterance nothing references.
      live.utter = u;
      synth.speak(u);
    }
    setTimeout(next, 30);
  }

  function stopSpeaking(ctx) {
    var live = liveState(ctx);
    live.speech = null;
    live.speaking = false;
    live.utter = null;
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) { /* nothing was speaking */ }
  }

  /* A word boundary while speaking: a nudge to the mark. */
  function bump(ctx) {
    var live = ctx.live;
    if (!live || !live.orbEl) return;
    live.orbEl.classList.remove('is-bump');
    void live.orbEl.offsetWidth;
    live.orbEl.classList.add('is-bump');
  }

  /* The reader's own voice, as a level for the bars and the orb. Best
   * effort: if the microphone stream is refused, recognition says so. */
  function startMeter(ctx) {
    var live = liveState(ctx);
    if (live.meter) return live.meter.ready;
    var meter = { stream: null, audio: null, raf: 0, dead: false, ready: null };
    live.meter = meter;
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
        live.level = smooth;
        if (live.view && live.mode === 'listening') live.view.style.setProperty('--level', smooth.toFixed(3));
        meter.raf = requestAnimationFrame(tick);
      }
      tick();
      return meter;
    }).catch(function () {
      // The browser ear reports its own permission errors; the server ear
      // reads the missing stream.
      return meter;
    });
    return meter.ready;
  }

  function ensureMeter(ctx) {
    var live = liveState(ctx);
    return live.meter ? live.meter.ready : startMeter(ctx);
  }

  function stopMeter(ctx) {
    var live = liveState(ctx);
    var meter = live.meter;
    live.level = 0;
    if (!meter) return;
    live.meter = null;
    meter.dead = true;
    if (meter.raf) cancelAnimationFrame(meter.raf);
    if (meter.stream) meter.stream.getTracks().forEach(function (t) { t.stop(); });
    if (meter.audio && meter.audio.close) meter.audio.close().catch(function () { /* already closed */ });
    if (live.view) live.view.style.removeProperty('--level');
  }

  function toggleMic(ctx) {
    var live = liveState(ctx);
    if (!live.active) return;
    if (live.listening) {
      live.micOff = true;
      stopListening(ctx);
      setLiveMode(ctx, 'idle', 'Microphone off. Tap to talk.');
      return;
    }
    if (live.mode === 'thinking') return;
    live.micOff = false;
    live.noSpeech = 0;
    liveListen(ctx);
  }

  function paintMic(ctx) {
    var live = ctx.live;
    if (!live || !live.micBtn) return;
    var off = !!live.micOff && !live.listening;
    live.micBtn.classList.toggle('is-off', off);
    live.micBtn.classList.toggle('is-listening', !!live.listening);
    live.micBtn.setAttribute('aria-pressed', live.listening ? 'true' : 'false');
    live.micBtn.setAttribute('aria-label', live.listening ? 'Stop listening' : (live.speaking ? 'Interrupt and talk' : 'Talk'));
    var img = live.micBtn.querySelector('img');
    if (img) img.src = off ? MIC_OFF : MIC;
  }

  function toggleSpeaker(ctx) {
    var live = liveState(ctx);
    live.speakerOff = !live.speakerOff;
    storeSet(LS_VOICE_OFF, live.speakerOff ? '1' : '0');
    paintSpeaker(ctx);
    if (live.speakerOff && live.speaking) {
      stopSpeaking(ctx);
      setLiveMode(ctx, 'idle', '');
      setTimeout(function () { liveListen(ctx); }, 200);
    }
  }

  function paintSpeaker(ctx) {
    var live = ctx.live;
    if (!live || !live.speakerBtn) return;
    live.speakerBtn.classList.toggle('is-off', !!live.speakerOff);
    live.speakerBtn.setAttribute('aria-pressed', live.speakerOff ? 'true' : 'false');
    live.speakerBtn.setAttribute('aria-label', live.speakerOff ? 'Unmute the voice' : 'Mute the voice');
    var img = live.speakerBtn.querySelector('img');
    if (img) img.src = live.speakerOff ? SPEAKER_OFF : SPEAKER;
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
    if (ctx.voiceBtn) {
      if (!liveSupported()) ctx.voiceBtn.hidden = true;
      else ctx.voiceBtn.addEventListener('click', function () { openLive(ctx); });
    }
    ctx.inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask(ctx, ctx.inputEl.value);
      }
    });
    ctx.logEl.addEventListener('click', onNavClick);
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
        '<form class="tma-bespoke__composer" data-bespoke-page-form>' +
          '<button type="button" class="tma-bespoke__clip" data-bespoke-page-clip aria-label="Attach files"><img src="' + CLIP + '" alt=""></button>' +
          '<input type="file" data-bespoke-page-file multiple accept="' + ACCEPT + '" hidden>' +
          '<textarea class="tma-bespoke__input" data-bespoke-page-input rows="1" placeholder="Ask about this portal" aria-label="Message Bespoke AI Assistant"></textarea>' +
          '<button type="button" class="tma-bespoke__voice" data-bespoke-page-voice aria-label="Talk live" title="Talk live"><img src="' + VOICE + '" alt=""></button>' +
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
    ctx.conversations.forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-bespoke-page__item' + (row.uuid === ctx.conversationId ? ' is-active' : '');
      btn.setAttribute('data-bespoke-open', row.uuid);
      btn.innerHTML =
        '<span class="tma-bespoke-page__item-title">' + escapeHtml(row.title || 'New chat') + '</span>' +
        '<span class="tma-bespoke-page__item-time">' + escapeHtml(timeLabel(row.updatedAt)) + '</span>' +
        '<span class="tma-bespoke-page__item-preview">' + escapeHtml(row.preview || '') + '</span>';
      btn.addEventListener('click', function () {
        openPageThread(ctx, row.uuid, true);
      });
      list.appendChild(btn);
    });
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
    storeSet(LS_CONV, ctx.conversationId);
    ctx.busy = false;
    if (ctx.logEl) ctx.logEl.innerHTML = '';
    setPageTitle(ctx, 'New chat');
    ctx.shell.classList.add('is-thread');
    renderPageList(ctx);
    refreshSuggestions(ctx);
    if (ctx.inputEl) ctx.inputEl.focus();
  }

  function openPageThread(ctx, id, pushUrl) {
    if (!id) {
      resetPageThread(ctx);
      if (pushUrl) replaceBespokeUrl('/bespoke-ai', null);
      return;
    }
    api('/portal/bespoke/conversations/' + encodeURIComponent(id)).then(function (data) {
      var conv = data.conversation || {};
      ctx.conversationId = conv.uuid || id;
      storeSet(LS_CONV, ctx.conversationId);
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
    if (page) closeLive(page);
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
      voiceBtn: root.querySelector('[data-bespoke-page-voice]'),
      surfaceEl: root.querySelector('.tma-bespoke-page__thread'),
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
            if (storeGet(LS_CONV, '') === ctx.conversationId) storeSet(LS_CONV, '');
            resetPageThread(ctx);
            replaceBespokeUrl('/bespoke-ai', null);
            loadPageList(ctx);
          });
      });
    });

    loadPageList(ctx).then(function (list) {
      var wanted = opts.conversationId || '';
      if (!wanted) {
        var stored = storeGet(LS_CONV, '');
        var found = list.filter(function (row) { return row.uuid === stored; })[0];
        if (found) wanted = found.uuid;
      }
      if (wanted) {
        openPageThread(ctx, wanted, !opts.conversationId);
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
        '<div class="sr-only" aria-live="polite" data-bespoke-live></div>' +
        '<div class="tma-bespoke__chips" data-bespoke-chips></div>' +
        '<div class="tma-bespoke__attach" data-bespoke-attach hidden></div>' +
        '<form class="tma-bespoke__composer" data-bespoke-form>' +
          '<button type="button" class="tma-bespoke__clip" data-bespoke-clip aria-label="Attach files"><img src="' + CLIP + '" alt=""></button>' +
          '<input type="file" data-bespoke-file multiple accept="' + ACCEPT + '" hidden>' +
          '<textarea class="tma-bespoke__input" data-bespoke-input rows="1" placeholder="Ask about this portal" aria-label="Message Bespoke AI Assistant"></textarea>' +
          '<button type="button" class="tma-bespoke__voice" data-bespoke-voice aria-label="Talk live" title="Talk live"><img src="' + VOICE + '" alt=""></button>' +
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
    widget.messages = [];
    widget.pending = [];
    renderAttachStrip(widget);
    widget.conversationId = uuid();
    storeSet(LS_CONV, widget.conversationId);
    if (widget.logEl) widget.logEl.innerHTML = '';
    refreshSuggestions(widget);
    if (widget.inputEl) widget.inputEl.focus();
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
    closeLive(widget);
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
    if (e.key === 'Escape' && page && page.live && page.live.active) {
      e.preventDefault();
      e.stopPropagation();
      closeLive(page);
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
      // The page's live voice ends with the page; the launcher's rides along.
      if (page && page.live && page.live.active && !isPagePath()) closeLive(page);
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
      voiceBtn: host.querySelector('[data-bespoke-voice]'),
      surfaceEl: panel,
      pending: [],
      messages: [],
      conversationId: storeGet(LS_CONV, ''),
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
      setOpen(false);
      go('/bespoke-ai');
    });
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
    closeLive(widget);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', trap, true);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = panel = fab = widget = null;
    open = false;
  }

  function consider() {
    if (isComposePopout()) return;
    if (enabled()) {
      ensurePageChrome();
      if (!host) mountWidget();
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
    if (window.TMABootBespoke !== true && window.TMABootBespoke !== 'true') {
      api('/portal/bespoke/suggestions').then(function (data) {
        window.TMABootBespoke = true;
        configured = !!(data && data.configured);
        consider();
      }).catch(function () { /* 404 = still dark */ });
    }
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
    mount: mountWidget
  };
})();
