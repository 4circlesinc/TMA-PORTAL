/*
 * On API 401, send the user to sign-in and bring them back afterward.
 * Global: wraps window.fetch for same-origin portal pages.
 *
 * Skip this during sign-out. Logging out destroys the session, so leftover
 * polls (/me, settings) also come back 401. Sending those to
 * /auth/login?return=/account-settings is why signing back in opened Settings
 * instead of the dashboard.
 *
 * A 403 carrying code 'mfa-required' is the same shape of problem: an
 * authenticator is now required of this account, so every call the open page
 * makes will fail until it is set up. Without this the page just decays into
 * failed panels; the person is meant to be on the setup screen.
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

  /* Reading the body consumes it, so clone first — the caller still needs
     its own copy of the response to fail on in its own way. */
  function redirectIfMfaRequired(response) {
    var type = response.headers.get('content-type') || '';
    if (type.indexOf('json') === -1) return;

    response.clone().json().then(function (body) {
      if (body && body.code === 'mfa-required') {
        location.assign(body.redirect || '/auth/required-authenticator');
      }
    }).catch(function () {});
  }

  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (response.status === 401 && !signingOut()) {
        var returnTo = location.pathname + location.search;
        location.assign('/auth/login?return=' + encodeURIComponent(returnTo));
      }
      if (response.status === 403 && !signingOut()) {
        redirectIfMfaRequired(response);
      }
      return response;
    });
  };
})();
