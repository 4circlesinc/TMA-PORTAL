/*
 * Swiping between tabs, on a phone.
 *
 * A page whose sections are a tab row (CIP Applications' lists, an
 * application's Overview, Applicant, Documents…) moves to the next or the
 * previous tab under a sideways swipe across what the tab shows, the way a
 * phone's own apps page through their sections.
 *
 * The swipe only chooses. It clicks the tab, so everything a tap does (the
 * state, the URL, loading what that tab needs) still happens in one place,
 * the page's own handler, and the two can never disagree.
 *
 * Opt in with data-tab-swipe on the element the swipe runs across. Its value
 * names the tab row when the row lives somewhere else (CIP's list tabs sit in
 * the page head, above the list); left empty, it is the first tablist inside.
 * The nearest one to the finger wins, so an application's own tabs beat the
 * list's around them.
 *
 * What the tab shows goes with the finger. Let go past a third of the way, or
 * with a flick, and it carries on out while the next tab's comes in from the
 * other side; short of that it settles back. Past the first or the last tab
 * it gives a little and comes back, so the end is felt rather than guessed.
 *
 * Not a swipe: a touch that starts at either edge of the screen (the back
 * swipe, the menu), on the tab row itself (it scrolls), in a field, or on
 * something that scrolls sideways and still can that way.
 */
