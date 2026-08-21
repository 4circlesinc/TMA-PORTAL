/*
 * TMA - Portal Account settings (admin area)
 * Secondary nav + admin pages: Admin Overview, Background Operations,
 * Account and Reporting, Client hub management, Security, Connectors,
 * Connection Manager, Storage, Advanced Preferences.
 * Registers view: 'admin'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  /* Which sections this account may open. The rail is one static list shared
     by every account type, so without this an employee or a client was offered
     the firm's security policy, branding, billing and Advanced Preferences
     alongside their own profile. The map lives in portal-access.js next to the
     sidebar's; the server enforces the same capabilities again on every
     endpoint these pages call.

     Until /me answers, can() is false and only the personal sections render —
     the admin ones appear a beat later, the same beat the rail already waits
     for to show the reader's name. A missing access module (a shell that never
     loaded it) opens everything rather than stranding an administrator with no
     settings at all. */
  function access() { return window.TMAPortalAccess; }

  function allowed(pageId) {
    if (pageId === 'reporting') return false;
    var a = access();
    return !a || !a.canSettingsPage || a.canSettingsPage(pageId);
  }

  var state = { el: null, page: 'profile', expanded: {} };

  /* Personal sections reuse the real panels from settings.js */
  var SETTINGS_PAGES = [
    { id: 'theme', label: 'Theme', icon: 'Palette' },
    { id: 'time', label: 'Time and language', icon: 'SunHorizon' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'privacy', label: 'Privacy', icon: 'HandPalm' },
  ];

  var NAV = [
    { id: 'profile', label: 'My profile', icon: 'UserCircle' },
    { id: 'theme', label: 'Theme', icon: 'Palette' },
    { id: 'time', label: 'Time and language', icon: 'SunHorizon' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'privacy', label: 'Privacy', icon: 'HandPalm' },
    { id: 'background-ops', label: 'Background Operations', icon: 'ArrowsClockwise' },
    { group: 'reporting-group', label: 'Account and Reporting', icon: 'ChartBar', items: [
      { id: 'notification-history', label: 'Notification History' },
      { id: 'branding', label: 'Edit Company Branding' },
    ] },
    { group: 'clienthub-group', label: 'CIP Console', icon: 'UsersThree', items: [
      { id: 'clienthub-access', label: 'Access' },
      { id: 'service-teams', label: 'Service teams' },
      { id: 'custom-fields', label: 'Custom fields' },
      { id: 'cip-documents', label: 'Document requirements' },
      { id: 'cip-letters', label: 'Granted and Denied letters' },
    ] },
    { group: 'security-group', label: 'Security', icon: 'ShieldCheck', items: [
      { id: 'account-security', label: 'Account security' },
      { id: 'security-insights', label: 'Security Insights' },
      { id: 'signin-policy', label: 'Sign in policy' },
      { id: 'security-policy', label: 'Security policy' },
      { id: 'alert-settings', label: 'Security alert settings' },
      { id: 'device-security', label: 'Configure device security' },
    ] },
    { id: 'connectors', label: 'Connectors', icon: 'Plugs' },
    { group: 'storage-group', label: 'Storage', icon: 'HardDrives', items: [
      { id: 'storage-usage', label: 'Usage' },
    ] },
    { group: 'prefs-group', label: 'Advanced Preferences', icon: 'SlidersHorizontal', items: [
      { id: 'permissions', label: 'Permissions' },
      { id: 'default-folders', label: 'Default Folders' },
      { id: 'folder-templates', label: 'Folder Templates' },
    ] },
  ];

  /* Every group in the rail starts open. The sections inside them are what the
     page is for, and leaving them shut hid most of Settings behind a caret.
     Collapsing still works — it just isn't where a reader starts. */
  NAV.forEach(function (n) { if (n.group) state.expanded[n.group] = true; });

  function groupForPage(pageId) {
    var found = null;
    NAV.forEach(function (n) {
      if (n.items && n.items.some(function (it) { return it.id === pageId; })) found = n.group;
    });
    return found;
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

  /* Server-backed: the real queue. Long jobs (mail import, calendar import,
     OneDrive sync, outbound email) all run here, and their signature failure
     is a worker that stopped — so the health line comes first. */
  PAGES['background-ops'] = {
    render: function () {
      secEnsureStyles();
      return '<div data-ops-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-ops-root]');
      if (!root) return;
      var esc = ui().esc;

      function ago(seconds) {
        if (!seconds || seconds < 60) return 'just now';
        var m = Math.floor(seconds / 60);
        if (m < 60) return m + ' minute' + (m === 1 ? '' : 's');
        var h = Math.floor(m / 60);
        if (h < 24) return h + ' hour' + (h === 1 ? '' : 's');
        var d = Math.floor(h / 24);
        return d + ' day' + (d === 1 ? '' : 's');
      }

      function when(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleString();
      }

      function empty(text) {
        return '<p class="tma-portal-note" style="text-align:center;padding:var(--space-16) 0">' + text + '</p>';
      }

      function importsSection(d) {
        var targets = (d.imports && d.imports.targets) || [];
        if (!targets.length) {
          return empty('No import sources are connected yet.');
        }
        return targets.map(function (t) {
          return '<div class="tma-portal-toggle-row">' +
            '<span class="tma-portal-toggle-row__label">' +
            '<strong>' + esc(t.name) + '</strong>' +
            (t.paused ? ' <span class="tma-portal-status tma-portal-status--pending">Paused</span>' : '') +
            '<br><span class="tma-portal-note">' + esc(t.detail || '') + '</span></span>' +
            ui().toggle(!!t.paused, 'data-ops-import-pause="' + esc(t.id) + '"', 'Pause ' + t.name) +
            '</div>';
        }).join('') +
          '<p class="tma-portal-note" style="margin:var(--space-8) 0 0">Pause one source at a time. Mailbox and calendar sync stay on each person\'s Connectors settings.</p>';
      }

      function load() {
        secApi('GET', '/admin/background-ops').then(function (r) { return r.json(); }).then(function (d) {
          var pauseBlock = importsSection(d);

          if (!d.inspectable) {
            root.innerHTML =
              '<p class="tma-portal-subtitle">Long-running work runs on the <strong>' +
              esc(d.driver || 'unknown') + '</strong> queue, which can\'t be inspected from here.</p>' +
              ui().section('Imports', pauseBlock);
            wirePause();
            return;
          }

          var h = d.health || {};
          var health = h.stalled
            ? '<div class="tma-portal-connector" style="border-left:3px solid var(--color-red, #d64545)">' +
              '<div class="tma-portal-connector__body">' +
              '<span class="tma-portal-connector__name">Nothing is processing the queue</span>' +
              '<span class="tma-portal-connector__desc">' + h.pending + ' job(s) waiting, the oldest for ' +
              esc(ago(h.oldestWaitSeconds)) + '. Email, calendar and file sync stay stuck until a worker runs.' +
              '</span></div></div>'
            : '<div class="tma-portal-connector">' +
              '<div class="tma-portal-connector__body">' +
              '<span class="tma-portal-connector__name">' +
              (h.pending ? 'Working through ' + h.pending + ' job(s)' : 'Everything is up to date') + '</span>' +
              '<span class="tma-portal-connector__desc">' +
              (h.failed ? h.failed + ' job(s) failed and need attention.' : 'No failed jobs.') +
              '</span></div></div>';

          var pending = (d.pending || []).length
            ? (d.pending).map(function (j) {
                return '<div class="tma-portal-toggle-row">' +
                  '<span class="tma-portal-toggle-row__label">' + esc(j.name) +
                  (j.attempts > 0 ? ' <span class="tma-portal-note">(attempt ' + (j.attempts + 1) + ')</span>' : '') +
                  '</span>' +
                  '<span class="tma-portal-note">' + (j.reserved ? 'Running' : 'Waiting ' + esc(ago(j.waitingSeconds))) + '</span>' +
                  '</div>';
              }).join('')
            : empty('Nothing is queued.');

          var failed = (d.failed || []).length
            ? (d.failed).map(function (j) {
                return '<div class="tma-portal-toggle-row">' +
                  '<span class="tma-portal-toggle-row__label">' + esc(j.name) +
                  '<br><span class="tma-portal-note">' + esc(j.error || '') + '</span></span>' +
                  '<span style="display:flex;align-items:center;gap:6px">' +
                  '<span class="tma-portal-note">' + esc(when(j.failedAt)) + '</span>' +
                  ui().btn({ label: 'Retry', small: true, attrs: 'data-ops-retry="' + esc(j.uuid) + '"' }) +
                  ui().btn({ label: 'Dismiss', variant: 'ghost', small: true, attrs: 'data-ops-forget="' + esc(j.uuid) + '"' }) +
                  '</span></div>';
              }).join('')
            : empty('No failed jobs.');

          root.innerHTML =
            '<p class="tma-portal-subtitle">Work the portal does in the background — importing mail and files, ' +
            'syncing calendars, sending email. You can keep working while these run.</p>' +
            ui().section('Imports', pauseBlock) +
            health +
            ui().section('Queued', pending) +
            ui().section('Failed', failed +
              ((d.failed || []).length
                ? '<div style="margin-top:8px">' + ui().btn({ label: 'Clear all failed', variant: 'ghost', small: true, attrs: 'data-ops-flush' }) + '</div>'
                : ''));

          wirePause();

          root.querySelectorAll('[data-ops-retry], [data-ops-forget]').forEach(function (b) {
            b.addEventListener('click', function () {
              var uuid = b.getAttribute('data-ops-retry') || b.getAttribute('data-ops-forget');
              var action = b.hasAttribute('data-ops-retry') ? 'retry' : 'forget';
              b.disabled = true;
              secApi('POST', '/admin/background-ops/retry', { uuid: uuid, action: action })
                .then(function (res) {
                  ui().toast(res.ok ? (action === 'retry' ? 'Job queued again' : 'Job dismissed') : 'Could not update that job');
                  load();
                });
            });
          });

          var flush = root.querySelector('[data-ops-flush]');
          if (flush) {
            flush.addEventListener('click', function () {
              flush.disabled = true;
              secApi('POST', '/admin/background-ops/flush', {}).then(function (res) {
                ui().toast(res.ok ? 'Failed jobs cleared' : 'Could not clear');
                load();
              });
            });
          }
        }).catch(function () {
          root.innerHTML = '<p class="tma-portal-note">Couldn\'t load background operations. Refresh to try again.</p>';
        });
      }

      function wirePause() {
        root.querySelectorAll('[data-ops-import-pause]').forEach(function (sw) {
          sw.addEventListener('change', function () {
            var target = sw.getAttribute('data-ops-import-pause');
            var next = !!sw.checked;
            sw.disabled = true;
            secApi('PUT', '/admin/background-ops/imports-pause', { target: target, paused: next })
              .then(function (res) {
                if (!res.ok) {
                  sw.checked = !next;
                  ui().toast('Could not update that import');
                  sw.disabled = false;
                  return;
                }
                ui().toast(next ? 'Import paused' : 'Import resumed');
                load();
              })
              .catch(function () {
                sw.checked = !next;
                ui().toast('Could not update that import');
                sw.disabled = false;
              });
          });
        });
      }

      load();
    },
  };

  /* ── Account and Reporting ──────────────────────────────────────────
     All three pages below used to read and write window.TMAPortalData, the
     localStorage store — so a "report" held a name and a date and no numbers,
     the notification history listed whatever the mock had pushed into it, and
     branding applied to the one browser that typed it. They are server-backed
     now: ReportsController (numbers computed from the portal's own tables),
     NotificationHistoryController (the real email_deliveries log) and
     BrandingController (portal_settings, shared by the whole firm). */

  /* Delivery and report states, in the documented status-chip colours. */
  function statusChip(status) {
    var tone = {
      ready: 'success', sent: 'success', delivered: 'success', opened: 'success', clicked: 'success',
      failed: 'danger', bounced: 'danger',
      pending: 'pending', queued: 'pending',
    }[status] || 'neutral';
    var label = String(status || '').replace(/^./, function (c) { return c.toUpperCase(); });
    return '<span class="tma-portal-status tma-portal-status--' + tone + '">' + ui().esc(label) + '</span>';
  }

  function whenDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }

  PAGES['reporting'] = {
    tab: 'recent',
    open: null,        // uid of the report being read, or null for the list
    render: function () {
      return '<div data-rep-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var self = PAGES['reporting'];
      var root = el.querySelector('[data-rep-root]');
      if (!root) return;
      var esc = ui().esc;
      var payload = null;

      function fail(message) {
        root.innerHTML = '<p class="tma-portal-note">' + esc(message) + '</p>';
      }

      /* repaint: false refreshes the list behind a report that is already on
         screen, so creating one doesn't paint its numbers and then immediately
         fetch and paint them a second time. */
      function load(repaint) {
        return secApi('GET', '/admin/reports').then(function (r) {
          if (r.status === 403) { fail('Only administrators can open reporting.'); return null; }
          /* A failed request still answers with JSON, so parsing it and
             carrying on paints "no reports have been created yet" over what is
             actually a broken endpoint. Anything but a 200 is a failure. */
          if (!r.ok) { fail('Couldn\'t load reports. Refresh to try again.'); return null; }
          return r.json();
        }).then(function (d) {
          if (!d) return;
          payload = d;
          if (repaint === false) return;
          self.open ? openReport(self.open) : paintList();
        }).catch(function () { fail('Couldn\'t load reports. Refresh to try again.'); });
      }

      /* ── the two tabs ─────────────────────────────── */
      function paintList() {
        self.open = null;
        var list = self.tab === 'recent' ? (payload.recent || []) : (payload.recurring || []);

        var rows = list.map(function (r) {
          return '<tr>' +
            '<td><button type="button" class="tma-portal-link" data-rep-open="' + esc(r.id) + '">' + esc(r.name) + '</button></td>' +
            '<td class="tma-portal-table__muted">' + esc(typeLabel(r.type)) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(r.range) + '</td>' +
            '<td>' + statusChip(r.status) +
            (r.frequency ? ' <span class="tma-portal-note">' + esc(r.frequency === 'weekly' ? 'Weekly' : 'Monthly') + '</span>' : '') +
            '</td>' +
            '<td class="tma-portal-table__muted">' + esc(whenDate(r.generatedAt || r.created)) + '</td>' +
            '<td>' + ui().btn({ label: 'Delete', variant: 'ghost', small: true, attrs: 'data-rep-delete="' + esc(r.id) + '"' }) + '</td>' +
            '</tr>';
        }).join('');

        root.innerHTML =
          '<div class="tma-portal-toolbar">' +
          ui().tabs([{ key: 'recent', label: 'Recent Reports' }, { key: 'recurring', label: 'Recurring Reports' }], self.tab) +
          ui().btn({ label: 'Create Report', attrs: 'data-rep-create' }) +
          '</div>' +
          (list.length
            ? ui().table(['Report', 'Type', 'Date range', 'Status', 'Generated', ''], rows)
            : ui().emptyState({
                illustration: 'Illustration04',
                title: self.tab === 'recent' ? 'No reports have been created yet.' : 'No recurring reports.',
                subtitle: self.tab === 'recent'
                  ? 'Create a report to see how your account is being used.'
                  : 'A recurring report re-measures itself every week or month.',
              }));

        /* The tab markup is new on every repaint and needs re-initialising,
           but `root` is the same node — wiring the change listener again would
           stack another handler on it each time a tab is clicked. */
        if (root._repTabsWired) {
          if (window.PortalTabGroup) window.PortalTabGroup.init(root);
        } else {
          root._repTabsWired = true;
          ui().wireTabs(root, function (key) { self.tab = key; paintList(); });
        }

        root.querySelectorAll('[data-rep-open]').forEach(function (b) {
          b.addEventListener('click', function () { openReport(b.getAttribute('data-rep-open')); });
        });
        root.querySelectorAll('[data-rep-delete]').forEach(function (b) {
          b.addEventListener('click', function () { removeReport(b.getAttribute('data-rep-delete'), b); });
        });
        var create = root.querySelector('[data-rep-create]');
        if (create) create.addEventListener('click', createDialog);
      }

      function typeLabel(type) {
        var found = (payload.types || []).filter(function (t) { return t.value === type; })[0];
        return found ? found.label : type;
      }

      /* ── one report ───────────────────────────────── */
      function openReport(uid) {
        self.open = uid;
        root.innerHTML = ui().loading();
        secApi('GET', '/admin/reports/' + encodeURIComponent(uid)).then(function (r) {
          if (r.status === 404) { self.open = null; paintList(); return null; }
          return r.json();
        }).then(function (d) { if (d) paintReport(d.report); })
          .catch(function () { fail('Couldn\'t open that report. Refresh to try again.'); });
      }

      function paintReport(report) {
        var d = report.data || {};

        /* The documented KPI card - same component as the dashboard's metric
           row, alternating the two card colours the way it does. */
        var cards = (d.metrics || []).map(function (m, i) {
          return '<article class="tma-dash__card tma-dash__card--' + (i % 2 ? 'purple' : 'blue') + '">' +
            '<div class="tma-dash__card-head"><span class="tma-dash__card-label">' + esc(m.label) + '</span></div>' +
            '<div class="tma-dash__card-row"><div class="tma-dash__card-value">' + esc(m.value) + '</div></div>' +
            (m.hint ? '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">' + esc(m.hint) + '</span></div>' : '') +
            '</article>';
        }).join('');

        var breakdown = d.table && (d.table.rows || []).length
          ? ui().section(d.table.title, ui().table(d.table.columns || [], d.table.rows.map(function (row) {
              return '<tr>' + row.map(function (cell, i) {
                return '<td' + (i ? ' class="tma-portal-table__muted"' : '') + '>' + esc(cell) + '</td>';
              }).join('') + '</tr>';
            }).join('')))
          : '';

        root.innerHTML =
          '<div class="tma-portal-toolbar">' +
          '<button type="button" class="tma-portal-link" data-rep-back>&larr; All reports</button>' +
          '<div class="tma-portal-toolbar__group">' +
          ui().btn({ label: 'Run again', variant: 'ghost', small: true, attrs: 'data-rep-run' }) +
          ui().btn({ label: 'Download CSV', variant: 'ghost', small: true, attrs: 'data-rep-csv' }) +
          '</div></div>' +
          '<h3 class="tma-portal-section__title">' + esc(report.name) + '</h3>' +
          '<p class="tma-portal-subtitle">' + esc(report.range) +
          (report.generatedAt ? ' · measured ' + esc(new Date(report.generatedAt).toLocaleString()) : '') +
          (report.frequency ? ' · repeats ' + esc(report.frequency) : '') +
          '</p>' +
          (report.status === 'failed'
            ? ui().banner('warning', 'This report could not be generated. ' + esc(report.error || ''))
            : '<div class="tma-dash__cards">' + cards + '</div>' + breakdown);

        root.querySelector('[data-rep-back]').addEventListener('click', paintList);

        root.querySelector('[data-rep-run]').addEventListener('click', function () {
          secApi('POST', '/admin/reports/' + encodeURIComponent(report.id) + '/run').then(function (r) { return r.json(); })
            .then(function (d2) {
              ui().toast('Report measured again');
              paintReport(d2.report);
            }).catch(function () { ui().toastError('Could not run that report'); });
        });

        root.querySelector('[data-rep-csv]').addEventListener('click', function () {
          window.location.href = '/admin/reports/' + encodeURIComponent(report.id) + '/export';
        });
      }

      /* ── create ───────────────────────────────────── */
      function createDialog() {
        var today = new Date().toISOString().slice(0, 10);
        var cip = payload.cip || null;
        var any = [{ value: '', label: 'Any' }];
        ui().openModal({
          title: 'Create Report',
          body:
            ui().field('Report type', ui().select(payload.types || [], 'usage', 'data-rep-type', 'Report type')) +
            '<div data-rep-cip hidden>' +
            (cip
              ? ui().field('Preset', ui().select([{ value: '', label: 'Custom' }].concat(cip.presets || []), '', 'data-rep-preset', 'Preset')) +
                ui().field('Status', ui().select(any.concat(cip.statuses || []), '', 'data-rep-status', 'Status')) +
                ui().field('Service provider', ui().select(any.concat(cip.providers || []), '', 'data-rep-provider', 'Service provider')) +
                ui().field('Investment type', ui().select(any.concat(cip.investmentTypes || []), '', 'data-rep-investment', 'Investment type')) +
                ui().field('Applicant', ui().input({ attrs: 'data-rep-applicant', placeholder: 'Name', ariaLabel: 'Applicant' })) +
                ui().field('Assigned officer', ui().select(any.concat(cip.officers || []), '', 'data-rep-officer', 'Assigned officer')) +
                ui().field('Submitted from', ui().input({ type: 'date', attrs: 'data-rep-submitted-from' })) +
                ui().field('Submitted to', ui().input({ type: 'date', attrs: 'data-rep-submitted-to' })) +
                ui().field('Decision from', ui().input({ type: 'date', attrs: 'data-rep-decided-from' })) +
                ui().field('Decision to', ui().input({ type: 'date', attrs: 'data-rep-decided-to' }))
              : '') +
            '</div>' +
            ui().field('Date range', ui().select(payload.ranges || [], 'last_30', 'data-rep-range', 'Date range')) +
            '<div data-rep-custom hidden>' +
            ui().field('From', ui().input({ type: 'date', attrs: 'data-rep-from', value: today })) +
            ui().field('To', ui().input({ type: 'date', attrs: 'data-rep-to', value: today })) +
            '</div>' +
            '<label class="tma-portal-checkbox"><input type="checkbox" data-rep-recurring><span>Run this report on a recurring schedule</span></label>' +
            '<div data-rep-freq hidden>' +
            ui().field('How often', ui().select(payload.frequencies || [], 'weekly', 'data-rep-frequency', 'Frequency')) +
            '</div>' +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create Report', attrs: 'data-rep-save' }) + '</div>',
          onMount: function (host) {
            var type = host.querySelector('[data-rep-type]');
            var range = host.querySelector('[data-rep-range]');
            var custom = host.querySelector('[data-rep-custom]');
            var cipBox = host.querySelector('[data-rep-cip]');
            var recurring = host.querySelector('[data-rep-recurring]');
            var freq = host.querySelector('[data-rep-freq]');

            function syncType() {
              var isCip = type.value === 'cip';
              if (cipBox) cipBox.hidden = !isCip;
              if (isCip && range.value === 'last_30') range.value = 'all';
            }

            range.addEventListener('change', function () { custom.hidden = range.value !== 'custom'; });
            recurring.addEventListener('change', function () { freq.hidden = !recurring.checked; });
            if (type) type.addEventListener('change', syncType);
            syncType();

            function val(attr) {
              var el = host.querySelector('[' + attr + ']');
              return el && el.value ? el.value : '';
            }

            var save = host.querySelector('[data-rep-save]');
            save.addEventListener('click', function () {
              save.disabled = true;
              var body = {
                type: type.value,
                range: range.value,
                startsOn: range.value === 'custom' ? host.querySelector('[data-rep-from]').value : null,
                endsOn: range.value === 'custom' ? host.querySelector('[data-rep-to]').value : null,
                recurring: recurring.checked,
                frequency: recurring.checked ? host.querySelector('[data-rep-frequency]').value : null,
              };
              if (type.value === 'cip') {
                body.filters = {
                  preset: val('data-rep-preset'),
                  status: val('data-rep-status'),
                  providerId: val('data-rep-provider'),
                  investmentType: val('data-rep-investment'),
                  applicant: val('data-rep-applicant'),
                  officerId: val('data-rep-officer'),
                  submittedFrom: val('data-rep-submitted-from'),
                  submittedTo: val('data-rep-submitted-to'),
                  decidedFrom: val('data-rep-decided-from'),
                  decidedTo: val('data-rep-decided-to'),
                };
              }
              secApi('POST', '/admin/reports', body).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (j) {
                  if (!res.ok) {
                    save.disabled = false;
                    ui().toastError((j && j.message) || 'Could not create that report');
                    return;
                  }
                  self.tab = recurring.checked ? 'recurring' : 'recent';
                  ui().closeModal();
                  ui().toast('Report created');
                  // Straight into the numbers: seeing them is the point. The
                  // list refreshes behind it, ready for the back link.
                  self.open = j.report.id;
                  paintReport(j.report);
                  load(false);
                });
              }).catch(function () {
                save.disabled = false;
                ui().toastError('Could not create that report');
              });
            });
          },
        });
      }

      function removeReport(uid, button) {
        button.disabled = true;
        secApi('DELETE', '/admin/reports/' + encodeURIComponent(uid)).then(function (res) {
          if (!res.ok) { button.disabled = false; ui().toastError('Could not delete that report'); return; }
          ui().toast('Report deleted');
          load();
        }).catch(function () { button.disabled = false; ui().toastError('Could not delete that report'); });
      }

      load();
    },
  };

  PAGES['notification-history'] = {
    filterDate: '',
    filterEmail: '',
    filterStatus: '',
    page: 1,
    render: function () {
      return '<div data-note-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var self = PAGES['notification-history'];
      var root = el.querySelector('[data-note-root]');
      if (!root) return;
      var esc = ui().esc;

      function query() {
        var parts = [];
        if (self.filterDate) parts.push('date=' + encodeURIComponent(self.filterDate));
        if (self.filterEmail) parts.push('recipient=' + encodeURIComponent(self.filterEmail));
        if (self.filterStatus) parts.push('status=' + encodeURIComponent(self.filterStatus));
        if (self.page > 1) parts.push('page=' + self.page);
        return parts.length ? '?' + parts.join('&') : '';
      }

      function load() {
        secApi('GET', '/admin/notification-history' + query()).then(function (r) {
          if (r.status === 403) {
            root.innerHTML = '<p class="tma-portal-note">Only administrators can open the notification history.</p>';
            return null;
          }
          /* An error answers with JSON too, and painting it would report an
             empty history rather than a broken one. */
          if (!r.ok) {
            root.innerHTML = '<p class="tma-portal-note">Couldn\'t load the notification history. Refresh to try again.</p>';
            return null;
          }
          return r.json();
        }).then(function (d) { if (d) paint(d); })
          .catch(function () {
            root.innerHTML = '<p class="tma-portal-note">Couldn\'t load the notification history. Refresh to try again.</p>';
          });
      }

      function paint(d) {
        var summary = d.summary || {};
        var recipients = [{ value: '', label: 'Everyone' }].concat((d.recipients || []).map(function (e) {
          return { value: e, label: e };
        }));

        var rows = (d.notifications || []).map(function (n) {
          return '<tr>' +
            '<td class="tma-portal-table__muted">' + esc(n.time) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(n.recipient) + '</td>' +
            '<td>' + esc(n.subject) +
            (n.template ? '<br><span class="tma-portal-note">' + esc(n.template) + '</span>' : '') +
            '</td>' +
            '<td>' + statusChip(n.status) +
            (n.failed && n.error ? '<br><span class="tma-portal-note">' + esc(n.error) + '</span>' : '') +
            '</td></tr>';
        }).join('');

        root.innerHTML =
          '<p class="tma-portal-subtitle">Every email the portal has sent, and what became of it. ' +
          '"Queued" means the message is still waiting on a worker and has not left yet.</p>' +
          (summary.failed
            ? ui().banner('warning', esc(String(summary.failed)) + ' message(s) failed to send.')
            : '') +
          '<div class="tma-portal-section__card"><div class="tma-portal-toolbar">' +
          '<div class="tma-portal-toolbar__group">' +
          ui().field('Date:', ui().input({ type: 'date', attrs: 'data-note-date', value: self.filterDate })) +
          ui().field('Recipient:', ui().select(recipients, self.filterEmail, 'data-note-email', 'Recipient filter')) +
          ui().field('Status:', ui().select([
            { value: '', label: 'Any' },
            { value: 'queued', label: 'Queued' },
            { value: 'sent', label: 'Sent' },
            { value: 'failed', label: 'Failed' },
          ], self.filterStatus, 'data-note-status', 'Status filter')) +
          '</div>' +
          '<div class="tma-portal-toolbar__group">' +
          ui().btn({ label: 'Apply', attrs: 'data-note-apply' }) +
          ui().btn({ label: 'Clear', variant: 'ghost', attrs: 'data-note-clear' }) +
          '</div></div></div>' +
          (rows
            ? ui().table(['Sent', 'Recipient', 'Subject', 'Status'], rows) +
              '<div class="tma-portal-toolbar">' +
              '<span class="tma-portal-note">' + esc(String(d.total)) + ' message(s) · ' +
              esc(String(summary.queued || 0)) + ' still queued</span>' +
              (d.pages > 1
                ? '<div class="tma-portal-toolbar__group">' +
                  ui().btn({ label: 'Previous', variant: 'ghost', small: true, attrs: 'data-note-prev', disabled: d.page <= 1 }) +
                  '<span class="tma-portal-note">Page ' + esc(String(d.page)) + ' of ' + esc(String(d.pages)) + '</span>' +
                  ui().btn({ label: 'Next', variant: 'ghost', small: true, attrs: 'data-note-next', disabled: d.page >= d.pages }) +
                  '</div>'
                : '') +
              '</div>'
            : ui().emptyState({
                illustration: 'Illustration04',
                title: 'No notifications found.',
                subtitle: 'Nothing matches these filters.',
              }));

        root.querySelector('[data-note-apply]').addEventListener('click', function () {
          self.filterDate = root.querySelector('[data-note-date]').value;
          self.filterEmail = root.querySelector('[data-note-email]').value;
          self.filterStatus = root.querySelector('[data-note-status]').value;
          self.page = 1;
          load();
        });

        root.querySelector('[data-note-clear]').addEventListener('click', function () {
          self.filterDate = self.filterEmail = self.filterStatus = '';
          self.page = 1;
          load();
        });

        var prev = root.querySelector('[data-note-prev]');
        if (prev) prev.addEventListener('click', function () { self.page = Math.max(1, d.page - 1); load(); });
        var next = root.querySelector('[data-note-next]');
        if (next) next.addEventListener('click', function () { self.page = d.page + 1; load(); });
      }

      load();
    },
  };

  PAGES['branding'] = {
    render: function () {
      return '<div data-brand-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-brand-root]');
      if (!root) return;
      var esc = ui().esc;
      var editable = true;

      function load() {
        secApi('GET', '/admin/branding').then(function (r) {
          // An error body would paint as blank fields, and saving those would
          // then wipe the firm's real branding.
          if (!r.ok) throw new Error('branding');
          return r.json();
        })
          .then(function (d) { paint(d.branding || {}); })
          .catch(function () {
            root.innerHTML = '<p class="tma-portal-note">Couldn\'t load branding. Refresh to try again.</p>';
          });
      }

      function paint(b) {
        root.innerHTML =
          '<p class="tma-portal-subtitle">The name, title and colours everyone in the firm sees. Saved once for the whole account.</p>' +
          ui().section('Edit Account Name',
            ui().field('Account Name:', ui().input({ value: b.accountName || '', attrs: 'data-brand-name' }))) +
          ui().section('Edit Account Appearance',
            '<div class="tma-portal-toolbar"><strong>Basic Options</strong>' +
            '<button type="button" class="tma-portal-link" data-brand-defaults>Use Portal Defaults</button></div>' +
            ui().field('Page Title:', ui().input({ value: b.pageTitle || '', attrs: 'data-brand-title' })) +
            ui().field('Logo:', '<input type="file" accept="image/jpeg,image/png,image/webp" data-brand-logo class="tma-portal-input" style="padding:var(--space-4)">') +
            (b.logo
              ? '<div class="tma-portal-toolbar">' +
                '<img src="' + esc(b.logo) + '" alt="Current logo" style="max-height:40px;max-width:200px">' +
                '<div class="tma-portal-toolbar__group">' +
                '<span class="tma-portal-note">' + esc(b.logoName || 'Current logo') + '</span>' +
                ui().btn({ label: 'Remove', variant: 'ghost', small: true, attrs: 'data-brand-logo-remove' }) +
                '</div></div>'
              : '<p class="tma-portal-note">No logo uploaded. JPG, PNG or WebP, up to 2 MB.</p>') +
            '<div class="tma-portal-toolbar__group">' +
            ui().field('Header Background Color:', '<input type="color" data-brand-header value="' + esc(b.headerColor || '#FFFFFF') + '" aria-label="Header background color">') +
            ui().field('Accent Color:', '<input type="color" data-brand-accent value="' + esc(b.accentColor || '#0C0C0C') + '" aria-label="Accent color">') +
            '</div>') +
          (editable ? saveBtn('data-brand-save') : '');

        var save = root.querySelector('[data-brand-save]');
        if (save) save.addEventListener('click', function () {
          save.disabled = true;
          secApi('PUT', '/admin/branding', {
            accountName: root.querySelector('[data-brand-name]').value.trim(),
            pageTitle: root.querySelector('[data-brand-title]').value.trim(),
            headerColor: root.querySelector('[data-brand-header]').value,
            accentColor: root.querySelector('[data-brand-accent]').value,
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (j) {
              save.disabled = false;
              if (res.status === 403) { editable = false; ui().toastError('Only administrators can change branding.'); return; }
              if (!res.ok) {
                var msg = (j && j.message) || 'Could not save branding';
                if (j && j.errors) { var k = Object.keys(j.errors); if (k.length) msg = j.errors[k[0]][0]; }
                ui().toastError(msg);
                return;
              }
              ui().toast('Branding saved');
              applyBranding(j.branding);
              // The logo is uploaded separately: it is a file, not a field.
              uploadLogo(j.branding);
            });
          }).catch(function () { save.disabled = false; ui().toastError('Could not save branding'); });
        });

        var remove = root.querySelector('[data-brand-logo-remove]');
        if (remove) remove.addEventListener('click', function () {
          remove.disabled = true;
          secApi('DELETE', '/admin/branding/logo').then(function (res) { return res.json(); })
            .then(function (j) { ui().toast('Logo removed'); applyBranding(j.branding); paint(j.branding); })
            .catch(function () { remove.disabled = false; ui().toastError('Could not remove the logo'); });
        });

        var defaults = root.querySelector('[data-brand-defaults]');
        if (defaults) defaults.addEventListener('click', function () {
          secApi('POST', '/admin/branding/reset').then(function (res) {
            if (!res.ok) { ui().toastError('Could not restore the defaults'); return null; }
            return res.json();
          }).then(function (j) {
            if (!j) return;
            ui().toast('Defaults restored');
            applyBranding(j.branding);
            paint(j.branding);
          }).catch(function () { ui().toastError('Could not restore the defaults'); });
        });
      }

      function uploadLogo(current) {
        var picker = root.querySelector('[data-brand-logo]');
        if (!picker || !picker.files || !picker.files[0]) { paint(current); return; }

        var fd = new FormData();
        fd.append('logo', picker.files[0]);

        var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        fetch('/admin/branding/logo', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json',
            'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: fd,
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            if (!res.ok) {
              var msg = (j && j.message) || 'Could not upload that logo';
              if (j && j.errors) { var k = Object.keys(j.errors); if (k.length) msg = j.errors[k[0]][0]; }
              ui().toastError(msg);
              paint(current);
              return;
            }
            ui().toast('Logo updated');
            applyBranding(j.branding);
            paint(j.branding);
          });
        }).catch(function () { ui().toastError('Could not upload that logo'); paint(current); });
      }

      load();
    },
  };

  /* Branding is chrome every shell paints, so a save has to reach the page the
     administrator is standing on, not just the database. */
  function applyBranding(b) {
    if (!b) return;
    if (window.TMABranding && window.TMABranding.apply) window.TMABranding.apply(b);
  }

  /* ── Client hub access (real: /admin/client-hub) ──────────────────
     The capability toggles here are the same names the server enforces and
     the sidebar prunes on, so switching one off removes the Clients page for
     every employee — not just its buttons. Administrators always hold all of
     them, which is why nobody can lock themselves out of this screen.

     Rows reuse the Privacy panel's cookie-row component (label + description
     + switch, with a disabled state already styled); a plain toggle row has
     nowhere to say what the switch actually does. */
  var HUB_CAP_DEPENDENTS = ['clients.viewAll', 'clients.manage', 'clients.invite', 'clients.assign'];

  function capRow(cap, canEdit, attr) {
    return '<div class="tma-dash__settings-cookie-row">' +
      '<span class="tma-dash__settings-cookie-copy">' +
      '<span class="tma-dash__settings-cookie-label">' + ui().esc(cap.label) + '</span>' +
      '<span class="tma-dash__settings-cookie-desc">' + ui().esc(cap.help) + '</span>' +
      '</span>' +
      ui().toggle(cap.granted, attr + '="' + ui().esc(cap.id) + '"' + (canEdit ? '' : ' disabled'), cap.label) +
      '</div>';
  }

  function hubCapRow(cap, canEdit) {
    return capRow(cap, canEdit, 'data-hub-cap');
  }

  PAGES['clienthub-access'] = {
    render: function () {
      return '<div data-hub-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-hub-root]');
      if (!root) return;
      var editable = false;

      function paint(d) {
        var canEdit = editable = !!d.canEdit;
        var counts = d.counts || {};

        root.innerHTML =
          '<p class="tma-portal-subtitle">Who may work in CIP Applications, and how clients get their account — ' +
          'administrators always hold every permission below.</p>' +
          (canEdit ? '' : '<p class="tma-portal-note">Only administrators can change this access.</p>') +
          ui().section('What employees can do',
            d.capabilities.map(function (cap) { return hubCapRow(cap, canEdit); }).join('') +
            '<p class="tma-portal-note" data-hub-reach-note hidden>Employees cannot open CIP Applications, so the permissions above it do nothing.</p>' +
            '<p class="tma-portal-note">Applies to ' + counts.employees + ' employee account' + (counts.employees === 1 ? '' : 's') +
            ', the next time each one loads the portal.</p>') +
          ui().section('Client invitations',
            '<div class="tma-dash__settings-cookie-row">' +
            '<span class="tma-dash__settings-cookie-copy">' +
            '<span class="tma-dash__settings-cookie-label">Let clients create their own account from an invitation link</span>' +
            '<span class="tma-dash__settings-cookie-desc">Off, an invited client is told the account will be created for them, and only an existing login can accept.</span>' +
            '</span>' +
            ui().toggle(d.allowSelfRegistration, 'data-hub-self' + (canEdit ? '' : ' disabled'), 'Allow self registration') +
            '</div>' +
            ui().field('Invitation links expire after',
              ui().select(d.expiryChoices.map(function (n) {
                return { value: String(n), label: n + (n === 1 ? ' day' : ' days') };
              }), String(d.inviteExpiryDays), 'data-hub-expiry' + (canEdit ? '' : ' disabled'), 'Invitation expiry')) +
            '<p class="tma-portal-note">Client and company invitations only' +
            (counts.pendingInvitations
              ? '; the ' + counts.pendingInvitations + ' already outstanding keep their original date'
              : '') + '.</p>') +
          (canEdit ? saveBtn('data-hub-save') : '');

        syncDependents();
        wireRow();
      }

      /* The other four permissions are meaningless without the hub itself, so
         they follow it rather than silently staying "on" against a page the
         employee can no longer reach. */
      function syncDependents() {
        var reach = root.querySelector('[data-hub-cap="clients.view"]');
        var off = reach && !reach.checked;
        HUB_CAP_DEPENDENTS.forEach(function (id) {
          var cb = root.querySelector('[data-hub-cap="' + id + '"]');
          // A reader who may not edit stays disabled whatever `reach` says.
          if (cb) cb.disabled = !editable || !!off;
        });
        var note = root.querySelector('[data-hub-reach-note]');
        if (note) note.hidden = !off;
      }

      function wireRow() {
        var reach = root.querySelector('[data-hub-cap="clients.view"]');
        if (reach) reach.addEventListener('change', syncDependents);

        var save = root.querySelector('[data-hub-save]');
        if (!save) return;
        save.addEventListener('click', function () {
          var employee = {};
          root.querySelectorAll('[data-hub-cap]').forEach(function (cb) {
            employee[cb.getAttribute('data-hub-cap')] = cb.checked;
          });
          var body = {
            employee: employee,
            allowSelfRegistration: root.querySelector('[data-hub-self]').checked,
            inviteExpiryDays: parseInt(root.querySelector('[data-hub-expiry]').value, 10),
          };
          secApi('PUT', '/admin/client-hub', body).then(function (res) {
            return res.json().then(function (j) { return { ok: res.ok, body: j }; });
          }).then(function (r) {
            if (!r.ok) { ui().toast((r.body && r.body.message) || 'Could not save'); return; }
            ui().toast('Access settings saved');
            paint(r.body);
          }).catch(function () { ui().toast('Could not save'); });
        });
      }

      secApi('GET', '/admin/client-hub')
        .then(function (r) { return r.json(); })
        .then(paint)
        .catch(function () {
          root.innerHTML = '<p class="tma-portal-note">Couldn’t load access settings. Refresh to try again.</p>';
        });
    },
  };

  /* ── Service teams (real: /admin/service-teams) ────────────────────
     Teams are the firm's staff groups — this screen does not create a second
     kind. Putting a team on a client fans out into ordinary per-person
     assignments, which is what FileAccess reads, so folder access arrives by
     the route it always did. */
  var TEAMS = { loaded: false, loading: false, error: '', data: null };

  function loadTeams() {
    if (TEAMS.loading) return;
    TEAMS.loading = true;
    filelibJson('GET', '/admin/service-teams')
      .then(function (d) { TEAMS.data = d; TEAMS.error = ''; })
      .catch(function (e) { TEAMS.error = e.message; })
      .then(function () { TEAMS.loading = false; TEAMS.loaded = true; render(); });
  }

  function teamAssignModal(team, mode) {
    var d = TEAMS.data;
    var removing = mode === 'remove';

    if (!d.clients.length) {
      ui().toast('There are no clients to assign a team to yet');
      return;
    }
    if (!removing && !team.memberCount) {
      ui().toast('“' + team.name + '” has no staff members yet — add some under People → Groups');
      return;
    }

    var roleOptions = Object.keys(d.roles).map(function (k) { return { value: k, label: d.roles[k] }; });

    ui().openModal({
      title: (removing ? 'Take “' : 'Assign “') + team.name + (removing ? '” off a client' : '” to a client'),
      body:
        '<p>' + (removing
          ? 'Ends the client assignment for all ' + team.memberCount + ' staff member' + (team.memberCount === 1 ? '' : 's') + ' in this team.'
          : 'Assigns all ' + team.memberCount + ' staff member' + (team.memberCount === 1 ? '' : 's') + ' in this team to the client.') + '</p>' +
        ui().field('Client', ui().select(d.clients.map(function (c) {
          return { value: c.uid, label: c.name };
        }), d.clients[0].uid, 'data-team-client', 'Client')) +
        (removing ? '' :
          ui().field('What they do for this client', ui().select(roleOptions, 'general', 'data-team-role', 'Role')) +
          ui().field('What they can reach', ui().select(d.levels, 'view_files', 'data-team-level', 'Permission level'))) +
        '<p class="tma-portal-note">' + (removing
          ? 'Anyone in this team who is on the client for another reason loses that too — a client records one assignment per person, not one per team.'
          : 'Nobody becomes the client’s primary contact this way. Adding someone to the team later does not put them on the client — re-apply the team to include them.') + '</p>' +
        '<div class="tma-portal-form-actions">' +
        ui().btn({
          label: removing ? 'Remove from client' : 'Assign team',
          variant: removing ? 'danger' : undefined,
          attrs: 'data-team-go',
        }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-team-go]').addEventListener('click', function () {
          var body = { client: host.querySelector('[data-team-client]').value };
          if (!removing) {
            body.role = host.querySelector('[data-team-role]').value;
            body.level = host.querySelector('[data-team-level]').value;
          }

          filelibJson('POST', '/admin/service-teams/' + encodeURIComponent(team.id) + (removing ? '/unassign' : '/assign'), body)
            .then(function (res) {
              TEAMS.data = res;
              ui().closeModal();
              var names = removing ? res.removed : res.assigned;
              ui().toast(names.length
                ? (removing ? 'Removed ' : 'Assigned ') + names.length + ' staff ' +
                  (removing ? 'from ' : 'to ') + res.client.name
                : (removing ? 'Nobody in this team was on ' : 'Everyone in this team was already on ') + res.client.name);
              render();
            })
            .catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  PAGES['service-teams'] = {
    render: function () {
      if (TEAMS.error) return '<p class="tma-portal-note">Couldn’t load service teams: ' + ui().esc(TEAMS.error) + '</p>';
      if (!TEAMS.loaded) return ui().loading();

      var d = TEAMS.data;
      var canEdit = !!d.canEdit;

      return '<p class="tma-portal-subtitle">Put a whole staff team onto a client in one move. ' +
        'Teams are your staff groups — create and edit them under People → Groups.</p>' +
        (canEdit ? '' : '<p class="tma-portal-note">Only administrators can assign service teams.</p>') +
        (d.teams.length
          ? ui().table(['Team', 'Staff', 'Clients', ''], d.teams.map(function (t) {
              return '<tr><td><strong>' + ui().esc(t.name) + '</strong>' +
                (t.description ? '<br><span class="tma-portal-table__muted">' + ui().esc(t.description) + '</span>' : '') + '</td>' +
                '<td class="tma-portal-table__muted">' + t.memberCount + '</td>' +
                '<td class="tma-portal-table__muted">' + t.clientCount + '</td>' +
                '<td>' + (canEdit
                  ? '<div class="tma-portal-row-actions">' +
                    '<button type="button" class="tma-portal-icon-btn" data-team-assign="' + ui().esc(t.id) + '" title="Assign to a client" aria-label="Assign to a client"><img src="images/icons/phosphor/UserPlus.svg" alt=""></button>' +
                    '<button type="button" class="tma-portal-icon-btn" data-team-remove="' + ui().esc(t.id) + '" title="Take off a client" aria-label="Take off a client"><img src="images/icons/phosphor/UserMinus.svg" alt=""></button>' +
                    '</div>'
                  : '') + '</td></tr>';
            }).join(''))
          : ui().emptyState({
              illustration: 'Illustration13',
              title: 'There aren’t any staff groups yet',
              subtitle: 'Create a group under People → Groups, then assign it to a client from here.',
            }));
    },
    wire: function (el) {
      if (!TEAMS.loaded) { loadTeams(); return; }

      function teamFor(btn, attr) {
        var id = btn.getAttribute(attr);
        return TEAMS.data.teams.filter(function (t) { return t.id === id; })[0];
      }

      el.querySelectorAll('[data-team-assign]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = teamFor(b, 'data-team-assign');
          if (t) teamAssignModal(t, 'assign');
        });
      });

      el.querySelectorAll('[data-team-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = teamFor(b, 'data-team-remove');
          if (t) teamAssignModal(t, 'remove');
        });
      });
    },
  };

  /* ── Custom fields (real: /admin/client-fields) ────────────────────
     Defines them here; the values are collected on the client record and
     normalised server-side on every write, so a deleted field stops being
     stored and a dropdown can never hold a value that is not one of its
     options. */
  var CFIELDS = { loaded: false, loading: false, error: '', data: null };

  var CFIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Dropdown' },
  ];

  function cfieldTypeLabel(type) {
    var match = CFIELD_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function loadCustomFields() {
    if (CFIELDS.loading) return;
    CFIELDS.loading = true;
    filelibJson('GET', '/admin/client-fields')
      .then(function (d) { CFIELDS.data = d; CFIELDS.error = ''; })
      .catch(function (e) { CFIELDS.error = e.message; })
      .then(function () { CFIELDS.loading = false; CFIELDS.loaded = true; render(); });
  }

  function customFieldModal(existing) {
    var editing = !!existing;

    ui().openModal({
      title: editing ? 'Edit custom field' : 'Add custom field',
      body:
        ui().field('Field name', ui().input({
          value: editing ? existing.label : '',
          placeholder: 'e.g. Client reference',
          attrs: 'data-cf-label',
        })) +
        ui().field('Type', ui().select(CFIELD_TYPES, editing ? existing.type : 'text', 'data-cf-type', 'Field type')) +
        '<div data-cf-options' + (editing && existing.type === 'select' ? '' : ' hidden') + '>' +
        ui().field('Options (comma separated)', ui().input({
          value: editing ? existing.options.join(', ') : '',
          placeholder: 'North, South, East, West',
          attrs: 'data-cf-option-list',
        })) +
        '</div>' +
        '<label class="tma-portal-checkbox"><input type="checkbox" data-cf-required' +
        (editing && existing.required ? ' checked' : '') + '><span>Required</span></label>' +
        '<p class="tma-portal-note">Required fields are shown as missing on client records that don’t answer them. ' +
        'Existing clients are never blocked from being saved.</p>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: editing ? 'Save' : 'Add field', attrs: 'data-cf-save' }) + '</div>',
      onMount: function (host) {
        var typeEl = host.querySelector('[data-cf-type]');
        var optionsWrap = host.querySelector('[data-cf-options]');

        typeEl.addEventListener('change', function () {
          optionsWrap.hidden = typeEl.value !== 'select';
        });

        host.querySelector('[data-cf-save]').addEventListener('click', function () {
          var labelEl = host.querySelector('[data-cf-label]');
          var label = labelEl.value.trim();
          if (!label) { labelEl.focus(); return; }

          var type = typeEl.value;
          var options = host.querySelector('[data-cf-option-list]').value
            .split(',').map(function (o) { return o.trim(); }).filter(Boolean);

          if (type === 'select' && !options.length) {
            host.querySelector('[data-cf-option-list]').focus();
            ui().toastError('A dropdown needs at least one option.');
            return;
          }

          var body = {
            label: label,
            type: type,
            options: options,
            required: host.querySelector('[data-cf-required]').checked,
          };

          var call = editing
            ? filelibJson('PUT', '/admin/client-fields/' + encodeURIComponent(existing.id), body)
            : filelibJson('POST', '/admin/client-fields', body);

          call.then(function (d) {
            CFIELDS.data = d;
            ui().closeModal();
            ui().toast(editing ? 'Field saved' : 'Custom field added');
            render();
          }).catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  PAGES['custom-fields'] = {
    render: function () {
      if (CFIELDS.error) return '<p class="tma-portal-note">Couldn’t load custom fields: ' + ui().esc(CFIELDS.error) + '</p>';
      if (!CFIELDS.loaded) return ui().loading();

      var d = CFIELDS.data;
      var canEdit = !!d.canEdit;
      var usage = d.usage || {};

      return '<p class="tma-portal-subtitle">Extra details collected on every client record.</p>' +
        (canEdit ? '' : '<p class="tma-portal-note">Only administrators can change custom fields.</p>') +
        (d.fields.length
          ? ui().table(['Field', 'Type', 'Answered by', ''], d.fields.map(function (f) {
              var answered = usage[f.id] || 0;
              return '<tr><td><strong>' + ui().esc(f.label) + '</strong>' +
                (f.required ? ' <span class="tma-portal-tag">Required</span>' : '') +
                (f.type === 'select' && f.options.length
                  ? '<br><span class="tma-portal-table__muted">' + ui().esc(f.options.join(', ')) + '</span>'
                  : '') + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(cfieldTypeLabel(f.type)) + '</td>' +
                '<td class="tma-portal-table__muted">' + answered + ' of ' + d.clientCount + '</td>' +
                '<td>' + (canEdit
                  ? '<div class="tma-portal-row-actions">' +
                    '<button type="button" class="tma-portal-icon-btn" data-cf-edit="' + ui().esc(f.id) + '" title="Edit field" aria-label="Edit field"><img src="images/icons/phosphor/PencilSimple.svg" alt=""></button>' +
                    '<button type="button" class="tma-portal-icon-btn" data-cf-delete="' + ui().esc(f.id) + '" title="Delete field" aria-label="Delete field"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                    '</div>'
                  : '') + '</td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration04', title: 'No custom fields yet', subtitle: 'Add a field to collect details like a client reference or region.' })) +
        (canEdit ? '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Add custom field', attrs: 'data-cf-add' }) + '</div>' : '');
    },
    wire: function (el) {
      if (!CFIELDS.loaded) { loadCustomFields(); return; }

      function fieldFor(btn, attr) {
        var id = btn.getAttribute(attr);
        return CFIELDS.data.fields.filter(function (f) { return f.id === id; })[0];
      }

      var add = el.querySelector('[data-cf-add]');
      if (add) add.addEventListener('click', function () { customFieldModal(null); });

      el.querySelectorAll('[data-cf-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = fieldFor(b, 'data-cf-edit');
          if (f) customFieldModal(f);
        });
      });

      el.querySelectorAll('[data-cf-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = fieldFor(b, 'data-cf-delete');
          if (!f) return;
          var answered = (CFIELDS.data.usage || {})[f.id] || 0;
          // Deleting a field and discarding the answers to it are the same
          // click, so the count has to be in the question.
          if (!window.confirm(answered
            ? 'Delete “' + f.label + '”? ' + answered + ' client record' + (answered === 1 ? '' : 's') + ' answered it, and those answers stop being shown.'
            : 'Delete the “' + f.label + '” field?')) return;

          filelibJson('DELETE', '/admin/client-fields/' + encodeURIComponent(f.id))
            .then(function (d) { CFIELDS.data = d; ui().toast('Field deleted'); render(); })
            .catch(function (e) { ui().toastError(e.message); });
        });
      });
    },
  };

  /* ── CIP document requirements (§11) ───────────────────────────────
   *
   * The checklists every applicant is measured against, one list per
   * applicant type, editable by administrators. The server already enforces
   * the rules that matter — a retired requirement is a soft delete because
   * filed documents key on it, re-adding one restores it, and renaming
   * changes the label never the key — so this screen is honest chrome over
   * /portal/cip/requirements.
   */
  var CIPDOCS = { loaded: false, loading: false, error: '', types: null };

  function loadCipDocs() {
    if (CIPDOCS.loading) return;
    CIPDOCS.loading = true;
    filelibJson('GET', '/portal/cip/requirements')
      .then(function (d) { CIPDOCS.types = d.types || []; CIPDOCS.error = ''; })
      .catch(function (e) { CIPDOCS.error = e.message; })
      .then(function () { CIPDOCS.loaded = true; CIPDOCS.loading = false; render(); });
  }

  function cipDocFolders() {
    var names = {};
    CIPDOCS.types.forEach(function (t) {
      t.requirements.forEach(function (r) {
        if (r.folder) names[r.folder] = true;
      });
    });
    return Object.keys(names).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function cipDocFolderModal(f) {
    var existing = cipDocFolders();
    var current = f.r.folder || '';
    var options = [{ value: '', label: 'Person’s own folder' }].concat(
      existing.map(function (name) { return { value: name, label: name }; }),
      [{ value: '__new__', label: 'Create a new folder…' }]
    );
    var selected = current && existing.indexOf(current) >= 0 ? current : (current ? '__new__' : '');

    ui().openModal({
      title: 'Filing folder',
      body:
        '<p class="tma-portal-note">Uploads stay inside that person’s own folder — Main Applicant, Sponsor, or Dependent. Pick a subfolder inside it, or create one. The main applicant’s files cannot be filed anywhere else.</p>' +
        ui().field('Folder', ui().select(options, selected, 'data-cipdoc-folder-pick', 'Folder')) +
        '<div data-cipdoc-folder-new' + (selected === '__new__' ? '' : ' hidden') + '>' +
        ui().field('New folder name', ui().input({
          placeholder: 'e.g. Passport',
          value: selected === '__new__' ? current : '',
          attrs: 'data-cipdoc-folder-name maxlength="64"',
        })) +
        '</div>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-cipdoc-folder-save' }) + '</div>',
      onMount: function (host) {
        var pick = host.querySelector('[data-cipdoc-folder-pick]');
        var extra = host.querySelector('[data-cipdoc-folder-new]');
        var nameInput = host.querySelector('[data-cipdoc-folder-name]');
        function sync() {
          extra.hidden = pick.value !== '__new__';
        }
        pick.addEventListener('change', sync);
        host.querySelector('[data-cipdoc-folder-save]').addEventListener('click', function () {
          var folder = pick.value === '__new__'
            ? (nameInput.value || '').trim()
            : pick.value;
          if (pick.value === '__new__' && !folder) {
            ui().toastError('Name the folder first.');
            return;
          }
          if (folder === (f.r.folder || '')) { ui().closeModal(); return; }
          filelibJson('PATCH', '/portal/cip/requirements/' + encodeURIComponent(f.r.id), { folder: folder })
            .then(function () {
              ui().closeModal();
              ui().toast(folder ? 'Now filing into “' + folder + '”' : 'Back to the person’s own folder');
              CIPDOCS.loaded = false;
              if (window.TMAStore) window.TMAStore.invalidate('cip:application:');
              loadCipDocs();
            })
            .catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  function cipDocRow(r, canEdit) {
    // A retired row keeps its place in the list but drops to the muted ink —
    // the same grey the table already uses — so the eye reads it as history.
    var name = r.retired
      ? '<span class="tma-portal-table__muted"><strong>' + ui().esc(r.label) + '</strong></span>'
      : '<strong>' + ui().esc(r.label) + '</strong>';

    // Required is a tick in its own column. Ticked means required; unticked
    // means optional. The old inverted reading — a filled circle for optional
    // — is the thing this column exists to stop.
    var tick = r.retired ? '' :
      '<input type="checkbox" class="tma-dash__check" data-cipdoc-toggle="' + ui().esc(r.id) + '"' +
      (r.required ? ' checked' : '') + (canEdit ? '' : ' disabled') +
      ' title="' + (r.required ? 'Required — untick to make it optional' : 'Optional — tick to make it required') + '"' +
      ' aria-label="Required — ' + ui().esc(r.label) + '">';

    var meta = [];
    if (r.help) meta.push(ui().esc(r.help));
    if (r.folder) meta.push('Filed in “' + ui().esc(r.folder) + '”');

    return '<tr>' +
      '<td class="tma-portal-table__check">' + tick + '</td>' +
      '<td>' + name +
      (r.retired ? ' <span class="tma-portal-tag">Retired</span>' : '') +
      (meta.length ? '<br><span class="tma-portal-table__muted">' + meta.join(' · ') + '</span>' : '') +
      '</td>' +
      '<td>' + (canEdit
        ? '<div class="tma-portal-row-actions">' +
          (r.retired
            ? '<button type="button" class="tma-portal-icon-btn" data-cipdoc-restore="' + ui().esc(r.id) + '" title="Bring it back" aria-label="Bring it back"><img src="images/icons/phosphor/ArrowCounterClockwise.svg" alt=""></button>'
            : '<button type="button" class="tma-portal-icon-btn" data-cipdoc-up="' + ui().esc(r.id) + '" title="Move up" aria-label="Move up"><img src="images/icons/phosphor/CaretUp.svg" alt=""></button>' +
              '<button type="button" class="tma-portal-icon-btn" data-cipdoc-down="' + ui().esc(r.id) + '" title="Move down" aria-label="Move down"><img src="images/icons/phosphor/CaretDown.svg" alt=""></button>' +
              '<button type="button" class="tma-portal-icon-btn" data-cipdoc-folder="' + ui().esc(r.id) + '" title="Choose a folder" aria-label="Choose a folder"><img src="images/icons/phosphor/FolderSimple.svg" alt=""></button>' +
              '<button type="button" class="tma-portal-icon-btn" data-cipdoc-edit="' + ui().esc(r.id) + '" title="Rename" aria-label="Rename"><img src="images/icons/phosphor/PencilSimple.svg" alt=""></button>' +
              '<button type="button" class="tma-portal-icon-btn" data-cipdoc-retire="' + ui().esc(r.id) + '" title="Retire" aria-label="Retire"><img src="images/icons/phosphor/Trash.svg" alt=""></button>') +
          '</div>'
        : '') + '</td></tr>';
  }

  PAGES['cip-documents'] = {
    render: function () {
      if (CIPDOCS.error) return '<p class="tma-portal-note">Couldn’t load the requirements: ' + ui().esc(CIPDOCS.error) + '</p>';
      if (!CIPDOCS.loaded) return ui().loading();

      var canEdit = true;

      return '<p class="tma-portal-subtitle">What each person on an application must upload. Tick a document to make it required; leave it unticked for optional. Every new application is measured against these lists.</p>' +
        CIPDOCS.types.map(function (t) {
          var live = t.requirements.filter(function (r) { return !r.retired; });
          var retired = t.requirements.filter(function (r) { return r.retired; });

          return '<h3 class="tma-portal-section__title">' + ui().esc(t.label) + '</h3>' +
            (t.requirements.length
              ? ui().table(['Required', 'Document', ''], live.concat(retired).map(function (r) { return cipDocRow(r, canEdit); }).join(''), { cls: 'tma-portal-table--cipdocs' })
              : '<p class="tma-portal-note">Nothing required of this person yet.</p>') +
            '<div class="tma-dash__clients-assign-form">' +
            '<input class="tma-dash__clients-field-input" type="text" placeholder="Add a document…" data-cipdoc-label="' + ui().esc(t.value) + '" aria-label="Document name for ' + ui().esc(t.label) + '">' +
            '<button type="button" class="tma-dash__clients-assign-btn" data-cipdoc-add="' + ui().esc(t.value) + '">Add</button>' +
            '</div>';
        }).join('');
    },
    wire: function (el) {
      if (!CIPDOCS.loaded) { loadCipDocs(); return; }

      function req(id) {
        var found = null;
        CIPDOCS.types.forEach(function (t) {
          t.requirements.forEach(function (r) { if (r.id === id) found = { type: t, r: r }; });
        });
        return found;
      }

      function saved() {
        CIPDOCS.loaded = false;
        if (window.TMAStore) window.TMAStore.invalidate('cip:application:');
        loadCipDocs();
      }
      function failed(e) { ui().toastError(e.message); }

      el.querySelectorAll('[data-cipdoc-add]').forEach(function (b) {
        b.addEventListener('click', function () {
          var type = b.getAttribute('data-cipdoc-add');
          var input = el.querySelector('[data-cipdoc-label="' + type + '"]');
          var label = input && input.value ? input.value.trim() : '';
          if (!label) { ui().toastError('Name the document first.'); return; }
          filelibJson('POST', '/portal/cip/requirements', { applicantType: type, label: label, required: true })
            .then(function () { ui().toast('Added'); saved(); }).catch(failed);
        });
      });

      // Enter in the add box is the same as pressing Add.
      el.querySelectorAll('[data-cipdoc-label]').forEach(function (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var btn = el.querySelector('[data-cipdoc-add="' + input.getAttribute('data-cipdoc-label') + '"]');
          if (btn) btn.click();
        });
      });

      el.querySelectorAll('[data-cipdoc-toggle]').forEach(function (box) {
        box.addEventListener('change', function () {
          var f = req(box.getAttribute('data-cipdoc-toggle'));
          if (!f) return;
          var required = !!box.checked;
          filelibJson('PATCH', '/portal/cip/requirements/' + encodeURIComponent(f.r.id), { required: required })
            .then(function () { ui().toast(required ? 'Now required' : 'Now optional'); saved(); })
            // The box flipped the moment it was clicked; a redraw from the
            // unchanged state snaps it back so it never shows a saved lie.
            .catch(function (e) { failed(e); render(); });
        });
      });

      el.querySelectorAll('[data-cipdoc-folder]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = req(b.getAttribute('data-cipdoc-folder'));
          if (f) cipDocFolderModal(f);
        });
      });

      el.querySelectorAll('[data-cipdoc-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = req(b.getAttribute('data-cipdoc-edit'));
          if (!f) return;
          var label = window.prompt('Rename this document', f.r.label);
          if (!label || !label.trim() || label.trim() === f.r.label) return;
          filelibJson('PATCH', '/portal/cip/requirements/' + encodeURIComponent(f.r.id), { label: label.trim() })
            .then(function () { ui().toast('Renamed'); saved(); }).catch(failed);
        });
      });

      el.querySelectorAll('[data-cipdoc-retire]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = req(b.getAttribute('data-cipdoc-retire'));
          if (!f) return;
          // Retiring is reversible and documents already filed stay filed —
          // the confirm says so, so nobody hesitates for the wrong reason.
          if (!window.confirm('Retire “' + f.r.label + '” for ' + f.type.label + '? New applications stop asking for it; anything already uploaded stays on its file. You can bring it back any time.')) return;
          filelibJson('DELETE', '/portal/cip/requirements/' + encodeURIComponent(f.r.id))
            .then(function () { ui().toast('Retired'); saved(); }).catch(failed);
        });
      });

      el.querySelectorAll('[data-cipdoc-restore]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = req(b.getAttribute('data-cipdoc-restore'));
          if (!f) return;
          filelibJson('POST', '/portal/cip/requirements/' + encodeURIComponent(f.r.id) + '/restore')
            .then(function () { ui().toast('Restored'); saved(); }).catch(failed);
        });
      });

      function move(id, delta) {
        var f = req(id);
        if (!f) return;
        var live = f.type.requirements.filter(function (r) { return !r.retired; });
        var at = live.indexOf(f.r);
        var to = at + delta;
        if (at === -1 || to < 0 || to >= live.length) return;
        live.splice(at, 1);
        live.splice(to, 0, f.r);
        var order = live.concat(f.type.requirements.filter(function (r) { return r.retired; }))
          .map(function (r) { return r.id; });
        filelibJson('POST', '/portal/cip/requirements/reorder', { applicantType: f.type.value, order: order })
          .then(function (d) { CIPDOCS.types = d.types || CIPDOCS.types; render(); }).catch(failed);
      }

      el.querySelectorAll('[data-cipdoc-up]').forEach(function (b) {
        b.addEventListener('click', function () { move(b.getAttribute('data-cipdoc-up'), -1); });
      });
      el.querySelectorAll('[data-cipdoc-down]').forEach(function (b) {
        b.addEventListener('click', function () { move(b.getAttribute('data-cipdoc-down'), 1); });
      });
    },
  };

  /* ── CIP Granted / Denied letters (§23) ─────────────────────────────
   *
   * Ten templates, one pair per investment type. The filing subject is
   * still §22; this screen is the body the administrator keeps. Tokens
   * are filled from the application when the letter is sent.
   */
  var CIPLETTERS = { loaded: false, loading: false, error: '', data: null };

  function loadCipLetters() {
    if (CIPLETTERS.loading) return;
    CIPLETTERS.loading = true;
    filelibJson('GET', '/portal/cip/letters')
      .then(function (d) { CIPLETTERS.data = d; CIPLETTERS.error = ''; })
      .catch(function (e) { CIPLETTERS.error = e.message; })
      .then(function () { CIPLETTERS.loaded = true; CIPLETTERS.loading = false; render(); });
  }

  function cipLetterFor(id) {
    var found = null;
    (CIPLETTERS.data.types || []).forEach(function (t) {
      t.letters.forEach(function (letter) { if (letter.id === id) found = { type: t, letter: letter }; });
    });
    return found;
  }

  function cipLetterModal(found) {
    var letter = found.letter;
    var tokens = (CIPLETTERS.data.placeholders || []).map(function (p) {
      return '{{' + p.token + '}} — ' + p.meaning;
    }).join('<br>');

    ui().openModal({
      title: found.type.label + ' · ' + letter.decisionLabel,
      body:
        '<p class="tma-portal-note">The email subject stays in the filing format. This is the letter itself. Placeholders are filled from the application when it is sent.</p>' +
        ui().field('Title', ui().input({
          value: letter.title,
          attrs: 'data-cipletter-title maxlength="191"',
          ariaLabel: 'Letter title',
        })) +
        ui().field('Letter', '<textarea class="tma-portal-textarea" data-cipletter-body rows="8" maxlength="8000">' + ui().esc(letter.body) + '</textarea>') +
        '<p class="tma-portal-table__muted">' + tokens + '</p>' +
        '<div class="tma-portal-form-actions">' +
          ui().btn({ label: 'Save', attrs: 'data-cipletter-save' }) +
          (letter.customized ? ui().btn({ label: 'Restore default', attrs: 'data-cipletter-restore', variant: 'ghost' }) : '') +
        '</div>',
      onMount: function (host) {
        host.querySelector('[data-cipletter-save]').addEventListener('click', function () {
          var title = (host.querySelector('[data-cipletter-title]').value || '').trim();
          var body = (host.querySelector('[data-cipletter-body]').value || '').trim();
          if (!title || !body) { ui().toastError('Title and letter are both required.'); return; }
          filelibJson('PATCH', '/portal/cip/letters/' + encodeURIComponent(letter.id), { title: title, body: body })
            .then(function () {
              ui().closeModal();
              ui().toast('Letter saved');
              CIPLETTERS.loaded = false;
              loadCipLetters();
            })
            .catch(function (e) { ui().toastError(e.message); });
        });
        var restore = host.querySelector('[data-cipletter-restore]');
        if (restore) restore.addEventListener('click', function () {
          filelibJson('POST', '/portal/cip/letters/' + encodeURIComponent(letter.id) + '/restore')
            .then(function () {
              ui().closeModal();
              ui().toast('Restored to the default');
              CIPLETTERS.loaded = false;
              loadCipLetters();
            })
            .catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  PAGES['cip-letters'] = {
    render: function () {
      if (CIPLETTERS.error) return '<p class="tma-portal-note">Couldn’t load the letters: ' + ui().esc(CIPLETTERS.error) + '</p>';
      if (!CIPLETTERS.loaded) return ui().loading();

      var canEdit = !!(CIPLETTERS.data && CIPLETTERS.data.canEdit);

      return '<p class="tma-portal-subtitle">Granted and Denied letters, one pair per investment type. The subject line is still the filing format; these are the bodies that go out when a decision is recorded.</p>' +
        (canEdit ? '' : '<p class="tma-portal-note">Only an administrator can change these letters.</p>') +
        (CIPLETTERS.data.types || []).map(function (t) {
          return '<h3 class="tma-portal-section__title">' + ui().esc(t.label) + '</h3>' +
            ui().table(['Decision', 'Title', ''], t.letters.map(function (letter) {
              return '<tr>' +
                '<td>' + ui().esc(letter.decisionLabel) +
                (letter.customized ? ' <span class="tma-portal-tag">Custom</span>' : '') + '</td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(letter.title) + '</td>' +
                '<td>' + (canEdit
                  ? '<div class="tma-portal-row-actions">' +
                    '<button type="button" class="tma-portal-icon-btn" data-cipletter-edit="' + ui().esc(letter.id) + '" title="Edit letter" aria-label="Edit letter"><img src="images/icons/phosphor/PencilSimple.svg" alt=""></button>' +
                    '</div>'
                  : '') + '</td></tr>';
            }).join(''));
        }).join('');
    },
    wire: function (el) {
      if (!CIPLETTERS.loaded) { loadCipLetters(); return; }

      el.querySelectorAll('[data-cipletter-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var found = cipLetterFor(b.getAttribute('data-cipletter-edit'));
          if (found) cipLetterModal(found);
        });
      });
    },
  };

  var AUTH_APPS = {
    microsoft: { name: 'Microsoft Authenticator', logo: 'images/icons/brands/MicrosoftAuthenticator.webp', desc: 'iOS, Android' },
    google: { name: 'Google Authenticator', logo: 'images/icons/brands/GoogleAuthenticator.svg', desc: 'iOS, Android' },
  };

  var SEC_STATUS = {
    login: { label: 'Signed in', badge: 'tma-auth__badge--done' },
    logout: { label: 'Signed out', badge: '' },
    login_failed: { label: 'Failed', badge: 'tma-auth__badge--danger' },
    lockout: { label: 'Blocked', badge: 'tma-auth__badge--danger' },
    social_failed: { label: 'Sign-in refused', badge: 'tma-auth__badge--danger' },
    registered: { label: 'Account created', badge: '' },
    email_verified: { label: 'Email verified', badge: '' },
    password_reset: { label: 'Password reset', badge: '' },
    social_connected: { label: 'Sign-in method connected', badge: 'tma-auth__badge--done' },
    social_disconnected: { label: 'Sign-in method disconnected', badge: '' },
    user_invited: { label: 'Invited to the portal', badge: '' },
    account_approved: { label: 'Account approved', badge: 'tma-auth__badge--done' },
    account_suspended: { label: 'Account suspended', badge: 'tma-auth__badge--danger' },
    account_reactivated: { label: 'Account reactivated', badge: 'tma-auth__badge--done' },
    account_updated: { label: 'Profile updated by admin', badge: '' },
    password_reset_link_sent: { label: 'Password reset link sent', badge: '' },
    password_generated: { label: 'Temporary password generated', badge: '' },
    account_deleted: { label: 'Account deleted', badge: 'tma-auth__badge--danger' },
    two_factor_reset: { label: 'Two-factor reset by admin', badge: '' },
  };

  function secField(label, name, value, placeholder, icon) {
    var input = '<input class="tma-pf__input" data-pf="' + name + '" value="' + ui().esc(value || '') + '"' +
      (placeholder ? ' placeholder="' + ui().esc(placeholder) + '"' : '') + '>';
    if (icon) {
      input = '<span class="tma-pf__input-wrap">' +
        '<img class="tma-pf__input-icon" src="images/icons/' + ui().esc(icon) + '.svg" alt="" width="16" height="16" aria-hidden="true">' +
        input + '</span>';
    }
    return '<label class="tma-pf__field"><span class="tma-pf__label">' + ui().esc(label) + '</span>' + input + '</label>';
  }

  function secSelect(label, name, value, choices) {
    return '<label class="tma-pf__field"><span class="tma-pf__label">' + ui().esc(label) + '</span>' +
      '<select class="tma-pf__input" data-pf="' + name + '">' +
      '<option value=""' + (!value ? ' selected' : '') + '></option>' +
      choices.map(function (c) {
        return '<option value="' + ui().esc(c) + '"' + (value === c ? ' selected' : '') + '>' + ui().esc(c) + '</option>';
      }).join('') +
      '</select></label>';
  }

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

  SETTINGS_PAGES.forEach(function (sp) {
    PAGES[sp.id] = {
      render: function () {
        return '<div data-settings-embed></div>';
      },
      wire: function (el) {
        var host = el.querySelector('[data-settings-embed]');
        if (!host || !window.TMASettings) return;
        window.TMASettings.mount(host, { activeNav: sp.id });
        var card = host.querySelector('.tma-dash__settings-card');
        if (card) card.classList.add('is-settings-detail');
      },
    };
  });

  PAGES['profile'] = {
    hideTitle: true,
    render: function () {
      secEnsureStyles();
      return '<div data-pf-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-pf-root]');
      if (!root) return;
      var esc = ui().esc;

      /* returning from an account-photo re-sign-in lands here with a notice */
      try {
        var pq = new URLSearchParams(window.location.search);
        var pNotice = pq.get('notice');
        var pReason = pq.get('reason') || '';
        if (pNotice) {
          pq.delete('notice'); pq.delete('reason'); pq.delete('page');
          history.replaceState(null, '', window.location.pathname + (pq.toString() ? '?' + pq.toString() : ''));
          if (pNotice === 'photo-added') ui().toast('Photo added from your account');
          else if (pNotice === 'photo-none') ui().toast('No photo found on that account');
          else if (pNotice === 'social-error') ui().toast(pReason || 'That didn\'t complete.');
        }
      } catch (e0) {}

      secApi('GET', '/me/profile').then(function (r) { return r.json(); }).then(function (me) {
        var photoFile = null;            // a File the user picked
        var photoSource = 'keep';        // 'keep' | 'upload' | 'provider'
        var hasProvider = !!me.providerPhoto;

        function initials(seed) {
          var s = String(me.name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
          var colors = ['#136da0', '#03a5e9', '#0f9d8c', '#3f9142', '#c77d18', '#b5497e', '#3b6fb8'];
          var n = 0, k = String(seed || me.email || me.name || '');
          for (var i = 0; i < k.length; i++) n = (n + k.charCodeAt(i)) % 997;
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
            '<rect width="40" height="40" rx="20" fill="' + colors[n % colors.length] + '"/>' +
            '<text x="20" y="21" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" ' +
            'fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + s + '</text></svg>';
          return 'data:image/svg+xml,' + encodeURIComponent(svg);
        }

        function avatarSrc(name) {
          if (name && /^(https?:|\/(storage|media)\/|data:)/.test(name)) return name;
          return initials();
        }

        root.innerHTML =
          '<div class="tma-security">' +

          '<section class="tma-security__card" aria-label="Profile picture">' +
          '<div class="tma-pf__current">' +
          '<img data-pf-preview src="' + esc(avatarSrc(me.avatar)) + '" alt="" width="72" height="72">' +
          '<span class="tma-security__row-copy">' +
          '<span class="tma-security__row-name" data-pf-display>' + esc(me.name) + '</span>' +
          '<span class="tma-security__row-sub">' + esc(me.accountType || 'Member') + '</span></span>' +
          '</div>' +
          (hasProvider
            ? '<div class="tma-pf__sources">' +
                '<label class="tma-pf__source"><input type="radio" name="pf-source" value="keep" checked><span>Keep current photo</span></label>' +
                '<label class="tma-pf__source"><input type="radio" name="pf-source" value="provider"><span>Use my account photo</span></label>' +
                '<label class="tma-pf__source"><input type="radio" name="pf-source" value="upload"><span>Upload a new photo</span></label>' +
              '</div>'
            : '') +
          '<label class="tma-auth__chip-btn tma-pf__upload" data-pf-uploadbtn>' +
          '<img src="images/icons/tma/UploadCloud.svg" alt="" width="14" height="14" aria-hidden="true">' +
          '<span data-pf-uploadlabel>' + (me.avatar ? 'Change photo' : 'Upload a photo') + '</span>' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-pf-file></label>' +
          // No provider photo cached yet, but they have a connected account:
          // offer to pull it (needs a quick re-sign-in to that account).
          (!hasProvider && me.connected && me.connected.length
            ? '<div class="tma-pf__connected">' +
              me.connected.map(function (c) {
                var logo = c.key === 'google' ? 'Google16' : (c.key === 'microsoft' ? 'Microsoft16' : null);
                return '<a class="tma-auth__chip-btn tma-pf__connect" href="/auth/social/' + esc(c.key) + '/redirect?return=profile">' +
                  (logo ? '<img src="images/icons/brands/' + logo + '.svg" alt="" width="14" height="14" aria-hidden="true">' : '') +
                  '<span>Use my ' + esc(c.name) + ' account photo</span></a>';
              }).join('') +
              '</div>'
            : '') +
          '</section>' +

          '<section class="tma-security__card" aria-label="Your details">' +
          '<div class="tma-pf__grid">' +
          secField('First name', 'first_name', me.firstName) +
          secField('Middle name', 'middle_name', me.middleName) +
          secField('Last name', 'last_name', me.lastName) +
          secSelect('Gender', 'gender', me.gender, ['Female', 'Male', 'Non-binary', 'Prefer not to say']) +
          secField('Phone', 'phone', me.phone, '+1 555 123 4567') +
          secField('Role', 'job_title', me.jobTitle) +
          // Client accounts inherit their company from the client record staff
          // set up; showing it as the placeholder says where it came from
          // without saving a copy onto the account.
          secField('Company', 'company', me.company, me.companyInherited || 'Who you work for') +
          secField('LinkedIn', 'linkedin_url', me.linkedin, 'linkedin.com/in/your-name', 'brands/LinkedIn16') +
          '<label class="tma-pf__field tma-pf__field--wide"><span class="tma-pf__label">About you</span>' +
          '<textarea class="tma-pf__input tma-pf__input--area" data-pf="bio" rows="4" maxlength="1000">' + esc(me.bio || '') + '</textarea></label>' +
          '</div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-copy">' +
          '<span class="tma-security__row-name">Email</span>' +
          '<span class="tma-security__row-sub">' + esc(me.email) + ' - an administrator can change this</span></span>' +
          '<button type="button" class="tma-auth__chip-btn" data-pf-security><span>Security</span></button>' +
          '</div>' +
          '<p class="tma-portal-note" data-pf-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save profile', attrs: 'data-pf-save' }) + '</div>' +
          '</section></div>';

        var previewEl = root.querySelector('[data-pf-preview]');
        var uploadBtn = root.querySelector('[data-pf-uploadbtn]');
        var uploadLabel = root.querySelector('[data-pf-uploadlabel]');
        var fileInput = root.querySelector('[data-pf-file]');

        fileInput.addEventListener('change', function () {
          var picked = fileInput.files && fileInput.files[0];
          if (!picked) return;
          var up = root.querySelector('input[name="pf-source"][value="upload"]');
          var useIt = function (blob, dataUrl) {
            photoFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            photoSource = 'upload';
            previewEl.src = dataUrl || URL.createObjectURL(blob);
            uploadLabel.textContent = 'Change photo';
            if (up) up.checked = true;
          };
          if (window.TMAAvatarCropper) {
            window.TMAAvatarCropper.open(picked, useIt);
          } else {
            photoFile = picked;
            photoSource = 'upload';
            previewEl.src = URL.createObjectURL(picked);
            uploadLabel.textContent = 'Change photo';
            if (up) up.checked = true;
          }
          fileInput.value = '';
        });

        root.querySelectorAll('input[name="pf-source"]').forEach(function (radio) {
          radio.addEventListener('change', function () {
            photoSource = radio.value;
            if (photoSource === 'upload') {
              fileInput.click();
            } else if (photoSource === 'provider') {
              photoFile = null;
              fileInput.value = '';
              previewEl.src = avatarSrc(me.providerPhoto);
            } else {
              photoFile = null;
              fileInput.value = '';
              previewEl.src = avatarSrc(me.avatar);
            }
          });
        });

        var secBtn = root.querySelector('[data-pf-security]');
        if (secBtn) secBtn.addEventListener('click', function () { window.TMAPortalAdmin.setPage('account-security'); });

        root.querySelector('[data-pf-save]').addEventListener('click', function () {
          function val(name) {
            var f = root.querySelector('[data-pf="' + name + '"]');
            return f ? f.value.trim() : '';
          }
          var fd = new FormData();
          fd.append('_method', 'PUT');
          fd.append('first_name', val('first_name'));
          fd.append('middle_name', val('middle_name'));
          fd.append('last_name', val('last_name'));
          fd.append('phone', val('phone'));
          fd.append('job_title', val('job_title'));
          fd.append('company', val('company'));
          fd.append('linkedin_url', val('linkedin_url'));
          fd.append('gender', val('gender'));
          fd.append('bio', val('bio'));
          if (photoSource === 'upload' && photoFile) {
            fd.append('source', 'upload');
            fd.append('avatar_photo', photoFile);
          } else if (photoSource === 'provider') {
            fd.append('source', 'provider');
          }

          var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
          fetch('/profile', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Accept': 'application/json',
              'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: fd,
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (j) {
              var err = root.querySelector('[data-pf-error]');
              if (!res.ok) {
                var msg = (j && j.message) || 'Could not save your profile.';
                if (j && j.errors) { var k = Object.keys(j.errors); if (k.length) msg = j.errors[k[0]][0]; }
                err.textContent = msg;
                err.hidden = false;
                return;
              }
              err.hidden = true;
              ui().toast('Profile saved');
              if (window.TMACurrentUser) window.TMACurrentUser.load();
              window.TMAPortalAdmin.setPage('profile');
            });
          });
        });
      }).catch(function () {
        root.innerHTML = '<p class="tma-portal-note">Couldn\'t load your profile. Refresh to try again.</p>';
      });
    },
  };

  PAGES['account-security'] = {
    render: function () {
      secEnsureStyles();
      return '<div data-sec-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-sec-root]');
      if (!root) return;
      var esc = ui().esc;

      /* full-page round-trips (OAuth, MFA gate) land here with a notice */
      var notice = null;
      var noticeReason = '';
      try {
        var qs = new URLSearchParams(window.location.search);
        notice = qs.get('notice');
        noticeReason = qs.get('reason') || '';
        if (qs.get('settings-page') || notice) {
          qs.delete('settings-page');
          qs.delete('notice');
          qs.delete('reason');
          history.replaceState(null, '', window.location.pathname + (qs.toString() ? '?' + qs.toString() : ''));
        }
      } catch (e2) {}
      if (notice === 'social-connected') ui().toast('Sign-in method connected');
      if (notice === 'social-disconnected') ui().toast('Sign-in method disconnected');
      if (notice === 'social-error') ui().toast(noticeReason || 'That connection didn\'t complete.');

      function refresh() { window.TMAPortalAdmin.setPage('account-security'); }

      secApi('GET', '/security-settings/data').then(function (r) { return r.json(); }).then(function (d) {
        var on = d.twoFactor === 'on';

        var sessionRows = d.sessions.map(function (s2) {
          return '<tr><td>' + esc(s2.device) + (s2.current ? ' <span class="tma-auth__badge tma-auth__badge--done">This device</span>' : '') + '</td>' +
            '<td>' + esc(s2.ip || '') + '</td><td>' + esc(s2.lastActive) + '</td>' +
            '<td>' + (s2.current
              ? ''
              : '<button type="button" class="tma-auth__chip-btn" data-sec-session-revoke="' + esc(s2.id) + '"><span>Sign out</span></button>') +
            '</td></tr>';
        }).join('');

        var eventRows = d.events.map(function (ev) {
          var s3 = SEC_STATUS[ev.event] || { label: ev.event, badge: '' };
          var at = ev.atIso ? new Date(ev.atIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : ev.when;
          return '<tr><td>' + esc(at) + '</td><td>' + esc(ev.ip || '') + '</td><td>' + esc(ev.device || '') + '</td>' +
            '<td><span class="tma-auth__badge ' + s3.badge + '">' + esc(s3.label) + '</span>' +
            (ev.detail ? '<div class="tma-security__row-sub">' + esc(ev.detail) + '</div>' : '') + '</td></tr>';
        }).join('');

        root.innerHTML =
          '<div class="tma-security">' +
          (notice === 'mfa-required'
            ? '<div class="tma-auth__alert tma-auth__alert--warning" role="status" style="width: 100%; max-width: none;">' +
              '<img src="images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16" aria-hidden="true">' +
              '<span>Your administrator requires two-factor authentication. Set it up below.</span></div>'
            : '') +

          '<section class="tma-security__card" aria-labelledby="sec-password">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-password">Password</h2>' +
          (d.hasRealPassword
            ? '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#change-password-dialog"><span>Change password</span></button></div>' +
              '<p class="tma-security__desc">Use a password you don\'t use anywhere else.</p></section>'
            // An account created by an administrator, or through Google/Microsoft,
            // has a random password nobody has ever seen — so "change" can't work.
            : '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#set-password-dialog"><span>Set a password</span></button></div>' +
              '<p class="tma-security__desc">Set one to sign in with your email address as well as your connected accounts.</p></section>') +

          '<section class="tma-security__card" aria-labelledby="sec-connected">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-connected">Connected accounts</h2></div>' +
          '<p class="tma-security__desc">Sign in with Google or Microsoft alongside your password. Only accounts with your portal email can be connected.</p>' +
          ((d.syncAvailable && (d.syncAvailable.google || d.syncAvailable.microsoft)) ? '<p class="tma-security__desc"><strong>Connecting also lets you sync your email and calendar</strong> into the portal, so you can use it instead of Gmail or Outlook.</p>' : '') +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-ico" aria-hidden="true"><img src="images/icons/brands/Google16.svg" alt=""></span>' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Google</span>' +
          (d.google && d.google.connected
            ? '<span class="tma-security__row-sub tma-auth__provider-status tma-auth__provider-status--on">Connected as ' + esc(d.google.email || '') + '</span>'
            : '<span class="tma-security__row-sub">Not connected</span>') +
          '</span>' +
          (d.google && d.google.connected
            ? '<button type="button" class="tma-auth__chip-btn" data-sec-sdisconnect="google"><span>Disconnect</span></button>'
            : '<a class="tma-auth__chip-btn" href="/auth/social/google/redirect' + (d.syncAvailable && d.syncAvailable.google ? '?sync_all=1' : '') + '"><span>Connect</span></a>') +
          '</div>' +
          '<div class="tma-security__row">' +
          '<span class="tma-security__row-ico" aria-hidden="true"><img src="images/icons/brands/Microsoft16.svg" alt=""></span>' +
          '<span class="tma-security__row-copy"><span class="tma-security__row-name">Microsoft</span>' +
          (d.microsoft && d.microsoft.connected
            ? '<span class="tma-security__row-sub tma-auth__provider-status tma-auth__provider-status--on">Connected as ' + esc(d.microsoft.email || '') + '</span>'
            : '<span class="tma-security__row-sub">Not connected</span>') +
          '</span>' +
          (d.microsoft && d.microsoft.connected
            ? '<button type="button" class="tma-auth__chip-btn" data-sec-sdisconnect="microsoft"><span>Disconnect</span></button>'
            : '<a class="tma-auth__chip-btn" href="/auth/social/microsoft/redirect' + (d.syncAvailable && d.syncAvailable.microsoft ? '?sync_all=1' : '') + '"><span>Connect</span></a>') +
          '</div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-phone">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-phone">Phone number</h2>' +
          (d.phone ? '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#phone-dialog"><span>Change</span></button>' : '') +
          '</div>' +
          '<p class="tma-security__desc">Used for security alerts and account recovery only - never marketing.</p>' +
          (d.phone
            ? '<div class="tma-security__row">' +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">' + esc(d.phone) + '</span>' +
              '<span class="tma-security__row-sub">Also shown on your profile.</span></span>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-phone-remove><span>Remove</span></button></div>'
            : '<div class="tma-security__empty">' +
              '<img src="images/icons/phosphor/DeviceMobile.svg" alt="" aria-hidden="true">' +
              '<span>No phone number added yet.</span>' +
              '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#phone-dialog"><span>Add phone number</span></button></div>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-tfa">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-tfa">Two-factor authentication</h2>' +
          (on ? '<span class="tma-auth__badge tma-auth__badge--done">On</span>' : '<span class="tma-auth__badge">Off</span>') + '</div>' +
          '<p class="tma-security__desc">A 6-digit code from your authenticator app is required when signing in.</p>' +
          (on
            ? '<div class="tma-security__row">' +
              (d.twoFactorApp && d.twoFactorApp.key !== 'other'
                ? '<span class="tma-security__row-ico"><img src="' + esc(d.twoFactorApp.logo.replace(/^\//, '')) + '" alt="" style="width:24px;height:24px;object-fit:contain;border-radius:6px"></span>'
                : '') +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">' + esc(d.twoFactorApp ? d.twoFactorApp.name : 'Authenticator app') + '</span>' +
              '<span class="tma-security__row-sub">Added ' + esc(d.twoFactorSince || '') + '</span></span>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-relabel><span>' + (d.twoFactorApp && d.twoFactorApp.key !== 'other' ? 'Change app' : 'Set your app') + '</span></button>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-setup><span>Set up again</span></button>' +
              '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#disable-tfa-dialog"><span>Turn off</span></button></div>'
            : '<div class="tma-security__empty">' +
              '<img src="images/icons/phosphor/ShieldCheck.svg" alt="" aria-hidden="true">' +
              '<span>Two-factor authentication is off.</span>' +
              '<button type="button" class="tma-auth__chip-btn" data-sec-setup><span>Turn on</span></button></div>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-codes">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-codes">Recovery codes</h2></div>' +
          (on
            ? '<div class="tma-security__row">' +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">' + d.recoveryCodesCount + ' codes available</span>' +
              '<span class="tma-security__row-sub">Each code signs you in once if you can\'t use your authenticator app. Codes are only shown when generated.</span></span>' +
              '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#regenerate-dialog"><span>Generate new codes</span></button></div>'
            : '<p class="tma-security__desc">Available once two-factor authentication is turned on.</p>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-trusted">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-trusted">Trusted devices</h2>' +
          ((d.trustedDevices || []).length ? '<button type="button" class="tma-auth__chip-btn" data-sec-trust-revoke-all><span>Remove all</span></button>' : '') +
          '</div>' +
          '<p class="tma-security__desc">These devices skip the two-factor code for 30 days. Remove any device you don\'t recognize.</p>' +
          ((d.trustedDevices || []).length
            ? '<div class="tma-security__table-wrap"><table class="tma-security__table">' +
              '<thead><tr><th scope="col">Device</th><th scope="col">IP address</th><th scope="col">Last used</th><th scope="col">Expires</th><th scope="col"></th></tr></thead><tbody>' +
              d.trustedDevices.map(function (td) {
                return '<tr><td>' + esc(td.device || 'Unknown device') + '</td><td>' + esc(td.ip || '') + '</td>' +
                  '<td>' + esc(td.lastUsed || '') + '</td><td>' + esc(td.expires || '') + '</td>' +
                  '<td><button type="button" class="tma-auth__chip-btn" data-sec-trust-revoke="' + td.id + '"><span>Remove</span></button></td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<div class="tma-security__empty">' +
              '<img src="images/icons/phosphor/Devices.svg" alt="" aria-hidden="true">' +
              '<span>No trusted devices yet.</span></div>') +
          '</section>' +

          '<section class="tma-security__card" aria-labelledby="sec-sessions">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-sessions">Active sessions</h2>' +
          '<button type="button" class="tma-auth__chip-btn" data-dialog-open="#signout-all-dialog"><span>Sign out of all other devices</span></button></div>' +
          '<p class="tma-security__desc">Everywhere you\'re currently signed in. Signing one out asks every device that chose to stay signed in to sign in again.</p>' +
          '<div class="tma-security__table-wrap"><table class="tma-security__table">' +
          '<thead><tr><th scope="col">Device</th><th scope="col">Location</th><th scope="col">Last active</th><th scope="col"></th></tr></thead>' +
          '<tbody>' + sessionRows + '</tbody></table></div></section>' +

          '<section class="tma-security__card" aria-labelledby="sec-history">' +
          '<div class="tma-security__head">' +
          '<h2 class="tma-security__title" id="sec-history">Recent login activity</h2></div>' +
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
          '<h2 class="tma-security__title" id="sec-notify">Security notifications</h2></div>' +
          '<p class="tma-security__desc">Emails we send to keep you informed about your account. Alerts for sign-ins from new devices can\'t be turned off.</p>' +
          /* key, label, sub, locked-on, default */
          [
            ['new_device', 'New device sign-in', 'Always on - sent whenever a new device signs in', true, true],
            ['password_changed', 'Password changes', '', false, true],
            ['two_factor_changed', 'Two-factor authentication changes', '', false, true],
            ['monthly_summary', 'Monthly security summary', 'A short overview of recent account activity', false, false],
          ].map(function (a) {
            var alerts = d.alerts || {};
            var on = a[3] ? true : (Object.prototype.hasOwnProperty.call(alerts, a[0]) ? !!alerts[a[0]] : a[4]);
            return '<div class="tma-security__row">' +
              '<span class="tma-security__row-copy"><span class="tma-security__row-name">' + a[1] + '</span>' +
              (a[2] ? '<span class="tma-security__row-sub">' + a[2] + '</span>' : '') + '</span>' +
              '<label class="tma-auth__switch"><input class="tma-auth__switch-input" type="checkbox" data-sec-alert="' + a[0] + '"' +
              (on ? ' checked' : '') + (a[3] ? ' disabled' : '') + ' aria-label="' + a[1] + '">' +
              '<span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span></label></div>';
          }).join('') +
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

          '<div class="tma-auth__dialog" id="set-password-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">Set a password</h2>' +
          '<p class="tma-auth__dialog-text">You\'ll be able to sign in with your email address and this password, as well as the accounts you\'ve connected.</p>' +
          '<form class="tma-auth__form" data-sec-form="set-password" action="#" novalidate>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password" placeholder="New password" autocomplete="new-password" aria-label="New password"></label>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="password" name="password_confirmation" placeholder="Confirm new password" autocomplete="new-password" aria-label="Confirm new password"></label>' +
          '<p class="tma-auth__hint">At least 10 characters.</p>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Set password</button></div></form></div></div>' +

          '<div class="tma-auth__dialog" id="phone-dialog" role="dialog" aria-modal="true" hidden>' +
          '<div class="tma-auth__dialog-card">' +
          '<h2 class="tma-auth__dialog-title">' + (d.phone ? 'Change your phone number' : 'Add a phone number') + '</h2>' +
          '<p class="tma-auth__dialog-text">Used for security alerts and account recovery only.</p>' +
          '<form class="tma-auth__form" data-sec-form="phone" action="#" novalidate>' +
          '<label class="tma-auth__field"><input class="tma-auth__input" type="tel" name="phone" value="' + esc(d.phone || '') + '" placeholder="+1 555 123 4567" autocomplete="tel" aria-label="Phone number"></label>' +
          '<p class="tma-auth__hint" data-sec-error hidden style="color: var(--color-red);"></p>' +
          '<div class="tma-auth__dialog-actions">' +
          '<button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>' +
          '<button type="submit" class="tma-auth__submit">Save number</button></div></form></div></div>' +

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
          '<div data-sec-step="app" hidden>' +
          '<h2 class="tma-auth__dialog-title">Choose your authenticator app</h2>' +
          '<p class="tma-auth__dialog-text">Pick the app you\'ll scan the code with.</p>' +
          '<div class="tma-authapps">' +
          ['microsoft', 'google'].map(function (k) {
            var a = AUTH_APPS[k];
            return '<button type="button" class="tma-authapp" data-sec-app="' + k + '">' +
              '<img class="tma-authapp__logo" src="' + a.logo + '" alt="">' +
              '<span class="tma-authapp__text"><span class="tma-authapp__name">' + a.name + '</span>' +
              '<span class="tma-authapp__desc">' + a.desc + '</span></span>' +
              '<img class="tma-authapp__caret" src="images/icons/phosphor/CaretRight.svg" alt=""></button>';
          }).join('') +
          '</div>' +
          '<div class="tma-auth__dialog-actions"><button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button></div></div>' +
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
          '<p class="tma-auth__dialog-text">Choose "Add account" in <strong data-sec-scan-app>your authenticator app</strong>, then scan the code below.</p>' +
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

        /* phone number */
        var phoneRemove = root.querySelector('[data-sec-phone-remove]');
        if (phoneRemove) phoneRemove.addEventListener('click', function () {
          if (!window.confirm('Remove your phone number? We won\'t be able to reach you on it about your account.')) return;
          secApi('DELETE', '/security-settings/phone').then(function (res) {
            if (res.ok) { ui().toast('Phone number removed'); refresh(); }
            else ui().toast('Could not remove your phone number.');
          });
        });

        /* security notification switches — saved as they're flipped */
        root.querySelectorAll('[data-sec-alert]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var body = {};
            body[cb.getAttribute('data-sec-alert')] = cb.checked;
            secApi('PUT', '/security-settings/alerts', body).then(function (res) {
              if (res.ok) { ui().toast(cb.checked ? 'Alert turned on' : 'Alert turned off'); return; }
              cb.checked = !cb.checked;   // the server didn't take it; don't pretend it did
              ui().toast('Could not save that setting.');
            }).catch(function () {
              cb.checked = !cb.checked;
              ui().toast('Could not save that setting.');
            });
          });
        });

        /* end one other session */
        root.querySelectorAll('[data-sec-session-revoke]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            secApi('DELETE', '/security-settings/sessions/' + b.getAttribute('data-sec-session-revoke')).then(function (res) {
              if (res.ok) { ui().toast('Session ended'); refresh(); }
              else { b.disabled = false; ui().toast('That session has already ended.'); }
            }).catch(function () { b.disabled = false; ui().toast('Could not end that session.'); });
          });
        });

        /* trusted devices */
        root.querySelectorAll('[data-sec-trust-revoke]').forEach(function (b) {
          b.addEventListener('click', function () {
            secApi('DELETE', '/security-settings/trusted-devices/' + b.getAttribute('data-sec-trust-revoke')).then(function (res) {
              if (res.ok) { ui().toast('Device removed'); refresh(); }
              else ui().toast('Could not remove that device.');
            });
          });
        });
        var revokeAll = root.querySelector('[data-sec-trust-revoke-all]');
        if (revokeAll) revokeAll.addEventListener('click', function () {
          if (!window.confirm('Remove all trusted devices? Every device will ask for a two-factor code next time.')) return;
          secApi('DELETE', '/security-settings/trusted-devices').then(function (res) {
            if (res.ok) { ui().toast('Trusted devices removed'); refresh(); }
          });
        });

        /* provider disconnects */
        root.querySelectorAll('[data-sec-sdisconnect]').forEach(function (b) {
          b.addEventListener('click', function () {
            var prov = b.getAttribute('data-sec-sdisconnect');
            secApi('POST', '/auth/social/' + prov + '/disconnect').then(function (res) {
              return res.json().then(function (j) {
                ui().toast((j && j.message) || (res.ok ? 'Disconnected.' : 'Could not disconnect.'));
                if (res.ok) refresh();
              });
            }).catch(function () { ui().toast('Could not disconnect.'); });
          });
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
        var chosenApp = 'other';
        var relabelOnly = false;   // just recording which app, not re-running setup
        root.querySelectorAll('[data-sec-setup]').forEach(function (b) {
          b.addEventListener('click', function () { relabelOnly = false; showStep('app'); });
        });
        // "Set your app / Change app": record the authenticator without touching
        // the existing secret, so the challenge screen shows the right logo.
        root.querySelectorAll('[data-sec-relabel]').forEach(function (b) {
          b.addEventListener('click', function () { relabelOnly = true; showStep('app'); });
        });
        root.querySelectorAll('[data-sec-app]').forEach(function (b) {
          b.addEventListener('click', function () {
            chosenApp = b.getAttribute('data-sec-app');
            var save = secApi('POST', '/security-settings/two-factor-app', { app: chosenApp });
            if (relabelOnly) {
              relabelOnly = false;
              save.then(function () { closeDialogs(); ui().toast('Authenticator app updated'); refresh(); });
              return;
            }
            var scanName = root.querySelector('[data-sec-scan-app]');
            if (scanName) scanName.textContent = AUTH_APPS[chosenApp].name;
            startSetup();
          });
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

            if (kind === 'set-password') {
              var pw = form.querySelector('[name="password"]').value;
              var pw2 = form.querySelector('[name="password_confirmation"]').value;
              if (pw !== pw2) { errorIn(form, 'Those passwords don\'t match.'); return; }
              secApi('POST', '/security-settings/password', { password: pw, password_confirmation: pw2 }).then(function (res) {
                if (res.ok) { closeDialogs(); ui().toast('Password set'); form.reset(); refresh(); }
                else res.json().then(function (j) { errorIn(form, firstError(j, 'Could not set your password.')); });
              });
            }

            if (kind === 'phone') {
              secApi('PUT', '/security-settings/phone', { phone: form.querySelector('[name="phone"]').value.trim() }).then(function (res) {
                if (res.ok) { closeDialogs(); ui().toast('Phone number saved'); refresh(); }
                else res.json().then(function (j) { errorIn(form, firstError(j, 'Could not save that number.')); });
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
    render: function () {
      return '<p class="tma-portal-subtitle">A summary of your account’s security posture.</p>' +
        '<div class="tma-portal-two-col">' +
        ui().section('Sign-ins', '<div data-si-signins>' + ui().loading({ count: 2 }) + '</div>') +
        ui().section('Two-factor authentication', '<div data-si-tfa>' + ui().loading({ count: 2 }) + '</div>') +
        ui().section('Active sessions', '<div data-si-sessions>' + ui().loading({ count: 2 }) + '</div>') +
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

  PAGES['signin-policy'] = {
    render: function () {
      return '<div data-pol-root>' + ui().loading() + '</div>';
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
      return '<div data-pol-root>' + ui().loading() + '</div>';
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

  /* ── Security alert settings (real: /admin/security-policies) ───────
     Only the two events the portal actually detects are offered. The screen
     this replaced also listed "signs in from a different country" and "a
     suspicious file is uploaded" — the portal does no geo-IP lookup and runs
     no malware scanner, so those switches could never have fired. The event
     list comes from the server for exactly that reason. */
  PAGES['alert-settings'] = {
    render: function () {
      return '<div data-alert-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-alert-root]');
      if (!root) return;

      secApi('GET', '/admin/security-policies').then(function (r) { return r.json(); }).then(function (all) {
        var a = all.alertSettings;
        var admin = all.isAdmin;
        var events = all.alertEvents || [];
        var thresholds = [3, 5, 10, 15, 20];

        root.innerHTML =
          '<p class="tma-portal-subtitle">Who is told when something happens to an account, on top of the account holder.</p>' +
          (admin ? '' : '<p class="tma-portal-note">Only administrators can change these settings.</p>') +
          ui().section('Tell administrators when…',
            events.map(function (ev) {
              return '<div class="tma-dash__settings-cookie-row">' +
                '<span class="tma-dash__settings-cookie-copy">' +
                '<span class="tma-dash__settings-cookie-label">' + ui().esc(ev.label) + '</span>' +
                '<span class="tma-dash__settings-cookie-desc">' + ui().esc(ev.help) + '</span>' +
                '</span>' +
                ui().toggle((a[ev.id] || {}).admins, 'data-alert-cap="' + ui().esc(ev.id) + '"' + (admin ? '' : ' disabled'), ev.label) +
                '</div>';
            }).join('')) +
          ui().section('Failed sign-in threshold',
            ui().field('Alert after', ui().select(thresholds.map(function (n) {
              return { value: String(n), label: n + ' failed attempts' };
            }), String(a.failedSignInThreshold), 'data-alert-threshold' + (admin ? '' : ' disabled'), 'Failed sign-in threshold')) +
            '<p class="tma-portal-note">Counted within ' + all.failureWindowMinutes + ' minutes, and sent once when the count is reached.</p>') +
          ui().section('Alternate contacts',
            ui().field('Also send alerts to (comma separated emails)', ui().input({
              value: a.alternateContacts,
              placeholder: 'security@yourfirm.com',
              attrs: 'data-alert-contacts' + (admin ? '' : ' disabled'),
            }))) +
          (admin ? saveBtn('data-alert-save') : '');

        var save = root.querySelector('[data-alert-save]');
        if (!save) return;
        save.addEventListener('click', function () {
          var body = {
            failedSignInThreshold: parseInt(root.querySelector('[data-alert-threshold]').value, 10),
            alternateContacts: root.querySelector('[data-alert-contacts]').value.trim(),
          };
          root.querySelectorAll('[data-alert-cap]').forEach(function (cb) {
            body[cb.getAttribute('data-alert-cap')] = { admins: cb.checked };
          });

          secApi('PUT', '/admin/security-policies/alerts', body).then(function (res) {
            if (res.ok) { ui().toast('Alert settings saved'); return; }
            res.json().then(function (j) { ui().toastError((j && j.message) || 'Could not save'); }).catch(function () {});
          });
        });
      }).catch(function () {
        root.innerHTML = '<p class="tma-portal-note">Couldn’t load the alert settings. Refresh to try again.</p>';
      });
    },
  };

  PAGES['device-security'] = {
    render: function () {
      return '<div data-pol-root>' + ui().loading() + '</div>';
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

  // One Microsoft consent covers all three — each tile reflects a facet of
  // the same connected account, so connecting any of them connects them all.
  var CONNECTOR_CATALOG = [
    { id: 'email', name: 'Outlook', desc: 'Read and send your mail in the portal', icon: 'images/icons/brands/Outlook.svg' },
    { id: 'calendar', name: 'Calendar', desc: 'Two-way sync with your Microsoft calendar', icon: 'images/icons/brands/outlook_calendar.svg' },
    { id: 'onedrive', name: 'OneDrive', desc: 'Your OneDrive files in the file library', icon: 'images/icons/brands/OneDrive40.svg' },
  ];

  PAGES['connectors'] = {
    render: function () {
      secEnsureStyles();
      return '<div data-conn-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-conn-root]');
      if (!root) return;
      var esc = ui().esc;

      try {
        var qs = new URLSearchParams(window.location.search);
        var notice = qs.get('notice');
        if (notice) {
          if (notice === 'social-connected') ui().toast('Microsoft account connected');
          else if (notice === 'social-error') ui().toast(qs.get('reason') || "That connection didn't complete");
          qs.delete('notice'); qs.delete('reason'); qs.delete('settings-page');
          history.replaceState(null, '', window.location.pathname + (qs.toString() ? '?' + qs.toString() : ''));
        }
      } catch (e) {}

      var CONNECT_URL = '/auth/social/microsoft/redirect?sync_all=1&return=connectors';

      secApi('GET', '/admin/connectors').then(function (r) { return r.json(); }).then(function (d) {
        var features = d.features || {};

        root.innerHTML =
          '<h3 class="tma-portal-section__title">Connectors</h3>' +
          '<p class="tma-portal-subtitle">Connect once — Outlook, Calendar and OneDrive link together.</p>' +
          '<div class="tma-portal-connector-list">' +
          CONNECTOR_CATALOG.map(function (c) {
            var f = features[c.id] || {};
            var right = '';

            if (!d.microsoftReady) {
              right = '<span class="tma-portal-note">Needs Microsoft sync enabled</span>';
            } else if (f.linked && c.id === 'email' && !f.writable) {
              right = '<span class="tma-portal-note">Read-only</span>' +
                '<a class="tma-auth__chip-btn" style="margin-left:8px" href="' + CONNECT_URL + '"><span>Reconnect</span></a>';
            } else if (f.linked && c.id === 'calendar' && !f.readable) {
              right = '<a class="tma-auth__chip-btn" href="' + CONNECT_URL + '"><span>Reconnect</span></a>';
            } else if (f.linked) {
              right = '<span class="tma-portal-chip tma-portal-chip--ok">Connected</span>';
            } else {
              right = '<a class="tma-auth__chip-btn" href="' + CONNECT_URL + '"><span>Connect</span></a>';
            }

            return '<div class="tma-portal-connector">' +
              '<span class="tma-portal-connector__logo"><img src="' + c.icon + '" alt=""></span>' +
              '<div class="tma-portal-connector__body">' +
              '<span class="tma-portal-connector__name">' + esc(c.name) + '</span>' +
              '<span class="tma-portal-connector__desc">' + esc(c.desc) + '</span></div>' +
              '<div class="tma-portal-connector__actions" style="display:flex;align-items:center;gap:4px">' + right + '</div>' +
              '</div>';
          }).join('') +
          '</div>' +
          (d.connected
            ? '<p class="tma-portal-note" style="margin-top:12px">Connected as ' + esc(d.email || '') +
              ' · <a href="' + CONNECT_URL + '">Reconnect</a></p>'
            : '');
      }).catch(function () {
        root.innerHTML = '<p class="tma-portal-note">Couldn\'t load connectors. Refresh to try again.</p>';
      });
    },
  };

  /* Server-backed: real bytes, measured from every table that holds them —
     the File Library, old versions, message and Feed attachments, and anything
     deleted but not yet purged. The limit is a licence figure from config, and
     the page says so rather than implying the ceiling was metered. */
  PAGES['storage-usage'] = {
    render: function () {
      secEnsureStyles();
      return '<div data-usage-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-usage-root]');
      if (!root) return;
      var esc = ui().esc;

      function bytes(n) {
        var v = Number(n) || 0;
        if (v <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        var p = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
        var scaled = v / Math.pow(1024, p);
        return (p === 0 ? v : scaled.toFixed(scaled >= 100 ? 0 : 1)) + ' ' + units[p];
      }

      function count(n) { return (Number(n) || 0).toLocaleString(); }

      function plural(n, one, many) { return (Number(n) === 1 ? one : many); }

      function when(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
      }

      function empty(text) {
        return '<p class="tma-portal-note" style="text-align:center;padding:var(--space-16) 0">' + esc(text) + '</p>';
      }

      /* Headline: used against the allowance, with the bar only when there is
         an allowance to draw it against. */
      function headline(d) {
        var limit = d.limit || {};
        var used = Number(d.usedBytes) || 0;
        var total = Number(limit.bytes) || 0;
        var pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

        var line = total > 0
          ? '<span><strong>' + esc(bytes(used)) + '</strong> of <strong>' + esc(bytes(total)) + '</strong> used</span>' +
            '<span>' + esc(pct < 1 && used > 0 ? 'Under 1%' : Math.round(pct) + '%') + '</span>'
          : '<span><strong>' + esc(bytes(used)) + '</strong> stored</span>';

        // A fraction of a percent still rounds to a sub-pixel sliver, which
        // reads as "nothing stored" rather than "barely anything".
        var bar = total > 0
          ? '<div class="tma-auth__progress-track"><div class="tma-auth__progress-fill" style="width:' +
            pct.toFixed(1) + '%' + (used > 0 ? ';min-width:3px' : '') + '"></div></div>'
          : '';

        var source = total > 0
          ? (limit.source === 'licences'
              ? bytes(limit.perLicenceBytes) + ' per licence across ' + count(limit.licences) + ' staff ' +
                plural(limit.licences, 'account', 'accounts') + ', pooled.'
              : 'Pooled across the account.')
          : 'No storage limit is set for this account.';

        var where = (d.byLocation || []).filter(function (l) { return Number(l.bytes) > 0; });
        var whereLine = where.length
          ? '<p class="tma-portal-note">' + where.map(function (l) {
              return esc(l.label) + ' ' + esc(bytes(l.bytes));
            }).join(' · ') + '</p>'
          : '';

        var g = d.growth || {};
        var growthLine = (g.addedFiles || g.binnedFiles)
          ? '<p class="tma-portal-note">Last ' + esc(g.days) + ' days: ' + esc(bytes(g.addedBytes)) + ' added across ' +
            esc(count(g.addedFiles)) + ' ' + plural(g.addedFiles, 'file', 'files') +
            (g.binnedFiles ? ', ' + esc(bytes(g.binnedBytes)) + ' moved to the bin' : '') + '.</p>'
          : '';

        // No heading: the rail already says Usage, and the figure is the lead.
        return ui().section('',
          '<div class="tma-auth__progress" style="width:100%">' +
          '<div class="tma-auth__progress-row">' + line + '</div>' + bar + '</div>' +
          '<p class="tma-portal-note">' + esc(source) + '</p>' +
          whereLine + growthLine);
      }

      function categories(d) {
        var list = (d.categories || []);
        var used = Number(d.usedBytes) || 0;
        // Six zero rows is noise on a new account; one line says the same.
        if (!list.length || used <= 0) return ui().section('What’s using it', empty('Nothing is stored yet.'));

        var rows = list.map(function (c) {
          var share = used > 0 ? (Number(c.bytes) / used) * 100 : 0;
          return '<tr><td><strong>' + esc(c.label) + '</strong>' +
            (c.hint ? '<br><span class="tma-portal-note">' + esc(c.hint) + '</span>' : '') + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(count(c.count)) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(bytes(c.bytes)) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(Number(c.bytes) > 0 && share < 1 ? '<1%' : Math.round(share) + '%') + '</td></tr>';
        }).join('');

        return ui().section('What’s using it', ui().table(['Storage', 'Items', 'Size', 'Share'], rows));
      }

      function owners(d) {
        var list = d.topOwners || [];
        var split = (d.byAccountType || []).filter(function (t) { return Number(t.bytes) > 0; });
        var splitLine = split.length > 1
          ? '<p class="tma-portal-note">' + split.map(function (t) {
              return esc(t.label) + ' ' + esc(bytes(t.bytes));
            }).join(' · ') + '</p>'
          : '';

        if (!list.length) return ui().section('Storage by owner', empty('No files have been uploaded yet.'));

        var rows = list.map(function (o) {
          return '<tr><td><strong>' + esc(o.name) + '</strong></td>' +
            '<td class="tma-portal-table__muted">' + esc(o.type) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(count(o.count)) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(bytes(o.bytes)) + '</td></tr>';
        }).join('');

        return ui().section('Storage by owner', ui().table(['Owner', 'Type', 'Files', 'Size'], rows) + splitLine);
      }

      function largest(d) {
        var list = d.largestFiles || [];
        if (!list.length) return '';

        var rows = list.map(function (f) {
          return '<tr><td><strong>' + esc(f.name) + '</strong></td>' +
            '<td class="tma-portal-table__muted">' + esc(f.folder || '—') + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(f.owner || '—') + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(when(f.uploadedAt)) + '</td>' +
            '<td class="tma-portal-table__muted">' + esc(bytes(f.bytes)) + '</td></tr>';
        }).join('');

        return ui().section('Largest files', ui().table(['File', 'Folder', 'Owner', 'Uploaded', 'Size'], rows));
      }

      secApi('GET', '/admin/storage-usage').then(function (r) {
        if (!r.ok) throw new Error('load');
        return r.json();
      }).then(function (d) {
        root.innerHTML = headline(d) + categories(d) + owners(d) + largest(d);
      }).catch(function () {
        root.innerHTML = '<p class="tma-portal-note">Couldn\'t load storage usage. Refresh to try again.</p>';
      });
    },
  };

  /* ── Permissions (real: /admin/permissions) ───────────────────────
     Two firm-wide defaults of deliberately different kinds. The directory
     toggle grants a capability, so switching it off takes the People section
     away from every employee — sidebar, page gate and API together. Client
     sharing is not a capability (the right to re-share belongs to the item,
     not the account), so the server enforces it inside FileAccess::can, which
     every share path already passes through. */
  PAGES['permissions'] = {
    render: function () {
      return '<div data-perm-root>' + ui().loading() + '</div>';
    },
    wire: function (el) {
      var root = el.querySelector('[data-perm-root]');
      if (!root) return;

      function paint(d) {
        var canEdit = !!d.canEdit;
        var counts = d.counts || {};

        root.innerHTML =
          '<p class="tma-portal-subtitle">Firm-wide defaults for what employees can see and what clients can pass on — ' +
          'administrators are unaffected by both.</p>' +
          (canEdit ? '' : '<p class="tma-portal-note">Only administrators can change these permissions.</p>') +
          ui().section('Directory',
            d.capabilities.map(function (cap) { return capRow(cap, canEdit, 'data-perm-cap'); }).join('') +
            '<p class="tma-portal-note">Applies to ' + counts.employees + ' employee account' +
            (counts.employees === 1 ? '' : 's') + ', the next time each one loads the portal.</p>') +
          ui().section('Client sharing',
            '<div class="tma-dash__settings-cookie-row">' +
            '<span class="tma-dash__settings-cookie-copy">' +
            '<span class="tma-dash__settings-cookie-label">Let clients share files onward</span>' +
            '<span class="tma-dash__settings-cookie-desc">Off, a client can open and download what you share with them but cannot pass it to anyone else. ' +
            'Existing share links they already created keep working.</span>' +
            '</span>' +
            ui().toggle(d.clientSharing, 'data-perm-sharing' + (canEdit ? '' : ' disabled'), 'Let clients share files onward') +
            '</div>' +
            '<p class="tma-portal-note">Applies to ' + counts.clients + ' client' +
            (counts.clients === 1 ? '' : 's') + '. Staff sharing is unaffected.</p>') +
          (canEdit ? saveBtn('data-perm-save') : '');

        var save = root.querySelector('[data-perm-save]');
        if (!save) return;
        save.addEventListener('click', function () {
          var employee = {};
          root.querySelectorAll('[data-perm-cap]').forEach(function (cb) {
            employee[cb.getAttribute('data-perm-cap')] = cb.checked;
          });
          secApi('PUT', '/admin/permissions', {
            employee: employee,
            clientSharing: root.querySelector('[data-perm-sharing]').checked,
          }).then(function (res) {
            return res.json().then(function (j) { return { ok: res.ok, body: j }; });
          }).then(function (r) {
            if (!r.ok) { ui().toast((r.body && r.body.message) || 'Could not save'); return; }
            ui().toast('Permissions saved');
            paint(r.body);
          }).catch(function () { ui().toast('Could not save'); });
        });
      }

      secApi('GET', '/admin/permissions')
        .then(function (r) { return r.json(); })
        .then(paint)
        .catch(function () {
          root.innerHTML = '<p class="tma-portal-note">Couldn’t load permissions. Refresh to try again.</p>';
        });
    },
  };

  /* ── Folder templates (real: /portal/file-library/folder-templates) ──
     A template is a named list of subfolder names. Creating one is only half
     the feature — "Apply" is the half that makes it worth having, and it goes
     through the same folder creation the client defaults use, so a name that
     already exists is skipped rather than duplicated. */
  var FTPL = { loaded: false, loading: false, error: '', templates: [], targets: [] };

  function loadTemplates() {
    if (FTPL.loading) return;
    FTPL.loading = true;
    filelibJson('GET', '/portal/file-library/folder-templates')
      .then(function (d) {
        FTPL.templates = d.templates || [];
        FTPL.targets = d.targets || [];
        FTPL.error = '';
      })
      .catch(function (e) { FTPL.error = e.message; })
      .then(function () { FTPL.loading = false; FTPL.loaded = true; render(); });
  }

  /* The target list is grouped (organization folders, then each client's), and
     ui().select has no optgroup support — so this builds one, reusing the same
     class so it still looks like every other select on the page. */
  function targetSelect(targets) {
    var groups = [];
    var byGroup = {};
    targets.forEach(function (t) {
      if (!byGroup[t.group]) { byGroup[t.group] = []; groups.push(t.group); }
      byGroup[t.group].push(t);
    });

    return '<select class="tma-portal-select" data-ftpl-target aria-label="Destination folder">' +
      groups.map(function (g) {
        return '<optgroup label="' + ui().esc(g) + '">' +
          byGroup[g].map(function (t) {
            return '<option value="' + ui().esc(t.id) + '">' + ui().esc(t.name) + '</option>';
          }).join('') + '</optgroup>';
      }).join('') +
      '</select>';
  }

  function templateModal(existing) {
    var editing = !!existing;
    ui().openModal({
      title: editing ? 'Edit folder template' : 'Create folder template',
      body:
        ui().field('Template name', ui().input({
          value: editing ? existing.name : '',
          placeholder: 'e.g. New Client Setup',
          attrs: 'data-ftpl-name',
        })) +
        ui().field('Subfolders (comma separated)', ui().input({
          value: editing ? existing.subfolders.join(', ') : '',
          placeholder: 'Documents, Contracts, Invoices',
          attrs: 'data-ftpl-folders',
        })) +
        '<p class="tma-portal-note">Applying this template creates any of these folders that aren’t already there.</p>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: editing ? 'Save' : 'Create', attrs: 'data-ftpl-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-ftpl-save]').addEventListener('click', function () {
          var nameEl = host.querySelector('[data-ftpl-name]');
          var name = nameEl.value.trim();
          if (!name) { nameEl.focus(); return; }

          var subfolders = host.querySelector('[data-ftpl-folders]').value
            .split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          if (!subfolders.length) { host.querySelector('[data-ftpl-folders]').focus(); return; }

          var body = { name: name, subfolders: subfolders };
          var call = editing
            ? filelibJson('PUT', '/portal/file-library/folder-templates/' + encodeURIComponent(existing.id), body)
            : filelibJson('POST', '/portal/file-library/folder-templates', body);

          call.then(function (d) {
            FTPL.templates = d.templates || [];
            ui().closeModal();
            ui().toast(editing ? 'Template saved' : 'Folder template created');
            render();
          }).catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  function applyTemplateModal(template) {
    if (!FTPL.targets.length) {
      ui().toast('There are no organization or client folders to apply this to yet');
      return;
    }

    ui().openModal({
      title: 'Apply “' + template.name + '”',
      body:
        '<p>This creates ' + template.subfolders.length + ' folder' + (template.subfolders.length === 1 ? '' : 's') +
        ' — ' + ui().esc(template.subfolders.join(', ')) + ' — inside the folder you pick.</p>' +
        ui().field('Destination folder', targetSelect(FTPL.targets)) +
        '<p class="tma-portal-note">Folders that already exist are left alone.</p>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Apply template', attrs: 'data-ftpl-apply-go' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-ftpl-apply-go]').addEventListener('click', function () {
          var folder = host.querySelector('[data-ftpl-target]').value;
          filelibJson('POST', '/portal/file-library/folder-templates/' + encodeURIComponent(template.id) + '/apply', { folder: folder })
            .then(function (d) {
              ui().closeModal();
              // "Applied, nothing to do" and "applied, made five folders" are
              // different outcomes and the toast should not blur them.
              var made = (d.created || []).length;
              ui().toast(made
                ? 'Created ' + made + ' folder' + (made === 1 ? '' : 's') + ' in ' + d.folder.name
                : 'Everything in this template was already in ' + d.folder.name);
            })
            .catch(function (e) { ui().toastError(e.message); });
        });
      },
    });
  }

  PAGES['folder-templates'] = {
    render: function () {
      if (FTPL.error) return '<p class="tma-portal-note">Couldn’t load folder templates: ' + ui().esc(FTPL.error) + '</p>';
      if (!FTPL.loaded) return ui().loading();

      return '<p class="tma-portal-subtitle">Folder templates create a consistent subfolder structure wherever you apply them.</p>' +
        (FTPL.templates.length
          ? ui().table(['Template', 'Subfolders', ''], FTPL.templates.map(function (t) {
              return '<tr><td><strong>' + ui().esc(t.name) + '</strong></td>' +
                '<td class="tma-portal-table__muted">' + ui().esc(t.subfolders.join(', ')) + '</td>' +
                '<td><div class="tma-portal-row-actions">' +
                '<button type="button" class="tma-portal-icon-btn" data-ftpl-apply="' + ui().esc(t.id) + '" title="Apply to a folder" aria-label="Apply to a folder"><img src="images/icons/phosphor/FolderPlus.svg" alt=""></button>' +
                '<button type="button" class="tma-portal-icon-btn" data-ftpl-edit="' + ui().esc(t.id) + '" title="Edit template" aria-label="Edit template"><img src="images/icons/phosphor/PencilSimple.svg" alt=""></button>' +
                '<button type="button" class="tma-portal-icon-btn" data-ftpl-delete="' + ui().esc(t.id) + '" title="Delete template" aria-label="Delete template"><img src="images/icons/phosphor/Trash.svg" alt=""></button>' +
                '</div></td></tr>';
            }).join(''))
          : ui().emptyState({ illustration: 'Illustration03', title: 'No folder templates yet', subtitle: 'Create a template like “Documents, Contracts, Invoices” and apply it to any client or organization folder.' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create folder template', attrs: 'data-ftpl-add' }) + '</div>';
    },
    wire: function (el) {
      if (!FTPL.loaded) { loadTemplates(); return; }

      function templateFor(btn, attr) {
        var id = btn.getAttribute(attr);
        return FTPL.templates.filter(function (t) { return t.id === id; })[0];
      }

      var add = el.querySelector('[data-ftpl-add]');
      if (add) add.addEventListener('click', function () { templateModal(null); });

      el.querySelectorAll('[data-ftpl-apply]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = templateFor(b, 'data-ftpl-apply');
          if (t) applyTemplateModal(t);
        });
      });

      el.querySelectorAll('[data-ftpl-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = templateFor(b, 'data-ftpl-edit');
          if (t) templateModal(t);
        });
      });

      el.querySelectorAll('[data-ftpl-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = templateFor(b, 'data-ftpl-delete');
          if (!t) return;
          // Deleting a template never touches the folders it created, so this
          // needs no scarier warning than naming what goes away.
          if (!window.confirm('Delete the “' + t.name + '” template? Folders it already created stay where they are.')) return;
          filelibJson('DELETE', '/portal/file-library/folder-templates/' + encodeURIComponent(t.id))
            .then(function (d) { FTPL.templates = d.templates || []; ui().toast('Template deleted'); render(); })
            .catch(function (e) { ui().toastError(e.message); });
        });
      });
    },
  };


  /* ── shell ──────────────────────────────────────── */
  function navIcon(name) {
    return name
      ? '<img class="tma-portal-admin__nav-icon" src="images/icons/phosphor/' + ui().esc(name) + '.svg" alt="" width="20" height="20" aria-hidden="true">'
      : '';
  }

  function navInitials(me) {
    var s = String((me && me.name) || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var colors = ['#136da0', '#03a5e9', '#0f9d8c', '#3f9142', '#c77d18', '#b5497e', '#3b6fb8'];
    var n = 0, k = String((me && (me.email || me.name)) || '');
    for (var i = 0; i < k.length; i++) n = (n + k.charCodeAt(i)) % 997;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<rect width="40" height="40" rx="20" fill="' + colors[n % colors.length] + '"/>' +
      '<text x="20" y="21" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" ' +
      'fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + s + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /* ── Default Folders (File Library configuration) ───────────────
   * Real admin management for the organization folders, the default client
   * subfolders, and the per-staff folder toggle. Backed by /portal/file-library.
   */
  var FILELIB = {
    loaded: false, loading: false, error: null,
    settings: { clientSubfolders: [], autoCreateStaffFolder: false }, orgFolders: [],
  };

  function filelibJson(method, url, body) {
    return secApi(method, url, body).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { throw new Error(d.message || 'Something went wrong.'); }
        return d;
      });
    });
  }

  function loadFileLib() {
    if (FILELIB.loading) return;
    FILELIB.loading = true;
    filelibJson('GET', '/portal/file-library/settings').then(function (d) {
      FILELIB.settings = d.settings || FILELIB.settings;
      FILELIB.orgFolders = d.organizationFolders || [];
      FILELIB.loaded = true; FILELIB.loading = false; FILELIB.error = null;
      render();
    }).catch(function (e) {
      FILELIB.loading = false; FILELIB.error = e.message; render();
    });
  }

  function mergeOrg(folder) {
    var idx = -1;
    FILELIB.orgFolders.forEach(function (x, i) { if (x.id === folder.id) idx = i; });
    if (idx >= 0) FILELIB.orgFolders[idx] = folder; else FILELIB.orgFolders.push(folder);
  }

  function saveSubfolders(list) {
    filelibJson('PUT', '/portal/file-library/settings', { clientSubfolders: list })
      .then(function (d) { FILELIB.settings = d.settings; ui().toast('Saved'); render(); })
      .catch(function (e) { ui().toast(e.message); });
  }

  function orgAccessLabel(f) {
    if (f.audience === 'all_staff') return 'All staff · ' + (f.role === 'editor' ? 'Can edit' : 'View only');
    return 'Selected staff';
  }

  function orgFolderModal() {
    ui().openModal({
      title: 'Create organization folder',
      body:
        ui().field('Folder name', ui().input({ placeholder: 'e.g. Company Documents', attrs: 'data-of-name' })) +
        ui().field('Who can access it',
          '<label class="tma-portal-radio"><input type="radio" name="of-aud" value="all_staff" checked data-of-aud> All staff</label>' +
          '<label class="tma-portal-radio"><input type="radio" name="of-aud" value="selected" data-of-aud> Selected staff (assign later)</label>') +
        ui().field('Access level for all staff', ui().select(['View only', 'Can edit'], 'View only', 'data-of-role', 'Access level')) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-of-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-of-save]').addEventListener('click', function () {
          var nameEl = host.querySelector('[data-of-name]');
          var name = (nameEl.value || '').trim();
          if (!name) { nameEl.focus(); return; }
          var audEl = host.querySelector('[data-of-aud]:checked');
          var aud = audEl ? audEl.value : 'all_staff';
          var roleSel = host.querySelector('[data-of-role]');
          var role = roleSel && roleSel.value === 'Can edit' ? 'editor' : 'viewer';
          filelibJson('POST', '/portal/file-library/organization-folders', { name: name, audience: aud, role: role })
            .then(function (d) {
              mergeOrg(d.folder);
              ui().closeModal();
              ui().toast('Folder created');
              if (window.TMASidebarShortcuts && window.TMASidebarShortcuts.refresh) window.TMASidebarShortcuts.refresh();
              if (window.TMAPortalHomeLibrary && window.TMAPortalHomeLibrary.refresh) window.TMAPortalHomeLibrary.refresh();
              render();
            })
            .catch(function (e) { ui().toast(e.message); });
        });
      },
    });
  }

  function renameOrgModal(f) {
    ui().openModal({
      title: 'Rename folder',
      body: ui().field('Folder name', ui().input({ value: f.name, attrs: 'data-of-rename' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-of-rename-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-of-rename-save]').addEventListener('click', function () {
          var name = (host.querySelector('[data-of-rename]').value || '').trim();
          if (!name) return;
          filelibJson('PATCH', '/portal/file-library/organization-folders/' + encodeURIComponent(f.id), { name: name })
            .then(function (d) { mergeOrg(d.folder); ui().closeModal(); ui().toast('Renamed'); render(); })
            .catch(function (e) { ui().toast(e.message); });
        });
      },
    });
  }

  function orgAccessModal(f) {
    ui().openModal({
      title: 'Folder access',
      body:
        ui().field('Who can access it',
          '<label class="tma-portal-radio"><input type="radio" name="oa-aud" value="all_staff"' + (f.audience === 'all_staff' ? ' checked' : '') + ' data-oa-aud> All staff</label>' +
          '<label class="tma-portal-radio"><input type="radio" name="oa-aud" value="selected"' + (f.audience !== 'all_staff' ? ' checked' : '') + ' data-oa-aud> Selected staff</label>') +
        ui().field('Access level for all staff', ui().select(['View only', 'Can edit'], f.role === 'editor' ? 'Can edit' : 'View only', 'data-oa-role', 'Access level')) +
        '<p class="tma-portal-note">For “Selected staff”, share the folder with specific people from the File Library using Assign.</p>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-oa-save' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-oa-save]').addEventListener('click', function () {
          var audEl = host.querySelector('[data-oa-aud]:checked');
          var aud = audEl ? audEl.value : 'all_staff';
          var roleSel = host.querySelector('[data-oa-role]');
          var role = roleSel && roleSel.value === 'Can edit' ? 'editor' : 'viewer';
          filelibJson('PATCH', '/portal/file-library/organization-folders/' + encodeURIComponent(f.id), { audience: aud, role: role })
            .then(function (d) { mergeOrg(d.folder); ui().closeModal(); ui().toast('Access updated'); render(); })
            .catch(function (e) { ui().toast(e.message); });
        });
      },
    });
  }

  PAGES['default-folders'] = {
    render: function () {
      if (FILELIB.error) return '<p class="tma-portal-note">Couldn’t load the File Library settings: ' + ui().esc(FILELIB.error) + '</p>';
      if (!FILELIB.loaded) return '<p class="tma-portal-subtitle">Loading…</p>';

      var orgRows = FILELIB.orgFolders.map(function (f) {
        return '<tr' + (f.archived ? ' class="tma-portal-table__muted"' : '') + '>' +
          '<td><strong>' + ui().esc(f.name) + '</strong>' + (f.archived ? ' <span class="tma-portal-tag">Archived</span>' : '') + '</td>' +
          '<td class="tma-portal-table__muted">' + ui().esc(orgAccessLabel(f)) + '</td>' +
          '<td><div class="tma-portal-row-actions">' +
          '<button type="button" class="tma-portal-icon-btn" data-org-rename="' + ui().esc(f.id) + '" title="Rename" aria-label="Rename folder"><img src="images/icons/phosphor/PencilSimple.svg" alt=""></button>' +
          '<button type="button" class="tma-portal-icon-btn" data-org-access="' + ui().esc(f.id) + '" title="Access" aria-label="Folder access"><img src="images/icons/phosphor/UsersThree.svg" alt=""></button>' +
          '<button type="button" class="tma-portal-icon-btn" data-org-archive="' + ui().esc(f.id) + '" title="' + (f.archived ? 'Restore' : 'Archive') + '" aria-label="Archive folder"><img src="images/icons/phosphor/Archive.svg" alt=""></button>' +
          '</div></td></tr>';
      }).join('');

      var orgSection = ui().section('Organization folders',
        (FILELIB.orgFolders.length
          ? ui().table(['Folder', 'Staff access', ''], orgRows)
          : ui().emptyState({ illustration: 'Illustration03', title: 'No organization folders yet', subtitle: 'Shared internal folders your staff can access. Clients never see these.' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create organization folder', attrs: 'data-org-create' }) + '</div>',
        { description: 'Shared internal folders for your staff — e.g. Company Documents, Templates, Policies. Clients can’t see these unless you share a specific file or folder with them.' });

      var subChips = (FILELIB.settings.clientSubfolders || []).map(function (n, i) {
        return '<span class="tma-portal-subchip">' + ui().esc(n) +
          '<button type="button" class="tma-portal-subchip__x" data-sub-remove="' + i + '" aria-label="Remove ' + ui().esc(n) + '">&times;</button></span>';
      }).join('');
      var subSection = ui().section('Default client subfolders',
        '<div class="tma-portal-subchips">' + (subChips || '<span class="tma-portal-note">None — new clients get just their main folder.</span>') + '</div>' +
        '<div class="tma-portal-inline-add">' + ui().input({ placeholder: 'Add a subfolder (e.g. Tax)', attrs: 'data-sub-input' }) +
        ui().btn({ label: 'Add', small: true, attrs: 'data-sub-add' }) + '</div>',
        { description: 'Created automatically inside every new client’s folder.' });

      var staffSection = ui().section('Staff folders',
        '<div class="tma-portal-toggle-row"><span class="tma-portal-toggle-row__label">Automatically create a personal folder for each new staff member</span>' +
        ui().toggle(FILELIB.settings.autoCreateStaffFolder, 'data-staff-toggle', 'Auto-create staff folder') + '</div>',
        { description: 'A private folder under “Staff Files” for each employee. Only they and administrators can see it.' });

      return orgSection + subSection + staffSection;
    },
    wire: function (el) {
      if (!FILELIB.loaded) { loadFileLib(); return; }

      var createBtn = el.querySelector('[data-org-create]');
      if (createBtn) createBtn.addEventListener('click', function () { orgFolderModal(); });

      el.querySelectorAll('[data-org-rename]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = FILELIB.orgFolders.filter(function (x) { return x.id === b.getAttribute('data-org-rename'); })[0];
          if (f) renameOrgModal(f);
        });
      });
      el.querySelectorAll('[data-org-access]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = FILELIB.orgFolders.filter(function (x) { return x.id === b.getAttribute('data-org-access'); })[0];
          if (f) orgAccessModal(f);
        });
      });
      el.querySelectorAll('[data-org-archive]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-org-archive');
          var f = FILELIB.orgFolders.filter(function (x) { return x.id === id; })[0];
          if (!f) return;
          filelibJson('PATCH', '/portal/file-library/organization-folders/' + encodeURIComponent(id), { archived: !f.archived })
            .then(function (d) { mergeOrg(d.folder); ui().toast(d.folder.archived ? 'Folder archived' : 'Folder restored'); render(); })
            .catch(function (e) { ui().toast(e.message); });
        });
      });

      el.querySelectorAll('[data-sub-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = parseInt(b.getAttribute('data-sub-remove'), 10);
          var list = (FILELIB.settings.clientSubfolders || []).slice();
          list.splice(i, 1);
          saveSubfolders(list);
        });
      });
      var addBtn = el.querySelector('[data-sub-add]');
      var addInput = el.querySelector('[data-sub-input]');
      function doAdd() {
        var v = (addInput.value || '').trim();
        if (!v) return;
        var list = (FILELIB.settings.clientSubfolders || []).slice();
        list.push(v);
        saveSubfolders(list);
      }
      if (addBtn && addInput) {
        addBtn.addEventListener('click', doAdd);
        addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      }

      var staffToggle = el.querySelector('[data-staff-toggle]');
      if (staffToggle) staffToggle.addEventListener('change', function (e) {
        var on = e.target.checked;
        filelibJson('PUT', '/portal/file-library/settings', { autoCreateStaffFolder: on })
          .then(function (d) { FILELIB.settings = d.settings; ui().toast('Saved'); })
          .catch(function (err) { ui().toast(err.message); e.target.checked = !on; });
      });
    },
  };

  function renderNavUser(active) {
    var e = ui().esc;
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    var avatar = me && me.avatar && /^(https?:|\/(storage|media)\/|data:)/.test(me.avatar)
      ? me.avatar
      : navInitials(me);
    return '<button type="button" class="tma-portal-admin__nav-item tma-portal-admin__nav-user' + (active ? ' is-active' : '') + '" data-admin-nav="profile">' +
      '<img class="tma-portal-admin__nav-user-avatar" src="' + e(avatar) + '" alt="">' +
      '<span class="tma-portal-admin__nav-user-meta">' +
      '<span class="tma-portal-admin__nav-user-name">' + e(me ? me.name : 'My profile') + '</span>' +
      (me ? '<span class="tma-portal-admin__nav-user-email">' + e(me.email) + '</span>' : '') +
      '</span></button>';
  }

  function renderNav(pageId) {
    return NAV.map(function (n) {
      if (!n.items) {
        if (!allowed(n.id)) return '';
        if (n.id === 'profile') return renderNavUser(pageId === n.id);
        return '<button type="button" class="tma-portal-admin__nav-item' + (pageId === n.id ? ' is-active' : '') + '" data-admin-nav="' + n.id + '">' + navIcon(n.icon) + ui().esc(n.label) + '</button>';
      }
      /* A group whose every section is closed to this account should not leave
         an empty disclosure behind. */
      var items = n.items.filter(function (it) { return allowed(it.id); });
      if (!items.length) return '';
      var open = !!state.expanded[n.group];
      return '<button type="button" class="tma-portal-admin__nav-item" data-admin-group="' + n.group + '" aria-expanded="' + open + '">' + navIcon(n.icon) + ui().esc(n.label) +
        '<img class="tma-portal-admin__caret" src="images/icons/phosphor/CaretRight.svg" alt=""></button>' +
        (open
          ? '<div class="tma-portal-admin__subnav">' +
            items.map(function (it) {
              return '<button type="button" class="tma-portal-admin__nav-item' + (pageId === it.id ? ' is-active' : '') + '" data-admin-nav="' + it.id + '">' + ui().esc(it.label) + '</button>';
            }).join('') +
            '</div>'
          : '');
    }).join('');
  }

  function setPage(pageId) {
    state.page = PAGES[pageId] ? pageId : 'profile';
    var group = groupForPage(state.page);
    if (group) state.expanded[group] = true;
    render();
  }

  function render() {
    var el = state.el;
    if (!el) return;
    var s = data().state();
    /* state.page is what was *asked* for — a deep link, a search result, a
       stale bookmark. What actually renders is resolved here, every time, so a
       section this account may not open falls back to their profile instead of
       drawing an admin panel. */
    var pageId = allowed(state.page) ? state.page : 'profile';
    var page = PAGES[pageId];

    /* the rail is rebuilt on every page change - keep the reader where they
       were instead of snapping back to the top of the list */
    var priorNav = el.querySelector('.tma-portal-admin__nav');
    var navScroll = priorNav ? priorNav.scrollTop : 0;

    el.innerHTML =
      '<div class="tma-portal-page"><div class="tma-portal-admin">' +
      '<nav class="tma-portal-admin__nav" aria-label="Settings sections">' + renderNav(pageId) + '</nav>' +
      '<div class="tma-portal-admin__content">' +
      page.render(s) +
      '</div></div></div>';

    var nav = el.querySelector('.tma-portal-admin__nav');
    if (nav && navScroll) nav.scrollTop = navScroll;

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

  var meWatched = false;
  var accessWatched = false;

  function refreshNavUser() {
    if (!state.el) return;
    var btn = state.el.querySelector('.tma-portal-admin__nav-user');
    if (!btn) return;
    btn.outerHTML = renderNavUser(!allowed(state.page) || state.page === 'profile');
    var fresh = state.el.querySelector('.tma-portal-admin__nav-user');
    if (fresh) fresh.addEventListener('click', function () { setPage('profile'); });
  }

  function mount(el, opts) {
    state.el = el;
    /* the identity in the rail arrives from /me after first paint */
    if (!meWatched && window.TMACurrentUser) {
      meWatched = true;
      window.TMACurrentUser.onChange(refreshNavUser);
    }
    /* so do the capabilities: the first paint shows only the personal
       sections, and the administration appears once /me has answered. */
    if (!accessWatched && access() && access().ready) {
      accessWatched = true;
      access().ready().then(function () { if (state.el) render(); });
    }
    /* deep link: /settings?page=profile */
    try {
      var wanted = new URLSearchParams(window.location.search).get('page');
      if (wanted && PAGES[wanted]) {
        opts = opts || {};
        opts.adminPage = wanted;
      }
    } catch (e) {}
    if (opts && opts.adminPage && PAGES[opts.adminPage]) {
      state.page = opts.adminPage;
      var group = groupForPage(state.page);
      if (group) state.expanded[group] = true;
    }
    render();
  }

  window.TMAPortalAdmin = { setPage: setPage };
  function mountReporting(el) {
    el.innerHTML =
      '<div class="tma-portal-page"><div class="tma-portal-admin tma-portal-admin--page">' +
      '<div class="tma-portal-admin__content">' +
      PAGES['reporting'].render() +
      '</div></div></div>';
    PAGES['reporting'].wire(el.querySelector('.tma-portal-admin__content'));
  }
  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('admin', mount);
    window.TMAPortalViews.register('reporting', mountReporting);
  }
})();
