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
    { id: 'messages', label: 'Messages', icon: 'ChatsCircle', count: 'messages', nav: { navId: 'so-messages', view: 'messages', title: 'Messages', crumb: 'Messages' } },
    { id: 'feed', label: 'Feed', icon: 'Newspaper', count: 'feed', nav: { navId: 'so-feed', view: 'feed', title: 'Feed', crumb: 'Social / Feed' } },
    { id: 'calendar', label: 'Calendar', icon: 'CalendarBlank', count: 'calendar', nav: { navId: 'calendar', view: 'calendar', title: 'Calendar', crumb: 'Calendar' } },
    { id: 'users', label: 'Users', icon: 'Users', count: 'users', nav: { navId: 'users', view: 'users', title: 'Users', crumb: 'Users' } },
    { id: 'share-files', label: 'Share Files', icon: 'Share' },
    { id: 'request-files', label: 'Request Files', icon: 'DownloadSimple' },
    { id: 'new-user-folders', label: 'Create New User', icon: 'UserPlus' },
    { id: 'shared-folders', label: 'Shared Folders', icon: 'FolderSimpleUser', nav: { navId: 'folders-shared', view: 'folders', title: 'Shared Folders', crumb: 'Folders / Shared Folders' } },
    { id: 'favorites', label: 'Favorites', icon: 'Star', nav: { navId: 'folders-favorites', view: 'folders', title: 'Favorites', crumb: 'Folders / Favorites' } },
    { id: 'feedback-approval', label: 'Feedback and Approval', icon: 'Checks', nav: { navId: 'workflows-feedback', view: 'workflows', title: 'Feedback and Approval', crumb: 'Workflows / Feedback and Approval' } },
    { id: 'send-signature', label: 'Send for Signature', icon: 'Signature', nav: { navId: 'signatures', view: 'signatures', title: 'Signature requests', crumb: 'Signatures' } },
  ];

  function navigate(nav) {
    if (window.TMADashboard && window.TMADashboard.navigate) {
      window.TMADashboard.navigate(nav);
    }
  }

  function kpiCard(tone, label, iconName, card) {
    var deltaUp = !!card.deltaUp;
    return '<article class="tma-dash__card tma-dash__card--' + tone + '"' +
      (card.hint ? ' title="' + ui().esc(card.hint) + '"' : '') + '>' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">' + ui().esc(label) + '</span>' +
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/' + iconName + '.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">' + ui().esc(card.value) + '</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">' + ui().esc(card.delta) + '</span>' +
      '<img src="images/icons/tma/' + (deltaUp ? 'ArrowRise' : 'ArrowFall') + '.svg" alt="' + (deltaUp ? 'up' : 'down') + '"></div></div></article>';
  }

  function kpiSkeletonCard(tone) {
    return '<article class="tma-dash__card tma-dash__card--' + tone + '" aria-hidden="true">' +
      '<div class="tma-dash__card-head"><span class="tma-skeleton tma-skeleton--text" style="width:55%"></span></div>' +
      '<div class="tma-dash__card-row"><span class="tma-skeleton tma-dash__card-value--skeleton"></span>' +
      '<span class="tma-skeleton tma-dash__card-delta--skeleton"></span></div></article>';
  }

  // Cards the server couldn't measure. Shown when the metrics request fails —
  // an em-dash is honest about the gap; a number would not be.
  var KPI_UNAVAILABLE = { value: '—', delta: 'Unavailable', deltaUp: false, hint: 'Could not load this metric.' };

  function renderKpis() {
    if (!homeMetricsLoaded) {
      return '<div class="tma-dash__cards" aria-busy="true">' +
        kpiSkeletonCard('blue') + kpiSkeletonCard('purple') + kpiSkeletonCard('blue') + kpiSkeletonCard('purple') +
        '</div>';
    }
    // The KPI row measures how the firm serves its clients, so it is staff
    // only — a client account gets no row rather than four meaningless cards.
    if (homeMetrics && homeMetrics.staff === false) return '';

    var c = (homeMetrics && homeMetrics.cards) || {};
    function card(key) { return c[key] || KPI_UNAVAILABLE; }

    return '<div class="tma-dash__cards">' +
      kpiCard('blue', 'Avg. Response to Clients', 'ClockCountdown', card('clientResponse')) +
      kpiCard('purple', 'Files Shared', 'Share', card('filesShared')) +
      kpiCard('blue', 'Clients Awaiting Reply', 'ChatDots', card('awaitingReply')) +
      kpiCard('purple', 'Awaiting Signature', 'Signature', card('awaitingSignature')) +
      '</div>';
  }

  /*
   * Recent Files, Favorites and the KPI row are server-owned and cached here for
   * the life of the page, not re-fetched per mount.
   *
   * These flags are deliberately module-level rather than per-mount. Returning
   * to the Dashboard re-runs mount(), and if "have we loaded?" lived on the
   * element, every visit would start from nothing: skeletons, a fetch, then a
   * rebuild. Kept here, a revisit paints the data it already has and revalidates
   * quietly behind it.
   *
   * The *Inflight promises collapse overlapping refreshes into one request.
   */
  var homeFilesLoaded = false;
  var homeFilesInflight = null;

  var homeMetricsLoaded = false;
  var homeMetrics = null;
  var homeMetricsInflight = null;

  // Pending-approvals count, fetched once and reused. It was previously
  // requested on every mount, including the two re-renders each load triggers.
  var pendingUsersCount = null;

  // Inbox unread — same pattern as users. Never invent a number: hide the
  // badge until the first real count arrives (from /portal/mail or the email
  // module), then keep painting from cache so remounts do not flash.
  var inboxUnreadCount = null;
  var inboxUnreadInflight = null;
  var shortcutCountListenersBound = false;

  // `path` from the API is the full ancestor chain ([{id,name}, ...], root
  // first) rather than just the immediate parent's name — join it into one
  // breadcrumb string. A file directly in the File Box (no folder) has an
  // empty path; a top-level folder does too, but only files get the label.
  function pathLabel(kind, crumbs) {
    var names = (crumbs || []).map(function (c) { return c.name; });
    return names.length ? names.join(' / ') : (kind === 'file' ? 'File Box' : '');
  }

  // Folder icon for folders; the real server thumbnail for images (falling back
  // to the file-type icon if it can't be produced); the type icon otherwise.
  function rowIconHtml(f) {
    if (f.kind === 'folder') {
      var base = f.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
      if (window.TMAFolderIcons) return window.TMAFolderIcons.html(base, f.colour, f.iconName, 24);
      var src = window.TMAFolderColours ? window.TMAFolderColours.iconSrc(base, f.colour) : 'images/icons/phosphor/' + base + '.svg';
      return '<img src="' + ui().esc(src) + '" alt="">';
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
    // data-key ties this panel to *itself* across renders. Panels are siblings
    // in one grid and can be shown or hidden individually, so without a key a
    // hidden neighbour would shift the others along and this panel's contents —
    // thumbnails included — would be rewritten onto a different node.
    if (!homeFilesLoaded) {
      return tileShell('recentFiles', 'panel-recent', 'Recent files', panelHead('Recent Files'), skeletonFileRows(3), '', true);
    }
    var rows = s.recentFiles.map(function (f) {
      // Keyed by kind+id: a folder and a file can share a numeric id, and
      // matching the wrong one would swap a row's icon and name.
      return '<button type="button" class="tma-portal-file-row"' +
        ' data-key="recent-' + ui().esc(f.kind) + '-' + ui().esc(f.id) + '"' +
        ' data-home-file="' + ui().esc(f.id) + '"' +
        ' data-home-file-kind="' + ui().esc(f.kind) + '"' +
        (f.folderId ? ' data-home-file-folder="' + ui().esc(f.folderId) + '"' : '') + '>' +
        rowIconHtml(f) +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + ui().esc(f.name) + '</span>' +
        (f.path ? '<span class="tma-portal-file-row__path">' + ui().esc(f.path) + '</span>' : '') +
        '</span></button>';
    }).join('');
    return tileShell(
      'recentFiles', 'panel-recent', 'Recent files', panelHead('Recent Files'),
      rows || '<p class="tma-portal-panel__note">No recent files yet.</p>'
    );
  }

  function renderShortcuts() {
    if (!homeFilesLoaded) {
      var tile = '<div class="tma-portal-shortcut tma-portal-shortcut--skeleton" aria-hidden="true">' +
        '<span class="tma-skeleton" style="width:44px;height:44px;border-radius:var(--radius-12)"></span>' +
        '<span class="tma-skeleton tma-skeleton--text" style="width:70%;height:11px"></span></div>';
      return tileShell(
        'shortcuts', 'panel-shortcuts', 'Shortcuts', panelHead('Shortcuts'),
        '<div class="tma-portal-shortcuts">' + new Array(8).fill(tile).join('') + '</div>',
        '', true
      );
    }
    return tileShell(
      'shortcuts', 'panel-shortcuts', 'Shortcuts', panelHead('Shortcuts'),
      '<div class="tma-portal-shortcuts">' +
      SHORTCUTS.map(function (sc) {
        return '<button type="button" class="tma-portal-shortcut" data-home-shortcut="' + sc.id + '">' +
          '<span class="tma-portal-shortcut__icon"><img src="images/icons/phosphor/' + sc.icon + '.svg" alt="">' +
          (sc.count ? '<span class="tma-portal-shortcut__count" data-home-shortcut-count="' + sc.count + '" hidden></span>' : '') +
          '</span>' +
          '<span>' + ui().esc(sc.label) + '</span></button>';
      }).join('') +
      '</div>'
    );
  }

  function renderTutorials(s) {
    if (!homeFilesLoaded) {
      return tileShell('tutorials', 'panel-tutorials', 'Tutorials', panelHead('Tutorials'), skeletonFileRows(4), '', true);
    }
    var done = s.tutorials.filter(function (t) { return t.done; }).length;
    var head =
      '<div class="tma-portal-panel__head">' +
      '<div class="tma-portal-head" style="gap:var(--space-8);flex:1;min-width:0">' +
      '<h2 class="tma-portal-panel__title">Tutorials</h2>' +
      ui().select(['Getting Started'], 'Getting Started', 'data-home-tutorial-set', 'Tutorial set') +
      '</div></div>';
    var body =
      '<p class="tma-portal-panel__note">' + done + ' of ' + s.tutorials.length + ' completed</p>' +
      '<div class="tma-portal-tutorials">' +
      s.tutorials.map(function (t) {
        return '<button type="button" class="tma-portal-tutorial' + (t.done ? ' is-done' : '') + ' tma-portal-file-row" data-home-tutorial="' + ui().esc(t.id) + '" aria-pressed="' + t.done + '">' +
          '<span class="tma-portal-tutorial__check">' + (t.done ? '<img src="images/icons/phosphor/Check.svg" alt="" width="12" height="12">' : '') + '</span>' +
          '<span class="tma-portal-tutorial__label">' + ui().esc(t.label) + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
    return tileShell('tutorials', 'panel-tutorials', 'Tutorials', head, body);
  }

  /* Staff team board — online / offline + today's work-plan status. */
  var homeStaffLoaded = false;
  var homeStaff = null;
  var homeStaffInflight = null;
  var homeStaffTimer = null;
  var homeStaffUserBound = false;

  function avatarSrcFor(person) {
    if (window.TMACurrentUser && window.TMACurrentUser.avatarSrc) {
      return window.TMACurrentUser.avatarSrc(person.avatar, person.name);
    }
    return person.avatar || 'images/avatars/Avatar3d01.png';
  }

  function workStatusTone(status) {
    if (!status) return 'neutral';
    if (status === 'in_office' || status === 'field_work') return 'office';
    if (status === 'remote' || status === 'flexible') return 'remote';
    if (status === 'sick_leave' || status === 'on_leave' || status === 'personal_leave') return 'leave';
    if (status === 'out_of_office' || status === 'travelling' || status === 'not_working') return 'away';
    return 'neutral';
  }

  function employeesSkeleton() {
    return tileShell(
      'employees', 'panel-employees', 'Employees', panelHead('Employees'),
      '<div class="tma-portal-employees" aria-hidden="true">' +
      new Array(5).fill(
        '<div class="tma-portal-employee tma-portal-employee--skeleton">' +
        '<span class="tma-skeleton tma-skeleton--avatar" style="width:36px;height:36px;border-radius:50%"></span>' +
        '<span class="tma-portal-employee__meta" style="flex:1">' +
        '<span class="tma-skeleton tma-skeleton--text" style="width:48%"></span>' +
        '<span class="tma-skeleton tma-skeleton--text" style="width:32%;margin-top:6px"></span>' +
        '</span></div>'
      ).join('') +
      '</div>',
      'tma-portal-panel--employees',
      true
    );
  }

  function renderEmployees() {
    // Identity/API may still be loading — show a skeleton rather than vanishing.
    // The server is the source of truth for staff vs client (`staff: false`).
    if (!homeStaffLoaded) return employeesSkeleton();

    if (!homeStaff || homeStaff.staff === false) return '';

    var people = homeStaff.employees || [];
    var onlineCount = people.filter(function (p) { return p.online; }).length;
    var rows = people.map(function (p) {
      var work = p.workStatus || null;
      var tone = work ? workStatusTone(work.status) : (p.online ? 'online' : 'away');
      var sub;
      if (p.online && work && work.label) sub = work.label;
      else if (!p.online && work && work.label) sub = work.label + ' · ' + (p.lastSeen || 'Offline');
      else if (p.online) sub = 'Online';
      else sub = p.lastSeen || 'Offline';

      return '<div class="tma-portal-employee" data-key="employee-' + ui().esc(p.id) + '">' +
        '<span class="tma-portal-employee__avatar' + (p.online ? ' is-online' : '') + '">' +
        '<img src="' + ui().esc(avatarSrcFor(p)) + '" alt="" width="36" height="36" loading="lazy">' +
        '</span>' +
        '<span class="tma-portal-employee__meta">' +
        '<span class="tma-portal-employee__name">' + ui().esc(p.name) + (p.self ? ' (you)' : '') + '</span>' +
        '<span class="tma-portal-employee__sub">' + ui().esc(sub) + '</span>' +
        '</span>' +
        '<span class="tma-portal-employee__badge tma-portal-employee__badge--' + tone + '">' +
        ui().esc(p.online ? 'Online' : 'Offline') +
        '</span></div>';
    }).join('');

    return tileShell(
      'employees', 'panel-employees', 'Employees',
      panelHead('Employees', onlineCount + ' of ' + people.length + ' online'),
      '<div class="tma-portal-employees">' +
      (rows || '<p class="tma-portal-panel__note">No employees to show.</p>') +
      '</div>',
      'tma-portal-panel--employees'
    );
  }

  /* Recent inbox messages for the home dashboard. */
  var homeEmailLoaded = false;
  var homeEmail = null;
  var homeEmailInflight = null;
  var homeEmailTimer = null;

  function emailAvatarSrc(msg) {
    if (msg.avatarUrl) return msg.avatarUrl;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsFor) {
      return window.TMACurrentUser.initialsFor(msg.sender || msg.email || '?', msg.email || msg.sender || '?');
    }
    return 'images/avatars/Avatar3d01.png';
  }

  function renderEmail() {
    if (!homeEmailLoaded) {
      return tileShell(
        'email', 'panel-email', 'Recent email', panelHead('Recent Email'),
        skeletonFileRows(4), 'tma-portal-panel--email', true
      );
    }

    if (homeEmail && homeEmail.connected === false) {
      return tileShell(
        'email', 'panel-email', 'Recent email', panelHead('Recent Email'),
        '<p class="tma-portal-panel__note">Connect a mailbox to see recent email here.</p>' +
        '<button type="button" class="tma-portal-link" data-home-email-open>Open Email</button>',
        'tma-portal-panel--email'
      );
    }

    var messages = (homeEmail && homeEmail.messages) || [];
    var rows = messages.map(function (m) {
      return '<button type="button" class="tma-portal-email-row' + (m.unread ? ' is-unread' : '') + '"' +
        ' data-key="email-' + ui().esc(m.id) + '"' +
        ' data-home-email="' + ui().esc(m.id) + '">' +
        '<img class="tma-portal-email-row__avatar" src="' + ui().esc(emailAvatarSrc(m)) + '" alt="" width="32" height="32" loading="lazy">' +
        '<span class="tma-portal-email-row__meta">' +
        '<span class="tma-portal-email-row__top">' +
        '<span class="tma-portal-email-row__sender">' + ui().esc(m.sender || m.email || 'Unknown') + '</span>' +
        '<span class="tma-portal-email-row__time">' + ui().esc(m.time || '') + '</span>' +
        '</span>' +
        '<span class="tma-portal-email-row__subject">' + ui().esc(m.subject || '(no subject)') + '</span>' +
        (m.body ? '<span class="tma-portal-email-row__snippet">' + ui().esc(m.body) + '</span>' : '') +
        '</span></button>';
    }).join('');

    return tileShell(
      'email', 'panel-email', 'Recent email', panelHead('Recent Email'),
      rows
        ? '<div class="tma-portal-email-list">' + rows + '</div>'
        : '<p class="tma-portal-panel__note">No recent messages.</p>',
      'tma-portal-panel--email'
    );
  }

  function emailPayloadSignature(payload) {
    if (!payload) return '';
    if (payload.connected === false) return 'disconnected';
    var msgs = payload.messages || [];
    return msgs.map(function (m) {
      return [m.id, m.unread ? 1 : 0, m.time || '', m.subject || ''].join(':');
    }).join('|');
  }

  function loadHomeEmail(el, opts) {
    opts = opts || {};
    if (homeEmailInflight) return;

    function finish(payload) {
      homeEmailInflight = null;
      var changed = !homeEmailLoaded ||
        emailPayloadSignature(payload) !== emailPayloadSignature(homeEmail);
      homeEmailLoaded = true;
      homeEmail = payload;
      if (changed && el && el.isConnected) mount(el, { fromLoad: true });
    }

    homeEmailInflight = fetch('/portal/mail', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (index) {
        if (!index) {
          finish({ connected: true, messages: (homeEmail && homeEmail.messages) || [] });
          return null;
        }
        if (index.connected === false) {
          finish({ connected: false, messages: [] });
          return null;
        }
        return fetch('/portal/mail/messages?folder=inbox&perPage=25&page=1', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        }).then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (json) {
            finish({
              connected: true,
              messages: json && Array.isArray(json.messages) ? json.messages.slice(0, 8) : [],
            });
          });
      })
      .catch(function () {
        homeEmailInflight = null;
        if (!homeEmailLoaded) {
          homeEmailLoaded = true;
          homeEmail = { connected: true, messages: [] };
          if (el && el.isConnected) mount(el, { fromLoad: true });
        }
      });

    // Keep inbox fresh while the home view is open (same cadence as Employees).
    if (!homeEmailTimer && !opts.skipTimer) {
      homeEmailTimer = setInterval(function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        if (homeEmailInflight) return;
        if (homeEmail && homeEmail.connected === false) return;
        loadHomeEmail(mountEl, { skipTimer: true });
      }, 30000);
    }

    if (!window.__tmaHomeEmailLiveBound) {
      window.__tmaHomeEmailLiveBound = true;
      document.addEventListener('tma-email-count', function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        loadHomeEmail(mountEl, { skipTimer: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        loadHomeEmail(mountEl, { skipTimer: true });
      });
    }
  }

  function renderRoadPanel() {
    if (!window.TMAOverview || !window.TMAOverview.renderRoad) return '';
    return '<div class="tma-portal-panel tma-portal-tile tma-portal-tile--road tma-portal-tile--third"' +
      ' data-tile-id="road" data-tile-span="third" data-key="panel-road" aria-label="What\'s on the road?">' +
      window.TMAOverview.renderRoad() +
      '</div>';
  }

  function renderHomeGrid(s, show) {
    var renderers = {
      email: function () { return show.email !== false ? renderEmail() : ''; },
      recentFiles: function () { return show.recentFiles ? renderRecentFiles(s) : ''; },
      shortcuts: function () { return show.shortcuts ? renderShortcuts() : ''; },
      employees: function () { return show.employees !== false ? renderEmployees() : ''; },
      favorites: function () { return show.favorites ? renderFavorites(s) : ''; },
      tutorials: function () { return show.tutorials ? renderTutorials(s) : ''; },
      road: function () { return show.road !== false ? renderRoadPanel() : ''; },
    };
    return tileOrder().map(function (id) {
      return renderers[id] ? renderers[id]() : '';
    }).join('');
  }

  function bindStaffUserListener() {
    if (homeStaffUserBound) return;
    if (!window.TMACurrentUser || !window.TMACurrentUser.onChange) return;
    homeStaffUserBound = true;
    window.TMACurrentUser.onChange(function () {
      var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      if (!mountEl || !mountEl.isConnected) return;
      // /me often arrives after the first dashboard mount. If we previously
      // concluded "not staff" before identity was known, retry.
      if (homeStaff && homeStaff.staff === false && isStaffUser()) {
        homeStaffLoaded = false;
        homeStaff = null;
      }
      if (!homeStaffLoaded || (isStaffUser() && (!homeStaff || !homeStaff.staff))) {
        loadHomeStaff(mountEl);
      } else {
        mount(mountEl, { fromLoad: true });
      }
    });
  }

  function loadHomeStaff(el, opts) {
    opts = opts || {};
    bindStaffUserListener();

    // Only skip the network call when we already know this account is a client.
    // If /me has not loaded yet, still ask the server — the session knows.
    if (isStaffUser() === false) {
      homeStaffLoaded = true;
      homeStaff = { staff: false, employees: [] };
      return;
    }
    if (homeStaffInflight) return;

    homeStaffInflight = fetch('/portal/dashboard/staff', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (json) {
        homeStaffInflight = null;
        homeStaffLoaded = true;
        // A failed request must not permanently hide the widget for staff.
        if (json) {
          homeStaff = json;
        } else if (!homeStaff) {
          homeStaff = { staff: true, employees: [], error: true };
        }
        if (el && el.isConnected) mount(el, { fromLoad: true });
      });

    // Keep presence fresh while the home view is open.
    if (!homeStaffTimer && !opts.skipTimer) {
      homeStaffTimer = setInterval(function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        if (homeStaffInflight) return;
        if (homeStaff && homeStaff.staff === false) return;
        homeStaffInflight = fetch('/portal/dashboard/staff', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        }).then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (json) {
            homeStaffInflight = null;
            if (!json) return;
            homeStaff = json;
            homeStaffLoaded = true;
            if (mountEl.isConnected) mount(mountEl, { fromLoad: true });
          });
      }, 30000);
    }
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
    { id: 'email', label: 'Recent Email', desc: 'Your latest inbox messages, ready to open.', preview: 'email' },
    { id: 'shortcuts', label: 'Shortcuts', desc: 'Frequently used actions, as well as quick access to certain folders.', preview: 'shortcuts' },
    { id: 'employees', label: 'Employees', desc: 'Who is online, and today\'s work status (office, remote, leave).', preview: 'employees', staffOnly: true },
    { id: 'favorites', label: 'Favorites', desc: 'Files and folders you marked as favorite.', preview: 'favorites' },
    { id: 'tutorials', label: 'Tutorials', desc: 'Videos and helpful articles that will help you get the best out of the portal.', preview: 'tutorials' },
    { id: 'road', label: 'What\'s on the road?', desc: 'Upcoming events and work-plan items for the selected day.', preview: 'road' },
  ];

  // Shipped default board (3 equal columns, masonry):
  //   Recent Files → Favorites
  //   Recent Email → What's on the road?
  //   Shortcuts → Employees
  // Tutorials stays off by default.
  var DEFAULT_TILE_ORDER = ['recentFiles', 'email', 'shortcuts', 'favorites', 'road', 'employees', 'tutorials'];

  // Every tile is one column of the 3-up board — nothing spans full width.
  var TILE_SPAN = {
    recentFiles: 'third',
    favorites: 'third',
    employees: 'third',
    email: 'third',
    tutorials: 'third',
    shortcuts: 'third',
    road: 'third',
  };

  var TILE_GAP = 20;

  function homeGridCols(width) {
    if (width < 700) return 1;
    if (width < 1100) return 2;
    return 3;
  }

  function tileWidthFrac(span, cols) {
    if (span === 'full' || cols <= 1) return 1;
    return 1 / cols;
  }

  function fractionToPx(frac, containerWidth, gap, cols) {
    if (frac >= 0.999) return containerWidth;
    var colW = (containerWidth - gap * (cols - 1)) / cols;
    var spanCols = Math.max(1, Math.round(frac * cols));
    return Math.round(spanCols * colW + (spanCols - 1) * gap);
  }

  function rectsOverlap(a, b, gap) {
    return !(
      a.x + a.w + gap <= b.x ||
      b.x + b.w + gap <= a.x ||
      a.y + a.h + gap <= b.y ||
      b.y + b.h + gap <= a.y
    );
  }

  /* Skyline masonry: place each tile at the highest (lowest y) leftmost slot.
   * Column stacks for the default board:
   *   favorites → recentFiles, road → email, employees → shortcuts. */
  var TILE_STACK_UNDER = {
    favorites: 'recentFiles',
    road: 'email',
    employees: 'shortcuts',
  };

  function packHomeTiles(items, containerWidth, gap) {
    var placed = [];
    items.forEach(function (item) {
      var w = item.wPx;
      var h = item.h;
      var candidates = [0];
      placed.forEach(function (p) {
        candidates.push(p.x + p.w + gap);
      });
      candidates = candidates.filter(function (x, i, arr) {
        return arr.indexOf(x) === i && x >= 0 && x + w <= containerWidth + 0.5;
      }).sort(function (a, b) { return a - b; });
      if (!candidates.length) {
        w = Math.min(w, containerWidth);
        candidates = [0];
      }

      var preferX = null;
      var stackUnder = TILE_STACK_UNDER[item.id];
      if (stackUnder) {
        for (var r = 0; r < placed.length; r++) {
          if (placed[r].id === stackUnder) {
            preferX = placed[r].x;
            if (candidates.indexOf(preferX) === -1) candidates.unshift(preferX);
            break;
          }
        }
      }

      var best = null;
      candidates.forEach(function (x) {
        var y = 0;
        var guard = 0;
        while (guard++ < 200) {
          var hit = null;
          for (var i = 0; i < placed.length; i++) {
            var p = placed[i];
            if (rectsOverlap({ x: x, y: y, w: w, h: h }, p, gap)) {
              hit = p;
              break;
            }
          }
          if (!hit) break;
          y = hit.y + hit.h + gap;
        }
        var prefer = preferX != null && Math.abs(x - preferX) < 1;
        if (
          !best ||
          (prefer && !(preferX != null && Math.abs(best.x - preferX) < 1)) ||
          (prefer === (preferX != null && Math.abs(best.x - preferX) < 1) &&
            (y < best.y || (y === best.y && x < best.x)))
        ) {
          best = { id: item.id, x: x, y: y, w: w, h: h };
        }
      });
      placed.push(best);
    });
    return placed;
  }

  function layoutHomeMasonry(grid) {
    if (!grid) return;
    var width = grid.clientWidth || grid.offsetWidth;
    if (width < 40) return;

    var nodes = Array.prototype.slice.call(grid.querySelectorAll('[data-tile-id]'));
    if (!nodes.length) {
      grid.style.height = '0px';
      grid.classList.remove('is-packed');
      return;
    }

    var cols = homeGridCols(width);
    var gap = TILE_GAP;

    // Drop back to the CSS-grid fallback so heights match real column widths.
    grid.classList.remove('is-packed');
    grid.style.height = '';
    nodes.forEach(function (node) {
      node.style.position = '';
      node.style.left = '';
      node.style.top = '';
      node.style.width = '';
      node.style.height = '';
    });
    void grid.offsetHeight;

    var items = nodes.map(function (node) {
      var id = node.getAttribute('data-tile-id');
      var span = node.getAttribute('data-tile-span') || 'third';
      var frac = tileWidthFrac(span, cols);
      var wPx = fractionToPx(frac, width, gap, cols);
      var h = Math.max(120, Math.ceil(node.getBoundingClientRect().height));
      return { id: id, wPx: wPx, h: h, node: node };
    });

    var packed = packHomeTiles(items, width, gap);

    // Stretch the bottom card in each column so column bottoms line up
    // (Favorites / Employees meet What's on the road?).
    var maxBottom = 0;
    packed.forEach(function (p) {
      if (p.y + p.h > maxBottom) maxBottom = p.y + p.h;
    });
    var bottomByCol = {};
    packed.forEach(function (p) {
      var key = String(Math.round(p.x));
      var prev = bottomByCol[key];
      if (!prev || p.y + p.h > prev.y + prev.h) bottomByCol[key] = p;
    });
    Object.keys(bottomByCol).forEach(function (key) {
      var p = bottomByCol[key];
      var nextH = Math.max(p.h, maxBottom - p.y);
      if (nextH > p.h) p.h = nextH;
    });

    var byId = {};
    packed.forEach(function (p) { byId[p.id] = p; });

    nodes.forEach(function (node) {
      var id = node.getAttribute('data-tile-id');
      var p = byId[id];
      if (!p) return;
      node.style.left = p.x + 'px';
      node.style.top = p.y + 'px';
      node.style.width = p.w + 'px';
      node.style.height = p.h + 'px';
    });

    grid.style.height = maxBottom + 'px';
    grid.classList.add('is-packed');
    grid._masonryWidth = width;
    grid._masonrySig = items.map(function (i) { return i.id + ':' + i.h; }).join('|');
  }

  function bindHomeMasonry(root) {
    var grid = root.querySelector('.tma-portal-home-grid');
    if (!grid) return;

    requestAnimationFrame(function () {
      layoutHomeMasonry(grid);
      // Second pass after images/fonts settle natural heights.
      requestAnimationFrame(function () { layoutHomeMasonry(grid); });
    });

    if (!grid._masonryRo && typeof ResizeObserver !== 'undefined') {
      var timer = null;
      grid._masonryRo = new ResizeObserver(function () {
        if (timer) cancelAnimationFrame(timer);
        timer = requestAnimationFrame(function () {
          timer = null;
          var w = grid.clientWidth || 0;
          if (grid._masonryWidth && Math.abs(grid._masonryWidth - w) < 1) {
            // Width unchanged — still re-pack if content height likely changed.
            var sig = Array.prototype.map.call(
              grid.querySelectorAll('[data-tile-id]'),
              function (n) { return n.getAttribute('data-tile-id'); }
            ).join('|');
            if (grid._masonryNodeSig === sig && grid.classList.contains('is-packed')) return;
            grid._masonryNodeSig = sig;
          }
          layoutHomeMasonry(grid);
        });
      });
      grid._masonryRo.observe(grid);
    }
  }

  // true = staff, false = client, null = /me not loaded yet
  function isStaffUser() {
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    if (!me) return null;
    if (me.isAdmin) return true;
    var type = String(me.accountType || '');
    return type === 'Administrator' || type === 'Employee';
  }

  var layoutHydrated = false;
  var layoutSaveTimer = null;

  function panelHead(title, meta) {
    return '<div class="tma-portal-panel__head">' +
      '<h2 class="tma-portal-panel__title">' + ui().esc(title) + '</h2>' +
      (meta ? '<span class="tma-portal-panel__meta">' + ui().esc(meta) + '</span>' : '') +
      '</div>';
  }

  function tileAttrs(id) {
    var span = TILE_SPAN[id] || 'third';
    return ' data-tile-id="' + id + '" data-tile-span="' + span + '"';
  }

  function tileShell(id, key, aria, headHtml, bodyHtml, extraClass, busy) {
    var span = TILE_SPAN[id] || 'third';
    var spanClass = span === 'full' ? ' tma-portal-tile--full' : ' tma-portal-tile--third';
    return '<section class="tma-portal-panel tma-portal-tile' + spanClass + (extraClass ? ' ' + extraClass : '') + '"' +
      tileAttrs(id) +
      ' data-key="' + key + '"' +
      ' aria-label="' + ui().esc(aria) + '"' +
      (busy ? ' aria-busy="true"' : '') + '>' +
      headHtml +
      '<div class="tma-portal-panel__body">' + bodyHtml + '</div>' +
      '</section>';
  }

  function prefXsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function layoutPayload() {
    return {
      dashboardTiles: tilesVisibilityPayload(),
      dashboardLayout: {
        order: tileOrder(),
      },
    };
  }

  function tilesVisibilityPayload() {
    var show = tiles();
    var out = {};
    DEFAULT_TILE_ORDER.forEach(function (id) {
      if (show[id] == null) out[id] = id !== 'tutorials';
      else out[id] = !!show[id];
    });
    return out;
  }

  function queueLayoutServerSave() {
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(flushLayoutServerSave, 350);
  }

  function flushLayoutServerSave() {
    layoutSaveTimer = null;
    fetch('/me/preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': prefXsrf(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(layoutPayload()),
    }).catch(function () {});
  }

  function layoutSnapshot(s) {
    return JSON.stringify({
      tiles: s.dashboardTiles || {},
      order: s.dashboardTileOrder || [],
    });
  }

  // Bump when the shipped default board changes. Applies once per browser, then
  // the account save keeps every other browser in sync.
  var DASHBOARD_LAYOUT_GEN = 10;

  function ensureLocalDefaultLayout() {
    var s = data().state();
    if (s.dashboardLayoutGen === DASHBOARD_LAYOUT_GEN) return false;

    s.dashboardTileSizes = {};
    s.dashboardTileOrder = DEFAULT_TILE_ORDER.slice();
    s.dashboardTiles = Object.assign({}, s.dashboardTiles || {}, {
      recentFiles: true, email: true, shortcuts: true, employees: true,
      favorites: true, road: true, tutorials: false,
    });
    s.dashboardLayoutGen = DASHBOARD_LAYOUT_GEN;
    data().save();
    return true;
  }

  function hydrateLayoutFromServer(done) {
    if (layoutHydrated) {
      if (done) done(false);
      return;
    }
    var forcedDefault = ensureLocalDefaultLayout();
    fetch('/me/preferences', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (prefs) {
        layoutHydrated = true;
        if (!prefs) {
          if (forcedDefault) queueLayoutServerSave();
          if (done) done(forcedDefault);
          return;
        }
        var s = data().state();
        var before = layoutSnapshot(s);
        var serverOrder = prefs.dashboardLayout &&
          Array.isArray(prefs.dashboardLayout.order) &&
          prefs.dashboardLayout.order.length
          ? prefs.dashboardLayout.order
          : null;

        if (prefs.dashboardTiles && typeof prefs.dashboardTiles === 'object') {
          s.dashboardTiles = Object.assign({}, s.dashboardTiles || {}, prefs.dashboardTiles);
        }

        // After a layout-gen bump, keep the new defaults and push them to the account.
        // Otherwise the server order is the cross-browser source of truth.
        if (forcedDefault) {
          queueLayoutServerSave();
        } else if (serverOrder) {
          s.dashboardTileOrder = serverOrder.slice();
        }

        // Sizes are no longer used (fixed 2-column grid).
        s.dashboardTileSizes = {};

        var changed = forcedDefault || layoutSnapshot(s) !== before;
        if (changed) data().save();
        if (done) done(changed);
      });
  }

  // Persist layout immediately when leaving the page / tab so another browser
  // never races an in-flight debounced save.
  if (!window.__tmaHomeLayoutFlushBound) {
    window.__tmaHomeLayoutFlushBound = true;
    window.addEventListener('pagehide', function () {
      if (layoutSaveTimer) flushLayoutServerSave();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && layoutSaveTimer) flushLayoutServerSave();
    });
  }

  function tiles() {
    var s = data().state();
    if (!s.dashboardTiles) {
      s.dashboardTiles = {
        recentFiles: true, email: true, shortcuts: true, employees: true,
        favorites: true, road: true, tutorials: false,
      };
      data().save();
    }
    if (s.dashboardTiles.employees == null) s.dashboardTiles.employees = true;
    if (s.dashboardTiles.email == null) s.dashboardTiles.email = true;
    if (s.dashboardTiles.road == null) s.dashboardTiles.road = true;
    return s.dashboardTiles;
  }

  function tileOrder() {
    var s = data().state();
    var order = Array.isArray(s.dashboardTileOrder) ? s.dashboardTileOrder.slice() : [];
    DEFAULT_TILE_ORDER.forEach(function (id) {
      if (order.indexOf(id) === -1) order.push(id);
    });
    return order.filter(function (id) {
      return DEFAULT_TILE_ORDER.indexOf(id) !== -1;
    });
  }

  function availableTiles() {
    // While /me is loading, keep staff-only tiles visible in the editor so an
    // admin does not see them disappear and reappear.
    var staff = isStaffUser();
    return DASH_TILES.filter(function (t) { return !t.staffOnly || staff !== false; });
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
    } else if (kind === 'employees' || kind === 'email') {
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>';
      for (var e = 0; e < 3; e++) {
        inner += '<span class="tma-portal-tilerow__preview-line">' +
          '<span class="tma-portal-tilerow__preview-dot"></span>' +
          '<span class="tma-portal-tilerow__preview-bar"></span></span>';
      }
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
    var available = availableTiles();
    var draft = {};
    available.forEach(function (t) { draft[t.id] = !!current[t.id]; });

    ui().openModal({
      title: 'Edit Dashboard',
      body:
        '<p>Choose which tiles to show on your dashboard.</p>' +
        '<div class="tma-portal-tilerows">' +
        available.map(function (t) {
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
          return available.some(function (t) { return !!draft[t.id] !== !!current[t.id]; });
        }

        host.querySelectorAll('[data-home-tile]').forEach(function (input) {
          input.addEventListener('change', function () {
            draft[input.getAttribute('data-home-tile')] = input.checked;
            saveBtn.disabled = !dirty();
          });
        });

        saveBtn.addEventListener('click', function () {
          var s = data().state();
          s.dashboardTiles = Object.assign({}, s.dashboardTiles || {}, draft);
          data().save();
          queueLayoutServerSave();
          ui().closeModal();
          ui().toast('Dashboard updated');
          rerender();
        });
      },
    });
  }

  function renderFavorites(s) {
    if (!homeFilesLoaded) {
      return tileShell(
        'favorites', 'panel-favorites', 'Favorites', panelHead('Favorites'),
        skeletonFileRows(2),
        '', true
      );
    }
    var favs = (s.folders && s.folders.favorites) || [];
    var rows = favs.map(function (f) {
      return '<button type="button" class="tma-portal-file-row"' +
        ' data-key="fav-' + ui().esc(f.kind) + '-' + ui().esc(f.id) + '"' +
        ' data-home-favorite="' + ui().esc(f.id) + '"' +
        ' data-home-favorite-kind="' + ui().esc(f.kind) + '"' +
        (f.folderId ? ' data-home-favorite-folder="' + ui().esc(f.folderId) + '"' : '') + '>' +
        rowIconHtml(f) +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + ui().esc(f.name) + '</span>' +
        (f.path ? '<span class="tma-portal-file-row__path">' + ui().esc(f.path) + '</span>' : '') +
        '</span></button>';
    }).join('');
    return tileShell(
      'favorites', 'panel-favorites', 'Favorites', panelHead('Favorites'),
      rows || '<p class="tma-portal-panel__note">No favorites yet.</p>'
    );
  }

  /* Real data for the Recent Files + Favorites widgets, from the File Library
   * browse API (the same endpoints the file manager uses). Falls back quietly
   * to whatever is in state if the request fails. */
  function loadHomeFiles(el) {
    var net = window.TMAFilesNet;
    if (!net) { homeFilesLoaded = true; return; }

    // One flight at a time. Returning to the Dashboard while a refresh is still
    // running used to start a second identical pair of requests, and whichever
    // landed last won.
    if (homeFilesInflight) return;

    // Recent Files and Favorites are server-owned, so any value persisted by the
    // old localStorage mock must never reach the screen. That purge belongs to
    // the *first* load only — doing it on every refresh is what emptied the
    // panel and forced the skeleton back each time the Dashboard was opened.
    if (!homeFilesLoaded) {
      var s0 = data().state();
      s0.recentFiles = [];
      s0.folders = s0.folders || {};
      s0.folders.favorites = [];
    }

    // If the fetch stalls (slow single-threaded dev server), stop showing the
    // skeleton after a while and fall back to the empty state. The real data is
    // still applied whenever it eventually arrives.
    var giveUp = setTimeout(function () {
      if (homeFilesLoaded) return;
      homeFilesLoaded = true;
      if (el.isConnected) mount(el, { fromLoad: true });
    }, 12000);

    // The server orders folders before files within a page (same windowing
    // every other section uses), so a plain perPage=6 could return e.g. 6
    // folders and cut off a file modified a minute ago. Ask for a wider
    // candidate pool and do the true recency merge across both types here.
    homeFilesInflight = Promise.all([
      net.fetchJSON(net.url('/?section=recent&perPage=24')).catch(function () { return null; }),
      net.fetchJSON(net.url('/?section=favorites&perPage=8')).catch(function () { return null; }),
    ]).then(function (res) {
      clearTimeout(giveUp);
      homeFilesInflight = null;

      // A failed refresh keeps whatever is already on screen rather than
      // clearing the panel: the rows shown are still the last known-good truth,
      // and blanking them is both a worse answer and a visible flash.
      if (!res[0] && !res[1]) { homeFilesLoaded = true; return; }

      homeFilesLoaded = true;
      var s = data().state();

      // Each section is applied only if its own request succeeded, so a failing
      // Favorites call cannot wipe a good Recent Files list.
      if (res[0]) {
        var recentFolders = (res[0].folders || []).map(function (f) {
          return {
            kind: 'folder', id: f.id, name: f.name, fileCount: f.fileCount, colour: f.colour,
            path: pathLabel('folder', f.path), sortAt: f.modifiedAt,
          };
        });
        var recentFiles = (res[0].files || []).map(function (f) {
          return {
            kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
            folderId: f.folder && f.folder.id, path: pathLabel('file', f.path), sortAt: f.updatedAt,
          };
        });
        s.recentFiles = recentFolders.concat(recentFiles)
          .sort(function (a, b) { return new Date(b.sortAt || 0) - new Date(a.sortAt || 0); })
          .slice(0, 6);
      }

      if (res[1]) {
        var favFolders = (res[1].folders || []).map(function (f) {
          return { kind: 'folder', id: f.id, name: f.name, fileCount: f.fileCount, colour: f.colour, path: pathLabel('folder', f.path) };
        });
        var favFiles = (res[1].files || []).map(function (f) {
          return {
            kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
            folderId: f.folder && f.folder.id, path: pathLabel('file', f.path),
          };
        });
        s.folders = s.folders || {};
        s.folders.favorites = favFolders.concat(favFiles);
      }

      if (el.isConnected) mount(el, { fromLoad: true });
    });
  }

  /* The KPI row, measured server-side from real activity: response times come
   * from portal messages and connected mailboxes, shares from the file
   * library, signatures from the request log. A failure leaves the row in
   * place with em-dashes rather than showing a stale or invented number. */
  function loadHomeMetrics(el) {
    if (homeMetricsInflight) return;

    homeMetricsInflight = fetch('/portal/dashboard/metrics', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      // A failed refresh keeps the numbers already on the cards; only the very
      // first attempt has nothing to fall back to.
      .then(function (j) { if (j) homeMetrics = j; })
      .catch(function () {})
      .then(function () {
        homeMetricsInflight = null;
        homeMetricsLoaded = true;
        if (el.isConnected) mount(el, { fromLoad: true });
      });
  }

  // Shortcut badges: Email = exact inbox unread, Calendar = today's events,
  // Users = pending approvals. Never a placeholder number — and never "99+".
  function formatShortcutCount(n) {
    n = Math.max(0, parseInt(n, 10) || 0);
    if (n <= 0) return '';
    try { return n.toLocaleString('en-US'); } catch (e) { return String(n); }
  }

  function fillShortcutCounts(el) {
    function setCount(kind, n) {
      var text = formatShortcutCount(n);
      el.querySelectorAll('[data-home-shortcut-count="' + kind + '"]').forEach(function (b) {
        if (text) { b.textContent = text; b.hidden = false; }
        else { b.hidden = true; b.textContent = ''; }
      });
    }

    function applyEmail(n) {
      inboxUnreadCount = Math.max(0, parseInt(n, 10) || 0);
      setCount('email', inboxUnreadCount);
    }

    // Prefer the live mailbox state when the email view has already bootstrapped.
    var emailMount = document.querySelector('[data-email]');
    var emailState = emailMount && emailMount._emailState;
    if (emailState && window.TMAEmail && window.TMAEmail.getInboxUnreadCount) {
      applyEmail(window.TMAEmail.getInboxUnreadCount(emailState));
    } else if (inboxUnreadCount !== null) {
      setCount('email', inboxUnreadCount);
    }

    if (!inboxUnreadInflight) {
      inboxUnreadInflight = fetch('/portal/mail', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          // No mailbox → 0 (hide badge). Connected → exact inbox unread.
          var n = (j && j.connected && j.folders && j.folders.inbox)
            ? (j.folders.inbox.unread || 0)
            : 0;
          applyEmail(n);
          try {
            document.dispatchEvent(new CustomEvent('tma-email-count', { detail: { count: n } }));
          } catch (e) { /* ignore */ }
        })
        .catch(function () {})
        .then(function () { inboxUnreadInflight = null; });
    }

    var cal = (window.TMACalendar && window.TMACalendar.getTodayEventCount) ? window.TMACalendar.getTodayEventCount() : 0;
    // Real count now. It answers 0 until the first fetch lands, which hides
    // the badge rather than showing an invented number; the calendar module
    // fires tma-calendar-count when the true value arrives.
    setCount('calendar', cal);

    if (window.TMAMessages && window.TMAMessages.getInboxUnreadCount) {
      var messagesMount = document.querySelector('[data-messages]');
      var messagesState = messagesMount && messagesMount._messagesState;
      setCount('messages', window.TMAMessages.getInboxUnreadCount(messagesState));
    }

    if (window.TMAFeed && window.TMAFeed.getUnreadCount) {
      setCount('feed', window.TMAFeed.getUnreadCount());
    }

    // Painted from cache when known, so the badge does not blink back to zero
    // and re-populate on every render.
    if (pendingUsersCount !== null) { setCount('users', pendingUsersCount); }
    else {
      fetch('/admin/users/pending-count', { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.ok ? r.json() : { count: 0 }; })
        .then(function (j) {
          pendingUsersCount = (j && j.count) || 0;
          setCount('users', pendingUsersCount);
        })
        .catch(function () {});
    }

    if (!shortcutCountListenersBound) {
      shortcutCountListenersBound = true;
      document.addEventListener('tma-email-count', function (e) {
        var n = e && e.detail && e.detail.count;
        if (n == null) return;
        inboxUnreadCount = Math.max(0, parseInt(n, 10) || 0);
        var text = formatShortcutCount(inboxUnreadCount);
        document.querySelectorAll('[data-home-shortcut-count="email"]').forEach(function (b) {
          if (text) { b.textContent = text; b.hidden = false; }
          else { b.hidden = true; b.textContent = ''; }
        });
      });
      document.addEventListener('tma-calendar-count', function (e) {
        var n = e && e.detail && e.detail.count;
        if (n == null) return;
        var text = formatShortcutCount(n);
        document.querySelectorAll('[data-home-shortcut-count="calendar"]').forEach(function (b) {
          if (text) { b.textContent = text; b.hidden = false; }
          else { b.hidden = true; b.textContent = ''; }
        });
      });
    }
  }

  function mount(el, opts) {
    opts = opts || {};
    var s = data().state();
    var show = tiles();
    // Local re-render only. Toggling a tile or ticking a tutorial is a change to
    // *this* view, not a reason to re-request Recent Files, Favorites and the
    // KPI row from the server.
    function rerender() { mount(el, { fromLoad: true }); }

    /*
     * The greeting is rendered with the real name and avatar whenever
     * TMACurrentUser already has them.
     *
     * It used to always emit a blank skeleton avatar and then assign the true
     * src further down. Under a reconciling render that reads as: reset the
     * image to a 1x1 placeholder, then set it back — a visible flash of every
     * profile picture on every render, and a fresh network request each time.
     */
    var me = window.TMACurrentUser ? window.TMACurrentUser.get() : null;
    var heroSrc = me ? window.TMACurrentUser.avatarSrc(me.avatar, me.name) : null;

    var heroAvatarHtml = heroSrc
      ? '<img class="tma-portal-hello__avatar" src="' + ui().esc(heroSrc) + '" alt="" width="56" height="56">'
      : '<img class="tma-portal-hello__avatar tma-skeleton tma-skeleton--avatar" width="56" height="56"' +
        ' src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">';

    var heroTitleHtml = me
      ? '<h2 class="tma-portal-hello__title">Hello ' + ui().esc(me.firstName) + '</h2>'
      : '<h2 class="tma-portal-hello__title tma-skeleton tma-skeleton--text"></h2>';

    var picLinkLabel = me && me.hasAvatar ? 'Change profile picture' : 'Add profile picture';

    var html =
      '<div class="tma-portal-page" data-node-id="portal-home">' +
      '<div class="tma-portal-hello">' +
      '<div class="tma-portal-hello__main">' +
      heroAvatarHtml +
      '<div class="tma-portal-hello__copy">' +
      heroTitleHtml +
      '<button type="button" class="tma-portal-link tma-portal-hello__picture-link" data-home-add-picture>' +
      picLinkLabel + '</button>' +
      '</div></div>' +
      '<div class="tma-portal-hello__actions">' +
      ui().btn({ label: 'Edit Dashboard', icon: 'SquaresFour', variant: 'ghost', small: true, attrs: 'data-home-edit' }) +
      '</div></div>' +
      renderKpis() +
      '<div class="tma-portal-home-grid">' +
      renderHomeGrid(s, show) +
      '</div>' +
      (window.TMAPortalHomeLibrary ? window.TMAPortalHomeLibrary.render() : '') +
      '</div>';

    /*
     * Reconcile rather than replace.
     *
     * Assigning innerHTML here destroyed and rebuilt the whole Dashboard on
     * every render — including each Recent Files thumbnail and the profile
     * photo, which is what made the panel blink and the images re-request. The
     * panels and rows carry stable keys, so unchanged rows are now left
     * untouched and only genuinely changed ones are rewritten.
     */
    if (window.TMAMorph) window.TMAMorph.patch(el, html);
    else el.innerHTML = html;

    // Wiring runs after every render, but the nodes it walks now survive across
    // renders — so each binding is registered once per element rather than once
    // per render. Without this, a single click would fire N times on the Nth
    // render. See TMAMorph.unwired.
    var pick = window.TMAMorph
      ? function (sel) { return window.TMAMorph.unwired(el, sel); }
      : function (sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); };
    var bind = window.TMAMorph
      ? window.TMAMorph.on
      : function (node, type, fn) { if (node) node.addEventListener(type, fn); };

    if (window.TMAOverview && typeof window.TMAOverview.bindRoadActions === 'function') {
      window.TMAOverview.bindRoadActions(el);
    }
    if (window.TMAOverview && typeof window.TMAOverview.refreshRoad === 'function') {
      window.TMAOverview.refreshRoad(el);
    }

    bindHomeMasonry(el);

    el._homeLibRerender = function () { mount(el, { fromLoad: true }); };
    if (window.TMAPortalHomeLibrary) {
      window.TMAPortalHomeLibrary.wire(el);
    }

    pick('[data-home-shortcut]').forEach(function (b) {
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

    pick('[data-home-file]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-home-file-kind') === 'folder') {
          navigate({ navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: b.getAttribute('data-home-file') });
          return;
        }
        // Open the file's own folder; fall back to the File Box when it has none.
        var folderId = b.getAttribute('data-home-file-folder');
        navigate(folderId
          ? { navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: folderId }
          : { navId: 'folders-filebox', view: 'folders', title: 'File Box', crumb: 'Folders / File Box' });
      });
    });

    pick('[data-home-favorite]').forEach(function (b) {
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

    pick('[data-home-tutorial]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = s.tutorials.filter(function (x) { return x.id === b.getAttribute('data-home-tutorial'); })[0];
        if (!t) return;
        t.done = !t.done;
        data().save();
        rerender();
      });
    });

    pick('[data-home-email]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-home-email');
        navigate({
          navId: 'email',
          view: 'email',
          title: 'Email',
          crumb: 'Email',
          emailMessageId: id || null,
        });
      });
    });

    pick('[data-home-email-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        navigate({ navId: 'email', view: 'email', title: 'Email', crumb: 'Email' });
      });
    });

    /* The greeting and avatar are rendered directly in the markup above when
     * TMACurrentUser is ready. When it isn't yet, the skeleton stands until
     * current-user.js's own listener fires and re-renders this view — no
     * post-render patching of the DOM is needed here.
     * The picture picker itself is owned by current-user.js (delegated click). */

    bind(el.querySelector('[data-home-edit]'), 'click', function () { editDashboardModal(rerender); });

    fillShortcutCounts(el);
    // Fetch real Recent Files + Favorites, and the KPI metrics, once per
    // genuine mount (not on the re-render the fetches themselves trigger).
    if (!opts.fromLoad) {
      hydrateLayoutFromServer(function (changed) {
        // Re-render once when the account layout differs from local cache.
        if (changed && el.isConnected) mount(el, { fromLoad: true, fromHydrate: true });
      });
      loadHomeFiles(el);
      loadHomeMetrics(el);
      loadHomeStaff(el);
      loadHomeEmail(el);
      if (window.TMAPortalHomeLibrary) {
        window.TMAPortalHomeLibrary.load(function () {
          if (el.isConnected) mount(el, { fromLoad: true });
        });
      }
    } else if (!homeStaffInflight && (!homeStaffLoaded || (isStaffUser() && homeStaff && homeStaff.staff === false))) {
      // Retry when identity arrives after an early "not staff" guess.
      loadHomeStaff(el);
    } else {
      bindStaffUserListener();
    }
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('dashboard', mount);
})();
