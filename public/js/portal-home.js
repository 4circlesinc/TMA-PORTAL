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
    return 'images/icons/phosphor/File.svg';
  }

  var SHORTCUTS = [
    { id: 'email', label: 'Email', icon: 'EnvelopeSimple', count: 'email', nav: { navId: 'email', view: 'email', title: 'Email', crumb: 'Email' } },
    { id: 'calendar', label: 'Calendar', icon: 'CalendarBlank', count: 'calendar', nav: { navId: 'calendar', view: 'calendar', title: 'Calendar', crumb: 'Calendar' } },
    { id: 'users', label: 'Users', icon: 'Users', count: 'users', nav: { navId: 'users', view: 'users', title: 'Users', crumb: 'Users' } },
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
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/' + iconName + '.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">' + ui().esc(value) + '</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">' + ui().esc(delta) + '</span>' +
      '<img src="images/icons/tma/' + (deltaUp ? 'ArrowRise' : 'ArrowFall') + '.svg" alt="' + (deltaUp ? 'up' : 'down') + '"></div></div></article>';
  }

  function kpiSkeletonCard(tone) {
    return '<article class="tma-dash__card tma-dash__card--' + tone + '" aria-hidden="true">' +
      '<div class="tma-dash__card-head"><span class="tma-skeleton tma-skeleton--text" style="width:55%"></span></div>' +
      '<div class="tma-dash__card-row"><span class="tma-skeleton tma-dash__card-value--skeleton"></span>' +
      '<span class="tma-skeleton tma-dash__card-delta--skeleton"></span></div></article>';
  }

  function renderKpis(s) {
    if (!homeFilesLoaded) {
      return '<div class="tma-dash__cards" aria-busy="true">' +
        kpiSkeletonCard('blue') + kpiSkeletonCard('purple') + kpiSkeletonCard('blue') + kpiSkeletonCard('purple') +
        '</div>';
    }
    var activeProjects = s.projects.filter(function (p) { return p.status === 'open'; }).length;
    var sigLeft = Math.max(0, s.trial.signatureLimit - s.trial.signatureUsed);
    return '<div class="tma-dash__cards">' +
      kpiCard('blue', 'Avg. Client Response', 'ClockCountdown', '3h 24m', '-12.4%', false) +
      kpiCard('purple', 'Files Shared', 'Share', '128', '+11.02%', true) +
      kpiCard('blue', 'Active Projects', 'Kanban', String(activeProjects), activeProjects ? '+' + activeProjects + ' new' : '-', true) +
      kpiCard('purple', 'Signature Requests Left', 'Signature', String(sigLeft), s.trial.active ? 'Trial' : 'Plan', true) +
      '</div>';
  }

  // Real Recent Files + Favorites are fetched on mount; until they arrive we
  // show shimmering skeletons rather than empty or placeholder rows.
  var homeFilesLoaded = false;

  // Folder icon for folders; the real server thumbnail for images (falling back
  // to the file-type icon if it can't be produced); the type icon otherwise.
  function rowIconHtml(f) {
    if (f.kind === 'folder') {
      return '<img src="images/icons/phosphor/FolderFilled.svg" alt="">';
    }
    if (f.thumbUrl) {
      return '<img class="tma-portal-file-row__thumb" src="' + ui().esc(f.thumbUrl) + '" alt="" loading="lazy"' +
        ' onerror="this.onerror=null;this.classList.remove(\'tma-portal-file-row__thumb\');this.src=\'' + ui().esc(fileIconSrc(f)) + '\'">';
    }
    return '<img src="' + ui().esc(fileIconSrc(f)) + '" alt="">';
  }

  function skeletonFileRows(n) {
    var row = '<div class="tma-portal-file-row tma-portal-file-row--skeleton" aria-hidden="true">' +
      '<span class="tma-skeleton tma-skeleton--icon"></span>' +
      '<span class="tma-portal-file-row__meta" style="flex:1">' +
      '<span class="tma-skeleton tma-skeleton--text" style="width:58%"></span>' +
      '<span class="tma-skeleton tma-skeleton--text" style="width:34%;margin-top:6px"></span>' +
      '</span></div>';
    return new Array(n).fill(row).join('');
  }

  function renderRecentFiles(s) {
    if (!homeFilesLoaded) {
      return '<section class="tma-portal-panel" aria-label="Recent files" aria-busy="true">' +
        '<h2 class="tma-portal-panel__title">Recent Files</h2>' + skeletonFileRows(3) + '</section>';
    }
    var rows = s.recentFiles.map(function (f) {
      return '<button type="button" class="tma-portal-file-row" data-home-file="' + ui().esc(f.id) + '"' +
        (f.folderId ? ' data-home-file-folder="' + ui().esc(f.folderId) + '"' : '') + '>' +
        rowIconHtml(f) +
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
    if (!homeFilesLoaded) {
      var tile = '<div class="tma-portal-shortcut tma-portal-shortcut--skeleton" aria-hidden="true">' +
        '<span class="tma-skeleton" style="width:44px;height:44px;border-radius:var(--radius-12)"></span>' +
        '<span class="tma-skeleton tma-skeleton--text" style="width:70%;height:11px"></span></div>';
      return '<section class="tma-portal-panel" aria-label="Shortcuts" aria-busy="true">' +
        '<h2 class="tma-portal-panel__title">Shortcuts</h2>' +
        '<div class="tma-portal-shortcuts">' + new Array(8).fill(tile).join('') + '</div></section>';
    }
    return '<section class="tma-portal-panel" aria-label="Shortcuts">' +
      '<h2 class="tma-portal-panel__title">Shortcuts</h2>' +
      '<div class="tma-portal-shortcuts">' +
      SHORTCUTS.map(function (sc) {
        return '<button type="button" class="tma-portal-shortcut" data-home-shortcut="' + sc.id + '">' +
          '<span class="tma-portal-shortcut__icon"><img src="images/icons/phosphor/' + sc.icon + '.svg" alt="">' +
          (sc.count ? '<span class="tma-portal-shortcut__count" data-home-shortcut-count="' + sc.count + '" hidden></span>' : '') +
          '</span>' +
          '<span>' + ui().esc(sc.label) + '</span></button>';
      }).join('') +
      '</div></section>';
  }

  function renderTutorials(s) {
    if (!homeFilesLoaded) {
      return '<section class="tma-portal-panel" aria-label="Tutorials" aria-busy="true">' +
        '<h2 class="tma-portal-panel__title">Tutorials</h2>' + skeletonFileRows(4) + '</section>';
    }
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
          '<span class="tma-portal-tutorial__check">' + (t.done ? '<img src="images/icons/phosphor/Check.svg" alt="" width="12" height="12">' : '') + '</span>' +
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
      s.dashboardTiles = { recentFiles: true, shortcuts: true, tutorials: false, favorites: true };
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
    if (!homeFilesLoaded) {
      return '<section class="tma-portal-panel" aria-label="Favorites" aria-busy="true">' +
        '<h2 class="tma-portal-panel__title">Favorites</h2>' +
        '<p class="tma-portal-panel__note">Mark certain files or folders as Favorite and have a shortcut to them.</p>' +
        skeletonFileRows(2) + '</section>';
    }
    var favs = (s.folders && s.folders.favorites) || [];
    var rows = favs.map(function (f) {
      return '<button type="button" class="tma-portal-file-row" data-home-favorite="' + ui().esc(f.id) + '"' +
        ' data-home-favorite-kind="' + ui().esc(f.kind) + '"' +
        (f.folderId ? ' data-home-favorite-folder="' + ui().esc(f.folderId) + '"' : '') + '>' +
        rowIconHtml(f) +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + ui().esc(f.name) + '</span>' +
        (f.path ? '<span class="tma-portal-file-row__path">' + ui().esc(f.path) + '</span>' : '') +
        '</span></button>';
    }).join('');
    return '<section class="tma-portal-panel" aria-label="Favorites">' +
      '<h2 class="tma-portal-panel__title">Favorites</h2>' +
      '<p class="tma-portal-panel__note">Mark certain files or folders as Favorite and have a shortcut to them.</p>' +
      (rows || '<p class="tma-portal-panel__note">No favorites yet.</p>') +
      '</section>';
  }

  /* Real data for the Recent Files + Favorites widgets, from the File Library
   * browse API (the same endpoints the file manager uses). Falls back quietly
   * to whatever is in state if the request fails. */
  function loadHomeFiles(el) {
    var net = window.TMAFilesNet;
    if (!net) { homeFilesLoaded = true; return; }

    // Drop any stale, localStorage-persisted mock immediately: Recent Files and
    // Favorites are server-owned, so old cached values must never render. They
    // are refilled from the API below (or left empty if it fails).
    var s0 = data().state();
    s0.recentFiles = [];
    s0.folders = s0.folders || {};
    s0.folders.favorites = [];

    // If the fetch stalls (slow single-threaded dev server), stop showing the
    // skeleton after a while and fall back to the empty state. The real data is
    // still applied whenever it eventually arrives.
    var giveUp = setTimeout(function () {
      if (homeFilesLoaded) return;
      homeFilesLoaded = true;
      if (el.isConnected) mount(el, { fromLoad: true });
    }, 12000);

    Promise.all([
      net.fetchJSON(net.url('/?section=recent&perPage=6')).catch(function () { return null; }),
      net.fetchJSON(net.url('/?section=favorites&perPage=8')).catch(function () { return null; }),
    ]).then(function (res) {
      clearTimeout(giveUp);
      homeFilesLoaded = true;
      var s = data().state();

      // Always assign — a failed fetch yields an empty list, never stale data.
      s.recentFiles = (res[0] && res[0].files) ? res[0].files.map(function (f) {
        return {
          kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
          folderId: f.folder && f.folder.id, path: (f.folder && f.folder.name) || 'File Box',
        };
      }) : [];

      var favFolders = (res[1] && res[1].folders || []).map(function (f) {
        return { kind: 'folder', id: f.id, name: f.name, path: (f.parent && f.parent.name) || 'Folders' };
      });
      var favFiles = (res[1] && res[1].files || []).map(function (f) {
        return {
          kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
          folderId: f.folder && f.folder.id, path: (f.folder && f.folder.name) || 'File Box',
        };
      });
      s.folders = s.folders || {};
      s.folders.favorites = favFolders.concat(favFiles);

      if (el.isConnected) mount(el, { fromLoad: true });
    });
  }

  // Email/Calendar are placeholder counts (no backend yet); Users is the real
  // pending-approvals count.
  function fillShortcutCounts(el) {
    function setCount(kind, n) {
      el.querySelectorAll('[data-home-shortcut-count="' + kind + '"]').forEach(function (b) {
        if (n && n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
        else { b.hidden = true; b.textContent = ''; }
      });
    }
    var email = (window.TMAEmail && window.TMAEmail.getInboxUnreadCount) ? window.TMAEmail.getInboxUnreadCount(null) : 0;
    var cal = (window.TMACalendar && window.TMACalendar.getTodayEventCount) ? window.TMACalendar.getTodayEventCount() : 0;
    setCount('email', email || 4);
    setCount('calendar', cal || 2);
    fetch('/admin/users/pending-count', { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.ok ? r.json() : { count: 0 }; })
      .then(function (j) { setCount('users', (j && j.count) || 0); })
      .catch(function () {});
  }

  function mount(el, opts) {
    opts = opts || {};
    var s = data().state();
    var show = tiles();
    function rerender() { mount(el); }

    el.innerHTML =
      '<div class="tma-portal-page" data-node-id="portal-home">' +
      '<div class="tma-portal-hello">' +
      '<div class="tma-portal-hello__main">' +
      '<img class="tma-portal-hello__avatar tma-skeleton tma-skeleton--avatar" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">' +
      '<div class="tma-portal-hello__copy">' +
      '<h2 class="tma-portal-hello__title tma-skeleton tma-skeleton--text"></h2>' +
      '<button type="button" class="tma-portal-link tma-portal-hello__picture-link" data-home-add-picture>Add profile picture</button>' +
      '</div></div>' +
      '<div class="tma-portal-hello__actions">' +
      ui().btn({ label: 'Edit Dashboard', icon: 'SquaresFour', variant: 'ghost', small: true, attrs: 'data-home-edit' }) +
      '</div></div>' +
      renderKpis(s) +
      // Everything below the KPI row lives in one 2-column grid so no panel
      // (including "What's on the road?") ever spans the full width.
      '<div class="tma-portal-home-grid">' +
      (show.recentFiles ? renderRecentFiles(s) : '') +
      (show.shortcuts ? renderShortcuts() : '') +
      (show.favorites ? renderFavorites(s) : '') +
      (show.tutorials ? renderTutorials(s) : '') +
      (window.TMAOverview && window.TMAOverview.renderRoad ? window.TMAOverview.renderRoad() : '') +
      '</div>' +
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
        // Open the file's own folder; fall back to the File Box when it has none.
        var folderId = b.getAttribute('data-home-file-folder');
        navigate(folderId
          ? { navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: folderId }
          : { navId: 'folders-filebox', view: 'folders', title: 'File Box', crumb: 'Folders / File Box' });
      });
    });

    el.querySelectorAll('[data-home-favorite]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-home-favorite-kind');
        if (kind === 'folder') {
          // Open the favorited folder itself.
          navigate({ navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: b.getAttribute('data-home-favorite') });
        } else {
          // Open the file's folder, or fall back to the Favorites section.
          var folderId = b.getAttribute('data-home-favorite-folder');
          navigate(folderId
            ? { navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: folderId }
            : { navId: 'folders-favorites', view: 'folders', title: 'Favorites', crumb: 'Folders / Favorites' });
        }
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

    /* the picker is owned by current-user.js (delegated click) */
    if (window.TMACurrentUser) {
      var meNow = window.TMACurrentUser.get();
      if (meNow) {
        var hello = el.querySelector('.tma-portal-hello__title');
        if (hello) hello.textContent = 'Hello ' + meNow.firstName;
        var heroAvatar = el.querySelector('.tma-portal-hello__avatar');
        if (heroAvatar) heroAvatar.src = window.TMACurrentUser.avatarSrc(meNow.avatar, meNow.name);
        var picLink = el.querySelector('[data-home-add-picture]');
        if (picLink) picLink.textContent = meNow.hasAvatar ? 'Change profile picture' : 'Add profile picture';
      }
    }

    var edit = el.querySelector('[data-home-edit]');
    if (edit) edit.addEventListener('click', function () { editDashboardModal(rerender); });

    fillShortcutCounts(el);
    // Fetch real Recent Files + Favorites once per genuine mount (not on the
    // re-render the fetch itself triggers).
    if (!opts.fromLoad) loadHomeFiles(el);
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('dashboard', mount);
})();
