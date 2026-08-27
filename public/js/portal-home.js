/*
 * TMA - Portal Dashboard (home) view
 * Greeting, KPI cards (reuses tma-dash__card recipe), Recent Files,
 * and Shortcuts.
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

  /*
   * The Shortcuts board: what each tile is called, what it opens, and who is
   * offered it.
   *
   * What is deliberately *not* here is the glyph and the colour. Each tile
   * draws its icon as a masked span so it can be tinted — a phosphor <img> is
   * fill="currentColor" art, which through an <img> resolves to flat black and
   * cannot be recoloured — and the mask has to be named in a stylesheet rather
   * than inline, because that is the only form scripts/inline_icon_masks.py
   * can reach. Twelve inline masks would be twelve requests the dashboard has
   * to wait on; inlined, they cost none.
   *
   * So each tile's art and ink live together in one block per `id` in
   * portal.css (.tma-portal-shortcut--<id>). A shortcut added here without one
   * there still works and still opens: it falls back to a plain document
   * glyph in the default ink, which is visibly wrong rather than invisible.
   */
  var SHORTCUTS = [
    { id: 'email', label: 'Email', count: 'email', cap: 'mail.use', nav: { navId: 'email', view: 'email', title: 'Email', crumb: 'Email' } },
    { id: 'messages', label: 'Messages', count: 'messages', nav: { navId: 'so-messages', view: 'messages', title: 'Messages', crumb: 'Messages' } },
    { id: 'feed', label: 'Feed', count: 'feed', cap: 'feed.view', nav: { navId: 'so-feed', view: 'feed', title: 'Feed', crumb: 'Social / Feed' } },
    { id: 'calendar', label: 'Calendar', count: 'calendar', nav: { navId: 'calendar', view: 'calendar', title: 'Calendar', crumb: 'Calendar' } },
    { id: 'users', label: 'Users', count: 'users', cap: 'users.view', nav: { navId: 'users', view: 'users', title: 'Users', crumb: 'Users' } },
    { id: 'share-files', label: 'Share Files', cap: 'files.viewOrg' },
    { id: 'request-files', label: 'Request Files', cap: 'files.viewOrg' },
    { id: 'new-user-folders', label: 'Create New User', cap: 'users.manage' },
    { id: 'shared-folders', label: 'Shared Folders', cap: 'files.viewOrg', nav: { navId: 'folders-shared', view: 'folders', title: 'Shared Folders', crumb: 'File Library / Shared Folders' } },
    { id: 'favorites', label: 'Favorites', nav: { navId: 'folders-favorites', view: 'folders', title: 'Favorites', crumb: 'File Library / Favorites' } },
    { id: 'feedback-approval', label: 'Feedback and Comments', cap: 'workflows.view', nav: { navId: 'workflows-feedback', view: 'workflows', title: 'Feedback and Comments', crumb: 'Workflows / Feedback and Comments' } },
    { id: 'send-signature', label: 'Send for Signature', cap: 'signatures.create', nav: { navId: 'signatures', view: 'signatures', title: 'Signature requests', crumb: 'Signatures' } },
  ];

  /*
   * A capability this account holds, decided from the boot list the shell
   * serves in the document rather than from /me, so a panel the server would
   * refuse is never painted and then emptied.
   */
  function canReach(capability) {
    var access = window.TMAPortalAccess;
    return !capability || (!!access && access.can(capability));
  }

  function visibleShortcuts() {
    return SHORTCUTS.filter(function (sc) { return canReach(sc.cap); });
  }

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
  var KPI_UNAVAILABLE = { value: '-', delta: 'Unavailable', deltaUp: false, hint: 'Could not load this metric.' };

  function renderKpis() {
    if (!homeMetricsLoaded) {
      return '<div class="tma-dash__cards" aria-busy="true">' +
        kpiSkeletonCard('blue') + kpiSkeletonCard('purple') + kpiSkeletonCard('blue') + kpiSkeletonCard('purple') +
        '</div>';
    }
    // The KPI row is staff for the firm, or a CIP-and-inbox row for a
    // service-provider contact. Other client accounts get no row rather
    // than four meaningless cards.
    if (homeMetrics && homeMetrics.staff === false && !homeMetrics.provider) return '';

    var c = (homeMetrics && homeMetrics.cards) || {};
    function card(key) { return c[key] || KPI_UNAVAILABLE; }

    if (homeMetrics && homeMetrics.provider) {
      return '<div class="tma-dash__cards">' +
        kpiCard('blue', 'Active CIP Applications', 'FilePlus', card('cipActive')) +
        kpiCard('purple', 'CIP Updates Required', 'WarningCircle', card('cipUpdatesRequired')) +
        kpiCard('blue', 'Unread Messages', 'ChatsCircle', card('unreadMessages')) +
        kpiCard('purple', 'Open Comments', 'ChatText', card('openComments')) +
        '</div>';
    }

    return '<div class="tma-dash__cards">' +
      kpiCard('blue', 'Avg. Response to Clients', 'ClockCountdown', card('clientResponse')) +
      kpiCard('purple', 'New CIP Applications', 'FilePlus', card('cipNew')) +
      kpiCard('blue', 'CIP Updates Required', 'WarningCircle', card('cipUpdatesRequired')) +
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
  var homeFilesAt = 0;

  /*
   * Whether each tile's state came from the SERVER, as opposed to a failed
   * fetch marking the tile "loaded" with nothing so the skeleton comes down.
   * Hydration keys on this, never on the loaded flags: a dead network races
   * the store read and loses the board otherwise, the loader fails fast,
   * stamps loaded-empty, and a guard on "loaded" then throws the snapshot
   * away in favour of an empty tile.
   */
  var homeReal = { files: false, metrics: false, staff: false, email: false, chats: false, cip: false, work: false };

  /*
   * ── Warm boot ─────────────────────────────────────────────────────
   *
   * Every tile below keeps its last answer in the store and starts from it.
   * That is the whole difference between "an app opening" and "a page
   * loading": the board paints exactly what it showed when the app was quit,
   * and the fetches, which every loader already runs as a quiet,
   * diff-before-repaint revalidation, correct it behind the paint. No
   * skeleton, no tiles filling in one by one; the data simply updates, the
   * way a chat app's list does.
   *
   * On the desktop the snapshots survive a restart (IndexedDB); in a browser
   * the store is memory, so this warms in-session navigation and leaves
   * nothing on the disk, the firm's standing decision.
   *
   * Hydration runs at script load, not at mount: the store's memory tier
   * answers in a microtask and the disk tier in a few milliseconds, both
   * long before the dashboard view first mounts, so the first render already
   * has the data and the skeleton branch is never taken.
   */
  function keepWarm(key, value) {
    if (window.TMAStore) window.TMAStore.put('home:' + key, value);
  }

  function hydrateHomeState() {
    if (!window.TMAStore) return;

    var remount = function () {
      var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      if (el && el.isConnected && el.childElementCount) mount(el, { fromLoad: true });
    };

    window.TMAStore.get('home:files').then(function (snap) {
      if (!snap || homeReal.files) return;
      var s = data().state();
      s.recentFiles = snap.recentFiles || [];
      s.folders = s.folders || {};
      s.folders.favorites = snap.favorites || [];
      homeFilesLoaded = true;
      remount();
    });

    window.TMAStore.get('home:metrics').then(function (snap) {
      if (!snap || homeReal.metrics) return;
      homeMetrics = snap;
      homeMetricsLoaded = true;
      remount();
    });

    window.TMAStore.get('home:staff').then(function (snap) {
      if (!snap || homeReal.staff) return;
      // Presence dots a restart old are presence dots, not the truth, the
      // refresh already on its way corrects them, the same as a chat app
      // showing last-known "online" for the first breath after launch.
      homeStaff = snap;
      homeStaffLoaded = true;
      remount();
    });

    window.TMAStore.get('home:email').then(function (snap) {
      if (!snap || homeReal.email) return;
      homeEmail = snap;
      homeEmailLoaded = true;
      remount();
    });

    window.TMAStore.get('home:chats').then(function (snap) {
      if (!snap || homeReal.chats) return;
      homeChats = snap;
      homeChatsLoaded = true;
      remount();
    });

    window.TMAStore.get('home:work').then(function (snap) {
      if (!snap || homeReal.work) return;
      homeWork = snap;
      // Which lists the kept answer holds, or the tiles it does hold would
      // paint a skeleton over rows that are perfectly good until the
      // revalidation lands.
      homeWorkWant = Array.isArray(snap.want) ? snap.want.slice() : [];
      homeWorkLoaded = true;
      remount();
    });

    window.TMAStore.get('home:cip').then(function (snap) {
      if (!snap || homeReal.cip) return;
      // Counts a restart old, corrected by the refetch already on its way —
      // the same bargain the presence dots above make. This is not the cache
      // Buckets forbids: that one is a server holding an answer back for five
      // minutes, this is a first paint that the very next request overwrites.
      homeCip = snap;
      homeCipLoaded = true;
      remount();
    });
  }

  var homeMetricsLoaded = false;
  var homeMetrics = null;
  var homeMetricsInflight = null;
  var homeMetricsAt = 0;

  /*
   * Revalidation windows.
   *
   * Coming back to the Dashboard used to refetch six endpoints unconditionally,
   * and each answer triggered another full render. Nothing on this board
   * changes in the seconds it takes to look at Email and come back, so a
   * revisit inside the window paints what it already has and asks the server
   * nothing. Anything that genuinely changes arrives through TMALive (a file
   * added, a folder renamed) rather than by polling harder.
   */
  var FRESH_MS = 60000;         // Recent Files, Favorites, Default Folders
  var METRICS_FRESH_MS = 300000; // the KPI row is a rolling measurement
  var PRESENCE_FRESH_MS = 20000; // who is online moves faster than anything else
  /* A bucket only moves when an application does, and every CIP write raises
     the live signal this card listens to, so the window is a backstop for the
     changes whose signal we never saw (another firm's officer, a queued job),
     not the way the counts normally arrive. */
  var CIP_FRESH_MS = 30000;

  function stale(at, within) { return (Date.now() - at) > (within || FRESH_MS); }

  // Pending-approvals count, fetched once and reused. It was previously
  // requested on every mount, including the two re-renders each load triggers.
  var pendingUsersCount = null;

  // Inbox unread, same pattern as users. Never invent a number: hide the
  // badge until the first real count arrives (from /portal/mail or the email
  // module), then keep painting from cache so remounts do not flash.
  var inboxUnreadCount = null;
  var inboxUnreadInflight = null;
  var shortcutCountListenersBound = false;

  // `path` from the API is the full ancestor chain ([{id,name}, ...], root
  // first) rather than just the immediate parent's name, join it into one
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
    if (window.TMAFileThumbs) {
      return window.TMAFileThumbs.imgHtml(f, {
        size: 24,
        cls: 'tma-portal-file-row__thumb',
        iconCls: '',
        icon: fileIconSrc(f),
      });
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
    // thumbnails included, would be rewritten onto a different node.
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
    var shown = visibleShortcuts();
    if (!shown.length) return '';

    /*
     * The loading tile is the real tile with the glass taken out: the same
     * 44px box at the same radius, above the same label line, so the grid does
     * not resettle when the counts land. The board's *shape* is already known
     * here — visibleShortcuts() is answered from the boot capability list, not
     * from a request — so the placeholder is the right length as well.
     *
     * The measurements are the stylesheet's, not inline. An inline width
     * outranks anything a selector can say, and the loading tile and the real
     * one have to agree about a number that is written down once.
     */
    if (!homeFilesLoaded) {
      var tile = '<div class="tma-portal-shortcut tma-portal-shortcut--skeleton" aria-hidden="true">' +
        '<span class="tma-portal-shortcut__icon tma-skeleton"></span>' +
        '<span class="tma-skeleton tma-skeleton--text"></span></div>';
      return tileShell(
        'shortcuts', 'panel-shortcuts', 'Shortcuts', panelHead('Shortcuts'),
        '<div class="tma-portal-shortcuts">' + new Array(shown.length).fill(tile).join('') + '</div>',
        '', true
      );
    }

    return tileShell(
      'shortcuts', 'panel-shortcuts', 'Shortcuts', panelHead('Shortcuts'),
      '<div class="tma-portal-shortcuts">' +
      shown.map(function (sc) {
        /*
         * The id is a class as well as a hook. It is what portal.css hangs
         * this tile's glyph and ink on — see the note on SHORTCUTS above for
         * why the art cannot be named here — and the ids are a fixed
         * vocabulary in that array, so nothing arbitrary reaches the markup.
         */
        return '<button type="button" class="tma-portal-shortcut tma-portal-shortcut--' + ui().esc(sc.id) +
          '" data-home-shortcut="' + ui().esc(sc.id) + '">' +
          '<span class="tma-portal-shortcut__icon">' +
          '<span class="tma-portal-shortcut__art" aria-hidden="true"></span>' +
          (sc.count ? '<span class="tma-portal-shortcut__count" data-home-shortcut-count="' + sc.count + '" hidden></span>' : '') +
          '</span>' +
          '<span class="tma-portal-shortcut__label">' + ui().esc(sc.label) + '</span></button>';
      }).join('') +
      '</div>'
    );
  }

  /* Staff team board, online / offline + today's work-plan status. */
  var homeStaffLoaded = false;
  var homeStaff = null;
  var homeStaffInflight = null;
  var homeStaffTimer = null;
  var homeStaffAt = 0;
  var homeStaffUserBound = false;

  function avatarSrcFor(person) {
    if (window.TMACurrentUser && window.TMACurrentUser.avatarSrc) {
      return window.TMACurrentUser.avatarSrc(person.avatar, person.name);
    }
    return person.avatar || 'images/avatars/Avatar3d01.png';
  }

  /* Presence chips are Online / Offline only, the work plan (in office,
     remote, leave) lives on the row subtitle, not on the badge. */
  function presenceBadge(p) {
    if (p.statusLabel) {
      var tone = p.status === 'offline' ? 'offline' : 'online';
      if (p.status === 'on_call' || p.status === 'do_not_disturb') tone = 'busy';
      return { tone: tone, label: p.statusLabel };
    }
    if (!p.online) return { tone: 'offline', label: 'Offline' };
    return { tone: 'online', label: 'Online' };
  }

  /* "Last seen 5 minutes ago", re-derived from the instant so it stays true
     between the 30-second polls. Falls back to the server's sentence for
     anyone who hides their last-seen (they send no timestamp). */
  function lastSeenLabel(p) {
    if (window.TMAPresence && (p.statusLabel || p.status)) {
      return window.TMAPresence.labelFor(p);
    }
    if (window.TMALastSeen) return window.TMALastSeen.forPresence(p);
    return p.online ? 'Online' : (p.lastSeen || 'Last seen recently');
  }

  /*
   * Message / voice / video, on hover.
   *
   * The board answers "who is around?" and the obvious next thing to do about
   * an answer is reach them, which previously meant leaving the Dashboard,
   * opening Messages and searching for the person by name.
   *
   * Rendered for every row rather than only the hovered one, and hidden in CSS:
   * building them on mouseenter would mean a DOM write per pointer move, and
   * the row would have no keyboard path to them at all. They are real buttons,
   * so Tab reaches them and :focus-within reveals them.
   *
   * Not on your own row, there is nobody to call.
   */
  var EMPLOYEE_ACTIONS = [
    { key: 'message', icon: 'ChatCircle', label: 'Message' },
    { key: 'audio', icon: 'Phone', label: 'Voice call' },
    { key: 'video', icon: 'VideoCamera', label: 'Video call' },
  ];

  function employeeActionsHtml(p) {
    if (p.self) return '';

    return '<span class="tma-portal-employee__actions">' +
      EMPLOYEE_ACTIONS.map(function (a) {
        var title = a.label + ' ' + (p.firstName || p.name || '');
        return '<button type="button" class="tma-portal-employee__action"' +
          ' data-home-employee-action="' + a.key + '"' +
          ' data-home-employee="' + ui().esc(p.id) + '"' +
          ' title="' + ui().esc(title.trim()) + '"' +
          ' aria-label="' + ui().esc(title.trim()) + '">' +
          '<img src="images/icons/phosphor/' + a.icon + '.svg" alt="" width="16" height="16">' +
          '</button>';
      }).join('') +
      '</span>';
  }

  /**
   * Reach a colleague from the board.
   *
   * All three go through Messages: a call needs a *conversation*, and this
   * board knows a person. Messages resolves the direct thread and then rings —
   * see startConversationWith in messages.js.
   */
  function openEmployeeAction(userId, action) {
    navigate({
      navId: 'so-messages',
      view: 'messages',
      title: 'Messages',
      crumb: 'Messages',
      openDirectUserId: userId,
      startCall: action === 'audio' || action === 'video' ? action : null,
    });
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
    // Identity/API may still be loading, show a skeleton rather than vanishing.
    // The server is the source of truth for staff vs client (`staff: false`).
    if (!homeStaffLoaded) return employeesSkeleton();

    if (!homeStaff || homeStaff.staff === false) return '';

    /*
     * Sorted here, not just trusted from the server. The payload arrives in
     * this order, but presence then moves under a list that is already on
     * screen: somebody coming online has to rise to the top on the event, not
     * on the next poll. A copy, so the kept snapshot is left as the server
     * sent it.
     */
    var people = (homeStaff.employees || []).slice();
    if (window.TMAPresence && window.TMAPresence.compare) people.sort(window.TMAPresence.compare);

    var onlineCount = people.filter(function (p) { return p.online; }).length;
    var rows = people.map(function (p) {
      var badge = presenceBadge(p);
      var sub = lastSeenLabel(p);

      return '<div class="tma-portal-employee" data-key="employee-' + ui().esc(p.id) + '">' +
        '<span class="tma-portal-employee__avatar' + (p.online ? ' is-online' : ' is-offline') + '">' +
        '<img src="' + ui().esc(avatarSrcFor(p)) + '" alt="" width="36" height="36" loading="lazy">' +
        '</span>' +
        '<span class="tma-portal-employee__meta">' +
        '<span class="tma-portal-employee__name">' + ui().esc(p.name) + (p.self ? ' (you)' : '') + '</span>' +
        '<span class="tma-portal-employee__sub">' + ui().esc(sub) + '</span>' +
        '</span>' +
        employeeActionsHtml(p) +
        '<span class="tma-portal-employee__badge tma-portal-employee__badge--' + badge.tone + '">' +
        ui().esc(badge.label) +
        '</span></div>';
    }).join('');

    return tileShell(
      'employees', 'panel-employees', 'Employees',
      panelHead('Employees', onlineCount + ' of ' + people.length + ' online'),
      // A fixed-height list that scrolls, rather than a card that grows with
      // the payroll: the board stays the same size at 4 employees and at 40.
      '<div class="tma-portal-employees tma-portal-employees--scroll">' +
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
  var homeEmailAt = 0;

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
      homeEmailAt = Date.now();
      homeEmail = payload;
      if (payload && payload.real) { homeReal.email = true; keepWarm('email', payload); }
      if (changed && el && el.isConnected) mount(el, { fromLoad: true });
    }

    homeEmailInflight = fetch('/portal/mail', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (index) {
        if (!index) {
          // The network failed, this is the skeleton coming down, not an
          // answer, so it is neither kept nor allowed to outrank the kept.
          finish({ connected: true, messages: (homeEmail && homeEmail.messages) || [] });
          return null;
        }
        if (index.connected === false) {
          finish({ connected: false, messages: [], real: true });
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
              real: !!json,
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

  /* Recent chats for the home dashboard, the top of the Messages list. */
  var HOME_CHAT_LIMIT = 5;
  var homeChatsLoaded = false;
  var homeChats = null;
  var homeChatsInflight = null;
  var homeChatsTimer = null;
  var homeChatsAt = 0;

  // Real photos only; where a conversation has none the initials tile stands
  // in, exactly as the Messages list does.
  function chatAvatarSrc(c) {
    if (c.photo) return c.photo;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsFor) {
      return window.TMACurrentUser.initialsFor(c.name || '?');
    }
    return '';
  }

  function chatMemberSrc(member) {
    if (member && member.photo) return member.photo;
    var name = (member && member.name) || '?';
    if (window.TMACurrentUser && window.TMACurrentUser.initialsFor) {
      return window.TMACurrentUser.initialsFor(name, name);
    }
    return '';
  }

  function chatAvatarHtml(c) {
    var online = !!(c.presence && c.presence.online);
    if (c.type === 'group') {
      var members = (c.members || []).slice();
      var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
      if (members.length < 2 && me && (me.name || me.avatar)) {
        members = members.concat([{ name: me.name, photo: me.photo || me.avatar }]);
      }
      members.sort(function (a, b) {
        return (a.photo ? 0 : 1) - (b.photo ? 0 : 1);
      });
      members = members.slice(0, 2);
      if (members.length) {
        return '<span class="tma-portal-chat-row__avatar tma-portal-chat-row__avatar--group">' +
          members.map(function (member, i) {
            return '<img class="tma-portal-chat-row__avatar-part tma-portal-chat-row__avatar-part--' +
              (i + 1) + '" src="' + ui().esc(chatMemberSrc(member)) + '" alt="" width="24" height="24" loading="lazy">';
          }).join('') +
          '</span>';
      }
    }
    return '<span class="tma-portal-chat-row__avatar' + (online ? ' is-online' : '') + '">' +
      '<img src="' + ui().esc(chatAvatarSrc(c)) + '" alt="" width="32" height="32" loading="lazy">' +
      '</span>';
  }

  function chatName(c) {
    if (c.name && c.name !== 'Group') return c.name;
    var names = (c.members || []).map(function (m) { return m.name; }).filter(Boolean);
    if (names.length) return names.join(', ');
    return c.name || 'Chat';
  }

  function chatCountLabel(c) {
    var label = c.presence && c.presence.label;
    if (label && !/^group chat$/i.test(String(label).trim())) return label;
    var n = parseInt(c.memberCount, 10) || 0;
    if (!n) return '';
    return n === 1 ? '1 member' : n + ' members';
  }

  // What the row says under the name, in the order the Messages list uses:
  // an unsent draft, then a reaction, then the last message itself.
  function chatPreview(c) {
    if (c.draft) return 'Draft: ' + c.draft;
    if (c.reactionNote) return c.reactionNote;
    return c.preview || '';
  }

  function renderChats() {
    if (!homeChatsLoaded) {
      return tileShell(
        'messages', 'panel-messages', 'Messages', panelHead('Messages'),
        skeletonFileRows(4), 'tma-portal-panel--messages', true
      );
    }

    var chats = (homeChats && homeChats.chats) || [];
    var unreadTotal = chats.reduce(function (n, c) {
      return n + Math.max(0, parseInt(c.unread, 10) || 0);
    }, 0);

    var rows = chats.map(function (c) {
      var unread = Math.max(0, parseInt(c.unread, 10) || 0);
      var preview = chatPreview(c) || (c.type === 'group' ? chatCountLabel(c) : '');
      return '<button type="button" class="tma-portal-chat-row' +
        (unread || c.markedUnread ? ' is-unread' : '') + '"' +
        ' data-key="chat-' + ui().esc(c.id) + '"' +
        ' data-home-chat="' + ui().esc(c.id) + '">' +
        chatAvatarHtml(c) +
        '<span class="tma-portal-chat-row__meta">' +
        '<span class="tma-portal-chat-row__top">' +
        '<span class="tma-portal-chat-row__name">' + ui().esc(chatName(c)) + '</span>' +
        '<span class="tma-portal-chat-row__time">' + ui().esc(c.time || '') + '</span>' +
        '</span>' +
        '<span class="tma-portal-chat-row__preview">' + ui().esc(preview) + '</span>' +
        '</span>' +
        (unread
          ? '<span class="tma-portal-chat-row__unread">' + (unread > 99 ? '99+' : unread) + '</span>'
          : '') +
        '</button>';
    }).join('');

    return tileShell(
      'messages', 'panel-messages', 'Messages',
      panelHead('Messages', unreadTotal ? unreadTotal + ' unread' : ''),
      rows
        ? '<div class="tma-portal-chat-list">' + rows + '</div>'
        : '<p class="tma-portal-panel__note">No conversations yet.</p>' +
          '<button type="button" class="tma-portal-link" data-home-chat-open>Open Messages</button>',
      'tma-portal-panel--messages'
    );
  }

  function chatsPayloadSignature(payload) {
    if (!payload) return '';
    return (payload.chats || []).map(function (c) {
      return [
        c.id, c.unread || 0, c.markedUnread ? 1 : 0, c.time || '',
        chatPreview(c), (c.presence && c.presence.online) ? 1 : 0,
      ].join(':');
    }).join('|');
  }

  function loadHomeChats(el, opts) {
    opts = opts || {};
    if (homeChatsInflight) return;

    function finish(payload) {
      homeChatsInflight = null;
      var changed = !homeChatsLoaded ||
        chatsPayloadSignature(payload) !== chatsPayloadSignature(homeChats);
      homeChatsLoaded = true;
      homeChatsAt = Date.now();
      homeChats = payload;
      if (payload && payload.real) { homeReal.chats = true; keepWarm('chats', payload); }
      if (changed && el && el.isConnected) mount(el, { fromLoad: true });
    }

    homeChatsInflight = fetch('/portal/messaging/conversations', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (json) {
        if (!json || !Array.isArray(json.conversations)) {
          // A failed refresh keeps the rows already on screen rather than
          // blanking the tile.
          finish({ chats: (homeChats && homeChats.chats) || [] });
          return;
        }
        // Archived chats are off the Messages list, so they are off this tile
        // too. The server already sorts pinned first, then by recency.
        finish({
          real: true,
          chats: json.conversations.filter(function (c) { return !c.archived; })
            .slice(0, HOME_CHAT_LIMIT),
        });
      })
      .catch(function () {
        homeChatsInflight = null;
        if (!homeChatsLoaded) {
          homeChatsLoaded = true;
          homeChats = { chats: [] };
          if (el && el.isConnected) mount(el, { fromLoad: true });
        }
      });

    // Messaging has no shell-wide realtime listener, only the Messages view
    // subscribes, so the tile polls while the dashboard is open.
    if (!homeChatsTimer && !opts.skipTimer) {
      homeChatsTimer = setInterval(function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        if (document.visibilityState === 'hidden') return;
        if (homeChatsInflight) return;
        loadHomeChats(mountEl, { skipTimer: true });
      }, 60000);
    }

    if (!window.__tmaHomeChatsLiveBound) {
      window.__tmaHomeChatsLiveBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        loadHomeChats(mountEl, { skipTimer: true });
      });
    }
  }

  /*
   * ── CIP Applications ──────────────────────────────────────────────
   *
   * §9's buckets, counted, as one list. The applications table filters by
   * exactly these keys through exactly this endpoint, so a row here and the
   * list it opens cannot end up disagreeing about what "Pending Review" means:
   * the count and the filter are one definition read twice, in
   * App\Support\Cip\Buckets.
   *
   * Which set arrives is the server's decision and this card does not second
   * guess it: an administrator gets the ten the firm reports on, a Reviewing
   * Officer and a Compliance Officer get their four work queues, and a Service
   * Provider contact gets the applicant-facing six. The card renders whatever
   * came back, in the order it came back in.
   *
   * A private client never sees this card. They share the service-provider set
   * with the contact, so the dashboard name cannot decide it, the server
   * answers with `card`.
   */
  var homeCipLoaded = false;
  var homeCip = null;
  var homeCipInflight = null;
  var homeCipAt = 0;

  /*
   * The five-tone status vocabulary (App\Support\Cip\Status), whitelisted here
   * because the tone is interpolated into a class name and an unrecognised
   * value must fall back rather than travel into the markup.
   *
   * A bucket with nothing in it is neutral whatever tone the server gave it.
   * The colour is the only part of a row that claims the reader has something
   * to do about it, and "Updates Required 0" has nothing behind it, the row
   * stays, because zero is a true answer worth reading, but it stops shouting.
   *
   * The greyed dot is the whole of what a zero earns. The row used to carry a
   * `--empty` class as well, which no stylesheet defined and nothing read; the
   * only thing such a hook could ever do is dim or flag a row for being empty,
   * and an empty queue is the answer an administrator opened the card hoping
   * for, not a fault to draw the eye to. It is not emitted any more.
   */
  var CIP_TONES = [
    'success', 'danger', 'pending', 'action', 'neutral',
    'sky', 'indigo', 'violet', 'amber', 'teal', 'orange', 'rose', 'cyan', 'copper',
  ];

  function cipCardVisible(payload) {
    if (!payload || payload.cip === false) return false;
    if (payload.card === true) return true;
    if (payload.card === false) return false;
    // Warm snapshot from before `card` existed: staff was the gate.
    return payload.staff === true;
  }

  function cipTone(bucket) {
    if (!bucket.count) return 'neutral';
    return CIP_TONES.indexOf(bucket.tone) === -1 ? 'neutral' : bucket.tone;
  }

  /* Thousands separated, and zeros written out. formatShortcutCount hides a
     zero because an empty badge is the honest shortcut; here the zero IS the
     answer somebody came to the card for. */
  function cipCount(n) {
    n = Math.max(0, parseInt(n, 10) || 0);
    try { return n.toLocaleString('en-US'); } catch (e) { return String(n); }
  }

  function cipSkeleton() {
    /*
     * A bar and four legend rows, and no placeholder for the total: it lives
     * in the heading now, which the loading card simply leaves without one
     * rather than shimmering a number-shaped blank beside a real title.
     *
     * The bar is one grey block rather than segments, and the reason is the same one the rows have always had: a
     * shape that could be read as an answer must not stand in for one that has
     * not arrived. Ten grey slivers are what a *finished* card with nothing in
     * it would look like.
     *
     * Four legend rows because the sets are four, six and ten long and how
     * many of them hold work is exactly what is unknown; four is roughly a
     * working day and being wrong costs a re-pack of the board. Warm boot
     * means a returning reader paints their real set and never sees this.
     *
     * The placeholders sit straight in the row: there is nothing to press yet,
     * so there is no button. That matters beyond tidiness — a
     * .tma-portal-cip__link wrapper would hand the loading rows the link's
     * pointer cursor, so rows nobody can click would invite the click.
     * dashboard.css gives the row itself the padding and gap the link would
     * have supplied (.tma-portal-cip__row:has(> .tma-skeleton)).
     *
     * No inline sizes. The stylesheet owns every measurement here, an inline
     * width outranks it, and the two were quietly disagreeing about how wide a
     * placeholder label is. --avatar is what keeps the dot round: .tma-skeleton
     * loads after dashboard.css and would otherwise square it off with its own
     * 6px radius.
     */
    var row = '<li class="tma-portal-cip__row" aria-hidden="true">' +
      '<i class="tma-portal-cip__dot tma-skeleton tma-skeleton--avatar"></i>' +
      '<span class="tma-skeleton tma-skeleton--text"></span>' +
      '</li>';

    return tileShell(
      'cipStatus', 'panel-cip', 'CIP Applications', panelHead('CIP Applications'),
      '<div class="tma-portal-cip-card" aria-hidden="true">' +
      '<p class="tma-portal-cip__stack-skeleton tma-skeleton"></p>' +
      '<ul class="tma-portal-cip">' + new Array(4).fill(row).join('') + '</ul>' +
      '</div>',
      'tma-portal-panel--cip',
      true
    );
  }

  /*
   * The buckets that are parts of the whole.
   *
   * A stacked bar can only be drawn from buckets that do not contain each
   * other, and one of §9's does: the Reviewing Officer's Assigned Reviews is
   * deliberately the sum of the three queues under it. Given a share of the
   * bar alongside its own children it would draw every file on that officer's
   * desk twice and the segments would add up to 200%.
   *
   * The server answers which one that is (App\Support\Cip\Buckets::rollsUp),
   * because it is a fact about the shape of the set rather than something to
   * infer from the counts: on a quiet day the roll-up and one of its children
   * hold the same number, and a browser guessing from that would drop a
   * different bucket each morning. A payload that has not been asked the
   * question — a warm snapshot written by an older release — has no flag and
   * every bucket is treated as a part, which is right for two of the three
   * sets and settles for the third the moment the fetch behind it lands.
   */
  function cipParts(buckets) {
    return buckets.filter(function (b) { return b.aggregate !== true; });
  }

  /*
   * What the bar is a hundred per cent of.
   *
   * The server's total when it sent one, and it and the parts agree by
   * construction — the total is counted over the same statuses the parts
   * divide between them. Falling back to adding the parts up is safe for the
   * same reason, and is not the trap the old code had: it is the *whole*
   * bucket list that cannot be summed, because of the roll-up now filtered out
   * above.
   */
  function cipTotal(payload, parts) {
    var total = payload.total;

    if (typeof total === 'number' && isFinite(total) && total >= 0) return total;

    return parts.reduce(function (sum, b) { return sum + (parseInt(b.count, 10) || 0); }, 0);
  }

  /* One decimal, so ten shares of an awkward total do not drift far enough
     from 100 to leave a gap at the end of the bar. */
  function cipShare(count, total) {
    if (!total) return 0;
    return Math.round((count / total) * 1000) / 10;
  }

  /*
   * The same share, written out for the legend: whole per cent, and never a
   * rounded-down zero.
   *
   * "0%" beside a stage that is in the legend at all would be a plain
   * contradiction — only stages holding work get a row — so a share too small
   * to round up says "<1%" instead. It happens at one application in more than
   * two hundred, which a firm's whole book reaches.
   *
   * Whole numbers cost the column its last decimal and the ten of them can
   * therefore come to 99 or 101. That is the ordinary arithmetic of a
   * percentage legend and is preferable to "9.4%" ten times over; the exact
   * figures are the total above and the counts on each row's title.
   */
  function cipPercent(count, total) {
    var share = cipShare(count, total);

    if (count > 0 && share < 0.5) return '<1%';

    return Math.round(share) + '%';
  }

  /*
   * The bar: every stage holding work, as its share of the total, in the order
   * §9 names them.
   *
   * Widths are shares and the numbers inside are counts, which is the division
   * of labour the whole layout rests on — the bar answers "how is the work
   * split" at a glance and the legend under it answers "how much" exactly.
   * A number is only printed where its segment is wide enough to hold it;
   * below that the segment is a plain block and its count is in the legend,
   * because a digit clipped in half reads as a fault rather than as a small
   * number. Every segment carries its name and count either way, for the
   * pointer and for a screen reader.
   *
   * Each is a button, like the rows: a share is only useful if the reader can
   * open what it is a share of.
   */
  function cipStack(busy, total) {
    return '<div class="tma-portal-cip__stack" role="group" aria-label="Applications by stage">' +
      busy.map(function (b) {
        var share = cipShare(b.count, total);
        var name = b.label + ': ' + cipCount(b.count);

        return '<button type="button" class="tma-portal-cip__seg tma-portal-cip__tone--' + cipTone(b) + '"' +
          ' style="--tma-cip-share:' + share + '%"' +
          ' data-home-cip-bucket="' + ui().esc(b.key) + '"' +
          ' title="' + ui().esc(name) + '" aria-label="' + ui().esc(name) + '">' +
          (share >= 12 ? '<span aria-hidden="true">' + ui().esc(cipCount(b.count)) + '</span>' : '') +
          '</button>';
      }).join('') +
      '</div>';
  }

  /*
   * The legend: the short name and the share, two to a line.
   *
   * A share rather than a count, because the count is the one thing the row is
   * sitting next to a picture of. The bar says which stage is biggest; what it
   * cannot say is *how much* biggest, and "19%" against "3%" answers that in a
   * way two blocks of colour cannot. The exact numbers are not lost — the
   * total is stated above, the wider blocks carry theirs, and every row's
   * title and label say it in full.
   *
   * The short name is the server's (App\Support\Cip\Buckets) rather than
   * something cut down here — "Additional Information Requests" has to fit
   * half a third-width card, and a browser shortening it by rule would be
   * guessing where a name can be cut. `label` is the fallback for a snapshot
   * taken before the field existed; it wraps rather than lying.
   *
   * The accessible name carries the visible per cent as well as the count, so
   * a screen reader is told what the sighted reader is looking at rather than
   * a different fact about the same row.
   *
   * The tone is set on the row and the dot inherits it, because the block
   * above reads the same variable: a colour named twice is a colour that can
   * end up disagreeing with itself, and here the two are how a reader knows
   * which block of the bar is which.
   */
  function cipLegendRow(bucket, total) {
    var percent = cipPercent(bucket.count, total);
    var name = bucket.label + ': ' + cipCount(bucket.count) + ' (' + percent + ')';

    return '<li class="tma-portal-cip__row tma-portal-cip__tone--' + cipTone(bucket) +
      '" data-key="cip-' + ui().esc(bucket.key) + '">' +
      '<button type="button" class="tma-portal-cip__link" data-home-cip-bucket="' + ui().esc(bucket.key) + '"' +
      ' title="' + ui().esc(name) + '" aria-label="' + ui().esc(name) + '">' +
      '<i class="tma-portal-cip__dot" aria-hidden="true"></i>' +
      '<span class="tma-portal-cip__label">' + ui().esc(bucket.short || bucket.label) + '</span>' +
      '<span class="tma-portal-cip__share">' + ui().esc(percent) + '</span>' +
      '</button></li>';
  }

  /*
   * The stages holding nothing, as chips.
   *
   * They keep their name and their press and lose everything else, which is
   * the whole of what a zero earns: an empty queue is a true answer and a
   * reasonable thing to open, and a reader who cannot open it has to go and
   * confirm the zero some other way. Dropping them instead would leave a card
   * that cannot say whether a stage is empty or missing.
   */
  function cipChips(clear) {
    if (!clear.length) return '';

    return '<div class="tma-portal-cip__chips">' +
      clear.map(function (b) {
        return '<button type="button" class="tma-portal-cip__chip"' +
          ' data-home-cip-bucket="' + ui().esc(b.key) + '"' +
          ' title="' + ui().esc(b.label + ': ' + cipCount(b.count)) + '"' +
          ' aria-label="' + ui().esc(b.label + ': ' + cipCount(b.count)) + '">' +
          ui().esc(b.short || b.label) +
          '</button>';
      }).join('') +
      '</div>';
  }

  function renderCipStatus() {
    /*
     * The skeleton is withheld from a reader we already know will not be given
     * a card. /me settles well before this payload does, and six shimmering
     * rows that resolve into nothing would have announced a module to somebody
     * who does not have one, the exact thing the silences below are careful
     * not to do. The KPI row and Employees both shimmer first and vanish
     * second, which is right for them: those two are *staff* only, and the
     * board they sit on is the staff board, so the flash is rare. This card is
     * staff only AND CIP only, and its readers are the smaller set.
     *
     * One-sided on purpose. Only a positive "this is a client" suppresses it;
     * an unloaded /me (null) still shimmers, so identity arriving late costs a
     * staff reader nothing. And this can only ever withhold a placeholder —
     * the card itself is the server's decision, taken below on data that has
     * landed, so a wrong guess here cannot hide anybody's queues.
     */
    if (!homeCipLoaded) return isStaffUser() === false ? '' : cipSkeleton();

    /*
     * Three different silences, and all of them are the right answer.
     *
     * `cip: false` is the server saying the module is not this reader's, the
     * same answer /portal/dashboard/metrics gives a client account asking for
     * staff KPIs, and it is honoured the same way: no card, no explanation,
     * nothing to dismiss.
     *
     * `card: false` is that courtesy asked a second question. The module IS
     * for the external side: a provider contact and a private client both
     * reach it through their own applications, and only the contact is offered
     * this summary. They share a dashboard name, so the server answers with
     * `card` rather than leaving the browser to infer it from `dashboard`.
     *
     * Drawn only on a positive answer, where the KPI row tests for the
     * negative. The difference is the warm store: a payload carrying no
     * `card` key at all is a snapshot written by a release that had not been
     * asked the question, and treating silence as consent would paint the card
     * for exactly the reader it was taken away from. `cipCardVisible` falls
     * back to `staff` for that snapshot.
     *
     * A failed request lands here too, holding nothing, and it has to be
     * silent for a reason the KPI row does not have. The KPI row knows its
     * four labels and can show em-dashes under them; here the labels, the
     * counts AND whether this reader has CIP at all were all in the answer
     * that never came. An error note would announce a module to people who do
     * not have one, which is a worse lie than saying nothing. The loader
     * leaves homeCipAt at zero, so the next mount, live signal or pull-to-
     * refresh asks again and the card appears the moment there is something
     * true to put in it.
     */
    if (!cipCardVisible(homeCip)) return '';

    var buckets = homeCip.buckets || [];
    if (!buckets.length) return '';

    /*
     * The order is the server's, top to bottom, and nothing here re-sorts it.
     *
     * §9 lists the buckets in the order an application travels through them,
     * and that order is the brief's rather than a renderer's choice. It is
     * also what makes the bar readable: the blocks run in the order work moves
     * through them, so a pipeline weighted toward the end looks different from
     * one weighted toward the start. Sorting the biggest share to the front
     * would throw that away and leave a chart that says only "some are bigger
     * than others", which the numbers already said.
     *
     * Rows are keyed by bucket so morph leaves an unchanged one alone: the
     * counts are re-read on every CIP signal and most will not have moved.
     */
    var parts = cipParts(buckets);
    var total = cipTotal(homeCip, parts);
    var busy = parts.filter(function (b) { return b.count > 0; });
    var clear = parts.filter(function (b) { return !b.count; });

    /*
     * The total sits in the heading, beside the card's name.
     *
     * It used to be a figure of its own under a line saying what the counts
     * were measured over ("All applications", "Assigned to you", "Your firm").
     * One line now carries both jobs: the name says what this is and the
     * number says how much of it there is, which is what a reader glancing at
     * the board wants in the fewest words.
     *
     * The bar underneath still needs a stated total — it is what the blocks
     * are a hundred per cent of — and this is it; there is no second copy
     * lower down printing the same number twice.
     */
    return tileShell(
      'cipStatus', 'panel-cip', 'CIP Applications',
      panelHead('CIP Applications', cipCount(total)),
      '<div class="tma-portal-cip-card">' +
      (busy.length
        ? cipStack(busy, total) +
          '<ul class="tma-portal-cip">' +
          busy.map(function (b) { return cipLegendRow(b, total); }).join('') +
          '</ul>'
        // Every stage clear, which is a finished day rather than an empty
        // card — so it says so, instead of leaving a bar with nothing in it.
        : '<p class="tma-portal-cip__none">Nothing waiting right now</p>') +
      cipChips(clear) +
      '</div>',
      'tma-portal-panel--cip'
    );
  }

  /*
   * The counts, re-read rather than adjusted by hand.
   *
   * Buckets are uncached server-side on purpose, an officer who clears a file
   * and watches the number sit still concludes the portal is broken, so the
   * only thing between a status change and this card is the window below, and
   * the `cip` live signal that every CIP write already raises cuts through it.
   *
   * A failed refresh keeps the counts already on screen, exactly like the KPI
   * row: the previous answer was true a minute ago, and a card that empties
   * itself because one request timed out is worse than one that is a minute
   * behind. Only the very first attempt has nothing to fall back on.
   */
  function loadHomeCip(el) {
    if (homeCipInflight) return;

    var before = JSON.stringify(homeCip || null);

    homeCipInflight = fetch('/portal/cip/dashboard', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        homeCip = j;
        homeCipAt = Date.now();
        homeReal.cip = true;
        keepWarm('cip', j);
      })
      .catch(function () {})
      .then(function () {
        homeCipInflight = null;
        var wasLoaded = homeCipLoaded;
        homeCipLoaded = true;
        // Same counts, same rows, leave the card alone. Every loader on this
        // board answers on every visit, and each answer used to repaint it.
        if ((!wasLoaded || JSON.stringify(homeCip || null) !== before) && el.isConnected) {
          mount(el, { fromLoad: true });
        }
      });
  }

  /**
   * Open the CIP applications table, filtered to one bucket.
   *
   * The view first, the filter second, and that order is what makes it safe
   * both ways round. navigate() activates the clients view and settles its URL
   * synchronously, so by the time openBucket runs there is a table to narrow;
   * and when there isn't one, the view has never been mounted in this session
   *, openBucket parks the key for the mount to pick up, the way the tab and
   * folder position is parked. The other order is the one that breaks:
   * navigate's own URL sync would land last and drop the ?bucket= the filter
   * had just written, so a reload would come back unfiltered.
   *
   * Guarded on openBucket because clients.js is a separate bundle: without it
   * the row still opens the unfiltered table, which is the smaller failure.
   */
  function openCipBucket(key) {
    navigate({
      navId: 'clients',
      view: 'clients',
      title: 'CIP Applications',
      crumb: 'CIP Applications',
      clientsScreen: 'list',
    });
    if (window.TMAClients && window.TMAClients.openBucket) {
      window.TMAClients.openBucket(key);
    }
  }

  /* ── Requests & Comments ───────────────────────────────────────────
   *
   * The Workflows section's two default tabs, on the board: what is waiting on
   * you, and the latest discussion that concerns you.
   *
   * Both tiles are drawn from one request. They are gated by the same
   * capability, refresh on the same signal, and the server builds them from
   * the same reads the Workflows page uses, so a row here and the page it
   * opens onto can never disagree about what is yours. A tile the reader
   * turned off is left out of the `want` list and costs nothing.
   */
  var homeWorkLoaded = false;
  var homeWork = null;
  var homeWorkInflight = null;
  var homeWorkTimer = null;
  var homeWorkAt = 0;
  /* Which lists the answer we are holding was actually built from. A tile
     switched on after the last request went out has an empty list for a
     reason that is nothing to do with the reader, and must not say so. */
  var homeWorkWant = [];
  var homeWorkRetry = false;

  /* Comments and requests are not broadcast on any live channel, so the board
     polls, at the same cadence as presence and the inbox. */
  var WORK_FRESH_MS = 60000;

  /* Short enough to sit at the end of a row: "just now", "12 min ago",
     "3h ago", "5d ago". Same shape the File Library's sync line uses. */
  function workAgo(iso) {
    if (!iso) return '';
    var secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(secs)) return '';
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.round(secs / 60) + ' min ago';
    if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
    return Math.round(secs / 86400) + 'd ago';
  }

  /* The file a row is about, and the way back to it. Both halves are needed:
     the File Library loads a folder, then looks for the file inside it. */
  function workFileAttrs(file) {
    if (!file || !file.id) return '';
    return ' data-home-work-file="' + ui().esc(file.id) + '"' +
      (file.folderId ? ' data-home-work-folder="' + ui().esc(file.folderId) + '"' : '');
  }

  function workAvatarHtml(person, cls) {
    var src = avatarSrcFor(person || {});
    return '<img class="' + cls + '" src="' + ui().esc(src) + '" alt="" width="32" height="32" loading="lazy">';
  }

  function commentRow(c) {
    var file = c.file || {};
    var body = c.deleted ? 'This comment was deleted.' : (c.body || '');

    /*
     * Read state comes from the server per row, and the listing asking for it
     * does not spend it — see Hub::comments. A resolved thread is settled
     * rather than new, so it reads as read whatever the marker says.
     */
    var unread = c.unread !== false && !c.resolved;

    return '<button type="button" class="tma-portal-comment-row' +
      (unread ? ' is-unread' : '') + '"' +
      ' data-key="work-comment-' + ui().esc(c.id) + '"' +
      ' data-home-work-comment="' + ui().esc(c.id) + '"' +
      workFileAttrs(file) + '>' +
      workAvatarHtml(c.author, 'tma-portal-comment-row__avatar') +
      '<span class="tma-portal-comment-row__meta">' +
      '<span class="tma-portal-comment-row__top">' +
      '<span class="tma-portal-comment-row__author">' +
      ui().esc((c.author && c.author.name) || 'Someone') + '</span>' +
      // The dot is decoration; the word is what a screen reader gets, and it
      // comes first so the row announces its state before its contents.
      (unread ? '<span class="tma-portal-comment-row__unread">Unread</span>' : '') +
      '<span class="tma-portal-comment-row__time">' + ui().esc(workAgo(c.createdAt)) + '</span>' +
      '</span>' +
      '<span class="tma-portal-comment-row__body">' + ui().esc(body) + '</span>' +
      (file.name ? '<span class="tma-portal-comment-row__file">' + ui().esc(file.name) + '</span>' : '') +
      '</span></button>';
  }

  /*
   * The reader opened this thread, so it is read.
   *
   * The listing deliberately marks nothing (see Hub::comments), which is what
   * lets a row arrive unread. This is the other half, and it is the same
   * endpoint the Workflows page posts to rather than a second definition of
   * what reading means.
   *
   * `keepalive` because the click that gets here also opens the file, which
   * navigates away in the same tick: an ordinary fetch would be cancelled on
   * the way out and the row would still be unread on the way back.
   */
  function markWorkCommentRead(commentId) {
    if (!commentId || !homeWork) return;

    var row = (homeWork.comments || []).filter(function (c) { return c.id === commentId; })[0];
    if (!row || row.unread === false) return;   // already read; nothing to spend
    row.unread = false;

    var root = window.__TMA_SITE_ROOT || '';

    fetch(root + '/portal/files/workflows/comments/' + encodeURIComponent(commentId) + '/read', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': prefXsrf(),
        // This write signals the reader's own other tabs; the header is what
        // lets toOthers() skip this one, which has already drawn the change.
        'X-Socket-ID': (window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId) || '',
      },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.counts) return;
        homeWork.counts = j.counts;
        keepWarm('work', homeWork);
        publishWorkCounts(j.counts);
        var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (el && el.isConnected) mount(el, { fromLoad: true });
      })
      .catch(function () { /* the badge settles on the next poll */ });
  }

  /* Is this tile's list part of the answer we are holding? */
  function workListReady(id) {
    return homeWorkLoaded && homeWorkWant.indexOf(id) !== -1;
  }

  function renderComments() {
    if (!workListReady('comments')) {
      return tileShell(
        'comments', 'panel-comments', 'Comments', panelHead('Comments'),
        skeletonFileRows(4), 'tma-portal-panel--work', true
      );
    }

    var items = (homeWork && homeWork.comments) || [];
    var unread = homeWork && homeWork.counts ? (homeWork.counts.unread || 0) : 0;
    var rows = items.map(commentRow).join('');

    return tileShell(
      'comments', 'panel-comments', 'Comments',
      panelHead('Comments', unread ? unread + ' unread' : ''),
      rows
        ? '<div class="tma-portal-work-list">' + rows + '</div>'
        : '<p class="tma-portal-panel__note">No comments involving you yet.</p>',
      'tma-portal-panel--work'
    );
  }

  function requestRow(r) {
    var file = r.file || {};
    var headline = r.headline || {};
    var tone = headline.tone === 'action' || headline.tone === 'danger' ? headline.tone : '';

    return '<button type="button" class="tma-portal-request-row"' +
      ' data-key="work-request-' + ui().esc(r.id) + '"' +
      workFileAttrs(file) + '>' +
      workAvatarHtml(r.sender, 'tma-portal-request-row__avatar') +
      '<span class="tma-portal-request-row__meta">' +
      '<span class="tma-portal-request-row__top">' +
      '<span class="tma-portal-request-row__type">' + ui().esc(r.typeLabel || 'Request') + '</span>' +
      '<span class="tma-portal-request-row__time">' + ui().esc(workAgo(r.sentAt)) + '</span>' +
      '</span>' +
      (file.name ? '<span class="tma-portal-request-row__file">' + ui().esc(file.name) + '</span>' : '') +
      '<span class="tma-portal-request-row__headline' +
      (tone ? ' tma-portal-request-row__headline--' + tone : '') + '">' +
      ui().esc(headline.text || r.statusLabel || '') + '</span>' +
      '</span></button>';
  }

  function renderRequests() {
    if (!workListReady('requests')) {
      return tileShell(
        'requests', 'panel-requests', 'Requests', panelHead('Requests'),
        skeletonFileRows(4), 'tma-portal-panel--work', true
      );
    }

    var items = (homeWork && homeWork.requests) || [];
    var waiting = homeWork && homeWork.counts ? (homeWork.counts.waiting || 0) : 0;
    var rows = items.map(requestRow).join('');

    return tileShell(
      'requests', 'panel-requests', 'Requests',
      panelHead('Requests', waiting ? waiting + ' waiting' : ''),
      rows
        ? '<div class="tma-portal-work-list">' + rows + '</div>'
        : '<p class="tma-portal-panel__note">Nothing is waiting on you.</p>',
      'tma-portal-panel--work'
    );
  }

  /* Same rows, same numbers, leave both tiles alone — every loader on this
     board answers on every visit, and each answer would otherwise repaint. */
  function workSignature(payload) {
    if (!payload) return '';
    if (payload.enabled === false) return 'disabled';
    var counts = payload.counts || {};

    return [
      counts.waiting || 0, counts.unread || 0,
      (payload.requests || []).map(function (r) {
        return [r.id, r.status || '', r.answered, ((r.headline || {}).text || '')].join(':');
      }).join('|'),
      (payload.comments || []).map(function (c) {
        return [
          c.id, c.unread === false ? 0 : 1, c.resolved ? 1 : 0,
          c.editedAt || '', c.deleted ? 1 : 0,
        ].join(':');
      }).join('|'),
    ].join('~');
  }

  /* Which tiles are on screen. Asking for a tile the reader turned off is a
     page of rows and a per-file access walk nobody will ever see. */
  function wantedWorkTiles() {
    var show = tiles();
    var want = [];
    if (show.requests !== false) want.push('requests');
    if (show.comments !== false) want.push('comments');
    return want;
  }

  function loadHomeWork(el, opts) {
    opts = opts || {};
    // Returned rather than dropped: TMALive uses the promise to suppress
    // overlapping runs, and a burst of comments is one signal per write.
    if (homeWorkInflight) return homeWorkInflight;

    var want = wantedWorkTiles();
    if (!want.length) return null;

    var before = workSignature(homeWork);

    homeWorkInflight = fetch('/portal/dashboard/work?want=' + want.join(','), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (json) {
        homeWorkInflight = null;
        var wasLoaded = homeWorkLoaded;
        homeWorkLoaded = true;

        if (json) {
          homeWork = json;
          homeWorkWant = Array.isArray(json.want) ? json.want.slice() : want.slice();
          homeWorkAt = Date.now();
          homeReal.work = true;
          keepWarm('work', json);
          publishWorkCounts(json.counts);
        } else if (!homeWork) {
          // A failed request is the skeleton coming down, not an answer: it is
          // neither kept warm nor allowed to outrank what the store held. The
          // tiles settle into their empty state rather than spinning, the same
          // bargain every other tile on this board makes, and the poll behind
          // them corrects it as soon as the network is back.
          homeWork = { enabled: true, want: want.slice(), requests: [], comments: [], counts: null };
          homeWorkWant = want.slice();
        }

        if ((!wasLoaded || workSignature(homeWork) !== before) && el && el.isConnected) {
          mount(el, { fromLoad: true });
        }

        // A tile was switched on while this request was in the air, so what
        // just landed is already the wrong shape. Ask once more, for the board
        // as it is now.
        if (homeWorkRetry) {
          homeWorkRetry = false;
          if (el && el.isConnected) loadHomeWork(el, { skipTimer: true });
        }
      });

    var settled = homeWorkInflight;

    if (!homeWorkTimer && !opts.skipTimer) {
      homeWorkTimer = setInterval(function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        // A hidden tab polling is pure cost; the visibilitychange handler
        // below catches up on the way back.
        if (document.visibilityState === 'hidden') return;
        if (homeWorkInflight) return;
        if (homeWork && homeWork.enabled === false) return;
        loadHomeWork(mountEl, { skipTimer: true });
      }, WORK_FRESH_MS);
    }

    if (!window.__tmaHomeWorkLiveBound) {
      window.__tmaHomeWorkLiveBound = true;

      // The Workflows page republishes these after every answer given there,
      // and answering something is exactly when this board is stale. Our own
      // publish is skipped, or every load would schedule the next one.
      document.addEventListener('tma-workflow-counts', function () {
        if (publishingWorkCounts) return;
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        homeWorkAt = 0;
        loadHomeWork(mountEl, { skipTimer: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        loadHomeWork(mountEl, { skipTimer: true });
      });
    }

    return settled;
  }

  /*
   * A work tile the reader has just switched on.
   *
   * Its list was left out of the last request's `want`, so it is empty because
   * nobody asked for it. Left alone the tile would sit on "Nothing is waiting
   * on you" until the poll came round, which is a wrong answer, not a stale one.
   */
  function refreshWorkForTiles() {
    // Switching one OFF needs nothing: the tile leaves the board and the list
    // we are holding is still correct for the ones that stayed.
    var missing = wantedWorkTiles().some(function (id) {
      return homeWorkWant.indexOf(id) === -1;
    });
    if (!missing) return;

    var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
    if (!el || !el.isConnected) return;

    homeWorkAt = 0;
    if (homeWorkInflight) { homeWorkRetry = true; return; }
    loadHomeWork(el, { skipTimer: true });
  }

  /* Hand the counts to the shell so the Workflows badge agrees with the tiles
     it sits beside — the same event the Workflows page raises.
     Dispatch is synchronous, so the flag is set for exactly the listeners this
     call runs, which is what keeps the listener above off its own tail. */
  var publishingWorkCounts = false;

  function publishWorkCounts(counts) {
    if (!counts) return;
    publishingWorkCounts = true;
    try {
      document.dispatchEvent(new CustomEvent('tma-workflow-counts', { detail: counts }));
    } catch (e) { /* an old engine simply keeps the figure taken at boot */ } finally {
      publishingWorkCounts = false;
    }
  }

  /*
   * Back to the file, with its viewer open.
   *
   * A full navigation rather than an in-place view swap, for the reason the
   * Workflows page gives: the File Library reads the folder and the file from
   * the URL on mount, and there is no way to hand it both through the SPA
   * router without it clearing one of them.
   */
  function openWorkFile(fileId, folderId) {
    if (!fileId) return;
    var root = window.__TMA_SITE_ROOT || '';
    var params = new URLSearchParams();
    if (folderId) params.set('folder', folderId);
    params.set('file', fileId);
    window.location.assign(root + '/folders/all?' + params.toString());
  }

  function renderRoadPanel() {
    if (!window.TMAOverview || !window.TMAOverview.renderRoad) return '';
    return '<div class="tma-portal-panel tma-portal-tile tma-portal-tile--road tma-portal-tile--third"' +
      ' data-tile-id="road" data-tile-span="third" data-key="panel-road" aria-label="Upcoming Events">' +
      window.TMAOverview.renderRoad() +
      '</div>';
  }

  function renderHomeGrid(s, show) {
    var renderers = {
      // A client account has no mailbox: /portal/mail answers 403, so the
      // panel would sit on "No recent messages" for ever. Not drawn at all.
      email: function () {
        return show.email !== false && canReach('mail.use') ? renderEmail() : '';
      },
      messages: function () { return show.messages !== false ? renderChats() : ''; },
      recentFiles: function () { return show.recentFiles ? renderRecentFiles(s) : ''; },
      shortcuts: function () { return show.shortcuts ? renderShortcuts() : ''; },
      employees: function () { return show.employees !== false ? renderEmployees() : ''; },
      favorites: function () { return show.favorites ? renderFavorites(s) : ''; },
      road: function () { return show.road !== false ? renderRoadPanel() : ''; },
      // On unless the reader turned it off, like every tile that shipped after
      // the original board. Whether there is anything to draw is a separate
      // question, and the server answers that one, see renderCipStatus.
      cipStatus: function () { return show.cipStatus !== false ? renderCipStatus() : ''; },
      // Both work tiles live behind the Workflows section's own capability:
      // every row they draw opens onto a page a client account cannot reach.
      requests: function () {
        return show.requests !== false && canReach('workflows.view') ? renderRequests() : '';
      },
      comments: function () {
        return show.comments !== false && canReach('workflows.view') ? renderComments() : '';
      },
    };
    return tileOrder().map(function (id) {
      return renderers[id] ? renderers[id]() : '';
    }).join('');
  }

  /*
   * The staff answer this listener has already acted on.
   *
   * TMACurrentUser fans out to its listeners from paint(), and paint() runs on
   * every `tma:view-rendered`, so this fired on *every* navigation back to the
   * Dashboard, not only when identity arrived. Each firing force-refreshed the
   * Default Folders strip, which is what emptied every card on the way in. What
   * the listener is actually for is the one-time race where /me answers after
   * the first mount, so it now compares answers and does nothing when the
   * answer has not moved.
   */
  var staffAnswerActedOn = null;

  function bindStaffUserListener() {
    if (homeStaffUserBound) return;
    if (!window.TMACurrentUser || !window.TMACurrentUser.onChange) return;
    homeStaffUserBound = true;
    window.TMACurrentUser.onChange(function () {
      var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      if (!mountEl || !mountEl.isConnected) return;

      var answer = isStaffUser();
      var settled = answer === staffAnswerActedOn;
      staffAnswerActedOn = answer;

      // /me often arrives after the first dashboard mount. If we previously
      // concluded "not staff" before identity was known, retry.
      if (homeStaff && homeStaff.staff === false && answer) {
        homeStaffLoaded = false;
        homeStaff = null;
      }
      // Re-fetch default folders once identity is *newly* known, the first
      // load may have raced ahead of /me and skipped staff-only chrome. A /me
      // that says the same thing as last time changes nothing on this board.
      if (!settled && answer && window.TMAPortalHomeLibrary && window.TMAPortalHomeLibrary.refresh) {
        window.TMAPortalHomeLibrary.refresh();
      }
      if (!homeStaffLoaded || (answer && (!homeStaff || !homeStaff.staff))) {
        loadHomeStaff(mountEl);
      } else if (!settled) {
        mount(mountEl, { fromLoad: true });
      }
    });
  }

  /* Everything the board draws for one person. A poll that returns the same
     presence and the same work plan must not redraw thirty avatars. */
  function staffSignature(payload) {
    if (!payload) return '';
    if (payload.staff === false) return 'client';
    return (payload.employees || []).map(function (p) {
      var work = p.workStatus || {};
      return [
        p.id, p.online ? 1 : 0, p.lastSeen || '', p.lastSeenAt || '',
        p.status || '', p.statusLabel || '', p.statusSource || '',
        p.name || '', p.avatar || '', work.status || '', work.label || '',
      ].join(':');
    }).join('|');
  }

  if (!window._tmaHomePresenceBound) {
    window._tmaHomePresenceBound = true;
    document.addEventListener('tma:presence-status', function (ev) {
      var p = ev.detail;
      if (!p || !homeStaff || !homeStaff.employees) return;
      var before = staffSignature(homeStaff);
      homeStaff.employees = homeStaff.employees.map(function (person) {
        if (person.id !== p.userId) return person;
        if (window.TMAPresence && window.TMAPresence.applyRemoteToPerson) {
          return window.TMAPresence.applyRemoteToPerson(person, p);
        }
        person.online = p.status !== 'offline';
        person.statusLabel = p.label;
        return person;
      });
      if (staffSignature(homeStaff) !== before) {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (mountEl && mountEl.isConnected) mount(mountEl, { fromLoad: true });
      }
    });
  }

  function loadHomeStaff(el, opts) {
    opts = opts || {};
    bindStaffUserListener();

    // Only skip the network call when we already know this account is a client.
    // If /me has not loaded yet, still ask the server, the session knows.
    if (isStaffUser() === false) {
      homeStaffLoaded = true;
      homeStaff = { staff: false, employees: [] };
      return;
    }
    if (homeStaffInflight) return;

    var before = staffSignature(homeStaff);

    homeStaffInflight = fetch('/portal/dashboard/staff', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (json) {
        homeStaffInflight = null;
        var wasLoaded = homeStaffLoaded;
        homeStaffLoaded = true;
        // A failed request must not permanently hide the widget for staff.
        if (json) {
          homeStaff = json;
          homeStaffAt = Date.now();
          homeReal.staff = true;
          keepWarm('staff', json);
        } else if (!homeStaff) {
          homeStaff = { staff: true, employees: [], error: true };
        }
        if ((!wasLoaded || staffSignature(homeStaff) !== before) && el && el.isConnected) {
          mount(el, { fromLoad: true });
        }
      });

    // Keep presence fresh while the home view is open.
    if (!homeStaffTimer && !opts.skipTimer) {
      homeStaffTimer = setInterval(function () {
        var mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
        if (!mountEl || !mountEl.isConnected) return;
        // A hidden tab polling presence is pure cost, the visibilitychange
        // handler catches up on the way back.
        if (document.visibilityState === 'hidden') return;
        if (homeStaffInflight) return;
        if (homeStaff && homeStaff.staff === false) return;
        loadHomeStaff(mountEl, { skipTimer: true });
      }, 30000);
    }
  }

  /*
   * Request Files, from the Dashboard shortcut.
   *
   * Hands straight over to the shared dialog (portal-file-requests.js) rather
   * than keeping the Dashboard's own version. That version asked for an email
   * address, wrote a line to the local activity log, said "File request sent"
   * and sent nothing, there was no request, no link and no destination behind
   * it. One implementation now serves all three entry points.
   */
  function requestFiles() {
    if (!window.TMAFileRequests) {
      ui().toastError('Request Files isn’t available right now.');
      return;
    }
    window.TMAFileRequests.open({
      onCreated: function () {
        // A request is not a file, so nothing on the board changes yet, but
        // the folder it points at is worth revalidating next time round.
        homeFilesAt = 0;
      },
    });
  }

  /* Share Files only. Request Files went to the real implementation above,
     which left this branch dead. */
  function shareFilesModal() {
    var s = data().state();
    ui().openModal({
      title: 'Share Files',
      body:
        ui().field('To (email address)', ui().input({ type: 'email', placeholder: 'client@example.com', attrs: 'data-home-share-to' })) +
        ui().field('Subject', ui().input({ placeholder: 'Files shared with you', attrs: 'data-home-share-subject' })) +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Message</span>' +
        '<textarea class="tma-portal-textarea" data-home-share-msg placeholder="Add a note (optional)"></textarea></div>' +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Files</span>' +
        s.recentFiles.map(function (f) {
          return '<label class="tma-portal-checkbox"><input type="checkbox" data-home-share-file value="' + ui().esc(f.id) + '"><span>' + ui().esc(f.name) + '</span></label>';
        }).join('') + '</div>' +
        '<div class="tma-portal-form-actions">' +
        ui().btn({ label: 'Share', attrs: 'data-home-share-send' }) +
        '</div>',
      onMount: function (host) {
        host.querySelector('[data-home-share-send]').addEventListener('click', function () {
          var to = host.querySelector('[data-home-share-to]').value.trim();
          if (!to) { host.querySelector('[data-home-share-to]').focus(); return; }
          data().logNotification('Files shared with ' + to, to);
          data().logBackgroundOp('Share files (' + to + ')');
          ui().closeModal();
          ui().toast('Files shared');
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
    { id: 'email', label: 'Recent Email', desc: 'Your latest inbox messages, ready to open.', preview: 'email', cap: 'mail.use' },
    { id: 'messages', label: 'Messages', desc: 'Your five most recent chats, with unread counts.', preview: 'messages' },
    { id: 'shortcuts', label: 'Shortcuts', desc: 'Frequently used actions, as well as quick access to certain folders.', preview: 'shortcuts' },
    { id: 'employees', label: 'Employees', desc: 'Who is online, and today\'s work status (office, remote, leave).', preview: 'employees', staffOnly: true },
    { id: 'favorites', label: 'Favorites', desc: 'Files and folders you marked as favorite.', preview: 'favorites' },
    { id: 'road', label: 'Upcoming Events', desc: 'Upcoming events for the selected day.', preview: 'road' },
    /*
     * staffOnly keeps Employees out of the Edit Dashboard list for a client
     * account. CIP is a different question: a Service Provider contact is a
     * client account and still gets this card, so the editor asks `card`
     * rather than staffhood. Without the flag, every client would be offered a
     * tile that would never appear; without the server's answer, a staff
     * member without CIP gets an empty panel.
     */
    { id: 'cipStatus', label: 'CIP Applications', desc: 'How many applications sit at each stage, and what needs picking up.', preview: 'cip', cipCard: true },
    { id: 'requests', label: 'Requests', desc: 'Reviews, approvals and signatures waiting on you.', preview: 'requests', cap: 'workflows.view' },
    { id: 'comments', label: 'Comments', desc: 'The latest discussion on files that involve you.', preview: 'comments', cap: 'workflows.view' },
  ];

  // Shipped default board (3 equal columns, masonry):
  //   Recent Files → Favorites
  //   Recent Email → What's on the road?
  //   CIP Applications → Shortcuts → Employees
  // Messages, Requests and Comments then land in whichever column is shortest,
  // in that order — they are listed last so adding them left the three columns
  // above exactly where the board already had them.
  var DEFAULT_TILE_ORDER = [
    'recentFiles', 'email', 'cipStatus', 'favorites', 'road',
    'shortcuts', 'employees', 'messages', 'requests', 'comments',
  ];

  // Every tile is one column of the 3-up board, nothing spans full width.
  var TILE_SPAN = {
    recentFiles: 'third',
    favorites: 'third',
    employees: 'third',
    email: 'third',
    messages: 'third',
    shortcuts: 'third',
    road: 'third',
    cipStatus: 'third',
    requests: 'third',
    comments: 'third',
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

  /*
   * Kept fractional on purpose. Rounding each column up made the columns no
   * longer fit the container they were derived from, at 1152px wide, three
   * 370.67px columns became 371px each and the last one no longer passed the
   * `x + w <= containerWidth` test in packHomeTiles. The tile fell back to an
   * earlier column and the board rendered a whole empty column on the right,
   * at every container width that doesn't divide evenly.
   */
  function fractionToPx(frac, containerWidth, gap, cols) {
    if (frac >= 0.999) return containerWidth;
    var colW = (containerWidth - gap * (cols - 1)) / cols;
    var spanCols = Math.max(1, Math.round(frac * cols));
    return spanCols * colW + (spanCols - 1) * gap;
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
   *   favorites → recentFiles, road → email,
   *   shortcuts → cipStatus, employees → shortcuts. */
  var TILE_STACK_UNDER = {
    favorites: 'recentFiles',
    road: 'email',
    shortcuts: 'cipStatus',
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

  /*
   * Pack only if the board isn't already packed at the width it is now.
   *
   * The path taken when a render produced identical markup. Two cases still
   * need work: the very first paint, and a return to a view that was packed
   * while it was hidden (a hidden view measures 0px wide, so layoutHomeMasonry
   * bails and the tiles are left in the CSS-grid fallback).
   */
  function ensureHomeMasonry(root) {
    var grid = root.querySelector('.tma-portal-home-grid');
    if (!grid) return;
    var width = grid.clientWidth || 0;
    if (width < 40) return;
    if (grid.classList.contains('is-packed') && Math.abs((grid._masonryWidth || 0) - width) < 1) return;
    bindHomeMasonry(root);
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
            // Width unchanged, still re-pack if content height likely changed.
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

  /* true = staff, false = client, null = /me not loaded yet.

     The answer is the server's: /me already reports isStaff from
     App\Support\Access\Role, which knows about the officer account types and
     their legacy spellings. Reading accountType against a hand-written pair of
     type names, as this did, filed every CRO / Reviewing officer under
     "client" and hid the staff half of the home. */
  function isStaffUser() {
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    if (!me) return null;
    return !!(me.isAdmin || me.isStaff);
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
      if (show[id] == null) out[id] = true;
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
  // 16 re-applies CIP → Shortcuts after the server whitelist started accepting
  // cipStatus/messages (older saves had stripped them and put CIP at the end).
  // 17 adds the Requests and Comments tiles to boards saved before they existed.
  var DASHBOARD_LAYOUT_GEN = 17;

  function ensureLocalDefaultLayout() {
    var s = data().state();
    if (s.dashboardLayoutGen === DASHBOARD_LAYOUT_GEN) return false;

    s.dashboardTileSizes = {};
    s.dashboardTileOrder = DEFAULT_TILE_ORDER.slice();
    s.dashboardTiles = Object.assign({}, s.dashboardTiles || {}, {
      recentFiles: true, email: true, shortcuts: true, employees: true,
      favorites: true, road: true, messages: true, cipStatus: true,
      requests: true, comments: true,
    });
    delete s.dashboardTiles.tutorials;
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
        favorites: true, road: true,
      };
      data().save();
    }
    if (s.dashboardTiles.employees == null) s.dashboardTiles.employees = true;
    if (s.dashboardTiles.email == null) s.dashboardTiles.email = true;
    if (s.dashboardTiles.messages == null) s.dashboardTiles.messages = true;
    if (s.dashboardTiles.road == null) s.dashboardTiles.road = true;
    if (s.dashboardTiles.cipStatus == null) s.dashboardTiles.cipStatus = true;
    if (s.dashboardTiles.requests == null) s.dashboardTiles.requests = true;
    if (s.dashboardTiles.comments == null) s.dashboardTiles.comments = true;
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
    return DASH_TILES.filter(function (t) {
      if (t.cap && !canReach(t.cap)) return false;
      if (t.cipCard) return staff !== false || cipCardVisible(homeCip);
      return !t.staffOnly || staff !== false;
    });
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
    } else if (kind === 'cip') {
      // A labelled count per line: dot, a full-width bar for the bucket name,
      // and a short stub on the right for the number. The stub reuses the
      // --title modifier because that is the one that means "fixed width and a
      // shade stronger"; only its width is overridden, so no new preview class
      // has to exist for a thumbnail 96px wide.
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>';
      for (var c = 0; c < 4; c++) {
        inner += '<span class="tma-portal-tilerow__preview-line">' +
          '<span class="tma-portal-tilerow__preview-dot"></span>' +
          '<span class="tma-portal-tilerow__preview-bar"></span>' +
          '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title" style="width:12px"></span>' +
          '</span>';
      }
    } else if (kind === 'employees' || kind === 'email' || kind === 'messages' || kind === 'comments') {
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>';
      for (var e = 0; e < 3; e++) {
        inner += '<span class="tma-portal-tilerow__preview-line">' +
          '<span class="tma-portal-tilerow__preview-dot"></span>' +
          '<span class="tma-portal-tilerow__preview-bar"></span></span>';
      }
    } else if (kind === 'requests') {
      // The comments thumbnail with a stub on the right for the status line,
      // which is the one thing that tells the two tiles apart at 96px wide.
      // Same borrowed --title modifier the CIP thumbnail uses for its numbers.
      inner = '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title"></span>';
      for (var q = 0; q < 3; q++) {
        inner += '<span class="tma-portal-tilerow__preview-line">' +
          '<span class="tma-portal-tilerow__preview-dot"></span>' +
          '<span class="tma-portal-tilerow__preview-bar"></span>' +
          '<span class="tma-portal-tilerow__preview-bar tma-portal-tilerow__preview-bar--title" style="width:18px"></span>' +
          '</span>';
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
          refreshWorkForTiles();
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
  /* What Recent Files / Favorites currently *say*. Two payloads with the same
     signature paint the same rows, so there is nothing to re-render. */
  function fileListSignature(list) {
    return (list || []).map(function (f) {
      return [f.kind, f.id, f.name, f.path || '', f.thumbUrl || '', f.fileCount == null ? '' : f.fileCount].join(':');
    }).join('|');
  }

  /*
   * The listing rows, exactly as the server sent them, kept beside the state
   * rather than in it.
   *
   * The File Library's viewer expects to be handed the payload it hands
   * itself; these two panels keep a reduced shape of their own (`kind`,
   * `path`, `sortAt`) that it would not understand. Parking the full rows in
   * `data().state()` would have worked and would also have written every one
   * of them into localStorage on the next save() — a stale copy of the
   * library, persisted, which is the one thing this feature must never grow.
   */
  var homeFilePayloads = {};

  function rememberFilePayload(f) {
    if (!f || !f.id) return;
    // Bounded: a long session rotating through hundreds of files must not turn
    // this into a leak. Everything on screen is re-registered on every load.
    if (Object.keys(homeFilePayloads).length > 200) homeFilePayloads = {};
    homeFilePayloads[f.id] = f;
  }

  function loadHomeFiles(el) {
    var net = window.TMAFilesNet;
    if (!net) { homeFilesLoaded = true; return; }

    // One flight at a time. Returning to the Dashboard while a refresh is still
    // running used to start a second identical pair of requests, and whichever
    // landed last won.
    if (homeFilesInflight) return;

    // Recent Files and Favorites are server-owned, so any value persisted by the
    // old localStorage mock must never reach the screen. That purge belongs to
    // the *first* load only, doing it on every refresh is what emptied the
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

      var wasLoaded = homeFilesLoaded;
      homeFilesLoaded = true;
      homeFilesAt = Date.now();
      var s = data().state();
      var beforeRecent = fileListSignature(s.recentFiles);
      var beforeFavs = fileListSignature(s.folders && s.folders.favorites);

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
          rememberFilePayload(f);
          return {
            kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
            // Carried for the thumbnail: a PDF has no server thumbnail, so
            // TMAFileThumbs paints page one from the preview route.
            category: f.category, mime: f.mime, previewUrl: f.previewUrl, permissions: f.permissions,
            size: f.size,
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
          rememberFilePayload(f);
          return {
            kind: 'file', id: f.id, name: f.name, type: f.extension || '', icon: f.icon, thumbUrl: f.thumbUrl,
            // Carried for the thumbnail: a PDF has no server thumbnail, so
            // TMAFileThumbs paints page one from the preview route.
            category: f.category, mime: f.mime, previewUrl: f.previewUrl, permissions: f.permissions,
            size: f.size,
            folderId: f.folder && f.folder.id, path: pathLabel('file', f.path),
          };
        });
        s.folders = s.folders || {};
        s.folders.favorites = favFolders.concat(favFiles);
      }

      homeReal.files = true;
      keepWarm('files', {
        recentFiles: s.recentFiles || [],
        favorites: (s.folders && s.folders.favorites) || [],
      });

      // A revalidation that found nothing new is not a reason to touch the
      // page. Re-rendering an identical board is where the "cards keep
      // refreshing" feeling came from.
      var changed = !wasLoaded ||
        fileListSignature(s.recentFiles) !== beforeRecent ||
        fileListSignature(s.folders && s.folders.favorites) !== beforeFavs;

      if (changed && el.isConnected) mount(el, { fromLoad: true });
    });
  }

  /* The KPI row, measured server-side from real activity: response times come
   * from portal messages and connected mailboxes, shares from the file
   * library, signatures from the request log. A failure leaves the row in
   * place with em-dashes rather than showing a stale or invented number. */
  function loadHomeMetrics(el) {
    if (homeMetricsInflight) return;

    var before = JSON.stringify(homeMetrics || null);

    homeMetricsInflight = fetch('/portal/dashboard/metrics', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      // A failed refresh keeps the numbers already on the cards; only the very
      // first attempt has nothing to fall back to.
      .then(function (j) { if (j) { homeMetrics = j; homeMetricsAt = Date.now(); homeReal.metrics = true; keepWarm('metrics', j); } })
      .catch(function () {})
      .then(function () {
        homeMetricsInflight = null;
        var wasLoaded = homeMetricsLoaded;
        homeMetricsLoaded = true;
        // Same numbers, same cards, leave the row alone.
        if ((!wasLoaded || JSON.stringify(homeMetrics || null) !== before) && el.isConnected) {
          mount(el, { fromLoad: true });
        }
      });
  }

  // Shortcut badges: Email = exact inbox unread, Calendar = today's events,
  // Users = pending approvals. Never a placeholder number, and never "99+".
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

    if (!inboxUnreadInflight && canReach('mail.use')) {
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

  /*
   * The shell's Today control lives in .tma-dash__main-head, which Dashboard
   * hides. Park it beside Edit Dashboard so the greeting stays one row.
   *
   * Morph of the hello actions only knows about Edit Dashboard, so Today must
   * be moved back to the shell before any patch, or the reconciler deletes it.
   */
  function parkTodayInHello(el) {
    var actions = el && el.querySelector('.tma-portal-hello__actions');
    var today = document.querySelector('.tma-dash [data-today-dropdown]');
    if (!actions || !today) return;
    if (today.parentElement !== actions) {
      actions.insertBefore(today, actions.firstChild);
    }
    today.style.display = '';
    today.hidden = false;
    today.removeAttribute('hidden');
  }

  function restoreTodayToShell() {
    var today = document.querySelector('[data-today-dropdown]');
    var slot = document.querySelector('.tma-dash__main-head-right');
    if (!today || !slot || today.parentElement === slot) return;
    slot.insertBefore(today, slot.firstChild);
  }

  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    if (el._homeMounting) {
      el._homeMountQueued = true;
      return;
    }
    el._homeMounting = true;
    try {
    var s = data().state();
    var show = tiles();
    // Local re-render only. Toggling a tile is a change to *this* view, not a
    // reason to re-request Recent Files, Favorites and the KPI row from the
    // server.
    function rerender() { mount(el, { fromLoad: true }); }

    /*
     * The greeting is rendered with the real name and avatar whenever
     * TMACurrentUser already has them.
     *
     * It used to always emit a blank skeleton avatar and then assign the true
     * src further down. Under a reconciling render that reads as: reset the
     * image to a 1x1 placeholder, then set it back, a visible flash of every
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
     * every render, including each Recent Files thumbnail and the profile
     * photo, which is what made the panel blink and the images re-request. The
     * panels and rows carry stable keys, so unchanged rows are now left
     * untouched and only genuinely changed ones are rewritten.
     */
    /*
     * …and don't reconcile at all when there is nothing to reconcile.
     *
     * Six background loaders answer on every visit to this view, and each one
     * called mount(). Morph made those cheap in DOM terms, but the work either
     * side of it was not: the masonry pass below tears every tile out of its
     * absolute position, forces a reflow to re-measure, and packs them again —
     * twice per render, six times per visit. Comparing the rendered string
     * first turns a no-op render into an actual no-op.
     *
     * The comparison is exact and the string is built from state, so anything
     * that genuinely changed still gets through.
     */
    var rendered = el.firstElementChild;
    var unchanged = el._homeHtml === html &&
      !!rendered && rendered.getAttribute('data-node-id') === 'portal-home';
    // Rescue Today before morph, hello actions HTML has no Today node, so a
    // patch would throw the parked control away and it would never come back.
    restoreTodayToShell();
    if (!unchanged) {
      if (window.TMAMorph) window.TMAMorph.patch(el, html);
      else el.innerHTML = html;
      el._homeHtml = html;
    }

    // Shell hides .tma-dash__main-head on Dashboard, so park the Today control
    // in the hello actions. Hello / Change picture / Today / Edit Dashboard
    // stay one row instead of Today stacking above Edit Dashboard.
    parkTodayInHello(el);

    // Wiring runs after every render, but the nodes it walks now survive across
    // renders, so each binding is registered once per element rather than once
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

    // Re-packing costs a forced reflow of the whole board; skip it when the
    // markup it would measure is the one already on screen. The ResizeObserver
    // inside still handles a genuine width change.
    if (!unchanged) bindHomeMasonry(el);
    else ensureHomeMasonry(el);

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
        if (id === 'request-files') requestFiles();
        if (id === 'new-user-folders') newUserFoldersModal(rerender);
      });
    });

    /*
     * A file opens where every other list in the portal opens one: the File
     * Library's viewer, through TMAFileActions — the same window, with the
     * file's comments, versions, approvals and details. Naming a row and then
     * dropping the reader into the folder it lives in, which is what these two
     * panels used to do, left them to find it again among everything else in
     * there.
     *
     * The panel's other files go with it, so the viewer's rail steps through
     * the list that was clicked, and anything an action changes in there (a
     * rename, a delete) is reloaded back into the panel.
     */
    function openHomeFile(list, id) {
      var actions = window.TMAFileActions;
      if (!actions || typeof actions.open !== 'function') return false;

      var files = (list || [])
        .filter(function (f) { return f.kind !== 'folder' && homeFilePayloads[f.id]; })
        .map(function (f) { return homeFilePayloads[f.id]; });
      var row = files.filter(function (f) { return String(f.id) === String(id); })[0];
      if (!row) return false;

      actions.open(row, function () { loadHomeFiles(el); }, files);

      return true;
    }

    pick('[data-home-file]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-home-file-kind') === 'folder') {
          navigate({ navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: b.getAttribute('data-home-file') });
          return;
        }
        if (openHomeFile(data().state().recentFiles, b.getAttribute('data-home-file'))) return;
        // No viewer on the page: open the file's own folder, falling back to
        // the File Box when it has none.
        var folderId = b.getAttribute('data-home-file-folder');
        navigate(folderId
          ? { navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: folderId }
          : { navId: 'folders-filebox', view: 'folders', title: 'File Box', crumb: 'File Library / File Box' });
      });
    });

    pick('[data-home-favorite]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-home-favorite-kind');
        if (kind === 'folder') {
          // Open the favorited folder itself.
          navigate({ navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: b.getAttribute('data-home-favorite') });
          return;
        }
        var favs = (data().state().folders || {}).favorites;
        if (openHomeFile(favs, b.getAttribute('data-home-favorite'))) return;
        // Open the file's folder, or fall back to the Favorites section.
        var folderId = b.getAttribute('data-home-favorite-folder');
        navigate(folderId
          ? { navId: 'folders-all', view: 'folders', title: 'Folders', crumb: 'Folders', folderId: folderId }
          : { navId: 'folders-favorites', view: 'folders', title: 'Favorites', crumb: 'File Library / Favorites' });
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

    pick('[data-home-chat]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-home-chat');
        navigate({
          navId: 'so-messages',
          view: 'messages',
          title: 'Messages',
          crumb: 'Messages',
          openConversationId: id || null,
        });
      });
    });

    pick('[data-home-chat-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        navigate({ navId: 'so-messages', view: 'messages', title: 'Messages', crumb: 'Messages' });
      });
    });

    pick('[data-home-work-file]').forEach(function (b) {
      b.addEventListener('click', function () {
        markWorkCommentRead(b.getAttribute('data-home-work-comment'));
        openWorkFile(
          b.getAttribute('data-home-work-file'),
          b.getAttribute('data-home-work-folder')
        );
      });
    });

    pick('[data-home-cip-bucket]').forEach(function (b) {
      b.addEventListener('click', function () {
        openCipBucket(b.getAttribute('data-home-cip-bucket'));
      });
    });

    pick('[data-home-employee-action]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openEmployeeAction(
          b.getAttribute('data-home-employee'),
          b.getAttribute('data-home-employee-action')
        );
      });
    });

    /* The greeting and avatar are rendered directly in the markup above when
     * TMACurrentUser is ready. When it isn't yet, the skeleton stands until
     * current-user.js's own listener fires and re-renders this view, no
     * post-render patching of the DOM is needed here.
     * The picture picker itself is owned by current-user.js (delegated click). */

    bind(el.querySelector('[data-home-edit]'), 'click', function () { editDashboardModal(rerender); });

    fillShortcutCounts(el);
    watchLiveFiles();
    watchLiveCip();
    watchLiveWork();

    /*
     * Revalidate on a genuine mount, but only what has actually gone stale.
     *
     * This block used to run every endpoint unconditionally on every visit to
     * the Dashboard, force-refreshing the Default Folders as well. Leaving for
     * Email and coming back therefore cost six requests and six renders, for a
     * board that had not changed in the twenty seconds you were away. Each
     * loader is now asked only when its own data is past its window; anything
     * that changes in between arrives through TMALive instead.
     */
    if (!opts.fromLoad) {
      /* An explicit refresh, re-selecting the page you are on, or the
         pull-to-refresh gesture, is a request for the latest, so it ignores
         the windows above. They exist to stop idle navigation from polling,
         not to answer somebody who has just asked. */
      var force = !!opts.refresh;
      hydrateLayoutFromServer(function (changed) {
        // Re-render once when the account layout differs from local cache.
        if (changed && el.isConnected) mount(el, { fromLoad: true, fromHydrate: true });
      });
      if (force || !homeFilesLoaded || stale(homeFilesAt)) loadHomeFiles(el);
      if (force || !homeMetricsLoaded || stale(homeMetricsAt, METRICS_FRESH_MS)) loadHomeMetrics(el);
      if (force || !homeStaffLoaded || stale(homeStaffAt, PRESENCE_FRESH_MS)) loadHomeStaff(el);
      else bindStaffUserListener();
      // The mailbox tile costs two round trips (index, then messages), so it
      // gets the same treatment. Both keep polling on their own timers while
      // the board is open, and both listen for their live signals.
      if (canReach('mail.use') && (force || !homeEmailLoaded || stale(homeEmailAt))) loadHomeEmail(el);
      if (force || !homeChatsLoaded || stale(homeChatsAt)) loadHomeChats(el);
      if (force || !homeCipLoaded || stale(homeCipAt, CIP_FRESH_MS)) loadHomeCip(el);
      if (canReach('workflows.view') && (force || !homeWorkLoaded || stale(homeWorkAt, WORK_FRESH_MS))) {
        loadHomeWork(el);
      }
      if (window.TMAPortalHomeLibrary) {
        // Only forced on an explicit refresh. A forced load replaced
        // state.defaults with preview-less folders straight away, so every card
        // on the strip read "Nothing in this folder yet" until the previews came
        // back, the Default Folders blanking on every visit. Left to itself the
        // strip revalidates on its own schedule and repaints only what changed.
        window.TMAPortalHomeLibrary.load(function () {
          if (el.isConnected) mount(el, { fromLoad: true });
        }, force);
      }
    } else if (!homeStaffInflight && (!homeStaffLoaded || (isStaffUser() && homeStaff && homeStaff.staff === false))) {
      // Retry when identity arrives after an early "not staff" guess.
      loadHomeStaff(el);
    } else {
      bindStaffUserListener();
    }
    } finally {
      el._homeMounting = false;
      if (el._homeMountQueued) {
        el._homeMountQueued = false;
        mount(el, { fromLoad: true });
      }
    }
  }

  /*
   * Files change → the file tiles change, and nothing else does.
   *
   * The Dashboard's answer to "update automatically when new files are added"
   * is the signal the rest of the portal already uses (App\Support\Realtime\Live
   * → TMALive), not a shorter poll. An upload, a rename, a move or a delete
   * emits `files`; this refetches Recent Files, Favorites and the Default
   * Folders strip, and the render-diff above means nothing repaints unless the
   * rows genuinely differ.
   */
  var liveFilesBound = false;
  function watchLiveFiles() {
    if (liveFilesBound || !window.TMALive) return;
    liveFilesBound = true;

    function dashMount() {
      var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      return el && el.isConnected ? el : null;
    }

    window.TMALive.register(window.TMALive.RESOURCES.FILES, function () {
      var el = dashMount();
      if (!el) return null;
      // Force past the freshness window: this is a signal that the data has
      // actually changed, not a speculative revalidation.
      homeFilesAt = 0;
      loadHomeFiles(el);
      if (!window.TMAPortalHomeLibrary) return null;
      return window.TMAPortalHomeLibrary.refresh(function () {
        var live = dashMount();
        if (live) mount(live, { fromLoad: true });
      });
    }, {
      // Registered for the life of the page, so skip the work whenever the
      // Dashboard is not the view on screen.
      active: function () {
        var view = document.querySelector('.tma-dash__view[data-view="dashboard"]');
        return !!view && !view.hidden;
      },
    });
  }

  /*
   * A comment is written, or a request is answered → the two work tiles move,
   * and nothing else on this board does.
   *
   * Its own registration for the same reason CIP keeps one: somebody answering
   * an approval does not touch Recent Files, and an upload does not move a
   * conversation. One shared entry would make every write on either side
   * refetch the other's.
   *
   * The 60-second poll below stays as the backstop. This is the path that
   * makes the tiles live; the timer is what covers a portal that cannot reach
   * Reverb at all, which is a configuration this app has shipped in more than
   * once.
   */
  var liveWorkBound = false;
  function watchLiveWork() {
    if (liveWorkBound || !window.TMALive) return;
    liveWorkBound = true;

    window.TMALive.register(window.TMALive.RESOURCES.WORKFLOWS, function () {
      var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      if (!el || !el.isConnected) return null;

      // Force past the freshness window: this is a signal that something
      // actually changed, not a speculative revalidation.
      homeWorkAt = 0;

      /*
       * Off screen, zeroing that window IS the job — which is why this does
       * the check itself rather than handing TMALive an `active` guard. The
       * guard returns before any of this runs, so a comment written while the
       * reader was in Email left the board thinking it was fresh, and walking
       * back in under the minute showed them yesterday's tile. Refetching a
       * board nobody is looking at is still pure cost; mount() asks on the way
       * back instead.
       */
      var view = document.querySelector('.tma-dash__view[data-view="dashboard"]');
      if (!view || view.hidden) return null;

      return loadHomeWork(el, { skipTimer: true });
    });
  }

  /*
   * An application moves → the counts move, and nothing else on this board does.
   *
   * Its own registration rather than a second job on the files entry, for the
   * reason clients.js gives for keeping its CIP entry separate: a status change
   * does not touch Recent Files and an upload does not move a bucket, so one
   * shared entry would make every write on either side refetch the other's.
   * This is the same `cip` signal the applications table listens to, which is
   * what keeps the card and the list it opens onto in step.
   */
  var liveCipBound = false;
  function watchLiveCip() {
    if (liveCipBound || !window.TMALive) return;
    liveCipBound = true;

    window.TMALive.register(window.TMALive.RESOURCES.CIP, function () {
      var el = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
      if (!el || !el.isConnected) return null;
      // Force past the freshness window: this is a signal that a status
      // actually changed, not a speculative revalidation.
      homeCipAt = 0;
      loadHomeCip(el);
      return null;
    }, {
      // Registered for the life of the page, so skip the work whenever the
      // Dashboard is not the view on screen.
      active: function () {
        var view = document.querySelector('.tma-dash__view[data-view="dashboard"]');
        return !!view && !view.hidden;
      },
    });
  }

  /*
   * On DOMContentLoaded, not at parse, two orderings force it. The store's
   * reads are scoped to the account, and the account is set by
   * current-user.js, which parses AFTER this file: a read fired at parse
   * looks under the anonymous scope and misses everything. Deferred scripts
   * all parse before DCL fires, and the desktop's remembered /me applies
   * synchronously during current-user's parse, so at DCL the scope is set,
   * and the dashboard view mounts later still. (readyState guard because a
   * deferred script can, in odd embeddings, run after DCL already fired.)
   */
  /*
   * The deferred-script trap, in its precise form: while deferred scripts
   * execute, readyState is ALREADY 'interactive', but DOMContentLoaded has
   * NOT fired yet; it fires after the last deferred script returns. A guard
   * on `readyState === 'loading'` therefore runs immediately, at parse,
   * before current-user.js (later in the order) has told the store whose
   * scope to read, and every get() misses. 'complete' is the only state
   * that proves DCL is in the past. Both listeners, once-guarded, cover the
   * sliver between DCL and load.
   */
  var hydrated = false;
  var hydrateOnce = function () {
    if (hydrated) return;
    hydrated = true;
    hydrateHomeState();
  };
  if (document.readyState === 'complete') {
    hydrateOnce();
  } else {
    document.addEventListener('DOMContentLoaded', hydrateOnce);
    window.addEventListener('load', hydrateOnce);
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('dashboard', mount);

  window.TMAPortalHome = window.TMAPortalHome || {};
  window.TMAPortalHome.restoreTodayToShell = restoreTodayToShell;
})();
