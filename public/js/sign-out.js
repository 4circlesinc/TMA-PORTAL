/*
 * Sign-out for the portal shell: POST /auth/logout, then leave for login.
 *
 * Wire any element with data-action="sign-out". Capture-phase so other click
 * handlers (SPA nav, settings) cannot turn the click into a soft refresh.
 *
 * A failed logout that still navigated to /auth/login used to bounce the
 * still-authenticated reader straight back into the portal, that is the
 * "it just refreshed" bug, especially visible on Account settings.
 */
(function () {
  'use strict';

  var WIPE_MS = 1500;
  var PENDING = 'tma.wipe-pending';
  var FLAG = 'tma.signing-out';
  var leaving = false;

  function forget() {
    try { localStorage.removeItem('tma.me'); } catch (e) { /* nothing kept */ }
  }

  function markLeaving() {
    window.__TMA_SIGNING_OUT = true;
    try { sessionStorage.setItem(FLAG, '1'); } catch (e) { /* private mode */ }
  }

  function wipe() {
    if (!window.TMAStore || !window.TMAStore.clear) return Promise.resolve();

    try { localStorage.setItem(PENDING, '1'); } catch (e) { /* best effort */ }

    var done = Promise.resolve(window.TMAStore.clear())
      .then(function () {
        try { localStorage.removeItem(PENDING); } catch (e) { /* best effort */ }
      })
      .catch(function () {});

    return Promise.race([
      done,
      new Promise(function (resolve) { setTimeout(resolve, WIPE_MS); }),
    ]);
  }

  function cookieToken() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function csrf() {
    if (typeof window.TMACsrfToken === 'string' && window.TMACsrfToken) {
      return window.TMACsrfToken;
    }
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    return cookieToken();
  }

  function postFetch() {
    return fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
      headers: {
        'Accept': 'application/json',
        'X-XSRF-TOKEN': cookieToken() || csrf(),
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrf(),
      },
    });
  }

  function ok(res) {
    if (!res) return false;
    // redirect:manual → opaqueredirect on 302; Fortify also returns 204/200 JSON.
    if (res.type === 'opaqueredirect') return true;
    return res.status === 200 || res.status === 204 || res.status === 302;
  }

  function formFallback() {
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    form.style.display = 'none';

    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_token';
    input.value = csrf();
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
  }

  function goLogin() {
    // Keep the signing-out flag until the login page loads. Clearing it here
    // left a window where a 401 from /me could still append return=/settings.
    // Auth layout drops the flag so the next portal visit does not sign out.
    window.location.replace('/auth/login?from=logout');
  }

  function signOut() {
    return postFetch()
      .then(function (res) {
        if (res && res.status === 419) return postFetch();
        return res;
      })
      .catch(function () { return null; });
  }

  function run() {
    if (leaving) return;
    leaving = true;
    markLeaving();
    forget();

    Promise.all([wipe(), signOut()]).then(function (parts) {
      var res = parts[1];
      if (ok(res)) {
        goLogin();
        return;
      }
      // Last resort: full form POST (browser navigates with the session cookie).
      formFallback();
    });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('[data-action="sign-out"]');
    if (!btn) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

    try {
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-disabled', 'true');
    } catch (e) { /* decoration only */ }

    run();
  }, true);

  // Mid-sign-out reload: finish leaving instead of painting the portal again.
  try {
    if (sessionStorage.getItem(FLAG)) {
      markLeaving();
      forget();
      signOut().then(function (res) {
        if (ok(res)) goLogin();
        else formFallback();
      });
    }
  } catch (e) { /* no storage */ }

  try {
    if (localStorage.getItem(PENDING) && window.TMAStore && window.TMAStore.clear) {
      Promise.resolve(window.TMAStore.clear()).then(function () {
        try { localStorage.removeItem(PENDING); } catch (e) { /* best effort */ }
      }).catch(function () {});
    }
  } catch (e) { /* no storage */ }
})();
