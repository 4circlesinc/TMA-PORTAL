/*
 * A guided walkthrough with a spotlight.
 *
 * The page dims, one control stays lit — and clickable, so the reader does
 * the real thing rather than watching a picture of it — and a small card
 * beside it says what it is and what to do next. The card is the portal's
 * own: its title and text styles, its black and ghost buttons.
 *
 * Generic: the caller supplies the steps. Each step is
 *
 *   {
 *     target:  selector | [selectors] | function () → Element | null
 *              (the first visible match is lit; none means a card in the
 *              middle of a dimmed screen)
 *     title, body:  text (body may hold <strong>; it is the caller's HTML)
 *     action:  true → the step is done by clicking the lit control; Next
 *              clicks it for the reader
 *     before:  function () → optional Promise, run as the step opens
 *     skip:    function () → true leaves the step out (and the count)
 *     wait:    ms to wait for the target to appear (default 2500)
 *     optional: a target that never appears skips the step instead of
 *              falling back to a card in the middle
 *     nextLabel: the primary button's words
 *   }
 *
 * opts: scope (an element; the tour ends if it leaves the page), pauseWhen
 * (function → true hides the tour, e.g. while a dialog it led to is open),
 * onEnd(reason) with 'done' | 'skipped' | 'gone'.
 *
 * Global: window.TMATour
 */
