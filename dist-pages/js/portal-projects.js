/*
 * TMA — Portal Projects (All / Closed / Deleted)
 * Create projects (blank or from template), close, reopen, delete,
 * restore; deleted projects are retained for 45 days.
 * Registers view: 'projects-hub'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  var RECOMMENDED = ['Client Onboarding', 'HR Onboarding', 'Patient Onboarding', 'Safety Incident Report'];

  var state = { tab: 'all', el: null };

  function tabForNav(navId) {
    if (navId === 'projects-closed') return 'closed';
    if (navId === 'projects-deleted') return 'deleted';
    return 'all';
  }

  function projects(status) {
    return data().state().projects.filter(function (p) { return p.status === status; });
  }

  function createProjectModal(template) {
    ui().openModal({
      title: template ? 'New project from “' + template + '”' : 'Create Project',
      body:
        ui().field('Project name', ui().input({ placeholder: template || 'e.g. Q3 Client Onboarding', attrs: 'data-proj-name', value: template || '' })) +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Description</span>' +
        '<textarea class="tma-portal-textarea" data-proj-desc placeholder="What is this project for? (optional)"></textarea></div>' +
        ui().field('Due date', ui().input({ type: 'date', attrs: 'data-proj-due' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create Project', attrs: 'data-proj-create' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-proj-create]').addEventListener('click', function () {
          var name = host.querySelector('[data-proj-name]').value.trim();
          if (!name) { host.querySelector('[data-proj-name]').focus(); return; }
          var s = data().state();
          s.projects.unshift({
            id: data().uid('proj'),
            name: name,
            description: host.querySelector('[data-proj-desc]').value.trim(),
            due: host.querySelector('[data-proj-due]').value || '',
            template: template || '',
            status: 'open',
            createdAt: Date.now(),
            createdOn: data().shortDate(),
          });
          data().save();
          data().logBackgroundOp('Create project “' + name + '”');
          ui().closeModal();
          ui().toast('Project created');
          render();
        });
      },
    });
  }

  function templatePickerModal() {
    var tpls = data().state().templates;
    ui().openModal({
      title: 'Start from template',
      body:
        '<p>Pick a template to pre-fill your project.</p>' +
        '<div class="tma-portal-tutorials">' +
        tpls.map(function (t) {
          return '<button type="button" class="tma-portal-file-row" data-proj-tpl="' + ui().esc(t.name) + '">' +
            '<img src="/TMA-PORTAL/images/icons/phosphor/Kanban.svg" alt="">' +
            '<span class="tma-portal-file-row__meta">' +
            '<span class="tma-portal-file-row__name">' + ui().esc(t.name) + '</span>' +
            '<span class="tma-portal-file-row__path">' + ui().esc(t.description) + '</span>' +
            '</span></button>';
        }).join('') +
        '</div>',
      onMount: function (host) {
        host.querySelectorAll('[data-proj-tpl]').forEach(function (b) {
          b.addEventListener('click', function () {
            ui().closeModal();
            createProjectModal(b.getAttribute('data-proj-tpl'));
          });
        });
      },
    });
  }

  function projectRow(p, actionsHtml, metaLabel) {
    return '<tr>' +
      '<td><strong>' + ui().esc(p.name) + '</strong>' +
      (p.template ? ' <span class="tma-portal-chip">' + ui().esc(p.template) + '</span>' : '') +
      (p.description ? '<div class="tma-portal-table__muted">' + ui().esc(p.description) + '</div>' : '') + '</td>' +
      '<td class="tma-portal-table__muted">' + ui().esc(metaLabel) + '</td>' +
      '<td class="tma-portal-table__muted">' + ui().esc(p.due || '—') + '</td>' +
      '<td><div class="tma-portal-row-actions">' + actionsHtml + '</div></td>' +
      '</tr>';
  }

  function iconBtn(iconName, label, attr) {
    return '<button type="button" class="tma-portal-icon-btn" ' + attr + ' title="' + ui().esc(label) + '" aria-label="' + ui().esc(label) + '">' +
      '<img src="/TMA-PORTAL/images/icons/phosphor/' + iconName + '.svg" alt=""></button>';
  }

  function renderAll() {
    var open = projects('open');
    var head =
      '<div class="tma-portal-head">' +
      '<h2 class="tma-portal-head__title">Projects</h2>' +
      '<div class="tma-portal-head__actions">' +
      ui().btn({ label: 'Create Project', icon: 'Plus', attrs: 'data-proj-new' }) +
      ui().btn({ label: 'Start from template', icon: 'Table', variant: 'ghost', attrs: 'data-proj-from-tpl' }) +
      '</div></div>';

    if (!open.length) {
      var recommended = data().state().templates.filter(function (t) {
        return RECOMMENDED.indexOf(t.name) !== -1;
      });
      return head +
        ui().emptyState({
          illustration: 'Illustration05',
          title: 'Create your first project',
          subtitle: 'Projects help you track file-related to-dos and timelines in one place, so you and your team never miss a due date or lose sight of progress.',
          button: ui().btn({ label: 'Create Project', attrs: 'data-proj-new-hero' }) +
            ui().btn({ label: 'Start from template', variant: 'ghost', attrs: 'data-proj-from-tpl-hero' }),
        }) +
        '<p class="tma-portal-subtitle" style="text-align:center">Recommended templates</p>' +
        '<div class="tma-portal-card-grid">' +
        recommended.map(function (t) {
          return '<article class="tma-portal-tpl-card">' +
            '<div class="tma-portal-tpl-card__preview"><img src="/TMA-PORTAL/images/icons/phosphor/Kanban.svg" alt=""></div>' +
            '<h3 class="tma-portal-tpl-card__name">' + ui().esc(t.name) + '</h3>' +
            '<p class="tma-portal-tpl-card__desc">' + ui().esc(t.description) + '</p>' +
            '<div class="tma-portal-tpl-card__foot"><span class="tma-portal-chip">' + ui().esc(t.kind) + '</span>' +
            ui().btn({ label: 'Use', variant: 'ghost', small: true, attrs: 'data-proj-use-tpl="' + ui().esc(t.name) + '"' }) +
            '</div></article>';
        }).join('') +
        '</div>';
    }

    var rows = open.map(function (p) {
      return projectRow(p,
        iconBtn('ArchiveBox', 'Close project', 'data-proj-close="' + p.id + '"') +
        iconBtn('Trash', 'Delete project', 'data-proj-delete="' + p.id + '"'),
        'Created ' + p.createdOn);
    }).join('');
    return head + ui().table(['Project', 'Created', 'Due date', { html: '<span class="tma-portal-row-actions">Actions</span>' }], rows);
  }

  function renderClosed() {
    var closed = projects('closed');
    var head = '<div class="tma-portal-head"><h2 class="tma-portal-head__title">Closed</h2></div>';
    if (!closed.length) {
      return head + ui().emptyState({
        illustration: 'Illustration09',
        title: 'You don’t have any closed projects.',
        subtitle: 'Once you close a project, it will appear here.',
      });
    }
    var rows = closed.map(function (p) {
      return projectRow(p,
        iconBtn('ArrowsCounterClockwise', 'Reopen project', 'data-proj-reopen="' + p.id + '"') +
        iconBtn('Trash', 'Delete project', 'data-proj-delete="' + p.id + '"'),
        'Closed ' + (p.closedOn || '—'));
    }).join('');
    return head + ui().table(['Project', 'Closed', 'Due date', { html: '<span class="tma-portal-row-actions">Actions</span>' }], rows);
  }

  function renderDeleted() {
    data().purgeExpiredProjects();
    var deleted = projects('deleted');
    var head = '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Deleted</h2>' +
      '<p class="tma-portal-subtitle">We’ll store recently deleted projects here for ' + data().DELETED_RETENTION_DAYS + ' days.</p>' +
      '</div></div>';
    if (!deleted.length) {
      return head + ui().emptyState({
        illustration: 'Illustration12',
        title: 'No projects match your filters',
        subtitle: 'Try adjusting or clearing your filters to see more results.',
      });
    }
    var rows = deleted.map(function (p) {
      return projectRow(p,
        iconBtn('ArrowsCounterClockwise', 'Restore project', 'data-proj-restore="' + p.id + '"') +
        iconBtn('Trash', 'Delete permanently', 'data-proj-purge="' + p.id + '"'),
        'Deleted ' + (p.deletedOn || '—'));
    }).join('');
    return head + ui().table(['Project', 'Deleted', 'Due date', { html: '<span class="tma-portal-row-actions">Actions</span>' }], rows);
  }

  function setStatus(id, status) {
    var s = data().state();
    var p = s.projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    p.status = status;
    if (status === 'closed') { p.closedAt = Date.now(); p.closedOn = data().shortDate(); }
    if (status === 'deleted') { p.deletedAt = Date.now(); p.deletedOn = data().shortDate(); }
    data().save();
    render();
  }

  function purge(id) {
    var s = data().state();
    s.projects = s.projects.filter(function (x) { return x.id !== id; });
    data().save();
    render();
    ui().toast('Project permanently deleted');
  }

  function render() {
    var el = state.el;
    if (!el) return;
    var body = state.tab === 'closed' ? renderClosed() : state.tab === 'deleted' ? renderDeleted() : renderAll();
    el.innerHTML = '<div class="tma-portal-page">' + body + '</div>';

    function on(sel, fn) {
      el.querySelectorAll(sel).forEach(function (b) { b.addEventListener('click', fn); });
    }
    on('[data-proj-new], [data-proj-new-hero]', function () { createProjectModal(); });
    on('[data-proj-from-tpl], [data-proj-from-tpl-hero]', function () { templatePickerModal(); });
    el.querySelectorAll('[data-proj-use-tpl]').forEach(function (b) {
      b.addEventListener('click', function () { createProjectModal(b.getAttribute('data-proj-use-tpl')); });
    });
    el.querySelectorAll('[data-proj-close]').forEach(function (b) {
      b.addEventListener('click', function () { setStatus(b.getAttribute('data-proj-close'), 'closed'); ui().toast('Project closed'); });
    });
    el.querySelectorAll('[data-proj-reopen]').forEach(function (b) {
      b.addEventListener('click', function () { setStatus(b.getAttribute('data-proj-reopen'), 'open'); ui().toast('Project reopened'); });
    });
    el.querySelectorAll('[data-proj-delete]').forEach(function (b) {
      b.addEventListener('click', function () { setStatus(b.getAttribute('data-proj-delete'), 'deleted'); ui().toast('Project moved to Deleted'); });
    });
    el.querySelectorAll('[data-proj-restore]').forEach(function (b) {
      b.addEventListener('click', function () { setStatus(b.getAttribute('data-proj-restore'), 'open'); ui().toast('Project restored'); });
    });
    el.querySelectorAll('[data-proj-purge]').forEach(function (b) {
      b.addEventListener('click', function () { purge(b.getAttribute('data-proj-purge')); });
    });
  }

  function mount(el, opts) {
    state.el = el;
    state.tab = tabForNav(opts && opts.navId);
    render();
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('projects-hub', mount);
})();
