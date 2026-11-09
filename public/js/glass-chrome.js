/*
 * TMA Portal — the iPhone app's bar and header in Liquid Glass (iOS 26 and later).
 *
 * The page's own glass is an imitation: it cannot take the look a person
 * picks in Settings > Display & Brightness > Liquid Glass (Clear or Tinted),
 * nor Reduce Transparency, Increase Contrast or Reduce Motion. Apple applies
 * those only to the system's material. So in the iPhone app the bottom bar
 * and the header's bubbles are drawn by the app itself, in that material
 * (ios/TMAPortal/GlassChrome.swift), and this file tells it what to draw:
 * where each one sits, its buttons and their icons, which tab is open, the
 * counts, and whether something on the page covers it.
 *
 * The page stays in charge. A tap on the app's glass comes back here and
 * clicks the page's own button, so its handlers run as they always have.
 * The page's copies keep their places (html.tma-native-glass makes them
 * invisible, dashboard-tma-overrides.css), so the layout, the popups that
 * hang from them and this file's measurements are unchanged.
 *
 * Only when the app says it draws them (TMADesktop.glassChrome, set by the
 * iPhone app's preload on iOS 26 and later). Everywhere else, nothing.
 */
(function () {
  'use strict';

  var host = window.TMADesktop;
  if (!host || !host.isIOS || !host.glassChrome || typeof host.setGlassChrome !== 'function') return;
  if (window.__tmaGlassChrome) return;

  /* The phone layout, where the bar and the bubbles exist. */
  var PHONE = window.matchMedia ? window.matchMedia('(max-width: 1024px)') : null;
  /* Icons go to the app drawn at three times their size: an iPhone's screen. */
  var ICON_SCALE = 3;

  /* What the app draws. Each is a bubble; "items" are the buttons in it. */
  var GROUPS = [
    { id: 'bar', selector: '.tma-dash:not(.tma-dash--desktop-bar) .tma-dash__tabbar', items: '.tma-dash__tab-btn', bar: true },
    { id: 'lead', selector: '.tma-dash__header .tma-dash__header-left', items: 'button, a[href]' },
    { id: 'trail', selector: '.tma-dash__header .tma-dash__header-icons', items: 'button, a[href]' },
    { id: 'mail', selector: '.tma-dash__header .tma-dash__email-header-tools', items: 'button, a[href]' },
    /* Reading a message, or with messages selected: back (or clear), and the actions. */
    { id: 'mail-back', selector: '.tma-dash__header .tma-dash__email-header-reading-back-btn', items: 'button' },
    { id: 'mail-actions', selector: '.tma-dash__header .tma-dash__email-header-reading-tools-group', items: 'button' }
  ];
  var BADGE = '.tma-dash__tab-badge, .tma-dash__icon-btn-badge';
  /* Icons from the portal's own sets are symbols, drawn in the glass's ink;
     anything else (the logo, a photo) keeps its own colours. */
  var SYMBOL = /\/images\/icons\//;

  /* Search bars, wherever they are: the buttons that open search, and every
     search input (in a list, a toolbar, a popup, a picker). An input is one
     when it says so (type="search"), or its placeholder starts with "Search"
     and it or the box around it is a search by name. */
  var SEARCH_BUTTONS = '.tma-dash__sidebar-mobile-search, .tma-dash__mmenu-search, [data-action="open-search"]';
  var SEARCH_INPUTS = 'input[type="search"], input[placeholder]';
  /* Taller than this, what paints around an input is a panel, not its field. */
  var FIELD_MAX_HEIGHT = 64;

  var byKey = new Map();
  var keys = new WeakMap();
  var counter = 0;
  var sent = new Set();
  var outgoing = {};
  var last = '';
  /* The page's copies this file has taken out of VoiceOver's reach. */
  var silenced = new Set();
  /* Search bars the app is drawing just now (html.tma-native-glass hides
     the page's own while they are drawn), and their stable ids. */
  var drawnFields = new Set();
  var fieldIds = new WeakMap();
  var fieldCount = 0;
  var waitingForFonts = false;

  document.documentElement.classList.add('tma-native-glass');

  /* ── Measuring ─────────────────────────────────────────────────────── */

  function half(n) { return Math.round(n * 2) / 2; }

  function box(el) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return r;
  }

  function rect(r, origin) {
    var ox = origin ? origin.left : 0;
    var oy = origin ? origin.top : 0;
    return [half(r.left - ox), half(r.top - oy), half(r.width), half(r.height)];
  }

  /* A corner radius in pixels: the computed value can be a percentage. */
  function radius(el, r) {
    var raw = getComputedStyle(el).borderTopLeftRadius || '0';
    var n = parseFloat(raw) || 0;
    if (raw.indexOf('%') !== -1) n = (n / 100) * Math.min(r.width, r.height);
    return half(n);
  }

  /* How much of it its containers leave showing while they fade. The bubbles
     themselves are made invisible by this file, so they don't count. */
  function fade(el, groupEls) {
    var o = 1;
    for (var n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (groupEls.indexOf(n) !== -1) continue;
      var v = parseFloat(getComputedStyle(n).opacity);
      if (!isNaN(v)) o *= v;
      if (o < 0.02) return 0;
    }
    return Math.round(o * 100) / 100;
  }

  /* Whether something lying over it paints nothing there: the phone's
     tap-outside-to-close layer behind an open menu is clear, so the bubble
     still shows through it. Checked from what was hit up to the nearest
     element that holds the bubble too. */
  function clearCover(hit, el) {
    for (var n = hit; n && !n.contains(el); n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (visibleColor(cs.backgroundColor)) return false;
      if (cs.backdropFilter && cs.backdropFilter !== 'none') return false;
      if (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') return false;
      if (n.tagName === 'IMG' || n.tagName === 'VIDEO' || n.tagName === 'CANVAS') return false;
    }
    return true;
  }

  /* Whether the page shows it ("open"), shows it under a clear layer that
     takes the taps ("under": the glass shows and lets taps through), or has
     anything that paints lying over any part of it: a sheet, a dimmed scrim,
     the menu sliding in ("covered"). The glass sits above the whole page, so
     it can't be partly hidden the way the page's copy can; it goes. Five
     points across its middle, two of them near its ends. */
  function exposure(el, r) {
    var y = r.top + r.height / 2;
    var open = 0;
    var under = 0;
    var covered = 0;
    [0.06, 0.25, 0.5, 0.75, 0.94].forEach(function (f) {
      var x = r.left + r.width * f;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return;
      var hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) open += 1;
      else if (hit && clearCover(hit, el)) under += 1;
      else covered += 1;
    });
    if (covered || !(open + under)) return 'covered';
    return under ? 'under' : 'open';
  }

  /* Content scrolled up under the header: the app softens the edge there. */
  function scrolledUnder(bottom) {
    var n = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight - 1, bottom + 8));
    for (; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
    }
    var page = document.scrollingElement;
    return !!(page && page.scrollTop > 0);
  }

  function visibleColor(css) {
    return !!css && css !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(css);
  }

  /* ── Keys: the app names a button by these when it is tapped ───────── */

  /* The button's first data attribute, with its value when it has a short
     one: "email-action=archive", "header-logo". */
  function dataName(node) {
    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      if (attr.name.indexOf('data-') !== 0 || attr.name === 'data-tooltip') continue;
      var value = attr.value && attr.value.length <= 32 ? '=' + attr.value : '';
      return attr.name.slice(5) + value;
    }
    return '';
  }

  function keyFor(groupId, node, used) {
    var key = keys.get(node);
    if (!key) {
      var name = node.getAttribute('data-tab') || node.getAttribute('data-action') || dataName(node) || 'n' + (++counter);
      key = groupId + ':' + name;
    }
    if (used.has(key)) key = key + '~' + (++counter);
    keys.set(node, key);
    used.add(key);
    return key;
  }

  function labelOf(node) {
    return (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().replace(/\s+/g, ' ');
  }

  /* ── Icons: drawn once into a PNG, then named by id ────────────────── */

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function draw(img, w, h, fit) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * ICON_SCALE));
    canvas.height = Math.max(1, Math.round(h * ICON_SCALE));
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var nw = img.naturalWidth || w;
    var nh = img.naturalHeight || h;
    if ((fit === 'cover' || fit === 'contain') && nw && nh) {
      var s = (fit === 'cover' ? Math.max : Math.min)(canvas.width / nw, canvas.height / nh);
      ctx.drawImage(img, (canvas.width - nw * s) / 2, (canvas.height - nh * s) / 2, nw * s, nh * s);
    } else {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      /* Another site's photo can't be copied off a canvas; the app fetches it. */
      return /^https?:/.test(img.currentSrc || img.src) ? (img.currentSrc || img.src) : null;
    }
  }

  function iconFor(img, r) {
    var src = img.currentSrc || img.src || '';
    if (!src) return null;
    var w = Math.round(r.width);
    var h = Math.round(r.height);
    var fit = getComputedStyle(img).objectFit;
    var id = (src.length > 160 ? 'h' + hash(src) : src) + '@' + w + 'x' + h + (fit === 'cover' ? 'c' : '');
    if (sent.has(id) || outgoing[id]) return id;
    var svg = /\.svg(\?|#|$)|^data:image\/svg/.test(src);
    if (!img.complete || (!img.naturalWidth && !svg)) {
      if (!img.__tmaGlassWaiting) {
        img.__tmaGlassWaiting = true;
        img.addEventListener('load', function () { img.__tmaGlassWaiting = false; schedule(); }, { once: true });
      }
      return null;
    }
    var data = draw(img, w, h, fit);
    if (!data) return null;
    outgoing[id] = data;
    return id;
  }

  function isRound(img, r) {
    var raw = getComputedStyle(img).borderTopLeftRadius || '0';
    var n = parseFloat(raw) || 0;
    return raw.indexOf('%') !== -1 ? n >= 50 : n >= Math.min(r.width, r.height) / 2 - 0.5;
  }

  /* ── An item: one button ───────────────────────────────────────────── */

  function firstVisible(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var r = box(nodes[i]);
      if (r) return { el: nodes[i], r: r };
    }
    return null;
  }

  /* A small coloured dot (the presence status), when there is no icon. */
  function dotOf(node, origin) {
    var spans = node.querySelectorAll('span, i');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].matches(BADGE)) continue;
      var r = box(spans[i]);
      if (!r || r.width > 16 || r.height > 16) continue;
      var bg = getComputedStyle(spans[i]).backgroundColor;
      if (visibleColor(bg)) return { color: bg, rect: rect(r, origin) };
    }
    return null;
  }

  function badgeOf(node, origin) {
    var el = node.querySelector(BADGE);
    if (!el || el.hidden) return null;
    var r = box(el);
    if (!r) return null;
    var cs = getComputedStyle(el);
    return { text: (el.textContent || '').trim(), rect: rect(r, origin), background: cs.backgroundColor, foreground: cs.color };
  }

  function itemOf(def, node, r, groupRect, used) {
    var key = keyFor(def.id, node, used);
    byKey.set(key, node);
    var item = { key: key, label: labelOf(node), rect: rect(r, groupRect) };
    var img = firstVisible(node.querySelectorAll('img'));
    if (img) {
      var icon = iconFor(img.el, img.r);
      if (icon) item.icon = icon;
      item.iconRect = rect(img.r, r);
      if (!SYMBOL.test(img.el.currentSrc || img.el.src || '')) item.original = true;
      if (isRound(img.el, img.r)) item.round = true;
    } else {
      var dot = dotOf(node, r);
      if (dot) item.dot = dot;
      else {
        var text = (node.textContent || '').trim().replace(/\s+/g, ' ');
        if (text && text.length <= 24) item.text = text;
      }
    }
    var badge = badgeOf(node, groupRect);
    if (badge) item.badge = badge;
    if (def.bar && node.classList.contains('tma-dash__tab-btn--active')) item.active = true;
    if (node.getAttribute('aria-expanded') === 'true') item.expanded = true;
    return item;
  }

  /* The glass carries the buttons' labels to VoiceOver, so the invisible
     copies under it are hidden from it too, or each would be heard twice.
     Only while the app draws them, and only what this file hid. */
  function silence(els) {
    silenced.forEach(function (el) {
      if (els.indexOf(el) === -1) {
        el.removeAttribute('aria-hidden');
        silenced.delete(el);
      }
    });
    els.forEach(function (el) {
      /* Left alone if the page hides it itself; put back if a re-render
         took this file's off. */
      if (!silenced.has(el) && el.hasAttribute('aria-hidden')) return;
      if (el.getAttribute('aria-hidden') !== 'true') el.setAttribute('aria-hidden', 'true');
      silenced.add(el);
    });
  }

  /* ── Search bars ───────────────────────────────────────────────────── */

  function isSearchInput(input) {
    if (input.type === 'search') return true;
    if (input.type && input.type !== 'text') return false;
    if (!/^\s*search\b/i.test(input.placeholder || '')) return false;
    for (var n = input, i = 0; n && i < 3; n = n.parentElement, i += 1) {
      var cls = typeof n.className === 'string' ? n.className : '';
      if (/search/i.test(cls) || n.getAttribute('role') === 'search') return true;
    }
    return false;
  }

  function paints(el) {
    var cs = getComputedStyle(el);
    if (visibleColor(cs.backgroundColor)) return true;
    return cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0 && visibleColor(cs.borderTopColor);
  }

  /* The field an input sits in: the nearest box around it that paints. An
     input with nothing drawn around it has no field to turn to glass. */
  function fieldShell(input) {
    for (var n = input, i = 0; n && i < 4; n = n.parentElement, i += 1) {
      if (n.getBoundingClientRect().height > FIELD_MAX_HEIGHT) return null;
      if (paints(n)) return n;
    }
    return null;
  }

  function fieldId(el) {
    var id = fieldIds.get(el);
    if (!id) {
      id = 'search-' + (++fieldCount);
      fieldIds.set(el, id);
    }
    return id;
  }

  function alphaOf(css) {
    var m = /rgba?\(([^)]*)\)/.exec(css || '');
    if (!m) return 1;
    var parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  }

  /* How strongly text sits on the glass, from how strongly the page draws it. */
  function toneOf(color) {
    var a = alphaOf(color);
    return a >= 0.7 ? 'primary' : a >= 0.35 ? 'secondary' : 'tertiary';
  }

  function contentBox(el, r) {
    var cs = getComputedStyle(el);
    var left = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    var right = (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    return { left: r.left + left, top: r.top, width: Math.max(1, r.width - left - right), height: r.height };
  }

  function whenFontsLoad() {
    if (waitingForFonts || !document.fonts || !document.fonts.ready) return;
    waitingForFonts = true;
    document.fonts.ready.then(function () { waitingForFonts = false; schedule(); });
  }

  /*
   * Whether the text can be drawn in its own font yet.
   *
   * Inter is served in pieces by character range, and a piece loads only when
   * text the page shows needs it. The page's own copy of a search bar's words
   * is hidden behind the glass, so nothing ever asked for its piece:
   * `fonts.ready` resolved with it still missing, the check failed on every
   * pass, and the bar showed no words at all, not even "Search". So the
   * faces this text needs are asked for outright, and if they have still not
   * come after a moment the words are drawn in whatever the font stack has:
   * a slightly different letter shape beats an empty search bar.
   */
  var FONT_GRACE_MS = 1200;
  var fontAsked = {};
  function fontReady(font, text) {
    if (!document.fonts || !document.fonts.check) return true;
    if (document.fonts.check(font, text)) return true;
    var key = font + '|' + text;
    if (!fontAsked[key]) {
      fontAsked[key] = Date.now();
      if (document.fonts.load) document.fonts.load(font, text).then(schedule, schedule);
      setTimeout(schedule, FONT_GRACE_MS + 50);
      whenFontsLoad();
      return false;
    }
    return Date.now() - fontAsked[key] >= FONT_GRACE_MS;
  }

  /* Text goes to the app drawn in the page's own font (Inter, which the app
     doesn't carry), as a mask the glass inks like its symbols. */
  function drawText(text, font, w, h, align) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * ICON_SCALE));
    canvas.height = Math.max(1, Math.round(h * ICON_SCALE));
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(ICON_SCALE, ICON_SCALE);
    ctx.font = font;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'middle';
    var shown = text;
    if (ctx.measureText(shown).width > w) {
      while (shown.length > 1 && ctx.measureText(shown + '…').width > w) shown = shown.slice(0, -1);
      shown += '…';
    }
    var tw = ctx.measureText(shown).width;
    var x = align === 'center' ? (w - tw) / 2 : (align === 'right' || align === 'end') ? w - tw : 0;
    ctx.fillText(shown, x, h / 2);
    return canvas.toDataURL('image/png');
  }

  function textMark(text, el, r, origin, tone) {
    var cs = getComputedStyle(el);
    var font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if (!fontReady(font, text)) return null;
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    var id = 't' + hash(text + '|' + font + '|' + w + 'x' + h + '|' + cs.textAlign);
    if (!sent.has(id) && !outgoing[id]) {
      var data = drawText(text, font, w, h, cs.textAlign);
      if (!data) return null;
      outgoing[id] = data;
    }
    return { icon: id, rect: rect(r, origin), tone: tone };
  }

  /* What a search bar shows: its icons, what is typed or the placeholder,
     and any other words in it (a "Search" label, a key hint). */
  function marksOf(f) {
    var marks = [];
    var imgs = f.el.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var ir = box(imgs[i]);
      if (!ir) continue;
      var icon = iconFor(imgs[i], ir);
      if (!icon) continue;
      var symbol = SYMBOL.test(imgs[i].currentSrc || imgs[i].src || '');
      var mark = { icon: icon, rect: rect(ir, f.r) };
      if (symbol) mark.tone = 'secondary';
      else mark.original = true;
      marks.push(mark);
    }
    if (f.input) {
      var typed = f.input.value;
      var words = typed || f.input.placeholder || '';
      var ir2 = box(f.input);
      if (words && ir2) {
        var tm = textMark(words, f.input, contentBox(f.input, ir2), f.r, typed ? 'primary' : 'secondary');
        if (tm) marks.push(tm);
      }
    }
    var leaves = f.el.querySelectorAll('span, kbd, label, b, strong, em, p, div');
    for (var j = 0; j < leaves.length; j++) {
      var leaf = leaves[j];
      if (leaf.children.length || leaf.matches(BADGE)) continue;
      var text = (leaf.textContent || '').trim();
      if (!text) continue;
      var lr = box(leaf);
      if (!lr) continue;
      var lm = textMark(text, leaf, lr, f.r, toneOf(getComputedStyle(leaf).color));
      if (lm) marks.push(lm);
    }
    return marks;
  }

  /* Every search bar showing: [{ el, r, input?, button? }]. */
  function searchFields() {
    var out = [];
    var seen = new Set();
    document.querySelectorAll(SEARCH_BUTTONS).forEach(function (btn) {
      var r = box(btn);
      if (r && r.height <= FIELD_MAX_HEIGHT && !seen.has(btn)) {
        seen.add(btn);
        out.push({ el: btn, r: r, button: true });
      }
    });
    document.querySelectorAll(SEARCH_INPUTS).forEach(function (input) {
      if (!isSearchInput(input) || !box(input)) return;
      var shell = fieldShell(input);
      var r = shell && box(shell);
      if (!r || seen.has(shell)) return;
      seen.add(shell);
      out.push({ el: shell, r: r, input: input });
    });
    return out;
  }

  /* Marks each search bar for the stylesheet: data-glass="drawn" while the
     app draws it (the page's own field hides), "field" otherwise (it shows,
     in the same glass look: being typed in, or partly covered). An attribute,
     not a class, so the pages that re-render through TMAMorph keep it
     (dom-morph.js leaves data-glass alone); written again whenever it's off. */
  function markFields(fields, drawn) {
    drawnFields.forEach(function (el) {
      if (fields.some(function (f) { return f.el === el; })) return;
      if (el.isConnected) el.setAttribute('data-glass', 'field');
      drawnFields.delete(el);
    });
    fields.forEach(function (f) {
      var want = drawn.indexOf(f.el) !== -1 ? 'drawn' : 'field';
      if (f.el.getAttribute('data-glass') !== want) f.el.setAttribute('data-glass', want);
      if (want === 'drawn') drawnFields.add(f.el);
      else drawnFields.delete(f.el);
    });
  }

  /* ── The whole picture ─────────────────────────────────────────────── */

  function collect() {
    byKey = new Map();
    if (PHONE && !PHONE.matches) {
      silence([]);
      markFields([], []);
      return null;
    }

    var found = [];
    GROUPS.forEach(function (def) {
      var els = document.querySelectorAll(def.selector);
      for (var i = 0, n = 0; i < els.length; i++) {
        var r = box(els[i]);
        if (r) found.push({ def: def, el: els[i], r: r, id: def.id + (n++ ? '-' + n : '') });
      }
    });
    var fields = searchFields().filter(function (f) {
      return !found.some(function (g) { return g.el === f.el || g.el.contains(f.el); });
    });
    var groupEls = found.map(function (g) { return g.el; }).concat(fields.map(function (f) { return f.el; }));

    /* A button belongs to the innermost bubble around it. */
    function owner(node) {
      for (var n = node; n; n = n.parentElement) {
        if (groupEls.indexOf(n) !== -1) return n;
      }
      return null;
    }

    var used = new Set();
    var groups = [];
    var drawnEls = [];
    var headerBottom = -1;
    found.forEach(function (g) {
      var nodes = g.el.matches(g.def.items) ? [g.el] : g.el.querySelectorAll(g.def.items);
      var items = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (owner(node) !== g.el) continue;
        var outer = node.parentElement && node.parentElement.closest(g.def.items);
        if (outer && g.el.contains(outer)) continue;
        var r = box(node);
        if (r) items.push(itemOf({ id: g.id, bar: g.def.bar }, node, r, g.r, used));
      }
      if (!items.length) return;
      var opacity = fade(g.el, groupEls);
      var seen = opacity > 0 ? exposure(g.el, g.r) : 'covered';
      var group = {
        id: g.id,
        rect: rect(g.r),
        radius: radius(g.el, g.r),
        shown: seen !== 'covered',
        opacity: opacity,
        items: items
      };
      if (seen === 'under') group.inert = true;
      if (g.def.bar) group.bar = true;
      else if (group.shown) headerBottom = Math.max(headerBottom, g.r.bottom);
      groups.push(group);
      drawnEls.push(g.el);
    });

    /* Search bars. A search button's glass is drawn by the app and tapped like
     * any other button. A search input is never drawn: the page's own field
     * stays on screen in the same glass look (data-glass="field"). Drawing it
     * meant hiding the real input under a picture of it and handing over on
     * focus, and in the app that hand-over lost taps, hid the caret (WebKit
     * suppresses it in a transparent field) and left bars with no words: the
     * search boxes didn't work. A real field just works. */
    var drawnFieldEls = [];
    fields.forEach(function (f) {
      if (f.input) return;
      var opacity = fade(f.el, groupEls);
      var seen = opacity > 0 ? exposure(f.el, f.r) : 'covered';
      if (seen === 'covered') return;
      var item = {
        key: f.button ? keyFor('search', f.el, used) : fieldId(f.el),
        label: f.input ? (f.input.getAttribute('aria-label') || f.input.placeholder || '') : labelOf(f.el),
        rect: [0, 0, half(f.r.width), half(f.r.height)],
        marks: marksOf(f)
      };
      if (f.button) byKey.set(item.key, f.el);
      var group = { id: fieldId(f.el), field: true, rect: rect(f.r), radius: radius(f.el, f.r), shown: true, opacity: opacity, items: [item] };
      if (!f.button || seen === 'under') group.inert = true;
      groups.push(group);
      drawnFieldEls.push(f.el);
      if (f.button) drawnEls.push(f.el);
    });
    markFields(fields, drawnFieldEls);

    silence(drawnEls);
    if (!groups.length) return null;

    var vv = window.visualViewport;
    return {
      width: document.documentElement.clientWidth || window.innerWidth,
      viewport: vv ? [half(vv.offsetLeft), half(vv.offsetTop), Math.round(vv.scale * 1000) / 1000] : [0, 0, 1],
      scrolled: headerBottom >= 0 && scrolledUnder(headerBottom),
      groups: groups
    };
  }

  /* Sends what changed: the state when it differs, and icons the app lacks. */
  function flush() {
    var json = JSON.stringify(collect());
    var icons = Object.keys(outgoing);
    if (json === last && !icons.length) return false;
    last = json;
    var message = '{"state":' + json;
    if (icons.length) {
      message += ',"icons":' + JSON.stringify(outgoing);
      icons.forEach(function (id) { sent.add(id); });
      outgoing = {};
    }
    host.setGlassChrome(message + '}');
    return true;
  }

  /* ── When to look ─────────────────────────────────────────────────────
   * After anything that may move, cover or change them, for a few frames, so
   * the app follows the page's own transitions; and once a second besides. */

  var raf = 0;
  var frames = 0;

  function tick() {
    raf = 0;
    if (flush()) frames = Math.max(frames, 10);
    frames -= 1;
    if (frames > 0) raf = requestAnimationFrame(tick);
  }

  function schedule() {
    frames = 20;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  window.__tmaGlassChrome = {
    /* The app's glass was tapped: the page's own button is clicked. */
    tap: function (key) {
      var node = byKey.get(String(key));
      if (!node || !node.isConnected) return false;
      node.click();
      schedule();
      return true;
    },
    /* The app is missing an icon: send them all again. */
    resend: function () {
      sent.clear();
      outgoing = {};
      last = '';
      schedule();
    }
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style', 'src', 'aria-label', 'aria-expanded', 'data-theme', 'open']
  });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('pageshow', function () { last = ''; schedule(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  /* A search bar hands over to the page's own field on focus and back on
     blur, and shows what was typed. */
  document.addEventListener('focusin', schedule, true);
  document.addEventListener('focusout', schedule, true);
  document.addEventListener('input', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  document.addEventListener('load', schedule, true);
  if (PHONE && PHONE.addEventListener) PHONE.addEventListener('change', schedule);
  setInterval(function () { if (!raf) flush(); }, 1000);
  schedule();
})();
