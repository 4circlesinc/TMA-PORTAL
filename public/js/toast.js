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
   * Stacked cards for realtime / polled portal notifications. Position,
   * duration, sound, and related behaviour come from the signed-in user's
   * toast preferences (Settings → Notifications). Defaults match the
   * product default: bottom-right, 10s hold.
   */
  const TOAST_DEFAULTS = {
    enabled: true,
    position: 'bottom-right',
    durationSec: 10,
    stickyImportant: false,
    sound: false,
    previewText: true,
    groupSimilar: false,
  };

  const POSITIONS = ['bottom-right', 'top-right', 'bottom-left'];
  const DURATIONS = [3, 5, 8, 10];
  const GROUP_WINDOW_MS = 4000;
  const NOTIFY_MAX_STACK = 4;
  const notifiedIds = {};

  let toastPrefs = Object.assign({}, TOAST_DEFAULTS);
  let lastGroup = null;

  function clampPrefs(raw) {
    const next = Object.assign({}, TOAST_DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    next.enabled = !!next.enabled;
    next.stickyImportant = !!next.stickyImportant;
    next.sound = !!next.sound;
    next.previewText = next.previewText !== false;
    next.groupSimilar = !!next.groupSimilar;
    next.position = POSITIONS.indexOf(next.position) >= 0 ? next.position : TOAST_DEFAULTS.position;
    const dur = parseInt(next.durationSec, 10);
    next.durationSec = DURATIONS.indexOf(dur) >= 0 ? dur : TOAST_DEFAULTS.durationSec;
    return next;
  }

  function applyNotifyHostPosition(host) {
    if (!host) return;
    host.className = 'tma-notify-toast-host tma-notify-toast-host--' + toastPrefs.position;
  }

  function getNotifyHost() {
    let host = document.querySelector('[data-notify-toast-host]');
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-notify-toast-host', '');
      document.body.appendChild(host);
    }
    applyNotifyHostPosition(host);
    return host;
  }

  function applyToastPrefs(raw) {
    toastPrefs = clampPrefs(raw);
    const host = document.querySelector('[data-notify-toast-host]');
    if (host) applyNotifyHostPosition(host);
    return getToastPrefs();
  }

  function getToastPrefs() {
    return Object.assign({}, toastPrefs);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  function senderName(item) {
    if (item.actor && item.actor.name) return item.actor.name;
    if (item.meta && item.meta.from_name) return item.meta.from_name;
    const title = String(item.title || '');
    let m = title.match(/^New email from\s+(.+)$/i);
    if (m) return m[1];
    m = String(item.message || '').match(/^From\s+(.+?)\s+[—-]/);
    return m ? m[1] : '';
  }

  function notifyLeading(item) {
    const R = window.TMANotifyRender;
    const name = senderName(item);
    const isEmail = item.module === 'email' || (item.type && String(item.type).indexOf('email.') === 0);
    const asPerson = !!(item.actor || item.image || (isEmail && name));
    if (asPerson) {
      const fallback = R ? R.initialsUri(name) : '';
      const src = item.image || (item.actor && item.actor.avatar) || '';
      const url = (R && R.isRealPhoto ? R.isRealPhoto(src) : /^(https?:|\/(storage|media|portal)\/|data:)/i.test(src || ''))
        ? src
        : fallback;
      const safeFallback = String(fallback || '').replace(/'/g, '%27');
      const wrapStyle = 'width:36px;height:36px;min-width:36px;min-height:36px;max-width:36px;max-height:36px;' +
        'flex:0 0 36px;border-radius:50%;overflow:hidden;display:block;line-height:0;';
      const imgStyle = 'width:100%;height:100%;object-fit:cover;object-position:center;display:block;border-radius:0;';
      return '<span class="tma-notify-toast__avatar-wrap" style="' + wrapStyle + '">' +
        '<img class="tma-notify-toast__avatar" src="' + esc(url || fallback) + '" alt="" width="36" height="36" decoding="async" style="' + imgStyle + '"' +
        (fallback ? " onerror=\"this.onerror=null;this.src='" + safeFallback + "'\"" : '') + '>' +
        '</span>';
    }
    const tone = R ? R.levelTone(item.level) : 'blue';
    const iconSrc = R ? R.iconUrl(item.icon) : 'images/icons/phosphor/' + (item.icon || 'Notification') + '.svg';
    return '<span class="tma-notify-toast__icon tma-notify-toast__icon--' + esc(tone) + '" aria-hidden="true">' +
      '<img src="' + esc(iconSrc) + '" alt=""></span>';
  }

  function isImportant(item) {
    const priority = String(item.priority || '').toLowerCase();
    const level = String(item.level || '').toLowerCase();
    const type = String(item.type || '').toLowerCase();
    const module = String(item.module || '').toLowerCase();
    if (priority === 'high' || priority === 'urgent') return true;
    if (level === 'error' || level === 'security' || level === 'approval') return true;
    if (type.indexOf('security.') === 0 || type.indexOf('approval.') === 0) return true;
    if (module === 'security' || module === 'approvals') return true;
    return false;
  }

  function groupKey(item) {
    return String(item.type || item.module || item.title || 'toast');
  }

  function playNotifySound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playNotifySound._ctx || (playNotifySound._ctx = new Ctx());
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) { /* ignore autoplay / unsupported */ }
  }

  function dismissNotifyToast(card) {
    if (!card || card._closing) return;
    card._closing = true;
    clearTimeout(card._timer);
    card.classList.add('tma-notify-toast--closing');
    setTimeout(() => {
      const host = card.parentNode;
      if (host) host.removeChild(card);
      if (lastGroup && lastGroup.card === card) lastGroup = null;
    }, 260);
  }

  function bumpGroupedToast(card, item) {
    card._groupCount = (card._groupCount || 1) + 1;
    const titleEl = card.querySelector('.tma-notify-toast__title');
    const msgEl = card.querySelector('.tma-notify-toast__message');
    if (titleEl) {
      const base = card._baseTitle || item.title || titleEl.textContent;
      card._baseTitle = base;
      titleEl.textContent = base + ' (' + card._groupCount + ')';
    }
    if (msgEl && toastPrefs.previewText && item.message) {
      msgEl.textContent = item.message;
    }
    lastGroup = { key: groupKey(item), card: card, at: Date.now() };
    return card;
  }

  function showNotificationToast(item, options = {}) {
    if (!item || !item.title) return null;

    const preview = !!options.preview;
    if (!preview && !toastPrefs.enabled) return null;

    if (!preview && item.id) {
      if (notifiedIds[item.id]) return null;
      notifiedIds[item.id] = true;
    }

    if (!preview && toastPrefs.groupSimilar && lastGroup
      && lastGroup.key === groupKey(item)
      && (Date.now() - lastGroup.at) < GROUP_WINDOW_MS
      && lastGroup.card && lastGroup.card.parentNode && !lastGroup.card._closing) {
      const grouped = bumpGroupedToast(lastGroup.card, item);
      if (toastPrefs.sound) playNotifySound();
      const sticky = toastPrefs.stickyImportant && isImportant(item);
      if (!sticky) {
        clearTimeout(grouped._timer);
        grouped._timer = setTimeout(() => dismissNotifyToast(grouped), (toastPrefs.durationSec || 10) * 1000);
      }
      return grouped;
    }

    const host = getNotifyHost();

    while (host.children.length >= NOTIFY_MAX_STACK) {
      host.removeChild(host.firstChild);
    }

    const showPreview = toastPrefs.previewText !== false;
    const card = document.createElement('div');
    card.className = 'tma-notify-toast';
    card.setAttribute('role', 'status');
    card._baseTitle = item.title;
    card._groupCount = 1;
    if (item.id) card.setAttribute('data-notify-toast-id', item.id);
    if (preview) card.setAttribute('data-notify-toast-preview', '1');
    const cta = (!preview && item.actionLabel && item.actionUrl)
      ? '<div class="tma-notify-toast__cta">' + esc(item.actionLabel) + '</div>'
      : '';
    card.innerHTML =
      notifyLeading(item) +
      '<div class="tma-notify-toast__body">' +
        '<div class="tma-notify-toast__title">' + esc(item.title) + '</div>' +
        (showPreview && item.message ? '<div class="tma-notify-toast__message">' + esc(item.message) + '</div>' : '') +
        cta +
      '</div>' +
      '<button type="button" class="tma-notify-toast__close" data-notify-toast-close aria-label="Dismiss">&times;</button>';

    const holdMs = options.holdMs != null
      ? options.holdMs
      : (toastPrefs.durationSec || 10) * 1000;
    const leaveMs = options.leaveMs || HOVER_LEAVE_MS;
    const sticky = !preview && toastPrefs.stickyImportant && isImportant(item);

    function arm(ms) {
      if (sticky) return;
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
      if (preview) return;
      const store = window.TMANotifications;
      if (item.id && store && store.markRead) store.markRead(item.id);
      if (item.actionUrl) {
        const dash = document.querySelector('.tma-dash');
        if (dash && dash._portalNavigate) dash._portalNavigate(item.actionUrl);
        else window.location.assign((window.__TMA_SITE_ROOT || '') + item.actionUrl);
      }
    });

    host.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('tma-notify-toast--visible')));
    arm(holdMs);

    if (!preview) {
      lastGroup = { key: groupKey(item), card: card, at: Date.now() };
      if (toastPrefs.sound) playNotifySound();
    }

    return card;
  }

  /** Settings preview — never marks as a real notification. */
  function previewNotificationToast(overrides) {
    const item = Object.assign({
      title: 'Sample notification',
      message: 'This is how toasts will appear here.',
      icon: 'Bell',
      level: 'info',
      module: 'system',
      type: 'system.preview',
    }, overrides || {});
    return showNotificationToast(item, {
      preview: true,
      holdMs: Math.min((toastPrefs.durationSec || 5) * 1000, 5000),
    });
  }

  window.TMAToast = {
    renderToast,
    mountScene,
    updateSceneScale,
    showFloatingToast,
    showNotificationToast,
    previewNotificationToast,
    applyToastPrefs,
    getToastPrefs,
  };

  // Restore last-known prefs immediately so the first toast of a session uses
  // the correct corner before /me finishes. /me then overwrites with truth.
  try {
    const cached = JSON.parse(localStorage.getItem('tma.toasts') || 'null');
    if (cached && typeof cached === 'object') applyToastPrefs(cached);
  } catch (e) { /* ignore */ }
})();
