/*
 * TMA - Feed API client for the Feed page ( /social/feed ).
 *
 * Mirrors messaging-api.js: same fetch wrapper, same CSRF handling, same error
 * shape. feed.js talks to this and never to fetch directly.
 *
 * Global: window.TMAFeedAPI
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/feed';

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /*
   * The websocket id of this tab, when one is connected.
   *
   * Laravel's broadcast(...)->toOthers() can only exclude the sender if the
   * request says which socket made it. Without this header every client
   * receives its own echoes, and the feed would patch in a post it had already
   * rendered optimistically.
   */
  function socketId() {
    var rt = window.TMAFeedRealtime || window.TMAMessagingRealtime;
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
      signal: opts.signal,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);

      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error(message(data, res.status));
          err.status = res.status;
          err.data = data;
          // A channel the user isn't in resolves as 404, not 403, treat it
          // as "gone" so the UI drops it instead of showing an error.
          err.gone = res.status === 404;
          // Validation errors are shown against their field, not as a toast.
          err.errors = (data && data.errors) || null;
          throw err;
        }
        return data;
      });
    });
  }

  /* The most useful sentence available, in the order the server offers them. */
  function message(data, status) {
    if (data && data.errors) {
      for (var key in data.errors) {
        if (data.errors[key] && data.errors[key][0]) return data.errors[key][0];
      }
    }
    if (data && data.message) return data.message;
    if (status === 403) return 'You do not have access to this.';
    if (status === 404) return 'That is no longer available.';
    return 'Something went wrong. Try again.';
  }

  /* Turn an object into a query string, dropping empty values. */
  function query(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === '' || value === false) return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function get(path, params, signal) {
    return api(BASE + path + query(params), { signal: signal });
  }

  function send(method, path, json) {
    return api(BASE + path, { method: method, json: json === undefined ? {} : json });
  }

  window.TMAFeedAPI = {
    /* ── Channels ─────────────────────────────────────────── */
    channels: function (params) { return get('/channels', params); },
    channel: function (id) { return get('/channels/' + encodeURIComponent(id)); },
    createChannel: function (payload) { return send('POST', '/channels', payload); },
    updateChannel: function (id, payload) {
      return send('PATCH', '/channels/' + encodeURIComponent(id), payload);
    },
    deleteChannel: function (id) { return send('DELETE', '/channels/' + encodeURIComponent(id)); },
    archiveChannel: function (id) { return send('POST', '/channels/' + encodeURIComponent(id) + '/archive'); },
    restoreChannel: function (id) { return send('POST', '/channels/' + encodeURIComponent(id) + '/restore'); },
    joinChannel: function (id) { return send('POST', '/channels/' + encodeURIComponent(id) + '/join'); },
    leaveChannel: function (id) { return send('POST', '/channels/' + encodeURIComponent(id) + '/leave'); },
    markChannelRead: function (id) { return send('POST', '/channels/' + encodeURIComponent(id) + '/read'); },
    updateMembership: function (id, payload) {
      return send('PATCH', '/channels/' + encodeURIComponent(id) + '/membership', payload);
    },

    members: function (id) { return get('/channels/' + encodeURIComponent(id) + '/members'); },
    addMembers: function (id, userIds, role) {
      return send('POST', '/channels/' + encodeURIComponent(id) + '/members', {
        userIds: userIds, role: role || 'member',
      });
    },
    updateMember: function (id, userId, role) {
      return send('PATCH', '/channels/' + encodeURIComponent(id) + '/members/' + userId, { role: role });
    },
    removeMember: function (id, userId) {
      return send('DELETE', '/channels/' + encodeURIComponent(id) + '/members/' + userId);
    },

    /*
     * Channel images go up as multipart, so they bypass the JSON wrapper but
     * keep its CSRF handling and error shape.
     */
    uploadChannelImage: function (id, which, file) {
      var form = new FormData();
      form.append('file', file);
      return api(BASE + '/channels/' + encodeURIComponent(id) + '/image/' + which, {
        method: 'POST', body: form,
      });
    },

    /* ── Posts ────────────────────────────────────────────── */
    posts: function (params, signal) { return get('/posts', params, signal); },
    post: function (id) { return get('/posts/' + encodeURIComponent(id)); },
    createPost: function (payload) { return send('POST', '/posts', payload); },
    updatePost: function (id, payload) { return send('PATCH', '/posts/' + encodeURIComponent(id), payload); },
    deletePost: function (id) { return send('DELETE', '/posts/' + encodeURIComponent(id)); },
    autosave: function (id, payload) {
      return send('PUT', '/posts/' + encodeURIComponent(id) + '/autosave', payload);
    },
    publishPost: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/publish'); },
    duplicatePost: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/duplicate'); },
    togglePin: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/pin'); },
    toggleLock: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/lock'); },
    toggleBookmark: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/bookmark'); },
    share: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/share'); },
    acknowledge: function (id) { return send('POST', '/posts/' + encodeURIComponent(id) + '/acknowledge'); },
    acknowledgements: function (id) { return get('/posts/' + encodeURIComponent(id) + '/acknowledgements'); },

    /* ── Engagement ───────────────────────────────────────── */
    reactToPost: function (id, emoji) {
      return send('POST', '/posts/' + encodeURIComponent(id) + '/reactions', { emoji: emoji });
    },
    reactToComment: function (id, emoji) {
      return send('POST', '/comments/' + encodeURIComponent(id) + '/reactions', { emoji: emoji });
    },
    reactionPeople: function (id) { return get('/posts/' + encodeURIComponent(id) + '/reactions'); },

    comments: function (postId) { return get('/posts/' + encodeURIComponent(postId) + '/comments'); },
    comment: function (postId, payload) {
      return send('POST', '/posts/' + encodeURIComponent(postId) + '/comments', payload);
    },
    updateComment: function (id, body) {
      return send('PATCH', '/comments/' + encodeURIComponent(id), { body: body });
    },
    deleteComment: function (id) { return send('DELETE', '/comments/' + encodeURIComponent(id)); },

    vote: function (postId, optionIds) {
      return send('POST', '/posts/' + encodeURIComponent(postId) + '/poll/vote', { optionIds: optionIds });
    },
    closePoll: function (postId) { return send('POST', '/posts/' + encodeURIComponent(postId) + '/poll/close'); },
    pollVoters: function (postId) { return get('/posts/' + encodeURIComponent(postId) + '/poll/voters'); },

    /* ── Attachments ──────────────────────────────────────── */
    uploadAttachment: function (channelId, file, onProgress) {
      // XHR rather than fetch: the composer shows a progress bar per file, and
      // fetch still has no upload-progress event.
      return new Promise(function (resolve, reject) {
        var form = new FormData();
        form.append('file', file);

        var xhr = new XMLHttpRequest();
        xhr.open('POST', BASE + '/channels/' + encodeURIComponent(channelId) + '/attachments');
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.setRequestHeader('X-XSRF-TOKEN', csrf());

        if (onProgress && xhr.upload) {
          xhr.upload.addEventListener('progress', function (e) {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          });
        }

        xhr.onload = function () {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
            return;
          }

          var err = new Error(message(data, xhr.status));
          err.status = xhr.status;
          err.data = data;
          reject(err);
        };

        xhr.onerror = function () { reject(new Error('The upload failed. Check your connection.')); };
        xhr.send(form);
      });
    },
    deleteAttachment: function (id) { return send('DELETE', '/attachments/' + encodeURIComponent(id)); },

    /* ── Search and autocomplete ──────────────────────────── */
    search: function (params, signal) { return get('/search', params, signal); },
    mentionable: function (q, channelId, signal) {
      return get('/mentionable', { q: q, channel: channelId }, signal);
    },
    hashtags: function (q, signal) { return get('/hashtags', { q: q }, signal); },

    /* ── Analytics ────────────────────────────────────────── */
    analytics: function (params) { return get('/analytics', params); },
  };
})();
