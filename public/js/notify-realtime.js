/*
 * TMA - Notification realtime (§24, §25).
 *
 * Rides the same Reverb websocket the messaging page uses. It listens on the
 * signed-in user's own private channel for `notification.created` and applies
 * the new item to the shared store, so the bell badge, the header popup, and
 * the right sidebar all update live, smoothly appended, never a full refetch
 * or a reset scroll.
 *
 * Degrades quietly: with no websocket configured (or Reverb unreachable) the
 * portal falls back to the count-poll / wake catch-up in notify-store.js.
 *
 * Global: window.TMANotifyRealtime
 */
(function () {
  'use strict';

  var started = false;
  var channel = null;

  function apply(payload) {
    if (!payload) return;
    try {
      if (window.TMANotifications && payload.notification) {
        window.TMANotifications.applyRealtime(payload.notification, payload.unread);
      }
      var root = document.querySelector('.tma-dash');
      if (root && root._syncTabBarBadges) root._syncTabBarBadges();
    } catch (e) { /* a bad payload must not break the socket loop */ }
  }

  function bindChannel(rt, userId) {
    channel = 'private-App.Models.User.' + userId;
    rt.listen(channel, 'notification.created', apply);
  }

  function start() {
    if (started) return;
    started = true;

    fetch((window.__TMA_SITE_ROOT || '') + '/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me || !me.id) return;
        var rt = window.TMAMessagingRealtime;
        var cfg = me.realtime;
        // No socket configured → rely on loads/polls, not this.
        if (!rt || !cfg || !cfg.enabled) return;
        if (!rt.start(cfg)) return;
        bindChannel(rt, me.id);

        // After a reconnect, re-listen is already covered by channel registry;
        // still catch up HTTP so anything missed while the socket was dead
        // surfaces as toasts / badge updates.
        if (rt.onState) {
          rt.onState(function (state) {
            if (state === 'connected' && window.TMANotifications && window.TMANotifications.catchUp) {
              window.TMANotifications.catchUp({ forceLoad: true });
            }
          });
        }
      })
      .catch(function () {});
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.TMANotifyRealtime = { start: start };
})();
