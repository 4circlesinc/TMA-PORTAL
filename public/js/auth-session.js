/*
 * On API 401, send the user to sign-in and bring them back afterward.
 * Global: wraps window.fetch for same-origin portal pages.
 *
 * Skip this during sign-out. Logging out destroys the session, so leftover
 * polls (/me, settings) also come back 401. Sending those to
 * /auth/login?return=/account-settings is why signing back in opened Settings
 * instead of the dashboard.
 */
(function () {
  'use strict';

  if (typeof window.fetch !== 'function') return;
  if (/^\/auth\//.test(location.pathname)) return;

  var nativeFetch = window.fetch.bind(window);

  function signingOut() {
    if (window.__TMA_SIGNING_OUT) return true;
    try { return sessionStorage.getItem('tma.signing-out') === '1'; } catch (e) { return false; }
  }

  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (response.status === 401 && !signingOut()) {
        var returnTo = location.pathname + location.search;
        location.assign('/auth/login?return=' + encodeURIComponent(returnTo));
      }
      return response;
    });
  };
})();
