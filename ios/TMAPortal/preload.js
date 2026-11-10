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
  // The iPhone app's look (liquid-glass bar and header, dashboard-tma-overrides.css),
  // set before the first paint so the page never flashes the plain dock.
  try { document.documentElement.classList.add('tma-ios'); } catch (e) { /* no document yet */ }

  // Typing in a box never zooms the page in, the way it doesn't in an app:
  // iOS zooms on a field whose text is under 16pt unless the scale is capped.
  // Every page, sign-in included, as soon as its viewport tag exists.
  function capZoom(loaded) {
    var tag = document.querySelector('meta[name="viewport"]');
    if (!tag) {
      // Only once the page is in: one added earlier would be followed by the
      // page's own, which would win.
      if (!loaded || !document.head) return false;
      tag = document.createElement('meta');
      tag.name = 'viewport';
      tag.content = 'width=device-width, initial-scale=1';
      document.head.appendChild(tag);
    }
    if (!/maximum-scale/.test(tag.content || '')) tag.content = (tag.content || '') + ', maximum-scale=1';
    return true;
  }
  if (!capZoom(false)) document.addEventListener('DOMContentLoaded', function () { capZoom(true); }, { once: true });
  var notificationsAllowed = __TMA_NOTIFICATIONS__;

  var fileCalls = 0;
  var fileCallbacks = {};
  window.__tmaFileStore = {
    progress: function (call, index, ok) {
      var c = fileCallbacks[call];
      if (c && typeof c.each === 'function') {
        try { c.each(index, ok); } catch (e) { /* the page's own */ }
      }
    },
    done: function (call) {
      var c = fileCallbacks[call];
      delete fileCallbacks[call];
      if (c && typeof c.done === 'function') {
        try { c.done(); } catch (e) { /* the page's own */ }
      }
    },
  };

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
    /*
     * Documents kept on the phone (FileStore.swift). keepFiles downloads the
     * ones missing or changed in the app's own session, telling onEach(i, ok)
     * as each one lands and onDone() at the end (offline-download.js);
     * readKeptFile gives a kept one back, as a Blob (or null), when nothing
     * answers for it (offline-fetch.js, offline-pictures.js).
     */
    keepFiles: function (files, onEach, onDone) {
      var call = 'files-' + (++fileCalls);
      fileCallbacks[call] = { each: onEach, done: onDone };
      post('keepFiles', { call: call, files: Array.isArray(files) ? files : [] });
    },
    readKeptFile: function (path) {
      var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tmaFiles;
      if (!handler) return Promise.resolve(null);
      try {
        return handler.postMessage({ path: String(path) }).then(function (reply) {
          if (!reply || !reply.data) return null;
          // Decoded here: WebKit will not fetch a data: address for this page.
          var raw = atob(reply.data);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          return new Blob([bytes], { type: reply.type || 'application/octet-stream' });
        }).catch(function () { return null; });
      } catch (e) {
        return Promise.resolve(null);
      }
    },
    clearFiles: function () {
      post('clearFiles');
    },
    openLocationSettings: function () {
      post('openLocationSettings');
    },
    // The page's short tones, played natively as system sounds (PageTone.swift).
    // Page audio is media to iOS: a one-second chime put up the Now Playing
    // panel and could pause music. True when the app played it, so the page
    // only falls back to its own audio for a tone this build does not carry.
    playTone: function (name) {
      if (['chime', 'system', 'sent', 'beep'].indexOf(name) === -1) return false;
      post('tone', { name: name });
      return true;
    },
    // Whether a drag from the left edge is back (a screen is open inside the
    // page) or opens the menu (a page of its own). phone-screens.js says.
    setEdgeBack: function (on) {
      post('edgeBack', { on: !!on });
    },
    // The Taptic Engine's knock for a hold that opens a menu or a swipe that
    // reaches its point (navigator.vibrate does nothing on an iPhone).
    haptic: function (style) {
      post('haptic', { style: String(style || 'light') });
    },
    // iOS 26 and later: the app draws the bottom bar and the header's bubbles
    // in the system's Liquid Glass (GlassChrome.swift), which follows the
    // device's Liquid Glass and accessibility settings. glass-chrome.js tells
    // it what they hold, through setGlassChrome.
    glassChrome: __TMA_GLASS__,
    setGlassChrome: function (json) {
      post('glass', { json: String(json) });
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
    // "chime" (the TM tone, the default) or "default" (the Apple tone); the
    // page's notify-store passes the person's choice from Settings.
    this.sound = typeof options.sound === 'string' && options.sound ? options.sound : 'chime';
    this.onclick = null;
    this.onclose = null;
    this.__id = nextId++;
    live[this.__id] = this;
    var url = '';
    try { url = options.data && options.data.url ? String(options.data.url) : ''; } catch (e) { /* ignore */ }
    // subtitle and text are notify-store's layout (not part of the web API):
    // the app draws them as a message, under the picture in icon.
    post('notify', { json: JSON.stringify({
      id: this.__id, title: this.title, body: this.body, tag: this.tag, silent: this.silent, sound: this.sound, url: url,
      icon: options.icon || '',
      subtitle: typeof options.subtitle === 'string' ? options.subtitle : '',
      text: typeof options.text === 'string' ? options.text : this.body,
    }) });
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
