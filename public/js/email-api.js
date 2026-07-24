/*
 * TMA - Mailbox API client for the email page.
 *
 * Mirrors the clients.js persistence layer: same fetch wrapper, same CSRF
 * handling, same error shape. email.js talks to this and never to fetch.
 *
 * Writes are optimistic — the UI updates immediately and this reconciles
 * afterwards — because a provider round trip is far too slow to block a
 * star or a read toggle on.
 *
 * Global: window.TMAEmailAPI
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/mail';

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function mailFetch(url, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (opts.method && opts.method !== 'GET') headers['X-XSRF-TOKEN'] = csrf();
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
          // 409 from the mailbox routes means the OAuth grant is gone or was
          // never wide enough. The UI shows a Reconnect prompt for this
          // rather than a generic failure toast.
          err.reconnect = !!(data && data.reconnect);
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

  window.TMAEmailAPI = {
    /* Connection state, folder counts, labels. */
    bootstrap: function () {
      return mailFetch(BASE);
    },

    /* Progress of the mailbox history download, for the corner panel. */
    syncStatus: function () {
      return mailFetch(BASE + '/sync-status');
    },

    listMessages: function (opts) {
      opts = opts || {};
      return mailFetch(BASE + '/messages' + query({
        folder: opts.folder || 'inbox',
        q: opts.search,
        label: opts.label,
        page: opts.page,
        perPage: opts.perPage,
      }));
    },

    getMessage: function (id) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id));
    },

    /* Every message in the conversation the given message belongs to. Only the
     * opened message arrives with its body; the rest report bodyLoaded:false
     * and are pulled through getMessage as the reader expands them. */
    getThread: function (id) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id) + '/thread');
    },

    /* Read / starred flags. */
    setFlags: function (id, flags) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id), {
        method: 'PATCH',
        json: flags,
      });
    },

    move: function (id, folder) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id) + '/move', {
        method: 'POST',
        json: { folder: folder },
      });
    },

    remove: function (id) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    setLabel: function (id, labelId, applied) {
      return mailFetch(BASE + '/messages/' + encodeURIComponent(id) + '/labels', {
        method: 'POST',
        json: { label: labelId, applied: !!applied },
      });
    },

    bulk: function (ids, action) {
      return mailFetch(BASE + '/bulk', { method: 'POST', json: { ids: ids, action: action } });
    },

    send: function (payload) {
      return mailFetch(BASE + '/send', { method: 'POST', json: payload });
    },

    listDrafts: function () {
      return mailFetch(BASE + '/drafts');
    },

    saveDraft: function (payload) {
      return mailFetch(BASE + '/drafts', { method: 'POST', json: payload });
    },

    deleteDraft: function (id) {
      return mailFetch(BASE + '/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    attachmentUrl: function (id) {
      return BASE + '/attachments/' + encodeURIComponent(id);
    },

    /* opts.fast asks for the inbox-only live check rather than the full folder
     * walk — the difference between something that can run every five seconds
     * and something that cannot. */
    sync: function (opts) {
      return mailFetch(BASE + '/sync' + ((opts && opts.fast) ? '?fast=1' : ''), { method: 'POST' });
    },

    getSettings: function () {
      return mailFetch(BASE + '/settings');
    },

    saveSettings: function (payload) {
      return mailFetch(BASE + '/settings', { method: 'PUT', json: payload });
    },

    /* Re-dispatch a stalled or failed sync. Resumes from the stored page
     * tokens server-side — never a from-scratch re-import. */
    retrySync: function () {
      return mailFetch(BASE + '/sync/retry', { method: 'POST' });
    },

    /* Signs out of the mailbox ONLY: stops mail sync so the page drops back
     * to the "Connect your mailbox" state. The Google/Microsoft account
     * itself stays connected to the portal (sign-in, calendar, files are
     * untouched) — fully disconnecting it lives in Security settings.
     * Imported mail is kept, so reconnecting later is instant. */
    disconnect: function (provider) {
      return mailFetch(BASE + '/sign-out', { method: 'POST' });
    },

    /* Where the sidebar's Reconnect button sends the user. Asking for mail
     * scopes goes through the normal social-connect flow with sync_email on;
     * return=email lands the user back on this page, where the progress
     * panel picks the sync up immediately. */
    connectUrl: function (provider) {
      return ROOT + '/auth/social/' + encodeURIComponent(provider) +
        '/redirect?sync_email=1&return=email';
    },
  };
})();
