/*
 * TMA. Swipe a toast away.
 *
 * Every card that drops into a corner (a notification, a sync card, the
 * small "Saved" pill, the Messages and Settings toasts) can be pushed off
 * the screen sideways, the way it leaves on its own when its time is up:
 * a finger drag on a phone or tablet, a two-finger swipe on a trackpad. Far
 * enough, or quick enough, and it slides out in the direction it was pushed
 * and closes; short of that it springs back.
 *
 * One place for all of them, by event delegation, rather than a gesture
 * written into each toast. Each kind is closed the way it already closes
 * itself (its own close button where it has one), so whatever that does
 * (marking a sync card dismissed, forgetting a grouped notification) still
 * happens. The card is moved with the `translate` property, not
 * `transform`, so a toast's own transform (its centring, its entrance)
 * is never overwritten mid-drag.
 *
 * A mouse is left alone: a mouse click opens a notification, and dragging a
 * card with a mouse is not something anyone expects. The trackpad's swipe
 * arrives as sideways wheel movement and is read here.
 */
(function () {
  'use strict';

  if (window.TMAToastSwipe) return;

  function clickInside(el, selector) {
    var btn = el.querySelector(selector);
    if (!btn) return false;
    btn.click();
    return true;
  }

  /* What counts as a toast, and how each kind is put away. */
  var KINDS = [
    {
      sel: '.tma-notify-toast',
      close: function (el) {
        if (!clickInside(el, '[data-notify-toast-close]') && el.parentNode) el.parentNode.removeChild(el);
      },
    },
    {
      sel: '.tma-sync-toast',
      close: function (el) {
        if (clickInside(el, '[data-sync-close], [data-mail-sync-action="close"]')) return;
        if (el.parentNode) el.parentNode.removeChild(el);
      },
    },
    {
      // The shared feedback pill ("Saved", "Copied"): its host shows it.
      sel: '.tma-toast-floating-host[data-visible] .tma-toast',
      close: function (el) {
        var host = el.closest('.tma-toast-floating-host');
        if (!host) return;
        clearTimeout(host._timer);
        host.removeAttribute('data-visible');
      },
    },
    {
      sel: '.tma-dash__messages-toast',
      close: function (el) {
        el.classList.remove('tma-dash__messages-toast--visible');
        setTimeout(function () { el.hidden = true; }, 240);
      },
    },
    {
      sel: '[data-settings-toast]',
      close: function (el) { el.hidden = true; },
    },
  ];

  var SELECTOR = KINDS.map(function (k) { return k.sel; }).join(', ');

  /* True while a swiped card is being closed through its own button. */
  var closingOurselves = false;

  /* The toast under this point, and its kind. */
  function toastAt(target) {
    var el = target && target.closest ? target.closest(SELECTOR) : null;
    if (!el || el._swipedAway) return null;
    for (var i = 0; i < KINDS.length; i++) {
      if (el.matches(KINDS[i].sel)) return { el: el, kind: KINDS[i] };
    }
    return null;
  }

  /* How far it must go before letting go puts it away. */
  function threshold(el) {
    return Math.min(110, Math.max(48, (el.offsetWidth || 300) * 0.35));
  }

  function begin(el) {
    el.style.transition = 'none';
    el.style.willChange = 'translate, opacity';
    el.classList.add('is-swiping');
  }

  function follow(el, dx) {
    el.style.translate = dx + 'px 0';
    var w = el.offsetWidth || 300;
    el.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (w * 1.15)));
  }

  function clearInline(el) {
    el.style.translate = '';
    el.style.opacity = '';
    el.style.transition = '';
    el.style.willChange = '';
    el.classList.remove('is-swiping');
  }

  function springBack(el) {
    el.style.transition = 'translate 0.2s ease, opacity 0.2s ease';
    el.style.translate = '0px 0';
    el.style.opacity = '';
    setTimeout(function () { if (!el._swipedAway) clearInline(el); }, 220);
  }

  /* Out in the direction it was pushed, then closed as that kind closes. */
  function swipeAway(hit, direction) {
    var el = hit.el;
    if (el._swipedAway) return;
    el._swipedAway = true;
    var distance = (el.offsetWidth || 300) + 48;
    el.style.transition = 'translate 0.2s ease-out, opacity 0.2s ease-out';
    el.style.translate = (direction * distance) + 'px 0';
    el.style.opacity = '0';
    setTimeout(function () {
      closingOurselves = true;
      try { hit.kind.close(el); } catch (err) { /* the card is already gone */ }
      closingOurselves = false;
      // The Messages and Settings toasts, and the feedback pill's host, are
      // shown again later: they must come back where they belong.
      setTimeout(function () {
        el._swipedAway = false;
        clearInline(el);
      }, 360);
    }, 180);
  }

  /* ── Finger (and pen) ───────────────────────────────────────────── */

  var DEAD_ZONE = 8;
  var AXIS_RATIO = 1.2;
  var drag = null;
  var suppressClickUntil = 0;

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    var hit = toastAt(e.target);
    if (!hit) return;
    drag = {
      hit: hit,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: Date.now(),
      dx: 0,
      active: false,
    };
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0;
    var dy = e.clientY - drag.y0;

    if (!drag.active) {
      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      // Up or down is the page scrolling under it, not a swipe.
      if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) { drag = null; return; }
      drag.active = true;
      begin(drag.hit.el);
      try { drag.hit.el.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }

    if (e.cancelable) e.preventDefault();
    drag.dx = dx;
    follow(drag.hit.el, dx);
  }, { capture: true, passive: false });

  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag;
    drag = null;
    if (!d.active) return;

    // The lift after a drag must not also open the notification.
    suppressClickUntil = Date.now() + 400;

    var elapsed = Math.max(1, Date.now() - d.t0);
    var flick = Math.abs(d.dx) > 30 && Math.abs(d.dx) / elapsed > 0.6;
    if (!cancelled && (Math.abs(d.dx) >= threshold(d.hit.el) || flick)) {
      swipeAway(d.hit, d.dx > 0 ? 1 : -1);
    } else {
      springBack(d.hit.el);
    }
  }

  document.addEventListener('pointerup', function (e) { endDrag(e, false); }, true);
  document.addEventListener('pointercancel', function (e) { endDrag(e, true); }, true);

  document.addEventListener('click', function (e) {
    if (Date.now() > suppressClickUntil) return;
    // The close button pressed by swipeAway() is ours, and must go through.
    if (closingOurselves) return;
    if (!e.target.closest || !e.target.closest(SELECTOR)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  /* ── Trackpad ───────────────────────────────────────────────────────
   * A two-finger sideways swipe is wheel movement on the x axis. Fingers
   * moving right report a negative deltaX with natural scrolling, the same
   * reading the Messages swipe-to-reply uses. The swipe goes as soon as it
   * has travelled far enough; the momentum that trails it is swallowed so
   * it cannot start on the card beneath. */

  var WHEEL_IDLE_MS = 160;
  var MOMENTUM_MS = 500;
  var wheel = null;
  var swallowUntil = 0;

  document.addEventListener('wheel', function (e) {
    var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
    var dx = e.deltaX * unit;
    var dy = e.deltaY * unit;
    if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 0.5) return;

    var hit = toastAt(e.target);
    if (!hit) {
      if (Date.now() < swallowUntil && e.target.closest && e.target.closest(SELECTOR) && e.cancelable) e.preventDefault();
      return;
    }

    // Keep the browser's own back/forward swipe out of it.
    if (e.cancelable) e.preventDefault();
    if (Date.now() < swallowUntil) return;

    if (!wheel || wheel.el !== hit.el) {
      if (wheel) springBack(wheel.el);
      wheel = { el: hit.el, hit: hit, offset: 0, timer: null };
      begin(hit.el);
    }

    wheel.offset += -dx;
    follow(hit.el, wheel.offset);
    clearTimeout(wheel.timer);

    if (Math.abs(wheel.offset) >= threshold(hit.el)) {
      var gone = wheel;
      wheel = null;
      swallowUntil = Date.now() + MOMENTUM_MS;
      swipeAway(gone.hit, gone.offset > 0 ? 1 : -1);
      return;
    }

    var held = wheel;
    wheel.timer = setTimeout(function () {
      if (wheel === held) wheel = null;
      springBack(held.el);
    }, WHEEL_IDLE_MS);
  }, { capture: true, passive: false });

  window.TMAToastSwipe = { selector: SELECTOR };
})();
