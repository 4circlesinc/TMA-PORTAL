/*
 * Injected into the portal page, in the page's own world.
 *
 * The shell needs things the page knows and it does not: how many items are
 * waiting, and when the page wants the app brought forward. Preload runs in an
 * isolated world — it shares the DOM but not page globals — so everything
 * crosses on attributes of <html>, which are plain strings on a node both
 * worlds see. preload.js relays them; main.js acts on them.
 *
 * Call state arrives the same way but is published by messaging-calls.js
 * itself (data-tma-call), since only it knows when a call is ringing.
 *
 * Runs in the page, so it stays ES5 like the portal's other scripts.
 */
module.exports = `(function () {
  if (window.__tmaHostBridge) return;
  window.__tmaHostBridge = true;

  var el = document.documentElement;

  /* ---- badge: unread notifications + new activity ---- */

  function publishBadge() {
    var n = 0;
    var notif = window.TMANotifications;
    var acts = window.TMAActivities;
    if (notif && notif.state) n += notif.state.unread || 0;
    if (acts && acts.state) n += acts.state.newCount || 0;
    if (el.getAttribute('data-tma-badge') !== String(n)) {
      el.setAttribute('data-tma-badge', String(n));
    }
  }

  function bindBadge() {
    var notif = window.TMANotifications;
    var acts = window.TMAActivities;
    if (!notif || !acts) return false;

    notif.subscribe(publishBadge);
    acts.subscribe(publishBadge);
    notif.refreshCount();
    acts.refreshCount();
    publishBadge();

    // The page's own poll stands down on document.hidden, which is exactly
    // when a dock badge matters most — so keep our own beat going.
    window.setInterval(function () {
      notif.refreshCount();
      acts.refreshCount();
    }, 45000);

    return true;
  }

  publishBadge(); // clears the badge on signed-out pages, where no store exists

  if (!bindBadge()) {
    var tries = 0;
    var timer = window.setInterval(function () {
      if (bindBadge() || ++tries > 40) window.clearInterval(timer);
    }, 250);
  }

  /* ---- focus requests ----
   *
   * Both the notification store and the call module already call
   * window.focus() when the user acts on an OS notification. In a browser tab
   * that raises the window; in Electron the renderer cannot activate the app,
   * so mirror every call onto an attribute the main process can act on. The
   * native call still runs, so behaviour in a browser is unchanged.
   */
  var nativeFocus = window.focus.bind(window);
  window.focus = function () {
    try { el.setAttribute('data-tma-focus', String(Date.now())); } catch (e) { /* ignore */ }
    return nativeFocus();
  };
})();`;
