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
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest'
      }
    }).then(function () {
      window.location.href = '/auth/login';
    }).catch(function () {
      window.location.href = '/auth/login';
    });
  });
})();
