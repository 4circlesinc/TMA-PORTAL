/*
 * TMA - Client portal view dispatcher + shared UI helpers
 * Portal page modules register mount functions per view name;
 * the dashboard controller activates them on navigation.
 * Globals: window.TMAPortalViews, window.TMAPortalUI
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';

  /* ── view registry ─────────────────────────────── */
  var pages = {};

  function register(view, mountFn) {
    pages[view] = mountFn;
  }

  function activate(view, root, opts) {
    var fn = pages[view];
    if (!fn) return false;
    var mountEl = root.querySelector('.tma-dash__view[data-view="' + view + '"] [data-portal-mount]');
    if (!mountEl) return false;
    fn(mountEl, opts || {});
    // A view just (re)rendered its markup — let shared chrome (the signed-in
    // user's name/avatar in current-user.js) re-apply itself so re-created
    // elements don't keep placeholder/broken images.
    try {
      document.dispatchEvent(new CustomEvent('tma:view-rendered', { detail: { view: view } }));
    } catch (e) {}
    return true;
  }

  function has(view) { return !!pages[view]; }

  window.TMAPortalViews = { register: register, activate: activate, has: has };

  /* ── shared UI helpers ─────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function icon(name, size) {
    var px = size || 20;
    return '<img src="' + ICON + esc(name) + '.svg" alt="" width="' + px + '" height="' + px + '" aria-hidden="true">';
  }

  /* Primary / secondary buttons - reuse the no-data CTA recipe */
  function btn(opts) {
    var o = opts || {};
    var cls = 'tma-no-data__btn';
    if (o.variant === 'ghost') cls += ' tma-portal-btn--ghost';
    if (o.variant === 'danger') cls += ' tma-portal-btn--danger';
    if (o.small) cls += ' tma-portal-btn--small';
    var iconHtml = o.icon
      ? '<img class="tma-no-data__btn-icon" src="' + ICON + esc(o.icon) + '.svg" alt="" width="16" height="16">'
      : '';
    return '<button type="button" class="' + cls + '"' + (o.attrs || '') + (o.disabled ? ' disabled' : '') + '>' +
      iconHtml + '<span>' + esc(o.label) + '</span>' +
      (o.caret ? '<img class="tma-no-data__btn-icon tma-portal-btn__caret" src="images/icons/tma/ArrowLineDown-16.svg" alt="" width="10" height="10">' : '') +
      '</button>';
  }

  /* Centered empty state with illustration (portal pages) */
  function emptyState(opts) {
    var o = opts || {};
    var ill = o.illustration || 'Illustration07';
    return '<div class="tma-portal-empty">' +
      '<img class="tma-portal-empty__illustration" src="images/illustrations/' + esc(ill) + '.svg" alt="" width="120" height="120" decoding="async">' +
      '<p class="tma-portal-empty__title">' + esc(o.title || 'Nothing here yet') + '</p>' +
      (o.subtitle ? '<p class="tma-portal-empty__subtitle">' + esc(o.subtitle) + '</p>' : '') +
      (o.button ? '<div class="tma-portal-empty__cta">' + o.button + '</div>' : '') +
      '</div>';
  }

  /* Info / warning banner */
  function banner(kind, html, attrs) {
    return '<div class="tma-portal-banner tma-portal-banner--' + esc(kind || 'info') + '"' + (attrs || '') + '>' +
      '<img class="tma-portal-banner__icon" src="' + ICON + (kind === 'warning' ? 'WarningCircle' : 'Info') + '.svg" alt="" width="16" height="16">' +
      '<span class="tma-portal-banner__text">' + html + '</span>' +
      '</div>';
  }

  /* A–Z alphabetical filter row */
  function alphaFilter(active) {
    var letters = ['All'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')).concat(['#']);
    return '<div class="tma-portal-alpha" role="group" aria-label="Filter by letter">' +
      letters.map(function (l) {
        var on = (active || 'All') === l;
        return '<button type="button" class="tma-portal-alpha__btn' + (on ? ' is-active' : '') + '" data-alpha="' + esc(l) + '" aria-pressed="' + on + '">' + esc(l) + '</button>';
      }).join('') +
      '</div>';
  }

  /* Search - reuses documented table toolbar search chrome (dashboard.css) */
  function searchInput(placeholder, dataAttr, value, opts) {
    var o = opts || {};
    var v = value || '';
    var hasValue = !!String(v).length;
    var classes = ['tma-dash__toolbar-search'];
    if (o.focused || hasValue) classes.push('tma-dash__toolbar-search--focused');
    if (hasValue) classes.push('tma-dash__toolbar-search--has-value');
    return '<div class="' + classes.join(' ') + '" role="search" data-portal-search-wrap>' +
      '<img src="images/icons/tma/Search-16.svg" alt="" width="16" height="16">' +
      '<input type="search" class="tma-dash__search-input" ' + (dataAttr || '') +
      ' placeholder="' + esc(placeholder || 'Search') + '" value="' + esc(v) + '"' +
      ' aria-label="' + esc(placeholder || 'Search') + '" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-search-clear>' +
      '<img src="images/icons/phosphor/XCircle.svg" alt="" width="16" height="16"></button>' +
      '<kbd class="tma-dash__kbd" data-search-shortcut>/</kbd>' +
      '</div>';
  }

  function wireToolbarSearch(root, inputSelector, onChange) {
    if (!root) return;
    var input = root.querySelector(inputSelector);
    if (!input) return;
    var wrap = input.closest('[data-portal-search-wrap]');
    if (!wrap) return;

    function sync() {
      var has = !!input.value.trim();
      wrap.classList.toggle('tma-dash__toolbar-search--has-value', has);
      wrap.classList.toggle('tma-dash__toolbar-search--focused', document.activeElement === input);
    }

    input.addEventListener('input', function () {
      sync();
      if (typeof onChange === 'function') onChange(input.value);
    });
    input.addEventListener('focus', sync);
    input.addEventListener('blur', function () { setTimeout(sync, 0); });

    var clear = wrap.querySelector('[data-search-clear]');
    if (clear) {
      clear.addEventListener('click', function (e) {
        e.preventDefault();
        input.value = '';
        sync();
        if (typeof onChange === 'function') onChange('');
        input.focus();
      });
    }

    sync();
  }

  /* Data table */
  function table(headers, rowsHtml, opts) {
    var o = opts || {};
    return '<div class="tma-portal-table-wrap"><table class="tma-portal-table' + (o.cls ? ' ' + esc(o.cls) : '') + '"' + (o.tableAttrs || '') + '>' +
      '<thead><tr>' + headers.map(function (h) {
        if (typeof h === 'string') return '<th scope="col">' + esc(h) + '</th>';
        return '<th scope="col"' + (h.attrs || '') + '>' + (h.html != null ? h.html : esc(h.label)) + '</th>';
      }).join('') + '</tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
      '</table></div>';
  }

  /* Settings-style section: heading + grey inner card */
  function section(title, bodyHtml, opts) {
    var o = opts || {};
    return '<section class="tma-portal-section"' + (o.attrs || '') + '>' +
      (title ? '<h3 class="tma-portal-section__title">' + esc(title) + (o.help ? ' <span class="tma-portal-help" title="' + esc(o.help) + '">&#9432;</span>' : '') + '</h3>' : '') +
      (o.description ? '<p class="tma-portal-section__desc">' + esc(o.description) + '</p>' : '') +
      '<div class="tma-portal-section__card">' + bodyHtml + '</div>' +
      '</section>';
  }

  /* Yes / No radio pair */
  function radioYesNo(name, value, dataAttr) {
    function one(v, label) {
      return '<label class="tma-portal-radio">' +
        '<input type="radio" name="' + esc(name) + '" value="' + v + '"' + (value === v ? ' checked' : '') + ' ' + (dataAttr || '') + '>' +
        '<span class="tma-portal-radio__dot" aria-hidden="true"></span>' +
        '<span>' + label + '</span></label>';
    }
    return '<div class="tma-portal-radio-row">' + one('yes', 'Yes') + one('no', 'No') + '</div>';
  }

  /* Toggle switch - same markup as settings switch (dashboard.css) */
  function toggle(checked, dataAttr, ariaLabel) {
    return '<label class="tma-dash__settings-switch">' +
      '<input class="tma-dash__settings-switch-input" type="checkbox"' + (checked ? ' checked' : '') +
      ' ' + (dataAttr || '') + ' role="switch" aria-label="' + esc(ariaLabel || 'Toggle') + '">' +
      '<span class="tma-dash__settings-switch-ui" aria-hidden="true">' +
      '<span class="tma-dash__settings-switch-track"></span>' +
      '<span class="tma-dash__settings-switch-thumb"></span></span></label>';
  }

  /* Select control */
  function select(options, value, dataAttr, ariaLabel) {
    return '<select class="tma-portal-select" ' + (dataAttr || '') + ' aria-label="' + esc(ariaLabel || 'Select') + '">' +
      options.map(function (opt) {
        var v = typeof opt === 'string' ? opt : opt.value;
        var l = typeof opt === 'string' ? opt : opt.label;
        return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') +
      '</select>';
  }

  function input(opts) {
    var o = opts || {};
    return '<input class="tma-portal-input" type="' + esc(o.type || 'text') + '" ' + (o.attrs || '') +
      ' placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '"' +
      (o.ariaLabel ? ' aria-label="' + esc(o.ariaLabel) + '"' : '') + '>';
  }

  function field(label, controlHtml) {
    return '<div class="tma-portal-field">' +
      '<span class="tma-portal-field__label">' + esc(label) + '</span>' +
      controlHtml +
      '</div>';
  }

  /* Modal - settings popup chrome (title inside card, single close button) */
  var modalHost = null;

  function closeModal() {
    if (modalHost) {
      modalHost.remove();
      modalHost = null;
      document.removeEventListener('keydown', onModalKey);
    }
  }

  function onModalKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function openModal(opts) {
    var o = opts || {};
    closeModal();
    modalHost = document.createElement('div');
    modalHost.className = 'tma-portal-modal';
    modalHost.innerHTML =
      '<div class="tma-portal-modal__backdrop" data-portal-modal-close></div>' +
      '<div class="tma-dash__settings-change-card tma-portal-modal__card" role="dialog" aria-modal="true" aria-label="' + esc(o.title || 'Dialog') + '">' +
      '<div class="tma-portal-modal__head">' +
      (o.title ? '<h2 class="tma-portal-modal__title">' + esc(o.title) + '</h2>' : '<span class="tma-portal-modal__title" aria-hidden="true"></span>') +
      '<button type="button" class="tma-dash__settings-change-close" data-portal-modal-close aria-label="Close">' +
      '<img src="' + ICON + 'X.svg" alt=""></button>' +
      '</div>' +
      '<div class="tma-portal-modal__body">' + (o.body || '') + '</div>' +
      '</div>';
    document.body.appendChild(modalHost);
    modalHost.querySelectorAll('[data-portal-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', onModalKey);
    if (typeof o.onMount === 'function') o.onMount(modalHost);
    var focusable = modalHost.querySelector('input, select, textarea, button:not([data-portal-modal-close])');
    if (focusable) focusable.focus();
    return modalHost;
  }

  /* Underline tab group - reuses .tma-tab-group markup + PortalTabGroup */
  function tabs(items, activeKey) {
    return '<div class="tma-tab-group tma-tab-group--underline" role="tablist">' +
      items.map(function (it, i) {
        var on = it.key === activeKey;
        return '<button type="button" class="tma-tab' + (on ? ' is-active' : '') + '" role="tab"' +
          ' data-tab-index="' + i + '" data-tab-key="' + esc(it.key) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' +
          '<span class="tma-tab__label">' + esc(it.label) + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
          '</button>';
      }).join('') +
      '</div>';
  }

  function wireTabs(container, onChange) {
    if (window.PortalTabGroup) window.PortalTabGroup.init(container);
    container.addEventListener('tma-tab-change', function (e) {
      if (e.detail && e.detail.key != null) onChange(e.detail.key);
    });
  }

  function toast(message) {
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(message, { variant: 'successful' });
    }
  }

  /* Head dropdown - same pattern as Clients main-head buttons */
  function headDropdown(opts) {
    var o = opts || {};
    var variant = o.primary ? 'primary' : 'secondary';
    var align = o.alignEnd ? ' tma-dash__head-dropdown-menu--end' : ' tma-dash__head-dropdown-menu--start';
    var wrapAttr = o.wrapAttrs ? ' ' + o.wrapAttrs : '';
    var items = (o.items || []).map(function (it) {
      var action = it.action != null ? String(it.action) : esc(it.label);
      var disabled = it.disabled ? ' disabled' : '';
      return '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="' + esc(action) + '"' + disabled + '>' + esc(it.label) + '</button>';
    }).join('');
    return (
      '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap' + wrapAttr + '>' +
      '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--' + variant + '" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
      esc(o.label || '') +
      '<img class="tma-dash__head-dropdown-caret" src="images/icons/tma/ArrowLineDown-16.svg" alt="" width="10" height="10" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu' + align + '" data-head-dropdown-menu hidden role="menu" aria-label="' + esc(o.menuLabel || o.label || 'Menu') + '">' +
      items +
      '</div></div>'
    );
  }

  function wireHeadDropdown(wrap, onSelect) {
    if (!wrap || wrap.dataset.portalHeadDropdownWired) return;
    wrap.dataset.portalHeadDropdownWired = '1';
    if (window.TMAHeadDropdown) window.TMAHeadDropdown.mount();
    wrap.addEventListener('head-dropdown:select', function (e) {
      if (e.detail.wrap !== wrap) return;
      var item = e.detail.item;
      if (item && item.disabled) return;
      onSelect({
        action: e.detail.action,
        label: item ? item.textContent.trim() : '',
      });
    });
  }

  function wireHeadDropdownAll(root, selector, onSelect) {
    if (!root) return;
    root.querySelectorAll(selector).forEach(function (wrap) {
      wireHeadDropdown(wrap, onSelect);
    });
  }

  /* Small dropdown menu anchored to a trigger */
  function wireMenu(trigger, items, onPick) {
    if (!trigger || trigger.dataset.portalMenuWired) return;
    trigger.dataset.portalMenuWired = '1';
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var existing = document.querySelector('.tma-portal-menu-pop');
      if (existing) { existing.remove(); return; }
      var menu = document.createElement('div');
      menu.className = 'tma-portal-menu-pop';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = items.map(function (it, i) {
        return '<button type="button" class="tma-portal-menu-pop__item" role="menuitem" data-menu-index="' + i + '"' + (it.disabled ? ' disabled' : '') + '><span class="tma-portal-menu-pop__label">' + esc(it.label) + '</span></button>';
      }).join('');
      document.body.appendChild(menu);
      var r = trigger.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.zIndex = '260';
      menu.style.visibility = 'hidden';
      menu.style.left = '0';
      menu.style.top = '0';
      var menuWidth = menu.offsetWidth;
      var left = Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8));
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = left + 'px';
      menu.style.visibility = '';
      function dismiss() {
        menu.remove();
        document.removeEventListener('click', dismiss);
      }
      menu.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-menu-index]');
        if (!b) return;
        dismiss();
        onPick(items[parseInt(b.getAttribute('data-menu-index'), 10)]);
      });
      setTimeout(function () { document.addEventListener('click', dismiss); }, 0);
    });
  }

  /* Global skeleton loading placeholder for any portal view that awaits data.
     opts: { count, grid, inline, trailing, width }. Falls back to text if the
     shared skeleton (current-user.js) hasn't defined window.TMASkeleton yet. */
  function loading(opts) {
    opts = opts || {};
    if (window.TMASkeleton) {
      if (opts.inline) return window.TMASkeleton.line(opts.width || '60%');
      if (opts.grid) return window.TMASkeleton.cards(opts.count || 8, opts);
      return window.TMASkeleton.rows(opts.count || 6, opts);
    }
    return '<div class="tma-portal-loading" role="status" aria-live="polite">Loading…</div>';
  }

  window.TMAPortalUI = {
    esc: esc,
    icon: icon,
    btn: btn,
    loading: loading,
    headDropdown: headDropdown,
    wireHeadDropdown: wireHeadDropdown,
    wireHeadDropdownAll: wireHeadDropdownAll,
    emptyState: emptyState,
    banner: banner,
    alphaFilter: alphaFilter,
    searchInput: searchInput,
    wireToolbarSearch: wireToolbarSearch,
    table: table,
    section: section,
    radioYesNo: radioYesNo,
    toggle: toggle,
    select: select,
    input: input,
    field: field,
    openModal: openModal,
    closeModal: closeModal,
    toast: toast,
    wireMenu: wireMenu,
    tabs: tabs,
    wireTabs: wireTabs,
  };
})();
