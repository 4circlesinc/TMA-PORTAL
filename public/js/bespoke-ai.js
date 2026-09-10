/*
 * Bespoke AI — in-portal assistant.
 * Vanilla IIFE. Global: window.TMABespoke
 *
 * Mounts only when FEATURE_BESPOKE is on (TMABootBespoke). Stays off the
 * sign-in shells and the email compose popout.
 */
(function () {
  'use strict';

  var LS_OPEN = 'tma.bespoke.open';
  var LS_CONV = 'tma.bespoke.conversationId';
  var SIDEBAR_BP = 1024;
  var MARK = 'images/brand/tma/tma-logo-mark.png';
  var PLUS = 'images/icons/phosphor/Plus.svg';
  var CLOSE = 'images/icons/phosphor/X.svg';
  var SEND = 'images/icons/phosphor/PaperPlaneTilt.svg';
  var COPY = 'images/icons/phosphor/Copy.svg';

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
  var logEl = null;
  var chipsEl = null;
  var inputEl = null;
  var liveEl = null;
  var bannerEl = null;
  var subEl = null;
  var sendBtn = null;
  var lastFocus = null;
  var open = false;
  var busy = false;
  var configured = false;
  var conversationId = storeGet(LS_CONV, '');
  var faq = FALLBACK_FAQ.slice();
  var allowedPaths = ['/', '/calendar', '/signatures', '/social/messages', '/account-settings', '/folders/recent'];
  var messages = [];

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

  function ensureConversation() {
    if (!conversationId) {
      conversationId = uuid();
      storeSet(LS_CONV, conversationId);
    }
    return conversationId;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      headers['X-XSRF-TOKEN'] = csrf();
    }
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 404) return Promise.reject({ notFound: true });
      if (!res.ok) return Promise.reject({ status: res.status });
      return res.json();
    });
  }

  function refreshSuggestions() {
    var path = currentPath();
    var qs = '?path=' + encodeURIComponent(path) +
      '&view=' + encodeURIComponent(currentView()) +
      '&title=' + encodeURIComponent(currentTitle());
    return api('/portal/bespoke/suggestions' + qs).then(function (data) {
      configured = !!data.configured;
      if (Array.isArray(data.faq) && data.faq.length) faq = data.faq;
      if (Array.isArray(data.allowedPaths) && data.allowedPaths.length) allowedPaths = data.allowedPaths;
      if (bannerEl) {
        bannerEl.hidden = configured;
      }
      if (subEl) subEl.textContent = data.subtitle || 'How can I help?';
      renderChips(data.chips || []);
      if (window.TMACurrentUser && window.TMACurrentUser.get) {
        var me = window.TMACurrentUser.get();
        if (me && me.bespoke) me.bespoke.configured = configured;
      }
    }).catch(function (err) {
      if (err && err.notFound) {
        destroy();
        return;
      }
      renderChips(localChips());
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
    return [
      { id: 'dash-what', label: 'What’s on this dashboard?', prompt: 'What’s on this dashboard?' },
      { id: 'start-cip', label: 'How do I start a CIP application?', prompt: 'How do I start a CIP application?' },
      { id: 'files-where', label: 'Where is File Library?', prompt: 'Where is File Library?' },
      { id: 'autosave', label: 'How does draft autosave work?', prompt: 'How does draft autosave work?' }
    ];
  }

  function renderChips(chips) {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    if (!chips || !chips.length || messages.length) {
      chipsEl.hidden = true;
      return;
    }
    chipsEl.hidden = false;
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
        ask(chip.prompt || chip.label);
      });
      chipsEl.appendChild(btn);
    });
  }

  function appendRow(role, html, opts) {
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
    bubble.innerHTML = html;
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
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
    return bubble;
  }

  function showTyping() {
    return appendRow('assistant', '<span class="tma-bespoke__typing" aria-hidden="true"><span></span><span></span><span></span></span>');
  }

  function typeInto(bubble, text) {
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
    logEl.scrollTop = logEl.scrollHeight;
    announce(text);
  }

  function announce(text) {
    if (!liveEl) return;
    liveEl.textContent = text.replace(/\s+/g, ' ').slice(0, 280);
  }

  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    messages.push({ role: 'user', content: text });
    appendRow('user', renderLite(text));
    renderChips([]);
    inputEl.value = '';
    resizeInput();
    busy = true;
    sendBtn.disabled = true;
    var bubble = showTyping();

    var local = matchFaq(text);
    api('/portal/bespoke/chat', {
      method: 'POST',
      body: {
        messages: messages,
        conversationId: ensureConversation(),
        clientContext: {
          path: currentPath(),
          view: currentView(),
          title: currentTitle(),
          fieldHints: fieldHints()
        }
      }
    }).then(function (data) {
      configured = !!data.configured;
      if (bannerEl) bannerEl.hidden = configured;
      if (data.conversationId) {
        conversationId = data.conversationId;
        storeSet(LS_CONV, conversationId);
      }
      var reply = data.reply || '';
      messages.push({ role: 'assistant', content: reply });
      typeInto(bubble, reply);
    }).catch(function (err) {
      if (err && err.notFound) {
        destroy();
        return;
      }
      var fallback = local && local.answer
        ? local.answer
        : 'I could not reach Bespoke AI. Try a suggestion, or ask an administrator.';
      messages.push({ role: 'assistant', content: fallback });
      typeInto(bubble, fallback);
    }).then(function () {
      busy = false;
      sendBtn.disabled = !String(inputEl.value || '').trim();
      inputEl.focus();
    });
  }

  function newChat() {
    messages = [];
    conversationId = uuid();
    storeSet(LS_CONV, conversationId);
    if (logEl) logEl.innerHTML = '';
    refreshSuggestions();
    if (inputEl) inputEl.focus();
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
      refreshSuggestions();
      setTimeout(function () {
        if (inputEl) inputEl.focus();
      }, 40);
    } else if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    } else if (fab) {
      fab.focus();
    }
  }

  function toggle() {
    setOpen(!open);
  }

  function resizeInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 4 * 22 + 16) + 'px';
    sendBtn.disabled = busy || !String(inputEl.value || '').trim();
  }

  function markup() {
    return '<button type="button" class="tma-bespoke__fab" data-bespoke-fab aria-label="Open Bespoke AI" aria-expanded="false" aria-controls="tma-bespoke-panel">' +
      '<img class="tma-bespoke__mark" src="' + MARK + '" alt="" width="32" height="32">' +
      '</button>' +
      '<div class="tma-bespoke__panel" id="tma-bespoke-panel" role="dialog" aria-modal="true" aria-labelledby="tma-bespoke-title" aria-hidden="true" inert>' +
        '<div class="tma-bespoke__head">' +
          '<div class="tma-bespoke__identity">' +
            '<img class="tma-bespoke__mark" src="' + MARK + '" alt="" width="28" height="28">' +
            '<div class="tma-bespoke__titles">' +
              '<p class="tma-bespoke__name" id="tma-bespoke-title">Bespoke AI</p>' +
              '<p class="tma-bespoke__sub" data-bespoke-sub>How can I help?</p>' +
            '</div>' +
          '</div>' +
          '<div class="tma-bespoke__head-actions">' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-new aria-label="New chat"><img src="' + PLUS + '" alt=""></button>' +
            '<button type="button" class="tma-bespoke__icon-btn" data-bespoke-close aria-label="Close"><img src="' + CLOSE + '" alt=""></button>' +
          '</div>' +
        '</div>' +
        '<p class="tma-bespoke__banner" data-bespoke-banner>Bespoke AI isn’t configured for live answers. Navigation and the user guide still work.</p>' +
        '<div class="tma-bespoke__log" data-bespoke-log></div>' +
        '<div class="sr-only" aria-live="polite" data-bespoke-live></div>' +
        '<div class="tma-bespoke__chips" data-bespoke-chips></div>' +
        '<form class="tma-bespoke__composer" data-bespoke-form>' +
          '<textarea class="tma-bespoke__input" data-bespoke-input rows="1" placeholder="Ask about this portal" aria-label="Message Bespoke AI"></textarea>' +
          '<button type="submit" class="tma-bespoke__send" data-bespoke-send disabled aria-label="Send"><img src="' + SEND + '" alt=""></button>' +
        '</form>' +
      '</div>';
  }

  function onKey(e) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'j') {
      e.preventDefault();
      toggle();
    }
  }

  function onNavClick(e) {
    var a = e.target.closest && e.target.closest('[data-bespoke-nav]');
    if (!a) return;
    var href = a.getAttribute('data-bespoke-nav') || a.getAttribute('href');
    if (!href || href.charAt(0) !== '/') return;
    e.preventDefault();
    go(href);
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
      if (open) refreshSuggestions();
    });
  }

  function mount() {
    if (host || !enabled() || isComposePopout()) return;
    var dash = document.querySelector('.tma-dash');
    if (!dash) return;

    host = document.createElement('div');
    host.className = 'tma-bespoke';
    host.innerHTML = markup();
    document.body.appendChild(host);

    fab = host.querySelector('[data-bespoke-fab]');
    panel = host.querySelector('.tma-bespoke__panel');
    logEl = host.querySelector('[data-bespoke-log]');
    chipsEl = host.querySelector('[data-bespoke-chips]');
    inputEl = host.querySelector('[data-bespoke-input]');
    liveEl = host.querySelector('[data-bespoke-live]');
    bannerEl = host.querySelector('[data-bespoke-banner]');
    subEl = host.querySelector('[data-bespoke-sub]');
    sendBtn = host.querySelector('[data-bespoke-send]');

    fab.addEventListener('click', toggle);
    host.querySelector('[data-bespoke-close]').addEventListener('click', function () { setOpen(false); });
    host.querySelector('[data-bespoke-new]').addEventListener('click', newChat);
    host.querySelector('[data-bespoke-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      ask(inputEl.value);
    });
    inputEl.addEventListener('input', resizeInput);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask(inputEl.value);
      }
    });
    panel.addEventListener('click', onNavClick);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', trap, true);

    wrapHistory();
    renderChips(localChips());

    if (storeGet(LS_OPEN, '') === '1') setOpen(true);
    else refreshSuggestions();
  }

  function destroy() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', trap, true);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = panel = fab = logEl = chipsEl = inputEl = liveEl = bannerEl = subEl = sendBtn = null;
    open = false;
  }

  function start() {
    if (!enabled() || isComposePopout()) return;
    mount();
    if (window.TMACurrentUser && window.TMACurrentUser.onChange) {
      window.TMACurrentUser.onChange(function (me) {
        if (me && me.bespoke && me.bespoke.enabled === false) destroy();
        else if (!host) mount();
        if (me && me.bespoke) configured = !!me.bespoke.configured;
        if (bannerEl) bannerEl.hidden = configured;
      });
    }
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
    mount: mount
  };
})();
