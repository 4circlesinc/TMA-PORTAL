/*
 * TMA - pull to refresh
 * Global: window.TMAPullRefresh
 *
 * Drag down from the top of a page to reload it. The gesture hands off to
 * TMADashboard.refresh(), which is the same reload path the sidebar uses when
 * you re-select the page you are already on — so a pull and a re-tap fetch
 * exactly the same things.
 *
 * Touch only. There is no mouse equivalent on purpose: dragging the page down
 * with a pointer is not a gesture anybody makes, and listening for it would
 * fight text selection on every screen.
 *
 * The touchmove listener is non-passive (it has to stop the scroller from
 * moving while the finger drags the indicator), so it is bound for the length
 * of one gesture and unbound again — a permanent non-passive move listener on
 * the document is a scroll-performance cost paid on every swipe in the app.
 */
(function () {
  'use strict';

  var THRESHOLD = 68;      // pull past this and letting go refreshes
  var MAX_PULL = 108;      // the indicator stops following here
  var RESISTANCE = 0.45;   // the indicator travels less than the finger does
  var DIRECTION_SLOP = 10; // px before a drag is judged vertical or horizontal
  var MIN_SPIN_MS = 450;   // a refresh that lands instantly still reads as one

  /*
   * Views that own the top of their own screen.
   *
   * Messages and Feed are already live over the socket, and both carry their
   * own touch gestures (the swipe-to-reply bubble, the story rail) that a
   * downward drag would compete with. The signature editor is a canvas: a pull
   * there would be a stray pen stroke.
   */
  var SKIP_VIEWS = { messages: 1, feed: 1, signatures: 1 };

  /* Anything full-screen or modal owns the gesture while it is open. */
  var OVERLAY_SELECTOR = [
    '.tma-portal-modal',
    '.tma-portal-viewer',
    '.tma-portal-sig-wizard',
    '.tma-portal-context-menu',
    '.tma-dash__cmd:not([hidden])',
  ].join(',');

  var host = null;   // the indicator
  var busy = false;  // a refresh is running
  var gesture = null;

  function supportsTouch() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  }

  function dash() { return document.querySelector('.tma-dash'); }

  function activeView() {
    var el = document.querySelector('.tma-dash__main .tma-dash__view:not([hidden])');
    return el ? el.getAttribute('data-view') : '';
  }

  function blocked(root) {
    if (document.querySelector(OVERLAY_SELECTOR)) return true;
    // The mobile drawers slide over the content and scroll themselves.
    if (root.classList.contains('is-nav-open') || root.classList.contains('is-rb-open')) return true;
    if (root.classList.contains('tma-dash--signatures-wizard')) return true;
    return !!SKIP_VIEWS[activeView()];
  }

  /* Every scroller between the touched element and the page must be at its
     top, or the drag is a scroll-up that has not finished yet. */
  function stackAtTop(target, main) {
    var el = target;
    while (el && el.nodeType === 1) {
      if (el.scrollTop > 0) {
        var style = window.getComputedStyle(el);
        var oy = style.overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return false;
      }
      if (el === main) return true;
      el = el.parentElement;
    }
    return true;
  }

  function ignoredTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('[data-no-pull-refresh]')) return true;
    // Anything the finger is meant to drag, draw on, or type into.
    if (target.closest('input, textarea, select, canvas, [contenteditable="true"], [draggable="true"]')) return true;
    return false;
  }

  function ensureHost(root) {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.className = 'tma-pull-refresh';
    host.setAttribute('data-pull-refresh', '');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '<span class="tma-pull-refresh__ring"></span>';
    root.appendChild(host);
    return host;
  }

  /* Fixed rather than in-flow: the indicator has to sit over the content
     without being scrolled by it, and it is centred on the main column so it
     does not float over the sidebar on a desktop layout. */
  function placeHost(main) {
    var box = main.getBoundingClientRect();
    // Start just above the content — on mobile that is under the fixed header,
    // so the indicator slides out from behind it rather than appearing on top
    // of the first row.
    var pad = parseFloat(window.getComputedStyle(main).paddingTop) || 0;
    host.style.left = (box.left + box.width / 2) + 'px';
    host.style.top = (box.top + pad - 44) + 'px';
  }

  function draw(distance, ready) {
    host.style.transform = 'translate(-50%, ' + distance + 'px)';
    host.style.opacity = String(Math.min(1, distance / (THRESHOLD * 0.7)));
    host.classList.toggle('tma-pull-refresh--ready', !!ready);
  }

  function settle() {
    host.classList.add('tma-pull-refresh--settling');
    host.style.transform = 'translate(-50%, 0)';
    host.style.opacity = '0';
    window.setTimeout(function () {
      if (!host) return;
      host.classList.remove('tma-pull-refresh--settling', 'tma-pull-refresh--ready', 'tma-pull-refresh--busy');
    }, 240);
  }

  function run() {
    busy = true;
    host.classList.add('tma-pull-refresh--busy');
    host.classList.remove('tma-pull-refresh--ready');
    host.classList.add('tma-pull-refresh--settling');
    host.style.transform = 'translate(-50%, ' + THRESHOLD + 'px)';
    host.style.opacity = '1';

    var started = Date.now();
    var refresh = (window.TMADashboard && window.TMADashboard.refresh)
      ? window.TMADashboard.refresh()
      : Promise.resolve();

    Promise.resolve(refresh).catch(function () {}).then(function () {
      var left = Math.max(0, MIN_SPIN_MS - (Date.now() - started));
      window.setTimeout(function () {
        busy = false;
        settle();
      }, left);
    });
  }

  function endGesture() {
    if (!gesture) return;
    document.removeEventListener('touchmove', onMove, { passive: false });
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
    gesture = null;
  }

  function onStart(e) {
    if (busy || gesture || !e.touches || e.touches.length !== 1) return;

    var root = dash();
    if (!root || blocked(root)) return;

    var main = root.querySelector('.tma-dash__main');
    if (!main || !main.contains(e.target)) return;
    if (ignoredTarget(e.target)) return;
    if (!stackAtTop(e.target, main)) return;

    gesture = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      main: main,
      root: root,
      pulling: false,
      distance: 0,
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onCancel);
  }

  function onMove(e) {
    if (!gesture || !e.touches || !e.touches.length) return;

    var dy = e.touches[0].clientY - gesture.y;
    var dx = e.touches[0].clientX - gesture.x;

    if (!gesture.pulling) {
      // Wait until the drag has committed to a direction: a diagonal start
      // that turns into a horizontal swipe belongs to whatever is underneath.
      if (Math.abs(dy) < DIRECTION_SLOP && Math.abs(dx) < DIRECTION_SLOP) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { endGesture(); return; }
      // The finger may have scrolled the list back to the top on the way here.
      if (!stackAtTop(e.target, gesture.main)) { endGesture(); return; }
      gesture.pulling = true;
      ensureHost(gesture.root);
      placeHost(gesture.main);
      host.classList.remove('tma-pull-refresh--settling');
    }

    gesture.distance = Math.min(MAX_PULL, dy * RESISTANCE);
    if (gesture.distance <= 0) { endGesture(); settle(); return; }

    // Hold the scroller still: without this the content rubber-bands behind
    // the indicator and the two move at different speeds.
    if (e.cancelable) e.preventDefault();
    draw(gesture.distance, gesture.distance >= THRESHOLD);
  }

  function onEnd() {
    if (!gesture) return;
    var pulled = gesture.pulling ? gesture.distance : 0;
    endGesture();
    if (!host) return;
    if (pulled >= THRESHOLD) run();
    else if (pulled > 0) settle();
  }

  function onCancel() {
    var pulling = gesture && gesture.pulling;
    endGesture();
    if (pulling && host) settle();
  }

  function init() {
    if (!supportsTouch()) return;
    if (document._tmaPullRefreshBound) return;
    document._tmaPullRefreshBound = true;
    document.addEventListener('touchstart', onStart, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.TMAPullRefresh = {
    init: init,
    /* Run the same refresh the gesture runs, indicator and all. */
    trigger: function () {
      var root = dash();
      if (busy || !root) return;
      ensureHost(root);
      var main = root.querySelector('.tma-dash__main');
      if (main) placeHost(main);
      run();
    },
  };
})();
