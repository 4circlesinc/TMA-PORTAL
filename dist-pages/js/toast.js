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
    }

    host.innerHTML = renderToast({ size, state, message });
    host.setAttribute('data-visible', '');
    clearTimeout(host._timer);
    host._timer = setTimeout(() => host.removeAttribute('data-visible'), durationMs);
  }

  window.TMAToast = {
    renderToast,
    mountScene,
    updateSceneScale,
    showFloatingToast,
  };
})();
