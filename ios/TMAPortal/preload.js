/*
 * TMA Portal — iOS preload (the twin of desktop/preload.js and the Android preload).
 *
 * Runs before the page's own scripts. Exposes the same TMADesktop object the
 * Electron shell exposes, relays the <html> attributes the page writes for its
 * host, and gives the page a window.Notification that lands in Notification
 * Center, since a WKWebView has none of its own.
 *
 * This file is not a PWA. The native app injects it.
 */
(function () {
  if (window.__tmaIOSPreload) return;
  window.__tmaIOSPreload = true;
  var notificationsAllowed = __TMA_NOTIFICATIONS__;

  function post(op, extra) {
    try {
      var body = extra || {};
      body.op = op;
      window.webkit.messageHandlers.tmaHost.postMessage(body);
    } catch (e) { /* host gone */ }
  }

  window.TMADesktop = {
    isDesktop: true,
    isIOS: true,
    platform: 'ios',
    // The App Store (and TestFlight) is the only way this app is installed.
    // The page keeps offers of other builds out of it.
    store: 'app-store',
    version: '__TMA_VERSION__',
    pushEnabled: false,
    openInBrowser: function (url) {
      if (typeof url !== 'string') return;
      post('openInBrowser', { url: url });
    },
    openLocationSettings: function () {
      post('openLocationSettings');
    },
  };

  /*
   * Location through the app (LocationBridge.swift), not the web view. A web
   * view asks "Allow portal.tmantoinelaw.com to use your current location?"
   * on every launch and never keeps the answer; the app's own permission is
   * asked once and kept by iOS (Settings > TM ANTOINE Portal > Location).
   * Same shapes as the web API, so presence-status.js needs no changes.
   */
  (function () {
    var pending = {};
    var seq = 0;
    var geoState = '__TMA_GEO_STATE__';
    var statuses = [];

    function positionError(code, message) {
      return { code: code, message: message || '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
    }
    function position(p) {
      return {
        coords: {
          latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy,
          altitude: p.altitude, altitudeAccuracy: p.altitudeAccuracy, heading: p.heading, speed: p.speed
        },
        timestamp: p.timestamp
      };
    }

    window.__tmaGeo = {
      resolve: function (id, p) {
        var req = pending[id];
        if (!req) return;
        if (!req.watch) delete pending[id];
        try { req.ok(position(p)); } catch (e) {}
      },
      reject: function (id, code, message) {
        var req = pending[id];
        if (!req) return;
        if (!req.watch) delete pending[id];
        if (typeof req.fail === 'function') { try { req.fail(positionError(code, message)); } catch (e) {} }
      },
      state: function (next) {
        if (next === geoState) return;
        geoState = next;
        statuses.forEach(function (status) {
          status.state = next;
          if (typeof status.onchange === 'function') { try { status.onchange(); } catch (e) {} }
        });
      }
    };

    function ask(ok, fail, options, watch) {
      var id = ++seq;
      var o = options || {};
      pending[id] = { ok: ok, fail: fail, watch: watch };
      post(watch ? 'geoWatch' : 'geoGet', {
        id: id,
        highAccuracy: !!o.enableHighAccuracy,
        timeout: typeof o.timeout === 'number' && isFinite(o.timeout) ? o.timeout : 0,
        maximumAge: typeof o.maximumAge === 'number' && isFinite(o.maximumAge) ? o.maximumAge : 0
      });
      return id;
    }

    var geolocation = {
      getCurrentPosition: function (ok, fail, options) {
        if (typeof ok === 'function') ask(ok, fail, options, false);
      },
      watchPosition: function (ok, fail, options) {
        return typeof ok === 'function' ? ask(ok, fail, options, true) : 0;
      },
      clearWatch: function (id) {
        if (!pending[id]) return;
        delete pending[id];
        post('geoClear', { id: id });
      }
    };
    try { Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true }); } catch (e) {}

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      var query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (descriptor) {
        if (descriptor && descriptor.name === 'geolocation') {
          var status = { name: 'geolocation', state: geoState, onchange: null };
          status.addEventListener = function (type, fn) { if (type === 'change') status.onchange = fn; };
          status.removeEventListener = function (type, fn) { if (type === 'change' && status.onchange === fn) status.onchange = null; };
          statuses.push(status);
          return Promise.resolve(status);
        }
        return query(descriptor);
      };
    }
  })();

  var RELAYS = [
    { attribute: 'data-tma-badge', channel: 'badge', read: function (raw) { var n = raw == null ? 0 : parseInt(raw, 10); return isFinite(n) ? n : 0; } },
    { attribute: 'data-tma-call-info', channel: 'call-info', read: function (raw) { return raw || ''; } },
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
      var fire = function () { post('relay', { channel: relay.channel, value: String(relay.read(el.getAttribute(relay.attribute))) }); };
      new MutationObserver(fire).observe(el, { attributes: true, attributeFilter: [relay.attribute] });
      if (!relay.skipInitial) fire();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchHostAttributes, { once: true });
  else watchHostAttributes();

  // Tells the app the page's content is in, so the boot splash can lift
  // without waiting for every image (SplashGate.swift).
  function ready() { post('ready'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();

  var live = {};
  var nextId = 1;
  function IOSNotification(title, options) {
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
    var sound = typeof options.sound === 'string' ? options.sound : 'default';
    post('notify', { json: JSON.stringify({ id: this.__id, title: this.title, body: this.body, tag: this.tag, silent: this.silent, sound: sound, url: url, icon: options.icon || '' }) });
  }
  IOSNotification.permission = notificationsAllowed ? 'granted' : 'default';
  IOSNotification.requestPermission = function (cb) {
    var p = new Promise(function (resolve) {
      post('requestNotifications');
      resolve(IOSNotification.permission);
    });
    if (typeof cb === 'function') p.then(cb);
    return p;
  };
  IOSNotification.prototype.close = function () {
    post('closeNotification', { id: this.__id });
    delete live[this.__id];
    if (typeof this.onclose === 'function') { try { this.onclose(); } catch (e) { /* ignore */ } }
  };
  IOSNotification.prototype.addEventListener = function (type, fn) { if (type === 'click') this.onclick = fn; if (type === 'close') this.onclose = fn; };
  window.__tmaNotificationClick = function (id) {
    var n = live[id];
    if (!n) return false;
    if (typeof n.onclick === 'function') { try { n.onclick({ type: 'click', target: n, preventDefault: function () {} }); } catch (e) { /* ignore */ } }
    delete live[id];
    return true;
  };
  window.__tmaNotificationPermission = function (granted) {
    notificationsAllowed = !!granted;
    IOSNotification.permission = granted ? 'granted' : 'denied';
  };
  window.Notification = IOSNotification;
})();
