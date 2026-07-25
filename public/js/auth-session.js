/*
 * On API 401, send the user to sign-in and bring them back afterward.
 * Global: wraps window.fetch for same-origin portal pages.
 */
(function () {
  'use strict';

  if (typeof window.fetch !== 'function') return;
  if (/^\/auth\//.test(location.pathname)) return;

  var nativeFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (response.status === 401) {
        var returnTo = location.pathname + location.search;
        location.assign('/auth/login?return=' + encodeURIComponent(returnTo));
      }
      return response;
    });
  };
})();
