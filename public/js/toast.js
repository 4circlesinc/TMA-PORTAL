(function () {
  'use strict';

  const DEFAULTS = {
    successful: { big: 'Done', small: 'Done' },
    failure: { big: 'Something Wrong', small: 'Something Wrong' },
  };

  function svg(key, className, width, height) {
    const icons = window.TMAToastIcons;
    return icons ? icons.svg(key, className, width, height) : '';
  }

  function iconKey(size, state) {
    const big = size === 'big';
    if (state === 'successful') return big ? 'ToastCheckCircle20' : 'ToastCheckCircle16';
    return big ? 'ToastWarning20' : 'ToastWarning16';
  }

  function renderToast(options = {}) {
    const {
      size = 'big',
      state = 'successful',
      message,
      className = '',
      attrs = '',
      role = 'status',
    } = options;

    const sizeClass = size === 'small' ? 'tma-toast--small' : 'tma-toast--big';
    const stateClass = state === 'failure' ? 'tma-toast--failure' : 'tma-toast--successful';
    const text = message || DEFAULTS[state === 'failure' ? 'failure' : 'successful'][size === 'small' ? 'small' : 'big'];
    const icon = iconKey(size, state);
    const iconSize = size === 'small' ? 16 : 20;
    const extraClass = className ? ` ${className}` : '';

    return `<div class="tma-toast ${sizeClass} ${stateClass}${extraClass}" role="${role}"${attrs}>
      <span class="tma-toast__icon">${svg(icon, '', iconSize, iconSize)}</span>
      <p class="tma-toast__text">${text}</p>
    </div>`;
  }

  function updateSceneScale(scene) {
    if (!scene) return;
    const scale = scene.clientWidth / 1440;
    scene.style.setProperty('--toast-scene-scale', String(scale));
  }

  function mountScene(root, options = {}) {
    const GS = window.TMAGlobalSearch;
    if (!GS || !root) return null;

    const { autoShow = true, durationMs = 3000, loop = false } = options;
    root.innerHTML = `<div class="tma-toast-guidance-scene" data-toast-scene>
      <div class="tma-toast-guidance-scene__canvas" data-toast-scene-canvas>
        ${GS.renderOverview({ interactive: false })}
        <div class="tma-toast-guidance-scene__toast-wrap" data-toast-scene-toast>
          ${renderToast({ size: 'big', state: 'successful' })}
        </div>
      </div>
    </div>`;

    const scene = root.querySelector('[data-toast-scene]');
    const wrap = root.querySelector('[data-toast-scene-toast]');
    updateSceneScale(scene);

    let timer = null;

    function showToast() {
      if (!wrap) return;
      wrap.setAttribute('data-visible', '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        wrap.removeAttribute('data-visible');
        if (loop) {
          timer = setTimeout(showToast, 600);
        }
      }, durationMs);
    }

    if (autoShow) {
      requestAnimationFrame(() => {
        requestAnimationFrame(showToast);
      });
    }

    const observer = new ResizeObserver(() => updateSceneScale(scene));
    observer.observe(scene);

    return { scene, wrap, showToast, destroy: () => observer.disconnect() };
  }

  /* Hovering a toast means the user is reading it — never yank it away
     mid-read. The timer restarts (shorter) once the pointer leaves. */
  const HOVER_LEAVE_MS = 5000;

  function showFloatingToast(message, options = {}) {
    const {
      size = 'big',
      state = 'successful',
      durationMs = 3000,
      container = document.body,
    } = options;

    let host = container.querySelector('[data-toast-floating-host]');
    if (!host) {
      host = document.createElement('div');
      host.className = 'tma-toast-floating-host';
      host.setAttribute('data-toast-floating-host', '');
      container.appendChild(host);
      host.addEventListener('mouseenter', () => clearTimeout(host._timer));
      host.addEventListener('mouseleave', () => {
        clearTimeout(host._timer);
        host._timer = setTimeout(() => host.removeAttribute('data-visible'), HOVER_LEAVE_MS);
      });
    }

    host.innerHTML = renderToast({ size, state, message });
    host.setAttribute('data-visible', '');
    clearTimeout(host._timer);
    host._timer = setTimeout(() => host.removeAttribute('data-visible'), durationMs);
  }

  /* ── Notification toasts ──────────────────────────────────────────────
   *
   * A stacked card in the top-right corner for every notification that
   * arrives while the user is in the portal (realtime push or the polling
   * fallback — see notify-store.js). Distinct from the feedback toast
   * above: it shows who/what, deep-links to the notification's action,
   * and lives long enough to actually be read.
   *
   * Timing per spec: closes on its own after 10 seconds; hovering holds it
   * open for as long as the pointer stays; once the pointer leaves it
   * closes 5 seconds later.
   */
  const NOTIFY_HOLD_MS = 10000;
  const NOTIFY_MAX_STACK = 4;
  const notifiedIds = {};

  function getNotifyHost() {
    let host = document.querySelector('[data-notify-toast-host]');
    if (!host) {
      host = document.createElement('div');
      host.className = 'tma-notify-toast-host';
      host.setAttribute('data-notify-toast-host', '');
      document.body.appendChild(host);
    }
    return host;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  /* The same person-photo / system-glyph rule the notification panels use,
     borrowed from TMANotifyRender so a toast matches its panel row. */
  function notifyLeading(item) {
    const R = window.TMANotifyRender;
    if (item.actor || item.image) {
      const name = (item.actor && item.actor.name) || '';
      const fallback = R ? R.initialsUri(name) : '';
      const src = item.image || (item.actor && item.actor.avatar) || '';
      const url = /^(https?:|\/(storage|media)\/|data:)/.test(src || '') ? src : fallback;
      return '<img class="tma-notify-toast__avatar" src="' + esc(url) + '" alt=""' +
        (fallback ? " onerror=\"this.onerror=null;this.src='" + fallback + "'\"" : '') + '>';
    }
    const tone = R ? R.levelTone(item.level) : 'blue';
    const iconSrc = R ? R.iconUrl(item.icon) : 'images/icons/phosphor/' + (item.icon || 'Notification') + '.svg';
    return '<span class="tma-notify-toast__icon tma-notify-toast__icon--' + esc(tone) + '" aria-hidden="true">' +
      '<img src="' + esc(iconSrc) + '" alt=""></span>';
  }

  function dismissNotifyToast(card) {
    if (!card || card._closing) return;
    card._closing = true;
    clearTimeout(card._timer);
    card.classList.add('tma-notify-toast--closing');
    setTimeout(() => {
      const host = card.parentNode;
      if (host) host.removeChild(card);
    }, 260);
  }

  function showNotificationToast(item, options = {}) {
    if (!item || !item.title) return null;

    // One toast per notification, ever — realtime and the poll fallback can
    // both report the same arrival.
    if (item.id) {
      if (notifiedIds[item.id]) return null;
      notifiedIds[item.id] = true;
    }

    const host = getNotifyHost();

    // Never stack past readability; the oldest card yields.
    while (host.children.length >= NOTIFY_MAX_STACK) {
      host.removeChild(host.firstChild);
    }

    const card = document.createElement('div');
    card.className = 'tma-notify-toast';
    card.setAttribute('role', 'status');
    if (item.id) card.setAttribute('data-notify-toast-id', item.id);
    card.innerHTML =
      notifyLeading(item) +
      '<div class="tma-notify-toast__body">' +
        '<div class="tma-notify-toast__title">' + esc(item.title) + '</div>' +
        (item.message ? '<div class="tma-notify-toast__message">' + esc(item.message) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="tma-notify-toast__close" data-notify-toast-close aria-label="Dismiss">&times;</button>';

    const holdMs = options.holdMs || NOTIFY_HOLD_MS;
    const leaveMs = options.leaveMs || HOVER_LEAVE_MS;

    function arm(ms) {
      clearTimeout(card._timer);
      card._timer = setTimeout(() => dismissNotifyToast(card), ms);
    }

    card.addEventListener('mouseenter', () => clearTimeout(card._timer));
    card.addEventListener('mouseleave', () => arm(leaveMs));

    card.querySelector('[data-notify-toast-close]').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissNotifyToast(card);
    });

    card.addEventListener('click', () => {
      dismissNotifyToast(card);
      const store = window.TMANotifications;
      if (item.id && store && store.markRead) store.markRead(item.id);
      if (item.actionUrl) {
        // Same routing rule the panel rows use: the SPA navigator when the
        // dashboard shell is mounted, a full load otherwise.
        const dash = document.querySelector('.tma-dash');
        if (dash && dash._portalNavigate) dash._portalNavigate(item.actionUrl);
        else window.location.assign((window.__TMA_SITE_ROOT || '') + item.actionUrl);
      }
    });

    host.appendChild(card);
    // Double rAF so the enter transition actually plays on a fresh node.
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('tma-notify-toast--visible')));
    arm(holdMs);

    return card;
  }

  window.TMAToast = {
    renderToast,
    mountScene,
    updateSceneScale,
    showFloatingToast,
    showNotificationToast,
  };
})();
