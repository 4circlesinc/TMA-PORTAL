/*
 * TMA - Liquid glass tab bar indicator
 * Single shared pill that spring-animates between tab positions.
 * Global: window.TMATabbarIndicator
 */
(function () {
  'use strict';

  var STIFFNESS = 420;
  var DAMPING = 30;
  var MASS = 1;
  var HANDOFF_KEY = 'tma.tabIndicatorHandoff';
  var HANDOFF_MAX_AGE = 2500;

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function createTabbarIndicator(tabbarRow, tabBtns) {
    if (!tabbarRow || !tabBtns || !tabBtns.length) return null;

    var indicator = document.createElement('div');
    indicator.className = 'tma-dash__tabbar-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    tabbarRow.insertBefore(indicator, tabbarRow.firstChild);

    var activeTab = '';
    var hidden = true;
    var rafId = null;
    var lastTime = 0;
    var travelDir = 0;

    var pos = { x: 0, y: 0, w: 44, h: 44, r: 22 };
    var vel = { x: 0, y: 0, w: 0, h: 0 };
    var target = { x: 0, y: 0, w: 44, h: 44, r: 22 };
    var scaleX = 1;

    function findBtn(name) {
      for (var i = 0; i < tabBtns.length; i++) {
        if (tabBtns[i].getAttribute('data-tab') === name) return tabBtns[i];
      }
      return null;
    }

    function measureTab(btn) {
      var rowRect = tabbarRow.getBoundingClientRect();
      var btnRect = btn.getBoundingClientRect();
      var padX = 6;
      var padY = 5;
      var w = btnRect.width + padX * 2;
      var h = btnRect.height + padY * 2;
      return {
        x: btnRect.left - rowRect.left - padX,
        y: btnRect.top - rowRect.top - padY,
        w: w,
        h: h,
        r: Math.min(h / 2, w / 2, 24),
      };
    }

    function render() {
      var origin = travelDir >= 0 ? '18% 50%' : '82% 50%';
      indicator.style.transformOrigin = origin;
      indicator.style.transform =
        'translate3d(' + pos.x + 'px,' + (pos.y - 2) + 'px,0) scale3d(' + scaleX + ',1,1)';
      indicator.style.width = pos.w + 'px';
      indicator.style.height = pos.h + 'px';
      indicator.style.borderRadius = pos.r + 'px';
      indicator.classList.toggle('is-hidden', hidden);
      indicator.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    function snapToTarget() {
      pos.x = target.x;
      pos.y = target.y;
      pos.w = target.w;
      pos.h = target.h;
      pos.r = target.r;
      scaleX = 1;
      vel.x = vel.y = vel.w = vel.h = 0;
      render();
    }

    function springStep(dt) {
      var settled = true;

      ['x', 'y', 'w', 'h'].forEach(function (key) {
        var displacement = pos[key] - target[key];
        var force = -STIFFNESS * displacement - DAMPING * vel[key];
        var acceleration = force / MASS;
        vel[key] += acceleration * dt;
        pos[key] += vel[key] * dt;
        if (Math.abs(displacement) > 0.25 || Math.abs(vel[key]) > 0.25) settled = false;
      });

      var stretch = Math.min(0.2, Math.abs(vel.x) * 0.011);
      var targetScale = 1 + stretch;
      scaleX += (targetScale - scaleX) * (1 - Math.exp(-dt * 20));
      pos.r = target.r * (1 - stretch * 0.3);

      if (Math.abs(scaleX - 1) > 0.003) settled = false;
      if (settled) {
        scaleX = 1;
        pos.r = target.r;
      }

      render();
      return settled;
    }

    function springFrame(now) {
      if (!lastTime) lastTime = now;
      var dt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;

      if (springStep(dt)) {
        rafId = null;
        lastTime = 0;
        snapToTarget();
        return;
      }
      rafId = requestAnimationFrame(springFrame);
    }

    function startSpring() {
      if (rafId) return;
      lastTime = 0;
      rafId = requestAnimationFrame(springFrame);
    }

    function stopSpring() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        lastTime = 0;
      }
    }

    function moveTo(name, immediate) {
      if (!name) {
        hidden = true;
        stopSpring();
        render();
        return;
      }

      var btn = findBtn(name);
      if (!btn) {
        hidden = true;
        stopSpring();
        render();
        return;
      }

      var next = measureTab(btn);
      if (!next) return;

      travelDir = next.x - pos.x;
      activeTab = name;
      hidden = false;
      target = next;

      if (immediate || prefersReducedMotion()) {
        stopSpring();
        snapToTarget();
        return;
      }

      startSpring();
    }

    function moveFromTo(fromName, toName, immediate) {
      var fromBtn = findBtn(fromName);
      var toBtn = findBtn(toName);
      if (!toBtn) return moveTo(toName, immediate);
      var fromM = fromBtn ? measureTab(fromBtn) : null;
      var toM = measureTab(toBtn);
      if (!toM) return;

      if (fromM) {
        pos.x = fromM.x;
        pos.y = fromM.y;
        pos.w = fromM.w;
        pos.h = fromM.h;
        pos.r = fromM.r;
      }
      vel.x = vel.y = vel.w = vel.h = 0;
      scaleX = 1;
      travelDir = toM.x - (fromM ? fromM.x : pos.x);
      activeTab = toName;
      hidden = false;
      target = toM;

      if (immediate || prefersReducedMotion()) {
        stopSpring();
        snapToTarget();
        return;
      }

      startSpring();
    }

    function sync(immediate) {
      if (immediate && rafId) return;
      moveTo(activeTab, immediate !== false);
    }

    function hide() {
      hidden = true;
      stopSpring();
      render();
    }

    function isAnimating() {
      return !!rafId;
    }

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (!hidden && activeTab && !rafId) sync(true);
      });
      ro.observe(tabbarRow);
      tabBtns.forEach(function (btn) {
        ro.observe(btn);
      });
    }

    window.addEventListener(
      'resize',
      function () {
        if (!hidden && activeTab && !rafId) sync(true);
      },
      { passive: true }
    );

    render();

    return {
      moveTo: moveTo,
      moveFromTo: moveFromTo,
      sync: sync,
      hide: hide,
      isAnimating: isAnimating,
    };
  }

  function storeHandoff(fromTab, toTab) {
    if (!fromTab || !toTab || fromTab === toTab) return;
    try {
      sessionStorage.setItem(
        HANDOFF_KEY,
        JSON.stringify({ from: fromTab, to: toTab, ts: Date.now() })
      );
    } catch (e) {}
  }

  function consumeHandoff(toTab) {
    if (!toTab) return null;
    try {
      var raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return null;
      var handoff = JSON.parse(raw);
      if (!handoff || handoff.to !== toTab) return null;
      if (Date.now() - handoff.ts > HANDOFF_MAX_AGE) {
        sessionStorage.removeItem(HANDOFF_KEY);
        return null;
      }
      if (!handoff.from || handoff.from === toTab) {
        sessionStorage.removeItem(HANDOFF_KEY);
        return null;
      }
      sessionStorage.removeItem(HANDOFF_KEY);
      return handoff;
    } catch (e) {
      return null;
    }
  }

  window.TMATabbarIndicator = {
    create: createTabbarIndicator,
    storeHandoff: storeHandoff,
    consumeHandoff: consumeHandoff,
  };
})();
