/*
 * Sign-out for static portal shells: POSTs to Fortify's logout endpoint
 * using the XSRF cookie (no server-rendered form needed on static pages).
 * Wire any element with data-action="sign-out".
 */
(function () {
  'use strict';

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-action="sign-out"]');
    if (!btn) return;
    ev.preventDefault();
    /*
     * Leaving means leaving nothing behind: the read cache, and the desktop's
     * remembered /me — kept so an offline boot knows who it is, and exactly
     * the thing that must not survive into somebody else's sign-in. Note that
     * portal-store.js always described clear() as "what signing out runs",
     * but until here nothing ran it: on a desktop the previous reader's cache
     * outlived their session, saved only by setAccount wiping on the NEXT
     * sign-in. The wipe is awaited before navigating — a navigation kills
     * the page mid-sweep, which is a wipe that only looked like one.
     */
    var wiped = Promise.resolve();
    if (window.TMAStore) {
      wiped = Promise.resolve(window.TMAStore.clear()).catch(function () {});
    }
    try { localStorage.removeItem('tma.me'); } catch (e) { /* nothing kept */ }
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    var out = fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest'
      }
    }).catch(function () {});
    Promise.all([wiped, out]).then(function () {
      window.location.href = '/auth/login';
    });
  });
})();
