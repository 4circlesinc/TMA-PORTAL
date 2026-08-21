/*
 * TMA - Dashboard Overview (Figma 32546:96118, Files 32546:96116, Activity 32546:96119)
 * Global: window.TMAOverview
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';
  var AVATAR = 'images/avatars/';

  function fileIconSrc(key, filename) {
    if (window.TMAFileIcons && TMAFileIcons.fileIconSrc) {
      return TMAFileIcons.fileIconSrc(key, filename);
    }
    return ICON + key + '.svg';
  }

  /* Targets, Budget and Settings were removed from this page along with the
     Project Spendings table and the Add Target action — none of them were
     backed by anything, and the page reads as a real dashboard, so figures
     nobody entered are worse than absent sections. */
  /* Employees (the presence board), Users (the account-management table) and
     the Recycle Bin all ride on administrator-only data — an employee's tab
     would be an empty board or a table of 403s. The server enforces each one
     separately; hiding them here just keeps the offer honest. */
  var BASE_TABS = ['Overview', 'Files', 'Notifications', 'Activity'];
  var ADMIN_TABS = ['Overview', 'Employees', 'Users', 'Files', 'Notifications', 'Activity', 'Recycle Bin'];

  function isAdminUser() {
    var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
    return !!(me && me.isAdmin);
  }

  function visibleTabs() {
    return (isAdminUser() ? ADMIN_TABS : BASE_TABS).slice();
  }

  function dateKeyOf(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function startOfWeek(d) {
    var day = d.getDay(); // 0 = Sunday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  }

  function parseDateKey(key) {
    var parts = String(key || '').split('-');
    if (parts.length !== 3) return new Date();
    return new Date(+parts[0], (+parts[1]) - 1, +parts[2]);
  }

  /* Real calendar week chrome — never hardcode sample day numbers. */
  function weekDaysFor(selectedKey, weekStartDate) {
    var labels = ['SU', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var start = weekStartDate || startOfWeek(parseDateKey(selectedKey));
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = dateKeyOf(d);
      days.push({
        label: labels[i],
        day: String(d.getDate()),
        key: key,
        active: key === selectedKey,
      });
    }
    return days;
  }

  var ROAD = [];
  var ROAD_EVENTS = [];
  var SELECTED_ROAD_DATE = dateKeyOf(new Date());
  var ROAD_WEEK_START = startOfWeek(new Date());
  var FILES = [];
  var METRICS = null;
  var SIGNINS = [];
  var SIGNINS_STATE = 'loading';
  var ROOT = window.__TMA_SITE_ROOT || '';

  /* Whether the server has answered this session. Warm boot keys on this,
     never on the panels having content — a dead fetch leaves them empty. */
  var OVERVIEW_REAL = false;

  /* The mounted container, so a snapshot resolving after mount repaints. */
  var OVERVIEW_CONTAINER = null;

  /*
   * ── Warm boot ────────────────────────────────────────────────────
   * Overview paints its last-known panels and lets refreshOverviewData —
   * which was always going to run — correct them silently. The road is
   * day-keyed, so it only hydrates onto the same day it was kept for:
   * yesterday's road under today's date is a wrong screen, not a warm one.
   * Post-DCL for the account scope; 'complete' guard for
   * the deferred-readyState trap. Desktop-persistent, browser-memory.
   */
  function keepOverviewWarm() {
    if (!window.TMAStore) return;
    window.TMAStore.put('overview:warm', {
      day: dateKeyOf(new Date()),
      road: ROAD,
      roadEvents: ROAD_EVENTS,
      files: FILES,
      metrics: METRICS,
      signIns: SIGNINS,
    });
  }

  function hydrateOverview() {
    if (!window.TMAStore) return;
    window.TMAStore.get('overview:warm').then(function (snap) {
      if (!snap || OVERVIEW_REAL) return;
      FILES = snap.files || [];
      METRICS = snap.metrics || null;
      SIGNINS = snap.signIns || [];
      SIGNINS_STATE = SIGNINS.length ? 'ready' : SIGNINS_STATE;
      if (snap.day === dateKeyOf(new Date())) {
        ROAD = snap.road || [];
        ROAD_EVENTS = snap.roadEvents || [];
      }
      if (OVERVIEW_CONTAINER && OVERVIEW_CONTAINER.isConnected && !OVERVIEW_REAL) {
        remountOverviewGrid(OVERVIEW_CONTAINER, 'Overview');
      }
    });
  }

  var overviewHydrated = false;
  function hydrateOverviewOnce() {
    if (overviewHydrated) return;
    overviewHydrated = true;
    hydrateOverview();
  }
  if (document.readyState === 'complete') {
    hydrateOverviewOnce();
  } else {
    document.addEventListener('DOMContentLoaded', hydrateOverviewOnce);
    window.addEventListener('load', hydrateOverviewOnce);
  }

  function apiGet(url) {
    return fetch(ROOT + url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function formatRoadTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function weekRangeIso(weekStart) {
    var start = weekStart || ROAD_WEEK_START || startOfWeek(new Date());
    var from = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7, 0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  function avatarSrc(avatar, name) {
    if (window.TMACurrentUser && TMACurrentUser.avatarSrc) {
      return TMACurrentUser.avatarSrc(avatar, name);
    }
    if (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar)) return avatar;
    return AVATAR + 'Avatar3d01.png';
  }

  function eventDateKey(ev) {
    var iso = ev.startsAt || ev.starts_at || '';
    try {
      var d = new Date(iso);
      if (!isNaN(d.getTime())) return dateKeyOf(d);
    } catch (e) {}
    return String(iso).slice(0, 10);
  }

  function buildRoadItems(events) {
    var items = [];
    (events || []).forEach(function (ev) {
      items.push({
        kind: 'event',
        id: ev.id || ev.uuid,
        text: ev.title || 'Untitled event',
        time: formatRoadTime(ev.startsAt || ev.starts_at),
        avatarUrl: avatarSrc(null, ev.organizerName || ev.title),
        dateKey: eventDateKey(ev),
      });
    });
    return items.slice(0, 8);
  }

  function loadRoadFromCalendar() {
    var range = weekRangeIso(ROAD_WEEK_START);
    var dayKey = SELECTED_ROAD_DATE;
    return apiGet('/portal/calendar/events?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to))
      .then(function (j) {
        ROAD_EVENTS = (j && j.events) || [];
        var dayEvents = ROAD_EVENTS.filter(function (ev) {
          return eventDateKey(ev) === dayKey;
        });
        ROAD = buildRoadItems(dayEvents);
      });
  }

  function setSelectedRoadDate(key) {
    SELECTED_ROAD_DATE = key || dateKeyOf(new Date());
    ROAD_WEEK_START = startOfWeek(parseDateKey(SELECTED_ROAD_DATE));
  }

  function shiftRoadWeek(deltaWeeks) {
    var start = ROAD_WEEK_START || startOfWeek(parseDateKey(SELECTED_ROAD_DATE));
    ROAD_WEEK_START = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (deltaWeeks * 7));
    var selected = parseDateKey(SELECTED_ROAD_DATE);
    var offset = selected.getDay();
    SELECTED_ROAD_DATE = dateKeyOf(new Date(
      ROAD_WEEK_START.getFullYear(),
      ROAD_WEEK_START.getMonth(),
      ROAD_WEEK_START.getDate() + offset
    ));
  }

  function fileTone(name) {
    var ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'red';
    if (ext === 'doc' || ext === 'docx') return 'blue';
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'green';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'purple';
    return 'grey';
  }

  function formatFileWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function loadLatestFiles() {
    // only=files — Recent is folder-first, so a busy org folder list would
    // otherwise return zero files for a small perPage window.
    return apiGet('/portal/files?section=recent&perPage=8&only=files')
      .then(function (j) {
        var files = (j && j.files) || [];
        FILES = files.slice(0, 6).map(function (f) {
          var name = f.name || f.filename || 'File';
          var uploader = (f.uploadedBy && f.uploadedBy.name) || (f.owner && f.owner.name) || '';
          var when = formatFileWhen(f.modifiedAt || f.uploadedAt || f.updatedAt || f.createdAt);
          var meta = [
            f.sizeLabel || '',
            when,
            uploader,
          ].filter(Boolean).join(' · ');
          return {
            id: f.id || f.uuid,
            name: name,
            meta: meta || 'Recent file',
            icon: f.icon || ((window.TMAFileIcons && TMAFileIcons.iconKeyFor) ? TMAFileIcons.iconKeyFor(name) : 'File'),
            tone: fileTone(name),
            downloadUrl: f.downloadUrl || null,
            previewUrl: f.previewUrl || f.thumbUrl || null,
            mime: f.mime || f.mimeType || '',
            uploader: uploader,
            uploaderAvatar: avatarSrc(
              (f.uploadedBy && f.uploadedBy.avatar) || (f.owner && f.owner.avatar),
              uploader
            ),
            raw: f,
          };
        });
      });
  }

  function loadMetrics() {
    return apiGet('/portal/dashboard/metrics').then(function (j) {
      METRICS = j;
    });
  }

  /* Sign-ins are their own feed, not a slice of the audit trail: failed
     attempts only exist in auth_events, and the trail shows non-admins their
     own rows alone. apiGet swallows the failure, so a null answer is the
     error state rather than an empty list — an empty list means nobody has
     signed in, which is a different thing to say. */
  function loadSignIns() {
    return apiGet('/portal/sign-ins?limit=8').then(function (j) {
      SIGNINS = (j && j.items) || [];
      SIGNINS_STATE = j ? 'ready' : 'error';
    });
  }

  var TAB_PANELS = {
    Overview: '.tma-dash__overview-grid',
    Employees: '.tma-dash__overview-employees-tab',
    Users: '.tma-dash__overview-users',
    Files: '.tma-dash__overview-files-tab',
    Notifications: '.tma-dash__overview-notifications-tab',
    Activity: '.tma-dash__overview-activity-tab',
    'Recycle Bin': '.tma-dash__overview-recycle-tab',
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTabs(activeTab) {
    var current = activeTab || 'Overview';
    var tabs = visibleTabs();
    if (tabs.indexOf(current) === -1) current = 'Overview';
    var items = tabs.map(function (label) {
      var active = label === current;
      return '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" data-overview-tab="' + esc(label) + '">' +
        '<span class="tma-tab__label">' + esc(label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
    return '<div class="tma-dash__overview-toolbar">' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-tabs" role="tablist">' + items + '</div>' +
      // Add Target and the overflow menu went with the Targets tab. Add User
      // stays for administrators: inviting accounts is theirs alone.
      '<div class="tma-dash__overview-actions">' +
      (isAdminUser()
        ? '<button type="button" class="tma-dash__overview-btn" data-overview-add-user><img src="' + ICON + 'Plus.svg" alt=""><span>Add User</span></button>'
        : '') +
      '</div></div>';
  }

  function metricCardsFromApi(j) {
    if (!j || j.staff === false || !j.cards) return null;
    var cards = j.cards;
    var order = [
      ['clientResponse', 'Client response'],
      ['cipNew', 'New CIP applications'],
      ['cipUpdatesRequired', 'CIP updates required'],
      ['awaitingSignature', 'Awaiting signature'],
    ];
    return order.map(function (pair) {
      var c = cards[pair[0]] || {};
      return {
        label: pair[1],
        value: c.value != null ? String(c.value) : '—',
        hint: c.delta || '',
      };
    });
  }

  /* Your profile, the same cards the account page shows, borrowed from
     TMAAccount so the two never drift apart. */
  function renderProfile() {
    if (!window.TMAAccount || typeof window.TMAAccount.renderProfileCards !== 'function') return '';
    return window.TMAAccount.renderProfileCards();
  }

  function mountProfile(root) {
    if (!root || !window.TMAAccount || typeof window.TMAAccount.mountProfileCards !== 'function') return;
    window.TMAAccount.mountProfileCards(root);
  }

  function renderHero() {
    var cards = metricCardsFromApi(METRICS);

    var metricsHtml;
    if (!cards) {
      metricsHtml =
        '<div class="tma-dash__overview-metrics tma-dash__overview-metrics--empty">' +
        '<div class="tma-dash__overview-metric">' +
        '<span class="tma-dash__overview-metric-label">Workspace metrics</span>' +
        '<p class="tma-dash__overview-metric-value"><strong>No data yet</strong></p>' +
        '<p class="tma-dash__overview-metric-empty-hint">Metrics appear for staff accounts once activity is recorded.</p>' +
        '</div></div>';
    } else {
      metricsHtml =
        '<div class="tma-dash__overview-metrics" aria-label="Workspace metrics">' +
        cards.map(function (c, i) {
          return (i ? '<span class="tma-dash__overview-metric-divider" aria-hidden="true"></span>' : '') +
            '<div class="tma-dash__overview-metric">' +
            '<span class="tma-dash__overview-metric-label">' + esc(c.label) + '</span>' +
            '<p class="tma-dash__overview-metric-value"><strong>' + esc(c.value) + '</strong></p>' +
            (c.hint ? '<p class="tma-dash__overview-metric-empty-hint">' + esc(c.hint) + '</p>' : '') +
            '</div>';
        }).join('') +
        '</div>';
    }

    return '<section class="tma-dash__overview-block tma-dash__overview-block--hero" data-node-id="32546:46983">' +
      '<div class="tma-dash__overview-hero-main">' +
      '<h3 class="tma-dash__overview-block-title">Workspace metrics</h3>' +
      metricsHtml +
      '</div>' +
      '</section>';
  }

  function renderWeek() {
    return weekDaysFor(SELECTED_ROAD_DATE, ROAD_WEEK_START).map(function (d) {
      return '<button type="button" class="tma-dash__overview-day' + (d.active ? ' tma-dash__overview-day--active' : '') +
        '" data-overview-day="' + esc(d.key) + '" aria-pressed="' + (d.active ? 'true' : 'false') + '">' +
        '<span class="tma-dash__overview-day-label">' + esc(d.label) + '</span>' +
        '<span class="tma-dash__overview-day-num">' + esc(d.day) + '</span></button>';
    }).join('');
  }

  function renderRoad() {
    var items = ROAD.length
      ? ROAD.map(function (item) {
          return '<button type="button" class="tma-dash__overview-road-item" data-overview-road-item="' +
            esc(item.id || '') + '" data-overview-road-kind="' + esc(item.kind || 'event') + '"' +
            (item.dateKey ? ' data-overview-road-date="' + esc(item.dateKey) + '"' : '') + '>' +
            '<img class="tma-dash__overview-road-avatar" src="' + esc(item.avatarUrl || AVATAR + 'Avatar3d01.png') + '" alt="">' +
            '<div class="tma-dash__overview-road-body">' +
            '<span class="tma-dash__overview-road-text">' + esc(item.text) + '</span>' +
            '<span class="tma-dash__overview-road-time">' + esc(item.time) + '</span></div></button>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No upcoming events for this day.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--road" data-node-id="32546:46995" data-overview-road>' +
      '<h3 class="tma-dash__overview-block-title">Upcoming Events</h3>' +
      '<div class="tma-dash__overview-week-wrap">' +
      '<button type="button" class="tma-dash__overview-week-nav" data-overview-week-nav="-1" aria-label="Previous week">' +
      '<img src="' + ICON + 'CaretLeft.svg" alt=""></button>' +
      '<div class="tma-dash__overview-week" data-overview-week>' + renderWeek() + '</div>' +
      '<button type="button" class="tma-dash__overview-week-nav" data-overview-week-nav="1" aria-label="Next week">' +
      '<img src="' + ICON + 'CaretRight.svg" alt=""></button>' +
      '</div>' +
      '<div class="tma-dash__overview-road">' +
      '<div class="tma-dash__overview-road-line" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-road-list">' + items + '</div></div></section>';
  }

  function renderFiles() {
    var rows = FILES.length
      ? FILES.map(function (f) {
          return '<button type="button" class="tma-dash__overview-file-row" data-overview-file="' +
            esc(f.id || '') + '">' +
            '<div class="tma-dash__overview-file-main">' +
            '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + esc(f.tone) + '">' +
            '<img src="' + fileIconSrc(f.icon, f.name) + '" alt=""></span>' +
            '<div class="tma-dash__overview-file-copy">' +
            '<p class="tma-dash__overview-file-name">' + esc(f.name) + '</p>' +
            '<p class="tma-dash__overview-file-meta">' + esc(f.meta) + '</p></div>' +
            (f.uploader
              ? '<img class="tma-dash__overview-file-uploader" src="' + esc(f.uploaderAvatar) +
                '" alt="' + esc(f.uploader) + '" title="' + esc(f.uploader) + '">'
              : '') +
            '</div></button>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No files yet.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--files" data-node-id="32546:47005">' +
      '<div class="tma-dash__overview-block-head">' +
      '<h3 class="tma-dash__overview-block-title">Latest Files</h3>' +
      '<button type="button" class="tma-dash__overview-link" data-overview-view-all-files>View all files</button>' +
      '</div>' +
      '<div class="tma-dash__overview-files-body">' +
      '<div class="tma-dash__overview-files">' + rows + '</div>' +
      '<div class="tma-dash__overview-upload" data-overview-upload-zone>' +
      '<p class="tma-dash__overview-upload-hint">Drop files here or upload files</p>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--solid" data-overview-upload><span>Upload</span></button>' +
      '<input type="file" hidden multiple data-overview-file-input>' +
      '</div></div></section>';
  }

  /* Recent sign-ins. The rows are the shared activity component the right
     sidebar and the Activities popup already use, so a sign-in looks the same
     wherever it is shown — only the feed behind it is different. */
  function renderSignInRows() {
    var R = window.TMANotifyRender;
    if (!R) return '';
    if (SIGNINS_STATE === 'loading') return R.skeleton(4);
    if (SIGNINS_STATE === 'error') return R.errorState('Could not load sign-ins.');
    if (!SIGNINS.length) return R.emptyState('No sign-ins recorded yet.', 'ClockCounterClockwise');
    return SIGNINS.map(function (item) {
      return R.activityItem(item, 'sidebar');
    }).join('');
  }

  function renderSignIns() {
    return '<section class="tma-dash__overview-block tma-dash__overview-block--signins" data-overview-signins>' +
      '<div class="tma-dash__overview-block-head">' +
      '<h3 class="tma-dash__overview-block-title">Recent sign-ins</h3>' +
      '<button type="button" class="tma-dash__overview-link" data-overview-view-all-activity>See all activity</button>' +
      '</div>' +
      '<div class="tma-dash__overview-signins" data-overview-signins-body>' + renderSignInRows() + '</div>' +
      '</section>';
  }

  function renderEmployeesTab(activeTab) {
    if (!isAdminUser()) return '';
    return '<div class="tma-dash__overview-employees-tab"' + (activeTab !== 'Employees' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__overview-employees-mount" data-employees-overview></div></div>';
  }

  function renderUsers(activeTab) {
    if (!isAdminUser()) return '';
    return '<div class="tma-dash__overview-users" data-node-id="32546:96120"' + (activeTab !== 'Users' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__users" data-users-overview></div></div>';
  }

  function renderFilesTab(activeTab) {
    return '<div class="tma-dash__overview-files-tab" data-node-id="32546:96116"' + (activeTab !== 'Files' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__files" data-files-overview></div></div>';
  }

  function mountEmployeesTab(container) {
    if (!isAdminUser()) return;
    var mountEl = container.querySelector('[data-employees-overview]');
    if (!mountEl || !window.TMAOverviewEmployees || typeof window.TMAOverviewEmployees.mount !== 'function') return;
    window.TMAOverviewEmployees.mount(mountEl);
  }

  function renderNotificationsTab(activeTab) {
    return '<div class="tma-dash__overview-notifications-tab"' + (activeTab !== 'Notifications' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__notifications" data-notifications-overview></div></div>';
  }

  function renderActivityTab(activeTab) {
    return '<div class="tma-dash__overview-activity-tab" data-node-id="32546:96119"' + (activeTab !== 'Activity' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__activity" data-activity-overview></div></div>';
  }

  function renderRecycleTab(activeTab) {
    if (!isAdminUser()) return '';
    return '<div class="tma-dash__overview-recycle-tab"' + (activeTab !== 'Recycle Bin' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__recycle" data-recycle-overview></div></div>';
  }

  function mountUsersTab(container) {
    if (!isAdminUser()) return;
    var mountEl = container.querySelector('[data-users-overview]');
    if (!mountEl || !window.TMAUsers || typeof window.TMAUsers.mount !== 'function') return;
    window.TMAUsers.mount(mountEl, { context: 'overview' });
  }

  function mountFilesTab(container) {
    var mountEl = container.querySelector('[data-files-overview]');
    if (!mountEl || !window.TMAOverviewFiles || typeof window.TMAOverviewFiles.mount !== 'function') return;
    window.TMAOverviewFiles.mount(mountEl);
  }

  function mountNotificationsTab(container) {
    var mountEl = container.querySelector('[data-notifications-overview]');
    if (!mountEl || !window.TMAOverviewNotifications || typeof window.TMAOverviewNotifications.mount !== 'function') return;
    window.TMAOverviewNotifications.mount(mountEl);
  }

  function mountActivityTab(container) {
    var mountEl = container.querySelector('[data-activity-overview]');
    if (!mountEl || !window.TMAOverviewActivity || typeof window.TMAOverviewActivity.mount !== 'function') return;
    window.TMAOverviewActivity.mount(mountEl);
  }

  function mountRecycleTab(container) {
    if (!isAdminUser()) return;
    var mountEl = container.querySelector('[data-recycle-overview]');
    if (!mountEl || !window.TMAOverviewRecycle || typeof window.TMAOverviewRecycle.mount !== 'function') return;
    window.TMAOverviewRecycle.mount(mountEl);
  }

  function syncOverviewChrome(tab) {
    var dash = document.querySelector('.tma-dash');
    var overviewView = dash && dash.querySelector('.tma-dash__view[data-view="overview"]');
    if (!overviewView || overviewView.hidden) return;

    var mainHead = dash.querySelector('.tma-dash__main-head');
    var viewToggleWrap = dash.querySelector('[data-page-view-toggle]');
    if (mainHead) mainHead.style.display = 'none';
    if (viewToggleWrap) viewToggleWrap.hidden = true;

    if (tab === 'Users' && window.TMAUsers && typeof window.TMAUsers.setActiveContext === 'function') {
      window.TMAUsers.setActiveContext('overview');
    }
  }

  function render(activeTab) {
    var tab = activeTab || 'Overview';
    return '<div class="tma-dash__overview" data-node-id="32546:96118">' +
      renderTabs(tab) +
      '<div class="tma-dash__overview-grid"' + (tab !== 'Overview' ? ' hidden' : '') + '>' +
      renderProfile() + renderHero() + renderRoad() + renderFiles() + renderSignIns() +
      '</div>' +
      renderEmployeesTab(tab) +
      renderUsers(tab) +
      renderFilesTab(tab) +
      renderNotificationsTab(tab) +
      renderActivityTab(tab) +
      renderRecycleTab(tab) +
      '</div>';
  }

  function setActiveTab(container, tab) {
    if (!container) return;
    var overview = container.querySelector('.tma-dash__overview');
    if (!overview) return;
    if (visibleTabs().indexOf(tab) === -1) tab = 'Overview';

    overview.querySelectorAll('[role="tab"]').forEach(function (btn) {
      var isActive = btn.getAttribute('data-overview-tab') === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Object.keys(TAB_PANELS).forEach(function (key) {
      var panel = overview.querySelector(TAB_PANELS[key]);
      if (panel) panel.hidden = tab !== key;
    });

    if (tab === 'Employees') mountEmployeesTab(container);
    if (tab === 'Users') mountUsersTab(container);
    if (tab === 'Files') mountFilesTab(container);
    if (tab === 'Notifications') mountNotificationsTab(container);
    if (tab === 'Activity') mountActivityTab(container);
    if (tab === 'Recycle Bin') mountRecycleTab(container);
    syncOverviewChrome(tab);

    // Keep the URL in sync so See all / refresh / share land on the same tab.
    try {
      var key = String(tab || 'Overview').toLowerCase();
      if (key === 'recycle bin') key = 'recycle-bin';
      var url = new URL(window.location.href);
      if (key === 'overview') url.searchParams.delete('tab');
      else url.searchParams.set('tab', key);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  function bindTabs(container) {
    if (!container || container.dataset.overviewTabsBound) return;
    container.dataset.overviewTabsBound = '1';
    container.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-overview-tab]');
      if (!tabBtn || !container.contains(tabBtn)) return;
      setActiveTab(container, tabBtn.getAttribute('data-overview-tab'));
    });
  }

  /* Map a deep-link tab token (?tab=activity, or the pending value the shell
     stored) to a real tab label, so "See all activities" lands on Activity. */
  function normalizeTab(token) {
    var map = {
      overview: 'Overview',
      employees: 'Employees',
      employee: 'Employees',
      staff: 'Employees',
      team: 'Employees',
      users: 'Users',
      files: 'Files',
      notifications: 'Notifications',
      notification: 'Notifications',
      activity: 'Activity',
      activities: 'Activity',
      recycle: 'Recycle Bin',
      'recycle-bin': 'Recycle Bin',
      recyclebin: 'Recycle Bin',
      trash: 'Recycle Bin',
      bin: 'Recycle Bin',
    };
    return map[String(token || '').toLowerCase()] || null;
  }

  function tabFromUrl() {
    try {
      var t = new URLSearchParams(window.location.search).get('tab');
      return normalizeTab(t);
    } catch (e) { return null; }
  }

  function remountOverviewGrid(container, activeTab) {
    if (!container || activeTab !== 'Overview') return;
    var grid = container.querySelector('.tma-dash__overview-grid');
    if (!grid) return;
    var scrollY = window.scrollY || 0;
    grid.innerHTML = renderProfile() + renderHero() + renderRoad() + renderFiles() + renderSignIns();
    try { window.scrollTo(0, scrollY); } catch (e) {}
    bindRoadWheel(container);
    mountProfile(grid);
  }

  function remountRoadSection(container) {
    var host = container || document;
    var section = host.querySelector('[data-overview-road]');
    if (!section) return;
    var html = renderRoad();
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var next = tmp.firstElementChild;
    if (!next) return;
    section.replaceWith(next);
    bindRoadWheel(host);
  }

  function navigateToCalendar() {
    var calNav = document.querySelector('.tma-dash__nav-item[data-nav="calendar"], .tma-dash__mrow[data-nav="calendar"]');
    if (calNav) calNav.click();
    else if (window.TMACalendar && typeof TMACalendar.activate === 'function') {
      TMACalendar.activate();
    }
  }

  function openCalendarEvent(eventId, dateKey) {
    if (eventId) window.__TMA_OPEN_EVENT = eventId;
    else if (dateKey) window.__TMA_OPEN_DAY = dateKey;
    navigateToCalendar();
    if (eventId && window.TMACalendar && typeof TMACalendar.openEvent === 'function') {
      TMACalendar.openEvent(eventId);
    } else if (dateKey && window.TMACalendar && typeof TMACalendar.openDay === 'function') {
      TMACalendar.openDay(dateKey);
    }
  }

  function refreshRoadForSelection(container) {
    return loadRoadFromCalendar().then(function () {
      remountRoadSection(container);
    });
  }

  function bindRoadWheel(root) {
    var hosts = root.querySelectorAll
      ? root.querySelectorAll('[data-overview-week]')
      : [];
    Array.prototype.forEach.call(hosts, function (week) {
      if (week.dataset.roadWheelBound) return;
      week.dataset.roadWheelBound = '1';
      week.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        if (week.scrollWidth <= week.clientWidth + 1) return;
        e.preventDefault();
        week.scrollLeft += e.deltaY;
      }, { passive: false });
    });
  }

  function openFilePreview(file) {
    if (!file) return;
    var url = file.previewUrl || file.downloadUrl;
    if (!url) return;
    if (window.TMAPortalLightbox && typeof TMAPortalLightbox.open === 'function') {
      TMAPortalLightbox.open([{
        name: file.name,
        mime: file.mime || '',
        size: (file.raw && file.raw.size) || 0,
        url: url,
        downloadUrl: file.downloadUrl || url,
      }], 0);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function openUploaderPhoto(file) {
    var src = file && file.uploaderAvatar;
    if (!src || !window.TMAPortalLightbox) return;
    if (/Avatar3d|initials|data:image\/svg/i.test(src) && !(file.raw && file.raw.uploadedBy && file.raw.uploadedBy.avatar)) {
      return;
    }
    var real = (file.raw && file.raw.uploadedBy && file.raw.uploadedBy.avatar) || src;
    if (!real || !/^(https?:|\/(storage|media)\/)/.test(real)) return;
    TMAPortalLightbox.open([{
      name: file.uploader || 'Profile photo',
      mime: 'image/jpeg',
      size: 0,
      url: real,
      canDownload: false,
    }], 0);
  }

  function startOverviewUpload(container, fileList) {
    if (!fileList || !fileList.length || !window.TMAUpload) return;
    window.TMAUpload.add(fileList, { folderId: null });
  }

  function bindOverviewActions(container) {
    if (!container || container.dataset.overviewActionsBound) return;
    container.dataset.overviewActionsBound = '1';

    container.addEventListener('click', function (e) {
      var addUser = e.target.closest('[data-overview-add-user]');
      if (addUser && container.contains(addUser)) {
        e.preventDefault();
        if (window.TMAUsers && typeof TMAUsers.openInvite === 'function') {
          TMAUsers.openInvite();
        } else {
          var usersTab = container.querySelector('[data-overview-tab="Users"]');
          if (usersTab) usersTab.click();
        }
        return;
      }

      var allActivity = e.target.closest('[data-overview-view-all-activity]');
      if (allActivity && container.contains(allActivity)) {
        e.preventDefault();
        setActiveTab(container, 'Activity');
        return;
      }

      var weekNav = e.target.closest('[data-overview-week-nav]');
      if (weekNav && container.contains(weekNav)) {
        e.preventDefault();
        shiftRoadWeek(parseInt(weekNav.getAttribute('data-overview-week-nav'), 10) || 0);
        refreshRoadForSelection(container);
        return;
      }

      var dayBtn = e.target.closest('[data-overview-day]');
      if (dayBtn && container.contains(dayBtn)) {
        e.preventDefault();
        setSelectedRoadDate(dayBtn.getAttribute('data-overview-day'));
        refreshRoadForSelection(container);
        return;
      }

      var roadItem = e.target.closest('[data-overview-road-item]');
      if (roadItem && container.contains(roadItem)) {
        e.preventDefault();
        var rid = roadItem.getAttribute('data-overview-road-item');
        var rdate = roadItem.getAttribute('data-overview-road-date') || SELECTED_ROAD_DATE;
        openCalendarEvent(rid, rdate);
        return;
      }

      var viewAllFiles = e.target.closest('[data-overview-view-all-files]');
      if (viewAllFiles && container.contains(viewAllFiles)) {
        e.preventDefault();
        setActiveTab(container, 'Files');
        return;
      }

      var uploaderImg = e.target.closest('.tma-dash__overview-file-uploader');
      if (uploaderImg && container.contains(uploaderImg)) {
        e.preventDefault();
        e.stopPropagation();
        var rowBtn = uploaderImg.closest('[data-overview-file]');
        var id = rowBtn && rowBtn.getAttribute('data-overview-file');
        var file = FILES.filter(function (f) { return String(f.id) === String(id); })[0];
        openUploaderPhoto(file);
        return;
      }

      var fileBtn = e.target.closest('[data-overview-file]');
      if (fileBtn && container.contains(fileBtn)) {
        e.preventDefault();
        var fid = fileBtn.getAttribute('data-overview-file');
        openFilePreview(FILES.filter(function (f) { return String(f.id) === String(fid); })[0]);
        return;
      }

      var uploadBtn = e.target.closest('[data-overview-upload]');
      if (uploadBtn && container.contains(uploadBtn)) {
        e.preventDefault();
        var input = container.querySelector('[data-overview-file-input]');
        if (input) input.click();
      }
    });

    container.addEventListener('change', function (e) {
      var input = e.target.closest('[data-overview-file-input]');
      if (!input || !container.contains(input)) return;
      startOverviewUpload(container, input.files);
      input.value = '';
    });

    container.addEventListener('dragover', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
    container.addEventListener('dragleave', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      zone.classList.remove('is-dragover');
    });
    container.addEventListener('drop', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      e.preventDefault();
      zone.classList.remove('is-dragover');
      startOverviewUpload(container, e.dataTransfer && e.dataTransfer.files);
    });

    document.addEventListener('tma:upload-complete', function () {
      var current = container.querySelector('[role="tab"][aria-selected="true"]');
      var tab = (current && current.getAttribute('data-overview-tab')) || 'Overview';
      if (tab !== 'Overview') return;
      loadLatestFiles().then(function () {
        remountOverviewGrid(container, 'Overview');
      });
    });
  }

  function refreshOverviewData(container) {
    return Promise.all([
      loadRoadFromCalendar(),
      loadLatestFiles(),
      loadMetrics(),
      loadSignIns(),
    ]).then(function () {
      // Metrics answering is the tell that the server, not a dead network,
      // produced this state — a failed apiGet resolves null everywhere.
      if (METRICS || FILES.length || SIGNINS.length) {
        OVERVIEW_REAL = true;
        keepOverviewWarm();
      }
      var current = container.querySelector('[role="tab"][aria-selected="true"]');
      var tab = (current && current.getAttribute('data-overview-tab')) || 'Overview';
      if (tab === 'Overview') remountOverviewGrid(container, 'Overview');
    });
  }

  /* Bind day / week / item clicks for any host that embeds renderRoad
     (Overview tab and Dashboard home). Idempotent per root. */
  function bindRoadActions(root) {
    if (!root || root.dataset.overviewRoadBound) return;
    root.dataset.overviewRoadBound = '1';
    root.addEventListener('click', function (e) {
      var weekNav = e.target.closest('[data-overview-week-nav]');
      if (weekNav && root.contains(weekNav)) {
        e.preventDefault();
        shiftRoadWeek(parseInt(weekNav.getAttribute('data-overview-week-nav'), 10) || 0);
        refreshRoadForSelection(root);
        return;
      }
      var dayBtn = e.target.closest('[data-overview-day]');
      if (dayBtn && root.contains(dayBtn)) {
        e.preventDefault();
        setSelectedRoadDate(dayBtn.getAttribute('data-overview-day'));
        refreshRoadForSelection(root);
        return;
      }
      var roadItem = e.target.closest('[data-overview-road-item]');
      if (roadItem && root.contains(roadItem)) {
        e.preventDefault();
        var rid = roadItem.getAttribute('data-overview-road-item');
        var rdate = roadItem.getAttribute('data-overview-road-date') || SELECTED_ROAD_DATE;
        openCalendarEvent(rid, rdate);
      }
    });
    bindRoadWheel(root);
  }

  function remountTabsForAdmin(container, requestedTab) {
    if (!container || !isAdminUser()) return;
    var overview = container.querySelector('.tma-dash__overview');
    if (!overview) return;
    if (overview.querySelector('[data-overview-tab="Recycle Bin"]')) return;
    var current = overview.querySelector('[role="tab"][aria-selected="true"]');
    var tab = (current && current.getAttribute('data-overview-tab')) || 'Overview';
    var toolbar = overview.querySelector('.tma-dash__overview-toolbar');
    if (toolbar) toolbar.outerHTML = renderTabs(tab);
    if (!overview.querySelector('.tma-dash__overview-employees-tab')) {
      overview.insertAdjacentHTML('beforeend', renderEmployeesTab(tab));
    }
    if (!overview.querySelector('.tma-dash__overview-users')) {
      overview.insertAdjacentHTML('beforeend', renderUsers(tab));
    }
    if (!overview.querySelector('.tma-dash__overview-recycle-tab')) {
      overview.insertAdjacentHTML('beforeend', renderRecycleTab(tab));
    }
    // A deep link to an admin tab that arrived before /me resolved was parked
    // on Overview; honour it now that the tab exists.
    if (requestedTab && tab !== requestedTab && visibleTabs().indexOf(requestedTab) !== -1) {
      setActiveTab(container, requestedTab);
    }
  }

  function mount(container, opts) {
    if (!container) return;
    var pending = (typeof document !== 'undefined' && document.querySelector('.tma-dash'))
      ? document.querySelector('.tma-dash')._pendingOverviewTab : null;
    var activeTab = (opts && opts.tab) || normalizeTab(pending) || tabFromUrl() || 'Overview';
    if (pending) { try { document.querySelector('.tma-dash')._pendingOverviewTab = null; } catch (e) {} }
    var requestedTab = activeTab;
    if (visibleTabs().indexOf(activeTab) === -1) activeTab = 'Overview';
    container.innerHTML = render(activeTab);
    bindTabs(container);
    bindOverviewActions(container);
    bindRoadWheel(container);
    mountProfile(container.querySelector('.tma-dash__overview-grid'));
    if (activeTab === 'Employees') mountEmployeesTab(container);
    if (activeTab === 'Users') mountUsersTab(container);
    if (activeTab === 'Files') mountFilesTab(container);
    if (activeTab === 'Notifications') mountNotificationsTab(container);
    if (activeTab === 'Activity') mountActivityTab(container);
    if (activeTab === 'Recycle Bin') mountRecycleTab(container);
    setActiveTab(container, activeTab);

    OVERVIEW_CONTAINER = container;
    refreshOverviewData(container);

    // /me may resolve after first paint — reveal the admin-only tabs then.
    if (window.TMACurrentUser && typeof window.TMACurrentUser.onChange === 'function') {
      window.TMACurrentUser.onChange(function () {
        remountTabsForAdmin(container, requestedTab);
      });
    }
  }

  /* Open a tab on an already-mounted Overview (used by the "See all
     activities" deep link). Mounts the tab's content on demand. */
  function selectTab(token) {
    var tab = normalizeTab(token) || 'Overview';
    var container = document.querySelector('[data-overview]');
    if (!container || !container.querySelector('.tma-dash__overview')) {
      // Not mounted yet — leave a marker mount() will pick up.
      var dash = document.querySelector('.tma-dash');
      if (dash) dash._pendingOverviewTab = token;
      return;
    }
    setActiveTab(container, tab);
  }

  window.TMAOverview = {
    mount: mount,
    render: render,
    setActiveTab: setActiveTab,
    selectTab: selectTab,
    renderRoad: renderRoad,
    bindRoadActions: bindRoadActions,
    refreshRoad: function (root) {
      return loadRoadFromCalendar().then(function () {
        remountRoadSection(root || document);
      });
    },
    refresh: function () {
      var container = document.querySelector('[data-overview]');
      if (container) refreshOverviewData(container);
    },
  };
})();
