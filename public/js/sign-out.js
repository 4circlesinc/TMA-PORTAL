/*
 * Sign-out for static portal shells: POSTs to Fortify's logout endpoint
 * using the XSRF cookie (no server-rendered form needed on static pages).
 * Wire any element with data-action="sign-out".
 *
 * It was reported as needing two clicks — the first one "just refreshing the
 * page". Everything below is about making one click final:
 *
 *   - The listener is on the *capture* phase, so it runs before anything else
 *     on the page can act on the same click, and it stops the event dead. A
 *     document-level bubbling listener is the last to hear a click, not the
 *     first, so every other handler between the button and here had already
 *     run by the time sign-out started.
 *   - The page is flagged as leaving. portal-live.js reloads the page by
 *     itself when /me comes back with a different capability set — and a
 *     session that has just been destroyed is exactly a different capability
 *     set, so a poller landing mid-sign-out reloaded the page out from under
 *     this and the click looked like it had only refreshed.
 *   - Nothing unbounded is awaited before leaving. The cache wipe used to be,
 *     and IndexedDB is not obliged to answer: a wipe that never settles was a
 *     click that never went anywhere.
 *   - A second click while one is in flight is ignored rather than starting
 *     another.
 */
(function () {
  'use strict';

  /* Long enough for a real wipe, short enough that nobody waits on a broken
     one. Whatever is left is finished on the next boot — see the marker. */
  var WIPE_MS = 1500;

  /* Set while a wipe is outstanding, so a sign-out that had to leave before
     the cache was empty is finished the next time the app starts rather than
     leaving one reader's cached pages for the next one. */
  var PENDING = 'tma.wipe-pending';

  var leaving = false;

  function forget() {
    try { localStorage.removeItem('tma.me'); } catch (e) { /* nothing kept */ }
  }

  /**
   * Everything this browser holds about the reader who is leaving.
   *
   * portal-store.js always described clear() as "what signing out runs", but
   * for a long time nothing ran it: on a desktop the previous reader's cache
   * outlived their session, saved only by setAccount wiping on the NEXT
   * sign-in.
   */
  function wipe() {
    if (!window.TMAStore || !window.TMAStore.clear) return Promise.resolve();

    try { localStorage.setItem(PENDING, '1'); } catch (e) { /* best effort */ }

    var done = Promise.resolve(window.TMAStore.clear())
      .then(function () {
        try { localStorage.removeItem(PENDING); } catch (e) { /* best effort */ }
      })
      .catch(function () {});

    // Raced, not awaited. A wipe that never settles must not become a
    // sign-out that never happens.
    return Promise.race([
      done,
      new Promise(function (resolve) { setTimeout(resolve, WIPE_MS); }),
    ]);
  }

  function token() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    return m ? decodeURIComponent(m[1]) : '';
  }

  function post() {
    return fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-XSRF-TOKEN': token(),
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
  }

  /**
   * The POST, and one retry.
   *
   * A rejected or refused logout used to be swallowed whole, and the page then
   * navigated to /auth/login with the session still alive — which the server
   * answers by sending the reader straight back to the portal. That is the
   * "it just refreshed" symptom exactly, and it is also why a second click
   * worked: the round trip in between had left a usable token behind.
   *
   * 419 is the one worth retrying: the token travelled and was stale. The
   * response carries a fresh XSRF cookie, so simply asking again works.
   */
  function signOut() {
    return post()
      .then(function (res) {
        if (res.status !== 419) return res;

        return post();
      })
      .catch(function () { return null; });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('[data-action="sign-out"]');
    if (!btn) return;

    ev.preventDefault();
    // Capture phase: nothing else on the page gets to see this click at all.
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

    if (leaving) return;
    leaving = true;

    /* Read by portal-live.js, which otherwise reloads the page the moment /me
       reports the capabilities of a session that no longer exists. */
    window.__TMA_SIGNING_OUT = true;

    try {
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-disabled', 'true');
    } catch (e) { /* decoration only */ }

    forget();

    Promise.all([wipe(), signOut()]).then(function () {
      // replace(), not href: the portal must not be one Back press away from a
      // reader who has just left it.
      window.location.replace('/auth/login');
    });
  }, true);

  /* Finish a wipe that had to be cut short last time. Cheap when there is
     nothing to do — the marker is only ever set by a sign-out. */
  try {
    if (localStorage.getItem(PENDING) && window.TMAStore && window.TMAStore.clear) {
      Promise.resolve(window.TMAStore.clear()).then(function () {
        try { localStorage.removeItem(PENDING); } catch (e) { /* best effort */ }
      }).catch(function () {});
    }
  } catch (e) { /* no storage, nothing pending */ }
})();
