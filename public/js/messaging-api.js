/*
 * TMA - Messaging API client for the Messages page ( /social/messages ).
 *
 * Mirrors email-api.js: same fetch wrapper, same CSRF handling, same error
 * shape. messages.js talks to this and never to fetch directly.
 *
 * Global: window.TMAMessagingAPI
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/messaging';

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /*
   * The websocket id of this tab, when one is connected.
   *
   * Laravel's `broadcast(...)->toOthers()` can only exclude the sender if the
   * request tells it which socket made it. Without this header every client
   * receives its own echoes — which silently made a sender mark its *own*
   * message delivered off its own acknowledgement, showing two ticks when
   * nobody had received it.
   */
  function socketId() {
    var rt = window.TMAMessagingRealtime;
    return (rt && rt.socketId) || '';
  }

  function api(url, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (opts.method && opts.method !== 'GET') {
      headers['X-XSRF-TOKEN'] = csrf();
      var socket = socketId();
      if (socket) headers['X-Socket-ID'] = socket;
    }
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(url, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign(headers, opts.headers || {}),
      body: opts.body,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || 'Request failed');
          err.status = res.status;
          err.data = data;
          // A conversation the user isn't in resolves as 404, not 403 — treat
          // it as "gone" so the UI drops it instead of showing an error.
          err.gone = res.status === 404;
          throw err;
        }
        return data;
      });
    });
  }

  function query(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  window.TMAMessagingAPI = {
    newNonce: uuid,

    /* The chat list, the viewer, and their messaging settings. */
    conversations: function () {
      return api(BASE + '/conversations');
    },

    /* Open (or reuse) a direct thread with one person. */
    openDirect: function (userId) {
      return api(BASE + '/conversations', { method: 'POST', json: { userId: userId } });
    },

    /* People this user may start a conversation with. */
    contacts: function (term) {
      return api(BASE + '/contacts' + query({ q: term }));
    },

    /*
     * A page of thread history, oldest-first. `before` is a message `seq`;
     * omit it for the newest page, pass the oldest loaded seq to page upward.
     */
    messages: function (conversationId, before) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/messages' + query({ before: before }));
    },

    send: function (conversationId, payload) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/messages', {
        method: 'POST',
        json: payload,
      });
    },

    editMessage: function (messageId, body) {
      return api(BASE + '/messages/' + encodeURIComponent(messageId), {
        method: 'PATCH',
        json: { body: body },
      });
    },

    deleteMessage: function (messageId) {
      return api(BASE + '/messages/' + encodeURIComponent(messageId), { method: 'DELETE' });
    },

    /*
     * Upload one file and stage it against a conversation.
     *
     * XHR rather than fetch: fetch still has no upload-progress event, and the
     * composer has to show a progress bar. Returns an object carrying the
     * promise plus an abort() so a queued file can be cancelled mid-flight.
     */
    uploadAttachment: function (conversationId, file, onProgress) {
      var xhr = new XMLHttpRequest();

      var promise = new Promise(function (resolve, reject) {
        var form = new FormData();
        form.append('file', file);

        xhr.open('POST', BASE + '/conversations/' + encodeURIComponent(conversationId) + '/attachments');
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.setRequestHeader('X-XSRF-TOKEN', csrf());
        var socket = socketId();
        if (socket) xhr.setRequestHeader('X-Socket-ID', socket);

        xhr.upload.addEventListener('progress', function (e) {
          if (!e.lengthComputable || !onProgress) return;
          onProgress(Math.round((e.loaded / e.total) * 100));
        });

        xhr.addEventListener('load', function () {
          var data = null;
          try {
            data = JSON.parse(xhr.responseText);
          } catch (err) {
            /* non-JSON error page */
          }

          if (xhr.status >= 200 && xhr.status < 300 && data && data.attachment) {
            resolve(data.attachment);
            return;
          }

          var err = new Error(
            (data && (data.message || (data.errors && data.errors.file && data.errors.file[0]))) ||
              'Upload failed'
          );
          err.status = xhr.status;
          reject(err);
        });

        xhr.addEventListener('error', function () {
          reject(new Error('Upload failed'));
        });

        xhr.addEventListener('abort', function () {
          var err = new Error('Upload cancelled');
          err.aborted = true;
          reject(err);
        });

        xhr.send(form);
      });

      return {
        promise: promise,
        abort: function () {
          xhr.abort();
        },
      };
    },

    /* Discard a staged file before it is sent. */
    removeAttachment: function (attachmentId) {
      return api(BASE + '/attachments/' + encodeURIComponent(attachmentId), { method: 'DELETE' });
    },

    /* Toggle one emoji on a message. Returns the updated message. */
    react: function (messageId, emoji) {
      return api(BASE + '/messages/' + encodeURIComponent(messageId) + '/reactions', {
        method: 'POST',
        json: { emoji: emoji },
      });
    },

    markRead: function (conversationId) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/read', { method: 'POST' });
    },

    /* Acknowledge receipt — the sender's second grey tick. Distinct from
     * markRead, and not gated on any privacy setting. */
    markDelivered: function (conversationId) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/delivered', {
        method: 'POST',
      });
    },

    /* Acknowledge receipt across every conversation in one call. */
    markAllDelivered: function () {
      return api(BASE + '/delivered', { method: 'POST' }).catch(function () {});
    },

    clearChat: function (conversationId) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/clear', {
        method: 'POST',
      });
    },

    setBlocked: function (conversationId, blocked) {
      return api(
        BASE + '/conversations/' + encodeURIComponent(conversationId) + (blocked ? '/block' : '/unblock'),
        { method: 'POST' }
      );
    },

    /* Leaves the conversation for this user; the other side keeps theirs. */
    leaveConversation: function (conversationId) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId), { method: 'DELETE' });
    },

    exportUrl: function (conversationId) {
      return BASE + '/conversations/' + encodeURIComponent(conversationId) + '/export';
    },

    markUnread: function (conversationId) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/unread', { method: 'POST' });
    },

    saveDraft: function (conversationId, draft) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId) + '/draft', {
        method: 'PUT',
        json: { draft: draft },
      });
    },

    /* Pin / archive / mute. Accepts any subset. */
    updateConversation: function (conversationId, changes) {
      return api(BASE + '/conversations/' + encodeURIComponent(conversationId), {
        method: 'PATCH',
        json: changes,
      });
    },

    settings: function () {
      return api(BASE + '/settings');
    },

    updateSettings: function (changes) {
      return api(BASE + '/settings', { method: 'PUT', json: changes });
    },

    /* Keeps the user online. Fire-and-forget: a missed beat just expires. */
    heartbeat: function () {
      return api(BASE + '/heartbeat', { method: 'POST' }).catch(function () {});
    },
  };
})();