(function () {
  'use strict';

  if (window.TMATabSwipe) return;

  var EDGE = 24;        // px at each side of the screen left to back and the menu
  var SLOP = 10;        // movement before a direction is decided
  var AXIS = 1.4;       // how much more sideways than down a swipe must be
  var COMMIT = 0.3;     // share of the width that counts as meant
  var FLICK = 0.45;     // px/ms that counts as meant however short
  var FLICK_MIN = 28;   // ...as long as it went at least this far
  var OUT_MS = 140;
  var IN_MS = 280;
  var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var SKIP = 'input, textarea, select, [contenteditable=""], [contenteditable="true"],' +
    ' [role="tablist"], [role="slider"], [role="menu"], [role="listbox"], [role="dialog"],' +
    ' [data-no-tab-swipe]';

  var gesture = null;
  var busy = false;
  var swallowClickUntil = 0;
  var choosing = false;

  function shown(el) {
    return !!(el && el.isConnected && el.getClientRects().length);
  }

  function tablistFor(surface) {
    var sel = surface.getAttribute('data-tab-swipe');
    var list = null;
    try {
      list = sel
        ? (surface.querySelector(sel) || document.querySelector(sel))
        : surface.querySelector('[role="tablist"]');
    } catch (e) { list = null; }

    return shown(list) ? list : null;
  }

  function tabsOf(list) {
    return Array.prototype.filter.call(list.querySelectorAll('[role="tab"]'), function (t) {
      return !t.disabled && t.getAttribute('aria-disabled') !== 'true' && shown(t);
    });
  }

  function activeIndex(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('aria-selected') === 'true' || tabs[i].classList.contains('is-active')) return i;
    }

    return -1;
  }

  /* Everything the tab shows. A row outside the surface (the page head's)
     leaves the whole surface to move; a row inside it moves what comes after
     it, so the row itself and anything above it (the toolbar) stay put. */
  function movingParts(surface, list) {
    if (!surface.contains(list)) return [surface];

    var top = list;
    while (top.parentElement && top.parentElement !== surface) top = top.parentElement;
    var parts = [];
    for (var n = top.nextElementSibling; n; n = n.nextElementSibling) {
      if (shown(n)) parts.push(n);
    }

    return parts;
  }

  /* Sideways scrollers between the finger and the surface, as they stood
     when the finger came down. */
  function scrollersUnder(target, surface) {
    var found = [];
    for (var el = target; el && el !== surface.parentElement; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      var ox = getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      found.push({
        el: el,
        left: Math.abs(el.scrollLeft),
        max: el.scrollWidth - el.clientWidth,
        rtl: getComputedStyle(el).direction === 'rtl',
      });
    }

    return found;
  }

  /* Can any of them still go the way the finger is going? Then it is theirs. */
  function scrollerWants(scrollers, dx) {
    for (var i = 0; i < scrollers.length; i++) {
      var s = scrollers[i];
      var towardEnd = s.rtl ? dx > 0 : dx < 0;
      var room = towardEnd ? s.max - s.left : s.left;
      if (room > 1) return true;
    }

    return false;
  }

  function haptic() {
    var host = window.TMADesktop;
    if (host && typeof host.haptic === 'function') {
      try { host.haptic('light'); } catch (e) { /* an older app */ }
      return;
    }
    if (navigator.vibrate) {
      try { navigator.vibrate(8); } catch (e) { /* not allowed here */ }
    }
  }

  function paint(parts, x, fade) {
    var t = x ? 'translate3d(' + x + 'px,0,0)' : '';
    for (var i = 0; i < parts.length; i++) {
      parts[i].style.transform = t;
      parts[i].style.opacity = fade == null || fade >= 1 ? '' : String(fade);
    }
  }

  function setTransition(parts, value) {
    for (var i = 0; i < parts.length; i++) parts[i].style.transition = value;
  }

  function clear(parts) {
    for (var i = 0; i < parts.length; i++) {
      parts[i].style.transition = '';
      parts[i].style.transform = '';
      parts[i].style.opacity = '';
      parts[i].style.willChange = '';
    }
  }

  function fadeFor(x, w) {
    return 1 - Math.min(0.35, Math.abs(x) / (w || 1) * 0.5);
  }

  /* Past the last tab the content gives a little, and less the further. */
  function banded(dx, w) {
    var limit = Math.max(40, w * 0.12);
    var a = Math.abs(dx);

    return (dx < 0 ? -1 : 1) * limit * (1 - 1 / (a / limit + 1));
  }

  function velocity(g) {
    var s = g.samples;
    if (s.length < 2) return 0;
    var a = s[0];
    var b = s[s.length - 1];
    var dt = b.t - a.t;
    if (dt <= 0) return b.x > a.x ? 10 : b.x < a.x ? -10 : 0;

    return (b.x - a.x) / dt;
  }

  /* The newly lit tab, in sight on a row that scrolls sideways. */
  function reveal(list) {
    var tabs = tabsOf(list);
    var on = tabs[activeIndex(tabs)];
    if (!on) return;
    var box = list;
    while (box && box !== document.body && box.scrollWidth <= box.clientWidth + 1) box = box.parentElement;
    if (!box || box === document.body) return;
    var g = box.getBoundingClientRect();
    var a = on.getBoundingClientRect();
    var by = 0;
    if (a.left < g.left) by = -((g.left - a.left) + 16);
    else if (a.right > g.right) by = (a.right - g.right) + 16;
    if (!by) return;
    try { box.scrollBy({ left: by, behavior: 'smooth' }); } catch (e) { box.scrollLeft += by; }
  }

  function settleBack(parts) {
    setTransition(parts, 'transform ' + IN_MS + 'ms ' + EASE + ', opacity ' + IN_MS + 'ms ' + EASE);
    paint(parts, 0, 1);
    setTimeout(function () { clear(parts); }, IN_MS + 40);
  }

  function goTo(g, target) {
    busy = true;
    var parts = g.parts;
    var w = g.w;
    var out = g.forward ? -1 : 1;

    setTransition(parts, 'transform ' + OUT_MS + 'ms ease-in, opacity ' + OUT_MS + 'ms ease-in');
    paint(parts, Math.round(out * w * 0.45), 0);
    haptic();

    setTimeout(function () {
      clear(parts);
      choosing = true;
      try { target.click(); } finally { choosing = false; }

      // The page has drawn the new tab; it comes in from the other side.
      var list = tablistFor(g.surface) || g.list;
      var next = list ? movingParts(g.surface, list) : parts;
      setTransition(next, 'none');
      paint(next, Math.round(-out * w * 0.3), 0);
      void (next[0] && next[0].offsetWidth);
      setTransition(next, 'transform ' + IN_MS + 'ms ' + EASE + ', opacity ' + IN_MS + 'ms ' + EASE);
      paint(next, 0, 1);
      if (list) reveal(list);
      setTimeout(function () {
        clear(next);
        busy = false;
      }, IN_MS + 40);
    }, OUT_MS);
  }

  function onStart(e) {
    // A second finger mid-swipe ends it; what moved goes back first.
    if (gesture && gesture.engaged) onCancel();
    gesture = null;
    if (busy || !e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    var target = e.target;
    if (!target || !target.closest) return;
    var surface = target.closest('[data-tab-swipe]');
    if (!surface) return;
    if (t.clientX <= EDGE || t.clientX >= window.innerWidth - EDGE) return;
    if (target.closest(SKIP)) return;

    var list = tablistFor(surface);
    if (!list) return;
    var tabs = tabsOf(list);
    if (tabs.length < 2) return;

    gesture = {
      surface: surface,
      list: list,
      tabs: tabs,
      at: activeIndex(tabs),
      x: t.clientX,
      y: t.clientY,
      scrollers: scrollersUnder(target, surface),
      rtl: getComputedStyle(list).direction === 'rtl',
      engaged: false,
      dead: false,
      dx: 0,
      samples: [{ x: t.clientX, t: e.timeStamp || Date.now() }],
    };
  }

  function onMove(e) {
    var g = gesture;
    if (!g || g.dead || !e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - g.x;
    var dy = t.clientY - g.y;

    if (!g.engaged) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) { g.dead = true; return; }
      if (Math.abs(dx) <= SLOP) return;
      if (Math.abs(dx) < Math.abs(dy) * AXIS) { g.dead = true; return; }
      // Already scrolling (the page took it first), or a list that scrolls
      // sideways and has further to go: theirs, not ours.
      if (!e.cancelable || scrollerWants(g.scrollers, dx)) { g.dead = true; return; }
      if (g.at < 0) { g.dead = true; return; }

      g.engaged = true;
      g.parts = movingParts(g.surface, g.list);
      if (!g.parts.length) { g.dead = true; return; }
      g.w = g.surface.getBoundingClientRect().width || window.innerWidth;
      // Measured from here, so the content does not jump by the slop.
      g.x = t.clientX - (dx > 0 ? 1 : -1);
      dx = t.clientX - g.x;
      setTransition(g.parts, 'none');
      for (var i = 0; i < g.parts.length; i++) g.parts[i].style.willChange = 'transform';
      try {
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      } catch (err) { /* nothing selected */ }
    }

    e.preventDefault();
    g.dx = dx;
    g.samples.push({ x: t.clientX, t: e.timeStamp || Date.now() });
    if (g.samples.length > 5) g.samples.shift();

    var forward = g.rtl ? dx > 0 : dx < 0;
    var exists = forward ? g.at < g.tabs.length - 1 : g.at > 0;
    var x = exists ? dx : banded(dx, g.w);
    if (g.frame) cancelAnimationFrame(g.frame);
    g.frame = requestAnimationFrame(function () {
      g.frame = 0;
      paint(g.parts, Math.round(x), exists ? fadeFor(x, g.w) : 1);
    });
  }

  function onEnd() {
    var g = gesture;
    gesture = null;
    if (!g || !g.engaged) return;
    if (g.frame) { cancelAnimationFrame(g.frame); g.frame = 0; }
    swallowClickUntil = Date.now() + 400;

    var dx = g.dx;
    var v = velocity(g);
    g.forward = g.rtl ? dx > 0 : dx < 0;
    var index = g.forward ? g.at + 1 : g.at - 1;
    var target = g.tabs[index];
    var far = Math.abs(dx) >= g.w * COMMIT;
    var quick = Math.abs(v) >= FLICK && Math.abs(dx) >= FLICK_MIN && (v < 0) === (dx < 0);

    if (target && (far || quick)) {
      goTo(g, target);
      return;
    }
    settleBack(g.parts);
  }

  function onCancel() {
    var g = gesture;
    gesture = null;
    if (!g || !g.engaged) return;
    if (g.frame) { cancelAnimationFrame(g.frame); g.frame = 0; }
    settleBack(g.parts);
  }

  // A swipe that ends on a row is not a tap on it.
  function onClick(e) {
    if (choosing || Date.now() > swallowClickUntil) return;
    if (!e.target || !e.target.closest || !e.target.closest('[data-tab-swipe]')) return;
    swallowClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }

  /* Listeners on the host, not the document: touchmove has to be able to
     stop the page scrolling under a swipe, and a blocking listener on the
     whole document would make every scroll in the portal wait for script. */
  function attach(host) {
    if (!host || host._tabSwipe) return;
    host._tabSwipe = true;
    host.addEventListener('touchstart', onStart, { passive: true });
    host.addEventListener('touchmove', onMove, { passive: false });
    host.addEventListener('touchend', onEnd, { passive: true });
    host.addEventListener('touchcancel', onCancel, { passive: true });
    host.addEventListener('click', onClick, true);
  }

  function attachAll() {
    var hosts = document.querySelectorAll('[data-tab-swipe]');
    for (var i = 0; i < hosts.length; i++) {
      // The outermost one carries the listeners; nested ones are found
      // from the finger.
      if (hosts[i].parentElement && hosts[i].parentElement.closest('[data-tab-swipe]')) continue;
      attach(hosts[i]);
    }
  }

  window.TMATabSwipe = { attach: attach, attachAll: attachAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachAll);
  else attachAll();
})();
