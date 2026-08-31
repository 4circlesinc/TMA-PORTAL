/* Sync progress toasts — retired (2026-08-31).

   Email, calendar, OneDrive and document imports now run silently in the
   background: the cards covered working UI (the compose Send button among
   them), and an ordinary queue wait surfaced as "ask an administrator to
   check the queue worker" to people who could do nothing about it. Sync
   state still lives on the mailbox page and Settings → Background
   Operations, where an administrator can actually act on it.

   The API stays as no-ops so callers need no changes, and host() still
   returns the real bottom-right column — the upload manager and mail cards
   mount into it so their toasts keep stacking instead of overlapping. */
(function () {
  'use strict';

  if (window.TMASyncToasts) return;

  var host = null;

  function ensureHost() {
    if (!host || !host.isConnected) {
      host = document.querySelector('[data-sync-toast-host]') || document.createElement('div');
      host.className = 'tma-sync-toast-host';
      host.setAttribute('data-sync-toast-host', '');
      if (!host.parentNode) document.body.appendChild(host);
    }
    return host;
  }

  var noop = function () {};

  window.TMASyncToasts = {
    poll: noop,
    watch: noop,
    dismiss: noop,
    update: noop,
    host: ensureHost,
  };
})();
