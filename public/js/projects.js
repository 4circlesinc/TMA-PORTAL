/*
 * TMA - My Projects page ( /projects ) - Figma 32546:96122
 * Uses TMACard + shared dashboard list/grid toggle (TMATableViewToggle).
 * Global: window.TMAProjects
 */
(function () {
  'use strict';

  var VIEW_KEY = 'tma.projectsViewMode.v1';

  function due(month, day, year) {
    return 'Due Date: ' + month + ' ' + day + ', ' + year;
  }

  var STATS = [
    { nodeId: '33160:10066', label: 'Current Projects', value: '268', trend: '+11.02%', trendUp: true, bg: '#e6f1fd', icon: 'FolderNotch' },
    { nodeId: '33160:10067', label: 'Project Finance', value: '$3,290', trend: '-0.03%', trendUp: false, bg: '#edeefc', icon: 'CurrencyCircleDollar' },
    { nodeId: '33160:10068', label: 'Our Clients', value: '31', trend: '+15.03%', trendUp: true, bg: '#e6f1fd', icon: 'UsersThree' },
  ];

  var PROJECTS = [
    { nodeId: '33160:10069', title: 'Advisory Portal', dueDate: due('Nov', 10, 2026), status: 'In Progress', statusColor: 'purple', completed: 36, total: 49, percent: 75, logoIcon: 'Figma', avatar: 'AvatarByewind' },
    { nodeId: '33160:10070', title: 'Coffee detail page - Main Page', dueDate: due('Nov', 10, 2026), status: 'Complete', statusColor: 'green', completed: 56, total: 56, percent: 100, logoIcon: 'Copilot', avatar: 'AvatarFemale04', fullStrip: true },
    { nodeId: '33160:10071', title: 'Drinking bottle graphics', dueDate: due('Nov', 10, 2026), status: 'Rejected', statusColor: 'gray', completed: 16, total: 65, percent: 45, logoIcon: 'Behance', avatar: 'Avatar3d04' },
    { nodeId: '33160:10072', title: 'Company logo design', dueDate: due('Feb', 21, 2026), status: 'Complete', statusColor: 'green', completed: 20, total: 20, percent: 100, logoIcon: 'Dropbox', avatar: 'AvatarAbstract04', fullStrip: true },
    { nodeId: '33160:10073', title: 'Landing page design', dueDate: due('Jun', 20, 2026), status: 'Pending', statusColor: 'blue', completed: 5, total: 23, percent: 36, logoIcon: 'ChatGPT', avatarGroup: ['AvatarByewind', 'AvatarFemale05', 3] },
    { nodeId: '33160:10074', title: 'Product page redesign', dueDate: due('Jun', 20, 2026), status: 'In Progress', statusColor: 'purple', completed: 12, total: 49, percent: 38, logoIcon: 'Dribbble', avatar: 'AvatarMale02' },
    { nodeId: '33160:10075', title: 'Coffee detail page', dueDate: due('Jun', 24, 2026), status: 'Rejected', statusColor: 'gray', completed: 8, total: 12, percent: 68, logoIcon: 'Messenger', avatar: 'AvatarMale01' },
    { nodeId: '33160:10076', title: 'Aviasales App', dueDate: due('Oct', 25, 2026), status: 'Approved', statusColor: 'orange', completed: 17, total: 20, percent: 70, logoIcon: 'Loop', avatar: 'AvatarFemale06', stripColor: 'yellow', fullStrip: true },
    { nodeId: '33160:10077', title: 'Finance Dispatch', dueDate: due('Nov', 10, 2026), status: 'Pending', statusColor: 'blue', completed: 2, total: 19, percent: 17, logoIcon: 'Slack', avatar: 'AvatarAbstract01' },
    { nodeId: '33160:10078', title: 'Fitnes App', dueDate: due('Nov', 10, 2026), status: 'Pending', statusColor: 'blue', completed: 20, total: 48, percent: 45, logoIcon: 'Figma', avatar: 'AvatarMale04' },
    { nodeId: '33160:10079', title: 'Atica Banking', dueDate: due('Jun', 20, 2026), status: 'In Progress', statusColor: 'purple', completed: 35, total: 49, percent: 66, logoIcon: 'Github', avatar: 'AvatarAbstract02' },
    { nodeId: '33160:10080', title: 'Coffee detail page', dueDate: due('Jun', 24, 2026), status: 'Rejected', statusColor: 'gray', completed: 2, total: 12, percent: 10, logoIcon: 'PriorityMedium', avatar: 'Avatar3d03' },
  ];

  var CHIP_CLASS = {
    purple: 'purple',
    green: 'green',
    blue: 'blue',
    gray: 'muted',
    orange: 'orange',
  };

  var STRIP_CLASS = {
    purple: 'purple',
    green: 'green',
    blue: 'blue',
    gray: 'muted',
    orange: 'orange',
    yellow: 'yellow',
  };

  var state = {
    container: null,
    viewMode: 'grid',
  };

  function cardApi() {
    return window.TMACard;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function loadViewMode() {
    try {
      var saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'card') saved = 'grid';
      if (saved === 'list' || saved === 'grid') state.viewMode = saved;
    } catch (e) { /* ignore */ }
  }

  function saveViewMode() {
    try { localStorage.setItem(VIEW_KEY, state.viewMode); } catch (e) { /* ignore */ }
  }

  function renderStats() {
    var C = cardApi();
    if (!C) return '';
    return STATS.map(function (stat) { return C.renderStatCard(stat); }).join('');
  }

  function renderCardGrid() {
    var C = cardApi();
    if (!C) return '';
    return PROJECTS.map(function (project) { return C.renderProgressCard(project); }).join('');
  }

  function renderAssignees(project) {
    var html = '<div class="tma-dash__avatars tma-dash__avatars--project">';
    if (project.avatarGroup) {
      project.avatarGroup.slice(0, 2).forEach(function (key) {
        html += '<img class="tma-dash__avatar tma-dash__avatar--28" src="images/avatars/' + escapeHtml(key) + '.png" alt="">';
      });
      if (project.avatarGroup[2] != null) {
        html += '<span class="tma-dash__avatar tma-dash__avatar--28 tma-dash__avatar--more">+' + project.avatarGroup[2] + '</span>';
      }
    } else if (project.avatar) {
      html += '<img class="tma-dash__avatar tma-dash__avatar--28" src="images/avatars/' + escapeHtml(project.avatar) + '.png" alt="">';
    }
    html += '</div>';
    return html;
  }

  function renderListLogo(project) {
    var src = (window.TMACard && window.TMACard.brandLogoSrc)
      ? window.TMACard.brandLogoSrc(project.logoIcon)
      : 'images/icons/brands/' + (project.logoIcon || 'Figma') + '40.svg';
    return '<img class="tma-dash__projects-list-logo" src="' + escapeHtml(src) + '" alt="" width="40" height="40">';
  }

  function renderListRow(project) {
    var chipCls = CHIP_CLASS[project.statusColor] || 'purple';
    var stripCls = STRIP_CLASS[project.stripColor || project.statusColor] || 'purple';
    var percent = project.percent != null ? project.percent : 0;

    return '' +
      '<article class="tma-dash__projects-list-row">' +
        renderListLogo(project) +
        '<div class="tma-dash__projects-list-copy">' +
          '<p class="tma-dash__projects-list-title">' + escapeHtml(project.title) + '</p>' +
          '<p class="tma-dash__projects-list-date">' + escapeHtml(project.dueDate) + '</p>' +
        '</div>' +
        renderAssignees(project) +
        '<span class="tma-dash__chip tma-dash__chip--' + chipCls + '">' +
          '<span class="tma-dash__chip-dot" aria-hidden="true"></span>' +
          escapeHtml(project.status) +
        '</span>' +
        '<div class="tma-dash__projects-list-progress" aria-hidden="true">' +
          '<div class="tma-dash__projects-list-progress-fill tma-dash__projects-list-progress-fill--' + stripCls + '" style="width:' + percent + '%"></div>' +
        '</div>' +
        '<p class="tma-dash__projects-list-tasks">' +
          '<span class="tma-dash__projects-list-tasks-done">' + project.completed + '</span>' +
          '<span class="tma-dash__projects-list-tasks-sep"> / </span>' +
          '<span class="tma-dash__projects-list-tasks-total">' + project.total + '</span>' +
        '</p>' +
        '<span class="tma-dash__projects-list-pct">' + percent + '%</span>' +
      '</article>';
  }

  function renderList() {
    return '<div class="tma-dash__projects-list">' + PROJECTS.map(renderListRow).join('') + '</div>';
  }

  function renderContent() {
    if (state.viewMode === 'list') {
      return '' +
        '<div class="tma-dash__projects-stats">' + renderStats() + '</div>' +
        '<div class="tma-dash__projects-body tma-dash__projects-body--list">' + renderList() + '</div>';
    }
    return '<div class="tma-dash__projects-grid">' + renderStats() + renderCardGrid() + '</div>';
  }

  function render() {
    if (!state.container) return;
    state.container.innerHTML = renderContent();
    if (window.TMATableViewToggle) window.TMATableViewToggle.sync('projects');
  }

  function mount(container) {
    if (!container) return;
    loadViewMode();
    state.container = container;
    container.className = 'tma-dash__projects';
    render();

    if (window.TMATableViewToggle) {
      window.TMATableViewToggle.register('projects', {
        getViewMode: function () { return state.viewMode; },
        setViewMode: function (mode) {
          state.viewMode = mode === 'list' ? 'list' : 'grid';
          saveViewMode();
        },
        render: render,
      });
    }
  }

  window.TMAProjects = { mount: mount };
})();
