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

  var WEEK = [
    { label: 'SU', day: '22' },
    { label: 'Mo', day: '23', active: true },
    { label: 'Tu', day: '24' },
    { label: 'We', day: '25' },
    { label: 'Th', day: '26' },
    { label: 'Fr', day: '27' },
    { label: 'Sa', day: '28' },
  ];

  var ROAD = [
    { avatar: 'AvatarFemale05', text: 'You have a bug that needs to be fixed.', time: 'Just now' },
    { avatar: 'AvatarMale05', text: 'Released a new version', time: '59 minutes ago' },
    { avatar: 'AvatarFemale02', text: 'Submitted a bug', time: '12 hours ago' },
    { avatar: 'AvatarAbstract01', text: 'Modified A data in Page X', time: 'Today, 11:59 AM' },
    { avatar: 'AvatarMale05', text: 'Deleted a page in Project X', time: 'Feb 2, 2026' },
  ];

  var FILES = [
    { icon: 'FilePdf', tone: 'purple', name: 'Project tech requirements.pdf', meta: '5.6 MB / Just now / Karina Clark', download: true },
    { icon: 'FileImage', tone: 'blue', name: 'Dashboard-design.jpg', meta: '2.3 MB / 59 minutes ago / Marcus Blake', download: false },
    { icon: 'FilePdf', tone: 'purple', name: 'Completed Project Stylings.pdf', meta: '4.6 MB / 12 hours ago / Terry Barry', download: false },
    { icon: 'FileXls', tone: 'blue', name: 'Create Project Wireframes.xls', meta: '1.2 MB / Today, 11:59 AM / Roth Bloom', download: false },
    { icon: 'FilePdf', tone: 'purple', name: 'Project tech requirements.pdf', meta: '2.8 MB / Yesterday / Natali Craig', download: false },
  ];

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
      '<div class="tma-dash__overview-metrics">' +
      '<div class="tma-dash__overview-metric tma-dash__overview-metric--status">' +
      '<span class="tma-dash__overview-metric-label">Status</span>' +
      '<div class="tma-dash__overview-status" aria-label="In Progress 51 percent">' +
      '<div class="tma-dash__overview-status-fill" style="width:51%"></div>' +
      '<span class="tma-dash__overview-status-text">' +
      '<span class="tma-dash__overview-status-label">In Progress</span>' +
      '<span class="tma-dash__overview-status-pct">51%</span></span>' +
      '</div></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Total Tasks</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>15</strong><span class="tma-dash__overview-metric-sep"> / </span><strong>48</strong></p></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Due Date</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>29 Jan, 2026</strong></p></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Budget Spent</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>$15,000</strong></p></div>' +
      '</div></div>' +
      '<div class="tma-dash__overview-hero-side">' +
      '<div class="tma-dash__avatars tma-dash__avatars--project">' +
      '<img class="tma-dash__avatar tma-dash__avatar--28" src="' + AVATAR + 'AvatarByewind.png" alt="">' +
      '<img class="tma-dash__avatar tma-dash__avatar--28" src="' + AVATAR + 'AvatarFemale05.png" alt="">' +
      '<span class="tma-dash__avatar tma-dash__avatar--more tma-dash__avatar--28">+3</span>' +
      '</div></div></section>';
  }

  function renderWeek() {
    return WEEK.map(function (d) {
      return '<button type="button" class="tma-dash__overview-day' + (d.active ? ' tma-dash__overview-day--active' : '') + '">' +
        '<span class="tma-dash__overview-day-label">' + esc(d.label) + '</span>' +
        '<span class="tma-dash__overview-day-num">' + esc(d.day) + '</span></button>';
    }).join('');
  }

  function renderRoad() {
    var items = ROAD.map(function (item) {
      return '<div class="tma-dash__overview-road-item">' +
        '<img class="tma-dash__overview-road-avatar" src="' + AVATAR + item.avatar + '.png" alt="">' +
        '<div class="tma-dash__overview-road-body">' +
        '<span class="tma-dash__overview-road-text">' + esc(item.text) + '</span>' +
        '<span class="tma-dash__overview-road-time">' + esc(item.time) + '</span></div></div>';
    }).join('');
    return '<section class="tma-dash__overview-block tma-dash__overview-block--road" data-node-id="32546:46995">' +
      '<h3 class="tma-dash__overview-block-title">What\'s on the road?</h3>' +
      '<div class="tma-dash__overview-week">' + renderWeek() + '</div>' +
      '<div class="tma-dash__overview-road">' +
      '<div class="tma-dash__overview-road-line" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-road-list">' + items + '</div></div></section>';
  }

  function renderFiles() {
    var rows = FILES.map(function (f) {
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
    }).join('');
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

  function mount(container, opts) {
    if (!container) return;
    var activeTab = (opts && opts.tab) || 'Overview';
    container.innerHTML = render(activeTab);
    bindTabs(container);
    if (activeTab === 'Users') mountUsersTab(container);
    if (activeTab === 'Files') mountFilesTab(container);
    if (activeTab === 'Activity') mountActivityTab(container);
    setActiveTab(container, activeTab);
  }

  window.TMAOverview = { mount: mount, render: render, setActiveTab: setActiveTab, renderRoad: renderRoad };
})();
