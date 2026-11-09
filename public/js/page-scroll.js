/*
 * TMA - the page never scrolls; the box does
 * Global: window.TMAPageScroll
 *
 * The portal does not scroll as a page. The shell is one screen tall and each
 * view scrolls inside itself: the main column on most pages, or a box within
 * it on the pages that keep their title and tabs in place (a CIP
 * application's applicant and documents card, the settings pane, a chat, a
 * mail list).
 *
 * On those pages a wheel turned over the parts that hold still (the title,
 * the tabs, the summary strip, the gutter beside the card, the header above
 * it all) had nothing to scroll, so the browser handed it to the document.
 * And the document had room to move: an absolutely placed element with no
 * positioned ancestor (the hidden file input in a checklist row) escapes
 * every clip and stretches the page to wherever it would have sat in the
 * unscrolled list. The whole portal slid up and left a blank band below it.
 *
 * The stylesheet now holds the document still (dashboard-tma-overrides.css,
 * "The page itself never scrolls"). This file does the rest:
 *
 * - A wheel that lands on nothing scrollable scrolls the box it was meant
 *   for: the nearest one in the column under the pointer, the box the eye is
 *   already on. One gesture keeps the box it started with.
 * - If a script moves the document anyway (a focus or scrollIntoView can
 *   scroll what the wheel cannot), it is put straight back.
 *
 * A wheel over something that scrolls itself is left to the browser, even
 * when that box is already at its end, so reaching the bottom of a list never
 * starts scrolling a different one. Dialogs, menus, overlays, pinch-zoom
 * (ctrl + wheel) and sideways scrolling (shift + wheel too) are left alone.
 * Anything that must keep the wheel to itself can say so with
 * data-scroll-own.
 */
(function () {
  'use strict';

  /* Where a wheel counts as "the page": the main column and the header bar
     above it. The sidebars and the activity rail scroll themselves. */
  var ZONES = '.tma-dash__main, .tma-dash__header';
  var OWN = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-scroll-own]';
  var STEP = 24;         // px between the points probed for a box
  var GESTURE_MS = 200;  // wheel events closer together than this are one gesture
  var LINE_PX = 40;      // one wheel "line" (Firefox, some Windows mice)

  var gesture = null;    // { box, at }: the box the current gesture is moving

  function element(node) {
    return node && node.nodeType === 1 ? node : node && node.parentElement;
  }

  /* A box that scrolls up and down and holds more than it shows. */
  function scrollsY(el, cs) {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    var oy = cs.overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  /* Whether the browser already has a box between the pointer and the zone
     for this wheel. An overlay (anything fixed) counts as having one. */
  function handledInside(node, zone) {
    for (var el = node; el; el = el.parentElement) {
      var cs = getComputedStyle(el);
      if (scrollsY(el, cs)) return true;
      if (el === zone) return false;
      if (cs.position === 'fixed') return true;
    }
    return true;
  }

  /* The scrolling box at one point of the main column, if any. */
  function boxAt(x, y, main) {
    var hit = document.elementFromPoint(x, y);
    if (!hit || !main.contains(hit)) return null;
    for (var el = hit; el; el = el.parentElement) {
      if (el.matches(OWN)) return null;
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed') return null;
      if (scrollsY(el, cs)) return el;
      if (el === main) return null;
    }
    return null;
  }

  /*
   * The box a wheel at (x, y) is meant for: probe the main column at the
   * pointer's x, nearest points first, alternating below and above, then down
   * the middle of the column if that column has none. The first scrolling box
   * met wins, which may be the main column itself.
   */
  function boxFor(x, y) {
    var main = document.querySelector('.tma-dash__main');
    if (!main) return null;
    var r = main.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    var cy = Math.min(Math.max(y, r.top), r.bottom - 1);
    var columns = [Math.min(Math.max(x, r.left + 1), r.right - 1), r.left + r.width / 2];
    for (var c = 0; c < columns.length; c++) {
      for (var d = 0; d <= r.height; d += STEP) {
        var below = cy + d;
        var above = cy - d;
        var box = below < r.bottom ? boxAt(columns[c], below, main) : null;
        if (!box && d && above >= r.top) box = boxAt(columns[c], above, main);
        if (box) return box;
      }
    }
    return null;
  }

  function onWheel(e) {
    // ctrl is pinch-zoom; shift turns the wheel sideways on Windows.
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey) return;
    var dy = e.deltaY;
    if (!dy || Math.abs(e.deltaX) > Math.abs(dy)) return;
    var node = element(e.target);
    var zone = node && node.closest(ZONES);
    if (!zone || node.closest(OWN) || handledInside(node, zone)) {
      gesture = null;
      return;
    }

    var now = Date.now();
    var box = gesture && now - gesture.at < GESTURE_MS && gesture.box.isConnected
      ? gesture.box
      : boxFor(e.clientX, e.clientY);
    gesture = box ? { box: box, at: now } : null;
    if (!box) return;

    e.preventDefault();
    box.scrollTop += dy * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? box.clientHeight : 1);
  }

  /* Put back a page or shell that a script scrolled. */
  function onScroll(e) {
    var t = e.target;
    if (t === document || t === document.documentElement) {
      if ((window.scrollX || window.scrollY) && document.querySelector('body > .tma-dash')) window.scrollTo(0, 0);
      return;
    }
    if (t && t.nodeType === 1 && (t.scrollTop || t.scrollLeft) && t.matches('body > .tma-dash')) {
      t.scrollTop = 0;
      t.scrollLeft = 0;
    }
  }

  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  window.TMAPageScroll = { boxFor: boxFor };
})();
