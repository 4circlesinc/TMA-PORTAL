/*
 * TMA - Main-head dropdown buttons (Clients, Today, etc.)
 * Global: window.TMAHeadDropdown
 */
(function () {
  'use strict';

  var wired = false;

  function getWrap(menu) {
    return menu && menu.closest('[data-head-dropdown-wrap]');
  }

  function getToggle(wrap) {
    return wrap && wrap.querySelector('[data-head-dropdown-toggle]');
  }

  function getMenu(wrap) {
    return wrap && wrap.querySelector('[data-head-dropdown-menu]');
  }

  function closeWrap(wrap) {
    if (!wrap) return;
    var menu = getMenu(wrap);
    var toggle = getToggle(wrap);
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function closeAll(exceptWrap) {
    document.querySelectorAll('[data-head-dropdown-wrap]').forEach(function (wrap) {
      if (exceptWrap && wrap === exceptWrap) return;
      closeWrap(wrap);
    });
  }

  function toggleWrap(wrap) {
    var menu = getMenu(wrap);
    var toggle = getToggle(wrap);
    if (!menu || !toggle) return;
    var open = menu.hidden;
    closeAll();
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function mount() {
    if (wired) return;
    wired = true;

    document.addEventListener('click', function (event) {
      var wrap = event.target.closest('[data-head-dropdown-wrap]');
      if (!wrap) {
        closeAll();
        return;
      }

      var toggle = event.target.closest('[data-head-dropdown-toggle]');
      if (toggle && wrap.contains(toggle)) {
        event.stopPropagation();
        toggleWrap(wrap);
        return;
      }

      var item = event.target.closest('[data-head-dropdown-item]');
      if (item && wrap.contains(item)) {
        event.stopPropagation();
        closeAll();
        wrap.dispatchEvent(new CustomEvent('head-dropdown:select', {
          bubbles: true,
          detail: {
            action: item.getAttribute('data-head-dropdown-item') || '',
            item: item,
            wrap: wrap,
          },
        }));
        return;
      }

      if (!event.target.closest('[data-head-dropdown-menu]')) {
        closeWrap(wrap);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeAll();
    });
  }

  window.TMAHeadDropdown = {
    mount: mount,
    closeAll: closeAll,
    closeWrap: closeWrap,
  };
})();
