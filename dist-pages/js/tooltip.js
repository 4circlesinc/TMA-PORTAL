/**
 * Tooltip — TMA hover behavior (Figma documentation).
 *
 * - First hover: 1.5s delay (configurable per trigger)
 * - Same type while visible: switch immediately
 * - Re-hover same trigger within 30s: 0.5s delay
 */
(function () {
  const TRIGGER = '[data-tooltip-trigger]';
  const GAP = 8;
  const PENDING_MS = 200;

  const state = {
    hoverTrigger: null,
    activeTrigger: null,
    activeTooltip: null,
    activeType: null,
    lastTrigger: null,
    lastShownAt: 0,
    showTimer: null,
    hideTimer: null,
    pendingTimer: null,
  };

  function clearShowTimer() {
    if (state.showTimer) {
      clearTimeout(state.showTimer);
      state.showTimer = null;
    }
  }

  function clearHideTimer() {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  }

  function clearPendingTimer() {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function setPending(trigger, on) {
    if (!trigger) return;
    trigger.classList.toggle('is-tooltip-pending', on);
  }

  function getTooltip(trigger) {
    const id = trigger.getAttribute('data-tooltip-target');
    if (id) {
      return document.getElementById(id);
    }
    return trigger.querySelector('.tma-tooltip');
  }

  function getPosition(tooltip, trigger) {
    const fromTrigger = trigger.getAttribute('data-tooltip-position');
    if (fromTrigger) return fromTrigger;
    if (tooltip.classList.contains('tma-tooltip--bottom')) return 'bottom';
    if (tooltip.classList.contains('tma-tooltip--left')) return 'left';
    if (tooltip.classList.contains('tma-tooltip--right')) return 'right';
    return 'top';
  }

  function rememberHome(tooltip, trigger) {
    if (!tooltip._tooltipHome) {
      tooltip._tooltipHome = trigger;
    }
  }

  function restoreHome(tooltip) {
    const home = tooltip._tooltipHome;
    if (home && tooltip.parentNode !== home) {
      home.appendChild(tooltip);
    }
    tooltip.classList.remove('is-portaled');
    tooltip.style.position = '';
    tooltip.style.left = '';
    tooltip.style.top = '';
    tooltip.style.visibility = '';
    tooltip.style.removeProperty('--tooltip-arrow-offset');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function positionTooltip(trigger, tooltip) {
    rememberHome(tooltip, trigger);

    if (tooltip.parentNode !== document.body) {
      document.body.appendChild(tooltip);
    }

    const position = getPosition(tooltip, trigger);
    const triggerRect = trigger.getBoundingClientRect();

    tooltip.classList.add('is-portaled');
    tooltip.style.position = 'fixed';
    tooltip.style.left = '-9999px';
    tooltip.style.top = '-9999px';
    tooltip.style.visibility = 'visible';

    const tipRect = tooltip.getBoundingClientRect();
    let top = 0;
    let left = 0;

    if (position === 'bottom') {
      top = triggerRect.bottom + GAP;
      left = triggerRect.left + (triggerRect.width - tipRect.width) / 2;
    } else if (position === 'left') {
      top = triggerRect.top + (triggerRect.height - tipRect.height) / 2;
      left = triggerRect.left - tipRect.width - GAP;
    } else if (position === 'right') {
      top = triggerRect.top + (triggerRect.height - tipRect.height) / 2;
      left = triggerRect.right + GAP;
    } else {
      top = triggerRect.top - tipRect.height - GAP;
      left = triggerRect.left + (triggerRect.width - tipRect.width) / 2;
    }

    left = clamp(left, 8, window.innerWidth - tipRect.width - 8);
    top = clamp(top, 8, window.innerHeight - tipRect.height - 8);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    tooltip.style.setProperty('--tooltip-arrow-offset', `${triggerCenterX - left - 4}px`);
  }

  function hideTooltip(tooltip) {
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
    restoreHome(tooltip);
  }

  function hideActive() {
    if (state.activeTooltip) {
      hideTooltip(state.activeTooltip);
    }
    state.activeTrigger = null;
    state.activeTooltip = null;
    state.activeType = null;
  }

  function showTooltip(trigger, tooltip) {
    clearPendingTimer();
    setPending(trigger, false);

    if (state.activeTooltip && state.activeTooltip !== tooltip) {
      hideTooltip(state.activeTooltip);
    }

    positionTooltip(trigger, tooltip);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    state.activeTrigger = trigger;
    state.activeTooltip = tooltip;
    state.activeType = trigger.getAttribute('data-tooltip-type') || 'default';
    state.lastTrigger = trigger;
    state.lastShownAt = Date.now();

    trigger.dispatchEvent(new CustomEvent('tma-tooltip-show', {
      bubbles: true,
      detail: { trigger, tooltip },
    }));
  }

  function resolveDelay(trigger) {
    const initial = Number(trigger.getAttribute('data-tooltip-initial-delay') || 1500);
    const rehover = Number(trigger.getAttribute('data-tooltip-rehover-delay') || 500);
    const windowMs = Number(trigger.getAttribute('data-tooltip-rehover-window') || 30000);
    const type = trigger.getAttribute('data-tooltip-type') || 'default';
    const tooltip = getTooltip(trigger);

    if (
      state.activeType === type &&
      state.activeTooltip &&
      state.activeTooltip !== tooltip &&
      state.activeTooltip.classList.contains('is-visible')
    ) {
      return 0;
    }

    if (
      state.lastTrigger === trigger &&
      state.lastShownAt &&
      Date.now() - state.lastShownAt <= windowMs
    ) {
      return rehover;
    }

    return initial;
  }

  function scheduleShow(trigger) {
    clearShowTimer();
    clearPendingTimer();
    setPending(trigger, false);

    const tooltip = getTooltip(trigger);
    if (!tooltip) return;

    const delay = resolveDelay(trigger);

    state.pendingTimer = setTimeout(() => {
      if (state.hoverTrigger === trigger) {
        setPending(trigger, true);
      }
    }, PENDING_MS);

    if (delay <= 0) {
      showTooltip(trigger, tooltip);
      return;
    }

    state.showTimer = setTimeout(() => {
      if (state.hoverTrigger === trigger) {
        showTooltip(trigger, tooltip);
      }
    }, delay);
  }

  function scheduleHide(trigger) {
    clearShowTimer();
    clearPendingTimer();
    setPending(trigger, false);

    state.hideTimer = setTimeout(() => {
      if (state.hoverTrigger === trigger) return;

      if (state.activeTrigger === trigger) {
        hideActive();
      }
    }, 80);
  }

  function enterTrigger(trigger) {
    state.hoverTrigger = trigger;
    clearHideTimer();
    scheduleShow(trigger);
  }

  function leaveTrigger(trigger) {
    if (state.hoverTrigger === trigger) {
      state.hoverTrigger = null;
    }
    setPending(trigger, false);
    scheduleHide(trigger);
  }

  function findTrigger(node) {
    return node && node.closest ? node.closest(TRIGGER) : null;
  }

  function isInsideTrigger(trigger, node) {
    return !!(node && trigger && (node === trigger || trigger.contains(node)));
  }

  function onMouseOver(event) {
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    if (isInsideTrigger(trigger, event.relatedTarget)) return;
    enterTrigger(trigger);
  }

  function onMouseOut(event) {
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    if (isInsideTrigger(trigger, event.relatedTarget)) return;
    leaveTrigger(trigger);
  }

  function onFocusIn(event) {
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    enterTrigger(trigger);
  }

  function onFocusOut(event) {
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    if (isInsideTrigger(trigger, event.relatedTarget)) return;
    leaveTrigger(trigger);
  }

  function onScrollOrResize() {
    if (
      state.activeTrigger &&
      state.activeTooltip &&
      state.activeTooltip.classList.contains('is-visible')
    ) {
      positionTooltip(state.activeTrigger, state.activeTooltip);
    }
  }

  function initAll() {
    document.querySelectorAll('.tma-tooltip:not(.tma-tooltip--static)').forEach((tip) => {
      if (!tip.classList.contains('is-visible')) {
        tip.setAttribute('aria-hidden', 'true');
      }
    });
  }

  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('mouseout', onMouseOut);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  window.PortalTooltip = { init: initAll, hideAll: hideActive };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
