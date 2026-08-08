/*
 * TMA - Portal People section
 * Manage users home, Browse employees, Browse client contacts,
 * Browse prospects, Shared / Personal address books, Distribution
 * groups, Resend welcome emails.
 * Registers view: 'people'.
 *
 * Every screen reads the real directory. Accounts come from
 * /portal/people/* (a staff read of the users table) and are written through
 * /admin/users, which is where the rules for creating, suspending and
 * deleting an account already live; the address books are /portal/contacts;
 * groups are /portal/groups. Nothing here keeps a list of its own — the page
 * used to hold one in localStorage, which is why it always looked empty.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }

  /*
   * Rendering reconciles rather than replaces (see dom-morph.js), so nodes
   * survive a render — every binding below therefore goes through
   * MORPH.unwired / unwiredOne / on, never a bare addEventListener walk, or
   * handlers stack one per render.
   */
  var MORPH = window.TMAMorph || {
    patch: function (root, html) { root.innerHTML = html; },
    unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
    unwiredOne: function (root, sel) { return root.querySelector(sel); },
    on: function (el, type, fn) { if (el) el.addEventListener(type, fn); },
  };

  var ROOT = window.__TMA_SITE_ROOT || '';

  function net(url, opts) {
    return window.TMAFilesNet.fetchJSON(ROOT + url, opts);
  }

  function errMsg(e, fallback) {
    return (e && e.message) || fallback;
  }

  /* ── state ──────────────────────────────────────── */

  var SCREEN_FOR_NAV = {
    'people-home': 'home',
    'people-employees': 'employees',
    'people-clients': 'clients',
    'people-prospects': 'prospects',
    'people-shared-address': 'shared-address',
    'people-personal-address': 'personal-address',
    'people-groups': 'groups',
    'people-resend': 'resend',
  };

  var state = {
    el: null,
    screen: 'home',
    alpha: 'All',
    search: '',
    statusFilter: 'All employees',
    // Which invitation states the Invitations screen is showing.
    inviteView: 'waiting',
    selected: {},
    caps: { manageUsers: false, viewClients: false, manageGroups: false, viewGroups: false },
  };

  /* One cache per feed. `loaded` is what tells a revisited screen not to
     re-skeleton over data it already has. */
  function feed() {
    return { loaded: false, loading: false, error: null, items: [], extra: {} };
  }

  var store = {
    summary: feed(),
    employees: feed(),
    clients: feed(),
    prospects: feed(),
    shared: feed(),
    personal: feed(),
    groups: feed(),
    candidates: feed(),
  };

  /* Fetch a feed once. `pick` maps the response onto { items, extra }. */
  /*
   * Set while a live update is refetching in the background.
   *
   * A flag rather than another parameter because every caller reaches load()
   * through ensure(), whose eight branches would each have to thread it — and
   * the one that got missed would be the screen that blanks itself. Refreshes
   * are driven one at a time by TMALive, which suppresses overlapping runs,
   * so there is only ever one refresh this could describe.
   */
  var liveRefreshing = false;

  function load(key, url, pick, force) {
    var f = store[key];
    if (f.loading || (f.loaded && !force)) return;
    var silent = liveRefreshing;
    f.loading = true;
    f.error = null;

    return net(url)
      .then(function (d) {
        var out = pick(d || {});
        f.items = out.items || [];
        f.extra = out.extra || {};
        if (d && d.capabilities) state.caps = d.capabilities;
        f.loaded = true;
        f.loading = false;
        render();
      })
      .catch(function (e) {
        f.loaded = true;
        f.loading = false;
        // Keep a list that is already on screen rather than swapping it for an
        // error because a refresh nobody requested happened to fail.
        if (!silent) f.error = errMsg(e, 'Couldn’t load this list.');
        render();
      });
  }

  function reload(key) {
    var f = store[key];
    f.loaded = false;
    ensure(key, true);
  }

  /* The feed each screen needs, and where it comes from. */
  function ensure(key, force) {
    if (key === 'summary') {
      load('summary', '/portal/people/summary', function (d) {
        return { items: [], extra: d.counts || {} };
      }, force);
    } else if (key === 'employees') {
      load('employees', '/portal/people/employees', function (d) {
        return { items: d.employees || [] };
      }, force);
    } else if (key === 'clients') {
      load('clients', '/portal/people/client-contacts', function (d) {
        return { items: d.contacts || [] };
      }, force);
    } else if (key === 'prospects') {
      load('prospects', '/portal/people/prospects?status=' + encodeURIComponent(state.inviteView || 'waiting'), function (d) {
        return { items: d.prospects || [], counts: d.counts || {} };
      }, force);
    } else if (key === 'shared' || key === 'personal') {
      var scope = key === 'shared' ? 'shared' : 'personal';
      load(key, '/portal/contacts?scope=' + scope, function (d) {
        return { items: d.contacts || [], extra: { canManageShared: !!d.canManageShared } };
      }, force);
    } else if (key === 'groups') {
      load('groups', '/portal/groups', function (d) {
        return { items: d.groups || [], extra: { canManage: !!d.canManage } };
      }, force);
    } else if (key === 'candidates') {
      load('candidates', '/portal/people/welcome-candidates', function (d) {
        return { items: d.candidates || [] };
      }, force);
    }
  }

  function navigate(navId, title, crumb) {
    if (window.TMADashboard) {
      window.TMADashboard.navigate({ navId: navId, view: 'people', title: title, crumb: crumb });
    }
  }

  /* ── shared bits ────────────────────────────────── */

  function esc(s) { return ui().esc(s); }

  function sortKey(p) {
    return String(p.lastName || p.name || p.firstName || p.email || '').toLowerCase();
  }

  function matchesAlpha(p) {
    if (state.alpha === 'All') return true;
    var first = String(p.lastName || p.name || p.firstName || p.email || '').charAt(0);
    if (state.alpha === '#') return !/[a-z]/i.test(first);
    return first.toUpperCase() === state.alpha;
  }

  function matchesSearch(p) {
    var q = state.search.trim().toLowerCase();
    if (!q) return true;
    var hay = [p.name, p.firstName, p.lastName, p.email, p.company, p.jobTitle]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function filtered(list) {
    return list.filter(function (p) { return matchesAlpha(p) && matchesSearch(p); })
      .sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0; });
  }

  function avatarSrc(p) {
    var name = p.name || p.email || '';
    if (window.TMACurrentUser) {
      if (p.avatar && typeof window.TMACurrentUser.avatarSrc === 'function') {
        return window.TMACurrentUser.avatarSrc(p.avatar, name);
      }
      if (typeof window.TMACurrentUser.initialsFor === 'function') {
        return window.TMACurrentUser.initialsFor(name, p.email || String(p.id));
      }
    }
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }

  function nameCell(p, chips) {
    return '<td><span class="tma-portal-avatar-cell">' +
      '<img src="' + avatarSrc(p) + '" alt="" width="24" height="24">' +
      '<strong>' + esc(p.name || p.email) + '</strong>' +
      (chips || '') +
      '</span></td>';
  }

  function chip(label, variant) {
    return '<span class="tma-portal-chip' + (variant ? ' tma-portal-chip--' + variant : '') + '">' + esc(label) + '</span>';
  }

  /* One vocabulary for "can this person actually get in?", used by the
     employees and client-contacts tables and by the Showing filter. */
  function statusOf(p) {
    if (p.status === 'suspended') return { key: 'Suspended', label: 'Suspended', variant: '' };
    if (p.status === 'pending') return { key: 'Not activated', label: 'Awaiting approval', variant: '' };
    if (!p.lastLogin) return { key: 'Not activated', label: 'Not activated', variant: '' };
    return { key: 'Active', label: 'Active', variant: 'ok' };
  }

  function menuBtn(attr, id, label) {
    return '<div class="tma-portal-row-actions">' +
      '<button type="button" class="tma-portal-icon-btn" ' + attr + '="' + esc(id) + '"' +
      ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
      '<img src="images/icons/phosphor/DotsThree.svg" alt="" width="20" height="20"></button></div>';
  }

  function feedProblem(f) {
    return f.error ? ui().banner('warning', esc(f.error)) : '';
  }

  function toolbar(placeholder, right) {
    return '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group">' +
      ui().searchInput(placeholder, 'data-people-search', state.search) +
      '</div>' +
      (right ? '<div class="tma-portal-toolbar__group">' + right + '</div>' : '') +
      '</div>';
  }

  function selectedIds() {
    return Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
  }

  function head(title, subtitle, actions) {
    return '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">' + esc(title) + '</h2>' +
      (subtitle ? '<p class="tma-portal-subtitle">' + esc(subtitle) + '</p>' : '') +
      '</div>' +
      (actions ? '<div class="tma-portal-head__actions">' + actions + '</div>' : '') +
      '</div>';
  }

  /* ── home ───────────────────────────────────────── */

  var HOME_LINKS = [
    { nav: 'people-employees', screen: 'employees', title: 'Browse employees', desc: 'Manage employee accounts, permissions and personal folders.', icon: 'UserList', count: 'employees' },
    { nav: 'people-clients', screen: 'clients', title: 'Browse client contacts', desc: 'The client accounts that can sign in to the portal.', icon: 'AddressBook', count: 'clientContacts', cap: 'viewClients' },
    { nav: 'people-prospects', screen: 'prospects', title: 'Browse prospects', desc: 'Invitations and the people who have not activated yet.', icon: 'UserCirclePlus', count: 'prospects', cap: 'viewClients' },
    { nav: 'people-shared-address', screen: 'shared-address', title: 'Shared address book', desc: 'Account-wide contacts available to every employee.', icon: 'BookOpen', count: 'sharedContacts' },
    { nav: 'people-personal-address', screen: 'personal-address', title: 'Personal address book', desc: 'Your private contacts.', icon: 'Book', count: 'personalContacts' },
    { nav: 'people-groups', screen: 'groups', title: 'Distribution groups', desc: 'Send and share with many people at once.', icon: 'UsersThree', count: 'groups', cap: 'viewGroups' },
    { nav: 'people-resend', screen: 'resend', title: 'Resend welcome emails', desc: 'Re-invite people who have not signed in yet.', icon: 'PaperPlaneTilt', cap: 'manageUsers' },
  ];

  /* "UserCirclePlus" -> "user-circle-plus", naming the mask rule in
     portal.css. The art itself is named there, never inline — a relative
     url() in an inline style resolves against the page, not the stylesheet. */
  function iconSlug(name) {
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  function renderHome() {
    var f = store.summary;
    var counts = f.extra || {};

    var actions =
      (state.caps.manageUsers ? ui().btn({ label: 'Create employee', icon: 'UserPlus', attrs: ' data-people-quick="employee"' }) : '') +
      (state.caps.manageUsers ? ui().btn({ label: 'Add client contact', icon: 'Plus', variant: 'ghost', attrs: ' data-people-quick="client"' }) : '');

    var subtitle = f.loaded && !f.error
      ? counts.employees + ' employee' + (counts.employees === 1 ? '' : 's') + ' · ' +
        counts.clientContacts + ' client contact' + (counts.clientContacts === 1 ? '' : 's') +
        (counts.prospects ? ' · ' + counts.prospects + ' waiting to activate' : '')
      : '';

    var body;
    if (!f.loaded) {
      body = ui().loading({ grid: true, count: 6 });
    } else {
      body = '<div class="tma-portal-card-grid">' +
        HOME_LINKS.filter(function (l) { return !l.cap || state.caps[l.cap]; }).map(function (l) {
          var n = l.count ? counts[l.count] : null;
          return '<button type="button" class="tma-portal-tpl-card tma-portal-tpl-card--module"' +
            ' data-people-link="' + l.nav + '"' +
            ' data-people-screen="' + l.screen + '" data-people-title="' + esc(l.title) + '">' +
            '<span class="tma-portal-module-icon">' +
            '<span class="tma-portal-module-icon__art tma-portal-module-icon__art--' +
            iconSlug(l.icon) + '" aria-hidden="true"></span></span>' +
            '<h3 class="tma-portal-tpl-card__name">' + esc(l.title) +
            (n != null ? ' ' + chip(String(n)) : '') + '</h3>' +
            '<p class="tma-portal-tpl-card__desc">' + esc(l.desc) + '</p>' +
            '</button>';
        }).join('') +
        '</div>';
    }

    return head('Manage users', subtitle, actions) + feedProblem(f) + body;
  }

  /* ── employees ──────────────────────────────────── */

  var EMPLOYEE_FILTERS = ['All employees', 'Active', 'Not activated', 'Suspended'];

  function renderEmployees() {
    var f = store.employees;
    var actions = state.caps.manageUsers
      ? ui().btn({ label: 'Create employee', icon: 'UserPlus', attrs: ' data-people-create="employee"' })
      : '';

    var right = '<span class="tma-portal-subtitle">Showing</span>' +
      ui().select(EMPLOYEE_FILTERS, state.statusFilter, 'data-people-status', 'Employee status');

    var chrome = head('Browse Employees', null, actions) + feedProblem(f) +
      ui().alphaFilter(state.alpha) + toolbar('Search employees', right);

    if (!f.loaded) return chrome + ui().loading({ count: 6 });
    if (f.error) return chrome;

    var list = filtered(f.items).filter(function (p) {
      return state.statusFilter === 'All employees' || statusOf(p).key === state.statusFilter;
    });

    if (!list.length) {
      return chrome + ui().emptyState({
        illustration: 'Illustration14',
        title: f.items.length ? 'No employees match these filters' : 'No employees yet',
        subtitle: f.items.length ? 'Try a different letter, search or status.' : 'Create an employee to get started.',
      });
    }

    var rows = list.map(function (p) {
      var s = statusOf(p);
      var chips = (p.admin ? ' ' + chip('Admin') : '') + (p.self ? ' ' + chip('You') : '');
      return '<tr data-people-row="' + p.id + '">' +
        nameCell(p, chips) +
        '<td class="tma-portal-table__muted">' + esc(p.email) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.jobTitle || '—') + '</td>' +
        '<td>' + chip(s.label, s.variant) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.lastLogin || 'Never') + '</td>' +
        (state.caps.manageUsers
          ? '<td>' + menuBtn('data-people-manage', p.id, 'Manage ' + (p.name || p.email)) + '</td>'
          : '<td></td>') +
        '</tr>';
    }).join('');

    return chrome + ui().table(
      ['Name', 'Email', 'Job title', 'Status', 'Last sign-in', { html: '<span class="tma-portal-row-actions">Manage</span>' }],
      rows
    );
  }

  /* ── client contacts ────────────────────────────── */

  function renderClients() {
    var f = store.clients;
    var picked = selectedIds();

    var actions = state.caps.manageUsers
      ? ui().btn({ label: 'Add client contact', icon: 'Plus', attrs: ' data-people-create="client"' })
      : '';
    var right = state.caps.manageUsers
      ? ui().btn({ label: 'Delete selected', variant: 'danger', attrs: ' data-people-delete-users', disabled: !picked.length })
      : '';

    var chrome = head('Browse client contacts', 'Client accounts that can sign in to the portal.', actions) +
      feedProblem(f) + ui().alphaFilter(state.alpha) + toolbar('Search client contacts', right);

    if (!f.loaded) return chrome + ui().loading({ count: 6 });
    if (f.error) return chrome;

    var list = filtered(f.items);
    if (!list.length) {
      return chrome + ui().emptyState({
        illustration: 'Illustration14',
        title: f.items.length ? 'No client contacts match these filters' : 'No client contacts yet',
        subtitle: f.items.length
          ? 'Try a different letter or search.'
          : 'Client accounts appear here once they are created or a client accepts an invitation.',
      });
    }

    var rows = list.map(function (p) {
      var s = statusOf(p);
      return '<tr data-people-row="' + p.id + '">' +
        '<td><label class="tma-portal-checkbox"><input type="checkbox" data-people-select="' + p.id + '"' +
        (state.selected[p.id] ? ' checked' : '') + ' aria-label="Select ' + esc(p.name || p.email) + '"></label></td>' +
        nameCell(p) +
        '<td class="tma-portal-table__muted">' + esc(p.email) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.company || '—') + '</td>' +
        '<td>' + chip(s.label, s.variant) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.lastLogin || 'Never') + '</td>' +
        // No menu at all when every action in it would be refused.
        '<td>' + (state.caps.manageUsers || p.clientUid
          ? menuBtn('data-people-client-menu', p.id, 'Manage ' + (p.name || p.email))
          : '') + '</td>' +
        '</tr>';
    }).join('');

    return chrome + ui().table(
      ['', 'Name', 'Email', 'Company', 'Status', 'Last sign-in', { html: '<span class="tma-portal-row-actions">Manage</span>' }],
      rows
    );
  }

  /* One call for every invitation action. `person.invitationId` is the uuid;
     rows that are unused accounts rather than invitations never reach here. */
  function invitationAction(person, path, method, body) {
    var base = '/portal/invitations/' + encodeURIComponent(person.invitationId);
    return net(base + (path ? '/' + path : ''), {
      method: method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    });
  }

  /* ── prospects / invitation management ──────────── */

  /* The states an invitation can be looked at in. `waiting` is this screen's
     original question — who has not activated — and the rest open up the
     settled invitations that used to be invisible here entirely. */
  var INVITE_VIEWS = [
    { value: 'waiting', label: 'Still waiting' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'expired', label: 'Expired' },
    { value: 'failed', label: 'Failed to send' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'all', label: 'All invitations' },
  ];

  var INVITE_STATUS_LABEL = {
    pending: 'Queued',
    sent: 'Sent',
    delivered: 'Delivered',
    opened: 'Opened',
    accepted: 'Accepted',
    expired: 'Expired',
    cancelled: 'Cancelled',
    failed: 'Failed to send',
  };

  function inviteStatusChip(p) {
    if (p.source !== 'invite') {
      return p.awaitingApproval ? chip('Awaiting approval') : chip('Never signed in');
    }
    if (p.expired) return chip('Expired');
    return chip(INVITE_STATUS_LABEL[p.status] || p.status || 'Invited');
  }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderProspects() {
    var f = store.prospects;
    var counts = f.counts || {};

    var right = '<span class="tma-portal-subtitle">Showing</span>' +
      ui().select(INVITE_VIEWS.map(function (v) {
        var n = counts[v.value];
        return { value: v.value, label: v.label + (n ? ' (' + n + ')' : '') };
      }), state.inviteView || 'waiting', 'data-people-invite-view', 'Invitation status');

    // Titled to match the sidebar, which says Browse prospects in all 13 shells.
    var chrome = head('Browse prospects', 'Everyone invited, and how far each invitation got.') +
      feedProblem(f) + ui().alphaFilter(state.alpha) + toolbar('Search invitations', right);

    if (!f.loaded) return chrome + ui().loading({ count: 5 });
    if (f.error) return chrome;

    var list = filtered(f.items);
    if (!list.length) {
      return chrome + ui().emptyState({
        illustration: 'Illustration14',
        title: f.items.length ? 'Nothing matches these filters' : 'No invitations here',
        subtitle: f.items.length
          ? 'Try a different letter, search or status.'
          : 'People you invite appear here with the state of their invitation.',
      });
    }

    var rows = list.map(function (p) {
      // A failed send is the single most useful thing this screen can say, so
      // the reason sits under the address rather than behind a menu.
      var emailCell = esc(p.email) +
        (p.status === 'failed' && p.lastError
          ? '<br><span class="tma-portal-table__muted">' + esc(p.lastError) + '</span>'
          : '');
      var when = p.status === 'accepted'
        ? (shortDate(p.acceptedAt) || p.invited || '—')
        : (p.invited || '—');

      return '<tr data-people-row="' + esc(p.id) + '">' +
        nameCell(p) +
        '<td class="tma-portal-table__muted">' + emailCell + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.company || p.accountType || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(p.invitedBy || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(when) + '</td>' +
        '<td>' + inviteStatusChip(p) + '</td>' +
        (state.caps.manageUsers
          ? '<td>' + menuBtn('data-people-prospect-menu', p.id, 'Manage invitation for ' + (p.name || p.email)) + '</td>'
          : '<td></td>') +
        '</tr>';
    }).join('');

    return chrome + ui().table(
      ['Name', 'Email', 'Company', 'Invited by', 'When', 'Status',
        { html: '<span class="tma-portal-row-actions">Manage</span>' }],
      rows
    );
  }

  /* ── address books ──────────────────────────────── */

  function bookKey() { return state.screen === 'shared-address' ? 'shared' : 'personal'; }
  function bookScope() { return state.screen === 'shared-address' ? 'shared' : 'personal'; }

  function renderAddressBook() {
    var isShared = state.screen === 'shared-address';
    var f = store[bookKey()];
    var picked = selectedIds();

    var actions = ui().btn({ label: 'Add contact', icon: 'Plus', attrs: ' data-people-contact-add' });
    var right = ui().btn({
      label: 'Remove selected', variant: 'danger',
      attrs: ' data-people-contact-remove', disabled: !picked.length,
    });

    var chrome = head(
      isShared ? 'Shared Address Book' : 'Personal Address Book',
      isShared ? 'Contacts every employee can use.' : 'Contacts only you can see.',
      actions
    ) + feedProblem(f) + ui().alphaFilter(state.alpha) + toolbar('Search contacts', right);

    if (!f.loaded) return chrome + ui().loading({ count: 5 });
    if (f.error) return chrome;

    var list = filtered(f.items);
    if (!list.length) {
      return chrome + ui().emptyState({
        illustration: 'Illustration13',
        title: f.items.length ? 'No contacts match these filters' : 'This address book is empty',
        subtitle: f.items.length ? 'Try a different letter or search.' : 'Add a contact to keep their details here.',
      });
    }

    var rows = list.map(function (c) {
      return '<tr data-people-row="' + esc(c.id) + '">' +
        '<td><label class="tma-portal-checkbox"><input type="checkbox" data-people-select="' + esc(c.id) + '"' +
        (state.selected[c.id] ? ' checked' : '') + ' aria-label="Select ' + esc(c.name) + '"></label></td>' +
        '<td><strong>' + esc(c.name) + '</strong></td>' +
        '<td class="tma-portal-table__muted">' + esc(c.email || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(c.company || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(c.phone || '—') + '</td>' +
        // A shared entry someone else added is read-only unless you administer
        // the account, so it gets no menu rather than one that only errors.
        '<td>' + (c.canEdit === false ? '' : menuBtn('data-people-contact-menu', c.id, 'Manage ' + c.name)) + '</td>' +
        '</tr>';
    }).join('');

    return chrome + ui().table(
      ['', 'Name', 'Email', 'Company', 'Phone', { html: '<span class="tma-portal-row-actions">Manage</span>' }],
      rows
    );
  }

  /* ── distribution groups ────────────────────────── */

  var GROUP_TYPE_LABELS = {
    team: 'Team', department: 'Department', project: 'Project',
    committee: 'Committee', organization: 'Organization',
  };

  function renderGroups() {
    var f = store.groups;
    var canManage = !!(f.extra && f.extra.canManage);

    var actions = canManage
      ? ui().btn({ label: 'New group', icon: 'Plus', attrs: ' data-people-group-new' })
      : '';

    var chrome = head(
      'Distribution Groups',
      'Teams, departments, projects and committees. Share a calendar or invite a whole team at once.',
      actions
    ) + feedProblem(f) + toolbar('Search groups');

    if (!f.loaded) return chrome + ui().loading({ count: 4 });
    if (f.error) return chrome;

    var q = state.search.trim().toLowerCase();
    var list = f.items.filter(function (g) {
      return !q || (g.name + ' ' + (g.description || '')).toLowerCase().indexOf(q) !== -1;
    });

    if (!list.length) {
      return chrome + ui().emptyState({
        illustration: 'Illustration13',
        title: f.items.length ? 'No groups match that search' : 'No groups yet',
        subtitle: f.items.length
          ? 'Try a different search.'
          : 'Create a group to share calendars and invite several people at once.',
      });
    }

    var rows = list.map(function (g) {
      return '<tr data-people-row="' + esc(g.id) + '">' +
        '<td><strong>' + esc(g.name) + '</strong>' +
        (g.description ? '<div class="tma-portal-table__muted">' + esc(g.description) + '</div>' : '') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(GROUP_TYPE_LABELS[g.type] || g.type) + '</td>' +
        '<td class="tma-portal-table__muted">' + g.memberCount + ' member' + (g.memberCount === 1 ? '' : 's') +
        (g.autoJoin ? ' · all staff' : '') + '</td>' +
        '<td>' + menuBtn('data-people-group-menu', g.id, 'Manage ' + g.name) + '</td>' +
        '</tr>';
    }).join('');

    return chrome + ui().table(
      ['Group', 'Type', 'Members', { html: '<span class="tma-portal-row-actions">Manage</span>' }],
      rows
    );
  }

  /* ── resend welcome emails ──────────────────────── */

  function renderResend() {
    var f = store.candidates;

    var waiting = '';
    if (!f.loaded) {
      waiting = ui().loading({ count: 3 });
    } else if (f.error) {
      waiting = feedProblem(f);
    } else if (f.items.length) {
      var rows = f.items.map(function (p) {
        return '<tr data-people-row="' + esc(p.id) + '">' +
          '<td><strong>' + esc(p.name || p.email) + '</strong></td>' +
          '<td class="tma-portal-table__muted">' + esc(p.email) + '</td>' +
          '<td class="tma-portal-table__muted">' + esc(p.invited || '—') + '</td>' +
          '<td>' + ui().btn({ label: 'Send', small: true, variant: 'ghost', attrs: ' data-people-resend-one="' + esc(p.email) + '"' }) + '</td>' +
          '</tr>';
      }).join('');
      waiting = '<h3 class="tma-portal-section__title">Waiting to activate</h3>' +
        ui().table(['Name', 'Email', 'Invited', ''], rows);
    } else {
      waiting = ui().banner('info', 'Everyone in the account has signed in at least once.');
    }

    return head(
      'Resend Welcome Emails',
      'Send someone the email that gets them into the portal. Accounts that have never set a password get their activation link instead.'
    ) +
      '<div class="tma-portal-section__card" style="max-width:560px">' +
      ui().field('To', ui().input({ type: 'email', placeholder: 'Email address', attrs: ' data-resend-to' })) +
      '<div class="tma-portal-field"><span class="tma-portal-field__label">Message</span>' +
      '<textarea class="tma-portal-textarea" data-resend-msg rows="4" placeholder="Add a short note (optional)"></textarea></div>' +
      '<label class="tma-portal-checkbox"><input type="checkbox" data-resend-copy><span>Send me a copy</span></label>' +
      '<div class="tma-portal-form-actions">' +
      ui().btn({ label: 'Send', attrs: ' data-resend-send' }) +
      ui().btn({ label: 'Cancel', variant: 'ghost', attrs: ' data-resend-cancel' }) +
      '</div></div>' +
      waiting;
  }

  /* ── modals ─────────────────────────────────────── */

  var ACCOUNT_TYPES = ['Employee', 'Administrator'];

  /* Create an account (employee or client contact) through /admin/users. */
  function accountModal(kind) {
    var isClient = kind === 'client';
    ui().openModal({
      title: isClient ? 'Add client contact' : 'Create employee',
      body:
        ui().field('First name', ui().input({ attrs: ' data-acct-first' })) +
        ui().field('Last name', ui().input({ attrs: ' data-acct-last' })) +
        ui().field('Email address', ui().input({ type: 'email', attrs: ' data-acct-email' })) +
        (isClient ? '' : ui().field('Account type', ui().select(ACCOUNT_TYPES, 'Employee', 'data-acct-type', 'Account type'))) +
        ui().field('Phone (optional)', ui().input({ attrs: ' data-acct-phone' })) +
        ui().banner('info', 'They get an email with a link to set their own password.') +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: isClient ? 'Add contact' : 'Create employee', attrs: ' data-acct-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-acct-save]').addEventListener('click', function () {
          var first = host.querySelector('[data-acct-first]').value.trim();
          var last = host.querySelector('[data-acct-last]').value.trim();
          var email = host.querySelector('[data-acct-email]').value.trim();
          if (!first) { host.querySelector('[data-acct-first]').focus(); return; }
          if (!email) { host.querySelector('[data-acct-email]').focus(); return; }

          var typeEl = host.querySelector('[data-acct-type]');
          net('/admin/users', {
            method: 'POST',
            json: {
              name: (first + ' ' + last).trim(),
              email: email,
              account_type: isClient ? 'Client' : (typeEl ? typeEl.value : 'Employee'),
              phone: host.querySelector('[data-acct-phone]').value.trim() || null,
            },
          }).then(function () {
            ui().closeModal();
            ui().toast(isClient ? 'Client contact added' : 'Employee created');
            reload(isClient ? 'clients' : 'employees');
            reload('summary');
            reload('prospects');
          }).catch(function (e) {
            ui().toastError(errMsg(e, 'Couldn’t create that account.'));
          });
        });
      },
    });
  }

  function editAccountModal(person, feedKey) {
    ui().openModal({
      title: 'Edit ' + (person.name || person.email),
      body:
        ui().field('First name', ui().input({ attrs: ' data-acct-first', value: person.firstName || '' })) +
        ui().field('Last name', ui().input({ attrs: ' data-acct-last', value: person.lastName || '' })) +
        ui().field('Email address', ui().input({ type: 'email', attrs: ' data-acct-email', value: person.email || '' })) +
        ui().field('Account type', ui().select(
          ['Client', 'Employee', 'Administrator'], person.accountType, 'data-acct-type', 'Account type'
        )) +
        ui().field('Job title', ui().input({ attrs: ' data-acct-job', value: person.jobTitle || '' })) +
        ui().field('Phone', ui().input({ attrs: ' data-acct-phone', value: person.phone || '' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save changes', attrs: ' data-acct-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-acct-save]').addEventListener('click', function () {
          var first = host.querySelector('[data-acct-first]').value.trim();
          var last = host.querySelector('[data-acct-last]').value.trim();
          if (!first) { host.querySelector('[data-acct-first]').focus(); return; }
          if (!last) { host.querySelector('[data-acct-last]').focus(); return; }

          net('/admin/users/' + person.id, {
            method: 'PATCH',
            json: {
              first_name: first,
              last_name: last,
              email: host.querySelector('[data-acct-email]').value.trim(),
              account_type: host.querySelector('[data-acct-type]').value,
              job_title: host.querySelector('[data-acct-job]').value.trim() || null,
              phone: host.querySelector('[data-acct-phone]').value.trim() || null,
            },
          }).then(function () {
            ui().closeModal();
            ui().toast('Changes saved');
            reload(feedKey);
            reload('summary');
          }).catch(function (e) {
            ui().toastError(errMsg(e, 'Couldn’t save those changes.'));
          });
        });
      },
    });
  }

  function contactModal(existing) {
    var scope = bookScope();
    var key = bookKey();
    var c = existing || {};
    ui().openModal({
      title: existing ? 'Edit contact' : 'Add contact',
      body:
        ui().field('First name', ui().input({ attrs: ' data-contact-first', value: c.firstName || '' })) +
        ui().field('Last name', ui().input({ attrs: ' data-contact-last', value: c.lastName || '' })) +
        ui().field('Email address', ui().input({ type: 'email', attrs: ' data-contact-email', value: c.email || '' })) +
        ui().field('Company', ui().input({ attrs: ' data-contact-company', value: c.company || '' })) +
        ui().field('Phone', ui().input({ attrs: ' data-contact-phone', value: c.phone || '' })) +
        ui().field('Job title', ui().input({ attrs: ' data-contact-job', value: c.jobTitle || '' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: existing ? 'Save contact' : 'Add contact', attrs: ' data-contact-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-contact-save]').addEventListener('click', function () {
          var first = host.querySelector('[data-contact-first]').value.trim();
          if (!first) { host.querySelector('[data-contact-first]').focus(); return; }

          var payload = {
            scope: scope,
            first_name: first,
            last_name: host.querySelector('[data-contact-last]').value.trim() || null,
            email: host.querySelector('[data-contact-email]').value.trim() || null,
            company: host.querySelector('[data-contact-company]').value.trim() || null,
            phone: host.querySelector('[data-contact-phone]').value.trim() || null,
            job_title: host.querySelector('[data-contact-job]').value.trim() || null,
          };

          var req = existing
            ? net('/portal/contacts/' + encodeURIComponent(existing.id), { method: 'PATCH', json: payload })
            : net('/portal/contacts', { method: 'POST', json: payload });

          req.then(function () {
            ui().closeModal();
            ui().toast(existing ? 'Contact saved' : 'Contact added');
            reload(key);
            reload('summary');
          }).catch(function (e) {
            ui().toastError(errMsg(e, 'Couldn’t save that contact.'));
          });
        });
      },
    });
  }

  function staffPicker(selectedIdsList, disabled) {
    return net('/portal/groups/staff').then(function (d) {
      return (d && d.staff ? d.staff : []).map(function (p) {
        var on = (selectedIdsList || []).indexOf(p.id) !== -1;
        return '<label class="tma-portal-check-row">' +
          '<input type="checkbox" class="tma-dash__check" data-group-member="' + p.id + '"' +
          (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
          '<span>' + esc(p.name) + '<span class="tma-portal-table__muted"> · ' + esc(p.email) + '</span></span>' +
          '</label>';
      }).join('');
    });
  }

  function groupModal(existing) {
    var isEdit = !!existing;

    function open(staffRows, memberIds) {
      var typeOptions = Object.keys(GROUP_TYPE_LABELS).map(function (k) {
        var on = existing ? existing.type === k : k === 'team';
        return '<option value="' + k + '"' + (on ? ' selected' : '') + '>' + esc(GROUP_TYPE_LABELS[k]) + '</option>';
      }).join('');

      ui().openModal({
        title: isEdit ? 'Edit ' + existing.name : 'New group',
        body:
          ui().field('Group name', ui().input({ placeholder: 'e.g. Marketing Team', attrs: ' data-group-name', value: existing ? existing.name : '' })) +
          ui().field('Description', ui().input({ placeholder: 'What is this group for?', attrs: ' data-group-desc', value: existing ? (existing.description || '') : '' })) +
          ui().field('Type', '<select class="tma-portal-select" data-group-type>' + typeOptions + '</select>') +
          ui().field('Everyone on staff',
            '<label class="tma-portal-check-row"><input type="checkbox" class="tma-dash__check" data-group-auto' +
            (existing && existing.autoJoin ? ' checked' : '') + '>' +
            '<span>Membership follows the staff list — new joiners are added automatically</span></label>') +
          ui().field('Members',
            '<div class="tma-portal-check-list" data-group-members>' +
            (staffRows || '<p class="tma-portal-table__muted">No staff to add yet.</p>') + '</div>') +
          '<div class="tma-portal-form-actions">' +
          ui().btn({ label: isEdit ? 'Save group' : 'Create group', attrs: ' data-group-save' }) + '</div>',
        onMount: function (host) {
          // An auto-join group manages its own membership, so the picker is
          // meaningless for it.
          var auto = host.querySelector('[data-group-auto]');
          var list = host.querySelector('[data-group-members]');
          function syncAuto() {
            if (!auto || !list) return;
            list.style.opacity = auto.checked ? '0.4' : '';
            list.querySelectorAll('input').forEach(function (i) { i.disabled = auto.checked; });
          }
          if (auto) auto.addEventListener('change', syncAuto);
          syncAuto();

          host.querySelector('[data-group-save]').addEventListener('click', function () {
            var nameEl = host.querySelector('[data-group-name]');
            var name = nameEl.value.trim();
            if (!name) { nameEl.focus(); return; }

            var chosen = Array.prototype.slice
              .call(host.querySelectorAll('[data-group-member]:checked'))
              .map(function (i) { return Number(i.getAttribute('data-group-member')); });

            var payload = {
              name: name,
              description: host.querySelector('[data-group-desc]').value.trim() || null,
              group_type: host.querySelector('[data-group-type]').value,
              auto_join: !!(auto && auto.checked),
            };

            var req;
            if (isEdit) {
              req = net('/portal/groups/' + encodeURIComponent(existing.id), { method: 'PATCH', json: payload })
                .then(function () { return syncMembers(existing, memberIds, chosen, payload.auto_join); });
            } else {
              payload.memberIds = chosen;
              req = net('/portal/groups', { method: 'POST', json: payload });
            }

            req.then(function () {
              ui().closeModal();
              ui().toast(isEdit ? 'Group saved' : 'Group created');
              reload('groups');
              reload('summary');
            }).catch(function (e) {
              ui().toastError(errMsg(e, 'Couldn’t save that group.'));
            });
          });
        },
      });
    }

    if (!isEdit) {
      staffPicker([], false).then(function (rows) { open(rows, []); })
        .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t load the staff list.')); });
      return;
    }

    // Editing: the picker starts from who is actually in the group.
    net('/portal/groups/' + encodeURIComponent(existing.id) + '/members')
      .then(function (d) {
        var memberIds = (d && d.members ? d.members : []).map(function (m) { return m.userId; });
        return staffPicker(memberIds, false).then(function (rows) { open(rows, memberIds); });
      })
      .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t load that group.')); });
  }

  /* Membership is edited as a set; send only what actually changed. */
  function syncMembers(group, before, after, autoJoin) {
    if (autoJoin) return Promise.resolve();

    var added = after.filter(function (id) { return before.indexOf(id) === -1; });
    var removed = before.filter(function (id) { return after.indexOf(id) === -1; });
    var base = '/portal/groups/' + encodeURIComponent(group.id) + '/members';

    var chain = added.length
      ? net(base, { method: 'POST', json: { memberIds: added } })
      : Promise.resolve();

    return removed.reduce(function (p, id) {
      return p.then(function () { return net(base + '/' + id, { method: 'DELETE' }); });
    }, chain);
  }

  /* ── actions ────────────────────────────────────── */

  function findPerson(key, id) {
    return store[key].items.filter(function (p) { return String(p.id) === String(id); })[0];
  }

  function sendWelcome(email, opts) {
    var o = opts || {};
    return net('/portal/people/welcome', {
      method: 'POST',
      json: { email: email, message: o.message || null, copyToMe: !!o.copyToMe },
    }).then(function (d) {
      ui().toast(d && d.kind === 'activation' ? 'Activation link sent' : 'Welcome email sent');
      return d;
    }).catch(function (e) {
      ui().toastError(errMsg(e, 'Couldn’t send that email.'));
      throw e;
    });
  }

  function deleteUser(person, feedKey) {
    if (!window.confirm('Delete ' + (person.name || person.email) + '? Their account and sessions are removed.')) return;
    net('/admin/users/' + person.id, { method: 'DELETE' })
      .then(function () {
        ui().toast('Account deleted');
        reload(feedKey);
        reload('summary');
      })
      .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t delete that account.')); });
  }

  /* ── render ─────────────────────────────────────── */

  var SCREEN_FEED = {
    home: 'summary',
    employees: 'employees',
    clients: 'clients',
    prospects: 'prospects',
    'shared-address': 'shared',
    'personal-address': 'personal',
    groups: 'groups',
    resend: 'candidates',
  };

  function render() {
    var el = state.el;
    if (!el) return;

    ensure(SCREEN_FEED[state.screen]);
    // The home cards are gated on capabilities, which arrive with the summary.
    if (state.screen !== 'home') ensure('summary');

    var body;
    if (state.screen === 'home') body = renderHome();
    else if (state.screen === 'employees') body = renderEmployees();
    else if (state.screen === 'clients') body = renderClients();
    else if (state.screen === 'prospects') body = renderProspects();
    else if (state.screen === 'shared-address' || state.screen === 'personal-address') body = renderAddressBook();
    else if (state.screen === 'groups') body = renderGroups();
    else body = renderResend();

    MORPH.patch(el, '<div class="tma-portal-page">' + body + '</div>');
    wire();
  }

  function wire() {
    var el = state.el;

    /* home cards + quick actions */
    MORPH.unwired(el, '[data-people-link]').forEach(function (card) {
      card.addEventListener('click', function () {
        var title = card.getAttribute('data-people-title');
        navigate(card.getAttribute('data-people-link'), title, 'People / ' + title);
      });
    });
    MORPH.unwired(el, '[data-people-quick]').forEach(function (b) {
      b.addEventListener('click', function () { accountModal(b.getAttribute('data-people-quick')); });
    });

    /* filters */
    MORPH.unwired(el, '[data-alpha]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.alpha = b.getAttribute('data-alpha');
        render();
      });
    });
    ui().wireToolbarSearch(el, '[data-people-search]', function (value) {
      state.search = value;
      render();
    });
    var inviteView = MORPH.unwiredOne(el, '[data-people-invite-view]');
    if (inviteView) {
      inviteView.addEventListener('change', function () {
        state.inviteView = inviteView.value;
        // The server decides which invitations belong to each view, so the
        // list is refetched rather than filtered in the browser.
        store.prospects.loaded = false;
        reload('prospects');
        render();
      });
    }

    var status = el.querySelector('[data-people-status]');
    MORPH.on(status, 'change', function () {
      state.statusFilter = status.value;
      render();
    });

    /* selection */
    MORPH.unwired(el, '[data-people-select]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.selected[cb.getAttribute('data-people-select')] = cb.checked;
        render();
      });
    });

    /* create */
    MORPH.unwired(el, '[data-people-create]').forEach(function (b) {
      b.addEventListener('click', function () { accountModal(b.getAttribute('data-people-create')); });
    });

    /* employee row menu */
    MORPH.unwired(el, '[data-people-manage]').forEach(function (b) {
      var person = findPerson('employees', b.getAttribute('data-people-manage'));
      if (!person) return;
      ui().wireMenu(b, [
        { label: 'Edit details', action: 'edit' },
        { label: 'Send password reset', action: 'reset' },
        { label: person.lastLogin ? 'Resend welcome email' : 'Resend activation email', action: 'welcome' },
        person.status === 'suspended'
          ? { label: 'Reactivate account', action: 'reactivate' }
          : { label: 'Suspend account', action: 'suspend', disabled: person.self },
        { label: 'Delete employee', action: 'delete', disabled: person.self },
      ], function (item) {
        if (item.action === 'edit') editAccountModal(person, 'employees');
        else if (item.action === 'reset') {
          net('/admin/users/' + person.id + '/send-reset', { method: 'POST' })
            .then(function () { ui().toast('Password reset sent'); })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t send that reset link.')); });
        } else if (item.action === 'welcome') {
          sendWelcome(person.email).then(function () { reload('prospects'); }).catch(function () {});
        } else if (item.action === 'suspend' || item.action === 'reactivate') {
          net('/admin/users/' + person.id + '/' + item.action, { method: 'POST' })
            .then(function () {
              ui().toast(item.action === 'suspend' ? 'Account suspended' : 'Account reactivated');
              reload('employees');
            })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t update that account.')); });
        } else if (item.action === 'delete') {
          deleteUser(person, 'employees');
        }
      });
    });

    /* client contact row menu */
    MORPH.unwired(el, '[data-people-client-menu]').forEach(function (b) {
      var person = findPerson('clients', b.getAttribute('data-people-client-menu'));
      if (!person) return;
      // Only what this viewer may actually do — the writes below are all
      // administrator-only, so an employee gets the client record link alone.
      var items = [];
      if (state.caps.manageUsers) items.push({ label: 'Edit details', action: 'edit' });
      if (person.clientUid) items.push({ label: 'Open client record', action: 'open' });
      if (state.caps.manageUsers) {
        items.push({ label: person.lastLogin ? 'Resend welcome email' : 'Resend activation email', action: 'welcome' });
        items.push({ label: 'Delete contact', action: 'delete' });
      }
      if (!items.length) return;

      ui().wireMenu(b, items, function (item) {
        if (item.action === 'edit') editAccountModal(person, 'clients');
        else if (item.action === 'open') {
          window.location.href = ROOT + '/clients/' + encodeURIComponent(person.clientUid);
        } else if (item.action === 'welcome') {
          sendWelcome(person.email).catch(function () {});
        } else if (item.action === 'delete') {
          deleteUser(person, 'clients');
        }
      });
    });

    /* bulk delete of client accounts */
    var deleteUsers = MORPH.unwiredOne(el, '[data-people-delete-users]');
    if (deleteUsers) deleteUsers.addEventListener('click', function () {
      var ids = selectedIds().map(Number);
      if (!ids.length) return;
      if (!window.confirm('Delete ' + ids.length + ' account' + (ids.length === 1 ? '' : 's') + '?')) return;
      net('/admin/users/bulk-delete', { method: 'POST', json: { ids: ids } })
        .then(function (d) {
          state.selected = {};
          ui().toast('Deleted ' + (d && d.deleted ? d.deleted : ids.length));
          reload('clients');
          reload('summary');
        })
        .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t delete those accounts.')); });
    });

    /* prospect row menu */
    MORPH.unwired(el, '[data-people-prospect-menu]').forEach(function (b) {
      var id = b.getAttribute('data-people-prospect-menu');
      var person = findPerson('prospects', id);
      if (!person) return;
      var items = [];
      if (person.source === 'invite') {
        if (person.canResend !== false) items.push({ label: 'Resend invitation', action: 'welcome' });
        if (person.canCancel) items.push({ label: 'Copy invitation link', action: 'link' });
        if (person.canCancel) items.push({ label: 'Change email address', action: 'recipient' });
        if (person.canCancel) items.push({ label: 'Cancel invitation', action: 'cancel' });
        if (!person.canCancel) items.push({ label: 'Delete this record', action: 'purge' });
      } else {
        items.push({ label: 'Resend activation email', action: 'welcome' });
        items.push({ label: 'Remove account', action: 'cancel' });
      }

      ui().wireMenu(b, items, function (item) {
        if (item.action === 'link') {
          invitationAction(person, 'link', 'POST').then(function (res) {
            var url = res && res.url;
            if (!url) return;
            var done = function () { ui().toast('Link copied — it replaces any link already sent'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(done, function () { window.prompt('Invitation link', url); });
            } else {
              window.prompt('Invitation link', url);
            }
          }).catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t create a link.')); });
          return;
        }

        if (item.action === 'recipient') {
          var next = window.prompt('Send this invitation to a different address:', person.email);
          if (!next || next === person.email) return;
          invitationAction(person, 'recipient', 'PATCH', { email: next })
            .then(function () { ui().toast('Invitation resent to ' + next); reload('prospects'); })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t change the address.')); });
          return;
        }

        if (item.action === 'purge') {
          if (!window.confirm('Delete the invitation record for ' + person.email + '?')) return;
          invitationAction(person, '', 'DELETE')
            .then(function () { ui().toast('Record deleted'); reload('prospects'); reload('summary'); })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t delete that.')); });
          return;
        }

        if (item.action === 'welcome') {
          sendWelcome(person.email).then(function () { reload('prospects'); }).catch(function () {});
        } else {
          var q = person.source === 'invite'
            ? 'Cancel the invitation to ' + person.email + '?'
            : 'Remove the unused account for ' + person.email + '?';
          if (!window.confirm(q)) return;
          net('/portal/people/prospects/' + encodeURIComponent(person.id), { method: 'DELETE' })
            .then(function () {
              ui().toast(person.source === 'invite' ? 'Invitation cancelled' : 'Account removed');
              reload('prospects');
              reload('summary');
            })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t do that.')); });
        }
      });
    });

    /* address books */
    var addContact = MORPH.unwiredOne(el, '[data-people-contact-add]');
    if (addContact) addContact.addEventListener('click', function () { contactModal(null); });

    MORPH.unwired(el, '[data-people-contact-menu]').forEach(function (b) {
      var contact = findPerson(bookKey(), b.getAttribute('data-people-contact-menu'));
      if (!contact) return;
      ui().wireMenu(b, [
        { label: 'Edit contact', action: 'edit' },
        { label: 'Remove contact', action: 'remove' },
      ], function (item) {
        if (item.action === 'edit') { contactModal(contact); return; }
        if (!window.confirm('Remove ' + contact.name + ' from this address book?')) return;
        net('/portal/contacts/' + encodeURIComponent(contact.id), { method: 'DELETE' })
          .then(function () {
            ui().toast('Contact removed');
            reload(bookKey());
            reload('summary');
          })
          .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t remove that contact.')); });
      });
    });

    var removeContacts = MORPH.unwiredOne(el, '[data-people-contact-remove]');
    if (removeContacts) removeContacts.addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) return;
      if (!window.confirm('Remove ' + ids.length + ' contact' + (ids.length === 1 ? '' : 's') + '?')) return;
      net('/portal/contacts/bulk-delete', { method: 'POST', json: { ids: ids, scope: bookScope() } })
        .then(function (d) {
          state.selected = {};
          ui().toast('Removed ' + (d && d.deleted != null ? d.deleted : ids.length));
          reload(bookKey());
          reload('summary');
        })
        .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t remove those contacts.')); });
    });

    /* groups */
    var newGroup = MORPH.unwiredOne(el, '[data-people-group-new]');
    if (newGroup) newGroup.addEventListener('click', function () { groupModal(null); });

    MORPH.unwired(el, '[data-people-group-menu]').forEach(function (b) {
      var group = findPerson('groups', b.getAttribute('data-people-group-menu'));
      if (!group) return;
      var canManage = !!(store.groups.extra && store.groups.extra.canManage);
      ui().wireMenu(b, [
        { label: 'View members', action: 'members' },
        { label: 'Edit group', action: 'edit', disabled: !canManage },
        { label: 'Delete group', action: 'delete', disabled: !canManage },
      ], function (item) {
        if (item.action === 'members') {
          net('/portal/groups/' + encodeURIComponent(group.id) + '/members')
            .then(function (d) {
              var members = (d && d.members) || [];
              ui().openModal({
                title: group.name + ' · members',
                body: members.length
                  ? '<div class="tma-portal-check-list">' + members.map(function (m) {
                      return '<div class="tma-portal-check-row"><span>' + esc(m.name) +
                        '<span class="tma-portal-table__muted"> · ' + esc(m.email) + '</span></span></div>';
                    }).join('') + '</div>'
                  : '<p class="tma-portal-table__muted">This group has no members yet.</p>',
              });
            })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t load the members.')); });
        } else if (item.action === 'edit') {
          groupModal(group);
        } else if (item.action === 'delete') {
          if (!window.confirm('Delete “' + group.name + '”? Calendars shared with it lose that access.')) return;
          net('/portal/groups/' + encodeURIComponent(group.id), { method: 'DELETE' })
            .then(function () {
              ui().toast('Group deleted');
              reload('groups');
              reload('summary');
            })
            .catch(function (e) { ui().toastError(errMsg(e, 'Couldn’t delete that group.')); });
        }
      });
    });

    /* resend welcome emails */
    var send = MORPH.unwiredOne(el, '[data-resend-send]');
    if (send) send.addEventListener('click', function () {
      var to = el.querySelector('[data-resend-to]');
      var msg = el.querySelector('[data-resend-msg]');
      var copy = el.querySelector('[data-resend-copy]');
      if (!to.value.trim()) { to.focus(); return; }
      sendWelcome(to.value.trim(), {
        message: msg ? msg.value.trim() : '',
        copyToMe: !!(copy && copy.checked),
      }).then(function () {
        to.value = '';
        if (msg) msg.value = '';
        if (copy) copy.checked = false;
        reload('candidates');
        reload('prospects');
      }).catch(function () {});
    });

    var cancel = MORPH.unwiredOne(el, '[data-resend-cancel]');
    if (cancel) cancel.addEventListener('click', function () {
      navigate('people-home', 'Manage users', 'People / Manage users');
    });

    MORPH.unwired(el, '[data-people-resend-one]').forEach(function (b) {
      b.addEventListener('click', function () {
        sendWelcome(b.getAttribute('data-people-resend-one'))
          .then(function () { reload('candidates'); })
          .catch(function () {});
      });
    });
  }

  /* ── mount ──────────────────────────────────────── */

  function mount(el, opts) {
    state.el = el;
    var next = (opts && opts.navId && SCREEN_FOR_NAV[opts.navId]) || null;
    if (next && next !== state.screen) {
      // A different screen starts clean — a letter or search left over from
      // the last list would silently hide rows on this one.
      state.alpha = 'All';
      state.search = '';
      state.selected = {};
      state.statusFilter = 'All employees';
      state.screen = next;
    }
    render();
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('people', mount);

  /*
   * Live updates: employees, client contacts, address books, groups and
   * invitations all read from tables other people are editing.
   *
   * Only the feed behind the screen on show is refetched, plus the summary
   * counts the other screens display — refetching all eight caches on every
   * signal would be seven wasted requests for a list nobody is looking at.
   */
  if (window.TMALive) {
    var refreshPeople = function () {
      liveRefreshing = true;

      try {
        var key = SCREEN_FEED[state.screen];
        if (key) reload(key);
        reload('summary');
      } finally {
        // reload() kicks the fetches off synchronously; the flag only has to
        // survive until load() has read it.
        liveRefreshing = false;
      }
    };

    var watchPeople = function (resource) {
      window.TMALive.register(resource, refreshPeople, {
        active: function () { return !!state.el && document.contains(state.el); },
      });
    };

    // People is assembled from accounts *and* the client directory, so it has
    // to listen for both — a new client contact is not a `users` change.
    watchPeople(window.TMALive.RESOURCES.USERS);
    watchPeople(window.TMALive.RESOURCES.CLIENTS);
    watchPeople(window.TMALive.RESOURCES.CONTACTS);
  }
})();
