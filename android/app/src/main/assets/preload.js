/*
 * TMA Portal — Android preload (the twin of desktop/preload.js).
 *
 * Runs before the page's own scripts. Exposes the same TMADesktop object the
 * Electron shell exposes, relays the <html> attributes the page writes for its
 * host (badge, call phase, overlay, theme, focus, sign-in reopen/cancel) to the
 * Kotlin side, and gives the page a window.Notification that lands in the
 * Android notification shade, since a WebView has none of its own.
 */
(function () {
  if (window.__tmaAndroidPreload) return;
  window.__tmaAndroidPreload = true;
  var host = window.TMAAndroidHost;
  function send(channel, value) {
    try { if (host && host.relay) host.relay(channel, value == null ? '' : String(value)); } catch (e) { /* host gone */ }
  }

  window.TMADesktop = {
    isDesktop: true,
    isAndroid: true,
    platform: 'android',
    version: host && host.version ? host.version() : '',
    openInBrowser: function (url) {
      if (typeof url !== 'string') return;
      try { host.openInBrowser(url); } catch (e) { /* ignore */ }
    },
  };

  var RELAYS = [
    { attribute: 'data-tma-badge', channel: 'badge', read: function (raw) { var n = raw == null ? 0 : parseInt(raw, 10); return isFinite(n) ? n : 0; } },
    { attribute: 'data-tma-call', channel: 'call', read: function (raw) { return raw || ''; } },
    { attribute: 'data-tma-overlay', channel: 'overlay', read: function (raw) { return raw === '1' ? '1' : '0'; } },
    { attribute: 'data-theme', channel: 'theme', read: function (raw) { return raw === 'dark' ? 'dark' : 'light'; } },
    { attribute: 'data-tma-focus', channel: 'focus', read: function () { return '1'; }, skipInitial: true },
    { attribute: 'data-tma-signin-reopen', channel: 'signin-reopen', read: function () { return '1'; }, skipInitial: true },
    { attribute: 'data-tma-signin-cancel', channel: 'signin-cancel', read: function () { return '1'; }, skipInitial: true },
  ];
  function watchHostAttributes() {
    var el = document.documentElement;
    if (!el) return;
    RELAYS.forEach(function (relay) {
      var fire = function () { send(relay.channel, relay.read(el.getAttribute(relay.attribute))); };
      new MutationObserver(fire).observe(el, { attributes: true, attributeFilter: [relay.attribute] });
      if (!relay.skipInitial) fire();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchHostAttributes, { once: true });
  else watchHostAttributes();

  /* window.Notification, backed by the Android shade. Clicks come back through
     __tmaNotificationClick(id) and land on the instance's onclick, the way the
     page's own handlers expect (notify-store.js, messaging-calls.js). */
  var live = {};
  var nextId = 1;
  function AndroidNotification(title, options) {
    options = options || {};
    this.title = String(title || '');
    this.body = options.body == null ? '' : String(options.body);
    this.tag = options.tag == null ? '' : String(options.tag);
    this.data = options.data;
    this.silent = !!options.silent;
    this.onclick = null;
    this.onclose = null;
    this.__id = nextId++;
    live[this.__id] = this;
    var url = '';
    try { url = options.data && options.data.url ? String(options.data.url) : ''; } catch (e) { /* ignore */ }
    try { host.notify(JSON.stringify({ id: this.__id, title: this.title, body: this.body, tag: this.tag, silent: this.silent, url: url, icon: options.icon || '' })); } catch (e) { /* ignore */ }
  }
  AndroidNotification.permission = host && host.notificationsAllowed && host.notificationsAllowed() ? 'granted' : 'default';
  AndroidNotification.requestPermission = function (cb) {
    var p = new Promise(function (resolve) {
      try { host.requestNotifications(); } catch (e) { /* ignore */ }
      AndroidNotification.permission = host && host.notificationsAllowed && host.notificationsAllowed() ? 'granted' : 'denied';
      resolve(AndroidNotification.permission);
    });
    if (typeof cb === 'function') p.then(cb);
    return p;
  };
  AndroidNotification.prototype.close = function () {
    try { host.closeNotification(this.__id); } catch (e) { /* ignore */ }
    delete live[this.__id];
    if (typeof this.onclose === 'function') { try { this.onclose(); } catch (e) { /* ignore */ } }
  };
  AndroidNotification.prototype.addEventListener = function (type, fn) { if (type === 'click') this.onclick = fn; if (type === 'close') this.onclose = fn; };
  window.__tmaNotificationClick = function (id) {
    var n = live[id];
    if (!n) return false;
    if (typeof n.onclick === 'function') { try { n.onclick({ type: 'click', target: n, preventDefault: function () {} }); } catch (e) { /* ignore */ } }
    delete live[id];
    return true;
  };
  window.__tmaNotificationPermission = function (granted) { AndroidNotification.permission = granted ? 'granted' : 'denied'; };
  window.Notification = AndroidNotification;
})();
