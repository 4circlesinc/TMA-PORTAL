(function () {
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

  /* ---- notification permission ----
   *
   * The app has its own permission store, separate from any browser, and the
   * portal only ever asks from the settings toggle — so a user who turned
   * notifications on in Safari months ago still lands here at "default", and
   * every banner is dropped silently. Ask on load; the shell approves it
   * without a prompt, so nothing is shown to the user.
   */
  if (typeof window.Notification === 'function' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) { /* ignore */ }
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
})();
