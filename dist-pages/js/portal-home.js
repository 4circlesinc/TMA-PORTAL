/*
 * TMA - Portal Dashboard (home) view
 * Greeting, KPI cards (reuses tma-dash__card recipe), Recent Files,
 * Shortcuts, and Getting Started tutorials.
 * Registers view: 'dashboard' in TMAPortalViews.
 */
(function () {
  'use strict';

  var UI = null;
  var D = null;

  function ui() { return UI || (UI = window.TMAPortalUI); }
  function data() { return D || (D = window.TMAPortalData); }

  function fileIconSrc(f) {
    if (window.TMAFileIcons) {
      return window.TMAFileIcons.fileIconFromFilename(f.name) ||
        window.TMAFileIcons.fileIconFromFilename('x.' + (f.type || '')) ||
        window.TMAFileIcons.fileIconSrc('DefaultIcon');
    }
    return '/TMA-PORTAL/images/icons/phosphor/File.svg';
  }

  var SHORTCUTS = [
    { id: 'share-files', label: 'Share Files', icon: 'Share' },
    { id: 'request-files', label: 'Request Files', icon: 'DownloadSimple' },
    { id: 'new-user-folders', label: 'Create New User Personal Folders', icon: 'UserPlus' },
    { id: 'shared-folders', label: 'Shared Folders', icon: 'FolderSimpleUser', nav: { navId: 'folders-shared', view: 'folders', title: 'Shared Folders', crumb: 'Folders / Shared Folders' } },
    { id: 'favorites', label: 'Favorites', icon: 'Star', nav: { navId: 'folders-favorites', view: 'folders', title: 'Favorites', crumb: 'Folders / Favorites' } },
    { id: 'feedback-approval', label: 'Feedback and Approval', icon: 'Checks', nav: { navId: 'workflows-feedback', view: 'workflows', title: 'Feedback and Approval', crumb: 'Workflows / Feedback and Approval' } },
    { id: 'send-signature', label: 'Send for Signature', icon: 'Signature', nav: { navId: 'signatures', view: 'signatures', title: 'Signature requests', crumb: 'Signatures' } },
    { id: 'create-template', label: 'Create Document Template', icon: 'Table', nav: { navId: 'templates', view: 'templates', title: 'Templates', crumb: 'Templates' } },
    { id: 'projects', label: 'Projects', icon: 'Kanban', nav: { navId: 'projects-all', view: 'projects-hub', title: 'Projects', crumb: 'Projects / All Projects' } },
  ];

  function navigate(nav) {
    if (window.TMADashboard && window.TMADashboard.navigate) {
      window.TMADashboard.navigate(nav);
    }
  }

  function kpiCard(tone, label, iconName, value, delta, deltaUp) {
    return '<article class="tma-dash__card tma-dash__card--' + tone + '">' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">' + ui().esc(label) + '</span>' +
      '<img class="tma-dash__card-ico" src="/TMA-PORTAL/images/icons/phosphor/' + iconName + '.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">' + ui().esc(value) + '</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">' + ui().esc(delta) + '</span>' +
      '<img src="/TMA-PORTAL/images/icons/tma/' + (deltaUp ? 'ArrowRise' : 'ArrowFall') + '.svg" alt="' + (deltaUp ? 'up' : 'down') + '"></div></div></article>';
  }

  function renderKpis(s) {
    var activeProjects = s.projects.filter(function (p) { return p.status === 'open'; }).length;
    var sigLeft = Math.max(0, s.trial.signatureLimit - s.trial.signatureUsed);
    return '<div class="tma-dash__cards">' +
      kpiCard('blue', 'Avg. Client Response', 'ClockCountdown', '3h 24m', '-12.4%', false) +
      kpiCard('purple', 'Files Shared', 'Share', '128', '+11.02%', true) +
      kpiCard('blue', 'Active Projects', 'Kanban', String(activeProjects), activeProjects ? '+' + activeProjects + ' new' : '-', true) +
      kpiCard('purple', 'Signature Requests Left', 'Signature', String(sigLeft), s.trial.active ? 'Trial' : 'Plan', true) +
      '</div>';
  }

  function renderRecentFiles(s) {
    var rows = s.recentFiles.map(function (f) {
      return '<button type="button" class="tma-portal-file-row" data-home-file="' + ui().esc(f.id) + '">' +
        '<img src="' + ui().esc(fileIconSrc(f)) + '" alt="">' +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + ui().esc(f.name) + '</span>' +
        '<span class="tma-portal-file-row__path">' + ui().esc(f.path) + '</span>' +
        '</span></button>';
    }).join('');
    return '<section class="tma-portal-panel" aria-label="Recent files">' +
      '<h2 class="tma-portal-panel__title">Recent Files</h2>' +
      (rows || '<p class="tma-portal-panel__note">No recent files yet.</p>') +
      '</section>';
  }

  function renderShortcuts() {
    return '<section class="tma-portal-panel" aria-label="Shortcuts">' +
      '<h2 class="tma-portal-panel__title">Shortcuts</h2>' +
      '<div class="tma-portal-shortcuts">' +
      SHORTCUTS.map(function (sc) {
        return '<button type="button" class="tma-portal-shortcut" data-home-shortcut="' + sc.id + '">' +
          '<span class="tma-portal-shortcut__icon"><img src="/TMA-PORTAL/images/icons/phosphor/' + sc.icon + '.svg" alt=""></span>' +
          '<span>' + ui().esc(sc.label) + '</span></button>';
      }).join('') +
      '</div></section>';
  }

  function renderTutorials(s) {
    var done = s.tutorials.filter(function (t) { return t.done; }).length;
    return '<section class="tma-portal-panel" aria-label="Tutorials">' +
      '<div class="tma-portal-head" style="gap:var(--space-8)">' +
      '<h2 class="tma-portal-panel__title">Tutorials</h2>' +
      ui().select(['Getting Started'], 'Getting Started', 'data-home-tutorial-set', 'Tutorial set') +
      '</div>' +
      '<p class="tma-portal-panel__note">' + done + ' of ' + s.tutorials.length + ' completed</p>' +
      '<div class="tma-portal-tutorials">' +
      s.tutorials.map(function (t) {
        return '<button type="button" class="tma-portal-tutorial' + (t.done ? ' is-done' : '') + ' tma-portal-file-row" data-home-tutorial="' + ui().esc(t.id) + '" aria-pressed="' + t.done + '">' +
          '<span class="tma-portal-tutorial__check">' + (t.done ? '<img src="/TMA-PORTAL/images/icons/phosphor/Check.svg" alt="" width="12" height="12">' : '') + '</span>' +
          '<span class="tma-portal-tutorial__label">' + ui().esc(t.label) + '</span>' +
          '</button>';
      }).join('') +
      '</div></section>';
  }

  function shareFilesModal(kind) {
    var s = data().state();
    var isShare = kind === 'share';
    ui().openModal({
      title: isShare ? 'Share Files' : 'Request Files',
      body:
        ui().field('To (email address)', ui().input({ type: 'email', placeholder: 'client@example.com', attrs: 'data-home-share-to' })) +
        ui().field('Subject', ui().input({ placeholder: isShare ? 'Files shared with you' : 'Please upload your files', attrs: 'data-home-share-subject' })) +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Message</span>' +
        '<textarea class="tma-portal-textarea" data-home-share-msg placeholder="Add a note (optional)"></textarea></div>' +
        (isShare
          ? '<div class="tma-portal-field"><span class="tma-portal-field__label">Files</span>' +
            s.recentFiles.map(function (f) {
              return '<label class="tma-portal-checkbox"><input type="checkbox" data-home-share-file value="' + ui().esc(f.id) + '"><span>' + ui().esc(f.name) + '</span></label>';
            }).join('') + '</div>'
          : '<p>The recipient gets a secure upload link. Uploads land in your File Box and you are notified by email.</p>') +
        '<div class="tma-portal-form-actions">' +
        ui().btn({ label: isShare ? 'Share' : 'Send Request', attrs: 'data-home-share-send' }) +
        '</div>',
      onMount: function (host) {
        host.querySelector('[data-home-share-send]').addEventListener('click', function () {
          var to = host.querySelector('[data-home-share-to]').value.trim();
          if (!to) { host.querySelector('[data-home-share-to]').focus(); return; }
          data().logNotification((isShare ? 'Files shared with ' : 'File request sent to ') + to, to);
          data().logBackgroundOp(isShare ? 'Share files (' + to + ')' : 'Request files (' + to + ')');
          ui().closeModal();
          ui().toast(isShare ? 'Files shared' : 'File request sent');
        });
      },
    });
  }

  function newUserFoldersModal(rerender) {
    ui().openModal({
      title: 'Create New User Personal Folders',
      body:
        '<p>Creates an employee account with its own personal folders.</p>' +
        ui().field('First name', ui().input({ attrs: 'data-home-nu-first' })) +
        ui().field('Last name', ui().input({ attrs: 'data-home-nu-last' })) +
        ui().field('Email address', ui().input({ type: 'email', attrs: 'data-home-nu-email' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-home-nu-create' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-home-nu-create]').addEventListener('click', function () {
          var s = data().state();
          var first = host.querySelector('[data-home-nu-first]').value.trim();
          var last = host.querySelector('[data-home-nu-last]').value.trim();
          var email = host.querySelector('[data-home-nu-email]').value.trim();
          if (!first || !email) { host.querySelector(first ? '[data-home-nu-email]' : '[data-home-nu-first]').focus(); return; }
          if (s.employees.length >= s.trial.employeeLimit) {
            ui().closeModal();
            ui().toast('Employee limit reached - upgrade to add more users');
            return;
          }
          s.employees.push({
            id: data().uid('emp'), firstName: first, lastName: last, email: email,
            company: s.branding.accountName, lastLogin: '-', admin: false,
          });
          s.folders.personal.push({ id: data().uid('folder'), name: first + ' ' + last, kind: 'folder', items: 0, created: data().shortDate() });
          data().save();
          data().logNotification('Welcome email sent to ' + email, email);
          ui().closeModal();
          ui().toast('User personal folders created');
          rerender();
        });
      },
    });
  }

  var DASH_TILES = [
    { id: 'recentFiles', label: 'Recent Files', desc: 'Files you last accessed across all of your devices.', preview: 'files' },
    { id: 'shortcuts', label: 'Shortcuts', desc: 'Frequently used actions, as well as quick access to certain folders.', preview: 'shortcuts' },
    { id: 'tutorials', label: 'Tutorials', desc: 'Videos and helpful articles that will help you get the best out of the portal.', preview: 'tutorials' },
    { id: 'favorites', label: 'Favorites', desc: 'Mark certain files or folders as Favorite and have a shortcut to them.', preview: 'favorites' },
  ];

  function tiles() {
    var s = data().state();
    if (!s.dashboardTiles) {
      s.dashboardTiles = { recentFiles: true, shortcuts: true, tutorials: false, favorites: false };
      data().save();
    }
    return s.dashboardTiles;
  }

  function tilePreview(kind) {
    var inner = '';
    if (kind === 'files' || kind === 'favorites') {
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>';
      for (var i = 0; i < 4; i++) {
        inner += '<span class="tma-portal-tilerow__preview-line">' +
          '<span class="tma-portal-tilerow__preview-dot' + (kind === 'favorites' ? ' tma-portal-tilerow__preview-dot--star' : '') + '"></span>' +
          '<span class="tma-portal-tilerow__preview-bar"></span></span>';
      }
    } else if (kind === 'shortcuts') {
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>' +
        '<span class="tma-portal-tilerow__preview-grid">' +
        new Array(8 + 1).join('<span class="tma-portal-tilerow__preview-circle"></span>') +
        '</span>';
    } else {
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>' +
        '<span class="tma-portal-tilerow__preview-grid tma-portal-tilerow__preview-grid--wide">' +
        new Array(3 + 1).join('<span class="tma-portal-tilerow__preview-box"></span>') +
        '</span>';
    }
    return '<span class="tma-portal-tilerow__preview" aria-hidden="true">' + inner + '</span>';
  }

  function editDashboardModal(rerender) {
    var current = tiles();
    var draft = {};
    Object.keys(current).forEach(function (k) { draft[k] = !!current[k]; });

    ui().openModal({
      title: 'Edit Dashboard',
      body:
        '<p>Choose the tiles that you would like to display on your dashboard.</p>' +
        '<div class="tma-portal-tilerows">' +
        DASH_TILES.map(function (t) {
          return '<div class="tma-portal-tilerow">' +
            tilePreview(t.preview) +
            '<div class="tma-portal-tilerow__meta">' +
            '<span class="tma-portal-tilerow__label">' + ui().esc(t.label) + '</span>' +
            '<span class="tma-portal-tilerow__desc">' + ui().esc(t.desc) + '</span>' +
            '</div>' +
            ui().toggle(!!draft[t.id], 'data-home-tile="' + t.id + '"', 'Show ' + t.label) +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
        ui().btn({ label: 'Save', attrs: ' data-home-tiles-save', disabled: true }) +
        ui().btn({ label: 'Cancel', variant: 'ghost', attrs: ' data-portal-modal-close' }) +
        '</div>',
      onMount: function (host) {
        var saveBtn = host.querySelector('[data-home-tiles-save]');

        function dirty() {
          return Object.keys(draft).some(function (k) { return !!draft[k] !== !!current[k]; });
        }

        host.querySelectorAll('[data-home-tile]').forEach(function (input) {
          input.addEventListener('change', function () {
            draft[input.getAttribute('data-home-tile')] = input.checked;
            saveBtn.disabled = !dirty();
          });
        });

        saveBtn.addEventListener('click', function () {
          var s = data().state();
          s.dashboardTiles = draft;
          data().save();
          ui().closeModal();
          ui().toast('Dashboard updated');
          rerender();
        });
      },
    });
  }

  function renderFavorites(s) {
    var favs = (s.folders && s.folders.favorites) || [];
    var rows = favs.map(function (f) {
      return '<div class="tma-portal-file-row">' +
        '<img src="/TMA-PORTAL/images/icons/phosphor/Star.svg" alt="">' +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + ui().esc(f.name) + '</span>' +
        '</span></div>';
    }).join('');
    return '<section class="tma-portal-panel" aria-label="Favorites">' +
      '<h2 class="tma-portal-panel__title">Favorites</h2>' +
      '<p class="tma-portal-panel__note">Mark certain files or folders as Favorite and have a shortcut to them.</p>' +
      (rows || '<p class="tma-portal-panel__note">No favorites yet.</p>') +
      '</section>';
  }

  function mount(el) {
    var s = data().state();
    var show = tiles();
    function rerender() { mount(el); }

    el.innerHTML =
      '<div class="tma-portal-page" data-node-id="portal-home">' +
      '<div class="tma-portal-hello">' +
      '<div class="tma-portal-hello__main">' +
      '<img class="tma-portal-hello__avatar" src="/TMA-PORTAL/images/avatars/AvatarByewind.png" alt="">' +
      '<div class="tma-portal-hello__copy">' +
      '<h2 class="tma-portal-hello__title">Hello ' + ui().esc(s.user.firstName) + '</h2>' +
      '<button type="button" class="tma-portal-link tma-portal-hello__picture-link" data-home-add-picture>Add profile picture</button>' +
      '</div></div>' +
      '<div class="tma-portal-hello__actions">' +
      ui().btn({ label: 'Edit Dashboard', icon: 'SquaresFour', variant: 'ghost', small: true, attrs: 'data-home-edit' }) +
      '</div></div>' +
      renderKpis(s) +
      ((show.recentFiles || show.shortcuts || show.favorites || show.tutorials)
        ? '<div class="tma-portal-home-grid">' +
          (show.recentFiles ? renderRecentFiles(s) : '') +
          (show.shortcuts ? renderShortcuts() : '') +
          (show.favorites ? renderFavorites(s) : '') +
          (show.tutorials ? renderTutorials(s) : '') +
          '</div>'
        : '') +
      (window.TMAOverview && window.TMAOverview.renderRoad ? window.TMAOverview.renderRoad() : '') +
      '</div>';

    el.querySelectorAll('.tma-dash__overview-day').forEach(function (day) {
      day.addEventListener('click', function () {
        el.querySelectorAll('.tma-dash__overview-day').forEach(function (d) {
          d.classList.remove('tma-dash__overview-day--active');
        });
        day.classList.add('tma-dash__overview-day--active');
      });
    });

    el.querySelectorAll('[data-home-shortcut]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-home-shortcut');
        var sc = SHORTCUTS.filter(function (x) { return x.id === id; })[0];
        if (!sc) return;
        if (sc.nav) { navigate(sc.nav); return; }
        if (id === 'share-files') shareFilesModal('share');
        if (id === 'request-files') shareFilesModal('request');
        if (id === 'new-user-folders') newUserFoldersModal(rerender);
      });
    });

    el.querySelectorAll('[data-home-file]').forEach(function (b) {
      b.addEventListener('click', function () {
        navigate({ navId: 'folders-personal', view: 'folders', title: 'Personal Folders', crumb: 'Folders / Personal Folders' });
      });
    });

    el.querySelectorAll('[data-home-tutorial]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = s.tutorials.filter(function (x) { return x.id === b.getAttribute('data-home-tutorial'); })[0];
        if (!t) return;
        t.done = !t.done;
        data().save();
        rerender();
      });
    });

    var addPic = el.querySelector('[data-home-add-picture]');
    if (addPic) addPic.addEventListener('click', function () { ui().toast('Profile pictures can be changed in Settings'); });

    var edit = el.querySelector('[data-home-edit]');
    if (edit) edit.addEventListener('click', function () { editDashboardModal(rerender); });
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('dashboard', mount);
})();
