/*
 * TMA - Realtime transport for the Messages page.
 *
 * Speaks the Pusher wire protocol to Laravel Reverb directly over a WebSocket.
 * Written by hand rather than pulling in laravel-echo + pusher-js because the
 * portal's scripts are plain files under public/js with no bundling step, and
 * the slice of the protocol needed here is small: connect, authorise a private
 * channel, subscribe, receive events, answer pings.
 *
 * Reconnects with backoff, and re-subscribes everything it had on the way back
 * up, so a laptop waking from sleep lands in the same channels it left.
 *
 * Global: window.TMAMessagingRealtime
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var PROTOCOL = 7;
  var CLIENT = 'tma-portal';
  var VERSION = '1.0';

  /* Backoff between reconnect attempts, in ms. Caps out at 30s. */
  var RETRY_BASE = 1000;
  var RETRY_MAX = 30000;

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* A socket that still says "connected" but has been silent this long is
     treated as a zombie (laptop sleep / background tab) and force-reopened. */
  var STALE_MS = 90000;

  /*
   * Silence alone does not mean a dead socket. The server speaks to an idle
   * connection only once it has heard nothing from it for a minute, checked
   * once a minute, so a healthy one can be silent for up to two: past
   * STALE_MS a good part of the time. Read as death, that reopened working
   * sockets every few minutes. So a quiet socket is asked (pusher:ping,
   * answered with pusher:pong) before it goes stale, and a stale one is
   * asked once more and only reopened if nothing answers.
   */
  var PROBE_AFTER_MS = 40000;
  var PROBE_WAIT_MS = 5000;

  /*
   * A subscription the server has not confirmed this long after it was sent
   * is taken as lost and asked for again. The server confirms the ones it
   * accepts and says nothing that names the channel about one it drops (a
   * rate-limited frame is answered with a bare pusher:error), so silence is
   * the only sign there is. Retries back off, up to a minute apart.
   */
  var SUBSCRIBE_CONFIRM_MS = 8000;
  var SUBSCRIBE_RETRY_BASE = 2000;
  var SUBSCRIBE_RETRY_MAX = 60000;
  var AUTHORIZE_TIMEOUT_MS = 20000;

  /* Sign-off answers that are answers: asking again gets the same one. */
  var REFUSED = { 401: true, 403: true, 404: true, 419: true };

  /* How long a tab turned away by a full cluster waits before asking again. */
  var QUOTA_RETRY_MS = 5 * 60 * 1000;

  /*
   * Idle-tab parking. The WebSocket cluster admits a limited number of
   * connections, and every open tab holds one, so a user with three portal
   * tabs spends three slots to hear each doorbell once. A tab hidden this
   * long hands its socket back, provided another tab of the same browser
   * still holds one - notifications must always have somewhere to arrive.
   * Timers in hidden tabs are throttled to once a minute, so every window
   * here is generous and peer freshness rides the socket's own pings.
   */
  var PARK_AFTER_MS = 5 * 60 * 1000;
  var PARK_CHECK_MS = 30000;
  var HEARTBEAT_MS = 20000;
  var PEER_FRESH_MS = 150000;

  function Realtime() {
    this.config = null;
    this.socket = null;
    this.socketId = null;
    // name -> { handlers: {event: [fn]}, subscribed, pending, attempts, ticket, timer, auth }
    this.channels = {};
    // Channels confirmed since the last 'subscribed' state went out.
    this._confirmed = [];
    this.retries = 0;
    this.retryTimer = null;
    this.probeTimer = null;
    this.quotaTimer = null;
    this.connected = false;
    this.stateHandlers = [];
    this.closedByUs = false;
    this.lastMessageAt = 0;
    this._wakeBound = false;

    /* Idle-tab parking state. */
    this.parked = false;
    this._tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this._peers = {};
    this._bc = null;
    this._coordBound = false;
    this._hiddenAt = document.hidden ? Date.now() : null;
    this._lastBeat = 0;
  }

  Realtime.prototype.start = function (config) {
    if (!config || !config.enabled || !config.key) return false;
    // Reconnecting with the same config is a no-op; a changed one restarts.
    if (this.socket && this.config && this.config.key === config.key) {
      this.bindWakeHandlers();
      return true;
    }

    this.config = config;
    this.closedByUs = false;
    this.open();
    this.bindWakeHandlers();
    this.bindTabCoordination();
    return true;
  };

  /* Tear down a zombie/dead socket and open a fresh one, keeping channel
     registrations so resubscribeAll() re-auths them on connect. */
  Realtime.prototype.reconnect = function () {
    if (!this.config || this.closedByUs) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retries = 0;
    // open() lets the old socket go and starts the new one from nothing.
    this.open();
  };

  /*
   * Let go of the socket in use. Its handlers compare themselves against
   * this.socket, so from here on nothing it does is heard: a socket that has
   * been replaced must not be able to speak for the connection.
   */
  Realtime.prototype.release = function () {
    var old = this.socket;
    this.socket = null;
    if (old) {
      try { old.close(); } catch (e) { /* ignore */ }
    }
  };

  /* A new socket starts with no subscriptions, and no answer still in flight
     for the old one counts towards it. */
  Realtime.prototype.dropSubscriptions = function () {
    var self = this;
    Object.keys(this.channels).forEach(function (name) {
      var entry = self.channels[name];
      entry.subscribed = false;
      entry.pending = false;
      entry.attempts = 0;
      entry.ticket += 1;
      entry.auth = null;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    });
    this._confirmed = [];
  };

  Realtime.prototype.isHealthy = function () {
    if (!this.connected || !this.socketId || !this.socket) return false;
    if (this.socket.readyState !== 1) return false;
    if (!this.lastMessageAt) return true;
    return (Date.now() - this.lastMessageAt) < STALE_MS;
  };

  Realtime.prototype.ensureAlive = function () {
    if (!this.config || this.closedByUs) return;
    if (this.parked) {
      this.unpark();
      return;
    }
    if (this.isHealthy()) {
      // Quiet, not yet stale: ask before it is, so that silence past
      // STALE_MS means a dead socket and not merely an idle one.
      if (Date.now() - this.lastMessageAt > PROBE_AFTER_MS) this.send({ event: 'pusher:ping', data: {} });
      return;
    }
    // Still open but silent too long (a tab that was hidden asks nothing).
    // Ask once, and reconnect only if nothing comes back.
    if (this.connected && this.socket && this.socket.readyState === 1) {
      this.probe();
      return;
    }
    this.reconnect();
  };

  Realtime.prototype.probe = function () {
    var self = this;
    if (this.probeTimer) return;

    var socket = this.socket;
    var asked = Date.now();
    this.send({ event: 'pusher:ping', data: {} });

    this.probeTimer = setTimeout(function () {
      self.probeTimer = null;
      // Replaced in the meantime, or it answered.
      if (self.socket !== socket || self.lastMessageAt >= asked) return;
      self.reconnect();
    }, PROBE_WAIT_MS);
  };

  Realtime.prototype.bindWakeHandlers = function () {
    if (this._wakeBound) return;
    this._wakeBound = true;
    var self = this;
    function onWake() {
      if (document.hidden) return;
      self.ensureAlive();
    }
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    // Visible idle tabs can keep a half-open socket that never fires
    // close/visibility events, poke health on a timer too.
    if (!this._healthTimer) {
      this._healthTimer = window.setInterval(function () {
        if (document.hidden) return;
        self.ensureAlive();
      }, 30000);
    }
  };

  /*
   * Cross-tab coordination for parking. Tabs of the same browser announce
   * themselves on a BroadcastChannel; a hidden tab only parks while a peer
   * is connected, and a parked tab takes the socket back if the last
   * connected peer disappears, so the browser as a whole never goes deaf.
   *
   * Among several hidden connected tabs the highest tab id keeps the socket
   * (a visible peer counts for everyone): without a tie-break two hidden
   * tabs each see the other connected, both park, both notice the silence,
   * both reconnect, and the pair oscillates forever.
   */
  Realtime.prototype.bindTabCoordination = function () {
    if (this._coordBound || typeof BroadcastChannel === 'undefined') return;
    this._coordBound = true;
    var self = this;

    try {
      this._bc = new BroadcastChannel('tma-realtime-tabs');
    } catch (err) {
      return;
    }

    this._bc.addEventListener('message', function (e) {
      var msg = e.data;
      if (!msg || !msg.id || msg.id === self._tabId) return;
      self._peers[msg.id] = {
        at: Date.now(),
        connected: !!msg.connected,
        visible: !!msg.visible,
      };
    });

    document.addEventListener('visibilitychange', function () {
      self._hiddenAt = document.hidden ? Date.now() : null;
      self.beat();
    });
    window.addEventListener('pagehide', function () {
      // Going away: tell the peers now rather than leaving them to wait out
      // the freshness window before one of them picks the socket back up.
      if (self._bc) {
        try { self._bc.postMessage({ id: self._tabId, connected: false, visible: false }); } catch (err) { /* ignore */ }
      }
    });

    window.setInterval(function () { self.maybeBeat(); }, HEARTBEAT_MS);
    window.setInterval(function () { self.parkCheck(); }, PARK_CHECK_MS);
    this.beat();
  };

  Realtime.prototype.beat = function () {
    if (!this._bc) return;
    this._lastBeat = Date.now();
    try {
      this._bc.postMessage({
        id: this._tabId,
        connected: this.connected && !this.parked,
        visible: !document.hidden,
      });
    } catch (err) { /* ignore */ }
  };

  Realtime.prototype.maybeBeat = function () {
    if (Date.now() - this._lastBeat >= HEARTBEAT_MS) this.beat();
  };

  /** Is some other tab of this browser holding a live socket? */
  Realtime.prototype.freshConnectedPeer = function (ranked) {
    var now = Date.now();
    var self = this;
    return Object.keys(this._peers).some(function (id) {
      var p = self._peers[id];
      if (!p.connected || now - p.at >= PEER_FRESH_MS) return false;
      // Ranked: a hidden peer only counts when it outranks this tab, so
      // exactly one hidden tab elects itself the holder. Visible peers
      // count for everyone; they never park.
      return ranked ? (p.visible || id > self._tabId) : true;
    });
  };

  Realtime.prototype.parkCheck = function () {
    if (!document.hidden) return;

    if (this.parked) {
      // Last-tab duty: the peer that held the socket is gone, take it back
      // even while hidden so notifications still arrive somewhere.
      if (!this.freshConnectedPeer(false)) this.unpark();
      return;
    }

    if (!this.connected || this.closedByUs) return;
    if (!this._hiddenAt || Date.now() - this._hiddenAt < PARK_AFTER_MS) return;
    // Calls signal over this socket, and a call keeps running in a hidden
    // tab (floating window, second monitor). Never park under one.
    if (window.TMAMessagingCalls && window.TMAMessagingCalls.isActive && window.TMAMessagingCalls.isActive()) return;
    if (!this.freshConnectedPeer(true)) return;

    this.park();
  };

  Realtime.prototype.park = function () {
    if (this.parked || this.closedByUs) return;
    this.parked = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.release();
    this.connected = false;
    this.socketId = null;
    this.dropSubscriptions();
    this.beat();
  };

  Realtime.prototype.unpark = function () {
    if (!this.parked) return;
    this.parked = false;
    if (!this.config || this.closedByUs) return;
    this.retries = 0;
    // open() reconnects and resubscribeAll() re-auths every channel; the
    // 'connected' state that follows makes the surfaces refetch what the
    // parked socket never heard.
    this.open();
    this.beat();
  };

  Realtime.prototype.url = function () {
    var c = this.config;
    var scheme = c.scheme === 'https' ? 'wss' : 'ws';
    return (
      scheme + '://' + c.host + ':' + c.port + '/app/' + encodeURIComponent(c.key) +
      '?protocol=' + PROTOCOL + '&client=' + CLIENT + '&version=' + VERSION + '&flash=false'
    );
  };

  Realtime.prototype.open = function () {
    var self = this;

    // Safari logs every WebSocket() attempt while the machine is offline.
    // Wait for the online event (ensureAlive) instead of opening one now.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.scheduleRetry();
      return;
    }

    // Whatever path opens a socket, the tab is no longer parked.
    this.parked = false;

    /*
     * One socket per tab. The one being replaced is closed here and its late
     * events are ignored below. A replaced socket's 'close' used to be heard
     * as the connection dropping: it scheduled a retry that opened a second
     * socket beside the new one, the subscriptions sat on one while pings
     * were answered on the other, and the server cut the unanswered one off
     * a minute later, taking every subscription with it, again and again.
     */
    this.release();
    this.connected = false;
    this.socketId = null;
    this.dropSubscriptions();

    var socket;
    try {
      socket = new WebSocket(this.url());
    } catch (err) {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', function () {
      if (self.socket !== socket) return;
      // Not "connected" yet, that waits for pusher:connection_established,
      // which carries the socket_id every private subscription needs.
      self.retries = 0;
    });

    socket.addEventListener('message', function (e) {
      if (self.socket !== socket) return;
      self.receive(e.data);
    });

    socket.addEventListener('close', function () {
      if (self.socket !== socket) return;
      self.connected = false;
      self.socketId = null;
      self.dropSubscriptions();
      self.emitState('disconnected');
      self.beat();
      if (!self.closedByUs && !self.parked) self.scheduleRetry();
    });

    socket.addEventListener('error', function () {
      // 'close' always follows; retry is scheduled there so it happens once.
    });
  };

  Realtime.prototype.receive = function (raw) {
    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return;
    }

    this.lastMessageAt = Date.now();
    // Hidden tabs throttle timers to once a minute, but socket traffic
    // (Reverb pings included) still arrives: let it drive the heartbeat so
    // a hidden holder stays visibly fresh to its parked peers.
    this.maybeBeat();
    var event = payload.event;

    // Reverb sends event data as a JSON *string*, not a nested object.
    var data = payload.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (err) {
        /* leave as the raw string */
      }
    }

    if (event === 'pusher:connection_established') {
      this.socketId = data && data.socket_id;
      this.connected = true;
      this.lastMessageAt = Date.now();
      this.emitState('connected');
      this.resubscribeAll();
      this.beat();
      return;
    }

    if (event === 'pusher:ping') {
      this.send({ event: 'pusher:pong', data: {} });
      return;
    }

    if (event === 'pusher:error') {
      this.handleProtocolError(data);
      return;
    }

    if (event === 'pusher_internal:subscription_succeeded') {
      var entry = this.channels[payload.channel];
      if (entry) {
        var fresh = !entry.subscribed;
        entry.subscribed = true;
        entry.pending = false;
        entry.attempts = 0;
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        if (fresh) {
          this._confirmed.push(payload.channel);
          this.settle();
        }
      }
      return;
    }

    this.dispatch(payload.channel, event, data);
  };

  /*
   * A pusher:error from the server. The protocol splits these by code:
   *
   *   4000-4099  don't reconnect, the connection is misconfigured and an
   *              identical retry will be refused identically
   *   4100-4199  reconnect after a backoff
   *   4200-4299  reconnect immediately
   *
   * Honouring the first band matters. The common case is 4009 "Origin not
   * allowed", which means this host isn't on the WebSocket cluster's allowed
   * origins list, retrying that forever just hammers the cluster and buries
   * the one message that explains the problem.
   */
  Realtime.prototype.handleProtocolError = function (data) {
    var code = (data && Number(data.code)) || 0;
    var message = (data && data.message) || 'unknown error';
    var fatal = code >= 4000 && code <= 4099;

    if (fatal) {
      // Stop the reconnect loop; this cannot succeed as configured.
      this.closedByUs = true;
      // A full cluster is the one refusal that passes by itself, as other
      // tabs close. Ask again now and then, far apart, or a tab opened in a
      // busy hour stays without live updates until it is reloaded.
      if (code === 4004) this.retryWhenThereIsRoom();
      if (window.console) {
        console.error(
          '[messaging] realtime disabled, the server refused the connection (' +
            code + ': ' + message + ').' +
            (code === 4009
              ? ' Add this origin (' + window.location.origin +
                ") to the WebSocket cluster's allowed origins."
              : '')
        );
      }
    }

    this.emitState(fatal ? 'refused' : 'error', { code: code, message: message });
  };

  Realtime.prototype.retryWhenThereIsRoom = function () {
    var self = this;
    if (this.quotaTimer) return;
    this.quotaTimer = setTimeout(function () {
      self.quotaTimer = null;
      if (!self.config || self.connected) return;
      self.closedByUs = false;
      self.retries = 0;
      self.open();
    }, QUOTA_RETRY_MS);
  };

  Realtime.prototype.dispatch = function (channel, event, data) {
    var entry = this.channels[channel];
    if (!entry) return;
    (entry.handlers[event] || []).forEach(function (fn) {
      try {
        fn(data);
      } catch (err) {
        // One bad listener must not take down the socket loop.
        if (window.console) console.error('[messaging] listener failed', err);
      }
    });
  };

  Realtime.prototype.send = function (message) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(message));
  };

  /*
   * Private channels are authorised by the Laravel app, not by Reverb: POST
   * the socket id and channel name to /broadcasting/auth as the session user
   * and pass the signature it returns back over the socket.
   */
  Realtime.prototype.authorize = function (channel) {
    // A sign-off that never answers would hold its channel in flight, and
    // so unsubscribed, for good. Give up on it and let the retry ask again.
    var abort = typeof AbortController === 'function' ? new AbortController() : null;
    var giveUp = abort ? setTimeout(function () { abort.abort(); }, AUTHORIZE_TIMEOUT_MS) : null;

    return fetch(ROOT + '/broadcasting/auth', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf(),
      },
      body: JSON.stringify({ socket_id: this.socketId, channel_name: channel }),
      signal: abort ? abort.signal : undefined,
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error('Channel auth failed (' + res.status + ')');
        err.status = res.status;
        throw err;
      }
      return res.json();
    }).then(function (auth) {
      if (giveUp) clearTimeout(giveUp);
      return auth;
    }, function (err) {
      if (giveUp) clearTimeout(giveUp);
      throw err;
    });
  };

  Realtime.prototype.subscribe = function (channel) {
    var self = this;
    var entry = this.channels[channel];
    if (!entry || entry.subscribed || entry.pending || !this.connected || !this.socketId) return;

    // One sign-off and one subscribe per channel, however many listeners ask
    // for it. A conversation registers nine, and each used to post its own:
    // nine requests and nine frames per conversation on every page load.
    entry.pending = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    // Left, or the socket replaced, while an answer was in flight: the
    // answer belongs to something that is gone.
    var ticket = entry.ticket;
    function current() {
      return self.channels[channel] === entry && entry.ticket === ticket;
    }

    // A sign-off is for this socket and this channel and stays good for
    // both, so a frame the server dropped goes out again without asking the
    // app a second time.
    var signed = entry.auth ? Promise.resolve(entry.auth) : this.authorize(channel);

    signed
      .then(function (auth) {
        if (!current()) return;
        entry.auth = auth;
        self.send({
          event: 'pusher:subscribe',
          data: { channel: channel, auth: auth.auth, channel_data: auth.channel_data },
        });
        entry.timer = setTimeout(function () {
          entry.timer = null;
          if (!current() || entry.subscribed) return;
          entry.pending = false;
          self.retrySubscribe(channel);
          self.settle();
        }, SUBSCRIBE_CONFIRM_MS);
      })
      .catch(function (err) {
        if (!current()) return;
        entry.pending = false;
        // Refused is left unsubscribed; the next reconnect or explicit
        // listen() asks afresh. Anything else (offline, a server error) is
        // asked again here, or the channel stays deaf for as long as the
        // socket stays up.
        if (!(err && REFUSED[err.status])) self.retrySubscribe(channel);
        self.settle();
      });
  };

  Realtime.prototype.retrySubscribe = function (channel) {
    var self = this;
    var entry = this.channels[channel];
    if (!entry || entry.timer) return;

    var delay = Math.min(SUBSCRIBE_RETRY_MAX, SUBSCRIBE_RETRY_BASE * Math.pow(2, entry.attempts));
    // Jitter, so channels dropped together do not all ask again together.
    delay = delay * (0.7 + Math.random() * 0.6);
    entry.attempts += 1;

    var ticket = entry.ticket;
    entry.timer = setTimeout(function () {
      entry.timer = null;
      if (self.channels[channel] === entry && entry.ticket === ticket) self.subscribe(channel);
    }, delay);
  };

  /*
   * Say which channels have just been confirmed, once nothing is still in
   * flight. A surface that read its data before its subscription took effect
   * has a gap between the two that no event will ever fill, on first load
   * and after every reconnect; this is its cue to read once more.
   */
  Realtime.prototype.settle = function () {
    var self = this;
    if (!this._confirmed.length) return;
    var waiting = Object.keys(this.channels).some(function (name) {
      return self.channels[name].pending;
    });
    if (waiting) return;

    var batch = this._confirmed;
    this._confirmed = [];
    this.emitState('subscribed', { channels: batch });
  };

  Realtime.prototype.resubscribeAll = function () {
    var self = this;
    Object.keys(this.channels).forEach(function (name) {
      self.subscribe(name);
    });
  };

  /* Register a handler and make sure we're subscribed to its channel. */
  Realtime.prototype.listen = function (channel, event, handler) {
    if (!this.channels[channel]) {
      this.channels[channel] = {
        handlers: {},
        subscribed: false,
        pending: false,
        attempts: 0,
        ticket: 0,
        timer: null,
        auth: null,
      };
    }
    var handlers = this.channels[channel].handlers;
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);

    this.subscribe(channel);

    var self = this;
    return function off() {
      var list = self.channels[channel] && self.channels[channel].handlers[event];
      if (!list) return;
      var i = list.indexOf(handler);
      if (i !== -1) list.splice(i, 1);
    };
  };

  Realtime.prototype.leave = function (channel) {
    var entry = this.channels[channel];
    if (!entry) return;
    if (this.connected) this.send({ event: 'pusher:unsubscribe', data: { channel: channel } });
    if (entry.timer) clearTimeout(entry.timer);
    delete this.channels[channel];
    this.settle();
  };

  Realtime.prototype.scheduleRetry = function () {
    var self = this;
    if (this.retryTimer) return;

    var delay = Math.min(RETRY_MAX, RETRY_BASE * Math.pow(2, this.retries));
    // Jitter so many tabs waking together don't reconnect in lockstep.
    delay = delay * (0.7 + Math.random() * 0.6);
    this.retries += 1;

    this.retryTimer = setTimeout(function () {
      self.retryTimer = null;
      if (!self.closedByUs) self.open();
    }, delay);
  };

  Realtime.prototype.onState = function (handler) {
    this.stateHandlers.push(handler);
  };

  Realtime.prototype.emitState = function (state, detail) {
    this.stateHandlers.forEach(function (fn) {
      try {
        fn(state, detail);
      } catch (err) {
        /* ignore */
      }
    });
  };

  Realtime.prototype.stop = function () {
    this.closedByUs = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
      this.quotaTimer = null;
    }
    if (this.socket) this.socket.close();
    this.socket = null;
    this.channels = {};
    this.connected = false;
  };

  window.TMAMessagingRealtime = new Realtime();
})();
