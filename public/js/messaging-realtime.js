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

  function Realtime() {
    this.config = null;
    this.socket = null;
    this.socketId = null;
    this.channels = {};      // name -> { handlers: {event: [fn]}, subscribed: bool }
    this.retries = 0;
    this.retryTimer = null;
    this.connected = false;
    this.stateHandlers = [];
    this.closedByUs = false;
  }

  Realtime.prototype.start = function (config) {
    if (!config || !config.enabled || !config.key) return false;
    // Reconnecting with the same config is a no-op; a changed one restarts.
    if (this.socket && this.config && this.config.key === config.key) return true;

    this.config = config;
    this.closedByUs = false;
    this.open();
    return true;
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

    try {
      this.socket = new WebSocket(this.url());
    } catch (err) {
      this.scheduleRetry();
      return;
    }

    this.socket.addEventListener('open', function () {
      // Not "connected" yet — that waits for pusher:connection_established,
      // which carries the socket_id every private subscription needs.
      self.retries = 0;
    });

    this.socket.addEventListener('message', function (e) {
      self.receive(e.data);
    });

    this.socket.addEventListener('close', function () {
      self.connected = false;
      self.socketId = null;
      Object.keys(self.channels).forEach(function (name) {
        self.channels[name].subscribed = false;
      });
      self.emitState('disconnected');
      if (!self.closedByUs) self.scheduleRetry();
    });

    this.socket.addEventListener('error', function () {
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
      this.emitState('connected');
      this.resubscribeAll();
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
      if (this.channels[payload.channel]) this.channels[payload.channel].subscribed = true;
      return;
    }

    this.dispatch(payload.channel, event, data);
  };

  /*
   * A pusher:error from the server. The protocol splits these by code:
   *
   *   4000-4099  don't reconnect — the connection is misconfigured and an
   *              identical retry will be refused identically
   *   4100-4199  reconnect after a backoff
   *   4200-4299  reconnect immediately
   *
   * Honouring the first band matters. The common case is 4009 "Origin not
   * allowed", which means this host isn't on the WebSocket cluster's allowed
   * origins list — retrying that forever just hammers the cluster and buries
   * the one message that explains the problem.
   */
  Realtime.prototype.handleProtocolError = function (data) {
    var code = (data && Number(data.code)) || 0;
    var message = (data && data.message) || 'unknown error';
    var fatal = code >= 4000 && code <= 4099;

    if (fatal) {
      // Stop the reconnect loop; this cannot succeed as configured.
      this.closedByUs = true;
      if (window.console) {
        console.error(
          '[messaging] realtime disabled — the server refused the connection (' +
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
    }).then(function (res) {
      if (!res.ok) throw new Error('Channel auth failed (' + res.status + ')');
      return res.json();
    });
  };

  Realtime.prototype.subscribe = function (channel) {
    var self = this;
    var entry = this.channels[channel];
    if (!entry || entry.subscribed || !this.connected || !this.socketId) return;

    this.authorize(channel)
      .then(function (auth) {
        // The channel may have been left while auth was in flight.
        if (!self.channels[channel]) return;
        self.send({
          event: 'pusher:subscribe',
          data: { channel: channel, auth: auth.auth, channel_data: auth.channel_data },
        });
      })
      .catch(function () {
        // Denied or offline. Leave it unsubscribed; the next reconnect or
        // explicit listen() retries it.
      });
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
      this.channels[channel] = { handlers: {}, subscribed: false };
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
    if (!this.channels[channel]) return;
    if (this.connected) this.send({ event: 'pusher:unsubscribe', data: { channel: channel } });
    delete this.channels[channel];
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
    if (this.socket) this.socket.close();
    this.socket = null;
    this.channels = {};
    this.connected = false;
  };

  window.TMAMessagingRealtime = new Realtime();
})();
