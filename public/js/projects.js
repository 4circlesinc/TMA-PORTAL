/*
 * TMA - My Projects page ( /projects ) - Figma 32546:96122
 * Uses TMACard + shared dashboard list/grid toggle (TMATableViewToggle).
 * Global: window.TMAProjects
 */
(function () {
  'use strict';

  var VIEW_KEY = 'tma.projectsViewMode.v1';

  /* Live data only — design-system sample cards are not painted as real projects. */
  var STATS = [];
  var PROJECTS = [];

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
    if (!C || !STATS.length) return '';
    return STATS.map(function (stat) { return C.renderStatCard(stat); }).join('');
  }

  function renderCardGrid() {
    var C = cardApi();
    if (!C || !PROJECTS.length) return '';
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

  function renderEmpty() {
    if (window.TMANoData && window.TMANoData.mount) {
      window.TMANoData.mount(state.container, {
        title: 'No projects yet',
        subtitle: 'Coming soon',
        itemLabel: 'Project',
        showButton: false,
        illustrationName: 'Illustration07',
      });
      return true;
    }
    state.container.innerHTML =
      '<div class="tma-dash__projects-empty">' +
        '<p class="tma-dash__projects-empty-title">No projects yet</p>' +
        '<p class="tma-dash__projects-empty-text">Coming soon</p>' +
      '</div>';
    return true;
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
    if (!PROJECTS.length && !STATS.length) {
      renderEmpty();
      if (window.TMATableViewToggle) window.TMATableViewToggle.sync('projects');
      return;
    }
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
