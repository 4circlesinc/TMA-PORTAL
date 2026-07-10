/*
 * TMA — Portal People section
 * Manage users home, Browse employees, Browse client contacts,
 * Browse prospects, Shared / Personal address books, Distribution
 * groups, Resend welcome emails.
 * Registers view: 'people'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  var state = {
    el: null,
    screen: 'home',
    alpha: 'All',
    search: '',
    statusFilter: 'All employees',
    selected: {},
  };

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

  function navigate(navId, title, crumb) {
    if (window.TMADashboard) window.TMADashboard.navigate({ navId: navId, view: 'people', title: title, crumb: crumb });
  }

  function displayName(p) {
    return (p.lastName ? p.lastName + ', ' : '') + p.firstName;
  }

  function matchesFilters(p) {
    if (state.alpha !== 'All' && state.alpha !== '#') {
      var letter = (p.lastName || p.firstName || '').charAt(0).toUpperCase();
      if (letter !== state.alpha) return false;
    }
    if (state.alpha === '#') {
      var first = (p.lastName || p.firstName || '').charAt(0);
      if (/[a-z]/i.test(first)) return false;
    }
    var q = state.search.toLowerCase();
    if (q) {
      var hay = (p.firstName + ' ' + (p.lastName || '') + ' ' + p.email + ' ' + (p.company || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function personModal(kind, onDone, existing) {
    var isEmployee = kind === 'employee';
    ui().openModal({
      title: existing ? 'Edit ' + kind : (isEmployee ? 'Create employee' : kind === 'client' ? 'Add client contact' : 'Add ' + kind),
      body:
        ui().field('First name', ui().input({ attrs: 'data-person-first', value: existing ? existing.firstName : '' })) +
        ui().field('Last name', ui().input({ attrs: 'data-person-last', value: existing ? existing.lastName : '' })) +
        ui().field('Email address', ui().input({ type: 'email', attrs: 'data-person-email', value: existing ? existing.email : '' })) +
        ui().field('Company', ui().input({ attrs: 'data-person-company', value: existing ? existing.company || '' : '' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: existing ? 'Save' : (isEmployee ? 'Create' : 'Add'), attrs: 'data-person-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-person-save]').addEventListener('click', function () {
          var first = host.querySelector('[data-person-first]').value.trim();
          var email = host.querySelector('[data-person-email]').value.trim();
          if (!first || !email) { host.querySelector(first ? '[data-person-email]' : '[data-person-first]').focus(); return; }
          var record = {
            firstName: first,
            lastName: host.querySelector('[data-person-last]').value.trim(),
            email: email,
            company: host.querySelector('[data-person-company]').value.trim(),
          };
          onDone(record, existing);
          ui().closeModal();
        });
      },
    });
  }

  /* ── home ───────────────────────────────────────── */
  var HOME_LINKS = [
    { nav: 'people-employees', title: 'Browse employees', desc: 'Manage employee accounts, permissions and personal folders.', icon: 'UserList' },
    { nav: 'people-clients', title: 'Browse client contacts', desc: 'Manage the clients you exchange files with.', icon: 'AddressBook' },
    { nav: 'people-prospects', title: 'Browse prospects', desc: 'People invited to the portal who have not activated yet.', icon: 'UserCirclePlus' },
    { nav: 'people-shared-address', title: 'Shared address book', desc: 'Account-wide contacts available to every employee.', icon: 'BookOpen' },
    { nav: 'people-personal-address', title: 'Personal address book', desc: 'Your private contacts.', icon: 'Book' },
    { nav: 'people-groups', title: 'Distribution groups', desc: 'Send and share with many people at once.', icon: 'UsersThree' },
    { nav: 'people-resend', title: 'Resend welcome emails', desc: 'Re-invite users who have not signed in yet.', icon: 'PaperPlaneTilt' },
  ];

  function renderHome() {
    var s = data().state();
    return '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Manage users</h2>' +
      '<p class="tma-portal-subtitle">' + s.employees.length + ' employee' + (s.employees.length === 1 ? '' : 's') + ' · ' +
      s.clientContacts.length + ' client contact' + (s.clientContacts.length === 1 ? '' : 's') + '</p>' +
      '</div><div class="tma-portal-head__actions">' +
      ui().btn({ label: 'Create employee', icon: 'UserPlus', attrs: 'data-people-quick="employee"' }) +
      ui().btn({ label: 'Add client contact', icon: 'Plus', variant: 'ghost', attrs: 'data-people-quick="client"' }) +
      '</div></div>' +
      '<div class="tma-portal-card-grid">' +
      HOME_LINKS.map(function (l) {
        return '<button type="button" class="tma-portal-tpl-card" data-people-link="' + l.nav + '" data-people-title="' + ui().esc(l.title) + '" style="cursor:pointer;text-align:left;font-family:inherit">' +
          '<div class="tma-portal-tpl-card__preview"><img src="images/icons/phosphor/' + l.icon + '.svg" alt=""></div>' +
          '<h3 class="tma-portal-tpl-card__name">' + ui().esc(l.title) + '</h3>' +
          '<p class="tma-portal-tpl-card__desc">' + ui().esc(l.desc) + '</p>' +
          '</button>';
      }).join('') +
      '</div>';
  }

  /* ── employees ──────────────────────────────────── */
  function renderEmployees() {
    var s = data().state();
    var list = s.employees.filter(matchesFilters);
    var atLimit = s.employees.length >= s.trial.employeeLimit;

    var rows = list.map(function (p) {
      return '<tr>' +
        '<td><span class="tma-portal-avatar-cell">' +
        '<img src="images/avatars/AvatarByewind.png" alt="">' +
        '<strong>' + ui().esc(displayName(p)) + '</strong>' +
        (p.admin ? ' <span class="tma-portal-chip">Admin</span>' : '') +
        '</span></td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(p.email) + '</td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(p.lastLogin || '—') + '</td>' +
        '<td><div class="tma-portal-row-actions">' +
        '<button type="button" class="tma-portal-icon-btn" data-people-manage="' + p.id + '" title="Manage" aria-label="Manage ' + ui().esc(p.firstName) + '"><img src="images/icons/phosphor/GearSix.svg" alt=""></button>' +
        '</div></td></tr>';
    }).join('') || '<tr class="tma-portal-table__empty"><td colspan="4">No employees match your filters.</td></tr>';

    return '<div class="tma-portal-head"><h2 class="tma-portal-head__title">Browse Employees</h2>' +
      '<div class="tma-portal-head__actions">' + ui().btn({ label: 'Create employee', attrs: 'data-people-create-employee', disabled: atLimit }) + '</div></div>' +
      ui().alphaFilter(state.alpha) +
      '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group">' +
      ui().searchInput('Search Employees', 'data-people-search', state.search) +
      '<span class="tma-portal-subtitle">Showing</span>' +
      ui().select(['All employees', 'Active', 'Not activated'], state.statusFilter, 'data-people-status', 'Employee status') +
      '</div></div>' +
      ui().table(['Name', 'Email', 'Last Login', { html: '<span class="tma-portal-row-actions">Manage</span>' }], rows);
  }

  /* ── clients / prospects ────────────────────────── */
  function renderContacts(kind) {
    var s = data().state();
    var isClients = kind === 'clients';
    var source = isClients ? s.clientContacts : s.prospects;
    var list = source.filter(matchesFilters);
    var hasSelection = Object.keys(state.selected).some(function (k) { return state.selected[k]; });

    var rows = list.map(function (p) {
      return '<tr>' +
        '<td><label class="tma-portal-checkbox"><input type="checkbox" data-people-select="' + p.id + '"' + (state.selected[p.id] ? ' checked' : '') + '></label></td>' +
        '<td><strong>' + ui().esc(displayName(p)) + '</strong></td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(p.email) + '</td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(p.company || '—') + '</td>' +
        '</tr>';
    }).join('');

    var title = isClients ? 'Browse client contacts' : 'Browse prospects';
    var emptyText = isClients ? 'There are no matching client contacts.' : 'There are no matching prospects.';

    return '<div class="tma-portal-head"><h2 class="tma-portal-head__title">' + title + '</h2>' +
      '<div class="tma-portal-head__actions">' +
      ui().btn({ label: isClients ? 'Add client contact' : 'Add prospect', attrs: 'data-people-add-contact' }) +
      '</div></div>' +
      ui().alphaFilter(state.alpha) +
      '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group">' + ui().searchInput('Search ' + (isClients ? 'client contacts' : 'prospects'), 'data-people-search', state.search) + '</div>' +
      '<div class="tma-portal-toolbar__group">' +
      (isClients ? ui().btn({ label: 'Send agreement', variant: 'ghost', attrs: 'data-people-agreement', disabled: !hasSelection }) : '') +
      ui().btn({ label: 'Delete Selected', variant: 'danger', attrs: 'data-people-delete-selected', disabled: !hasSelection }) +
      '</div></div>' +
      (list.length
        ? ui().table(['', 'Name', 'Email', 'Company'], rows)
        : ui().emptyState({ illustration: 'Illustration14', title: emptyText, subtitle: 'People you add will appear in this list.' }));
  }

  /* ── address books ──────────────────────────────── */
  function renderAddressBook(kind) {
    var s = data().state();
    var isShared = kind === 'shared-address';
    var source = isShared ? s.sharedAddressBook : s.personalAddressBook;
    var list = source.filter(matchesFilters);
    var hasSelection = Object.keys(state.selected).some(function (k) { return state.selected[k]; });

    var rows = list.map(function (p) {
      return '<tr>' +
        '<td><label class="tma-portal-checkbox"><input type="checkbox" data-people-select="' + p.id + '"' + (state.selected[p.id] ? ' checked' : '') + '></label></td>' +
        '<td><strong>' + ui().esc(displayName(p)) + '</strong></td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(p.email) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="tma-portal-head"><h2 class="tma-portal-head__title">' + (isShared ? 'Shared Address Book' : 'Personal Address Book') + '</h2></div>' +
      ui().alphaFilter(state.alpha) +
      '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group">' + ui().searchInput('Search Users', 'data-people-search', state.search) + '</div>' +
      '<div class="tma-portal-toolbar__group">' +
      ui().btn({ label: 'Remove Selected', variant: 'danger', attrs: 'data-people-delete-selected', disabled: !hasSelection }) +
      ui().btn({ label: 'Add New User', attrs: 'data-people-add-contact' }) +
      '</div></div>' +
      (list.length
        ? ui().table(['', 'Name', 'Email'], rows)
        : '<div class="tma-portal-table-wrap"><div class="tma-portal-empty" style="padding:var(--space-24)">' +
          '<p class="tma-portal-empty__subtitle">No users in this address book yet.</p></div></div>');
  }

  /* ── distribution groups ────────────────────────── */
  function renderGroups() {
    var s = data().state();
    var rows = s.distributionGroups.map(function (g) {
      return '<tr><td><strong>' + ui().esc(g.name) + '</strong></td>' +
        '<td class="tma-portal-table__muted">' + g.members.length + ' member' + (g.members.length === 1 ? '' : 's') + '</td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(g.created) + '</td>' +
        '<td><div class="tma-portal-row-actions">' +
        '<button type="button" class="tma-portal-icon-btn" data-people-group-delete="' + g.id + '" title="Delete group" aria-label="Delete group"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
        '</div></td></tr>';
    }).join('');

    return '<div class="tma-portal-head"><h2 class="tma-portal-head__title">Distribution Groups</h2>' +
      '<div class="tma-portal-head__actions">' + ui().btn({ label: 'New group', icon: 'Plus', attrs: 'data-people-new-group' }) + '</div></div>' +
      (s.distributionGroups.length
        ? ui().table(['Group', 'Members', 'Created', ''], rows)
        : ui().emptyState({
            illustration: 'Illustration13',
            title: 'No distribution groups yet',
            subtitle: 'Create a group to share folders or send messages to many people at once.',
          }));
  }

  /* ── resend welcome emails ──────────────────────── */
  function renderResend() {
    var s = data().state();
    return '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Resend Welcome Emails</h2>' +
      '<p class="tma-portal-subtitle">Send a customized message to let the new users know they’ve been added to the account. Email addresses must be verified to allow users access.</p>' +
      '</div></div>' +
      '<div class="tma-portal-section__card" style="max-width:560px">' +
      ui().field('To:', ui().input({ type: 'email', placeholder: 'Email Address', attrs: 'data-resend-to' })) +
      (s.trial.active ? ui().banner('info', 'You can customize this welcome message once you upgrade from a trial account.') : '') +
      '<div class="tma-portal-field"><span class="tma-portal-field__label">Message:</span>' +
      '<textarea class="tma-portal-textarea" data-resend-msg' + (s.trial.active ? ' disabled' : '') + ' placeholder="I’ve added you to my ' + ui().esc(s.user.company) + ' portal account!"></textarea></div>' +
      '<label class="tma-portal-checkbox"><input type="checkbox" data-resend-copy><span>Send me a copy of this email</span></label>' +
      '<button type="button" class="tma-portal-link" data-resend-preview style="align-self:flex-end">Preview Email</button>' +
      '<div class="tma-portal-form-actions">' +
      ui().btn({ label: 'Notify', attrs: 'data-resend-notify' }) +
      ui().btn({ label: 'Skip', variant: 'ghost', attrs: 'data-resend-skip' }) +
      '</div></div>';
  }

  /* ── render + wiring ────────────────────────────── */
  function render() {
    var el = state.el;
    if (!el) return;
    var s = data().state();

    var body;
    if (state.screen === 'home') body = renderHome();
    else if (state.screen === 'employees') body = renderEmployees();
    else if (state.screen === 'clients') body = renderContacts('clients');
    else if (state.screen === 'prospects') body = renderContacts('prospects');
    else if (state.screen === 'shared-address') body = renderAddressBook('shared-address');
    else if (state.screen === 'personal-address') body = renderAddressBook('personal-address');
    else if (state.screen === 'groups') body = renderGroups();
    else body = renderResend();

    el.innerHTML = '<div class="tma-portal-page">' + body + '</div>';

    /* home links + quick actions */
    el.querySelectorAll('[data-people-link]').forEach(function (card) {
      card.addEventListener('click', function () {
        var nav = card.getAttribute('data-people-link');
        var title = card.getAttribute('data-people-title');
        navigate(nav, title, 'People / ' + title);
      });
    });
    el.querySelectorAll('[data-people-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-people-quick');
        if (kind === 'employee') { navigate('people-employees', 'Browse employees', 'People / Browse employees'); setTimeout(function () { createEmployee(); }, 60); }
        else { navigate('people-clients', 'Browse client contacts', 'People / Browse client contacts'); setTimeout(function () { addContact('clients'); }, 60); }
      });
    });

    /* alpha + search + status filters */
    el.querySelectorAll('[data-alpha]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.alpha = b.getAttribute('data-alpha');
        render();
      });
    });
    var search = el.querySelector('[data-people-search]');
    if (search) search.addEventListener('input', function () { state.search = search.value; render(); moveFocus(search); });
    var status = el.querySelector('[data-people-status]');
    if (status) status.addEventListener('change', function () { state.statusFilter = status.value; render(); });

    function moveFocus(oldInput) {
      var fresh = el.querySelector('[data-people-search]');
      if (fresh && oldInput !== fresh) {
        fresh.focus();
        fresh.setSelectionRange(fresh.value.length, fresh.value.length);
      }
    }

    /* employees */
    function createEmployee() {
      if (s.employees.length >= s.trial.employeeLimit) { ui().toast('Employee limit reached — upgrade to add more users'); return; }
      personModal('employee', function (record) {
        record.id = data().uid('emp');
        record.lastLogin = '—';
        record.admin = false;
        s.employees.push(record);
        data().save();
        data().logNotification('Welcome email sent to ' + record.email, record.email);
        ui().toast('Employee created');
        render();
      });
    }
    var createBtn = el.querySelector('[data-people-create-employee]');
    if (createBtn) createBtn.addEventListener('click', createEmployee);

    el.querySelectorAll('[data-people-manage]').forEach(function (b) {
      var person = s.employees.filter(function (p) { return p.id === b.getAttribute('data-people-manage'); })[0];
      if (!person) return;
      ui().wireMenu(b, [
        { label: 'Edit employee', action: 'edit' },
        { label: 'Resend welcome email', action: 'resend' },
        { label: 'Delete employee', action: 'delete', disabled: person.admin },
      ], function (item) {
        if (item.action === 'edit') {
          personModal('employee', function (record, existing) {
            Object.assign(existing, record);
            data().save();
            ui().toast('Employee updated');
            render();
          }, person);
        } else if (item.action === 'resend') {
          data().logNotification('Welcome email re-sent to ' + person.email, person.email);
          ui().toast('Welcome email sent');
        } else if (item.action === 'delete') {
          s.employees = s.employees.filter(function (p) { return p.id !== person.id; });
          data().save();
          ui().toast('Employee deleted');
          render();
        }
      });
    });

    /* contacts + address books */
    function currentListRef() {
      if (state.screen === 'clients') return s.clientContacts;
      if (state.screen === 'prospects') return s.prospects;
      if (state.screen === 'shared-address') return s.sharedAddressBook;
      return s.personalAddressBook;
    }

    function addContact(kindOverride) {
      var kind = kindOverride || (state.screen === 'clients' ? 'client' : state.screen === 'prospects' ? 'prospect' : 'user');
      personModal(kind === 'clients' ? 'client' : kind, function (record) {
        record.id = data().uid('person');
        currentListRef().push(record);
        data().save();
        ui().toast(kind === 'client' || kind === 'clients' ? 'Client contact added' : 'Added');
        render();
      });
    }
    var addBtn = el.querySelector('[data-people-add-contact]');
    if (addBtn) addBtn.addEventListener('click', function () { addContact(); });

    el.querySelectorAll('[data-people-select]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.selected[cb.getAttribute('data-people-select')] = cb.checked;
        render();
      });
    });

    var deleteSel = el.querySelector('[data-people-delete-selected]');
    if (deleteSel) deleteSel.addEventListener('click', function () {
      var list = currentListRef();
      var keep = list.filter(function (p) { return !state.selected[p.id]; });
      list.length = 0;
      Array.prototype.push.apply(list, keep);
      state.selected = {};
      data().save();
      ui().toast('Removed');
      render();
    });

    var agreement = el.querySelector('[data-people-agreement]');
    if (agreement) agreement.addEventListener('click', function () {
      var picked = s.clientContacts.filter(function (p) { return state.selected[p.id]; });
      picked.forEach(function (p) { data().logNotification('Agreement sent to ' + p.email, p.email); });
      ui().toast('Agreement sent to ' + picked.length + ' contact' + (picked.length === 1 ? '' : 's'));
    });

    /* groups */
    var newGroup = el.querySelector('[data-people-new-group]');
    if (newGroup) newGroup.addEventListener('click', function () {
      ui().openModal({
        title: 'New distribution group',
        body:
          ui().field('Group name', ui().input({ placeholder: 'e.g. Tax Season Clients', attrs: 'data-group-name' })) +
          ui().field('Members (comma separated emails)', ui().input({ placeholder: 'a@x.com, b@y.com', attrs: 'data-group-members' })) +
          '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create group', attrs: 'data-group-create' }) + '</div>',
        onMount: function (host) {
          host.querySelector('[data-group-create]').addEventListener('click', function () {
            var name = host.querySelector('[data-group-name]').value.trim();
            if (!name) { host.querySelector('[data-group-name]').focus(); return; }
            var members = host.querySelector('[data-group-members]').value.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
            s.distributionGroups.unshift({ id: data().uid('group'), name: name, members: members, created: data().shortDate() });
            data().save();
            ui().closeModal();
            ui().toast('Group created');
            render();
          });
        },
      });
    });
    el.querySelectorAll('[data-people-group-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        s.distributionGroups = s.distributionGroups.filter(function (g) { return g.id !== b.getAttribute('data-people-group-delete'); });
        data().save();
        ui().toast('Group deleted');
        render();
      });
    });

    /* resend welcome emails */
    var notify = el.querySelector('[data-resend-notify]');
    if (notify) notify.addEventListener('click', function () {
      var to = el.querySelector('[data-resend-to]');
      if (!to.value.trim()) { to.focus(); return; }
      data().logNotification('Welcome email re-sent to ' + to.value.trim(), to.value.trim());
      if (el.querySelector('[data-resend-copy]').checked) {
        data().logNotification('Copy of welcome email sent to ' + s.user.email, s.user.email);
      }
      ui().toast('Welcome email sent');
      to.value = '';
    });
    var skip = el.querySelector('[data-resend-skip]');
    if (skip) skip.addEventListener('click', function () {
      navigate('people-home', 'Manage users', 'People / Manage users');
    });
    var preview = el.querySelector('[data-resend-preview]');
    if (preview) preview.addEventListener('click', function () {
      ui().openModal({
        title: 'Email preview',
        body:
          '<p><strong>Subject:</strong> You’ve been added to ' + ui().esc(s.user.company) + '</p>' +
          '<p>Hi there,</p>' +
          '<p>' + ui().esc(s.user.name) + ' added you to the ' + ui().esc(s.user.company) + ' client portal. ' +
          'Click the activation link in this email to verify your address and set your password.</p>' +
          '<p class="tma-portal-note">This is how the welcome email will appear to recipients.</p>',
      });
    });
  }

  function mount(el, opts) {
    state.el = el;
    var next = opts && opts.navId && SCREEN_FOR_NAV[opts.navId];
    if (next && next !== state.screen) {
      state.alpha = 'All';
      state.search = '';
      state.selected = {};
      state.screen = next;
    } else if (next) {
      state.screen = next;
    }
    render();
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('people', mount);
})();
