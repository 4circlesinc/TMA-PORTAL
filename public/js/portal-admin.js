/*
 * TMA - Portal Account settings (admin area)
 * Secondary nav + admin pages: Admin Overview, Background Operations,
 * Account and Reporting, Billing, Client hub management, Security,
 * Connectors, Connection Manager, Storage, Advanced Preferences.
 * Registers view: 'admin'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  var state = { el: null, page: 'admin-overview', expanded: {} };

  var NAV = [
    { id: 'admin-overview', label: 'Admin Overview' },
    { id: 'background-ops', label: 'Background Operations' },
    { group: 'reporting-group', label: 'Account and Reporting', items: [
      { id: 'reporting', label: 'Reporting' },
      { id: 'notification-history', label: 'Notification History' },
      { id: 'branding', label: 'Edit Company Branding' },
    ] },
    { group: 'clienthub-group', label: 'Client hub management', items: [
      { id: 'clienthub-access', label: 'Client hub access' },
      { id: 'service-teams', label: 'Service teams' },
      { id: 'custom-fields', label: 'Custom fields' },
    ] },
    { group: 'security-group', label: 'Security', items: [
      { id: 'account-security', label: 'Account security' },
      { id: 'security-insights', label: 'Security Insights' },
      { id: 'dlp', label: 'Data loss prevention' },
      { id: 'signin-policy', label: 'Sign in policy' },
      { id: 'security-policy', label: 'Security policy' },
      { id: 'alert-settings', label: 'Security alert settings' },
      { id: 'device-security', label: 'Configure device security' },
      { id: 'super-users', label: 'Edit super user group' },
      { id: 'quarantined', label: 'Quarantined files' },
    ] },
    { id: 'connectors', label: 'Connectors' },
    { id: 'connection-manager', label: 'Connection Manager' },
    { group: 'storage-group', label: 'Storage', items: [
      { id: 'storage-usage', label: 'Usage' },
    ] },
    { group: 'prefs-group', label: 'Advanced Preferences', items: [
      { id: 'ai-settings', label: 'AI Settings' },
      { id: 'email-settings', label: 'Email Settings' },
      { id: 'permissions', label: 'Permissions' },
      { id: 'file-settings', label: 'File Settings' },
      { id: 'tools', label: 'Enable Portal Tools' },
      { id: 'folder-templates', label: 'Folder Templates' },
      { id: 'upload-forms', label: 'Remote Upload Forms' },
      { id: 'file-drops', label: 'File Drops' },
    ] },
  ];

  function groupForPage(pageId) {
    var found = null;
    NAV.forEach(function (n) {
      if (n.items && n.items.some(function (it) { return it.id === pageId; })) found = n.group;
    });
    return found;
  }

  function pageTitle(pageId) {
    var title = pageId;
    NAV.forEach(function (n) {
      if (n.id === pageId) title = n.label;
      if (n.items) n.items.forEach(function (it) { if (it.id === pageId) title = it.label; });
    });
    return title;
  }

  /* ── helpers ────────────────────────────────────── */
  function saveBtn(attr) {
    return '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: attr }) + '</div>';
  }

  function wireSave(el, attr, collect) {
    var b = el.querySelector('[' + attr.split('=')[0] + ']');
    if (!b) return;
    b.addEventListener('click', function () {
      collect();
      data().save();
      ui().toast('Settings saved');
    });
  }

  function radioValue(el, name, fallback) {
    var checked = el.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : fallback;
  }

  /* ── real security backend (Fortify) ───────────── */
  function xsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function secApi(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': xsrf(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  var SEC = { codesOnce: null };


  /* ── pages ──────────────────────────────────────── */
  var PAGES = {};

  PAGES['admin-overview'] = {
    render: function (s) {
      var sigLeft = Math.max(0, s.trial.signatureLimit - s.trial.signatureUsed);
      return ui().section('Account',
        '<p><strong>Account name:</strong> ' + ui().esc(s.branding.accountName) + '</p>' +
        '<p><strong>Plan:</strong> Premium' + (s.trial.active ? ' (Trial - ' + s.trial.daysLeft + ' days left)' : '') + '</p>' +
        '<p><strong>Employees:</strong> ' + s.employees.length + ' of ' + s.trial.employeeLimit + '</p>' +
        '<p><strong>Signature requests remaining:</strong> ' + sigLeft + '</p>') +
        ui().section('Quick links',
          '<ul>' +
          '<li><button type="button" class="tma-portal-link" data-admin-go="branding">Edit company branding</button></li>' +
          '<li><button type="button" class="tma-portal-link" data-admin-go="device-security">Configure device security</button></li>' +
          '<li><button type="button" class="tma-portal-link" data-admin-go="email-settings">Email settings</button></li>' +
          '</ul>');
    },
    wire: function (el) {
      el.querySelectorAll('[data-admin-go]').forEach(function (b) {
        b.addEventListener('click', function () { setPage(b.getAttribute('data-admin-go')); });
      });
    },
  };

  PAGES['background-ops'] = {
    render: function (s) {
      function opsList(list) {
        if (!list.length) return '<p class="tma-portal-note" style="text-align:center;padding:var(--space-16) 0">There are no operations to display</p>';
        return list.map(function (op) {
          return '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">' + ui().esc(op.name) + '</span>' +
            '<span class="tma-portal-note">' + ui().esc(op.date) + '</span></div>';
        }).join('');
      }
      var current = s.backgroundOps.filter(function (o) { return o.status !== 'completed'; });
      var completed = s.backgroundOps.filter(function (o) { return o.status === 'completed'; }).slice(0, 10);
      return '<p class="tma-portal-subtitle">Sometimes actions in the portal can take a long time to complete. Instead of making you wait for them to finish we allow you to continue working and move those operations to the background. This page allows you to see a listing of all pending, in progress and recently completed operations.</p>' +
        ui().section('Current Operations', opsList(current)) +
        ui().section('Completed Operations', opsList(completed));
    },
  };

  PAGES['reporting'] = {
    tab: 'recent',
    render: function (s) {
      var self = PAGES['reporting'];
      var list = self.tab === 'recent' ? s.reports : s.recurringReports;
      return '<p class="tma-portal-subtitle">To see how your account is being used, you can create recurring and non-recurring reports that track usage, access, messaging, storage, and other helpful details.</p>' +
        '<div class="tma-portal-toolbar">' +
        ui().tabs([{ key: 'recent', label: 'Recent Reports' }, { key: 'recurring', label: 'Recurring Reports' }], self.tab) +
        ui().btn({ label: 'Create Report', attrs: 'data-report-create' }) +
        '</div>' +
        (list.length
          ? ui().table(['Report', 'Type', 'Date range', 'Created'], list.map(function (r) {
              return '<tr><td><strong>' + ui().esc(r.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(r.type) + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(r.range) + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(r.created) + '</td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration04', title: 'No reports have been created recently.', subtitle: 'Create a report to see how your account is being used.' }));
    },
    wire: function (el, s) {
      var self = PAGES['reporting'];
      ui().wireTabs(el, function (key) { self.tab = key; render(); });
      var create = el.querySelector('[data-report-create]');
      if (create) create.addEventListener('click', function () {
        ui().openModal({
          title: 'Create Report',
          body:
            ui().field('Report type', ui().select(['Usage', 'Access', 'Messaging', 'Storage Summary', 'Storage Detail'], 'Usage', 'data-report-type')) +
            ui().field('Date range', ui().select(['Last 7 days', 'Last 30 days', 'Last 90 days', 'Custom'], 'Last 30 days', 'data-report-range')) +
            '<label class="tma-portal-checkbox"><input type="checkbox" data-report-recurring><span>Run this report on a recurring schedule</span></label>' +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create Report', attrs: 'data-report-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-report-save]').addEventListener('click', function () {
              var type = host.querySelector('[data-report-type]').value;
              var recurring = host.querySelector('[data-report-recurring]').checked;
              var report = {
                id: data().uid('report'),
                name: type + ' report',
                type: type,
                range: host.querySelector('[data-report-range]').value,
                created: data().shortDate(),
              };
              (recurring ? s.recurringReports : s.reports).unshift(report);
              data().save();
              data().logBackgroundOp('Generate ' + type.toLowerCase() + ' report');
              self.tab = recurring ? 'recurring' : 'recent';
              ui().closeModal();
              ui().toast('Report created');
              render();
            });
          },
        });
      });
    },
  };

  PAGES['notification-history'] = {
    filterDate: '',
    filterEmail: '',
    render: function (s) {
      var self = PAGES['notification-history'];
      var emails = [''].concat(s.notificationHistory.map(function (n) { return n.email; }).filter(function (v, i, a) { return a.indexOf(v) === i; }));
      var list = s.notificationHistory.filter(function (n) {
        if (self.filterEmail && n.email !== self.filterEmail) return false;
        if (self.filterDate) {
          var d = new Date(self.filterDate);
          var formatted = data().shortDate(d);
          if (n.date !== formatted) return false;
        }
        return true;
      });
      return '<p class="tma-portal-subtitle">Below is a history of all email messages that have been sent from the portal.</p>' +
        '<div class="tma-portal-section__card"><div class="tma-portal-toolbar">' +
        '<div class="tma-portal-toolbar__group">' +
        ui().field('Date:', ui().input({ type: 'date', attrs: 'data-note-date', value: self.filterDate })) +
        ui().field('Email:', ui().select(emails.map(function (e) { return { value: e, label: e || 'Select…' }; }), self.filterEmail, 'data-note-email', 'Email filter')) +
        '</div>' +
        ui().btn({ label: 'Apply', attrs: 'data-note-apply' }) +
        '</div></div>' +
        (list.length
          ? ui().table(['Date', 'Recipient', 'Subject'], list.map(function (n) {
              return '<tr><td class="tma-portal-table__muted">' + ui().esc(n.time || n.date) + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(n.email) + '</td>' +
                '<td>' + ui().esc(n.subject) + '</td></tr>';
            }).join(''))
          : '<div class="tma-portal-table-wrap"><div style="padding:var(--space-24);text-align:center">' +
            '<p class="tma-portal-note">' + ui().esc(data().shortDate()) + '</p>' +
            '<p class="tma-portal-note">No notifications found.</p></div></div>');
    },
    wire: function (el) {
      var self = PAGES['notification-history'];
      var apply = el.querySelector('[data-note-apply]');
      if (apply) apply.addEventListener('click', function () {
        self.filterDate = el.querySelector('[data-note-date]').value;
        self.filterEmail = el.querySelector('[data-note-email]').value;
        render();
      });
    },
  };

  PAGES['branding'] = {
    render: function (s) {
      return ui().section('Edit Account Name',
        ui().field('Account Name:', ui().input({ value: s.branding.accountName, attrs: 'data-brand-name' })) +
        (s.trial.active ? '<p class="tma-portal-note">TRIAL</p>' : '')) +
        ui().section('Edit Account Appearance',
          '<div class="tma-portal-toolbar"><strong>Basic Options</strong>' +
          '<button type="button" class="tma-portal-link" data-brand-defaults>Use Portal Defaults</button></div>' +
          ui().field('Page Title:', ui().input({ value: s.branding.pageTitle, attrs: 'data-brand-title' })) +
          ui().field('Logo:', '<input type="file" accept="image/*" data-brand-logo class="tma-portal-input" style="padding:var(--space-4)">') +
          (s.branding.logoName ? '<p class="tma-portal-note">Current logo: ' + ui().esc(s.branding.logoName) + '</p>' : '') +
          '<div class="tma-portal-toolbar__group">' +
          ui().field('Header Background Color:', '<input type="color" data-brand-header value="' + ui().esc(s.branding.headerColor) + '" aria-label="Header background color">') +
          ui().field('Accent Color:', '<input type="color" data-brand-accent value="' + ui().esc(s.branding.accentColor) + '" aria-label="Accent color">') +
          '</div>') +
        saveBtn('data-brand-save');
    },
    wire: function (el, s) {
      wireSave(el, 'data-brand-save', function () {
        s.branding.accountName = el.querySelector('[data-brand-name]').value.trim() || s.branding.accountName;
        s.branding.pageTitle = el.querySelector('[data-brand-title]').value.trim();
        s.branding.headerColor = el.querySelector('[data-brand-header]').value;
        s.branding.accentColor = el.querySelector('[data-brand-accent]').value;
        var logo = el.querySelector('[data-brand-logo]');
        if (logo.files && logo.files[0]) s.branding.logoName = logo.files[0].name;
      });
      var defaults = el.querySelector('[data-brand-defaults]');
      if (defaults) defaults.addEventListener('click', function () {
        s.branding.pageTitle = 'TM ANTOINE Advisory - Where Companies Connect';
        s.branding.headerColor = '#FFFFFF';
        s.branding.accentColor = '#0C0C0C';
        s.branding.logoName = '';
        data().save();
        ui().toast('Defaults restored');
        render();
      });
    },
  };

  PAGES['billing-convert'] = {
    cycle: 'annual',
    render: function (s) {
      var self = PAGES['billing-convert'];
      var monthly = self.cycle === 'monthly';
      function price(annual) { return monthly ? (Math.round(annual * 1.25 * 10) / 10).toFixed(1) : annual.toFixed(1); }
      function plan(name, tagline, annualPrice, badges, current, forChip) {
        return '<article class="tma-portal-plan' + (current ? ' is-current' : '') + '">' +
          '<div class="tma-portal-plan__badges">' +
          badges.map(function (b) { return '<span class="tma-portal-chip">' + ui().esc(b) + '</span>'; }).join('') +
          (forChip ? '<span class="tma-portal-chip">' + ui().esc(forChip) + '</span>' : '') +
          '</div>' +
          '<h3 class="tma-portal-plan__name">' + ui().esc(name) + '</h3>' +
          '<p class="tma-portal-plan__tagline">' + ui().esc(tagline) + '</p>' +
          '<div class="tma-portal-plan__price"><span class="tma-portal-plan__amount">$' + price(annualPrice) + '0</span>' +
          '<span class="tma-portal-plan__per">per month</span></div>' +
          '<div class="tma-portal-plan__meta">' +
          '<span><img src="images/icons/phosphor/Users.svg" alt="">3 Employee Accounts</span>' +
          '<span><img src="images/icons/phosphor/Database.svg" alt="">1TB/license Storage</span>' +
          '</div>' +
          ui().btn({ label: 'Buy now', attrs: 'data-plan-buy="' + ui().esc(name) + '"', variant: current ? undefined : 'ghost' }) +
          '</article>';
      }
      return ui().banner('info', 'Need help? We’re here for you. Contact support at <strong>sales@tmantoinelaw.com</strong> or call <strong>1 (800) 441-3453</strong> for more plan options.') +
        '<div class="tma-portal-toolbar"><h3 class="tma-portal-section__title">Select plan</h3>' +
        '<div class="tma-portal-toolbar__group">' +
        ui().btn({ label: 'Pay monthly', small: true, variant: monthly ? undefined : 'ghost', attrs: 'data-plan-cycle="monthly"' }) +
        ui().btn({ label: 'Pay annually', small: true, variant: monthly ? 'ghost' : undefined, attrs: 'data-plan-cycle="annual"' }) +
        '</div></div>' +
        '<div class="tma-portal-plans">' +
        plan('Advanced', 'Secure File Sharing for Teams', 49.5, [], false) +
        plan('Premium', 'End-to-End Document Workflows for Teams and Clients', 78.0, ['Most popular', 'Current plan'], true) +
        plan('Industry Advantage', 'Pre-Built, Accounting-Specific Document Workflow Automation', 125.0, [], false, 'For Accounting') +
        '</div>';
    },
    wire: function (el, s) {
      var self = PAGES['billing-convert'];
      el.querySelectorAll('[data-plan-cycle]').forEach(function (b) {
        b.addEventListener('click', function () { self.cycle = b.getAttribute('data-plan-cycle'); render(); });
      });
      el.querySelectorAll('[data-plan-buy]').forEach(function (b) {
        b.addEventListener('click', function () {
          var name = b.getAttribute('data-plan-buy');
          ui().openModal({
            title: 'Convert to ' + name,
            body: '<p>Your trial will convert to the <strong>' + ui().esc(name) + '</strong> plan billed ' +
              (self.cycle === 'monthly' ? 'monthly' : 'annually') + '. You can change plans at any time.</p>' +
              '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Confirm purchase', attrs: 'data-plan-confirm' }) + '</div>',
            onMount: function (host) {
              host.querySelector('[data-plan-confirm]').addEventListener('click', function () {
                s.trial.active = false;
                s.plan = name;
                data().save();
                data().logNotification('Order confirmation - ' + name + ' plan', s.user.email);
                ui().closeModal();
                ui().toast('Welcome to ' + name + '!');
                render();
              });
            },
          });
        });
      });
    },
  };

  PAGES['billing-cancel'] = {
    render: function (s) {
      return '<div class="tma-portal-two-col">' +
        ui().section('We are here for you',
          '<ul>' +
          '<li><button type="button" class="tma-portal-link" data-cancel-support>Visit support</button></li>' +
          '<li>Call toll free: 1.800.441.3453</li>' +
          '<li>UK: +44 (0800) 680.0621</li>' +
          '<li>International: +1 919.745.6111</li>' +
          '</ul>') +
        ui().section('Have you tried these resources?',
          '<ul>' +
          '<li><span class="tma-portal-link">Ask the community</span></li>' +
          '<li><span class="tma-portal-link">Knowledge base</span></li>' +
          '<li><span class="tma-portal-link">Training videos</span></li>' +
          '</ul>') +
        '</div>' +
        ui().section('We’re sorry to see you go!',
          '<p>The portal is designed with you in mind, and we’re always trying to find ways to improve our service and meet your file-sharing and storage needs.</p>' +
          '<h4 style="margin:0;font-size:var(--text-size-14)">Did you know?</h4>' +
          '<p class="tma-portal-note">When you cancel your account, you’ll miss out on a lot of great features, including:</p>' +
          '<div class="tma-portal-feature"><img src="images/icons/phosphor/EnvelopeSimple.svg" alt="">' +
          '<div class="tma-portal-feature__body"><span class="tma-portal-feature__title">Plugin for Microsoft Outlook</span>' +
          '<span class="tma-portal-feature__desc">Send large files securely directly from Outlook. <span class="tma-portal-link">Download now</span></span></div></div>' +
          '<div class="tma-portal-feature"><img src="images/icons/phosphor/DeviceMobile.svg" alt="">' +
          '<div class="tma-portal-feature__body"><span class="tma-portal-feature__title">Mobile Apps</span>' +
          '<span class="tma-portal-feature__desc">Access files and folders anytime from your smartphone or tablet. <span class="tma-portal-link">Learn More</span></span></div></div>' +
          '<div class="tma-portal-feature"><img src="images/icons/phosphor/Signature.svg" alt="">' +
          '<div class="tma-portal-feature__body"><span class="tma-portal-feature__title">E-Signature</span>' +
          '<span class="tma-portal-feature__desc">Get documents signed with legally binding e-signatures.</span></div></div>' +
          '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Cancel my trial', variant: 'danger', attrs: 'data-cancel-trial' }) + '</div>');
    },
    wire: function (el, s) {
      var support = el.querySelector('[data-cancel-support]');
      if (support) support.addEventListener('click', function () { ui().toast('Support: support@tmantoinelaw.com'); });
      var cancel = el.querySelector('[data-cancel-trial]');
      if (cancel) cancel.addEventListener('click', function () {
        ui().openModal({
          title: 'Cancel trial?',
          body: '<p>Your trial data will be kept for 30 days in case you change your mind.</p>' +
            '<div class="tma-portal-form-actions">' +
            ui().btn({ label: 'Keep my trial', attrs: 'data-cancel-keep' }) +
            ui().btn({ label: 'Cancel trial', variant: 'danger', attrs: 'data-cancel-confirm' }) +
            '</div>',
          onMount: function (host) {
            host.querySelector('[data-cancel-keep]').addEventListener('click', function () { ui().closeModal(); });
            host.querySelector('[data-cancel-confirm]').addEventListener('click', function () {
              ui().closeModal();
              ui().toast('Cancellation request received - check your email');
              data().logNotification('Trial cancellation confirmation', s.user.email);
            });
          },
        });
      });
    },
  };

  PAGES['clienthub-access'] = {
    render: function (s) {
      return ui().section('Client hub access',
        '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Enable the client hub for this account</span>' +
        ui().toggle(s.clientHubAccess.enabled, 'data-hub-enabled', 'Enable client hub') + '</div>' +
        '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Allow clients to self-register from an invite link</span>' +
        ui().toggle(s.clientHubAccess.allowSelfRegistration, 'data-hub-self', 'Allow self registration') + '</div>' +
        '<p class="tma-portal-note">The client hub gives each client a personalized space with their shared files, requests, and projects.</p>');
    },
    wire: function (el, s) {
      el.querySelector('[data-hub-enabled]').addEventListener('change', function (e) {
        s.clientHubAccess.enabled = e.target.checked; data().save(); ui().toast('Client hub ' + (e.target.checked ? 'enabled' : 'disabled'));
      });
      el.querySelector('[data-hub-self]').addEventListener('change', function (e) {
        s.clientHubAccess.allowSelfRegistration = e.target.checked; data().save();
      });
    },
  };

  PAGES['service-teams'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">Create and manage service teams that can be assigned to clients.</p>' +
        (s.serviceTeams.length
          ? ui().table(['Team', 'Members', 'Created', ''], s.serviceTeams.map(function (t) {
              return '<tr><td><strong>' + ui().esc(t.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + t.members.length + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(t.created) + '</td>' +
                '<td><div class="tma-portal-row-actions">' +
                '<button type="button" class="tma-portal-icon-btn" data-team-delete="' + t.id + '" title="Delete team" aria-label="Delete team"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                '</div></td></tr>';
            }).join('')) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create service team', attrs: 'data-team-create' }) + '</div>'
          : ui().emptyState({
              illustration: 'Illustration13',
              title: 'There aren’t any service teams yet',
              subtitle: 'Start by creating service teams to assign to clients.',
              button: ui().btn({ label: 'Create service team', attrs: 'data-team-create' }),
            }));
    },
    wire: function (el, s) {
      el.querySelectorAll('[data-team-create]').forEach(function (b) {
        b.addEventListener('click', function () {
          ui().openModal({
            title: 'Create service team',
            body:
              ui().field('Team name', ui().input({ placeholder: 'e.g. Tax Advisory', attrs: 'data-team-name' })) +
              ui().field('Members (employee emails, comma separated)', ui().input({ placeholder: 'a@x.com, b@y.com', attrs: 'data-team-members' })) +
              '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create team', attrs: 'data-team-save' }) + '</div>',
            onMount: function (host) {
              host.querySelector('[data-team-save]').addEventListener('click', function () {
                var name = host.querySelector('[data-team-name]').value.trim();
                if (!name) { host.querySelector('[data-team-name]').focus(); return; }
                var members = host.querySelector('[data-team-members]').value.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
                s.serviceTeams.unshift({ id: data().uid('team'), name: name, members: members, created: data().shortDate() });
                data().save();
                ui().closeModal();
                ui().toast('Service team created');
                render();
              });
            },
          });
        });
      });
      el.querySelectorAll('[data-team-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          s.serviceTeams = s.serviceTeams.filter(function (t) { return t.id !== b.getAttribute('data-team-delete'); });
          data().save(); ui().toast('Team deleted'); render();
        });
      });
    },
  };

  PAGES['custom-fields'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">Add custom fields to collect extra details about clients in the hub.</p>' +
        (s.customFields.length
          ? ui().table(['Field', 'Type', ''], s.customFields.map(function (f) {
              return '<tr><td><strong>' + ui().esc(f.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(f.type) + '</td>' +
                '<td><div class="tma-portal-row-actions">' +
                '<button type="button" class="tma-portal-icon-btn" data-field-delete="' + f.id + '" title="Delete field" aria-label="Delete field"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                '</div></td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration04', title: 'No custom fields yet', subtitle: 'Add a field to collect details like Client ID or Region.' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Add custom field', attrs: 'data-field-add' }) + '</div>';
    },
    wire: function (el, s) {
      el.querySelector('[data-field-add]').addEventListener('click', function () {
        ui().openModal({
          title: 'Add custom field',
          body:
            ui().field('Field name', ui().input({ placeholder: 'e.g. Client ID', attrs: 'data-field-name' })) +
            ui().field('Type', ui().select(['Text', 'Number', 'Date', 'Dropdown'], 'Text', 'data-field-type')) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Add field', attrs: 'data-field-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-field-save]').addEventListener('click', function () {
              var name = host.querySelector('[data-field-name]').value.trim();
              if (!name) { host.querySelector('[data-field-name]').focus(); return; }
              s.customFields.push({ id: data().uid('field'), name: name, type: host.querySelector('[data-field-type]').value });
              data().save(); ui().closeModal(); ui().toast('Field added'); render();
            });
          },
        });
      });
      el.querySelectorAll('[data-field-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          s.customFields = s.customFields.filter(function (f) { return f.id !== b.getAttribute('data-field-delete'); });
          data().save(); render();
        });
      });
    },
  };

  var SEC_STATUS = {
    login: { label: 'Signed in', badge: 'tma-auth__badge--done' },
    logout: { label: 'Signed out', badge: '' },
    login_failed: { label: 'Failed', badge: 'tma-auth__badge--danger' },
    lockout: { label: 'Blocked', badge: 'tma-auth__badge--danger' },
    registered: { label: 'Account created', badge: '' },
    email_verified: { label: 'Email verified', badge: '' },
    password_reset: { label: 'Password reset', badge: '' },
    social_connected: { label: 'Google connected', badge: 'tma-auth__badge--done' },
    social_disconnected: { label: 'Google disconnected', badge: '' },
  };

  function secEnsureStyles() {
    ['css/auth.css', 'css/auth-flow.css'].forEach(function (href) {
      if (!document.querySelector('link[href*="' + href + '"]')) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
      }
    });
  }

  PAGES['account-security'] = {
    render: function () {
      secEnsureStyles();
      return '<div data-sec-root><p class="tma-portal-note">Loading…</p></div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-sec-root]');
      if (!root) return;
      var esc = ui().esc;

      function refresh() { window.TMAPortalAdmin.setPage('account-security'); }

      secApi('GET', '/security-settings/data').then(function (r) { return r.json(); }).then(function (d) {
        var on = d.twoFactor === 'on';

        var sessionRows = d.sessions.map(function (s2) {
          return '<tr><td>' + esc(s2.device) + (s2.current ? ' <span class="tma-auth__badge tma-auth__badge--done">This device</span>' : '') + '</td>' +
            '<td>' + esc(s2.ip || '') + '</td><td>' + esc(s2.lastActive) + '</td><td></td></tr>';
        }).join('');

        var eventRows = d.events.map(function (ev) {
          var s3 = SEC_STATUS[ev.event] || { label: ev.event, badge: '' };
          var at = ev.atIso ? new Date(ev.atIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : ev.when;
          return '<tr><td>' + esc(at) + '</td><td>' + esc(ev.ip || '') + '</td><td>' + esc(ev.device || '') + '</td>' +
            '<td><span class="tma-auth__badge ' + s3.badge + '">' + esc(s3.label) + '</span></td></tr>';
        }).join('');

        root.innerHTML =
          '<div class="tma-security">' +

          '<section class="tma-security__card" aria-labelledby="sec-password">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-password"><img src="images/icons/phosphor/Password.svg" alt="" aria-hidden="true">Password</h2>' +
          '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#change-password-dialog"><span>Change password</span></button></div>' +
          '<p class="tma-security__desc">Use a password you don\'t use anywhere else.</p></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-connected">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-connected"><img src="images/icons/phosphor/Plugs.svg" alt="" aria-hidden="true">Connected accounts</h2></div>' +
          '<p class="tma-security__desc">Sign in with Google or Microsoft alongside your password. Only accounts with your portal email can be connected.</p>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-ico" aria-hidden="true"><img src="images/icons/brands/Google16.svg" alt=""></span>' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Google</span>' +
          (d.google && d.google.connected
            ? '<span class="tma-security__row-sub tma-auth__provider-status tma-auth__provider-status--on">Connected as ' + esc(d.google.email || '') + '</span>'
            : '<span class="tma-security__row-sub">Not connected</span>') +
          '</span>' +
          (d.google && d.google.connected
            ? '<button type="button" class="tma-auth__chip-btn" data-sec-gdisconnect><span>Disconnect</span></button>'
            : '<a class="tma-auth__chip-btn" href="/auth/social/google/redirect"><span>Connect</span></a>') +
          '</div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-ico" aria-hidden="true"><img src="images/icons/brands/Microsoft16.svg" alt=""></span>' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Microsoft</span><span class="tma-security__row-sub">Not connected</span></span>' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-connect="Microsoft"><span>Connect</span></button></div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-phone">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-phone"><img src="images/icons/phosphor/DeviceMobile.svg" alt="" aria-hidden="true">Phone number</h2></div>' +
          '<p class="tma-security__desc">Used for security alerts and account recovery only - never marketing.</p>' +
          '<div class="tma-security__empty">' +
          '<img src="images/icons/phosphor/DeviceMobile.svg" alt="" aria-hidden="true">' +
          '<span>No phone number added yet.</span>' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-connect="Phone verification"><span>Add phone number</span></button></div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-tfa">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-tfa"><img src="images/icons/phosphor/ShieldCheck.svg" alt="" aria-hidden="true">Two-factor authentication</h2>' +
          (on ? '<span class="tma-auth__badge tma-auth__badge--done">On</span>' : '<span class="tma-auth__badge">Off</span>') + '</div>' +
          '<p class="tma-security__desc">A 6-digit code from your authenticator app is required when signing in.</p>' +
          (on
            ? '<div class="tma-security__row">' +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">Authenticator app</span>' +
              '<span class="tma-security__row-sub">Added ' + esc(d.twoFactorSince || '') + '</span></span>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-setup><span>Set up again</span></button>' +
              '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#disable-tfa-dialog"><span>Turn off</span></button></div>'
            : '<div class="tma-security__empty">' +
              '<img src="images/icons/phosphor/ShieldCheck.svg" alt="" aria-hidden="true">' +
              '<span>Two-factor authentication is off.</span>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-setup><span>Turn on</span></button></div>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-codes">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-codes"><img src="images/icons/phosphor/Key.svg" alt="" aria-hidden="true">Recovery codes</h2></div>' +
          (on
            ? '<div class="tma-security__row">' +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">' + d.recoveryCodesCount + ' codes available</span>' +
              '<span class="tma-security__row-sub">Each code signs you in once if you can\'t use your authenticator app. Codes are only shown when generated.</span></span>' +
              '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#regenerate-dialog"><span>Generate new codes</span></button></div>'
            : '<p class="tma-security__desc">Available once two-factor authentication is turned on.</p>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-trusted">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-trusted"><img src="images/icons/phosphor/Devices.svg" alt="" aria-hidden="true">Trusted devices</h2></div>' +
          '<p class="tma-security__desc">These devices skip the two-factor code for 30 days. Remove any device you don\'t recognize.</p>' +
          '<div class="tma-security__empty">' +
          '<img src="images/icons/phosphor/Devices.svg" alt="" aria-hidden="true">' +
          '<span>No trusted devices yet.</span></div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-sessions">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-sessions"><img src="images/icons/phosphor/Desktop.svg" alt="" aria-hidden="true">Active sessions</h2>' +
          '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#signout-all-dialog"><span>Sign out of all other devices</span></button></div>' +
          '<p class="tma-security__desc">Everywhere you\'re currently signed in. Sign out anything you don\'t recognize.</p>' +
          '<div class="tma-security__table-wrap"><table class="tma-security__table">' +
          '<thead><tr><th scope="col">Device</th><th scope="col">Location</th><th scope="col">Last active</th><th scope="col"></th></tr></thead>' +
          '<tbody>' + sessionRows + '</tbody></table></div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-history">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-history"><img src="images/icons/phosphor/ClockCounterClockwise.svg" alt="" aria-hidden="true">Recent login activity</h2></div>' +
          '<p class="tma-security__desc">The last sign-ins and attempts on your account. If something looks wrong, change your password and sign out of all devices.</p>' +
          (d.events.length
            ? '<div class="tma-security__table-wrap"><table class="tma-security__table">' +
              '<thead><tr><th scope="col">When</th><th scope="col">Location</th><th scope="col">Device</th><th scope="col">Status</th></tr></thead>' +
              '<tbody>' + eventRows + '</tbody></table></div>'
            : '<div class="tma-security__empty">' +
              '<img src="images/icons/phosphor/ClockCounterClockwise.svg" alt="" aria-hidden="true">' +
              '<span>No login activity to show yet.</span></div>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-notify">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-notify"><img src="images/icons/phosphor/Bell.svg" alt="" aria-hidden="true">Security notifications</h2></div>' +
          '<p class="tma-security__desc">Emails we send to keep you informed about your account. Alerts for sign-ins from new devices can\'t be turned off.</p>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">New device sign-in</span>' +
          '<span class="tma-security__row-sub">Always on - sent whenever a new device signs in</span></span>' +
          '<label class="tma-auth__switch"><input class="tma-auth__switch-input" type="checkbox" checked disabled aria-label="New device sign-in alerts (always on)"><span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span></label></div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Password changes</span></span>' +
          '<label class="tma-auth__switch"><input class="tma-auth__switch-input" type="checkbox" checked aria-label="Password change alerts"><span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span></label></div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Two-factor authentication changes</span></span>' +
          '<label class="tma-auth__switch"><input class="tma-auth__switch-input" type="checkbox" checked aria-label="Two-factor authentication change alerts"><span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span></label></div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Monthly security summary</span>' +
          '<span class="tma-security__row-sub">A short overview of recent account activity</span></span>' +
          '<label class="tma-auth__switch"><input class="tma-auth__switch-input" type="checkbox" aria-label="Monthly security summary"><span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span></label></div>' +
          '</section>' +
          '</div>' +

          /* ── dialogs (from the design prototype) ── */
          '<div class="tma-auth__dialog" id="change-password-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">Change password</h2>' +
          '<form class="tma-auth__form" data-sec-form="password" action="#" novalidate>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="current_password" placeholder="Current password" autocomplete="current-password" aria-label="Current password"></label>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password" placeholder="New password" autocomplete="new-password" aria-label="New password"></label>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password_confirmation" placeholder="Confirm new password" autocomplete="new-password" aria-label="Confirm new password"></label>' +
          '<p class="tma-auth__hint">At least 10 characters. Changing it signs out your other devices.</p>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Update password</button></div></form></div></div>' +

          '<div class="tma-auth__dialog" id="disable-tfa-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">Turn off two-factor authentication?</h2>' +
          '<p class="tma-auth__dialog-text">Your recovery codes will stop working too.</p>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Keep it on</button>' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--danger" data-sec-disable>Turn off</button></div></div></div>' +

          '<div class="tma-auth__dialog" id="regenerate-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">Generate new recovery codes?</h2>' +
          '<p class="tma-auth__dialog-text">Your old codes stop working immediately. Save the new set right away.</p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="button" class="tma-auth__submit" data-sec-regen>Generate new codes</button></div></div></div>' +

          '<div class="tma-auth__dialog" id="signout-all-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">Sign out of all other devices?</h2>' +
          '<p class="tma-auth__dialog-text">Every session except this one will end immediately.</p>' +
          '<form class="tma-auth__form" data-sec-form="logout-all" action="#" novalidate>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password" placeholder="Confirm your password" autocomplete="current-password" aria-label="Confirm your password"></label>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Sign out other devices</button></div></form></div></div>' +

          '<div class="tma-auth__dialog" id="tfa-setup-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<div data-sec-step="confirm" hidden>' +
          '<h2 class="tma-auth__dialog-title">Confirm your password</h2>' +
          '<form class="tma-auth__form" data-sec-form="confirm" action="#" novalidate>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password" placeholder="Password" autocomplete="current-password" aria-label="Password"></label>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Continue</button></div></form></div>' +
          '<div data-sec-step="scan" hidden>' +
          '<h2 class="tma-auth__dialog-title">Scan this QR code</h2>' +
          '<p class="tma-auth__dialog-text">Choose "Add account" in your authenticator app, then scan.</p>' +
          '<div class="tma-auth__qr" data-sec-qr role="img" aria-label="QR code for authenticator setup"></div>' +
          '<div class="tma-auth__manual-key"><code data-sec-key></code>' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-copy-key><span>Copy</span></button></div>' +
          '<form class="tma-auth__form" data-sec-form="verify" action="#" novalidate>' +
          '<div class="tma-auth__otp tma-auth__otp--6" data-sec-otp role="group" aria-label="6 digit code">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" aria-label="Digit 1">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 2">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 3">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 4">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 5">' +
          '<input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 6">' +
          '</div>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Verify code</button></div></form></div>' +
          '<div data-sec-step="codes" hidden>' +
          '<h2 class="tma-auth__dialog-title">Save your recovery codes</h2>' +
          '<p class="tma-auth__dialog-text">Each code signs you in once. They won\'t be shown again.</p>' +
          '<ul class="tma-auth__codes" data-sec-codes></ul>' +
          '<div class="tma-auth__actions">' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-copy-codes><img src="images/icons/phosphor/Copy.svg" alt="" width="14" height="14" aria-hidden="true"><span>Copy</span></button>' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-download-codes><img src="images/icons/phosphor/DownloadSimple.svg" alt="" width="14" height="14" aria-hidden="true"><span>Download</span></button>' +
          '<button type="button" class="tma-auth__chip-btn" data-sec-print-codes><img src="images/icons/phosphor/Printer.svg" alt="" width="14" height="14" aria-hidden="true"><span>Print</span></button></div>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit" data-sec-done>Done</button></div></div>' +
          '</div></div>';

        /* ── dialog plumbing ── */
        function closeDialogs() { root.querySelectorAll('.tma-auth__dialog').forEach(function (dg) { dg.hidden = true; }); }
        root.querySelectorAll('[data-dialog-open]').forEach(function (b) {
          b.addEventListener('click', function () {
            closeDialogs();
            var dg = root.querySelector(b.getAttribute('data-dialog-open'));
            if (dg) { dg.hidden = false; var f = dg.querySelector('input'); if (f) f.focus(); }
          });
        });
        root.querySelectorAll('[data-dialog-close]').forEach(function (b) {
          b.addEventListener('click', closeDialogs);
        });
        root.querySelectorAll('.tma-auth__dialog').forEach(function (dg) {
          dg.addEventListener('click', function (ev2) { if (ev2.target === dg) closeDialogs(); });
        });

        var setupDialog = root.querySelector('#tfa-setup-dialog');
        function showStep(id) {
          setupDialog.querySelectorAll('[data-sec-step]').forEach(function (s2) { s2.hidden = s2.getAttribute('data-sec-step') !== id; });
          closeDialogs();
          setupDialog.hidden = false;
          var f = setupDialog.querySelector('[data-sec-step="' + id + '"] input');
          if (f) f.focus();
        }
        function errorIn(scope, msg) {
          var e = scope.querySelector('[data-sec-error]');
          if (e) { e.hidden = !msg; e.textContent = msg || ''; }
        }
        function firstError(json, fallback) {
          if (json && json.errors) { var k = Object.keys(json.errors); if (k.length) return json.errors[k[0]][0]; }
          return (json && json.message) || fallback;
        }

        /* otp auto-advance */
        var digits = root.querySelectorAll('[data-sec-otp] input');
        digits.forEach(function (input, i) {
          input.addEventListener('input', function () {
            input.value = input.value.replace(/\D/g, '').slice(-1);
            if (input.value && digits[i + 1]) digits[i + 1].focus();
          });
          input.addEventListener('keydown', function (ev2) {
            if (ev2.key === 'Backspace' && !input.value && digits[i - 1]) digits[i - 1].focus();
          });
          input.addEventListener('paste', function (ev2) {
            var text = (ev2.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (!text) return;
            ev2.preventDefault();
            for (var k2 = 0; k2 < digits.length - i && k2 < text.length; k2++) digits[i + k2].value = text.charAt(k2);
          });
        });

        /* coming-soon connects */
        root.querySelectorAll('[data-sec-connect]').forEach(function (b) {
          b.addEventListener('click', function () {
            ui().toast(b.getAttribute('data-sec-connect') + ' is coming in a later phase');
          });
        });

        /* Google disconnect */
        var gdis = root.querySelector('[data-sec-gdisconnect]');
        if (gdis) gdis.addEventListener('click', function () {
          secApi('POST', '/auth/social/google/disconnect').then(function (res) {
            return res.json().then(function (j) {
              ui().toast((j && j.message) || (res.ok ? 'Google disconnected.' : 'Could not disconnect.'));
              if (res.ok) refresh();
            });
          }).catch(function () { ui().toast('Could not disconnect.'); });
        });

        /* two-factor setup flow */
        var afterConfirm = null;
        function startSetup() {
          secApi('POST', '/auth/user/two-factor-authentication').then(function (res) {
            if (res.status === 423) { afterConfirm = startSetup; showStep('confirm'); return; }
            if (res.ok) loadScan();
          });
        }
        function loadScan() {
          showStep('scan');
          secApi('GET', '/auth/user/two-factor-qr-code').then(function (r) { return r.json(); }).then(function (j) {
            var qr = root.querySelector('[data-sec-qr]');
            qr.innerHTML = j.svg;
            var svg = qr.querySelector('svg');
            if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = '100%'; }
          }).catch(function () {});
          secApi('GET', '/auth/user/two-factor-secret-key').then(function (r) { return r.json(); }).then(function (j) {
            root.querySelector('[data-sec-key]').textContent = (j.secretKey.match(/.{1,4}/g) || [j.secretKey]).join(' ');
            root.querySelector('[data-sec-copy-key]').onclick = function () {
              navigator.clipboard && navigator.clipboard.writeText(j.secretKey);
              ui().toast('Setup key copied');
            };
          }).catch(function () {});
        }
        var lastCodes = [];
        function showCodes() {
          secApi('GET', '/auth/user/two-factor-recovery-codes').then(function (r) { return r.json(); }).then(function (codes) {
            lastCodes = codes;
            root.querySelector('[data-sec-codes]').innerHTML = codes.map(function (c) { return '<li class="tma-auth__code">' + esc(c) + '</li>'; }).join('');
            showStep('codes');
          });
        }
        root.querySelectorAll('[data-sec-setup]').forEach(function (b) {
          b.addEventListener('click', startSetup);
        });
        var copyCodes = root.querySelector('[data-sec-copy-codes]');
        if (copyCodes) copyCodes.addEventListener('click', function () {
          navigator.clipboard && navigator.clipboard.writeText(lastCodes.join('\n'));
          ui().toast('Recovery codes copied');
        });
        var dlCodes = root.querySelector('[data-sec-download-codes]');
        if (dlCodes) dlCodes.addEventListener('click', function () {
          var blob = new Blob(['TM ANTOINE Advisory - recovery codes\n\n' + lastCodes.join('\n') + '\n'], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'tma-recovery-codes.txt';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        });
        var prCodes = root.querySelector('[data-sec-print-codes]');
        if (prCodes) prCodes.addEventListener('click', function () { window.print(); });
        var doneBtn = root.querySelector('[data-sec-done]');
        if (doneBtn) doneBtn.addEventListener('click', function () { closeDialogs(); refresh(); });

        var regen = root.querySelector('[data-sec-regen]');
        if (regen) regen.addEventListener('click', function () {
          var run = function () {
            secApi('POST', '/auth/user/two-factor-recovery-codes').then(function (res) {
              if (res.status === 423) { afterConfirm = run; showStep('confirm'); return; }
              if (res.ok) showCodes();
            });
          };
          run();
        });
        var disable = root.querySelector('[data-sec-disable]');
        if (disable) disable.addEventListener('click', function () {
          var run = function () {
            secApi('DELETE', '/auth/user/two-factor-authentication').then(function (res) {
              if (res.status === 423) { afterConfirm = run; showStep('confirm'); return; }
              if (res.ok) { closeDialogs(); ui().toast('Two-factor authentication turned off'); refresh(); }
            });
          };
          run();
        });

        /* forms */
        root.querySelectorAll('form[data-sec-form]').forEach(function (form) {
          form.addEventListener('submit', function (ev2) {
            ev2.preventDefault();
            var kind = form.getAttribute('data-sec-form');

            if (kind === 'confirm') {
              secApi('POST', '/auth/user/confirm-password', { password: form.querySelector('input').value }).then(function (res) {
                if (res.ok) { errorIn(form, ''); form.reset(); if (afterConfirm) afterConfirm(); }
                else res.json().then(function (j) { errorIn(form, firstError(j, 'That password didn\'t match.')); });
              });
            }

            if (kind === 'verify') {
              var code = '';
              form.querySelectorAll('.tma-auth__otp-digit').forEach(function (i2) { code += i2.value; });
              secApi('POST', '/auth/user/confirmed-two-factor-authentication', { code: code }).then(function (res) {
                if (res.ok) showCodes();
                else errorIn(form, 'That code didn\'t match - enter the newest one.');
              });
            }

            if (kind === 'password') {
              secApi('PUT', '/auth/user/password', {
                current_password: form.querySelector('[name="current_password"]').value,
                password: form.querySelector('[name="password"]').value,
                password_confirmation: form.querySelector('[name="password_confirmation"]').value,
              }).then(function (res) {
                if (res.ok) { closeDialogs(); ui().toast('Password updated'); form.reset(); }
                else res.json().then(function (j) { errorIn(form, firstError(j, 'Could not update password.')); });
              });
            }

            if (kind === 'logout-all') {
              secApi('POST', '/security-settings/logout-others', { password: form.querySelector('input').value }).then(function (res) {
                if (res.ok) { closeDialogs(); ui().toast('Other sessions ended'); refresh(); }
                else res.json().then(function (j) { errorIn(form, firstError(j, 'Could not end sessions.')); });
              });
            }
          });
        });
      }).catch(function () {
        root.innerHTML = '<p class="tma-portal-note">Couldn\'t load security data. Refresh to try again.</p>';
      });
    },
  };

  PAGES['security-insights'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">A summary of your account’s security posture.</p>' +
        '<div class="tma-portal-two-col">' +
        ui().section('Sign-ins', '<p data-si-signins>Loading…</p>') +
        ui().section('Two-factor authentication', '<p data-si-tfa>Loading…</p>') +
        ui().section('Active sessions', '<p data-si-sessions>Loading…</p>') +
        ui().section('Quarantine', '<p><strong>' + s.quarantinedFiles.length + '</strong> quarantined files</p>') +
        '</div>';
    },
    wire: function (el) {
      secApi('GET', '/security-settings/data').then(function (r) { return r.json(); }).then(function (d) {
        var si = el.querySelector('[data-si-signins]');
        var tfa = el.querySelector('[data-si-tfa]');
        var ses = el.querySelector('[data-si-sessions]');
        if (si) si.innerHTML = '<strong>' + d.failedSignins7d + '</strong> failed sign-in attempt' + (d.failedSignins7d === 1 ? '' : 's') + ' in the last 7 days';
        if (tfa) tfa.innerHTML = d.twoFactor === 'on' ? '<strong>On</strong>' : '<strong>Off</strong> — turn it on under Account security';
        if (ses) ses.innerHTML = '<strong>' + d.sessions.length + '</strong> active session' + (d.sessions.length === 1 ? '' : 's');
      }).catch(function () {});
    },
  };

  PAGES['dlp'] = {
    render: function (s) {
      var d = s.settings.dlp;
      function matrix(key, label, help) {
        var m = d[key];
        function row(action, actionLabel) {
          return '<tr><td>' + actionLabel + '</td>' +
            ['anonymous', 'client', 'employee'].map(function (role) {
              return '<td><input type="checkbox" data-dlp="' + key + '.' + action + '.' + role + '"' + (m[action][role] ? ' checked' : '') + ' aria-label="' + actionLabel + ' - ' + role + '"></td>';
            }).join('') + '</tr>';
        }
        return ui().section(label,
          (help ? '<p class="tma-portal-note">' + ui().esc(help) + '</p>' : '') +
          '<table class="tma-portal-matrix"><thead><tr><th></th><th>Anonymous</th><th>Client</th><th>Employee</th></tr></thead>' +
          '<tbody>' + row('download', 'Download') + row('share', 'Share') + '</tbody></table>');
      }
      return '<p class="tma-portal-subtitle">The portal integrates with third-party Data Loss Prevention (DLP) systems to identify files that contain sensitive information. To limit access and sharing of items based on their content, enable DLP scanning on your storage zone controller and then configure the settings below.</p>' +
        ui().section('Limit access to files based on their content',
          ui().radioYesNo('dlp-limit', d.limitAccess, 'data-dlp-limit')) +
        '<h3 class="tma-portal-section__title">Allowed Actions</h3>' +
        matrix('rejected', 'Scanned: Rejected', 'Files a DLP scan flagged as containing sensitive content.') +
        matrix('ok', 'Scanned: OK', 'Files a DLP scan cleared.') +
        matrix('unscanned', 'Unscanned Documents', 'Files not yet scanned.') +
        saveBtn('data-dlp-save');
    },
    wire: function (el, s) {
      wireSave(el, 'data-dlp-save', function () {
        s.settings.dlp.limitAccess = radioValue(el, 'dlp-limit', 'yes');
        el.querySelectorAll('[data-dlp]').forEach(function (cb) {
          var path = cb.getAttribute('data-dlp').split('.');
          s.settings.dlp[path[0]][path[1]][path[2]] = cb.checked;
        });
      });
    },
  };

  PAGES['signin-policy'] = {
    render: function () {
      return '<div data-pol-root><p class="tma-portal-note">Loading…</p></div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-pol-root]');
      if (!root) return;
      secApi('GET', '/admin/security-policies').then(function (r) { return r.json(); }).then(function (all) {
        var p = all.signInPolicy;
        var admin = all.isAdmin;
        root.innerHTML = '<h3 class="tma-portal-section__title">Password requirements</h3>' +
          '<p class="tma-portal-subtitle">Applies to registration, password changes, and password resets.</p>' +
          (admin ? '' : '<p class="tma-portal-note">Only administrators can change these settings.</p>') +
          ui().section('',
            '<p>Minimum length:<br><strong>' + p.minLength + ' characters</strong></p>' +
            '<p>Numbers required:<br><strong>' + p.numbersRequired + '</strong></p>' +
            '<p>Special characters required:<br><strong>' + p.specialRequired + '</strong></p>' +
            (admin ? '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Edit', icon: 'PencilSimple', variant: 'ghost', attrs: 'data-signin-edit' }) + '</div>' : '')) +
          '<h3 class="tma-portal-section__title">Multi-Factor authentication</h3>' +
          '<p class="tma-portal-subtitle">Require every user to set up an authenticator app. Anyone without one is sent to Security settings at sign-in.</p>' +
          ui().section('', '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Require multi-factor authentication</span>' +
            ui().toggle(p.requireMfa, 'data-signin-mfa' + (admin ? '' : ' disabled'), 'Require MFA') + '</div>');

        function save(done) {
          secApi('PUT', '/admin/security-policies/sign-in', p).then(function (res) {
            if (res.ok) { ui().toast('Sign in policy saved'); if (done) done(true); }
            else res.json().then(function (j) { ui().toast((j && j.message) || 'Could not save'); if (done) done(false); }).catch(function () { if (done) done(false); });
          });
        }

        var mfa = root.querySelector('[data-signin-mfa]');
        if (mfa) mfa.addEventListener('change', function () { p.requireMfa = mfa.checked; save(); });

        var edit = root.querySelector('[data-signin-edit]');
        if (edit) edit.addEventListener('click', function () {
          ui().openModal({
            title: 'Edit password requirements',
            body:
              ui().field('Minimum length (characters)', ui().input({ type: 'number', value: String(p.minLength), attrs: 'data-signin-len min="8" max="64"' })) +
              ui().field('Numbers required', ui().input({ type: 'number', value: String(p.numbersRequired), attrs: 'data-signin-num min="0" max="4"' })) +
              ui().field('Special characters required', ui().input({ type: 'number', value: String(p.specialRequired), attrs: 'data-signin-special min="0" max="4"' })) +
              '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-signin-save' }) + '</div>',
            onMount: function (host) {
              host.querySelector('[data-signin-save]').addEventListener('click', function () {
                p.minLength = Math.min(64, Math.max(8, parseInt(host.querySelector('[data-signin-len]').value, 10) || 8));
                p.numbersRequired = Math.max(0, parseInt(host.querySelector('[data-signin-num]').value, 10) || 0);
                p.specialRequired = Math.max(0, parseInt(host.querySelector('[data-signin-special]').value, 10) || 0);
                save(function (ok) { if (ok) { ui().closeModal(); window.TMAPortalAdmin.setPage('signin-policy'); } });
              });
            },
          });
        });
      }).catch(function () { root.innerHTML = '<p class="tma-portal-note">Couldn\'t load the sign in policy. Refresh to try again.</p>'; });
    },
  };

  PAGES['security-policy'] = {
    render: function () {
      return '<div data-pol-root><p class="tma-portal-note">Loading…</p></div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-pol-root]');
      if (!root) return;
      secApi('GET', '/admin/security-policies').then(function (r) { return r.json(); }).then(function (all) {
        var p = all.securityPolicy;
        var admin = all.isAdmin;
        var toggles = [
          ['impossibleTravel', 'Impossible travel access from multiple countries'],
          ['downloadTrend', 'High download activity: change in download activity trend'],
          ['ipCountChange', 'Access from high number of IPs: change in IP count trend'],
          ['failedSignIns', 'Multiple failed sign-in attempts'],
          ['suspiciousIp', 'Suspicious IP activity'],
        ];
        root.innerHTML = '<h3 class="tma-portal-section__title">Trusted domains</h3>' +
          (admin ? '' : '<p class="tma-portal-note">Only administrators can change these settings.</p>') +
          ui().section('',
            '<p class="tma-portal-note">Domains listed here may embed the portal in an iframe. Sent to browsers as a Content-Security-Policy header.</p>' +
            '<div class="tma-portal-field"><span class="tma-portal-field__label">Allowed domains (comma separated list):</span>' +
            '<textarea class="tma-portal-textarea" data-secpol-domains placeholder="example.com, app.example.com"' + (admin ? '' : ' disabled') + '>' + ui().esc(p.trustedDomains) + '</textarea></div>') +
          '<h3 class="tma-portal-section__title">Auto-remediation</h3>' +
          ui().section('',
            '<p class="tma-portal-note">Scenarios flagged for automatic follow-up in the suspicious-login checks.</p>' +
            '<p><strong>Scenarios</strong></p>' +
            toggles.map(function (t2) {
              return '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">' + t2[1] + '</span>' +
                ui().toggle(p.autoRemediation[t2[0]], 'data-secpol-toggle="' + t2[0] + '"' + (admin ? '' : ' disabled'), t2[1]) + '</div>';
            }).join('')) +
          (admin ? saveBtn('data-secpol-save') : '');

        function save() {
          secApi('PUT', '/admin/security-policies/security', p).then(function (res) {
            if (res.ok) ui().toast('Security policy saved');
            else res.json().then(function (j) { ui().toast((j && j.message) || 'Could not save'); }).catch(function () {});
          });
        }

        root.querySelectorAll('[data-secpol-toggle]').forEach(function (t2) {
          t2.addEventListener('change', function () {
            p.autoRemediation[t2.getAttribute('data-secpol-toggle')] = t2.checked;
            save();
          });
        });
        var saveB = root.querySelector('[data-secpol-save]');
        if (saveB) saveB.addEventListener('click', function () {
          p.trustedDomains = root.querySelector('[data-secpol-domains]').value.trim();
          save();
        });
      }).catch(function () { root.innerHTML = '<p class="tma-portal-note">Couldn\'t load the security policy. Refresh to try again.</p>'; });
    },
  };

  PAGES['alert-settings'] = {
    render: function (s) {
      var a = s.settings.alertSettings;
      var events = [
        ['differentCountry', 'A user signs in from a different country'],
        ['differentCity', 'A user signs in from a different city using a different device'],
        ['failedSignIns', 'There are multiple failed sign-in attempts on a user’s account'],
        ['suspiciousUpload', 'A suspicious file is uploaded to a folder'],
      ];
      return ui().section('',
        '<p class="tma-portal-note">We send security alerts whenever we detect potentially malicious activity. Choose which activities you’d like us to notify your users about.</p>' +
        '<table class="tma-portal-matrix"><thead>' +
        '<tr><th>Send an alert whenever…</th><th>Admin</th><th>Employees</th><th>Clients</th></tr></thead><tbody>' +
        events.map(function (ev) {
          return '<tr><td>' + ev[1] + '</td>' +
            ['admin', 'employees', 'clients'].map(function (who) {
              return '<td><input type="checkbox" data-alert="' + ev[0] + '.' + who + '"' + (a[ev[0]][who] ? ' checked' : '') + ' aria-label="' + ev[1] + ' - ' + who + '"></td>';
            }).join('') + '</tr>';
        }).join('') +
        '</tbody></table>' +
        saveBtn('data-alert-save')) +
        ui().section('Add Alternate Contacts',
          ui().field('Also send alerts to (comma separated emails)', ui().input({ value: a.alternateContacts, placeholder: 'security@yourfirm.com', attrs: 'data-alert-contacts' })));
    },
    wire: function (el, s) {
      wireSave(el, 'data-alert-save', function () {
        var a = s.settings.alertSettings;
        el.querySelectorAll('[data-alert]').forEach(function (cb) {
          var path = cb.getAttribute('data-alert').split('.');
          a[path[0]][path[1]] = cb.checked;
        });
        a.alternateContacts = el.querySelector('[data-alert-contacts]').value.trim();
      });
    },
  };

  PAGES['device-security'] = {
    render: function () {
      return '<div data-pol-root><p class="tma-portal-note">Loading…</p></div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-pol-root]');
      if (!root) return;
      secApi('GET', '/admin/security-policies').then(function (r) { return r.json(); }).then(function (all) {
        var d = all.deviceSecurity;
        var admin = all.isAdmin;
        var dis = admin ? '' : ' disabled';
        root.innerHTML =
          (admin ? '' : '<p class="tma-portal-note">Only administrators can change these settings.</p>') +
          ui().section('Standard (Most Accessible)',
            '<p class="tma-portal-note">Standard mode provides users with the most flexible options for accessing their account.</p>' +
            '<ul>' +
            '<li>Self Destruct is disabled</li>' +
            '<li>External Applications are enabled</li>' +
            '<li>Offline Access to Files is enabled</li>' +
            '<li>Require Pin Lock is disabled</li>' +
            '<li>Restrict Modified Devices is disabled</li>' +
            '<li>Automatic Login is enabled</li>' +
            '</ul>' +
            '<label class="tma-portal-checkbox"><input type="radio" name="device-default" value="standard"' + (d.defaultMode === 'standard' ? ' checked' : '') + dis + ' data-device-default>' +
            '<span>Set as the Default Security Setting</span></label>') +
          ui().section('Secure (Common Safeguards)',
            '<p class="tma-portal-note">Secure mode provides default settings that lock down access to documents while offline.</p>' +
            ui().field('Self Destruct - accounts are automatically removed:', ui().select(['Never', 'After 1 day offline', 'After 7 days offline', 'After 30 days offline'], d.selfDestruct, 'data-device-destruct' + dis)) +
            '<ul>' +
            '<li>External Applications are disabled</li>' +
            '<li>Offline Access to Files is disabled</li>' +
            '<li>Require Pin Lock is enabled</li>' +
            '<li>Restrict Modified Devices is enabled</li>' +
            '<li>Automatic Login is disabled</li>' +
            '</ul>' +
            '<label class="tma-portal-checkbox"><input type="radio" name="device-default" value="secure"' + (d.defaultMode === 'secure' ? ' checked' : '') + dis + ' data-device-default>' +
            '<span>Set as the Default Security Setting</span></label>') +
          (admin ? saveBtn('data-device-save') : '');

        var saveB = root.querySelector('[data-device-save]');
        if (saveB) saveB.addEventListener('click', function () {
          d.defaultMode = radioValue(root, 'device-default', 'standard');
          d.selfDestruct = root.querySelector('[data-device-destruct]').value;
          secApi('PUT', '/admin/security-policies/device', d).then(function (res) {
            if (res.ok) ui().toast('Device security saved');
            else res.json().then(function (j) { ui().toast((j && j.message) || 'Could not save'); }).catch(function () {});
          });
        });
      }).catch(function () { root.innerHTML = '<p class="tma-portal-note">Couldn\'t load device security. Refresh to try again.</p>'; });
    },
  };

  PAGES['super-users'] = {
    search: '',
    alpha: 'All',
    selected: {},
    render: function (s) {
      var self = PAGES['super-users'];
      var members = s.employees.filter(function (e) { return s.superUsers.indexOf(e.id) !== -1; });
      var list = members.filter(function (p) {
        if (self.alpha !== 'All' && (p.lastName || p.firstName).charAt(0).toUpperCase() !== self.alpha) return false;
        var q = self.search.toLowerCase();
        if (q && (p.firstName + ' ' + p.lastName + ' ' + p.email).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      var hasSelection = Object.keys(self.selected).some(function (k) { return self.selected[k]; });
      return ui().alphaFilter(self.alpha) +
        '<div class="tma-portal-toolbar">' +
        '<div class="tma-portal-toolbar__group">' + ui().searchInput('Search Users', 'data-super-search', self.search) + '</div>' +
        '<div class="tma-portal-toolbar__group">' +
        ui().btn({ label: 'Remove', variant: 'danger', attrs: 'data-super-remove', disabled: !hasSelection }) +
        ui().btn({ label: 'Add New User', attrs: 'data-super-add' }) +
        '</div></div>' +
        ui().table(['', 'Name', 'Email', 'Company'], list.map(function (p) {
          return '<tr>' +
            '<td><label class="tma-portal-checkbox"><input type="checkbox" data-super-select="' + p.id + '"' + (self.selected[p.id] ? ' checked' : '') + '></label></td>' +
            '<td><span class="tma-portal-avatar-cell"><img src="images/avatars/AvatarByewind.png" alt=""><strong>' + ui().esc(p.lastName + ', ' + p.firstName) + '</strong></span></td>' +
            '<td class="tma-portal-table__muted">' + ui().esc(p.email) + '</td>' +
            '<td class="tma-portal-table__muted">' + ui().esc(p.company || '-') + '</td></tr>';
        }).join('') || '<tr class="tma-portal-table__empty"><td colspan="4">No members match your filters.</td></tr>') +
        '<label class="tma-portal-checkbox"><input type="checkbox" data-super-hide' + (s.hideSuperGroup ? ' checked' : '') + '>' +
        '<span>Hide Super Group from Folder Access List</span></label>';
    },
    wire: function (el, s) {
      var self = PAGES['super-users'];
      el.querySelectorAll('[data-alpha]').forEach(function (b) {
        b.addEventListener('click', function () { self.alpha = b.getAttribute('data-alpha'); render(); });
      });
      var search = el.querySelector('[data-super-search]');
      if (search) search.addEventListener('input', function () { self.search = search.value; render(); });
      el.querySelectorAll('[data-super-select]').forEach(function (cb) {
        cb.addEventListener('change', function () { self.selected[cb.getAttribute('data-super-select')] = cb.checked; render(); });
      });
      var remove = el.querySelector('[data-super-remove]');
      if (remove) remove.addEventListener('click', function () {
        s.superUsers = s.superUsers.filter(function (id) { return !self.selected[id]; });
        self.selected = {};
        data().save(); ui().toast('Removed from Super User Group'); render();
      });
      var add = el.querySelector('[data-super-add]');
      if (add) add.addEventListener('click', function () {
        var candidates = s.employees.filter(function (e) { return s.superUsers.indexOf(e.id) === -1; });
        if (!candidates.length) { ui().toast('All employees are already super users'); return; }
        ui().openModal({
          title: 'Add to Super User Group',
          body: ui().field('Employee', ui().select(candidates.map(function (e) { return { value: e.id, label: e.lastName + ', ' + e.firstName + ' (' + e.email + ')' }; }), candidates[0].id, 'data-super-pick')) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Add', attrs: 'data-super-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-super-save]').addEventListener('click', function () {
              s.superUsers.push(host.querySelector('[data-super-pick]').value);
              data().save(); ui().closeModal(); ui().toast('Added to Super User Group'); render();
            });
          },
        });
      });
      var hide = el.querySelector('[data-super-hide]');
      if (hide) hide.addEventListener('change', function () { s.hideSuperGroup = hide.checked; data().save(); });
    },
  };

  PAGES['quarantined'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">We detected malicious content in these files.</p>' +
        '<div class="tma-portal-toolbar"><span></span><div class="tma-portal-toolbar__group">' +
        ui().btn({ label: 'Delete', variant: 'danger', attrs: 'data-quar-delete', disabled: !s.quarantinedFiles.length }) +
        ui().btn({ label: 'Download', attrs: 'data-quar-download', disabled: !s.quarantinedFiles.length }) +
        '</div></div>' +
        (s.quarantinedFiles.length
          ? ui().table(['File', 'Detected', 'Threat'], s.quarantinedFiles.map(function (f) {
              return '<tr><td><strong>' + ui().esc(f.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(f.date) + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(f.threat) + '</td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration03', title: 'Quarantined Files is empty', subtitle: 'Files flagged for malicious content will be held here.' }));
    },
    wire: function (el, s) {
      var del = el.querySelector('[data-quar-delete]');
      if (del) del.addEventListener('click', function () {
        s.quarantinedFiles = [];
        data().save(); ui().toast('Quarantined files permanently deleted'); render();
      });
      var dl = el.querySelector('[data-quar-download]');
      if (dl) dl.addEventListener('click', function () { ui().toast('Preparing download…'); });
    },
  };

  PAGES['connectors'] = {
    render: function (s) {
      var LOGOS = {
        box: { icon: 'Package' },
        dropbox: { brand: 'Dropbox40' },
        googledrive: { icon: 'HardDrives' },
        onedrive: { icon: 'Cloud' },
        onedrivebusiness: { icon: 'CloudCheck' },
        sharepoint: { icon: 'Buildings' },
      };
      return '<h3 class="tma-portal-section__title">Add Connectors</h3>' +
        '<p class="tma-portal-subtitle">Choose from the following services to add access through the portal.</p>' +
        '<div class="tma-portal-connector-list">' +
        s.connectors.map(function (c) {
          var logo = LOGOS[c.id] || { icon: 'Plug' };
          var src = logo.brand ? 'images/icons/brands/' + logo.brand + '.svg' : 'images/icons/phosphor/' + logo.icon + '.svg';
          return '<div class="tma-portal-connector">' +
            '<span class="tma-portal-connector__logo"><img src="' + src + '" alt=""></span>' +
            '<div class="tma-portal-connector__body">' +
            '<span class="tma-portal-connector__name">' + ui().esc(c.name) + '</span>' +
            '<span class="tma-portal-connector__desc">' + ui().esc(c.description) + '</span>' +
            '</div>' +
            (c.enabled
              ? '<span class="tma-portal-chip">Enabled</span>' + ui().btn({ label: 'Disable', variant: 'ghost', small: true, attrs: 'data-connector-off="' + c.id + '"' })
              : ui().btn({ label: c.action, small: true, attrs: 'data-connector-on="' + c.id + '"' })) +
            '</div>';
        }).join('') +
        '</div>';
    },
    wire: function (el, s) {
      function find(id) { return s.connectors.filter(function (c) { return c.id === id; })[0]; }
      el.querySelectorAll('[data-connector-on]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = find(b.getAttribute('data-connector-on'));
          if (c) { c.enabled = true; data().save(); ui().toast(c.name + ' connector enabled'); render(); }
        });
      });
      el.querySelectorAll('[data-connector-off]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = find(b.getAttribute('data-connector-off'));
          if (c) { c.enabled = false; data().save(); ui().toast(c.name + ' connector disabled'); render(); }
        });
      });
    },
  };

  PAGES['connection-manager'] = {
    render: function (s) {
      var enabled = s.connectors.filter(function (c) { return c.enabled; });
      return '<p class="tma-portal-subtitle">Review the external services currently connected to your account.</p>' +
        (enabled.length
          ? ui().table(['Service', 'Status'], enabled.map(function (c) {
              return '<tr><td><strong>' + ui().esc(c.name) + '</strong></td><td><span class="tma-portal-chip">Connected</span></td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration08', title: 'No active connections', subtitle: 'Enable a connector to link an external storage service.' }));
    },
  };

  PAGES['storage-usage'] = {
    render: function (s) {
      var files = s.folders.personal.length + s.folders.shared.length;
      return ui().section('Storage usage',
        '<p><strong>2.1 GB</strong> of <strong>1 TB</strong> used</p>' +
        '<div style="height:8px;border-radius:var(--radius-pill);background:var(--color-hover);overflow:hidden">' +
        '<div style="width:2%;height:100%;background:var(--color-black)"></div></div>' +
        '<p class="tma-portal-note">' + files + ' items across personal and shared folders. Storage is pooled across all licenses.</p>');
    },
  };

  PAGES['ai-settings'] = {
    render: function (s) {
      var a = s.settings.ai;
      return ui().section('AI-powered document request list generation',
        '<p class="tma-portal-note"><span class="tma-portal-chip">Beta</span></p>' +
        '<p>Generate document request lists with AI-powered recommendations. <span class="tma-portal-link">Learn More</span></p>' +
        '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Enable document request list generation</span>' +
        ui().toggle(a.requestList, 'data-ai-requests', 'Enable document request list generation') + '</div>') +
        ui().section('AI document assistant',
          '<p class="tma-portal-note"><span class="tma-portal-chip">Beta</span></p>' +
          '<p>Generate a document summary and ask questions with AI. <span class="tma-portal-link">Learn More</span></p>' +
          '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Enable AI document assistant</span>' +
          ui().toggle(a.docAssistant, 'data-ai-assistant', 'Enable AI document assistant') + '</div>');
    },
    wire: function (el, s) {
      el.querySelector('[data-ai-requests]').addEventListener('change', function (e) {
        s.settings.ai.requestList = e.target.checked; data().save();
      });
      el.querySelector('[data-ai-assistant]').addEventListener('change', function (e) {
        s.settings.ai.docAssistant = e.target.checked; data().save();
      });
    },
  };

  PAGES['email-settings'] = {
    render: function (s) {
      var e = s.settings.emailSettings;
      function radio(name, value, current, label, attr) {
        return '<label class="tma-portal-radio"><input type="radio" name="' + name + '" value="' + value + '"' + (current === value ? ' checked' : '') + ' ' + attr + '>' +
          '<span class="tma-portal-radio__dot" aria-hidden="true"></span><span>' + label + '</span></label>';
      }
      return ui().section('Send Emails Via',
        '<p class="tma-portal-note">Choose which notifications are sent through the portal mail server.</p>' +
        '<div class="tma-portal-radio-row" style="flex-direction:column;align-items:flex-start;gap:var(--space-8)">' +
        radio('email-via', 'uploads', e.sendVia, 'Uploads Only', 'data-email-via') +
        radio('email-via', 'downloads', e.sendVia, 'Downloads Only', 'data-email-via') +
        radio('email-via', 'both', e.sendVia, 'Both Uploads and Downloads', 'data-email-via') +
        '</div>', { help: 'Mail routing for notification emails' }) +
        ui().section('Upload Receipts',
          '<p>Send upload receipts for Request a File</p>' +
          ui().radioYesNo('email-receipts', e.uploadReceipts, 'data-email-receipts'), { help: 'Email clients a receipt when they upload files' }) +
        ui().section('Email Notifications',
          ui().field('Send email notifications:', ui().select(['Every 15 minutes', 'Every 30 minutes', 'Hourly', 'Daily'], e.notifyFrequency, 'data-email-frequency')) +
          ui().field('Default email language:', ui().select(['Invariant', 'English (US)', 'English (UK)', 'Spanish', 'French', 'Dutch', 'German'], e.language, 'data-email-language')), { help: 'How often notification digests are sent' }) +
        ui().section('Q & A Email Text',
          '<p>Show Question &amp; Answer text in the notification email</p>' +
          ui().radioYesNo('email-qa', e.qaText, 'data-email-qa'), { help: 'Include Q&A thread text in notifications' }) +
        saveBtn('data-email-save');
    },
    wire: function (el, s) {
      wireSave(el, 'data-email-save', function () {
        var e = s.settings.emailSettings;
        e.sendVia = radioValue(el, 'email-via', 'both');
        e.uploadReceipts = radioValue(el, 'email-receipts', 'no');
        e.notifyFrequency = el.querySelector('[data-email-frequency]').value;
        e.language = el.querySelector('[data-email-language]').value;
        e.qaText = radioValue(el, 'email-qa', 'yes');
      });
    },
  };

  PAGES['permissions'] = {
    render: function (s) {
      var p = s.settings.permissions;
      return ui().section('Client contact shares',
        '<p>Allow client contacts to share files</p>' +
        ui().radioYesNo('perm-shares', p.clientShares, 'data-perm-shares'), { help: 'Whether clients can re-share files' }) +
        ui().section('Folder access list',
          '<p>Show “People” tab to non-administrators</p>' +
          ui().radioYesNo('perm-people', p.showPeopleTab, 'data-perm-people'), { help: 'Visibility of the People tab' }) +
        saveBtn('data-perm-save');
    },
    wire: function (el, s) {
      wireSave(el, 'data-perm-save', function () {
        s.settings.permissions.clientShares = radioValue(el, 'perm-shares', 'no');
        s.settings.permissions.showPeopleTab = radioValue(el, 'perm-people', 'no');
      });
    },
  };

  PAGES['file-settings'] = {
    render: function (s) {
      var f = s.settings.fileSettings;
      var tokens = ['Email', 'First Name', 'Last Name', 'Company', 'IP Address', 'Date', 'Time'];
      return ui().section('Sorting',
        '<p>Enable Sorting</p>' +
        ui().radioYesNo('fs-sorting', f.sortingEnabled, 'data-fs-sorting') +
        '<div class="tma-portal-toolbar__group">' +
        ui().field('Default Sort:', ui().select(['Name', 'Date', 'Size', 'Type'], f.defaultSortField, 'data-fs-sort-field')) +
        ui().field('&nbsp;', ui().select(['Ascending', 'Descending'], f.defaultSortDir, 'data-fs-sort-dir', 'Sort direction')) +
        '</div>', { help: 'Default item ordering in folders' }) +
        ui().section('Versioning',
          '<p>Enable Versioning</p>' +
          ui().radioYesNo('fs-versioning', f.versioningEnabled, 'data-fs-versioning') +
          '<div class="tma-portal-toolbar__group">' +
          ui().field('Maximum Versions:', ui().select(['Custom…', 'Unlimited'], f.maxVersionsMode === 'Custom' ? 'Custom…' : 'Unlimited', 'data-fs-versions-mode')) +
          ui().field('&nbsp;', ui().input({ type: 'number', value: String(f.maxVersions), attrs: 'data-fs-versions min="1" max="10000"', ariaLabel: 'Maximum versions' }) + ' <span class="tma-portal-note">versions</span>') +
          '</div>', { help: 'Keep previous versions when files change' }) +
        ui().section('File Box',
          ui().field('Keep files in the File Box for:', ui().input({ type: 'number', value: String(f.fileBoxRetentionDays), attrs: 'data-fs-filebox min="1" max="365"', ariaLabel: 'File Box retention days' }) + ' <span class="tma-portal-note">days (default 180)</span>'), { help: 'File Box retention period' }) +
        ui().section('Watermark',
          '<p class="tma-portal-note">You can overlay a watermark on supported file types. Users with download permission will not see the watermark.</p>' +
          '<p>Enable Watermarking</p>' +
          ui().radioYesNo('fs-watermark', f.watermarkEnabled, 'data-fs-watermark') +
          '<div class="tma-portal-field"><span class="tma-portal-field__label">Watermark:</span>' +
          '<textarea class="tma-portal-textarea" data-fs-watermark-text>' + ui().esc(f.watermarkText) + '</textarea></div>' +
          '<p class="tma-portal-note">Insert dynamic text:</p>' +
          '<div class="tma-portal-watermark-tokens">' +
          tokens.map(function (t) { return '<button type="button" class="tma-portal-link" data-fs-token="{' + t.replace(/ /g, '') + '}">' + t + '</button>'; }).join('') +
          '</div>') +
        ui().section('Editing',
          '<p>Microsoft Office Editing <span class="tma-portal-help" title="Edit Office documents in the browser">&#9432;</span></p>' +
          '<p>Enable Editing</p>' +
          ui().radioYesNo('fs-editing', f.officeEditing, 'data-fs-editing')) +
        ui().section('Cloud Rendering',
          '<p>Enable Cloud Rendering of files on Customer Managed StorageZones for Feedback &amp; Approval and Custom Workflows</p>' +
          ui().radioYesNo('fs-cloud', f.cloudRendering, 'data-fs-cloud') +
          '<p class="tma-portal-note">If Cloud Rendering is enabled, the cloud keeps a temporary copy of the files (images, audio, PDF etc.) involved in your workflow. When the workflow completes:</p>' +
          '<ol>' +
          '<li>The cloud moves the files to the selected on-prem folder</li>' +
          '<li>If an end user views any file related to a completed workflow, a temporary copy of the file is made from on-prem to the cloud cache</li>' +
          '<li>A file will be available for up to 1 week in the cloud cache after the last time the file is viewed</li>' +
          '</ol>' +
          '<p class="tma-portal-note">If Cloud Rendering is disabled, end users will not be able to use Feedback and Approval or Custom Workflow features with files stored on Customer Managed StorageZones. It is recommended that all administrators communicate this information to their end users along with reviewing the End User Services Agreement and Privacy Policy.</p>') +
        saveBtn('data-fs-save');
    },
    wire: function (el, s) {
      el.querySelectorAll('[data-fs-token]').forEach(function (b) {
        b.addEventListener('click', function () {
          var ta = el.querySelector('[data-fs-watermark-text]');
          ta.value = (ta.value + ' ' + b.getAttribute('data-fs-token')).trim();
          ta.focus();
        });
      });
      wireSave(el, 'data-fs-save', function () {
        var f = s.settings.fileSettings;
        f.sortingEnabled = radioValue(el, 'fs-sorting', 'no');
        f.defaultSortField = el.querySelector('[data-fs-sort-field]').value;
        f.defaultSortDir = el.querySelector('[data-fs-sort-dir]').value;
        f.versioningEnabled = radioValue(el, 'fs-versioning', 'yes');
        f.maxVersionsMode = el.querySelector('[data-fs-versions-mode]').value.indexOf('Custom') === 0 ? 'Custom' : 'Unlimited';
        f.maxVersions = parseInt(el.querySelector('[data-fs-versions]').value, 10) || 10000;
        f.fileBoxRetentionDays = parseInt(el.querySelector('[data-fs-filebox]').value, 10) || 180;
        f.watermarkEnabled = radioValue(el, 'fs-watermark', 'yes');
        f.watermarkText = el.querySelector('[data-fs-watermark-text]').value.trim();
        f.officeEditing = radioValue(el, 'fs-editing', 'yes');
        f.cloudRendering = radioValue(el, 'fs-cloud', 'no');
      });
    },
  };

  PAGES['tools'] = {
    render: function (s) {
      var t = s.settings.tools;
      return '<p class="tma-portal-subtitle">Enable or disable access to individual components of the Power Tools suite using the options below. <strong>Note that any changes will affect all users of your account.</strong></p>' +
        ui().section('',
          '<label class="tma-portal-checkbox"><input type="checkbox" data-tools-apps' + (t.showAppsPage ? ' checked' : '') + '><span>Show Apps Page in Navigation Bar</span></label>' +
          '<label class="tma-portal-checkbox"><input type="checkbox" data-tools-betas' + (t.desktopBetas ? ' checked' : '') + '><span>Enable Desktop Apps Betas</span></label>' +
          ui().field('Show Tools in App List', ui().select(['All Available', 'Enabled Only', 'None'], t.showInList, 'data-tools-list'))) +
        ui().section('Desktop Apps',
          '<div class="tma-portal-feature"><img src="images/icons/phosphor/EnvelopeSimple.svg" alt="">' +
          '<div class="tma-portal-feature__body">' +
          '<span class="tma-portal-feature__title">Outlook Plug-in</span>' +
          '<label class="tma-portal-checkbox"><input type="checkbox" data-tools-outlook' + (t.outlookPlugin ? ' checked' : '') + '><span>Enabled</span></label>' +
          '<span class="tma-portal-feature__desc">The Outlook Plug-in integrates with Outlook on Windows to provide an easy interface to the portal, allowing you to quickly send and request files through e-mail.</span>' +
          '</div></div>' +
          '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Configure Plug-in', variant: 'ghost', attrs: 'data-tools-configure' }) + '</div>') +
        ui().section('External Tools',
          '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">FTPS Access</span>' +
          ui().toggle(t.ftpsAccess, 'data-tools-ftps', 'FTPS Access') + '</div>');
    },
    wire: function (el, s) {
      var t = s.settings.tools;
      el.querySelector('[data-tools-apps]').addEventListener('change', function (e) { t.showAppsPage = e.target.checked; data().save(); });
      el.querySelector('[data-tools-betas]').addEventListener('change', function (e) { t.desktopBetas = e.target.checked; data().save(); });
      el.querySelector('[data-tools-list]').addEventListener('change', function (e) { t.showInList = e.target.value; data().save(); });
      el.querySelector('[data-tools-outlook]').addEventListener('change', function (e) { t.outlookPlugin = e.target.checked; data().save(); });
      el.querySelector('[data-tools-ftps]').addEventListener('change', function (e) { t.ftpsAccess = e.target.checked; data().save(); });
      el.querySelector('[data-tools-configure]').addEventListener('click', function () {
        ui().openModal({
          title: 'Configure Outlook Plug-in',
          body: '<p>Default sharing options for files sent through the Outlook plug-in.</p>' +
            ui().field('Attachments larger than', ui().select(['5 MB', '10 MB', '20 MB', 'Always convert'], '10 MB', 'data-outlook-threshold')) +
            ui().field('Link expires after', ui().select(['7 days', '30 days', '90 days', 'Never'], '30 days', 'data-outlook-expiry')) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-outlook-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-outlook-save]').addEventListener('click', function () {
              ui().closeModal(); ui().toast('Plug-in settings saved');
            });
          },
        });
      });
    },
  };

  PAGES['folder-templates'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">Folder templates create a consistent subfolder structure whenever they are applied.</p>' +
        (s.folderTemplates.length
          ? ui().table(['Template', 'Subfolders', ''], s.folderTemplates.map(function (t) {
              return '<tr><td><strong>' + ui().esc(t.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(t.subfolders.join(', ')) + '</td>' +
                '<td><div class="tma-portal-row-actions">' +
                '<button type="button" class="tma-portal-icon-btn" data-ftpl-delete="' + t.id + '" title="Delete template" aria-label="Delete template"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                '</div></td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration03', title: 'No folder templates yet', subtitle: 'Create a template like “Client / Tax / 2026” to standardize folder structures.' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create folder template', attrs: 'data-ftpl-add' }) + '</div>';
    },
    wire: function (el, s) {
      el.querySelector('[data-ftpl-add]').addEventListener('click', function () {
        ui().openModal({
          title: 'Create folder template',
          body:
            ui().field('Template name', ui().input({ placeholder: 'e.g. New Client Setup', attrs: 'data-ftpl-name' })) +
            ui().field('Subfolders (comma separated)', ui().input({ placeholder: 'Documents, Contracts, Invoices', attrs: 'data-ftpl-folders' })) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-ftpl-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-ftpl-save]').addEventListener('click', function () {
              var name = host.querySelector('[data-ftpl-name]').value.trim();
              if (!name) { host.querySelector('[data-ftpl-name]').focus(); return; }
              var subfolders = host.querySelector('[data-ftpl-folders]').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
              s.folderTemplates.push({ id: data().uid('ftpl'), name: name, subfolders: subfolders });
              data().save(); ui().closeModal(); ui().toast('Folder template created'); render();
            });
          },
        });
      });
      el.querySelectorAll('[data-ftpl-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          s.folderTemplates = s.folderTemplates.filter(function (t) { return t.id !== b.getAttribute('data-ftpl-delete'); });
          data().save(); render();
        });
      });
    },
  };

  PAGES['upload-forms'] = {
    render: function (s) {
      return '<p class="tma-portal-subtitle">Remote Upload Forms let you place HTML code on your web site that allows visitors to upload file(s) from your web site directly into your account. You can specify the folder that uploaded files get saved to, and what additional information to collect from the person uploading files.</p>' +
        '<p class="tma-portal-note">For more information about this feature, please visit our <span class="tma-portal-link">knowledge base</span>.</p>' +
        '<div class="tma-portal-toolbar"><span></span>' + ui().btn({ label: 'Add New Form', variant: 'ghost', attrs: 'data-ruf-add' }) + '</div>' +
        (s.remoteUploadForms.length
          ? ui().table(['Form', 'Destination folder', 'Created', ''], s.remoteUploadForms.map(function (f) {
              return '<tr><td><strong>' + ui().esc(f.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(f.folder) + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(f.created) + '</td>' +
                '<td><div class="tma-portal-row-actions">' +
                '<button type="button" class="tma-portal-icon-btn" data-ruf-code="' + f.id + '" title="Get HTML code" aria-label="Get HTML code"><img src="images/icons/phosphor/FileCode.svg" alt=""></button>' +
                '<button type="button" class="tma-portal-icon-btn" data-ruf-delete="' + f.id + '" title="Deactivate form" aria-label="Deactivate form"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                '</div></td></tr>';
            }).join(''))
          : '<div class="tma-portal-table-wrap"><div style="padding:var(--space-24);text-align:center"><p class="tma-portal-note">No forms exist yet.</p></div></div>');
    },
    wire: function (el, s) {
      el.querySelector('[data-ruf-add]').addEventListener('click', function () {
        var folders = s.folders.personal.map(function (f) { return f.name; });
        ui().openModal({
          title: 'Add New Form',
          body:
            ui().field('Form name', ui().input({ placeholder: 'e.g. Website uploads', attrs: 'data-ruf-name' })) +
            ui().field('Destination folder', ui().select(folders.length ? folders : ['File Box'], folders[0] || 'File Box', 'data-ruf-folder')) +
            ui().field('Collect from uploader', ui().select(['Name and email', 'Email only', 'Nothing'], 'Name and email', 'data-ruf-info')) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create form', attrs: 'data-ruf-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-ruf-save]').addEventListener('click', function () {
              var name = host.querySelector('[data-ruf-name]').value.trim();
              if (!name) { host.querySelector('[data-ruf-name]').focus(); return; }
              s.remoteUploadForms.push({
                id: data().uid('ruf'), name: name,
                folder: host.querySelector('[data-ruf-folder]').value,
                info: host.querySelector('[data-ruf-info]').value,
                created: data().shortDate(),
              });
              data().save(); ui().closeModal(); ui().toast('Upload form created'); render();
            });
          },
        });
      });
      el.querySelectorAll('[data-ruf-code]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = s.remoteUploadForms.filter(function (x) { return x.id === b.getAttribute('data-ruf-code'); })[0];
          ui().openModal({
            title: 'Embed code - ' + (f ? f.name : ''),
            body: '<p>Paste this snippet into your website:</p>' +
              '<div class="tma-portal-section__card"><code style="font-size:var(--text-size-12);word-break:break-all">&lt;iframe src="https://portal.tmantoinelaw.com/upload/' + (f ? f.id : '') + '" width="100%" height="480"&gt;&lt;/iframe&gt;</code></div>',
          });
        });
      });
      el.querySelectorAll('[data-ruf-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          s.remoteUploadForms = s.remoteUploadForms.filter(function (x) { return x.id !== b.getAttribute('data-ruf-delete'); });
          data().save(); ui().toast('Form deactivated'); render();
        });
      });
    },
  };

  PAGES['file-drops'] = {
    selected: {},
    render: function (s) {
      var self = PAGES['file-drops'];
      var hasSelection = Object.keys(self.selected).some(function (k) { return self.selected[k]; });
      return '<p class="tma-portal-subtitle">A File Drop is a page you can link to from your website, where visitors can select an employee and upload one or more files to their File Box. Your account can have one public File Drop, and you can make other File Drop links for different groups of employee users. A File Drop can also be integrated more tightly into your website when used in conjunction with a Remote Upload form.</p>' +
        '<p class="tma-portal-note">The recipient of a file drop upload will automatically receive an email notification.</p>' +
        '<div class="tma-portal-toolbar"><span></span><div class="tma-portal-toolbar__group">' +
        ui().btn({ label: 'Delete Selected File Drops', variant: 'ghost', attrs: 'data-drop-delete', disabled: !hasSelection }) +
        ui().btn({ label: 'Create New File Drop', attrs: 'data-drop-add' }) +
        '</div></div>' +
        ui().table(['', 'Name', 'Public', 'Require User Info', 'Members', 'Direct Link'],
          s.fileDrops.length
            ? s.fileDrops.map(function (d) {
                return '<tr>' +
                  '<td><label class="tma-portal-checkbox"><input type="checkbox" data-drop-select="' + d.id + '"' + (self.selected[d.id] ? ' checked' : '') + '></label></td>' +
                  '<td><strong>' + ui().esc(d.name) + '</strong></td>' +
                  '<td class="tma-portal-table__muted">' + (d.isPublic ? 'Yes' : 'No') + '</td>' +
                  '<td class="tma-portal-table__muted">' + (d.requireInfo ? 'Yes' : 'No') + '</td>' +
                  '<td class="tma-portal-table__muted">' + d.members + '</td>' +
                  '<td><button type="button" class="tma-portal-link" data-drop-link="' + d.id + '">Copy link</button></td>' +
                  '</tr>';
              }).join('')
            : '<tr class="tma-portal-table__empty"><td colspan="6">No file drops yet.</td></tr>');
    },
    wire: function (el, s) {
      var self = PAGES['file-drops'];
      el.querySelector('[data-drop-add]').addEventListener('click', function () {
        var hasPublic = s.fileDrops.some(function (d) { return d.isPublic; });
        ui().openModal({
          title: 'Create New File Drop',
          body:
            ui().field('Name', ui().input({ placeholder: 'e.g. Client uploads', attrs: 'data-drop-name' })) +
            '<label class="tma-portal-checkbox"><input type="checkbox" data-drop-public' + (hasPublic ? ' disabled' : ' checked') + '><span>Public file drop' + (hasPublic ? ' (your account already has one)' : '') + '</span></label>' +
            '<label class="tma-portal-checkbox"><input type="checkbox" data-drop-info checked><span>Require uploader name and email</span></label>' +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-drop-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-drop-save]').addEventListener('click', function () {
              var name = host.querySelector('[data-drop-name]').value.trim();
              if (!name) { host.querySelector('[data-drop-name]').focus(); return; }
              s.fileDrops.push({
                id: data().uid('drop'), name: name,
                isPublic: host.querySelector('[data-drop-public]').checked && !hasPublic,
                requireInfo: host.querySelector('[data-drop-info]').checked,
                members: s.employees.length,
              });
              data().save(); ui().closeModal(); ui().toast('File drop created'); render();
            });
          },
        });
      });
      el.querySelectorAll('[data-drop-select]').forEach(function (cb) {
        cb.addEventListener('change', function () { self.selected[cb.getAttribute('data-drop-select')] = cb.checked; render(); });
      });
      var del = el.querySelector('[data-drop-delete]');
      if (del) del.addEventListener('click', function () {
        s.fileDrops = s.fileDrops.filter(function (d) { return !self.selected[d.id]; });
        self.selected = {};
        data().save(); ui().toast('File drops deleted'); render();
      });
      el.querySelectorAll('[data-drop-link]').forEach(function (b) {
        b.addEventListener('click', function () {
          var url = 'https://portal.tmantoinelaw.com/filedrop/' + b.getAttribute('data-drop-link');
          if (navigator.clipboard) navigator.clipboard.writeText(url);
          ui().toast('Direct link copied');
        });
      });
    },
  };

  /* ── shell ──────────────────────────────────────── */
  function renderNav() {
    return NAV.map(function (n) {
      if (!n.items) {
        return '<button type="button" class="tma-portal-admin__nav-item' + (state.page === n.id ? ' is-active' : '') + '" data-admin-nav="' + n.id + '">' + ui().esc(n.label) + '</button>';
      }
      var open = !!state.expanded[n.group];
      return '<button type="button" class="tma-portal-admin__nav-item" data-admin-group="' + n.group + '" aria-expanded="' + open + '">' + ui().esc(n.label) +
        '<img class="tma-portal-admin__caret" src="images/icons/phosphor/CaretRight.svg" alt=""></button>' +
        (open
          ? '<div class="tma-portal-admin__subnav">' +
            n.items.map(function (it) {
              return '<button type="button" class="tma-portal-admin__nav-item' + (state.page === it.id ? ' is-active' : '') + '" data-admin-nav="' + it.id + '">' + ui().esc(it.label) + '</button>';
            }).join('') +
            '</div>'
          : '');
    }).join('');
  }

  function setPage(pageId) {
    state.page = PAGES[pageId] ? pageId : 'admin-overview';
    var group = groupForPage(state.page);
    if (group) state.expanded[group] = true;
    render();
  }

  function render() {
    var el = state.el;
    if (!el) return;
    var s = data().state();
    var page = PAGES[state.page];

    el.innerHTML =
      '<div class="tma-portal-page"><div class="tma-portal-admin">' +
      '<nav class="tma-portal-admin__nav" aria-label="Account settings sections">' + renderNav() + '</nav>' +
      '<div class="tma-portal-admin__content">' +
      '<h2 class="tma-portal-admin__page-title">' + ui().esc(pageTitle(state.page)) + '</h2>' +
      page.render(s) +
      '</div></div></div>';

    el.querySelectorAll('[data-admin-nav]').forEach(function (b) {
      b.addEventListener('click', function () { setPage(b.getAttribute('data-admin-nav')); });
    });
    el.querySelectorAll('[data-admin-group]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-admin-group');
        state.expanded[g] = !state.expanded[g];
        render();
      });
    });

    if (page.wire) page.wire(el.querySelector('.tma-portal-admin__content'), s);
  }

  function mount(el, opts) {
    state.el = el;
    if (opts && opts.adminPage && PAGES[opts.adminPage]) {
      state.page = opts.adminPage;
      var group = groupForPage(state.page);
      if (group) state.expanded[group] = true;
    }
    render();
  }

  window.TMAPortalAdmin = { setPage: setPage };
  if (window.TMAPortalViews) window.TMAPortalViews.register('admin', mount);
})();
