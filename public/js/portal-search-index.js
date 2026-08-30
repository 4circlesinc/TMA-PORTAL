/**
 * Site-wide portal search index builders + live fetchers.
 * Static: nav pages + every Settings / Account Settings screen.
 * Live (as you type): files, folders, clients, users, signatures, mail, messages.
 *
 * Global: window.TMAPortalSearchIndex
 */
(function () {
  'use strict';

  var SETTINGS_PAGES = [
    { id: 'profile', label: 'Profile' },
    { id: 'theme', label: 'Theme' },
    { id: 'time', label: 'Time and language' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'account-security', label: 'Account security' },
    { id: 'payment', label: 'Payment' },
    { id: 'plugins', label: 'Plugins' },
  ];

  var ADMIN_PAGES = [
    { id: 'profile', label: 'My profile', group: 'Settings' },
    { id: 'theme', label: 'Theme', group: 'Settings' },
    { id: 'time', label: 'Time and language', group: 'Settings' },
    { id: 'notifications', label: 'Notifications', group: 'Settings' },
    { id: 'privacy', label: 'Privacy', group: 'Settings' },
    { id: 'payment', label: 'Payment', group: 'Settings' },
    { id: 'plugins', label: 'Plugins', group: 'Settings' },
    { id: 'admin-overview', label: 'Admin Overview', group: 'Settings' },
    { id: 'background-ops', label: 'Background Operations', group: 'Settings' },
    { id: 'notification-history', label: 'Notification History', group: 'Account and Reporting' },
    { id: 'branding', label: 'Edit Company Branding', group: 'Account and Reporting' },
    { id: 'clienthub-access', label: 'Access', group: 'CIP Console' },
    { id: 'service-teams', label: 'Service teams', group: 'CIP Console' },
    { id: 'custom-fields', label: 'Custom fields', group: 'CIP Console' },
    { id: 'cip-documents', label: 'Document requirements', group: 'CIP Console' },
    { id: 'cip-letters', label: 'Granted and Denied letters', group: 'CIP Console' },
    { id: 'account-security', label: 'Account security', group: 'Security' },
    { id: 'security-insights', label: 'Security Insights', group: 'Security' },
    { id: 'signin-policy', label: 'Sign in policy', group: 'Security' },
    { id: 'security-policy', label: 'Security policy', group: 'Security' },
    { id: 'alert-settings', label: 'Security alert settings', group: 'Security' },
    { id: 'device-security', label: 'Configure device security', group: 'Security' },
    { id: 'connectors', label: 'Connectors', group: 'Settings' },
    { id: 'connection-manager', label: 'Connection Manager', group: 'Settings' },
    { id: 'storage-usage', label: 'Storage usage', group: 'Storage' },
    { id: 'permissions', label: 'Permissions', group: 'Advanced Preferences' },
    { id: 'default-folders', label: 'Default Folders', group: 'Advanced Preferences' },
    { id: 'folder-templates', label: 'Folder Templates', group: 'Advanced Preferences' },
  ];

  function root() {
    return window.__TMA_SITE_ROOT || '';
  }

  function api() {
    return window.TMANotifyAPI;
  }

  function settle(promise) {
    return Promise.resolve(promise).catch(function () { return []; });
  }

  function resultKey(item) {
    if (!item) return '';
    return item.fileId || item.folderId || item.clientId || item.userId
      || item.signatureId || item.emailMessageId || item.conversationId
      || item.adminPage || item.settingsNav
      || ((item.navId || '') + ':' + (item.label || item.title || ''));
  }

  function navLeavesFrom(rootEl) {
    if (!rootEl) return [];
    return Array.prototype.map.call(
      rootEl.querySelectorAll('.tma-dash__nav-item[data-nav]'),
      function (l) {
        var title = l.getAttribute('data-title') || (l.textContent || '').trim();
        var crumb = l.getAttribute('data-crumb') || '';
        var navId = l.getAttribute('data-nav') || '';
        var view = l.getAttribute('data-view') || '';
        return {
          type: 'page',
          label: title,
          title: title,
          subtitle: crumb && crumb !== title ? crumb : '',
          navId: navId,
          view: view,
          href: '#' + navId,
          keywords: [title, crumb, navId, view, (l.textContent || '').trim()].filter(Boolean),
        };
      }
    );
  }

  /* Search reads the sidebar out of the DOM, so a nav item portal-access.js
     pruned drops out of the index for free. The settings rail has no such
     luck, it is a static list in portal-admin.js, so without this an
     employee searching "security policy" was handed a result that opened the
     firm's policy page. */
  function allowedAdminPage(page) {
    var access = window.TMAPortalAccess;
    return !access || !access.canSettingsPage || access.canSettingsPage(page.id);
  }

  function personalSettingsEntries() {
    return SETTINGS_PAGES.map(function (page) {
      return {
        type: 'page',
        label: page.label,
        title: page.label,
        subtitle: 'Settings',
        navId: 'settings',
        view: 'settings',
        settingsNav: page.id,
        href: '/settings?nav=' + encodeURIComponent(page.id),
        keywords: ['settings', page.label, page.id, 'preferences', 'account'],
      };
    });
  }

  function adminSettingsEntries() {
    return ADMIN_PAGES.filter(allowedAdminPage).map(function (page) {
      return {
        type: 'page',
        label: page.label,
        title: page.label,
        subtitle: page.group ? ('Settings / ' + page.group) : 'Settings',
        navId: 'account-settings',
        view: 'admin',
        adminPage: page.id,
        href: '/account-settings?settings-page=' + encodeURIComponent(page.id),
        keywords: ['settings', 'admin', page.label, page.id, page.group || '', 'preferences', 'security', 'storage'],
      };
    });
  }

  function settingsIndex() {
    return personalSettingsEntries().concat(adminSettingsEntries());
  }

  function buildStaticIndex(rootEl) {
    var index = navLeavesFrom(rootEl).concat(settingsIndex());

    /* The index is built once, at boot, before /me has answered, so at this
       point nobody holds any capability and every admin section is filtered
       out, administrators included. The search popup keeps this array, not a
       copy, so the sections an account really may reach are pushed into it in
       place once the capabilities land. */
    var access = window.TMAPortalAccess;
    if (access && access.ready) {
      access.ready().then(function () {
        var known = {};
        index.forEach(function (entry) { if (entry.adminPage) known[entry.adminPage] = true; });
        adminSettingsEntries().forEach(function (entry) {
          if (!known[entry.adminPage]) index.push(entry);
        });
      });
    }

    return index;
  }

  var usersCache = null;
  var usersPromise = null;
  var usersCacheUrl = null;

  function mapClients(data) {
    return ((data && data.clients) || []).slice(0, 40).map(function (c) {
      var name = c.name || 'Client';
      var company = (c.profile && c.profile.work && c.profile.work.company) || c.company || '';
      var photo = c.profile && c.profile.photo;
      var hasPhoto = photo && /^(https?:|\/(storage|media)\/|data:)/.test(photo);
      return {
        type: 'user',
        label: name,
        title: name,
        subtitle: company ? ('Client · ' + company) : 'Client',
        avatarUrl: hasPhoto ? photo : '',
        clientId: c.id,
        navId: 'clients',
        view: 'clients',
        href: '/citizenship-applications/' + encodeURIComponent(c.id),
        keywords: [name, company, 'client', 'clients'],
      };
    });
  }

  function fetchContacts(q) {
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    var term = String(q || '').trim();
    if (term.length < 2) return Promise.resolve([]);
    var access = window.TMAPortalAccess;
    if (access && typeof access.holds === 'function' && !access.holds('clients.view')) {
      return Promise.resolve([]);
    }
    // Server-side search with a capped record set, never the full directory.
    return a.api(root() + '/portal/clients/search?q=' + encodeURIComponent(term) + '&limit=12')
      .then(function (data) {
        return mapClients(data);
      })
      .catch(function () {
        return [];
      });
  }

  function fetchFiles(q) {
    var net = window.TMAFilesNet;
    if (!net || typeof net.fetchJSON !== 'function') return Promise.resolve([]);
    var params = 'section=all&search=' + encodeURIComponent(q) + '&perPage=12';
    return net.fetchJSON(net.url('/?' + params)).then(function (res) {
      var folders = (res.folders || []).slice(0, 8).map(function (f) {
        return {
          type: 'folder',
          label: f.name,
          title: f.name,
          subtitle: 'Folder',
          folderId: f.id,
          navId: 'folders-all',
          view: 'folders',
          href: '/folders/all',
          keywords: [f.name, 'folder', 'files'],
        };
      });
      var files = (res.files || []).slice(0, 12).map(function (f) {
        var folderName = (f.folder && f.folder.name) || 'Files';
        return {
          type: 'file',
          label: f.name,
          title: f.name,
          subtitle: folderName,
          fileId: f.id,
          folderId: f.folder && f.folder.id ? f.folder.id : null,
          navId: 'folders-all',
          view: 'folders',
          href: '/folders/all',
          keywords: [f.name, f.extension || '', folderName, 'file', 'files'],
        };
      });
      return folders.concat(files);
    });
  }

  /* People results come from whichever list the account may actually read.
     `/admin/users` is the account-management table and `/portal/people/*` is
     the directory; both are administration now, so an account holding neither
     gets no colleague results rather than a row that 403s when opened. Client
     results are unaffected, they come from /portal/clients, which scopes
     itself to the reader's assignments. */
  function usersSource() {
    var access = window.TMAPortalAccess;
    var can = access && access.can ? access.can : function () { return true; };

    if (can('users.view')) {
      return { url: '/admin/users', key: 'users', navId: 'users', view: 'users', href: '/users' };
    }
    if (can('directory.view')) {
      return { url: '/portal/people/employees', key: 'employees', navId: 'people-employees', view: 'people', href: '/people/employees' };
    }
    return null;
  }

  function mapUsers(data, source) {
    return ((data && data[source.key]) || []).map(function (u) {
      return {
        type: 'user',
        label: u.name || u.email || 'User',
        title: u.name || u.email || 'User',
        subtitle: u.email || u.jobTitle || 'User',
        avatarUrl: u.avatar || '',
        userId: u.id,
        navId: source.navId,
        view: source.view,
        href: source.href,
        keywords: [u.name, u.email, u.jobTitle, u.accountType, 'user', 'users'].filter(Boolean),
      };
    });
  }

  function loadUsers() {
    var source = usersSource();
    if (!source) return Promise.resolve([]);
    /* Keyed by source, not just "loaded": a search run before /me answers
       reads nothing (nobody holds a capability yet), and an administrator must
       not be stuck with that answer afterwards. */
    if (usersCache && usersCacheUrl === source.url) return Promise.resolve(usersCache);
    if (usersPromise && usersCacheUrl === source.url) return usersPromise;
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    usersCacheUrl = source.url;
    usersPromise = a.api(root() + source.url).then(function (data) {
      usersCache = mapUsers(data, source);
      usersPromise = null;
      return usersCache;
    }).catch(function () {
      usersPromise = null;
      return [];
    });
    return usersPromise;
  }

  function fetchUsers(q) {
    var needle = String(q || '').toLowerCase();
    return loadUsers().then(function (items) {
      return items.filter(function (item) {
        var hay = [item.label, item.subtitle].concat(item.keywords || []).join(' ').toLowerCase();
        return hay.indexOf(needle) !== -1;
      }).slice(0, 10);
    });
  }

  function fetchSignatures(q) {
    var net = window.TMAFilesNet;
    if (!net || typeof net.fetchJSON !== 'function') return Promise.resolve([]);
    var url = root() + '/portal/signatures/?search=' + encodeURIComponent(q);
    return net.fetchJSON(url).then(function (res) {
      return ((res && res.requests) || []).slice(0, 8).map(function (r) {
        var title = r.title || r.name || 'Signature request';
        return {
          type: 'page',
          label: title,
          title: title,
          subtitle: 'Signatures',
          signatureId: r.id,
          navId: 'signatures',
          view: 'signatures',
          href: '/signatures',
          keywords: [title, 'signature', 'signatures', 'sign'],
        };
      });
    });
  }

  function fetchMail(q) {
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    var url = root() + '/portal/mail/messages?q=' + encodeURIComponent(q) + '&perPage=8';
    return a.api(url).then(function (data) {
      var rows = (data && (data.messages || data.rows || data.items)) || [];
      return rows.slice(0, 8).map(function (m) {
        var subject = m.subject || m.title || '(No subject)';
        var from = m.from || m.fromName || m.sender || '';
        return {
          type: 'page',
          label: subject,
          title: subject,
          subtitle: from ? ('Email · ' + from) : 'Email',
          emailMessageId: m.id || m.messageId || null,
          navId: 'email',
          view: 'email',
          href: '/email',
          keywords: [subject, from, 'email', 'mail', 'inbox'].filter(Boolean),
        };
      });
    });
  }

  function fetchMessaging(q) {
    var msg = window.TMAMessagingAPI;
    if (!msg || typeof msg.search !== 'function') return Promise.resolve([]);
    return msg.search(q).then(function (data) {
      var results = (data && data.results) || data || {};
      var out = [];
      (results.people || []).slice(0, 6).forEach(function (p) {
        out.push({
          type: 'user',
          label: p.name || p.email || 'Person',
          title: p.name || p.email || 'Person',
          subtitle: p.email || 'Messages',
          avatarUrl: p.photo || '',
          userId: p.id,
          navId: 'so-messages',
          view: 'messages',
          href: '/social/messages',
          keywords: [p.name, p.email, 'messages', 'people'].filter(Boolean),
        });
      });
      (results.conversations || []).slice(0, 6).forEach(function (c) {
        var name = c.name || c.title || 'Conversation';
        out.push({
          type: 'page',
          label: name,
          title: name,
          subtitle: 'Messages',
          conversationId: c.id || c.uuid || c.conversationId,
          navId: 'so-messages',
          view: 'messages',
          href: '/social/messages',
          keywords: [name, 'messages', 'chat', 'conversation'],
        });
      });
      (results.messages || []).slice(0, 4).forEach(function (m) {
        var body = m.body || m.text || m.preview || 'Message';
        var label = String(body).replace(/\s+/g, ' ').trim().slice(0, 80);
        out.push({
          type: 'page',
          label: label,
          title: label,
          subtitle: 'Message',
          conversationId: m.conversationId || m.conversation_id || (m.conversation && (m.conversation.id || m.conversation.uuid)),
          navId: 'so-messages',
          view: 'messages',
          href: '/social/messages',
          keywords: [label, 'messages', 'chat'],
        });
      });
      return out;
    });
  }

  function fetchLiveResults(query) {
    var q = String(query || '').trim();
    if (q.length < 2) return Promise.resolve([]);

    return Promise.all([
      settle(fetchFiles(q)),
      settle(fetchContacts(q)),
      settle(fetchUsers(q)),
      settle(fetchSignatures(q)),
      settle(fetchMail(q)),
      settle(fetchMessaging(q)),
    ]).then(function (chunks) {
      var merged = [];
      var seen = Object.create(null);
      chunks.forEach(function (list) {
        (list || []).forEach(function (item) {
          var key = resultKey(item);
          if (!key || seen[key]) return;
          seen[key] = true;
          merged.push(item);
        });
      });
      return merged;
    });
  }

  window.TMAPortalSearchIndex = {
    buildStaticIndex: buildStaticIndex,
    settingsIndex: settingsIndex,
    fetchContacts: fetchContacts,
    fetchLiveResults: fetchLiveResults,
    resultKey: resultKey,
  };
})();
