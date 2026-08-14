/*
 * TMA - Clients page ( /clients )
 * Global: window.TMAClients
 */
(function () {
  'use strict';

  /*
   * Keyed DOM reconciliation (js/dom-morph.js). See dom-morph.js for why the
   * views no longer assign innerHTML, and why the wiring below binds through
   * MORPH.unwired / unwiredOne / on — nodes survive a render now, so plain
   * addEventListener in a render path stacks one handler per render.
   */
  var MORPH = window.TMAMorph || {
    patch: function (root, html) { root.innerHTML = html; },
    unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
    unwiredOne: function (root, sel) { return root.querySelector(sel); },
    on: function (el, type, fn) { if (el) el.addEventListener(type, fn); },
  };

  var AVATAR = 'images/avatars/';
  var ICON = 'images/icons/phosphor/';

  var VIEW_KEY = 'tma.clientsViewMode.v1';

  var ICONS = {
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    UserCircle: ICON + 'UserCircle.svg',
    MapPin: ICON + 'MapPin.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    Phone: ICON + 'Phone.svg',
    ShareNetwork: ICON + 'ShareNetwork.svg',
    ChatTeardropDots: ICON + 'ChatTeardropDots.svg',
    PencilSimple: ICON + 'PencilSimple.svg',
    Plus: ICON + 'Plus.svg',
    FunnelSimple: 'images/icons/tma/FunnelSimple-16.svg',
    ArrowsDownUp: 'images/icons/tma/ArrowsDownUp.svg',
    Search: 'images/icons/tma/Search-16.svg',
    Line: 'images/icons/tma/Line-16.svg',
    Close12: 'images/icons/tma/Close-12.svg',
    Briefcase: ICON + 'Briefcase.svg',
    ArrowUpRight: ICON + 'ArrowUpRight.svg',
    Buildings: ICON + 'Buildings.svg',
    Globe: ICON + 'Globe.svg',
    CalendarBlank: ICON + 'CalendarBlank.svg',
    LinkedinLogo: ICON + 'LinkedinLogo.svg',
    Trash: ICON + 'Trash.svg',
    Copy: 'images/icons/tma/Copy-16.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    CaretRight: ICON + 'CaretRight.svg',
    User: ICON + 'User.svg',
    XCircle: ICON + 'Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
    Warning20: 'images/icons/tma/ToastWarning20.svg',
    ArrowLineDown: 'images/icons/tma/ArrowLineDown-16.svg',
    CaretDown: ICON + 'CaretDown.svg',
    ArrowLineLeft: 'images/icons/tma/ArrowLineLeft-16.svg',
    ArrowLineRight: 'images/icons/tma/ArrowLineRight-16.svg',
    FolderNotch: ICON + 'FolderNotch.svg',
    FolderFilled: ICON + 'FolderFilled.svg',
    FolderEmpty: ICON + 'FolderEmpty.svg',
    TwitterLogo: ICON + 'TwitterLogo.svg',
    InstagramLogo: ICON + 'InstagramLogo.svg',
    ThreadsLogo: ICON + 'ThreadsLogo.svg',
  };

  var SOCIAL_ICONS = {
    linkedin: ICONS.LinkedinLogo,
    twitter: ICONS.TwitterLogo,
    instagram: ICONS.InstagramLogo,
    threads: ICONS.ThreadsLogo,
  };

  var SOCIAL_LABELS = {
    linkedin: 'LinkedIn',
    twitter: 'Twitter',
    instagram: 'Instagram',
    threads: 'Threads',
  };

  var PROFILE_TABS = [
    { id: 'info', label: 'Client info' },
    // The panel lists this client's files, so it is labelled for its content.
    // The id stays `folders` — it keys the panel, the tab state and the
    // File Library folder it opens onto.
    { id: 'folders', label: 'Documents' },
    { id: 'assigned', label: 'Assigned' },
    // Can this client sign in, and what have they done since. Before an
    // account exists this is where the invitation lives.
    { id: 'access', label: 'Portal access' },
  ];

  var ASSIGNMENT_LEVELS = [
    { value: 'view_only', label: 'View only' },
    { value: 'view_files', label: 'View files' },
    { value: 'contributor', label: 'Contributor' },
    { value: 'editor', label: 'Editor' },
    { value: 'manager', label: 'Manager' },
    { value: 'full', label: 'Full access' },
  ];

  /* Company roles, mirroring App\Support\Companies\CompanyRoles. A role seeds
     the permission flags; the flags are what the server actually checks. */
  var COMPANY_ROLES = [
    { value: 'primary', label: 'Primary contact' },
    { value: 'finance', label: 'Finance contact' },
    { value: 'event', label: 'Event contact' },
    { value: 'signatory', label: 'Contract signatory' },
    { value: 'viewer', label: 'Viewer' },
    { value: 'member', label: 'Service provider member' },
  ];

  /* How far a staff assignment reaches. Company-only is the default on purpose
     — the wider options are shown with what they will cover before they apply. */
  var COMPANY_SCOPES = [
    { value: 'company_only', label: 'The service provider only' },
    { value: 'existing', label: 'The service provider and its current contacts' },
    { value: 'existing_future', label: 'The service provider and all its contacts, now and in future' },
  ];


  function assignmentLevelLabel(level) {
    for (var i = 0; i < ASSIGNMENT_LEVELS.length; i++) {
      if (ASSIGNMENT_LEVELS[i].value === level) return ASSIGNMENT_LEVELS[i].label;
    }
    return level || 'Assigned';
  }

  var DATE_TYPES = [
    { value: 'birthday', label: 'Birthday' },
    { value: 'anniversary', label: 'Anniversary' },
    { value: 'custom', label: 'Custom' },
  ];

  var PHONE_TYPES = [
    { value: 'mobile', label: 'Mobile' },
    { value: 'office', label: 'Office' },
    { value: 'home', label: 'Home' },
    { value: 'fax', label: 'Fax' },
  ];

  var EMAIL_TYPES = [
    { value: 'work', label: 'Work' },
    { value: 'personal', label: 'Personal' },
    { value: 'other', label: 'Other' },
  ];

  var ADDRESS_TYPES = [
    { value: 'work', label: 'Work' },
    { value: 'home', label: 'Home' },
    { value: 'other', label: 'Other' },
  ];

  /* What the record is, mirroring Client::TYPES. An applicant is a private
     individual unless the firm says otherwise. */
  var CLIENT_TYPES = [
    { value: 'private', label: 'Private' },
    { value: 'company', label: 'Company' },
  ];

  function clientTypeLabel(value) {
    for (var i = 0; i < CLIENT_TYPES.length; i++) {
      if (CLIENT_TYPES[i].value === value) return CLIENT_TYPES[i].label;
    }
    return 'Private';
  }

  var DIRECTORY = [];
  var PROFILES = {};

  /* ── server persistence ─────────────────────────────────────────
   * The directory is populated from /portal/clients on mount and kept in
   * sync as records are created, edited, and removed. The full contact
   * record round-trips verbatim under `profile`.
   */
  var CLIENTS_ROOT = window.__TMA_SITE_ROOT || '';
  var CLIENTS_BASE = CLIENTS_ROOT + '/portal/clients';
  var COMPANIES_BASE = CLIENTS_ROOT + '/portal/companies';
  var INVITATIONS_BASE = CLIENTS_ROOT + '/portal/invitations';
  var COMPANIES = [];

  function clientsCsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function clientsFetch(url, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (opts.method && opts.method !== 'GET') headers['X-XSRF-TOKEN'] = clientsCsrf();
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
          throw err;
        }
        return data;
      });
    });
  }

  /* In-flight / warm directory share: live refresh, remount and any other
   * consumer hitting list() in the same burst reuse one network round trip. */
  var directoryPromise = null;
  var directoryCache = null;
  var directoryCacheAt = 0;
  var DIRECTORY_TTL_MS = 30000;

  var ClientsAPI = {
    list: function (opts) {
      var force = !!(opts && opts.force);
      if (!force && directoryCache && (Date.now() - directoryCacheAt) < DIRECTORY_TTL_MS) {
        return Promise.resolve(directoryCache);
      }
      if (!force && directoryPromise) return directoryPromise;
      directoryPromise = clientsFetch(CLIENTS_BASE).then(function (data) {
        directoryCache = data;
        directoryCacheAt = Date.now();
        directoryPromise = null;
        return data;
      }).catch(function (err) {
        directoryPromise = null;
        throw err;
      });
      return directoryPromise;
    },
    invalidateList: function () {
      directoryCache = null;
      directoryCacheAt = 0;
      directoryPromise = null;
    },
    // One client's full record, profile included. The listing carries no
    // profiles, so this is how a record being opened gets its detail.
    show: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid));
    },
    // Which clients match a term, as ids. Searching reaches into the profile
    // blob, which only the server holds now.
    search: function (term) {
      return clientsFetch(CLIENTS_BASE + '/search?q=' + encodeURIComponent(term));
    },
    create: function (payload) {
      return clientsFetch(CLIENTS_BASE, { method: 'POST', json: payload }).then(function (data) {
        ClientsAPI.invalidateList();
        return data;
      });
    },
    update: function (uid, payload) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid), { method: 'PATCH', json: payload })
        .then(function (data) {
          ClientsAPI.invalidateList();
          return data;
        });
    },
    remove: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid), { method: 'DELETE' })
        .then(function (data) {
          ClientsAPI.invalidateList();
          return data;
        });
    },
    bulkRemove: function (uids) {
      return clientsFetch(CLIENTS_BASE + '/bulk-delete', { method: 'POST', json: { uids: uids } })
        .then(function (data) {
          ClientsAPI.invalidateList();
          return data;
        });
    },
    duplicate: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/duplicate', { method: 'POST' })
        .then(function (data) {
          ClientsAPI.invalidateList();
          return data;
        });
    },
    assignments: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/assignments');
    },
    assign: function (uid, payload) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/assignments', {
        method: 'POST',
        json: payload,
      });
    },
    unassign: function (uid, userId) {
      return clientsFetch(
        CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/assignments/' + encodeURIComponent(userId),
        { method: 'DELETE' }
      );
    },
    invite: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/invite', { method: 'POST' });
    },
    inviteStatus: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/invite');
    },
    access: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/access');
    },
  };

  var CompanyMembersAPI = {
    list: function (uid) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) + '/members');
    },
    add: function (uid, payload) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) + '/members', {
        method: 'POST', json: payload,
      });
    },
    invite: function (uid, memberId) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) +
        '/members/' + encodeURIComponent(memberId) + '/invite', { method: 'POST' });
    },
    update: function (uid, memberId, payload) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) +
        '/members/' + encodeURIComponent(memberId), { method: 'PATCH', json: payload });
    },
    remove: function (uid, memberId) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) +
        '/members/' + encodeURIComponent(memberId), { method: 'DELETE' });
    },
  };

  var CompanyStaffAPI = {
    list: function (uid) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) + '/staff');
    },
    preview: function (uid, appliesToClients) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) + '/staff/preview', {
        method: 'POST', json: { appliesToClients: appliesToClients },
      });
    },
    assign: function (uid, payload) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) + '/staff', {
        method: 'POST', json: payload,
      });
    },
    remove: function (uid, userId) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) +
        '/staff/' + encodeURIComponent(userId), { method: 'DELETE' });
    },
  };

  var InvitationsAPI = {
    resend: function (id) {
      return clientsFetch(INVITATIONS_BASE + '/' + encodeURIComponent(id) + '/resend', { method: 'POST' });
    },
    cancel: function (id) {
      return clientsFetch(INVITATIONS_BASE + '/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
    },
    link: function (id) {
      return clientsFetch(INVITATIONS_BASE + '/' + encodeURIComponent(id) + '/link', { method: 'POST' });
    },
  };

  var CompaniesAPI = {
    list: function () { return clientsFetch(COMPANIES_BASE); },
    create: function (payload) { return clientsFetch(COMPANIES_BASE, { method: 'POST', json: payload }); },
    update: function (uid, payload) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid), { method: 'PATCH', json: payload });
    },
    remove: function (uid) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid), { method: 'DELETE' });
    },
  };

  function hydrateCompanies(records) {
    COMPANIES = (records || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function companyFor(id) {
    if (!id) return null;
    for (var i = 0; i < COMPANIES.length; i++) {
      if (COMPANIES[i].id === id) return COMPANIES[i];
    }
    return null;
  }

  function emptyCompanyDraft() {
    return { name: '', website: '', notes: '', cipCode: '' };
  }

  var clientsLoaded = false;

  function firstDirectoryItem() {
    for (var i = 0; i < DIRECTORY.length; i++) {
      if (DIRECTORY[i].items && DIRECTORY[i].items.length) return DIRECTORY[i].items[0];
    }
    return null;
  }

  // Per-client server metadata that isn't part of the editable profile:
  // the linked File Library folder and whether the client has a login.
  var CLIENT_META = {};

  function rememberMeta(rec) {
    if (!rec || !rec.id) return;
    CLIENT_META[rec.id] = {
      folderUuid: rec.folderUuid || null,
      hasLogin: !!rec.hasLogin,
      userId: rec.userId || null,
      companyId: rec.companyId || null,
      companyName: rec.companyName || null,
      clientType: rec.clientType || 'private',
      referralType: rec.referralType || 'none',
      referredByCompanyId: rec.referredByCompanyId || null,
      referredByLabel: rec.referredByLabel || null,
      // The Contact column's value, sent with the listing so the table can
      // draw a row without the profile behind it.
      contact: rec.contact || null,
    };
  }

  function clientFolderUuid(id) {
    return CLIENT_META[id] ? CLIENT_META[id].folderUuid : null;
  }

  function clientUserId(id) {
    return CLIENT_META[id] ? CLIENT_META[id].userId : null;
  }

  function clientCompanyId(id) {
    return CLIENT_META[id] ? CLIENT_META[id].companyId : null;
  }

  function clientCompanyName(id) {
    var meta = CLIENT_META[id] || {};
    if (meta.companyName) return meta.companyName;
    var profile = PROFILES[id] || {};
    return (profile.work && profile.work.company) || '';
  }

  function clientTypeOf(id) {
    return (CLIENT_META[id] && CLIENT_META[id].clientType) || 'private';
  }

  function clientReferralType(id) {
    return (CLIENT_META[id] && CLIENT_META[id].referralType) || 'none';
  }

  function clientReferrerId(id) {
    return (CLIENT_META[id] && CLIENT_META[id].referredByCompanyId) || '';
  }

  /* The referrer's name, "Private", or nothing at all — the three answers the
     Referred by column has to tell apart. */
  function clientReferralLabel(id) {
    var meta = CLIENT_META[id] || {};
    if (meta.referredByLabel) return meta.referredByLabel;
    if (meta.referralType === 'private') return 'Private';
    return '';
  }

  function isClientsAdmin() {
    var me = window.TMACurrentUser && TMACurrentUser.get && TMACurrentUser.get();
    return !!(me && me.isAdmin);
  }

  /*
   * Which profiles are actually in hand.
   *
   * The listing stopped carrying profiles — eleven thousand of them was nine
   * megabytes of JSON per page load — so a missing PROFILES entry now means
   * "not fetched yet" rather than "nothing recorded". Those are different
   * answers: most imported clients genuinely have an almost empty profile, and
   * without this flag the detail view would draw one as if it had loaded.
   */
  var PROFILES_LOADED = {};

  function profileLoaded(id) {
    return !!(id && PROFILES_LOADED[id]);
  }

  function rememberProfile(id, profile) {
    if (!id) return;
    PROFILES[id] = profile || {};
    PROFILES_LOADED[id] = true;
  }

  // Rebuild the in-memory directory from server records. Profiles already
  // fetched are kept: a live refresh re-sends the listing, and re-fetching the
  // open client's profile on every colleague's edit would be a request per
  // signal for something that has not changed.
  function hydrateClients(records) {
    DIRECTORY.length = 0;
    CLIENT_META = {};
    var seen = {};
    (records || []).forEach(function (rec) {
      if (!rec || !rec.id) return;
      seen[rec.id] = true;
      // store(), update() and duplicate() answer with a full record; the
      // listing does not, and must not overwrite what we hold with nothing.
      if (rec.profile) rememberProfile(rec.id, rec.profile);
      rememberMeta(rec);
      var item = { id: rec.id, name: rec.name || 'Client' };
      if (rec.initial) item.initial = rec.initial;
      if (rec.initialColor) item.initialColor = rec.initialColor;
      insertContact(item);
    });
    // A client somebody else deleted must not survive in the profile cache.
    Object.keys(PROFILES).forEach(function (id) {
      if (seen[id]) return;
      delete PROFILES[id];
      delete PROFILES_LOADED[id];
    });
    clientsLoaded = true;
  }

  // Open a client's main folder in the File Library (by folder uuid).
  function openClientFolder(id) {
    var uuid = clientFolderUuid(id);
    if (!uuid || !window.TMADashboard || !window.TMADashboard.navigate) return;
    var contact = directoryItemFor(id);
    window.TMADashboard.navigate({
      navId: 'folders-all',
      view: 'folders',
      title: contact ? contact.name : 'Client folder',
      crumb: 'File Library / ' + (contact ? contact.name : 'Client'),
      folderId: uuid,
    });
  }

  function clientsToast(message, state) {
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(message, { state: state || 'positive' });
    }
  }

  // The payload the server stores: the full draft as `profile`, plus the
  // display name and avatar fallback the directory list needs.
  function draftPayload(draft, id) {
    var name = displayName(draft) || 'New Client';
    var existing = directoryItemFor(id);
    var profile = cloneDraft(draft);
    delete profile.companyId;
    // Classification is a column, not part of the contact blob — same reason
    // companyId is hoisted out: the table and the filters read it directly.
    delete profile.clientType;
    delete profile.referralType;
    delete profile.referredByCompanyId;
    var company = companyFor(draft.companyId);
    if (company) {
      profile.work = profile.work || {};
      profile.work.company = company.name;
    }
    return {
      uid: id,
      name: name,
      initial: name.charAt(0).toUpperCase(),
      initialColor: (existing && existing.initialColor) || 'blue',
      companyId: draft.companyId || null,
      clientType: draft.clientType || 'private',
      referralType: draft.referralType || 'none',
      referredByCompanyId: draft.referredByCompanyId || null,
      profile: profile,
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cloneDraft(draft) {
    return JSON.parse(JSON.stringify(draft));
  }

  function emptyPhone(type) {
    return { type: type || 'mobile', value: '' };
  }

  function emptyEmail() {
    return { type: 'work', value: '' };
  }

  function emptyAddress() {
    return { type: 'work', street: '', city: '', state: '', zip: '', country: '' };
  }

  function emptyDate(type) {
    return { type: type || 'birthday', label: '', date: '' };
  }

  function emptyDraft(opts) {
    opts = opts || {};
    var companyId = opts.companyId || '';
    var company = companyFor(companyId);
    return {
      firstName: '',
      middleName: '',
      lastName: '',
      nickname: '',
      photo: '',
      phones: [emptyPhone('mobile'), emptyPhone('office')],
      emails: [emptyEmail()],
      clientType: 'private',
      referralType: opts.referralType || 'none',
      referredByCompanyId: opts.referredByCompanyId || '',
      companyId: companyId,
      work: {
        jobTitle: '',
        department: '',
        company: company ? company.name : '',
      },
      addresses: [emptyAddress()],
      importantDates: [emptyDate('birthday')],
      website: '',
      linkedIn: '',
      notes: '',
    };
  }

  function legacyToContact(item, extra) {
    extra = extra || {};
    var parts = String(item.name || '').trim().split(/\s+/);
    return {
      firstName: extra.firstName || parts[0] || '',
      middleName: extra.middleName || '',
      lastName: extra.lastName || parts.slice(1).join(' ') || '',
      nickname: extra.nickname || '',
      phones: extra.phones || [{ type: 'mobile', value: extra.phone || '' }],
      emails: extra.emails || [{ type: 'work', value: extra.email || '' }],
      work: extra.work || {
        jobTitle: extra.role || 'Team member',
        department: extra.department || '',
        company: extra.company || '',
      },
      addresses: extra.addresses || [
        { type: 'work', street: '', city: extra.location || 'Remote', state: '', zip: '', country: '' },
      ],
      website: extra.website || '',
      photo: extra.photo || '',
      importantDates: extra.importantDates || [],
      birthday: extra.birthday || '',
      linkedIn: extra.linkedIn || '',
      socials: extra.socials || [],
      notes: extra.notes || '',
    };
  }

  function directoryItemFor(id) {
    for (var i = 0; i < DIRECTORY.length; i++) {
      for (var j = 0; j < DIRECTORY[i].items.length; j++) {
        if (DIRECTORY[i].items[j].id === id) return DIRECTORY[i].items[j];
      }
    }
    return null;
  }

  function displayName(contact) {
    var parts = [contact.firstName, contact.middleName, contact.lastName].filter(Boolean);
    if (parts.length) return parts.join(' ');
    return contact.name || 'Client';
  }

  function normalizeImportantDates(contact) {
    var dates = (contact.importantDates || []).slice();
    if (!dates.length && contact.birthday) {
      dates.push({ type: 'birthday', label: '', date: contact.birthday });
    }
    return dates;
  }

  function avatarSource(item) {
    if (item.photo) return { kind: 'photo', src: item.photo };
    if (item.avatar) return { kind: 'avatar', src: AVATAR + item.avatar + '.png' };
    return { kind: 'initial', initial: item.initial, color: item.initialColor };
  }

  function contactFor(id) {
    var item = directoryItemFor(id) || firstDirectoryItem() || { id: id || '', name: '' };
    var extra = PROFILES[item.id] || {};
    var contact = legacyToContact(item, extra);
    contact.id = item.id;
    contact.name = displayName(contact);
    contact.avatar = item.avatar;
    contact.initial = item.initial;
    contact.initialColor = item.initialColor;
    contact.importantDates = normalizeImportantDates(contact);
    contact.socials = extra.socials || [];
    return contact;
  }

  function contactToDraft(contact) {
    var dates = normalizeImportantDates(contact);
    var companyId = clientCompanyId(contact.id) || '';
    return cloneDraft({
      firstName: contact.firstName,
      middleName: contact.middleName,
      lastName: contact.lastName,
      nickname: contact.nickname,
      photo: contact.photo || '',
      phones: contact.phones.length ? contact.phones : [emptyPhone()],
      emails: contact.emails.length ? contact.emails : [emptyEmail()],
      clientType: clientTypeOf(contact.id),
      referralType: clientReferralType(contact.id),
      referredByCompanyId: clientReferrerId(contact.id),
      companyId: companyId,
      work: contact.work || { jobTitle: '', department: '', company: '' },
      addresses: contact.addresses.length ? contact.addresses : [emptyAddress()],
      importantDates: dates.length ? dates : [emptyDate('birthday')],
      website: contact.website || '',
      linkedIn: contact.linkedIn || '',
      notes: contact.notes || '',
    });
  }

  function formatAddress(addr) {
    return [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  }

  function phoneTypeLabel(type) {
    var match = PHONE_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function emailTypeLabel(type) {
    var match = EMAIL_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function addressTypeLabel(type) {
    var match = ADDRESS_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function dateTypeLabel(type) {
    var match = DATE_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function dateEntryLabel(entry) {
    if (entry.type === 'custom' && entry.label) return entry.label;
    return dateTypeLabel(entry.type);
  }

  function formatDateDisplay(iso) {
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function telHref(phone) {
    return 'tel:' + String(phone).replace(/[^\d+]/g, '');
  }

  function mapsHref(address) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(formatAddress(address));
  }

  function renderAvatar(item, size) {
    size = size || 24;
    var source = avatarSource(item);
    if (source.kind === 'photo' || source.kind === 'avatar') {
      return (
        '<span class="tma-dash__clients-avatar" style="width:' + size + 'px;height:' + size + 'px">' +
        '<img src="' + esc(source.src) + '" alt="">' +
        '</span>'
      );
    }
    var uri = initialsAvatarUri(item.name, item.id);
    if (uri) {
      return (
        '<span class="tma-dash__clients-avatar" style="width:' + size + 'px;height:' + size + 'px">' +
        '<img src="' + esc(uri) + '" alt="">' +
        '</span>'
      );
    }
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue"' +
      ' style="width:' + size + 'px;height:' + size + 'px">' + esc(source.initial) + '</span>'
    );
  }

  function directoryAvatarItem(item) {
    var profile = PROFILES[item.id] || {};
    return {
      // id and name travel with it: the initials avatar is drawn from the
      // person's name and coloured by hashing it, so an avatar object that
      // dropped them rendered every row as the same grey "?".
      id: item.id,
      name: item.name,
      avatar: item.avatar,
      initial: item.initial,
      initialColor: item.initialColor,
      photo: profile.photo || '',
    };
  }

  var CONTACTS_MOBILE_BP = 1024;

  function isClientsMobile() {
    return window.innerWidth <= CONTACTS_MOBILE_BP;
  }

  function usesTableFullPage(state) {
    return state.viewMode === 'list';
  }

  function usesPagedClientsFlow(state) {
    return isClientsMobile() || usesTableFullPage(state);
  }

  function parseClientsPath(pathname) {
    var p = String(pathname || '').replace(/\/+$/, '') || '/';
    if (p === '/clients' || p === '/user-profile/clients') {
      return { screen: 'list' };
    }
    if (p === '/clients/new') {
      return { screen: 'add' };
    }
    if (p === '/clients/companies/new') {
      return { screen: 'add-company' };
    }
    var companyEditMatch = p.match(/^\/clients\/companies\/([^/]+)\/edit$/);
    if (companyEditMatch) {
      return { screen: 'edit-company', companyId: decodeURIComponent(companyEditMatch[1]) };
    }
    var companyMatch = p.match(/^\/clients\/companies\/([^/]+)$/);
    if (companyMatch) {
      return { screen: 'company', companyId: decodeURIComponent(companyMatch[1]) };
    }
    var editMatch = p.match(/^\/clients\/([^/]+)\/edit$/);
    if (editMatch) {
      return { screen: 'edit', contactId: decodeURIComponent(editMatch[1]) };
    }
    var detailMatch = p.match(/^\/clients\/([^/]+)$/);
    if (detailMatch) {
      return { screen: 'detail', contactId: decodeURIComponent(detailMatch[1]) };
    }
    if (p === '/contacts' || p === '/user-profile/contacts') {
      return { screen: 'list', legacyRedirect: true };
    }
    if (p === '/contacts/new') {
      return { screen: 'add', legacyRedirect: true };
    }
    var legacyEditMatch = p.match(/^\/contacts\/([^/]+)\/edit$/);
    if (legacyEditMatch) {
      return { screen: 'edit', contactId: decodeURIComponent(legacyEditMatch[1]), legacyRedirect: true };
    }
    var legacyDetailMatch = p.match(/^\/contacts\/([^/]+)$/);
    if (legacyDetailMatch) {
      return { screen: 'detail', contactId: decodeURIComponent(legacyDetailMatch[1]), legacyRedirect: true };
    }
    return null;
  }

  function pathForClientsScreen(screen, contactId, companyId) {
    if (screen === 'add') return '/clients/new';
    if (screen === 'add-company') return '/clients/companies/new';
    if (screen === 'edit-company' && companyId) {
      return '/clients/companies/' + encodeURIComponent(companyId) + '/edit';
    }
    if (screen === 'company' && companyId) {
      return '/clients/companies/' + encodeURIComponent(companyId);
    }
    if (screen === 'edit' && contactId) {
      return '/clients/' + encodeURIComponent(contactId) + '/edit';
    }
    if (screen === 'detail' && contactId) {
      return '/clients/' + encodeURIComponent(contactId);
    }
    return '/clients';
  }

  /*
   * What the server matched for the current term.
   *
   * Search used to run over the profiles the browser held. The listing does not
   * carry them any more, so the database answers instead and this holds the ids
   * it returned. `null` means no server answer is in play — the term is too
   * short to ask about, the request is still out, or it failed — and matching
   * falls back to the names the directory does hold.
   */
  var SEARCH_HITS = null;

  var SEARCH_HITS_TERM = '';

  /* Matches ClientsController::SEARCH_MIN. Below it, one keystroke would match
     most of the directory and the request would answer nothing. */
  var SEARCH_MIN_LENGTH = 2;

  function clearSearchHits() {
    SEARCH_HITS = null;
    SEARCH_HITS_TERM = '';
  }

  function contactMatchesSearch(item, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    // Every client's name is in hand, so it matches on the keystroke — the
    // round trip only adds the fields the browser no longer holds.
    if (item.name.toLowerCase().indexOf(q) !== -1) return true;
    if (SEARCH_HITS && SEARCH_HITS_TERM === q) return !!SEARCH_HITS[item.id];
    // While the server answer is in flight, a profile that happens to be
    // loaded — the open client, one just saved — can still match locally.
    var profile = profileLoaded(item.id) ? PROFILES[item.id] : null;
    if (!profile) return false;
    var parts = [
      profile.firstName,
      profile.lastName,
      profile.nickname,
      profile.work && profile.work.company,
      profile.work && profile.work.jobTitle,
      clientReferralLabel(item.id),
    ];
    (profile.emails || []).forEach(function (email) { if (email.value) parts.push(email.value); });
    (profile.phones || []).forEach(function (phone) { if (phone.value) parts.push(phone.value); });
    return parts.filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
  }

  /* What the Sort button offers. `name` ascending is the directory's natural
     order and stays the default. */
  var CLIENT_SORTS = [
    { value: 'name', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
    { value: 'company', label: 'Service provider' },
    { value: 'type', label: 'Type' },
  ];

  function clientSortLabel(value) {
    for (var i = 0; i < CLIENT_SORTS.length; i++) {
      if (CLIENT_SORTS[i].value === value) return CLIENT_SORTS[i].label;
    }
    return CLIENT_SORTS[0].label;
  }

  function emptyClientFilters() {
    return { referral: '', clientType: '' };
  }

  function anyClientFilter(filters) {
    return !!(filters && (filters.referral || filters.clientType));
  }

  /*
   * `referral` carries all four questions the hub is asked: any company
   * ('company'), one named company ('company:<uid>'), private individuals
   * ('private'), and nobody recorded ('none').
   */
  function clientMatchesFilters(item, filters) {
    if (!anyClientFilter(filters)) return true;

    if (filters.clientType && clientTypeOf(item.id) !== filters.clientType) return false;

    var want = filters.referral;
    if (!want) return true;

    var have = clientReferralType(item.id);
    if (want === 'company') return have === 'company';
    if (want.indexOf('company:') === 0) {
      return have === 'company' && clientReferrerId(item.id) === want.slice('company:'.length);
    }
    return have === want;
  }

  function filteredDirectoryGroups(search, filters) {
    var q = String(search || '').trim();
    if (!q && !anyClientFilter(filters)) return DIRECTORY;
    return DIRECTORY.map(function (group) {
      var items = group.items.filter(function (item) {
        return clientMatchesFilters(item, filters) && contactMatchesSearch(item, q);
      });
      if (!items.length) return null;
      return { letter: group.letter, items: items };
    }).filter(Boolean);
  }

  function filteredDirectoryItems(state) {
    var search = typeof state === 'string' ? state : (state && state.search);
    var filters = state && typeof state === 'object' ? state.filters : null;
    var removedIds = state && typeof state === 'object' ? state.removedIds : null;
    var items = [];
    filteredDirectoryGroups(search, filters).forEach(function (group) {
      group.items.forEach(function (item) {
        if (removedIds && removedIds[clientRowKey(item)]) return;
        items.push(item);
      });
    });
    return items;
  }

  function loadViewMode() {
    try {
      var saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'table') saved = 'list';
      if (saved === 'directory') saved = 'grid';
      if (saved === 'list' || saved === 'grid') return saved;
    } catch (e) { /* ignore */ }
    return 'list';
  }

  var PAGE_SIZE_KEY = 'tma.clientsPageSize.v1';

  function loadPageSize() {
    try {
      var saved = parseInt(localStorage.getItem(PAGE_SIZE_KEY), 10);
      if (CLIENTS_PAGE_SIZES.indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return CLIENTS_PAGE_SIZES[0];
  }

  function savePageSize(size) {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch (e) { /* ignore */ }
  }

  function saveViewMode(mode) {
    try {
      localStorage.setItem(VIEW_KEY, mode === 'list' ? 'list' : 'grid');
    } catch (e) { /* ignore */ }
  }

  function registerViewToggle(entry) {
    if (!window.TMATableViewToggle || !entry) return;
    window.TMATableViewToggle.register('clients', {
      getViewMode: function () { return entry.state.viewMode; },
      setViewMode: function (mode) {
        entry.state.viewMode = mode === 'list' ? 'list' : 'grid';
        saveViewMode(entry.state.viewMode);
        if (entry.state.viewMode === 'list') {
          entry.state.screen = 'list';
          entry.state.page = 1;
          if (!isClientsMobile()) {
            history.replaceState(
              {
                navId: 'clients',
                view: 'clients',
                title: 'Clients',
                crumb: 'Clients',
                clientsScreen: 'list',
                contactId: entry.state.selectedId || null,
              },
              '',
              '/clients'
            );
            if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
              window.TMADashboard.updatePageMeta({ title: 'Clients', crumb: 'Clients' });
            }
          }
        }
      },
      render: function () { entry.render({ forceFull: true }); },
    });
  }

  /* The first entry in an emails/phones list that actually holds a value. */
  function firstEntryValue(entries) {
    var list = entries || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].value) return list[i].value;
    }
    return '';
  }

  /*
   * The Contact column.
   *
   * Prefers the value the listing sends, which the server denormalises out of
   * the profile — the table has to draw eleven thousand rows without eleven
   * thousand profiles behind them. The profile is still consulted when it
   * happens to be loaded, so an open client shows an edit before the listing
   * catches up.
   */
  function primaryContactValue(id) {
    var profile = profileLoaded(id) ? PROFILES[id] : null;
    if (profile) {
      var fromProfile = firstEntryValue(profile.emails) || firstEntryValue(profile.phones);
      if (fromProfile) return fromProfile;
    }
    var meta = CLIENT_META[id];
    return (meta && meta.contact) || '—';
  }

  function clientTableColumns(item) {
    // The referrer is only a link when a company is what referred them:
    // "Private" names no record to open.
    var referrerId = clientReferralType(item.id) === 'company' ? clientReferrerId(item.id) : '';
    return {
      name: item.name,
      type: clientTypeLabel(clientTypeOf(item.id)),
      referral: clientReferralLabel(item.id) || '—',
      referrerId: referrerId,
      contact: primaryContactValue(item.id),
    };
  }

  function clientRowKey(item) {
    return item.id;
  }

  /*
   * The initials avatar the whole portal uses (TMACurrentUser.initialsFor):
   * initials on one of seven colours, picked by hashing the seed. Colour by
   * *name* rather than by the record's stored initial_color, which the
   * importer had no basis to choose and so left blue on all eleven thousand
   * — a directory where everybody is the same colour is a directory where the
   * avatar tells you nothing. Hashing means one person keeps their colour
   * across pages and reloads.
   */
  function initialsAvatarUri(name, seed) {
    var cu = window.TMACurrentUser;
    // No name means no initials and no colour — every circle would come back
    // an identical grey "?", which is worse than the letter we already have.
    if (!name || !cu || typeof cu.initialsFor !== 'function') return '';

    return cu.initialsFor(name, seed || name);
  }

  function clientAvatarMarkup(item) {
    var av = directoryAvatarItem(item);
    if (av.avatar) {
      return '<img src="' + esc(AVATAR + av.avatar + '.png') + '" alt="">';
    }
    if (av.photo) {
      return '<img src="' + esc(av.photo) + '" alt="">';
    }
    var uri = initialsAvatarUri(item.name, item.id);
    if (uri) {
      return '<img class="tma-dash__clients-avatar" style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)"' +
        ' src="' + esc(uri) + '" alt="">';
    }
    // current-user.js not loaded on this shell — keep a readable circle.
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue"' +
      ' style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)">' + esc(av.initial || '?') + '</span>'
    );
  }

  function selectedClientCount(state) {
    return Object.keys(state.selected || {}).length;
  }

  /* Employees work in the hub; how it is shaped — who may reach it, the
     service teams, the custom fields every record inherits — is the
     administrator's call, and these three open exactly those settings
     sections. Hidden rather than left to 404 in the rail. */
  function canManageClientHub() {
    var access = window.TMAPortalAccess;
    return !access || !access.canSettingsPage || access.canSettingsPage('clienthub-access');
  }

  function renderClientsHeadActions() {
    return (
      (canManageClientHub()
        ? '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
          '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--secondary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
          'Manage client hub' +
          '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
          '</button>' +
          '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--start" data-head-dropdown-menu hidden role="menu" aria-label="Manage client hub">' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:clienthub-access">Manage client hub access</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:service-teams">Manage service teams</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:custom-fields">Manage custom fields</button>' +
          '</div></div>'
        : '') +
      '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
      '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--primary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
      'Create client' +
      '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--end" data-head-dropdown-menu hidden role="menu" aria-label="Create client">' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-new">Create person</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-company">Create company</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-import">Import clients</button>' +
      '</div>' +
      '<input type="file" accept=".csv,.xlsx,.xls" class="tma-dash__clients-import-input" data-clients-import-input hidden aria-hidden="true">' +
      '</div>'
    );
  }

  function syncClientsPageActions(state, navigate) {
    var slot = document.querySelector('[data-clients-page-actions]');
    if (!slot) return;
    clientsHeadActionsNavigate = navigate;
    ensureClientsHeadActionsWiring();
    var show = state.screen === 'list';
    slot.hidden = !show;
    if (!show) {
      slot.innerHTML = '';
      if (window.TMAHeadDropdown) window.TMAHeadDropdown.closeAll();
      return;
    }
    refreshClientsHeadActions(slot);
  }

  /* Rendered once per access state, not once per mount: on a hard refresh at
     /clients the actions are drawn before /me has answered, so an
     administrator would otherwise be left without the hub controls until they
     navigated away and back. Re-rendering only when the answer changes keeps
     an open dropdown from being torn out from under the reader. */
  function refreshClientsHeadActions(slot) {
    slot = slot || document.querySelector('[data-clients-page-actions]');
    if (!slot || slot.hidden) return;
    var hub = canManageClientHub() ? '1' : '0';
    if (slot.getAttribute('data-clients-hub-actions') === hub
      && slot.querySelector('[data-head-dropdown-toggle]')) return;
    slot.innerHTML = renderClientsHeadActions();
    slot.setAttribute('data-clients-hub-actions', hub);
  }

  function renderBulkToolBtn(action, icon, label) {
    return (
      '<button type="button" class="tma-dash__tool-btn" aria-label="' + esc(label) + '" data-clients-bulk-action="' + action + '">' +
      '<img src="' + icon + '" alt=""></button>'
    );
  }

  function renderTableToolbar(state) {
    var count = selectedClientCount(state);
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';
    var filtered = anyClientFilter(state.filters);

    return (
      '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
      renderClientsCount(state) +
      '<img class="tma-dash__toolbar-divider" src="' + ICONS.Line + '" alt="" aria-hidden="true">' +
      // aria-pressed carries the lit state on its own — see the tool-btn rule.
      '<button type="button" class="tma-dash__tool-btn" aria-label="Filter" data-clients-filter' +
      ' aria-pressed="' + (filtered ? 'true' : 'false') + '" aria-expanded="false">' +
      '<img src="' + ICONS.FunnelSimple + '" alt=""></button>' +
      '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-clients-sort' +
      ' aria-pressed="' + (state.sort && state.sort !== 'name' ? 'true' : 'false') + '" aria-expanded="false">' +
      '<img src="' + ICONS.ArrowsDownUp + '" alt=""></button>' +
      '<div class="tma-dash__toolbar-bulk" data-clients-bulk' + bulkHidden + '>' +
      '<img class="tma-dash__toolbar-divider" src="' + ICONS.Line + '" alt="" aria-hidden="true">' +
      '<span class="tma-dash__toolbar-selection" data-clients-selection-count aria-live="polite">' + selectionLabel + '</span>' +
      renderBulkToolBtn('delete', ICONS.Trash, 'Delete selected clients') +
      renderBulkToolBtn('duplicate', ICONS.Copy, 'Duplicate selected clients') +
      '</div></div>' +
      renderTableSearchField(state) +
      '</div>'
    );
  }

  function updateTableToolbarSelection(root, state) {
    var count = selectedClientCount(state);
    var bulk = root.querySelector('[data-clients-bulk]');
    var label = root.querySelector('[data-clients-selection-count]');
    var toolbar = root.querySelector('.tma-dash__toolbar');
    if (!bulk || !label || !toolbar) return;
    bulk.hidden = count === 0;
    toolbar.classList.toggle('tma-dash__toolbar--selected', count > 0);
    label.textContent = count === 1 ? '1 Selected' : count + ' Selected';
  }
  function referralFilterLabel(value) {
    if (value === 'company') return 'Any service provider';
    if (value === 'private') return 'Private';
    if (value === 'none') return 'No referral';
    if (value.indexOf('company:') === 0) {
      var company = companyFor(value.slice('company:'.length));
      return company ? company.name : 'Service provider';
    }
    return '';
  }

  /* What is actually applied, as removable chips under the toolbar — the
     Users-table filter bar recipe, same as the CBI list. */
  function renderClientsFilterChips(state) {
    var filters = state.filters || {};
    var tags = [];
    if (filters.referral) {
      tags.push({ id: 'referral', label: 'Referred by: ' + referralFilterLabel(filters.referral) });
    }
    if (filters.clientType) {
      tags.push({ id: 'clientType', label: 'Type: ' + clientTypeLabel(filters.clientType) });
    }
    if (state.sort && state.sort !== 'name') {
      tags.push({ id: 'sort', label: 'Sorted by ' + clientSortLabel(state.sort), icon: ICONS.ArrowsDownUp });
    }
    if (!tags.length) return '';

    var html = tags.map(function (tag) {
      return '<div class="tma-dash__filter-tag" role="listitem" data-tag-id="' + esc(tag.id) + '">' +
        '<img src="' + (tag.icon || ICONS.FunnelSimple) + '" width="16" height="16" alt="" aria-hidden="true">' +
        '<span>' + esc(tag.label) + '</span>' +
        '<button type="button" class="tma-dash__filter-tag-remove" aria-label="Remove ' + esc(tag.label) +
        '" data-clients-remove-filter="' + esc(tag.id) + '">' +
        '<img src="' + ICONS.Close12 + '" width="6" height="6" alt=""></button></div>';
    }).join('');

    return '<div class="tma-dash__filter-bar" role="list">' + html +
      '<button type="button" class="tma-dash__filter-reset" data-clients-reset-filters>Reset</button></div>';
  }

  /*
   * Only values the directory actually holds are offered. A company that has
   * referred nobody is a filter that returns nothing, and with every referral
   * partner registered up front the list would otherwise be mostly dead ends.
   */
  function referralFacets() {
    var counts = { company: 0, private: 0, none: 0, byCompany: {} };
    DIRECTORY.forEach(function (group) {
      group.items.forEach(function (item) {
        var type = clientReferralType(item.id);
        if (type === 'company') {
          counts.company += 1;
          var cid = clientReferrerId(item.id);
          if (cid) counts.byCompany[cid] = (counts.byCompany[cid] || 0) + 1;
        } else if (type === 'private') {
          counts.private += 1;
        } else {
          counts.none += 1;
        }
      });
    });
    return counts;
  }

  /*
   * The Type counts have to agree with what the table draws, and the table
   * draws two kinds of record. A registered company is a Company row, so it
   * counts as one — reporting only the handful of *clients* flagged company
   * while sixty-four company rows sat in the list made the filter look broken,
   * because picking Company then returned far more rows than the count.
   */
  function clientTypeFacets() {
    var counts = { private: 0, company: COMPANIES.length };
    DIRECTORY.forEach(function (group) {
      group.items.forEach(function (item) {
        var type = clientTypeOf(item.id);
        counts[type] = (counts[type] || 0) + 1;
      });
    });
    return counts;
  }

  function renderSearchField(state) {
    var search = state.search || '';
    var cls = 'tma-dash__clients-search';
    if (state.searchFocused || search) cls += ' tma-dash__clients-search--focused';
    if (search) cls += ' tma-dash__clients-search--has-value';
    if (state.searchLoading) cls += ' tma-dash__clients-search--loading';

    return (
      '<div class="' + cls + '" role="search" data-clients-search-wrap>' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<input type="search" class="tma-dash__clients-search-input" data-clients-search value="' + esc(search) +
      '" placeholder="Search" aria-label="Search clients" autocomplete="off">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-clients-search-clear>' +
      '<img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      '<kbd class="tma-dash__kbd" data-clients-search-shortcut aria-hidden="true">/</kbd>' +
      '</div>'
    );
  }

  function renderTableSearchField(state) {
    var search = state.search || '';
    var cls = 'tma-dash__toolbar-search';
    if (state.searchFocused || search) cls += ' tma-dash__toolbar-search--focused';
    if (search) cls += ' tma-dash__toolbar-search--has-value';
    if (state.searchLoading) cls += ' tma-dash__toolbar-search--loading';
    var kbd = search ? '' : '<kbd class="tma-dash__kbd" data-clients-search-shortcut aria-hidden="true">/</kbd>';

    return (
      '<div class="' + cls + '" role="search" data-clients-search-wrap>' +
      '<img src="' + ICONS.Search + '" alt="">' +
      '<input type="search" class="tma-dash__search-input" data-clients-search value="' + esc(search) +
      '" placeholder="Search" aria-label="Search table" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-clients-search-clear>' +
      '<img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      kbd +
      '</div>'
    );
  }

  /*
   * The table lists both kinds of record the hub holds — the people and the
   * companies — because a company is a client too, and until now the only way
   * to reach one was to already know it existed. Companies carry no checkbox:
   * the bulk actions speak to the clients endpoint, and a company is deleted
   * from its own profile, where what that would do to its people is visible.
   */
  function companyMatchesFilters(company, filters) {
    if (!anyClientFilter(filters)) return true;
    // Nobody refers a company into the hub; a referral filter is about people.
    if (filters.referral) return false;
    return !filters.clientType || filters.clientType === 'company';
  }

  function companyMatchesSearch(company, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return [company.name, company.email, company.website, company.industry]
      .filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
  }

  // Client rows keep the bare uid as their key: it is what `selected` holds and
  // what bulk-delete posts, so a company key has to be namespaced instead.
  function tableRowEntries(state) {
    var rows = filteredDirectoryItems(state).map(function (item) {
      return { kind: 'client', key: item.id, id: item.id, name: item.name, item: item };
    });

    var filters = state && state.filters;
    var search = state && state.search;
    var removed = (state && state.removedIds) || {};
    COMPANIES.forEach(function (company) {
      if (!company || !company.id) return;
      if (!companyMatchesFilters(company, filters)) return;
      if (!companyMatchesSearch(company, search)) return;
      var key = 'company:' + company.id;
      if (removed[key]) return;
      rows.push({ kind: 'company', key: key, id: company.id, name: company.name || 'Service provider', company: company });
    });

    return sortTableRows(rows, state && state.sort);
  }

  /* Sorting the merged list. Every comparison falls back to the name so the
     order is total — otherwise two rows sharing a type swap places on every
     re-render, which reads as the table twitching. */
  function sortTableRows(rows, sort) {
    var byName = function (a, b) { return String(a.name).localeCompare(String(b.name)); };

    var keyed = function (fn) {
      return function (a, b) {
        var d = String(fn(a) || '').localeCompare(String(fn(b) || ''));
        return d !== 0 ? d : byName(a, b);
      };
    };

    if (sort === 'name-desc') return rows.sort(function (a, b) { return byName(b, a); });
    if (sort === 'company') {
      return rows.sort(keyed(function (r) {
        // Companies sort under their own name; people under their referrer.
        return r.kind === 'company' ? r.name : clientReferralLabel(r.id);
      }));
    }
    if (sort === 'type') {
      return rows.sort(keyed(function (r) {
        return r.kind === 'company' ? 'Service provider' : clientTypeLabel(clientTypeOf(r.id));
      }));
    }

    return rows.sort(byName);
  }

  // 100 first: the directory holds eleven thousand people, and ten to a page
  // made reaching anyone a hundred-click expedition.
  var CLIENTS_PAGE_SIZES = [100, 25, 50, 250, 500];

  function getTablePageData(state) {
    var items = tableRowEntries(state);
    var pageSize = clientsPageSize(state);
    var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total: items.length,
      totalPages: totalPages,
    };
  }

  /* The tinted circle with a Buildings glyph the company profile head already
     uses, at row size. */
  function companyAvatarMarkup(company) {
    if (company.logoUrl) return '<img src="' + esc(company.logoUrl) + '" alt="">';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue"' +
      ' style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)">' +
      '<img src="' + ICONS.Buildings + '" alt="" width="16" height="16"></span>'
    );
  }

  /* What a company is to the firm, in one phrase. Referrals lead, because a
     referral source that has sent 4,000 files and employs nobody here would
     otherwise read as "0 people" — the emptiest possible description of the
     busiest record in the hub. */
  function companyRowSummary(company) {
    var referred = company.referredCount || 0;
    if (referred) return referred === 1 ? '1 referred' : referred + ' referred';
    var people = company.peopleCount || 0;
    if (people) return people === 1 ? '1 person' : people + ' people';
    return '—';
  }

  function renderCompanyTableRow(company, index) {
    var contact = company.email || company.phone || '—';
    var people = companyRowSummary(company);
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body" data-clients-open-company="' + esc(company.id) +
      '" data-row-index="' + index + '" role="row">' +
      // No checkbox: the bulk actions post to the clients endpoint.
      '<div class="tma-dash__cc tma-dash__cc--check"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user">' + companyAvatarMarkup(company) +
      '<span class="tma-dash__cc-truncate">' + esc(company.name || 'Service provider') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--type"><span class="tma-dash__cc-truncate">Company</span></div>' +
      // Its own name belongs in the first column, not repeated here; what the
      // reader wants of a company at a glance is how many people it holds.
      '<div class="tma-dash__cc tma-dash__cc--referral"><span class="tma-dash__cc-truncate">' +
      esc(people) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact"><span class="tma-dash__cc-truncate">' +
      esc(contact) + '</span></div></div>'
    );
  }

  function renderFullTableRow(entry, index, checked) {
    if (entry.kind === 'company') return renderCompanyTableRow(entry.company, index);

    var item = entry.item;
    var cols = clientTableColumns(item);
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    var companyCell = cols.referrerId
      ? '<button type="button" class="tma-dash__clients-company-link tma-dash__cc-truncate" data-clients-open-company="' +
        esc(cols.referrerId) + '">' + esc(cols.referral) + '</button>'
      : '<span class="tma-dash__cc-truncate">' + esc(cols.referral) + '</span>';
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body' + selected + '" data-clients-row="' + esc(item.id) +
      '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-check' + (checked ? ' checked' : '') +
      ' aria-label="Select ' + esc(cols.name) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user">' + clientAvatarMarkup(item) +
      '<span class="tma-dash__cc-truncate">' + esc(cols.name) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--type"><span class="tma-dash__cc-truncate">' +
      esc(cols.type) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--referral">' + companyCell + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact"><span class="tma-dash__cc-truncate">' +
      esc(cols.contact) + '</span></div></div>'
    );
  }

  /*
   * Loading placeholders.
   *
   * The shared .tma-skeleton system from portal.css, shaped like the rows it
   * stands in for. A centred spinner told the reader nothing about what was
   * coming and then jumped into a full table; these hold the layout still, and
   * on a directory this size the wait is long enough to be worth furnishing.
   *
   * The widths are staggered so the block reads as a list of names rather than
   * a bar chart — deterministic, because a re-render must not reshuffle them.
   */
  var SKELETON_ROW_COUNT = 12;

  var SKELETON_WIDTHS = [68, 52, 80, 44, 62, 74, 50, 86, 58, 70, 46, 64];

  function skeletonWidth(index, spread) {
    var base = SKELETON_WIDTHS[index % SKELETON_WIDTHS.length];
    return Math.round(base * (spread || 1));
  }

  function skeletonBar(width) {
    return '<span class="tma-skeleton tma-skeleton--text" style="width:' + width + '%"></span>';
  }

  function renderTableSkeletonRows(count) {
    var rows = '';
    for (var i = 0; i < (count || SKELETON_ROW_COUNT); i++) {
      rows +=
        '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--skeleton" role="row" aria-hidden="true">' +
        '<div class="tma-dash__cc tma-dash__cc--check"></div>' +
        '<div class="tma-dash__cc tma-dash__cc--user">' +
        '<span class="tma-skeleton tma-skeleton--avatar tma-dash__clients-skeleton-avatar"></span>' +
        skeletonBar(skeletonWidth(i)) + '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--type">' + skeletonBar(skeletonWidth(i + 4, 0.7)) + '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--referral">' + skeletonBar(skeletonWidth(i + 7, 0.9)) + '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--contact">' + skeletonBar(skeletonWidth(i + 2)) + '</div>' +
        '</div>';
    }
    return rows;
  }

  /* The A–Z split view's list column, letter headings included: without them
     the column would shift down the moment the first group arrived. */
  function renderDirectorySkeleton() {
    var out = '';
    for (var g = 0; g < 3; g++) {
      out += '<div class="tma-dash__clients-letter tma-dash__clients-letter--skeleton" aria-hidden="true">' +
        '<span class="tma-skeleton" style="width:12px;height:12px"></span></div>';
      for (var i = 0; i < 4; i++) {
        out += '<div class="tma-dash__clients-row tma-dash__clients-row--skeleton" aria-hidden="true">' +
          '<span class="tma-skeleton tma-skeleton--avatar tma-dash__clients-skeleton-avatar"></span>' +
          skeletonBar(skeletonWidth(g * 4 + i)) + '</div>';
      }
    }
    return (
      '<div class="tma-dash__clients-directory-skeleton" role="status" aria-live="polite">' +
      '<span class="tma-dash__clients-sr">Loading clients…</span>' + out + '</div>'
    );
  }

  /* The detail panel, while one client's profile is being fetched. */
  function renderProfileSkeleton() {
    var rows = '';
    for (var i = 0; i < 5; i++) {
      rows += '<div class="tma-dash__clients-skeleton-line" aria-hidden="true">' +
        '<span class="tma-skeleton" style="width:20px;height:20px;border-radius:6px"></span>' +
        skeletonBar(skeletonWidth(i + 3)) + '</div>';
    }
    return (
      '<div class="tma-dash__clients-profile-skeleton" role="status" aria-live="polite">' +
      '<span class="tma-dash__clients-sr">Loading this client…</span>' +
      '<div class="tma-dash__clients-skeleton-head" aria-hidden="true">' +
      '<span class="tma-skeleton tma-skeleton--avatar" style="width:64px;height:64px"></span>' +
      '<span class="tma-skeleton tma-skeleton--text" style="width:140px;height:16px"></span>' +
      '</div>' + rows + '</div>'
    );
  }

  /* One client's profile failed to load. Distinct from an empty record, which
     is a perfectly ordinary thing for an imported client to be. */
  function renderProfileError(message, opts) {
    var retry = !opts || opts.retry !== false;
    return (
      '<div class="tma-dash__clients-profile-error" role="alert">' +
      '<img src="' + ICONS.Warning20 + '" alt="" width="20" height="20">' +
      '<p>' + esc(message || 'Could not load this client.') + '</p>' +
      (retry ? '<button type="button" class="tma-dash__clients-edit-btn" data-clients-retry-profile>Try again</button>' : '') +
      '</div>'
    );
  }

  /*
   * The three things "nothing to show" can mean, which the page used to
   * collapse into one sentence: the firm has no clients, this search or filter
   * matched none, or the directory never loaded. The last one is why staff were
   * told "No clients found" while eleven thousand clients sat in the database —
   * a failed request rendered as an empty one.
   *
   * Drawn with TMANoData, the portal's documented empty state, so the
   * illustration and spacing match every other empty list.
   */
  function renderClientsEmptyState(state) {
    if (state.loadState === 'error') {
      return (
        '<div class="tma-dash__clients-load-error" role="alert">' +
        '<img class="tma-dash__clients-load-error-art" src="images/illustrations/Illustration11.svg"' +
        ' alt="" width="120" height="120" decoding="async">' +
        '<p class="tma-dash__clients-load-error-title">Couldn’t load your clients</p>' +
        '<p class="tma-dash__clients-load-error-note">' +
        esc(state.loadError || 'The directory did not answer.') + '</p>' +
        '<button type="button" class="tma-dash__clients-message-btn" data-clients-retry>Try again</button>' +
        '</div>'
      );
    }

    var noData = window.TMANoData;
    var searching = !!String(state.search || '').trim();
    var filtered = anyClientFilter(state.filters);

    if (searching || filtered) {
      // Nothing to add here: the records exist, the query is what is wrong.
      var what = searching ? 'search' : 'filters';
      if (!noData) return 'No clients match this ' + what;
      return noData.render({
        title: 'No matches',
        subtitle: searching
          ? 'No client matches “' + state.search.trim() + '”.'
          : 'No client matches these filters.',
        illustrationName: 'Illustration19',
        showButton: false,
      });
    }

    if (!noData) return 'No clients yet';
    return noData.render({
      title: 'No clients yet',
      subtitle: 'Add your first client to get started.',
      illustrationName: 'Illustration07',
      buttonLabel: 'Add client',
      showButton: canManageClients(),
    });
  }

  /* Whether this reader may add a client — an empty state offering a button
     that 403s is worse than an empty state offering nothing. */
  function canManageClients() {
    var access = window.TMAPortalAccess;
    if (access && access.can) return !!access.can('clients.manage');
    return isClientsAdmin();
  }

  function renderFullTableRows(state) {
    if (state.loadState === 'loading') return renderTableSkeletonRows();
    var page = getTablePageData(state);
    if (!page.items.length) {
      return '<div class="tma-dash__ctr tma-dash__ctr--empty" role="row">' +
        '<div class="tma-dash__cc tma-dash__cc--empty">' + renderClientsEmptyState(state) + '</div></div>';
    }
    var start = (state.page - 1) * clientsPageSize(state);
    return page.items.map(function (entry, i) {
      return renderFullTableRow(entry, start + i, !!(state.selected && state.selected[entry.key]));
    }).join('');
  }

  function clientsPageSize(state) {
    return state.pageSize || CLIENTS_PAGE_SIZES[0];
  }

  function clientsTotalPages(state, totalRows) {
    return Math.max(1, Math.ceil(totalRows / clientsPageSize(state)));
  }

  /*
   * A window of page buttons that follows the reader.
   *
   * It used to render pages 1–5 and nothing else, so with eleven thousand
   * clients pages 6 to 111 could only be reached by pressing Next a hundred
   * times — and the last page could not be reached at all. The window now
   * centres on the current page and the ends are always one press away.
   */
  function renderClientsPagination(state, totalRows) {
    var pageSize = clientsPageSize(state);
    var totalPages = clientsTotalPages(state, totalRows);
    if (state.page > totalPages) state.page = totalPages;

    var pageBtn = function (p, label, extraClass, aria) {
      var active = p === state.page;
      return '<button type="button" class="tma-pagination__button' +
        (active ? ' tma-pagination__button--active' : '') + (extraClass || '') +
        '" aria-label="' + esc(aria || ('Page ' + p)) + '"' + (active ? ' aria-current="page"' : '') +
        ' data-page="' + p + '"><span class="tma-pagination__label">' + esc(label == null ? p : label) +
        '</span></button>';
    };

    var window_ = 5;
    var start = Math.max(1, Math.min(state.page - Math.floor(window_ / 2), totalPages - window_ + 1));
    var end = Math.min(totalPages, start + window_ - 1);

    var pages = '';
    // Keep page 1 reachable when the window has moved past it.
    if (start > 1) {
      pages += pageBtn(1);
      if (start > 2) pages += '<span class="tma-pagination__gap" aria-hidden="true">…</span>';
    }
    for (var p = start; p <= end; p++) pages += pageBtn(p);
    if (end < totalPages) {
      if (end < totalPages - 1) pages += '<span class="tma-pagination__gap" aria-hidden="true">…</span>';
      pages += pageBtn(totalPages);
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';
    // Nothing has been counted yet, so "0 results · page 1 of 1" beside a
    // skeleton table is a claim about the directory rather than a report on
    // the request — the same mistake the count above the table used to make.
    var resultsText = state.loadState === 'ready'
      ? totalRows.toLocaleString() + (totalRows === 1 ? ' result' : ' results') +
        ' · page ' + state.page.toLocaleString() + ' of ' + totalPages.toLocaleString()
      : '';

    return (
      '<div class="tma-pagination-bar tma-pagination-bar--footer" data-clients-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
      '<button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page" aria-haspopup="listbox" aria-expanded="false" data-clients-page-size>' +
      '<span class="tma-pagination__label">' + pageSize + '</span>' +
      '<img src="' + ICONS.ArrowLineDown + '" class="tma-pagination__icon" width="16" height="16" alt="" aria-hidden="true">' +
      '</button>' +
      '<span class="tma-pagination-bar__results" data-clients-results-count>' + esc(resultsText) + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="First page" data-direction="first"' + prevDisabled + '>' +
      '<img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '>' +
      '<img src="' + ICONS.CaretLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      pages +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Next page" data-direction="next"' + nextDisabled + '>' +
      '<img src="' + ICONS.CaretRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Last page" data-direction="last"' + nextDisabled + '>' +
      '<img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>'
    );
  }

  function renderTableListPage(state) {
    var page = getTablePageData(state);
    return (
      renderTableToolbar(state) +
      renderClientsFilterChips(state) +
      // The grid is wider than a narrow window; without a scroller of its own
      // the last columns are simply unreachable, and the page body scrolling
      // sideways drags the whole shell with it.
      '<div class="tma-dash__ctable-scroll" data-clients-scroll>' +
      '<div class="tma-dash__ctable tma-dash__ctable--clients" role="table" aria-label="Clients">' +
      '<div class="tma-dash__ctr tma-dash__ctr--head" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-selectall aria-label="Select all"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head" role="columnheader">Client</div>' +
      '<div class="tma-dash__cc tma-dash__cc--type tma-dash__cc--head" role="columnheader">Type</div>' +
      '<div class="tma-dash__cc tma-dash__cc--referral tma-dash__cc--head" role="columnheader">Service provider</div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact tma-dash__cc--head" role="columnheader">Contact</div>' +
      '</div>' +
      '<div data-clients-body>' + renderFullTableRows(state) + '</div>' +
      '</div></div>' +
      renderClientsPagination(state, page.total)
    );
  }

  /*
   * How many clients there are, at the head of the toolbar.
   *
   * It began as a display-sized number in its own band above the table, which
   * read as a stray fragment sitting in whitespace rather than part of the
   * page. Set at the left of the toolbar it does the same job — the first
   * number the reader wants, before they touch a control — while belonging to
   * something. When a filter is on it reports both figures, because "8,210 of
   * 11,101" is the honest answer and a bare 8,210 is not.
   */
  function renderClientsCount(state) {
    // Nothing has been counted yet, and "0 clients" beside a skeleton table is
    // a claim about the firm rather than a report on the request.
    if (state.loadState !== 'ready') {
      return (
        '<span class="tma-dash__toolbar-count" data-clients-count aria-live="polite">' +
        '<span class="tma-skeleton tma-skeleton--text" style="width:64px;display:inline-block"></span>' +
        '</span>'
      );
    }

    var total = totalClientRecords();
    var filtered = anyClientFilter(state.filters) || !!state.search;
    var shown = filtered ? tableRowEntries(state).length : total;

    return (
      '<span class="tma-dash__toolbar-count" data-clients-count aria-live="polite">' +
      '<span class="tma-dash__toolbar-count-value">' +
      esc(filtered ? shown.toLocaleString() + ' of ' + total.toLocaleString() : total.toLocaleString()) +
      '</span> ' + (total === 1 && !filtered ? 'client' : 'clients') +
      '</span>'
    );
  }

  function totalClientRecords() {
    var people = 0;
    DIRECTORY.forEach(function (group) { people += group.items.length; });
    return people + COMPANIES.length;
  }
  function renderDirectoryListBody(state) {
    if (state.loadState === 'loading') return renderDirectorySkeleton();
    var groups = filteredDirectoryGroups(state.search, state.filters);
    if (!groups.length) {
      return '<div class="tma-dash__clients-directory-empty">' +
        renderClientsEmptyState(state) + '</div>';
    }
    /*
     * Each letter and its names are one box.
     *
     * A sticky heading only sticks within its own containing block, so the
     * wrapper is what makes B rise up and push A out of the way as you scroll
     * into it. Flat siblings all pin to the same line instead and pile up
     * there — the top one still happened to read correctly, but every heading
     * scrolled past stayed in the layer underneath it.
     */
    return groups.map(function (group) {
      return (
        '<div class="tma-dash__clients-group">' +
        '<div class="tma-dash__clients-letter">' + esc(group.letter) + '</div>' +
        group.items.map(function (item) {
          var active = state.selectedId === item.id;
          return (
            '<button type="button" class="tma-dash__clients-row' + (active ? ' tma-dash__clients-row--active' : '') +
            '" data-clients-row="' + esc(item.id) + '">' +
            renderAvatar(directoryAvatarItem(item)) +
            '<span class="tma-dash__clients-row-name">' + esc(item.name) + '</span>' +
            '</button>'
          );
        }).join('') +
        '</div>'
      );
    }).join('');
  }

  function renderDirectoryBody(state) {
    return renderDirectoryListBody(state);
  }

  function renderDirectoryHead(state) {
    return (
      '<div class="tma-dash__clients-directory-head">' +
      renderSearchField(state) +
      '</div>'
    );
  }

  function renderDirectory(state, standalone) {
    var standaloneClass = standalone !== false ? ' tma-dash__clients-directory--standalone' : '';
    return (
      '<div class="tma-dash__clients-directory' + standaloneClass + '">' +
      renderDirectoryHead(state) +
      '<div class="tma-dash__clients-directory-body">' +
      renderDirectoryBody(state) +
      '</div></div>'
    );
  }

  function renderListPage(state) {
    return (
      '<div class="tma-dash__clients-page tma-dash__clients-page--list" data-node-id="clients-page">' +
      renderDirectory(state, true) +
      '</div>'
    );
  }

  function renderDetailContent(state, opts) {
    opts = opts || {};
    if (state.screen === 'add-company' || state.screen === 'edit-company') {
      return renderCompanyFormPanel(state, opts);
    }
    if (state.screen === 'company') {
      return renderCompanyProfile(state, opts);
    }
    if (state.adding || state.editing) {
      return renderContactFormPanel(state, opts);
    }
    if (!state.selectedId) {
      return '<div class="tma-dash__clients-detail"><div class="tma-dash__clients-assigned-empty">Select a client to view details.</div></div>';
    }
    return renderProfile(state, opts);
  }

  /*
   * The directory column was a fixed 208px, which is fine for "Jane Smith" and
   * useless for "AASHA MORSHED ABDELAZIZ ELATI" — the caseload is full of the
   * latter and they wrapped to four lines. The reader sets the width instead,
   * with the same handle the Messages inbox uses.
   *
   * The default is 40% wider than the original 208px. The key is versioned so
   * that lands for everyone: a stored v1 width was the old default for anybody
   * who never touched the handle, and reading it back would have kept the
   * narrow column on every screen it was already wrong on. The floor is
   * unchanged, so the list can still be dragged well below the new default.
   */
  var DIR_WIDTH_KEY = 'tma.clientsDirectoryWidth.v2';
  var DIR_WIDTH_DEFAULT = 291;
  var DIR_WIDTH_MIN = 180;
  var DIR_WIDTH_MAX = 560;

  function clampDirWidth(px, layoutWidth) {
    var max = DIR_WIDTH_MAX;
    // Never let the list crowd the detail pane below a readable width.
    if (layoutWidth) max = Math.min(max, layoutWidth - 420);
    if (max < DIR_WIDTH_MIN) max = DIR_WIDTH_MIN;
    return Math.max(DIR_WIDTH_MIN, Math.min(px, max));
  }

  function loadDirWidth() {
    try {
      var v = parseInt(localStorage.getItem(DIR_WIDTH_KEY), 10);
      if (!isNaN(v)) return v;
    } catch (e) { /* ignore */ }
    return DIR_WIDTH_DEFAULT;
  }

  function saveDirWidth(px) {
    try { localStorage.setItem(DIR_WIDTH_KEY, String(Math.round(px))); } catch (e) { /* ignore */ }
  }

  function renderClientsResizer(state) {
    var w = typeof state.dirWidth === 'number' ? state.dirWidth : DIR_WIDTH_DEFAULT;
    return (
      '<div class="tma-dash__clients-resizer" data-clients-resizer role="separator"' +
      ' aria-orientation="vertical" aria-label="Resize the client list" tabindex="0"' +
      ' aria-valuemin="' + DIR_WIDTH_MIN + '" aria-valuemax="' + DIR_WIDTH_MAX + '"' +
      ' aria-valuenow="' + Math.round(w) + '"></div>'
    );
  }

  function renderDesktopPage(state) {
    if (typeof state.dirWidth !== 'number') state.dirWidth = loadDirWidth();
    return (
      '<div class="tma-dash__clients-page" data-node-id="clients-page"' +
      ' style="--clients-dir-w:' + Math.round(state.dirWidth) + 'px">' +
      renderDirectory(state, false) +
      renderClientsResizer(state) +
      renderDetailContent(state) +
      '</div>'
    );
  }

  /*
   * Sets the width variable live during a drag rather than re-rendering, and
   * only writes the preference on release — re-rendering per pointermove would
   * rebuild the whole directory on every pixel. Re-run after each render; the
   * stored cleanup keeps listeners from stacking.
   */
  function attachClientsResizer(root, state) {
    if (root._clientsResizeCleanup) {
      root._clientsResizeCleanup();
      root._clientsResizeCleanup = null;
    }

    var layout = root.querySelector('.tma-dash__clients-page');
    var resizer = root.querySelector('[data-clients-resizer]');
    if (!layout || !resizer) return;

    if (typeof state.dirWidth !== 'number') state.dirWidth = loadDirWidth();

    function apply(px) {
      layout.style.setProperty('--clients-dir-w', Math.round(px) + 'px');
      resizer.setAttribute('aria-valuenow', String(Math.round(px)));
    }

    function widthFrom(clientX) {
      var rect = layout.getBoundingClientRect();
      if (rect.width <= 0) return state.dirWidth;
      return clampDirWidth(clientX - rect.left, rect.width);
    }

    var dragging = false;

    function onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      resizer.classList.add('tma-dash__clients-resizer--dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      if (typeof resizer.setPointerCapture === 'function') resizer.setPointerCapture(e.pointerId);
      state.dirWidth = widthFrom(e.clientX);
      apply(state.dirWidth);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      e.preventDefault();
      state.dirWidth = widthFrom(e.clientX);
      apply(state.dirWidth);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('tma-dash__clients-resizer--dragging');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      if (typeof resizer.releasePointerCapture === 'function' &&
          resizer.hasPointerCapture && resizer.hasPointerCapture(e.pointerId)) {
        resizer.releasePointerCapture(e.pointerId);
      }
      saveDirWidth(state.dirWidth);
    }

    function onKeyDown(e) {
      var step = 24;
      var w = layout.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') state.dirWidth = clampDirWidth((state.dirWidth || DIR_WIDTH_DEFAULT) - step, w);
      else if (e.key === 'ArrowRight') state.dirWidth = clampDirWidth((state.dirWidth || DIR_WIDTH_DEFAULT) + step, w);
      else if (e.key === 'Home') state.dirWidth = DIR_WIDTH_MIN;
      else if (e.key === 'End') state.dirWidth = clampDirWidth(DIR_WIDTH_MAX, w);
      else return;
      e.preventDefault();
      apply(state.dirWidth);
      saveDirWidth(state.dirWidth);
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    resizer.addEventListener('keydown', onKeyDown);

    root._clientsResizeCleanup = function () {
      resizer.removeEventListener('pointerdown', onPointerDown);
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      resizer.removeEventListener('keydown', onKeyDown);
    };
  }

  function renderClientsBackBtn() {
    return (
      '<button type="button" class="tma-dash__clients-back-btn" data-clients-back aria-label="Back to clients">' +
      '<img src="' + ICONS.CaretLeft + '" alt="" aria-hidden="true">' +
      '<span>Clients</span>' +
      '</button>'
    );
  }

  function contactProfileSubtitle(c) {
    if (!c) return '';
    return [c.nickname ? '"' + c.nickname + '"' : '', c.work && c.work.jobTitle, c.work && c.work.company]
      .filter(Boolean)
      .join(' · ');
  }

  function renderContactProfileToolbar(c, state) {
    if (!c) return '';
    var subtitle = contactProfileSubtitle(c);
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + renderAvatar(c, 40) +
      '<div class="tma-dash__clients-profile-ident">' +
      '<span class="tma-dash__clients-profile-name">' + esc(c.name) + '</span>' +
      (subtitle ? '<span class="tma-dash__clients-profile-subtitle">' + esc(subtitle) + '</span>' : '') +
      '</div></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      (clientFolderUuid(c.id)
        ? '<button type="button" class="tma-dash__clients-message-btn" data-clients-open-folder>' +
          '<img src="' + ICONS.FolderNotch + '" alt=""><span>Open folder</span></button>'
        : '') +
      inviteToolbarBtn(c, state) +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit>' +
      '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-message>' +
      '<img src="' + ICONS.ChatTeardropDots + '" alt=""><span>Message</span></button>' +
      // Last in the row: it is the one action that leaves the page, so it
      // reads as the way out rather than another thing to do here.
      cbiToolbarBtn(c) +
      '</div></div>'
    );
  }

  /*
   * Straight to this person's citizenship file, beside Edit and Message.
   *
   * The link was only a row in the info list, which meant the one thing a case
   * worker opens a CBI client's record to reach was buried under their phone
   * numbers. Hidden from anyone without cbi.view — the module is still
   * admin-only, and a button that 403s is worse than no button.
   */
  function cbiToolbarBtn(c) {
    if (!c) return '';
    var cbi = (PROFILES[c.id] || {}).cbi;
    if (!cbi || !cbi.applicationUuid) return '';

    var access = window.TMAPortalAccess;
    if (access && access.can && !access.can('cbi.view')) return '';

    return (
      // Spelled out rather than "CBI": the toolbar is read by people who do
      // not live in the module, and the arrow says it leaves this page.
      '<a class="tma-dash__clients-edit-btn tma-dash__clients-edit-btn--accent" href="' +
      esc((window.__TMA_SITE_ROOT || '') + '/cbi#/app/' + encodeURIComponent(cbi.applicationUuid)) +
      '" title="' + esc('Open the Citizenship by Investment file' +
        (cbi.applicantNumber ? ' ' + cbi.applicantNumber : '')) + '">' +
      '<img src="' + ICONS.ArrowUpRight + '" alt="">' +
      '<span>Citizenship by Investment file</span></a>'
    );
  }

  /* Invite / resend, right next to Edit and Message.
     This used to live only inside the Assigned tab, which meant the one action
     staff reach for when a client says "I never got the email" was three clicks
     down a tab nobody opens. It belongs on the toolbar. */
  function inviteToolbarBtn(c, state) {
    // Nothing to offer if they can already sign in, or if we have no address
    // to send to. Reaching the client hub at all already means `clients.invite`
    // — and the server re-checks it regardless.
    if (!c || c.hasLogin || !clientPrimaryEmail(c)) return '';

    var inv = state ? state.invitation : null;
    var pending = inv && inv.status !== 'accepted' && (inv.canResend || inv.canCancel);

    return '<button type="button" class="tma-dash__clients-message-btn" data-clients-invite-toolbar>' +
      '<img src="' + ICONS.EnvelopeSimple + '" alt=""><span>' +
      (pending ? 'Resend invite' : 'Invite to portal') + '</span></button>';
  }

  function renderCompanyProfileToolbar(company) {
    if (!company) return '';
    var peopleCount = (company.people || []).length;
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' +
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:40px;height:40px">' +
      '<img src="' + ICONS.Buildings + '" alt="" width="20" height="20"></span>' +
      '<div class="tma-dash__clients-profile-ident">' +
      '<span class="tma-dash__clients-profile-name">' + esc(company.name) + '</span>' +
      '<span class="tma-dash__clients-profile-subtitle">' +
      esc(peopleCount + (peopleCount === 1 ? ' person' : ' people')) +
      '</span></div></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit-company>' +
      '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-add-person>' +
      '<img src="' + ICONS.Plus + '" alt=""><span>Add person</span></button>' +
      '</div></div>'
    );
  }

  function renderContactFormToolbar(state) {
    var draft = state.draft || emptyDraft({ companyId: state.prefillCompanyId || '' });
    var isNew = !!state.adding;
    var contact = isNew ? null : contactFor(state.selectedId);
    var title = isNew ? 'New person' : 'Edit person';
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + renderFormHeadAvatar(draft, contact, isNew) +
      '<span class="tma-dash__clients-profile-name">' + esc(title) + '</span></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-save>' + (isNew ? 'Add' : 'Save') + '</button>' +
      '</div></div>'
    );
  }

  function renderCompanyFormToolbar(state) {
    var isNew = state.screen === 'add-company';
    var title = isNew ? 'New service provider' : 'Edit service provider';
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' +
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:40px;height:40px">' +
      '<img src="' + ICONS.Buildings + '" alt="" width="20" height="20">' +
      '</span>' +
      '<span class="tma-dash__clients-profile-name">' + esc(title) + '</span></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-save-company>' + (isNew ? 'Create' : 'Save') + '</button>' +
      '</div></div>'
    );
  }

  function renderElevatedDetailChrome(state) {
    var toolbar = '';
    if (state.screen === 'detail' && state.selectedId) {
      toolbar = renderContactProfileToolbar(contactFor(state.selectedId), state);
    } else if (state.screen === 'company' && state.companyId) {
      toolbar = renderCompanyProfileToolbar(companyFor(state.companyId));
    } else if (state.screen === 'add' || state.screen === 'edit') {
      toolbar = renderContactFormToolbar(state);
    } else if (state.screen === 'add-company' || state.screen === 'edit-company') {
      toolbar = renderCompanyFormToolbar(state);
    }
    return renderClientsBackBtn() + (toolbar || '');
  }

  /* Full-page detail: put identity + actions in the global page-title row. */
  function syncClientsDetailHead(state) {
    var left = document.querySelector('.tma-dash__main-head-left');
    if (!left) return;
    var titleEl = left.querySelector('[data-page-title]');
    var host = left.querySelector('[data-clients-detail-head]');
    var show = usesPagedClientsFlow(state) && state.screen !== 'list';

    if (!show) {
      if (host) {
        host.hidden = true;
        host.innerHTML = '';
      }
      if (titleEl) {
        titleEl.hidden = false;
        titleEl.style.removeProperty('display');
      }
      left.classList.remove('tma-dash__main-head-left--clients-detail');
      return;
    }

    if (!host) {
      host = document.createElement('div');
      host.className = 'tma-dash__clients-detail-head';
      host.setAttribute('data-clients-detail-head', '');
      left.appendChild(host);
    }
    host.hidden = false;
    host.innerHTML = renderElevatedDetailChrome(state);
    if (titleEl) {
      titleEl.hidden = true;
      titleEl.style.display = 'none';
    }
    left.classList.add('tma-dash__main-head-left--clients-detail');
  }

  function clientsDetailHeadRoot() {
    return document.querySelector('[data-clients-detail-head]');
  }

  function unwiredClientsChrome(root, selector) {
    var el = MORPH.unwiredOne(root, selector);
    if (el) return el;
    var head = clientsDetailHeadRoot();
    return head ? MORPH.unwiredOne(head, selector) : null;
  }

  function unwiredAllClientsChrome(root, selector) {
    var list = MORPH.unwired(root, selector);
    var head = clientsDetailHeadRoot();
    if (head) {
      MORPH.unwired(head, selector).forEach(function (el) {
        if (list.indexOf(el) === -1) list.push(el);
      });
    }
    return list;
  }

  function renderDetailPage(state) {
    return (
      '<div class="tma-dash__clients-page tma-dash__clients-page--detail" data-node-id="clients-page">' +
      renderDetailContent(state, { elevateToolbar: true }) +
      '</div>'
    );
  }

  function renderSelectOptions(types, selected) {
    return types.map(function (t) {
      return '<option value="' + esc(t.value) + '"' + (t.value === selected ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    }).join('');
  }

  function renderFormField(label, field, value, opts) {
    opts = opts || {};
    return (
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">' + esc(label) + '</span>' +
      '<input type="' + esc(opts.type || 'text') + '" class="tma-dash__clients-field-input" data-clients-field="' +
      esc(field) + '" value="' + esc(value || '') + '"' + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
      '</label>'
    );
  }

  function renderCompanySelect(selectedId) {
    var opts = '<option value="">No company</option>' +
      COMPANIES.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === selectedId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');
    return (
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">Company</span>' +
      '<select class="tma-dash__clients-field-select tma-dash__clients-field-select--full" data-clients-company-id>' +
      opts +
      '</select></label>'
    );
  }

  function renderClientTypeSelect(draft) {
    var selected = draft.clientType || 'private';
    return (
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">Client type</span>' +
      '<select class="tma-dash__clients-field-select tma-dash__clients-field-select--full" data-clients-client-type>' +
      renderSelectOptions(CLIENT_TYPES, selected) +
      '</select></label>'
    );
  }

  /* One control for all three answers. Splitting "who referred them" across a
     source picker and a company picker asks the reader to keep two fields
     consistent; a single list cannot be left half-set. */
  function renderReferralSelect(draft) {
    var selected = draft.referralType === 'company' && draft.referredByCompanyId
      ? 'company:' + draft.referredByCompanyId
      : (draft.referralType || 'none');

    var companyOpts = COMPANIES.map(function (c) {
      var value = 'company:' + c.id;
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' +
        esc(c.name) + '</option>';
    }).join('');

    return (
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">Referred by</span>' +
      '<select class="tma-dash__clients-field-select tma-dash__clients-field-select--full" data-clients-referral>' +
      '<option value="none"' + (selected === 'none' ? ' selected' : '') + '>No referral</option>' +
      '<option value="private"' + (selected === 'private' ? ' selected' : '') + '>Private</option>' +
      (companyOpts ? '<optgroup label="Service providers">' + companyOpts + '</optgroup>' : '') +
      '</select></label>'
    );
  }

  function renderFormSection(title, content) {
    return (
      '<section class="tma-dash__clients-form-section">' +
      '<h3 class="tma-dash__clients-form-section-title">' + esc(title) + '</h3>' +
      content +
      '</section>'
    );
  }

  function renderPhoneRows(phones) {
    return phones.map(function (phone, i) {
      return (
        '<div class="tma-dash__clients-form-row" data-clients-phone-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-phone-type="' + i + '">' +
        renderSelectOptions(PHONE_TYPES, phone.type) +
        '</select>' +
        '<input type="tel" class="tma-dash__clients-field-input" data-clients-phone-value="' + i +
        '" value="' + esc(phone.value) + '" placeholder="Phone number">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="phones" data-clients-index="' + i +
        '" aria-label="Remove phone"' + (phones.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderEmailRows(emails) {
    return emails.map(function (email, i) {
      return (
        '<div class="tma-dash__clients-form-row" data-clients-email-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-email-type="' + i + '">' +
        renderSelectOptions(EMAIL_TYPES, email.type) +
        '</select>' +
        '<input type="email" class="tma-dash__clients-field-input" data-clients-email-value="' + i +
        '" value="' + esc(email.value) + '" placeholder="Email address">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="emails" data-clients-index="' + i +
        '" aria-label="Remove email"' + (emails.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderAddressBlocks(addresses) {
    return addresses.map(function (addr, i) {
      return (
        '<div class="tma-dash__clients-address-block" data-clients-address-row="' + i + '">' +
        '<div class="tma-dash__clients-address-block-head">' +
        '<select class="tma-dash__clients-field-select" data-clients-address-type="' + i + '">' +
        renderSelectOptions(ADDRESS_TYPES, addr.type) +
        '</select>' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="addresses" data-clients-index="' + i +
        '" aria-label="Remove address"' + (addresses.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>' +
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Street', 'address-street-' + i, addr.street, { placeholder: 'Street address' }) +
        renderFormField('City', 'address-city-' + i, addr.city, { placeholder: 'City' }) +
        renderFormField('State / Province', 'address-state-' + i, addr.state, { placeholder: 'State' }) +
        renderFormField('ZIP / Postal code', 'address-zip-' + i, addr.zip, { placeholder: 'ZIP' }) +
        renderFormField('Country', 'address-country-' + i, addr.country, { placeholder: 'Country' }) +
        '</div></div>'
      );
    }).join('');
  }

  function renderAddGroupButton(group, label) {
    return (
      '<button type="button" class="tma-dash__clients-add-group" data-clients-add-group="' + esc(group) + '">' +
      '<img src="' + ICONS.Plus + '" alt=""><span>' + esc(label) + '</span></button>'
    );
  }

  function renderDateRows(dates) {
    return dates.map(function (entry, i) {
      var isCustom = entry.type === 'custom';
      return (
        '<div class="tma-dash__clients-form-row tma-dash__clients-form-row--dates" data-clients-date-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-date-type="' + i + '">' +
        renderSelectOptions(DATE_TYPES, entry.type) +
        '</select>' +
        '<input type="text" class="tma-dash__clients-field-input tma-dash__clients-date-label' +
        (isCustom ? '' : ' tma-dash__clients-date-label--hidden') + '" data-clients-date-label="' + i +
        '" value="' + esc(entry.label) + '" placeholder="Custom label"' + (isCustom ? '' : ' disabled') + '>' +
        '<input type="date" class="tma-dash__clients-field-input" data-clients-date-value="' + i +
        '" value="' + esc(entry.date) + '">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="importantDates" data-clients-index="' + i +
        '" aria-label="Remove date"' + (dates.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderPhotoField(draft) {
    var hasPhoto = !!draft.photo;
    return (
      '<div class="tma-dash__clients-photo">' +
      '<input type="file" accept="image/*" class="tma-dash__clients-photo-input" data-clients-photo-input aria-hidden="true">' +
      '<div class="tma-dash__clients-photo-wrap">' +
      '<button type="button" class="tma-dash__clients-photo-btn"' + (hasPhoto ? ' data-has-image="true"' : '') + ' data-clients-photo-btn>' +
      '<img src="' + ICONS.User + '" alt="" class="tma-dash__clients-photo-placeholder" width="40" height="40">' +
      '<img alt="" class="tma-dash__clients-photo-preview" data-clients-photo-preview width="80" height="80"' +
      (hasPhoto ? ' src="' + esc(draft.photo) + '"' : '') + '>' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-photo-remove" data-clients-photo-remove aria-label="Remove photo">' +
      '<img src="' + ICONS.XCircle + '" alt="" class="tma-dash__clients-photo-remove-icon" width="20" height="20">' +
      '</button></div>' +
      '<p class="tma-dash__clients-photo-hint">Upload a photo for this client. JPG or PNG recommended.</p>' +
      '</div>'
    );
  }

  function renderFormHeadAvatar(draft, contact, isNew) {
    if (draft.photo) {
      return (
        '<span class="tma-dash__clients-avatar" style="width:40px;height:40px">' +
        '<img src="' + esc(draft.photo) + '" alt="">' +
        '</span>'
      );
    }
    if (!isNew && contact) return renderAvatar(contact, 40);
    var initial = draft.firstName ? draft.firstName.charAt(0).toUpperCase() : '+';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:40px;height:40px">' +
      esc(initial) + '</span>'
    );
  }

  function renderContactForm(draft) {
    return (
      '<form class="tma-dash__clients-form" data-clients-form novalidate>' +
      renderFormSection('Photo', renderPhotoField(draft)) +
      renderFormSection(
        'Name',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('First name', 'firstName', draft.firstName) +
        renderFormField('Middle name', 'middleName', draft.middleName) +
        renderFormField('Last name', 'lastName', draft.lastName) +
        renderFormField('Nickname', 'nickname', draft.nickname) +
        '</div>'
      ) +
      renderFormSection(
        'Classification',
        '<div class="tma-dash__clients-form-grid">' +
        renderClientTypeSelect(draft) +
        renderReferralSelect(draft) +
        '</div>'
      ) +
      renderFormSection(
        'Phone numbers',
        '<div class="tma-dash__clients-form-rows" data-clients-phones>' + renderPhoneRows(draft.phones) + '</div>' +
        renderAddGroupButton('phones', 'Add phone number')
      ) +
      renderFormSection(
        'Email addresses',
        '<div class="tma-dash__clients-form-rows" data-clients-emails>' + renderEmailRows(draft.emails) + '</div>' +
        renderAddGroupButton('emails', 'Add email address')
      ) +
      renderFormSection(
        'Work',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Job title', 'jobTitle', draft.work.jobTitle) +
        renderFormField('Department', 'department', draft.work.department) +
        renderCompanySelect(draft.companyId || '') +
        '</div>'
      ) +
      renderFormSection(
        'Addresses',
        '<div class="tma-dash__clients-form-addresses" data-clients-addresses>' + renderAddressBlocks(draft.addresses) + '</div>' +
        renderAddGroupButton('addresses', 'Add address')
      ) +
      renderFormSection(
        'Important dates',
        '<div class="tma-dash__clients-form-rows" data-clients-dates>' + renderDateRows(draft.importantDates) + '</div>' +
        renderAddGroupButton('importantDates', 'Add date')
      ) +
      renderFormSection(
        'Additional',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Website', 'website', draft.website, { type: 'url', placeholder: 'https://' }) +
        renderFormField('LinkedIn', 'linkedIn', draft.linkedIn, { type: 'url', placeholder: 'https://linkedin.com/in/' }) +
        '</div>' +
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Notes</span>' +
        '<textarea class="tma-dash__clients-field-textarea" data-clients-field="notes" rows="4" placeholder="Add notes about this client">' +
        esc(draft.notes) +
        '</textarea></label>'
      ) +
      '</form>'
    );
  }

  function renderContactFormPanel(state, opts) {
    opts = opts || {};

    // Editing a client whose profile is still in flight: the form has nothing
    // truthful to put in its fields yet, and an empty one invites a save that
    // would erase the record. See applyScreen.
    if (state.editing && state.selectedId && !profileLoaded(state.selectedId)) {
      return (
        '<div class="tma-dash__clients-detail">' +
        '<div class="tma-dash__clients-profile tma-dash__clients-profile--form' +
        (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
        (state.profileError
          ? renderProfileError(state.profileError, { retry: !state.profileErrorFinal })
          : renderProfileSkeleton()) +
        '</div></div>'
      );
    }

    var draft = state.draft || emptyDraft({ companyId: state.prefillCompanyId || '' });
    var toolbar = opts.elevateToolbar ? '' : renderContactFormToolbar(state);

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile tma-dash__clients-profile--form' +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      toolbar +
      renderContactForm(draft) +
      '</div></div>'
    );
  }

  function renderCompanyFormPanel(state, opts) {
    opts = opts || {};
    var draft = state.companyDraft || emptyCompanyDraft();
    var toolbar = opts.elevateToolbar ? '' : renderCompanyFormToolbar(state);
    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile tma-dash__clients-profile--form' +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      toolbar +
      '<form class="tma-dash__clients-form" data-clients-company-form novalidate>' +
      renderFormSection(
        'Service provider',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Service provider name', 'companyName', draft.name) +
        renderFormField('Website', 'companyWebsite', draft.website, { type: 'url', placeholder: 'https://' }) +
        renderFormField('CIP code', 'companyCipCode', draft.cipCode, { placeholder: 'GAL' }) +
        '</div>' +
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Notes</span>' +
        '<textarea class="tma-dash__clients-field-textarea" data-clients-field="companyNotes" rows="4" placeholder="Notes about this company">' +
        esc(draft.notes || '') +
        '</textarea></label>'
      ) +
      '</form></div></div>'
    );
  }

  /*
   * Cards, not one long scroll of headings.
   *
   * The page was a stack of labelled sections running the full width, each a
   * line or two of content followed by a lot of nothing — a long way to travel
   * to learn very little. The two short ones pair up on a wide screen; the
   * lists that can grow take the full width. Empty sections show an
   * illustration rather than a sentence of apology.
   */
  function renderCompanyProfile(state, opts) {
    opts = opts || {};
    var company = companyFor(state.companyId);
    if (!company) {
      return '<div class="tma-dash__clients-detail">' +
        clientsEmpty('You’re not assigned to this service provider.', 'Illustration07') + '</div>';
    }

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile tma-dash__clients-profile--company' +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      (opts.elevateToolbar ? '' : renderCompanyProfileToolbar(company)) +
      '<div class="tma-dash__clients-cards">' +
      // The top row is always two columns: Details can always answer for
      // itself, and Access always has at least its form.
      // Details spans, then two pairs. The wide one first because it is what
      // identifies the company; the pairs below are the four things you do
      // with it.
      companyCard('Details', renderCompanyDetails(company), {}) +
      companyCard('Clients referred', renderCompanyReferredBlock(company), {
        half: true, count: company.referredCount || 0,
      }) +
      companyCard('Access', renderCompanyMembersBlock(state, company), { half: true }) +
      companyCard('People', renderCompanyPeople(company), {
        half: true, count: (company.people || []).length,
      }) +
      companyCard('Assigned staff', renderCompanyStaffBlock(state, company), { half: true }) +
      '</div></div></div>'
    );
  }

  /* One section. `half` pairs with its neighbour on a wide screen; the rest
     run full width. */
  function companyCard(title, body, opts) {
    opts = opts || {};
    if (!body) return '';
    return (
      '<section class="tma-dash__clients-card' + (opts.half ? ' tma-dash__clients-card--half' : '') + '">' +
      '<header class="tma-dash__clients-card-head">' +
      '<h3 class="tma-dash__clients-card-title">' + esc(title) + '</h3>' +
      (opts.count ? '<span class="tma-dash__clients-card-count">' + opts.count.toLocaleString() + '</span>' : '') +
      '</header>' + body + '</section>'
    );
  }

  /* The documented empty state (portal-views.js): an illustration and four
     words, instead of a grey apology. */
  function clientsEmpty(title, illustration) {
    var ui = window.TMAPortalUI;
    if (ui && ui.emptyState) return ui.emptyState({ title: title, illustration: illustration });
    return '<div class="tma-dash__clients-assigned-empty">' + esc(title) + '</div>';
  }

  function companyPersonRow(p) {
    return (
      '<button type="button" class="tma-dash__clients-row" data-clients-row="' + esc(p.id) + '">' +
      clientAvatarMarkup(p) +
      '<span class="tma-dash__clients-row-name">' + esc(p.name) + '</span>' +
      (p.email ? '<span class="tma-dash__clients-row-meta">' + esc(p.email) + '</span>' : '') +
      '</button>'
    );
  }

  function renderCompanyPeople(company) {
    var people = company.people || [];
    if (!people.length) return clientsEmpty('No contacts yet', 'Illustration04');

    return '<div class="tma-dash__clients-company-people">' +
      people.map(companyPersonRow).join('') + '</div>';
  }

  /*
   * The clients this company sent us — what a referral partner's page is for,
   * and which the page used to answer with "No people at this company yet".
   * Only the first dozen travel in the record; the rest are one click away in
   * the directory, filtered to this company.
   */
  function renderCompanyReferredBlock(company) {
    var total = company.referredCount || 0;
    if (!total) return clientsEmpty('No referrals yet', 'Illustration07');

    var shown = company.referred || [];
    return '<div class="tma-dash__clients-company-people">' +
      shown.map(companyPersonRow).join('') + '</div>' +
      (total > shown.length
        ? '<button type="button" class="tma-dash__clients-see-all" data-clients-see-referred="' +
          esc(company.id) + '">See all ' + total.toLocaleString() + '</button>'
        : '');
  }

  /*
   * The company at a glance, always with something in it.
   *
   * It used to drop every blank row and return nothing at all when a company
   * had no type, industry or phone — which is every company the CBI import
   * created. An empty Details card meant the top row never paired up, so the
   * page had no two-column row anywhere. The first four rows are always
   * answerable from what we hold; the rest still only appear when filled.
   */
  function renderCompanyDetails(company) {
    var website = company.website
      ? { icon: ICONS.Globe, label: 'Website', value: company.website, href: company.website, linkLabel: company.website }
      : null;

    var rows = [
      { icon: ICONS.Buildings, label: 'Type', value: company.companyTypeLabel || 'Referral partner' },
      { icon: ICONS.ShareNetwork, label: 'Clients referred', value: (company.referredCount || 0).toLocaleString() },
      { icon: ICONS.User, label: 'Contacts', value: String((company.people || []).length) },
      { icon: ICONS.UserCircle, label: 'Portal access', value: String(company.memberCount || 0) },
      website,
      { icon: ICONS.Briefcase, label: 'CIP code', value: company.cipCode },
      { icon: ICONS.Briefcase, label: 'Industry', value: company.industry },
      { icon: ICONS.EnvelopeSimple, label: 'Email', value: company.email },
      { icon: ICONS.Phone, label: 'Phone', value: company.phone },
      { icon: ICONS.User, label: 'Registration', value: company.registrationNumber },
    ].filter(function (r) { return r && !!r.value; });

    // `--facts`: a full-width card has room for these side by side, and
    // stacked they were four short lines down the left of an empty acre.
    return '<div class="tma-dash__clients-profile-body">' +
      '<ul class="tma-dash__clients-list tma-dash__clients-list--profile tma-dash__clients-list--facts" role="list">' +
      rows.map(function (r) { return renderListItem(r); }).join('') +
      '</ul></div>';
  }

  /* The address an invitation would go to.
     The contact object carries `emails: [{type, value}]`, never a top-level
     `email` — reading `c.email` silently yields undefined and makes every
     client look like it has no address. */
  function clientPrimaryEmail(c) {
    if (!c) return '';
    if (c.email) return c.email;
    var rows = c.emails || (c.profile && c.profile.emails) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].value) return rows[i].value;
    }
    return '';
  }

  function companyRoleLabel(role) {
    for (var i = 0; i < COMPANY_ROLES.length; i++) {
      if (COMPANY_ROLES[i].value === role) return COMPANY_ROLES[i].label;
    }
    return 'Service provider member';
  }

  /* Who at the company can reach its records, and how far each has got. */
  function renderCompanyMembersBlock(state, company) {
    var members = state.companyMembers || [];
    var loading = !!state.companyMembersLoading;
    var admin = isClientsAdmin();

    var form = admin && !loading
      ? '<div class="tma-dash__clients-assign-form">' +
        '<input class="tma-dash__clients-field-input" type="email" placeholder="Email address" data-company-member-email aria-label="Member email">' +
        '<select class="tma-dash__clients-field-select" data-company-member-role aria-label="Company role">' +
        COMPANY_ROLES.map(function (r) {
          return '<option value="' + esc(r.value) + '"' + (r.value === 'member' ? ' selected' : '') + '>' +
            esc(r.label) + '</option>';
        }).join('') +
        '</select>' +
        '<button type="button" class="tma-dash__clients-assign-btn" data-company-member-add>Add</button>' +
        '</div>'
      : '';

    var list = members.length
      ? '<div class="tma-dash__clients-assigned-list">' + members.map(function (m) {
          var meta = [companyRoleLabel(m.role)];
          if (m.primary) meta.unshift('Primary');
          meta.push(m.hasAccount ? 'Has access' : (m.status === 'invited' ? 'Invited' : 'No account yet'));
          return '<div class="tma-dash__clients-assigned">' +
            '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' + staffAvatarHtml(m) + '</span>' +
            '<span class="tma-dash__clients-assigned-main">' +
            '<span class="tma-dash__clients-assigned-title">' + esc(m.name || m.email || 'Member') + '</span>' +
            '<span class="tma-dash__clients-assigned-meta">' + esc(meta.join(' · ')) +
            (m.email ? ' · ' + esc(m.email) : '') + '</span>' +
            '</span>' +
            (admin && !m.hasAccount && m.email
              ? '<button type="button" class="tma-dash__clients-message-btn" data-company-member-invite="' +
                esc(m.id) + '">Invite</button>'
              : '') +
            (admin
              ? '<button type="button" class="tma-dash__clients-row-remove" data-company-member-remove="' +
                esc(m.id) + '" aria-label="Remove member"><img src="' + ICONS.Trash + '" alt=""></button>'
              : '') +
            '</div>';
        }).join('') + '</div>'
      : (loading
        ? '<div class="tma-dash__clients-assigned-empty">Loading…</div>'
        : clientsEmpty('No portal access yet', 'Illustration09'));

    return '<div class="tma-dash__clients-access-block">' +
      form + list + '</div>';
  }

  /* The firm's own people looking after this company. */
  function renderCompanyStaffBlock(state, company) {
    if (!isClientsAdmin()) return '';

    var items = state.companyStaff || [];
    var assignable = state.companyStaffAssignable || [];
    var loading = !!state.companyStaffLoading;

    var options = assignable.map(function (u) {
      return '<option value="' + esc(String(u.id)) + '">' + esc(u.name) + '</option>';
    }).join('');

    var form = !loading
      ? '<div class="tma-dash__clients-assign-form">' +
        '<select class="tma-dash__clients-field-select tma-dash__clients-field-select--full" data-company-staff-user>' +
        '<option value="">Assign staff…</option>' + options + '</select>' +
        '<select class="tma-dash__clients-field-select" data-company-staff-level aria-label="Permission level">' +
        ASSIGNMENT_LEVELS.map(function (l) {
          return '<option value="' + esc(l.value) + '"' + (l.value === 'editor' ? ' selected' : '') + '>' +
            esc(l.label) + '</option>';
        }).join('') +
        '</select>' +
        '<select class="tma-dash__clients-field-select" data-company-staff-scope aria-label="How far this reaches">' +
        COMPANY_SCOPES.map(function (sc) {
          return '<option value="' + esc(sc.value) + '">' + esc(sc.label) + '</option>';
        }).join('') +
        '</select>' +
        '<button type="button" class="tma-dash__clients-assign-btn" data-company-staff-add>Assign</button>' +
        '</div>'
      : '';

    var list = items.length
      ? '<div class="tma-dash__clients-assigned-list">' + items.map(function (a) {
          var meta = [a.roleLabel || 'Assigned staff', assignmentLevelLabel(a.level)];
          if (a.primary) meta.unshift('Primary');
          if (a.appliesLabel) meta.push(a.appliesLabel);
          return '<div class="tma-dash__clients-assigned">' +
            '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' + staffAvatarHtml(a) + '</span>' +
            '<span class="tma-dash__clients-assigned-main">' +
            '<span class="tma-dash__clients-assigned-title">' + esc(a.name || 'Staff') + '</span>' +
            '<span class="tma-dash__clients-assigned-meta">' + esc(meta.join(' · ')) + '</span>' +
            '</span>' +
            '<button type="button" class="tma-dash__clients-row-remove" data-company-staff-remove="' +
            esc(String(a.userId)) + '" aria-label="End assignment"><img src="' + ICONS.Trash + '" alt=""></button>' +
            '</div>';
        }).join('') + '</div>'
      : (loading
        ? '<div class="tma-dash__clients-assigned-empty">Loading…</div>'
        : clientsEmpty('No staff assigned', 'Illustration04'));

    return '<div class="tma-dash__clients-access-block">' +
      form + list + '</div>';
  }

  function renderListItem(opts) {
    var valueHtml = opts.href
      ? '<a class="tma-dash__clients-list-value tma-dash__clients-list-link" href="' + esc(opts.href) +
        '" aria-label="' + esc(opts.linkLabel || opts.value) + '">' + esc(opts.value) + '</a>'
      : '<span class="tma-dash__clients-list-value">' + esc(opts.value) + '</span>';
    return (
      '<li class="tma-dash__clients-list-item">' +
      '<span class="tma-dash__clients-list-icon" aria-hidden="true"><img src="' + esc(opts.icon) + '" alt=""></span>' +
      '<div class="tma-dash__clients-list-main">' +
      '<span class="tma-dash__clients-list-label">' + esc(opts.label) + '</span>' + valueHtml +
      '</div></li>'
    );
  }

  function renderStat(label, value) {
    return (
      '<div class="tma-dash__clients-stat">' +
      '<span class="tma-dash__clients-stat-label">' + esc(label) + '</span>' +
      '<span class="tma-dash__clients-stat-value">' + esc(value) + '</span></div>'
    );
  }

  function splitListColumns(items, maxPerColumn) {
    maxPerColumn = maxPerColumn || 6;
    var columns = [[], []];
    items.forEach(function (item, i) {
      var columnIndex = Math.floor(i / maxPerColumn) % 2;
      columns[columnIndex].push(item);
    });
    return columns;
  }

  function renderProfileListColumns(listItems) {
    if (isClientsMobile()) {
      return (
        '<div class="tma-dash__clients-profile-body">' +
        '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
        listItems.join('') +
        '</ul></div>'
      );
    }
    var columns = splitListColumns(listItems, 6);
    return (
      '<div class="tma-dash__clients-profile-body">' +
      columns.map(function (columnItems) {
        return (
          '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
          columnItems.join('') +
          '</ul>'
        );
      }).join('') +
      '</div>'
    );
  }

  function staffAvatarHtml(person) {
    if (person && person.avatar) {
      return '<img src="' + esc(person.avatar) + '" alt="">';
    }
    var name = (person && person.name) || '?';
    var initial = name.charAt(0).toUpperCase();
    return '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:32px;height:32px">' +
      esc(initial) + '</span>';
  }

  function socialDisplayValue(url) {
    return String(url || '')
      .replace(/^https?:\/\/(www\.)?/i, '')
      .replace(/^linkedin\.com\/in\//i, 'linkedin.com/in/')
      .replace(/^twitter\.com\//i, 'twitter.com/')
      .replace(/^instagram\.com\//i, 'instagram.com/')
      .replace(/^threads\.net\//i, 'threads.net/');
  }

  function buildProfileListItems(c) {
    var listItems = [];
    listItems.push(renderListItem({
      icon: ICONS.UserCircle,
      label: 'Client type',
      value: clientTypeLabel(clientTypeOf(c.id)),
    }));
    // Always shown, unlike the optional rows below: "no referral recorded" is
    // information the firm acts on, not an empty field.
    listItems.push(renderListItem({
      icon: ICONS.ShareNetwork,
      label: 'Referred by',
      value: clientReferralLabel(c.id) || 'Not recorded',
    }));

    // The applicant number is worth stating; the link to the case itself is a
    // button on the toolbar (see cbiToolbarBtn) rather than a row down here.
    var cbi = (PROFILES[c.id] || {}).cbi;
    if (cbi && cbi.applicantNumber) {
      listItems.push(renderListItem({
        icon: ICONS.Briefcase,
        label: 'CBI application',
        value: cbi.applicantNumber,
      }));
    }
    if (c.work.jobTitle) listItems.push(renderListItem({ icon: ICONS.Briefcase, label: 'Job title', value: c.work.jobTitle }));
    if (c.work.department) listItems.push(renderListItem({ icon: ICONS.UserCircle, label: 'Department', value: c.work.department }));
    if (c.work.company) listItems.push(renderListItem({ icon: ICONS.Buildings, label: 'Company', value: c.work.company }));

    c.phones.forEach(function (phone) {
      if (!phone.value) return;
      listItems.push(renderListItem({
        icon: ICONS.Phone,
        label: phoneTypeLabel(phone.type),
        value: phone.value,
        href: telHref(phone.value),
        linkLabel: 'Call ' + c.name,
      }));
    });

    c.emails.forEach(function (email) {
      if (!email.value) return;
      listItems.push(renderListItem({
        icon: ICONS.EnvelopeSimple,
        label: emailTypeLabel(email.type),
        value: email.value,
        href: 'mailto:' + email.value,
        linkLabel: 'Email ' + c.name,
      }));
    });

    c.addresses.forEach(function (addr) {
      var text = formatAddress(addr);
      if (!text) return;
      listItems.push(renderListItem({
        icon: ICONS.MapPin,
        label: addressTypeLabel(addr.type),
        value: text,
        href: mapsHref(addr),
        linkLabel: 'Open address in maps',
      }));
    });

    if (c.website) {
      listItems.push(renderListItem({
        icon: ICONS.Globe,
        label: 'Website',
        value: c.website,
        href: c.website.indexOf('://') === -1 ? 'https://' + c.website : c.website,
        linkLabel: 'Open website',
      }));
    }

    c.importantDates.forEach(function (entry) {
      if (!entry.date) return;
      listItems.push(renderListItem({
        icon: ICONS.CalendarBlank,
        label: dateEntryLabel(entry),
        value: formatDateDisplay(entry.date),
      }));
    });

    if (c.linkedIn) {
      listItems.push(renderListItem({
        icon: ICONS.LinkedinLogo,
        label: 'LinkedIn',
        value: c.linkedIn.replace(/^https?:\/\/(www\.)?linkedin\.com\//i, ''),
        href: c.linkedIn.indexOf('://') === -1 ? 'https://' + c.linkedIn : c.linkedIn,
        linkLabel: 'Open LinkedIn profile',
      }));
    }

    (c.socials || []).forEach(function (social) {
      if (!social || !social.value) return;
      if (social.type === 'linkedin' && c.linkedIn) return;
      var label = SOCIAL_LABELS[social.type] || social.label || 'Social';
      var icon = SOCIAL_ICONS[social.type] || ICONS.ShareNetwork;
      var href = social.value.indexOf('://') === -1 ? 'https://' + social.value : social.value;
      listItems.push(renderListItem({
        icon: icon,
        label: label,
        value: socialDisplayValue(href),
        href: href,
        linkLabel: 'Open ' + label + ' profile',
      }));
    });

    if (c.notes) listItems.push(renderListItem({ icon: ICONS.ChatTeardropDots, label: 'Notes', value: c.notes }));

    return listItems;
  }

  /*
   * How many documents this client has, keyed by their folder.
   *
   * Filled in by the folder panel's own listing (loadClientFolder), which runs
   * on every profile render whether or not the Documents tab is the one on
   * show — so the number is there before anybody opens it. Counted from the
   * root listing only: drilling into a subfolder must not make the tab report
   * that subfolder's contents as the client's total.
   */
  var clientDocCounts = {};

  function documentCountFor(rootUuid) {
    if (!rootUuid) return null;
    var n = clientDocCounts[rootUuid];
    return typeof n === 'number' ? n : null;
  }

  function profileTabCount(state, tabId) {
    if (tabId === 'assigned') {
      if (state.assignmentsLoading) return null;
      return (state.assignments || []).length;
    }
    if (tabId === 'folders') return documentCountFor(clientFolderUuid(state.selectedId));
    return null;
  }

  /* Nested inside the label rather than beside it: the underline tab is a
     column (label above indicator), so a third child would land under the rule
     and the indicator would stop matching the width of what it underlines.
     Zero draws nothing, the way every other count in the portal behaves — the
     panel behind the tab already says it is empty, in a sentence. */
  function tabCountChip(count) {
    if (!count) return '';
    return '<span class="tma-tab__count">' + esc(count > 999 ? '999+' : String(count)) + '</span>';
  }

  function renderProfileTabs(state, activeTab) {
    return PROFILE_TABS.map(function (tab) {
      var active = tab.id === activeTab;
      return (
        '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab"' +
        ' aria-selected="' + (active ? 'true' : 'false') + '" data-clients-tab="' + esc(tab.id) + '">' +
        '<span class="tma-tab__label">' + esc(tab.label) +
        tabCountChip(profileTabCount(state, tab.id)) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>'
      );
    }).join('');
  }

  function renderContactInfoPanel(c, listItems, hidden) {
    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="info" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      renderProfileListColumns(listItems) +
      '</div>'
    );
  }

  function renderFolderRow(folder) {
    var countLabel = folder.count === 1 ? '1 file' : folder.count + ' files';
    return (
      '<button type="button" class="tma-dash__clients-folder" data-clients-folder="' + esc(folder.id) + '">' +
      '<span class="tma-dash__clients-folder-icon" aria-hidden="true">' +
      '<img src="' + ICONS.FolderFilled + '" alt="">' +
      '</span>' +
      '<span class="tma-dash__clients-folder-main">' +
      '<span class="tma-dash__clients-folder-name">' + esc(folder.name) + '</span>' +
      '<span class="tma-dash__clients-folder-meta">' + esc(countLabel) + ' · Updated ' + esc(folder.updated) + '</span>' +
      '</span>' +
      '<span class="tma-dash__clients-folder-count" aria-hidden="true">' + esc(String(folder.count)) + '</span>' +
      '</button>'
    );
  }

  function renderFoldersPanel(contactId, hidden) {
    var uuid = clientFolderUuid(contactId);
    return (
      // The client this panel belongs to, on the panel itself. The wiring below
      // is module-level and has no access to the per-mount `state`, so anything
      // it needs about the client has to be readable from the DOM.
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="folders" role="tabpanel"' +
      ' data-clients-panel-client="' + esc(contactId || '') + '"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-folders-head">' +
      '<span class="tma-dash__clients-folders-title" data-clients-folder-crumbs>Client documents</span>' +
      (uuid
        ? '<div class="tma-dash__clients-folders-actions">' +
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-new>' +
          '<img src="' + ICONS.Plus + '" alt=""><span>New folder</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-upload>' +
          '<img src="images/icons/phosphor/ArrowLineUp.svg" alt=""><span>Upload</span></button>' +
          // Collecting documents from the client is the other half of uploading
          // them on the client's behalf, so it sits beside it and targets the
          // same folder the panel is currently showing.
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-request>' +
          '<img src="images/icons/phosphor/DownloadSimple.svg" alt=""><span>Request files</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-open-folder>' +
          '<img src="' + ICONS.FolderNotch + '" alt=""><span>Open in File Library</span></button>' +
          '<input type="file" multiple hidden data-clients-folder-fileinput>' +
          '</div>'
        : '') +
      '</div>' +
      (uuid
        ? '<div class="tma-dash__clients-folders" data-clients-folder-drop data-folder-uuid="' + esc(uuid) + '" data-root-uuid="' + esc(uuid) + '">' +
          '<div class="tma-dash__clients-assigned-empty" data-clients-folder-list>Loading…</div>' +
          '</div>'
        : '<div class="tma-dash__clients-folders">' +
          '<div class="tma-dash__clients-assigned-empty">This client’s folder isn’t ready yet.</div></div>') +
      '</div>'
    );
  }

  /* ── the client folder, live inside the profile ─────────────────
   * Reuses the File Library APIs: the browse endpoint lists the folder, the
   * global upload manager (TMAUpload) handles chunked uploads + drag-and-drop,
   * and the folders endpoint creates subfolders. Nothing about the File
   * Library design changes - this is just a window onto the client's folder.
   */
  function filesNet() { return window.TMAFilesNet; }

  // "3 files · 1 folder · 1.2 MB", or "Empty" when the folder has nothing.
  function folderMetaLabel(f) {
    var parts = [];
    var files = f.fileCount || 0;
    var folders = f.folderCount || 0;
    if (files) parts.push(files + (files === 1 ? ' file' : ' files'));
    if (folders) parts.push(folders + (folders === 1 ? ' folder' : ' folders'));
    if (!parts.length) return 'Empty';
    if (f.sizeLabel) parts.push(f.sizeLabel);
    return parts.join(' · ');
  }

  function fmtShortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /**
   * A client document's review state, beside its name.
   *
   * Reuses the portal's status badge rather than a chip of this page's own, so
   * "Pending review" here and in the File Library are recognisably the same
   * fact about the same file.
   */
  function clientStatusChip(f) {
    var s = f && f.status;
    if (!s || !s.label) return '';

    return '<span class="tma-portal-status tma-portal-status--' + esc(s.tone || 'neutral') +
      ' tma-portal-status--inline">' + esc(s.label) + '</span>';
  }

  /* The rows currently on show, so a click can hand the viewer the whole file
     rather than re-fetching one it already has. */
  var clientFolderFiles = [];

  function renderClientFolderList(root, res) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return;
    var folders = (res && res.folders) || [];
    var files = (res && res.files) || [];
    clientFolderFiles = files;
    if (!folders.length && !files.length) {
      // Same illustrated empty state as File Library folders — plain grey copy
      // read as a broken list rather than an intentional empty folder.
      var ui = window.TMAPortalUI;
      wrap.innerHTML = '<div data-clients-folder-list>' +
        (ui && ui.emptyState
          ? ui.emptyState({
              illustration: 'Illustration03',
              title: 'No files yet',
              subtitle: 'Use “Upload”, “New folder”, or drag files here.',
            })
          : '<div class="tma-dash__clients-assigned-empty">' +
            'No files yet. Use “Upload”, “New folder”, or drag files here.</div>') +
        '</div>';
      return;
    }
    var html = '';
    folders.forEach(function (f) {
      var count = (f.fileCount || 0) + (f.folderCount || 0);
      var folderBase = f.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
      var folderIcon = window.TMAFolderIcons
        ? window.TMAFolderIcons.html(folderBase, f.colour, f.iconName, 24)
        : '<img src="' + (window.TMAFolderColours ? window.TMAFolderColours.iconSrc(folderBase, f.colour) : ICONS[folderBase]) + '" alt="">';
      html += '<button type="button" class="tma-dash__clients-folder" data-clients-subfolder="' + esc(f.id) + '" data-clients-subfolder-name="' + esc(f.name) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true">' + folderIcon + '</span>' +
        '<span class="tma-dash__clients-folder-main"><span class="tma-dash__clients-folder-name">' + esc(f.name) + '</span>' +
        '<span class="tma-dash__clients-folder-meta">' + esc(folderMetaLabel(f)) + '</span></span>' +
        '<span class="tma-dash__clients-folder-count" aria-hidden="true">' + count + '</span>' +
        '</button>';
    });
    files.forEach(function (f) {
      /*
       * The file's own icon, not a generic page.
       *
       * Every document here rendered as the same phosphor File.svg, so a
       * folder of passports, spreadsheets and photographs looked like one
       * repeated thing. The listing already carries an `icon` chosen from the
       * extension, which is what the File Library draws from — the icon set
       * was there all along, this list just was not asking for it.
       */
      var icon = (window.TMAFileIcons && window.TMAFileIcons.fileIconSrc)
        ? window.TMAFileIcons.fileIconSrc(f.icon, f.name)
        : 'images/icons/phosphor/File.svg';

      // Who and when, not just how big — the brief asks for both against every
      // client document, and "uploaded by" is the first question about one.
      var who = f.uploadedBy && f.uploadedBy.name ? f.uploadedBy.name : null;
      var meta = [
        f.sizeLabel,
        f.uploadedAt ? fmtShortDate(f.uploadedAt) : null,
        who,
      ].filter(Boolean).join(' · ');

      html += '<button type="button" class="tma-dash__clients-folder" data-clients-file="' + esc(f.id) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true"><img src="' + esc(icon) + '" alt=""></span>' +
        '<span class="tma-dash__clients-folder-main">' +
          '<span class="tma-dash__clients-folder-name">' + esc(f.name) + clientStatusChip(f) + '</span>' +
          (meta ? '<span class="tma-dash__clients-folder-meta">' + esc(meta) + '</span>' : '') +
        '</span></button>';
    });
    wrap.innerHTML = html;
  }

  /* One tab's count chip, patched in place.
     Deliberately not a re-render: a render re-wires the folder panel, which
     reloads the folder, which lands back here — a loop that never settles. */
  function setTabCount(root, tabId, count) {
    var label = root.querySelector('[data-clients-tab="' + tabId + '"] .tma-tab__label');
    if (!label) return;
    var chip = label.querySelector('.tma-tab__count');
    if (!count) {
      if (chip) chip.remove();
      return;
    }
    var text = count > 999 ? '999+' : String(count);
    if (chip) {
      if (chip.textContent !== text) chip.textContent = text;
      return;
    }
    label.insertAdjacentHTML('beforeend', '<span class="tma-tab__count">' + esc(text) + '</span>');
  }

  /*
   * The client's document total, from the listing the panel just loaded.
   *
   * `counts.files` is what sits directly in the folder; every subfolder row
   * carries its own *recursive* fileCount (FolderTree::aggregate), so the two
   * together are every document anywhere under the client folder. Only the
   * root listing counts — drilling into a subfolder must not make the tab
   * report that subfolder as the client's total.
   */
  function captureClientDocCount(root, res) {
    if (!clientFolderNav) return;
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    if (!uuid || uuid !== clientFolderNav.rootUuid) return;

    var counts = (res && res.counts) || {};
    var total = typeof counts.files === 'number' ? counts.files : ((res && res.files) || []).length;
    ((res && res.folders) || []).forEach(function (f) {
      if (typeof f.fileCount === 'number') total += f.fileCount;
    });

    clientDocCounts[uuid] = total;
    setTabCount(root, 'folders', total);
  }

  // In-place drilling: the panel tracks where inside the client folder tree the
  // user has navigated, so folders open in place instead of leaving the profile.
  // { rootUuid, path: [{ uuid, name }] } — path[0] is always the client folder.
  var clientFolderNav = null;

  function clientFolderCurrentUuid(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    return wrap ? wrap.getAttribute('data-folder-uuid') : null;
  }

  function renderFolderCrumbs(root) {
    var host = root.querySelector('[data-clients-folder-crumbs]');
    if (!host || !clientFolderNav) return;
    var path = clientFolderNav.path;
    host.innerHTML = path.map(function (node, i) {
      if (i === path.length - 1) {
        return '<span class="tma-dash__clients-crumb tma-dash__clients-crumb--current">' + esc(node.name) + '</span>';
      }
      return '<button type="button" class="tma-dash__clients-crumb" data-clients-crumb="' + i + '">' + esc(node.name) + '</button>' +
        '<span class="tma-dash__clients-crumb-sep" aria-hidden="true">›</span>';
    }).join('');
  }

  // Point the drop zone at the deepest folder in the path, then repaint.
  function showClientFolderCurrent(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap || !clientFolderNav) return;
    var current = clientFolderNav.path[clientFolderNav.path.length - 1];
    wrap.setAttribute('data-folder-uuid', current.uuid);
    renderFolderCrumbs(root);
    loadClientFolder(root);
  }

  function bindClientFolderRows(root) {
    root.querySelectorAll('[data-clients-subfolder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!clientFolderNav) return;
        clientFolderNav.path.push({
          uuid: btn.getAttribute('data-clients-subfolder'),
          name: btn.getAttribute('data-clients-subfolder-name') || 'Folder',
        });
        showClientFolderCurrent(root);
      });
    });
    root.querySelectorAll('[data-clients-file]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fu = btn.getAttribute('data-clients-file');
        if (!fu) return;

        /*
         * The File Library's viewer, not a new browser tab.
         *
         * These are the same files the library lists, so opening one here used
         * to give a bare PDF in another tab — no comments, no versions, no
         * review controls — while opening it from the library gave the full
         * viewer. TMAFileActions.open hands the row we already hold straight
         * to it, and the callback refreshes this list for anything the viewer
         * changed (a review moved on, a version added).
         */
        var row = (clientFolderFiles || []).filter(function (f) { return f.id === fu; })[0];

        if (row && window.TMAFileActions && window.TMAFileActions.open) {
          window.TMAFileActions.open(row, function () { loadClientFolder(root); });

          return;
        }

        // No viewer on this shell — the old behaviour beats doing nothing.
        if (filesNet()) window.open(filesNet().url('/files/' + encodeURIComponent(fu) + '/preview'), '_blank', 'noopener');
      });
    });
  }

  function loadClientFolder(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap || !filesNet()) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    filesNet().fetchJSON(filesNet().url('/?folder=' + encodeURIComponent(uuid) + '&perPage=200'))
      .then(function (res) {
        renderClientFolderList(root, res);
        bindClientFolderRows(root);
        captureClientDocCount(root, res);
      })
      .catch(function () {
        var list = wrap.querySelector('[data-clients-folder-list]') || wrap;
        list.textContent = 'Could not load this folder.';
      });
  }

  function uploadToClientFolder(files, uuid) {
    if (!files || !files.length || !window.TMAUpload) return;
    window.TMAUpload.add(files, { folderId: uuid });
    clientsToast(files.length > 1 ? files.length + ' files uploading…' : 'Uploading…', 'neutral');
  }

  // One document-level listener refreshes the open folder panel when an upload
  // into it finishes, wherever the upload was started from.
  var clientFolderUploadListenerBound = false;
  function bindClientFolderUploadRefresh() {
    if (clientFolderUploadListenerBound) return;
    clientFolderUploadListenerBound = true;
    document.addEventListener('tma:upload-complete', function (e) {
      if (!clientsMountRoot) return;
      var wrap = clientsMountRoot.querySelector('[data-clients-folder-drop]');
      if (!wrap) return;
      var done = e.detail && e.detail.folderId;
      if (!done || done === wrap.getAttribute('data-folder-uuid')) {
        loadClientFolder(clientsMountRoot);
      }
    });
  }

  function wireClientFolderPanel(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return;
    var rootUuid = wrap.getAttribute('data-root-uuid');

    // Start a fresh drill path when opening a different client's folder; keep it
    // (so a switch to Client info and back stays put) for the same client.
    if (!clientFolderNav || clientFolderNav.rootUuid !== rootUuid) {
      clientFolderNav = { rootUuid: rootUuid, path: [{ uuid: rootUuid, name: 'Client documents' }] };
    }
    wrap.setAttribute('data-folder-uuid', clientFolderNav.path[clientFolderNav.path.length - 1].uuid);
    renderFolderCrumbs(root);

    // New folder / uploads always target the folder currently in view.
    var current = function () { return clientFolderCurrentUuid(root); };

    bindClientFolderUploadRefresh();
    loadClientFolder(root);

    var newBtn = root.querySelector('[data-clients-folder-new]');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var name = window.prompt('New folder name');
        if (!name || !name.trim() || !filesNet()) return;
        filesNet().fetchJSON(filesNet().url('/folders'), { method: 'POST', json: { name: name.trim(), parent: current() } })
          .then(function () { clientsToast('Folder created', 'positive'); loadClientFolder(root); })
          .catch(function (err) { clientsToast((err && err.message) || 'Could not create the folder', 'negative'); });
      });
    }

    var uploadBtn = root.querySelector('[data-clients-folder-upload]');
    var fileInput = root.querySelector('[data-clients-folder-fileinput]');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        uploadToClientFolder(fileInput.files, current());
        fileInput.value = '';
      });
    }

    /*
     * Ask the client for documents, into the folder on screen.
     *
     * Deliberately the *current* folder rather than the client's root: the
     * point of drilling into "Approval Documents" and then asking is that the
     * uploads land there. The shared dialog (portal-file-requests.js) owns
     * everything else, and the client is tagged on the request so the
     * documents are attributed even when the destination is a plain folder.
     */
    var requestBtn = root.querySelector('[data-clients-folder-request]');
    if (requestBtn) {
      requestBtn.addEventListener('click', function () {
        if (!window.TMAFileRequests) {
          clientsToast('Request Files isn’t available right now', 'negative');
          return;
        }
        var here = clientFolderNav
          ? clientFolderNav.path[clientFolderNav.path.length - 1]
          : { uuid: rootUuid, name: 'Client documents' };
        var panel = requestBtn.closest('[data-clients-panel-client]');
        var clientId = panel ? panel.getAttribute('data-clients-panel-client') : null;
        var contact = clientId ? contactFor(clientId) : null;
        var name = contact && contact.name;

        window.TMAFileRequests.open({
          folderId: here.uuid,
          folderName: here.name,
          clientId: clientId || null,
          clientName: name || null,
          title: name ? 'Documents for ' + name : 'Please upload your documents',
          onCreated: function () { loadClientFolder(root); },
        });
      });
    }

    // Breadcrumb: jump back up to any ancestor (delegated, survives repaints).
    var crumbHost = root.querySelector('[data-clients-folder-crumbs]');
    if (crumbHost) {
      crumbHost.addEventListener('click', function (e) {
        var crumb = e.target.closest('[data-clients-crumb]');
        if (!crumb || !clientFolderNav) return;
        var idx = parseInt(crumb.getAttribute('data-clients-crumb'), 10);
        clientFolderNav.path = clientFolderNav.path.slice(0, idx + 1);
        showClientFolderCurrent(root);
      });
    }

    // Drag-and-drop upload straight onto the panel (into the current folder).
    var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        stop(e);
        e.dataTransfer.dropEffect = 'copy';
        wrap.classList.add('is-drop-into');
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        if (e.target === wrap) wrap.classList.remove('is-drop-into');
      });
    });
    wrap.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      stop(e);
      wrap.classList.remove('is-drop-into');
      uploadToClientFolder(e.dataTransfer.files, current());
    });
  }

  function assignmentEndsLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return ' · until ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderAssignedStaffRow(person) {
    // The role is what they do; the level is what they can open. Both are
    // shown because either alone is misleading.
    var meta = [
      person.roleLabel || assignmentLevelLabel(person.level),
      assignmentLevelLabel(person.level),
    ];
    if (person.primary) meta.unshift('Primary');
    var line = meta.join(' · ') + assignmentEndsLabel(person.endsAt);

    return (
      '<div class="tma-dash__clients-assigned" data-clients-assigned-user="' + esc(String(person.userId)) + '">' +
      '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' + staffAvatarHtml(person) + '</span>' +
      '<span class="tma-dash__clients-assigned-main">' +
      '<span class="tma-dash__clients-assigned-title">' + esc(person.name || 'Staff') + '</span>' +
      '<span class="tma-dash__clients-assigned-meta">' + esc(line) +
      (person.email ? ' · ' + esc(person.email) : '') + '</span>' +
      '</span>' +
      (isClientsAdmin()
        ? '<button type="button" class="tma-dash__clients-row-remove" data-clients-unassign="' +
          esc(String(person.userId)) + '" aria-label="End assignment">' +
          '<img src="' + ICONS.Trash + '" alt=""></button>'
        : '') +
      '</div>'
    );
  }

  /* Who used to look after this client. Read-only — ending an assignment keeps
     the record rather than deleting it, and this is where that record shows. */
  function renderAssignmentHistory(history) {
    if (!history || !history.length) return '';
    return (
      '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Previously assigned</span></div>' +
      '<div class="tma-dash__clients-assigned-list">' +
      history.map(function (p) {
        var when = p.endedAt ? new Date(p.endedAt) : null;
        var label = (p.roleLabel || 'Assigned staff') +
          (when && !isNaN(when.getTime())
            ? ' · until ' + when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
            : '');
        return (
          '<div class="tma-dash__clients-assigned">' +
          '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' + staffAvatarHtml(p) + '</span>' +
          '<span class="tma-dash__clients-assigned-main">' +
          '<span class="tma-dash__clients-assigned-title">' + esc(p.name || 'Staff') + '</span>' +
          '<span class="tma-dash__clients-assigned-meta">' + esc(label) + '</span>' +
          '</span></div>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  /* ---------------------------------------------------------- portal access
     Whether this client can sign in, and where their invitation has got to.
     Rendered above the assigned-staff list so "who looks after them" and "can
     they actually get in" read as one section. */

  var INVITE_STATUS_TEXT = {
    pending: 'Invitation created, not sent yet',
    sent: 'Invitation sent',
    delivered: 'Invitation delivered',
    opened: 'Invitation opened',
    accepted: 'Invitation accepted',
    expired: 'Invitation expired',
    cancelled: 'Invitation withdrawn',
    failed: 'Invitation could not be sent',
  };

  function inviteStatusTone(status) {
    if (status === 'accepted') return 'positive';
    if (status === 'failed' || status === 'expired') return 'negative';
    if (status === 'cancelled') return 'neutral';
    return 'info';
  }

  function formatInviteDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderPortalAccessBlock(state, c) {
    if (!c) return '';
    var inv = state.invitation;
    var loading = !!state.accessLoading;

    if (c.hasLogin) {
      return (
        '<div class="tma-dash__clients-access-block" data-clients-access>' +
        '<div class="tma-dash__clients-assigned-head">' +
        '<span class="tma-dash__clients-assigned-count">Portal access</span></div>' +
        '<div class="tma-dash__clients-assigned-empty">This client has a portal account and can sign in.</div>' +
        '</div>'
      );
    }

    var body;
    if (loading) {
      body = '<div class="tma-dash__clients-assigned-empty">Checking…</div>';
    } else if (!inv || inv.status === 'accepted') {
      body =
        '<div class="tma-dash__clients-assigned-empty">' +
        (clientPrimaryEmail(c)
          ? 'No portal access yet. Invite them to create an account.'
          : 'Add an email address to this client before inviting them.') +
        '</div>' +
        (clientPrimaryEmail(c)
          ? '<div class="tma-dash__clients-assign-form">' +
            '<button type="button" class="tma-dash__clients-message-btn" data-clients-invite>' +
            '<img src="' + ICONS.EnvelopeSimple + '" alt=""><span>Invite to portal</span></button></div>'
          : '');
    } else {
      var sent = formatInviteDate(inv.sentAt);
      var expires = formatInviteDate(inv.expiresAt);
      var detail = [];
      if (inv.invitedBy) detail.push('by ' + inv.invitedBy);
      if (sent) detail.push('on ' + sent);
      if (expires && inv.canCancel) detail.push('expires ' + expires);

      body =
        '<div class="tma-dash__clients-assigned-empty tma-dash__clients-access-state--' +
        esc(inviteStatusTone(inv.status)) + '">' +
        esc(INVITE_STATUS_TEXT[inv.status] || inv.status) +
        (detail.length ? ' ' + esc(detail.join(', ')) : '') +
        (inv.status === 'failed' && inv.lastError
          ? '<br><span class="tma-dash__clients-access-error">' + esc(inv.lastError) + '</span>'
          : '') +
        '</div>' +
        '<div class="tma-dash__clients-assign-form">' +
        (inv.canResend
          ? '<button type="button" class="tma-dash__clients-message-btn" data-clients-invite-resend="' +
            esc(inv.id) + '">' + (inv.status === 'failed' ? 'Try again' : 'Resend') + '</button>'
          : '') +
        (inv.canCancel
          ? '<button type="button" class="tma-dash__clients-message-btn" data-clients-invite-link="' +
            esc(inv.id) + '">Copy link</button>' +
            '<button type="button" class="tma-dash__clients-message-btn" data-clients-invite-cancel="' +
            esc(inv.id) + '">Cancel</button>'
          : '') +
        '</div>';
    }

    return (
      '<div class="tma-dash__clients-access-block" data-clients-access>' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Portal access</span></div>' +
      body +
      '</div>'
    );
  }

  var LOGIN_EVENT_LABEL = {
    login: 'Signed in',
    logout: 'Signed out',
    login_failed: 'Failed sign-in',
    lockout: 'Locked out',
  };

  /* The Portal access tab.

     Two mutually exclusive halves, which is the point of the tab: until the
     client has an account the only useful thing is the invitation, and once
     they do the invitation is history and what staff want is "when did they
     last get in". */
  function renderAccessPanel(state, c, hidden) {
    var d = state.access;
    var loading = !!state.accessLoading;

    var body;
    if (loading || !d) {
      body = '<div class="tma-dash__clients-assigned-empty">Loading…</div>';
    } else if (!d.hasAccount) {
      // No account yet: the invitation is the whole story.
      body = renderPortalAccessBlock(state, c);
    } else {
      body = renderAccountSummary(d.account) +
        renderLoginLog(d.logins || []) +
        renderAccountActivity(d.activity || []);
    }

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="access" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' + body + '</div>'
    );
  }

  function renderAccountSummary(a) {
    if (!a) return '';
    var bits = [a.accountType || 'Client'];
    if (a.status) bits.push(a.status === 'approved' ? 'Active' : a.status);
    if (a.twoFactor) bits.push('Two-factor on');
    if (a.onboardedAt) bits.push('Onboarding complete');

    return '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Account</span></div>' +
      '<div class="tma-dash__clients-assigned">' +
      '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' + staffAvatarHtml(a) + '</span>' +
      '<span class="tma-dash__clients-assigned-main">' +
      '<span class="tma-dash__clients-assigned-title">' + esc(a.name || a.email || 'Account') + '</span>' +
      '<span class="tma-dash__clients-assigned-meta">' + esc(bits.join(' · ')) +
      (a.email ? ' · ' + esc(a.email) : '') + '</span>' +
      '</span></div></div>';
  }

  function renderLoginLog(rows) {
    var list = rows.length
      ? '<div class="tma-dash__clients-assigned-list">' + rows.map(function (r) {
          var meta = [r.when || ''];
          if (r.device) meta.push(r.device);
          if (r.ip) meta.push(r.ip);
          return '<div class="tma-dash__clients-assigned">' +
            '<span class="tma-dash__clients-assigned-main">' +
            '<span class="tma-dash__clients-assigned-title">' +
            esc(LOGIN_EVENT_LABEL[r.event] || r.event) + '</span>' +
            '<span class="tma-dash__clients-assigned-meta">' +
            esc(meta.filter(Boolean).join(' · ')) + '</span>' +
            '</span></div>';
        }).join('') + '</div>'
      : '<div class="tma-dash__clients-assigned-empty">No sign-ins recorded yet.</div>';

    return '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Sign-in history</span></div>' +
      list + '</div>';
  }

  function renderAccountActivity(rows) {
    if (!rows.length) {
      return '<div class="tma-dash__clients-access-block">' +
        '<div class="tma-dash__clients-assigned-head">' +
        '<span class="tma-dash__clients-assigned-count">Activity</span></div>' +
        '<div class="tma-dash__clients-assigned-empty">Nothing recorded yet.</div></div>';
    }

    return '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Activity</span></div>' +
      '<div class="tma-dash__clients-assigned-list">' + rows.map(function (r) {
        return '<div class="tma-dash__clients-assigned">' +
          '<span class="tma-dash__clients-assigned-main">' +
          '<span class="tma-dash__clients-assigned-title">' + esc(r.description || r.type) + '</span>' +
          '<span class="tma-dash__clients-assigned-meta">' + esc(r.when || '') + '</span>' +
          '</span></div>';
      }).join('') + '</div></div>';
  }

  function renderAssignedPanel(state, contactId, hidden) {
    var items = state.assignments || [];
    var assignable = state.assignable || [];
    var loading = !!state.assignmentsLoading;
    var admin = isClientsAdmin();
    var assignForm = '';
    if (admin && !hidden) {
      var options = assignable
        .filter(function (s) {
          return !items.some(function (a) { return String(a.userId) === String(s.id); });
        })
        .map(function (s) {
          return '<option value="' + esc(String(s.id)) + '">' + esc(s.name) + '</option>';
        }).join('');
      assignForm =
        '<div class="tma-dash__clients-assign-form">' +
        '<select class="tma-dash__clients-field-select tma-dash__clients-field-select--full" data-clients-assign-user>' +
        '<option value="">Assign staff…</option>' + options + '</select>' +
        '<select class="tma-dash__clients-field-select" data-clients-assign-level aria-label="Permission level">' +
        ASSIGNMENT_LEVELS.map(function (l) {
          return '<option value="' + esc(l.value) + '"' + (l.value === 'editor' ? ' selected' : '') + '>' +
            esc(l.label) + '</option>';
        }).join('') +
        '</select>' +
        '<button type="button" class="tma-dash__clients-assign-btn" data-clients-assign-submit>Assign</button>' +
        '</div>';
    }

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="assigned" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">' +
      (loading ? 'Loading…' : (items.length + ' assigned staff member' + (items.length === 1 ? '' : 's'))) +
      '</span></div>' +
      assignForm +
      (loading
        ? '<div class="tma-dash__clients-assigned-empty">Loading assigned staff…</div>'
        : (items.length
          ? '<div class="tma-dash__clients-assigned-list">' + items.map(renderAssignedStaffRow).join('') + '</div>'
          : '<div class="tma-dash__clients-assigned-empty">No staff assigned to this client yet.</div>')) +
      (loading ? '' : renderAssignmentHistory(state.assignmentHistory)) +
      '</div>'
    );
  }

  function renderProfile(state, opts) {
    opts = opts || {};

    // The profile arrives separately from the directory listing, so the panel
    // has a name and an avatar before it has phone numbers. Drawing the record
    // now would show an empty one — indistinguishable from a client who really
    // has nothing recorded, which most imported clients are.
    if (state.selectedId && !profileLoaded(state.selectedId)) {
      return (
        '<div class="tma-dash__clients-detail">' +
        '<div class="tma-dash__clients-profile' +
        (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
        (state.profileError
          ? renderProfileError(state.profileError, { retry: !state.profileErrorFinal })
          : renderProfileSkeleton()) +
        '</div></div>'
      );
    }

    var c = contactFor(state.selectedId);
    var activeTab = state.profileTab || 'info';
    var listItems = buildProfileListItems(c);
    var toolbar = opts.elevateToolbar ? '' : renderContactProfileToolbar(c, state);

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile' +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      toolbar +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__clients-profile-tablist" role="tablist" aria-label="Client sections">' +
      renderProfileTabs(state, activeTab) +
      '</div>' +
      renderContactInfoPanel(c, listItems, activeTab !== 'info') +
      renderFoldersPanel(c.id, activeTab !== 'folders') +
      renderAssignedPanel(state, c.id, activeTab !== 'assigned') +
      renderAccessPanel(state, c, activeTab !== 'access') +
      '</div></div>'
    );
  }

  function readFormDraft(root) {
    var draft = emptyDraft();
    var get = function (field) {
      var el = root.querySelector('[data-clients-field="' + field + '"]');
      return el ? el.value.trim() : '';
    };

    draft.firstName = get('firstName');
    draft.middleName = get('middleName');
    draft.lastName = get('lastName');
    draft.nickname = get('nickname');
    draft.website = get('website');
    draft.linkedIn = get('linkedIn');
    draft.notes = get('notes');

    var photoBtn = root.querySelector('[data-clients-photo-btn]');
    var photoPreview = root.querySelector('[data-clients-photo-preview]');
    draft.photo = photoBtn && photoBtn.dataset.hasImage && photoPreview && photoPreview.src ? photoPreview.src : '';

    var typeSel = root.querySelector('[data-clients-client-type]');
    draft.clientType = typeSel ? typeSel.value : 'private';

    var referralSel = root.querySelector('[data-clients-referral]');
    var referral = referralSel ? referralSel.value : 'none';
    if (referral.indexOf('company:') === 0) {
      draft.referralType = 'company';
      draft.referredByCompanyId = referral.slice('company:'.length);
    } else {
      draft.referralType = referral === 'private' ? 'private' : 'none';
      draft.referredByCompanyId = '';
    }

    var companySel = root.querySelector('[data-clients-company-id]');
    var companyId = companySel ? companySel.value : '';
    var company = companyFor(companyId);
    draft.companyId = companyId;
    draft.work = {
      jobTitle: get('jobTitle'),
      department: get('department'),
      company: company ? company.name : '',
    };

    draft.phones = [];
    root.querySelectorAll('[data-clients-phone-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-phone-row');
      var typeEl = root.querySelector('[data-clients-phone-type="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-phone-value="' + i + '"]');
      draft.phones.push({
        type: typeEl ? typeEl.value : 'mobile',
        value: valueEl ? valueEl.value.trim() : '',
      });
    });

    draft.emails = [];
    root.querySelectorAll('[data-clients-email-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-email-row');
      var typeEl = root.querySelector('[data-clients-email-type="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-email-value="' + i + '"]');
      draft.emails.push({
        type: typeEl ? typeEl.value : 'work',
        value: valueEl ? valueEl.value.trim() : '',
      });
    });

    draft.addresses = [];
    root.querySelectorAll('[data-clients-address-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-address-row');
      var typeEl = root.querySelector('[data-clients-address-type="' + i + '"]');
      draft.addresses.push({
        type: typeEl ? typeEl.value : 'work',
        street: get('address-street-' + i),
        city: get('address-city-' + i),
        state: get('address-state-' + i),
        zip: get('address-zip-' + i),
        country: get('address-country-' + i),
      });
    });

    draft.importantDates = [];
    root.querySelectorAll('[data-clients-date-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-date-row');
      var typeEl = root.querySelector('[data-clients-date-type="' + i + '"]');
      var labelEl = root.querySelector('[data-clients-date-label="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-date-value="' + i + '"]');
      draft.importantDates.push({
        type: typeEl ? typeEl.value : 'birthday',
        label: labelEl ? labelEl.value.trim() : '',
        date: valueEl ? valueEl.value : '',
      });
    });

    if (!draft.phones.length) draft.phones = [emptyPhone()];
    if (!draft.emails.length) draft.emails = [emptyEmail()];
    if (!draft.addresses.length) draft.addresses = [emptyAddress()];
    if (!draft.importantDates.length) draft.importantDates = [emptyDate('birthday')];

    return draft;
  }

  function syncDraftFromForm(root, state) {
    if (root.querySelector('[data-clients-form]')) {
      state.draft = readFormDraft(root);
    }
  }

  function slugId(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'contact';
  }

  function uniqueId(base) {
    var id = base;
    var n = 2;
    while (directoryItemFor(id)) {
      id = base + '-' + n;
      n += 1;
    }
    return id;
  }

  function insertContact(item) {
    var letter = item.name.charAt(0).toUpperCase();
    if (!/^[A-Z]$/.test(letter)) letter = '#';
    var group = null;
    for (var i = 0; i < DIRECTORY.length; i++) {
      if (DIRECTORY[i].letter === letter) {
        group = DIRECTORY[i];
        break;
      }
    }
    if (!group) {
      group = { letter: letter, items: [] };
      DIRECTORY.push(group);
      DIRECTORY.sort(function (a, b) { return a.letter.localeCompare(b.letter); });
    }
    group.items.push(item);
    group.items.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function saveContactRecord(id, draft, isNew) {
    var name = displayName(draft) || 'New Client';
    var item = directoryItemFor(id);
    var existing = PROFILES[id] || {};

    if (isNew) {
      insertContact({
        id: id,
        name: name,
        initial: name.charAt(0).toUpperCase(),
        initialColor: 'blue',
      });
    } else if (item) {
      item.name = name;
    }

    rememberProfile(id, Object.assign({}, cloneDraft(draft), {
      projects: existing.projects || '0',
      workingGroup: existing.workingGroup || '0',
      likes: existing.likes || '0',
      // The importer writes this and nothing in the editor does, so it would
      // otherwise be dropped the first time somebody saved a CBI client.
      cbi: existing.cbi,
    }));

    var birthdayEntry = draft.importantDates.filter(function (entry) {
      return entry.type === 'birthday' && entry.date;
    })[0];
    PROFILES[id].birthday = birthdayEntry ? birthdayEntry.date : '';

    // The listing's Contact column is denormalised server-side; keep the copy
    // we hold in step so an edit shows in the table without a round trip.
    if (CLIENT_META[id]) {
      CLIENT_META[id].contact = firstEntryValue(draft.emails) || firstEntryValue(draft.phones) || null;
    }
  }

  function resetClientsScroll(root) {
    var main = document.querySelector('.tma-dash__main');
    if (main) main.scrollTop = 0;
    if (!root) return;
    var page = root.querySelector('.tma-dash__clients-page');
    if (page) page.scrollTop = 0;
    var detail = root.querySelector('.tma-dash__clients-detail');
    if (detail) detail.scrollTop = 0;
  }

  function wireDirectoryRows(root, state, navigate) {
    MORPH.unwired(root, '[data-clients-row]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-clients-check]') || e.target.closest('[data-clients-search-wrap]')) return;
        e.preventDefault();
        var id = row.getAttribute('data-clients-row');
        if (!id) return;
        state.profileTab = 'info';
        navigate('detail', id);
      });
    });
  }

  /*
   * "See all N clients" on a company: show the directory filtered to the
   * people that company referred. It sets the same filter the reader could
   * have set by hand, so the chip appears and the × puts it back.
   */
  function wireSeeAllReferred(root, state, navigate) {
    MORPH.unwired(root, '[data-clients-see-referred]').forEach(function (btn) {
      MORPH.on(btn, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.filters = emptyClientFilters();
        state.filters.referral = 'company:' + btn.getAttribute('data-clients-see-referred');
        state.page = 1;
        state.selected = {};
        state.search = '';
        // The filter only has a surface in the table view; landing on the
        // directory list would apply it invisibly.
        state.viewMode = 'list';
        saveViewMode('list');
        navigate('list', null, { forceFull: true });
      });
    });
  }

  function syncSearchWrap(root, state) {
    root.querySelectorAll('[data-clients-search-wrap]').forEach(function (wrap) {
      var isToolbar = wrap.classList.contains('tma-dash__toolbar-search');
      var focused = !!(state.searchFocused || state.search);
      var hasValue = !!state.search;
      var loading = !!state.searchLoading;
      if (isToolbar) {
        wrap.classList.toggle('tma-dash__toolbar-search--focused', focused);
        wrap.classList.toggle('tma-dash__toolbar-search--has-value', hasValue);
        wrap.classList.toggle('tma-dash__toolbar-search--loading', loading);
        return;
      }
      wrap.classList.toggle('tma-dash__clients-search--focused', focused);
      wrap.classList.toggle('tma-dash__clients-search--has-value', hasValue);
      wrap.classList.toggle('tma-dash__clients-search--loading', loading);
    });
  }

  /* ── filter popover (documented tma-filter-popover) ──
   *
   * Built once into document.body and positioned on open, the way the Users
   * table and the CBI list do it: a fields list that cascades into a values
   * list. Living outside the view means a re-render never destroys it
   * mid-interaction, and the toolbar stays two icons however many referral
   * partners the firm registers.
   */

  var clientsPop = null;
  var clientsFilterCtx = null;

  function clientsPopShell(name) {
    return '<div class="tma-filter-popover tma-filter-popover--fixed" data-clients-popover="' +
      name + '" aria-hidden="true"></div>';
  }

  function clientsPopItem(attr, value, label, opts) {
    opts = opts || {};
    return '<button type="button" class="tma-filter-popover__item" ' + attr + '="' + esc(value) + '"' +
      (opts.selected ? ' data-selected' : '') + '>' +
      '<span class="tma-filter-popover__item-label">' + esc(label) + '</span>' +
      (opts.meta ? '<span class="tma-filter-popover__item-meta">' + esc(opts.meta) + '</span>' : '') +
      (opts.chevron
        ? '<img src="' + ICONS.ArrowLineRight + '" alt="" class="tma-filter-popover__item-chevron" width="16" height="16" aria-hidden="true">'
        : '') +
      '</button>';
  }

  function ensureClientsPopovers() {
    if (clientsPop && clientsPop.host && document.body.contains(clientsPop.host)) return clientsPop;
    var host = document.createElement('div');
    host.className = 'tma-dash__clients-popover-host';
    host.innerHTML = clientsPopShell('fields') + clientsPopShell('values') + clientsPopShell('sort');
    document.body.appendChild(host);
    clientsPop = {
      host: host,
      fields: host.querySelector('[data-clients-popover="fields"]'),
      values: host.querySelector('[data-clients-popover="values"]'),
      sort: host.querySelector('[data-clients-popover="sort"]'),
    };
    wireClientsPopovers();
    return clientsPop;
  }

  function currentClientFilters() {
    return (clientsFilterCtx && clientsFilterCtx.state.filters) || emptyClientFilters();
  }

  function fillFilterFields() {
    var filters = currentClientFilters();
    clientsPop.fields.innerHTML =
      clientsPopItem('data-clients-filter-field', 'referral', 'Referred by', {
        chevron: true,
        meta: filters.referral ? referralFilterLabel(filters.referral) : '',
      }) +
      clientsPopItem('data-clients-filter-field', 'clientType', 'Client type', {
        chevron: true,
        meta: filters.clientType ? clientTypeLabel(filters.clientType) : '',
      });
  }

  function fillFilterValues(field) {
    var filters = currentClientFilters();
    var html;

    if (field === 'referral') {
      var facets = referralFacets();
      var current = filters.referral || '';
      html = clientsPopItem('data-clients-filter-value', '', 'All clients', { selected: !current }) +
        clientsPopItem('data-clients-filter-value', 'company', 'Any service provider', {
          selected: current === 'company',
          meta: facets.company ? String(facets.company) : '',
        }) +
        clientsPopItem('data-clients-filter-value', 'private', 'Private', {
          selected: current === 'private',
          meta: facets.private ? String(facets.private) : '',
        }) +
        clientsPopItem('data-clients-filter-value', 'none', 'No referral', {
          selected: current === 'none',
          meta: facets.none ? String(facets.none) : '',
        });

      var referrers = COMPANIES.filter(function (c) { return facets.byCompany[c.id]; });
      if (referrers.length) {
        html += '<div class="tma-filter-popover__divider"></div>';
        html += referrers.map(function (c) {
          var value = 'company:' + c.id;
          return clientsPopItem('data-clients-filter-value', value, c.name, {
            selected: current === value,
            meta: String(facets.byCompany[c.id]),
          });
        }).join('');
      }
    } else {
      var typeFacets = clientTypeFacets();
      var currentType = filters.clientType || '';
      html = clientsPopItem('data-clients-filter-value', '', 'All types', { selected: !currentType }) +
        CLIENT_TYPES.map(function (t) {
          return clientsPopItem('data-clients-filter-value', t.value, t.label, {
            selected: currentType === t.value,
            meta: typeFacets[t.value] ? String(typeFacets[t.value]) : '',
          });
        }).join('');
    }

    clientsPop.values.innerHTML = html;
    clientsPop.values.setAttribute('data-clients-filter-field-name', field);
  }

  function positionClientsPopover(el, rect) {
    if (!rect) return;
    var width = el.offsetWidth || 240;
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    var top = rect.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - el.offsetHeight - 4);
    }
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function closeClientsPopovers(keep) {
    if (!clientsPop) return;
    [clientsPop.fields, clientsPop.values, clientsPop.sort].forEach(function (el) {
      if (!el || (keep && keep.indexOf(el) !== -1)) return;
      el.removeAttribute('data-open');
      el.setAttribute('aria-hidden', 'true');
    });
    if (!keep && clientsFilterCtx && clientsFilterCtx.root) {
      clientsFilterCtx.root.querySelectorAll('[data-clients-filter],[data-clients-sort]').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
      });
    }
  }

  function openClientsPopover(el, anchor, keep) {
    closeClientsPopovers(keep);
    el.setAttribute('data-open', 'true');
    el.setAttribute('aria-hidden', 'false');
    el._anchorRect = anchor ? anchor.getBoundingClientRect() : null;
    if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
    // offsetWidth is 0 until the element is displayed.
    requestAnimationFrame(function () { positionClientsPopover(el, el._anchorRect); });
  }

  /* A popover that outlived its view must not drive a hidden page. */
  function clientsFilterLive() {
    var root = clientsFilterCtx && clientsFilterCtx.root;
    if (!root || !root.isConnected) return false;
    var view = root.closest ? root.closest('.tma-dash__view') : null;
    return !view || !view.hidden;
  }

  /*
   * A selection made under one filter must not survive into another: the rows
   * leave the table but the bulk bar would still hold them, and Delete would
   * take clients the reader can no longer see.
   */
  function setClientsFilter(field, value) {
    if (!clientsFilterCtx) return;
    var state = clientsFilterCtx.state;
    state.filters = state.filters || emptyClientFilters();
    state.filters[field] = value || '';
    state.page = 1;
    state.selected = {};
    clientsFilterCtx.render({ forceFull: true });
  }

  function wireClientsPopovers() {
    clientsPop.host.addEventListener('click', function (e) {
      if (!clientsFilterLive()) { closeClientsPopovers(); return; }

      var field = e.target.closest('[data-clients-filter-field]');
      if (field) {
        e.preventDefault();
        fillFilterValues(field.getAttribute('data-clients-filter-field'));
        openClientsPopover(clientsPop.values, field, [clientsPop.fields]);
        return;
      }

      var sortItem = e.target.closest('[data-clients-sort-value]');
      if (sortItem) {
        e.preventDefault();
        var state = clientsFilterCtx.state;
        state.sort = sortItem.getAttribute('data-clients-sort-value');
        state.page = 1;
        closeClientsPopovers();
        clientsFilterCtx.render({ forceFull: true });
        return;
      }

      var value = e.target.closest('[data-clients-filter-value]');
      if (value) {
        e.preventDefault();
        setClientsFilter(
          clientsPop.values.getAttribute('data-clients-filter-field-name'),
          value.getAttribute('data-clients-filter-value')
        );
        closeClientsPopovers();
      }
    });

    document.addEventListener('click', function (e) {
      if (!clientsPop || !clientsPop.host.isConnected) return;
      if (!clientsFilterLive()) { closeClientsPopovers(); return; }
      if (e.target.closest('[data-clients-popover]') || e.target.closest('[data-clients-filter]') ||
          e.target.closest('[data-clients-sort]')) return;
      closeClientsPopovers();
    });

    window.addEventListener('resize', function () {
      if (!clientsPop) return;
      [clientsPop.fields, clientsPop.values, clientsPop.sort].forEach(function (el) {
        if (el && el.hasAttribute('data-open')) positionClientsPopover(el, el._anchorRect);
      });
    });
  }

  function wireTableFilters(root, state, render) {
    clientsFilterCtx = { root: root, state: state, render: render };
    ensureClientsPopovers();

    var trigger = MORPH.unwiredOne(root, '[data-clients-filter]');
    if (trigger) {
      MORPH.on(trigger, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (clientsPop.fields.hasAttribute('data-open')) {
          closeClientsPopovers();
          return;
        }
        fillFilterFields();
        openClientsPopover(clientsPop.fields, trigger);
      });
    }

    var sortTrigger = MORPH.unwiredOne(root, '[data-clients-sort]');
    if (sortTrigger) {
      MORPH.on(sortTrigger, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (clientsPop.sort.hasAttribute('data-open')) {
          closeClientsPopovers();
          return;
        }
        var current = state.sort || 'name';
        clientsPop.sort.innerHTML = CLIENT_SORTS.map(function (s) {
          return clientsPopItem('data-clients-sort-value', s.value, s.label, { selected: current === s.value });
        }).join('');
        openClientsPopover(clientsPop.sort, sortTrigger);
      });
    }

    MORPH.unwired(root, '[data-clients-remove-filter]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var id = btn.getAttribute('data-clients-remove-filter');
        if (id === 'sort') {
          state.sort = 'name';
          state.page = 1;
          render({ forceFull: true });
          return;
        }
        setClientsFilter(id, '');
      });
    });

    var reset = MORPH.unwiredOne(root, '[data-clients-reset-filters]');
    if (reset) {
      MORPH.on(reset, 'click', function () {
        state.filters = emptyClientFilters();
        state.sort = 'name';
        state.page = 1;
        state.selected = {};
        render({ forceFull: true });
      });
    }
  }

  function wireTablePagination(root, state, render) {
    var pagination = root.querySelector('[data-clients-pagination]');
    if (!pagination) return;

    MORPH.unwired(pagination, '[data-page]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var page = parseInt(btn.getAttribute('data-page'), 10);
        if (!page || page === state.page) return;
        state.page = page;
        render({ forceFull: true });
      });
    });

    // First and last were never wired, so with a hundred pages the end of the
    // directory was unreachable however long you pressed Next.
    MORPH.unwired(pagination, '[data-direction]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        if (btn.disabled) return;
        var totalPages = clientsTotalPages(state, tableRowEntries(state).length);
        var target = state.page;
        switch (btn.getAttribute('data-direction')) {
          case 'first': target = 1; break;
          case 'prev': target = state.page - 1; break;
          case 'next': target = state.page + 1; break;
          case 'last': target = totalPages; break;
        }
        target = Math.min(Math.max(1, target), totalPages);
        if (target === state.page) return;
        state.page = target;
        render({ forceFull: true });
      });
    });

    var pageSizeBtn = pagination.querySelector('[data-clients-page-size]');
    if (pageSizeBtn) {
      MORPH.on(pageSizeBtn, 'click', function () {
        var idx = CLIENTS_PAGE_SIZES.indexOf(clientsPageSize(state));
        state.pageSize = CLIENTS_PAGE_SIZES[(idx + 1) % CLIENTS_PAGE_SIZES.length];
        savePageSize(state.pageSize);
        state.page = 1;
        render({ forceFull: true });
      });
    }
  }

  function deleteSelectedClients(state, render) {
    var keys = Object.keys(state.selected || {});
    if (!keys.length) return;
    // Hide them at once, then confirm with the server; restore on failure.
    state.removedIds = state.removedIds || {};
    keys.forEach(function (key) { state.removedIds[key] = true; });
    state.selected = {};
    state.page = 1;
    render({ forceFull: true });
    ClientsAPI.bulkRemove(keys).then(function () {
      clientsToast(keys.length > 1 ? keys.length + ' clients removed' : 'Client removed', 'positive');
    }).catch(function (err) {
      keys.forEach(function (key) { delete state.removedIds[key]; });
      render({ forceFull: true });
      clientsToast((err && err.message) || 'Could not remove the selection', 'negative');
    });
  }

  function duplicateSelectedClients(state, render) {
    var keys = Object.keys(state.selected || {});
    if (!keys.length) return;
    Promise.all(keys.map(function (key) {
      return ClientsAPI.duplicate(key).then(function (res) {
        return res && res.client ? res.client : null;
      });
    })).then(function (records) {
      var nextSelected = {};
      records.forEach(function (rec) {
        if (!rec || !rec.id) return;
        rememberProfile(rec.id, rec.profile);
        // A copy inherits the original's type and referral; without this the
        // new row would claim to be an unreferred private client.
        rememberMeta(rec);
        insertContact({ id: rec.id, name: rec.name, initial: rec.initial, initialColor: rec.initialColor });
        nextSelected[rec.id] = true;
      });
      state.selected = nextSelected;
      render({ forceFull: true });
      clientsToast(keys.length > 1 ? keys.length + ' clients duplicated' : 'Client duplicated', 'positive');
    }).catch(function (err) {
      clientsToast((err && err.message) || 'Could not duplicate the selection', 'negative');
    });
  }

  /*
   * The buttons the empty and failed states offer: retry the directory, retry
   * one client's profile, and the "Add client" call to action TMANoData draws.
   *
   * TMANoData binds its own button when mounted through TMANoData.mount(); the
   * clients page renders it into a morphed string instead, so the click is
   * picked up here.
   */
  function wireClientsRecovery(root, state, render, navigate) {
    MORPH.unwired(root, '[data-clients-retry]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var controller = root._clientsController;
        if (controller && controller.retryLoad) controller.retryLoad();
      });
    });

    MORPH.unwired(root, '[data-clients-retry-profile]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        state.profileError = null;
    state.profileErrorFinal = false;
        state.profileErrorFinal = false;
        state.profileLoadingFor = null;
        ensureProfileLoaded(state, render);
        render({ detailOnly: !usesPagedClientsFlow(state) });
      });
    });

    MORPH.unwired(root, '[data-no-data-action="add"]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        navigate('add');
      });
    });
  }

  function wireTableBulkActions(root, state, render) {
    MORPH.unwired(root, '[data-clients-bulk-action]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var action = btn.getAttribute('data-clients-bulk-action');
        if (action === 'delete') deleteSelectedClients(state, render);
        else if (action === 'duplicate') duplicateSelectedClients(state, render);
      });
    });
  }

  /*
   * Selection, read from the DOM at the moment it is asked.
   *
   * This used to capture the checkbox list and the row array when it wired up.
   * The select-all box survives a re-render (that is the point of morphing),
   * so its handler was bound once and kept the very first render's nodes for
   * ever — change the page size or turn a page and ticking it set `checked`
   * on elements no longer in the document. Nothing visibly happened.
   *
   * Rows are also identified by their own uid rather than by their position in
   * a captured array, so a re-ordered or re-filtered table cannot select
   * somebody other than the person whose box was ticked.
   */
  function wireTableSelection(root, state) {
    var table = root.querySelector('.tma-dash__ctable--clients');
    if (!table) return;

    function boxes() {
      return Array.prototype.slice.call(table.querySelectorAll('[data-clients-check]'));
    }

    function keyOf(cb) {
      var row = cb.closest('[data-clients-row]');
      return row ? row.getAttribute('data-clients-row') : null;
    }

    function applyRow(cb) {
      var key = keyOf(cb);
      if (!key) return;
      if (cb.checked) state.selected[key] = true;
      else delete state.selected[key];
      var rowEl = cb.closest('[data-row-index]');
      if (rowEl) rowEl.classList.toggle('tma-dash__ctr--selected', cb.checked);
    }

    function syncSelectAll() {
      var selectAll = table.querySelector('[data-clients-selectall]');
      if (!selectAll) return;
      var all = boxes();
      var checked = all.filter(function (c) { return c.checked; }).length;
      selectAll.checked = all.length > 0 && checked === all.length;
      selectAll.indeterminate = checked > 0 && checked < all.length;
    }

    MORPH.unwired(table, '[data-clients-check]').forEach(function (cb) {
      MORPH.on(cb, 'change', function () {
        applyRow(cb);
        updateTableToolbarSelection(root, state);
        syncSelectAll();
      });
    });

    var selectAll = MORPH.unwiredOne(table, '[data-clients-selectall]');
    if (selectAll) {
      MORPH.on(selectAll, 'change', function () {
        // Live nodes, not the ones that existed when this was bound.
        boxes().forEach(function (cb) {
          cb.checked = selectAll.checked;
          applyRow(cb);
        });
        selectAll.indeterminate = false;
        updateTableToolbarSelection(root, state);
      });
    }

    syncSelectAll();
    updateTableToolbarSelection(root, state);
  }

  /*
   * Ask the database who matches.
   *
   * Names are matched in the browser as they are typed, so the list responds to
   * every keystroke; this fills in what the browser cannot see — nicknames, job
   * titles, addresses, and the second and third email address. The list renders
   * once on the local answer and again when the server's arrives, which is what
   * the search spinner in the field is reporting.
   */
  var searchSeq = 0;

  function runClientSearch(root, state) {
    var term = String(state.search || '').trim();

    if (term.length < SEARCH_MIN_LENGTH) {
      clearSearchHits();
      searchSeq++;
      state.searchLoading = false;
      refreshDirectoryFromSearch(root, state);
      return;
    }

    // Show the name matches straight away; the field keeps its spinner until
    // the fuller answer lands.
    refreshDirectoryFromSearch(root, state);

    var seq = ++searchSeq;
    ClientsAPI.search(term).then(function (res) {
      if (seq !== searchSeq) return; // a later keystroke owns the field now
      var hits = {};
      ((res && res.ids) || []).forEach(function (id) { hits[id] = true; });
      SEARCH_HITS = hits;
      SEARCH_HITS_TERM = term.toLowerCase();
      state.searchLoading = false;
      refreshDirectoryFromSearch(root, state);
    }).catch(function () {
      if (seq !== searchSeq) return;
      // Leave the local name matches standing. Emptying the list because the
      // search request failed is the mistake this whole change is undoing.
      clearSearchHits();
      state.searchLoading = false;
      refreshDirectoryFromSearch(root, state);
    });
  }

  function refreshDirectoryFromSearch(root, state) {
    state.page = 1;
    if (root.querySelector('[data-clients-body]') && state.viewMode === 'list') {
      if (root._clientsController && root._clientsController.render) {
        root._clientsController.render({ forceFull: true });
      }
      return;
    }

    syncDirectoryList(root, state);
    root.querySelectorAll('[data-clients-row]').forEach(function (btn) {
      var id = btn.getAttribute('data-clients-row');
      btn.classList.toggle('tma-dash__clients-row--active', id === state.selectedId);
    });
    syncSearchWrap(root, state);
  }

  function ensureClientsSearchWiring(root, state) {
    if (root._clientsSearchWiring) return;
    root._clientsSearchWiring = true;
    var searchTimer = null;

    root.addEventListener('focusin', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.searchFocused = true;
      syncSearchWrap(root, state);
    });

    root.addEventListener('focusout', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.searchFocused = false;
      syncSearchWrap(root, state);
    });

    root.addEventListener('input', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.search = e.target.value;
      state.searchFocused = true;
      state.searchLoading = true;
      syncSearchWrap(root, state);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        runClientSearch(root, state);
      }, 180);
    });

    root.addEventListener('click', function (e) {
      var wrap = e.target.closest('[data-clients-search-wrap]');
      if (!wrap || !root.contains(wrap)) return;

      if (e.target.closest('[data-clients-search-clear]')) {
        e.preventDefault();
        clearTimeout(searchTimer);
        state.search = '';
        state.searchLoading = false;
        state.searchFocused = true;
        clearSearchHits();
        searchSeq++;
        var searchInput = wrap.querySelector('[data-clients-search]');
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        refreshDirectoryFromSearch(root, state);
        return;
      }

      if (e.target.closest('[data-clients-search-shortcut]')) {
        e.preventDefault();
        var shortcutInput = wrap.querySelector('[data-clients-search]');
        if (shortcutInput) shortcutInput.focus();
        state.searchFocused = true;
        syncSearchWrap(root, state);
        return;
      }

      if (!e.target.matches('[data-clients-search]')) {
        var clickInput = wrap.querySelector('[data-clients-search]');
        if (clickInput) clickInput.focus();
        state.searchFocused = true;
        syncSearchWrap(root, state);
      }
    });
  }

  function syncDirectoryList(root, state) {
    var body = root.querySelector('.tma-dash__clients-directory-body');
    if (!body) return false;
    MORPH.patch(body, renderDirectoryListBody(state));
    return true;
  }

  function wireSearchEvents(root, state) {
    ensureClientsSearchWiring(root, state);
  }

  var clientsHeadActionsNavigate = null;
  var clientsHeadActionsWired = false;

  var CLIENTS_ADMIN_PAGES = {
    'clienthub-access': { title: 'Client hub access' },
    'service-teams': { title: 'Service teams' },
    'custom-fields': { title: 'Custom fields' },
  };

  function navigateToClientsAdminPage(adminPage) {
    var meta = CLIENTS_ADMIN_PAGES[adminPage];
    if (!meta || !canManageClientHub()) return;
    if (!window.TMADashboard || !window.TMADashboard.navigate) return;
    window.TMADashboard.navigate({
      navId: 'account-settings',
      view: 'admin',
      title: meta.title,
      crumb: 'Account settings / Client hub management / ' + meta.title,
      adminPage: adminPage,
    });
  }

  function ensureClientsHeadActionsWiring() {
    if (clientsHeadActionsWired) return;
    clientsHeadActionsWired = true;
    if (window.TMAHeadDropdown) window.TMAHeadDropdown.mount();

    var access = window.TMAPortalAccess;
    if (access && access.ready) {
      access.ready().then(function () { refreshClientsHeadActions(); });
    }

    document.addEventListener('head-dropdown:select', function (event) {
      var wrap = event.detail && event.detail.wrap;
      if (!wrap || !wrap.closest('[data-clients-page-actions]')) return;
      var action = event.detail.action || '';

      if (action.indexOf('admin:') === 0) {
        navigateToClientsAdminPage(action.slice(6));
        return;
      }
      if (action === 'create-new' && clientsHeadActionsNavigate) {
        clientsHeadActionsNavigate('add');
        return;
      }
      if (action === 'create-company' && clientsHeadActionsNavigate) {
        clientsHeadActionsNavigate('add-company');
        return;
      }
      if (action === 'create-import') {
        var slot = wrap.closest('[data-clients-page-actions]');
        var importInput = slot && slot.querySelector('[data-clients-import-input]');
        if (importInput) importInput.click();
      }
    });

    document.addEventListener('change', function (event) {
      var input = event.target.closest('[data-clients-import-input]');
      if (input) input.value = '';
    });
  }


  function wireEvents(root, state, scope, navigate, render) {
    // Rows appear in the directory, table list, and company people lists.
    wireDirectoryRows(root, state, navigate);
    wireSeeAllReferred(root, state, navigate);
    // Empty and failed states show in every view, so this is wired before the
    // per-view branches below — several of which return early.
    wireClientsRecovery(root, state, render, navigate);

    if (scope === 'list' || scope === 'split') {
      wireSearchEvents(root, state);
      // The split view carries the drag handle between the list and the
      // detail pane; re-attached each render, and a no-op where there is none.
      attachClientsResizer(root, state);

      MORPH.unwired(root, '[data-clients-layout]').forEach(function (btn) {
        btn.remove();
      });

      if (scope === 'list' && state.viewMode === 'list') {
        wireTableFilters(root, state, render);
        wireTablePagination(root, state, render);
        wireTableSelection(root, state);
        wireTableBulkActions(root, state, render);
        MORPH.unwired(root, '[data-clients-open-company]').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var companyId = btn.getAttribute('data-clients-open-company');
            if (companyId) navigate('company', null, { companyId: companyId });
          });
        });
        return;
      }
    }

    var backBtn = unwiredClientsChrome(root, '[data-clients-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (state.screen === 'edit') navigate('detail', state.selectedId);
        else if (state.screen === 'edit-company' && state.companyId) {
          navigate('company', null, { companyId: state.companyId });
        } else {
          navigate('list');
        }
      });
    }

    var editBtn = unwiredClientsChrome(root, '[data-clients-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        navigate('edit', state.selectedId);
      });
    }

    var cancelBtn = unwiredClientsChrome(root, '[data-clients-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        if (state.screen === 'add-company') {
          navigate('list');
          return;
        }
        if (state.screen === 'edit-company' && state.companyId) {
          navigate('company', null, { companyId: state.companyId });
          return;
        }
        if (state.screen === 'add' || state.adding) {
          if (state.companyId && companyFor(state.companyId)) {
            navigate('company', null, { companyId: state.companyId });
          } else if (usesPagedClientsFlow(state)) {
            navigate('list');
          } else {
            navigate('detail', state.selectedId);
          }
          return;
        }
        navigate('detail', state.selectedId);
      });
    }

    var saveBtn = unwiredClientsChrome(root, '[data-clients-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (saveBtn.disabled) return;
        var draft = readFormDraft(root);
        var adding = !!state.adding;
        var id = adding ? uniqueId(slugId(displayName(draft) || 'New Client')) : state.selectedId;
        var payload = draftPayload(draft, id);

        saveBtn.disabled = true;
        var request = adding ? ClientsAPI.create(payload) : ClientsAPI.update(id, payload);
        request.then(function (res) {
          // The server owns the final uid (a proposed slug can collide), so
          // fold the record it returns back into the local directory.
          var savedId = res && res.client && res.client.id ? res.client.id : id;
          saveContactRecord(savedId, draft, !directoryItemFor(savedId));
          if (res && res.client) rememberMeta(res.client);
          clientsToast(adding ? 'Client added' : 'Changes saved', 'positive');
          navigate('detail', savedId, { forceFull: adding && !usesPagedClientsFlow(state) });
        }).catch(function (err) {
          saveBtn.disabled = false;
          clientsToast((err && err.message) || 'Could not save this client', 'negative');
        });
      });
    }

    MORPH.unwired(root, '[data-clients-add-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        syncDraftFromForm(root, state);
        var group = btn.getAttribute('data-clients-add-group');
        if (group === 'phones') state.draft.phones.push(emptyPhone('mobile'));
        if (group === 'emails') state.draft.emails.push(emptyEmail());
        if (group === 'addresses') state.draft.addresses.push(emptyAddress());
        if (group === 'importantDates') state.draft.importantDates.push(emptyDate('custom'));
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });

    MORPH.unwired(root, '[data-clients-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        syncDraftFromForm(root, state);
        var group = btn.getAttribute('data-clients-remove');
        var index = parseInt(btn.getAttribute('data-clients-index'), 10);
        if (group === 'phones' && state.draft.phones.length > 1) state.draft.phones.splice(index, 1);
        if (group === 'emails' && state.draft.emails.length > 1) state.draft.emails.splice(index, 1);
        if (group === 'addresses' && state.draft.addresses.length > 1) state.draft.addresses.splice(index, 1);
        if (group === 'importantDates' && state.draft.importantDates.length > 1) state.draft.importantDates.splice(index, 1);
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });

    var photoBtn = root.querySelector('[data-clients-photo-btn]');
    var photoInput = root.querySelector('[data-clients-photo-input]');
    var photoPreview = root.querySelector('[data-clients-photo-preview]');
    var photoRemove = root.querySelector('[data-clients-photo-remove]');
    var detailHead = clientsDetailHeadRoot();
    var formHead = (detailHead && detailHead.querySelector('.tma-dash__clients-profile-head')) ||
      root.querySelector('.tma-dash__clients-profile--form .tma-dash__clients-profile-head');

    function refreshFormHeadAvatar() {
      if (!formHead) return;
      var contact = state.adding ? null : contactFor(state.selectedId);
      var title = state.adding ? 'New person' : 'Edit person';
      formHead.innerHTML =
        renderFormHeadAvatar(state.draft, contact, !!state.adding) +
        '<span class="tma-dash__clients-profile-name">' + esc(title) + '</span>';
    }

    if (photoBtn && photoInput) {
      MORPH.on(photoBtn, 'click', function () {
        photoInput.click();
      });

      MORPH.on(photoInput, 'change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file || !photoPreview) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          photoPreview.src = ev.target.result;
          photoPreview.alt = 'Client photo';
          photoBtn.dataset.hasImage = 'true';
          syncDraftFromForm(root, state);
          refreshFormHeadAvatar();
        };
        reader.readAsDataURL(file);
      });
    }

    if (photoRemove) {
      MORPH.on(photoRemove, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (photoBtn) delete photoBtn.dataset.hasImage;
        if (photoPreview) {
          photoPreview.removeAttribute('src');
          photoPreview.alt = '';
        }
        if (photoInput) photoInput.value = '';
        syncDraftFromForm(root, state);
        refreshFormHeadAvatar();
      });
    }

    MORPH.unwired(root, '[data-clients-date-type]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var i = sel.getAttribute('data-clients-date-type');
        var labelEl = root.querySelector('[data-clients-date-label="' + i + '"]');
        if (!labelEl) return;
        var isCustom = sel.value === 'custom';
        labelEl.disabled = !isCustom;
        labelEl.classList.toggle('tma-dash__clients-date-label--hidden', !isCustom);
      });
    });

    var messageBtn = unwiredClientsChrome(root, '[data-clients-message]');
    if (messageBtn) {
      messageBtn.addEventListener('click', function () {
        var userId = clientUserId(state.selectedId);
        if (!userId) {
          clientsToast('This client doesn’t have a portal login to message yet', 'negative');
          return;
        }
        if (window.TMADashboard && window.TMADashboard.navigate) {
          window.TMADashboard.navigate({
            navId: 'so-messages',
            view: 'messages',
            title: 'Messages',
            crumb: 'Messages',
            openDirectUserId: userId,
          });
        }
      });
    }

    unwiredAllClientsChrome(root, '[data-clients-open-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openClientFolder(state.selectedId);
      });
    });

    wireClientFolderPanel(root);

    MORPH.unwired(root, '[data-clients-open-company]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var companyId = btn.getAttribute('data-clients-open-company');
        if (companyId) navigate('company', null, { companyId: companyId });
      });
    });

    var editCompanyBtn = unwiredClientsChrome(root, '[data-clients-edit-company]');
    if (editCompanyBtn) {
      editCompanyBtn.addEventListener('click', function () {
        navigate('edit-company', null, { companyId: state.companyId });
      });
    }

    var addPersonBtn = unwiredClientsChrome(root, '[data-clients-add-person]');
    if (addPersonBtn) {
      addPersonBtn.addEventListener('click', function () {
        state.prefillCompanyId = state.companyId || '';
        navigate('add');
      });
    }

    var saveCompanyBtn = unwiredClientsChrome(root, '[data-clients-save-company]');
    if (saveCompanyBtn) {
      saveCompanyBtn.addEventListener('click', function () {
        if (saveCompanyBtn.disabled) return;
        var nameEl = root.querySelector('[data-clients-field="companyName"]');
        var websiteEl = root.querySelector('[data-clients-field="companyWebsite"]');
        var notesEl = root.querySelector('[data-clients-field="companyNotes"]');
        var cipCodeEl = root.querySelector('[data-clients-field="companyCipCode"]');
        var payload = {
          name: nameEl ? nameEl.value.trim() : '',
          website: websiteEl ? websiteEl.value.trim() : '',
          notes: notesEl ? notesEl.value.trim() : '',
          cipCode: cipCodeEl ? cipCodeEl.value.trim() : '',
        };
        if (!payload.name) {
          clientsToast('Service provider name is required', 'negative');
          return;
        }
        saveCompanyBtn.disabled = true;
        var isNew = state.screen === 'add-company';
        var req = isNew
          ? CompaniesAPI.create(payload)
          : CompaniesAPI.update(state.companyId, payload);
        req.then(function (res) {
          var company = res && res.company;
          if (company) {
            var existing = companyFor(company.id);
            if (existing) Object.assign(existing, company);
            else COMPANIES.push(company);
            hydrateCompanies(COMPANIES);
          }
          clientsToast(isNew ? 'Service provider created' : 'Service provider saved', 'positive');
          navigate('company', null, { companyId: company ? company.id : state.companyId });
        }).catch(function (err) {
          saveCompanyBtn.disabled = false;
          clientsToast((err && err.message) || 'Could not save company', 'negative');
        });
      });
    }

    var assignSubmit = MORPH.unwiredOne(root, '[data-clients-assign-submit]');
    if (assignSubmit) {
      assignSubmit.addEventListener('click', function () {
        var userSel = root.querySelector('[data-clients-assign-user]');
        var levelSel = root.querySelector('[data-clients-assign-level]');
        var userId = userSel && userSel.value ? parseInt(userSel.value, 10) : 0;
        if (!userId) {
          clientsToast('Choose a staff member to assign', 'negative');
          return;
        }
        ClientsAPI.assign(state.selectedId, {
          userId: userId,
          level: levelSel ? levelSel.value : 'editor',
        }).then(function (res) {
          state.assignments = (res && res.assignments) || [];
          clientsToast('Staff assigned', 'positive');
          if (usesPagedClientsFlow(state)) render();
          else render({ detailOnly: true });
          // Refresh assignable list (assigned people drop out of the picker).
          ClientsAPI.assignments(state.selectedId).then(function (data) {
            state.assignable = (data && data.assignable) || [];
            if (usesPagedClientsFlow(state)) render();
            else render({ detailOnly: true });
          });
        }).catch(function (err) {
          clientsToast((err && err.message) || 'Could not assign staff', 'negative');
        });
      });
    }

    MORPH.unwired(root, '[data-clients-unassign]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var userId = btn.getAttribute('data-clients-unassign');
        if (!userId || !window.confirm('End this staff assignment? Their access is removed, but the record is kept.')) return;
        ClientsAPI.unassign(state.selectedId, userId).then(function (res) {
          state.assignments = (res && res.assignments) || [];
          state.assignmentHistory = (res && res.history) || state.assignmentHistory;
          clientsToast('Assignment ended', 'positive');
          ClientsAPI.assignments(state.selectedId).then(function (data) {
            state.assignable = (data && data.assignable) || [];
            if (usesPagedClientsFlow(state)) render();
            else render({ detailOnly: true });
          });
        }).catch(function () {
          clientsToast('Could not remove assignment', 'negative');
        });
      });
    });

    /* ------------------------------------------------ portal invitations */

    function redraw() {
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    }

    // Fold a fresh invitation record into state and repaint.
    function applyInvitation(res) {
      state.invitation = (res && res.invitation) || null;
      // The panel reads state.access, so re-pull it rather than letting the
      // tab show a stale invitation next to a fresh toolbar button.
      state.accessLoadedFor = null;
      ensureAccessLoaded(state, render);
      redraw();
    }

    /* ------------------------------------------------ company members */

    function refreshCompanyPanels() {
      state.companyPanelsFor = null;
      ensureCompanyPanelsLoaded(state, render);
    }

    var memberAdd = MORPH.unwiredOne(root, '[data-company-member-add]');
    if (memberAdd) {
      memberAdd.addEventListener('click', function () {
        var emailEl = root.querySelector('[data-company-member-email]');
        var roleEl = root.querySelector('[data-company-member-role]');
        var email = emailEl && emailEl.value ? emailEl.value.trim() : '';
        if (!email) {
          clientsToast('Enter an email address', 'negative');
          return;
        }
        memberAdd.disabled = true;
        CompanyMembersAPI.add(state.companyId, {
          email: email,
          role: roleEl ? roleEl.value : 'member',
        }).then(function () {
          clientsToast('Member added', 'positive');
          refreshCompanyPanels();
        }).catch(function (err) {
          memberAdd.disabled = false;
          clientsToast((err && err.message) || 'Could not add that person', 'negative');
        });
      });
    }

    MORPH.unwired(root, '[data-company-member-invite]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        CompanyMembersAPI.invite(state.companyId, btn.getAttribute('data-company-member-invite'))
          .then(function () {
            clientsToast('Invitation sent', 'positive');
            refreshCompanyPanels();
          }).catch(function (err) {
            btn.disabled = false;
            clientsToast((err && err.message) || 'Could not send the invitation', 'negative');
          });
      });
    });

    MORPH.unwired(root, '[data-company-member-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Remove this person’s access to the company?')) return;
        CompanyMembersAPI.remove(state.companyId, btn.getAttribute('data-company-member-remove'))
          .then(function () {
            clientsToast('Access removed', 'positive');
            refreshCompanyPanels();
          }).catch(function (err) {
            clientsToast((err && err.message) || 'Could not remove them', 'negative');
          });
      });
    });

    /* -------------------------------------------- company staff */

    var staffAdd = MORPH.unwiredOne(root, '[data-company-staff-add]');
    if (staffAdd) {
      staffAdd.addEventListener('click', function () {
        var userEl = root.querySelector('[data-company-staff-user]');
        var levelEl = root.querySelector('[data-company-staff-level]');
        var scopeEl = root.querySelector('[data-company-staff-scope]');
        var userId = userEl && userEl.value ? parseInt(userEl.value, 10) : 0;
        var scope = scopeEl ? scopeEl.value : 'company_only';

        if (!userId) {
          clientsToast('Choose a staff member to assign', 'negative');
          return;
        }

        var apply = function () {
          staffAdd.disabled = true;
          CompanyStaffAPI.assign(state.companyId, {
            userId: userId,
            level: levelEl ? levelEl.value : 'editor',
            appliesToClients: scope,
          }).then(function () {
            clientsToast('Staff assigned', 'positive');
            refreshCompanyPanels();
          }).catch(function (err) {
            staffAdd.disabled = false;
            clientsToast((err && err.message) || 'Could not assign staff', 'negative');
          });
        };

        // Anything wider than the company itself is confirmed against what it
        // will actually cover — the spec forbids granting broad access without
        // showing the administrator the consequence first.
        if (scope === 'company_only') {
          apply();
          return;
        }

        CompanyStaffAPI.preview(state.companyId, scope).then(function (res) {
          var p = (res && res.preview) || {};
          var n = p.contactsCovered || 0;
          var msg = 'This also gives access to ' + n + ' contact' + (n === 1 ? '' : 's') +
            ' at ' + (p.companyName || 'this company') +
            (p.includesFuture ? ', and any added later' : '') + '.\n\nContinue?';
          if (window.confirm(msg)) apply();
        }).catch(function () {
          // Preview unavailable — ask plainly rather than assigning silently.
          if (window.confirm('This reaches beyond the company record. Continue?')) apply();
        });
      });
    }

    MORPH.unwired(root, '[data-company-staff-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('End this assignment? Any access it granted is removed.')) return;
        CompanyStaffAPI.remove(state.companyId, btn.getAttribute('data-company-staff-remove'))
          .then(function () {
            clientsToast('Assignment ended', 'positive');
            refreshCompanyPanels();
          }).catch(function (err) {
            clientsToast((err && err.message) || 'Could not end the assignment', 'negative');
          });
      });
    });

    // The toolbar button. Sends the first invitation, or chases an outstanding
    // one — which is the case staff actually hit ("they never got the email").
    var inviteToolbar = MORPH.unwiredOne(root, '[data-clients-invite-toolbar]');
    if (inviteToolbar) {
      inviteToolbar.addEventListener('click', function () {
        inviteToolbar.disabled = true;
        ClientsAPI.invite(state.selectedId).then(function (res) {
          applyInvitation(res);
          clientsToast(
            res && res.reminder
              ? 'Invitation resent — the previous link no longer works'
              : 'Invitation sent',
            'positive'
          );
        }).catch(function (err) {
          inviteToolbar.disabled = false;
          clientsToast((err && err.message) || 'Could not send the invitation', 'negative');
        });
      });
    }

    var inviteBtn = MORPH.unwiredOne(root, '[data-clients-invite]');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', function () {
        inviteBtn.disabled = true;
        ClientsAPI.invite(state.selectedId).then(function (res) {
          applyInvitation(res);
          clientsToast(res && res.reminder ? 'Reminder sent' : 'Invitation sent', 'positive');
        }).catch(function (err) {
          inviteBtn.disabled = false;
          clientsToast((err && err.message) || 'Could not send the invitation', 'negative');
        });
      });
    }

    MORPH.unwired(root, '[data-clients-invite-resend]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        InvitationsAPI.resend(btn.getAttribute('data-clients-invite-resend')).then(function (res) {
          applyInvitation(res);
          // Resending mints a new link, so any link already sent stops working.
          clientsToast('Invitation resent — the previous link no longer works', 'positive');
        }).catch(function (err) {
          btn.disabled = false;
          clientsToast((err && err.message) || 'Could not resend the invitation', 'negative');
        });
      });
    });

    MORPH.unwired(root, '[data-clients-invite-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Cancel this invitation? The link will stop working.')) return;
        InvitationsAPI.cancel(btn.getAttribute('data-clients-invite-cancel')).then(function (res) {
          applyInvitation(res);
          clientsToast('Invitation cancelled', 'positive');
        }).catch(function (err) {
          clientsToast((err && err.message) || 'Could not cancel the invitation', 'negative');
        });
      });
    });

    MORPH.unwired(root, '[data-clients-invite-link]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        InvitationsAPI.link(btn.getAttribute('data-clients-invite-link')).then(function (res) {
          var url = res && res.url;
          if (!url) return;
          var done = function () {
            clientsToast('Link copied — it replaces any link already sent', 'positive');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, function () { window.prompt('Invitation link', url); });
          } else {
            window.prompt('Invitation link', url);
          }
        }).catch(function (err) {
          clientsToast((err && err.message) || 'Could not create a link', 'negative');
        });
      });
    });

    MORPH.unwired(root, '[data-clients-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.profileTab = btn.getAttribute('data-clients-tab');
        if (state.profileTab === 'assigned' && state.selectedId) {
          ensureAssignmentsLoaded(state, render);
        }
        if (state.profileTab === 'access' && state.selectedId) {
          ensureAccessLoaded(state, render);
        }
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });
  }

  /* The client's invitation, loaded alongside their assigned staff. Kept
     separate from ensureAssignmentsLoaded so a client hub without the
     assignments capability still shows portal access. */
  /* Members and assigned staff for the open company. Guarded per company so
     re-rendering does not refetch. */
  function ensureCompanyPanelsLoaded(state, render) {
    if (!state.companyId) return;
    if (state.companyPanelsFor === state.companyId) return;
    state.companyPanelsFor = state.companyId;
    state.companyMembersLoading = true;
    state.companyStaffLoading = true;

    var redraw = function () {
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    };
    var stale = function () { return state.companyPanelsFor !== state.companyId; };

    CompanyMembersAPI.list(state.companyId).then(function (d) {
      if (stale()) return;
      state.companyMembers = (d && d.members) || [];
      state.companyMembersLoading = false;
      redraw();
    }).catch(function () {
      if (stale()) return;
      state.companyMembers = [];
      state.companyMembersLoading = false;
      redraw();
    });

    // Staff assignment is administrator-only; a 403 here is expected for an
    // employee and must not surface as an error.
    CompanyStaffAPI.list(state.companyId).then(function (d) {
      if (stale()) return;
      state.companyStaff = (d && d.assignments) || [];
      state.companyStaffAssignable = (d && d.assignable) || [];
      state.companyStaffLoading = false;
      redraw();
    }).catch(function () {
      if (stale()) return;
      state.companyStaff = [];
      state.companyStaffAssignable = [];
      state.companyStaffLoading = false;
      redraw();
    });
  }

  /* Everything the Portal access tab shows. One call: the invitation when
     there is no account, the sign-in log and activity once there is. */
  /*
   * Fetch the open client's profile, once.
   *
   * The directory listing carries names and columns only, so opening a record
   * is the moment its profile is actually needed. Everything that draws the
   * detail view reads PROFILES, and profileLoaded() tells the view whether to
   * draw the record or a skeleton.
   */
  function ensureProfileLoaded(state, render) {
    var id = state.selectedId;
    if (!id || profileLoaded(id)) return;
    if (state.profileLoadingFor === id) return;

    state.profileLoadingFor = id;
    state.profileError = null;

    var stale = function () { return state.profileLoadingFor !== id; };
    var redraw = function () {
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    };

    ClientsAPI.show(id).then(function (res) {
      if (stale()) return;
      var rec = res && res.client;
      // An empty profile is a real answer — most imported clients have one —
      // so this records the fetch even when there is nothing in it.
      rememberProfile(id, rec ? rec.profile : {});
      if (rec) rememberMeta(rec);
      state.profileLoadingFor = null;
      // An edit screen was waiting on this to build its draft (see
      // applyScreen); it holds null until the record is actually in hand.
      if (state.screen === 'edit' && state.selectedId === id && !state.draft) {
        state.draft = contactToDraft(contactFor(id));
      }
      redraw();
    }).catch(function (err) {
      if (stale()) return;
      state.profileLoadingFor = null;
      // Deliberately not marked loaded: leaving it unfetched is what lets
      // reopening the client try again.
      //
      // Our own sentence rather than err.message, which for a 500 is the
      // fetch layer's "Request failed" — true, and no use to the person
      // looking at an empty panel. The real error is in the console.
      // A 404 is not a failure: the record is outside this account's slice
      // (or does not exist — the server deliberately will not say which).
      if (err && err.status === 404) {
        state.profileError = 'You’re not assigned to this client.';
        state.profileErrorFinal = true;
      } else {
        state.profileError = 'Couldn’t load this client.';
        state.profileErrorFinal = false;
      }
      redraw();
    });
  }

  function ensureAccessLoaded(state, render) {
    if (!state.selectedId) return;
    if (state.accessLoadedFor === state.selectedId) return;
    state.accessLoadedFor = state.selectedId;
    state.accessLoading = true;

    var redraw = function () {
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    };
    var stale = function () { return state.accessLoadedFor !== state.selectedId; };

    // No redraw before the request: this is called from applyScreen, which is
    // still setting the screen up.
    ClientsAPI.access(state.selectedId).then(function (d) {
      if (stale()) return;
      state.access = d || null;
      // The toolbar button reads this to choose Invite vs Resend.
      state.invitation = (d && d.invitation) || null;
      state.accessLoading = false;
      redraw();
    }).catch(function () {
      if (stale()) return;
      state.access = null;
      state.invitation = null;
      state.accessLoading = false;
      redraw();
    });
  }

  /*
   * opts.quiet skips the redraw that shows the panel's loading state. Set when
   * this is called from applyScreen, which is still setting the screen up — the
   * same reason ensureAccessLoaded does not redraw up front.
   */
  function ensureAssignmentsLoaded(state, render, opts) {
    if (!state.selectedId) return;
    if (state.assignmentsLoadedFor === state.selectedId && !state.assignmentsLoading) return;
    state.assignmentsLoading = true;
    state.assignmentsLoadedFor = state.selectedId;
    if (opts && opts.quiet) { /* no redraw yet */ }
    else if (usesPagedClientsFlow(state)) render();
    else render({ detailOnly: true });
    ClientsAPI.assignments(state.selectedId).then(function (data) {
      if (state.assignmentsLoadedFor !== state.selectedId) return;
      state.assignments = (data && data.assignments) || [];
      state.assignable = (data && data.assignable) || [];
      state.assignmentHistory = (data && data.history) || [];
      state.assignmentsLoading = false;
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    }).catch(function () {
      state.assignmentsLoading = false;
      state.assignments = [];
      state.assignable = [];
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    });
  }

  var clientsMountRoot = null;

  function syncClientsShell(screen, viewMode) {
    var dash = document.querySelector('.tma-dash');
    if (!dash) return;
    var mobile = isClientsMobile();
    var listFull = !mobile && viewMode === 'list';
    dash.classList.toggle('tma-dash--clients-mobile', mobile);
    dash.classList.toggle('tma-dash--clients-detail', (mobile || listFull) && screen !== 'list');
    dash.classList.toggle('tma-dash--clients-table', listFull && screen === 'list');
  }

  function mount(root) {
    clientsMountRoot = root;
    if (root._clientsController) {
      root._clientsController.syncRoute(parseClientsPath(window.location.pathname));
      return;
    }

    var state = {
      screen: 'list',
      selectedId: null,
      companyId: null,
      companyDraft: null,
      prefillCompanyId: '',
      adding: false,
      editing: false,
      draft: null,
      profileTab: 'info',
      assignments: [],
      assignable: [],
      assignmentHistory: [],
      assignmentsLoading: false,
      assignmentsLoadedFor: null,
      invitation: null,
      access: null,
      accessLoading: false,
      accessLoadedFor: null,
      companyMembers: [],
      companyStaff: [],
      companyStaffAssignable: [],
      companyMembersLoading: false,
      companyStaffLoading: false,
      companyPanelsFor: null,
      listScrollTop: 0,
      search: '',
      searchFocused: false,
      searchLoading: false,
      filters: emptyClientFilters(),
      sort: 'name',
      viewMode: loadViewMode(),
      page: 1,
      pageSize: loadPageSize(),
      selected: {},
      removedIds: {},
      // 'loading' | 'ready' | 'error'. The directory used to have no third
      // state, so a request that failed was hydrated as an empty list and the
      // page reported "No clients found" — see startClients below.
      loadState: clientsLoaded ? 'ready' : 'loading',
      loadError: null,
      profileLoadingFor: null,
      profileError: null,
      // Ids the server matched for the current term. null means "no server
      // answer in play", which is what local name matching falls back to.
      searchIds: null,
      searchTerm: '',
    };

    function pageMetaFor(screen, contactId, companyId) {
      // In table/mobile detail flow the in-page back bar already says "Clients",
      // so keep the global page title empty to avoid the duplicate label.
      if (usesPagedClientsFlow(state) && screen !== 'list') {
        return { title: '', crumb: 'Clients' };
      }
      if (screen === 'add') {
        return { title: 'New person', crumb: 'Clients / New person' };
      }
      if (screen === 'add-company') {
        return { title: 'New service provider', crumb: 'Clients / New service provider' };
      }
      if (screen === 'company' || screen === 'edit-company') {
        var company = companyFor(companyId || state.companyId);
        var companyName = company ? company.name : 'Service provider';
        if (screen === 'edit-company') {
          return { title: companyName, crumb: 'Clients / ' + companyName };
        }
        return { title: companyName, crumb: 'Clients / ' + companyName };
      }
      if ((screen === 'detail' || screen === 'edit') && contactId) {
        var contact = contactFor(contactId);
        return { title: contact.name, crumb: 'Clients / ' + contact.name };
      }
      return { title: 'Clients', crumb: 'Clients' };
    }

    function applyScreen(screen, contactId, companyId) {
      var previousId = state.selectedId;
      state.screen = screen;
      state.adding = screen === 'add';
      state.editing = screen === 'edit';
      if (companyId) state.companyId = companyId;
      if (contactId) state.selectedId = contactId;
      if (contactId && contactId !== previousId) {
        state.profileTab = 'info';
        state.profileLoadingFor = null;
        state.profileError = null;
        state.assignmentsLoadedFor = null;
        state.assignments = [];
        state.assignmentHistory = [];
        state.accessLoadedFor = null;
        state.access = null;
        state.invitation = null;
      }

      // Portal access is loaded whenever a client is opened, not only when the
      // Assigned tab is, because the toolbar button needs to know whether this
      // is a first invitation or a chase-up. Assigned staff comes with it now
      // for the same kind of reason: its tab carries a count, and a count that
      // only appears once you open the tab is no use to anybody.
      // Both flows show the profile: 'contact' in the split view, 'detail'
      // in the paged/mobile one.
      if ((state.screen === 'contact' || state.screen === 'detail') && state.selectedId) {
        ensureProfileLoaded(state, render);
        ensureAccessLoaded(state, render);
        ensureAssignmentsLoaded(state, render, { quiet: true });
      }

      if (state.screen === 'company' && state.companyId) {
        ensureCompanyPanelsLoaded(state, render);
      }

      if (screen === 'add') {
        state.draft = emptyDraft({ companyId: state.prefillCompanyId || '' });
        state.prefillCompanyId = '';
        state.profileTab = 'info';
        state.companyDraft = null;
        return;
      }

      if (screen === 'add-company') {
        state.companyDraft = emptyCompanyDraft();
        state.draft = null;
        return;
      }

      if (screen === 'edit-company' && state.companyId) {
        var editCompany = companyFor(state.companyId) || {};
        state.companyDraft = {
          name: editCompany.name || '',
          website: editCompany.website || '',
          notes: editCompany.notes || '',
          cipCode: editCompany.cipCode || '',
        };
        state.draft = null;
        return;
      }

      if (screen === 'company') {
        state.draft = null;
        state.companyDraft = null;
        return;
      }

      if (screen === 'edit' && contactId) {
        // The draft is the record: building one before the profile has landed
        // would open a blank form over a real client, and saving it would
        // write that blank back. Wait, and build it in ensureProfileLoaded.
        ensureProfileLoaded(state, render);
        state.draft = profileLoaded(contactId) ? contactToDraft(contactFor(contactId)) : null;
        state.companyDraft = null;
        return;
      }

      state.draft = null;
      state.companyDraft = null;
      if (screen === 'detail') state.profileTab = state.profileTab || 'info';
    }

    function renderDetailPanel() {
      var page = root.querySelector('.tma-dash__clients-page');
      if (!page) return false;
      var detail = page.querySelector('.tma-dash__clients-detail');
      var html = renderDetailContent(state);
      if (detail) {
        detail.outerHTML = html;
      } else {
        page.insertAdjacentHTML('beforeend', html);
      }
      return true;
    }

    function syncDirectorySelection() {
      root.querySelectorAll('[data-clients-row]').forEach(function (btn) {
        var id = btn.getAttribute('data-clients-row');
        var isActive = id === state.selectedId;
        btn.classList.toggle('tma-dash__clients-row--active', isActive);
      });
    }

    function render(options) {
      options = options || {};
      syncClientsShell(state.screen, state.viewMode);
      syncClientsPageActions(state, navigate);
      syncClientsDetailHead(state);
      root.className = state.viewMode === 'grid'
        ? 'tma-dash__clients tma-dash__clients--grid'
        : 'tma-dash__clients';

      if (usesPagedClientsFlow(state)) {
        if (state.screen === 'list') {
          MORPH.patch(root, state.viewMode === 'list'
            ? renderTableListPage(state)
            : renderListPage(state));
          wireEvents(root, state, 'list', navigate, render);
          if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
          requestAnimationFrame(function () {
            var dirBody = root.querySelector('.tma-dash__clients-directory-body');
            if (dirBody) dirBody.scrollTop = state.listScrollTop;
          });
          return;
        }

        MORPH.patch(root, renderDetailPage(state));
        wireEvents(root, state, 'detail', navigate, render);
        if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
        return;
      }

      if (!isClientsMobile()) {
        var hasSplit = root.querySelector('.tma-dash__clients-page .tma-dash__clients-directory');
        if (!options.forceFull && hasSplit && options.detailOnly && renderDetailPanel()) {
          syncDirectorySelection();
          wireEvents(root, state, 'split', navigate, render);
          return;
        }
        MORPH.patch(root, renderDesktopPage(state));
        wireEvents(root, state, 'split', navigate, render);
        if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
        requestAnimationFrame(function () {
          var dirBody = root.querySelector('.tma-dash__clients-directory-body');
          if (dirBody) dirBody.scrollTop = state.listScrollTop;
        });
        return;
      }

      if (state.screen === 'list') {
        MORPH.patch(root, renderListPage(state));
        wireEvents(root, state, 'list', navigate, render);
        requestAnimationFrame(function () {
          var dirBody = root.querySelector('.tma-dash__clients-directory-body');
          if (dirBody) dirBody.scrollTop = state.listScrollTop;
        });
        return;
      }

      MORPH.patch(root, renderDetailPage(state));
      wireEvents(root, state, 'detail', navigate, render);
    }

    function navigate(screen, contactId, navOpts) {
      navOpts = navOpts || {};
      var companyId = navOpts.companyId || state.companyId;
      if (screen === 'detail' || screen === 'edit' || screen === 'add') {
        contactId = contactId || state.selectedId;
      } else {
        contactId = contactId || null;
      }

      if (!usesPagedClientsFlow(state)) {
        var dirBody = root.querySelector('.tma-dash__clients-directory-body');
        if (dirBody) state.listScrollTop = dirBody.scrollTop;

        applyScreen(screen, contactId, companyId);

        var meta = pageMetaFor(screen, contactId || state.selectedId, companyId);
        if (screen === 'list') {
          meta = pageMetaFor('detail', state.selectedId);
        }

        history.replaceState(
          {
            navId: 'clients',
            view: 'clients',
            title: meta.title,
            crumb: meta.crumb,
            clientsScreen: 'list',
            contactId: state.selectedId || null,
            companyId: state.companyId || null,
          },
          '',
          pathForClientsScreen(screen === 'list' ? 'list' : screen, state.selectedId, state.companyId)
        );

        if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
          window.TMADashboard.updatePageMeta(meta);
        }

        var needsFullRender = !!navOpts.forceFull ||
          ((screen === 'add' || screen === 'add-company' || screen === 'company') &&
            !root.querySelector('.tma-dash__clients-page'));
        render({
          detailOnly: !needsFullRender,
          forceFull: needsFullRender,
        });
        return;
      }

      if (state.screen === 'list') {
        var listDirBody = root.querySelector('.tma-dash__clients-directory-body');
        state.listScrollTop = listDirBody ? listDirBody.scrollTop : 0;
      }

      applyScreen(screen, contactId, companyId);

      var mobileMeta = pageMetaFor(screen, contactId || state.selectedId, companyId);
      var historyState = {
        navId: 'clients',
        view: 'clients',
        title: mobileMeta.title,
        crumb: mobileMeta.crumb,
        clientsScreen: screen,
        contactId: contactId || null,
        companyId: state.companyId || null,
      };

      history.pushState(
        historyState,
        '',
        pathForClientsScreen(screen, contactId || state.selectedId, state.companyId)
      );

      if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
        window.TMADashboard.updatePageMeta(mobileMeta);
      }

      render();

      if (screen !== 'list') {
        requestAnimationFrame(function () {
          resetClientsScroll(root);
        });
      }
    }

    function syncRoute(route) {
      route = route || parseClientsPath(window.location.pathname);
      if (!route) return;

      if (route.legacyRedirect && window.history.replaceState) {
        history.replaceState(
          {
            navId: 'clients',
            view: 'clients',
            title: route.screen === 'add' ? 'New person' : 'Clients',
            crumb: route.screen === 'add' ? 'Clients / New person' : 'Clients',
            clientsScreen: route.screen || 'list',
            contactId: route.contactId || null,
            companyId: route.companyId || null,
          },
          '',
          pathForClientsScreen(route.screen || 'list', route.contactId, route.companyId)
        );
      }

      if (!isClientsMobile() && state.viewMode !== 'list') {
        applyScreen(route.screen || 'detail', route.contactId || state.selectedId, route.companyId || null);
        if (!state.selectedId && route.screen !== 'add' && route.screen !== 'add-company' &&
            route.screen !== 'company' && route.screen !== 'edit-company') {
          var first = firstDirectoryItem();
          state.selectedId = first ? first.id : null;
          if (state.screen === 'detail' || state.screen === 'list') {
            state.screen = state.selectedId ? 'detail' : 'list';
          }
        }

        syncClientsShell(state.screen, state.viewMode);

        var desktopMeta = pageMetaFor(state.screen, state.selectedId, state.companyId);

        if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
          window.TMADashboard.updatePageMeta(desktopMeta);
        }

        render();

        if (route.screen !== 'list' && window.history.replaceState) {
          history.replaceState(
            {
              navId: 'clients',
              view: 'clients',
              title: 'Clients',
              crumb: 'Clients',
              clientsScreen: 'list',
              contactId: state.selectedId,
            },
            '',
            '/clients'
          );
        }
        return;
      }

      applyScreen(route.screen || 'list', route.contactId, route.companyId || null);
      syncClientsShell(state.screen, state.viewMode);

      var meta = pageMetaFor(state.screen, state.selectedId, state.companyId);
      if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
        window.TMADashboard.updatePageMeta(meta);
      }

      render();

      if (state.screen !== 'list') {
        requestAnimationFrame(function () {
          resetClientsScroll(root);
        });
      }
    }

    root._clientsController = { syncRoute: syncRoute, navigate: navigate, render: render };
    registerViewToggle({ state: state, render: render });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var dash = document.querySelector('.tma-dash');
      if (!dash || !dash.classList.contains('tma-dash--clients')) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      var searchInput = root.querySelector('[data-clients-search]');
      if (!searchInput) return;
      e.preventDefault();
      searchInput.focus();
      state.searchFocused = true;
      syncSearchWrap(root, state);
    });

    var lastMobile = isClientsMobile();
    window.addEventListener('resize', function () {
      var nextMobile = isClientsMobile();
      if (nextMobile === lastMobile) return;
      lastMobile = nextMobile;
      syncRoute(parseClientsPath(window.location.pathname));
    });

    function startClients() {
      // Point the default selection at a real client once loaded, so the
      // split view opens on someone who exists rather than seed data.
      if (!directoryItemFor(state.selectedId)) {
        var first = firstDirectoryItem();
        state.selectedId = first ? first.id : null;
      }
      syncRoute(parseClientsPath(window.location.pathname));
    }

    /*
     * Load the directory.
     *
     * The failure path is the point of this. It used to be
     * `.catch(() => ({ clients: [] }))` — a timed-out or 500ing request became
     * an empty list, was hydrated as though it were the truth, and rendered as
     * "No clients found". Staff were told the firm had no clients whenever the
     * request died, which with eleven thousand of them it regularly did.
     *
     * A failure is now its own state, it says so, and it offers a retry.
     */
    function loadClients() {
      state.loadState = 'loading';
      state.loadError = null;
      startClients();

      // Paint the directory as soon as clients arrive. Companies are secondary
      // (company column / company view) and used to hold the whole hub hostage.
      ClientsAPI.list().then(function (data) {
        hydrateClients((data && data.clients) || []);
        state.loadState = 'ready';
        state.loadError = null;
        startClients();

        CompaniesAPI.list().then(function (companies) {
          hydrateCompanies((companies && companies.companies) || []);
          if (clientsMountRoot && clientsMountRoot._clientsController) {
            clientsMountRoot._clientsController.syncRoute(
              parseClientsPath(window.location.pathname)
            );
          }
        }).catch(function () {
          hydrateCompanies([]);
        });
      }).catch(function () {
        state.loadState = 'error';
        // Our own sentence, not err.message: for a 500 the fetch layer says
        // "Request failed", which is true and tells the reader nothing they
        // can act on. The real error is in the console.
        state.loadError = 'The directory didn’t answer. It may just be busy.';
        // clientsLoaded stays false: nothing was loaded, and leaving it false
        // is what lets a later mount try again instead of showing a blank hub.
        startClients();
      });
    }

    root._clientsController.retryLoad = loadClients;

    if (clientsLoaded) startClients();
    else loadClients();
  }

  /*
   * Live updates: a client added, edited, invited or deleted by a colleague
   * appears here without a refresh.
   *
   * Note the null-on-failure catches. The bootstrap above deliberately falls
   * back to an empty list so a first mount can still render something, but the
   * same fallback on a background refresh would quietly empty a directory
   * somebody is reading because one request timed out. Here a failed fetch
   * means "keep what we have and wait for the next signal".
   */
  if (window.TMALive) {
    window.TMALive.register(window.TMALive.RESOURCES.CLIENTS, function () {
      ClientsAPI.invalidateList();
      return Promise.all([
        ClientsAPI.list({ force: true }).catch(function () { return null; }),
        CompaniesAPI.list().catch(function () { return null; }),
      ]).then(function (results) {
        var clients = results[0];
        var companies = results[1];

        if (clients && clients.clients) hydrateClients(clients.clients);
        if (companies && companies.companies) hydrateCompanies(companies.companies);
        if (!clients && !companies) return;

        if (!clientsMountRoot || !clientsMountRoot._clientsController) return;

        // syncRoute rather than render: it re-derives which client should be
        // selected from the URL and renders, which also settles the case where
        // the client being viewed was just deleted by somebody else. The view
        // state lives inside mount(), so it cannot be corrected from here.
        clientsMountRoot._clientsController.syncRoute(parseClientsPath(window.location.pathname));
      });
    }, {
      active: function () {
        return !!clientsMountRoot && document.contains(clientsMountRoot);
      },
    });
  }

  window.TMAClients = {
    mount: mount,
    contactFor: contactFor,
    hasContact: function (id) {
      return !!directoryItemFor(id);
    },
    syncRoute: function (route) {
      if (!clientsMountRoot || !clientsMountRoot._clientsController) return;
      var parsed = route || parseClientsPath(window.location.pathname);
      clientsMountRoot._clientsController.syncRoute(parsed);
    },
    routeFromPath: parseClientsPath,
    listDirectory: function (opts) { return ClientsAPI.list(opts); },
  };
})();
