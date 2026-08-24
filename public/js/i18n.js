/* Portal display language + time zone (Settings → Time and language).
 *
 * Language: 'auto' (the default) resolves from the browser; an explicit
 * choice wins. Only shipped dictionaries are offered. The active language's
 * dictionary loads from /js/i18n/<lang>.js and is applied to the DOM on load
 * and on every SPA re-render via a MutationObserver, exact string matches
 * plus a small set of patterns for dynamic text ("3 of 10 messages").
 *
 * Time: every date the portal prints goes through Date#toLocale*() or
 * Intl.DateTimeFormat. Both are wrapped so that (a) a manually chosen time
 * zone becomes the default timeZone everywhere, and (b) a non-English
 * language becomes the default locale, month names, weekday names and
 * number order follow the language without touching each call site. With
 * auto time zone (the default) the device zone is already correct, so no
 * timeZone default is injected.
 *
 * English + auto costs nothing: no patch, no observer, immediate return.
 */
(function () {
  'use strict';

  if (window.TMAI18n) return;

  var SHIPPED = { en: 1, es: 1, fr: 1, 'zh-hans': 1 };
  var LOCALE_TAG = { es: 'es', fr: 'fr', 'zh-hans': 'zh-Hans' };

  var stored = 'auto';
  try { stored = localStorage.getItem('tma.language') || 'auto'; } catch (e) {}

  var lang = stored;
  if (lang === 'auto') {
    var nav = String(navigator.language || 'en').toLowerCase();
    lang = nav.indexOf('es') === 0 ? 'es'
      : nav.indexOf('fr') === 0 ? 'fr'
      : nav.indexOf('zh') === 0 ? 'zh-hans'
      : 'en';
  }
  if (!SHIPPED[lang]) lang = 'en';

  try { document.documentElement.setAttribute('lang', LOCALE_TAG[lang] || 'en'); } catch (e) {}

  /* ── Time zone + locale defaults for every printed date ─────────── */

  var manualZone = null;
  try {
    if (localStorage.getItem('tma.autoTimezone') === '0') {
      var z = localStorage.getItem('tma.timezone') || '';
      var m = /^utc([+-])(\d{1,2})$/i.exec(z);
      if (m) {
        var n = parseInt(m[2], 10);
        // POSIX Etc zones carry inverted signs: UTC-5 is Etc/GMT+5.
        z = n === 0 ? 'Etc/GMT' : 'Etc/GMT' + (m[1] === '-' ? '+' : '-') + n;
      }
      if (z) {
        new Intl.DateTimeFormat('en', { timeZone: z }); // throws on junk
        manualZone = z;
      }
    }
  } catch (e) { manualZone = null; }

  var localeTag = LOCALE_TAG[lang] || null;

  if (manualZone || localeTag) {
    ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (fn) {
      var orig = Date.prototype[fn];
      Date.prototype[fn] = function (locales, options) {
        var opts = options ? Object.assign({}, options) : {};
        if (manualZone && !opts.timeZone) opts.timeZone = manualZone;
        return orig.call(this, locales || localeTag || undefined, opts);
      };
    });

    var OrigDTF = Intl.DateTimeFormat;
    var PatchedDTF = function (locales, options) {
      var opts = options ? Object.assign({}, options) : {};
      if (manualZone && !opts.timeZone) opts.timeZone = manualZone;
      return new OrigDTF(locales || localeTag || undefined, opts);
    };
    PatchedDTF.prototype = OrigDTF.prototype;
    PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf;
    Intl.DateTimeFormat = PatchedDTF;
  }

  /* ── Dictionary loading + DOM translation ───────────────────────── */

  var dict = null;
  var patterns = [];

  window.TMAI18n = {
    lang: lang,
    choice: stored,
    available: ['auto', 'en', 'es', 'fr', 'zh-hans'],
    zone: manualZone,
    t: function (s) { return (dict && dict[s]) || s; },
  };

  if (lang === 'en') return;

  var ATTRS = ['placeholder', 'aria-label', 'title'];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

  function lookup(trimmed) {
    var hit = dict[trimmed];
    if (hit) return hit;
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i][0].test(trimmed)) {
        return trimmed.replace(patterns[i][0], patterns[i][1]);
      }
    }
    return null;
  }

  function translateTextNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed || trimmed.length > 120) return;
    var out = lookup(trimmed);
    if (out && out !== trimmed) node.nodeValue = raw.replace(trimmed, out);
  }

  function translate(rootEl) {
    if (!rootEl) return;
    if (rootEl.nodeType === 3) { translateTextNode(rootEl); return; }
    if (rootEl.nodeType !== 1 || SKIP[rootEl.nodeName]) return;

    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        return p && !SKIP[p.nodeName] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (var n = walker.nextNode(); n; n = walker.nextNode()) translateTextNode(n);

    var all = rootEl.querySelectorAll('[placeholder],[aria-label],[title]');
    for (var i = 0; i < all.length; i++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = all[i].getAttribute(ATTRS[a]);
        if (!v) continue;
        var out = lookup(v.trim());
        if (out) all[i].setAttribute(ATTRS[a], out);
      }
    }
  }

  var pending = [];
  var timer = null;

  function flush() {
    timer = null;
    var batch = pending;
    pending = [];
    for (var i = 0; i < batch.length; i++) translate(batch[i]);
  }

  function boot() {
    if (!dict || !document.body) return;
    translate(document.body);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) pending.push(added[j]);
      }
      if (pending.length && !timer) timer = setTimeout(flush, 80);
    }).observe(document.body, { childList: true, subtree: true });
  }

  var script = document.createElement('script');
  script.src = (window.__TMA_SITE_ROOT || '') + '/js/i18n/' + lang + '.js?v=1';
  script.onload = function () {
    var data = window.TMAI18nDict || {};
    dict = data.strings || {};
    (data.patterns || []).forEach(function (p) {
      try { patterns.push([new RegExp(p[0]), p[1]]); } catch (e) { /* skip bad pattern */ }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  };
  document.head.appendChild(script);
})();
