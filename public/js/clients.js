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
    Briefcase: ICON + 'Briefcase.svg',
    Buildings: ICON + 'Buildings.svg',
    Globe: ICON + 'Globe.svg',
    CalendarBlank: ICON + 'CalendarBlank.svg',
    LinkedinLogo: ICON + 'LinkedinLogo.svg',
    Trash: ICON + 'Trash.svg',
    Copy: 'images/icons/tma/Copy-16.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    User: ICON + 'User.svg',
    XCircle: ICON + 'Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
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
    { value: 'member', label: 'Company member' },
  ];

  /* How far a staff assignment reaches. Company-only is the default on purpose
     — the wider options are shown with what they will cover before they apply. */
  var COMPANY_SCOPES = [
    { value: 'company_only', label: 'The company only' },
    { value: 'existing', label: 'The company and its current contacts' },
    { value: 'existing_future', label: 'The company and all its contacts, now and in future' },
  ];

  /* What the staff member does for the client, as opposed to what they may
     open. Mirrors ClientAssignment::ROLES — the server refuses anything else. */
  var ASSIGNMENT_ROLES = [
    { value: 'account_manager', label: 'Account manager' },
    { value: 'booking_coordinator', label: 'Booking coordinator' },
    { value: 'finance', label: 'Finance contact' },
    { value: 'contract_manager', label: 'Contract manager' },
    { value: 'event_coordinator', label: 'Event coordinator' },
    { value: 'general', label: 'Assigned staff' },
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

  var ClientsAPI = {
    list: function () { return clientsFetch(CLIENTS_BASE); },
    create: function (payload) { return clientsFetch(CLIENTS_BASE, { method: 'POST', json: payload }); },
    update: function (uid, payload) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid), { method: 'PATCH', json: payload });
    },
    remove: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid), { method: 'DELETE' });
    },
    bulkRemove: function (uids) {
      return clientsFetch(CLIENTS_BASE + '/bulk-delete', { method: 'POST', json: { uids: uids } });
    },
    duplicate: function (uid) {
      return clientsFetch(CLIENTS_BASE + '/' + encodeURIComponent(uid) + '/duplicate', { method: 'POST' });
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
    return { name: '', website: '', notes: '' };
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

  function isClientsAdmin() {
    var me = window.TMACurrentUser && TMACurrentUser.get && TMACurrentUser.get();
    return !!(me && me.isAdmin);
  }

  // Rebuild the in-memory directory + profile map from server records.
  function hydrateClients(records) {
    DIRECTORY.length = 0;
    CLIENT_META = {};
    Object.keys(PROFILES).forEach(function (k) { delete PROFILES[k]; });
    (records || []).forEach(function (rec) {
      if (!rec || !rec.id) return;
      PROFILES[rec.id] = rec.profile || {};
      rememberMeta(rec);
      var item = { id: rec.id, name: rec.name || 'Client' };
      if (rec.initial) item.initial = rec.initial;
      if (rec.initialColor) item.initialColor = rec.initialColor;
      insertContact(item);
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
    var colorClass = source.color === 'green' ? ' tma-dash__clients-avatar--green' : ' tma-dash__clients-avatar--blue';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial' + colorClass +
      '" style="width:' + size + 'px;height:' + size + 'px">' + esc(source.initial) + '</span>'
    );
  }

  function directoryAvatarItem(item) {
    var profile = PROFILES[item.id] || {};
    return {
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

  function contactMatchesSearch(item, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    if (item.name.toLowerCase().indexOf(q) !== -1) return true;
    var profile = PROFILES[item.id];
    if (!profile) return false;
    var parts = [
      profile.firstName,
      profile.lastName,
      profile.nickname,
      profile.work && profile.work.company,
      profile.work && profile.work.jobTitle,
    ];
    (profile.emails || []).forEach(function (email) { if (email.value) parts.push(email.value); });
    (profile.phones || []).forEach(function (phone) { if (phone.value) parts.push(phone.value); });
    return parts.filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
  }

  function filteredDirectoryGroups(search) {
    var q = String(search || '').trim();
    if (!q) return DIRECTORY;
    return DIRECTORY.map(function (group) {
      var items = group.items.filter(function (item) {
        return contactMatchesSearch(item, q);
      });
      if (!items.length) return null;
      return { letter: group.letter, items: items };
    }).filter(Boolean);
  }

  function filteredDirectoryItems(state) {
    var search = typeof state === 'string' ? state : (state && state.search);
    var removedIds = state && typeof state === 'object' ? state.removedIds : null;
    var items = [];
    filteredDirectoryGroups(search).forEach(function (group) {
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

  function primaryContactValue(id) {
    var profile = PROFILES[id];
    if (!profile) return '—';
    var emails = profile.emails || [];
    for (var i = 0; i < emails.length; i++) {
      if (emails[i].value) return emails[i].value;
    }
    var phones = profile.phones || [];
    for (var j = 0; j < phones.length; j++) {
      if (phones[j].value) return phones[j].value;
    }
    return '—';
  }

  function clientTableColumns(item) {
    return {
      name: item.name,
      company: clientCompanyName(item.id) || '—',
      companyId: clientCompanyId(item.id) || '',
      contact: primaryContactValue(item.id),
    };
  }

  function clientRowKey(item) {
    return item.id;
  }

  function clientAvatarMarkup(item) {
    var av = directoryAvatarItem(item);
    if (av.avatar) {
      return '<img src="' + esc(AVATAR + av.avatar + '.png') + '" alt="">';
    }
    if (av.photo) {
      return '<img src="' + esc(av.photo) + '" alt="">';
    }
    var colorClass = av.initialColor === 'green' ? ' tma-dash__clients-avatar--green' : ' tma-dash__clients-avatar--blue';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial' + colorClass +
      '" style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)">' + esc(av.initial || '?') + '</span>'
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

    return (
      '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
      '<button type="button" class="tma-dash__tool-btn" aria-label="Filter" data-clients-filter aria-pressed="false">' +
      '<img src="' + ICONS.FunnelSimple + '" alt=""></button>' +
      '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-clients-sort aria-pressed="false">' +
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

  var CLIENTS_PAGE_SIZES = [5, 10, 20];

  function getTablePageData(state) {
    var items = filteredDirectoryItems(state);
    var pageSize = state.pageSize || 10;
    var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total: items.length,
      totalPages: totalPages,
    };
  }

  function renderFullTableRow(item, index, checked) {
    var cols = clientTableColumns(item);
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    var companyCell = cols.companyId
      ? '<button type="button" class="tma-dash__clients-company-link tma-dash__cc-truncate" data-clients-open-company="' +
        esc(cols.companyId) + '">' + esc(cols.company) + '</button>'
      : '<span class="tma-dash__cc-truncate">' + esc(cols.company) + '</span>';
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body' + selected + '" data-clients-row="' + esc(item.id) +
      '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-check' + (checked ? ' checked' : '') +
      ' aria-label="Select ' + esc(cols.name) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user">' + clientAvatarMarkup(item) +
      '<span class="tma-dash__cc-truncate">' + esc(cols.name) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--company">' + companyCell + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact"><span class="tma-dash__cc-truncate">' +
      esc(cols.contact) + '</span></div></div>'
    );
  }

  function renderFullTableRows(state) {
    var page = getTablePageData(state);
    if (!page.items.length) {
      return '<div class="tma-dash__ctr tma-dash__ctr--empty" role="row"><div class="tma-dash__cc tma-dash__cc--empty">No clients found</div></div>';
    }
    var start = (state.page - 1) * (state.pageSize || 10);
    return page.items.map(function (item, i) {
      var key = clientRowKey(item);
      return renderFullTableRow(item, start + i, !!(state.selected && state.selected[key]));
    }).join('');
  }

  function renderClientsPagination(state, totalRows) {
    var pageSize = state.pageSize || 10;
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    var pages = '';
    var maxButtons = Math.min(5, totalPages);
    for (var p = 1; p <= maxButtons; p++) {
      var active = p === state.page;
      pages +=
        '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') +
        '" aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') +
        ' data-page="' + p + '"><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';
    var resultsText = totalRows + (totalRows === 1 ? ' result' : ' results');

    return (
      '<div class="tma-pagination-bar tma-pagination-bar--footer" data-clients-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
      '<button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page" aria-haspopup="listbox" aria-expanded="false" data-clients-page-size>' +
      '<span class="tma-pagination__label">' + pageSize + '</span>' +
      '<img src="' + ICONS.ArrowLineDown + '" class="tma-pagination__icon" width="16" height="16" alt="" aria-hidden="true">' +
      '</button>' +
      '<span class="tma-pagination-bar__results" data-clients-results-count>' + resultsText + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' + pages +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '>' +
      '<img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-direction="next"' + nextDisabled + '>' +
      '<img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>'
    );
  }

  function renderTableListPage(state) {
    var page = getTablePageData(state);
    return (
      renderTableToolbar(state) +
      '<div class="tma-dash__ctable tma-dash__ctable--clients" role="table" aria-label="Clients">' +
      '<div class="tma-dash__ctr tma-dash__ctr--head" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-selectall aria-label="Select all"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head" role="columnheader">Client</div>' +
      '<div class="tma-dash__cc tma-dash__cc--company tma-dash__cc--head" role="columnheader">Company</div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact tma-dash__cc--head" role="columnheader">Contact</div>' +
      '</div>' +
      '<div data-clients-body>' + renderFullTableRows(state) + '</div>' +
      '</div>' +
      renderClientsPagination(state, page.total)
    );
  }
  function renderDirectoryListBody(state) {
    var groups = filteredDirectoryGroups(state.search);
    if (!groups.length) {
      return '<div class="tma-dash__clients-directory-empty">No clients found</div>';
    }
    return groups.map(function (group) {
      return (
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
        }).join('')
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

  function renderDesktopPage(state) {
    return (
      '<div class="tma-dash__clients-page" data-node-id="clients-page">' +
      renderDirectory(state, false) +
      renderDetailContent(state) +
      '</div>'
    );
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
      '</div></div>'
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
    var title = isNew ? 'New company' : 'Edit company';
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
        'Company',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Company name', 'companyName', draft.name) +
        renderFormField('Website', 'companyWebsite', draft.website, { type: 'url', placeholder: 'https://' }) +
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

  function renderCompanyProfile(state, opts) {
    opts = opts || {};
    var company = companyFor(state.companyId);
    if (!company) {
      return '<div class="tma-dash__clients-detail"><div class="tma-dash__clients-assigned-empty">Company not found.</div></div>';
    }
    var people = company.people || [];
    var peopleHtml = people.length
      ? '<div class="tma-dash__clients-company-people">' + people.map(function (p) {
          return (
            '<button type="button" class="tma-dash__clients-row" data-clients-row="' + esc(p.id) + '">' +
            clientAvatarMarkup(p) +
            '<span class="tma-dash__clients-row-name">' + esc(p.name) + '</span>' +
            (p.email ? '<span class="tma-dash__clients-row-meta">' + esc(p.email) + '</span>' : '') +
            '</button>'
          );
        }).join('') + '</div>'
      : '<div class="tma-dash__clients-assigned-empty">No people at this company yet.</div>';

    var toolbar = opts.elevateToolbar ? '' : renderCompanyProfileToolbar(company);

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile' +
      (opts.elevateToolbar ? ' tma-dash__clients-profile--elevated' : '') + '">' +
      toolbar +
      (company.website
        ? '<div class="tma-dash__clients-profile-body"><ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
          renderListItem({ icon: ICONS.Globe, label: 'Website', value: company.website, href: company.website, linkLabel: company.website }) +
          '</ul></div>'
        : '') +
      (company.notes
        ? '<p class="tma-dash__clients-company-notes">' + esc(company.notes) + '</p>'
        : '') +
      renderCompanyDetails(company) +
      '<div class="tma-dash__clients-assigned-head"><span class="tma-dash__clients-assigned-count">People</span></div>' +
      peopleHtml +
      renderCompanyMembersBlock(state, company) +
      renderCompanyStaffBlock(state, company) +
      '</div></div>'
    );
  }

  /* The account details that belong to the organization rather than to any one
     contact. Only rows that are filled in are shown — an empty grid of labels
     tells the reader nothing. */
  function renderCompanyDetails(company) {
    var rows = [
      { icon: ICONS.Buildings, label: 'Type', value: company.companyTypeLabel },
      { icon: ICONS.Briefcase, label: 'Industry', value: company.industry },
      { icon: ICONS.EnvelopeSimple, label: 'Email', value: company.email },
      { icon: ICONS.Phone, label: 'Phone', value: company.phone },
      { icon: ICONS.User, label: 'Registration', value: company.registrationNumber },
    ].filter(function (r) { return !!r.value; });

    if (!rows.length) return '';

    return '<div class="tma-dash__clients-profile-body">' +
      '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
      rows.map(function (r) {
        return renderListItem({ icon: r.icon, label: r.label, value: r.value });
      }).join('') +
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
    return 'Company member';
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
        '<button type="button" class="tma-dash__clients-message-btn" data-company-member-add>Add</button>' +
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
      : '<div class="tma-dash__clients-assigned-empty">' +
        (loading ? 'Loading members…' : 'Nobody at this company has portal access yet.') + '</div>';

    return '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Company access</span></div>' +
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
        '<button type="button" class="tma-dash__clients-message-btn" data-company-staff-add>Assign</button>' +
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
      : '<div class="tma-dash__clients-assigned-empty">' +
        (loading ? 'Loading…' : 'No staff assigned to this company yet.') + '</div>';

    return '<div class="tma-dash__clients-access-block">' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">Assigned staff</span></div>' +
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

  function renderProfileTabs(activeTab) {
    return PROFILE_TABS.map(function (tab) {
      var active = tab.id === activeTab;
      return (
        '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab"' +
        ' aria-selected="' + (active ? 'true' : 'false') + '" data-clients-tab="' + esc(tab.id) + '">' +
        '<span class="tma-tab__label">' + esc(tab.label) + '</span>' +
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
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="folders" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-folders-head">' +
      '<span class="tma-dash__clients-folders-title" data-clients-folder-crumbs>Client documents</span>' +
      (uuid
        ? '<div class="tma-dash__clients-folders-actions">' +
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-new>' +
          '<img src="' + ICONS.Plus + '" alt=""><span>New folder</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-upload>' +
          '<img src="images/icons/phosphor/ArrowLineUp.svg" alt=""><span>Upload</span></button>' +
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

  function renderClientFolderList(root, res) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap) return;
    var folders = (res && res.folders) || [];
    var files = (res && res.files) || [];
    if (!folders.length && !files.length) {
      wrap.innerHTML = '<div class="tma-dash__clients-assigned-empty" data-clients-folder-list>' +
        'No files yet. Use “Upload”, “New folder”, or drag files here.</div>';
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
      var meta = [f.sizeLabel, f.modifiedAt ? 'Updated ' + fmtShortDate(f.modifiedAt) : null].filter(Boolean).join(' · ');
      html += '<button type="button" class="tma-dash__clients-folder" data-clients-file="' + esc(f.id) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true"><img src="images/icons/phosphor/File.svg" alt=""></span>' +
        '<span class="tma-dash__clients-folder-main"><span class="tma-dash__clients-folder-name">' + esc(f.name) + '</span>' +
        (meta ? '<span class="tma-dash__clients-folder-meta">' + esc(meta) + '</span>' : '') +
        '</span></button>';
    });
    wrap.innerHTML = html;
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
        if (fu && filesNet()) window.open(filesNet().url('/files/' + encodeURIComponent(fu) + '/preview'), '_blank', 'noopener');
      });
    });
  }

  function loadClientFolder(root) {
    var wrap = root.querySelector('[data-clients-folder-drop]');
    if (!wrap || !filesNet()) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    filesNet().fetchJSON(filesNet().url('/?folder=' + encodeURIComponent(uuid) + '&perPage=200'))
      .then(function (res) { renderClientFolderList(root, res); bindClientFolderRows(root); })
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
        '<select class="tma-dash__clients-field-select" data-clients-assign-role aria-label="Assignment role">' +
        ASSIGNMENT_ROLES.map(function (r) {
          return '<option value="' + esc(r.value) + '"' + (r.value === 'general' ? ' selected' : '') + '>' +
            esc(r.label) + '</option>';
        }).join('') +
        '</select>' +
        '<select class="tma-dash__clients-field-select" data-clients-assign-level aria-label="Permission level">' +
        ASSIGNMENT_LEVELS.map(function (l) {
          return '<option value="' + esc(l.value) + '"' + (l.value === 'editor' ? ' selected' : '') + '>' +
            esc(l.label) + '</option>';
        }).join('') +
        '</select>' +
        '<button type="button" class="tma-dash__clients-message-btn" data-clients-assign-submit>Assign</button>' +
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
      renderProfileTabs(activeTab) +
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

    PROFILES[id] = Object.assign({}, cloneDraft(draft), {
      projects: existing.projects || '0',
      workingGroup: existing.workingGroup || '0',
      likes: existing.likes || '0',
    });

    var birthdayEntry = draft.importantDates.filter(function (entry) {
      return entry.type === 'birthday' && entry.date;
    })[0];
    PROFILES[id].birthday = birthdayEntry ? birthdayEntry.date : '';
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

    var prev = pagination.querySelector('[data-direction="prev"]');
    if (prev) {
      MORPH.on(prev, 'click', function () {
        if (state.page <= 1) return;
        state.page -= 1;
        render({ forceFull: true });
      });
    }

    var next = pagination.querySelector('[data-direction="next"]');
    if (next) {
      MORPH.on(next, 'click', function () {
        var totalPages = Math.max(1, Math.ceil(filteredDirectoryItems(state).length / (state.pageSize || 10)));
        if (state.page >= totalPages) return;
        state.page += 1;
        render({ forceFull: true });
      });
    }

    var pageSizeBtn = pagination.querySelector('[data-clients-page-size]');
    if (pageSizeBtn) {
      MORPH.on(pageSizeBtn, 'click', function () {
        var idx = CLIENTS_PAGE_SIZES.indexOf(state.pageSize || 10);
        var nextSize = CLIENTS_PAGE_SIZES[(idx + 1) % CLIENTS_PAGE_SIZES.length];
        state.pageSize = nextSize;
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
        PROFILES[rec.id] = rec.profile || {};
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

  function wireTableBulkActions(root, state, render) {
    MORPH.unwired(root, '[data-clients-bulk-action]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var action = btn.getAttribute('data-clients-bulk-action');
        if (action === 'delete') deleteSelectedClients(state, render);
        else if (action === 'duplicate') duplicateSelectedClients(state, render);
      });
    });
  }

  function wireTableSelection(root, state) {
    var items = filteredDirectoryItems(state);
    var selectAll = root.querySelector('[data-clients-selectall]');
    var rowChecks = Array.prototype.slice.call(root.querySelectorAll('[data-clients-check]'));

    function syncRow(cb, rowIndex) {
      var rowEl = cb.closest('[data-row-index]');
      var item = items[rowIndex];
      if (!item) return;
      var key = clientRowKey(item);
      if (cb.checked) state.selected[key] = true;
      else delete state.selected[key];
      if (rowEl) rowEl.classList.toggle('tma-dash__ctr--selected', cb.checked);
      updateTableToolbarSelection(root, state);
    }

    function syncSelectAll() {
      if (!selectAll) return;
      var checked = rowChecks.filter(function (c) { return c.checked; }).length;
      selectAll.checked = checked === rowChecks.length && rowChecks.length > 0;
      selectAll.indeterminate = checked > 0 && checked < rowChecks.length;
    }

    rowChecks.forEach(function (cb) {
      var rowEl = cb.closest('[data-row-index]');
      var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
      MORPH.on(cb, 'change', function () {
        syncRow(cb, rowIndex);
        syncSelectAll();
      });
    });

    if (selectAll) {
      MORPH.on(selectAll, 'change', function () {
        rowChecks.forEach(function (cb) {
          var rowEl = cb.closest('[data-row-index]');
          var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
          cb.checked = selectAll.checked;
          syncRow(cb, rowIndex);
        });
        selectAll.indeterminate = false;
      });
      syncSelectAll();
    }
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
        state.searchLoading = false;
        refreshDirectoryFromSearch(root, state);
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

    if (scope === 'list' || scope === 'split') {
      wireSearchEvents(root, state);

      MORPH.unwired(root, '[data-clients-layout]').forEach(function (btn) {
        btn.remove();
      });

      if (scope === 'list' && state.viewMode === 'list') {
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
        var payload = {
          name: nameEl ? nameEl.value.trim() : '',
          website: websiteEl ? websiteEl.value.trim() : '',
          notes: notesEl ? notesEl.value.trim() : '',
        };
        if (!payload.name) {
          clientsToast('Company name is required', 'negative');
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
          clientsToast(isNew ? 'Company created' : 'Company saved', 'positive');
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
        var roleSel = root.querySelector('[data-clients-assign-role]');
        ClientsAPI.assign(state.selectedId, {
          userId: userId,
          role: roleSel ? roleSel.value : 'general',
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

  function ensureAssignmentsLoaded(state, render) {
    if (!state.selectedId) return;
    if (state.assignmentsLoadedFor === state.selectedId && !state.assignmentsLoading) return;
    state.assignmentsLoading = true;
    state.assignmentsLoadedFor = state.selectedId;
    if (usesPagedClientsFlow(state)) render();
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
      viewMode: loadViewMode(),
      page: 1,
      pageSize: 10,
      selected: {},
      removedIds: {},
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
        return { title: 'New company', crumb: 'Clients / New company' };
      }
      if (screen === 'company' || screen === 'edit-company') {
        var company = companyFor(companyId || state.companyId);
        var companyName = company ? company.name : 'Company';
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
        state.assignmentsLoadedFor = null;
        state.assignments = [];
        state.assignmentHistory = [];
        state.accessLoadedFor = null;
        state.access = null;
        state.invitation = null;
      }

      // Portal access is loaded whenever a client is opened, not only when the
      // Assigned tab is, because the toolbar button needs to know whether this
      // is a first invitation or a chase-up.
      // Both flows show the profile: 'contact' in the split view, 'detail'
      // in the paged/mobile one.
      if ((state.screen === 'contact' || state.screen === 'detail') && state.selectedId) {
        ensureAccessLoaded(state, render);
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
        state.draft = contactToDraft(contactFor(contactId));
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

    if (clientsLoaded) {
      startClients();
    } else {
      root.innerHTML =
        '<div class="tma-dash__clients-loading" role="status" aria-live="polite">' +
        '<img class="tma-dash__clients-loading-spinner" src="' + ICONS.Loading16 + '" alt="" width="20" height="20">' +
        '<span>Loading clients…</span></div>';
      Promise.all([
        ClientsAPI.list().catch(function () { return { clients: [] }; }),
        CompaniesAPI.list().catch(function () { return { companies: [] }; }),
      ]).then(function (results) {
        hydrateClients(results[0] && results[0].clients ? results[0].clients : []);
        hydrateCompanies(results[1] && results[1].companies ? results[1].companies : []);
      }).catch(function () {
        clientsLoaded = true;
      }).then(startClients);
    }
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
  };
})();
