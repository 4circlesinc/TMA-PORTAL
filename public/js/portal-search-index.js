/**
 * Site-wide portal search index builders + live fetchers.
 * Static: nav pages + every Settings / Account Settings screen.
 * Live (as you type): files, folders, clients, users, signatures, mail,
 * messages, CIP document requirements, CIP applications.
 * Empty palette: latest clients + recently changed files.
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
    { id: 'cip-admin', label: 'Administrator', group: 'CIP Console' },
    { id: 'clienthub-access', label: 'Access', group: 'CIP Console' },
    { id: 'service-teams', label: 'Service teams', group: 'CIP Console' },
    { id: 'custom-fields', label: 'Custom fields', group: 'CIP Console' },
    { id: 'cip-documents', label: 'Document requirements', group: 'CIP Console', keywords: ['description', 'help', 'checklist'] },
    { id: 'cip-letters', label: 'Granted and Denied letters', group: 'CIP Console' },
    { id: 'cip-distribution', label: 'Distribution group', group: 'CIP Console' },
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
      || item.cipRequirementId || item.cipApplicationId
      || item.adminPage || item.settingsNav
      || ((item.navId || '') + ':' + (item.label || item.title || ''));
  }

  /* Phrase first, then every word: "oath allegiance" still finds
     "Oath of Allegiance". */
  function matchesQuery(hay, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return false;
    hay = String(hay || '').toLowerCase();
    if (hay.indexOf(q) !== -1) return true;
    var words = q.split(/\s+/);
    var i;
    for (i = 0; i < words.length; i++) {
      if (words[i] && hay.indexOf(words[i]) === -1) return false;
    }
    return words.length > 0;
  }

  function haystack(item) {
    return [item.label, item.title, item.subtitle].concat(item.keywords || []).filter(Boolean).join(' ');
  }

  function canReachCip() {
    var access = window.TMAPortalAccess;
    if (access && typeof access.cipReach === 'function') return access.cipReach();
    return window.TMABootCipReach === true || window.TMABootCipReach === 'true';
  }

  function canOpenCipDocuments() {
    var access = window.TMAPortalAccess;
    return !access || !access.canSettingsPage || access.canSettingsPage('cip-documents');
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
        keywords: ['settings', 'admin', page.label, page.id, page.group || '', 'preferences', 'security', 'storage'].concat(page.keywords || []),
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

  function clientAvatarUrl(c, name) {
    var photo = c.photo || (c.profile && c.profile.photo) || '';
    if (photo && /^(https?:|\/(storage|media)\/|data:)/.test(photo)) return photo;
    var render = window.TMANotifyRender;
    if (render && typeof render.initialsUri === 'function') {
      return render.initialsUri(name || 'Client');
    }
    return '';
  }

  function mapClients(data, opts) {
    opts = opts || {};
    var cap = opts.limit || 40;
    return ((data && data.clients) || []).slice(0, cap).map(function (c) {
      var name = c.name || 'Client';
      var company = c.companyName || (c.profile && c.profile.work && c.profile.work.company) || c.company || '';
      var row = {
        type: 'user',
        label: name,
        title: name,
        avatarUrl: clientAvatarUrl(c, name),
        clientId: c.id,
        navId: 'clients',
        view: 'clients',
        href: '/citizenship-applications/' + encodeURIComponent(c.id),
        keywords: [name, company, 'client', 'clients'],
      };
      if (!opts.compact) {
        row.subtitle = company ? ('Client · ' + company) : 'Client';
      }
      return row;
    });
  }

  function mapFileRow(f, opts) {
    opts = opts || {};
    var folderName = (f.folder && f.folder.name) || 'Files';
    var row = {
      type: 'file',
      label: f.name,
      title: f.name,
      fileId: f.id,
      folderId: f.folder && f.folder.id ? f.folder.id : null,
      navId: 'folders-all',
      view: 'folders',
      href: '/folders/all',
      keywords: [f.name, f.extension || '', folderName, 'file', 'files'],
      // What TMAFileThumbs needs to draw the real thumbnail (or the
      // extension's own icon) instead of a generic document glyph.
      thumb: {
        type: 'file',
        id: f.id,
        name: f.name,
        extension: f.extension || '',
        category: f.category || '',
        mime: f.mime || '',
        icon: f.icon || '',
        thumbUrl: f.thumbUrl || '',
        previewUrl: f.previewUrl || '',
        permissions: f.permissions,
        bytes: f.size,
      },
    };
    if (!opts.compact) {
      row.subtitle = folderName;
    }
    return row;
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

  function fetchLatestClients(limit) {
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    var access = window.TMAPortalAccess;
    if (access && typeof access.holds === 'function' && !access.holds('clients.view')) {
      return Promise.resolve([]);
    }
    var n = Math.max(1, Math.min(20, Number(limit) || 5));
    return a.api(root() + '/portal/clients/preview?limit=' + encodeURIComponent(n) + '&sort=latest')
      .then(function (data) {
        return mapClients(data, { compact: true, limit: n });
      })
      .catch(function () {
        return [];
      });
  }

  function fetchFiles(q) {
    var net = window.TMAFilesNet;
    if (!net || typeof net.fetchJSON !== 'function') return Promise.resolve([]);
    var params = 'section=all&search=' + encodeURIComponent(q) + '&perPage=12&lean=1';
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
        return mapFileRow(f);
      });
      return folders.concat(files);
    });
  }

  function fetchLatestFiles(limit) {
    var net = window.TMAFilesNet;
    if (!net || typeof net.fetchJSON !== 'function') return Promise.resolve([]);
    var n = Math.max(1, Math.min(20, Number(limit) || 5));
    // Recent mixes folders and files in one window. Pull a wider page so
    // folders do not crowd the five files the empty search popup wants.
    return net.fetchJSON(net.url('/?section=recent&perPage=40&lean=1')).then(function (res) {
      return (res.files || []).slice(0, n).map(function (f) {
        return mapFileRow(f, { compact: true });
      });
    }).catch(function () {
      return [];
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
    return loadUsers().then(function (items) {
      return items.filter(function (item) {
        return matchesQuery(haystack(item), q);
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
    // `limit`, not `perPage`: the listing validator only accepts the inbox's
    // own page sizes, and a search that asked for a page of 8 was refused
    // outright, which is why mail never showed up in search.
    var url = root() + '/portal/mail/messages?q=' + encodeURIComponent(q) + '&limit=8';
    return a.api(url).then(function (data) {
      var rows = (data && (data.messages || data.rows || data.items)) || [];
      return rows.slice(0, 8).map(function (m) {
        var subject = m.subject || m.title || '(No subject)';
        // Rows come in the list shape (MailMessage::toRow): `sender` is the
        // display name with the address as its fallback.
        var from = m.sender || m.fromName || m.from || m.email || '';
        return {
          type: 'mail',
          label: subject,
          title: subject,
          subtitle: from,
          snippet: m.body || m.snippet || '',
          sentAt: m.sentAt || '',
          unread: !!m.unread,
          emailMessageId: m.id || m.messageId || null,
          navId: 'email',
          view: 'email',
          href: '/email',
          keywords: [subject, from, m.email, 'email', 'mail', 'inbox'].filter(Boolean),
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

  var cipReqCache = null;
  var cipReqPromise = null;

  function flattenRequirements(types) {
    var byKey = Object.create(null);
    (types || []).forEach(function (t) {
      (t.requirements || []).forEach(function (r) {
        if (!r || !r.label) return;
        var slot = byKey[r.key];
        if (!slot) {
          slot = byKey[r.key] = {
            type: 'page',
            label: r.label,
            title: r.label,
            cipRequirementId: r.key,
            keywords: [r.label, r.help, r.folder, r.key, 'document', 'requirement', 'cip'],
            types: [],
            retired: true,
          };
        }
        if (!r.retired) slot.retired = false;
        if (t.label && slot.types.indexOf(t.label) === -1) slot.types.push(t.label);
        [r.help, r.folder, r.label].forEach(function (word) {
          if (word && slot.keywords.indexOf(word) === -1) slot.keywords.push(word);
        });
      });
    });
    return Object.keys(byKey).map(function (key) {
      var item = byKey[key];
      var who = item.types.join(', ');
      item.subtitle = (item.retired ? 'Retired document requirement' : 'Document requirement')
        + (who ? ' · ' + who : '');
      item.keywords = item.keywords.concat(item.types).filter(Boolean);
      delete item.types;
      delete item.retired;
      return item;
    });
  }

  function loadCipRequirements() {
    if (cipReqCache) return Promise.resolve(cipReqCache);
    if (cipReqPromise) return cipReqPromise;
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    cipReqPromise = a.api(root() + '/portal/cip/requirements').then(function (data) {
      cipReqCache = flattenRequirements(data && data.types);
      cipReqPromise = null;
      return cipReqCache;
    }).catch(function () {
      cipReqPromise = null;
      return [];
    });
    return cipReqPromise;
  }

  function fetchCipDocuments(q) {
    if (!canReachCip()) return Promise.resolve([]);
    return loadCipRequirements().then(function (items) {
      var openDocs = canOpenCipDocuments();
      return items.filter(function (item) {
        return matchesQuery(haystack(item), q);
      }).slice(0, 12).map(function (item) {
        return {
          type: item.type,
          label: item.label,
          title: item.title,
          subtitle: item.subtitle,
          cipRequirementId: item.cipRequirementId,
          keywords: item.keywords,
          adminPage: openDocs ? 'cip-documents' : undefined,
          navId: openDocs ? 'account-settings' : 'clients',
          view: openDocs ? 'admin' : 'clients',
          href: openDocs
            ? '/account-settings?settings-page=cip-documents'
            : '/citizenship-applications',
        };
      });
    });
  }

  function fetchCipApplications(q) {
    if (!canReachCip()) return Promise.resolve([]);
    var a = api();
    if (!a || typeof a.api !== 'function') return Promise.resolve([]);
    var term = String(q || '').trim();
    if (term.length < 2) return Promise.resolve([]);
    return a.api(root() + '/portal/cip/applications?q=' + encodeURIComponent(term) + '&perPage=8')
      .then(function (data) {
        return ((data && data.applications) || []).slice(0, 8).map(function (app) {
          var name = app.applicantName || app.contactPerson || 'Application';
          var number = app.number || app.internalNumber || '';
          var uid = app.clientUid;
          return {
            type: 'user',
            label: name,
            title: name,
            subtitle: number ? ('CIP · ' + number) : 'CIP application',
            avatarUrl: app.photo || '',
            cipApplicationId: app.id,
            clientId: uid,
            navId: 'clients',
            view: 'clients',
            href: uid
              ? '/citizenship-applications/' + encodeURIComponent(uid)
              : '/citizenship-applications',
            keywords: [name, number, app.internalNumber, app.cipNumber, app.provider,
              app.contactPerson, 'cip', 'application'].filter(Boolean),
          };
        });
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
      settle(fetchCipDocuments(q)),
      settle(fetchCipApplications(q)),
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
    fetchLatestClients: fetchLatestClients,
    fetchLatestFiles: fetchLatestFiles,
    fetchMail: fetchMail,
    fetchLiveResults: fetchLiveResults,
    resultKey: resultKey,
    forgetCipRequirements: function () {
      cipReqCache = null;
      cipReqPromise = null;
    },
  };
})();
