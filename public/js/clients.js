/*
 * TMA - Clients page ( /clients )
 * Global: window.TMAClients
 */
(function () {
  'use strict';

  /*
   * Keyed DOM reconciliation (js/dom-morph.js). See dom-morph.js for why the
   * views no longer assign innerHTML, and why the wiring below binds through
   * MORPH.unwired / unwiredOne / on, nodes survive a render now, so plain
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

  /*
   * The CIP application a client's profile is showing, by client uid.
   *
   * A client is the hub's record of a person; the application is what the
   * firm is actually working on for them, and the profile's tabs are its
   * sections. Cached per client so switching tabs does not refetch, and
   * cleared on the way into an edit so a saved change is read back.
   */
  var APPLICATIONS = {};

  function applicationFor(id) {
    return Object.prototype.hasOwnProperty.call(APPLICATIONS, id) ? APPLICATIONS[id] : undefined;
  }
  var LIST_TAB_KEY = 'tma.cipListTab.v1';

  /*
   * The three things this page lists.
   *
   * They shared one table, told apart by a Type column and a filter, which
   * meant the answer to "how many applications are there" was a number you
   * had to filter for, and paging through applications walked you into
   * providers. They are different records with different columns; a tab each
   * is what the page was doing informally. Provider contacts is every contact
   * that belongs to a service provider, the same rows the firm card used to
   * hide one company at a time.
   */
  var LIST_TABS = [
    { id: 'applications', label: 'Applications' },
    { id: 'providers', label: 'Service providers' },
    { id: 'people', label: 'Provider contacts' },
  ];

  function listTabOf(state) {
    var tab = state && state.listTab;
    if (tab === 'providers' || tab === 'people') return tab;
    return 'applications';
  }

  function loadListTab() {
    try {
      return listTabOf({ listTab: localStorage.getItem(LIST_TAB_KEY) });
    } catch (e) {
      return 'applications';
    }
  }

  function saveListTab(tab) {
    try { localStorage.setItem(LIST_TAB_KEY, listTabOf({ listTab: tab })); } catch (e) { /* private mode */ }
  }

  function onProvidersTab(state) {
    return listTabOf(state) === 'providers';
  }

  function onPeopleTab(state) {
    return listTabOf(state) === 'people';
  }

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
    ArrowSquareOut: ICON + 'ArrowSquareOut.svg',
    Buildings: ICON + 'Buildings.svg',
    Globe: ICON + 'Globe.svg',
    CalendarBlank: ICON + 'CalendarBlank.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
    Image: ICON + 'Image.svg',
    IdentificationCard: ICON + 'IdentificationCard.svg',
    Circle: ICON + 'Circle.svg',
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
    // The id stays `folders`, it keys the panel, the tab state and the
    // File Library folder it opens onto.
    { id: 'folders', label: 'Documents' },
    { id: 'assigned', label: 'Assigned' },
    { id: 'messages', label: 'Messages' },
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
    , the wider options are shown with what they will cover before they apply. */
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
        /*
         * A write that landed makes every cached hub listing suspect, the
         * same blanket rule, at the same kind of seam, as the File Library's
         * (see TMAFilesNet.fetchJSON): every client, company, assignment and
         * invitation write in the hub goes through here, and dropping the
         * prefix costs one refetch of whatever is opened next.
         */
        if (opts.method && opts.method !== 'GET' && window.TMAStore) {
          window.TMAStore.invalidate('clients:');
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
    conversations: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/conversations');
    },
    openConversation: function (uid, withWhom) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/conversations', {
        method: 'POST',
        json: { with: withWhom },
      });
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
    get: function (uid) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid));
    },
    create: function (payload) { return clientsFetch(COMPANIES_BASE, { method: 'POST', json: payload }); },
    update: function (uid, payload) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid), { method: 'PATCH', json: payload });
    },
    remove: function (uid, withPeople) {
      return clientsFetch(COMPANIES_BASE + '/' + encodeURIComponent(uid) +
        (withPeople ? '?withPeople=1' : ''), { method: 'DELETE' });
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

  /* The referrer's name, "Private", or nothing at all, the three answers the
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
   * The listing stopped carrying profiles, eleven thousand of them was nine
   * megabytes of JSON per page load, so a missing PROFILES entry now means
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
      // The face, where the record has one. Carried on the item rather than
      // read from the profile blob: the listing does not send profiles, so a
      // row would otherwise wear initials until somebody opened it.
      if (rec.photo) item.photo = rec.photo;
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
    // Classification is a column, not part of the contact blob, same reason
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
        // No invented title. "Team member" was a placeholder standing under
        // every client's name as if the firm had recorded it, and a client is
        // not a member of the team, which is the one thing it managed to say.
        jobTitle: extra.role || '',
        department: extra.department || '',
        company: extra.company || '',
      },
      addresses: extra.addresses || [
        // Same rule as the job title above: an unrecorded city is blank, not
        // "Remote", the portal does not know where they are.
        { type: 'work', street: '', city: extra.location || '', state: '', zip: '', country: '' },
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
    if (item.photo) contact.photo = item.photo;
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
      // The row's own photo first: it rides on the lean directory record, so
      // a face shows in the table without waiting for a profile to be opened.
      // The blob is the fallback for a photo set through the contact form.
      photo: item.photo || profile.photo || '',
    };
  }

  var CONTACTS_MOBILE_BP = 1024;

  function isClientsMobile() {
    return window.innerWidth <= CONTACTS_MOBILE_BP;
  }

  /*
   * The hub is a table, and only a table.
   *
   * It used to offer a second arrangement, a directory column beside a
   * detail pane, reachable from a toggle in the toolbar and remembered per
   * reader. Two layouts meant every screen, every render path and every
   * measurement in this file had to be right in both, and the column one was
   * a narrower table with a profile squeezed in beside it. The firm reads
   * applications as a table; that is the one this keeps.
   *
   * The predicate stays rather than being inlined as `true` everywhere: it is
   * what the rest of the file asks, and answering it in one place is what made
   * removing the other layout a small change instead of a hunt.
   */
  function usesTableFullPage() {
    return true;
  }

  function usesPagedClientsFlow(state) {
    return isClientsMobile() || usesTableFullPage(state);
  }

  function parseClientsPath(pathname) {
    var p = String(pathname || '').replace(/\/+$/, '') || '/';
    if (p === '/clients' || p === '/user-profile/clients') {
      return { screen: 'list' };
    }
    if (p === '/clients/applications/new') {
      return { screen: 'new-application' };
    }
    var editApp = p.match(/^\/clients\/applications\/([^/]+)\/edit$/);
    if (editApp) {
      return { screen: 'edit-application', applicationId: decodeURIComponent(editApp[1]) };
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
    if (screen === 'new-application') return '/clients/applications/new';
    if (screen === 'edit-application' && contactId) {
      return '/clients/applications/' + encodeURIComponent(contactId) + '/edit';
    }
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

    /*
     * What the applications table is narrowed to is a position within the
     * list, the way the tab and the folder are a position within a client —
     * so it belongs in the address with it. All three are server-applied
     * filters, so all three travel: a link that carried the status but not the
     * officer would open somebody else's table.
     *
     * Built here rather than at the places the filters change, because every
     * return to the list rewrites this URL (see navigate and syncRoute) and
     * each of those would otherwise drop a filter the reader can still see on
     * the screen in front of them.
     */
    var listParams = [];
    ['bucket', 'assignee', 'provider'].forEach(function (field) {
      var ticked = filterValues(field);
      if (ticked.length) listParams.push(field + '=' + encodeURIComponent(ticked.join(',')));
    });
    if (APP_TABLE.sort && CIP_SORTS[APP_TABLE.sort]) {
      listParams.push('sort=' + encodeURIComponent(APP_TABLE.sort));
      listParams.push('dir=' + encodeURIComponent(APP_TABLE.dir === 'desc' ? 'desc' : 'asc'));
    }

    return '/clients' + (listParams.length ? '?' + listParams.join('&') : '');
  }

  /*
   * Where you were, in the address bar.
   *
   * A reload used to land on the first tab with the folder path thrown away,
   * so somebody three folders deep in a client's documents who pressed refresh
   *, or followed a link, or came back, started again from the top. The tab
   * and the open folder are where you are, so they belong in the URL, which is
   * also what makes a screen linkable and the back button mean something.
   *
   * Query rather than path: the path addresses the client, and these are a
   * position within it.
   */
  function clientsDetailUrl(state) {
    var base = pathForClientsScreen(state.screen, state.selectedId, state.companyId);
    var params = [];
    var tab = state.profileTab;

    // Guarded on the screen once, by the caller. Repeating it here only bought
    // a URL that carried the folder without the tab that shows it.
    if (tab) params.push('tab=' + encodeURIComponent(tab));

    // Only the folder actually in view. The trail above it is rebuilt from the
    // server's own parent chain, so a link does not have to carry it.
    if (tab === 'folders' && clientFolderNav) {
      var here = clientFolderNav.path[clientFolderNav.path.length - 1];
      if (here && here.uuid !== clientFolderNav.rootUuid) {
        params.push('folder=' + encodeURIComponent(here.uuid));
      }
    }

    return base + (params.length ? '?' + params.join('&') : '');
  }

  /* Rewrite the address for a move within the same screen, a tab, a folder.
     Never a new history entry: the client is the destination, and stepping
     back through six folders to leave them is not "back". */
  function syncClientsDetailUrl(state) {
    if (!window.history || !history.replaceState) return;
    if (state.screen !== 'detail' || !state.selectedId) return;
    history.replaceState(history.state, '', clientsDetailUrl(state));
  }

  /*
   * Is this view the page the reader is actually looking at?
   *
   * The shell keeps every view mounted and hides all but one, so this module
   * can be re-rendered, by a live signal, by a filter set from the Dashboard
   * card, while the reader is somewhere else entirely. Anything that writes
   * to the address bar has to ask this first.
   */
  function clientsViewShowing() {
    var root = clientsMountRoot;
    if (!root || !root.isConnected) return false;
    var view = root.closest ? root.closest('.tma-dash__view') : null;

    return !view || !view.hidden;
  }

  /* Set while a write is waiting for the shell to finish moving, see below. */
  var listUrlRetry = false;

  /*
   * The same job for the list: keep the address saying what the applications
   * table is narrowed to.
   *
   * Only when it would change anything. This is called from every paint of the
   * table, and rewriting the address to what it already says is work in front
   * of everything else that reads it.
   *
   * The wait is the subtle part. Coming back to the hub from another view,
   * dashboard.js shows this view and lets it render, which is where this is
   * called from, and only then pushes /clients. So the address still says
   * /files at this moment, and writing now would both aim at the wrong page
   * and replace the entry the reader would press Back to reach. Writing later
   * is safe: dashboard.js compares pathnames alone, so it leaves a /clients
   * address that already carries a query untouched.
   *
   * This used to return when the address did not parse as a clients route,
   * which meant it never wrote at all on the way in, the filter stayed on the
   * screen while the address forgot it, and a reload or a shared link lost it.
   * The property that guard was protecting is now asked directly, of the view
   * rather than of the URL.
   */
  function syncClientsListUrl(state) {
    if (!window.history || !history.replaceState) return;
    if (!state || state.screen !== 'list') return;
    if (!clientsViewShowing()) return;

    if (!parseClientsPath(window.location.pathname)) {
      if (listUrlRetry) return;
      listUrlRetry = true;
      setTimeout(function () {
        listUrlRetry = false;
        // Re-asked from the top: by now the reader may have moved on again,
        // and this is the same one-line answer as any other caller's.
        syncClientsListUrl(clientsMountState);
      }, 0);

      return;
    }

    var url = pathForClientsScreen('list');
    if (window.location.pathname + window.location.search === url) return;
    history.replaceState(history.state, '', url);
  }

  /*
   * Where the address says to be, read once at boot.
   *
   * Read eagerly, because dashboard.js rewrites the URL as it settles the
   * route and the query is gone by the time this view mounts, the same trap
   * the File Library's deep links hit.
   */
  var BOOT_POSITION = (function () {
    var params = new URLSearchParams(window.location.search || '');

    var folder = params.get('folder') || null;

    // A folder can only be shown on the documents tab, so it says which tab
    // to open, a link that carries one and not the other still works.
    return {
      tab: params.get('tab') || (folder ? 'folders' : null),
      folder: folder,
      // What the applications table opens filtered to, so a reload or a link
      // from the Dashboard's CIP card lands on the same rows. Each is checked
      // against the server's own set before it is trusted, see
      // settleApplicationFacets and ensureBuckets.
      bucket: params.get('bucket') || null,
      assignee: params.get('assignee') || null,
      provider: params.get('provider') || null,
      sort: params.get('sort') || null,
      dir: params.get('dir') || null,
    };
  })();

  /* Taken, not read: a boot position applies to the screen it was typed for,
     and must not reapply when the reader moves on to another client. Each part
     is claimed by whatever restores it, which happen at different moments —
     the tab once the profile knows which tabs it has, the folder once the
     documents panel mounts, the bucket at the first paint of the table it
     filters. */
  function takeBootPosition(key) {
    var value = BOOT_POSITION[key];
    BOOT_POSITION[key] = null;

    return value;
  }

  /*
   * What the server matched for the current term.
   *
   * Search used to run over the profiles the browser held. The listing does not
   * carry them any more, so the database answers instead and this holds the ids
   * it returned. `null` means no server answer is in play, the term is too
   * short to ask about, the request is still out, or it failed, and matching
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
    // Every client's name is in hand, so it matches on the keystroke, the
    // round trip only adds the fields the browser no longer holds.
    if (item.name.toLowerCase().indexOf(q) !== -1) return true;
    if (SEARCH_HITS && SEARCH_HITS_TERM === q) return !!SEARCH_HITS[item.id];
    // While the server answer is in flight, a profile that happens to be
    // loaded, the open client, one just saved, can still match locally.
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
   * Which list is on screen.
   *
   * One filter menu serves both tabs on this page, and every field it offers
   * asks about an application: what state it is in, whose desk it is on, whose
   * firm filed it. A service provider is a firm, it is the answer to the
   * third question, not a subject of any of them, so on that tab the menu has
   * nothing to say and is not offered at all. Every field below starts here.
   */
  function onApplicationsTable(state) {
    return !!state && state.screen === 'list' && listTabOf(state) === 'applications';
  }

  /*
   * Where a status filter means anything.
   *
   * The server's set is the second half of the test, if it named no buckets
   * then this reader has no CIP dashboard, and a field with no values is a
   * dead end.
   */
  function statusFilterApplies(state) {
    return onApplicationsTable(state) && BUCKETS.list.length > 0;
  }

  /*
   * The same test for the officers and the firms.
   *
   * Only that the server had something to offer. It sends every officer and
   * every firm this reader may filter by, counts included where they are
   * zero, so there is nothing left for the browser to second-guess, a
   * dropdown that hid itself when one of its answers happened to be empty
   * would be a toolbar that changes shape as the work moves.
   */
  function assigneeFilterApplies(state) {
    return onApplicationsTable(state) && APP_TABLE.assignees.length > 0;
  }

  function providerFilterApplies(state) {
    return onApplicationsTable(state) && APP_TABLE.providers.length > 0;
  }

  /*
   * What lights the Filter button.
   *
   * All three live on the module rather than on the state, because the server
   * is what applies them, the listing is re-asked for, not re-matched over
   * rows the browser holds. To the reader they are one control, so a lit state
   * that knew about only some of what is applied would be the button telling
   * them nothing is filtered while the table says otherwise.
   */
  function anyTableFilter(state) {
    if (!onApplicationsTable(state)) return false;

    return anyTableFilterSet();
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

  /* One layout, so nothing to remember. A reader who had chosen the column
     view before it was removed still opens the table. */
  function loadViewMode() {
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

  /*
   * Not registered any more: the toggle draws a control for switching between
   * two layouts, and there is one. Registering it would put a button in the
   * toolbar whose other position no longer exists.
   */
  function registerViewToggle() {
    return;
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
   * the profile, the table has to draw eleven thousand rows without eleven
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
    return (meta && meta.contact) || '-';
  }

  function clientTableColumns(item) {
    // The referrer is only a link when a company is what referred them:
    // "Private" names no record to open.
    var referrerId = clientReferralType(item.id) === 'company' ? clientReferrerId(item.id) : '';
    return {
      name: item.name,
      type: clientTypeLabel(clientTypeOf(item.id)),
      referral: clientReferralLabel(item.id) || '-',
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
   *, a directory where everybody is the same colour is a directory where the
   * avatar tells you nothing. Hashing means one person keeps their colour
   * across pages and reloads.
   */
  function initialsAvatarUri(name, seed) {
    var cu = window.TMACurrentUser;
    // No name means no initials and no colour, every circle would come back
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
    // current-user.js not loaded on this shell, keep a readable circle.
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue"' +
      ' style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)">' + esc(av.initial || '?') + '</span>'
    );
  }

  function selectedClientCount(state) {
    return Object.keys(state.selected || {}).length;
  }

  /* Employees work in the hub; how it is shaped, who may reach it, the
     service teams, the custom fields every record inherits, is the
     administrator's call, and these three open exactly those settings
     sections. Hidden rather than left to 404 in the rail. */
  function canManageClientHub() {
    if (isExternalCipUser()) return false;
    var access = window.TMAPortalAccess;
    return !access || !access.canSettingsPage || access.canSettingsPage('clienthub-access');
  }

  function renderClientsHeadActions() {
    return (
      (canManageClientHub()
        ? '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
          '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--secondary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
          'Manage' +
          '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
          '</button>' +
          '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--start" data-head-dropdown-menu hidden role="menu" aria-label="Manage CIP Applications">' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:clienthub-access">Manage access</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:service-teams">Manage service teams</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:custom-fields">Manage custom fields</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:cip-documents">Manage documents</button>' +
          '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:cip-letters">Manage decision letters</button>' +
          '</div></div>'
        : '') +
      '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
      '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--primary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
      'Create New Application' +
      '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--end" data-head-dropdown-menu hidden role="menu" aria-label="Create New Application">' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-new">New application</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-company">New service provider</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-import">Import</button>' +
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

  /*
   * The list's tabs, in the page head rather than above the table.
   *
   * They sit on the same line as Create New Application, where the page title
   * was. The title said "CIP Applications" while the lit tab said
   * "Applications" directly beneath it, the same word twice, one of them
   * doing nothing. The tab that is lit names the page now.
   *
   * Rendered into the shell's head, so it is synced on every render the way
   * the head actions are; the page's own DOM no longer contains them.
   */
  function isExternalCipUser() {
    var access = window.TMAPortalAccess;
    if (access && typeof access.isProviderContact === 'function' && access.isProviderContact()) {
      return true;
    }
    if (window.TMABootProviderContact === true || window.TMABootProviderContact === 'true') {
      return true;
    }
    var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
    return !!(me && (me.isProviderContact || (me.cipReach && !me.isStaff)));
  }

  function syncClientsHeadTabs(state, render) {
    var slot = document.querySelector('[data-page-head-tabs]');
    if (!slot) return;

    // Provider contacts / private clients: applications only, no staff tabs.
    if (isExternalCipUser()) {
      state.listTab = 'applications';
      slot.hidden = true;
      slot.innerHTML = '';
      return;
    }

    // The tabs describe a list. There is no list on a profile or a form.
    var show = state.screen === 'list' && state.viewMode === 'list';
    slot.hidden = !show;
    if (!show) {
      slot.innerHTML = '';

      return;
    }

    MORPH.patch(slot, '<div data-clients-head-tabs>' + renderListTabs(state) + '</div>');
    wireListTabs(slot, state, render);
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

  /*
   * The filters, as dropdowns in the toolbar itself.
   *
   * Not behind the funnel. What the table can be narrowed by is part of
   * reading the table, so the three questions sit in the open where the
   * reader can see them and see which are answered, a funnel hides both, and
   * a filter you have to go looking for is one nobody uses.
   *
   * Each opens its own checkbox list, because the reader is choosing several
   * from a list rather than picking one: "New or Delayed" is one thought, and
   * a control that closed on the first tick would make it three trips.
   *
   * Nothing is offered on the Service providers tab. All three are facts
   * about an application, a status, an officer, a firm, and that tab lists
   * firms, which hold none of them.
   */
  function renderTableFilterDropdowns(state) {
    if (!onApplicationsTable(state)) return '';

    var fields = [];
    if (statusFilterApplies(state)) fields.push(['bucket', 'Status']);
    if (assigneeFilterApplies(state)) fields.push(['assignee', 'Assigned to']);
    if (providerFilterApplies(state)) fields.push(['provider', 'Service provider']);
    if (!fields.length) return '';

    return '<div class="tma-dash__toolbar-filters">' +
      fields.map(function (pair) {
        var field = pair[0];
        var ticked = filterValues(field).length;

        /*
         * The button says how many are ticked rather than naming them. One
         * name would be a lie the moment there are two, and three names would
         * push the search box off the end of the toolbar, the chips under it
         * already carry the detail, each with its own remove.
         */
        return '<button type="button" class="tma-dash__filter-drop" data-cip-dropdown="' + esc(field) + '"' +
          ' aria-haspopup="true" aria-expanded="false"' +
          ' aria-pressed="' + (ticked ? 'true' : 'false') + '">' +
          '<span class="tma-dash__filter-drop-label">' + esc(pair[1]) + '</span>' +
          (ticked ? '<span class="tma-dash__filter-drop-count">' + ticked + '</span>' : '') +
          '<img class="tma-dash__filter-drop-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
          '</button>';
      }).join('') +
      '</div>';
  }

  function renderTableToolbar(state) {
    var count = selectedClientCount(state);
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';
    var filtered = anyTableFilter(state);

    return (
      '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
      renderClientsCount(state) +
      '<img class="tma-dash__toolbar-divider" src="' + ICONS.Line + '" alt="" aria-hidden="true">' +
      renderTableFilterDropdowns(state) +
      (onApplicationsTable(state) ? ''
        : '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-clients-sort' +
          ' aria-pressed="' + (state.sort && state.sort !== 'name' ? 'true' : 'false') + '" aria-expanded="false">' +
          '<img src="' + ICONS.ArrowsDownUp + '" alt=""></button>') +
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
  /* Kept for the dead directory list below, which still names its filters
     this way. Nothing on a live screen calls it, the applications table's
     filters are named from the server's own facets. */
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

  /* What is actually applied, as removable chips under the toolbar, the
     Users-table filter bar recipe, same as the CBI list. */
  function renderClientsFilterChips(state) {
    var filters = state.filters || {};
    var tags = [];

    /*
     * The status leads, because it is the one filter that changes which
     * applications the server sent rather than which of them are drawn.
     *
     * Named from the server's own set, not from the key: a bucket the reader
     * has no dashboard for is a bucket they cannot be filtered to, and until
     * the set lands there is no label to put on the chip, a heartbeat with
     * no chip reads better than a chip that says "update_required".
     */
    /*
     * One chip per tick, not one per field.
     *
     * Three statuses ticked is three chips, each with its own ×, because the
     * reader's next thought is usually "not that one" rather than "none of
     * them", and a single chip reading "Status: 3 selected" would make
     * removing one of them a trip back into the menu.
     *
     * Every chip is named from the server's own list. A value the reader has
     * no dashboard for cannot be filtered to, and until the lists land there
     * is no label to put on a chip, a beat with no chip reads better than a
     * chip that says "update_required" or an officer's bare id.
     */
    if (onApplicationsTable(state)) {
      [
        { field: 'bucket', prefix: 'Status' },
        { field: 'assignee', prefix: 'Assigned to' },
        { field: 'provider', prefix: 'Provider' },
      ].forEach(function (group) {
        filterValues(group.field).forEach(function (value) {
          var label = filterValueLabel(group.field, value);
          if (!label) return;
          tags.push({
            id: group.field + ':' + value,
            label: group.prefix + ': ' + label,
          });
        });
      });
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
   * counts as one, reporting only the handful of *clients* flagged company
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
   * The table lists both kinds of record the hub holds, the people and the
   * companies, because a company is a client too, and until now the only way
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

  function personMatchesSearch(person, company, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return [person.name, person.email, company && company.name]
      .filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
  }

  // Client rows keep the bare uid as their key: it is what `selected` holds and
  // what bulk-delete posts, so a company key has to be namespaced instead.
  function applicationRowEntries(state) {
    return filteredDirectoryItems(state).map(function (item) {
      return { kind: 'client', key: item.id, id: item.id, name: item.name, item: item };
    });
  }

  /*
   * Providers answer to the search box and nothing else.
   *
   * The filters ask client questions, what type of record this is, who
   * referred it, and a provider is the answer to the second, not a subject of
   * either. Running them here left the tab empty whenever a filter was set for
   * the other one, which reads as "there are no providers".
   */
  function providerRowEntries(state) {
    var rows = [];
    var search = state && state.search;
    var removed = (state && state.removedIds) || {};

    COMPANIES.forEach(function (company) {
      if (!company || !company.id) return;
      if (!companyMatchesSearch(company, search)) return;
      var key = 'company:' + company.id;
      if (removed[key]) return;
      rows.push({ kind: 'company', key: key, id: company.id, name: company.name || 'Service provider', company: company });
    });

    return rows;
  }

  /*
   * Every contact that belongs to a service provider, across every firm.
   *
   * These are the same rows the company profile's Provider contacts card lists, flattened
   * so the reader does not have to open each firm to find someone. Search
   * matches the person, their email, or the firm they sit on.
   */
  function peopleRowEntries(state) {
    var rows = [];
    var search = state && state.search;
    var removed = (state && state.removedIds) || {};

    COMPANIES.forEach(function (company) {
      if (!company || !company.id) return;
      (company.people || []).forEach(function (person) {
        if (!person || !person.id) return;
        if (!personMatchesSearch(person, company, search)) return;
        var key = 'person:' + person.id;
        if (removed[key] || removed[person.id]) return;
        rows.push({
          kind: 'person',
          key: key,
          id: person.id,
          name: person.name || '',
          person: person,
          company: company,
        });
      });
    });

    return rows;
  }

  function totalPeopleRecords() {
    var n = 0;
    COMPANIES.forEach(function (company) {
      n += (company.people || []).length;
    });
    return n;
  }

  function tableRowEntries(state) {
    var tab = listTabOf(state);
    var rows = tab === 'providers'
      ? providerRowEntries(state)
      : tab === 'people'
        ? peopleRowEntries(state)
        : applicationRowEntries(state);

    return sortTableRows(rows, state && state.sort);
  }

  /* Sorting the merged list. Every comparison falls back to the name so the
     order is total, otherwise two rows sharing a type swap places on every
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
        if (r.kind === 'company') return r.name;
        if (r.kind === 'person') return (r.company && r.company.name) || '';
        return clientReferralLabel(r.id);
      }));
    }
    if (sort === 'type') {
      return rows.sort(keyed(function (r) {
        if (r.kind === 'company') return 'Service provider';
        if (r.kind === 'person') return 'Contact';
        return clientTypeLabel(clientTypeOf(r.id));
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
     otherwise read as "0 people", the emptiest possible description of the
     busiest record in the hub. */
  function companyRowSummary(company) {
    var referred = company.referredCount || 0;
    if (referred) return referred === 1 ? '1 referred' : referred + ' referred';
    var people = company.peopleCount || 0;
    if (people) return people === 1 ? '1 person' : people + ' people';
    return '-';
  }

  function renderCompanyTableRow(company, index) {
    var contact = company.email || company.phone || '-';
    var people = companyRowSummary(company);
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body" data-clients-open-company="' + esc(company.id) +
      '" data-row-index="' + index + '" role="row">' +
      // No checkbox cell either, the head has none to line up with, and an
      // empty one only indents the name away from its own column heading.
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

  /*
   * One contact from any service provider. Opening the row is the person;
   * the firm name is its own control, the same as the Applications table.
   */
  function renderProviderPersonTableRow(entry, index) {
    var person = entry.person;
    var company = entry.company;
    var contact = person.email || '-';
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body" data-clients-row="' + esc(person.id) +
      '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--user">' + clientAvatarMarkup(person) +
      '<span class="tma-dash__cc-truncate">' + esc(person.name || '') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--referral">' +
      '<button type="button" class="tma-dash__clients-company-link tma-dash__cc-truncate" data-clients-open-company="' +
      esc(company.id) + '">' + esc(company.name || 'Service provider') + '</button></div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact"><span class="tma-dash__cc-truncate">' +
      esc(contact) + '</span></div></div>'
    );
  }

  function renderFullTableRow(entry, index, checked) {
    if (entry.kind === 'company') return renderCompanyTableRow(entry.company, index);
    if (entry.kind === 'person') return renderProviderPersonTableRow(entry, index);

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
   * a bar chart, deterministic, because a re-render must not reshuffle them.
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

  function renderTableSkeletonRows(state, count) {
    var people = onPeopleTab(state);
    var noselect = people || onProvidersTab(state);
    var rows = '';
    for (var i = 0; i < (count || SKELETON_ROW_COUNT); i++) {
      rows +=
        '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--skeleton" role="row" aria-hidden="true">' +
        (noselect ? '' : '<div class="tma-dash__cc tma-dash__cc--check"></div>') +
        '<div class="tma-dash__cc tma-dash__cc--user">' +
        '<span class="tma-skeleton tma-skeleton--avatar tma-dash__clients-skeleton-avatar"></span>' +
        skeletonBar(skeletonWidth(i)) + '</div>' +
        (people ? '' : '<div class="tma-dash__cc tma-dash__cc--type">' + skeletonBar(skeletonWidth(i + 4, 0.7)) + '</div>') +
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
  /*
   * The tab row, before it is known which tabs there are.
   *
   * The real container, so the height, the rule underneath and the space below
   * it are the tab row's own and nothing moves when the labels arrive. The
   * widths are the widths of the tabs an application has, so the greyed row is
   * the shape of the answer rather than a placeholder of its own invention.
   */
  function renderProfileTabsSkeleton() {
    var widths = [84, 60, 78, 74, 64, 82];

    return (
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__clients-profile-tablist"' +
      ' aria-hidden="true">' +
      widths.map(function (w) {
        // The real tab's own parts, label and indicator, so the underline
        // group sizes this exactly as it sizes the tab that replaces it. A box
        // of my own measuring came out 16px short and the page stepped down
        // when the labels arrived.
        return '<span class="tma-tab tma-tab--skeleton">' +
          '<span class="tma-tab__label">' +
          '<span class="tma-skeleton tma-skeleton--text" style="width:' + w + 'px;height:12px"></span>' +
          '</span>' +
          '<span class="tma-tab__indicator"></span>' +
          '</span>';
      }).join('') +
      '</div>'
    );
  }

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

    var people = onPeopleTab(state);
    var providers = onProvidersTab(state);
    var noun = people ? 'provider contact' : (providers ? 'service provider' : 'client');

    if (searching || filtered) {
      // Nothing to add here: the records exist, the query is what is wrong.
      var what = searching ? 'search' : 'filters';
      if (!noData) return 'No ' + noun + 's match this ' + what;
      return noData.render({
        title: 'No matches',
        subtitle: searching
          ? 'No ' + noun + ' matches “' + state.search.trim() + '”.'
          : 'No ' + noun + ' matches these filters.',
        illustrationName: 'Illustration19',
        showButton: false,
      });
    }

    if (people) {
      if (!noData) return 'No provider contacts yet';
      return noData.render({
        title: 'No provider contacts yet',
        subtitle: 'Contacts appear here once they belong to a service provider.',
        illustrationName: 'Illustration04',
        showButton: false,
      });
    }

    if (providers) {
      if (!noData) return 'No service providers yet';
      return noData.render({
        title: 'No service providers yet',
        subtitle: 'Add the firms that file applications with you.',
        illustrationName: 'Illustration07',
        buttonLabel: 'New service provider',
        showButton: canManageClients(),
      });
    }

    if (!noData) return 'No applications yet';
    return noData.render({
      title: 'No applications yet',
      subtitle: 'Create your first application to get started.',
      illustrationName: 'Illustration07',
      buttonLabel: 'Create New Application',
      showButton: canManageClients(),
    });
  }

  /* Whether this reader may add a client, an empty state offering a button
     that 403s is worse than an empty state offering nothing. */
  function canManageClients() {
    var access = window.TMAPortalAccess;
    if (access && access.can) return !!access.can('clients.manage');
    return isClientsAdmin();
  }

  function renderFullTableRows(state) {
    if (state.loadState === 'loading') return renderTableSkeletonRows(state);
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
   * times, and the last page could not be reached at all. The window now
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
    // the request, the same mistake the count above the table used to make.
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

  /*
   * The page's lists, as the documented tab group.
   *
   * Same recipe as the profile's tabs and every other tablist in the portal:
   * the underline variant, a label, the count chip, and the indicator span
   * the variant draws its rule from. tab-group.js is not wired to these —
   * this page re-renders its own DOM, so the active tab has to come from
   * state rather than a class the component toggled.
   */
  function renderListTabs(state) {
    var loading = state.loadState === 'loading';

    return (
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__clients-list-tabs"' +
      ' role="tablist" aria-label="CIP Applications sections">' +
      LIST_TABS.map(function (tab) {
        var active = (state.listTab || 'applications') === tab.id;
        var count = loading ? null : (tab.id === 'providers'
          ? providerRowEntries(state).length
          : tab.id === 'people'
            ? peopleRowEntries(state).length
            : applicationRowEntries(state).length);

        return (
          '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab"' +
          ' aria-selected="' + (active ? 'true' : 'false') + '"' +
          ' tabindex="' + (active ? '0' : '-1') + '"' +
          ' data-clients-list-tab="' + esc(tab.id) + '">' +
          '<span class="tma-tab__label">' + esc(tab.label) +
          (count === null ? '' : tabCountChip(count)) + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  /*
   * §8, the main application table.
   *
   * Nine columns about an APPLICATION: its number, who it is for, who filed
   * it, how to reach them, what they are investing in, how many people travel
   * on it, where it is, and whose desk it is on.
   *
   * A separate render path from the client grid beside it, because it lists a
   * different thing. The grid's row is a client and pages in the browser out
   * of the whole directory; this row is an application, and it is paged by the
   * server, a client with no application does not belong here, and one with
   * two would appear once.
   *
   * Built on the documented table component, the same one the CBI board uses,
   * so it is one table style across the two boards rather than a second grid
   * with its own column arithmetic.
   */
  var APP_TABLE = {
    rows: [], page: 1, lastPage: 1, total: 0,
    loading: false, error: null, loadedKey: null, status: '',
    // Empty until a header is clicked: the listing stays newest-first, which
    // is the worklist order, not an implicit sort on Application.
    sort: '', dir: 'asc',
    // What the filter menu can offer, from the last listing. Empty arrays
    // rather than undefined so the predicates that read .length can run
    // before the first response has landed.
    assignees: [], providers: [], statuses: [],
  };

  /*
   * Columns the applications table can be ordered by, keyed as the listing
   * API understands them. The menu column is not in this list because it is
   * not a fact about the application.
   */
  var CIP_SORTS = {
    number: 'Application',
    applicant: 'Applicant',
    provider: 'Service provider',
    contact: 'Contact person',
    email: 'Contact email',
    investment: 'Investment',
    family: 'Family',
    status: 'Status',
    assigned: 'Assigned to',
  };

  /*
   * Every application status the picker names, matching Status::listed().
   *
   * Used when the listing has not yet sent its copy, the chip on a profile
   * can open before the table has loaded, and an empty menu would look like
   * there was nothing to change to.
   */
  var CIP_STATUSES = [
    { value: 'new', label: 'New Applications', tone: 'sky' },
    { value: 'review_application', label: 'Review Applications', tone: 'indigo' },
    { value: 'assessment_feedback', label: 'Assessment Feedback', tone: 'violet' },
    { value: 'update_required', label: 'Updates Required', tone: 'amber' },
    { value: 'ready_to_submit', label: 'Ready to Submit', tone: 'teal' },
    { value: 'pending_review', label: 'Pending Review', tone: 'orange' },
    { value: 'non_compliant', label: 'Non-compliant', tone: 'rose' },
    { value: 'background_check', label: 'Background Check', tone: 'cyan' },
    { value: 'delayed', label: 'Delayed', tone: 'copper' },
    { value: 'granted', label: 'Approved', tone: 'success' },
    { value: 'denied', label: 'Denied', tone: 'danger' },
  ];

  /*
   * §9's buckets, what the applications table can be narrowed to.
   *
   * They were a row of counting chips above the table and are now the Status
   * field in its filter menu, which is where the reader already goes to narrow
   * a list. The counts they carry did not stop being useful, so each value in
   * the menu shows its own, the same figure the Dashboard's CIP card reports,
   * measured once on the server.
   *
   * Which set a reader gets is the server's to decide, an officer's four are
   * a work queue (CRO and Compliance share that view) and an administrator's
   * ten are a report, and the difference is scope, not presentation.
   */
  var BUCKETS = { list: [], dashboard: null, loaded: false, loading: false, active: null };

  /* The bucket a key names, or null. The reader's own set is the authority:
     the listing 404s on a bucket that was never on their dashboard, so a key
     it does not name is not a filter, it is an error waiting to be sent. */
  /*
   * The CIP provider firm behind a client-hub company, if there is one.
   *
   * The two are separate records on purpose, provider config lives in
   * cip_providers so that firms do not leak into the hub's client directory —
   * and the facet carries the pairing so this does not have to guess at it by
   * name. Null when the company is not a provider, or is one with nothing in
   * this reader's slice: either way there is no filtered table to send anybody
   * to, and the caller offers no button rather than a button that empties the
   * list.
   */
  function providerForCompany(companyId) {
    if (!companyId) return null;
    var match = null;
    (APP_TABLE.providers || []).forEach(function (p) {
      if (p.companyId && String(p.companyId) === String(companyId)) match = p;
    });

    return match;
  }

  function bucketFor(key) {
    if (!key) return null;
    for (var i = 0; i < BUCKETS.list.length; i++) {
      if (BUCKETS.list[i].key === key) return BUCKETS.list[i];
    }

    return null;
  }

  /*
   * What the applications table is narrowed to, the whole of it, in one
   * place.
   *
   * Three lists rather than three values, because the menu is checkboxes.
   * Within a field the ticks are an OR: asking for New and Delayed asks for
   * either, which is what a reader building up a view of "everything that
   * needs a decision" means. Across fields it is an AND. Rita's files that
   * are also Delayed, because a second question added to the first narrows
   * it. The server applies exactly those rules; this only records the ticks.
   *
   * Not on `state.filters`, deliberately. That object is the dead directory's
   * client-side matcher, and these three are server-applied: the table is
   * re-asked for rather than filtered over rows the browser already holds.
   * Keeping them apart is what stops a future edit "tidying" one into the
   * other and quietly making these inert, which is exactly what had already
   * happened to Referred by and Client type.
   */
  var TABLE_FILTERS = { bucket: [], assignee: [], provider: [] };

  /** The ticked values of one field, always an array. */
  function filterValues(field) {
    var list = TABLE_FILTERS[field];

    return Array.isArray(list) ? list : [];
  }

  function filterHas(field, value) {
    return filterValues(field).indexOf(String(value)) !== -1;
  }

  /* Tick or untick one value. Returns whether anything actually moved, so a
     caller can skip the refetch when it did not. */
  function toggleFilter(field, value) {
    if (!TABLE_FILTERS[field]) return false;
    var v = String(value);
    var at = TABLE_FILTERS[field].indexOf(v);

    if (at === -1) TABLE_FILTERS[field].push(v);
    else TABLE_FILTERS[field].splice(at, 1);

    return true;
  }

  function clearTableFilters() {
    var had = anyTableFilterSet();
    TABLE_FILTERS = { bucket: [], assignee: [], provider: [] };

    return had;
  }

  function anyTableFilterSet() {
    return filterValues('bucket').length > 0 ||
      filterValues('assignee').length > 0 ||
      filterValues('provider').length > 0;
  }

  /* A ticked value as the reader would say it, for the chip under the toolbar
     and the summary on the Filter button. Named from the server's own lists so
     no chip can read "update_required" or an officer's bare id. */
  function filterValueLabel(field, value) {
    if (field === 'bucket') {
      var bucket = bucketFor(value);

      return bucket ? bucket.label : '';
    }

    var list = field === 'assignee' ? (APP_TABLE.assignees || []) : (APP_TABLE.providers || []);
    var found = null;
    list.forEach(function (item) { if (String(item.id) === String(value)) found = item; });

    return found ? found.name : '';
  }

  function ensureBuckets(render) {
    if (BUCKETS.loaded || BUCKETS.loading) return;
    BUCKETS.loading = true;

    clientsFetch('/portal/cip/dashboard')
      .then(function (json) {
        BUCKETS.list = (json && json.buckets) || [];
        BUCKETS.dashboard = (json && json.dashboard) || null;
      })
      .catch(function () { BUCKETS.list = []; })
      .then(function () {
        BUCKETS.loading = false;
        BUCKETS.loaded = true;

        /*
         * A key can arrive from the address bar, where anything can be typed,
         * and this is the first moment there is a set to check it against. An
         * unknown one is dropped rather than sent: the listing answers 404 to
         * a bucket this reader was never offered, so leaving it on would show
         * "Could not load applications" in place of a table that is fine.
         */
        var before = filterValues('bucket').length;
        TABLE_FILTERS.bucket = filterValues('bucket').filter(bucketFor);
        var dropped = TABLE_FILTERS.bucket.length !== before;
        if (dropped) syncClientsListUrl(clientsMountState);

        if (dropped || BUCKETS.list.length) render();
      });
  }

  /* The counts move whenever an application does, and every CIP write already
     raises a signal, so they are re-read rather than adjusted by hand. */
  function forgetBuckets() {
    BUCKETS.loaded = false;
  }

  /*
   * Open the table on one bucket, asked from outside this view, the
   * Dashboard's CIP card is the caller, and window.TMAClients is the door.
   *
   * It has to work before the view exists. The card navigates first and says
   * which bucket second, so by the time this runs the clients view may not
   * have mounted; the filter is module state either way, and the mount reads
   * it when it comes up. Nothing is parked in BOOT_POSITION for the same
   * reason, that is for what the address said at page load, and this is a
   * caller in the same page saying it now.
   */
  function openBucket(key) {
    key = key || '';

    /*
     * An unknown key is ignored rather than applied. The listing answers 404
     * to a bucket that was never on this reader's dashboard, so filtering to
     * one would replace the table with an error, and a card that quietly
     * does nothing is better than a card that appears to break the page.
     * Before the set has landed there is nothing to check against; the same
     * check runs again in ensureBuckets when there is.
     */
    if (key && BUCKETS.loaded && !bucketFor(key)) return;

    // The card opens one bucket, so it replaces whatever was ticked rather
    // than adding to it: a reader pressing "Delayed" on the Dashboard means
    // "show me the delayed ones", not "add them to yesterday's filter".
    TABLE_FILTERS.bucket = key ? [String(key)] : [];
    APP_TABLE.page = 1;

    /*
     * On the applications tab, whichever tab the reader left the page on. A
     * status is a fact about an application and the service providers list
     * holds none, so somebody whose last visit ended on Service providers
     * would otherwise arrive at a filter they cannot see. Saved as well as
     * set, because an unmounted view reads the stored tab when it comes up.
     */
    saveListTab('applications');

    var state = clientsMountState;
    if (state) {
      state.listTab = 'applications';
      state.page = 1;
      state.selected = {};
      syncClientsListUrl(state);
    }

    repaintClients();
  }

  function applicationTableKey(state) {
    /*
     * Every server-applied filter belongs in this key.
     *
     * A field left out of it does not refetch, so the reader ticks it, the
     * chip appears and the rows never change, which is precisely how
     * "Referred by" came to be decoration on this table. Sort belongs here
     * too: a header click that does not change the key would paint a new
     * arrow over the same page.
     */
    return [
      state.search || '',
      APP_TABLE.status || '',
      filterValues('bucket').join(','),
      filterValues('assignee').join(','),
      filterValues('provider').join(','),
      APP_TABLE.sort || '',
      APP_TABLE.dir || '',
      APP_TABLE.page,
    ].join('|');
  }

  function ensureApplicationTable(state, render) {
    var key = applicationTableKey(state);
    if (APP_TABLE.loadedKey === key || APP_TABLE.loadingKey === key) return;

    APP_TABLE.loadingKey = key;
    APP_TABLE.loading = true;
    APP_TABLE.error = null;

    var params = ['perPage=50', 'page=' + APP_TABLE.page];
    if (state.search) params.push('q=' + encodeURIComponent(state.search));
    if (APP_TABLE.status) params.push('status=' + encodeURIComponent(APP_TABLE.status));
    /*
     * The same keys the counts were measured through, so the number beside a
     * value and the rows behind it come from one definition on the server.
     * Comma-separated because each is a list of ticks.
     */
    ['bucket', 'assignee', 'provider'].forEach(function (field) {
      var ticked = filterValues(field);
      if (ticked.length) params.push(field + '=' + encodeURIComponent(ticked.join(',')));
    });
    if (APP_TABLE.sort && CIP_SORTS[APP_TABLE.sort]) {
      params.push('sort=' + encodeURIComponent(APP_TABLE.sort));
      params.push('dir=' + encodeURIComponent(APP_TABLE.dir === 'desc' ? 'desc' : 'asc'));
    }

    clientsFetch('/portal/cip/applications?' + params.join('&'))
      .then(function (json) {
        // A slower answer for a term the reader has moved on from must not
        // overwrite the one they are looking at.
        if (APP_TABLE.loadingKey !== key) return;
        APP_TABLE.rows = (json && json.applications) || [];
        APP_TABLE.page = (json && json.page) || 1;
        APP_TABLE.lastPage = (json && json.lastPage) || 1;
        APP_TABLE.total = (json && json.total) || 0;
        APP_TABLE.statuses = (json && json.statuses) || APP_TABLE.statuses;
        /*
         * What the menu can offer, measured over the whole slice rather than
         * this page. Held even when a request answers with none, so a filter
         * that empties the table does not also empty the menu that would let
         * the reader undo it.
         */
        if (json && json.assignees) APP_TABLE.assignees = json.assignees;
        if (json && json.providers) APP_TABLE.providers = json.providers;
        APP_TABLE.loadedKey = key;
      })
      .catch(function (err) {
        if (APP_TABLE.loadingKey !== key) return;
        APP_TABLE.error = (err && err.message) || 'Could not load applications.';
        APP_TABLE.loadedKey = key;
      })
      .then(function () {
        if (APP_TABLE.loadingKey !== key) return;
        APP_TABLE.loadingKey = null;
        APP_TABLE.loading = false;
        render();
      });
  }

  /* Drop what is held so the next paint refetches, after a save, or a live
     signal that somebody else changed one. */
  function forgetApplicationTable() {
    APP_TABLE.loadedKey = null;
  }

  /*
   * One sortable header. The whole cell is the control so a click on the
   * padding still sorts, and aria-sort lives on the th, that is the column
   * header, not the button inside it.
   */
  function applicationSortHeader(key, label) {
    var active = APP_TABLE.sort === key;
    var dir = active && APP_TABLE.dir === 'desc' ? 'desc' : 'asc';
    var aria = !active ? 'none' : (dir === 'desc' ? 'descending' : 'ascending');
    var arrow = active
      ? '<span class="tma-cip-table__sort-arrow" aria-hidden="true">' +
        (dir === 'desc' ? '↓' : '↑') + '</span>'
      : '';

    return {
      html: '<button type="button" class="tma-cip-table__sort' + (active ? ' is-sorted' : '') +
        '" data-cip-sort="' + key + '">' + esc(label) + arrow + '</button>',
      attrs: ' class="tma-cip-table__th-sort" aria-sort="' + aria + '"',
    };
  }

  function applicationTableHeaders() {
    var headers = Object.keys(CIP_SORTS).map(function (key) {
      return applicationSortHeader(key, CIP_SORTS[key]);
    });
    headers.push({ html: '', attrs: ' class="tma-portal-cell--menu"' });

    return headers;
  }

  function setApplicationSort(col) {
    if (!CIP_SORTS[col]) return;
    if (APP_TABLE.sort === col) {
      APP_TABLE.dir = APP_TABLE.dir === 'asc' ? 'desc' : 'asc';
    } else {
      APP_TABLE.sort = col;
      APP_TABLE.dir = 'asc';
    }
    APP_TABLE.page = 1;
    if (clientsMountState) syncClientsListUrl(clientsMountState);
    forgetApplicationTable();
    repaintClients();
  }

  function renderApplicationTable(state) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.table) return '';

    if (APP_TABLE.error) {
      return '<div class="tma-dash__clients-directory-empty">' +
        '<p class="tma-portal-modal__text">' + esc(APP_TABLE.error) + '</p></div>';
    }

    var headers = applicationTableHeaders();

    if (APP_TABLE.loading && !APP_TABLE.rows.length) {
      return ui.table(headers, applicationTableSkeleton(), { cls: 'tma-cip-table' });
    }

    if (!APP_TABLE.rows.length) {
      return ui.table(headers,
        '<tr class="tma-portal-table__empty"><td colspan="10">' +
        esc(state.search ? 'No application matches “' + state.search + '”.' : 'No applications yet.') +
        '</td></tr>', { cls: 'tma-cip-table' });
    }

    var rows = APP_TABLE.rows.map(function (a) {
      return '<tr data-cip-open="' + esc(a.clientUid || '') + '" data-cip-app="' + esc(a.id) + '">' +
        // The number leads: §7 makes it the name of the application, and the
        // internal one rides underneath once the CIP number has taken over.
        '<td><span class="tma-cip-table__number">' + esc(a.number || '-') + '</span>' +
        (a.cipNumber && a.internalNumber
          ? '<div class="tma-portal-table__muted">' + esc(a.internalNumber) + '</div>'
          : '') + '</td>' +
        '<td>' + applicantCell(a) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.provider || '-') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.contactPerson || '-') + '</td>' +
        '<td class="tma-portal-table__muted">' +
        (a.contactEmail
          ? '<a class="tma-cip-table__email" href="mailto:' + esc(a.contactEmail) + '">' +
            esc(a.contactEmail) + '</a>'
          : '-') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.investmentType || '-') + '</td>' +
        // "F6". §8's own shorthand, with the arithmetic behind it on hover.
        '<td><span class="tma-cip-table__family" title="' + esc(familyTitle(a)) + '">' +
        esc(a.familyLabel || '-') + '</span></td>' +
        '<td>' + cipStatusChip(a) + '</td>' +
        '<td>' + assignedCell(a.assignedTo, a) + '</td>' +
        '<td class="tma-portal-cell--menu">' +
        '<button type="button" class="tma-portal-row-menu" data-cip-row-menu="' +
        esc(a.clientUid || '') + '" data-cip-app="' + esc(a.id) + '"' +
        ' aria-label="More actions" aria-haspopup="menu">' +
        '<img src="images/icons/tma/ThreeDots-16.svg" alt="" width="16" height="16"></button></td>' +
        '</tr>';
    }).join('');

    return ui.table(headers, rows, { cls: 'tma-cip-table' }) + renderApplicationTablePagination();
  }

  /*
   * Who to put on this file, the officers, as a menu on the row.
   *
   * The list is fetched when the menu opens rather than with the table: it is
   * a question about one application, and asking it for every row of fifty to
   * fill a menu nobody may open would be fifty round trips for nothing.
   */
  /*
   * One person's face for a menu row: their photo, else their initials.
   *
   * The portal's one avatar rule, borrowed rather than restated, a real
   * upload or a provider's picture, and otherwise initials on a colour drawn
   * from the same seed the faces in the cell use, so the same person is the
   * same colour in both. Never a stock silhouette.
   */
  function personFace(person) {
    if (!person) return '';
    var src = person.avatar || person.photo;
    if (src) return src;
    var cu = window.TMACurrentUser;

    return cu && cu.initialsFor
      ? cu.initialsFor(person.name || person.email || '', person.email || person.name || '')
      : '';
  }

  /* What an officer would hold this file as, from the account type the server
     sent, the same derivation the assignment endpoint makes when a request
     names no role. */
  function officerRoleLabel(officer) {
    var role = officer && officer.role;
    if (role === 'compliance_officer') return 'Compliance officer';
    if (role === 'reviewing_officer') return 'Reviewing officer';

    return officer && officer.accountType ? String(officer.accountType) : '';
  }

  function openAssignMenu(button, applicationId) {
    if (!window.TMAFileActions || !window.TMAFileActions.menu) return;

    var box = button.getBoundingClientRect();

    clientsFetch('/portal/cip/applications/' + encodeURIComponent(applicationId) + '/assignments')
      .then(function (json) {
        var free = (json && json.assignable) || [];
        var live = (json && json.assignments) || [];
        var held = {};

        /*
         * One list of people, not two.
         *
         * It used to be "End Rita" rows above a separate list of everybody
         * else, which made the same colleague read as two different things
         * depending on whether they held the file. It is a list of who could
         * be on this: the ones who already are come first, ticked, with an ×
         * to take it off them, and clicking the row itself does nothing,
         * because they are already there and a click that appears to work and
         * changes nothing is what made this feel broken.
         */
        var items = live.map(function (a) {
          held[String(a.userId)] = true;

          return {
            label: a.name || a.email || 'Somebody',
            meta: a.roleLabel || '',
            face: personFace(a),
            on: true,
            remove: function () { changeAssignment(applicationId, 'DELETE', a.userId); },
          };
        });

        free.forEach(function (o) {
          // The column and this menu share the client list: somebody already
          // named in the cell must not also appear as a person to add.
          if (held[String(o.id)]) return;
          items.push({
            label: o.name || o.email,
            meta: officerRoleLabel(o),
            face: personFace(o),
            fn: function () { changeAssignment(applicationId, 'POST', o.id); },
          });
        });

        if (!items.length) {
          items.push({ label: 'No officers to assign', static: true });
        }

        // The people, as the menu's own rows, not file actions for a fake
        // file that we then overwrite. That swap measured a narrow menu and
        // placed it, then grew it off the right of the Assigned To column.
        window.TMAFileActions.menu(
          box.left,
          box.bottom + 4,
          { id: applicationId, type: 'application' },
          null,
          items
        );
      })
      .catch(function () { clientsToast('Could not load the officers.', 'negative'); });
  }

  function changeAssignment(applicationId, method, userId) {
    var base = '/portal/cip/applications/' + encodeURIComponent(applicationId) + '/assignments';
    var url = method === 'DELETE' ? base + '/' + encodeURIComponent(userId) : base;

    clientsFetch(url, {
      method: method,
      json: method === 'DELETE' ? undefined : { userId: userId },
    })
      .then(function () {
        clientsToast(method === 'DELETE' ? 'Assignment ended' : 'Assigned', 'positive');
        // The first assignment moves the application into review, so the
        // buckets and the row both have to be read again rather than patched.
        forgetApplicationTable();
        forgetBuckets();
        repaintClients();
      })
      .catch(function (err) {
        clientsToast((err && err.message) || 'Could not change the assignment.', 'negative');
      });
  }

  function familyTitle(a) {
    var n = a.familySize || 0;

    return n === 1 ? 'The applicant alone' : n + ' people travel on this application';
  }

  /*
   * Who is on this applicant, the CBI board's own cell.
   *
   * TMAPersonCard is the component both boards share with the File Library:
   * overlapping faces, a "+N" that is itself face-shaped so the column's width
   * does not depend on how many people there are, and a card on hover that
   * names them. Rebuilding any of that here would have been a second version
   * of it to keep in step.
   */
  function assignedCell(people, row) {
    var list = people || [];

    /*
     * Assignment happens in the table (§8).
     *
     * The brief puts it here rather than only on the detail page, and it is
     * the transition that starts a review, so leaving it to the profile
     * meant an application nobody had opened could sit at New indefinitely.
     * The cell is the shared people cell the CBI table draws: faces side by
     * side, one full name or several first names beside them. The button is
     * what opens the picker.
     */
    var held = list.length > 0;
    var label = held ? 'Change who holds this' : 'Assign an officer';
    var picker = row && canAssignApplications()
      ? '<button type="button" class="tma-dash__cip-assign' + (held ? '' : ' tma-dash__cip-assign--add') + '"' +
        ' data-cip-assign="' + esc(row.id) + '"' +
        ' title="' + label + '" aria-label="' + label + '" aria-haspopup="menu">' +
        '<img src="' + (held ? ICONS.CaretDown : ICONS.Plus) + '" alt="" width="12" height="12">' +
        '</button>'
      : '';

    var faces = window.TMAPersonCard && window.TMAPersonCard.faces
      ? window.TMAPersonCard.faces(list, { emptyLabel: 'Unassigned' })
      : '<span class="tma-portal-table__muted">' +
        esc(list.map(function (p) { return p.first || p.name; }).join(', ') || 'Unassigned') +
        '</span>';

    return '<span class="tma-dash__cip-assigned">' + faces + picker + '</span>';
  }

  /*
   * The applicant, as a face and a name.
   *
   * Their passport photo where there is one, it is filed as the client's
   * picture at intake, and their initials where there is not. Never an
   * invented face: a stock silhouette on a citizenship application would be
   * the table showing somebody who does not exist.
   */
  function applicantCell(a) {
    var name = a.applicantName || '-';
    var face = a.photo
      ? '<img class="tma-cip-table__applicant-face" src="' + esc(a.photo) + '" alt="" width="26" height="26">'
      : applicantInitials(a);

    return '<span class="tma-cip-table__applicant">' + face +
      '<span class="tma-cip-table__applicant-name">' + esc(name) + '</span></span>';
  }

  function applicantInitials(a) {
    var name = a.applicantName || '';
    var uri = initialsAvatarUri(name, a.clientUid || name);

    if (uri) {
      return '<img class="tma-cip-table__applicant-face" src="' + esc(uri) +
        '" alt="" width="26" height="26">';
    }

    return '<span class="tma-cip-table__applicant-face tma-cip-table__applicant-face--initial">' +
      esc((name.charAt(0) || '?').toUpperCase()) + '</span>';
  }

  /*
   * Loading, shaped like the answer.
   *
   * A bar in every cell said "nine columns of text", and the two columns that
   * are not text, the applicant's face and the people assigned, arrived as
   * circles that had not been there a moment before, so the row jumped and the
   * empty avatar read as a prompt to add a photo. Each column now waits in its
   * own shape: a disc where a face is coming, a chip where a status or a
   * family count is, a bar where words are.
   *
   * Widths are staggered but deterministic, a repaint must not reshuffle
   * them, or the block shimmers like something is still arriving when nothing
   * has changed.
   */
  function applicationTableSkeleton() {
    var disc = '<span class="tma-skeleton tma-skeleton--circle"' +
      ' style="display:inline-block;width:26px;height:26px"></span>';
    var chip = function (w) {
      return '<span class="tma-skeleton" style="display:inline-block;width:' + w +
        'px;height:18px;border-radius:9px"></span>';
    };
    var rows = '';

    for (var i = 0; i < 8; i++) {
      rows += '<tr aria-hidden="true">' +
        '<td>' + skeletonBar(skeletonWidth(i, 0.7)) + '</td>' +
        // The face, then the name, the shape the row settles into.
        '<td><span class="tma-cip-table__applicant">' + disc +
        skeletonBar(skeletonWidth(i + 1, 0.8)) + '</span></td>' +
        '<td>' + skeletonBar(skeletonWidth(i + 2, 0.7)) + '</td>' +
        '<td>' + skeletonBar(skeletonWidth(i + 3, 0.8)) + '</td>' +
        '<td>' + skeletonBar(skeletonWidth(i + 4, 0.9)) + '</td>' +
        '<td>' + skeletonBar(skeletonWidth(i + 5, 0.7)) + '</td>' +
        '<td>' + chip(34) + '</td>' +
        '<td>' + chip(76) + '</td>' +
        '<td><span class="tma-cip-table__applicant">' + disc + '</span></td>' +
        '<td class="tma-portal-cell--menu"></td>' +
        '</tr>';
    }

    return rows;
  }

  function renderApplicationTablePagination() {
    if (APP_TABLE.lastPage <= 1) return '';

    var start = Math.max(1, Math.min(APP_TABLE.page - 2, APP_TABLE.lastPage - 4));
    var end = Math.min(APP_TABLE.lastPage, start + 4);
    var pages = '';
    for (var p = start; p <= end; p++) {
      var active = p === APP_TABLE.page;
      pages += '<button type="button" class="tma-pagination__button' +
        (active ? ' tma-pagination__button--active' : '') + '"' +
        ' aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') +
        ' data-cip-page="' + p + '"><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var results = APP_TABLE.total.toLocaleString() +
      (APP_TABLE.total === 1 ? ' application' : ' applications');

    return '<div class="tma-pagination-bar tma-pagination-bar--footer">' +
      '<div class="tma-pagination-bar__meta">' +
      '<span class="tma-pagination-bar__results">' + esc(results) + '</span></div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' + pages +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon"' +
      ' aria-label="Previous page" data-cip-direction="prev"' +
      (APP_TABLE.page <= 1 ? ' disabled' : '') + '>' +
      '<img src="' + ICONS.CaretLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon' +
      ' tma-pagination__button--next" aria-label="Next page" data-cip-direction="next"' +
      (APP_TABLE.page >= APP_TABLE.lastPage ? ' disabled' : '') + '>' +
      '<img src="' + ICONS.CaretRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>';
  }

  /*
   * Delegated, once, on the mount.
   *
   * Binding each row as it was drawn wired nothing that survived: the table is
   * rebuilt whenever its data lands, so every handler was attached to a node
   * already on its way out and the rows were inert by the time anyone clicked
   * one. A listener on the mount outlives every repaint under it.
   */
  var cipTableWired = false;

  function wireApplicationTable(root, state, navigate, render) {
    if (cipTableWired) return;
    cipTableWired = true;

    /*
     * On the document, like the intake toolbar above.
     *
     * Bound to the mount it was inert: the table is rebuilt whenever its data
     * lands and the view remounts around it, so a listener attached to
     * whichever element happened to be there is a listener on a node the next
     * paint throws away. One on the document outlives all of it, and the
     * handlers read `clientsMountState` rather than a captured `state` for the
     * same reason.
     */
    document.addEventListener('click', function (e) {
      var sortCol = e.target.closest('[data-cip-sort]');
      if (sortCol) {
        e.preventDefault();
        e.stopPropagation();
        setApplicationSort(sortCol.getAttribute('data-cip-sort'));

        return;
      }

      var page = e.target.closest('[data-cip-page]');
      if (page) {
        APP_TABLE.page = parseInt(page.getAttribute('data-cip-page'), 10) || 1;
        repaintClients();

        return;
      }

      var step = e.target.closest('[data-cip-direction]');
      if (step && !step.disabled) {
        var next = step.getAttribute('data-cip-direction') === 'next'
          ? APP_TABLE.page + 1
          : APP_TABLE.page - 1;
        APP_TABLE.page = Math.max(1, Math.min(APP_TABLE.lastPage, next));
        repaintClients();

        return;
      }

      var assign = e.target.closest('[data-cip-assign]');
      if (assign) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        openAssignMenu(assign, assign.getAttribute('data-cip-assign'));

        return;
      }

      var more = e.target.closest('[data-cip-row-menu]');
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (clientsCtxEl && clientsCtxAnchor === more) {
          closeClientsContextMenu();

          return;
        }
        var box = more.getBoundingClientRect();
        openClientsContextMenu(
          'application',
          more.getAttribute('data-cip-row-menu'),
          box.left,
          box.bottom + 4,
          { applicationId: more.getAttribute('data-cip-app') }
        );
        clientsCtxAnchor = more;

        return;
      }

      var chip = e.target.closest('[data-cip-status-chip]');
      if (chip) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (clientsCtxEl && clientsCtxAnchor === chip) {
          closeClientsContextMenu();

          return;
        }
        openCipStatusPicker(chip, {
          applicationId: chip.getAttribute('data-cip-app'),
        }, chip.getAttribute('data-cip-client'));
        clientsCtxAnchor = chip;

        return;
      }

      var row = e.target.closest('[data-cip-open]');
      if (!row) return;
      // The Contact email column is a mailto, its own destination.
      if (e.target.closest('a')) return;

      var uid = row.getAttribute('data-cip-open');
      if (!uid) return;
      var controller = clientsMountRoot && clientsMountRoot._clientsController;
      if (!controller) return;
      // Opened on Overview: the row is an application, and that tab is its
      // journey, the Timeline card CBI keeps on the same tab.
      if (clientsMountState) clientsMountState.profileTab = 'overview';
      controller.navigate('detail', uid);
    });
  }

  function repaintClients() {
    var controller = clientsMountRoot && clientsMountRoot._clientsController;
    if (controller && controller.render) controller.render();
  }

  function renderTableListPage(state) {
    var page = getTablePageData(state);
    var people = onPeopleTab(state);

    if (onApplicationsTable(state)) {
      return (
        renderTableToolbar(state) +
        renderClientsFilterChips(state) +
        '<div class="tma-dash__ctable-scroll" data-clients-scroll>' +
        renderApplicationTable(state) +
        '</div>'
      );
    }

    return (
      // The tabs live in the page head, see syncClientsHeadTabs.
      renderTableToolbar(state) +
      renderClientsFilterChips(state) +
      // The grid is wider than a narrow window; without a scroller of its own
      // the last columns are simply unreachable, and the page body scrolling
      // sideways drags the whole shell with it.
      '<div class="tma-dash__ctable-scroll" data-clients-scroll>' +
      '<div class="tma-dash__ctable tma-dash__ctable--clients tma-dash__ctable--noselect' +
      (people ? ' tma-dash__ctable--people' : '') +
      '" role="table" aria-label="' +
      (people ? 'Provider contacts' : 'Service providers') + '">' +
      '<div class="tma-dash__ctr tma-dash__ctr--head" role="row">' +
      // No checkbox column on these tabs. Bulk actions post to the clients
      // endpoint, and a company is deleted from its own profile.
      '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head" role="columnheader">' +
      (people ? 'Person' : 'Service provider') + '</div>' +
      (people ? ''
        : '<div class="tma-dash__cc tma-dash__cc--type tma-dash__cc--head" role="columnheader">Type</div>') +
      '<div class="tma-dash__cc tma-dash__cc--referral tma-dash__cc--head" role="columnheader">' +
      (people ? 'Service provider' : 'People') + '</div>' +
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
   * page. Set at the left of the toolbar it does the same job, the first
   * number the reader wants, before they touch a control, while belonging to
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

    // Counted within the tab: the number above a list has to be the number of
    // things in it, or it is answering a question nobody asked.
    var people = onPeopleTab(state);
    var providers = onProvidersTab(state);
    var total = people ? totalPeopleRecords() : (providers ? COMPANIES.length : totalApplicationRecords());
    var filtered = (people || providers) ? !!state.search : (anyClientFilter(state.filters) || !!state.search);
    var shown = filtered ? tableRowEntries(state).length : total;
    var noun = people
      ? (total === 1 && !filtered ? 'provider contact' : 'provider contacts')
      : providers
        ? (total === 1 && !filtered ? 'service provider' : 'service providers')
        : (total === 1 && !filtered ? 'application' : 'applications');

    return (
      '<span class="tma-dash__toolbar-count" data-clients-count aria-live="polite">' +
      '<span class="tma-dash__toolbar-count-value">' +
      esc(filtered ? shown.toLocaleString() + ' of ' + total.toLocaleString() : total.toLocaleString()) +
      '</span> ' + noun +
      '</span>'
    );
  }

  function totalClientRecords() {
    return totalApplicationRecords() + COMPANIES.length;
  }

  /* Applicants only, the providers have a tab and a count of their own. */
  function totalApplicationRecords() {
    var people = 0;
    DIRECTORY.forEach(function (group) { people += group.items.length; });

    return people;
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
     * there, the top one still happened to read correctly, but every heading
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


  function renderDetailContent(state, opts) {
    opts = opts || {};
    if (state.screen === 'add-company' || state.screen === 'edit-company') {
      return renderCompanyFormPanel(state, opts);
    }
    if (state.screen === 'company') {
      return renderCompanyProfile(state, opts);
    }
    if (state.screen === 'new-application' || state.screen === 'edit-application') {
      return '<div class="tma-dash__clients-detail">' +
        // --cards, not --form: the sections are cards, and a card inside the
        // panel's own fill reads as one grey block.
        '<div class="tma-dash__clients-profile tma-dash__clients-profile--cards">' +
        '<div data-cip-intake-mount data-morph-skip></div>' +
        '</div></div>';
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
   * useless for "AASHA MORSHED ABDELAZIZ ELATI", the caseload is full of the
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


  /*
   * Sets the width variable live during a drag rather than re-rendering, and
   * only writes the preference on release, re-rendering per pointermove would
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

  /*
   * The client an edit screen belongs to, or null for the listing.
   *
   * Editing is something you do TO a record you were looking at, so leaving it
   * puts you back in front of that record. An application edit sent you to the
   * table instead, the client you had open, their tabs and wherever you were
   * in them, all thrown away to go back to a row you then had to find again.
   *
   * `applicationOwner` covers the case where the edit page was loaded cold, by
   * link or reload, and there is no client open to go back to.
   */
  function backDestination(state) {
    if (state.screen === 'edit') return state.selectedId || null;
    if (state.screen === 'edit-application') return state.selectedId || applicationOwner(state);

    return null;
  }

  /* Who a cold-loaded application belongs to. The URL addresses the
     application, so the client is not in it and has to be asked for. */
  var APPLICATION_OWNERS = {};

  function applicationOwner(state) {
    var id = state.applicationId;
    if (!id) return null;
    if (APPLICATION_OWNERS[id]) return APPLICATION_OWNERS[id];

    if (!state.ownerLoadingFor || state.ownerLoadingFor !== id) {
      state.ownerLoadingFor = id;
      clientsFetch('/portal/cip/applications/' + encodeURIComponent(id))
        .then(function (json) {
          var uid = json && json.application && json.application.clientUid;
          if (!uid) return;
          APPLICATION_OWNERS[id] = uid;
          // Repaint the head: the button was drawn before the answer arrived
          // and is still labelled for a destination it no longer has.
          if (clientsMountState) syncClientsDetailHead(clientsMountState);
        })
        .catch(function () { /* the listing is a fine place to end up */ });
    }

    return null;
  }

  /*
   * The way back, as an arrow.
   *
   * No label. The destination is the thing you were just looking at and the
   * head names where you are now, a word for it was a row of chrome above
   * the person's own name, which is the wrong thing to put first on a page
   * about somebody. The name it would have carried lives on as the accessible
   * label, so it is still announced.
   */
  function renderClientsBackArrow(state) {
    var owner = state && backDestination(state);
    var client = owner ? contactFor(owner) : null;
    var label = client && client.name ? client.name : 'CIP Applications';

    return (
      '<button type="button" class="tma-dash__clients-back-arrow" data-clients-back' +
      ' aria-label="Back to ' + esc(label) + '" title="Back to ' + esc(label) + '">' +
      '<img src="' + ICONS.CaretLeft + '" alt="" aria-hidden="true">' +
      '</button>'
    );
  }

  /*
   * Status only, beside the name.
   *
   * The application number and family live on the facts strip; repeating
   * them here put three names for the same file in one head. The chip is
   * what the head still has to say that the strip does not, where this
   * file is in the lifecycle.
   */
  function renderApplicationStatus(app) {
    return cipStatusChip(app);
  }

  /*
   * The status chip itself is the control, header, Overview card, table
   * column. Clicking it opens the same list the row menu's Change status
   * item does, so the words on the chip are also the way to move them.
   */
  function cipStatusChip(app) {
    if (!app || !app.statusLabel) return '';

    return '<button type="button" class="tma-portal-status tma-portal-status--' +
      esc(app.statusTone || 'neutral') +
      ' tma-portal-status--inline tma-cip-status-chip" data-cip-status-chip' +
      ' data-cip-app="' + esc(app.id || '') + '"' +
      ' data-cip-client="' + esc(app.clientUid || '') + '"' +
      ' aria-haspopup="menu" aria-label="Change status, currently ' +
      esc(app.statusLabel) + '">' + esc(app.statusLabel) + '</button>';
  }


  function contactProfileSubtitle(c) {
    if (!c) return '';
    return [c.nickname ? '"' + c.nickname + '"' : '', c.work && c.work.jobTitle, c.work && c.work.company]
      .filter(Boolean)
      .join(' · ');
  }

  function renderContactProfileToolbar(c, state) {
    if (!c) return '';
    var app = applicationFor(c.id);
    var status = app ? renderApplicationStatus(app) : '';
    var subtitle = app ? '' : esc(contactProfileSubtitle(c));

    /*
     * Arrow, face, name, and, on an application, the status beside the name.
     * Number and family are on the facts strip; a second copy under the name
     * was the same file answering twice.
     */
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' +
      renderClientsBackArrow(state) + renderAvatar(c, 40) +
      '<div class="tma-dash__clients-profile-ident">' +
      '<span class="tma-dash__clients-profile-name-row">' +
      '<span class="tma-dash__clients-profile-name">' + esc(c.name) + '</span>' +
      status +
      '</span>' +
      (subtitle ? '<span class="tma-dash__clients-profile-subtitle">' + subtitle + '</span>' : '') +
      '</div></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      renderCorrectNumberAction(app) +
      (clientFolderUuid(c.id)
        ? '<button type="button" class="tma-dash__clients-message-btn" data-clients-open-folder>' +
          '<img src="' + ICONS.FolderNotch + '" alt=""><span>Open folder</span></button>'
        : '') +
      inviteToolbarBtn(c, state) +
      // Edit opens the application in the form it was filed with, not the
      // hub's contact record, the applicant IS the application here.
      (applicationFor(c.id)
        ? '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit-application>' +
          '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>'
        : '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit>' +
          '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>') +
      '<div class="tma-dash__clients-message-wrap" data-clients-message-wrap>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-message aria-haspopup="menu" aria-expanded="' +
      (state && state.messageMenuOpen ? 'true' : 'false') + '">' +
      '<img src="' + ICONS.ChatTeardropDots + '" alt=""><span>Message</span>' +
      '<img class="tma-dash__clients-message-caret" src="' + ICONS.CaretDown + '" alt="" width="12" height="12" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__clients-message-menu" data-clients-message-menu' +
      (state && state.messageMenuOpen ? '' : ' hidden') +
      ' role="menu" aria-label="Message">' +
      renderMessageChooser(c, state) +
      '</div></div>' +
      // Last in the row: it is the one action that leaves the page, so it
      // reads as the way out rather than another thing to do here.
      cbiToolbarBtn(c) +
      '</div></div>'
    );
  }

  /*
   * Who the Message button can reach from this applicant.
   *
   * The provider thread is the usual destination, staff talk to the firm
   * about the file. Messaging the person themselves is offered only when
   * they have a portal login.
   */
  function renderMessageChooser(c, state) {
    var opts = (state && state.conversationOptions) || null;
    if (!opts) {
      return '<div class="tma-dash__menu-item tma-dash__menu-item--muted" role="menuitem" aria-disabled="true">Loading…</div>';
    }

    var items = [];
    var provider = opts.provider || {};
    var person = opts.person || {};
    var providerLabel = provider.companyName
      ? 'Message ' + provider.companyName + ' about ' + (c.name || 'this applicant')
      : 'Message the service provider about ' + (c.name || 'this applicant');
    items.push(messageChooserItem('provider', providerLabel, provider.available, provider.reason));

    if (person.available) {
      items.push(messageChooserItem('person', 'Message ' + (person.name || c.name) + ' privately', true, ''));
    }

    return items.join('');
  }

  function messageChooserItem(kind, label, available, reason) {
    if (!available) {
      return '<div class="tma-dash__menu-item tma-dash__menu-item--muted" role="menuitem" aria-disabled="true">' +
        '<span class="tma-dash__clients-message-choice-label">' + esc(label) + '</span>' +
        (reason ? '<span class="tma-dash__clients-message-choice-meta">' + esc(reason) + '</span>' : '') +
        '</div>';
    }

    return '<button type="button" class="tma-dash__menu-item" role="menuitem" data-clients-message-with="' +
      esc(kind) + '">' +
      '<span class="tma-dash__clients-message-choice-label">' + esc(label) + '</span></button>';
  }

  /*
   * Straight to this person's citizenship file, beside Edit and Message.
   *
   * The link was only a row in the info list, which meant the one thing a case
   * worker opens a CBI client's record to reach was buried under their phone
   * numbers. Hidden from anyone without cbi.view, the module is still
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
    //, and the server re-checks it regardless.
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
      renderClientsBackArrow(null) +
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:40px;height:40px">' +
      '<img src="' + ICONS.Buildings + '" alt="" width="20" height="20"></span>' +
      '<div class="tma-dash__clients-profile-ident">' +
      '<span class="tma-dash__clients-profile-name">' + esc(company.name) + '</span>' +
      '<span class="tma-dash__clients-profile-subtitle">' +
      esc(peopleCount + (peopleCount === 1 ? ' contact' : ' contacts')) +
      '</span></div></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit-company>' +
      '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-add-person>' +
      '<img src="' + ICONS.Plus + '" alt=""><span>Add person</span></button>' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-delete-company aria-label="Delete service provider">' +
      '<img src="' + ICONS.Trash + '" alt=""></button>' +
      '</div></div>'
    );
  }

  function renderContactFormToolbar(state) {
    var draft = state.draft || emptyDraft({ companyId: state.prefillCompanyId || '' });
    var isNew = !!state.adding;
    var contact = isNew ? null : contactFor(state.selectedId);
    var title = isNew ? 'New application' : 'Edit application';
    return (
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + renderClientsBackArrow(state) +
      renderFormHeadAvatar(draft, contact, isNew) +
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
      // No avatar, for the same reason the new application head has none: a
      // form is not a record, and the circle stood in for a provider that
      // does not exist until the form is submitted.
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + renderClientsBackArrow(state) +
      '<span class="tma-dash__clients-profile-name">' + esc(title) + '</span></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-save-company>' + (isNew ? 'Create' : 'Save') + '</button>' +
      '</div></div>'
    );
  }

  function renderElevatedDetailChrome(state) {
    var toolbar = '';
    /*
     * Every head carries the way back itself now, an arrow on the same line
     * as the name, before whatever stands for the record. The labelled button
     * that used to sit on a row above them is gone: it spent a whole line of
     * the page saying "leave", above the name of the thing you had opened.
     */
    if (state.screen === 'detail' && state.selectedId) {
      toolbar = renderContactProfileToolbar(contactFor(state.selectedId), state);
    } else if (state.screen === 'company' && state.companyId) {
      toolbar = renderCompanyProfileToolbar(companyFor(state.companyId));
    } else if (state.screen === 'new-application' || state.screen === 'edit-application') {
      // No avatar. A profile head carries one because it depicts somebody; a
      // blank application depicts nobody, and the applicant's actual face is
      // asked for in the form a few inches below.
      var editingApp = state.screen === 'edit-application';
      toolbar = '<div class="tma-dash__clients-profile-toolbar">' +
        '<div class="tma-dash__clients-profile-head">' +
        renderClientsBackArrow(state) +
        '<span class="tma-dash__clients-profile-name">' +
        (editingApp ? 'Edit application' : 'New application') + '</span>' +
        '</div>' +
        '<div class="tma-dash__clients-profile-actions">' +
        '<button type="button" class="tma-dash__clients-edit-btn" data-cip-cancel>Cancel</button>' +
        '<button type="button" class="tma-dash__clients-message-btn" data-cip-save>' +
        (editingApp ? 'Save' : 'Add') + '</button>' +
        '</div></div>';
    } else if (state.screen === 'add' || state.screen === 'edit') {
      toolbar = renderContactFormToolbar(state);
    } else if (state.screen === 'add-company' || state.screen === 'edit-company') {
      toolbar = renderCompanyFormToolbar(state);
    }
    return toolbar || '';
  }

  /* Full-page detail: put identity + actions in the global page-title row. */
  function syncClientsDetailHead(state) {
    var left = document.querySelector('.tma-dash__main-head-left');
    if (!left) return;
    var titleEl = left.querySelector('[data-page-title]');
    var host = left.querySelector('[data-clients-detail-head]');
    var show = usesPagedClientsFlow(state) && state.screen !== 'list';

    /*
     * The page title is hidden only where the record's own head has been
     * lifted INTO the page head, the narrow-window arrangement, where the two
     * would otherwise sit on the same line. Everywhere else it stays: it is
     * the header's own label and the header is not the hub's to empty.
     */
    var hideTitle = show;

    if (titleEl) {
      titleEl.hidden = hideTitle;
      if (hideTitle) titleEl.style.display = 'none';
      else titleEl.style.removeProperty('display');
    }

    if (!show) {
      if (host) {
        host.hidden = true;
        host.innerHTML = '';
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
      // A form is read top to bottom, so it scrolls with the page rather than
      // inside a box of its own. Every other detail screen keeps its panes
      // pinned and scrolls within them.
      '<div class="tma-dash__clients-page tma-dash__clients-page--detail' +
      (state.screen === 'new-application' || state.screen === 'edit-application'
        ? ' tma-dash__clients-page--flowing' : '') +
      '" data-node-id="clients-page">' +
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
   * line or two of content followed by a lot of nothing, a long way to travel
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
      companyCard('Provider contacts', renderCompanyPeople(company), {
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
   * The clients this company sent us, what a referral partner's page is for,
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
      /*
       * Offered only when it can land somewhere. The destination is the
       * applications table filtered to this firm, and a company with no CIP
       * provider behind it, or one with no applications this reader may see —
       * has no such table. A button that opened an empty list would read as
       * "there are none", when the truth is that this company is not a filing
       * firm.
       */
      (total > shown.length && providerForCompany(company.id)
        ? '<button type="button" class="tma-dash__clients-see-all" data-clients-see-referred="' +
          esc(company.id) + '">See all ' + total.toLocaleString() + '</button>'
        : '');
  }

  /*
   * The company at a glance, always with something in it.
   *
   * It used to drop every blank row and return nothing at all when a company
   * had no type, industry or phone, which is every company the CBI import
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
     `email`, reading `c.email` silently yields undefined and makes every
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

    /*
     * An email and a button. The role dropdown sat here preselected to
     * "Service provider member" and that is what everyone was added as, a
     * question with one answer, the same one the assign form used to ask.
     * Each member row still carries its own role controls for the day
     * somebody really is the finance contact.
     */
    var form = admin && !loading
      ? '<div class="tma-dash__clients-assign-form">' +
        '<input class="tma-dash__clients-field-input" type="email" placeholder="Email address" data-company-member-email aria-label="Member email">' +
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

    /*
     * A picker, the reach, and a button, the level dropdown is gone from
     * here the same way it went from the client profile's form: preselected
     * to Editor and never changed, a question with one answer. The reach
     * stays, because company-only versus every-client is a real decision
     * with real consequences the label spells out.
     */
    var form = !loading
      ? '<div class="tma-dash__clients-assign-form">' +
        staffPicker('data-company-staff-user', assignable, state.companyStaffPick, 'Assign staff…') +
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

  /*
   * Half and half, extra field on the right.
   *
   * The person list used the contact profile's "six then the rest" split, so
   * passport number + photo + four answers sat on the left and three on the
   * right. The photo is already a tall row; piling the leftover fields under
   * it made that column the whole card. Floor-split so the two sides carry
   * the same number of fields, or the right carries the spare when the count
   * is odd.
   */
  function splitEvenColumns(items) {
    if (items.length <= 1) return [items, []];
    var mid = Math.floor(items.length / 2);
    return [items.slice(0, mid), items.slice(mid)];
  }

  function renderProfileListColumns(listItems, opts) {
    if (isClientsMobile()) {
      return (
        '<div class="tma-dash__clients-profile-body">' +
        '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
        listItems.join('') +
        '</ul></div>'
      );
    }
    var columns = (opts && opts.even)
      ? splitEvenColumns(listItems)
      : splitListColumns(listItems, 6);
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

  /*
   * Choosing a person by their face, not their name in a system menu.
   *
   * A native <select> is drawn by the operating system, so an option can hold
   * text and nothing else, which is why this list looked like a font menu
   * while every other place the portal names staff shows them. It is the
   * documented context menu instead, with the avatars renderAssignSub already
   * uses.
   *
   * The value stays on a hidden input under the same data attribute the
   * select had, so everything that reads `.value` to submit the form carries
   * on reading `.value`.
   */
  function staffPicker(attr, list, chosenId, placeholder) {
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(chosenId)) { chosen = list[i]; break; }
    }

    var options = list.length
      ? list.map(function (person) {
        var active = chosen && String(chosen.id) === String(person.id);
        return '<button type="button" role="option" aria-selected="' + (active ? 'true' : 'false') + '"' +
          ' class="tma-portal-context-menu__item' + (active ? ' is-active' : '') + '"' +
          ' data-staff-pick="' + esc(String(person.id)) + '">' +
          ctxAvatarHtml(person) +
          '<span class="tma-portal-context-menu__label">' +
          esc(person.name || person.email || 'Staff') + '</span></button>';
      }).join('')
      : '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--static">' +
        '<span class="tma-portal-context-menu__label">Nobody left to assign</span></div>';

    return (
      '<div class="tma-dash__clients-staff-picker" data-staff-picker>' +
      '<input type="hidden" ' + attr + ' value="' + esc(chosen ? String(chosen.id) : '') + '">' +
      '<button type="button" class="tma-dash__clients-field-select tma-dash__clients-field-select--full' +
      ' tma-dash__clients-staff-picker__btn" data-staff-picker-toggle' +
      ' aria-haspopup="listbox" aria-expanded="false">' +
      (chosen
        ? ctxAvatarHtml(chosen) + '<span class="tma-dash__clients-staff-picker__name">' +
          esc(chosen.name || chosen.email || 'Staff') + '</span>'
        : '<span class="tma-dash__clients-staff-picker__placeholder">' + esc(placeholder) + '</span>') +
      '</button>' +
      '<div class="tma-portal-context-menu tma-dash__clients-staff-picker__menu"' +
      ' data-staff-picker-menu role="listbox" hidden>' + options + '</div>' +
      '</div>'
    );
  }

  /*
   * The picker's behaviour, done here rather than by re-rendering the panel.
   *
   * Choosing somebody repaints the button in place: a full render would tear
   * the open menu out from under the pointer, and the level and scope selects
   * beside it would lose anything already chosen.
   */
  function wireStaffPickers(root, state) {
    MORPH.unwired(root, '[data-staff-picker]').forEach(function (picker) {
      var toggle = picker.querySelector('[data-staff-picker-toggle]');
      var menu = picker.querySelector('[data-staff-picker-menu]');
      var input = picker.querySelector('input[type="hidden"]');
      if (!toggle || !menu || !input) return;

      var close = function () {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      };

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var opening = menu.hidden;
        // One open at a time, including any other picker on the page.
        document.querySelectorAll('[data-staff-picker-menu]').forEach(function (m) { m.hidden = true; });
        document.querySelectorAll('[data-staff-picker-toggle]').forEach(function (t) {
          t.setAttribute('aria-expanded', 'false');
        });
        menu.hidden = !opening;
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });

      menu.addEventListener('click', function (e) {
        var pick = e.target.closest('[data-staff-pick]');
        if (!pick) return;
        e.stopPropagation();

        input.value = pick.getAttribute('data-staff-pick');
        // Remembered so a re-render, an assignment landing, the panel
        // reloading, does not silently forget who was chosen.
        if (picker.querySelector('[data-clients-assign-user]')) state.assignPick = input.value;
        else state.companyStaffPick = input.value;

        toggle.innerHTML = pick.innerHTML.replace('tma-portal-context-menu__label',
          'tma-dash__clients-staff-picker__name');
        menu.querySelectorAll('[data-staff-pick]').forEach(function (o) {
          var active = o === pick;
          o.classList.toggle('is-active', active);
          o.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        close();
      });

      MORPH.on(document, 'click', function () {
        document.querySelectorAll('[data-staff-picker-menu]').forEach(function (m) { m.hidden = true; });
        document.querySelectorAll('[data-staff-picker-toggle]').forEach(function (t) {
          t.setAttribute('aria-expanded', 'false');
        });
      }, 'staff-picker-dismiss');

      MORPH.on(document, 'keydown', function (e) {
        if (e.key === 'Escape') close();
      }, 'staff-picker-escape');
    });
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
   * show, so the number is there before anybody opens it. Counted from the
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
    if (tabId === 'messages') {
      if (state.conversationsLoading && !state.conversations) return null;
      return ((state.conversations || []).length) + ((state.recordings || []).length);
    }
    // How many people are on the application, so the tab says how big the
    // family is before it is opened.
    if (tabId === 'dependents') {
      var app = applicationFor(state.selectedId);
      return app ? (app.dependents || []).length : null;
    }
    return null;
  }

  /* Nested inside the label rather than beside it: the underline tab is a
     column (label above indicator), so a third child would land under the rule
     and the indicator would stop matching the width of what it underlines.
     Zero draws nothing, the way every other count in the portal behaves, the
     panel behind the tab already says it is empty, in a sentence. */
  function tabCountChip(count) {
    if (!count) return '';
    return '<span class="tma-tab__count">' + esc(count > 999 ? '999+' : String(count)) + '</span>';
  }

  /*
   * The tabs this profile actually has.
   *
   * A CIP applicant's profile is their application, so its sections are the
   * file itself (Overview, with the Timeline card), then the people on it —
   * the main applicant, the sponsor when there is one, the dependants when
   * there are any. "Client info" was the hub's own contact record standing
   * in for all of that, which is not what anybody opens an applicant to read.
   *
   * A client with no application keeps the contact record: plenty predate the
   * module, and a page of empty person tabs would say less than their phone
   * number does.
   */
  function profileTabsFor(state) {
    var app = applicationFor(state.selectedId);
    if (!app) return PROFILE_TABS;

    var tabs = [
      // The application's own facts, where it has got to, before the people
      // on it. CBI calls this Overview and keeps the Timeline card here; a
      // tab named "Application details" would sit next to "Main applicant"
      // and ask the reader which of the two was the file.
      { id: 'overview', label: 'Overview' },
      { id: 'applicant', label: 'Main applicant' },
    ];
    if (app.sponsor) tabs.push({ id: 'sponsor', label: 'Sponsor' });
    if ((app.dependents || []).length) tabs.push({ id: 'dependents', label: 'Dependents' });

    /*
     * Activity is offered only for an application.
     *
     * cip_events is an application's history; a client with none has nothing
     * for the tab to read, and an empty tab that can never fill is worse than
     * no tab.
     */
    return tabs
      .concat(PROFILE_TABS.filter(function (t) { return t.id !== 'info'; }))
      .concat([{ id: 'activity', label: 'Activity' }]);
  }

  /*
   * The tab to open on: the one the address asked for, else the first.
   *
   * Claimed here rather than at mount because the tabs a profile HAS depend on
   * its application, which arrives after the first paint, asking earlier
   * would mean checking "documents" against a list that is only ever
   * Client info, and dropping it.
   */
  function defaultProfileTab(state) {
    var tabs = profileTabsFor(state);
    var ids = tabs.map(function (t) { return t.id; });

    if (BOOT_POSITION.tab && ids.indexOf(BOOT_POSITION.tab) !== -1) {
      state.profileTab = takeBootPosition('tab');

      return state.profileTab;
    }

    return tabs.length ? tabs[0].id : 'info';
  }

  function renderProfileTabs(state, activeTab) {
    return profileTabsFor(state).map(function (tab) {
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

  /*
   * The journey, as CBI's Timeline card (§4d).
   *
   * It used to sit as a row of dates under every tab, which put the file's
   * progress on screens that were about a person. It is a card of label/date
   * rows, the same shape CBI draws, on Overview, which is the tab about
   * the application. Steps that have not happened yet stay on it, greyed:
   * a timeline with holes in it is how a reader tells what is still ahead.
   */
  function renderMilestones(app) {
    var steps = (app && app.milestones) || [];
    if (!steps.length) return '';

    return overviewList(steps.map(function (m) {
      return overviewRow(
        m.label,
        m.date ? fmtShortDate(m.date) : '-',
        false,
        m.reached ? '' : 'tma-dash__cip-tl-ahead'
      );
    }).join(''));
  }

  function overviewRow(label, value, rawHtml, extraClass) {
    if (value == null || value === '') return '';
    return '<li class="tma-portal-details__row' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<span>' + esc(label) + '</span>' +
      '<span class="tma-portal-details__label">' + (rawHtml ? value : esc(value)) + '</span></li>';
  }

  function overviewList(rows) {
    if (!rows) return '';
    return '<ul class="tma-dash__cip-tl">' + rows + '</ul>';
  }

  function cipFamily(app) {
    var people = [];
    if (app.applicant) people.push(app.applicant);
    if (app.sponsor) people.push(app.sponsor);
    (app.dependents || []).forEach(function (d) { people.push(d); });
    return people;
  }

  function familyComposition(app) {
    var parts = [];
    if (app.applicant) parts.push('1 Main Applicant');
    if (app.sponsor) parts.push('1 Sponsor');
    var n = (app.dependents || []).length;
    if (n) parts.push(n === 1 ? '1 Dependent' : n + ' Dependents');
    if (!parts.length) return '';
    return parts.join(' + ') + (app.familyLabel ? ' = ' + app.familyLabel : '');
  }

  function personDocStats(person) {
    var docs = (person && person.documents) || [];
    var total = docs.length;
    var filed = 0;
    var pending = 0;
    var review = 0;
    var update = 0;
    var ready = 0;
    docs.forEach(function (d) {
      if (d.uploaded) filed += 1;
      if (!d.uploaded) pending += 1;
      else if (d.status === 'application_review') review += 1;
      else if (d.status === 'update_required') update += 1;
      else if (d.status === 'ready_for_submission') ready += 1;
    });
    return {
      total: total,
      filed: filed,
      pending: pending,
      review: review,
      update: update,
      ready: ready,
    };
  }

  function renderOverviewFamily(app) {
    var people = cipFamily(app);
    var lead = familyComposition(app);
    var rows = people.map(function (p) {
      return overviewRow(p.name || '-', p.label || '');
    }).join('');
    if (!lead && !rows) return '';
    return (lead ? '<p class="tma-dash__cip-ov-lead">' + esc(lead) + '</p>' : '') +
      overviewList(rows);
  }

  function renderOverviewDocuments(app) {
    var people = cipFamily(app);
    if (!people.length) return '';
    return overviewList(people.map(function (p) {
      var s = personDocStats(p);
      return overviewRow(p.name || p.label || '-', s.filed + ' / ' + s.total);
    }).join(''));
  }

  function renderOverviewDocStatus(app) {
    var totals = { pending: 0, review: 0, update: 0, ready: 0, filed: 0, total: 0 };
    cipFamily(app).forEach(function (p) {
      var s = personDocStats(p);
      totals.pending += s.pending;
      totals.review += s.review;
      totals.update += s.update;
      totals.ready += s.ready;
      totals.filed += s.filed;
      totals.total += s.total;
    });
    return overviewList(
      overviewRow('Pending upload', String(totals.pending)) +
      overviewRow('Application review', String(totals.review)) +
      overviewRow('Update required', String(totals.update)) +
      overviewRow('Ready for submission', String(totals.ready))
    );
  }

  function overviewDocCount(app) {
    var filed = 0;
    var total = 0;
    cipFamily(app).forEach(function (p) {
      var s = personDocStats(p);
      filed += s.filed;
      total += s.total;
    });
    return total ? filed + ' / ' + total : '';
  }

  function renderOverviewApplication(app) {
    return overviewList(
      overviewRow('Number', app.number) +
      overviewRow('Internal', app.cipNumber && app.internalNumber ? app.internalNumber : '') +
      overviewRow('Status', cipStatusChip(app), true) +
      overviewRow('Investment', app.investmentType) +
      overviewRow('Referred by', app.provider) +
      overviewRow('Sponsored', app.sponsored ? 'Yes' : 'No')
    );
  }

  function renderOverviewAssigned(app) {
    var people = Array.isArray(app.assignedTo) ? app.assignedTo : [];
    var faces = cipAssignedFaces(app);
    var rows = people.map(function (p) {
      return overviewRow(p.name || '-', (p.roles && p.roles[0]) || '');
    }).join('');
    return '<div class="tma-dash__cip-ov-assigned">' + faces + '</div>' +
      overviewList(rows);
  }

  /*
   * Overview is the file at a glance: where it is, then who travels and
   * what they still owe. Application and Timeline lead; the rest pair up
   * under them. Nothing here is a full-width band just because it is the
   * first tab.
   */
  function renderOverviewPanel(app, hidden) {
    if (!app) return '';

    var family = cipFamily(app);
    var cards =
      companyCard('Application', renderOverviewApplication(app), { half: true }) +
      companyCard('Timeline', renderMilestones(app), { half: true }) +
      companyCard('Family', renderOverviewFamily(app), {
        half: true, count: app.familyLabel || family.length || '',
      }) +
      companyCard('Documents', renderOverviewDocuments(app), {
        half: true, count: overviewDocCount(app),
      }) +
      companyCard('Document status', renderOverviewDocStatus(app), { half: true }) +
      companyCard('Assigned', renderOverviewAssigned(app), {
        half: true, count: Array.isArray(app.assignedTo) ? app.assignedTo.length : 0,
      });

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="overview" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-cards">' + cards + '</div></div>'
    );
  }

  /*
   * The case at a glance, under every tab. CBI's facts strip.
   *
   * Application number is `displayNumber()`: the internal number until the
   * CIP number is recorded, the CIP number after. Submitted stays on the
   * strip even before the Unit has it, as an empty date. Empty decision
   * dates still drop out; Assigned always answers, Unassigned if nobody.
   */
  function cipFact(label, value, rawHtml) {
    if (value == null || value === '') return '';
    return '<div class="tma-dash__clients-list-main">' +
      '<span class="tma-dash__clients-list-label">' + esc(label) + '</span>' +
      '<span class="tma-dash__clients-list-value">' + (rawHtml ? value : esc(value)) + '</span></div>';
  }

  function cipMilestone(app, key) {
    var steps = (app && app.milestones) || [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].key === key) return steps[i];
    }
    return null;
  }

  function cipMilestoneDate(app, key) {
    var step = cipMilestone(app, key);
    var iso = step && step.date;
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cipAssignedFaces(app) {
    var people = Array.isArray(app.assignedTo)
      ? app.assignedTo
      : (app.assignedOfficer
        ? [{
            name: app.assignedOfficer.name,
            first: String(app.assignedOfficer.name || '').trim().split(' ')[0],
            email: app.assignedOfficer.email,
            avatar: app.assignedOfficer.avatar
          }]
        : []);
    if (window.TMAPersonCard && window.TMAPersonCard.faces) {
      return window.TMAPersonCard.faces(people, { emptyLabel: 'Unassigned' });
    }
    return esc(people.map(function (p) { return p.first || p.name; }).join(', ') || 'Unassigned');
  }

  function renderFactsStrip(app) {
    if (!app) return '';

    var decision = cipMilestone(app, 'decision');
    var html =
      cipFact('Application number', app.number) +
      cipFact('Received', cipMilestoneDate(app, 'filed')) +
      cipFact('Submitted', cipMilestoneDate(app, 'submitted') || '-') +
      cipFact(decision && decision.reached ? (decision.label || 'Decision') : 'Decision', cipMilestoneDate(app, 'decision')) +
      cipFact('Investment', app.investmentType) +
      cipFact('Referred by', app.provider) +
      cipFact('Assigned', cipAssignedFaces(app), true);

    if (!html) return '';

    return '<section class="tma-dash__cip-strip" aria-label="Application facts">' +
      '<div class="tma-dash__cip-strip-grid">' + html + '</div></section>';
  }

  /*
   * What can be DONE to this application, above the panels.
   *
   * The facts strip already names the file; what is left here is the verb.
   * When there is no verb to offer there is no band either: an empty strip
   * between the tabs and the panels would be a row of chrome standing in
   * for nothing.
   */
  function renderApplicationBar(state, app) {
    if (!app) return '';

    var parts = [];
    var submission = renderSubmissionAction(state, app);
    if (submission) parts.push(submission);
    var query = renderQueryAction(app);
    if (query) parts.push(query);
    var accepted = renderAcceptanceAction(app);
    if (accepted) parts.push(accepted);
    var decision = renderDecisionAction(app);
    if (decision) parts.push(decision);
    if (!parts.length) return '';

    return '<div class="tma-dash__clients-appbar">' + parts.join('') + '</div>';
  }

  /*
   * Recording the submission, which is what enters the CIP number.
   *
   * Offered only from Ready to submit, because that is the one edge the server
   * accepts (§16), an action that could be pressed from anywhere and then
   * refused would be the interface hiding a rule it could have simply not
   * shown. A typo in a number already recorded is Edit CIP number, up in the
   * profile head, it does not move the status and does not belong here.
   */
  function renderSubmissionAction(state, app) {
    if (app.status === 'ready_to_submit' && app.canConfirm && !app.locked) {
      return '<button type="button" class="tma-dash__clients-appbar-action" data-cip-confirm>' +
        'Confirm submission</button>';
    }

    if (app.status === 'ready_to_submit' && app.locked && canRecordSubmission()) {
      return '<button type="button" class="tma-dash__clients-appbar-action" data-cip-submit>' +
        'Record submission</button>';
    }

    if (app.status === 'ready_to_submit' && !app.locked && !app.canConfirm) {
      return '<p class="tma-dash__clients-appbar-note">Waiting for the service provider to confirm submission.</p>';
    }

    return '';
  }

  /*
   * A CIP number already recorded, but typed wrong. Lives next to the name
   * and the other profile actions, it is a correction to this file, not a
   * step in the workflow band under the tabs.
   */
  function renderCorrectNumberAction(app) {
    if (!app || !app.cipNumber || !canRecordSubmission()) return '';

    return '<button type="button" class="tma-dash__clients-edit-btn" data-cip-fix-number>' +
      'Edit CIP number</button>';
  }

  function canRecordSubmission() {
    var access = window.TMAPortalAccess;

    return !!(access && access.can && access.can('cip.compliance'));
  }

  /*
   * §18: the Unit asked for more. Offered from the statuses a query can
   * actually land on. Pending review, Background check, Delayed, because
   * that is the edge the server accepts. Pressing it from anywhere else and
   * then being refused would be the interface hiding a rule it could have
   * simply not shown.
   */
  function renderQueryAction(app) {
    if (!canRecordSubmission()) return '';
    if (['pending_review', 'background_check', 'delayed'].indexOf(app.status) === -1) return '';

    return '<button type="button" class="tma-dash__clients-appbar-action" data-cip-query>' +
      'Query received</button>';
  }

  /*
   * §19: the Unit accepted the file. Offered from Pending review and
   * Non-compliant, the two edges the server accepts into Background check.
   */
  function renderAcceptanceAction(app) {
    if (!canRecordSubmission()) return '';
    if (['pending_review', 'non_compliant'].indexOf(app.status) === -1) return '';

    return '<button type="button" class="tma-dash__clients-appbar-action" data-cip-accept>' +
      'Accepted for processing</button>';
  }

  /*
   * §21: the Unit decided. Offered from Background check and Delayed, the
   * two edges the server accepts into Approved or Denied. Date and type
   * are both asked for; either one without the other would leave a terminal
   * file whose reports cannot say when, or which way.
   */
  function canRecordDecision() {
    var access = window.TMAPortalAccess;

    return !!(access && access.can && access.can('cip.decide'));
  }

  function renderDecisionAction(app) {
    if (!canRecordDecision()) return '';
    if (['background_check', 'delayed'].indexOf(app.status) === -1) return '';

    return '<button type="button" class="tma-dash__clients-appbar-action" data-cip-decide>' +
      'Record decision</button>';
  }

  /*
   * One person from the application, as the profile's own list rows.
   *
   * The same list component the contact record uses, so an applicant reads
   * like every other record in the hub rather than like a form printed out.
   */
  function renderCipPersonPanel(state, person, panelId, hidden) {
    if (!person) return '';

    var rows = [
      { icon: ICONS.IdentificationCard, label: 'Passport number', value: person.passportNumber },
      { icon: ICONS.User, label: 'Name', value: person.name },
      { icon: ICONS.User, label: 'Gender', value: person.gender },
      { icon: ICONS.CalendarBlank, label: 'Date of birth', value: person.dateOfBirth },
      { icon: ICONS.MapPin, label: 'Country of birth', value: person.countryOfBirth },
      { icon: ICONS.MapPin, label: 'Country of residence', value: person.countryOfResidence },
      { icon: ICONS.MapPin, label: 'Region', value: person.region },
      { icon: ICONS.Briefcase, label: 'Occupation', value: person.occupation },
    ].filter(function (r) { return !!r.value; }).map(renderListItem);

    // Directly under the number, so the two passport fields read as one
    // block at the top of the first column rather than the photo dropping
    // under whatever field happened to come last.
    var photo = renderCipPersonPhoto(person);
    if (photo) rows.splice(person.passportNumber ? 1 : 0, 0, photo);

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="' + esc(panelId) + '" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      renderProfileListColumns(rows, { even: true }) +
      renderCipChecklist(person) +
      '</div>'
    );
  }

  /*
   * The passport photo, as the second row of the person's own list.
   *
   * A row rather than a column beside them: it sits under the passport
   * number, the two of them first, so a reader checking a face against a
   * number is not hunting through the rest of the answers.
   *
   * Built to renderListItem's shape, icon, label, value, so its label lines
   * up with the labels around it and the picture with their answers. It links
   * to the archival copy: what is drawn is the 320px avatar, and somebody
   * checking a face against a passport wants the file that was actually
   * filed.
   */
  function renderCipPersonPhoto(person) {
    if (!person.photo) return '';

    var img = '<img class="tma-dash__clients-person__photo" src="' + esc(person.photo) +
      '" alt="Passport photo of ' + esc(person.name || 'the applicant') + '" width="168" height="168">';

    /*
     * Opened in the File Library's viewer, because it is a library file.
     *
     * The photo is filed into the person's folder like every other document
     * on the application, so it opens the same window the library opens —
     * comments, versions, review, sharing, the lot, the same way the client's
     * Documents tab does. What is drawn on the page is still the 320px avatar;
     * the viewer is handed the file row.
     */
    var opens = person.photoFile ? ' data-cip-photo="' + esc(person.id) + '"' : '';

    return (
      '<li class="tma-dash__clients-list-item tma-dash__clients-person__photo-row">' +
      '<span class="tma-dash__clients-list-icon" aria-hidden="true">' +
      '<img src="' + ICONS.Image + '" alt=""></span>' +
      '<div class="tma-dash__clients-list-main">' +
      '<span class="tma-dash__clients-list-label">Passport photo</span>' +
      (opens
        ? '<button type="button" class="tma-dash__clients-person__photo-open"' + opens +
          ' title="Open the filed photo">' + img + '</button>'
        : img) +
      '</div></li>'
    );
  }

  /* Every person on the open application, whatever role they hold. */
  function cipPeople(state) {
    var app = applicationFor(state.selectedId);
    if (!app) return [];
    return [app.applicant, app.sponsor].concat(app.dependents || []).filter(Boolean);
  }

  function openCipPhoto(state, personId, render) {
    var person = cipPeople(state).filter(function (p) { return p.id === personId; })[0];
    openCipLibraryFile(state, person && person.photoFile, render);
  }

  /*
   * A filed checklist slot, opened the same way as the passport photo.
   *
   * The slot only carries the library uuid, the viewer wants the full file
   * row, so this uses a row we already hold (the photo, or the Documents
   * tab listing) and otherwise asks the library for that one file.
   */
  function openCipFile(state, fileId, render) {
    if (!fileId) return;

    var known = cipLibraryFile(state, fileId);
    if (known) {
      openCipLibraryFile(state, known, render);
      return;
    }

    var net = filesNet();
    if (net && net.fetchJSON) {
      net.fetchJSON(net.url('/files/' + encodeURIComponent(fileId)))
        .then(function (item) { openCipLibraryFile(state, item, render); })
        .catch(function () { /* gone, or not this reader's to open */ });
      return;
    }

    if (net) window.open(net.url('/files/' + encodeURIComponent(fileId) + '/preview'), '_blank', 'noopener');
  }

  function cipLibraryFile(state, fileId) {
    var people = cipPeople(state);
    var i;
    var j;
    var docs;

    for (i = 0; i < people.length; i++) {
      if (people[i].photoFile && people[i].photoFile.id === fileId) return people[i].photoFile;
      docs = people[i].documents || [];
      for (j = 0; j < docs.length; j++) {
        if (docs[j].file && docs[j].file.id === fileId) return docs[j].file;
      }
    }

    return clientFolderRow(fileId);
  }

  function openCipLibraryFile(state, file, render) {
    if (!file) return;

    if (window.TMAFileActions && window.TMAFileActions.open) {
      // A new version filed from the viewer is a new version of this file, and
      // the face on the page is derived from the passport photo, so read the
      // application back either way.
      window.TMAFileActions.open(file, function () {
        delete APPLICATIONS[state.selectedId];
        forgetApplication(state.selectedId);
        state.applicationFreshFor = null;
        ensureApplicationLoaded(state, render);
      });
      return;
    }

    // No viewer on this shell, the old behaviour beats doing nothing.
    window.open(file.previewUrl || file.downloadUrl, '_blank', 'noopener');
  }

  /* What this person owes, and what they have handed over. */
  function renderCipChecklist(person) {
    var docs = person.documents || [];
    if (!docs.length) return '';

    /*
     * Never a card, wherever it sits.
     *
     * A dependant is already drawn as one, so a card here put a card inside a
     * card, two rounded edges a few pixels apart. Giving the applicant's
     * version a card and the dependant's a plain block then meant the same
     * list wearing two different shapes on one page. It is a ruled section
     * everywhere instead, and the rule is what separates the documents from
     * the answers above them.
     */
    return (
      '<div class="tma-dash__clients-checklist-block">' +
      '<header class="tma-dash__clients-card-head">' +
      '<h3 class="tma-dash__clients-card-title">Documents</h3>' +
      tabCountChip(docs.filter(function (d) { return d.uploaded; }).length) +
      '</header>' +
      '<ul class="tma-dash__clients-checklist">' +
      docs.map(renderChecklistRow).join('') +
      '</ul></div>'
    );
  }

  /*
   * One requirement, and where it has got to.
   *
   * §11 asks for the mandatory ones to be marked and §12 for the state to be
   * legible, and the meeting was explicit that a provider must never have to
   * click through documents to find what needs work. So the state is the
   * status chip's own colour: something sent back reads as danger, something
   * settled reads as success, and a checklist can be scanned rather than
   * opened.
   *
   * The tick still says whether a file is there at all, because "uploaded" and
   * "accepted" are different questions and a row that answered only the second
   * would hide the first. It is the documented TMA checkbox (`.tma-dash__check`),
   * not a Phosphor circle, same glyph the rest of the portal uses.
   */
  function renderChecklistRow(d) {
    var filed = !!d.uploaded;
    var status = filed
      ? (d.statusLabel || 'Filed')
      : 'Pending upload';
    var tone = filed ? (d.statusTone || 'success') : 'neutral';
    var opens = filed && d.fileId;
    var name =
      '<span class="tma-dash__clients-checklist-label">' + esc(d.label) +
      (opens
        ? '<img class="tma-dash__clients-checklist-open-icon" src="' + ICONS.ArrowSquareOut +
          '" alt="" width="14" height="14">'
        : '') +
      // Not a red star after every line: the mandatory ones are the norm and
      // the exception is worth naming, so the OPTIONAL ones are the ones
      // marked. A checklist of asterisks marks nothing.
      (d.required === false
        ? '<span class="tma-dash__clients-checklist-optional">Optional</span>'
        : '') +
      '</span>';
    var chip =
      '<span class="tma-portal-status tma-portal-status--' + esc(tone) +
      ' tma-portal-status--inline">' + esc(status) + '</span>';
    var body = opens
      ? '<button type="button" class="tma-dash__clients-checklist-open" data-cip-file="' +
        esc(d.fileId) + '" title="Open the filed document">' + name + chip + '</button>'
      : name + chip;

    return (
      '<li class="tma-dash__clients-checklist-row">' +
      '<input type="checkbox" class="tma-dash__check"' + (filed ? ' checked' : '') +
      ' disabled tabindex="-1" aria-hidden="true">' +
      body +
      '</li>'
    );
  }

  /* Assigning is an administrator's, plus anyone the matrix has been widened
     to, the server decides, and this only asks whether to draw the control. */
  function canAssignApplications() {
    var access = window.TMAPortalAccess;
    var me = window.TMACurrentUser && window.TMACurrentUser.get();

    return !!((me && me.isAdmin) || (access && access.can && access.can('cip.assign')));
  }

  /*
   * The Activity tab (§4d): what has happened to this application.
   *
   * The sentences are the server's, cip_events holds actions and status
   * codes, and turning "status_changed / review_application" into English in
   * two places would be two places for it to drift.
   */
  var TIMELINE = {};

  function ensureTimeline(state, render) {
    var id = state.selectedId;
    var app = applicationFor(id);
    if (!id || !app) return;
    if (TIMELINE[id] !== undefined || TIMELINE.loadingFor === id) return;

    TIMELINE.loadingFor = id;
    clientsFetch('/portal/cip/applications/' + encodeURIComponent(app.id) + '/events')
      .then(function (json) { TIMELINE[id] = (json && json.events) || []; })
      .catch(function () { TIMELINE[id] = null; })
      .then(function () {
        TIMELINE.loadingFor = null;
        if (state.selectedId === id) render({ detailOnly: !usesPagedClientsFlow(state) });
      });
  }

  function renderActivityPanel(state, hidden) {
    var events = TIMELINE[state.selectedId];

    var body;
    if (events === undefined) {
      body = '<div class="tma-dash__clients-assigned-empty">Loading the history…</div>';
    } else if (events === null) {
      body = '<div class="tma-dash__clients-assigned-empty">Could not load the history.</div>';
    } else if (!events.length) {
      body = '<div class="tma-dash__clients-assigned-empty">Nothing has happened yet.</div>';
    } else {
      body = '<ol class="tma-dash__cip-activity">' + events.map(renderActivityRow).join('') + '</ol>';
    }

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="activity" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' + body + '</div>'
    );
  }

  function renderActivityRow(e) {
    var who = e.who || {};

    return (
      '<li class="tma-dash__cip-activity-row">' +
      '<span class="tma-dash__cip-activity-face">' +
      (who.avatar
        ? '<img src="' + esc(who.avatar) + '" alt="" width="24" height="24">'
        : esc(String(who.name || '?').charAt(0).toUpperCase())) +
      '</span>' +
      '<span class="tma-dash__cip-activity-what">' + esc(e.what || '') + '</span>' +
      '<span class="tma-dash__cip-activity-when">' + esc(fmtDateTime(e.when)) + '</span>' +
      '</li>'
    );
  }

  /* Every dependant, each with their classification and their checklist. */
  function renderCipDependentsPanel(state, app, hidden) {
    var list = (app.dependents || []);

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="dependents" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      list.map(function (d) {
        return '<div class="tma-dash__clients-card">' +
          '<header class="tma-dash__clients-card-head">' +
          '<h3 class="tma-dash__clients-card-title">' + esc(d.label) + '</h3>' +
          '</header>' +
          renderProfileListColumns([
            { icon: ICONS.User, label: 'Name', value: d.name },
            { icon: ICONS.CalendarBlank, label: 'Date of birth', value: d.dateOfBirth },
          ].filter(function (r) { return !!r.value; }).map(renderListItem)) +
          renderCipChecklist(d) +
          '</div>';
      }).join('') +
      '</div>'
    );
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
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-open-library>' +
          '<img src="' + ICONS.FolderNotch + '" alt=""><span>Open in File Library</span></button>' +
          '<input type="file" multiple hidden data-clients-folder-fileinput>' +
          '</div>'
        : '') +
      '</div>' +
      (uuid
        ? '<div class="tma-dash__clients-folders" data-clients-folder-drop data-folder-uuid="' + esc(uuid) + '" data-root-uuid="' + esc(uuid) + '">' +
          '<div data-clients-folder-canvas data-morph-skip>' +
          '<div class="tma-dash__clients-assigned-empty" data-clients-folder-list>Loading…</div>' +
          '</div></div>'
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

  /* Same shape CBI’s activity tab uses: the date the row already showed, plus
     the time, so two events on one day are distinguishable. */
  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return fmtShortDate(iso) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * A client document's review state, beside its name.
   *
   * Reuses the portal's status badge rather than a chip of this page's own, so
   * "Application review" here, on the person-tab checklists, and in the File
   * Library are recognisably the same fact about the same file.
   */
  function clientStatusChip(f) {
    var s = f && f.status;
    if (!s || !s.label) return '';

    return '<span class="tma-portal-status tma-portal-status--' + esc(s.tone || 'neutral') +
      ' tma-portal-status--inline">' + esc(s.label) + '</span>';
  }

  /* The rows currently on show, so a click can hand the viewer the whole file
     rather than re-fetching one it already has. Folders too, because the row
     menu acts on either. */
  var clientFolderFiles = [];

  var clientFolderFolders = [];

  function clientFolderCanvas(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return null;
    return wrap.querySelector('[data-clients-folder-canvas]') || wrap;
  }

  function renderClientFolderList(root, res) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    var canvas = clientFolderCanvas(root);
    if (!wrap || !canvas) return;
    var folders = (res && res.folders) || [];
    var files = (res && res.files) || [];
    clientFolderFiles = files;
    clientFolderFolders = folders;
    if (!folders.length && !files.length) {
      // Same illustrated empty state as File Library folders, plain grey copy
      // read as a broken list rather than an intentional empty folder.
      var ui = window.TMAPortalUI;
      canvas.innerHTML = '<div data-clients-folder-list>' +
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
      html += '<button type="button" class="tma-dash__clients-folder" draggable="true" data-clients-row data-clients-subfolder="' + esc(f.id) + '" data-clients-subfolder-name="' + esc(f.name) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true">' + folderIcon + '</span>' +
        '<span class="tma-dash__clients-folder-main"><span class="tma-dash__clients-folder-name" data-clients-rename-name>' + esc(f.name) + '</span>' +
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
       * extension, which is what the File Library draws from, the icon set
       * was there all along, this list just was not asking for it.
       */
      var icon = (window.TMAFileIcons && window.TMAFileIcons.fileIconSrc)
        ? window.TMAFileIcons.fileIconSrc(f.icon, f.name)
        : 'images/icons/phosphor/File.svg';

      // Who and when, not just how big, the brief asks for both against every
      // client document, and "uploaded by" is the first question about one.
      var who = f.uploadedBy && f.uploadedBy.name ? f.uploadedBy.name : null;
      var meta = [
        f.sizeLabel,
        f.uploadedAt ? fmtShortDate(f.uploadedAt) : null,
        who,
      ].filter(Boolean).join(' · ');

      html += '<button type="button" class="tma-dash__clients-folder" draggable="true" data-clients-row data-clients-file="' + esc(f.id) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true"><img src="' + esc(icon) + '" alt=""></span>' +
        '<span class="tma-dash__clients-folder-main">' +
          '<span class="tma-dash__clients-folder-name" data-clients-rename-name>' + esc(f.name) + clientStatusChip(f) + '</span>' +
          (meta ? '<span class="tma-dash__clients-folder-meta">' + esc(meta) + '</span>' : '') +
        '</span></button>';
    });
    canvas.innerHTML = html;
  }

  /* One tab's count chip, patched in place.
     Deliberately not a re-render: a render re-wires the folder panel, which
     reloads the folder, which lands back here, a loop that never settles. */
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
   * root listing counts, drilling into a subfolder must not make the tab
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
  // { rootUuid, path: [{ uuid, name }] }, path[0] is always the client folder.
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
    if (clientsMountState) syncClientsDetailUrl(clientsMountState);
    loadClientFolder(root);
  }

  /* The loaded row behind a document button, file or folder. */
  function clientFolderRow(id) {
    return (clientFolderFiles || []).concat(clientFolderFolders || [])
      .filter(function (r) { return r.id === id; })[0];
  }

  /*
   * The File Library's row menu, on a document in this tab.
   *
   * Right-clicking a file here did nothing, so a rename, a move, a share or a
   * copy link meant leaving for the library and finding the same row again.
   * TMAFileActions.menu is the library's own menu, the same actions, the same
   * permission rules, the same destination picker and the same confirmations —
   * handed the row this list already holds, so there is no second, drifting
   * copy of any of it. Anything it changes reloads the list.
   *
   * Anchored on the pointer: the menu is position: fixed, which is what the
   * event's client coordinates already are.
   */
  function openClientFolderMenu(root, e, id) {
    var row = clientFolderRow(id);
    if (!row || !window.TMAFileActions || !window.TMAFileActions.menu) return;

    e.preventDefault();
    window.TMAFileActions.menu(e.clientX, e.clientY, row, function () {
      loadClientFolder(root, { changed: true });
    });
  }

  function bindClientFolderRows(root) {
    root.querySelectorAll('[data-clients-subfolder]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (btn._suppressClick) { e.preventDefault(); e.stopPropagation(); btn._suppressClick = false; return; }
        if (!clientFolderNav) return;
        clientFolderNav.path.push({
          uuid: btn.getAttribute('data-clients-subfolder'),
          name: btn.getAttribute('data-clients-subfolder-name') || 'Folder',
        });
        showClientFolderCurrent(root);
      });
      btn.addEventListener('contextmenu', function (e) {
        openClientFolderMenu(root, e, btn.getAttribute('data-clients-subfolder'));
      });
    });
    root.querySelectorAll('[data-clients-file]').forEach(function (btn) {
      btn.addEventListener('contextmenu', function (e) {
        openClientFolderMenu(root, e, btn.getAttribute('data-clients-file'));
      });
      btn.addEventListener('click', function (e) {
        if (btn._suppressClick) { e.preventDefault(); e.stopPropagation(); btn._suppressClick = false; return; }
        var fu = btn.getAttribute('data-clients-file');
        if (!fu) return;

        /*
         * The File Library's viewer, not a new browser tab.
         *
         * These are the same files the library lists, so opening one here used
         * to give a bare PDF in another tab, no comments, no versions, no
         * review controls, while opening it from the library gave the full
         * viewer. TMAFileActions.open hands the row we already hold straight
         * to it, and the callback refreshes this list for anything the viewer
         * changed (a review moved on, a version added).
         */
        var row = clientFolderRow(fu);

        if (row && window.TMAFileActions && window.TMAFileActions.open) {
          window.TMAFileActions.open(row, function () { loadClientFolder(root, { changed: true }); });

          return;
        }

        // No viewer on this shell, the old behaviour beats doing nothing.
        if (filesNet()) window.open(filesNet().url('/files/' + encodeURIComponent(fu) + '/preview'), '_blank', 'noopener');
      });
    });
  }

  /**
   * Take the crumbs from the server's answer.
   *
   * Restoring a folder from the URL leaves a path with a placeholder in it —
   * the uuid is known, the names above it are not. The listing carries the
   * whole trail, so this replaces the guess with the real one, cut at the
   * client's own folder because everything above that is the firm's filing and
   * not this reader's business here.
   *
   * A no-op when the trail already matches, which is every ordinary click.
   */
  function adoptFolderTrail(root, res) {
    var trail = (res && res.breadcrumb) || [];
    if (!clientFolderNav || !trail.length) return;

    var start = -1;
    for (var i = 0; i < trail.length; i += 1) {
      if (trail[i].id === clientFolderNav.rootUuid) { start = i; break; }
    }
    if (start === -1) return;

    var path = trail.slice(start).map(function (node, i) {
      return { uuid: node.id, name: i === 0 ? 'Client documents' : node.name };
    });

    var same = path.length === clientFolderNav.path.length &&
      path.every(function (node, i) {
        return node.uuid === clientFolderNav.path[i].uuid &&
          node.name === clientFolderNav.path[i].name;
      });
    if (same) return;

    clientFolderNav.path = path;
    renderFolderCrumbs(root);
  }

  /*
   * A folder's contents, from the store first.
   *
   * Nothing was cached, so every step into a folder was a round trip with a
   * blank panel until it answered. 60ms against a local database and the two
   * seconds the firm sees against Cloud Postgres through one worker. The
   * listing is painted from whatever is held and repainted when the server
   * answers, so the second visit to a folder is immediate and the first is no
   * slower. See docs/offline-plan.md.
   */
  function loadClientFolder(root, opts) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap || !filesNet()) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    var url = filesNet().url('/?folder=' + encodeURIComponent(uuid) + '&perPage=0');

    // Something just changed this folder, an upload, a rename, a delete. The
    // held copy describes the folder as it was a moment ago, and showing it
    // first would flash the old contents back over the new.
    if (opts && opts.changed) invalidateClientFolder(uuid);

    var paint = function (res) {
      // The reader may have stepped on while the answer was in flight; a late
      // listing must not redraw the folder they have already left.
      if (wrap.getAttribute('data-folder-uuid') !== uuid) return;
      adoptFolderTrail(root, res);
      renderClientFolderList(root, res);
      bindClientFolderRows(root);
      captureClientDocCount(root, res);
    };

    var fail = function () {
      var canvas = clientFolderCanvas(root) || wrap;
      var list = canvas.querySelector('[data-clients-folder-list]') || canvas;
      list.textContent = 'Could not load this folder.';
    };

    var renamed = false;
    var afterPaint = function () {
      if (!opts || !opts.renameId || renamed) return;
      if (!clientFolderRow(opts.renameId)) return;
      renamed = true;
      startClientFolderRename(root, opts.renameId);
    };

    if (!window.TMAStore) {
      filesNet().fetchJSON(url).then(function (res) { paint(res); afterPaint(); }).catch(fail);

      return;
    }

    window.TMAStore
      .swr(folderCacheKey(uuid), function () { return filesNet().fetchJSON(url); }, function (res) {
        paint(res);
        afterPaint();
      })
      .catch(fail);
  }

  function folderCacheKey(uuid) {
    return 'files:folder:' + uuid;
  }

  /* Anything that changed a folder's contents. The listing it invalidates is
     the one the reader is about to be shown again. */
  function invalidateClientFolder(uuid) {
    if (window.TMAStore && uuid) window.TMAStore.invalidate(folderCacheKey(uuid));
  }

  function uploadToClientFolder(files, uuid) {
    if (!files || !files.length || !window.TMAUpload) return;
    window.TMAUpload.add(files, { folderId: uuid });
    clientsToast(files.length > 1 ? files.length + ' files uploading…' : 'Uploading…', 'neutral');
  }

  function hasOsFiles(e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
  }

  /*
   * Same instant "Untitled folder" as the File Library: create it, paint it,
   * and drop the reader into inline rename. window.prompt was a second, worse
   * version of the same action, and on a morphing profile it stacked until
   * the button looked broken.
   */
  function createClientUntitledFolder(root) {
    var uuid = clientFolderCurrentUuid(root);
    if (!uuid || !filesNet()) return;
    filesNet().fetchJSON(filesNet().url('/folders'), {
      method: 'POST',
      json: { name: 'Untitled folder', parent: uuid, auto: true },
    }).then(function (folder) {
      loadClientFolder(root, { changed: true, renameId: folder && folder.id });
    }).catch(function (err) {
      clientsToast((err && err.message) || 'Could not create the folder', 'negative');
    });
  }

  function startClientFolderRename(root, id) {
    var row = clientFolderRow(id);
    if (!row || !filesNet()) return;
    var btn = root.querySelector('[data-clients-subfolder="' + id + '"], [data-clients-file="' + id + '"]');
    var nameEl = btn && btn.querySelector('[data-clients-rename-name]');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tma-portal-rename-input';
    input.value = row.name;
    input.setAttribute('maxlength', '255');
    input.setAttribute('aria-label', 'Rename ' + row.name);
    nameEl.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();

    var settled = false;
    function finish() {
      loadClientFolder(root, { changed: true });
    }
    function commit() {
      if (settled) return;
      settled = true;
      var next = input.value.trim();
      if (!next || next === row.name) { finish(); return; }
      var url = (row.type === 'folder' ? '/folders/' : '/files/') + row.id;
      filesNet().fetchJSON(filesNet().url(url), { method: 'PATCH', json: { name: next } })
        .then(finish)
        .catch(function (err) {
          clientsToast((err && err.message) || 'Could not rename', 'negative');
          finish();
        });
    }
    function cancel() {
      if (settled) return;
      settled = true;
      finish();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation();
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', commit);
  }

  function moveClientFolderItems(root, items, targetId) {
    if (!items || !items.length || !targetId || !filesNet()) return;
    var payload = items.filter(function (it) { return it.id && it.id !== targetId; })
      .map(function (it) { return { id: it.id, type: it.type }; });
    if (!payload.length) return;
    filesNet().fetchJSON(filesNet().url('/bulk'), {
      method: 'POST',
      json: { action: 'move', items: payload, target: targetId },
    }).then(function () {
      clientsToast(payload.length === 1 ? 'Moved' : payload.length + ' items moved', 'positive');
      loadClientFolder(root, { changed: true });
    }).catch(function (err) {
      clientsToast((err && err.message) || 'Could not move', 'negative');
    });
  }

  function openCurrentFolderInLibrary(root) {
    var dest = clientFolderCurrentUuid(root);
    if (!dest) return;
    if (window.TMADashboard && window.TMADashboard.navigate) {
      var here = clientFolderNav && clientFolderNav.path[clientFolderNav.path.length - 1];
      window.TMADashboard.navigate({
        navId: 'folders-all',
        view: 'folders',
        title: here && here.name ? here.name : 'Client folder',
        crumb: 'File Library / ' + (here && here.name ? here.name : 'Client'),
        folderId: dest,
      });
      return;
    }
    location.href = (window.__TMA_SITE_ROOT || '') + '/files?folder=' + encodeURIComponent(dest);
  }

  function clientFolderPanelHasContents(wrap) {
    var canvas = wrap.querySelector('[data-clients-folder-canvas]') || wrap;
    if (canvas.querySelector('[data-clients-subfolder], [data-clients-file]')) return true;
    var empty = canvas.querySelector('[data-clients-folder-list]');
    return !!(empty && empty.textContent && empty.textContent !== 'Loading…');
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
      if (wrap) {
        var done = e.detail && e.detail.folderId;
        if (!done || done === wrap.getAttribute('data-folder-uuid')) {
          loadClientFolder(clientsMountRoot, { changed: true });
        }
      }

      var ctrl = clientsMountRoot._clientsController;
      if (!ctrl || !ctrl.state) return;
      var st = ctrl.state;
      if (!st.selectedId || !applicationFor(st.selectedId)) return;
      forgetApplication(st.selectedId);
      st.applicationFreshFor = null;
      ensureApplicationLoaded(st, ctrl.render);
    });
  }

  function wireClientFolderPanel(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return;
    var rootUuid = wrap.getAttribute('data-root-uuid');

    // Start a fresh drill path when opening a different client's folder; keep it
    // (so a switch to Client info and back stays put) for the same client.
    var switchedClient = !clientFolderNav || clientFolderNav.rootUuid !== rootUuid;
    if (switchedClient) {
      clientFolderNav = { rootUuid: rootUuid, path: [{ uuid: rootUuid, name: 'Client documents' }] };

      /*
       * Reopened where the address left off.
       *
       * Only the folder in view is in the URL; the trail above it comes back
       * with the listing (`breadcrumb`), so this points at the folder and lets
       * the answer fill in the crumbs. A link to a folder need carry nothing
       * but the folder.
       */
      var boot = takeBootPosition('folder');
      if (boot) clientFolderNav.path.push({ uuid: boot, name: '…' });
    }
    wrap.setAttribute('data-folder-uuid', clientFolderNav.path[clientFolderNav.path.length - 1].uuid);
    renderFolderCrumbs(root);

    var current = function () { return clientFolderCurrentUuid(root); };

    bindClientFolderUploadRefresh();
    if (switchedClient || !clientFolderPanelHasContents(wrap)) loadClientFolder(root);

    MORPH.unwired(root, '[data-clients-folder-new]').forEach(function (btn) {
      btn.addEventListener('click', function () { createClientUntitledFolder(root); });
    });

    var fileInput = root.querySelector('[data-clients-folder-fileinput]');
    MORPH.unwired(root, '[data-clients-folder-upload]').forEach(function (btn) {
      btn.addEventListener('click', function () { if (fileInput) fileInput.click(); });
    });
    if (fileInput) {
      MORPH.unwired(root, '[data-clients-folder-fileinput]').forEach(function (input) {
        input.addEventListener('change', function () {
          uploadToClientFolder(input.files, current());
          input.value = '';
        });
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
    MORPH.unwired(root, '[data-clients-folder-request]').forEach(function (requestBtn) {
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
          onCreated: function () { loadClientFolder(root, { changed: true }); },
        });
      });
    });

    MORPH.unwired(root, '[data-clients-open-library]').forEach(function (btn) {
      btn.addEventListener('click', function () { openCurrentFolderInLibrary(root); });
    });

    // Breadcrumb: jump back up to any ancestor (delegated, survives repaints).
    MORPH.unwired(root, '[data-clients-folder-crumbs]').forEach(function (crumbHost) {
      crumbHost.addEventListener('click', function (e) {
        var crumb = e.target.closest('[data-clients-crumb]');
        if (!crumb || !clientFolderNav) return;
        var idx = parseInt(crumb.getAttribute('data-clients-crumb'), 10);
        clientFolderNav.path = clientFolderNav.path.slice(0, idx + 1);
        showClientFolderCurrent(root);
      });
    });

    if (wrap._clientFolderDropWired) return;
    wrap._clientFolderDropWired = true;

    var draggingItems = null;

    function clearDropHighlight() {
      wrap.classList.remove('is-drop-into');
      wrap.querySelectorAll('.is-drop-into').forEach(function (n) { n.classList.remove('is-drop-into'); });
    }

    wrap.addEventListener('dragstart', function (e) {
      var row = e.target.closest('[data-clients-row]');
      if (!row || !wrap.contains(row)) return;
      var id = row.getAttribute('data-clients-subfolder') || row.getAttribute('data-clients-file');
      var it = clientFolderRow(id);
      if (!it) return;
      draggingItems = [{ id: it.id, type: it.type || (row.hasAttribute('data-clients-subfolder') ? 'folder' : 'file') }];
      try { e.dataTransfer.setData('text/plain', it.name || 'item'); } catch (err) {}
      try { e.dataTransfer.setData('application/x-tma-move', '1'); } catch (err) {}
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });

    wrap.addEventListener('dragover', function (e) {
      var folderRow = e.target.closest('[data-clients-subfolder]');
      if (hasOsFiles(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        clearDropHighlight();
        (folderRow && wrap.contains(folderRow) ? folderRow : wrap).classList.add('is-drop-into');
        return;
      }
      if (!draggingItems || !folderRow || !wrap.contains(folderRow)) return;
      if (draggingItems.some(function (d) { return d.id === folderRow.getAttribute('data-clients-subfolder'); })) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropHighlight();
      folderRow.classList.add('is-drop-into');
    });

    wrap.addEventListener('dragleave', function (e) {
      var into = e.target.closest('.is-drop-into');
      if (into && !into.contains(e.relatedTarget)) into.classList.remove('is-drop-into');
    });

    wrap.addEventListener('drop', function (e) {
      var folderRow = e.target.closest('[data-clients-subfolder]');
      var dest = folderRow && wrap.contains(folderRow)
        ? folderRow.getAttribute('data-clients-subfolder')
        : current();
      clearDropHighlight();
      if (hasOsFiles(e) && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        e.stopPropagation();
        uploadToClientFolder(e.dataTransfer.files, dest);
        draggingItems = null;
        return;
      }
      if (!draggingItems || !folderRow || !wrap.contains(folderRow)) return;
      e.preventDefault();
      e.stopPropagation();
      var moving = draggingItems;
      draggingItems = null;
      moveClientFolderItems(root, moving, dest);
    });

    wrap.addEventListener('dragend', function () {
      clearDropHighlight();
      var row = wrap.querySelector('.is-dragging');
      if (row) {
        row.classList.remove('is-dragging');
        row._suppressClick = true;
      }
      draggingItems = null;
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

  /* Who used to look after this client. Read-only, ending an assignment keeps
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
    social_failed: 'Microsoft or Google sign-in refused',
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
      var unassigned = assignable.filter(function (s) {
        return !items.some(function (a) { return String(a.userId) === String(s.id); });
      });
      /*
       * A picker and a button, nothing else. The permission-level dropdown
       * sat here and nobody chose anything but Editor, a question with one
       * answer asked on every assignment. Everyone starts as Editor, and the
       * level can still be changed on the assigned row afterwards.
       */
      assignForm =
        '<div class="tma-dash__clients-assign-form">' +
        staffPicker('data-clients-assign-user', unassigned, state.assignPick, 'Assign staff…') +
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

  function conversationKindLabel(row) {
    if (row && row.subject === 'provider') return (row.subtitle || 'Service provider');
    if (row && row.subject === 'person') return 'Private';
    return row && row.subtitle ? row.subtitle : 'Conversation';
  }

  function recordingDurationLabel(ms) {
    var n = parseInt(ms, 10) || 0;
    if (n <= 0) return '';
    var secs = Math.round(n / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return m + 'm' + (s < 10 ? '0' : '') + s + 's';
  }

  function recordingWhenLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function renderClientMessagesPanel(state, hidden) {
    var loading = !!state.conversationsLoading && !state.conversations;
    var threads = state.conversations || [];
    var recordings = state.recordings || [];
    var opts = state.conversationOptions || {};
    var canMessage = (opts.provider && opts.provider.available) || (opts.person && opts.person.available);

    var threadsBody;
    if (loading) {
      threadsBody = '<div class="tma-dash__clients-assigned-empty">Loading conversations…</div>';
    } else if (!threads.length) {
      threadsBody = '<div class="tma-dash__clients-assigned-empty">' +
        (canMessage
          ? 'No conversations on this file yet. Use Message to start one with the service provider.'
          : 'No conversations on this file yet.') +
        '</div>';
    } else {
      threadsBody = '<div class="tma-dash__clients-assigned-list">' + threads.map(function (row) {
        var meta = [conversationKindLabel(row)];
        if (row.preview) meta.push(row.preview);
        return '<button type="button" class="tma-dash__clients-assigned tma-dash__clients-thread" data-clients-open-thread="' +
          esc(row.id) + '">' +
          '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' +
          '<img src="' + ICONS.ChatTeardropDots + '" alt="" width="16" height="16"></span>' +
          '<span class="tma-dash__clients-assigned-main">' +
          '<span class="tma-dash__clients-assigned-title">' + esc(row.name || 'Conversation') + '</span>' +
          '<span class="tma-dash__clients-assigned-meta">' + esc(meta.filter(Boolean).join(' · ')) + '</span>' +
          '</span></button>';
      }).join('') + '</div>';
    }

    var recordingsBody;
    if (loading) {
      recordingsBody = '';
    } else if (!recordings.length) {
      recordingsBody = '<div class="tma-dash__clients-assigned-empty">No call recordings on this file yet. Calls with the service provider are recorded automatically.</div>';
    } else {
      recordingsBody = '<div class="tma-dash__clients-assigned-list">' + recordings.map(function (r) {
        var kind = r.media === 'video' ? 'Video' : 'Voice';
        var meta = [kind, recordingWhenLabel(r.startedAt), recordingDurationLabel(r.durationMs)].filter(Boolean);
        return '<button type="button" class="tma-dash__clients-assigned tma-dash__clients-thread" data-clients-open-recording="' +
          esc(r.id) + '">' +
          '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' +
          '<img src="' + ICONS.Phone + '" alt="" width="16" height="16"></span>' +
          '<span class="tma-dash__clients-assigned-main">' +
          '<span class="tma-dash__clients-assigned-title">' + esc(kind + ' call') + '</span>' +
          '<span class="tma-dash__clients-assigned-meta">' + esc(meta.join(' · ')) + '</span>' +
          '</span></button>';
      }).join('') + '</div>';
    }

    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="messages" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Conversations</span></div>' +
      threadsBody + '</div>' +
      '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Call recordings</span></div>' +
      recordingsBody + '</div>' +
      '</div>'
    );
  }

  function renderProfile(state, opts) {
    opts = opts || {};

    /*
     * The profile arrives separately from the directory listing, so the panel
     * has a name and an avatar before it has phone numbers. Drawing the record
     * now would show an empty one, indistinguishable from a client who really
     * has nothing recorded, which most imported clients are.
     *
     * The application arrives separately again, and it decides which tabs this
     * profile HAS. Drawing before it lands gave the applicant's screen the
     * plain-client tabs. Client info, Documents, Assigned, which then swapped
     * for Main applicant / Sponsor / Dependents a round trip later. Not a flash
     * on the firm's connection: two seconds of the wrong screen, offering a tab
     * that does not belong to this client at all.
     *
     * Waited for only while a request is actually out. Gating on "not answered
     * yet" would hold the skeleton for ever on any path that never asks.
     */
    var appPending = state.selectedId &&
      applicationFor(state.selectedId) === undefined &&
      state.applicationLoadingFor === state.selectedId;

    if (state.selectedId && (!profileLoaded(state.selectedId) || appPending)) {
      /*
       * The tab row stays, as a shape.
       *
       * Waiting for the application means not knowing which tabs this profile
       * has, but "not yet" is not the same as "none", and dropping the row
       * made it vanish and come back on every single client you opened, taking
       * the panel below it up and down with it. A row of the right height,
       * greyed, holds its place until it can be filled in.
       */
      return (
        '<div class="tma-dash__clients-detail">' +
        (opts.elevateToolbar ? '' : renderContactProfileToolbar(contactFor(state.selectedId), state)) +
        (state.profileError ? '' : renderProfileTabsSkeleton()) +
        '<div class="tma-dash__clients-profile' +
        (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
        (state.profileError
          ? renderProfileError(state.profileError, { retry: !state.profileErrorFinal })
          : renderProfileSkeleton()) +
        '</div></div>'
      );
    }

    var c = contactFor(state.selectedId);
    var app = applicationFor(state.selectedId);
    // The stored tab may not exist on this profile, an applicant has no
    // "Client info", and a client with no application has no "Main applicant".
    var tabIds = profileTabsFor(state).map(function (t) { return t.id; });
    var activeTab = tabIds.indexOf(state.profileTab) !== -1
      ? state.profileTab
      : defaultProfileTab(state);

    /*
     * Say where we ended up.
     *
     * The route sync writes the client's path and nothing else, and it runs
     * before this, before the application has arrived and before there is a
     * tab to name. So the address is brought up to date once the answer is
     * known, from the render that knows it. Not during: a history write inside
     * the string-building would fire on every repaint of the same screen.
     */
    if (state.screen === 'detail' && activeTab !== state.profileTab) state.profileTab = activeTab;
    if (state.screen === 'detail') {
      setTimeout(function () { syncClientsDetailUrl(state); }, 0);
    }

    var listItems = buildProfileListItems(c);
    var toolbar = opts.elevateToolbar ? '' : renderContactProfileToolbar(c, state);

    /*
     * The tabs sit above the panel, not inside it.
     *
     * They name the sections; they are not one of them. Inside, they were a
     * row at the top of a grey surface that then held more grey surfaces, and
     * on a CIP application, where every panel is made of cards, that surface
     * was a card behind cards with nothing between them but a seam. Outside,
     * the tabs sit on the page and each panel is whatever it is.
     */
    return (
      '<div class="tma-dash__clients-detail">' +
      toolbar +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__clients-profile-tablist" role="tablist" aria-label="Client sections">' +
      renderProfileTabs(state, activeTab) +
      '</div>' +
      renderFactsStrip(app) +
      renderApplicationBar(state, app) +
      renderApplicationSyncNotice(app) +
      // An application's panels are cards, so the panel behind them gets out
      // of the way, the same reason a company's and the intake form's do.
      '<div class="tma-dash__clients-profile' +
      (app ? ' tma-dash__clients-profile--cards' : '') +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      (app
        ? renderOverviewPanel(app, activeTab !== 'overview') +
          renderCipPersonPanel(state, app.applicant, 'applicant', activeTab !== 'applicant') +
          renderCipPersonPanel(state, app.sponsor, 'sponsor', activeTab !== 'sponsor') +
          ((app.dependents || []).length
            ? renderCipDependentsPanel(state, app, activeTab !== 'dependents')
            : '')
        : renderContactInfoPanel(c, listItems, activeTab !== 'info')) +
      (app ? renderActivityPanel(state, activeTab !== 'activity') : '') +
      renderFoldersPanel(c.id, activeTab !== 'folders') +
      renderAssignedPanel(state, c.id, activeTab !== 'assigned') +
      renderClientMessagesPanel(state, activeTab !== 'messages') +
      renderAccessPanel(state, c, activeTab !== 'access') +
      '</div></div>'
    );
  }

  /*
   * Say that what is on the screen has not reached the firm yet.
   *
   * An application edited with no network reads exactly like one that saved
   * normally, that is the point of applying it locally, and without this
   * line the reader has no way to tell, and no reason to leave the laptop on
   * long enough for the queue to run. It comes off by itself: the queue's
   * replay refetches the record, and the server's copy has no `pendingSync`.
   */
  function renderApplicationSyncNotice(app) {
    if (!app || !app.pendingSync || !window.TMAPortalUI) return '';

    return '<div class="tma-dash__clients-sync-notice">' +
      window.TMAPortalUI.banner('warning',
        'Saved on this device. These answers sync to the firm when you’re back online.') +
      '</div>';
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

  function wireRowContextMenus(root, state, navigate, render) {
    clientsMenuCtx = { root: root, state: state, navigate: navigate, render: render };
    ensureClientsPopovers();

    function bind(sel, kind, attr) {
      MORPH.unwired(root, sel, 'ctx').forEach(function (el) {
        el.addEventListener('contextmenu', function (e) {
          // Leave the browser's own menu to links and selected text.
          if (e.target.closest('a') || String(window.getSelection() || '')) return;
          // A person's row carries a link to their service provider, so both
          // handlers see this event. The innermost target wins: right-clicking
          // the provider link asks about the provider, not the person.
          if (kind !== 'company' && e.target.closest('[data-clients-open-company]')) return;
          var id = el.getAttribute(attr);
          if (!id) return;
          e.preventDefault();
          var extra = kind === 'application'
            ? { applicationId: el.getAttribute('data-cip-app') }
            : null;
          openClientsContextMenu(kind, id, e.clientX, e.clientY, extra);
        });
      });
    }

    bind('[data-clients-row]', 'client', 'data-clients-row');
    // §8's table draws its own rows, so they carry their own hook, but the
    // menu, its actions and its permissions are the ones every other row uses.
    bind('[data-cip-open]', 'application', 'data-cip-open');
    bind('[data-clients-open-company]', 'company', 'data-clients-open-company');
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
        /*
         * "See all" opens the applications table filtered to this firm.
         *
         * It used to set the directory's referral filter and navigate to a
         * table that has never consulted it, so the reader got the whole,
         * unfiltered list with a chip claiming otherwise. The honest
         * equivalent on a table of applications is the firm that filed them,
         * which is the Service provider filter.
         */
        var provider = providerForCompany(btn.getAttribute('data-clients-see-referred'));
        if (!provider) return;

        clearTableFilters();
        TABLE_FILTERS.provider = [String(provider.id)];
        APP_TABLE.page = 1;
        state.filters = emptyClientFilters();
        state.page = 1;
        state.selected = {};
        state.search = '';
        state.listTab = 'applications';
        saveListTab('applications');
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
      (opts.icon
        ? '<img src="' + esc(opts.icon) + '" alt="" class="tma-filter-popover__item-icon" width="16" height="16">'
        : '') +
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

  /*
   * One field's checkbox list, for the toolbar dropdown that opened it.
   *
   * A single group rather than all three: each dropdown answers its own
   * question and sits under its own button, so a panel carrying the other two
   * would be three menus opening from whichever button was pressed last.
   */
  function fillFilterField(field) {
    var state = clientsFilterCtx && clientsFilterCtx.state;
    var group = '';

    if (field === 'bucket' && statusFilterApplies(state)) {
      group = filterGroup('bucket', BUCKETS.list.map(function (b) {
        return { id: b.key, name: b.label, count: b.count, tone: b.tone };
      }));
    } else if (field === 'assignee' && assigneeFilterApplies(state)) {
      group = filterGroup('assignee', APP_TABLE.assignees);
    } else if (field === 'provider' && providerFilterApplies(state)) {
      group = filterGroup('provider', APP_TABLE.providers);
    }

    if (!group) {
      // Reachable only in the beat before the first listing answers: the
      // button is not drawn where the field has nothing to offer, so this is
      // a wait rather than a dead end, and it says so.
      clientsPop.fields.innerHTML =
        '<div class="tma-filter-popover__note">Loading…</div>';

      return;
    }

    clientsPop.fields.innerHTML = group +
      (filterValues(field).length
        ? '<div class="tma-filter-popover__divider"></div>' +
          '<button type="button" class="tma-filter-popover__item tma-filter-popover__item--clear"' +
          ' data-cip-filter-clear="' + esc(field) + '">Clear</button>'
        : '');
  }


  /**
   * One field's values as checkboxes.
   *
   * No heading inside the panel: the dropdown button it hangs from already
   * names the field, and repeating it an inch below is the panel telling the
   * reader what they just pressed.
   *
   * @param {string} field  bucket | assignee | provider
   * @param {Array}  items  [{ id, name, count, tone? }] in the server's order
   */
  /*
   * What sits between the checkbox and the name.
   *
   * A status wears its tone as a dot; an officer wears their face. The portal
   * draws a colleague with their picture everywhere else, and this list is
   * the one place a reader picks a person out of several, which is exactly
   * where two similar names get confused if there is nothing to tell them
   * apart at a glance.
   *
   * "Unassigned" is not a person and does not get a face. It gets an empty
   * ring in the same place, so the names below it still line up and nothing
   * pretends there is somebody there, a stock silhouette on a row that means
   * "nobody" would be the list inventing a person.
   */
  function filterItemArt(field, item) {
    if (item.tone) {
      return '<i class="tma-filter-popover__dot tma-filter-popover__dot--' + esc(item.tone) + '"></i>';
    }

    if (field !== 'assignee') return '';

    if (String(item.id) === 'none') {
      return '<span class="tma-filter-popover__face tma-filter-popover__face--none" aria-hidden="true"></span>';
    }

    var src = personFace(item);

    return src
      ? '<img class="tma-filter-popover__face" src="' + esc(src) + '" alt="" width="22" height="22">'
      : '<span class="tma-filter-popover__face tma-filter-popover__face--none" aria-hidden="true"></span>';
  }

  function filterGroup(field, items) {
    if (!items || !items.length) return '';

    return '<div class="tma-filter-popover__group" role="group">' +
      items.map(function (item) {
        var on = filterHas(field, item.id);

        /*
         * A real checkbox role rather than a pressed button: the reader is
         * choosing several from a list, and a screen reader has to say
         * "checked" for that to be understood. The tick itself is drawn by
         * the stylesheet from this state, so the markup carries no icon.
         */
        return '<button type="button" class="tma-filter-popover__item tma-filter-popover__item--check"' +
          ' role="checkbox" aria-checked="' + (on ? 'true' : 'false') + '"' +
          (on ? ' data-selected' : '') +
          ' data-cip-filter="' + esc(field) + '" data-cip-value="' + esc(item.id) + '">' +
          '<span class="tma-filter-popover__check" aria-hidden="true"></span>' +
          filterItemArt(field, item) +
          '<span class="tma-filter-popover__item-label">' + esc(item.name) + '</span>' +
          '<span class="tma-filter-popover__item-meta">' + esc(String(item.count)) + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
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
      clientsFilterCtx.root.querySelectorAll('[data-cip-dropdown],[data-clients-sort]').forEach(function (b) {
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
  /*
   * A filter changed: re-ask the server and redraw.
   *
   * All three are server-applied, so there is nothing to match over rows the
   * browser already holds, the page number goes back to one because page 4 of
   * the old answer is not page 4 of the new one, and the selection is dropped
   * because the rows it referred to may not be in the new answer at all.
   */
  function applyTableFilters() {
    if (!clientsFilterCtx) return;
    var state = clientsFilterCtx.state;

    APP_TABLE.page = 1;
    state.page = 1;
    state.selected = {};
    syncClientsListUrl(state);
    clientsFilterCtx.render({ forceFull: true });
  }

  /** Untick one value, from the chip under the toolbar. */
  function removeTableFilter(tagId) {
    var at = String(tagId).indexOf(':');
    if (at === -1) return false;

    var field = tagId.slice(0, at);
    if (!TABLE_FILTERS[field]) return false;

    return filterHas(field, tagId.slice(at + 1)) && toggleFilter(field, tagId.slice(at + 1));
  }

  function wireClientsPopovers() {
    clientsPop.host.addEventListener('click', function (e) {
      if (!clientsFilterLive()) { closeClientsPopovers(); return; }

      /*
       * A tick, which leaves the panel open.
       *
       * Closing on every tick would be the drill-down behaviour this replaced:
       * a reader building "New or Delayed, unassigned" would have to reopen
       * the menu three times, and would never see the combination they were
       * assembling. The group is redrawn in place instead, so the tick appears
       * and the counts beside it stay put.
       */
      var tick = e.target.closest('[data-cip-filter]');
      if (tick) {
        e.preventDefault();
        /*
         * Claimed before the panel is rebuilt.
         *
         * fillFilterField() replaces this popover's innerHTML, which orphans
         * the button that was just clicked, and the outside-click listener on
         * the document runs after this one, by which time `closest()` on a
         * detached node can no longer find the popover it came from. It would
         * read the tick as a click outside and shut the panel on every tick.
         */
        e._cipFilterHandled = true;

        var tickField = tick.getAttribute('data-cip-filter');
        if (toggleFilter(tickField, tick.getAttribute('data-cip-value'))) {
          applyTableFilters();
          fillFilterField(tickField);
        }

        return;
      }

      var clear = e.target.closest('[data-cip-filter-clear]');
      if (clear) {
        e.preventDefault();
        var field = clear.getAttribute('data-cip-filter-clear');
        if (filterValues(field).length) {
          TABLE_FILTERS[field] = [];
          applyTableFilters();
        }
        closeClientsPopovers();

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

    });

    document.addEventListener('click', function (e) {
      if (!clientsPop || !clientsPop.host.isConnected) return;
      if (!clientsFilterLive()) { closeClientsPopovers(); return; }
      // A tick inside the panel, whose node the redraw has already discarded.
      if (e._cipFilterHandled) return;
      if (e.target.closest('[data-clients-popover]') || e.target.closest('[data-cip-dropdown]') ||
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

  /* ── row context menu ───────────────────────────────
   *
   * Right-click (and long-press, which the browser reports as contextmenu on
   * touch) on any directory row, a person or a service provider, in the
   * table, the A-Z list, or a company's people list. The items are the same
   * verbs the toolbar carries; this only saves the trip.
   */
  var clientsMenuCtx = null;
  var clientsCtxEl = null;
  var clientsCtxSubEl = null;
  var clientsCtxAnchor = null;
  var clientsAssignable = {};

  /* Deleting a provider asks a real question, keep its people or take them
     with it, which a browser confirm() cannot. Referred clients are never
     deleted here: they are the firm's applicants, not the provider's staff. */
  /* The record if the page already holds it, else the server's copy. A
     company button rides inside client rows too, where this list may never
     have been loaded. */
  function resolveCompany(id) {
    var local = companyFor(id);
    if (local) return Promise.resolve(local);
    return CompaniesAPI.get(id).then(function (data) {
      return (data && data.company) || null;
    }).catch(function () { return null; });
  }

  function confirmCompanyDelete(company, onConfirm) {
    var ui = window.TMAPortalUI;
    // Two populations hang off a provider and both are "its people": the
    // contacts on its own record, and the clients it referred.
    var contacts = (company.people || []).length;
    var referred = company.referredCount || 0;
    var total = contacts + referred;

    if (!ui || !ui.openModal) {
      if (window.confirm('Delete ' + company.name + '? Its people are kept.')) onConfirm(false);
      return;
    }

    var parts = [];
    if (contacts) parts.push(contacts === 1 ? 'one contact' : contacts + ' contacts');
    if (referred) parts.push(referred === 1 ? 'one referred client' : referred + ' referred clients');
    var summary = total
      ? 'This service provider has ' + parts.join(' and ') + '.'
      : 'Nobody is attached to this service provider.';

    var host = ui.openModal({
      title: 'Delete ' + company.name + '?',
      body:
        '<p class="tma-portal-modal__text">' + esc(summary) + '</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-company-del-cancel>Cancel</button>' +
        (total
          ? '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-company-del-keep>Delete, keep them</button>' +
            '<button type="button" class="tma-no-data__btn tma-portal-btn--danger" data-company-del-all>Delete with ' +
              esc(total === 1 ? 'them' : 'all ' + total) + '</button>'
          : '<button type="button" class="tma-no-data__btn tma-portal-btn--danger" data-company-del-keep>Delete</button>') +
        '</div>',
      onMount: function (el) {
        var close = function () { ui.closeModal(); };
        var cancel = el.querySelector('[data-company-del-cancel]');
        if (cancel) cancel.addEventListener('click', close);
        var keep = el.querySelector('[data-company-del-keep]');
        if (keep) keep.addEventListener('click', function () { close(); onConfirm(false); });
        var all = el.querySelector('[data-company-del-all]');
        if (all) all.addEventListener('click', function () { close(); onConfirm(true); });
      },
    });
    return host;
  }

  /*
   * §15: the service provider locks the original package.
   *
   * Said before they commit, because this is the moment documents stop being
   * editable, staff recording the CIP number afterwards is a different verb.
   */
  function openConfirmSubmissionDialog(state, render) {
    var ui = window.TMAPortalUI;
    var app = applicationFor(state.selectedId);
    if (!app || !ui || !ui.openModal) return;

    ui.openModal({
      title: 'Confirm submission',
      body:
        '<p class="tma-portal-modal__text">' +
        'Confirming locks the original submission package. Documents cannot be changed after this.</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel-confirm>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-cip-save-confirm>Confirm submission</button>' +
        '</div>',
      onMount: function (el) {
        var cancel = el.querySelector('[data-cip-cancel-confirm]');
        if (cancel) cancel.addEventListener('click', function () { ui.closeModal(); });

        var save = el.querySelector('[data-cip-save-confirm]');
        if (!save) return;

        save.addEventListener('click', function () {
          save.disabled = true;
          save.textContent = 'Confirming…';

          clientsFetch('/portal/cip/applications/' + encodeURIComponent(app.id) + '/confirm', {
            method: 'POST',
            json: {},
          })
            .then(function (json) {
              ui.closeModal();
              var uid = state.selectedId;
              if (uid) forgetApplication(uid);
              forgetApplicationTable();
              forgetBuckets();
              clientsToast('Submission confirmed, the original package is locked.', 'positive');
              if (typeof render === 'function') {
                render(usesPagedClientsFlow(state) ? { forceFull: true } : { detailOnly: true });
              } else {
                repaintClients();
              }
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = 'Confirm submission';
              clientsToast((err && err.message) || 'Could not confirm this submission.', 'negative');
            });
        });
      },
    });
  }

  /*
   * Entering the CIP number (§7, §16).
   *
   * Two jobs, one dialog, because they are the same field: recording the
   * submission (which also moves the application to Pending review) and
   * correcting a number typed wrong (which does not). Splitting them into two
   * screens would mean two places to keep the same rules about a government
   * identifier.
   *
   * The date is asked for rather than assumed. Staff record a submission after
   * the fact as often as on the day, and quietly stamping today would put the
   * wrong date on an audit trail nobody would think to check.
   */
  function openSubmissionDialog(state, render, correcting, fromApp) {
    var ui = window.TMAPortalUI;
    var app = fromApp || applicationFor(state.selectedId);
    if (!app || !ui || !ui.openModal) return;

    var today = new Date().toISOString().slice(0, 10);

    ui.openModal({
      title: correcting ? 'Edit CIP number' : 'Record submission to the Unit',
      body:
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="cip-number">CIP application number</label>' +
        '<input type="text" id="cip-number" class="tma-dash__clients-field-input" data-cip-number' +
        ' value="' + esc(correcting ? (app.cipNumber || '') : '') + '"' +
        ' placeholder="10T1G12661P" autocomplete="off" spellcheck="false">' +
        '</div>' +
        (correcting
          ? ''
          : '<div class="tma-dash__clients-field">' +
            '<label class="tma-dash__clients-field-label" for="cip-submitted">Submission date</label>' +
            '<input type="date" id="cip-submitted" class="tma-dash__clients-field-input"' +
            ' data-cip-submitted value="' + esc(today) + '">' +
            '</div>') +
        // Said before they commit: this is the moment the whole portal starts
        // calling the application something else.
        '<p class="tma-portal-modal__text">' +
        (correcting
          ? 'The status does not change.'
          : 'Every screen will show this number from now on. ' +
            esc(app.internalNumber || 'The internal number') + ' stays for audit and invoicing.') +
        '</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel-number>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-cip-save-number>' +
        (correcting ? 'Save number' : 'Record submission') + '</button>' +
        '</div>',
      onMount: function (el) {
        var input = el.querySelector('[data-cip-number]');
        if (input) input.focus();

        var cancel = el.querySelector('[data-cip-cancel-number]');
        if (cancel) cancel.addEventListener('click', function () { ui.closeModal(); });

        var save = el.querySelector('[data-cip-save-number]');
        if (!save) return;

        save.addEventListener('click', function () {
          var number = input ? input.value.trim() : '';
          if (!number) {
            clientsToast('Enter the CIP application number from the Unit.', 'negative');
            if (input) input.focus();

            return;
          }

          var dateEl = el.querySelector('[data-cip-submitted]');
          if (!correcting && (!dateEl || !dateEl.value)) {
            clientsToast('Enter the submission date.', 'negative');
            if (dateEl) dateEl.focus();

            return;
          }

          save.disabled = true;
          save.textContent = 'Saving…';

          submitCipNumber(app.id, number, correcting, dateEl ? dateEl.value : null)
            .then(function (json) {
              ui.closeModal();
              var record = json && json.application;
              var uid = (fromApp && fromApp.clientUid) || state.selectedId;
              if (record && uid) rememberApplication(uid, record);
              forgetApplicationTable();
              forgetBuckets();
              clientsToast(correcting
                ? 'CIP number updated'
                : 'Submission recorded, now ' + (record ? record.number : number), 'positive');
              if (typeof render === 'function') {
                render(usesPagedClientsFlow(state) ? { forceFull: true } : { detailOnly: true });
              } else {
                repaintClients();
              }
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = correcting ? 'Save number' : 'Record submission';
              clientsToast((err && err.message) || 'Could not save that number.', 'negative');
            });
        });
      },
    });
  }

  function submitCipNumber(applicationId, number, correcting, submittedAt) {
    var base = '/portal/cip/applications/' + encodeURIComponent(applicationId);

    if (correcting) {
      return clientsFetch(base + '/cip-number', {
        method: 'PATCH',
        json: { cipNumber: number },
      });
    }

    return clientsFetch(base + '/submission', {
      method: 'POST',
      json: { cipNumber: number, submittedAt: submittedAt || null },
    });
  }

  function canAssignClients() {
    var access = window.TMAPortalAccess;
    return !!(access && access.can && access.can('clients.assign'));
  }

  function clientsContextItems(kind) {
    var items = [
      { act: 'open', label: 'Open', icon: 'ArrowUpRight' },
      // On §8's table the row IS an application, so Edit means the
      // application, the client's contact form is a different record and
      // sending somebody there from here would be answering a question they
      // did not ask.
      {
        act: 'edit',
        label: kind === 'application' ? 'Edit application' : 'Edit',
        icon: 'PencilSimple',
      },
    ];
    if (kind === 'company') items.push({ act: 'add-person', label: 'Add person', icon: 'Plus' });
    if (kind === 'application') {
      items.push({ act: 'status', label: 'Change status', icon: 'Flag', submenu: true });
    }
    // Assigning staff is `clients.assign`, the same capability the server
    // enforces, read through the access mirror rather than guessed from the
    // current-user store (which is not always populated by the time a row
    // is right-clicked).
    if (canAssignClients()) items.push({ act: 'assign', label: 'Assign to', icon: 'UserPlus', submenu: true });
    items.push({ sep: true });
    items.push({ act: 'delete', label: 'Delete', icon: 'Trash', danger: true });
    return items;
  }

  function ctxItemHtml(item) {
    if (item.sep) return '<div class="tma-portal-context-menu__sep" role="separator"></div>';
    return '<button type="button" role="menuitem"' +
      ' class="tma-portal-context-menu__item' +
      (item.danger ? ' tma-portal-context-menu__item--danger' : '') +
      (item.submenu ? ' tma-portal-context-menu__item--parent' : '') + '"' +
      ' data-clients-ctx-act="' + esc(item.act) + '"' + (item.submenu ? ' aria-haspopup="true"' : '') + '>' +
      '<img class="tma-portal-context-menu__icon" src="images/icons/phosphor/' + esc(item.icon) + '.svg" alt="" width="16" height="16">' +
      '<span class="tma-portal-context-menu__label">' + esc(item.label) + '</span>' +
      (item.submenu
        ? '<img class="tma-portal-context-menu__chevron" src="images/icons/phosphor/CaretRight.svg" alt="" width="16" height="16" aria-hidden="true">'
        : '') +
      '</button>';
  }

  /* Placed at the pointer, then pulled back inside the window, the same
     clamp the File Library's menu uses. */
  function placeCtxMenu(el, x, y) {
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }

  function closeClientsContextMenu() {
    closeClientsCtxSub();
    if (clientsCtxEl && clientsCtxEl.parentNode) clientsCtxEl.parentNode.removeChild(clientsCtxEl);
    clientsCtxEl = null;
    clientsCtxAnchor = null;
    document.removeEventListener('click', onClientsCtxDocClick);
    document.removeEventListener('keydown', onClientsCtxKey);
    document.removeEventListener('scroll', closeClientsContextMenu, true);
  }

  function closeClientsCtxSub() {
    if (clientsCtxSubEl && clientsCtxSubEl.parentNode) clientsCtxSubEl.parentNode.removeChild(clientsCtxSubEl);
    clientsCtxSubEl = null;
    if (clientsCtxEl) {
      clientsCtxEl.querySelectorAll('[data-open]').forEach(function (el) {
        el.removeAttribute('data-open');
      });
    }
  }

  function onClientsCtxDocClick(e) {
    if (e.target.closest('.tma-portal-context-menu')) return;
    // The row's three-dots button opens this menu; let that click toggle
    // rather than close-and-miss.
    if (e.target.closest('[data-cip-row-menu]')) return;
    if (e.target.closest('[data-cip-status-chip]')) return;
    closeClientsContextMenu();
  }

  function onClientsCtxKey(e) {
    if (e.key === 'Escape') closeClientsContextMenu();
  }

  function openClientsContextMenu(kind, id, x, y, extra) {
    closeClientsContextMenu();
    extra = extra || {};
    var items = clientsContextItems(kind);

    clientsCtxEl = document.createElement('div');
    clientsCtxEl.className = 'tma-portal-context-menu';
    clientsCtxEl.setAttribute('role', 'menu');
    clientsCtxEl.innerHTML = items.map(ctxItemHtml).join('');
    document.body.appendChild(clientsCtxEl);
    placeCtxMenu(clientsCtxEl, x, y);

    clientsCtxEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-clients-ctx-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-clients-ctx-act');
      // The parent row only opens its submenu; it is not an action itself.
      if (act === 'assign') { openClientsAssignSub(btn, kind, id); return; }
      if (act === 'status') { openCipStatusSub(btn, kind, id, extra); return; }
      closeClientsContextMenu();
      runClientsContextAction(act, kind, id);
    });

    // Hovering the parent opens the list; hovering any other row closes it,
    // so two submenus can never be open at once.
    clientsCtxEl.addEventListener('mouseover', function (e) {
      var btn = e.target.closest('[data-clients-ctx-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-clients-ctx-act');
      if (act === 'assign') openClientsAssignSub(btn, kind, id);
      else if (act === 'status') openCipStatusSub(btn, kind, id, extra);
      else closeClientsCtxSub();
    });

    setTimeout(function () {
      document.addEventListener('click', onClientsCtxDocClick);
      document.addEventListener('keydown', onClientsCtxKey);
      document.addEventListener('scroll', closeClientsContextMenu, true);
    }, 0);
  }

  /* The people this record can be assigned to, fetched once per record and
     kept for the life of the menu session. */
  function loadAssignable(kind, id) {
    var key = kind + ':' + id;
    if (clientsAssignable[key]) return Promise.resolve(clientsAssignable[key]);
    var req = kind === 'company' ? CompanyStaffAPI.list(id) : ClientsAPI.assignments(id);
    return req.then(function (data) {
      clientsAssignable[key] = (data && data.assignable) || [];
      return clientsAssignable[key];
    });
  }

  /* Their real photo when they have one, their initial when they don't —
     the portal never invents a face (see staffAvatarHtml, same rule). */
  function ctxAvatarHtml(person) {
    if (person && person.avatar) {
      return '<img class="tma-portal-context-menu__avatar" src="' + esc(person.avatar) + '" alt="" width="20" height="20">';
    }
    var initial = String((person && person.name) || '?').charAt(0).toUpperCase();
    return '<span class="tma-portal-context-menu__avatar tma-dash__clients-avatar' +
      ' tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue">' + esc(initial) + '</span>';
  }

  function renderAssignSub(list) {
    if (!list.length) {
      return '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--static">' +
        '<span class="tma-portal-context-menu__label">Everyone is already assigned</span></div>';
    }
    return list.map(function (person) {
      return '<button type="button" role="menuitem" class="tma-portal-context-menu__item"' +
        ' data-clients-assign-to="' + esc(String(person.id)) + '">' +
        ctxAvatarHtml(person) +
        '<span class="tma-portal-context-menu__label">' + esc(person.name || person.email || 'Staff') + '</span>' +
        '</button>';
    }).join('');
  }

  function openClientsAssignSub(parentBtn, kind, id) {
    if (clientsCtxSubEl && parentBtn.hasAttribute('data-open')) return;
    closeClientsCtxSub();
    parentBtn.setAttribute('data-open', 'true');

    clientsCtxSubEl = document.createElement('div');
    clientsCtxSubEl.className = 'tma-portal-context-menu tma-portal-context-menu--sub';
    clientsCtxSubEl.setAttribute('role', 'menu');
    clientsCtxSubEl.innerHTML = '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--static">' +
      '<span class="tma-portal-context-menu__label">Loading…</span></div>';
    document.body.appendChild(clientsCtxSubEl);

    var rect = parentBtn.getBoundingClientRect();
    placeCtxMenu(clientsCtxSubEl, rect.right + 2, rect.top - 4);

    clientsCtxSubEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-clients-assign-to]');
      if (!btn) return;
      var userId = parseInt(btn.getAttribute('data-clients-assign-to'), 10);
      closeClientsContextMenu();
      assignFromContextMenu(kind, id, userId);
    });

    var sub = clientsCtxSubEl;
    loadAssignable(kind, id).then(function (list) {
      if (sub !== clientsCtxSubEl) return;
      sub.innerHTML = renderAssignSub(list);
      placeCtxMenu(sub, rect.right + 2, rect.top - 4);
    }).catch(function () {
      if (sub !== clientsCtxSubEl) return;
      sub.innerHTML = '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--static">' +
        '<span class="tma-portal-context-menu__label">Couldn\u2019t load staff</span></div>';
    });
  }

  function applicationRowById(id) {
    if (!id) return null;

    return (APP_TABLE.rows || []).filter(function (a) { return a.id === id; })[0] || null;
  }

  function applicationRowByClient(uid) {
    if (!uid) return null;

    return (APP_TABLE.rows || []).filter(function (a) { return a.clientUid === uid; })[0] || null;
  }

  function cipRowForMenu(extra, clientUid) {
    return applicationRowById(extra && extra.applicationId) || applicationRowByClient(clientUid);
  }

  function cipSourceFor(extra, clientUid) {
    return cipRowForMenu(extra, clientUid) || applicationFor(clientUid) || null;
  }

  function cipStatusMenu(extra, clientUid) {
    var source = cipSourceFor(extra, clientUid);
    var list = (APP_TABLE.statuses && APP_TABLE.statuses.length)
      ? APP_TABLE.statuses
      : CIP_STATUSES;

    return { list: list, current: source && source.status };
  }

  function renderCipStatusSub(list, current) {
    return list.map(function (status) {
      var on = status.value === current;
      var tone = status.tone || 'neutral';

      return '<button type="button" role="menuitem" class="tma-portal-context-menu__item"' +
        (on ? ' aria-current="true"' : '') +
        ' data-cip-status-to="' + esc(status.value) + '"' +
        ' data-cip-status-label="' + esc(status.label) + '">' +
        '<i class="tma-portal-cip__dot tma-portal-cip__dot--' + esc(tone) + '" aria-hidden="true"></i>' +
        '<span class="tma-portal-context-menu__label">' + esc(status.label) + '</span></button>';
    }).join('');
  }

  function openCipStatusSub(parentBtn, kind, id, extra) {
    if (clientsCtxSubEl && parentBtn.hasAttribute('data-open')) return;
    closeClientsCtxSub();
    parentBtn.setAttribute('data-open', 'true');

    var menu = cipStatusMenu(extra, id);

    clientsCtxSubEl = document.createElement('div');
    clientsCtxSubEl.className = 'tma-portal-context-menu tma-portal-context-menu--sub';
    clientsCtxSubEl.setAttribute('role', 'menu');
    clientsCtxSubEl.innerHTML = renderCipStatusSub(menu.list, menu.current);
    document.body.appendChild(clientsCtxSubEl);

    var rect = parentBtn.getBoundingClientRect();
    placeCtxMenu(clientsCtxSubEl, rect.right + 2, rect.top - 4);

    clientsCtxSubEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cip-status-to]');
      if (!btn) return;
      var to = btn.getAttribute('data-cip-status-to');
      var label = btn.getAttribute('data-cip-status-label') || to;
      closeClientsContextMenu();
      changeCipStatus(to, extra, id, label);
    });
  }

  function openCipStatusPicker(anchor, extra, clientUid) {
    closeClientsContextMenu();
    extra = extra || {};

    var menu = cipStatusMenu(extra, clientUid);
    clientsCtxEl = document.createElement('div');
    clientsCtxEl.className = 'tma-portal-context-menu';
    clientsCtxEl.setAttribute('role', 'menu');
    clientsCtxEl.innerHTML = renderCipStatusSub(menu.list, menu.current);
    document.body.appendChild(clientsCtxEl);

    var box = anchor.getBoundingClientRect();
    placeCtxMenu(clientsCtxEl, box.left, box.bottom + 4);

    clientsCtxEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cip-status-to]');
      if (!btn) return;
      var to = btn.getAttribute('data-cip-status-to');
      var label = btn.getAttribute('data-cip-status-label') || to;
      closeClientsContextMenu();
      changeCipStatus(to, extra, clientUid, label);
    });

    setTimeout(function () {
      document.addEventListener('click', onClientsCtxDocClick);
      document.addEventListener('keydown', onClientsCtxKey);
      document.addEventListener('scroll', closeClientsContextMenu, true);
    }, 0);
  }

  function refreshAfterCipMove(clientUid) {
    forgetApplicationTable();
    forgetBuckets();
    if (clientUid) {
      forgetApplication(clientUid);
      delete TIMELINE[clientUid];
    }
    if (clientsMenuCtx && clientsMenuCtx.render) clientsMenuCtx.render({ forceFull: true });
    else repaintClients();
  }

  function changeCipStatus(to, extra, clientUid, label) {
    var source = cipSourceFor(extra, clientUid);
    var applicationId = (extra && extra.applicationId) || (source && source.id);
    if (!applicationId) {
      clientsToast('Could not find this application.', 'negative');

      return;
    }

    var ctx = clientsMenuCtx;
    var state = (ctx && ctx.state) || clientsMountState;
    var render = (ctx && ctx.render) || repaintClients;

    if (source && source.status === to) return;

    if (to === 'pending_review' && source && source.status === 'ready_to_submit') {
      if (!state) return;
      openSubmissionDialog(state, render, false, source || { id: applicationId, clientUid: clientUid });

      return;
    }

    if (to === 'granted' || to === 'denied') {
      openDecisionDialog(applicationId, clientUid, to);

      return;
    }

    if (to === 'non_compliant') {
      openQueryDialog(applicationId, clientUid);

      return;
    }

    if (to === 'background_check') {
      openAcceptanceDialog(applicationId, clientUid);

      return;
    }

    var leftoverDraft = to === 'new' && source && source.status === 'draft';
    var url = '/portal/cip/applications/' + encodeURIComponent(applicationId) +
      (leftoverDraft ? '/submit' : '/status');

    clientsFetch(url, leftoverDraft ? { method: 'POST' } : { method: 'POST', json: { status: to } })
      .then(function () {
        clientsToast('Moved to ' + (label || 'the next status'), 'positive');
        refreshAfterCipMove(clientUid);
      })
      .catch(function (err) {
        clientsToast((err && err.message) || 'Could not change the status.', 'negative');
      });
  }

  /*
   * §18: the day the Unit asked, which is what moves the file to Non-compliant.
   *
   * The date is asked for rather than assumed. Staff record a query after the
   * fact as often as on the day, and quietly stamping today would put the
   * wrong date on an audit trail nobody would think to check.
   */
  function openQueryDialog(applicationId, clientUid) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) return;

    var today = new Date().toISOString().slice(0, 10);

    ui.openModal({
      title: 'Record query received',
      body:
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="cip-query-received">Query received date</label>' +
        '<input type="date" id="cip-query-received" class="tma-dash__clients-field-input"' +
        ' data-cip-query-received value="' + esc(today) + '">' +
        '</div>' +
        '<p class="tma-portal-modal__text">' +
        'The application will move to Non-compliant. Response documents go in Additional Documents.</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel-query>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-cip-save-query>Record query</button>' +
        '</div>',
      onMount: function (el) {
        var cancel = el.querySelector('[data-cip-cancel-query]');
        if (cancel) cancel.addEventListener('click', function () { ui.closeModal(); });

        var save = el.querySelector('[data-cip-save-query]');
        if (!save) return;

        save.addEventListener('click', function () {
          var dateEl = el.querySelector('[data-cip-query-received]');
          var date = dateEl && dateEl.value;
          if (!date) {
            clientsToast('Enter the query received date.', 'negative');
            return;
          }

          save.disabled = true;
          save.textContent = 'Recording…';

          clientsFetch('/portal/cip/applications/' + encodeURIComponent(applicationId) + '/query', {
            method: 'POST',
            json: { queryReceivedAt: date },
          })
            .then(function () {
              ui.closeModal();
              clientsToast('Query recorded, the file is non-compliant.', 'positive');
              refreshAfterCipMove(clientUid);
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = 'Record query';
              clientsToast((err && err.message) || 'Could not record this query.', 'negative');
            });
        });
      },
    });
  }

  /*
   * §19: the day the Unit accepted the file, which is what moves it to
   * Background check. Asked for rather than assumed, staff record it after
   * the fact as often as on the day.
   */
  function openAcceptanceDialog(applicationId, clientUid) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) return;

    var today = new Date().toISOString().slice(0, 10);

    ui.openModal({
      title: 'Record accepted for processing',
      body:
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="cip-accepted">Accepted for processing date</label>' +
        '<input type="date" id="cip-accepted" class="tma-dash__clients-field-input"' +
        ' data-cip-accepted value="' + esc(today) + '">' +
        '</div>' +
        '<p class="tma-portal-modal__text">' +
        'The application will move to Background check.</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel-accept>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-cip-save-accept>Record acceptance</button>' +
        '</div>',
      onMount: function (el) {
        var cancel = el.querySelector('[data-cip-cancel-accept]');
        if (cancel) cancel.addEventListener('click', function () { ui.closeModal(); });

        var save = el.querySelector('[data-cip-save-accept]');
        if (!save) return;

        save.addEventListener('click', function () {
          var dateEl = el.querySelector('[data-cip-accepted]');
          var date = dateEl && dateEl.value;
          if (!date) {
            clientsToast('Enter the accepted for processing date.', 'negative');
            return;
          }

          save.disabled = true;
          save.textContent = 'Recording…';

          clientsFetch('/portal/cip/applications/' + encodeURIComponent(applicationId) + '/acceptance', {
            method: 'POST',
            json: { acceptedAt: date },
          })
            .then(function () {
              ui.closeModal();
              clientsToast('Accepted for processing, the file is in background check.', 'positive');
              refreshAfterCipMove(clientUid);
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = 'Record acceptance';
              clientsToast((err && err.message) || 'Could not record this acceptance.', 'negative');
            });
        });
      },
    });
  }

  function openDecisionDialog(applicationId, clientUid, decision) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) return;

    var today = new Date().toISOString().slice(0, 10);
    var chosen = decision === 'granted' || decision === 'denied' ? decision : '';
    var picking = !chosen;

    var typeField = picking
      ?         '<div class="tma-dash__clients-field">' +
        '<span class="tma-dash__clients-field-label">Decision type</span>' +
        '<div class="tma-portal-radio-row">' +
        '<label class="tma-portal-radio"><input type="radio" name="cip-decision-type" value="granted" data-cip-decision-type>' +
        '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Approved</label>' +
        '<label class="tma-portal-radio"><input type="radio" name="cip-decision-type" value="denied" data-cip-decision-type>' +
        '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Denied</label>' +
        '</div></div>'
      : '';

    ui.openModal({
      title: picking ? 'Record decision' : (chosen === 'granted' ? 'Record approval' : 'Record denial'),
      body:
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="cip-decided">Decision date</label>' +
        '<input type="date" id="cip-decided" class="tma-dash__clients-field-input"' +
        ' data-cip-decided value="' + esc(today) + '">' +
        '</div>' +
        typeField +
        '<p class="tma-portal-modal__text">' +
        (picking
          ? 'The application will move to Approved or Denied. This cannot be undone from here.'
          : (chosen === 'granted'
            ? 'The application will move to Approved. This cannot be undone from here.'
            : 'The application will move to Denied. This cannot be undone from here.')) +
        '</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel-decision>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-cip-save-decision>Record decision</button>' +
        '</div>',
      onMount: function (el) {
        var cancel = el.querySelector('[data-cip-cancel-decision]');
        if (cancel) cancel.addEventListener('click', function () { ui.closeModal(); });

        var save = el.querySelector('[data-cip-save-decision]');
        if (!save) return;

        save.addEventListener('click', function () {
          var dateEl = el.querySelector('[data-cip-decided]');
          var date = dateEl && dateEl.value;
          if (!date) {
            clientsToast('Enter the decision date.', 'negative');
            return;
          }

          var picked = chosen;
          if (picking) {
            var typeEl = el.querySelector('[data-cip-decision-type]:checked');
            picked = typeEl ? typeEl.value : '';
          }
          if (picked !== 'granted' && picked !== 'denied') {
            clientsToast('Choose Approved or Denied.', 'negative');
            return;
          }

          save.disabled = true;
          save.textContent = 'Recording…';

          clientsFetch('/portal/cip/applications/' + encodeURIComponent(applicationId) + '/decision', {
            method: 'POST',
            json: { decision: picked, decidedAt: date },
          })
            .then(function () {
              ui.closeModal();
              clientsToast(picked === 'granted' ? 'Recorded as Approved' : 'Recorded as Denied', 'positive');
              refreshAfterCipMove(clientUid);
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = 'Record decision';
              clientsToast((err && err.message) || 'Could not record the decision.', 'negative');
            });
        });
      },
    });
  }

  function assignFromContextMenu(kind, id, userId) {
    if (!userId) return;
    var key = kind + ':' + id;
    var req = kind === 'company'
      ? CompanyStaffAPI.assign(id, { userId: userId, level: 'editor', appliesToClients: 'company_only' })
      : ClientsAPI.assign(id, { userId: userId, level: 'editor' });

    req.then(function () {
      delete clientsAssignable[key];
      clientsToast('Staff assigned', 'positive');
      if (!clientsMenuCtx) return;
      // The panels cache what they loaded; a render alone would redraw the
      // same stale list the assignment was just added to.
      var state = clientsMenuCtx.state;
      if (kind === 'company') {
        state.companyPanelsFor = null;
        ensureCompanyPanelsLoaded(state, clientsMenuCtx.render);
      } else {
        state.assignmentsLoadedFor = null;
        ensureAssignmentsLoaded(state, clientsMenuCtx.render, { force: true });
      }
      clientsMenuCtx.render({ forceFull: true });
    }).catch(function (err) {
      clientsToast((err && err.message) || 'Could not assign staff', 'negative');
    });
  }

  function runClientsContextAction(act, kind, id) {
    var ctx = clientsMenuCtx;
    if (!ctx) return;
    var state = ctx.state;
    var navigate = ctx.navigate;

    /*
     * An application row is addressed by its client for everything except the
     * edit, which belongs to the application. Opening, assigning and deleting
     * are all questions about the person the application is for, and the hub
     * already answers them, this only says which record is being pointed at.
     */
    if (kind === 'application') {
      if (act === 'edit') {
        var row = (APP_TABLE.rows || []).filter(function (a) { return a.clientUid === id; })[0];
        if (row) {
          state.selectedId = id;

          return navigate('edit-application', null, { applicationId: row.id });
        }
      }
      kind = 'client';
    }

    if (kind === 'company') {
      if (act === 'open') return navigate('company', null, { companyId: id });
      if (act === 'edit') return navigate('edit-company', null, { companyId: id });
      if (act === 'add-person') {
        state.prefillCompanyId = id;
        return navigate('add');
      }
      if (act === 'delete') {
        resolveCompany(id).then(function (company) {
          if (!company) { clientsToast('Could not open this service provider', 'negative'); return; }
          confirmCompanyDelete(company, function (withPeople) {
          CompaniesAPI.remove(id, withPeople).then(function () {
            COMPANIES = COMPANIES.filter(function (c) { return c.id !== id; });
            hydrateCompanies(COMPANIES);
            clientsToast('Service provider deleted', 'positive');
            if (state.companyId === id) navigate('list');
            else ctx.render({ forceFull: true });
          }).catch(function (err) {
            clientsToast((err && err.message) || 'Could not delete this service provider', 'negative');
          });
          });
        });
        return;
      }
      return;
    }

    if (act === 'open') {
      state.profileTab = 'info';
      return navigate('detail', id);
    }
    if (act === 'edit') return navigate('edit', id);
    if (act === 'delete') {
      var item = directoryItemFor(id);
      var name = (item && item.name) || 'this client';
      if (!window.confirm('Delete ' + name + '?')) return;
      deleteDirectoryKeys(state, ctx.render, [id]);
    }
  }

  function wireTableFilters(root, state, render) {
    clientsFilterCtx = { root: root, state: state, render: render };
    ensureClientsPopovers();

    /*
     * One dropdown per field, each anchored to its own button in the toolbar.
     *
     * They share the single popover element rather than owning one each: only
     * one can be open at a time, so a second element would only be a second
     * thing to keep positioned and closed. The field it is currently showing
     * is recorded on it, which is how pressing the same button twice knows to
     * shut rather than refill.
     */
    MORPH.unwired(root, '[data-cip-dropdown]').forEach(function (btn) {
      MORPH.on(btn, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var field = btn.getAttribute('data-cip-dropdown');
        var open = clientsPop.fields.hasAttribute('data-open');

        if (open && clientsPop.fields.getAttribute('data-cip-field') === field) {
          closeClientsPopovers();
          return;
        }

        clientsPop.fields.setAttribute('data-cip-field', field);
        fillFilterField(field);
        openClientsPopover(clientsPop.fields, btn);
      });
    });

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
        var sorts = onPeopleTab(state)
          ? CLIENT_SORTS.filter(function (s) { return s.value !== 'type'; })
          : CLIENT_SORTS;
        clientsPop.sort.innerHTML = sorts.map(function (s) {
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
        if (removeTableFilter(id)) applyTableFilters();
      });
    });

    var reset = MORPH.unwiredOne(root, '[data-clients-reset-filters]');
    if (reset) {
      MORPH.on(reset, 'click', function () {
        state.filters = emptyClientFilters();
        state.sort = 'name';
        state.page = 1;
        state.selected = {};
        // The three table filters sit in the same bar under the same Reset, so
        // leaving any of them applied would be a chip the button does not
        // clear.
        clearTableFilters();
        APP_TABLE.page = 1;
        syncClientsListUrl(state);
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
    state.selected = {};
    state.page = 1;
    deleteDirectoryKeys(state, render, keys);
  }

  /* Records leave the table at once and come back if the server refuses —
     the row a reader just deleted lingering for a round trip reads as the
     click not having landed. */
  function deleteDirectoryKeys(state, render, keys) {
    if (!keys.length) return;
    state.removedIds = state.removedIds || {};
    keys.forEach(function (key) { state.removedIds[key] = true; });
    render({ forceFull: true });
    var companyKeys = keys.filter(function (k) { return k.indexOf('company:') === 0; });
    var clientKeys = keys.filter(function (k) { return k.indexOf('company:') !== 0; });

    Promise.all([
      clientKeys.length ? ClientsAPI.bulkRemove(clientKeys) : Promise.resolve(),
      Promise.all(companyKeys.map(function (k) {
        return CompaniesAPI.remove(k.slice('company:'.length));
      })),
    ]).then(function () {
      if (companyKeys.length) {
        COMPANIES = COMPANIES.filter(function (c) {
          return companyKeys.indexOf('company:' + c.id) === -1;
        });
        hydrateCompanies(COMPANIES);
      }
      clientsToast(keys.length > 1 ? keys.length + ' records removed' : 'Record removed', 'positive');
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
        state.applicationFreshFor = null;
        ensureProfileLoaded(state, render);
        ensureApplicationLoaded(state, render);
        render({ detailOnly: !usesPagedClientsFlow(state) });
      });
    });

    MORPH.unwired(root, '[data-no-data-action="add"]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        navigate(onProvidersTab(state) ? 'add-company' : 'add');
      });
    });
  }

  /*
   * Switching tabs.
   *
   * Selection and the page number are dropped on the way: they refer to rows
   * that are no longer on screen, and carrying them over means landing on
   * page 4 of a list with two entries, or deleting a client the reader can no
   * longer see is ticked. Arrow keys move between tabs, which is what a
   * tablist is expected to do.
   */
  function wireListTabs(root, state, render) {
    var tabs = MORPH.unwired(root, '[data-clients-list-tab]');
    if (!tabs.length) return;

    var select = function (id) {
      if (state.listTab === id) return;
      state.listTab = id;
      saveListTab(id);
      state.page = 1;
      state.selected = {};
      render();
    };

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        select(tab.getAttribute('data-clients-list-tab'));
      });

      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;

        e.preventDefault();
        select(tabs[next].getAttribute('data-clients-list-tab'));
        var moved = root.querySelector('[data-clients-list-tab="' +
          tabs[next].getAttribute('data-clients-list-tab') + '"]');
        if (moved && moved.focus) moved.focus();
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
   * ever, change the page size or turn a page and ticking it set `checked`
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
   * every keystroke; this fills in what the browser cannot see, nicknames, job
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
    // §8's table pages on the server, so a new term is a new first page.
    APP_TABLE.page = 1;
    /*
     * The full-width list repaints whole.
     *
     * It was found by looking for the grid's own body, which the application
     * table does not have, so typing in the search box refreshed the client
     * grid and left the application table showing the results of the term
     * before it. Either table on screen means this is that view.
     */
    var fullTable = root.querySelector('[data-clients-body]') || root.querySelector('.tma-cip-table');
    if (fullTable && state.viewMode === 'list') {
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
    'clienthub-access': { title: 'Access' },
    'service-teams': { title: 'Service teams' },
    'custom-fields': { title: 'Custom fields' },
    'cip-documents': { title: 'Document requirements' },
    'cip-letters': { title: 'Granted and Denied letters' },
  };

  function navigateToClientsAdminPage(adminPage) {
    var meta = CLIENTS_ADMIN_PAGES[adminPage];
    if (!meta || !canManageClientHub()) return;
    if (!window.TMADashboard || !window.TMADashboard.navigate) return;
    window.TMADashboard.navigate({
      navId: 'account-settings',
      view: 'admin',
      title: meta.title,
      crumb: 'Account settings / CIP Console / ' + meta.title,
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
        clientsHeadActionsNavigate('new-application');
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


  /* The application form's Cancel and Add sit in the page head, which is
     rendered outside this view's mount, so they are delegated once rather
     than bound on every render. */
  var cipToolbarWired = false;

  function wireCipToolbar(navigate) {
    if (cipToolbarWired) return;
    cipToolbarWired = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-cip-save]')) {
        e.preventDefault();
        if (window.TMACipIntake) window.TMACipIntake.submit();
        return;
      }
      if (e.target.closest('[data-cip-cancel]')) {
        e.preventDefault();
        // Cancel goes where Back goes. Abandoning an edit and finishing one
        // both leave you where you started, or the safer of the two answers
        // is the one that loses your place.
        var owner = clientsMountState && backDestination(clientsMountState);
        if (owner) navigate('detail', owner);
        else navigate('list');
      }
    });
  }

  function wireEvents(root, state, scope, navigate, render) {
    wireCipToolbar(navigate);
    // The shared person card: the hover that names the faces in Assigned to.
    // Once, on the document, like the board it is borrowed from.
    if (window.TMAPersonCard && window.TMAPersonCard.wire) window.TMAPersonCard.wire();
    wireApplicationTable(root, state, navigate, render);
    // Asked for at paint rather than on navigation: the table is drawn from
    // whatever the search box and the page buttons currently say, and those
    // change without a route change.
    if (onApplicationsTable(state)) {
      /*
       * The bucket a link asked for, claimed at the first paint of the table
       * it filters, and claimed before the request below goes out, or the
       * reader would be sent the whole list and watch it narrow under them a
       * moment later.
       */
      ['bucket', 'assignee', 'provider'].forEach(function (field) {
        var booted = takeBootPosition(field);
        if (!booted) return;
        // A comma-separated list, the way it was written into the address.
        // Blanks dropped: "a,,b" is what a hand-edited URL looks like, and an
        // empty term would become a filter matching nothing.
        TABLE_FILTERS[field] = String(booted).split(',')
          .map(function (v) { return v.trim(); })
          .filter(Boolean);
      });

      var bootedSort = takeBootPosition('sort');
      if (bootedSort && CIP_SORTS[bootedSort]) APP_TABLE.sort = bootedSort;
      var bootedDir = takeBootPosition('dir');
      if (bootedDir === 'asc' || bootedDir === 'desc') APP_TABLE.dir = bootedDir;

      // The Dashboard's CIP card sets the filter from outside this view, and
      // cannot write an address for a screen that has not mounted yet, so
      // the address is settled here, where it only writes when the two
      // actually disagree.
      syncClientsListUrl(state);

      ensureBuckets(render);
      ensureApplicationTable(state, render);
    }
    // The intake wizard owns its own subtree once mounted; re-mounting on a
    // re-render would wipe a half-typed application.
    var intakeMount = root.querySelector('[data-cip-intake-mount]');
    if (intakeMount && !intakeMount.querySelector('[data-cip-wizard]')) intakeMount._cipMounted = false;
    if (intakeMount && !intakeMount._cipMounted && window.TMACipIntake) {
      intakeMount._cipMounted = true;
      var editing = state.screen === 'edit-application';
      window.TMACipIntake.open(intakeMount, {
        applicationId: editing ? state.applicationId : null,
        onSaving: function (saving) {
          var btn = document.querySelector('[data-cip-save]');
          if (!btn) return;
          btn.disabled = !!saving;
          btn.textContent = saving
            ? (editing ? 'Saving…' : 'Adding…')
            : (editing ? 'Save' : 'Add');
        },
        onDone: function (application, meta) {
          /*
           * A parked save is a different sentence.
           *
           * "Saved" would be true of the device and false of the firm, and a
           * reader who took it the second way would close the laptop on work
           * nobody else can see yet. So the toast says where it is, and the
           * record it hands back, the answers laid over the filed copy, is
           * held locally so the profile behind them shows what they typed.
           */
          if (meta && meta.queued) {
            if (application) rememberApplication(state.selectedId, application);
            clientsToast(editing
              ? 'Saved on this device, it will sync when you’re back online'
              : 'Saved on this device, it will be filed when you’re back online',
            'warning');
            navigate('list');

            return;
          }

          if (application) {
            // Held as well as announced: the record the server just returned
            // is the newest there is, and refetching it would be asking for
            // what is already in hand.
            rememberApplication(state.selectedId, application);
            // The list refetches itself from the live signal the write raised.
            clientsToast('Application ' + application.number +
              (editing ? ' saved' : ' created'), 'positive');
          }
          navigate('list');
        },
      });
    }

    // Rows appear in the directory, table list, and company people lists.
    wireDirectoryRows(root, state, navigate);
    wireRowContextMenus(root, state, navigate, render);
    wireSeeAllReferred(root, state, navigate);
    // Empty and failed states show in every view, so this is wired before the
    // per-view branches below, several of which return early.
    wireClientsRecovery(root, state, render, navigate);

    if (scope === 'list') {
      wireSearchEvents(root, state);

      // A layout button left in any markup has nothing to switch to.
      MORPH.unwired(root, '[data-clients-layout]').forEach(function (btn) {
        btn.remove();
      });

      if (scope === 'list') {
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
        var owner = backDestination(state);
        if (owner) navigate('detail', owner);
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

    var editAppBtn = unwiredClientsChrome(root, '[data-clients-edit-application]');
    if (editAppBtn) {
      editAppBtn.addEventListener('click', function () {
        var app = applicationFor(state.selectedId);
        if (!app) return;
        // Dropped so the profile re-reads it after the save, rather than
        // showing the answers the reader has just changed.
        delete APPLICATIONS[state.selectedId];
        forgetApplication(state.selectedId);
        navigate('edit-application', null, { applicationId: app.id });
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
      var title = state.adding ? 'New application' : 'Edit application';
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
      messageBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.messageMenuOpen = !state.messageMenuOpen;
        if (state.messageMenuOpen) ensureConversationsLoaded(state, render, { quiet: true });
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    }

    unwiredAllClientsChrome(root, '[data-clients-message-with]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeClientMessageMenu(root);
        openApplicantConversation(state, render, item.getAttribute('data-clients-message-with'));
      });
    });

    wireClientMessageMenuCloser();

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

    var deleteCompanyBtn = unwiredClientsChrome(root, '[data-clients-delete-company]');
    if (deleteCompanyBtn) {
      deleteCompanyBtn.addEventListener('click', function () {
        var company = companyFor(state.companyId);
        if (!company) return;
        confirmCompanyDelete(company, function (withPeople) {
        deleteCompanyBtn.disabled = true;
        CompaniesAPI.remove(state.companyId, withPeople).then(function () {
          COMPANIES = COMPANIES.filter(function (c) { return c.id !== state.companyId; });
          hydrateCompanies(COMPANIES);
          clientsToast('Service provider deleted', 'positive');
          navigate('list');
        }).catch(function (err) {
          deleteCompanyBtn.disabled = false;
          clientsToast((err && err.message) || 'Could not delete this service provider', 'negative');
        });
        });
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

    wireStaffPickers(root, state);

    var assignSubmit = MORPH.unwiredOne(root, '[data-clients-assign-submit]');
    if (assignSubmit) {
      assignSubmit.addEventListener('click', function () {
        var userSel = root.querySelector('[data-clients-assign-user]');
        var userId = userSel && userSel.value ? parseInt(userSel.value, 10) : 0;
        if (!userId) {
          clientsToast('Choose a staff member to assign', 'negative');
          return;
        }
        ClientsAPI.assign(state.selectedId, {
          userId: userId,
          // Everyone starts as Editor; the row's own controls change it.
          level: 'editor',
        }).then(function (res) {
          state.assignments = (res && res.assignments) || [];
          // Chosen and gone: they are on the list now, not in the picker.
          state.assignPick = '';
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
        var email = emailEl && emailEl.value ? emailEl.value.trim() : '';
        if (!email) {
          clientsToast('Enter an email address', 'negative');
          return;
        }
        memberAdd.disabled = true;
        CompanyMembersAPI.add(state.companyId, {
          email: email,
          // Everyone joins as a member; the row's controls change it after.
          role: 'member',
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
            // Everyone starts as Editor; the row's controls change it after.
            level: 'editor',
            appliesToClients: scope,
          }).then(function () {
            // Chosen and gone: they are on the list now, not in the picker.
            state.companyStaffPick = '';
            clientsToast('Staff assigned', 'positive');
            refreshCompanyPanels();
          }).catch(function (err) {
            staffAdd.disabled = false;
            clientsToast((err && err.message) || 'Could not assign staff', 'negative');
          });
        };

        // Anything wider than the company itself is confirmed against what it
        // will actually cover, the spec forbids granting broad access without
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
          // Preview unavailable, ask plainly rather than assigning silently.
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
    // one, which is the case staff actually hit ("they never got the email").
    var inviteToolbar = MORPH.unwiredOne(root, '[data-clients-invite-toolbar]');
    if (inviteToolbar) {
      inviteToolbar.addEventListener('click', function () {
        inviteToolbar.disabled = true;
        ClientsAPI.invite(state.selectedId).then(function (res) {
          applyInvitation(res);
          clientsToast(
            res && res.reminder
              ? 'Invitation resent, the previous link no longer works'
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
          clientsToast('Invitation resent, the previous link no longer works', 'positive');
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
            clientsToast('Link copied, it replaces any link already sent', 'positive');
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
        syncClientsDetailUrl(state);
        if (state.profileTab === 'assigned' && state.selectedId) {
          ensureAssignmentsLoaded(state, render);
        }
        if (state.profileTab === 'access' && state.selectedId) {
          ensureAccessLoaded(state, render);
        }
        if (state.profileTab === 'activity' && state.selectedId) {
          ensureTimeline(state, render);
        }
        if (state.profileTab === 'messages' && state.selectedId) {
          ensureConversationsLoaded(state, render);
        }
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });

    MORPH.unwired(root, '[data-clients-open-thread]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var id = btn.getAttribute('data-clients-open-thread');
        var rows = state.conversations || [];
        var row = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].id === id) { row = rows[i]; break; }
        }
        // Join (or reuse) through the same endpoint as the Message button so
        // an officer who has not yet been added to the case thread still
        // lands inside it rather than on a 404 in Messages.
        if (row && (row.subject === 'provider' || row.subject === 'person')) {
          openApplicantConversation(state, render, row.subject);
          return;
        }
        if (!id || !window.TMADashboard || !window.TMADashboard.navigate) return;
        window.TMADashboard.navigate({
          navId: 'so-messages',
          view: 'messages',
          title: 'Messages',
          crumb: 'Messages',
          openConversationId: id,
        });
      });
    });

    MORPH.unwired(root, '[data-clients-open-recording]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var id = btn.getAttribute('data-clients-open-recording');
        var rows = state.recordings || [];
        var rec = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].id === id) { rec = rows[i]; break; }
        }
        openClientRecording(rec);
      });
    });

    MORPH.unwired(root, '[data-cip-confirm]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () { openConfirmSubmissionDialog(state, render); });
    });

    MORPH.unwired(root, '[data-cip-submit]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () { openSubmissionDialog(state, render, false); });
    });

    MORPH.unwired(root, '[data-cip-query]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var app = applicationFor(state.selectedId);
        if (!app) return;
        openQueryDialog(app.id, app.clientUid);
      });
    });

    MORPH.unwired(root, '[data-cip-accept]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var app = applicationFor(state.selectedId);
        if (!app) return;
        openAcceptanceDialog(app.id, app.clientUid);
      });
    });

    MORPH.unwired(root, '[data-cip-decide]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var app = applicationFor(state.selectedId);
        if (!app) return;
        openDecisionDialog(app.id, app.clientUid);
      });
    });

    var fixNumberBtn = unwiredClientsChrome(root, '[data-cip-fix-number]');
    if (fixNumberBtn) {
      MORPH.on(fixNumberBtn, 'click', function () { openSubmissionDialog(state, render, true); });
    }

    MORPH.unwired(root, '[data-cip-photo]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        openCipPhoto(state, btn.getAttribute('data-cip-photo'), render);
      });
    });

    MORPH.unwired(root, '[data-cip-file]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        openCipFile(state, btn.getAttribute('data-cip-file'), render);
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
  /*
   * The application behind a client, fetched once.
   *
   * Its own function, and its own guard, because the profile has one too, it
   * returns early for a client whose record is already cached, and while this
   * lived inside that function a second visit never asked for the application
   * at all. The tabs then fell back to the hub's contact record and the
   * profile went back to saying "Client info", which is exactly what it does
   * for a client that has no application. The two are different questions and
   * one being answered must not decide whether the other is asked.
   */
  function ensureApplicationLoaded(state, render) {
    var id = state.selectedId;
    if (!id) return;
    if (state.applicationLoadingFor === id) return;
    if (state.applicationFreshFor === id) return;

    state.applicationLoadingFor = id;

    var url = '/portal/cip/clients/' + encodeURIComponent(id) + '/application';

    /*
     * The application decides which tabs this profile even has, so until it
     * lands the screen shows a client that is not the one it is about to show.
     * Painted from the store first, which on a second visit means the right
     * tabs on the first frame.
     *
     * Always revalidated: document-requirement settings can grow the
     * checklist after this profile was last opened, and a cache that skipped
     * the request kept showing the original three documents.
     */
    var paint = function (json, meta) {
      APPLICATIONS[id] = (json && json.application) || null;
      if (state.selectedId !== id) return;
      if (!meta || !meta.stale) state.applicationFreshFor = id;
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    };

    var request = window.TMAStore
      ? window.TMAStore.swr(applicationCacheKey(id), function () { return clientsFetch(url); }, paint)
      : clientsFetch(url).then(paint);

    request
      .catch(function () { paint(null); })
      .then(function () {
        if (state.applicationLoadingFor === id) state.applicationLoadingFor = null;
      });
  }

  function applicationCacheKey(clientId) {
    return 'cip:application:' + clientId;
  }

  /* Drop the held copy as well as the in-page one. Both exist: the object
     above survives a tab change, the store survives a reload, and an edit has
     to outlive both or the reader is shown what they just replaced. */
  function forgetApplication(clientId) {
    if (window.TMAStore && clientId) window.TMAStore.invalidate(applicationCacheKey(clientId));
  }

  /*
   * Put a record in both places an application is remembered.
   *
   * Written after a save rather than forgetting and refetching: the answer
   * the write returned is newer than anything a refetch could bring back,
   * and offline there is no refetch to make. The same call carries an
   * optimistic record with `pendingSync` on it, which is what lets the
   * profile show a queued edit.
   */
  function rememberApplication(clientId, record) {
    if (!clientId || record === undefined) return;
    APPLICATIONS[clientId] = record;
    if (window.TMAStore) {
      window.TMAStore.put(applicationCacheKey(clientId), { application: record });
    }
  }

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
      // An empty profile is a real answer, most imported clients have one —
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

      /*
       * The server said something, a 404, a 500, and that answer stands.
       * The replica only speaks when nothing answered at all: err.status is
       * unset exactly when fetch itself rejected, which is the offline case,
       * and on the desktop the record layer clients-sync.js filled may hold
       * the whole profile of a client nobody ever clicked while connected.
       */
      var offline = !(err && err.status);
      var recovered = offline && window.TMAStore && window.TMAStore.persistent
        ? window.TMAStore.get('clients:record:' + id)
        : Promise.resolve(undefined);

      Promise.resolve(recovered).then(function (rec) {
        if (stale()) return;
        state.profileLoadingFor = null;

        if (rec && !rec.deleted) {
          rememberProfile(id, rec.profile || {});
          rememberMeta(rec);
          if (state.screen === 'edit' && state.selectedId === id && !state.draft) {
            state.draft = contactToDraft(contactFor(id));
          }
          redraw();

          return;
        }

        // Deliberately not marked loaded: leaving it unfetched is what lets
        // reopening the client try again.
        //
        // Our own sentence rather than err.message, which for a 500 is the
        // fetch layer's "Request failed", true, and no use to the person
        // looking at an empty panel. The real error is in the console.
        // A 404 is not a failure: the record is outside this account's slice
        // (or does not exist, the server deliberately will not say which).
        if (err && err.status === 404) {
          state.profileError = 'You’re not assigned to this client.';
          state.profileErrorFinal = true;
        } else {
          state.profileError = 'Couldn’t load this client.';
          state.profileErrorFinal = false;
        }
        redraw();
      });
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
   * this is called from applyScreen, which is still setting the screen up, the
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

  function closeClientMessageMenu(root) {
    if (clientsMountState) clientsMountState.messageMenuOpen = false;
    var scope = root || document;
    scope.querySelectorAll('[data-clients-message-menu]').forEach(function (menu) {
      menu.hidden = true;
    });
    scope.querySelectorAll('[data-clients-message]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
    var head = typeof clientsDetailHeadRoot === 'function' ? clientsDetailHeadRoot() : null;
    if (head && head !== scope) {
      head.querySelectorAll('[data-clients-message-menu]').forEach(function (menu) {
        menu.hidden = true;
      });
      head.querySelectorAll('[data-clients-message]').forEach(function (btn) {
        btn.setAttribute('aria-expanded', 'false');
      });
    }
  }

  var clientMessageMenuWired = false;
  function wireClientMessageMenuCloser() {
    if (clientMessageMenuWired) return;
    clientMessageMenuWired = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-clients-message-wrap]')) return;
      closeClientMessageMenu(document);
    });
  }

  function ensureConversationsLoaded(state, render, opts) {
    if (!state.selectedId) return;
    if (state.conversationsLoadedFor === state.selectedId) return;
    state.conversationsLoading = true;
    state.conversationsLoadedFor = state.selectedId;
    if (opts && opts.quiet) { /* no redraw yet */ }
    else if (usesPagedClientsFlow(state)) render();
    else render({ detailOnly: true });

    ClientsAPI.conversations(state.selectedId).then(function (data) {
      if (state.conversationsLoadedFor !== state.selectedId) return;
      state.conversations = (data && data.conversations) || [];
      state.conversationOptions = (data && data.options) || null;
      state.recordings = (data && data.recordings) || [];
      state.conversationsLoading = false;
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    }).catch(function () {
      if (state.conversationsLoadedFor !== state.selectedId) return;
      state.conversations = [];
      state.conversationOptions = state.conversationOptions || {
        provider: { available: false, reason: 'Could not load messaging options.' },
        person: { available: false },
      };
      state.recordings = [];
      state.conversationsLoading = false;
      if (usesPagedClientsFlow(state)) render();
      else render({ detailOnly: true });
    });
  }

  function openApplicantConversation(state, render, withWhom) {
    if (!state.selectedId || !withWhom) return;
    ClientsAPI.openConversation(state.selectedId, withWhom).then(function (data) {
      var conversation = data && data.conversation;
      state.conversationsLoadedFor = null;
      ensureConversationsLoaded(state, render, { quiet: true });
      if (!conversation || !window.TMADashboard || !window.TMADashboard.navigate) {
        clientsToast('Conversation could not be opened', 'negative');
        return;
      }
      window.TMADashboard.navigate({
        navId: 'so-messages',
        view: 'messages',
        title: 'Messages',
        crumb: 'Messages',
        openConversationId: conversation.id,
      });
    }).catch(function (err) {
      var msg = (err && err.data && err.data.message) || (err && err.message) || 'Conversation could not be opened';
      if (err && err.data && err.data.errors && err.data.errors.with) {
        msg = err.data.errors.with[0] || msg;
      }
      clientsToast(msg, 'negative');
    });
  }

  function openClientRecording(recording) {
    if (!recording) return;
    var ui = window.TMAPortalUI;
    var root = window.__TMA_SITE_ROOT || '';
    var mediaUrl = root + '/portal/call-recordings/' + encodeURIComponent(recording.id) + '/media';
    var player = '';
    if (recording.status === 'ready') {
      player = recording.media === 'video'
        ? '<video class="call-recordings__player" src="' + esc(mediaUrl) + '" controls preload="metadata"></video>'
        : '<audio class="call-recordings__player" src="' + esc(mediaUrl) + '" controls preload="metadata"></audio>';
    } else {
      player = '<div class="tma-portal-status">' +
        (recording.status === 'recording'
          ? 'This call is still being recorded.'
          : 'No playable recording was captured for this call.') +
        '</div>';
    }

    if (ui && ui.openModal) {
      ui.openModal({
        title: (recording.media === 'video' ? 'Video' : 'Voice') + ' call',
        body: '<div class="call-recordings__detail">' + player + '</div>',
      });
      return;
    }

    if (window.TMADashboard && window.TMADashboard.navigate) {
      window.TMADashboard.navigate({
        navId: 'call-recordings',
        view: 'call-recordings',
        title: 'Call recordings',
        crumb: 'Call recordings',
      });
    }
  }

  var clientsMountRoot = null;

  /* The mounted view's state, for the module-level folder wiring, it runs
     outside the controller and still has to say where the reader is. */
  var clientsMountState = null;

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
      clientsMountState = root._clientsController.state || clientsMountState;
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
      conversations: null,
      conversationOptions: null,
      recordings: null,
      conversationsLoading: false,
      conversationsLoadedFor: null,
      messageMenuOpen: false,
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
      listTab: loadListTab(),
      page: 1,
      pageSize: loadPageSize(),
      selected: {},
      removedIds: {},
      // 'loading' | 'ready' | 'error'. The directory used to have no third
      // state, so a request that failed was hydrated as an empty list and the
      // page reported "No clients found", see startClients below.
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
      // Where the record's own head is lifted into the page header, the title
      // beside it would be a second name for the same thing.
      if (usesPagedClientsFlow(state) && screen !== 'list') {
        return { title: '', crumb: 'CIP Applications' };
      }
      if (screen === 'new-application' || screen === 'add') {
        return { title: 'New application', crumb: 'CIP Applications / New application' };
      }
      if (screen === 'edit-application') {
        return { title: 'Edit application', crumb: 'CIP Applications / Edit application' };
      }
      if (screen === 'add-company') {
        return { title: 'New service provider', crumb: 'CIP Applications / New service provider' };
      }
      if (screen === 'company' || screen === 'edit-company') {
        var company = companyFor(companyId || state.companyId);
        var companyName = company ? company.name : 'Service provider';

        return { title: companyName, crumb: 'CIP Applications / ' + companyName };
      }
      if ((screen === 'detail' || screen === 'edit') && contactId) {
        var contact = contactFor(contactId);

        return { title: contact.name, crumb: 'CIP Applications / ' + contact.name };
      }

      return { title: 'CIP Applications', crumb: 'CIP Applications' };
    }

    function applyScreen(screen, contactId, companyId, applicationId) {
      var previousId = state.selectedId;
      state.screen = screen;
      state.adding = screen === 'add';
      state.editing = screen === 'edit';
      // Which application the form is editing. Cleared on the way out, or a
      // later New application would open with the last one's answers in it.
      state.applicationId = screen === 'edit-application' ? (applicationId || state.applicationId) : null;
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
        state.conversationsLoadedFor = null;
        state.conversations = null;
        state.conversationOptions = null;
        state.recordings = null;
        state.messageMenuOpen = false;
        state.applicationFreshFor = null;
      }

      // Portal access is loaded whenever a client is opened, not only when the
      // Assigned tab is, because the toolbar button needs to know whether this
      // is a first invitation or a chase-up. Assigned staff comes with it now
      // for the same kind of reason: its tab carries a count, and a count that
      // only appears once you open the tab is no use to anybody.
      // Both flows show the profile: 'contact' in the split view, 'detail'
      // in the paged/mobile one.
      if ((state.screen === 'contact' || state.screen === 'detail') && state.selectedId) {
        state.applicationFreshFor = null;
        ensureProfileLoaded(state, render);
        ensureApplicationLoaded(state, render);
        ensureAccessLoaded(state, render);
        ensureAssignmentsLoaded(state, render, { quiet: true });
        ensureConversationsLoaded(state, render, { quiet: true });
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
        state.applicationFreshFor = null;
        ensureApplicationLoaded(state, render);
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
      syncClientsShell(state.screen, 'list');
      syncClientsPageActions(state, navigate);
      syncClientsHeadTabs(state, render);
      syncClientsDetailHead(state);
      root.className = 'tma-dash__clients';

      /*
       * Two screens, and that is the whole of it.
       *
       * There were four render paths: the table, a card list, a split view
       * with a directory column, and a detail-only repaint of that split's
       * right-hand pane. Three of them existed to serve the column layout,
       * which is gone, so the branch that chose between them is gone with it,
       * and with it the class the shell had to be told to wear.
       */
      if (state.screen === 'list') {
        MORPH.patch(root, renderTableListPage(state));
        wireEvents(root, state, 'list', navigate, render);

        return;
      }

      MORPH.patch(root, renderDetailPage(state));
      wireEvents(root, state, 'detail', navigate, render);
    }

    function navigate(screen, contactId, navOpts) {
      navOpts = navOpts || {};
      var companyId = navOpts.companyId || state.companyId;
      // Editing an application is addressed by the application, not the
      // client, one client can hold more than one over time.
      var applicationId = navOpts.applicationId || null;
      if (screen === 'detail' || screen === 'edit' || screen === 'add') {
        contactId = contactId || state.selectedId;
      } else {
        contactId = contactId || null;
      }

      if (!usesPagedClientsFlow(state)) {
        var dirBody = root.querySelector('.tma-dash__clients-directory-body');
        if (dirBody) state.listScrollTop = dirBody.scrollTop;

        applyScreen(screen, contactId, companyId, applicationId);

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
          screen === 'edit-application'
            ? pathForClientsScreen(screen, state.applicationId)
            : pathForClientsScreen(screen === 'list' ? 'list' : screen, state.selectedId, state.companyId)
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

      applyScreen(screen, contactId, companyId, applicationId);

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
        // An application edit is addressed by the application, not the client
        // whose profile it was opened from, otherwise a refresh here would
        // ask the server for an application with a client's uid.
        screen === 'edit-application'
          ? pathForClientsScreen(screen, state.applicationId)
          : pathForClientsScreen(screen, contactId || state.selectedId, state.companyId)
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
            title: route.screen === 'add' ? 'New application' : 'CIP Applications',
            crumb: route.screen === 'add' ? 'CIP Applications / New application' : 'CIP Applications',
            clientsScreen: route.screen || 'list',
            contactId: route.contactId || null,
            companyId: route.companyId || null,
          },
          '',
          pathForClientsScreen(route.screen || 'list', route.contactId, route.companyId)
        );
      }

      if (!isClientsMobile() && state.viewMode !== 'list') {
        applyScreen(route.screen || 'detail', route.contactId || state.selectedId, route.companyId || null, route.applicationId);
        if (!state.selectedId && route.screen !== 'add' && route.screen !== 'add-company' &&
            route.screen !== 'company' && route.screen !== 'edit-company' &&
            route.screen !== 'edit-application') {
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
              title: 'CIP Applications',
              crumb: 'CIP Applications',
              clientsScreen: 'list',
              contactId: state.selectedId,
            },
            '',
            '/clients'
          );
        }
        return;
      }

      applyScreen(route.screen || 'list', route.contactId, route.companyId || null, route.applicationId);
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

    root._clientsController = { syncRoute: syncRoute, navigate: navigate, render: render, state: state };
    clientsMountState = state;
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
     * `.catch(() => ({ clients: [] }))`, a timed-out or 500ing request became
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

      /*
       * Both listings paint from the store first and repaint on the server's
       * answer, the File Library pattern. For eleven thousand clients that is
       * the difference between the hub opening and the hub asking Cloud
       * Postgres to send the book again, and on the desktop the copy
       * survives a restart, so the directory is there before the network is.
       *
       * The double hydrate is safe: hydrateClients rebuilds the in-memory
       * directory from whichever answer is arriving, keeps profiles already
       * fetched, and the second call simply does it again with fresher rows.
       */
      var paintClients = function (data) {
        hydrateClients((data && data.clients) || []);
        state.loadState = 'ready';
        state.loadError = null;
        startClients();
      };

      var paintCompanies = function (companies) {
        hydrateCompanies((companies && companies.companies) || []);
        if (clientsMountRoot && clientsMountRoot._clientsController) {
          clientsMountRoot._clientsController.syncRoute(
            parseClientsPath(window.location.pathname)
          );
        }
      };

      var listClients = function () { return ClientsAPI.list(); };
      var listCompanies = function () { return CompaniesAPI.list(); };

      // Paint the directory as soon as clients arrive. Companies are secondary
      // (company column / company view) and used to hold the whole hub hostage.
      var request = window.TMAStore
        ? window.TMAStore.swr('clients:directory', listClients, paintClients)
        : listClients().then(paintClients);

      request.then(function () {
        var companies = window.TMAStore
          ? window.TMAStore.swr('clients:companies', listCompanies, paintCompanies)
          : listCompanies().then(paintCompanies);

        companies.catch(function () {
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
        // The store learns what the signal fetched. A colleague's write
        // invalidates nothing in THIS tab, the clientsFetch seam only sees
        // our own writes, so without this the store would serve their
        // yesterday's directory to tomorrow's reload.
        if (window.TMAStore) {
          if (clients) window.TMAStore.put('clients:directory', clients);
          if (companies) window.TMAStore.put('clients:companies', companies);
        }
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

  /*
   * The same for the CIP module. §8's table, §9's chips, and whichever
   * application is open beside them.
   *
   * Its own entry rather than a second job on the directory's: a client
   * edited in the hub does not move an application through its statuses, and
   * an officer approving a document does not change the client's card. One
   * shared entry would make every write on either side refetch the other's
   * screens, on every tab that has this module mounted.
   *
   * Nothing is fetched here. The four caches are dropped and the route is
   * re-derived; the paint that follows refetches whichever of them is
   * actually on screen. A signal that arrives while the reader is in the
   * client directory therefore costs one render and no requests.
   */
  if (window.TMALive) {
    window.TMALive.register(window.TMALive.RESOURCES.CIP, function () {
      forgetApplicationTable();
      forgetBuckets();

      var route = parseClientsPath(window.location.pathname);
      var open = route.contactId || null;
      var app = open ? APPLICATIONS[open] : null;
      var settled = [];

      /*
       * The open file is refetched in place, never dropped first.
       *
       * The application is what decides which tabs this profile even has, so
       * clearing the held record blanks it: for the length of one request the
       * reader's open Documents tab vanishes and the screen falls back to a
       * plain client, then puts everything back. A colleague approving a
       * document a floor away must not make the page somebody is reading
       * flicker. The old copy stays up until the new one has arrived.
       *
       * A queued edit is not refetched at all. It is the only copy of a change
       * made offline, the server has never seen it, so reading over it would
       * take the reader's own work off the screen.
       */
      if (open && !(app && app.pendingSync)) {
        forgetApplication(open);
        settled.push(
          clientsFetch('/portal/cip/clients/' + encodeURIComponent(open) + '/application')
            .then(function (json) { rememberApplication(open, (json && json.application) || null); })
            // Keep what is on screen. A signal is not a reason to empty a file.
            .catch(function () {})
        );
      }

      // The history the same way, and only one that has actually been read: a
      // tab nobody has opened is fetched when they open it.
      if (app && app.id && TIMELINE[open] !== undefined) {
        settled.push(
          clientsFetch('/portal/cip/applications/' + encodeURIComponent(app.id) + '/events')
            .then(function (json) { TIMELINE[open] = (json && json.events) || []; })
            .catch(function () {})
        );
      }

      var repaint = function () {
        if (!clientsMountRoot || !clientsMountRoot._clientsController) return;
        clientsMountRoot._clientsController.syncRoute(route);
      };

      // Once now, so the table and the chips start refetching straight away
      // rather than queueing behind the open file, and once when the file's
      // own reads have landed.
      repaint();

      return Promise.all(settled).then(repaint);
    }, {
      active: function () {
        return !!clientsMountRoot && document.contains(clientsMountRoot);
      },
    });
  }

  /*
   * A change made offline has just reached the server.
   *
   * The live signal that normally brings a colleague's edit back here is
   * raised by the request, so the tab that made it skips its own echo, which
   * is right when the change was applied on the screen a moment ago and wrong
   * for a queued one, where the screen has been showing the local copy for
   * hours and the server has only now built the real record. So the held copy
   * is dropped and the screen re-derived, which is what takes the "saved on
   * this device" line off it.
   */
  document.addEventListener('tma:queue-applied', function (e) {
    if (!e.detail || e.detail.kind !== 'cip.application') return;

    Object.keys(APPLICATIONS).forEach(function (id) {
      var app = APPLICATIONS[id];
      if (app && app.pendingSync) delete APPLICATIONS[id];
    });

    if (!clientsMountRoot || !clientsMountRoot._clientsController) return;
    clientsMountRoot._clientsController.syncRoute(parseClientsPath(window.location.pathname));
  });

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
    // Filter the applications table to one of §9's buckets. The Dashboard's
    // CIP card navigates here and then calls this; an unknown key is ignored.
    openBucket: openBucket,
    listDirectory: function (opts) { return ClientsAPI.list(opts); },
    // The hub's own data layer, for lists that live outside this view, the
    // same reason TMAFileActions exists. Everything on it goes through
    // clientsFetch, so callers inherit the cache invalidation for free
    // (which is also what lets the browser tests prove the seam is real
    // rather than assert around it).
    api: ClientsAPI,
  };
})();
