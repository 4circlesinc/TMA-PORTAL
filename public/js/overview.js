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
  var TABS = ['Overview', 'Users', 'Files', 'Activity'];

  /* Real calendar week chrome — never hardcode sample day numbers. */
  function currentWeekDays() {
    var now = new Date();
    var day = now.getDay(); // 0 = Sunday
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    var labels = ['SU', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push({
        label: labels[i],
        day: String(d.getDate()),
        active: d.toDateString() === now.toDateString(),
      });
    }
    return days;
  }

  var ROAD = [];
  var FILES = [];

  var TAB_PANELS = {
    Overview: '.tma-dash__overview-grid',
    Users: '.tma-dash__overview-users',
    Files: '.tma-dash__overview-files-tab',
    Activity: '.tma-dash__overview-activity-tab',
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTabs(activeTab) {
    var current = activeTab || 'Overview';
    var items = TABS.map(function (label) {
      var active = label === current;
      return '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" data-overview-tab="' + esc(label) + '">' +
        '<span class="tma-tab__label">' + esc(label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
    return '<div class="tma-dash__overview-toolbar">' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-tabs" role="tablist">' + items + '</div>' +
      // Add Target and the overflow menu went with the Targets tab. Add User
      // stays: it is the one action here that leads somewhere real.
      '<div class="tma-dash__overview-actions">' +
      '<button type="button" class="tma-dash__overview-btn"><img src="' + ICON + 'Plus.svg" alt=""><span>Add User</span></button>' +
      '</div></div>';
  }

  function renderHero() {
    return '<section class="tma-dash__overview-block tma-dash__overview-block--hero" data-node-id="32546:46983">' +
      '<div class="tma-dash__overview-hero-main">' +
      '<div class="tma-dash__overview-metrics tma-dash__overview-metrics--empty">' +
      '<div class="tma-dash__overview-metric">' +
      '<span class="tma-dash__overview-metric-label">Project metrics</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>No data yet</strong></p>' +
      '<p class="tma-dash__overview-metric-empty-hint">Metrics will appear when project tracking is connected.</p>' +
      '</div></div></div></section>';
  }

  function renderWeek() {
    return currentWeekDays().map(function (d) {
      return '<button type="button" class="tma-dash__overview-day' + (d.active ? ' tma-dash__overview-day--active' : '') + '">' +
        '<span class="tma-dash__overview-day-label">' + esc(d.label) + '</span>' +
        '<span class="tma-dash__overview-day-num">' + esc(d.day) + '</span></button>';
    }).join('');
  }

  function renderRoad() {
    var items = ROAD.length
      ? ROAD.map(function (item) {
          return '<div class="tma-dash__overview-road-item">' +
            '<img class="tma-dash__overview-road-avatar" src="' + AVATAR + item.avatar + '.png" alt="">' +
            '<div class="tma-dash__overview-road-body">' +
            '<span class="tma-dash__overview-road-text">' + esc(item.text) + '</span>' +
            '<span class="tma-dash__overview-road-time">' + esc(item.time) + '</span></div></div>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No upcoming items yet.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--road" data-node-id="32546:46995">' +
      '<h3 class="tma-dash__overview-block-title">What\'s on the road?</h3>' +
      '<div class="tma-dash__overview-week">' + renderWeek() + '</div>' +
      '<div class="tma-dash__overview-road">' +
      '<div class="tma-dash__overview-road-line" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-road-list">' + items + '</div></div></section>';
  }

  function renderFiles() {
    var rows = FILES.length
      ? FILES.map(function (f) {
          var dl = f.download
            ? '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--icon" aria-label="Download"><img src="' + ICON + 'DownloadSimple.svg" alt=""></button>'
            : '';
          return '<div class="tma-dash__overview-file-row">' +
            '<div class="tma-dash__overview-file-main">' +
            '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + esc(f.tone) + '">' +
            '<img src="' + fileIconSrc(f.icon, f.name) + '" alt=""></span>' +
            '<div class="tma-dash__overview-file-copy">' +
            '<p class="tma-dash__overview-file-name">' + esc(f.name) + '</p>' +
            '<p class="tma-dash__overview-file-meta">' + esc(f.meta) + '</p></div></div>' + dl + '</div>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No files yet.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--files" data-node-id="32546:47005">' +
      '<h3 class="tma-dash__overview-block-title">Latest Files</h3>' +
      '<div class="tma-dash__overview-files-body">' +
      '<div class="tma-dash__overview-files">' + rows + '</div>' +
      '<div class="tma-dash__overview-upload">' +
      '<p class="tma-dash__overview-upload-hint">Drop files here or upload files</p>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--solid"><span>Upload</span></button>' +
      '</div></div></section>';
  }

  function renderUsers(activeTab) {
    return '<div class="tma-dash__overview-users" data-node-id="32546:96120"' + (activeTab !== 'Users' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__users" data-users-overview></div></div>';
  }

  function renderFilesTab(activeTab) {
    return '<div class="tma-dash__overview-files-tab" data-node-id="32546:96116"' + (activeTab !== 'Files' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__files" data-files-overview></div></div>';
  }

  function renderActivityTab(activeTab) {
    return '<div class="tma-dash__overview-activity-tab" data-node-id="32546:96119"' + (activeTab !== 'Activity' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__activity" data-activity-overview></div></div>';
  }

  function mountUsersTab(container) {
    var mountEl = container.querySelector('[data-users-overview]');
    if (!mountEl || !window.TMAUsers || typeof window.TMAUsers.mount !== 'function') return;
    window.TMAUsers.mount(mountEl, { context: 'overview' });
  }

  function mountFilesTab(container) {
    var mountEl = container.querySelector('[data-files-overview]');
    if (!mountEl || !window.TMAOverviewFiles || typeof window.TMAOverviewFiles.mount !== 'function') return;
    window.TMAOverviewFiles.mount(mountEl);
  }

  function mountActivityTab(container) {
    var mountEl = container.querySelector('[data-activity-overview]');
    if (!mountEl || !window.TMAOverviewActivity || typeof window.TMAOverviewActivity.mount !== 'function') return;
    window.TMAOverviewActivity.mount(mountEl);
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
      renderHero() + renderRoad() + renderFiles() +
      '</div>' +
      renderUsers(tab) +
      renderFilesTab(tab) +
      renderActivityTab(tab) +
      '</div>';
  }

  function setActiveTab(container, tab) {
    if (!container) return;
    var overview = container.querySelector('.tma-dash__overview');
    if (!overview) return;

    overview.querySelectorAll('[role="tab"]').forEach(function (btn) {
      var isActive = btn.getAttribute('data-overview-tab') === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Object.keys(TAB_PANELS).forEach(function (key) {
      var panel = overview.querySelector(TAB_PANELS[key]);
      if (panel) panel.hidden = tab !== key;
    });

    if (tab === 'Users') mountUsersTab(container);
    if (tab === 'Files') mountFilesTab(container);
    if (tab === 'Activity') mountActivityTab(container);
    syncOverviewChrome(tab);
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
    var map = { overview: 'Overview', users: 'Users', files: 'Files', activity: 'Activity' };
    return map[String(token || '').toLowerCase()] || null;
  }

  function tabFromUrl() {
    try {
      var t = new URLSearchParams(window.location.search).get('tab');
      return normalizeTab(t);
    } catch (e) { return null; }
  }

  function mount(container, opts) {
    if (!container) return;
    var pending = (typeof document !== 'undefined' && document.querySelector('.tma-dash'))
      ? document.querySelector('.tma-dash')._pendingOverviewTab : null;
    var activeTab = (opts && opts.tab) || normalizeTab(pending) || tabFromUrl() || 'Overview';
    if (pending) { try { document.querySelector('.tma-dash')._pendingOverviewTab = null; } catch (e) {} }
    container.innerHTML = render(activeTab);
    bindTabs(container);
    if (activeTab === 'Users') mountUsersTab(container);
    if (activeTab === 'Files') mountFilesTab(container);
    if (activeTab === 'Activity') mountActivityTab(container);
    setActiveTab(container, activeTab);
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

  window.TMAOverview = { mount: mount, render: render, setActiveTab: setActiveTab, selectTab: selectTab, renderRoad: renderRoad };
})();
