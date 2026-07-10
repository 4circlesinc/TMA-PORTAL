/*
 * TMA — List / grid view toggle for data table pages (Clients, Users, …)
 * Global: window.TMATableViewToggle
 */
(function () {
  'use strict';

  var registry = {};
  var activeView = null;
  var wired = false;

  function syncUI(viewId) {
    var wrap = document.querySelector('[data-page-view-toggle]');
    var ctrl = viewId && registry[viewId];
    if (!wrap || !ctrl) return;
    var mode = ctrl.getViewMode();
    wrap.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      var btnMode = btn.getAttribute('data-view-mode');
      var isActive = mode === btnMode;
      btn.classList.toggle('tma-dash__view-toggle-btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function init(wrap) {
    if (!wrap || wired) return;
    wired = true;
    wrap.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!activeView || !registry[activeView]) return;
        var ctrl = registry[activeView];
        var mode = btn.getAttribute('data-view-mode') || 'list';
        if (ctrl.getViewMode() === mode) return;
        ctrl.setViewMode(mode);
        ctrl.render();
        syncUI(activeView);
      });
    });
  }

  window.TMATableViewToggle = {
    init: init,
    register: function (viewId, controller) {
      registry[viewId] = controller;
    },
    activate: function (viewId) {
      activeView = viewId && registry[viewId] ? viewId : null;
      if (activeView) syncUI(activeView);
    },
    sync: function (viewId) {
      syncUI(viewId || activeView);
    },
  };
})();