(function () {
  'use strict';

  var PAD = 6;
  var GAP = 12;
  var EDGE = 12;
  var active = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function resolve(target, scope) {
    if (!target) return null;
    if (typeof target === 'function') {
      var got = target();
      return visible(got) ? got : null;
    }
    var list = Array.isArray(target) ? target : [target];
    for (var i = 0; i < list.length; i++) {
      var nodes = (scope || document).querySelectorAll(list[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (visible(nodes[j])) return nodes[j];
      }
    }
    return null;
  }

  function waitFor(step, scope) {
    var limit = step.wait == null ? 2500 : step.wait;
    var started = Date.now();
    return new Promise(function (done) {
      (function look() {
        var el = resolve(step.target, scope);
        if (el || Date.now() - started >= limit) return done(el);
        setTimeout(look, 100);
      })();
    });
  }

  function skipped(step) {
    try { return !!(step.skip && step.skip()); } catch (e) { return false; }
  }

  /* "Step 2 of 5", counting only the steps this reader will actually see. */
  function position(t) {
    var n = 0, at = 0;
    for (var i = 0; i < t.steps.length; i++) {
      if (skipped(t.steps[i]) || t.missing[i]) continue;
      n++;
      if (i <= t.index) at = n;
    }
    return { at: at, of: n };
  }

  function build() {
    var root = document.createElement('div');
    root.className = 'tma-tour';
    root.innerHTML =
      '<div class="tma-tour__shade" data-tour-shade></div>' +
      '<div class="tma-tour__block" data-tour-block="top"></div>' +
      '<div class="tma-tour__block" data-tour-block="right"></div>' +
      '<div class="tma-tour__block" data-tour-block="bottom"></div>' +
      '<div class="tma-tour__block" data-tour-block="left"></div>' +
      '<div class="tma-tour__hole" data-tour-hole aria-hidden="true"></div>' +
      '<section class="tma-tour__card" data-tour-card role="dialog" aria-modal="false" aria-labelledby="tma-tour-title" tabindex="-1"></section>';
    document.body.appendChild(root);
    // Floating extras (the assistant's button) step aside while it runs.
    document.documentElement.classList.add('tma-tour-on');
    return root;
  }

  function start(steps, opts) {
    if (active) finish(active, 'skipped', true);
    if (!steps || !steps.length) return null;

    var t = {
      steps: steps,
      opts: opts || {},
      index: -1,
      target: null,
      missing: {},
      seq: 0,
      root: build(),
      raf: 0,
      clickOff: null,
    };
    t.card = t.root.querySelector('[data-tour-card]');
    t.hole = t.root.querySelector('[data-tour-hole]');
    t.shade = t.root.querySelector('[data-tour-shade]');
    t.blocks = {};
    t.root.querySelectorAll('[data-tour-block]').forEach(function (b) { t.blocks[b.getAttribute('data-tour-block')] = b; });

    t.onKey = function (e) {
      if (active !== t || t.root.hidden) return;
      if (e.key === 'Escape') {
        // The viewer closes on Escape too; this one is the tour's.
        e.preventDefault();
        e.stopPropagation();
        finish(t, 'skipped');
      }
    };
    window.addEventListener('keydown', t.onKey, true);

    t.card.addEventListener('click', function (e) {
      if (e.target.closest('[data-tour-next]')) { next(t); return; }
      if (e.target.closest('[data-tour-back]')) { go(t, t.index - 1, -1); return; }
      if (e.target.closest('[data-tour-skip]')) finish(t, 'skipped');
    });

    active = t;
    go(t, 0, 1);
    loop(t);

    return { stop: function () { if (active === t) finish(t, 'skipped'); } };
  }

  function next(t) {
    var step = t.steps[t.index];
    // An action step done for the reader: the same click they would make.
    if (step && step.action && t.target && t.target.isConnected) {
      unbindClick(t);
      t.target.click();
    }
    go(t, t.index + 1, 1);
  }

  function go(t, i, dir) {
    if (active !== t) return;
    unbindClick(t);
    if (i < 0) i = 0;
    if (i >= t.steps.length) { finish(t, 'done'); return; }

    var step = t.steps[i];
    if (skipped(step)) { go(t, i + dir, dir); return; }

    var seq = ++t.seq;
    t.index = i;
    t.card.setAttribute('aria-busy', 'true');

    Promise.resolve(step.before ? step.before() : null)
      .catch(function () {})
      .then(function () { return step.target ? waitFor(step, t.opts.scope) : null; })
      .then(function (el) {
        if (active !== t || seq !== t.seq) return;
        if (step.target && !el && step.optional) {
          t.missing[i] = true;
          go(t, i + dir, dir);
          return;
        }
        show(t, step, el);
      });
  }

  function show(t, step, el) {
    t.target = el;
    var pos = position(t);
    var last = pos.at >= pos.of;
    var first = pos.at <= 1;

    t.card.innerHTML =
      '<p class="tma-tour__count">Step ' + pos.at + ' of ' + pos.of + '</p>' +
      '<h2 class="tma-portal-modal__title" id="tma-tour-title">' + esc(step.title) + '</h2>' +
      '<div class="tma-tour__body" aria-live="polite">' + (step.body || '') + '</div>' +
      '<div class="tma-tour__foot">' +
      (last ? '' : '<button type="button" class="tma-portal-link tma-tour__skip" data-tour-skip>Skip tutorial</button>') +
      (first ? '' : '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-tour-back>Back</button>') +
      '<button type="button" class="tma-no-data__btn" data-tour-next>' +
      esc(step.nextLabel || (last ? 'Done' : 'Next')) + '</button>' +
      '</div>';
    t.card.removeAttribute('aria-busy');
    t.root.classList.toggle('is-centred', !el);

    if (step.action && el) bindClick(t, el);

    place(t);
    // The card, not its button: a screen reader reads the step, and nobody
    // sees a focus ring they did not ask for. Enter still works from Tab.
    try { t.card.focus({ preventScroll: true }); } catch (e) { t.card.focus(); }
  }

  /* Clicking the lit control is how an action step is done. */
  function bindClick(t, el) {
    var handler = function () {
      unbindClick(t);
      // After the page's own handler has run (it opens the panel this
      // tour goes on to point at).
      setTimeout(function () { go(t, t.index + 1, 1); }, 60);
    };
    el.addEventListener('click', handler);
    t.clickOff = function () { el.removeEventListener('click', handler); };
  }

  function unbindClick(t) {
    if (t.clickOff) { t.clickOff(); t.clickOff = null; }
  }

  function setBox(node, l, tp, w, h) {
    node.style.left = Math.round(l) + 'px';
    node.style.top = Math.round(tp) + 'px';
    node.style.width = Math.max(0, Math.round(w)) + 'px';
    node.style.height = Math.max(0, Math.round(h)) + 'px';
  }

  function place(t) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var card = t.card;
    var el = t.target;

    card.style.left = card.style.top = card.style.right = card.style.bottom = '';
    card.classList.remove('is-docked');

    if (!el || !el.isConnected) {
      t.hole.hidden = true;
      t.shade.hidden = false;
      Object.keys(t.blocks).forEach(function (k) { t.blocks[k].hidden = true; });
      card.style.left = Math.max(EDGE, (vw - card.offsetWidth) / 2) + 'px';
      card.style.top = Math.max(EDGE, (vh - card.offsetHeight) / 2) + 'px';
      return;
    }

    var r = el.getBoundingClientRect();
    var hole = {
      l: Math.max(0, r.left - PAD), t: Math.max(0, r.top - PAD),
      r: Math.min(vw, r.right + PAD), b: Math.min(vh, r.bottom + PAD),
    };

    t.shade.hidden = true;
    t.hole.hidden = false;
    setBox(t.hole, hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);

    // Clicks outside the lit control land on these and go nowhere.
    Object.keys(t.blocks).forEach(function (k) { t.blocks[k].hidden = false; });
    setBox(t.blocks.top, 0, 0, vw, hole.t);
    setBox(t.blocks.bottom, 0, hole.b, vw, vh - hole.b);
    setBox(t.blocks.left, 0, hole.t, hole.l, hole.b - hole.t);
    setBox(t.blocks.right, hole.r, hole.t, vw - hole.r, hole.b - hole.t);

    // A phone: the card is a sheet across the bottom, or the top when the
    // lit control is down there.
    if (vw < 640) {
      card.classList.add('is-docked');
      if ((hole.t + hole.b) / 2 > vh * 0.55) card.style.top = 'calc(' + EDGE + 'px + env(safe-area-inset-top, 0px))';
      else card.style.bottom = 'calc(' + EDGE + 'px + env(safe-area-inset-bottom, 0px))';
      return;
    }

    var cw = card.offsetWidth;
    var ch = card.offsetHeight;
    var spots = {
      bottom: { l: (hole.l + hole.r - cw) / 2, t: hole.b + GAP, ok: hole.b + GAP + ch <= vh - EDGE },
      top: { l: (hole.l + hole.r - cw) / 2, t: hole.t - GAP - ch, ok: hole.t - GAP - ch >= EDGE },
      left: { l: hole.l - GAP - cw, t: (hole.t + hole.b - ch) / 2, ok: hole.l - GAP - cw >= EDGE },
      right: { l: hole.r + GAP, t: (hole.t + hole.b - ch) / 2, ok: hole.r + GAP + cw <= vw - EDGE },
    };
    var order = [t.steps[t.index].placement, 'bottom', 'left', 'top', 'right'];
    var spot = null;
    for (var i = 0; i < order.length; i++) {
      if (order[i] && spots[order[i]] && spots[order[i]].ok) { spot = spots[order[i]]; break; }
    }
    if (!spot) spot = { l: (vw - cw) / 2, t: vh - ch - EDGE };

    card.style.left = Math.min(Math.max(EDGE, spot.l), vw - cw - EDGE) + 'px';
    card.style.top = Math.min(Math.max(EDGE, spot.t), vh - ch - EDGE) + 'px';
  }

  /* Panels slide, the window turns, a list loads: follow the target. */
  function loop(t) {
    var last = '';
    (function frame() {
      if (active !== t) return;
      if (t.opts.scope && !t.opts.scope.isConnected) { finish(t, 'gone'); return; }

      var paused = false;
      try { paused = !!(t.opts.pauseWhen && t.opts.pauseWhen()); } catch (e) { paused = false; }
      if (t.root.hidden !== paused) t.root.hidden = paused;

      // The page redrew the lit control (a header repainted on a click):
      // light the new one rather than falling back to the middle.
      if (t.target && !t.target.isConnected) {
        var step = t.steps[t.index];
        var again = step ? resolve(step.target, t.opts.scope) : null;
        if (again) {
          t.target = again;
          if (step.action && t.clickOff) { unbindClick(t); bindClick(t, again); }
        }
      }

      if (!paused) {
        var r = t.target && t.target.isConnected ? t.target.getBoundingClientRect() : null;
        var key = (r ? [r.left, r.top, r.width, r.height].join(',') : 'none') + '|' + window.innerWidth + 'x' + window.innerHeight;
        if (key !== last) { last = key; place(t); }
      }
      t.raf = window.requestAnimationFrame(frame);
    })();
  }

  function finish(t, reason, silent) {
    if (active !== t) return;
    active = null;
    unbindClick(t);
    window.cancelAnimationFrame(t.raf);
    window.removeEventListener('keydown', t.onKey, true);
    if (t.root.parentNode) t.root.parentNode.removeChild(t.root);
    document.documentElement.classList.remove('tma-tour-on');
    if (!silent && t.opts.onEnd) {
      try { t.opts.onEnd(reason); } catch (e) { /* the tour is gone either way */ }
    }
  }

  window.TMATour = {
    start: start,
    isRunning: function () { return !!active; },
  };
})();
