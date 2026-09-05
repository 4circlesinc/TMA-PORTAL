/*
 * TMA - Email page ( /email )
 * Global: window.TMAEmail
 */
(function () {
  'use strict';

  /*
   * Keyed DOM reconciliation (js/dom-morph.js). The inbox list is the reason
   * this matters most here: rebuilding it threw away every sender photo and
   * attachment thumbnail whenever a single row was read, starred or labelled.
   * Rows key on data-email-row, so only the row that changed is rewritten.
   *
   * Wiring goes through MORPH.unwired / unwiredOne / on because nodes now
   * survive a render, plain addEventListener in a render path would stack a
   * handler per render.
   */
  var MORPH = window.TMAMorph || {
    patch: function (root, html) { root.innerHTML = html; },
    unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
    unwiredOne: function (root, sel) { return root.querySelector(sel); },
    on: function (el, type, fn) { if (el) el.addEventListener(type, fn); },
  };

  var AVATAR = 'images/avatars/';
  var ICON = 'images/icons/phosphor/';
  var BRAND = 'images/icons/brands/';

  var ICONS = {
    PencilSimpleLine: ICON + 'PencilSimpleLine.svg',
    Tray: ICON + 'Tray.svg',
    TrayFill: ICON + 'TrayFill.svg',
    PaperPlaneRight: ICON + 'PaperPlaneRight.svg',
    PaperPlaneRightFill: ICON + 'PaperPlaneRightFill.svg',
    FileText: ICON + 'FileText.svg',
    FileTextFill: ICON + 'FileTextFill.svg',
    WarningOctagon: ICON + 'WarningOctagon.svg',
    WarningOctagonFill: ICON + 'WarningOctagonFill.svg',
    Trash: ICON + 'Trash.svg',
    TrashFill: ICON + 'TrashFill.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
    Check: ICON + 'Check.svg',
    Archive: ICON + 'Archive.svg',
    ArchiveFill: ICON + 'ArchiveFill.svg',
    SquaresFour: ICON + 'SquaresFour.svg',
    FunnelSimple: ICON + 'FunnelSimple.svg',
    ArrowBendUpLeft: ICON + 'ArrowBendUpLeft.svg',
    ArrowBendUpRight: ICON + 'ArrowBendUpRight.svg',
    ArrowBendDoubleUpLeft: ICON + 'ArrowBendDoubleUpLeft.svg',
    ArrowsClockwise: ICON + 'ArrowsClockwise.svg',
    DotsThree: ICON + 'DotsThree.svg',
    Prohibit: ICON + 'Prohibit.svg',
    Star: ICON + 'Star.svg',
    StarFill: ICON + 'StarFill.svg',
    StarFilled: ICON + 'StarFilled.svg',
    ArrowUUpLeft: ICON + 'ArrowUUpLeft.svg',
    ArrowUUpRight: ICON + 'ArrowUUpRight.svg',
    ArrowClockwise: ICON + 'ArrowClockwise.svg',
    ArrowCounterClockwise: ICON + 'ArrowCounterClockwise.svg',
    TextT: ICON + 'TextT.svg',
    TextAa: ICON + 'TextAa.svg',
    HighlighterCircle: ICON + 'HighlighterCircle.svg',
    TextB: ICON + 'TextB.svg',
    TextItalic: ICON + 'TextItalic.svg',
    TextUnderline: ICON + 'TextUnderline.svg',
    TextStrikethrough: ICON + 'TextStrikethrough.svg',
    ListBullets: ICON + 'ListBullets.svg',
    ListNumbers: ICON + 'ListNumbers.svg',
    TextIndent: ICON + 'TextIndent.svg',
    TextOutdent: ICON + 'TextOutdent.svg',
    TextAlignLeft: ICON + 'TextAlignLeft.svg',
    TextAlignCenter: ICON + 'TextAlignCenter.svg',
    TextAlignRight: ICON + 'TextAlignRight.svg',
    LinkBreak: ICON + 'LinkBreak.svg',
    Eraser: ICON + 'Eraser.svg',
    Link: ICON + 'Link.svg',
    ArrowsOutSimple: ICON + 'ArrowsOutSimple.svg',
    CornersIn: ICON + 'CornersIn.svg',
    Minus: ICON + 'Minus.svg',
    X: ICON + 'X.svg',
    Paperclip: ICON + 'Paperclip.svg',
    Image: ICON + 'Image.svg',
    CaretDown: ICON + 'CaretDown.svg',
    CaretUp: ICON + 'CaretUp.svg',
    ArrowLineUpDown: 'images/icons/tma/ArrowLineUpDown.svg',
    EnvelopeSimpleOpen: ICON + 'EnvelopeSimpleOpen.svg',
    FolderSimple: ICON + 'FolderSimple.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    Clock: ICON + 'Clock.svg',
    ClockFill: ICON + 'ClockFill.svg',
    Tag: ICON + 'Tag.svg',
    PushPin: ICON + 'PushPin.svg',
    // Blue filled pin for the active pinned state (pair to StarFilled / FlagFilled).
    PushPinFilled: ICON + 'PushPinFilled.svg',
    PushPinSlash: ICON + 'PushPinSlash.svg',
    ArchiveTray: ICON + 'ArchiveTray.svg',
    Sidebar: ICON + 'SidebarSimple.svg',
    // A proper flag, not a price-tag shape. TagChevron's notched silhouette
    // read as "two icons overlapping" at toolbar size, and a tag was never
    // the right shape for "mark as important" to begin with.
    Important: ICON + 'FlagFill.svg',
    FlagFill: ICON + 'FlagFill.svg',
    // Red filled flag for the active "important" state (pair to StarFilled).
    FlagFilled: ICON + 'FlagFilled.svg',
    ArrowLineRight: ICON + 'ArrowLineRight.svg',
    ArrowLineLeft: ICON + 'ArrowLineLeft.svg',
    ArrowLineDown: ICON + 'ArrowLineDown.svg',
    Eye: ICON + 'Eye.svg',
    PaperclipHorizontal: ICON + 'PaperclipHorizontal.svg',
    SpeakerSlash: ICON + 'SpeakerSlash.svg',
    ChatCircleDots: ICON + 'ChatCircleDots.svg',
    ArrowsHorizontal: ICON + 'ArrowsHorizontal.svg',
    Flag: ICON + 'Flag.svg',
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    XCircle: 'images/icons/tma/Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
    Plus: ICON + 'Plus.svg',
    PencilSimple: ICON + 'PencilSimple.svg',
    SidebarSimple: ICON + 'SidebarSimple.svg',
    List: ICON + 'List.svg',
    Hamburger: ICON + 'Hamburger.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    CaretRight: ICON + 'CaretRight.svg',
    Smiley: ICON + 'Smiley.svg',
    Printer: ICON + 'Printer.svg',
    ArrowSquareOut: ICON + 'ArrowSquareOut.svg',
    GearSix: ICON + 'GearSix.svg',
  };

  var LAYOUT_STORE_KEY = 'tma.email.layoutStyle';
  var SPLIT_RATIO_STORE_KEY = 'tma.email.splitListRatio';
  // v2: prior key could be stuck "open" from a broken overflowing toggle.
  var SIDEBAR_COLLAPSE_KEY = 'tma.email.sidebarCollapsed.v2';
  /* What "collapsed" means for this reader: the icon rail, or nothing at all.
   * Mirrored from the server preference so it follows the account; kept in
   * localStorage too so the very first paint is already right. */
  var SIDEBAR_MODE_KEY = 'tma.email.sidebarMode.v3';
  /* v5: starred tab beside important. */
  var INBOX_CATEGORIES_KEY = 'tma.email.inboxCategories.v5';
  var SPLIT_RATIO_MIN = 0.22;
  var SPLIT_RATIO_MAX = 0.78;
  // Inbox list narrower than the reading pane by default.
  var SPLIT_RATIO_DEFAULT = 0.38;

  function loadSidebarCollapsed() {
    try {
      var saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch (e) { /* ignore */ }
    /* Closed (hidden) by default, the list-head menu button opens it. */
    return true;
  }

  function saveSidebarCollapsed(collapsed) {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  /* ── sidebar display mode ────────────────────────────────────────
   * Three settings, one control. "Full" is the open card; "Icons only" is the
   * rail; "Hidden" takes the sidebar off screen entirely. The collapse toggle
   * in the list head switches between Full and Hidden by default, closed
   * means gone, not an icon rail. Icons only stays available from settings.
   */
  var SIDEBAR_MODES = ['full', 'icons', 'hidden'];

  function loadSidebarMode() {
    try {
      var saved = localStorage.getItem(SIDEBAR_MODE_KEY);
      if (SIDEBAR_MODES.indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return 'hidden';
  }

  function saveSidebarMode(mode) {
    try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch (e) { /* ignore */ }
  }

  /* The sidebar the reader actually sees right now. Mobile always gets the
   * full drawer, an icon rail in a slide-over is just a smaller drawer.
   * Closed on desktop means Hidden unless Icons only was chosen explicitly. */
  function effectiveSidebarMode(state) {
    if (isEmailMobile()) return 'full';
    if (!state.sidebarCollapsed) return 'full';
    return state.sidebarMode === 'icons' ? 'icons' : 'hidden';
  }

  /* ── inbox categories ────────────────────────────────────────────
   * Tabs above the list for the folders people open every day. Each one is a
   * real server listing (see MailController::VIRTUAL_FOLDERS), so paging is
   * honest rather than a filter over whatever page happens to be loaded.
   * Inactive chips show the icon only; the active chip expands with its label
   * and its own colour.
   */
  var INBOX_CATEGORIES = [
    { id: 'inbox', label: 'Inbox', icon: 'TrayFill', fixed: true },
    { id: 'important', label: 'Important', icon: 'FlagFill', fixed: true },
    { id: 'starred', label: 'Starred', icon: 'StarFill', fixed: true },
    { id: 'snoozed', label: 'Snoozed', icon: 'ClockFill', fixed: true },
    { id: 'sent', label: 'Sent', icon: 'PaperPlaneRightFill', fixed: true },
    { id: 'draft', label: 'Drafts', icon: 'FileTextFill', fixed: true },
    { id: 'spam', label: 'Spam', icon: 'WarningOctagonFill', fixed: true },
    { id: 'trash', label: 'Trash', icon: 'TrashFill', fixed: true },
    { id: 'archive', label: 'Archive', icon: 'ArchiveFill', fixed: true },
  ];

  var CATEGORY_FOLDERS = INBOX_CATEGORIES.map(function (category) {
    return category.id;
  });

  function loadInboxCategories() {
    try {
      var saved = JSON.parse(localStorage.getItem(INBOX_CATEGORIES_KEY) || 'null');
      if (Array.isArray(saved)) return saved;
    } catch (e) { /* ignore */ }
    /* All daily tabs are fixed; this list is only consulted if a later
       preference makes any of them optional again. */
    return ['important', 'starred', 'snoozed', 'sent', 'draft', 'spam', 'trash', 'archive'];
  }

  function saveInboxCategories(ids) {
    try {
      localStorage.setItem(INBOX_CATEGORIES_KEY, JSON.stringify(ids || []));
    } catch (e) { /* ignore */ }
  }

  /*
   * Which sidebar groups are expanded. Mirrors the Feed's sidebar, which
   * remembers the same thing, a group someone closed should stay closed on
   * the next visit rather than springing back open.
   */
  var SIDEBAR_GROUPS_KEY = 'tma.email.sidebarGroups';
  var SIDEBAR_LIST_KEY = 'tma.email.sidebarList';
  var LIST_GROUPS_KEY = 'tma.email.listGroups';

  /* Inbox list sections, open by default; closing sticks until reopened. */
  var INBOX_LIST_GROUPS = [
    { id: 'pinned', label: 'Pinned' },
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'lastWeek', label: 'Last Week' },
    { id: 'thisMonth', label: 'This Month' },
    { id: 'lastMonth', label: 'Last Month' },
    { id: 'thisYear', label: 'This Year' },
    { id: 'older', label: 'Older' },
  ];

  function loadSidebarGroups() {
    try {
      var saved = JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) || '{}');
      if (saved && typeof saved === 'object') return saved;
    } catch (e) { /* ignore */ }
    return {};
  }

  function saveSidebarGroups(groups) {
    try {
      localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(groups || {}));
    } catch (e) { /* ignore */ }
  }

  function loadSidebarList() {
    try {
      var saved = localStorage.getItem(SIDEBAR_LIST_KEY);
      if (saved === 'labels' || saved === 'folders') return saved;
    } catch (e) { /* ignore */ }
    return 'folders';
  }

  function saveSidebarList(name) {
    try {
      localStorage.setItem(SIDEBAR_LIST_KEY, name);
    } catch (e) { /* ignore */ }
  }

  function emailSidebarList(state) {
    return state.sidebarList === 'labels' ? 'labels' : 'folders';
  }

  function emailNavCaret() {
    return '<span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>';
  }

  function fetchEmailSidebarSearchResults(q) {
    if (window.TMAPortalSearchIndex && typeof window.TMAPortalSearchIndex.fetchMail === 'function') {
      return window.TMAPortalSearchIndex.fetchMail(q);
    }
    return Promise.resolve([]);
  }

  function emailSidebarSearchMount(root) {
    return root.querySelector('[data-email-sidebar-search-mount]');
  }

  function resetEmailSidebarSearch(root, state) {
    if (state) state.mobileSearchOpen = false;
    var sidebar = root.querySelector('.tma-dash__email-sidebar');
    if (sidebar) sidebar.classList.remove('tma-dash__email-sidebar--mobile-search');
    var panel = root.querySelector('[data-email-sidebar-search-panel]');
    if (panel) panel.hidden = true;
    var mount = emailSidebarSearchMount(root);
    if (mount && mount._emailSearch && mount._emailSearch.isOpen && mount._emailSearch.isOpen()) {
      mount._emailSearch.close();
    }
  }

  function ensureEmailSidebarSearch(root, state, render) {
    var mount = emailSidebarSearchMount(root);
    if (!mount) return null;
    if (mount._emailSearch) return mount._emailSearch;
    if (!window.TMAGlobalSearch || typeof window.TMAGlobalSearch.mountSidebarSearch !== 'function') {
      return null;
    }

    mount._emailSearch = window.TMAGlobalSearch.mountSidebarSearch(mount, {
      index: [],
      scope: 'mail',
      fetchLiveResults: function (q) {
        return fetchEmailSidebarSearchResults(q).then(function (list) {
          return (list || []).filter(function (item) { return item && item.emailMessageId; });
        });
      },
      onNavigate: function (item) {
        var id = item && item.emailMessageId;
        if (state) {
          state.mobileSearchOpen = false;
          state.mobileNavOpen = false;
        }
        var liveSidebar = root.querySelector('.tma-dash__email-sidebar');
        if (liveSidebar) liveSidebar.classList.remove('tma-dash__email-sidebar--mobile-search');
        var livePanel = root.querySelector('[data-email-sidebar-search-panel]');
        if (livePanel) livePanel.hidden = true;
        syncEmailMobileNav(root, state);
        if (id) openMailById(root, state, render, id);
      },
      // Enter, or the "Search mail for …" row: the words go to the list the
      // way the header's Search in mail field sends them, and the drawer
      // gets out of the way so the matches are what is on screen.
      onSubmit: function (q) {
        if (state) {
          state.mobileSearchOpen = false;
          state.mobileNavOpen = false;
        }
        var liveSidebar = root.querySelector('.tma-dash__email-sidebar');
        if (liveSidebar) liveSidebar.classList.remove('tma-dash__email-sidebar--mobile-search');
        var livePanel = root.querySelector('[data-email-sidebar-search-panel]');
        if (livePanel) livePanel.hidden = true;
        syncEmailMobileNav(root, state);
        applyEmailListSearch(root, state, render, q);
      },
      onClose: function () {
        if (state) state.mobileSearchOpen = false;
        var liveSidebar = root.querySelector('.tma-dash__email-sidebar');
        if (liveSidebar) liveSidebar.classList.remove('tma-dash__email-sidebar--mobile-search');
        var livePanel = root.querySelector('[data-email-sidebar-search-panel]');
        if (livePanel) livePanel.hidden = true;
      },
    });
    return mount._emailSearch;
  }

  /* Filters the list by a query, exactly as typing it into the header's
   * Search in mail field would: the search is part of the listing context,
   * so reloadMessages starts a fresh page one. The header field is written
   * directly because ensureEmailHeaderSearch leaves a focused field alone. */
  function applyEmailListSearch(root, state, render, q) {
    var text = String(q || '').trim();
    if (!text) return;
    state.search = text;
    state.searchFocused = false;
    state.searchLoading = false;
    var dash = getEmailDashRoot(root);
    var headerInput = dash && dash.querySelector('[data-email-search]');
    if (headerInput && headerInput.value !== text) headerInput.value = text;
    reloadMessages(root, state, render);
  }

  function openEmailSidebarSearch(root, state, render) {
    var sidebar = root.querySelector('.tma-dash__email-sidebar');
    var panel = root.querySelector('[data-email-sidebar-search-panel]');
    if (!sidebar || !panel) return;
    var search = ensureEmailSidebarSearch(root, state, render);
    state.mobileSearchOpen = true;
    sidebar.classList.add('tma-dash__email-sidebar--mobile-search');
    panel.hidden = false;
    if (search) search.open();
  }

  function wireEmailSidebarSearch(root, state, render) {
    ensureEmailSidebarSearch(root, state, render);
    wireEmailHeaderMobileTools(root);
    if (root._emailSidebarSearchBound) return;
    root._emailSidebarSearchBound = true;
    root.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-email-sidebar-search-toggle]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      var sidebar = root.querySelector('.tma-dash__email-sidebar');
      if (!sidebar) return;
      if (sidebar.classList.contains('tma-dash__email-sidebar--mobile-search')) {
        resetEmailSidebarSearch(root, state);
        return;
      }
      openEmailSidebarSearch(root, state, render);
    });
  }

  function renderEmailSidebarMobileSearch(state) {
    return (
      '<div class="tma-dash__sidebar-mobile-head" data-email-sidebar-mobile-head data-key="email-sidebar-search-head">' +
        '<button type="button" class="tma-dash__sidebar-mobile-search" data-email-sidebar-search-toggle aria-label="Search in mail">' +
          '<img src="images/icons/tma/Search-16.svg" alt="" aria-hidden="true">' +
          '<span class="tma-dash__search-text">Search in mail</span>' +
        '</button>' +
      '</div>' +
      '<div class="tma-dash__sidebar-search-panel" data-email-sidebar-search-panel data-key="email-sidebar-search-panel"' +
      (state.mobileSearchOpen ? '' : ' hidden') + '>' +
        '<div class="tma-dash__sidebar-search-mount" data-email-sidebar-search-mount data-key="email-sidebar-search" data-morph-skip></div>' +
      '</div>'
    );
  }

  function syncEmailMobileNav(root, state) {
    var sidebar = root.querySelector('.tma-dash__email-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('tma-dash__email-sidebar--open', !!state.mobileNavOpen);
      sidebar.classList.toggle('tma-dash__email-sidebar--mobile-search', !!state.mobileSearchOpen);
    }
    var page = root.querySelector('.tma-dash__email-page');
    if (page) {
      page.classList.toggle('tma-dash__email-page--nav-open', !!state.mobileNavOpen);
    }
  }

  function applyEmailSidebarList(root, state) {
    var list = emailSidebarList(state);
    root.querySelectorAll('[data-email-list-tab]').forEach(function (tab) {
      var on = tab.getAttribute('data-email-list-tab') === list;
      tab.classList.toggle('tma-dash__tab--active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('[data-email-list]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-email-list') !== list;
    });
  }

  function toggleEmailMobileNav(root, state) {
    closeEmailProfileSidebar(state);
    if (state.mobileNavOpen) resetEmailSidebarSearch(root, state);
    state.mobileNavOpen = !state.mobileNavOpen;
    syncEmailMobileNav(root, state);
    var popup = root.querySelector('[data-email-profile-popup-card]');
    if (popup) popup.hidden = true;
    var dash = getEmailDashRoot(root);
    if (dash) dash.classList.remove('tma-dash--email-profile-sidebar-open');
  }

  function closeEmailMobileNav(root, state) {
    if (!state.mobileNavOpen && !state.profileSidebarOpen && !state.mobileSearchOpen) return;
    resetEmailSidebarSearch(root, state);
    state.mobileNavOpen = false;
    closeEmailProfileSidebar(state);
    syncEmailMobileNav(root, state);
    var popup = root.querySelector('[data-email-profile-popup-card]');
    if (popup) popup.hidden = true;
    var dash = getEmailDashRoot(root);
    if (dash) dash.classList.remove('tma-dash--email-profile-sidebar-open');
  }

  /* A group is open unless it was explicitly closed. On a phone the drawer
     is the only way to the mailboxes, so that group never stays folded. */
  function isSidebarGroupOpen(state, key) {
    if (key === 'folders' && isEmailMobile()) return true;
    return !(state.sidebarGroups && state.sidebarGroups[key] === false);
  }

  function loadListGroups() {
    try {
      var saved = JSON.parse(localStorage.getItem(LIST_GROUPS_KEY) || '{}');
      if (saved && typeof saved === 'object') return saved;
    } catch (e) { /* ignore */ }
    return {};
  }

  function saveListGroups(groups) {
    try {
      localStorage.setItem(LIST_GROUPS_KEY, JSON.stringify(groups || {}));
    } catch (e) { /* ignore */ }
  }

  function isListGroupOpen(state, key) {
    return !(state.listGroups && state.listGroups[key] === false);
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /* Bucket a row into Pinned / Today / … / Older using local calendar days. */
  function inboxListGroupId(row, now) {
    if (row && row.pinned) return 'pinned';
    var raw = row && row.sentAt;
    var date = raw ? new Date(raw) : null;
    if (!date || isNaN(date.getTime())) return 'older';

    now = now || new Date();
    var today = startOfLocalDay(now);
    var day = startOfLocalDay(date);
    var dayDiff = Math.round((today.getTime() - day.getTime()) / 86400000);

    if (dayDiff <= 0) return 'today';
    if (dayDiff === 1) return 'yesterday';
    if (dayDiff < 7) return 'lastWeek';

    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
      return 'thisMonth';
    }

    var prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    var prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    if (date.getFullYear() === prevYear && date.getMonth() === prevMonth) {
      return 'lastMonth';
    }

    if (date.getFullYear() === now.getFullYear()) return 'thisYear';
    return 'older';
  }

  /*
   * One collapsible sidebar section: a caret, a title, and its rows.
   *
   * The titles are hidden in the collapsed rail (there is no room for them),
   * so the caret is not rendered there either, a control that cannot be
   * labelled is a control nobody can use.
   */
  function renderEmailSidebarGroup(state, key, label, bodyHtml, actionHtml) {
    if (!isEmailMobile() && state.sidebarCollapsed) {
      return '<section class="tma-dash__email-group" data-email-group="' + esc(key) + '">' +
        bodyHtml + '</section>';
    }

    var open = isSidebarGroupOpen(state, key);

    return (
      '<section class="tma-dash__email-group" data-email-group="' + esc(key) + '">' +
      '<div class="tma-dash__email-group-head">' +
      '<button type="button" class="tma-dash__email-group-title"' +
      ' data-email-group-toggle="' + esc(key) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="tma-dash__email-group-caret' + (open ? ' tma-dash__email-group-caret--open' : '') + '"' +
      ' aria-hidden="true">' +
      '<svg viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span>' + esc(label) + '</span>' +
      '</button>' +
      (actionHtml || '') +
      '</div>' +
      (open ? '<div class="tma-dash__email-group-body">' + bodyHtml + '</div>' : '') +
      '</section>'
    );
  }

  function clampSplitRatio(ratio) {
    return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
  }

  function loadSplitListRatio() {
    try {
      var saved = parseFloat(localStorage.getItem(SPLIT_RATIO_STORE_KEY));
      if (!isNaN(saved)) return clampSplitRatio(saved);
    } catch (e) { /* ignore */ }
    return SPLIT_RATIO_DEFAULT;
  }

  function saveSplitListRatio(ratio) {
    try {
      localStorage.setItem(SPLIT_RATIO_STORE_KEY, String(ratio));
    } catch (e) { /* ignore */ }
  }

  var MAIL_PER_PAGE_KEY = 'tma.mail.perPage.v1';

  function loadMailPerPage() {
    try {
      var saved = parseInt(localStorage.getItem(MAIL_PER_PAGE_KEY), 10);
      if ([25, 50, 100, 200].indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return 50;
  }

  function saveMailPerPage(n) {
    try { localStorage.setItem(MAIL_PER_PAGE_KEY, String(n)); } catch (e) { /* ignore */ }
  }

  function loadLayoutStyle() {
    try {
      var saved = localStorage.getItem(LAYOUT_STORE_KEY);
      if (saved === 'single' || saved === 'split') return saved;
    } catch (e) { /* ignore */ }
    return 'split';
  }

  function saveLayoutStyle(style) {
    try {
      localStorage.setItem(LAYOUT_STORE_KEY, style);
    } catch (e) { /* ignore */ }
  }

  var EMAIL_MOBILE_MQ = '(max-width: 1024px)';
  /* The strip along the left edge belongs to the drawer's swipe-to-open
   * (dashboard.js); a row's own swipe never starts there. */
  var DRAWER_EDGE_PX = 24;

  function isComposePopoutPath() {
    try {
      var p = String(window.location.pathname || '');
      var root = window.__TMA_SITE_ROOT || '';
      if (root && p.indexOf(root) === 0) p = p.slice(root.length) || '/';
      if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
      return p === '/email/compose';
    } catch (e) {
      return false;
    }
  }

  function isEmailMobile() {
    // A popped-out composer is a small app window (~760px). Treat it as
    // desktop compose, not the phone mailbox, or the chrome collapses.
    if (isComposePopoutPath()) return false;
    return window.matchMedia(EMAIL_MOBILE_MQ).matches;
  }

  function emailReduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var COMPOSE_PANE_MS = 340;

  /* New Mail / reply occupy the reading pane instead of a floating window.
   * Only one composer is on screen; extra drafts sit minimized in the dock. */
  function paneComposeDraft(state) {
    var open = (state.composeDrafts || []).filter(function (draft) { return !draft.minimized; });
    if (!open.length) return null;
    var focused = open.filter(function (draft) { return draft.id === state.focusedComposeId; })[0];
    return focused || open[open.length - 1];
  }

  function isComposingInPane(state) {
    return !!(state && (state.inlineCompose || paneComposeDraft(state)));
  }

  function enterComposeView(state) {
    if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
  }

  function minimizeOpenComposeDrafts(state) {
    (state.composeDrafts || []).forEach(function (draft) { draft.minimized = true; });
  }

  function afterComposeClosed(state) {
    if (isComposingInPane(state)) return;
    if (!state.selectedId && state.folder !== 'templates') state.reading = false;
    maybeCloseComposePopoutWindow(state);
  }

  function maybeCloseComposePopoutWindow(state) {
    if (!state || !state.composePopout) return;
    if (isComposingInPane(state)) return;
    if (undoSendJob) return;
    window.setTimeout(function () {
      if (isComposingInPane(state) || undoSendJob) return;
      try { window.close(); } catch (e) { /* the OS close button already did */ }
    }, 0);
  }

  function leaveComposeView(state) {
    if (state.inlineCompose) closeInlineCompose(state);
    var draft = paneComposeDraft(state);
    if (draft) closeCompose(state, draft.id);
  }

  function wrapComposeOverlay(state, inner) {
    var cls = 'tma-dash__email-compose-overlay tma-dash__email-detail--compose';
    if (state.composePopout) cls += ' is-open';
    else if (state._composeDismissing) cls += ' is-open is-leaving';
    else if (!state._composeEnter) cls += ' is-open';
    return (
      '<div class="' + cls + '" data-email-compose-overlay data-key="email-compose-overlay">' +
      inner +
      '</div>'
    );
  }

  function cancelComposePaneDismiss(state) {
    state._composeDismissing = false;
    state._composeDismissToken = (state._composeDismissToken || 0) + 1;
  }

  /* Slide the composer off the reading pane, then apply the close. Skipping
   * the wait when nothing is on screen, motion is reduced, or a leave is
   * already playing. */
  function dismissComposePane(root, state, render, mutate) {
    if (state.composePopout) {
      mutate();
      render();
      return;
    }
    if (state._composeDismissing) return;
    var overlay = root && root.querySelector('[data-email-compose-overlay]');
    var play = overlay
      && overlay.classList.contains('is-open')
      && !overlay.classList.contains('is-leaving')
      && !emailReduceMotion();
    if (!play) {
      mutate();
      render();
      return;
    }
    state._composeDismissing = true;
    var token = (state._composeDismissToken || 0) + 1;
    state._composeDismissToken = token;
    overlay.classList.add('is-leaving');
    overlay.setAttribute('aria-hidden', 'true');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      overlay.removeEventListener('transitionend', onEnd);
      if (state._composeDismissToken !== token) return;
      state._composeDismissing = false;
      mutate();
      render();
    }
    function onEnd(event) {
      if (event.target !== overlay) return;
      if (event.propertyName && event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;
      finish();
    }
    overlay.addEventListener('transitionend', onEnd);
    window.setTimeout(finish, COMPOSE_PANE_MS + 40);
  }

  function isSingleReading(state) {
    if (isEmailMobile()) {
      if (!state.reading) return false;
      if (isComposingInPane(state)) return true;
      if (state.folder === 'templates') return !!state.selectedTemplateId;
      return !!state.selectedId;
    }
    if (state.layoutStyle !== 'single' || !state.reading) return false;
    if (isComposingInPane(state)) return true;
    if (state.folder === 'templates') return !!state.selectedTemplateId;
    return !!state.selectedId;
  }

  function isEmailBulkActive(state) {
    return isEmailMobile() && !isSingleReading(state) && selectedEmailCount(state) > 0;
  }

  function getFolderLabel(state) {
    if (state.activeLabelId) {
      var label = getEmailLabel(state.activeLabelId, state);
      return label ? label.name : 'Inbox';
    }
    for (var i = 0; i < FOLDERS.length; i++) {
      if (FOLDERS[i].id === state.folder) return FOLDERS[i].label;
    }
    return 'Inbox';
  }

  function renderDetailBack(state, iconOnly) {
    if (!(state.layoutStyle === 'single' || isEmailMobile()) || !state.reading) return '';
    var label = state.folder === 'templates' ? 'Templates' : 'Inbox';
    if (iconOnly) {
      return (
        '<button type="button" class="tma-dash__email-detail-topbar-btn tma-dash__email-detail-back" data-email-back aria-label="Back to ' + esc(label) + '">' +
        '<img src="' + ICONS.CaretLeft + '" alt="">' +
        '</button>'
      );
    }
    return (
      '<button type="button" class="tma-dash__email-detail-back" data-email-back aria-label="Back to ' + esc(label) + '">' +
      '<img src="' + ICONS.CaretLeft + '" alt="">' +
      '<span>' + esc(label) + '</span>' +
      '</button>'
    );
  }

  function getDetailNavState(state) {
    if (!state.selectedId || state.folder === 'templates') return null;
    var rows = filteredInbox(state);
    if (!rows.length) return null;
    var index = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === state.selectedId) {
        index = i;
        break;
      }
    }
    if (index === -1) return null;
    return {
      index: index,
      total: rows.length,
      prevId: index > 0 ? rows[index - 1].id : null,
      nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    };
  }

  function renderDetailNavBtn(dir, label, enabled) {
    var cls = 'tma-dash__email-detail-nav-btn';
    if (!enabled) cls += ' tma-dash__email-detail-nav-btn--disabled';
    var attrs = ' data-email-nav="' + dir + '"';
    if (!enabled) attrs += ' disabled aria-disabled="true"';
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-nav-' + dir,
      label: label,
      className: cls,
      attrs: attrs,
      innerHtml: '<img src="' + ICONS[dir === 'prev' ? 'CaretLeft' : 'CaretRight'] + '" alt="">',
    });
  }

  function renderDetailNav(state) {
    var nav = getDetailNavState(state);
    if (!nav) return '';
    return (
      '<nav class="tma-dash__email-detail-nav" aria-label="Message navigation">' +
      renderDetailNavBtn('prev', 'Previous message', !!nav.prevId) +
      '<span class="tma-dash__email-detail-nav-count">' + (nav.index + 1) + ' of ' + nav.total.toLocaleString() + '</span>' +
      renderDetailNavBtn('next', 'Next message', !!nav.nextId) +
      '</nav>'
    );
  }

  function detailTopbarActions(state) {
    var archive = state.folder === 'archive'
      ? { id: 'inbox', icon: 'ArchiveTray', label: 'Move to inbox' }
      : { id: 'archive', icon: 'Archive', label: 'Archive' };
    return [
      archive,
      { id: 'spam', icon: 'WarningOctagon', label: 'Report spam' },
      { id: 'delete', icon: 'Trash', label: 'Delete' },
      { id: 'unread', icon: 'EnvelopeSimple', label: 'Mark as unread' },
      { id: 'more', icon: 'DotsThree', label: 'More' },
    ];
  }

  /* The actions beside the sender, at the top of the open message. Reply all
   * lives here rather than only at the foot of the thread, replying to
   * everyone is a decision made while reading the header, not after scrolling
   * past the whole message. */
  var DETAIL_MESSAGE_ACTIONS = [
    { id: 'star', icon: 'Star', label: 'Star' },
    { id: 'reply', icon: 'ArrowBendUpLeft', label: 'Reply' },
    { id: 'reply-all', icon: 'ArrowBendDoubleUpLeft', label: 'Reply all' },
    { id: 'forward', icon: 'ArrowBendUpRight', label: 'Forward' },
    { id: 'more', icon: 'DotsThree', label: 'More' },
  ];

  var DETAIL_MESSAGE_ACTIONS_MOBILE = [
    { id: 'star', icon: 'Star', label: 'Star' },
    { id: 'reply', icon: 'ArrowBendUpLeft', label: 'Reply' },
    { id: 'more', icon: 'DotsThree', label: 'More' },
  ];

  function renderDetailTopbarBtn(action) {
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-topbar-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-detail-topbar-btn',
      attrs: ' data-email-detail-topbar="' + esc(action.id) + '"',
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderDetailMessageActionBtn(action) {
    var attrs = '';
    if (action.id === 'reply') attrs = ' data-email-inline-compose="reply"';
    if (action.id === 'forward') attrs = ' data-email-inline-compose="forward"';
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-action',
      attrs: attrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function syncInlineCompose(state) {
    if (state.inlineCompose && state.inlineCompose.messageId !== state.selectedId) {
      closeInlineCompose(state);
    }
  }

  function getReplySubject(subject) {
    var trimmed = (subject || '').trim();
    if (/^re:/i.test(trimmed)) return trimmed;
    return 'Re: ' + trimmed;
  }

  function getForwardSubject(subject) {
    var trimmed = (subject || '').trim();
    if (/^fwd?:/i.test(trimmed) || /^fw:/i.test(trimmed)) return trimmed;
    return 'Fwd: ' + trimmed;
  }

  function mailboxAddress() {
    return String(MAILBOX_EMAIL || PROFILE.email || '').toLowerCase();
  }

  function addressEmailOf(address) {
    if (!address) return '';
    if (typeof address === 'string') return address.toLowerCase();
    return String(address.email || '').toLowerCase();
  }

  function isSelfAddress(address) {
    var email = addressEmailOf(address);
    if (!email) return false;
    var mailbox = mailboxAddress();
    var profile = String(PROFILE.email || '').toLowerCase();
    return (mailbox && email === mailbox) || (profile && email === profile);
  }

  function uniqueAddresses(list) {
    var seen = {};
    return (list || []).filter(function (address) {
      var email = addressEmailOf(address);
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    });
  }

  function replyToAddress(row) {
    if (row && row.replyTo) {
      var parsed = parseAddresses(row.replyTo);
      if (parsed.length) return parsed[0];
      return { email: row.replyTo };
    }
    return { name: row && row.sender, email: rowSenderEmail(row) };
  }

  function isFromSelf(row) {
    return isSelfAddress({ email: rowSenderEmail(row) });
  }

  /* Reply goes to Reply-To (or From). Replying to mail you sent goes back to
   * the people you wrote to, the same as Gmail and Outlook. */
  function replyRecipients(row) {
    if (isFromSelf(row)) {
      return uniqueAddresses((row.to || []).filter(function (a) { return !isSelfAddress(a); }));
    }
    return [replyToAddress(row)];
  }

  function replyAllRecipients(row) {
    var to = [];
    if (!isFromSelf(row)) to.push(replyToAddress(row));
    to = uniqueAddresses(to.concat(Array.isArray(row.to) ? row.to : []).filter(function (a) {
      return !isSelfAddress(a);
    }));
    var inTo = {};
    to.forEach(function (a) { inTo[addressEmailOf(a)] = true; });
    var cc = uniqueAddresses((Array.isArray(row.cc) ? row.cc : []).filter(function (a) {
      return !isSelfAddress(a) && !inTo[addressEmailOf(a)];
    }));
    return { to: to, cc: cc };
  }

  /* {name, email}[] -> "Name <a@b.com>, c@d.com" for an editable address field. */
  function formatAddressList(list) {
    if (!Array.isArray(list)) return '';
    return list
      .map(function (address) {
        if (!address) return '';
        if (typeof address === 'string') return address;
        if (!address.email) return '';
        return address.name ? address.name + ' <' + address.email + '>' : address.email;
      })
      .filter(Boolean)
      .join(', ');
  }

  function rowSenderEmail(row) {
    return row.email || '';
  }

  function renderInlineComposeAvatar() {
    return (
      '<span class="tma-dash__email-message-avatar">' +
      '<img src="' + esc(profileAvatarSrc()) + '" alt="">' +
      '</span>'
    );
  }

  /* The original message's markup, made safe to sit in the page DOM.
   *
   * The reading pane shows bodies inside a sandboxed iframe; the reply quote
   * cannot (it has to travel with the reply), so active content is stripped
   * here instead. Formatting, inline styles, tables, images, links, is
   * exactly what quoting exists to keep, so everything else stays.
   */
  function sanitizeQuotedEmailHtml(html) {
    var doc;
    try {
      doc = new DOMParser().parseFromString('<div id="q">' + html + '</div>', 'text/html');
    } catch (e) {
      return '';
    }
    var rootEl = doc.getElementById('q');
    if (!rootEl) return '';

    rootEl.querySelectorAll(
      'script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base'
    ).forEach(function (el) { el.remove(); });

    rootEl.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && /^\s*(javascript|vbscript|data:text)/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return rootEl.innerHTML;
  }

  /* What the quote block carries: the exact HTML when we have it, the plain
   * text only as a fallback. Escaped text loses every line break the moment
   * it renders as HTML, replies used to arrive as one flattened paragraph. */
  function quoteBodyBlock(bodyHtml, bodyText) {
    // The inline style is what the *receiver* sees, the sent quote travels
    // as this exact markup and no portal stylesheet goes with it.
    var quoteStyle = ' style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex"';
    var html = sanitizeQuotedEmailHtml((bodyHtml || '').trim());
    if (html) {
      return '<blockquote class="tma-dash__email-inline-quote-body tma-dash__email-inline-quote-body--html"' +
        quoteStyle + '>' + html + '</blockquote>';
    }
    var text = (bodyText || '').trim();
    if (!text) return '';
    return '<blockquote class="tma-dash__email-inline-quote-body"' + quoteStyle + '>' +
      esc(text).replace(/\r?\n/g, '<br>') + '</blockquote>';
  }

  function renderReplyQuote(row, metaEmail, metaDate, bodyText, bodyHtml) {
    var block = quoteBodyBlock(bodyHtml, bodyText);
    if (!block) return '';
    return (
      '<div class="tma-dash__email-inline-quote">' +
      '<p class="tma-dash__email-inline-quote-lead">On ' + esc(metaDate) + ', ' + esc(row.sender) +
      ' &lt;' + esc(metaEmail) + '&gt; wrote:</p>' +
      block +
      '</div>'
    );
  }

  function renderForwardQuote(row, metaEmail, metaDate, subject, bodyText, bodyHtml) {
    var block = quoteBodyBlock(bodyHtml, bodyText);
    var originalTo = formatAddressList(addressList(row && row.to)) || mailboxAddress();
    return (
      '<div class="tma-dash__email-inline-quote tma-dash__email-inline-quote--forward">' +
      '<p class="tma-dash__email-inline-quote-lead">---------- Forwarded message ---------</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>From:</strong> ' + esc(row.sender) + ' &lt;' + esc(metaEmail) + '&gt;</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>Date:</strong> ' + esc(metaDate) + '</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>Subject:</strong> ' + esc(subject) + '</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>To:</strong> ' + esc(originalTo) + '</p>' +
      block +
      '</div>'
    );
  }

  function renderInlineCompose(state, row, mode, metaEmail, metaDate, subject, bodyText) {
    var isReply = mode === 'reply';
    var isForward = mode === 'forward';
    var isReplyAll = mode === 'reply-all';
    // The message being answered, with its lazily-loaded body, the list row
    // alone only knows the snippet, and quoting the snippet is how replies
    // used to go out as one flattened paragraph.
    var quotedSource = threadMessage(state, row.id) || row;
    var quotedBodyHtml = quotedSource.bodyHtml || '';
    var composeSubject = isForward ? getForwardSubject(subject) : getReplySubject(subject);
    var ic = state.inlineCompose || {};

    var replyToLabel = ic.to || (row.sender + ' <' + metaEmail + '>');
    var typing = ic._typing || {};
    function inlineRecipientInput(field, placeholder, label) {
      return '<input type="text" class="tma-dash__email-inline-compose-input" data-email-inline-compose-field="' + field + '"' +
        ' value="' + esc(typing[field] || '') + '" placeholder="' + placeholder + '" aria-label="' + label + '">';
    }
    // A reply answers one address, shown as a fixed pill; reply-all and
    // forward take an editable pill field.
    var toRow = '<div class="tma-dash__email-inline-compose-row">' +
      '<span class="tma-dash__email-inline-compose-label">To</span>' +
      (isReply
        ? renderRecipientField({ value: replyToLabel })
        : renderRecipientField({ value: ic.to, input: inlineRecipientInput('to', 'Recipients', 'To') })) +
      '</div>';

    var ccRow = isReplyAll
      ? '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">Cc</span>' +
        renderRecipientField({ value: ic.cc, input: inlineRecipientInput('cc', 'Cc', 'Cc') }) +
        '</div>'
      : '';

    var subjectRow = isForward
      ? '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">Subject</span>' +
        '<span class="tma-dash__email-inline-compose-value">' + esc(composeSubject) + '</span>' +
        '</div>'
      : '';

    return (
      '<div class="tma-dash__email-thread-actions tma-dash__email-thread-actions--compose">' +
      '<div class="tma-dash__email-inline-compose tma-dash__email-inline-compose--pane" data-email-inline-compose-panel data-key="email-inline-compose">' +
      '<div class="tma-dash__email-inline-compose-head">' +
      renderInlineComposeAvatar() +
      '<div class="tma-dash__email-inline-compose-fields">' +
      toRow + ccRow + subjectRow +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-editor-wrap">' +
      '<div class="tma-dash__email-image-stage tma-dash__email-inline-compose-stage" data-email-image-stage>' +
      '<div class="tma-dash__email-inline-compose-editor" contenteditable="true" data-email-inline-compose-editor data-placeholder="Compose your ' + (isForward ? 'message' : 'reply') + '" aria-label="Message body" role="textbox">' + (ic.bodyHtml || '') + '</div>' +
      renderImageTransformOverlay() +
      '</div>' +
      (isForward
        ? renderForwardQuote(row, metaEmail, metaDate, subject, bodyText, quotedBodyHtml)
        : renderReplyQuote(row, metaEmail, metaDate, bodyText, quotedBodyHtml)) +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-bar">' +
      renderComposeToolbar({ expand: false, attach: true }) +
      '</div>' +
      '<div class="tma-dash__email-compose-files" data-email-compose-files' +
      (composeFilesOf(ic).length ? '' : ' hidden') + '>' +
      renderComposeFileChips(ic) +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-actions">' +
      '<button type="button" class="tma-dash__email-inline-compose-send" data-email-inline-compose-send' + (ic.sending ? ' disabled' : '') + '>' +
      (ic.sending ? 'Sending…' : 'Send') + '</button>' +
      '<div class="tma-dash__email-inline-compose-tools">' +
      '<button type="button" class="tma-dash__email-inline-compose-discard" data-email-inline-compose-attach aria-label="Attach file">' +
      '<img src="' + ICONS.Paperclip + '" alt=""></button>' +
      '<button type="button" class="tma-dash__email-inline-compose-discard" data-email-inline-compose-close aria-label="Discard draft">' +
      '<img src="' + ICONS.Trash + '" alt="">' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-compose-drop" data-email-compose-drop aria-hidden="true">Drop files to attach</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDetailThreadActions(state, row, metaEmail, metaDate, subject, bodyText) {
    var mobile = isEmailMobile();
    return (
      '<div class="tma-dash__email-thread-actions' + (mobile ? ' tma-dash__email-thread-actions--mobile' : '') + '">' +
      '<div class="tma-dash__email-thread-btns">' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="reply">' +
      '<img src="' + ICONS.ArrowBendUpLeft + '" alt=""> Reply' +
      '</button>' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="reply-all">' +
      '<img src="' + ICONS.ArrowBendDoubleUpLeft + '" alt=""> Reply all' +
      '</button>' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="forward">' +
      '<img src="' + ICONS.ArrowBendUpRight + '" alt=""> Forward' +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function openInlineCompose(state, mode) {
    if (!state.selectedId) return;
    closeRecipientSuggest();
    // The open message may be one the thread carries rather than a row on the
    // page, its cc list is what "reply all" has to answer.
    var row = threadMessage(state, state.selectedId) || findAnyRow(state, state.selectedId);
    var to = '';
    var cc = '';
    if (row && mode === 'reply') {
      to = formatAddressList(replyRecipients(row));
    } else if (row && mode === 'reply-all') {
      var all = replyAllRecipients(row);
      to = formatAddressList(all.to);
      cc = formatAddressList(all.cc);
    }
    // Same as new compose: seed the signature into the draft so it paints and
    // leaves with the reply even if the user never types in the body. Blank
    // blocks sit above it so a tall signature image cannot eat the typing area.
    minimizeOpenComposeDrafts(state);
    state.inlineCompose = {
      mode: mode,
      messageId: state.selectedId,
      to: to,
      cc: cc,
      bodyHtml: inlineComposeBodyHtml(),
      sending: false,
      attachments: [],
    };
    enterComposeView(state);
    state._focusInlineCompose = true;
    state._composeEnter = true;
  }

  /* The loaded thread's copy of a message, the only one that carries cc, bcc
   * and a body. List rows never do. */
  function threadMessage(state, id) {
    if (!state.thread || !id) return null;

    return state.thread.messages.filter(function (m) { return m.id === id; })[0] || null;
  }

  function closeInlineCompose(state) {
    state.inlineCompose = null;
    afterComposeClosed(state);
  }

  function inlineComposeTitle(mode, subject) {
    var kind = mode === 'forward' ? 'Forward' : (mode === 'reply-all' ? 'Reply all' : 'Reply');
    var titled = mode === 'forward' ? getForwardSubject(subject) : getReplySubject(subject);
    return titled ? kind + ' \u00b7 ' + titled : kind;
  }

  function renderDetailInlineCompose(state, row) {
    var lines = rowListLines(row);
    var subject = (state.thread && state.thread.subject) || lines.subject;
    var metaEmail = row.email || '';
    var metaDate = formatMessageDate(row);
    var ic = state.inlineCompose;
    var mobile = isEmailMobile();
    var popoutBtn = (!mobile && !state.composePopout)
      ? '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-popout="inline" aria-label="Open in new window">' +
        '<img src="' + ICONS.ArrowSquareOut + '" alt=""></button>'
      : '';
    return (
      '<div class="tma-dash__email-compose-window-head">' +
      (!mobile && !state.composePopout ? renderDetailBack(state, true) : '') +
      '<span class="tma-dash__email-compose-window-title">' +
      esc(inlineComposeTitle(ic.mode, subject)) + '</span>' +
      '<div class="tma-dash__email-compose-window-actions">' +
      popoutBtn +
      '<button type="button" class="tma-dash__email-compose-window-btn" data-email-inline-compose-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>' +
      '</div></div>' +
      renderInlineCompose(state, row, ic.mode, metaEmail, metaDate, subject, lines.body)
    );
  }

  function renderDetailComposeDraft(state, draft) {
    var mobile = isEmailMobile();
    return (
      '<div class="tma-dash__email-compose-window tma-dash__email-compose-window--pane' +
      ' tma-dash__email-compose-window--focused" data-email-compose-window="' + esc(draft.id) + '"' +
      ' data-key="email-compose-window-' + esc(draft.id) + '">' +
      renderComposeWindowHead(draft, {
        pane: true,
        popout: !!state.composePopout,
        backHtml: (!mobile && !state.composePopout) ? renderDetailBack(state, true) : '',
      }) +
      '<div class="tma-dash__email-compose-window-body">' +
      renderComposeContent(draft) +
      '</div>' +
      '<div class="tma-dash__email-compose-drop" data-email-compose-drop aria-hidden="true">Drop files to attach</div>' +
      '</div>'
    );
  }

  function focusInlineComposeEditor(root) {
    var editor = root.querySelector('[data-email-inline-compose-editor]');
    if (!editor) return;
    editor.focus();
    if (typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined') {
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  function focusPaneCompose(root, draftId) {
    var win = root.querySelector('[data-email-compose-window="' + draftId + '"]');
    if (!win) return;
    var to = win.querySelector('[data-email-compose-field="to"]');
    var body = win.querySelector('[data-email-compose-body]');
    var hasPills = !!(win.querySelector('[data-email-recipient]'));
    var target = (to && !to.value && !hasPills) ? to : body;
    if (target) target.focus();
  }

  /* Field edits and the editor body write straight to state.inlineCompose —
   * no re-render here, same reasoning as wireComposeEvents: repainting the
   * panel while the user is typing would move the caret out from under them. */
  function wireInlineComposeEvents(root, state, render) {
    var panel = root.querySelector('[data-email-inline-compose-panel]');
    if (!panel) return;

    MORPH.unwired(panel, '[data-email-inline-compose-field]').forEach(function (input) {
      var field = input.getAttribute('data-email-inline-compose-field');
      if (field === 'to' || field === 'cc') {
        wireRecipientField(input, function (value, typing) {
          if (!state.inlineCompose) return;
          state.inlineCompose[field] = value;
          state.inlineCompose._typing = state.inlineCompose._typing || {};
          state.inlineCompose._typing[field] = typing;
        });
        wireRecipientSuggest(input);
        return;
      }
      input.addEventListener('input', function () {
        if (!state.inlineCompose) return;
        state.inlineCompose[field] = input.value;
      });
    });

    var editor = panel.querySelector('[data-email-inline-compose-editor]');
    if (editor) {
      prepareEditableImages(editor);
      wireComposeMention(editor);
      MORPH.on(editor, 'input', function () {
        if (!state.inlineCompose) return;
        state.inlineCompose.bodyHtml = editor.innerHTML;
      });
      MORPH.on(editor, 'paste', function (event) {
        var files = clipboardFileList(event);
        if (!files) return;
        event.preventDefault();
        attachFilesToComposeEditor(root, state, editor, files);
      });
    }

    MORPH.unwired(panel, '[data-email-insert-image]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (event) {
        event.preventDefault();
      });
      btn.addEventListener('click', function () {
        var target = resolveImageEditor(btn, root);
        if (!target) return;
        openInsertImagePicker(root, state, target);
      });
    });

    var sendBtn = panel.querySelector('[data-email-inline-compose-send]');
    if (sendBtn) {
      MORPH.on(sendBtn, 'click', function (event) {
        event.stopPropagation();
        sendInlineCompose(root, state, render);
      });
    }

    MORPH.unwired(panel, '[data-email-inline-compose-attach]').forEach(function (attachBtn) {
      attachBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (!state.inlineCompose) return;
        openComposeFilePicker(function (files) {
          addComposeFiles(root, state.inlineCompose, files, function () {
            paintComposeFileChips(panel, state.inlineCompose);
          });
        });
      });
    });

    wireComposeDropTarget(panel, function (files) {
      if (!state.inlineCompose) return;
      addComposeFiles(root, state.inlineCompose, files, function () {
        paintComposeFileChips(panel, state.inlineCompose);
      });
    });
  }

  function sendInlineCompose(root, state, render) {
    var ic = state.inlineCompose;
    if (!ic || ic.sending || ic._sendRequested) return;

    var row = threadMessage(state, ic.messageId) || findAnyRow(state, ic.messageId);
    if (!row) {
      dismissComposePane(root, state, render, function () {
        closeInlineCompose(state);
      });
      return;
    }

    commitRecipientFields(root.querySelector('[data-email-inline-compose-panel]'));
    var to = parseAddresses(ic.to);
    if (!to.length && ic.mode === 'reply') to = replyRecipients(row);
    if (!to.length) {
      showEmailToast(root, 'Add at least one recipient');
      return;
    }

    var panel = root.querySelector('[data-email-inline-compose-panel]');
    var editor = panel && panel.querySelector('[data-email-inline-compose-editor]');
    var quote = panel && panel.querySelector('.tma-dash__email-inline-quote');
    var bodyHtml = (editor ? editor.innerHTML : ic.bodyHtml || '') + (quote ? quote.outerHTML : '');
    var subject = ic.mode === 'forward' ? getForwardSubject(row.subject) : getReplySubject(row.subject);
    var payload = {
      to: to,
      cc: ic.mode === 'reply-all' ? parseAddresses(ic.cc) : [],
      subject: subject,
      bodyHtml: bodyHtml,
      mode: ic.mode,
      inReplyTo: ic.mode === 'new' ? null : ic.messageId,
      attachments: composeFilePayload(ic),
    };

    window.clearTimeout(ic._saveTimer);
    var seconds = undoSendWindowSeconds(state);
    if (seconds <= 0) {
      ic.sending = true;
      render();
      dispatchUndoSend(root, state, render, { kind: 'inline', inline: ic, payload: payload });
      return;
    }

    ic._sendRequested = true;
    startUndoSend(root, state, render, {
      kind: 'inline',
      inline: ic,
      seconds: seconds,
      payload: payload,
    });
    dismissComposePane(root, state, render, function () {
      closeInlineCompose(state);
    });
  }

  function renderEmailHeaderReadingBack(state) {
    if (!(state.layoutStyle === 'single' || isEmailMobile()) || !state.reading) return '';
    var label = state.folder === 'templates' ? 'Templates' : 'Inbox';
    return (
      '<div class="tma-dash__email-header-reading-back">' +
      '<button type="button" class="tma-dash__email-header-reading-back-btn" data-email-back aria-label="Back to ' + esc(label) + '">' +
      '<img src="' + ICONS.CaretLeft + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailHeaderReadingTools(state) {
    if (isComposingInPane(state)) return '';
    var topbarActions = detailTopbarActions(state).filter(function (action) { return action.id !== 'spam'; });
    var actions = topbarActions.map(renderDetailTopbarBtn).join('');
    if (!actions) return '';
    return (
      '<div class="tma-dash__email-header-reading-tools">' +
      '<div class="tma-dash__email-header-reading-tools-group" role="toolbar" aria-label="Message actions">' +
      actions +
      '</div>' +
      '</div>'
    );
  }

  function renderEmailHeaderBulkClose() {
    return (
      '<div class="tma-dash__email-header-bulk-close">' +
      '<button type="button" class="tma-dash__email-header-reading-back-btn" data-email-bulk-clear aria-label="Clear selection">' +
      '<img src="' + ICONS.X + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailHeaderBulkBtn(action, state) {
    var extraAttrs = '';
    if (action.id === 'more') {
      extraAttrs =
        ' data-email-bulk-more-toggle aria-haspopup="menu" aria-expanded="' +
        (state.bulkMoreMenuOpen ? 'true' : 'false') +
        '"';
    }
    return renderEmailIconTooltipBtn({
      tipId: 'email-header-bulk-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-detail-topbar-btn tma-dash__email-header-bulk-btn',
      attrs: ' data-email-bulk-action="' + esc(action.id) + '"' + extraAttrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderEmailHeaderBulkTools(state) {
    return (
      '<div class="tma-dash__email-header-bulk-tools">' +
      '<div class="tma-dash__email-header-reading-tools-group" role="toolbar" aria-label="Bulk actions">' +
      bulkActionsForFolder(state.folder).map(function (action) { return renderEmailHeaderBulkBtn(action, state); }).join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderDetailTopbarActions(state) {
    return renderEmailHeaderReadingBack(state) + renderEmailHeaderReadingTools(state);
  }

  function renderDetailTopbar(state) {
    if (isEmailMobile()) return '';
    // Back sits on the subject row now, so this strip is unused.
    return '';
  }

  function renderEmailTooltipMarkup(tipId, label) {
    return (
      '<div id="' + esc(tipId) + '" class="tma-tooltip tma-tooltip--compact tma-tooltip--bottom tma-tooltip-trigger__tip" role="tooltip" aria-hidden="true" style="--tooltip-font-size:12px;--tooltip-line-height:16px;--tooltip-padding-x:8px;--tooltip-padding-y:4px;--tooltip-radius:12px;">' +
      '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--inline"><span class="tma-tooltip__text">' + esc(label) + '</span></div></div>' +
      '<span class="tma-tooltip__arrow" aria-hidden="true"></span>' +
      '</div>'
    );
  }

  function renderEmailIconTooltipBtn(opts) {
    return (
      '<button type="button" class="' + opts.className + ' tma-tooltip-trigger"' +
      ' aria-label="' + esc(opts.label) + '"' +
      ' aria-describedby="' + esc(opts.tipId) + '"' +
      ' data-tooltip-trigger data-tooltip-type="email-action" data-tooltip-position="bottom"' +
      ' data-tooltip-initial-delay="500" data-tooltip-rehover-delay="0" data-tooltip-rehover-window="30000"' +
      (opts.attrs || '') +
      (opts.disabled ? ' disabled aria-disabled="true"' : '') +
      '>' +
      opts.innerHtml +
      renderEmailTooltipMarkup(opts.tipId, opts.label) +
      '</button>'
    );
  }

  /* Ids the top toolbar should act on: ticked rows, or the open message. */
  function emailToolbarTargetIds(state) {
    var ids = Object.keys(state.checkedIds || {});
    if (ids.length) return ids;
    return state.selectedId ? [state.selectedId] : [];
  }

  function emailToolbarActions(folder) {
    var archiveAction = folder === 'archive'
      ? { id: 'inbox', label: 'Move to inbox', icon: 'ArchiveTray' }
      : { id: 'archive', label: 'Archive', icon: 'Archive' };
    return [
      { id: 'delete', label: 'Delete', icon: 'Trash' },
      archiveAction,
      { id: 'move', label: 'Label as', icon: 'Tag' },
      { id: 'unread', label: 'Mark as unread', icon: 'EnvelopeSimple' },
      { id: 'spam', label: 'Report spam', icon: 'WarningOctagon' },
      { id: 'more', label: 'More', icon: 'DotsThree' },
    ];
  }

  /*
   * Page-level mail toolbar, sits above the folder rail, list and reading
   * pane, same role as the Files toolbar / an Outlook ribbon. New Mail and
   * Sync are always live; the rest enable once something is ticked or open.
   */
  function renderEmailSelectAll(state, opts) {
    opts = opts || {};
    var selection = selectionSummary(state);
    var cls = 'tma-dash__email-list-check';
    if (opts.className) cls += ' ' + opts.className;

    return (
      '<label class="' + cls + '" title="Select all">' +
      '<input type="checkbox" class="tma-dash__check" data-email-selectall' +
      (selection.all ? ' checked' : '') +
      ' aria-label="Select all">' +
      '</label>'
    );
  }

  function renderEmailToolbar(state) {
    if (isEmailMobile()) return '';

    var hasTarget = emailToolbarTargetIds(state).length > 0;
    var actions = emailToolbarActions(state.folder).map(function (action) {
      var extraAttrs = '';
      if (action.id === 'more') {
        extraAttrs =
          ' data-email-bulk-more-toggle aria-haspopup="menu" aria-expanded="' +
          (state.bulkMoreMenuOpen ? 'true' : 'false') +
          '"';
      }
      return renderEmailIconTooltipBtn({
        tipId: 'email-toolbar-tip-' + action.id,
        label: action.label,
        className: 'tma-dash__tool-btn tma-dash__email-toolbar-btn',
        attrs: ' data-email-bulk-action="' + esc(action.id) + '" data-email-toolbar-action' + extraAttrs,
        disabled: !hasTarget,
        innerHtml:
          '<img src="' + esc(ICONS[action.icon]) + '" alt="">' +
          '<span class="tma-dash__email-toolbar-btn-label">' + esc(action.label) + '</span>',
      });
    }).join('');

    return (
      '<div class="tma-dash__toolbar tma-dash__email-toolbar' +
      (hasTarget ? ' tma-dash__email-toolbar--ready' : '') +
      '" data-email-toolbar>' +
      '<div class="tma-dash__toolbar-actions">' +
      renderEmailSidebarMenuBtn(state) +
      renderEmailSelectAll(state, { className: 'tma-dash__email-toolbar-check' }) +
      renderEmailIconTooltipBtn({
        tipId: 'email-toolbar-tip-compose',
        label: 'New Mail',
        className: 'tma-dash__tool-btn tma-dash__email-toolbar-btn',
        attrs: ' data-email-folder="compose"',
        innerHtml:
          '<img src="' + ICONS.PencilSimple + '" alt="">' +
          '<span class="tma-dash__email-toolbar-btn-label">New Mail</span>',
      }) +
      '<span class="tma-dash__email-toolbar-actions" role="toolbar" aria-label="Mail actions">' +
      actions +
      '</span>' +
      renderEmailIconTooltipBtn({
        tipId: 'email-toolbar-tip-refresh',
        label: 'Sync',
        className: 'tma-dash__tool-btn tma-dash__email-toolbar-btn' +
          (state.refreshing ? ' tma-dash__email-toolbar-btn--spinning' : ''),
        attrs: ' data-email-refresh' + (state.refreshing ? ' aria-busy="true"' : ''),
        innerHtml:
          '<img src="' + ICONS.ArrowsClockwise + '" alt="">' +
          '<span class="tma-dash__email-toolbar-btn-label">Sync</span>',
      }) +
      renderEmailBulkMoreMenu(state) +
      renderEmailLabelMenu(state) +
      '</div>' +
      '<div class="tma-dash__email-toolbar-end">' +
      renderLayoutToggle(state) +
      renderEmailIconTooltipBtn({
        tipId: 'email-toolbar-tip-settings',
        label: 'Email settings',
        className: 'tma-dash__tool-btn tma-dash__email-toolbar-btn tma-dash__email-toolbar-settings',
        attrs: ' data-email-open-settings',
        innerHtml:
          '<img src="' + ICONS.GearSix + '" alt="">' +
          '<span class="tma-dash__email-toolbar-btn-label">Settings</span>',
      }) +
      renderDetailNav(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderLayoutToggle(state) {
    return (
      '<div class="tma-dash__email-layout-toggle" role="group" aria-label="Inbox layout">' +
      renderEmailIconTooltipBtn({
        tipId: 'email-layout-tip-split',
        label: 'Inbox with preview pane',
        className: 'tma-dash__email-layout-btn' + (state.layoutStyle === 'split' ? ' tma-dash__email-layout-btn--active' : ''),
        attrs:
          ' data-email-layout="split" aria-pressed="' + (state.layoutStyle === 'split' ? 'true' : 'false') + '"',
        innerHtml:
          '<img src="' + ICONS.SidebarSimple + '" alt="">' +
          '<span class="tma-dash__email-layout-btn-label">Split</span>',
      }) +
      renderEmailIconTooltipBtn({
        tipId: 'email-layout-tip-single',
        label: 'Inbox list only',
        className: 'tma-dash__email-layout-btn' + (state.layoutStyle === 'single' ? ' tma-dash__email-layout-btn--active' : ''),
        attrs:
          ' data-email-layout="single" aria-pressed="' + (state.layoutStyle === 'single' ? 'true' : 'false') + '"',
        innerHtml:
          '<img src="' + ICONS.List + '" alt="">' +
          '<span class="tma-dash__email-layout-btn-label">List</span>',
      }) +
      '</div>'
    );
  }

  function renderEmailListFilterBtn(state) {
    var bulkCount = selectedEmailCount(state);
    if (bulkCount > 0) return '';
    var active = state.listFilter && state.listFilter !== 'all';
    var filterItems = [
      { id: 'all', label: 'All' },
      { id: 'unread', label: 'Unread' },
      { id: 'starred', label: 'Starred' },
      { id: 'attachments', label: 'Has attachments' },
      { id: 'pinned', label: 'Pinned' },
    ];
    return (
      '<div class="tma-dash__email-filter-wrap" data-email-filter-wrap>' +
      renderEmailIconTooltipBtn({
        tipId: 'email-filter-tip',
        label: active ? 'Filter: ' + (state.listFilter || 'all') : 'Filter',
        className: 'tma-dash__email-filter' + (active ? ' is-active' : ''),
        attrs: ' data-email-filter aria-haspopup="menu" aria-expanded="' + (state.filterMenuOpen ? 'true' : 'false') + '"',
        innerHtml: '<img src="' + ICONS.FunnelSimple + '" alt="">',
      }) +
      '<div class="tma-dash__menu tma-dash__email-filter-menu" data-email-filter-menu role="menu" aria-label="Filter messages"' +
      (state.filterMenuOpen ? '' : ' hidden') + '>' +
      filterItems.map(function (item) {
        var on = (state.listFilter || 'all') === item.id;
        return (
          '<button type="button" class="tma-dash__menu-item' + (on ? ' tma-dash__menu-item--active' : '') +
          '" role="menuitem" data-email-filter-item="' + esc(item.id) + '">' + esc(item.label) + '</button>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  function renderEmailListRefreshBtn(state) {
    var cls = 'tma-dash__email-refresh-btn' + (state.refreshing ? ' tma-dash__email-refresh-btn--spinning' : '');
    return renderEmailIconTooltipBtn({
      tipId: 'email-refresh-tip',
      label: 'Refresh',
      className: cls,
      attrs: ' data-email-refresh' + (state.refreshing ? ' aria-busy="true"' : ''),
      innerHtml: '<img src="' + ICONS.ArrowsClockwise + '" alt="">',
    });
  }

  /* Folder-list toggle, lives in the page toolbar beside New Mail so it
   * stays reachable when the sidebar is hidden. */
  function renderEmailSidebarMenuBtn(state) {
    if (isEmailMobile()) return '';
    var collapsed = effectiveSidebarMode(state) !== 'full';
    var label = collapsed ? 'Show mail folders' : 'Hide mail folders';
    return renderEmailIconTooltipBtn({
      tipId: 'email-sidebar-menu-tip',
      label: label,
      className: 'tma-dash__email-sidebar-menu-btn' + (collapsed ? '' : ' is-active'),
      attrs:
        ' data-email-sidebar-toggle aria-pressed="' + (collapsed ? 'false' : 'true') + '"',
      innerHtml: '<img src="' + ICONS.List + '" alt="">',
    });
  }

  function renderListHeadActions(state, opts) {
    opts = opts || {};
    // Layout toggle lives in the page toolbar on desktop; keep it here on
    // mobile where that toolbar is hidden.
    var html =
      '<div class="tma-dash__email-list-head-actions">' +
      (opts.templateCount != null
        ? '<span class="tma-dash__email-template-list-count">' + opts.templateCount + '</span>'
        : '') +
      (isEmailMobile() ? renderLayoutToggle(state) : '');
    if (opts.showFilter !== false) {
      html += renderEmailListFilterBtn(state);
    }
    html += '</div>';
    return html;
  }

  function renderListMobileHead(state) {
    var searching = !!state.search;
    return (
      '<div class="tma-dash__email-list-mobile-head">' +
      '<span class="tma-dash__email-list-mobile-title">' +
      (searching ? 'Results for “' + esc(state.search) + '”' : esc(getFolderLabel(state))) +
      '</span>' +
      '<div class="tma-dash__email-list-mobile-actions">' +
      // The header field is not on a phone, so the clear lives with the list.
      (searching
        ? '<button type="button" class="tma-dash__email-list-mobile-clear" data-email-search-clear aria-label="Clear search">' +
          '<img src="' + ICONS.XCircle + '" alt="">' +
          '</button>'
        : '') +
      renderEmailListFilterBtn(state) +
      '</div>' +
      '</div>'
    );
  }

  function emailLabels(state) {
    // Only user-created portal labels, provider-synced defaults are excluded
    // server-side and again here as a safety net.
    return ((state && state.labels) || []).filter(function (label) {
      return !!(label && label.localOnly);
    });
  }

  function renderLabelTag(tone, sizeCls) {
    var cls = 'tma-dash__email-label-tag tma-dash__email-label-tag--' + esc(tone);
    if (sizeCls) cls += ' ' + sizeCls;
    return '<span class="' + cls + '" aria-hidden="true"></span>';
  }

  function getEmailLabel(labelId, state) {
    var labels = emailLabels(state);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].id === labelId) return labels[i];
    }
    return null;
  }

  function getRowLabelIds(rowId, state) {
    var row = findRow(state, rowId);
    return (row && row.labels) || [];
  }

  /* The server counts the whole mailbox at bootstrap (label.count); counting
   * loaded rows would only ever see the current page. Local toggles adjust
   * the number optimistically via adjustLabelCount. */
  function labelMessageCount(labelId, state) {
    var label = getEmailLabel(labelId, state);
    if (label && typeof label.count === 'number') return label.count;
    return rowsOf(state).filter(function (row) {
      return rowHasLabel(row.id, labelId, state);
    }).length;
  }

  function adjustLabelCount(state, labelId, delta) {
    var label = getEmailLabel(labelId, state);
    if (label && typeof label.count === 'number') {
      label.count = Math.max(0, label.count + delta);
    }
  }

  function renderDetailLabelChip(name, tone, opts) {
    opts = opts || {};
    var cls = 'tma-dash__email-detail-label-chip tma-dash__email-detail-label-chip--' + esc(tone);
    var removeBtn = '';
    if (opts.removable && opts.rowId && opts.labelId) {
      removeBtn =
        '<button type="button" class="tma-dash__email-detail-label-remove"' +
        ' data-email-detail-label-remove data-email-row-id="' + esc(opts.rowId) + '"' +
        ' data-email-label-id="' + esc(opts.labelId) + '"' +
        ' aria-label="Remove ' + esc(name) + '">' +
        '<img src="' + ICONS.X + '" alt="">' +
        '</button>';
    }
    return '<span class="' + cls + '"><span class="tma-dash__email-detail-label-chip-text">' + esc(name) + '</span>' + removeBtn + '</span>';
  }

  function getFolderLabelName(folder) {
    for (var i = 0; i < FOLDERS.length; i++) {
      if (FOLDERS[i].id === folder) return FOLDERS[i].label;
    }
    return folder;
  }

  function isDetailChipHidden(state, rowId, chipId) {
    return !!(state.hiddenDetailChips[rowId] && state.hiddenDetailChips[rowId][chipId]);
  }

  function renderInboxRowLabelChips(rowId, state) {
    var ids = getRowLabelIds(rowId, state);
    if (!ids.length) return '';
    return (
      '<span class="tma-dash__email-row-labels">' +
      ids
        .map(function (labelId) {
          var label = getEmailLabel(labelId, state);
          return label ? renderDetailLabelChip(label.name, label.tone) : '';
        })
        .join('') +
      '</span>'
    );
  }

  function renderDetailLabelChipsHtml(row, state) {
    var chips = [];
    var folderName = getFolderLabelName(state.folder);

    if (state.folder !== 'templates' && folderName) {
      chips.push(renderDetailLabelChip(folderName, 'neutral'));
    }

    if (row.email && !isDetailChipHidden(state, row.id, 'address')) {
      chips.push(
        renderDetailLabelChip(row.email, 'yellow', {
          removable: true,
          rowId: row.id,
          labelId: 'address',
        })
      );
    }

    getRowLabelIds(row.id, state).forEach(function (labelId) {
      var label = getEmailLabel(labelId, state);
      if (label) {
        chips.push(
          renderDetailLabelChip(label.name, label.tone, {
            removable: true,
            rowId: row.id,
            labelId: labelId,
          })
        );
      }
    });

    return chips.join('');
  }

  function starIconSrc(starred) {
    return starred ? ICONS.StarFilled : ICONS.Star;
  }

  function importantIconSrc(important) {
    return important ? ICONS.FlagFilled : ICONS.Important;
  }

  function pinIconSrc(pinned) {
    return pinned ? ICONS.PushPinFilled : ICONS.PushPin;
  }

  function renderDetailSubjectStar(row, state) {
    var starred = isRowStarred(row, state);
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-tip-star-' + row.id,
      label: starred ? 'Remove star' : 'Add star',
      className: 'tma-dash__email-detail-star' + (starred ? ' tma-dash__email-detail-star--active' : ''),
      attrs: ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
      innerHtml: '<img src="' + starIconSrc(starred) + '" alt="">',
    });
  }

  function renderDetailSubject(subject, row, state) {
    var important = isRowImportant(row, state);
    var importantLabel = important ? 'Mark as not important' : 'Mark as important';
    var labelsHtml = renderDetailLabelChipsHtml(row, state);
    var mobile = isEmailMobile();
    if (mobile) {
      // The subject wraps in full with the star beside it; labels take a row
      // of their own underneath, so a long label never truncates the title.
      return (
        '<div class="tma-dash__email-detail-subject tma-dash__email-detail-subject--mobile">' +
        '<span class="tma-dash__email-detail-subject-text">' + esc(subject) + '</span>' +
        '<span class="tma-dash__email-detail-subject-trailing">' + renderDetailSubjectStar(row, state) + '</span>' +
        '</div>' +
        (labelsHtml
          ? '<div class="tma-dash__email-detail-subject-labels tma-dash__email-detail-subject-labels--row">' + labelsHtml + '</div>'
          : '')
      );
    }
    return (
      '<div class="tma-dash__email-detail-subject">' +
      '<span class="tma-dash__email-detail-subject-text">' + esc(subject) + '</span>' +
      '<span class="tma-dash__email-detail-subject-trailing">' +
      (mobile
        ? (labelsHtml ? '<span class="tma-dash__email-detail-subject-labels">' + labelsHtml + '</span>' : '') +
          renderDetailSubjectStar(row, state)
        : renderEmailIconTooltipBtn({
            tipId: 'email-detail-tip-important',
            label: importantLabel,
            className: 'tma-dash__email-detail-important' + (important ? ' tma-dash__email-detail-important--active' : ''),
            attrs:
              ' data-email-important="' + esc(row.id) + '" aria-pressed="' + (important ? 'true' : 'false') + '"',
            innerHtml: '<img src="' + importantIconSrc(important) + '" alt="">',
          }) +
          (labelsHtml ? '<span class="tma-dash__email-detail-subject-labels">' + labelsHtml + '</span>' : '')) +
      '</span>' +
      '</div>'
    );
  }

  function renderEmailSidebarTabs(state) {
    var list = emailSidebarList(state);
    var foldersOn = list === 'folders';
    return (
      '<div class="tma-dash__nav-section tma-dash__nav-section--tabs">' +
      '<div class="tma-dash__tabs" role="tablist" aria-label="Mailbox sections">' +
      '<button type="button" class="tma-dash__tab' + (foldersOn ? ' tma-dash__tab--active' : '') + '"' +
      ' data-email-list-tab="folders" role="tab" aria-selected="' + String(foldersOn) + '">Mailboxes</button>' +
      '<button type="button" class="tma-dash__tab' + (foldersOn ? '' : ' tma-dash__tab--active') + '"' +
      ' data-email-list-tab="labels" role="tab" aria-selected="' + String(!foldersOn) + '">Labels</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderEmailLabelsNav(state) {
    var create =
      '<button type="button" class="tma-dash__email-labels-create" data-email-label-create' +
      ' aria-label="Create label" title="Create label">' +
      '<img src="' + ICONS.Plus + '" alt="">' +
      '</button>';
    return (
      '<nav class="tma-dash__email-labels" aria-label="Labels">' +
      create +
      emailLabels(state).map(function (label) {
        var active = state.activeLabelId === label.id;
        var count = labelMessageCount(label.id, state);
        var cls = 'tma-dash__email-label-item';
        if (active) cls += ' tma-dash__email-label-item--active';
        return (
          '<div class="tma-dash__email-label-row' + (active ? ' tma-dash__email-label-row--active' : '') + '">' +
          '<button type="button" class="' + cls + '" data-email-sidebar-label="' + esc(label.id) + '"' +
          ' title="' + esc(label.name) + '" aria-label="' + esc(label.name) + '">' +
          emailNavCaret() +
          renderLabelTag(label.tone) +
          '<span class="tma-dash__email-label-item-name">' + esc(label.name) + '</span>' +
          (count ? '<span class="tma-dash__email-label-item-count">' + count + '</span>' : '') +
          '</button>' +
          '<button type="button" class="tma-dash__email-label-edit" data-email-label-edit="' + esc(label.id) + '"' +
          ' aria-label="Edit label ' + esc(label.name) + '" aria-haspopup="dialog">' +
          '<img src="' + ICONS.PencilSimpleLine + '" alt="">' +
          '</button>' +
          '</div>'
        );
      }).join('') +
      '</nav>'
    );
  }

  /* The create/edit popup behind the sidebar's "+" and each label's pencil.
   * Rendered once (hidden); openEmailLabelEditor fills and positions it, so
   * a background repaint cannot wipe what the user is typing. */
  function renderEmailLabelEditor(state) {
    var tones = ['blue', 'green', 'purple', 'orange', 'red', 'indigo', 'gray'];
    // data-morph-skip: the editor's fields are managed imperatively (open,
    // tone selection, error text), and the background mail poll re-renders
    // the app, without the skip, every poll would wipe what the user typed.
    return (
      '<div class="tma-dash__email-label-editor tma-dash__menu" data-email-label-editor data-morph-skip role="dialog"' +
      ' aria-label="Label editor" hidden>' +
      '<div class="tma-dash__email-label-editor-head" data-email-label-editor-title>New label</div>' +
      '<input type="text" class="tma-dash__email-label-editor-name" data-email-label-editor-name' +
      ' maxlength="100" placeholder="Label name" aria-label="Label name">' +
      '<div class="tma-dash__email-label-editor-tones" role="radiogroup" aria-label="Label colour">' +
      tones.map(function (tone) {
        return (
          '<button type="button" class="tma-dash__email-label-editor-tone" role="radio" aria-checked="false"' +
          ' data-email-label-editor-tone="' + tone + '" aria-label="' + tone + '">' +
          renderLabelTag(tone) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="tma-dash__email-label-editor-error" data-email-label-editor-error hidden></div>' +
      '<div class="tma-dash__email-label-editor-actions">' +
      '<button type="button" class="tma-dash__email-label-editor-delete" data-email-label-editor-delete hidden>Delete</button>' +
      '<span class="tma-dash__email-label-editor-spacer"></span>' +
      '<button type="button" class="tma-dash__email-label-editor-cancel" data-email-label-editor-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__email-label-editor-save" data-email-label-editor-save>Save</button>' +
      '</div>' +
      '</div>'
    );
  }

  function bulkActionsForFolder(folder) {
    var archiveAction = folder === 'archive'
      ? { id: 'inbox', label: 'Move to inbox', icon: 'ArchiveTray' }
      : { id: 'archive', label: 'Archive', icon: 'Archive' };
    return [
      archiveAction,
      { id: 'spam', label: 'Spam', icon: 'WarningOctagon' },
      { id: 'delete', label: 'Delete', icon: 'Trash' },
      { id: 'read', label: 'Mark as read', icon: 'EnvelopeSimpleOpen' },
      { id: 'move', label: 'Label as', icon: 'Tag' },
      { id: 'more', label: 'More', icon: 'DotsThree' },
    ];
  }

  var BULK_MORE_SECTIONS = [
    {
      items: [
        { id: 'unread', label: 'Mark as unread', icon: 'EnvelopeSimple' },
        { id: 'snooze', label: 'Snooze', icon: 'Clock' },
      ],
    },
    {
      items: [
        { id: 'label', label: 'Label as', icon: 'Tag', submenu: true },
        { id: 'add-star', label: 'Add star', icon: 'Star' },
        { id: 'remove-star', label: 'Remove star', icon: 'StarFilled' },
        { id: 'important', label: 'Mark as important', icon: 'Flag' },
        { id: 'not-important', label: 'Mark as not important', icon: 'Flag', filled: true },
        { id: 'forward-attachment', label: 'Forward as attachment', icon: 'PaperclipHorizontal' },
        { id: 'filter-like', label: 'Filter messages like these', icon: 'FunnelSimple' },
        { id: 'mute', label: 'Mute', icon: 'SpeakerSlash' },
      ],
    },
    {
      items: [
        { id: 'share-feedback', label: 'Share to help improve TMA', icon: 'ChatCircleDots' },
      ],
    },
    {
      items: [
        { id: 'advanced-toolbar', label: 'Switch to advanced toolbar', icon: 'ArrowsHorizontal' },
      ],
    },
  ];


  /* Folder ids match the server's; counts arrive with the bootstrap payload
   * rather than being baked in here. */
  var FOLDERS = [
    { id: 'compose', label: 'New Email', icon: 'Plus', compose: true },
    { id: 'inbox', label: 'Inbox', icon: 'Tray' },
    // A virtual view rather than a real folder: the server filters by the
    // important flag across inbox/sent/archive.
    { id: 'important', label: 'Important', icon: 'Flag' },
    // Same idea: everything starred, wherever it really lives.
    { id: 'starred', label: 'Starred', icon: 'Star' },
    // Also virtual: everything with a snooze set, wherever it really lives.
    { id: 'snoozed', label: 'Snoozed', icon: 'Clock' },
    { id: 'sent', label: 'Sent', icon: 'PaperPlaneRight' },
    { id: 'draft', label: 'Draft', icon: 'FileText' },
    { id: 'spam', label: 'Spam', icon: 'WarningOctagon' },
    { id: 'trash', label: 'Trash', icon: 'Trash' },
    { id: 'archive', label: 'Archive', icon: 'Archive' },
    { id: 'templates', label: 'Templates', icon: 'SquaresFour', countKey: 'templates' },
  ];

  /* ── message store ───────────────────────────────────────────────
   * Rows come from /portal/mail/messages and live on state.rows. The old
   * hard-coded INBOX array is gone, along with the parallel readIds /
   * starredIds / rowLabels maps that shadowed it, a row now carries its own
   * flags, exactly as the server sent them, so there is one source of truth
   * per message instead of four.
   */

  function rowsOf(state) {
    return (state && state.rows) || [];
  }

  function findRow(state, id) {
    return rowsOf(state).filter(function (row) { return row.id === id; })[0] || null;
  }

  /* Mirror the server's folder ordering (pinned first, then newest) so a
   * pin or unpin lands the row exactly where the next fetch would put it —
   * no second shuffle when the poll comes back. */
  function resortPinnedRows(state) {
    var rows = rowsOf(state);
    var order = new Map(rows.map(function (row, i) { return [row.id, i]; }));
    rows.sort(function (a, b) {
      var pin = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pin !== 0) return pin;
      var at = a.sentAt || '';
      var bt = b.sentAt || '';
      if (at !== bt) return at < bt ? 1 : -1;
      return order.get(a.id) - order.get(b.id);
    });
  }

  /* ── conversations in the list ───────────────────────────────────
   * A row that stands for several messages carries an arrow. Opening it lists
   * every message in the conversation underneath (including the first), in
   * place, and deliberately does *not* open anything in the reading pane —
   * expanding is a look, choosing a message is a read, and conflating the two
   * made every glance at a thread mark something as read.
   *
   * `threadCount` comes from the server, so the arrow only ever appears where
   * there is genuinely more than one message. The children themselves are
   * fetched on first open and kept, since a reader who opened a conversation
   * usually opens it again.
   */
  function conversationCount(row) {
    return Math.max(1, (row && row.threadCount) || 1);
  }

  function hasConversation(row) {
    return conversationCount(row) > 1;
  }

  function isConversationOpen(state, id) {
    return !!(state.openConversations && state.openConversations[id]);
  }

  /* Every message in the conversation, newest first, once they have arrived.
   * Includes the parent row's message so every email in the thread is listed. */
  function conversationChildren(state, id) {
    var loaded = (state.conversationRows && state.conversationRows[id]) || null;
    if (!loaded) return null;

    return loaded.slice().sort(function (a, b) {
      var ta = a.sentAt || '';
      var tb = b.sentAt || '';
      if (ta !== tb) return ta > tb ? -1 : 1;
      return String(b.id).localeCompare(String(a.id));
    });
  }

  function collapseAllConversations(state) {
    state.openConversations = {};
  }

  function loadConversation(state, id) {
    if (!state.conversationRows) state.conversationRows = {};
    if (state.conversationRows[id]) return Promise.resolve(state.conversationRows[id]);

    if (!state._conversationLoads) state._conversationLoads = {};
    if (state._conversationLoads[id]) return state._conversationLoads[id];

    var request = api().conversation(id).then(function (data) {
      var rows = (data && data.messages) || [];
      state.conversationRows[id] = rows;
      delete state._conversationLoads[id];

      return rows;
    }).catch(function (err) {
      delete state._conversationLoads[id];
      throw err;
    });

    state._conversationLoads[id] = request;

    return request;
  }

  /* Every id a conversation covers. Once the drop is loaded that is every
   * message in it; before then it is just the parent row. Selection and bulk
   * actions work on this, so ticking a conversation really does tick all of it. */
  function conversationIds(state, id) {
    var children = conversationChildren(state, id);
    if (children && children.length) {
      return children.map(function (row) { return row.id; });
    }

    return [id];
  }

  /* Rows drawn in the list right now: the page, plus the children of any
   * conversation the reader has opened. "Select all" means these. */
  function visibleRows(state) {
    var out = [];
    filteredInbox(state).forEach(function (row) {
      out.push(row);
      if (!isConversationOpen(state, row.id)) return;
      (conversationChildren(state, row.id) || []).forEach(function (child) {
        out.push(child);
      });
    });

    return out;
  }

  /* A row anywhere on screen, parent or reply. findRow only knows the page. */
  function findAnyRow(state, id) {
    return rowCopies(state, id)[0] || null;
  }

  /*
   * Every in-memory copy of one message: the page row, whichever conversation
   * dropdowns it appears in, and the open thread.
   *
   * A message can legitimately be on screen three times at once now. Writing a
   * flag to one copy and not the others gives a row that un-stars itself on
   * the next repaint, so flag changes go through here.
   */
  function rowCopies(state, id) {
    var found = [];
    if (!id) return found;

    var row = findRow(state, id);
    if (row) found.push(row);

    var loaded = state.conversationRows || {};
    Object.keys(loaded).forEach(function (key) {
      loaded[key].forEach(function (m) {
        if (m.id === id && found.indexOf(m) === -1) found.push(m);
      });
    });

    if (state.thread) {
      state.thread.messages.forEach(function (m) {
        if (m.id === id && found.indexOf(m) === -1) found.push(m);
      });
    }

    return found;
  }

  function eachRowCopy(state, id, apply) {
    var copies = rowCopies(state, id);
    copies.forEach(apply);

    return copies.length > 0;
  }

  /* Drop selections for mail that is no longer on screen. A bulk action fired
   * against a row from the folder before last is a silent mistake. */
  function pruneSelection(state) {
    var live = {};
    visibleRows(state).forEach(function (row) { live[row.id] = true; });

    Object.keys(state.checkedIds).forEach(function (id) {
      if (!live[id]) delete state.checkedIds[id];
    });
  }

  /* The list-row id that owns the conversation drop for a message, the
   * parent itself, or the parent a child was loaded under. */
  function conversationParentForMessage(state, id) {
    if (!id) return null;

    var pageRow = findRow(state, id);
    if (pageRow && hasConversation(pageRow)) return id;

    var loaded = state.conversationRows || {};
    var parentId;
    for (parentId in loaded) {
      if (!Object.prototype.hasOwnProperty.call(loaded, parentId)) continue;
      var msgs = loaded[parentId] || [];
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i] && msgs[i].id === id) return parentId;
      }
    }

    return null;
  }

  /* Open a conversation drop in the list (never closes). Used when the reader
   * opens a message so the other messages show up underneath as well. */
  function ensureConversationExpanded(root, state, render, parentId) {
    if (!parentId) return;
    var parent = findRow(state, parentId);
    if (!parent || !hasConversation(parent)) return;
    if (!state.openConversations) state.openConversations = {};

    var alreadyOpen = !!state.openConversations[parentId];
    state.openConversations[parentId] = true;

    if (alreadyOpen && conversationChildren(state, parentId)) return;

    loadConversation(state, parentId).then(function (rows) {
      if (!state.openConversations[parentId]) return;
      // Opened while the conversation was ticked: its replies join the
      // selection, because ticking a conversation means all of it.
      if (state.checkedIds[parentId]) {
        rows.forEach(function (row) { state.checkedIds[row.id] = true; });
      }
      updateInboxList(root, state, render);
    }).catch(function (err) {
      delete state.openConversations[parentId];
      updateInboxList(root, state, render);
      reportMailError(state, err);
    });
  }

  /* Open or close a conversation in the list. Never opens the reading pane:
   * looking at what a conversation contains is not reading it. */
  function toggleConversation(root, state, render, id) {
    if (!id) return;
    if (!state.openConversations) state.openConversations = {};

    if (state.openConversations[id]) {
      delete state.openConversations[id];
      updateInboxList(root, state, render);
      return;
    }

    ensureConversationExpanded(root, state, render, id);
    updateInboxList(root, state, render);
  }

  /*
   * Tick or untick a row, and, for a conversation, everything inside it.
   *
   * Selecting the conversation and then archiving it has to archive the
   * replies too; leaving them behind in the inbox is the kind of half-done
   * bulk action nobody notices until the folder is wrong.
   */
  function setRowSelected(root, state, render, id, checked) {
    if (!id) return;

    conversationIds(state, id).forEach(function (rowId) {
      if (checked) state.checkedIds[rowId] = true;
      else delete state.checkedIds[rowId];
    });

    applySelectionToDom(root, state);
    updateEmailListBulk(root, state);

    var row = findAnyRow(state, id);
    if (!checked || !row || !hasConversation(row) || conversationChildren(state, id)) return;

    // The replies have not been fetched yet, so fetch them: a conversation
    // ticked before it was ever opened still selects in full.
    loadConversation(state, id).then(function (rows) {
      if (!state.checkedIds[id]) return;
      rows.forEach(function (child) { state.checkedIds[child.id] = true; });
      applySelectionToDom(root, state);
      updateEmailListBulk(root, state);
    }).catch(function () {
      /* The row itself stays selected; only its history is missing. */
    });
  }

  /* Push the selection onto the rows already on screen, rather than
   * re-rendering the list to change some tick boxes. */
  function applySelectionToDom(root, state) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-email-row]'), function (rowEl) {
      var id = rowEl.getAttribute('data-email-row');
      var checked = !!state.checkedIds[id];
      var box = rowEl.querySelector('[data-email-check]');
      if (box) box.checked = checked;
      var label = rowEl.querySelector('[data-email-row-select]');
      if (label) label.classList.toggle('is-checked', checked);
      rowEl.classList.toggle('tma-dash__email-row--selected', checked);
    });

    syncSelectAllBox(root, state);
  }

  /* The conversation, in a window of its own. Server-rendered, so it opens
   * with the mail already in it, see MailController::window. */
  function openMailInWindow(root, id, opts) {
    if (!id || !api().windowUrl) return;

    var url = api().windowUrl(id) + ((opts && opts.print) ? '?print=1' : '');
    // Named per message, so double-clicking the same conversation twice
    // raises the window it already has instead of stacking another.
    var opened = window.open(url, 'tma-mail-' + id, 'width=1000,height=880');

    if (!opened) showEmailToast(root, 'Allow pop-ups to open mail in its own window');
  }

  function api() {
    return window.TMAEmailAPI;
  }

  /* ── Firm compose templates ──────────────────────────────────────
   * Written by administrators on Templates → Email templates; the mailbox
   * only ever reads them. They fill the Templates folder and the "start
   * from a template" pick in compose.
   */
  var FIRM_TEMPLATES = { loaded: false, loading: false, items: [] };

  function loadFirmTemplates(render) {
    if (FIRM_TEMPLATES.loading || !api().composeTemplates) return;
    FIRM_TEMPLATES.loading = true;
    api().composeTemplates()
      .then(function (d) { FIRM_TEMPLATES.items = (d && d.templates) || []; })
      .catch(function () { /* an empty list, not a broken mailbox */ })
      .then(function () {
        FIRM_TEMPLATES.loading = false;
        FIRM_TEMPLATES.loaded = true;
        if (render) render();
      });
  }

  function firmTemplateById(id) {
    var found = null;
    FIRM_TEMPLATES.items.forEach(function (t) { if (t.id === id) found = t; });
    return found;
  }

  /* The body a picked template seeds: its content, then the signature. */
  function firmTemplateBodyHtml(template) {
    return '<div class="tma-dash__email-compose-template-body">' + template.bodyHtml + '</div>' +
      composeSignatureHtml();
  }

  /* ── warm start ──────────────────────────────────────────────────
   * The mailbox is the slowest thing in the portal to fill: a connection
   * check, folder counts, labels and a page of mail, all behind the network.
   * Opening Email used to mean watching that happen. Two things now stop it:
   *
   *   1. Those requests leave the moment this file parses, before the shell
   *      has finished building itself, and long before anyone clicks Email.
   *   2. What came back last time is kept in sessionStorage, so a reload
   *      paints real mail on the first frame and revalidates behind it.
   *
   * Neither ever replaces a fetch. The cache is painted and then overwritten
   * by the live answer, so nothing here can leave stale mail on screen, it
   * only decides whether the reader waits on a skeleton to find that out.
   */
  var MAIL_CACHE_KEY = 'tma.mail.warm.v1';

  /* Older than this and the cached page stops being "what you were just
   * looking at", the skeleton is more honest than an hour-old inbox. */
  var MAIL_CACHE_TTL = 10 * 60 * 1000;

  /* A prefetch is only worth consuming while it is still the newest thing
   * anyone asked for; past this, refetch rather than paint a stale answer. */
  var MAIL_PREFETCH_TTL = 30 * 1000;

  var warmBoot = null;

  function readMailCache() {
    try {
      var raw = window.sessionStorage.getItem(MAIL_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached || !cached.at) return null;
      if (Date.now() - cached.at > MAIL_CACHE_TTL) return null;
      // Signing out does not clear sessionStorage, so a second account signing
      // in on the same tab would be shown the first one's inbox until the
      // bootstrap answered. The shell stamps who it was served to.
      if (cached.user !== (window.TMABootUserId || null)) {
        window.sessionStorage.removeItem(MAIL_CACHE_KEY);

        return null;
      }

      return cached;
    } catch (e) {
      return null;
    }
  }

  function writeMailCache(state) {
    if (state.composePopout) return;
    // Only the plain first page of a folder is worth keeping: a search, a page
    // deep into history or a label filter is a place the reader navigated to,
    // not the one they will land on next time.
    if (state.search || state.activeLabelId || (state.page || 1) !== 1) return;
    if (state.folder === 'templates') return;

    try {
      window.sessionStorage.setItem(MAIL_CACHE_KEY, JSON.stringify({
        at: Date.now(),
        user: window.TMABootUserId || null,
        folder: state.folder,
        connected: state.connected,
        account: state.account,
        folders: state.folderCounts,
        labels: state.labels,
        preferences: state.preferences,
        // Capped: a 200-per-page inbox is not worth the storage quota, and the
        // live fetch that follows will fill in the rest within a second.
        rows: rowsOf(state).slice(0, 50),
        total: state.total,
        perPage: state.perPage,
        lastPage: state.lastPage,
      }));
    } catch (e) { /* a full or disabled sessionStorage just means a cold start */ }

    /*
     * The desktop keeps the same snapshot across a QUIT, which sessionStorage
     * cannot: the store's disk tier holds it, and seedWarmFromStore below
     * puts it back into sessionStorage at the next launch so every line of
     * the machinery above works unchanged. Browsers write to the store's
     * memory tier, which is a no-op across reloads, deliberate, and the
     * firm's disk rule.
     */
    if (window.TMAStore) {
      try {
        window.TMAStore.put('mail:warm', JSON.parse(window.sessionStorage.getItem(MAIL_CACHE_KEY)));
      } catch (e) { /* the session copy above still works */ }
    }
  }

  /*
   * A fresh launch: sessionStorage is empty, the store may not be. Re-seeding
   * the session copy, with a fresh timestamp, because across a quit the
   * choice is a painted inbox corrected in a second versus a skeleton, and
   * the machinery's own TTL was written for the within-session case, lets
   * readMailCache find it exactly as if the tab had never closed. The
   * account stamp rides along and is still checked on read.
   */
  function seedWarmFromStore() {
    if (!window.TMAStore || !window.TMAStore.persistent) return;
    try {
      if (window.sessionStorage.getItem(MAIL_CACHE_KEY)) return;
    } catch (e) { return; }

    window.TMAStore.get('mail:warm').then(function (kept) {
      if (!kept || !kept.folder) return;
      try {
        if (window.sessionStorage.getItem(MAIL_CACHE_KEY)) return;
        kept.at = Date.now();
        window.sessionStorage.setItem(MAIL_CACHE_KEY, JSON.stringify(kept));
      } catch (e) { /* cold start, as before */ }
    });
  }
  /*
   * After DCL, not at parse: the store's reads are account-scoped and the
   * account is set during current-user.js's parse, which comes after this
   * file's. And the guard keys on 'complete', because during deferred
   * execution readyState is already 'interactive' while DCL has not fired —
   * the trap that made portal-home's hydration read the anonymous scope.
   */
  var warmSeeded = false;
  var seedOnce = function () {
    if (warmSeeded) return;
    warmSeeded = true;
    seedWarmFromStore();
  };
  if (document.readyState === 'complete') {
    seedOnce();
  } else {
    document.addEventListener('DOMContentLoaded', seedOnce);
    window.addEventListener('load', seedOnce);
  }

  /* Start the mailbox's two boot requests as early as this file can. */
  function primeMailbox() {
    if (warmBoot || !window.TMAEmailAPI) return;
    if (!document.querySelector('[data-email]')) return;
    // The view markup is in every shell, the mailbox is not in every account.
    // Without this a client fires two requests /portal/mail refuses before the
    // shell has finished waking up, on every page they open.
    if (window.TMAPortalAccess && !window.TMAPortalAccess.can('mail.use')) return;

    // Failures are captured rather than thrown: this runs with nobody waiting
    // on it, and an unhandled rejection here would surface as a console error
    // on every portal page.
    function hold(promise) {
      return promise.then(
        function (data) { return { data: data }; },
        function (err) { return { error: err }; }
      );
    }

    warmBoot = {
      at: Date.now(),
      bootstrap: hold(window.TMAEmailAPI.bootstrap()),
      messages: hold(window.TMAEmailAPI.listMessages({
        folder: 'inbox',
        page: 1,
        perPage: loadMailPerPage(),
      })),
      suggest: hold(window.TMAEmailAPI.suggest('')),
    };
    warmBoot.suggest.then(function (result) {
      if (result.data && Array.isArray(result.data.suggestions)) {
        suggestCache[''] = result.data.suggestions;
      }
    });
  }

  /* Hand a prefetched response to the caller once, if it is still current. */
  function takeWarmBoot(key) {
    if (!warmBoot) return null;
    if (Date.now() - warmBoot.at > MAIL_PREFETCH_TTL) {
      warmBoot = null;
      return null;
    }
    var pending = warmBoot[key];
    warmBoot[key] = null;
    if (!pending) return null;

    return pending.then(function (result) {
      if (result.error) throw result.error;
      return result.data;
    });
  }

  /* Surfaces a failed write. A 409 means the OAuth grant is gone or too
   * narrow, which the sidebar turns into a Reconnect prompt; anything else is
   * a transient failure worth one toast. */
  /* The message worth showing a reader, without leaking a stack or a status. */
  function errorText(err) {
    return (err && err.message) || '';
  }

  /*
   * @param opts.reconnectBanner  false for a failure that is about one
   *        message rather than about the mailbox. Opening a message that the
   *        provider refuses says nothing about whether mail is still
   *        arriving, and the banner drops in above the list a second later —
   *        pushing every row down by one row height under the reader's
   *        pointer. The reading pane reports those failures itself; the
   *        banner is raised by the sync, which is what it actually describes.
   */
  function reportMailError(state, err, opts) {
    if (err && err.reconnect) {
      state.mailError = err.message;

      if (!opts || opts.reconnectBanner !== false) {
        // The grant is dead, but the mail already on screen is still real and
        // still readable. Flag it as a banner instead of replacing the list —
        // one failed fetch should not throw away a loaded inbox.
        state.reconnectNeeded = true;
        if (!rowsOf(state).length) state.connected = false;
      }

      if (state.render) state.render();

      return;
    }

    if (state.root) showEmailToast(state.root, (err && err.message) || 'Something went wrong');
  }

  function listContextKey(state) {
    return [state.folder, state.activeLabelId || '', state.search || ''].join('|');
  }

  /* Remember each folder/label/search listing for this session so switching
   * away and back does not blank the list and refetch from scratch. */
  function snapshotFolderListCache(state) {
    if (!state._folderListCache) state._folderListCache = {};
    var key = state._listContext;
    if (!key || state.folder === 'templates') return;
    // An in-flight empty skeleton is not a real listing, don't overwrite a
    // good cache entry with one.
    if (state.loading && !rowsOf(state).length) return;

    state._folderListCache[key] = {
      rows: rowsOf(state).slice(),
      hasMore: !!state.hasMore,
      total: state.total || 0,
      page: state.page || 1,
      perPage: state.perPage,
      lastPage: state.lastPage || 1,
      perPageOptions: state.perPageOptions,
      openConversations: Object.assign({}, state.openConversations || {}),
      at: Date.now(),
    };
  }

  function restoreFolderListCache(state, key) {
    var entry = state._folderListCache && state._folderListCache[key];
    if (!entry || !entry.rows || !entry.rows.length) return false;

    state.rows = entry.rows.slice();
    state.hasMore = !!entry.hasMore;
    state.total = entry.total || 0;
    state.page = entry.page || 1;
    if (entry.perPage) state.perPage = entry.perPage;
    state.lastPage = entry.lastPage || 1;
    if (entry.perPageOptions) state.perPageOptions = entry.perPageOptions;
    state.openConversations = Object.assign({}, entry.openConversations || {});
    state.loading = false;
    state.listRefreshing = false;
    state.loadError = null;
    return true;
  }

  function applyListPayload(state, data) {
    state.rows = (data && data.messages) || [];
    state.hasMore = !!(data && data.hasMore);
    state.total = (data && data.total) || 0;
    state.page = (data && data.page) || 1;
    state.perPage = (data && data.perPage) || state.perPage;
    state.lastPage = (data && data.lastPage) || 1;
    if (data && data.perPageOptions) state.perPageOptions = data.perPageOptions;
    state.loading = false;
    state.listRefreshing = false;
    state.loadError = null;
  }

  /* Loads the current folder. Search and label filtering are parameters
   * rather than post-filters, so results cover the whole mailbox instead of
   * only the page already in memory.
   *
   * opts.force, skip the per-folder cache (Sync button / reconnect). */
  function reloadMessages(root, state, render, opts) {
    opts = opts || {};
    // Templates are portal-local and have no server listing.
    if (state.folder === 'templates') return Promise.resolve();

    // Changing folder, label or search starts a new listing, page 5 of the
    // inbox says nothing about page 5 of Sent.
    var context = listContextKey(state);
    var switched = state._listContext !== context;
    var restored = false;

    if (switched) {
      snapshotFolderListCache(state);
      state._listContext = context;

      if (!opts.force && restoreFolderListCache(state, context)) {
        restored = true;
        pruneSelection(state);
        render();
      } else {
        state.page = 1;
        // Another folder's mail under this folder's name would be a lie, so it
        // goes and the skeleton takes its place, only when we have nothing
        // remembered for this folder.
        state.rows = [];
        collapseAllConversations(state);
      }
    }

    var token = ++state.loadToken;
    // Only ever a skeleton when there is genuinely nothing to show. Reloading
    // a list that is already on screen (including a restored cache) is a quiet
    // refresh: blanking mail the reader is looking at, to put it back a moment
    // later, is the "constantly loading" feeling this page had.
    state.loading = !rowsOf(state).length;
    state.listRefreshing = !state.loading;
    if (!restored) render();

    // The prefetch that left when this file parsed asked for exactly this:
    // the inbox, page one, no search or label. Anything else is a listing
    // nobody could have predicted, so it goes to the network.
    var prefetched = !state.search && !state.activeLabelId &&
      state.folder === 'inbox' && (state.page || 1) === 1
      ? takeWarmBoot('messages')
      : null;

    return (prefetched || api().listMessages({
      folder: state.folder,
      search: state.search,
      label: state.activeLabelId,
      page: state.page,
      perPage: state.perPage,
    })).then(function (data) {
      // A slower earlier request must not overwrite a newer folder's rows.
      if (token !== state.loadToken) return;
      if (state._listContext !== context) return;

      var incoming = (data && data.messages) || [];
      var unchanged = restored && sameMessageList(state.rows, incoming) &&
        (state.total || 0) === ((data && data.total) || 0) &&
        (state.page || 1) === ((data && data.page) || 1);

      applyListPayload(state, data);
      // Selections belong to rows that were on screen; carrying them over a
      // reload would apply a bulk action to mail nobody can see.
      pruneSelection(state);

      // Keep the reading pane pointed at something that still exists.
      if (state.selectedId && !findAnyRow(state, state.selectedId)) {
        state.selectedId = state.rows.length ? state.rows[0].id : null;
      }

      snapshotFolderListCache(state);
      // Same listing as the cache: leave the DOM alone so scroll position and
      // open conversation drops do not jump.
      if (!unchanged) render();
      writeMailCache(state);
      hydrateListAttachments(root, state, render, token);
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      // A restored folder stays on screen if the quiet revalidate fails —
      // better old mail than a flash of empty.
      if (restored && rowsOf(state).length) {
        state.loading = false;
        state.listRefreshing = false;
        render();
        return;
      }
      state.loading = false;
      state.listRefreshing = false;
      state.loadError = (err && err.message) || 'Could not load messages';
      state.rows = [];
      reportMailError(state, err);
      render();
    });
  }

  /* Fill attachment chips for listed mail without opening each message.
   * Runs after the list paints so the inbox never waits on provider fetches. */
  function hydrateListAttachments(root, state, render, token) {
    if (!api() || typeof api().hydrateAttachments !== 'function') return;
    var ids = rowsOf(state).filter(function (row) {
      return row && row.hasAttachments && !(row.attachmentsPreview && row.attachmentsPreview.length);
    }).map(function (row) { return row.id; });
    if (!ids.length) return;

    api().hydrateAttachments(ids).then(function (data) {
      if (token && token !== state.loadToken) return;
      var updates = (data && data.messages) || [];
      if (!updates.length) return;
      var changed = false;
      updates.forEach(function (item) {
        var row = findRow(state, item.id);
        if (!row) return;
        if (item.attachmentsPreview) {
          row.attachmentsPreview = item.attachmentsPreview;
          changed = true;
        }
        if (typeof item.attachmentCount === 'number') {
          row.attachmentCount = item.attachmentCount;
          changed = true;
        }
      });
      if (changed) updateInboxList(root, state, render);
    }).catch(function () { /* best-effort */ });
  }

  /* How often the page asks whether anything has arrived. Most ticks only
   * re-read the local mirror (so a Graph push that just wrote a message
   * shows up within a couple of seconds). Hitting the provider on every
   * tick is what stacked requests until Graph throttled, which looked like
   * auto-sync stopping. */
  var MAIL_POLL_INTERVAL = 2000;

  /* How often the *full* pass runs instead: every folder, plus the reads,
   * moves and deletions a plain inbox listing cannot report. Expensive, so it
   * is measured in polls rather than run on every tick. */
  var MAIL_FULL_SYNC_EVERY = 30; // ≈ 60s

  /* Provider live-check cadence. Microsoft Graph pushes changes; this is the
   * fallback. Gmail has no push here, so it asks every tick. */
  var MAIL_PROVIDER_EVERY = 3; // ≈ 6s for Microsoft

  /* True while the tab has nothing to gain from being polled at all. Note this
   * no longer includes composing: mail must keep *arriving* while the user
   * writes, only the repaint is held back (see mailRepaintShouldWait), which
   * is what would actually disturb them. */
  function mailPollShouldWait(state) {
    return (
      document.hidden ||
      !state.connected ||
      state.folder === 'templates' ||
      // A mailbox that needs reconnecting will answer 409 to every single
      // attempt. Polling it on a five-second timer produced a 409 in the
      // console every five seconds for as long as the page stayed open, and
      // not one of them could have succeeded, reconnecting is the only thing
      // that clears it, and the banner already says so.
      state.reconnectNeeded
    );
  }

  /* True while a re-render would do more harm than good: it would yank the
   * caret out of whatever the user is mid-typing. The sync still runs; the
   * list just paints once they are done. */
  function mailRepaintShouldWait(state) {
    // An open menu counts too: a repaint closes it (see render), so a poll
    // landing mid-decision would take the menu away as it was being read.
    return state.composeDrafts.length > 0 || !!state.inlineCompose || !!emailPointerMenu;
  }

  /* Cheap enough to run every tick: same ids in the same order, with the
   * same read/starred/label state, is "nothing changed" even if the server
   * handed back fresh objects. */
  function sameMessageList(a, b) {
    a = a || [];
    b = b || [];
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (
        a[i].id !== b[i].id ||
        a[i].unread !== b[i].unread ||
        a[i].starred !== b[i].starred ||
        !a[i].pinned !== !b[i].pinned ||
        (a[i].snoozedUntil || '') !== (b[i].snoozedUntil || '') ||
        (a[i].labels || []).join(',') !== (b[i].labels || []).join(',')
      ) {
        return false;
      }
    }
    return true;
  }

  function scheduleMailPoll(root, state, render) {
    window.clearTimeout(state._mailPollTimer);
    state._mailPollTimer = window.setTimeout(function () {
      pollNewMail(root, state, render);
    }, MAIL_POLL_INTERVAL);
  }

  /* Quiet background refresh: pulls the provider's change feed since the
   * last cursor (cheap, see MailSynchronizer::incremental) and repaints
   * only if the list actually changed, so an inbox with nothing new never
   * flickers or steals the user's scroll position. No loading spinner, no
   * error toast, the manual Sync button already covers that. */
  function pollNewMail(root, state, render) {
    if (mailPollShouldWait(state)) {
      scheduleMailPoll(root, state, render);
      return;
    }

    // One poll at a time. Without this a slow provider means each tick starts
    // another sync on top of the last, and the pile-up is what gets the
    // account throttled, at which point new mail stops arriving entirely.
    if (state._mailPollBusy) {
      scheduleMailPoll(root, state, render);
      return;
    }
    state._mailPollBusy = true;

    var token = ++state.loadToken;

    // Cheap inbox check on most provider ticks; the full folder walk
    // occasionally, since reads/moves/deletions made in Outlook never show
    // up in a plain inbox listing. Microsoft Graph also pushes, so most
    // ticks only refresh the local list. Gmail has no push here, so it
    // still asks the provider every tick.
    state._mailPollTick = (state._mailPollTick || 0) + 1;
    var full = state._mailPollTick % MAIL_FULL_SYNC_EVERY === 0;
    var microsoft = state.account && state.account.provider === 'microsoft';
    var askProvider = full || !microsoft || (state._mailPollTick % MAIL_PROVIDER_EVERY === 1);

    var synced = askProvider
      ? api().sync({ fast: !full })
      : Promise.resolve(null);

    synced.then(function (data) {
      // A sync that goes through means the grant is alive again, resume
      // polling without needing a reload.
      state.reconnectNeeded = false;

      // The sync response carries fresh folder counts on every tick now.
      // Apply them here, this is what keeps the sidebar badges and the
      // dashboard's Email nav count live, including reads and moves made in
      // Gmail/Outlook that never change this page's visible list.
      if (data && data.folders) {
        var next = JSON.stringify(data.folders);
        if (next !== JSON.stringify(state.folderCounts || {})) {
          state.folderCounts = data.folders;
          state._mailCountsDirty = true;
          announceInboxUnread(state);
          var dashRoot = getEmailDashRoot(root);
          if (dashRoot && typeof dashRoot._syncTabBarBadges === 'function') dashRoot._syncTabBarBadges();
        }
      }
    }).catch(function (err) {
      // A dead grant is terminal until the user reconnects, so record it and
      // let mailPollShouldWait stop the timer. Every other failure is
      // transient, fall through to listMessages with whatever is local.
      if (err && err.reconnect) {
        state.reconnectNeeded = true;
        state.mailError = err.message;
      }
    }).then(function () {
      // Repainting mid-compose would move the caret, so the list is left alone
      // until the compose window closes. The sync above still ran, so the mail
      // is already stored, it just paints a moment later.
      if (mailRepaintShouldWait(state)) return null;

      return api().listMessages({
        folder: state.folder,
        search: state.search,
        label: state.activeLabelId,
        page: state.page,
        perPage: state.perPage,
      });
    }).then(function (data) {
      if (!data) return;

      // A folder switch, search, or manual reload started after this poll
      // began owns the screen now, don't stomp on it.
      if (token !== state.loadToken) return;

      var incoming = (data && data.messages) || [];
      if (sameMessageList(state.rows, incoming)) {
        // Nothing moved in the visible list, but the sidebar badges might
        // have, a message read on the phone, mail landing in a folder that
        // is not open. Repaint once so the counts stay honest.
        if (state._mailCountsDirty) {
          state._mailCountsDirty = false;
          render();
        }
        return;
      }
      state._mailCountsDirty = false;

      state.rows = incoming;
      state.hasMore = !!(data && data.hasMore);
      state.total = (data && data.total) || 0;
      state.lastPage = (data && data.lastPage) || 1;
      if (data && data.perPageOptions) state.perPageOptions = data.perPageOptions;

      // Keep the reading pane pointed at something that still exists. A
      // message opened out of a conversation dropdown counts as existing —
      // it just is not one of the page's own rows.
      if (state.selectedId && !findAnyRow(state, state.selectedId)) {
        state.selectedId = state.rows.length ? state.rows[0].id : null;
      }

      render();
      writeMailCache(state);
      hydrateListAttachments(root, state, render, token);
    }).catch(function () {
      // Silent, this is a background refresh, not a user action.
    }).then(function () {
      state._mailPollBusy = false;
      scheduleMailPoll(root, state, render);
    });
  }

  /* The reader's saved mailbox preferences, applied to live state.
   *
   * The server is the authority, these follow the account between machines —
   * but they are mirrored into localStorage on the way through so the *next*
   * first paint is already in the right shape instead of rearranging itself
   * once the bootstrap lands. */
  function applyMailPreferences(state, prefs) {
    if (!prefs) return;
    state.preferences = prefs;

    if (SIDEBAR_MODES.indexOf(prefs.sidebarMode) !== -1) {
      state.sidebarMode = prefs.sidebarMode;
      state.sidebarCollapsed = prefs.sidebarMode !== 'full';
      saveSidebarMode(prefs.sidebarMode);
      saveSidebarCollapsed(state.sidebarCollapsed);
    }

    if (prefs.layout === 'split' || prefs.layout === 'single') {
      state.layoutStyle = prefs.layout;
      saveLayoutStyle(prefs.layout);
    }

    if (Array.isArray(prefs.inboxCategories)) {
      state.inboxCategories = prefs.inboxCategories;
      saveInboxCategories(prefs.inboxCategories);
    }

    if (typeof prefs.showInboxCategories === 'boolean') {
      state.showInboxCategories = prefs.showInboxCategories;
    }
  }

  /* Write one mail preference through to the account.
   *
   * Separate from saveEmailPreference, which assumes the settings panel is
   * open and holds the whole preference object. These are set from the
   * mailbox chrome, the collapse toggle, the layout switch, where it is not.
   */
  function persistMailPreference(state, key, value) {
    if (state.preferences) state.preferences[key] = value;
    if (state.settings && state.settings.preferences) state.settings.preferences[key] = value;

    var payload = {};
    payload[key] = value;

    api().saveSettings({ preferences: payload }).then(function (data) {
      if (data) state.settings = data;
    }).catch(function () {
      /* The local copy already applied; the preference simply doesn't travel
       * to the next machine, which is not worth a toast over. */
    });
  }

  function setMailSidebarMode(root, state, render, mode) {
    if (SIDEBAR_MODES.indexOf(mode) === -1) return;
    state.sidebarMode = mode;
    state.sidebarCollapsed = mode !== 'full';
    saveSidebarMode(mode);
    saveSidebarCollapsed(state.sidebarCollapsed);
    persistMailPreference(state, 'sidebarMode', mode);
    render();
  }

  /* Paint what the last visit ended on, before anything is asked of the
   * network. Everything set here is replaced by the live bootstrap moments
   * later, this only decides whether the reader watches that happen. */
  function hydrateFromCache(state) {
    var cached = readMailCache();
    if (!cached) return false;
    // Cached mail belongs to the folder it was cached from; anything else is
    // a fresh listing and gets the skeleton.
    if (cached.folder !== state.folder) return false;
    if (state.search || state.activeLabelId || (state.page || 1) !== 1) return false;

    state.connected = cached.connected;
    state.account = cached.account || null;
    rememberMailboxAccount(state.account);
    state.folderCounts = cached.folders || {};
    state.labels = cached.labels || [];
    state.rows = cached.rows || [];
    state.total = cached.total || 0;
    state.lastPage = cached.lastPage || 1;
    if (cached.perPage) state.perPage = cached.perPage;
    state._listContext = [state.folder, '', ''].join('|');
    applyMailPreferences(state, cached.preferences);
    state.loading = false;

    return !!(state.rows && state.rows.length);
  }

  /* First load: connection state, folder counts, labels, then the inbox. */
  function bootstrapMailbox(root, state, render) {
    // A mailbox already showing real mail (from the cache, or from the last
    // time this view was opened) revalidates quietly. Only a genuinely empty
    // one waits behind a loading state.
    var warm = rowsOf(state).length > 0;
    state.loading = !warm;
    if (warm) state.listRefreshing = true;

    (takeWarmBoot('bootstrap') || api().bootstrap()).then(function (data) {
      state.bootstrapFailed = false;
      state.loadError = null;
      state.connected = !!(data && data.connected);
      state.account = (data && data.account) || null;
      rememberMailboxAccount(state.account);
      state.folderCounts = (data && data.folders) || {};
      state.labels = ((data && data.labels) || []).filter(function (label) {
        return !!(label && label.localOnly);
      });
      applyMailPreferences(state, data && data.preferences);
      announceInboxUnread(state);

      if (!state.connected) {
        state.loading = false;
        state.listRefreshing = false;
        state.rows = [];
        render();
        return;
      }

      // A reminder toast / notification deep-link lands here as ?message=.
      if (state._pendingMessageId) {
        openMailById(root, state, render, state._pendingMessageId);
        state._pendingMessageId = null;
        return;
      }

      reloadMessages(root, state, render);
    }).catch(function (err) {
      state.loading = false;
      state.listRefreshing = false;
      // Remembered so re-opening Email retries instead of sitting on a failure
      // that only a browser refresh could clear, the bootstrap runs once at
      // app start, so a single blip used to poison the page for the session.
      state.bootstrapFailed = true;
      state.loadError = (err && err.message) || 'Could not reach the mailbox';
      // Mail already on screen is real and still readable. Only an empty
      // mailbox drops to the disconnected state.
      if (!rowsOf(state).length) state.connected = false;
      reportMailError(state, err);
      render();
    });
  }

  /* Open one message by id, used by snooze-reminder deep links. Switches to
   * the folder the message lives in (or Snoozed while it is still resting),
   * loads that list, then opens the reading pane on it. */
  function openMailById(root, state, render, id) {
    if (!id) return Promise.resolve();

    return api().getMessage(id).then(function (data) {
      var msg = data && data.message;
      if (!msg || !msg.id) return;

      var folder = msg.snoozedUntil ? 'snoozed' : (msg.folder || 'inbox');
      state.folder = folder;
      state.activeLabelId = null;
      state.mobileNavOpen = false;

      return reloadMessages(root, state, render).then(function () {
        if (!findRow(state, msg.id)) {
          // Off the first page, still open from the fetched record so the
          // reminder never lands on an empty reading pane.
          state.rows = [msg].concat(rowsOf(state).filter(function (r) { return r.id !== msg.id; }));
        }
        state.reading = true;
        openMailMessage(root, state, render, msg.id);

        // Arrived from the standalone window's Reply / Forward buttons.
        if (state._pendingCompose && !state.composePopout) {
          var mode = state._pendingCompose;
          state._pendingCompose = null;
          openInlineCompose(state, mode);
          render();
          window.requestAnimationFrame(function () { focusInlineComposeEditor(root); });
        }
      });
    }).catch(function () {
      // Deep-link is best-effort; fall back to the ordinary inbox load.
      reloadMessages(root, state, render);
    });
  }

  /* Opens a message: loads its whole conversation and marks it read.
   *
   * The thread is loaded even though the pane shows one message: it is where
   * the conversation's real subject comes from (the first message's, not the
   * newest "Re: Re: Fwd:"), and it means moving between messages in the list
   * dropdown does not refetch. Only the opened message carries a body; the
   * rest are pulled by ensureMessageBody() as they are chosen. */
  function openMailMessage(root, state, render, id) {
    // findAnyRow, not findRow: a message opened from a conversation dropdown
    // is not on the page, it belongs to the conversation loaded under it.
    var row = findAnyRow(state, id);
    if (!row) return;

    if (row.folder === 'draft') {
      continueDraftMessage(root, state, render, row);
      return;
    }

    if (isComposingInPane(state)) {
      dismissComposePane(root, state, render, function () {
        if (paneComposeDraft(state)) minimizeOpenComposeDrafts(state);
        closeInlineCompose(state);
        openMailMessage(root, state, render, id);
      });
      return;
    }

    state.selectedId = id;
    if (row.unread) markRowRead(state, id);

    // Opening a message also expands its conversation drop in the list so the
    // other messages are visible without a separate caret click.
    ensureConversationExpanded(root, state, render, conversationParentForMessage(state, id));

    // A thread already covering this message is reused rather than refetched —
    // but the reading pane shows whichever message is selected, and only the
    // one the thread was opened on arrives with a body, so the rest are pulled
    // as they are chosen.
    if (threadCoversSelection(state)) {
      ensureMessageBody(state, render, id);
      render();
      return;
    }

    state.thread = null;
    state.threadError = null;
    state.threadErrorId = null;
    state.bodyLoading = true;
    var token = ++state.threadToken;
    render();

    api().getThread(id).then(function (data) {
      // A slower earlier request must not overwrite a thread the reader has
      // since opened.
      if (token !== state.threadToken) return;

      var messages = (data && data.messages) || [];

      state.thread = {
        rootId: id,
        threadId: data && data.threadId,
        subject: (data && data.subject) || row.subject,
        messages: messages,
        showQuoted: {},
      };

      // Keep the list row in step with what the thread reported.
      var opened = messages.filter(function (m) { return m.id === id; })[0];
      if (opened) mergeMessageInto(row, opened);

      state.bodyLoading = false;
      render();
    }).catch(function (err) {
      if (token !== state.threadToken) return;
      state.bodyLoading = false;
      state.threadError = errorText(err) || 'This conversation could not be loaded.';
      state.threadErrorId = id;
      // The pane says so itself, see reportMailError on why this one must
      // not raise the mailbox-wide banner.
      reportMailError(state, err, { reconnectBanner: false });
      render();
    });
  }

  function continueDraftMessage(root, state, render, row) {
    var already = state.composeDrafts.filter(function (draft) {
      return draft.serverId && row._draftServerId && draft.serverId === row._draftServerId;
    })[0];
    if (already) {
      restoreCompose(state, already.id);
      render();
      return;
    }

    api().continueDraft(row.id).then(function (data) {
      var rec = data && data.draft;
      if (!rec) return;
      row._draftServerId = rec.id;
      var existing = state.composeDrafts.filter(function (draft) { return draft.serverId === rec.id; })[0];
      if (existing) {
        restoreCompose(state, existing.id);
        render();
        return;
      }
      var cc = formatAddressList(rec.cc);
      openCompose(state, {
        to: formatAddressList(rec.to),
        cc: cc,
        bcc: formatAddressList(rec.bcc),
        subject: rec.subject || '',
        bodyHtml: rec.bodyHtml || composeSignatureHtml(),
        mode: rec.mode || 'new',
        inReplyTo: rec.inReplyTo,
        serverId: rec.id,
        showCc: !!cc,
        attachments: composeAttachmentsFromRecord(rec.attachments),
      });
      render();
    }).catch(function (err) {
      reportMailError(state, err);
    });
  }

  /*
   * Flags the client owns between renders.
   *
   * Opening a message writes `read` and fetches the conversation at the same
   * moment. If the fetch wins the race it answers from a row the write has not
   * reached yet, and copying it wholesale flips the message back to unread
   * under the reader, then back again on the next poll. Everything else in
   * the record is server truth and is taken as it comes.
   */
  var OPTIMISTIC_FLAGS = ['unread', 'starred', 'important', 'pinned', 'snoozedUntil'];

  function mergeMessageInto(target, incoming) {
    if (!target || !incoming) return target;

    Object.keys(incoming).forEach(function (key) {
      if (OPTIMISTIC_FLAGS.indexOf(key) !== -1) return;
      target[key] = incoming[key];
    });

    return target;
  }

  /* True when the loaded thread actually covers the selected message.
   *
   * Selection moves without going through openMailMessage in several places —
   * a reload whose selected row has vanished, an archive, a folder change, and
   * a thread left over from the previous message would otherwise be rendered
   * against the new one. */
  function threadCoversSelection(state) {
    if (!state.thread || !state.selectedId) return false;

    return state.thread.messages.some(function (m) { return m.id === state.selectedId; });
  }

  /* Loads the conversation for whatever is selected, if it is not already
   * loaded. Called after each render rather than at every place that moves the
   * selection, so no future caller can forget to. */
  function ensureThreadLoaded(root, state, render) {
    if (state.folder === 'templates') return;
    if (!state.selectedId || state.bodyLoading) return;
    // A failure is remembered against the message it happened on, so the
    // error is not retried in a loop, but selecting a different message
    // still gets a fresh attempt.
    if (state.threadError && state.threadErrorId === state.selectedId) return;
    if (threadCoversSelection(state)) return;

    openMailMessage(root, state, render, state.selectedId);
  }

  /*
   * Pull a message's body if the thread it came in did not carry one.
   *
   * GET /thread only hydrates the message it was opened on, a long
   * conversation would otherwise be one provider round trip per message before
   * anything painted. Picking a different message from the list dropdown is
   * where the rest get fetched, one at a time and only when actually read.
   */
  function ensureMessageBody(state, render, id) {
    var thread = state.thread;
    if (!thread) return;

    var message = thread.messages.filter(function (m) { return m.id === id; })[0];
    if (!message || message.bodyLoaded || message._loading || message._error) return;

    message._loading = true;

    api().getMessage(id).then(function (data) {
      message._loading = false;
      if (data && data.message) mergeMessageInto(message, data.message);
      render();
    }).catch(function (err) {
      message._loading = false;
      message._error = errorText(err) || 'This message could not be loaded.';
      render();
    });
  }

  function isRowUnread(row, state) {
    return !!(row && row.unread);
  }

  /* Read state is optimistic: the row flips immediately and the provider
   * catches up. A failed write is not worth interrupting reading for, so it
   * is logged rather than surfaced, the next sync corrects it. */
  function markRowRead(state, id) {
    setRowRead(state, id, true);
  }

  function markRowUnread(state, id) {
    setRowRead(state, id, false);
  }

  function setRowRead(state, id, read) {
    var row = findAnyRow(state, id);
    if (!row || !!row.unread === !read) return;
    eachRowCopy(state, id, function (copy) { copy.unread = !read; });
    api().setFlags(id, { read: read }).catch(function (err) {
      row.unread = read;
      reportMailError(state, err);
    });
  }

  function syncEmailRowReadClasses(rowEl, unread) {
    if (!rowEl) return;
    rowEl.classList.toggle('tma-dash__email-row--unread', unread);
    rowEl.classList.toggle('tma-dash__email-row--read', !unread);
  }

  function isRowChecked(row, state) {
    return !!state.checkedIds[row.id];
  }

  function isRowStarred(row, state) {
    return !!(row && row.starred);
  }

  function isRowImportant(row, state) {
    return !!(row && row.important);
  }

  function rowHasLabel(rowId, labelId, state) {
    var row = findRow(state, rowId);
    return !!(row && row.labels && row.labels.indexOf(labelId) !== -1);
  }

  function rowHasAnyLabel(rowId, state) {
    var row = findRow(state, rowId);
    return !!(row && row.labels && row.labels.length);
  }

  function labelPopupTargetIds(state) {
    if (state.labelPopupBulk) return emailToolbarTargetIds(state);
    if (state.labelPopupRowId) return [state.labelPopupRowId];
    return [];
  }

  function isLabelCheckedForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    if (!ids.length) return false;
    return ids.every(function (id) {
      return rowHasLabel(id, labelId, state);
    });
  }

  function isLabelIndeterminateForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    if (ids.length <= 1) return false;
    var count = ids.filter(function (id) {
      return rowHasLabel(id, labelId, state);
    }).length;
    return count > 0 && count < ids.length;
  }

  function toggleLabelForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    // Mixed selections resolve to "apply to all", matching the checkbox's
    // indeterminate-to-checked step.
    var applied = !isLabelCheckedForTargets(labelId, state);

    ids.forEach(function (id) {
      var row = findAnyRow(state, id);
      if (!row) return;
      if (!row.labels) row.labels = [];

      var at = row.labels.indexOf(labelId);
      if (applied && at === -1) {
        row.labels.push(labelId);
        adjustLabelCount(state, labelId, 1);
      } else if (!applied && at !== -1) {
        row.labels.splice(at, 1);
        adjustLabelCount(state, labelId, -1);
      }

      api().setLabel(id, labelId, applied).catch(function (err) {
        // Put the label back the way it was; the popup re-reads from the row.
        var undo = row.labels.indexOf(labelId);
        if (applied && undo !== -1) {
          row.labels.splice(undo, 1);
          adjustLabelCount(state, labelId, -1);
        } else if (!applied && undo === -1) {
          row.labels.push(labelId);
          adjustLabelCount(state, labelId, 1);
        }
        reportMailError(state, err);
      });
    });
  }

  function syncLabelMenuChecks(root, state) {
    root.querySelectorAll('[data-email-label-option]').forEach(function (btn) {
      var labelId = btn.getAttribute('data-email-label-option');
      var checkbox = btn.querySelector('input[type="checkbox"]');
      var checked = isLabelCheckedForTargets(labelId, state);
      var indeterminate = isLabelIndeterminateForTargets(labelId, state);
      btn.setAttribute('aria-checked', checked ? 'true' : indeterminate ? 'mixed' : 'false');
      if (checkbox) {
        checkbox.checked = checked;
        checkbox.indeterminate = indeterminate;
      }
    });
  }

  function syncRowLabelButtons(root, state) {
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      var id = btn.getAttribute('data-email-label');
      btn.classList.toggle('tma-dash__email-row-action--active', rowHasAnyLabel(id, state));
    });
  }

  function renderEmailLabelMenu(state) {
    var items = emailLabels(state).map(function (label) {
      var checked = isLabelCheckedForTargets(label.id, state);
      var indeterminate = isLabelIndeterminateForTargets(label.id, state);
      return (
        '<button type="button" class="tma-dash__email-label-option" role="menuitemcheckbox"' +
        ' data-email-label-option="' + esc(label.id) + '"' +
        ' aria-checked="' + (checked ? 'true' : indeterminate ? 'mixed' : 'false') + '">' +
        '<input type="checkbox" class="tma-dash__check tma-dash__email-label-check"' +
        (checked ? ' checked' : '') + ' tabindex="-1" aria-hidden="true">' +
        renderLabelTag(label.tone) +
        '<span class="tma-dash__email-label-name">' + esc(label.name) + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="tma-dash__email-label-menu tma-dash__menu" data-email-label-menu role="menu" aria-label="Labels"' +
      (state.labelPopupOpen ? '' : ' hidden') +
      '>' +
      '<div class="tma-dash__email-label-menu-head">Label as</div>' +
      '<div class="tma-dash__email-label-menu-list">' + items + '</div>' +
      '<div class="tma-dash__email-label-menu-divider" role="separator"></div>' +
      '<button type="button" class="tma-dash__email-label-create" role="menuitem" data-email-label-create>' +
      '<img src="' + ICONS.Plus + '" alt="" aria-hidden="true">' +
      '<span>Create new</span>' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailRowHoverActions(row, state) {
    var unread = isRowUnread(row, state);
    var pinned = !!(row && row.pinned);
    var snoozed = !!(row && row.snoozedUntil);
    var inArchive = state.folder === 'archive' || (row && row.folder === 'archive');
    var starred = isRowStarred(row, state);
    var important = isRowImportant(row, state);
    var actions = [
      {
        id: 'star',
        label: starred ? 'Remove star' : 'Add star',
        icon: starred ? 'StarFilled' : 'Star',
        active: starred,
        star: true,
        attr: ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
      },
      {
        id: 'important',
        label: important ? 'Mark as not important' : 'Mark as important',
        icon: important ? 'FlagFilled' : 'Important',
        active: important,
        important: true,
        attr: ' data-email-important="' + esc(row.id) + '" aria-pressed="' + (important ? 'true' : 'false') + '"',
      },
      { id: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'PushPinFilled' : 'PushPin', active: pinned, pin: true },
      {
        id: inArchive ? 'inbox' : 'archive',
        label: inArchive ? 'Move to inbox' : 'Archive',
        icon: inArchive ? 'ArchiveTray' : 'Archive',
      },
      { id: 'delete', label: 'Delete', icon: 'Trash' },
      { id: 'read', label: unread ? 'Mark as read' : 'Mark as unread', icon: unread ? 'EnvelopeSimpleOpen' : 'EnvelopeSimple' },
      { id: 'snooze', label: snoozed ? 'Unsnooze' : 'Snooze', icon: 'Clock', active: snoozed },
    ];

    return (
      '<div class="tma-dash__email-row-hover-actions">' +
      actions
        .map(function (action) {
          return renderEmailIconTooltipBtn({
            tipId: 'email-row-tip-' + action.id + '-' + row.id,
            label: action.label,
            className:
              'tma-dash__email-row-action' +
              (action.active ? ' tma-dash__email-row-action--active' : '') +
              (action.star && action.active ? ' tma-dash__email-row-action--starred' : '') +
              (action.important && action.active ? ' tma-dash__email-row-action--important' : '') +
              (action.pin && action.active ? ' tma-dash__email-row-action--pinned' : ''),
            attrs:
              (action.attr ||
                (' data-email-row-hover="' + esc(action.id) + '" data-email-row-id="' + esc(row.id) + '"')) +
              (action.active && !action.attr ? ' aria-pressed="true"' : ''),
            innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
          });
        })
        .join('') +
      // The label (tag) button: opens the same "Label as" picker the bulk bar
      // uses, scoped to this one message.
      renderEmailIconTooltipBtn({
        tipId: 'email-row-tip-label-' + row.id,
        label: 'Label',
        className:
          'tma-dash__email-row-action' +
          (rowHasAnyLabel(row.id, state) ? ' tma-dash__email-row-action--active' : ''),
        attrs:
          ' data-email-label="' + esc(row.id) + '" aria-haspopup="menu" aria-expanded="false"',
        innerHtml: '<img src="' + ICONS.Tag + '" alt="">',
      }) +
      '</div>'
    );
  }

  function selectedEmailCount(state) {
    return Object.keys(state.checkedIds).length;
  }

  function renderEmailBulkBtn(action, state) {
    var tipId = 'email-bulk-tip-' + action.id;
    var extraAttrs = '';
    if (action.id === 'more') {
      extraAttrs =
        ' data-email-bulk-more-toggle aria-haspopup="menu" aria-expanded="' +
        (state.bulkMoreMenuOpen ? 'true' : 'false') +
        '"';
    }
    return renderEmailIconTooltipBtn({
      tipId: tipId,
      label: action.label,
      className: 'tma-dash__email-bulk-btn',
      attrs: ' data-email-bulk-action="' + esc(action.id) + '"' + extraAttrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderEmailBulkMoreMenuItem(item) {
    var iconCls = 'tma-dash__email-bulk-more-icon';
    if (item.filled) iconCls += ' tma-dash__email-bulk-more-icon--filled';
    var chevron = item.submenu
      ? '<img class="tma-dash__email-bulk-more-chevron" src="' + ICONS.ArrowLineRight + '" alt="" aria-hidden="true">'
      : '';
    return (
      '<button type="button" class="tma-dash__email-bulk-more-item" role="menuitem" data-email-bulk-more-item="' + esc(item.id) + '">' +
      '<img class="' + iconCls + '" src="' + esc(ICONS[item.icon]) + '" alt="">' +
      '<span class="tma-dash__email-bulk-more-label">' + esc(item.label) + '</span>' +
      chevron +
      '</button>'
    );
  }

  function renderEmailBulkMoreMenu(state) {
    var html = BULK_MORE_SECTIONS.map(function (section, index) {
      var block =
        '<div class="tma-dash__email-bulk-more-section">' +
        section.items.map(renderEmailBulkMoreMenuItem).join('') +
        '</div>';
      if (index < BULK_MORE_SECTIONS.length - 1) {
        block += '<div class="tma-dash__email-bulk-more-divider" role="separator"></div>';
      }
      return block;
    }).join('');

    return (
      '<div class="tma-dash__email-bulk-more-menu tma-dash__menu" data-email-bulk-more-menu role="menu" aria-label="More actions"' +
      (state.bulkMoreMenuOpen ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  function renderEmailListBulk(state) {
    var count = selectedEmailCount(state);
    return (
      '<div class="tma-dash__email-list-bulk" data-email-bulk' + (count === 0 ? ' hidden' : '') + '>' +
      bulkActionsForFolder(state.folder).map(function (action) { return renderEmailBulkBtn(action, state); }).join('') +
      '</div>'
    );
  }

  function clearEmailSelection(state) {
    state.checkedIds = {};
  }

  function updateEmailToolbar(root, state) {
    var toolbar = root.querySelector('[data-email-toolbar]');
    if (!toolbar) return;
    var hasTarget = emailToolbarTargetIds(state).length > 0;
    toolbar.classList.toggle('tma-dash__email-toolbar--ready', hasTarget);
    toolbar.querySelectorAll('[data-email-toolbar-action]').forEach(function (btn) {
      btn.disabled = !hasTarget;
      if (hasTarget) btn.removeAttribute('aria-disabled');
      else btn.setAttribute('aria-disabled', 'true');
    });
  }

  function updateEmailListBulk(root, state) {
    var count = selectedEmailCount(state);
    var bulk = root.querySelector('[data-email-bulk]');
    var filter = root.querySelector('[data-email-filter]');
    if (bulk) bulk.hidden = count === 0 || isEmailMobile();
    if (filter) filter.hidden = count > 0;
    syncSelectAllBox(root, state);
    updateEmailToolbar(root, state);
    if (count === 0) {
      closeEmailBulkMoreMenu(root, state);
      if (state.labelPopupBulk) closeEmailLabelPopup(root, state);
    }
    ensureEmailMobileHeader(root, state);
  }

  function closeEmailBulkMoreMenu(root, state) {
    if (!state.bulkMoreMenuOpen) return;
    state.bulkMoreMenuOpen = false;
    var menu = root.querySelector('[data-email-bulk-more-menu]');
    root.querySelectorAll('[data-email-bulk-more-toggle]').forEach(function (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
    });
    if (menu) menu.hidden = true;
    if (isEmailBulkActive(state)) ensureEmailMobileHeader(root, state);
  }

  function positionEmailProfilePopup(anchor, menu) {
    var rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.top = '-9999px';
    menu.style.left = '-9999px';
    var menuRect = menu.getBoundingClientRect();
    var top = rect.bottom + 8;
    var left = rect.right - menuRect.width;
    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 8);
    }
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function positionEmailPopupMenu(anchor, menu) {
    var rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.top = '-9999px';
    menu.style.left = '-9999px';
    var menuRect = menu.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 4);
    }
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function closeEmailLabelPopup(root, state) {
    if (!state.labelPopupOpen) return;
    state.labelPopupOpen = false;
    state.labelPopupRowId = null;
    state.labelPopupBulk = false;
    var menu = root.querySelector('[data-email-label-menu]');
    if (menu) menu.hidden = true;
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openEmailLabelPopup(root, state, anchor, opts) {
    opts = opts || {};
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailBulkMoreMenu(root, state);
    closeEmailProfileMenu(root, state);
    state.labelPopupOpen = true;
    state.labelPopupRowId = opts.rowId || null;
    state.labelPopupBulk = !!opts.bulk;
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
    if (anchor && anchor.hasAttribute('data-email-label')) {
      anchor.setAttribute('aria-expanded', 'true');
    }
    var menu = root.querySelector('[data-email-label-menu]');
    if (menu && anchor) {
      // The menu renders hidden and is revealed here, so a caller that opens
      // it without a re-render (the row's right-click menu) still gets it.
      menu.hidden = false;
      positionEmailPopupMenu(anchor, menu);
      syncLabelMenuChecks(root, state);
    }
  }

  function openEmailBulkMoreMenu(root, state, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailProfileMenu(root, state);
    closeEmailLabelPopup(root, state);
    state.bulkMoreMenuOpen = true;
    toggle.setAttribute('aria-expanded', 'true');
    var menu = root.querySelector('[data-email-bulk-more-menu]');
    if (menu) positionEmailPopupMenu(toggle, menu);
  }

  function closeEmailLabelEditor(root, state) {
    if (!state.labelEditorOpen) return;
    state.labelEditorOpen = false;
    state.labelEditorId = null;
    var editor = root.querySelector('[data-email-label-editor]');
    if (editor) editor.hidden = true;
  }

  function setEmailLabelEditorTone(editor, tone) {
    editor.dataset.tone = tone;
    editor.querySelectorAll('[data-email-label-editor-tone]').forEach(function (btn) {
      var selected = btn.getAttribute('data-email-label-editor-tone') === tone;
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      btn.classList.toggle('tma-dash__email-label-editor-tone--selected', selected);
    });
  }

  function setEmailLabelEditorError(editor, message) {
    var el = editor.querySelector('[data-email-label-editor-error]');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  /* Opens the editor for a new label (labelId null) or an existing one. The
   * fields are filled imperatively rather than through render() so the popup
   * survives the background mail poll untouched. */
  function openEmailLabelEditor(root, state, anchor, labelId) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailLabelPopup(root, state);
    closeEmailBulkMoreMenu(root, state);
    closeEmailProfileMenu(root, state);

    var editor = root.querySelector('[data-email-label-editor]');
    if (!editor) return;

    var label = labelId ? getEmailLabel(labelId, state) : null;
    state.labelEditorOpen = true;
    state.labelEditorId = label ? label.id : null;

    var title = editor.querySelector('[data-email-label-editor-title]');
    if (title) title.textContent = label ? 'Edit label' : 'New label';

    var name = editor.querySelector('[data-email-label-editor-name]');
    if (name) name.value = label ? label.name : '';

    setEmailLabelEditorTone(editor, (label && label.tone) || 'blue');
    setEmailLabelEditorError(editor, null);

    var del = editor.querySelector('[data-email-label-editor-delete]');
    if (del) {
      del.hidden = !label;
      del.textContent = 'Delete';
      del.classList.remove('tma-dash__email-label-editor-delete--confirm');
    }

    var save = editor.querySelector('[data-email-label-editor-save]');
    if (save) save.disabled = false;

    positionEmailPopupMenu(anchor, editor);
    if (name) name.focus();
  }

  function rowListLines(row) {
    if (row.subject && row.body) {
      return { subject: row.subject, body: row.body };
    }

    var preview = row.preview || row.body || row.subject || '';
    var splitAt = preview.indexOf(' – ');
    if (splitAt !== -1) {
      return {
        subject: preview.slice(0, splitAt),
        body: preview.slice(splitAt + 3),
      };
    }

    return {
      subject: row.subject || preview,
      body: row.body || preview,
    };
  }

  function esc(s) {
    if (s == null || s === '') return '';
    if (s === 'null' || s === 'undefined') return '';
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function displaySender(row) {
    var name = row && row.sender;
    if (name && name !== 'null' && name !== 'undefined') return name;
    if (row && row.folder === 'draft') {
      var to = addressList(row.to);
      if (to.length) return addressLabel(to[0]) || 'Draft';
      return 'Draft';
    }
    return (row && row.email) || '';
  }

  function brandSrc(name) {
    if (name === 'FacebookLogo' || name === 'ThreadsLogo') return ICON + name + '.svg';
    return BRAND + name + '.svg';
  }

  function rowIcon(row) {
    if (!row.brand) return '';
    return '<span class="tma-dash__email-row-icon"><img src="' + esc(brandSrc(row.brand)) + '" alt=""></span>';
  }

  function messageHeadIcon(row) {
    if (row.brand) {
      return '<span class="tma-dash__email-message-avatar tma-dash__email-message-avatar--brand">' + rowIcon(row) + '</span>';
    }
    // A real photo from the sender's portal account; falls back to initials
    // on error so a dead URL never leaves an empty circle.
    if (row.avatarUrl) {
      return (
        '<span class="tma-dash__email-message-avatar">' +
        '<img src="' + esc(row.avatarUrl) + '" alt=""' +
        ' onerror="this.closest(\'.tma-dash__email-message-avatar\').classList.add(\'tma-dash__email-message-avatar--initial\');this.remove();">' +
        '</span>'
      );
    }
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-message-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    return '<span class="tma-dash__email-message-avatar">' +
      '<img src="' + esc(senderInitials(row)) + '" alt="" aria-hidden="true">' +
      '</span>';
  }

  /*
   * Recipients, as the server actually stores them: `to`, `cc` and `bcc` are
   * arrays of {name, email}.
   *
   * This used to read `row.to` as if it were a single address. An empty array
   * is truthy, so every message fell through to the "me" branch, which is why
   * the header said "to me" on mail addressed to a dozen people, and why the
   * details panel never showed a recipient list at all.
   */
  function addressList(value) {
    if (!value) return [];
    var list = Array.isArray(value) ? value : [value];

    return list.map(function (entry) {
      if (typeof entry === 'string') return { email: entry, name: '' };
      if (!entry) return null;

      return { email: entry.email || '', name: entry.name || '' };
    }).filter(function (entry) {
      return entry && (entry.email || entry.name);
    });
  }

  /* "Jane Doe <jane@firm.com>", or just the address when there is no name. */
  function addressLabel(entry, full) {
    if (!entry) return '';
    if (isSelfAddress(entry)) return 'me';
    if (!entry.name || entry.name === entry.email) return entry.email;

    return full && entry.email ? entry.name + ' <' + entry.email + '>' : entry.name;
  }

  function addressListLabel(list, full) {
    return list.map(function (entry) { return addressLabel(entry, full); })
      .filter(Boolean)
      .join(', ');
  }

  /* The one-line "to …" summary beside the sender. Long recipient lists are
   * summarised; the full set is one click away in the details panel. */
  function getMessageRecipient(row) {
    var to = addressList(row && row.to);

    if (!to.length) {
      return { label: 'me', email: PROFILE.email, isMe: true };
    }

    var first = addressLabel(to[0]);
    var extra = to.length - 1;

    return {
      label: extra > 0 ? first + ' and ' + extra + ' other' + (extra === 1 ? '' : 's') : first,
      email: to[0].email,
      isMe: isSelfAddress(to[0]),
    };
  }

  /*
   * Everyone the message went to, not just the first name on the envelope.
   *
   * Cc and Bcc rows only appear when there is something in them, an empty
   * "bcc:" on every message is noise, and on a received message a populated
   * one is unusual enough to be worth seeing.
   */
  function renderMessageHeaderDetails(row, metaEmail, metaDate, subject) {
    var to = addressList(row && row.to);
    var cc = addressList(row && row.cc);
    var bcc = addressList(row && row.bcc);
    var replyTo = row && row.replyTo;

    function detailRow(label, value) {
      if (!value) return '';

      return (
        '<div class="tma-dash__email-header-details-row">' +
        '<dt>' + esc(label) + ':</dt><dd>' + esc(value) + '</dd>' +
        '</div>'
      );
    }

    return (
      '<div class="tma-dash__email-header-details" data-email-header-details-panel hidden>' +
      '<dl class="tma-dash__email-header-details-list">' +
      '<div class="tma-dash__email-header-details-row">' +
      '<dt>from:</dt>' +
      '<dd><strong>' + esc(displaySender(row)) + '</strong>' +
      (metaEmail ? ' &lt;' + esc(metaEmail) + '&gt;' : '') + '</dd>' +
      '</div>' +
      detailRow('reply-to', replyTo && replyTo !== metaEmail ? replyTo : '') +
      detailRow('to', to.length ? addressListLabel(to, true) : PROFILE.email) +
      detailRow('cc', addressListLabel(cc, true)) +
      detailRow('bcc', addressListLabel(bcc, true)) +
      detailRow('date', metaDate) +
      detailRow('subject', subject) +
      '</dl>' +
      '</div>'
    );
  }

  function renderMessageHead(row, metaEmail, metaDate, subject, headKey, state) {
    headKey = headKey || 'current';
    // Every card, not only a 'current' one: the thread renders each message
    // through here with its own key, and a guard on the key had left the
    // phone layout unused, so a 390px screen got the desktop row.
    var mobile = isEmailMobile();
    var recipient = getMessageRecipient(row);
    var messageActions = mobile ? DETAIL_MESSAGE_ACTIONS_MOBILE : DETAIL_MESSAGE_ACTIONS;
    var headCls = 'tma-dash__email-message-head' + (mobile ? ' tma-dash__email-message-head--mobile' : '');
    return (
      '<div class="' + headCls + '">' +
      '<div class="tma-dash__email-message-head-main">' +
      messageHeadIcon(row) +
      '<div class="tma-dash__email-message-head-identity">' +
      '<div class="tma-dash__email-message-head-line">' +
      '<span class="tma-dash__email-message-head-name">' + esc(displaySender(row)) + '</span>' +
      '</div>' +
      '<div class="tma-dash__email-message-head-recipient">' +
      '<button type="button" class="tma-dash__email-message-head-to" data-email-header-details-toggle aria-expanded="false">' +
      '<span class="tma-dash__email-message-head-to-label">to ' + esc(recipient.label) + '</span>' +
      '<span class="tma-dash__email-message-head-to-caret-wrap" aria-hidden="true">' +
      '<img src="' + ICONS.CaretDown + '" alt="" class="tma-dash__email-message-head-to-caret">' +
      '</span>' +
      '</button>' +
      renderMessageHeaderDetails(row, metaEmail, metaDate, subject) +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-message-head-side">' +
      (mobile
        ? '<time class="tma-dash__email-detail-date tma-dash__email-detail-date--inline" title="' + esc(metaDate) + '">' +
          esc(formatMessageDateShort(row, metaDate)) + '</time>'
        : '<time class="tma-dash__email-detail-date">' + esc(metaDate) + '</time>') +
      '<div class="tma-dash__email-detail-actions">' +
      messageActions.map(function (action) {
        // Every button carries the message it belongs to. These used to be
        // wired only when headKey was 'current', so on a thread card the star,
        // reply and forward buttons rendered and did nothing at all.
        var attrs = '';
        if (action.id === 'reply' || action.id === 'reply-all' || action.id === 'forward') {
          attrs = ' data-email-inline-compose="' + action.id + '"' +
            ' data-email-message-id="' + esc(row.id) + '"';
        }
        if (action.id === 'more') {
          attrs = ' data-email-message-menu="' + esc(row.id) + '"' +
            ' aria-haspopup="menu" aria-expanded="false"';
        }
        if (action.id === 'star') {
          attrs = ' data-email-star="' + esc(row.id) + '"' +
            ' aria-pressed="' + (isRowStarred(row, state) ? 'true' : 'false') + '"';
        }
        var cls = 'tma-dash__email-action';
        var starred = action.id === 'star' && isRowStarred(row, state);
        if (starred) {
          cls += ' tma-dash__email-row-action--active tma-dash__email-row-action--starred';
        }
        return renderEmailIconTooltipBtn({
          tipId: 'email-detail-tip-' + headKey + '-' + action.id,
          label: starred ? 'Remove star' : action.label,
          className: cls,
          attrs: attrs,
          innerHtml: '<img src="' + esc(starred ? ICONS.StarFilled : ICONS[action.icon]) + '" alt="">',
        });
      }).join('') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* The signed-in user, filled in from current-user.js. Starts blank rather
   * than with a stand-in, so a hardcoded name/photo is never briefly shown as
   * if it were real. */
  var PROFILE = {
    name: '',
    email: '',
    avatar: null,
  };

  /* The connected mailbox, which is who "me" is when replying, often
   * different from the portal login on PROFILE. */
  var MAILBOX_EMAIL = '';

  function rememberMailboxAccount(account) {
    MAILBOX_EMAIL = (account && account.email) || '';
  }

  /* current-user.js owns photo-or-initials resolution, so the mailbox chrome
   * draws exactly what the rest of the shell draws. */
  function profileAvatarSrc() {
    if (window.TMACurrentUser && window.TMACurrentUser.avatarSrc) {
      return window.TMACurrentUser.avatarSrc(PROFILE.avatar, PROFILE.name);
    }
    return PROFILE.avatar || '';
  }

  /* ── mailbox sync progress ──────────────────────────────────────
   * A corner panel while the mailbox is analyzed and imported, using the same
   * chrome as the File Library's upload panel so the two read as one thing.
   *
   * Everything shown here is server state (mail_sync_progress), so it
   * survives refreshes and closed tabs: the stage the sync is in, real
   * counts, an honest percentage, a measured time estimate, stall detection
   * with a Retry action, and the failure reason when there is one. It is
   * non-blocking by design, the panel can be collapsed or dismissed and the
   * import carries on in the queue either way.
   */
  var syncPanel = null;
  var syncTimer = null;
  /* Dismissed from birth (2026-08-31): the floating card is retired. The
     backfill runs silently — the card covered the composer, and an ordinary
     queue wait read as "ask an administrator". Sync state lives on
     Settings → Background Operations; the panel machinery stays intact
     behind this flag for a deliberate future surface. */
  var syncDismissed = true;
  var syncCollapsed = false;
  var syncLastData = null;

  /* A full sync is queued, not run inline, so the button coming back to life
   * is not evidence of anything. Hand it to the shared bottom-right sync
   * toasts (sync-toasts.js), the same card OneDrive and the calendar use —
   * so the mailbox reports its progress the same way from any page. The panel
   * above supersedes it while a first import is on screen. */
  function announceMailSync() {
    if (window.TMASyncToasts && window.TMASyncToasts.watch) {
      window.TMASyncToasts.watch('email');
    }
  }

  /*
   * Sync with the provider, then reload the open folder.
   *
   * Shared by the toolbar's refresh button and the shell's refresh gesture, so
   * both do the same work: reloading the listing alone would show whatever was
   * already stored and miss the mail that arrived since.
   */
  function refreshMailbox(root, state, render) {
    if (!root || !state || state.refreshing) return Promise.resolve();
    state.refreshing = true;
    render();
    announceMailSync();

    return api().sync().then(function (data) {
      if (data && data.folders) state.folderCounts = data.folders;
    }).catch(function (err) {
      reportMailError(state, err);
    }).then(function () {
      state.refreshing = false;
      return reloadMessages(root, state, render, { force: true });
    });
  }

  function stopSyncPolling() {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  }

  function hideSyncPanel() {
    if (syncPanel) { syncPanel.remove(); syncPanel = null; }
  }

  function ensureSyncPanel() {
    if (syncPanel) return syncPanel;
    syncPanel = document.createElement('section');
    syncPanel.className = 'tma-sync-toast tma-sync-toast--visible tma-mail-sync';
    syncPanel.setAttribute('aria-label', 'Mailbox sync');
    syncPanel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mail-sync-action]');
      if (!btn) {
        // Minimised chip expands on click, same as sync-toasts.js.
        if (syncCollapsed) {
          syncCollapsed = false;
          if (syncLastData) renderSyncPanel(syncLastData);
        }
        return;
      }
      var action = btn.getAttribute('data-mail-sync-action');
      if (action === 'collapse') {
        syncCollapsed = !syncCollapsed;
        if (syncLastData) renderSyncPanel(syncLastData);
      }
      if (action === 'close') { syncDismissed = true; stopSyncPolling(); hideSyncPanel(); }
      if (action === 'retry') { retryMailSync(btn); }
    });
    // Same column as OneDrive / Smartsheet / calendar sync toasts, a second
    // fixed corner host is what made cards sit on top of each other sideways.
    var stack = (window.TMASyncToasts && window.TMASyncToasts.host)
      ? window.TMASyncToasts.host()
      : (document.querySelector('[data-sync-toast-host]') || document.body);
    stack.appendChild(syncPanel);
    return syncPanel;
  }

  /* Manual retry from the panel. The server resumes from its stored page
   * tokens, so this never restarts the import from message zero. */
  function retryMailSync(btn) {
    if (btn) btn.disabled = true;
    api().retrySync().then(function (data) {
      if (data) renderSyncPanel(data);
      stopSyncPolling();
      syncTimer = setTimeout(pollSyncStatus, 3000);
    }).catch(function () {
      if (btn) btn.disabled = false;
    });
  }

  function syncNum(n) {
    return (n || 0).toLocaleString();
  }

  /* "just now" / "20s ago", the panel's proof it is still being fed. */
  function syncRelativeTime(iso) {
    if (!iso) return '';
    var secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 10) return 'just now';
    if (secs < 60) return secs + 's ago';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + 'm ago';
    return Math.round(mins / 60) + 'h ago';
  }

  function syncEtaText(seconds) {
    if (seconds === null || seconds === undefined) return '';
    if (seconds < 60) return 'under 1 min left';
    var mins = Math.round(seconds / 60);
    if (mins < 60) return 'about ' + mins + ' min left';
    return 'about ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm left';
  }

  /* The server's stall diagnosis, in words a reader can act on. */
  function syncStallText(reason) {
    switch (reason) {
      case 'auth':
        return 'The mailbox connection needs to be reconnected before the sync can continue.';
      case 'queue':
        return 'The background worker looks unavailable, ask an administrator to check the queue worker.';
      case 'job-failed':
        return 'The last sync step failed. Retrying resumes from where it stopped.';
      case 'job-missing':
        return 'The sync step went missing from the queue and is being restarted.';
      default:
        return 'We are retrying the current step.';
    }
  }

  function renderSyncPanel(data) {
    var p = (data && data.progress) || null;
    var finished = !!(data && data.done);
    var failed = !!(data && data.failed);
    var stalled = !!(p && p.stalled) && !finished && !failed;

    // Counts come from the progress record where there is one; older
    // accounts without a record fall back to the plain synced/total pair.
    var processed = p ? (p.processedMessages || 0) : ((data && data.synced) || 0);
    var total = (p && p.totalMessages) || (data && data.total) || null;
    var estimated = !!(p && p.estimated) && !finished;
    var pct = p && p.percentage !== null && p.percentage !== undefined
      ? p.percentage
      : (total ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : null);
    if (finished) pct = 100;

    var title = failed ? 'Mailbox sync problem'
      : finished ? 'Mailbox up to date'
        : stalled ? 'Mailbox sync delayed'
          : (p && p.stageLabel ? p.stageLabel + '…' : 'Syncing mailbox…');

    // "Importing Inbox. 1,250 of ~8,420 messages"
    var meta = total
      ? syncNum(processed) + ' of ' + (estimated ? '~' : '') + syncNum(total) + ' messages'
      : syncNum(processed) + ' messages synced';
    if (p && p.currentFolder && !finished && !failed) {
      var folderName = p.currentFolder.charAt(0).toUpperCase() + p.currentFolder.slice(1);
      meta = folderName + ': ' + meta;
    }

    var stageLine = p && !finished && !failed
      ? 'Step ' + p.stageNumber + ' of ' + p.stageCount
      : '';

    // What the analysis found. Only real numbers appear; a count of zero is
    // simply not claimed yet.
    var statBits = [];
    if (p) {
      if (p.totalConversations) statBits.push(syncNum(p.totalConversations) + ' conversations');
      var attachments = (p.totalAttachments !== null && p.totalAttachments !== undefined)
        ? p.totalAttachments
        : p.attachmentsFound;
      if (attachments) {
        statBits.push(syncNum(attachments) + ' attachments' + (estimated ? ' (est.)' : ''));
      }
      if (p.totalImages) statBits.push(syncNum(p.totalImages) + ' images');
      if (p.totalDocuments) statBits.push(syncNum(p.totalDocuments) + ' documents');
      if (p.failedMessages) statBits.push(syncNum(p.failedMessages) + ' failed');
    }

    var timingBits = [];
    if (p && !finished && !failed && p.etaSeconds !== null && p.etaSeconds !== undefined) {
      timingBits.push(syncEtaText(p.etaSeconds));
    }
    if (p && p.lastProgressAt) timingBits.push('updated ' + syncRelativeTime(p.lastProgressAt));

    // A stalled or failed sync explains itself and offers a way out, never
    // an endless spinner with no explanation.
    var problemHtml = '';
    if (failed) {
      problemHtml =
        '<div class="tma-mail-sync__problem" role="alert">' +
        '<span>' + esc((data && data.error) || 'The mailbox sync failed.') + '</span>' +
        '<button type="button" class="tma-mail-sync__retry" data-mail-sync-action="retry">Retry</button>' +
        '</div>';
    } else if (stalled) {
      problemHtml =
        '<div class="tma-mail-sync__problem" role="status">' +
        '<span>No progress for a little while. ' + esc(syncStallText(p.stallReason)) +
        (p.retried ? ' Retrying automatically…' : '') + '</span>' +
        '<button type="button" class="tma-mail-sync__retry" data-mail-sync-action="retry">Retry now</button>' +
        '</div>';
    }

    var hintHtml = (finished || failed) ? '' :
      '<div class="tma-mail-sync__hint">Syncing continues in the background, you can keep using the portal.</div>';

    var fillClass = 'tma-sync-toast__fill';
    var fillAttr = '';
    var indeterminate = !finished && !failed && !stalled && pct === null;
    if (indeterminate) {
      fillClass += ' tma-sync-toast__fill--indeterminate';
    } else {
      fillAttr = ' style="width:' + (finished || failed ? 100 : pct) + '%"';
    }

    var detailLine = meta;
    if (stageLine) detailLine += ' · ' + stageLine;
    if (statBits.length) detailLine += ' · ' + statBits.join(' · ');
    if (timingBits.length) detailLine += ' · ' + timingBits.join(' · ');

    syncLastData = data;
    var panel = ensureSyncPanel();
    panel.className = 'tma-sync-toast tma-sync-toast--visible tma-mail-sync' +
      (syncCollapsed ? ' tma-sync-toast--min' : '') +
      (finished ? ' tma-sync-toast--done' : '') +
      (failed ? ' tma-sync-toast--error' : '');

    // Same chrome as the global sync toasts. Outlook mark, naked white card.
    panel.innerHTML =
      '<span class="tma-sync-toast__icon tma-sync-toast__icon--email">' +
        '<img src="' + BRAND + 'Outlook.svg" alt="">' +
      '</span>' +
      '<div class="tma-sync-toast__body">' +
        '<span class="tma-sync-toast__title">' + esc(title) + '</span>' +
        '<span class="tma-sync-toast__detail">' + esc(detailLine) + '</span>' +
        '<div class="tma-sync-toast__track"><div class="' + fillClass + '"' + fillAttr + '></div></div>' +
        (syncCollapsed ? '' : (problemHtml + hintHtml)) +
      '</div>' +
      '<div class="tma-sync-toast__actions">' +
        '<button type="button" class="tma-sync-toast__btn" data-mail-sync-action="collapse" aria-label="' +
          (syncCollapsed ? 'Expand' : 'Minimise') + '">–</button>' +
        '<button type="button" class="tma-sync-toast__btn" data-mail-sync-action="close" aria-label="Close">×</button>' +
      '</div>';
  }

  function pollSyncStatus() {
    if (syncDismissed) return;

    api().syncStatus().then(function (data) {
      if (syncDismissed) return;

      if (!data || !data.connected) { hideSyncPanel(); return; }

      // Nothing left to download and nothing on screen: stay out of the way.
      if (data.done && !syncPanel) return;

      renderSyncPanel(data);

      if (data.done) {
        // Leave the finished state up briefly, then clear it.
        stopSyncPolling();
        setTimeout(function () { if (!syncDismissed) hideSyncPanel(); }, 6000);
        return;
      }

      // A failed sync polls slowly (an automatic recovery clears itself); a
      // live one polls fast enough that the numbers visibly move.
      syncTimer = setTimeout(pollSyncStatus, data.failed ? 10000 : 3000);
    }).catch(function () {
      // A failed poll is not worth surfacing; try again later.
      syncTimer = setTimeout(pollSyncStatus, 15000);
    });
  }

  /* Sign out of the mailbox ONLY: stops mail sync so the page returns to the
   * "Connect your mailbox" state. The Google/Microsoft account itself stays
   * connected to the portal, sign-in, calendar and file sync are untouched,
   * and imported mail is kept so reconnecting later is instant. Fully
   * disconnecting the account lives in Security settings. This also does NOT
   * end the portal session, portal sign-out lives on the shell sidebar
   * profile, not this menu. */
  function disconnectMailbox(root, state, render) {
    var provider = state.account && state.account.provider;
    if (!provider) {
      showEmailToast(root, 'No mailbox is connected.');
      return;
    }

    api().disconnect(provider).then(function () {
      // Re-read connection state so the page settles into the connect view;
      // the sync poller stops itself once connected is false.
      hideSyncPanel();
      bootstrapMailbox(root, state, render);
      showEmailToast(root, 'Signed out of your mailbox. Your account is still connected to the portal.');
    }).catch(function (err) {
      showEmailToast(root, (err && err.message) || 'Could not sign out of the mailbox.');
    });
  }

  var profileBound = false;

  /* Keep PROFILE in step with the signed-in user, and repaint once the real
   * details land (the first render happens before /me resolves). */
  function bindCurrentUser(rerender) {
    if (profileBound || !window.TMACurrentUser || !window.TMACurrentUser.onChange) return;
    profileBound = true;

    window.TMACurrentUser.onChange(function (me) {
      if (!me) return;
      PROFILE.name = me.name || '';
      PROFILE.email = me.email || '';
      PROFILE.avatar = me.avatar || null;
      if (typeof rerender === 'function') rerender();
    });
  }

  /* The account chip stands for the connected mailbox, not the portal user.
   * With no mailbox connected it must stop showing the signed-in name, that
   * reads as "still signed in" right after a mailbox sign-out. */
  function profileDisplay(connected) {
    return connected
      ? { name: PROFILE.name, email: PROFILE.email }
      : { name: 'Mailbox', email: 'Not connected' };
  }

  /* Menu items differ by connection: a connected mailbox can be signed out of;
   * a disconnected one only offers the way back to Settings to reconnect. */
  function profileMenuActions(connected) {
    if (!connected) {
      return '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="settings">Connect mailbox</button>';
    }
    return (
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="settings">Settings</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="sign-out">Sign out</button>'
    );
  }

  function renderEmailProfileCard(variant, connected) {
    var wrapCls = 'tma-dash__email-profile-wrap tma-dash__email-profile-wrap--' + variant;
    var profileCls = 'tma-dash__email-profile tma-dash__email-profile--' + variant;
    var who = profileDisplay(connected);
    return (
      '<div class="' + wrapCls + '">' +
      '<div class="' + profileCls + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="" width="40" height="40">' +
      '<span class="tma-dash__email-profile-meta">' +
      '<span class="tma-dash__email-profile-name" title="' + esc(who.name) + '">' + esc(who.name) + '</span>' +
      '<span class="tma-dash__email-profile-email" title="' + esc(who.email) + '">' + esc(who.email) + '</span>' +
      '</span>' +
      '</div>' +
      '</div>'
    );
  }

  /* The phone header's right-hand bubble, the same shape as the shell's own
   * on other pages: search (opens the drawer straight into searching), the
   * theme, and the account. The shell's bubble stays hidden on this page. */
  function renderEmailHeaderMobileTools(state) {
    return (
      '<div class="tma-dash__email-header-tools" role="group" aria-label="Mail">' +
      '<button type="button" class="tma-dash__icon-btn" data-email-header-search aria-label="Search in mail">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '</button>' +
      '<button type="button" class="tma-dash__icon-btn" data-email-header-theme aria-label="Toggle theme">' +
      '<img src="' + emailHeaderThemeIcon() + '" alt="">' +
      '</button>' +
      renderEmailHeaderProfileBtn(state) +
      '</div>'
    );
  }

  function emailHeaderThemeIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return ICON + (dark ? 'MoonStars.svg' : 'Sun.svg');
  }

  /* The theme can change from Settings as well as from this button. */
  function syncEmailHeaderThemeIcon(dash) {
    var img = dash && dash.querySelector('[data-email-header-theme] img');
    if (!img) return;
    var want = emailHeaderThemeIcon();
    if (img.getAttribute('src') !== want) img.setAttribute('src', want);
  }

  /* The header's search icon: the drawer opens already in searching mode,
   * with the field focused inside this tap, which is what lets a phone show
   * its keyboard. */
  function openEmailDrawerSearch(root, state, render) {
    if (!state.mobileNavOpen) toggleEmailMobileNav(root, state);
    openEmailSidebarSearch(root, state, render);
  }

  function wireEmailHeaderMobileTools(root) {
    var dash = getEmailDashRoot(root);
    if (!dash || dash._emailHeaderToolsBound) return;
    dash._emailHeaderToolsBound = true;
    dash.addEventListener('click', function (event) {
      var state = root._emailState;
      var render = root._emailRender;
      if (!state || !render) return;
      if (event.target.closest('[data-email-header-search]')) {
        event.preventDefault();
        openEmailDrawerSearch(root, state, render);
        return;
      }
      if (event.target.closest('[data-email-header-theme]')) {
        event.preventDefault();
        // The shell owns the theme; its own button (hidden on this page)
        // does the switching and the saving.
        var real = dash.querySelector('[data-action="toggle-theme"]');
        if (real) real.click();
        syncEmailHeaderThemeIcon(dash);
      }
    });
    var themeWatch = new MutationObserver(function () { syncEmailHeaderThemeIcon(dash); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function renderEmailHeaderProfileBtn(state) {
    return (
      '<button type="button" class="tma-dash__email-header-profile-btn" data-email-profile-sidebar-toggle' +
      ' aria-label="Open account menu" aria-expanded="' + (state.profileSidebarOpen ? 'true' : 'false') + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="' + esc(PROFILE.name) + '" width="32" height="32">' +
      '</button>'
    );
  }

  function renderEmailProfilePopup(state) {
    if (!isEmailMobile()) return '';
    var connected = state.connected !== false;
    return (
      '<div class="tma-dash__email-profile-popup-card tma-dash__menu" data-email-profile-popup-card role="menu"' +
      ' aria-label="Account"' + (state.profileSidebarOpen ? '' : ' hidden') + '>' +
      renderEmailProfileCard('popup', connected) +
      '<nav class="tma-dash__email-profile-popup-actions" aria-label="Account actions">' +
      profileMenuActions(connected) +
      '</nav>' +
      '</div>'
    );
  }

  function closeEmailProfileSidebar(state) {
    state.profileSidebarOpen = false;
  }

  function openEmailProfileSidebar(root, state) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailProfileMenu(root, state);
    state.mobileNavOpen = false;
    state.profileSidebarOpen = true;
  }

  function renderEmailProfile(isOpen, variant, connected) {
    var wrapCls = 'tma-dash__email-profile-wrap';
    var profileCls = 'tma-dash__email-profile';
    var menuCls = 'tma-dash__email-profile-menu tma-dash__menu';
    if (variant === 'topbar') {
      wrapCls += ' tma-dash__email-profile-wrap--topbar';
      profileCls += ' tma-dash__email-profile--topbar';
      menuCls += ' tma-dash__email-profile-menu--topbar';
    }
    if (variant === 'sidebar') {
      wrapCls += ' tma-dash__email-profile-wrap--sidebar';
      profileCls += ' tma-dash__email-profile--sidebar';
      menuCls += ' tma-dash__email-profile-menu--sidebar';
    }
    var who = profileDisplay(connected);
    return (
      '<div class="' + wrapCls + '">' +
      '<button type="button" class="' + profileCls + '"' +
      ' data-email-profile-toggle aria-haspopup="menu"' +
      ' aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="" width="24" height="24">' +
      '<span class="tma-dash__email-profile-meta">' +
      // The rail is too narrow for a full name and work address, so the value
      // is on the element itself, hovering shows what the ellipsis hides.
      '<span class="tma-dash__email-profile-name" title="' + esc(who.name) + '">' + esc(who.name) + '</span>' +
      '<span class="tma-dash__email-profile-email" title="' + esc(who.email) + '">' + esc(who.email) + '</span>' +
      '</span>' +
      '<img class="tma-dash__email-profile-caret" src="' + ICONS.CaretDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="' + menuCls + '"' +
      ' data-email-profile-menu role="menu"' + (isOpen ? '' : ' hidden') + '>' +
      '<div class="tma-dash__email-profile-menu-head">' +
      '<img class="tma-dash__email-profile-menu-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="" width="40" height="40">' +
      '<div class="tma-dash__email-profile-menu-meta">' +
      '<span class="tma-dash__email-profile-menu-name">' + esc(who.name) + '</span>' +
      '<span class="tma-dash__email-profile-menu-email">' + esc(who.email) + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-profile-menu-divider" role="separator"></div>' +
      profileMenuActions(connected) +
      '</div>' +
      '</div>'
    );
  }

  /* Folder/label/search come from the server; `listFilter` is a local view
   * over the current page (Unread / Starred / Attachments / Pinned). */
  function filteredInbox(state) {
    var rows = rowsOf(state);
    var filter = state.listFilter || 'all';
    if (filter === 'all') return rows;
    return rows.filter(function (row) {
      if (filter === 'unread') return !!row.unread;
      if (filter === 'starred') return !!row.starred;
      if (filter === 'attachments') return !!row.hasAttachments;
      if (filter === 'pinned') return !!row.pinned;
      return true;
    });
  }

  /* Counts come from the server, which sees the whole mailbox, counting
   * loaded rows would only ever report the current page. */
  function getInboxUnreadCount(state) {
    var counts = state && state.folderCounts && state.folderCounts.inbox;
    return counts ? counts.unread : 0;
  }

  /** Keep home shortcuts + sidebar badges on the exact inbox unread total. */
  function announceInboxUnread(state) {
    var n = getInboxUnreadCount(state);
    var email = (state && state.account && state.account.email) || '';
    try {
      document.dispatchEvent(new CustomEvent('tma-email-count', {
        detail: { count: n, email: email },
      }));
    } catch (e) { /* ignore */ }
  }

  /* Browser tab / page title while Email is open:
   * "Inbox 12 - you@firm.com" */
  function getPageTitle(state) {
    var unread = getInboxUnreadCount(state);
    var addr = (state && state.account && state.account.email) || '';
    var title = 'Inbox ' + String(unread || 0);
    return addr ? (title + ' - ' + addr) : title;
  }

  function folderCount(folder, state) {
    if (folder.compose) return null;

    // Templates are a portal-local feature with no provider equivalent, so
    // they still count themselves.
    if (folder.countKey === 'templates') {
      return FIRM_TEMPLATES.items.length || null;
    }

    var counts = state.folderCounts && state.folderCounts[folder.id];
    if (!counts) return null;

    // Inbox, Important and Spam badge what is unread; the rest badge what is
    // there, which is how both Gmail and Outlook read.
    if (folder.id === 'inbox' || folder.id === 'important' || folder.id === 'spam') {
      return counts.unread || null;
    }

    return counts.total || null;
  }

  /*
   * Does this folder's badge count *unread*, or just how much is in there?
   *
   * The two get different treatments: unread is the filled pill that asks for
   * attention, a total is quiet grey text. Rendering a total as a pill made
   * "27 templates" read as 27 unread ones.
   */
  function folderCountIsUnread(folder) {
    return folder.id === 'inbox' || folder.id === 'important' || folder.id === 'spam';
  }

  function renderEmailSidebar(state) {
    var mode = effectiveSidebarMode(state);
    var sidebarCls = 'tma-dash__email-sidebar';
    if (state.mobileNavOpen) sidebarCls += ' tma-dash__email-sidebar--open';
    if (state.mobileSearchOpen) sidebarCls += ' tma-dash__email-sidebar--mobile-search';
    if (mode === 'icons') sidebarCls += ' tma-dash__email-sidebar--collapsed';
    // Hidden still renders (the DOM patch is cheaper than tearing the subtree
    // out and rebuilding it) but takes up no space and is out of the tab order.
    if (mode === 'hidden') sidebarCls += ' tma-dash__email-sidebar--hidden';
    return (
      '<div class="' + sidebarCls + '"' + (mode === 'hidden' ? ' hidden' : '') + '>' +
      (isEmailMobile()
        ? renderEmailSidebarMobileSearch(state)
        : '<div class="tma-dash__email-sidebar-chrome">' +
          renderEmailProfile(!!state.profileMenuOpen, 'sidebar', state.connected !== false) +
          '</div>') +
      '<div class="tma-dash__email-sidebar-nav">' +
      renderEmailSidebarTabs(state) +
      '<div class="tma-dash__nav-section tma-dash__email-sidebar-list" data-email-list="folders"' +
      (emailSidebarList(state) === 'folders' ? '' : ' hidden') + '>' +
      renderFolders(state) +
      '</div>' +
      '<div class="tma-dash__nav-section tma-dash__email-sidebar-list" data-email-list="labels"' +
      (emailSidebarList(state) === 'labels' ? '' : ' hidden') + '>' +
      renderEmailLabelsNav(state) +
      '</div>' +
      renderEmailLabelEditor(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderSplitResizeHandle(state) {
    if (state.layoutStyle !== 'split') return '';
    return (
      '<div class="tma-dash__email-split-resizer" data-email-split-resizer role="separator"' +
      ' aria-orientation="vertical" aria-label="Resize inbox and message panes" aria-valuemin="22"' +
      ' aria-valuemax="78" aria-valuenow="' + Math.round(state.splitListRatio * 100) + '" tabindex="0"></div>'
    );
  }

  function renderEmailPanel(state) {
    var panelCls = 'tma-dash__email-panel';
    if (isEmailMobile()) {
      panelCls += ' tma-dash__email-panel--mobile';
      if (isSingleReading(state)) panelCls += ' tma-dash__email-panel--mobile-reading';
    } else if (state.layoutStyle === 'single') {
      panelCls += ' tma-dash__email-panel--single';
      if (isSingleReading(state)) panelCls += ' tma-dash__email-panel--reading';
    }
    var panelStyle = '';
    if (!isEmailMobile() && state.layoutStyle === 'split') {
      panelStyle =
        ' style="--email-split-list:' + Math.round((state.splitListRatio || SPLIT_RATIO_DEFAULT) * 1000) / 10 + '%"';
    }
    return (
      '<div class="tma-dash__email-panel-fit">' +
      '<div class="' + panelCls + '"' + panelStyle + '>' +
      renderList(state) +
      renderSplitResizeHandle(state) +
      renderDetail(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderFolders(state) {
    return (
      '<nav class="tma-dash__email-folders" aria-label="Mail folders">' +
      FOLDERS.filter(function (folder) {
        // Compose is the page-toolbar New Mail button, not a folder row.
        return !folder.compose;
      }).map(function (folder) {
        var active = !folder.compose && state.folder === folder.id && !state.activeLabelId;
        var cls = 'tma-dash__email-folder';
        if (folder.compose) cls += ' tma-dash__email-folder--compose';
        if (active) cls += ' tma-dash__email-folder--active';
        var count = folderCount(folder, state);
        var countHtml =
          count === null
            ? ''
            : '<span class="tma-dash__email-folder-count' +
              (folderCountIsUnread(folder) ? ' tma-dash__email-folder-count--unread' : '') +
              '">' + count + '</span>';
        return (
          '<button type="button" class="' + cls + '" data-email-folder="' + esc(folder.id) + '"' +
          ' title="' + esc(folder.label) + '" aria-label="' + esc(folder.label) + '">' +
          emailNavCaret() +
          '<img src="' + esc(ICONS[folder.icon]) + '" alt="">' +
          '<span class="tma-dash__email-folder-label">' + esc(folder.label) + '</span>' +
          countHtml +
          '</button>'
        );
      }).join('') +
      '</nav>'
    );
  }

  function templateThumbClass(template) {
    if (template.thumb === 'invoice') return 'tma-dash__email-template-thumb--invoice';
    if (template.thumb === 'auth') return 'tma-dash__email-template-thumb--auth';
    return 'tma-dash__email-template-thumb--invoice';
  }

  function renderTemplateList(state) {
    var templates = FIRM_TEMPLATES.items;
    var body;
    if (!FIRM_TEMPLATES.loaded) {
      body = '';
    } else if (!templates.length) {
      body = '<div class="tma-dash__email-detail--empty" style="padding:24px 16px;"><p>No templates yet.</p></div>';
    } else {
      body = templates
        .map(function (template) {
          var active = state.selectedTemplateId === template.id;
          return (
            '<button type="button" class="tma-dash__email-template-row' + (active ? ' tma-dash__email-template-row--active' : '') + '" data-email-template="' + esc(template.id) + '">' +
            '<span class="tma-dash__email-template-thumb tma-dash__email-template-thumb--auth" aria-hidden="true"></span>' +
            '<span class="tma-dash__email-row-text">' +
            '<span class="tma-dash__email-row-sender">' + esc(template.name) + '</span>' +
            '<span class="tma-dash__email-row-preview">' + esc(template.subject) + '</span>' +
            '</span>' +
            '</button>'
          );
        })
        .join('');
    }
    return (
      '<div class="tma-dash__email-list tma-dash__email-list--templates">' +
      '<div class="tma-dash__email-list-head tma-dash__email-list-head--templates" data-key="email-list-head">' +
      '<span class="tma-dash__email-template-list-title">Templates</span>' +
      renderListHeadActions(state, { templateCount: templates.length, showFilter: false }) +
      '</div>' +
      '<div class="tma-dash__email-list-body" data-key="email-list-body">' + body + '</div>' +
      '</div>'
    );
  }

  /*
   * Category tabs above the inbox.
   *
   * Each one is a real server listing (see MailController::VIRTUAL_FOLDERS),
   * not a filter over the loaded page. Counts live on the sidebar folders;
   * these tabs are just the view switcher.
   */
  function inboxCategories(state) {
    var enabled = state.inboxCategories || [];

    return INBOX_CATEGORIES.filter(function (category) {
      return category.fixed || enabled.indexOf(category.id) !== -1;
    });
  }

  function renderInboxCategories(state) {
    if (state.showInboxCategories === false) return '';
    if (CATEGORY_FOLDERS.indexOf(state.folder) === -1 || state.activeLabelId) return '';

    var categories = inboxCategories(state);
    // One tab is not a choice; drawing a strip for it is just a wasted row.
    if (categories.length < 2) return '';

    return (
      '<div class="tma-dash__email-categories" role="tablist" aria-label="Mail folders">' +
      categories.map(function (category) {
        var active = state.folder === category.id;
        var count = active ? folderCount(category, state) : null;
        var countHtml = active && count
          ? '<span class="tma-dash__email-category-count">' + count + '</span>'
          : '';
        var ariaLabel = count
          ? category.label + ', ' + count
          : category.label;

        return (
          '<button type="button" class="tma-dash__email-category' +
          ' tma-dash__email-category--' + esc(category.id) +
          (active ? ' tma-dash__email-category--active' : '') + '"' +
          ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '"' +
          ' aria-label="' + esc(ariaLabel) + '"' +
          ' title="' + esc(category.label) + '"' +
          ' data-email-category="' + esc(category.id) + '">' +
          '<img src="' + esc(ICONS[category.icon]) + '" alt="">' +
          '<span class="tma-dash__email-category-label">' + esc(category.label) + '</span>' +
          countHtml +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderList(state) {
    if (state.folder === 'templates') return renderTemplateList(state);

    var rows = filteredInbox(state);

    return (
      '<div class="tma-dash__email-list">' +
      /* Title + mailbox tabs stay put above the scroller. Expanding Today
         must grow the list downward, not slide this chrome off the top. */
      (isEmailMobile()
        ? '<div class="tma-dash__email-list-chrome" data-key="email-list-chrome">' +
          renderListMobileHead(state) +
          renderInboxCategories(state) +
          '</div>'
        : renderListMobileHead(state)) +
      '<div class="tma-dash__email-list-head" data-key="email-list-head">' +
      /* Desktop select-all lives in the page toolbar; keep it here on mobile
       * where that bar is hidden. */
      (isEmailMobile() ? renderEmailSelectAll(state) : '') +
      (isEmailMobile() ? '' : renderInboxCategories(state)) +
      (isEmailMobile()
        ? renderEmailListRefreshBtn(state) +
          renderEmailListBulk(state) +
          renderEmailBulkMoreMenu(state) +
          renderEmailLabelMenu(state)
        : '') +
      renderListHeadActions(state, { showFilter: !isEmailMobile() }) +
      '</div>' +
      renderReconnectBanner(state) +
      '<div class="tma-dash__email-list-body" data-key="email-list-body">' +
      renderListState(state, rows) +
      '</div>' +
      renderMailPagination(state) +
      '</div>'
    );
  }

  /* How much of what is on screen is ticked, drives the toolbar checkbox,
   * including its indeterminate state. */
  function selectionSummary(state) {
    var rows = visibleRows(state);
    var checked = rows.filter(function (row) { return isRowChecked(row, state); }).length;

    return {
      total: rows.length,
      checked: checked,
      all: rows.length > 0 && checked === rows.length,
      some: checked > 0 && checked < rows.length,
    };
  }

  function syncSelectAllBox(root, state) {
    var selection = selectionSummary(state);
    root.querySelectorAll('[data-email-selectall]').forEach(function (selectAll) {
      selectAll.checked = selection.all;
      selectAll.indeterminate = selection.some;
    });
  }

  /* Pager for the folder listing. The mailbox mirror can hold tens of
   * thousands of messages, so the list is a real server-side page, this shows
   * where you are, lets you step through, and sets how many land per page. */
  function renderMailPagination(state) {
    if (state.folder === 'templates' || state.search) return '';
    var total = state.total || 0;
    if (!total) return '';

    var perPage = state.perPage || 50;
    var page = state.page || 1;
    var last = state.lastPage || 1;
    var first = ((page - 1) * perPage) + 1;
    var upto = Math.min(page * perPage, total);

    var options = (state.perPageOptions || [25, 50, 100, 200]).map(function (n) {
      return '<option value="' + n + '"' + (n === perPage ? ' selected' : '') + '>' + n + '</option>';
    }).join('');

    function navBtn(target, label, disabled, icon) {
      return '<button type="button" class="tma-dash__email-page-btn" data-email-page="' + target + '"' +
        (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        '<img src="' + icon + '" alt="" aria-hidden="true"></button>';
    }

    return (
      '<div class="tma-dash__email-pagination" data-key="email-pagination" data-email-pagination>' +
      '<div class="tma-dash__email-pagination-size">' +
      '<label for="tma-email-perpage">Per page</label>' +
      '<select id="tma-email-perpage" class="tma-dash__email-perpage" data-email-perpage>' + options + '</select>' +
      '</div>' +
      '<span class="tma-dash__email-pagination-range">' +
      first.toLocaleString() + '–' + upto.toLocaleString() + ' of ' + total.toLocaleString() +
      '</span>' +
      '<div class="tma-dash__email-pagination-nav">' +
      navBtn(1, 'First page', page <= 1, ICONS.ArrowLineLeft) +
      navBtn(page - 1, 'Previous page', page <= 1, ICONS.CaretLeft) +
      '<span class="tma-dash__email-pagination-page">Page ' + page.toLocaleString() + ' of ' + last.toLocaleString() + '</span>' +
      navBtn(page + 1, 'Next page', page >= last, ICONS.CaretRight) +
      navBtn(last, 'Last page', page >= last, ICONS.ArrowLineRight) +
      '</div>' +
      '</div>'
    );
  }

  /* Shown above a list that still has mail in it when the mailbox connection
   * has failed: what is on screen is real but may be stale, and nothing new
   * will arrive until the account is reconnected. */
  /* The list's scrolling body and everything that can sit beside it carry
   * data-keys: this banner comes and goes before the body, and without keys
   * the morph paired children by position, turned the old body into the
   * banner and made a new body at scrollTop 0 — the phone list "jumping to
   * the top" on any repaint. */
  function renderReconnectBanner(state) {
    if (!state.reconnectNeeded || !rowsOf(state).length) return '';

    return (
      '<div class="tma-dash__email-reconnect" data-key="email-reconnect" role="status">' +
      '<span>' + esc(state.mailError || 'This mailbox needs to be reconnected.') + '</span>' +
      '<button type="button" class="tma-dash__email-settings-btn" data-email-open-settings>Fix it</button>' +
      '</div>'
    );
  }

  /*
   * Placeholder rows shaped like the real thing.
   *
   * "Loading emails…" told the reader nothing and made the pane look broken
   * for as long as it showed. These occupy the same geometry the mail will —
   * avatar, two lines, a timestamp, so the list fills in rather than jumping.
   */
  function renderListSkeleton(count) {
    var rows = '';
    var n = Math.max(1, count || 8);

    for (var i = 0; i < n; i++) {
      rows +=
        '<div class="tma-dash__email-row tma-dash__email-row--skeleton" aria-hidden="true">' +
        '<span class="tma-dash__email-row-thread-spacer"></span>' +
        '<span class="tma-skeleton tma-dash__email-skeleton-avatar"></span>' +
        '<div class="tma-dash__email-row-content">' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
        ' tma-dash__email-skeleton-line--sender"></span>' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
        ' tma-dash__email-skeleton-line--subject"></span>' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
        ' tma-dash__email-skeleton-line--snippet"></span>' +
        '</div>' +
        '<div class="tma-dash__email-row-side">' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-time"></span>' +
        '</div>' +
        '</div>';
    }

    return '<div class="tma-dash__email-list-skeleton" role="status" aria-label="Loading messages">' +
      rows + '</div>';
  }

  /* Compact placeholders for an opened conversation while replies load —
   * same shape as child rows (dot slot, sender, snippet, time), not a full
   * inbox row with avatar/subject. */
  function renderThreadSkeleton(count) {
    var rows = '';
    var n = Math.max(1, count || 2);
    var i;

    for (i = 0; i < n; i++) {
      rows +=
        '<div class="tma-dash__email-row tma-dash__email-row--child' +
        ' tma-dash__email-row--skeleton" aria-hidden="true">' +
        '<span class="tma-dash__email-row-unread-slot" aria-hidden="true"></span>' +
        '<div class="tma-dash__email-row-content">' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
        ' tma-dash__email-skeleton-line--sender"></span>' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
        ' tma-dash__email-skeleton-line--snippet"></span>' +
        '</div>' +
        '<div class="tma-dash__email-row-side">' +
        '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-time"></span>' +
        '</div>' +
        '</div>';
    }

    return '<div class="tma-dash__email-thread-skeleton" role="status" aria-label="Loading conversation">' +
      rows + '</div>';
  }

  /* Loading, disconnected, error and empty all get an honest state, never a
   * placeholder message that could be mistaken for real mail. */
  function renderListState(state, rows) {
    function notice(title, body, actionHtml) {
      return (
        '<div class="tma-dash__email-list-empty">' +
        '<p class="tma-dash__email-list-empty-title">' + esc(title) + '</p>' +
        (body ? '<p class="tma-dash__email-list-empty-body">' + esc(body) + '</p>' : '') +
        (actionHtml || '') +
        '</div>'
      );
    }

    /* The portal's shared empty state (illustration, title, one line, one
     * action) rather than a bespoke one, see TMANoData. */
    function empty(title, subtitle, buttonLabel) {
      if (!window.TMANoData) return notice(title, subtitle);

      return (
        '<div class="tma-dash__email-list-empty tma-dash__email-list-empty--illustrated">' +
        window.TMANoData.render({
          title: title,
          subtitle: subtitle,
          illustrationName: 'Illustration07',
          showButton: !!buttonLabel,
          buttonLabel: buttonLabel || '',
        }) +
        '</div>'
      );
    }

    // Skeletons are for "we don't know yet". Once the answer is in, no
    // account, or an account with nothing in this folder, they would be a
    // lie about mail that is on its way, so the empty state takes over.
    if (state.connected === false) {
      return empty(
        'No emails yet',
        'Connect your email account to get started.',
        'Connect email account'
      );
    }

    if (state.loading || state.connected === null) {
      return renderListSkeleton(state.perPage && state.perPage < 8 ? state.perPage : 8);
    }

    if (state.loadError) {
      return notice('Could not load messages', state.loadError);
    }

    if (!rows.length) {
      return state.search
        ? empty('No results', 'Nothing in this mailbox matches “' + state.search + '”.')
        : empty('Nothing here', 'This folder is empty.');
    }

    return buildInboxRowsHtml(rows, state);
  }

  /* Plain-text mail, and the fallback whenever no HTML part was sent.
   *
   * Newlines are the only structure a text body has, so they have to survive:
   * collapsing them into one paragraph turned every plain-text message —
   * including most automated notifications, into an unreadable wall. */
  function renderMessageBodyText(bodyText) {
    return (
      '<div class="tma-dash__email-body tma-dash__email-body--text">' +
      '<pre class="tma-dash__email-body-plain">' + esc(bodyText || '') + '</pre>' +
      '</div>'
    );
  }

  /* The message's attachments, under the body.
   *
   * Images get a thumbnail you can click to open full size; everything else is
   * a labelled row. Both go through the authenticated attachment endpoint —
   * the file is streamed from the provider, never guessed at locally. */
  /* The message's attachments, in their own section under the body, never
   * mixed into it. Each card previews (image thumbnail, or the file-type icon
   * from the same set the File Library uses) and offers Download and
   * Open/Preview separately, since a click should never trigger a surprise
   * download (see openAttachmentLightbox). */
  function renderAttachments(row) {
    var items = (row && row.attachments) || [];
    // Keyed by message, not stored as "the attachments currently on screen":
    // a thread renders several messages at once, each with its own files, so a
    // single shared array would hand every card the last one's attachments.
    var ownerId = (row && row.id) || '';
    state_attachmentsByMessage[ownerId] = items;
    if (!items.length) return '';

    // Gmail-style tiles: a big preview area (the real image, or, since this
    // stack has no Imagick/Ghostscript to rasterise a PDF server-side, its
    // first page rendered client-side via pdf.js, see wireAttachmentPdfPreviews),
    // a filename strip fixed under it, and download/open actions that only
    // appear on hover. The whole tile opens the lightbox; the hover button
    // downloads directly without opening it first.
    var cards = items.map(function (a, i) {
      var isImage = attachmentIsImage(a);
      var isPdf = !isImage && attachmentIsPdf(a);
      // The fallback icon is wired as a real listener (see wireAttachmentPreviews),
      // not an inline onerror string: JSON.stringify()'s own double quotes would
      // terminate this double-quoted HTML attribute early and silently truncate
      // the handler, so it never actually ran.
      var preview = isImage
        ? '<img src="' + esc(attachmentUrl(a, true)) + '" alt="" loading="lazy"' +
          ' data-email-attachment-fallback-icon="' + esc(attachmentIconSrc(a)) + '">'
        : '<img class="tma-dash__email-attachment-tile-icon-img" src="' + esc(attachmentIconSrc(a)) + '" alt="">';

      return (
        '<div class="tma-dash__email-attachment-tile' + (isImage ? '' : ' tma-dash__email-attachment-tile--icon') + '"' +
        ' data-email-attachment-index="' + i + '" data-email-attachment-open="' + i + '" role="button" tabindex="0"' +
        (isPdf ? ' data-email-attachment-pdf="' + esc(attachmentUrl(a, true)) + '"' : '') + '>' +
        '<div class="tma-dash__email-attachment-tile-preview">' + preview +
        // Hovering (or focusing) the tile covers the preview with the full
        // filename, see .tma-dash__email-attachment-tile-caption, so a
        // long or ambiguous name never needs a separate tooltip to read.
        '<div class="tma-dash__email-attachment-tile-caption" aria-hidden="true"><span>' + esc(a.name) + '</span></div>' +
        '<div class="tma-dash__email-attachment-tile-corner" aria-hidden="true"></div>' +
        '<div class="tma-dash__email-attachment-tile-hover">' +
        '<a class="tma-dash__email-attachment-tile-btn" href="' + esc(attachmentUrl(a, false)) + '" download="' + esc(a.name) + '"' +
        ' aria-label="Download ' + esc(a.name) + '" data-email-attachment-download>' +
        '<img src="' + ICONS.ArrowLineDown + '" alt="">' +
        '</a>' +
        '</div>' +
        '</div>' +
        '<div class="tma-dash__email-attachment-tile-bar">' +
        '<img class="tma-dash__email-attachment-tile-bar-icon" src="' + esc(attachmentIconSrc(a)) + '" alt="">' +
        '<span class="tma-dash__email-attachment-tile-name" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    // Embedded pictures are counted separately in the heading. They stay
    // listed, a sender pasting a real document into the body gives it a
    // Content-ID exactly as a signature logo has one, and hiding the first to
    // tidy away the second loses genuine paperwork, but saying how many of
    // the files are pictures already shown above stops a signature's four
    // logos reading as four documents nobody sent.
    var inlineCount = items.filter(function (a) { return a.inline; }).length;
    var fileCount = items.length - inlineCount;

    var heading = items.length + ' attachment' + (items.length === 1 ? '' : 's');
    if (inlineCount && fileCount) {
      heading = fileCount + ' attachment' + (fileCount === 1 ? '' : 's') +
        ' · ' + inlineCount + ' embedded image' + (inlineCount === 1 ? '' : 's');
    } else if (inlineCount) {
      heading = inlineCount + ' embedded image' + (inlineCount === 1 ? '' : 's');
    }

    return (
      '<div class="tma-dash__email-attachments" data-email-attachments' +
      ' data-email-attachments-owner="' + esc(ownerId) + '">' +
      '<div class="tma-dash__email-attachments-head">' +
      '<img src="' + ICONS.PaperclipHorizontal + '" alt="" aria-hidden="true">' +
      heading +
      '</div>' +
      '<div class="tma-dash__email-attachments-list">' + cards + '</div>' +
      '</div>'
    );
  }

  /* ── attachment lightbox ──────────────────────────────────────
   * Reuses the File Library's lightbox CSS (.tma-portal-lightbox*) so a
   * preview looks identical whether it was opened from Files or from Mail —
   * this is a new, small controller rather than calling into portal-files.js
   * directly, since that module's gallery/permissions are tied to the Vault's
   * file model, not a mail attachment.
   */
  var mailLightbox = null;

  function closeAttachmentLightbox() {
    if (!mailLightbox) return;
    if (mailLightbox._stageCleanup) { mailLightbox._stageCleanup(); mailLightbox._stageCleanup = null; }
    document.removeEventListener('keydown', mailLightbox._key);
    mailLightbox.remove();
    mailLightbox = null;
    document.body.style.overflow = '';
  }

  /* Text-y attachments (txt, csv, json…) preview on a fetched sheet via the
   * shared lightbox helpers; detection lives there so both viewers agree. */
  function attachmentIsText(a) {
    return !!(window.TMAPortalLightbox && window.TMAPortalLightbox.isTextItem &&
      window.TMAPortalLightbox.isTextItem({ mime: a.mime, name: a.name }));
  }

  function attachmentLightboxStage(a) {
    if (attachmentIsImage(a)) {
      return '<img class="tma-portal-lightbox__img tma-dash__email-lightbox-img" src="' + esc(attachmentUrl(a, true)) + '" alt="' + esc(a.name) + '" data-email-lightbox-zoom>';
    }
    if (attachmentIsPdf(a)) {
      // Painted by the shared pdf.js mounter after paint(), an iframe here
      // used to work on Chrome but Mac Safari drops iframe PDFs entirely.
      if (window.TMAPortalLightbox && window.TMAPortalLightbox.pdfInto) {
        return '<div class="tma-lightbox__doc" data-mail-lb-doc="pdf"></div>';
      }
      return '<iframe class="tma-portal-lightbox__frame" src="' + esc(attachmentUrl(a, true)) + '" title="' + esc(a.name) + '"></iframe>';
    }
    if (/^audio\//.test(a.mime || '')) {
      return '<div class="tma-portal-lightbox__audio"><img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="64" height="64">' +
        '<audio src="' + esc(attachmentUrl(a, true)) + '" controls autoplay></audio></div>';
    }
    if (/^video\//.test(a.mime || '')) {
      return '<video class="tma-portal-lightbox__media" src="' + esc(attachmentUrl(a, true)) + '" controls autoplay playsinline></video>';
    }
    if (attachmentIsText(a)) {
      return '<div class="tma-lightbox__doc" data-mail-lb-doc="text"></div>';
    }
    // Office documents, archives, and anything else a browser cannot render
    // safely inline: an honest "here's what it is" card, not a fake viewer.
    return (
      '<div class="tma-portal-lightbox__nopreview">' +
      '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="72" height="72">' +
      '<p class="tma-portal-lightbox__nopreview-title">' + esc(a.name) + '</p>' +
      '<p class="tma-portal-lightbox__nopreview-text">' + esc(attachmentTypeLabel(a)) + ' · ' + esc(formatBytes(a.size)) +
      ' · no in-browser preview for this file type</p>' +
      '</div>'
    );
  }

  function openAttachmentLightbox(items, index) {
    closeAttachmentLightbox();

    var idx = index;
    var lb = document.createElement('div');
    lb.className = 'tma-portal-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    document.body.appendChild(lb);
    document.body.style.overflow = 'hidden';
    mailLightbox = lb;

    function paint() {
      if (lb._stageCleanup) { lb._stageCleanup(); lb._stageCleanup = null; }
      var a = items[idx];
      var many = items.length > 1;
      lb.innerHTML =
        '<div class="tma-portal-lightbox__backdrop" data-lb-close></div>' +
        '<div class="tma-portal-lightbox__head">' +
        '<span class="tma-portal-lightbox__title" title="' + esc(a.name) + '">' +
        '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="18" height="18">' + esc(a.name) + '</span>' +
        '<div class="tma-portal-lightbox__head-actions">' +
        '<a class="tma-portal-tool" data-lb-download href="' + esc(attachmentUrl(a, false)) + '" download="' + esc(a.name) + '">' +
        '<img src="' + ICONS.ArrowLineDown + '" alt="" width="16" height="16"><span>Download</span></a>' +
        '<button type="button" class="tma-portal-tool tma-portal-tool--icon" data-lb-close aria-label="Close">' +
        '<img src="' + ICONS.X + '" alt="" width="16" height="16"></button>' +
        '</div></div>' +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--prev" data-lb-prev aria-label="Previous"><img src="' + ICONS.CaretLeft + '" alt="" width="24" height="24"></button>' : '') +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--next" data-lb-next aria-label="Next"><img src="' + ICONS.CaretRight + '" alt="" width="24" height="24"></button>' : '') +
        '<div class="tma-portal-lightbox__stage" data-lb-stage>' + attachmentLightboxStage(a) + '</div>' +
        '<div class="tma-portal-lightbox__foot">' + (many ? (idx + 1) + ' of ' + items.length + ' &middot; ' : '') + esc(formatBytes(a.size)) + '</div>';

      var doc = lb.querySelector('[data-mail-lb-doc]');
      if (doc && window.TMAPortalLightbox) {
        lb._stageCleanup = doc.getAttribute('data-mail-lb-doc') === 'pdf'
          ? window.TMAPortalLightbox.pdfInto(doc, attachmentUrl(a, true))
          : window.TMAPortalLightbox.textInto(doc, attachmentUrl(a, true), a.size);
      }
    }

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= items.length) return;
      idx = next;
      paint();
    }

    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-close]')) { closeAttachmentLightbox(); return; }
      if (e.target.closest('[data-lb-prev]')) { go(-1); return; }
      if (e.target.closest('[data-lb-next]')) { go(1); return; }
      // Click-to-zoom for images: a simple toggle rather than full pinch/pan,
      // enough to inspect detail on a scanned document or photo.
      var zoomImg = e.target.closest('[data-email-lightbox-zoom]');
      if (zoomImg) { zoomImg.classList.toggle('is-zoomed'); return; }
      // Clicking the dim stage around the attachment (not the media itself)
      // closes the lightbox, same expectation as clicking the backdrop.
      var stage = e.target.closest('[data-lb-stage]');
      if (stage && !e.target.closest('img, iframe, video, audio, .tma-portal-lightbox__nopreview, .tma-portal-lightbox__audio, .tma-lightbox__doc, a, button')) {
        closeAttachmentLightbox();
      }
    });

    lb._key = function (e) {
      if (document.querySelector('.tma-portal-modal')) return;
      if (e.key === 'Escape') closeAttachmentLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', lb._key);

    paint();
  }

  /* Delegated so it works whichever branch of the detail render is showing. */
  function wireAttachmentPreviews(root) {
    MORPH.unwired(root, '[data-email-attachments]').forEach(function (section) {
      if (section._wired) return;
      section._wired = true;

      function openFrom(target) {
        // The download button sits inside the tile it downloads, let its own
        // native download proceed rather than also opening the lightbox.
        if (target.closest('[data-email-attachment-download]')) return;
        var btn = target.closest('[data-email-attachment-open]');
        if (!btn) return;
        var index = parseInt(btn.getAttribute('data-email-attachment-open'), 10);
        // Which message's files these are, a thread has several sections on
        // screen at once, so the owner has to come from the section itself.
        var owner = section.getAttribute('data-email-attachments-owner') || '';
        var items = state_attachmentsByMessage[owner] || [];
        if (!items.length || isNaN(index)) return;
        openAttachmentLightbox(items, index);
      }

      section.addEventListener('click', function (e) { openFrom(e.target); });
      // The tile is a div (role="button"), which, unlike a real <button> —
      // needs its own Enter/Space handling to be keyboard-operable.
      section.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('[data-email-attachment-download]')) return;
        if (!e.target.closest('[data-email-attachment-open]')) return;
        e.preventDefault();
        openFrom(e.target);
      });

      // A broken preview (the fake/expired-token case, or any transient
      // provider hiccup) falls back to the file-type icon. `error` does not
      // bubble, so this has to be bound on the capture phase to delegate.
      section.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || !img.matches || !img.matches('[data-email-attachment-fallback-icon]')) return;
        var tile = img.closest('.tma-dash__email-attachment-tile');
        if (tile) tile.classList.add('tma-dash__email-attachment-tile--icon');
        var fallback = document.createElement('img');
        fallback.className = 'tma-dash__email-attachment-tile-icon-img';
        fallback.src = img.getAttribute('data-email-attachment-fallback-icon');
        fallback.alt = '';
        img.replaceWith(fallback);
      }, true);
    });
  }

  // Set right before the attachments section renders (see renderMessageBody
  // caller) so the lightbox and the click handler always agree on which
  // message's attachments are on screen, without threading the array through
  // every intermediate render function.
  /* Attachments currently on screen, keyed by the message they belong to.
   *
   * Not threaded through every intermediate render function, and not a single
   * "last row" array either: a thread paints several messages at once, so the
   * lightbox has to be able to ask which card was clicked. */
  var state_attachmentsByMessage = {};

  /* The state currently being rendered.
   *
   * Same reasoning as state_attachmentsByMessage above: a handful of leaf render
   * helpers need one field off the state (the user's signature, their timezone
   * preferences) and threading an extra argument through every caller in
   * between costs more than it explains. Set once at the top of render().
   */
  var state_active = null;

  /* One of the user's mail preferences, or a fallback before settings load.
   *
   * Bootstrap already ships preferences on state.preferences; the settings
   * panel mirrors them onto state.settings once opened. Compose must see the
   * signature from either place, otherwise a fresh page opens compose with
   * no signature until Email settings has been visited once. */
  function mailPreference(key, fallback) {
    var prefs = {};
    if (state_active) {
      if (state_active.settings && state_active.settings.preferences) {
        prefs = state_active.settings.preferences;
      } else if (state_active.preferences) {
        prefs = state_active.preferences;
      }
    }
    return prefs[key] === undefined || prefs[key] === null ? fallback : prefs[key];
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  /* ── Compose file attachments (paperclip + drag-and-drop) ───── */
  var MAX_COMPOSE_FILES = 10;
  var MAX_COMPOSE_FILE_BYTES = 100 * 1024 * 1024;

  function composeFilesOf(holder) {
    if (!holder.attachments) holder.attachments = [];
    return holder.attachments;
  }

  function dragHasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function readFileAsAttachment(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        var comma = result.indexOf(',');
        resolve({
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          name: file.name || 'attachment',
          mime: file.type || 'application/octet-stream',
          size: file.size,
          content: comma >= 0 ? result.slice(comma + 1) : result,
        });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function addComposeFiles(root, holder, fileList, paint) {
    var files = Array.prototype.slice.call(fileList || []);
    files = files.filter(function (file) { return file && file.size > 0; });
    if (!files.length) return;
    var current = composeFilesOf(holder);
    var room = MAX_COMPOSE_FILES - current.length;
    if (room <= 0) {
      showEmailToast(root, 'Up to ' + MAX_COMPOSE_FILES + ' files can be attached');
      return;
    }
    if (files.length > room) {
      showEmailToast(root, 'Only the first ' + room + ' files were added');
      files = files.slice(0, room);
    }
    var tooBig = files.filter(function (file) { return file.size > MAX_COMPOSE_FILE_BYTES; });
    if (tooBig.length) {
      showEmailToast(root, (tooBig.length === 1 ? tooBig[0].name : tooBig.length + ' files') + ' over 100 MB');
      files = files.filter(function (file) { return file.size <= MAX_COMPOSE_FILE_BYTES; });
    }
    if (!files.length) return;
    Promise.all(files.map(readFileAsAttachment)).then(function (items) {
      items.forEach(function (item) { current.push(item); });
      if (paint) paint();
    }).catch(function () {
      showEmailToast(root, 'Those files could not be read');
    });
  }

  function composeFilePayload(holder) {
    return composeFilesOf(holder).map(function (item) {
      return { name: item.name, mime: item.mime, content: item.content };
    });
  }

  function composeAttachmentsFromRecord(items) {
    return (items || []).map(function (item) {
      return {
        id: item.id || ('att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
        name: item.name || 'attachment',
        mime: item.mime || 'application/octet-stream',
        size: item.size || 0,
        content: item.content || '',
      };
    }).filter(function (item) { return item.content; });
  }

  function renderComposeFileChips(holder) {
    var items = composeFilesOf(holder);
    if (!items.length) return '';
    return items.map(function (item) {
      var icon = (window.TMAFileIcons && window.TMAFileIcons.fileIconSrc)
        ? window.TMAFileIcons.fileIconSrc(null, item.name)
        : ICONS.Paperclip;
      return (
        '<span class="tma-dash__email-compose-file" data-email-compose-file="' + esc(item.id) + '" title="' + esc(item.name) + '">' +
        '<img src="' + esc(icon) + '" alt="">' +
        '<span class="tma-dash__email-compose-file-name">' + esc(item.name) + '</span>' +
        '<span class="tma-dash__email-compose-file-size">' + esc(formatBytes(item.size)) + '</span>' +
        '<button type="button" class="tma-dash__email-compose-file-remove" data-email-compose-file-remove="' + esc(item.id) + '"' +
        ' aria-label="Remove ' + esc(item.name) + '">' +
        '<img src="' + ICONS.X + '" alt=""></button></span>'
      );
    }).join('');
  }

  function paintComposeFileChips(scope, holder) {
    if (!scope) return;
    var host = scope.querySelector('[data-email-compose-files]');
    if (!host) return;
    var html = renderComposeFileChips(holder);
    host.innerHTML = html;
    host.hidden = !html;
  }

  function openComposeFilePicker(onFiles) {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', function () {
      if (input.files && input.files.length) onFiles(input.files);
    });
    input.click();
  }

  function clipboardFileList(event) {
    var dt = event.clipboardData;
    if (!dt) return null;
    var files = [];
    if (dt.files && dt.files.length) {
      files = Array.prototype.slice.call(dt.files);
    } else if (dt.items) {
      for (var i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind !== 'file') continue;
        var file = dt.items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    return files.length ? files : null;
  }

  function composeHolderForEditor(state, editor) {
    if (!editor || !editor.closest) return null;
    var win = editor.closest('[data-email-compose-window]');
    if (win) {
      return {
        holder: findComposeDraft(state, win.getAttribute('data-email-compose-window')),
        scope: win,
        persist: true,
      };
    }
    var panel = editor.closest('[data-email-inline-compose-panel]');
    if (panel && state.inlineCompose) {
      return { holder: state.inlineCompose, scope: panel, persist: false };
    }
    return null;
  }

  function attachFilesToComposeEditor(root, state, editor, fileList) {
    var target = composeHolderForEditor(state, editor);
    if (!target || !target.holder) return;
    function paint() {
      paintComposeFileChips(target.scope, target.holder);
      if (target.persist) scheduleDraftSave(state, target.holder);
    }
    if (fileList) {
      addComposeFiles(root, target.holder, fileList, paint);
      return;
    }
    openComposeFilePicker(function (files) {
      addComposeFiles(root, target.holder, files, paint);
    });
  }

  function wireComposeDropTarget(el, onFiles) {
    if (!el || el._composeDropWired) return;
    el._composeDropWired = true;
    var depth = 0;
    function clearDrop() {
      depth = 0;
      el.classList.remove('is-drop-target');
    }
    el.addEventListener('dragenter', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragover', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }, true);
    el.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (depth === 0) el.classList.remove('is-drop-target');
    });
    el.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) {
        clearDrop();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      clearDrop();
      onFiles(e.dataTransfer.files);
    }, true);
  }

  /* ── attachment type detection ────────────────────────────────
   * One shared table for the human-readable type label; the icon itself comes
   * from window.TMAFileIcons, the same lookup the File Library uses, so a
   * given extension draws identically everywhere in the portal. */
  var ATTACHMENT_TYPE_LABELS = {
    pdf: 'PDF',
    doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word',
    xls: 'Excel', xlsx: 'Excel', ods: 'Excel',
    csv: 'CSV',
    ppt: 'PowerPoint', pptx: 'PowerPoint', odp: 'PowerPoint',
    jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', webp: 'Image',
    bmp: 'Image', tiff: 'Image', tif: 'Image', heic: 'Image', heif: 'Image',
    avif: 'Image', svg: 'Image',
    mp4: 'Video', mov: 'Video', webm: 'Video', mkv: 'Video', avi: 'Video', m4v: 'Video',
    mp3: 'Audio', wav: 'Audio', ogg: 'Audio', m4a: 'Audio', flac: 'Audio', aac: 'Audio',
    zip: 'Archive', rar: 'Archive', '7z': 'Archive', tar: 'Archive', gz: 'Archive',
    txt: 'Text', md: 'Text', log: 'Text',
  };

  function attachmentExt(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function attachmentTypeLabel(attachment) {
    var ext = attachmentExt(attachment && attachment.name);
    return ATTACHMENT_TYPE_LABELS[ext] || (ext ? ext.toUpperCase() : 'File');
  }

  function attachmentIconSrc(attachment) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(null, attachment.name);
    return ICONS.PaperclipHorizontal;
  }

  function attachmentIsImage(attachment) {
    return /^image\//.test((attachment && attachment.mime) || '') || /^(jpg|jpeg|png|gif|webp|bmp|tiff|tif|heic|heif|avif)$/i.test(attachmentExt(attachment && attachment.name));
  }

  function attachmentIsPdf(attachment) {
    return (attachment && attachment.mime) === 'application/pdf' || attachmentExt(attachment && attachment.name) === 'pdf';
  }

  var ATTACHMENT_BASE = (window.__TMA_SITE_ROOT || '') + '/portal/mail/attachments/';

  function attachmentUrl(attachment, inline) {
    return ATTACHMENT_BASE + encodeURIComponent(attachment.id) + (inline ? '?inline=1' : '');
  }

  /* pdf.js ships as ESM and weighs ~1.7 MB with its worker, so it's pulled in
     on first use rather than at page load, see portal-work.js's identical
     loader for the signature editor. Rendering the attachment's own first
     page client-side sidesteps the lack of Imagick/Ghostscript server-side. */
  var attachmentPdfjsPromise = null;
  function loadAttachmentPdfjs() {
    if (attachmentPdfjsPromise) return attachmentPdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    attachmentPdfjsPromise = import(root + '/js/vendor/pdf-loader.mjs?v=5').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf-worker.mjs?v=2';
      return lib;
    }).catch(function (err) {
      attachmentPdfjsPromise = null; // let a later attempt retry
      throw err;
    });
    return attachmentPdfjsPromise;
  }

  function renderAttachmentPdfThumb(tile, url) {
    var iconImg = tile.querySelector('.tma-dash__email-attachment-tile-icon-img');
    if (!iconImg) return;
    loadAttachmentPdfjs()
      .then(function (pdfjs) { return pdfjs.getDocument({ url: url, withCredentials: true }).promise; })
      .then(function (pdf) { return pdf.getPage(1); })
      .then(function (page) {
        var targetWidth = tile.clientWidth || 210;
        var dpr = window.devicePixelRatio || 1;
        var scale = (targetWidth * dpr) / page.getViewport({ scale: 1 }).width;
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.className = 'tma-dash__email-attachment-tile-pdf-canvas';
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
        canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
        return page.render({ canvas: canvas, viewport: viewport }).promise.then(function () {
          if (!iconImg.parentNode) return; // tile re-rendered while we were loading
          tile.classList.remove('tma-dash__email-attachment-tile--icon');
          iconImg.replaceWith(canvas);
        });
      })
      // A corrupt/unreadable PDF, or the worker failing to load, just leaves
      // the icon in place, never worth surfacing as an error to the user.
      .catch(function () {});
  }

  function wireAttachmentPdfPreviews(root) {
    root.querySelectorAll('[data-email-attachment-pdf]').forEach(function (tile) {
      if (tile._pdfPreviewWired) return;
      tile._pdfPreviewWired = true;
      renderAttachmentPdfThumb(tile, tile.getAttribute('data-email-attachment-pdf'));
    });
  }

  /* Compact chips under a list row. Gmail's own inbox does exactly this: a
   * small icon-and-name pill per file, not a full thumbnail, so a page of 50
   * rows never has to render dozens of image previews at once. */
  function renderRowAttachmentChips(row) {
    if (!row.hasAttachments) return '';

    var items = row.attachmentsPreview || [];
    var known = row.attachmentCount;

    // We only know real filenames/types for messages already opened once
    // (see toRow(), nothing here ever asks the provider for this). Anything
    // else still gets a line, just without per-file detail yet.
    if (!items.length) {
      return (
        '<div class="tma-dash__email-row-attachments">' +
        '<span class="tma-dash__email-attachment-chip tma-dash__email-attachment-chip--generic">' +
        '<img src="' + ICONS.PaperclipHorizontal + '" alt="" aria-hidden="true">' +
        '<span>' + (known ? known + ' attachment' + (known === 1 ? '' : 's') : 'Attachment') + '</span>' +
        '</span></div>'
      );
    }

    var LIMIT = 3;
    var shown = items.slice(0, LIMIT);
    var more = (known || items.length) - shown.length;

    // Each chip we have real data for opens straight into the same lightbox
    // the full message view uses (see wireListRows) instead of just opening
    // the message, a shortcut Gmail's own inbox offers too.
    var chips = shown.map(function (a, i) {
      return (
        '<span class="tma-dash__email-attachment-chip" title="' + esc(a.name) + '" data-email-row-attachment-open="' + i + '">' +
        '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" aria-hidden="true">' +
        '<span>' + esc(a.name) + '</span>' +
        '</span>'
      );
    }).join('');

    if (more > 0) {
      // "+more" can only jump into the lightbox when the extra files are
      // ones we actually have data for (items goes up to the server's cap of
      // 8); beyond that it falls back to opening the message, same as before.
      var moreOpen = items.length > shown.length ? ' data-email-row-attachment-open="' + shown.length + '"' : '';
      chips += '<span class="tma-dash__email-attachment-chip tma-dash__email-attachment-chip--more"' + moreOpen + '>+' + more + ' more</span>';
    }

    return '<div class="tma-dash__email-row-attachments">' + chips + '</div>';
  }

  /* Grow the message frame to its content so nothing is cut off.
   *
   * Re-measures after images finish loading, since a picture that arrives late
   * changes the height. Falls back to leaving the CSS height alone if the
   * document cannot be read for any reason. */
  function sizeMessageFrames(root) {
    root.querySelectorAll('[data-email-body-frame]').forEach(function (frame) {
      var fit = function () {
        try {
          var doc = frame.contentDocument;
          if (!doc || !doc.body) return;
          var h = Math.max(
            doc.body.scrollHeight,
            doc.documentElement ? doc.documentElement.scrollHeight : 0
          );
          if (h > 0) frame.style.height = (h + 2) + 'px';
        } catch (e) { /* cross-origin or torn down; keep the CSS height */ }
      };

      fit();
      frame.addEventListener('load', fit);

      try {
        var d = frame.contentDocument;
        if (d) {
          d.querySelectorAll('img').forEach(function (img) {
            if (!img.complete) {
              img.addEventListener('load', fit);
              img.addEventListener('error', fit);
            }
          });
        }
      } catch (e) { /* ignore */ }

      // A couple of late passes catch fonts and slow images without needing a
      // resize observer inside a document we deliberately cannot script.
      setTimeout(fit, 250);
      setTimeout(fit, 1200);
    });
  }

  /* Gives the sandboxed document a readable default and stops remote images
   * from silently reporting that the message was opened. */
  function wrapEmailBodyHtml(html) {
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="referrer" content="no-referrer">' +
      '<style>' +
      // :where() keeps these at zero specificity, so anything the sender
      // specified wins. Previously these overrode the message's own styling
      // and every email came out looking the same.
      ':where(html){margin:0;padding:0;}' +
      // Reading-pane gutter so plain HTML (no own margins) is not flush to
      // the frame edges. Senders that set their own body padding still win.
      // A phone's gutter is the pane's own 16px; the pane adds none of its
      // own there, so the text lines up with the head above it.
      ':where(body){margin:0;padding:' + (isEmailMobile() ? '16px 16px 12px' : '20px 24px 12px') + ';box-sizing:border-box;' +
      'font-family:Inter,system-ui,sans-serif;font-size:14px;' +
      // A white canvas in BOTH themes: mail is authored against white, and on
      // the dark theme a transparent body would show the dark frame through
      // the sender's black text. Senders that paint their own background win.
      'background:#fff;' +
      'line-height:1.5;color:#1c1c1c;word-wrap:break-word;overflow-wrap:anywhere;}' +
      // Pictures are held to the pane width so they cannot force the message
      // sideways; wide tables keep their real layout and scroll instead of
      // being squashed into something the sender never designed.
      ':where(img){max-width:100%;height:auto;}' +
      // On a phone the sender's fixed widths give way: an inline width="1400"
      // would beat the rule above and push the message sideways, and a
      // 600px newsletter table would scroll inside its frame with its text
      // cut at the edge. Pictures are capped and tables reflow to the pane,
      // the way every phone mail client reads them.
      (isEmailMobile()
        ? 'img{max-width:100% !important;height:auto !important;}' +
          'table{max-width:100% !important;}' +
          'td,th{white-space:normal !important;overflow-wrap:anywhere;}' +
          'pre{white-space:pre-wrap !important;overflow-wrap:anywhere;}' +
          // Quoted history carries the sizes of whatever client wrote it
          // (Outlook's 12pt Calibri, Gmail's 16px blockquote) and on a phone
          // came out bigger than the reply above it. History reads at the
          // reply's own size.
          QUOTE_FONT_CLAMP
        : '') +
      '</style></head><body>' + html + '</body></html>'
    );
  }

  /* ── quoted history ──────────────────────────────────────────────
   * A reply carries the message it answers, and usually everything before
   * that, appended to its own text. Showing all of it inline is what made
   * replies so hard to follow: the two lines someone actually wrote sit on top
   * of screens of history they did not.
   *
   * The split happens here rather than inside the body frame, because that
   * frame deliberately cannot run scripts, so a toggle inside it could never
   * work. Both halves are kept; nothing is discarded.
   */

  /* Where mail clients mark the start of quoted history. */
  var QUOTE_SELECTORS = [
    '.gmail_quote',
    '.gmail_extra',
    'blockquote[type="cite"]',
    '#divRplyFwdMsg',          // Outlook's "From: … Sent: …" reply header
    '#appendonsend',           // Outlook's marker for everything it appended
    '.OutlookMessageHeader',
    'div[name="quote"]',       // Zimbra, Roundcube
    '.yahoo_quoted',
    '.protonmail_quote',
    '.moz-cite-prefix',        // Thunderbird
  ];

  /* The phone-only rule that sizes quoted history like the reply itself:
   * every quote container, and everything after Outlook's reply header. */
  var QUOTE_FONT_CLAMP = (function () {
    var roots = QUOTE_SELECTORS.concat(['#divRplyFwdMsg ~ *', '#appendonsend ~ *']);
    return roots.concat(roots.map(function (sel) { return sel + ' *'; })).join(',') +
      '{font-size:14px !important;line-height:1.5 !important;}';
  })();

  /* Splits a body into what the sender wrote and the history they quoted.
   *
   * Parsed with DOMParser into a detached document: nothing is ever inserted
   * into the live page, no scripts run, and the sandboxed frame still does the
   * actual rendering. Returns the original untouched when there is no quote to
   * separate, so an ordinary message costs nothing. */
  function splitQuotedHtml(html) {
    var none = { main: html, quoted: '', hasQuote: false };
    if (!html || typeof DOMParser === 'undefined') return none;

    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      return none;
    }
    if (!doc || !doc.body) return none;

    var marker = null;
    for (var i = 0; i < QUOTE_SELECTORS.length && !marker; i++) {
      try {
        marker = doc.body.querySelector(QUOTE_SELECTORS[i]);
      } catch (e) { /* a selector this browser dislikes is simply skipped */ }
    }

    // Outlook separates the reply from its history with a horizontal rule
    // rather than a class, so that is worth catching too, but only when it is
    // in the back half of the message, so a rule used as decoration in a
    // newsletter is not mistaken for a quote boundary.
    if (!marker) {
      var rules = doc.body.querySelectorAll('hr');
      if (rules.length) {
        var last = rules[rules.length - 1];
        if (last.parentNode === doc.body && indexOfNode(last) > childCount(doc.body) / 2) {
          marker = last;
        }
      }
    }

    if (!marker) return none;

    // Everything from the marker onward is history. Walk up to the marker's
    // top-level ancestor first, so a quote nested inside a wrapper takes the
    // whole wrapper with it rather than leaving its container behind.
    var top = marker;
    while (top.parentNode && top.parentNode !== doc.body) top = top.parentNode;

    var quoted = doc.createElement('div');
    while (top.nextSibling) quoted.appendChild(top.nextSibling);
    quoted.insertBefore(top, quoted.firstChild);

    var main = doc.body.innerHTML;

    // A reply that is *only* quoted history (a bare forward, say) has nothing
    // to collapse, hiding all of it would leave an empty message.
    if (!main.replace(/<[^>]*>/g, '').trim()) return none;

    return { main: main, quoted: quoted.innerHTML, hasQuote: true };
  }

  function indexOfNode(node) {
    var i = 0;
    while ((node = node.previousSibling) !== null) i++;
    return i;
  }

  function childCount(node) {
    return node.childNodes ? node.childNodes.length : 0;
  }

  /* ── thread rendering ────────────────────────────────────────────
   * Every message in the conversation as its own card, oldest at the top.
   * Collapsed messages show a single summary line; the newest, the one that
   * was opened, and anything unread start expanded.
   */
  function renderEmailThread(state, threadActions) {
    // Only ever the conversation the selected message is actually in, a
    // thread left over from the previously open message must not be painted
    // against this one. ensureThreadLoaded replaces it on the next tick.
    var thread = threadCoversSelection(state) ? state.thread : null;

    if (state.threadError && state.threadErrorId === state.selectedId) {
      return (
        '<div class="tma-dash__email-thread">' +
        '<div class="tma-dash__email-thread-error" role="alert">' +
        esc(state.threadError) +
        '</div></div>'
      );
    }

    if (!thread || !thread.messages.length) {
      return (
        '<div class="tma-dash__email-thread">' +
        renderMessageSkeleton() +
        '</div>'
      );
    }

    /*
     * The reading pane shows the message that was opened, in full.
     *
     * It used to stack the whole conversation here as collapsed cards with
     * their own expand-all control, a second, competing way to move between
     * messages now that the inbox row has a dropdown. Navigating a thread
     * belongs in one place, and that place is the list.
     */
    var message = thread.messages.filter(function (m) {
      return m.id === state.selectedId;
    })[0] || thread.messages[thread.messages.length - 1];

    return (
      '<div class="tma-dash__email-thread" data-email-thread>' +
      renderThreadMessage(message, state, {
        showQuoted: !!thread.showQuoted[message.id],
      }) +
      (threadActions || '') +
      '</div>'
    );
  }

  /* A placeholder shaped like the message that is coming, rather than the
   * words "Loading conversation…" sitting alone in an empty pane. */
  function renderMessageSkeleton() {
    return (
      '<div class="tma-dash__email-message tma-dash__email-message--skeleton" role="status"' +
      ' aria-label="Loading message">' +
      '<div class="tma-dash__email-message-head">' +
      '<span class="tma-skeleton tma-dash__email-skeleton-avatar"></span>' +
      '<div class="tma-dash__email-message-head-identity">' +
      '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
      ' tma-dash__email-skeleton-line--sender"></span>' +
      '<span class="tma-skeleton tma-skeleton--text tma-dash__email-skeleton-line' +
      ' tma-dash__email-skeleton-line--subject"></span>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-skeleton-body">' +
      '<span class="tma-skeleton tma-skeleton--text"></span>' +
      '<span class="tma-skeleton tma-skeleton--text"></span>' +
      '<span class="tma-skeleton tma-skeleton--text"></span>' +
      '<span class="tma-skeleton tma-skeleton--text"></span>' +
      '</div>' +
      '</div>'
    );
  }

  /* The open message. */
  function renderThreadMessage(message, state, opts) {
    var metaEmail = message.email || '';
    var metaDate = formatMessageDate(message);
    var subject = message.subject || '';

    return (
      '<article class="tma-dash__email-message tma-dash__email-message--expanded' +
      ' tma-dash__email-message--current"' +
      ' data-email-thread-message="' + esc(message.id) + '">' +
      renderThreadMessageHead(message, metaEmail, metaDate, subject, state) +
      renderThreadMessageBody(message, opts) +
      renderAttachments(message) +
      '</article>'
    );
  }

  /* The head of the open card. Plain markup now: it used to double as the
   * collapse control, which is the mechanism the inbox dropdown replaced. */
  function renderThreadMessageHead(message, metaEmail, metaDate, subject, state) {
    return (
      '<div class="tma-dash__email-message-head-wrap">' +
      renderMessageHead(message, metaEmail, metaDate, subject, 'thread-' + message.id, state) +
      '</div>'
    );
  }

  function renderThreadMessageBody(message, opts) {
    if (message._loading) {
      return (
        '<div class="tma-dash__email-body tma-dash__email-skeleton-body" role="status"' +
        ' aria-label="Loading message">' +
        '<span class="tma-skeleton tma-skeleton--text"></span>' +
        '<span class="tma-skeleton tma-skeleton--text"></span>' +
        '<span class="tma-skeleton tma-skeleton--text"></span>' +
        '</div>'
      );
    }

    if (message._error) {
      return (
        '<div class="tma-dash__email-body">' +
        '<p class="tma-dash__email-body-error" role="alert">' + esc(message._error) + '</p>' +
        '</div>'
      );
    }

    // Nothing fetched yet, the card was rendered before its body arrived.
    if (!message.bodyLoaded && !message.bodyHtml && !message.bodyText) {
      return renderMessageBodyText(message.body || '');
    }

    if (!message.bodyHtml) {
      return renderMessageBodyText(message.bodyText || message.body || '');
    }

    var split = splitQuotedHtml(message.bodyHtml);
    var shown = split.hasQuote && !opts.showQuoted ? split.main : message.bodyHtml;

    var quoteToggle = split.hasQuote
      ? '<button type="button" class="tma-dash__email-quote-toggle"' +
        ' data-email-thread-quote="' + esc(message.id) + '"' +
        ' aria-expanded="' + (opts.showQuoted ? 'true' : 'false') + '">' +
        (opts.showQuoted ? 'Hide quoted text' : 'Show quoted text') +
        '</button>'
      : '';

    return (
      '<div class="tma-dash__email-body tma-dash__email-body--html">' +
      '<iframe class="tma-dash__email-body-frame" sandbox="allow-same-origin"' +
      ' referrerpolicy="no-referrer" title="Message content" data-email-body-frame' +
      ' srcdoc="' + esc(wrapEmailBodyHtml(shown)) + '"></iframe>' +
      quoteToggle +
      '</div>'
    );
  }

  /* The send time in the reader's own timezone.
   *
   * `sentAt` is an ISO instant; the two preformatted labels the server also
   * sends are built from a UTC Carbon, so on their own they show a 9pm message
   * as 1am the following day for anyone west of UTC, which is how a message
   * ends up looking like it never arrived. */
  function formatMessageDate(message) {
    if (!message.sentAt) return message.dateLabel || message.time || '';

    var when = new Date(message.sentAt);
    if (isNaN(when.getTime())) return message.dateLabel || message.time || '';

    try {
      return when.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (e) {
      return message.dateLabel || message.time || '';
    }
  }

  /* The phone head's date: "Sep 4, 8:36 PM", with the year only when it is
   * not this one. The full form stays in the details panel and the title. */
  function formatMessageDateShort(message, fallback) {
    if (!message.sentAt) return fallback || '';
    var when = new Date(message.sentAt);
    if (isNaN(when.getTime())) return fallback || '';
    var opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (when.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    try {
      return when.toLocaleString(undefined, opts);
    } catch (e) {
      return fallback || '';
    }
  }

  function renderTemplateDetail(state) {
    var template = firmTemplateById(state.selectedTemplateId);
    if (!template) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty"><p>Select a template</p></div>';
    }

    return (
      '<div class="tma-dash__email-detail tma-dash__email-detail--template">' +
      renderDetailBack(state) +
      '<div class="tma-dash__email-detail-subject">' + esc(template.subject) + '</div>' +
      '<div class="tma-dash__email-template-meta">' +
      '<span class="tma-dash__email-template-meta-category">' + esc(template.name) + '</span>' +
      '<div class="tma-dash__email-template-meta-actions">' +
      '<button type="button" class="tma-dash__email-template-use" data-email-use-template="' + esc(template.id) + '">Use template</button></div>' +
      '</div>' +
      '<div class="tma-dash__email-detail-scroll tma-dash__email-template-preview">' +
      '<div style="padding:8px 4px;font-size:15px;line-height:22px;">' + template.bodyHtml + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDetailThreadInner(state, row) {
    if (!row) {
      return '<div class="tma-dash__email-detail-empty-copy" data-key="email-detail-empty"><p>Select a message</p></div>';
    }
    var lines = rowListLines(row);
    var subject = (state.thread && state.thread.subject) || lines.subject;
    var metaEmail = row.email || '';
    var metaDate = formatMessageDate(row);
    var mobile = isEmailMobile();
    var threadActions = renderDetailThreadActions(state, row, metaEmail, metaDate, subject, lines.body);
    var body = renderEmailThread(state, null);
    return (
      renderDetailTopbar(state) +
      '<div class="tma-dash__email-detail-subject-bar" data-key="email-detail-subject">' +
      (!mobile ? renderDetailBack(state, true) : '') +
      renderDetailSubject(subject, row, state) +
      '</div>' +
      '<div class="tma-dash__email-detail-scroll" data-key="email-detail-scroll">' + body + '</div>' +
      (threadActions
        ? '<div class="tma-dash__email-detail-footer' +
          (mobile ? ' tma-dash__email-detail-mobile-footer' : '') + '" data-key="email-detail-footer">' +
          threadActions +
          '</div>'
        : '')
    );
  }

  function renderDetail(state) {
    if (state.composePopout) {
      var popped = paneComposeDraft(state);
      if (popped) return wrapComposeOverlay(state, renderDetailComposeDraft(state, popped));
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty" data-key="email-detail"></div>';
    }

    if (state.folder === 'templates') return renderTemplateDetail(state);

    var draft = paneComposeDraft(state);
    syncInlineCompose(state);
    var row = findAnyRow(state, state.selectedId);
    var inline = !!(state.inlineCompose && row);
    var composing = !!draft || inline;
    var mobile = isEmailMobile();

    if (!row && !composing) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty" data-key="email-detail"><p>Select a message</p></div>';
    }

    var overlay = '';
    if (draft) overlay = wrapComposeOverlay(state, renderDetailComposeDraft(state, draft));
    else if (inline) overlay = wrapComposeOverlay(state, renderDetailInlineCompose(state, row));

    var cls = 'tma-dash__email-detail';
    if (mobile) cls += ' tma-dash__email-detail--mobile';
    if (composing) cls += ' tma-dash__email-detail--composing';

    return (
      '<div class="' + cls + '" data-key="email-detail">' +
      renderDetailThreadInner(state, row) +
      overlay +
      '</div>'
    );
  }

  /* A new compose window starts blank. Only an explicitly chosen template, or
   * a reply/forward that set one, may put a subject here, the mock's stand-in
   * invoice subject used to be the fallback, so every blank message the user
   * started was pre-addressed about an invoice they had not mentioned. */
  function getComposeSubject(draft) {
    return draft.subject || '';
  }

  function createComposeDraft(state, opts) {
    opts = opts || {};
    return {
      id: 'compose-' + state.nextComposeId++,
      // Addresses are the "Name <a@b>, c@d" string the pill fields parse
      // and write back; what is still being typed rides in _typing so a
      // re-render never destroys a half-typed address.
      to: opts.to || '',
      cc: opts.cc || '',
      bcc: opts.bcc || '',
      subject: opts.subject || '',
      bodyHtml: opts.bodyHtml || '',
      showCc: !!opts.showCc,
      minimized: false,
      // Large compose is the default; expand toggles almost-fullscreen.
      expanded: true,
      fullscreen: false,
      sending: false,
      // Set once the draft has been saved server-side, so autosave updates
      // the same record instead of creating a new one each keystroke.
      serverId: opts.serverId || null,
      mode: opts.mode || 'new',
      inReplyTo: opts.inReplyTo || null,
      attachments: opts.attachments ? opts.attachments.slice() : [],
      signatureId: opts.signatureId || signatureLibraryFromState().activeSignatureId || '',
    };
  }

  /* "a@b.com, Name <c@d.com>" → the array the send endpoint expects. */
  function parseAddresses(text) {
    return String(text || '')
      .split(',')
      .map(function (part) { return part.trim(); })
      .filter(Boolean)
      .map(function (part) {
        var match = part.match(/^(.*?)\s*<([^>]+)>$/);
        if (match) return { name: match[1].replace(/^"|"$/g, '').trim() || null, email: match[2].trim() };
        return { email: part };
      })
      .filter(function (address) { return address.email.indexOf('@') !== -1; });
  }

  /* ── Recipient pills ─────────────────────────────────────────────
   * To, Cc and Bcc hold each address as a pill, the way every mail client
   * does; the input after the pills only ever carries the address being
   * typed. A comma, Enter, Tab or leaving the field turns that text into a
   * pill, Backspace on an empty input takes the last pill back, and picks
   * from the typeahead or a body @mention land as pills straight away.
   *
   * State keeps speaking the "Name <a@b>, c@d" string that drafts, send and
   * reply already use: the pills are that string parsed, and the field hands
   * it back through onChange whenever a pill is added or removed. Text still
   * being typed rides beside it as `_typing`, so a re-render mid-word paints
   * the same half-address instead of wiping it. */

  function recipientFull(address) {
    return address.name ? address.name + ' <' + address.email + '>' : address.email;
  }

  function renderRecipientPill(address, removable) {
    var full = recipientFull(address);
    return (
      '<span class="tma-dash__email-recipient' + (removable ? '' : ' tma-dash__email-recipient--static') + '"' +
      ' data-key="' + esc(address.email.toLowerCase()) + '"' +
      ' data-email-recipient="' + esc(address.email) + '"' +
      (address.name ? ' data-email-recipient-name="' + esc(address.name) + '"' : '') +
      ' title="' + esc(full) + '">' +
      '<span>' + esc(address.name || address.email) + '</span>' +
      (removable
        ? '<button type="button" class="tma-dash__email-recipient-remove" data-email-recipient-remove' +
          ' tabindex="-1" aria-label="Remove ' + esc(full) + '">' +
          '<img src="' + ICONS.X + '" alt=""></button>'
        : '') +
      '</span>'
    );
  }

  /* `value` is the address string; `input` the field's <input> markup, or
   * omitted for a read-only list such as a reply's To. */
  function renderRecipientField(opts) {
    var pills = parseAddresses(opts.value).map(function (address) {
      return renderRecipientPill(address, !!opts.input);
    }).join('');
    if (!pills && !opts.input) {
      pills = '<span class="tma-dash__email-inline-compose-value">' + esc(opts.value || '') + '</span>';
    }
    return (
      '<div class="tma-dash__email-recipients' + (opts.input ? '' : ' tma-dash__email-recipients--static') + '" data-email-recipients>' +
      pills + (opts.input || '') +
      '</div>'
    );
  }

  function recipientFieldOf(input) {
    return input && input.closest ? input.closest('[data-email-recipients]') : null;
  }

  function recipientFieldAddresses(field) {
    if (!field) return [];
    return Array.prototype.map.call(field.querySelectorAll('[data-email-recipient]'), function (pill) {
      return { name: pill.getAttribute('data-email-recipient-name') || null, email: pill.getAttribute('data-email-recipient') };
    });
  }

  function recipientFieldHas(field, email) {
    var needle = String(email || '').toLowerCase();
    return recipientFieldAddresses(field).some(function (address) {
      return address.email.toLowerCase() === needle;
    });
  }

  function notifyRecipientField(input) {
    var field = recipientFieldOf(input);
    if (field && field._onChange) field._onChange(formatAddressList(recipientFieldAddresses(field)), input.value || '');
  }

  /* Adds addresses as pills, skipping any already there. Returns how many landed. */
  function recipientFieldAdd(input, pieces) {
    var field = recipientFieldOf(input);
    if (!field) return 0;
    var added = 0;
    (pieces || []).forEach(function (piece) {
      if (!piece || !piece.email || piece.email.indexOf('@') === -1) return;
      if (recipientFieldHas(field, piece.email)) return;
      input.insertAdjacentHTML('beforebegin', renderRecipientPill({ name: piece.name || null, email: piece.email }, true));
      added++;
    });
    return added;
  }

  /* Turns the typed text into pills. With keepTail the last comma-separated
   * piece stays in the input, which is what a pasted list wants while its
   * final address is still being typed. Text that is not an address stays. */
  function recipientFieldCommit(input, keepTail) {
    var text = String(input.value || '');
    if (text.indexOf('@') === -1) return false;
    var parts = text.split(/[,;\n]/);
    var tail = keepTail ? parts.pop() : '';
    var pieces = [];
    var keep = [];
    parts.forEach(function (part) {
      var address = parseAddresses(part)[0];
      if (address) pieces.push(address);
      else if (part.trim()) keep.push(part.trim());
    });
    if (!pieces.length) return false;
    recipientFieldAdd(input, pieces);
    if (tail.trim()) keep.push(tail.replace(/^\s+/, ''));
    input.value = keep.join(', ');
    notifyRecipientField(input);
    return true;
  }

  /* Anything still typed in the fields under `scope` becomes a pill; run
   * before reading the addresses to send. */
  function commitRecipientFields(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-email-recipients] input').forEach(function (input) {
      recipientFieldCommit(input, false);
    });
  }

  function wireRecipientField(input, onChange) {
    var field = recipientFieldOf(input);
    if (!field) return;
    field._onChange = onChange;

    if (!field._recipientsWired) {
      field._recipientsWired = true;
      field.addEventListener('click', function (event) {
        var current = field.querySelector('input');
        var remove = event.target.closest('[data-email-recipient-remove]');
        if (remove) {
          var pill = remove.closest('[data-email-recipient]');
          if (pill) pill.remove();
          if (current) {
            notifyRecipientField(current);
            current.focus();
          }
          return;
        }
        if (current && !event.target.closest('[data-email-recipient]')) current.focus();
      });
    }

    if (input._recipientsWired) return;
    input._recipientsWired = true;

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Backspace' && !input.value) {
        var pills = field.querySelectorAll('[data-email-recipient]');
        if (!pills.length) return;
        event.preventDefault();
        pills[pills.length - 1].remove();
        notifyRecipientField(input);
        return;
      }
      if (event.key !== ',' && event.key !== ';' && event.key !== 'Enter' && event.key !== 'Tab') return;
      // With the typeahead open, Enter is its pick.
      if (event.key === 'Enter' && suggestActive && suggestActive.input === input) return;
      if (input.value.indexOf('@') === -1) return;
      if (event.key !== 'Tab') event.preventDefault();
      recipientFieldCommit(input, false);
    });

    input.addEventListener('input', function () {
      // A pasted "a@b, c@d" lands as pills at once.
      if (!(/[,;\n]/.test(input.value) && recipientFieldCommit(input, true))) {
        notifyRecipientField(input);
      }
    });

    input.addEventListener('blur', function () {
      recipientFieldCommit(input, false);
    });
  }

  /* ── Recipient typeahead ─────────────────────────────────────────
   * Portal users, clients, groups, and everyone this mailbox has written
   * to or heard from. The dropdown is a body-level popup so compose
   * re-renders / overflow never clip it, and picks write straight into the
   * input without a full re-render. */

  var SUGGEST_DEBOUNCE_MS = 50;
  var suggestCache = {};
  var suggestPrefetching = false;
  var suggestActive = null;

  function closeRecipientSuggest() {
    var menu = document.querySelector('[data-email-suggest-menu]');
    if (menu) menu.remove();
    if (suggestActive && suggestActive.cleanup) suggestActive.cleanup();
    suggestActive = null;
  }

  function currentAddressToken(value, caret) {
    var before = String(value || '').slice(0, caret == null ? String(value || '').length : caret);
    var start = before.lastIndexOf(',') + 1;
    return { start: start, text: before.slice(start).replace(/^\s+/, '') };
  }

  /* A pick replaces whatever was being typed with a pill (every address of
   * a group), skipping any already in the field. */
  function applyRecipientSuggestion(input, suggestion) {
    var pieces = (suggestion.source === 'group' && suggestion.emails && suggestion.emails.length)
      ? suggestion.emails
      : [{ name: suggestion.name, email: suggestion.email }];

    input.value = '';
    recipientFieldAdd(input, pieces);
    notifyRecipientField(input);
    closeRecipientSuggest();
    input.focus();
  }

  function renderSuggestMenu(items, activeIndex) {
    if (!items.length) {
      return '<div class="tma-dash__email-suggest-empty">No matches</div>';
    }
    return items.map(function (item, i) {
      var label = item.source === 'group'
        ? esc(item.name || 'Group')
        : esc(item.name ? item.name : item.email);
      // Email only under the name, never "Previous email" / "Organization"
      // source tags; those read as clutter next to a real face.
      var meta = item.source === 'group'
        ? esc(item.sourceLabel || 'Group')
        : esc(item.email || '');
      var initial = esc(item.initial || String(item.name || item.email || '?').charAt(0).toUpperCase());
      var colorStyle = item.initialColor ? ' style="background:' + esc(item.initialColor) + ';color:#fff"' : '';
      // One circle only: a photo when we have one, otherwise initials.
      // (A hidden sibling fallback was showing beside the photo because
      // .tma-dash__email-suggest-avatar--initial { display:inline-flex }
      // overrode the HTML hidden attribute.)
      var avatar = item.avatarUrl
        ? '<img class="tma-dash__email-suggest-avatar" src="' + esc(item.avatarUrl) + '" alt=""' +
          ' referrerpolicy="no-referrer" decoding="async"' +
          ' data-email-suggest-initial="' + initial + '"' +
          (item.initialColor ? ' data-email-suggest-color="' + esc(item.initialColor) + '"' : '') +
          ' onerror="window.TMAEmail && window.TMAEmail._suggestPhotoFallback && window.TMAEmail._suggestPhotoFallback(this)">'
        : '<span class="tma-dash__email-suggest-avatar tma-dash__email-suggest-avatar--initial" aria-hidden="true"' + colorStyle + '>' +
          initial + '</span>';
      return (
        '<button type="button" class="tma-dash__email-suggest-item' +
        (i === activeIndex ? ' tma-dash__email-suggest-item--active' : '') + '"' +
        ' data-email-suggest-index="' + i + '" role="option" aria-selected="' + (i === activeIndex ? 'true' : 'false') + '">' +
        avatar +
        '<span class="tma-dash__email-suggest-copy">' +
        '<span class="tma-dash__email-suggest-name">' + label + '</span>' +
        '<span class="tma-dash__email-suggest-meta">' + meta + '</span>' +
        '</span>' +
        '</button>'
      );
    }).join('');
  }

  function recipientSuggestAnchor(input) {
    return (input && (
      input.closest('.tma-dash__email-compose-to') ||
      input.closest('.tma-dash__email-inline-compose-row') ||
      input.closest('[data-email-recipients]')
    )) || input;
  }

  function openRecipientSuggest(input, items) {
    closeRecipientSuggest();
    closeComposeMention();
    if (!items || !items.length) return;

    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-suggest-menu';
    menu.setAttribute('data-email-suggest-menu', '');
    menu.setAttribute('role', 'listbox');
    var activeIndex = 0;
    menu.innerHTML = renderSuggestMenu(items, activeIndex);
    document.body.appendChild(menu);

    var anchor = recipientSuggestAnchor(input);
    var rect = anchor.getBoundingClientRect();
    menu.style.minWidth = Math.max(260, Math.round(rect.width)) + 'px';
    positionEmailPopupMenu(anchor, menu);

    var overlay = input.closest('[data-email-compose-overlay]');
    if (overlay && !overlay.classList.contains('is-open')) {
      overlay.addEventListener('transitionend', function onEnd(event) {
        if (event.target !== overlay) return;
        overlay.removeEventListener('transitionend', onEnd);
        if (suggestActive && suggestActive.input === input && menu.isConnected) {
          positionEmailPopupMenu(recipientSuggestAnchor(input), menu);
        }
      });
    }

    function setActive(next) {
      activeIndex = Math.max(0, Math.min(items.length - 1, next));
      menu.innerHTML = renderSuggestMenu(items, activeIndex);
      bindItemClicks();
      var active = menu.querySelector('.tma-dash__email-suggest-item--active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function bindItemClicks() {
      menu.querySelectorAll('[data-email-suggest-index]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          // mousedown so the input doesn't blur before we apply
          e.preventDefault();
          var idx = parseInt(btn.getAttribute('data-email-suggest-index'), 10);
          if (!isNaN(idx) && items[idx]) applyRecipientSuggestion(input, items[idx]);
        });
      });
    }
    bindItemClicks();

    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        applyRecipientSuggestion(input, items[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeRecipientSuggest();
      }
    }

    function onDoc(e) {
      if (e.target === input || menu.contains(e.target)) return;
      closeRecipientSuggest();
    }

    input.addEventListener('keydown', onKey);
    setTimeout(function () { document.addEventListener('mousedown', onDoc, true); }, 0);

    suggestActive = {
      input: input,
      cleanup: function () {
        input.removeEventListener('keydown', onKey);
        document.removeEventListener('mousedown', onDoc, true);
      },
    };
  }

  function suggestionMatches(item, q) {
    if (!q) return true;
    var email = String(item.email || '').toLowerCase();
    var name = String(item.name || '').toLowerCase();
    if (item.source === 'group') {
      return name.indexOf(q) !== -1 || String(item.sourceLabel || '').toLowerCase().indexOf(q) !== -1;
    }
    return email.indexOf(q) !== -1 || name.indexOf(q) !== -1;
  }

  function cachedSuggestions(q) {
    var key = String(q || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(suggestCache, key)) return suggestCache[key];
    for (var len = key.length - 1; len >= 0; len--) {
      var parentKey = key.slice(0, len);
      if (!Object.prototype.hasOwnProperty.call(suggestCache, parentKey)) continue;
      return suggestCache[parentKey].filter(function (item) {
        return suggestionMatches(item, key);
      });
    }
    return null;
  }

  function prefetchRecipientSuggest() {
    if (Object.prototype.hasOwnProperty.call(suggestCache, '') || suggestPrefetching) return;
    suggestPrefetching = true;
    api().suggest('').then(function (data) {
      suggestCache[''] = (data && data.suggestions) || [];
    }).catch(function () { /* typeahead still works on demand */ }).then(function () {
      suggestPrefetching = false;
    });
  }

  function requestRecipientSuggest(input) {
    var token = currentAddressToken(input.value, input.selectionStart).text;
    // An empty To must not dump the directory the moment compose opens.
    if (!String(token || '').trim()) {
      closeRecipientSuggest();
      return;
    }
    // Skip when the token already looks like a finished address.
    if (token.indexOf('@') !== -1 && token.indexOf(' ') === -1 && /\.[a-z]{2,}$/i.test(token)) {
      closeRecipientSuggest();
      return;
    }

    var q = token;
    var cacheKey = q.toLowerCase();
    var cached = cachedSuggestions(q);
    if (cached && cached.length) {
      openRecipientSuggest(input, cached);
      if (Object.prototype.hasOwnProperty.call(suggestCache, cacheKey)) return;
    }

    var seq = (input._suggestSeq = (input._suggestSeq || 0) + 1);
    api().suggest(q).then(function (data) {
      if (seq !== input._suggestSeq) return;
      var items = (data && data.suggestions) || [];
      suggestCache[cacheKey] = items;
      if (document.activeElement !== input) return;
      if (!items.length) { closeRecipientSuggest(); return; }
      openRecipientSuggest(input, items);
    }).catch(function () {
      /* Suggest is best-effort, a failure just means no dropdown. */
    });
  }

  function wireRecipientSuggest(input) {
    if (!input || input._suggestWired) return;
    input._suggestWired = true;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');

    var timer = null;
    input.addEventListener('input', function () {
      var q = currentAddressToken(input.value, input.selectionStart).text;
      if (!String(q || '').trim()) {
        closeRecipientSuggest();
        return;
      }
      var cached = cachedSuggestions(q);
      if (cached && cached.length) openRecipientSuggest(input, cached);
      clearTimeout(timer);
      timer = setTimeout(function () { requestRecipientSuggest(input); }, SUGGEST_DEBOUNCE_MS);
    });
    input.addEventListener('focus', function () {
      prefetchRecipientSuggest();
      var q = currentAddressToken(input.value, input.selectionStart).text;
      if (!String(q || '').trim()) return;
      var cached = cachedSuggestions(q);
      if (cached && cached.length) openRecipientSuggest(input, cached);
      clearTimeout(timer);
      timer = setTimeout(function () { requestRecipientSuggest(input); }, SUGGEST_DEBOUNCE_MS);
    });
    input.addEventListener('blur', function () {
      // Delay so a mousedown on a suggestion can fire first.
      setTimeout(function () {
        if (suggestActive && suggestActive.input === input) closeRecipientSuggest();
      }, 150);
    });
  }


  /* ── Body @mentions (compose / reply / forward) ──────────────────
   * Type @ in the contenteditable body to pick someone from the same
   * suggest API as To/Cc/Bcc. The menu is a body-level popup (no re-render)
   * so the caret stays put. Picking inserts a mailto mention and, when a
   * To field is editable, also adds them as a recipient. */

  var MENTION_DEBOUNCE_MS = 50;
  var mentionActive = null;

  function closeComposeMention() {
    var menu = document.querySelector('[data-email-mention-menu]');
    if (menu) menu.remove();
    if (mentionActive && mentionActive.cleanup) mentionActive.cleanup();
    mentionActive = null;
  }

  function composeMentionMatch(textBeforeCaret) {
    return String(textBeforeCaret || '').match(/(^|\s)@([\w.'\-]*)$/);
  }

  function caretClientRect() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    var range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    var rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
    var rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height || rect.top || rect.left)) return rect;
    // Empty editors often report a zero rect, fall back to the editor box.
    return null;
  }

  function findEditableToInput(editor) {
    var compose = editor.closest('.tma-dash__email-compose');
    if (compose) {
      return compose.querySelector('[data-email-compose-field="to"]');
    }
    var panel = editor.closest('[data-email-inline-compose-panel]');
    if (panel) {
      return panel.querySelector('[data-email-inline-compose-field="to"]');
    }
    return null;
  }

  function addMentionToRecipients(editor, suggestion) {
    var toInput = findEditableToInput(editor);
    if (!toInput) return;

    var pieces = (suggestion.source === 'group' && suggestion.emails && suggestion.emails.length)
      ? suggestion.emails
      : [{ name: suggestion.name, email: suggestion.email }];

    if (recipientFieldAdd(toInput, pieces)) notifyRecipientField(toInput);
  }

  function applyComposeMention(editor, suggestion) {
    if (!editor || !suggestion) return;
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    var range = selection.getRangeAt(0);
    var node = range.startContainer;
    if (!node || node.nodeType !== 3 || !editor.contains(node)) return;

    var before = node.textContent.slice(0, range.startOffset);
    var match = composeMentionMatch(before);
    if (!match) return;

    var triggerLen = 1 + (match[2] || '').length; // "@" + query
    var start = before.length - triggerLen;
    range.setStart(node, start);
    range.setEnd(node, range.startOffset + triggerLen);
    range.deleteContents();

    var label = suggestion.source === 'group'
      ? (suggestion.name || 'Group')
      : (suggestion.name || suggestion.email || 'Someone');
    var email = suggestion.email || '';
    if (suggestion.source === 'group' && suggestion.emails && suggestion.emails[0]) {
      email = suggestion.emails[0].email || '';
    }

    var mention = document.createElement('a');
    mention.className = 'tma-dash__email-mention';
    mention.setAttribute('data-email-mention', email || label);
    if (email) mention.setAttribute('href', 'mailto:' + email);
    mention.setAttribute('contenteditable', 'false');
    mention.textContent = '@' + label;

    range.insertNode(mention);
    var spacer = document.createTextNode('\u00a0');
    mention.parentNode.insertBefore(spacer, mention.nextSibling);

    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    addMentionToRecipients(editor, suggestion);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    closeComposeMention();
    editor.focus();
  }

  function openComposeMentionMenu(editor, items) {
    closeComposeMention();
    closeRecipientSuggest();
    if (!items || !items.length) return;

    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-suggest-menu tma-dash__email-mention-menu';
    menu.setAttribute('data-email-mention-menu', '');
    menu.setAttribute('role', 'listbox');
    var activeIndex = 0;
    menu.innerHTML = renderSuggestMenu(items, activeIndex);
    document.body.appendChild(menu);

    var caret = caretClientRect();
    var anchorRect = caret || editor.getBoundingClientRect();
    menu.style.minWidth = '280px';
    // positionEmailPopupMenu expects an element; use a temporary anchor at the caret.
    var anchor = document.createElement('span');
    anchor.style.position = 'fixed';
    anchor.style.top = Math.round(anchorRect.bottom || anchorRect.top || 0) + 'px';
    anchor.style.left = Math.round(anchorRect.left || 0) + 'px';
    anchor.style.width = '1px';
    anchor.style.height = '1px';
    anchor.style.pointerEvents = 'none';
    document.body.appendChild(anchor);
    positionEmailPopupMenu(anchor, menu);
    anchor.remove();

    function setActive(next) {
      activeIndex = Math.max(0, Math.min(items.length - 1, next));
      menu.innerHTML = renderSuggestMenu(items, activeIndex);
      bindItemClicks();
      var active = menu.querySelector('.tma-dash__email-suggest-item--active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function bindItemClicks() {
      menu.querySelectorAll('[data-email-suggest-index]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var idx = parseInt(btn.getAttribute('data-email-suggest-index'), 10);
          if (!isNaN(idx) && items[idx]) applyComposeMention(editor, items[idx]);
        });
      });
    }
    bindItemClicks();

    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && items[activeIndex]) {
        e.preventDefault();
        applyComposeMention(editor, items[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeComposeMention();
      }
    }

    function onDoc(e) {
      if (editor.contains(e.target) || menu.contains(e.target)) return;
      closeComposeMention();
    }

    editor.addEventListener('keydown', onKey);
    setTimeout(function () { document.addEventListener('mousedown', onDoc, true); }, 0);

    mentionActive = {
      editor: editor,
      cleanup: function () {
        editor.removeEventListener('keydown', onKey);
        document.removeEventListener('mousedown', onDoc, true);
      },
    };
  }

  function requestComposeMention(editor) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
      closeComposeMention();
      return;
    }

    var node = selection.anchorNode;
    if (!node || node.nodeType !== 3) {
      closeComposeMention();
      return;
    }

    var before = node.textContent.slice(0, selection.anchorOffset);
    var match = composeMentionMatch(before);
    if (!match) {
      closeComposeMention();
      return;
    }

    var q = match[2] || '';
    var cacheKey = q.toLowerCase();
    var cached = cachedSuggestions(q);
    if (cached && cached.length) {
      openComposeMentionMenu(editor, cached);
      if (Object.prototype.hasOwnProperty.call(suggestCache, cacheKey)) return;
    }

    var seq = (editor._mentionSeq = (editor._mentionSeq || 0) + 1);
    api().suggest(q).then(function (data) {
      if (seq !== editor._mentionSeq) return;
      var items = (data && data.suggestions) || [];
      suggestCache[cacheKey] = items;
      if (!editor.isConnected || document.activeElement !== editor) return;
      // Re-check the caret still sits on an @ trigger.
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode) || sel.anchorNode.nodeType !== 3) {
        closeComposeMention();
        return;
      }
      var still = composeMentionMatch(sel.anchorNode.textContent.slice(0, sel.anchorOffset));
      if (!still || (still[2] || '') !== q) {
        closeComposeMention();
        return;
      }
      if (!items.length) { closeComposeMention(); return; }
      openComposeMentionMenu(editor, items);
    }).catch(function () {
      /* Mentions are best-effort. */
    });
  }

  function wireComposeMention(editor) {
    if (!editor || editor._mentionWired) return;
    editor._mentionWired = true;

    var timer = null;
    editor.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { requestComposeMention(editor); }, MENTION_DEBOUNCE_MS);
    });
    editor.addEventListener('keyup', function (e) {
      if (e.key === 'Escape') return;
      // Catch @ typed via shift combinations that may not always fire input
      // the same way across engines after composition.
      if (e.key === '@' || e.key === '2') {
        clearTimeout(timer);
        timer = setTimeout(function () { requestComposeMention(editor); }, MENTION_DEBOUNCE_MS);
      }
    });
    editor.addEventListener('blur', function () {
      setTimeout(function () {
        if (mentionActive && mentionActive.editor === editor) closeComposeMention();
      }, 150);
    });
    // Don't navigate mailto mentions while editing.
    editor.addEventListener('click', function (e) {
      var mention = e.target.closest && e.target.closest('a.tma-dash__email-mention');
      if (mention && editor.contains(mention)) e.preventDefault();
    });
  }

  function findComposeDraft(state, id) {
    return state.composeDrafts.filter(function (draft) { return draft.id === id; })[0] || null;
  }

  function openCompose(state, opts) {
    opts = opts || {};
    closeRecipientSuggest();
    closeInlineCompose(state);
    if (!opts.serverId && !opts.to && !opts.subject && !opts.bodyHtml && (!opts.mode || opts.mode === 'new')) {
      var existing = paneComposeDraft(state);
      if (existing && existing.mode === 'new' && !draftHasSubstance(existing)) {
        state.focusedComposeId = existing.id;
        enterComposeView(state);
        state._focusCompose = existing.id;
        prefetchRecipientSuggest();
        return existing;
      }
    }
    minimizeOpenComposeDrafts(state);
    var draft = createComposeDraft(state, opts);
    // Seed the body with the signature (or template) the window will paint.
    // Otherwise draft.bodyHtml stays '' until the user types, and Send goes
    // out blank even though the editor looked signed.
    if (!(opts && opts.bodyHtml)) {
      draft.bodyHtml = defaultComposeBody(draft);
    }
    state.composeDrafts.push(draft);
    state.focusedComposeId = draft.id;
    enterComposeView(state);
    state._focusCompose = draft.id;
    state._composeEnter = true;
    prefetchRecipientSuggest();
    // Outlook (and Gmail) get a Drafts-folder copy once the user has
    // addressed, titled, or written something beyond the signature — not
    // the moment an empty window opens.
    if (!opts.serverId && draftHasSubstance(draft)) {
      saveComposeDraft(state, draft).catch(function () {});
    }
    return draft;
  }

  function minimizeCompose(state, id) {
    state.composeDrafts.forEach(function (draft) {
      if (draft.id === id) draft.minimized = true;
    });
    afterComposeClosed(state);
  }

  function restoreCompose(state, id) {
    closeInlineCompose(state);
    state.composeDrafts.forEach(function (draft) {
      draft.minimized = draft.id !== id;
    });
    state.focusedComposeId = id;
    enterComposeView(state);
    state._focusCompose = id;
    state._composeEnter = true;
  }

  function closeCompose(state, id, persist) {
    var draft = findComposeDraft(state, id);
    if (persist !== false && draft && !draft.sending && !draft._sendRequested) {
      window.clearTimeout(draft._saveTimer);
      if (draft._dirty && (draft.serverId || draftHasSubstance(draft))) {
        saveComposeDraft(state, draft).catch(function () {});
      }
    }
    if (state.composePopout && id) clearComposePopoutSnapshot(id);
    state.composeDrafts = state.composeDrafts.filter(function (draft) {
      return draft.id !== id;
    });
    if (state.focusedComposeId === id) {
      var open = state.composeDrafts.filter(function (draft) { return !draft.minimized; });
      state.focusedComposeId = open.length ? open[open.length - 1].id : null;
    }
    afterComposeClosed(state);
  }

  var COMPOSE_POPOUT_STORE = 'tma.mail.compose-popout.';

  function composePopoutKey(id) {
    return COMPOSE_POPOUT_STORE + id;
  }

  function composePopoutUrl(draftId) {
    return (window.__TMA_SITE_ROOT || '') + '/email/compose?draft=' + encodeURIComponent(draftId);
  }

  function snapshotComposeDraft(draft) {
    return {
      id: draft.id,
      to: draft.to || '',
      cc: draft.cc || '',
      bcc: draft.bcc || '',
      subject: draft.subject || '',
      bodyHtml: draft.bodyHtml || '',
      showCc: !!draft.showCc,
      serverId: draft.serverId || null,
      mode: draft.mode || 'new',
      inReplyTo: draft.inReplyTo || null,
      attachments: (draft.attachments || []).map(function (item) {
        return {
          id: item.id,
          name: item.name,
          mime: item.mime,
          size: item.size,
          content: item.content,
        };
      }),
      signatureId: draft.signatureId || '',
      _typing: draft._typing || {},
    };
  }

  function storeComposePopoutSnapshot(snapshot) {
    window.sessionStorage.setItem(composePopoutKey(snapshot.id), JSON.stringify(snapshot));
  }

  function readComposePopoutSnapshot(id) {
    if (!id) return null;
    try {
      var raw = window.sessionStorage.getItem(composePopoutKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearComposePopoutSnapshot(id) {
    try { window.sessionStorage.removeItem(composePopoutKey(id)); } catch (e) { /* ignore */ }
  }

  function openComposePopoutWindow(root, snapshot) {
    try {
      storeComposePopoutSnapshot(snapshot);
    } catch (e) {
      showEmailToast(root, 'This draft is too large to open in a new window');
      return null;
    }
    var opened = window.open(
      composePopoutUrl(snapshot.id),
      'tma-compose-' + snapshot.id,
      'popup=yes,width=760,height=820,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!opened) {
      clearComposePopoutSnapshot(snapshot.id);
      showEmailToast(root, 'Allow pop-ups to open the composer in its own window');
      return null;
    }
    try { opened.focus(); } catch (e) { /* ignore */ }
    return opened;
  }

  function popOutCompose(root, state, render, draftId) {
    if (state.composePopout) return;
    var draft = findComposeDraft(state, draftId);
    if (!draft) return;
    var win = document.querySelector('[data-email-compose-window="' + draft.id + '"]');
    commitRecipientFields(win);
    syncComposeBodyFromEditor(draft);
    var opened = openComposePopoutWindow(root, snapshotComposeDraft(draft));
    if (!opened) return;
    dismissComposePane(root, state, render, function () {
      closeCompose(state, draft.id, false);
    });
  }

  function popOutInlineCompose(root, state, render) {
    if (state.composePopout) return;
    var ic = state.inlineCompose;
    if (!ic) return;
    var panel = root.querySelector('[data-email-inline-compose-panel]');
    commitRecipientFields(panel);
    var editor = panel && panel.querySelector('[data-email-inline-compose-editor]');
    var quote = panel && panel.querySelector('.tma-dash__email-inline-quote');
    var bodyHtml = (editor ? editor.innerHTML : ic.bodyHtml || '') + (quote ? quote.outerHTML : '');
    var row = threadMessage(state, ic.messageId) || findAnyRow(state, ic.messageId);
    var subject = '';
    if (row) {
      subject = ic.mode === 'forward' ? getForwardSubject(row.subject) : getReplySubject(row.subject);
    }
    var snapshot = {
      id: 'compose-' + state.nextComposeId++,
      to: ic.to || '',
      cc: ic.cc || '',
      bcc: '',
      subject: subject,
      bodyHtml: bodyHtml,
      showCc: !!ic.cc,
      serverId: null,
      mode: ic.mode || 'reply',
      inReplyTo: ic.mode === 'new' ? null : ic.messageId,
      attachments: (ic.attachments || []).map(function (item) {
        return {
          id: item.id,
          name: item.name,
          mime: item.mime,
          size: item.size,
          content: item.content,
        };
      }),
      signatureId: ic.signatureId || '',
      _typing: ic._typing || {},
    };
    var opened = openComposePopoutWindow(root, snapshot);
    if (!opened) return;
    dismissComposePane(root, state, render, function () {
      closeInlineCompose(state);
    });
  }

  function adoptComposePopoutDraft(state) {
    var draftId = '';
    try { draftId = new URLSearchParams(window.location.search).get('draft') || ''; } catch (e) {}
    var snapshot = readComposePopoutSnapshot(draftId);
    if (!snapshot) {
      openCompose(state, {});
      state._composeEnter = false;
      return;
    }
    var draft = createComposeDraft(state, {
      to: snapshot.to,
      cc: snapshot.cc,
      bcc: snapshot.bcc,
      subject: snapshot.subject,
      bodyHtml: snapshot.bodyHtml,
      showCc: snapshot.showCc,
      serverId: snapshot.serverId,
      mode: snapshot.mode,
      inReplyTo: snapshot.inReplyTo,
      attachments: snapshot.attachments,
      signatureId: snapshot.signatureId,
    });
    if (snapshot.id) draft.id = snapshot.id;
    draft._typing = snapshot._typing || {};
    state.composeDrafts.push(draft);
    state.focusedComposeId = draft.id;
    enterComposeView(state);
    state._focusCompose = draft.id;
    state._composeEnter = false;
    prefetchRecipientSuggest();
    if (draft.subject) {
      try { document.title = draft.subject; } catch (e) { /* ignore */ }
    }
  }

  function toggleComposeExpand(state, id) {
    state.composeDrafts.forEach(function (draft) {
      if (draft.id !== id) return;
      // Large is the resting size; the button steps up to almost-fullscreen
      // and back down again.
      draft.expanded = true;
      draft.fullscreen = !draft.fullscreen;
    });
    state.focusedComposeId = id;
  }

  function renderComposeWindowHead(draft, opts) {
    opts = opts || {};
    var title = getComposeSubject(draft) || 'New Email';
    var actions = '';
    if (!opts.popout) {
      actions +=
        '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-minimize="' + esc(draft.id) + '" aria-label="Minimize">' +
        '<img src="' + ICONS.Minus + '" alt=""></button>';
    }
    if (opts.pane && !opts.popout) {
      actions +=
        '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-popout="' + esc(draft.id) + '" aria-label="Open in new window">' +
        '<img src="' + ICONS.ArrowSquareOut + '" alt=""></button>';
    }
    if (!opts.pane) {
      var expandLabel = draft.fullscreen ? 'Exit full screen' : 'Full screen';
      actions +=
        '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-expand="' + esc(draft.id) + '" aria-label="' + esc(expandLabel) + '">' +
        '<img src="' + (draft.fullscreen ? ICONS.CornersIn : ICONS.ArrowsOutSimple) + '" alt=""></button>';
    }
    actions +=
      '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-close="' + esc(draft.id) + '" aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>';
    return (
      '<div class="tma-dash__email-compose-window-head">' +
      (opts.backHtml || '') +
      '<span class="tma-dash__email-compose-window-title">' + esc(title) + '</span>' +
      '<div class="tma-dash__email-compose-window-actions">' +
      actions +
      '</div></div>'
    );
  }

  /* Open drafts live in the reading pane now. Minimized ones stay in the dock. */
  function renderComposeWindows(state) {
    return '';
  }

  function renderComposeDock(state) {
    var minimized = state.composeDrafts.filter(function (draft) { return draft.minimized; });
    if (!minimized.length) return '';

    return (
      '<div class="tma-dash__email-compose-dock">' +
      minimized
        .map(function (draft) {
          return (
            '<button type="button" class="tma-dash__email-compose-tab" data-email-compose-restore="' + esc(draft.id) + '">' +
            '<span class="tma-dash__email-compose-tab-label">' + esc(getComposeSubject(draft)) + '</span>' +
            '<span class="tma-dash__email-compose-tab-close" data-email-compose-close="' + esc(draft.id) + '" role="presentation" aria-hidden="true">' +
            '<img src="' + ICONS.X + '" alt=""></span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── compose toolbar menus ───────────────────────────────────────
   * Text style, text colour and highlight open a small popup built here
   * rather than in the main render, so opening one does not re-render the
   * compose window and throw away the selection the command is about to
   * be applied to.
   */

  var composeMenuEl = null;
  var composeMenuBtn = null;

  function closeComposeMenu() {
    if (composeMenuBtn) {
      composeMenuBtn.setAttribute('aria-expanded', 'false');
      composeMenuBtn = null;
    }
    if (!composeMenuEl) return;
    composeMenuEl.remove();
    composeMenuEl = null;
  }

  function composeMenuItems(kind) {
    if (kind === 'style') {
      return COMPOSE_FONT_SIZES.map(function (size) {
        return { label: size.label, cmd: 'fontSize', value: size.value };
      });
    }

    if (kind === 'color') {
      return COMPOSE_COLORS.map(function (color) {
        return {
          label: color.label,
          cmd: 'foreColor',
          value: color.value,
          swatch: color.value,
          swatchOnly: true,
        };
      });
    }

    if (kind === 'highlight') {
      return COMPOSE_HIGHLIGHTS.map(function (color) {
        // hiliteColor is the standards name; backColor is what older engines
        // answer to. Both are attempted when the command runs.
        return {
          label: color.label,
          cmd: 'hiliteColor',
          value: color.value,
          swatch: color.value,
          swatchOnly: true,
          none: color.value === 'transparent',
        };
      });
    }

    return [];
  }

  function renderComposeMenuItem(item) {
    if (item.separator) {
      return '<div class="tma-dash__email-compose-menu-sep">' + esc(item.label) + '</div>';
    }

    var cls = 'tma-dash__email-compose-menu-item';
    if (item.swatchOnly) cls += ' tma-dash__email-compose-menu-item--swatch';

    var swatchCls = 'tma-dash__email-compose-menu-swatch';
    if (item.none) swatchCls += ' tma-dash__email-compose-menu-swatch--none';

    return (
      '<button type="button" class="' + cls + '" role="menuitem"' +
      ' data-email-compose-menu-cmd="' + esc(item.cmd) + '"' +
      (item.value ? ' data-email-compose-menu-value="' + esc(item.value) + '"' : '') +
      ' aria-label="' + esc(item.label) + '" title="' + esc(item.label) + '">' +
      (item.swatch
        ? '<span class="' + swatchCls + '"' +
          (item.none ? '' : ' style="background:' + esc(item.swatch) + '"') + '></span>'
        : '') +
      (item.icon
        ? '<img class="tma-dash__email-compose-menu-icon" src="' + esc(ICON + item.icon + '.svg') + '" alt="">'
        : '') +
      (item.swatchOnly ? '' : esc(item.label)) +
      '</button>'
    );
  }

  function positionComposeMenu(menu, button) {
    var rect = button.getBoundingClientRect();
    var gap = 4;
    var pad = 8;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var spaceBelow = vh - rect.bottom - pad;
    var spaceAbove = rect.top - pad;
    var openUp = mh > spaceBelow && spaceAbove > spaceBelow;

    var top = openUp ? Math.max(pad, rect.top - gap - mh) : rect.bottom + gap;
    var maxH = openUp ? (rect.top - gap - pad) : (vh - top - pad);
    if (mh > maxH) {
      menu.style.maxHeight = Math.max(96, maxH) + 'px';
      menu.style.overflowY = 'auto';
      mh = menu.offsetHeight;
      if (openUp) top = Math.max(pad, rect.top - gap - mh);
    }

    var left = rect.left;
    if (left + mw > vw - pad) left = vw - mw - pad;
    if (left < pad) left = pad;

    menu.style.position = 'fixed';
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }

  function openComposeMenu(button, kind) {
    closeComposeMenu();

    var items = composeMenuItems(kind);
    if (!items.length) return;

    var palette = kind === 'color' || kind === 'highlight';
    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-compose-menu' + (palette ? ' tma-dash__email-compose-menu--palette' : '');
    menu.setAttribute('role', 'menu');
    if (palette) {
      menu.innerHTML =
        '<div class="tma-dash__email-compose-menu-sep">' +
        esc(kind === 'color' ? 'Text colour' : 'Highlight') +
        '</div>' +
        '<div class="tma-dash__email-compose-menu-swatches">' +
        items.map(renderComposeMenuItem).join('') +
        '</div>';
    } else {
      menu.innerHTML = items.map(renderComposeMenuItem).join('');
    }

    document.body.appendChild(menu);
    composeMenuEl = menu;
    composeMenuBtn = button;
    button.setAttribute('aria-expanded', 'true');
    positionComposeMenu(menu, button);
  }

  /* Runs a formatting command against the editor that owns the selection.
   *
   * execCommand is deprecated but remains the only thing every browser
   * implements for contenteditable rich text, and it is what the rest of this
   * toolbar already uses. */
  function applyComposeCommand(cmd, value) {
    if (cmd === 'createLink') {
      var url = window.prompt('Link URL');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }

    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* optional */ }

    if (cmd === 'hiliteColor') {
      // Not universally supported under that name; fall back to backColor.
      if (!document.execCommand('hiliteColor', false, value)) {
        document.execCommand('backColor', false, value);
      }
      return;
    }

    if (cmd === 'foreColor') {
      document.execCommand('foreColor', false, value);
      return;
    }

    document.execCommand(cmd, false, value === undefined ? null : value);
  }

  function cssColorOrEmpty(value, ignorePaper) {
    if (!value) return '';
    var v = String(value).replace(/\s+/g, '').toLowerCase();
    if (!v || v === 'transparent' || v === 'rgba(0,0,0,0)' || v === 'inherit') return '';
    if (ignorePaper && (v === '#fff' || v === '#ffffff' || v === 'white' ||
        v === 'rgb(255,255,255)' || v === 'rgba(255,255,255,1)')) return '';
    return value;
  }

  /* Reflects the formatting at the cursor back onto the toolbar, so Bold looks
   * pressed while the caret sits in bold text. */
  function syncComposeToolbarState(root) {
    root.querySelectorAll('[data-email-compose-tool-state]').forEach(function (btn) {
      var cmd = btn.getAttribute('data-email-compose-tool-state');
      var on = false;

      try {
        on = document.queryCommandState(cmd);
      } catch (e) { /* an engine that will not answer simply shows unpressed */ }

      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('tma-dash__email-compose-tool--active', on);
    });

    root.querySelectorAll('[data-email-compose-tool-menu="color"] .tma-dash__email-compose-tool-mark').forEach(function (mark) {
      var value = '';
      try { value = document.queryCommandValue('foreColor'); } catch (e) { /* leave the default bar */ }
      mark.style.background = cssColorOrEmpty(value) || '';
    });

    root.querySelectorAll('[data-email-compose-tool-menu="highlight"] .tma-dash__email-compose-tool-mark').forEach(function (mark) {
      var value = '';
      try { value = document.queryCommandValue('backColor') || document.queryCommandValue('hiliteColor'); } catch (e) { /* leave the default bar */ }
      mark.style.background = cssColorOrEmpty(value, true) || '';
    });
  }

  /* Menu items live on document.body, so their handler must too — and it must
   * be bound exactly once for the whole document: the mailbox and any other
   * surface hosting this toolbar (system-email Templates) share the one open
   * menu, and a second handler would run every command twice. */
  var composeMenuDocBound = false;
  function ensureComposeMenuDocHandler() {
    if (composeMenuDocBound) return;
    composeMenuDocBound = true;

    document.addEventListener('mousedown', function (event) {
      var item = event.target.closest('[data-email-compose-menu-cmd]');
      if (item) {
        event.preventDefault();
        applyComposeCommand(
          item.getAttribute('data-email-compose-menu-cmd'),
          item.getAttribute('data-email-compose-menu-value') || undefined
        );
        var host = composeMenuEl && composeMenuEl._host;
        closeComposeMenu();
        if (host) syncComposeToolbarState(host);
        return;
      }

      // A click anywhere else dismisses an open menu.
      if (composeMenuEl && !event.target.closest('.tma-dash__email-compose-menu') &&
          !event.target.closest('[data-email-compose-tool-menu]')) {
        closeComposeMenu();
      }
    });

    window.addEventListener('resize', closeComposeMenu);
    window.addEventListener('scroll', function (event) {
      if (composeMenuEl && composeMenuEl.contains(event.target)) return;
      closeComposeMenu();
    }, true);
  }

  /*
   * The compose toolbar as a shared component: another surface renders
   * toolbarHtml() above a contenteditable marked data-tma-rich-editor and
   * calls wire() on their common container — commands, menus and pressed
   * states then behave exactly as they do in compose.
   */
  function wireRichEditorHost(container) {
    if (!container || container._tmaRichBound) return;
    container._tmaRichBound = true;

    // mousedown, not click: execCommand needs the selection that is still
    // live in the editor the instant before the button would steal focus.
    container.addEventListener('mousedown', function (event) {
      var menuBtn = event.target.closest('[data-email-compose-tool-menu]');
      if (menuBtn) {
        event.preventDefault();
        var kind = menuBtn.getAttribute('data-email-compose-tool-menu');
        if (composeMenuEl && composeMenuEl._kind === kind) {
          closeComposeMenu();
          return;
        }
        openComposeMenu(menuBtn, kind);
        if (composeMenuEl) { composeMenuEl._kind = kind; composeMenuEl._host = container; }
        return;
      }

      var toolBtn = event.target.closest('[data-email-compose-tool-cmd]');
      if (!toolBtn) return;
      event.preventDefault();
      closeComposeMenu();
      applyComposeCommand(toolBtn.getAttribute('data-email-compose-tool-cmd'));
      syncComposeToolbarState(container);
    });

    ensureComposeMenuDocHandler();

    document.addEventListener('selectionchange', function () {
      if (!container.isConnected || !container.querySelector('[data-tma-rich-editor]')) return;
      syncComposeToolbarState(container);
    });

    container.addEventListener('keyup', function (event) {
      if (event.target.closest('[data-tma-rich-editor]')) syncComposeToolbarState(container);
    });
  }

  window.TMAComposeEditor = {
    toolbarHtml: function (opts) {
      return renderComposeToolbar(opts || { expand: false, image: false, full: true });
    },
    wire: wireRichEditorHost,
  };

  function wireComposeEvents(root, state, render) {
    MORPH.unwired(root, '[data-email-compose-window]').forEach(function (windowEl) {
      windowEl.addEventListener('mousedown', function () {
        var id = windowEl.getAttribute('data-email-compose-window');
        if (state.focusedComposeId !== id) {
          state.focusedComposeId = id;
          render();
        }
      });
      wireComposeDropTarget(windowEl, function (files) {
        var draft = findComposeDraft(state, windowEl.getAttribute('data-email-compose-window'));
        if (!draft) return;
        addComposeFiles(root, draft, files, function () {
          paintComposeFileChips(windowEl, draft);
          scheduleDraftSave(state, draft);
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-minimize]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-compose-minimize');
        dismissComposePane(root, state, render, function () {
          minimizeCompose(state, id);
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-popout]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-compose-popout');
        if (id === 'inline') popOutInlineCompose(root, state, render);
        else popOutCompose(root, state, render, id);
      });
    });

    MORPH.unwired(root, '[data-email-compose-expand]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleComposeExpand(state, btn.getAttribute('data-email-compose-expand'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-close]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-compose-close');
        dismissComposePane(root, state, render, function () {
          closeCompose(state, id);
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-restore]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        if (event.target.closest('[data-email-compose-close]')) return;
        restoreCompose(state, btn.getAttribute('data-email-compose-restore'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-discard]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-email-compose-discard');
        var draft = findComposeDraft(state, id);

        // Drop the server-side copy too, or the message reappears in Drafts.
        if (draft && draft.serverId) {
          api().deleteDraft(draft.serverId).catch(function () {});
        }

        dismissComposePane(root, state, render, function () {
          closeCompose(state, id, false);
        });
      });
    });

    /* Field edits write straight to the draft. No re-render on input —
     * repainting the window would move the caret out from under the user. */
    MORPH.unwired(root, '[data-email-compose-field]').forEach(function (input) {
      var field = input.getAttribute('data-email-compose-field');
      // To / Cc / Bcc are pill fields with the recipient typeahead; subject is plain.
      if (field === 'to' || field === 'cc' || field === 'bcc') {
        wireRecipientField(input, function (value, typing) {
          var draft = findComposeDraft(state, input.getAttribute('data-email-compose-id'));
          if (!draft) return;
          draft[field] = value;
          draft._typing = draft._typing || {};
          draft._typing[field] = typing;
          scheduleDraftSave(state, draft);
        });
        wireRecipientSuggest(input);
        return;
      }
      input.addEventListener('input', function () {
        var draft = findComposeDraft(state, input.getAttribute('data-email-compose-id'));
        if (!draft) return;
        draft[field] = input.value;
        scheduleDraftSave(state, draft);
      });
    });

    MORPH.unwired(root, '[data-email-compose-body]').forEach(function (body) {
      prepareEditableImages(body);
      wireComposeMention(body);
      body.addEventListener('input', function () {
        var draft = findComposeDraft(state, body.getAttribute('data-email-compose-body'));
        if (!draft) return;
        draft.bodyHtml = body.innerHTML;
        scheduleDraftSave(state, draft);
      });
      body.addEventListener('paste', function (event) {
        var files = clipboardFileList(event);
        if (!files) return;
        event.preventDefault();
        attachFilesToComposeEditor(root, state, body, files);
      });
    });

    // Compose footer/toolbar Insert image, also wired from settings path, but
    // compose windows need it even when settings is closed.
    MORPH.unwired(root, '[data-email-insert-image]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (event) {
        event.preventDefault();
      });
      btn.addEventListener('click', function () {
        var editor = resolveImageEditor(btn, root);
        if (!editor) return;
        openInsertImagePicker(root, state, editor);
      });
    });

    MORPH.unwired(root, '[data-email-compose-attach]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-compose-attach');
        var draft = findComposeDraft(state, id);
        if (!draft) return;
        openComposeFilePicker(function (files) {
          addComposeFiles(root, draft, files, function () {
            paintComposeFileChips(btn.closest('[data-email-compose-window]'), draft);
            scheduleDraftSave(state, draft);
          });
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-files]').forEach(function (host) {
      MORPH.on(host, 'click', function (event) {
        var btn = event.target.closest('[data-email-compose-file-remove]');
        if (!btn) return;
        event.preventDefault();
        var win = host.closest('[data-email-compose-window]');
        var panel = host.closest('[data-email-inline-compose-panel]');
        var holder = win
          ? findComposeDraft(state, win.getAttribute('data-email-compose-window'))
          : state.inlineCompose;
        if (!holder) return;
        var id = btn.getAttribute('data-email-compose-file-remove');
        holder.attachments = composeFilesOf(holder).filter(function (item) { return item.id !== id; });
        paintComposeFileChips(win || panel, holder);
        if (win) scheduleDraftSave(state, holder);
      });
    });

    MORPH.unwired(root, '[data-email-compose-cc]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var draft = findComposeDraft(state, btn.getAttribute('data-email-compose-cc'));
        if (!draft) return;
        draft.showCc = !draft.showCc;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-save]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var draft = findComposeDraft(state, btn.getAttribute('data-email-compose-save'));
        if (!draft) return;
        saveComposeDraft(state, draft).then(function () {
          showEmailToast(root, 'Draft saved');
        }).catch(function (err) {
          reportMailError(state, err);
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-send]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        sendCompose(root, state, render, btn.getAttribute('data-email-compose-send'));
      });
    });
  }

  /* Autosave, debounced so a burst of typing is one write. The first save
   * waits until the draft has real content so Outlook is not filled with
   * signature-only husks. */
  function scheduleDraftSave(state, draft) {
    if (draft.sending || draft._sendRequested) return;
    draft._dirty = true;
    window.clearTimeout(draft._saveTimer);
    draft._saveTimer = window.setTimeout(function () {
      if (draft.sending || draft._sendRequested) return;
      if (!draft.serverId && !draftHasSubstance(draft)) return;
      saveComposeDraft(state, draft).catch(function () {
        // Autosave is best-effort; Send is what the user is judged on, and
        // it sends the live field values rather than the saved copy.
      });
    }, 800);
  }

  function htmlToPlainForDraft(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var sigs = tmp.querySelectorAll('[data-email-signature], .gmail_signature, #Signature');
    for (var i = 0; i < sigs.length; i++) sigs[i].remove();
    return String(tmp.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function draftHasSubstance(draft) {
    if (!draft) return false;
    if (composeFilesOf(draft).length) return true;
    if (parseAddresses(draft.to).length || parseAddresses(draft.cc).length || parseAddresses(draft.bcc).length) {
      return true;
    }
    if (String(draft.subject || '').trim()) return true;
    var text = htmlToPlainForDraft(draft.bodyHtml || '');
    if (!text) return false;
    var sigText = htmlToPlainForDraft(composeSignatureHtml());
    if (sigText && (text === sigText || text.indexOf(sigText) !== -1 || (text.length >= 20 && sigText.indexOf(text) !== -1))) {
      return false;
    }
    var lower = text.toLowerCase();
    if (/\bthis electronic mail\b/.test(lower) || /\bget outlook for\b/.test(lower)) {
      return false;
    }
    return true;
  }

  /* Pull the compose body's HTML from the live editor when it is on screen.
   * Prefer the DOM over draft.bodyHtml so an untouched signature (or any
   * edits that have not yet fired an input handler) still leave with the
   * message. */
  function syncComposeBodyFromEditor(draft) {
    if (!draft) return;
    var win = document.querySelector('[data-email-compose-window="' + draft.id + '"]');
    var editor = win && win.querySelector('[data-email-compose-body]');
    if (editor) draft.bodyHtml = editor.innerHTML;
  }

  function saveComposeDraft(state, draft) {
    if (draft.sending || draft._sendRequested) {
      return draft._savePromise || Promise.resolve();
    }
    var win = document.querySelector('[data-email-compose-window="' + draft.id + '"]');
    commitRecipientFields(win);
    syncComposeBodyFromEditor(draft);

    var exec = function () {
      if (draft.sending || draft._sendRequested) return Promise.resolve();
      return api().saveDraft({
        id: draft.serverId,
        to: parseAddresses(draft.to),
        cc: parseAddresses(draft.cc),
        bcc: parseAddresses(draft.bcc),
        subject: draft.subject || '',
        bodyHtml: draft.bodyHtml,
        mode: draft.mode,
        inReplyTo: draft.inReplyTo,
        attachments: composeFilePayload(draft),
      }).then(function (data) {
        // Send is in flight: keep the id we already posted, do not resurrect
        // a Graph/Gmail draft the send just consumed.
        if (draft.sending) return data;
        if (data && data.draft) draft.serverId = data.draft.id;
        draft._dirty = false;
        return data;
      });
    };

    draft._savePromise = (draft._savePromise || Promise.resolve())
      .catch(function () {})
      .then(exec);

    return draft._savePromise;
  }

  function undoSendWindowSeconds(state) {
    var prefs = (state && state.preferences) || {};
    var n = prefs.undoSendSeconds;
    if (n == null && state && state.settings && state.settings.preferences) {
      n = state.settings.preferences.undoSendSeconds;
    }
    if (n == null || n === '') n = 5;
    n = parseInt(n, 10);
    if (!isFinite(n) || n < 0) n = 5;
    if (n > 30) n = 30;
    return n;
  }

  var undoSendJob = null;

  function stopUndoSendCountdown() {
    if (!undoSendJob || !undoSendJob.interval) return;
    window.clearInterval(undoSendJob.interval);
    undoSendJob.interval = null;
  }

  function clearUndoSendJob() {
    stopUndoSendCountdown();
    showEmailToast._persist = false;
    showEmailToast._onUndo = null;
    undoSendJob = null;
  }

  function restoreUndoSendJob(state, render, job) {
    if (!job) return;
    if (job.kind === 'compose' && job.draft) {
      job.draft.sending = false;
      job.draft._sendRequested = false;
      job.draft.minimized = false;
      if (!findComposeDraft(state, job.draft.id)) {
        state.composeDrafts.push(job.draft);
      }
      state.composeDrafts.forEach(function (d) {
        d.minimized = d.id !== job.draft.id;
      });
      state.focusedComposeId = job.draft.id;
      enterComposeView(state);
      cancelComposePaneDismiss(state);
      state._composeEnter = !state.composePopout;
    } else if (job.kind === 'inline' && job.inline) {
      job.inline.sending = false;
      job.inline._sendRequested = false;
      state.inlineCompose = job.inline;
      enterComposeView(state);
      cancelComposePaneDismiss(state);
      state._composeEnter = !state.composePopout;
    }
    if (render) render();
  }

  function dispatchUndoSend(root, state, render, job) {
    if (!job || !job.payload) return Promise.resolve();
    if (job.kind === 'compose' && job.draft) {
      job.draft.sending = true;
      job.draft._sendRequested = true;
    } else if (job.inline) {
      job.inline.sending = true;
      job.inline._sendRequested = true;
    }

    return api().send(job.payload).then(function () {
      if (job.kind === 'compose' && job.draft && findComposeDraft(state, job.draft.id)) {
        closeCompose(state, job.draft.id, false);
        if (render) render();
      } else if (job.kind === 'inline' && state.inlineCompose === job.inline) {
        closeInlineCompose(state);
        if (render) render();
      }
      showEmailToast(root, 'Message sent');
      reloadMessages(root, state, render);
      if (state.composePopout) {
        window.setTimeout(function () {
          maybeCloseComposePopoutWindow(state);
        }, 700);
      }
    }).catch(function (err) {
      if (job.kind === 'compose' && job.draft) {
        job.draft.sending = false;
        job.draft._sendRequested = false;
      } else if (job.inline) {
        job.inline.sending = false;
        job.inline._sendRequested = false;
      }
      restoreUndoSendJob(state, render, job);
      reportMailError(state, err);
    });
  }

  function flushUndoSendNow(root, state, render) {
    var job = undoSendJob;
    if (!job) return;
    clearUndoSendJob();
    dispatchUndoSend(root, state, render, job);
  }

  function startUndoSend(root, state, render, job) {
    if (undoSendJob) flushUndoSendNow(root, state, render);
    undoSendJob = job;
    var remaining = job.seconds;
    showUndoSendToast(root, remaining, function () {
      if (undoSendJob !== job) return;
      clearUndoSendJob();
      hideEmailToast();
      restoreUndoSendJob(state, render, job);
    });
    job.interval = window.setInterval(function () {
      if (undoSendJob !== job) return;
      remaining -= 1;
      if (remaining <= 0) {
        clearUndoSendJob();
        dispatchUndoSend(root, state, render, job);
        return;
      }
      var toast = getEmailToastEl();
      var text = toast && toast.querySelector('[data-email-toast-text]');
      if (text) text.textContent = 'Sending in ' + remaining + '\u2026';
    }, 1000);
  }

  function sendCompose(root, state, render, id) {
    var draft = findComposeDraft(state, id);
    if (!draft || draft.sending || draft._sendRequested) return;

    var win = document.querySelector('[data-email-compose-window="' + id + '"]');
    commitRecipientFields(win);
    syncComposeBodyFromEditor(draft);
    var to = parseAddresses(draft.to);
    if (!to.length) {
      showEmailToast(root, 'Add at least one recipient');
      return;
    }

    window.clearTimeout(draft._saveTimer);
    // Block new autosaves immediately, but let the in-flight one finish so
    // Send and PATCH are not racing the same Outlook/Gmail draft.
    draft._sendRequested = true;

    var beginSend = function () {
      if (draft.sending) return;
      var payload = {
        to: to,
        cc: parseAddresses(draft.cc),
        bcc: parseAddresses(draft.bcc),
        subject: draft.subject || '',
        bodyHtml: draft.bodyHtml || '',
        draftId: draft.serverId,
        mode: draft.mode || 'new',
        inReplyTo: draft.inReplyTo,
        attachments: composeFilePayload(draft),
      };
      var seconds = undoSendWindowSeconds(state);
      if (seconds <= 0) {
        if (!findComposeDraft(state, id)) return;
        draft.sending = true;
        render();
        dispatchUndoSend(root, state, render, {
          kind: 'compose',
          draft: draft,
          payload: payload,
        });
        return;
      }

      // Hide the window so it feels sent. Keep the draft object (and its
      // Outlook/Gmail serverId) parked for undo or the real send.
      draft._sendRequested = false;
      startUndoSend(root, state, render, {
        kind: 'compose',
        draft: draft,
        seconds: seconds,
        payload: payload,
      });
      dismissComposePane(root, state, render, function () {
        closeCompose(state, id, false);
      });
    };

    var pending = draft._savePromise;
    if (pending) pending.catch(function () {}).then(beginSend);
    else beginSend();
  }

  /* Font sizes the "Text style" menu offers, as execCommand's 1–7 scale. */
  var COMPOSE_FONT_SIZES = [
    { label: 'Small', value: '2' },
    { label: 'Normal', value: '3' },
    { label: 'Large', value: '5' },
    { label: 'Huge', value: '6' },
  ];

  /* Text and highlight colours. Deliberately a short, legible set rather than
   * a full picker, this is a mail composer, not a design tool. */
  var COMPOSE_COLORS = [
    { label: 'Default', value: '#1c1c1c' },
    { label: 'Grey', value: '#667085' },
    { label: 'Red', value: '#b42318' },
    { label: 'Orange', value: '#b54708' },
    { label: 'Green', value: '#027a48' },
    { label: 'Blue', value: '#175cd3' },
    { label: 'Purple', value: '#6941c6' },
  ];

  var COMPOSE_HIGHLIGHTS = [
    { label: 'None', value: 'transparent' },
    { label: 'Yellow', value: '#fef7c3' },
    { label: 'Green', value: '#d3f8df' },
    { label: 'Blue', value: '#d1e9ff' },
    { label: 'Pink', value: '#fce7f6' },
    { label: 'Orange', value: '#ffead5' },
    { label: 'Grey', value: '#e5e7eb' },
  ];

  /* opts.expand: compose windows get the expand control; the signature editor
   * and inline reply/forward do not, there is nowhere for them to expand into.
   * opts.attach: paperclip (compose draft id, or true for inline reply).
   * opts.insertImage: signature logo insert + transform dialog.
   *
   * New mail, reply, reply-all, forward and the template editors all share
   * this bar. Alignment, colour and highlight sit on it; a narrow host wraps
   * onto a second row instead of hiding tools behind More. */
  function renderComposeToolbar(opts) {
    opts = opts || {};
    var showExpand = !!opts.expand;
    var extra = [];
    if (opts.insertImage) {
      extra.push({ icon: 'Image', label: 'Insert image', image: true });
    } else if (opts.attach != null && opts.attach !== false) {
      extra.push({ icon: 'Paperclip', label: 'Attach file', attach: opts.attach });
    }

    var groups = [
      [
        { icon: 'ArrowUUpLeft', label: 'Undo', cmd: 'undo' },
        { icon: 'ArrowUUpRight', label: 'Redo', cmd: 'redo' },
      ],
      [
        { icon: 'TextT', label: 'Text style', caret: true, menu: 'style' },
      ],
      [
        { icon: 'TextB', label: 'Bold', cmd: 'bold', state: 'bold' },
        { icon: 'TextItalic', label: 'Italic', cmd: 'italic', state: 'italic' },
        { icon: 'TextUnderline', label: 'Underline', cmd: 'underline', state: 'underline' },
        { icon: 'TextStrikethrough', label: 'Strikethrough', cmd: 'strikeThrough', state: 'strikeThrough' },
      ],
      [
        { icon: 'TextAa', label: 'Text colour', menu: 'color', mark: 'color' },
        { icon: 'HighlighterCircle', label: 'Highlight', menu: 'highlight', mark: 'highlight' },
      ],
      [
        { icon: 'TextAlignLeft', label: 'Align left', cmd: 'justifyLeft', state: 'justifyLeft' },
        { icon: 'TextAlignCenter', label: 'Align centre', cmd: 'justifyCenter', state: 'justifyCenter' },
        { icon: 'TextAlignRight', label: 'Align right', cmd: 'justifyRight', state: 'justifyRight' },
      ],
      [
        { icon: 'ListBullets', label: 'Bulleted list', cmd: 'insertUnorderedList', state: 'insertUnorderedList' },
        { icon: 'ListNumbers', label: 'Numbered list', cmd: 'insertOrderedList', state: 'insertOrderedList' },
        { icon: 'TextIndent', label: 'Increase indent', cmd: 'indent' },
        { icon: 'TextOutdent', label: 'Decrease indent', cmd: 'outdent' },
      ],
      [
        { icon: 'Link', label: 'Insert link', cmd: 'createLink' },
        { icon: 'LinkBreak', label: 'Remove link', cmd: 'unlink' },
        { icon: 'Eraser', label: 'Clear formatting', cmd: 'removeFormat' },
      ].concat(extra),
    ];

    return (
      '<div class="tma-dash__email-compose-toolbar">' +
      '<div class="tma-dash__email-compose-toolbar-left">' +
      groups
        .map(function (group, index) {
          var html =
            '<div class="tma-dash__email-compose-toolbar-group">' +
            group
              .map(function (item) {
                var cls = 'tma-dash__email-compose-tool';
                if (item.caret) cls += ' tma-dash__email-compose-tool--caret';
                if (item.mark) cls += ' tma-dash__email-compose-tool--mark tma-dash__email-compose-tool--' + item.mark;
                return (
                  '<button type="button" class="' + cls + '"' +
                  (item.cmd ? ' data-email-compose-tool-cmd="' + esc(item.cmd) + '"' : '') +
                  (item.menu ? ' data-email-compose-tool-menu="' + esc(item.menu) + '" aria-haspopup="menu" aria-expanded="false"' : '') +
                  (item.image ? ' data-email-insert-image' : '') +
                  (item.attach === true ? ' data-email-inline-compose-attach' : '') +
                  (item.attach && item.attach !== true ? ' data-email-compose-attach="' + esc(item.attach) + '"' : '') +
                  // Marks the buttons whose pressed state tracks the cursor,
                  // so the toolbar shows what the text under it actually is.
                  (item.state ? ' data-email-compose-tool-state="' + esc(item.state) + '" aria-pressed="false"' : '') +
                  ' aria-label="' + esc(item.label) + '" title="' + esc(item.label) + '">' +
                  '<img src="' + esc(ICONS[item.icon]) + '" alt="">' +
                  (item.mark ? '<span class="tma-dash__email-compose-tool-mark" aria-hidden="true"></span>' : '') +
                  (item.caret ? '<img class="tma-dash__email-compose-tool-caret" src="' + ICONS.CaretDown + '" alt="">' : '') +
                  '</button>'
                );
              })
              .join('') +
            '</div>';
          if (index < groups.length - 1) {
            html += '<span class="tma-dash__email-compose-toolbar-sep" aria-hidden="true"></span>';
          }
          return html;
        })
        .join('') +
      '</div>' +
      (showExpand
        ? '<button type="button" class="tma-dash__email-compose-tool tma-dash__email-compose-tool--expand" aria-label="Expand editor" title="Expand editor">' +
          '<img src="' + ICONS.ArrowsOutSimple + '" alt="">' +
          '</button>'
        : '') +
      '</div>'
    );
  }

  /* The body a compose window opens with.
   *
   * Only a template the user actually picked, plus their configured signature.
   * This used to fall through to rendering the 'invoice' template into *every*
   * new message, a blank compose window arrived carrying a full invoice for a
   * client nobody had selected, which the user then had to delete by hand. */
  function defaultComposeBody(draft) {
    return composeSignatureHtml();
  }

  /* The user's configured signature, kept in its own block so it stays
   * identifiable rather than merging into whatever they type above it. */
  function signatureLibraryFromState() {
    var prefs = {};
    if (state_active) {
      if (state_active.settings && state_active.settings.preferences) {
        prefs = state_active.settings.preferences;
      } else if (state_active.preferences) {
        prefs = state_active.preferences;
      }
    }
    return ensureSignatureLibrary(prefs);
  }

  function composeSignatureHtmlFor(html) {
    if (!html) return '';
    return (
      '<div class="tma-dash__email-compose-signature" data-email-signature>' +
      '<br>' + html +
      '</div>'
    );
  }

  function composeSignatureHtml() {
    var lib = signatureLibraryFromState();
    var active = lib.signatures.find(function (entry) { return entry.id === lib.activeSignatureId; })
      || lib.signatures[0];
    return composeSignatureHtmlFor(active && active.html);
  }

  /* Two empty blocks so the caret sits above the signature in the HTML
   * that actually goes out. Extra visual room in the reply box is CSS. */
  function composeTypingRoomHtml() {
    return '<div><br></div><div><br></div>';
  }

  function inlineComposeBodyHtml() {
    return composeTypingRoomHtml() + composeSignatureHtml();
  }

  function renderComposeSignaturePicker(draft) {
    var lib = signatureLibraryFromState();
    if (!lib.signatures.length) return '';
    var selected = draft.signatureId || lib.activeSignatureId || '';
    if (selected && !lib.signatures.some(function (entry) { return entry.id === selected; })) {
      selected = lib.activeSignatureId || lib.signatures[0].id;
    }

    return (
      '<label class="tma-dash__email-compose-sig-pick">' +
      '<span class="tma-dash__email-compose-sig-pick-label">Signature</span>' +
      '<select class="tma-dash__email-compose-sig-pick-select" data-email-compose-signature="' + esc(draft.id) + '"' +
      ' aria-label="Choose signature">' +
      '<option value=""' + (selected ? '' : ' selected') + '>None</option>' +
      lib.signatures.map(function (entry) {
        var on = entry.id === selected;
        return '<option value="' + esc(entry.id) + '"' + (on ? ' selected' : '') + '>' +
          esc(entry.name || 'Signature') + '</option>';
      }).join('') +
      '</select></label>'
    );
  }

  function applyComposeSignature(draft, signatureId, editor) {
    var lib = signatureLibraryFromState();
    draft.signatureId = signatureId || '';
    var entry = lib.signatures.find(function (item) { return item.id === signatureId; });
    var next = composeSignatureHtmlFor(entry && entry.html);

    function swap(rootEl) {
      var block = rootEl.querySelector('[data-email-signature]');
      if (block && next) {
        block.outerHTML = next;
      } else if (block && !next) {
        block.remove();
      } else if (!block && next) {
        rootEl.insertAdjacentHTML('beforeend', next);
      }
    }

    if (editor) {
      swap(editor);
      draft.bodyHtml = editor.innerHTML;
      return;
    }

    var tmp = document.createElement('div');
    tmp.innerHTML = draft.bodyHtml || '';
    swap(tmp);
    draft.bodyHtml = tmp.innerHTML;
  }

  /* A real form: recipient pill fields, and subject / body inputs bound to
   * the draft. */
  function renderComposeContent(draft) {
    var bodyHtml = draft.bodyHtml || defaultComposeBody(draft);
    var typing = draft._typing || {};

    function addressRow(field, label) {
      return (
        '<div class="tma-dash__email-compose-to">' +
        '<span class="tma-dash__email-compose-label">' + esc(label) + '</span>' +
        renderRecipientField({
          value: draft[field],
          input: '<input type="text" class="tma-dash__email-compose-input"' +
            ' data-email-compose-field="' + esc(field) + '" data-email-compose-id="' + esc(draft.id) + '"' +
            ' value="' + esc(typing[field] || '') + '"' +
            ' autocomplete="off" spellcheck="false"' +
            ' aria-label="' + esc(label) + '" placeholder="name@example.com">',
        }) +
        (field === 'to'
          ? '<button type="button" class="tma-dash__email-compose-expand"' +
            ' data-email-compose-cc="' + esc(draft.id) + '"' +
            ' aria-expanded="' + (draft.showCc ? 'true' : 'false') + '"' +
            ' aria-label="Show Cc and Bcc">' +
            '<img src="' + ICONS.ArrowLineUpDown + '" alt="">' +
            '</button>'
          : '') +
        '</div>'
      );
    }

    return (
      '<div class="tma-dash__email-compose">' +
      '<div class="tma-dash__email-compose-headers">' +
      addressRow('to', 'To') +
      (draft.showCc ? addressRow('cc', 'Cc') + addressRow('bcc', 'Bcc') : '') +
      '<div class="tma-dash__email-compose-subject">' +
      '<span class="tma-dash__email-compose-label">Subject</span>' +
      '<input type="text" class="tma-dash__email-compose-input"' +
      ' data-email-compose-field="subject" data-email-compose-id="' + esc(draft.id) + '"' +
      ' value="' + esc(getComposeSubject(draft)) + '"' +
      ' aria-label="Subject" placeholder="Subject">' +
      '</div>' +
      (FIRM_TEMPLATES.items.length && draft.mode === 'new'
        ? '<div class="tma-dash__email-compose-subject">' +
          '<span class="tma-dash__email-compose-label">Template</span>' +
          '<select class="tma-dash__email-compose-input" data-email-compose-template="' + esc(draft.id) + '" aria-label="Start from a template">' +
          '<option value="">Start from a template\u2026</option>' +
          FIRM_TEMPLATES.items.map(function (t) {
            return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
          }).join('') +
          '</select>' +
          '</div>'
        : '') +
      '</div>' +
      '<div class="tma-dash__email-compose-editor">' +
      renderComposeToolbar({ expand: false, attach: draft.id }) +
      '<div class="tma-dash__email-image-stage tma-dash__email-compose-stage" data-email-image-stage>' +
      '<div class="tma-dash__email-compose-body" contenteditable="true" role="textbox"' +
      ' aria-multiline="true" aria-label="Message body"' +
      ' data-email-compose-body="' + esc(draft.id) + '">' + bodyHtml + '</div>' +
      renderImageTransformOverlay() +
      '</div>' +
      '<div class="tma-dash__email-compose-footer">' +
      '<div class="tma-dash__email-compose-files" data-email-compose-files' +
      (composeFilesOf(draft).length ? '' : ' hidden') + '>' +
      renderComposeFileChips(draft) +
      '</div>' +
      '<div class="tma-dash__email-compose-footer-row">' +
      '<div class="tma-dash__email-compose-attach">' +
      [
        { icon: 'Trash', label: 'Discard draft', discard: true },
        { icon: 'Paperclip', label: 'Attach file', attach: true },
      ]
        .map(function (item) {
          var attrs = item.discard
            ? ' data-email-compose-discard="' + esc(draft.id) + '"'
            : (item.image ? ' data-email-insert-image' : (item.attach ? ' data-email-compose-attach="' + esc(draft.id) + '"' : ''));
          return (
            '<button type="button" class="tma-dash__email-compose-attach-btn"' + attrs + ' aria-label="' + esc(item.label) + '">' +
            '<img src="' + esc(ICONS[item.icon]) + '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      renderComposeSignaturePicker(draft) +
      '</div>' +
      '<div class="tma-dash__email-compose-send">' +
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--late"' +
      ' data-email-compose-save="' + esc(draft.id) + '">Save draft</button>' +
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--primary"' +
      ' data-email-compose-send="' + esc(draft.id) + '"' + (draft.sending ? ' disabled' : '') + '>' +
      (draft.sending ? 'Sending…' : 'Send') + '</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* ── settings ────────────────────────────────────────────────────
   * The profile menu used to send the user to /settings, which meant leaving
   * the mailbox to change anything about it. It now opens here, over the
   * page, built from the same tma-dash__settings-* rows and switch the
   * Account settings rail uses.
   */

  function settingsSwitch(checked, label, attrs) {
    return '<label class="tma-dash__settings-switch">' +
      '<input class="tma-dash__settings-switch-input" type="checkbox"' + (checked ? ' checked' : '') +
      (attrs ? ' ' + attrs : '') +
      ' role="switch" aria-label="' + esc(label) + '">' +
      '<span class="tma-dash__settings-switch-ui" aria-hidden="true">' +
      '<span class="tma-dash__settings-switch-track"></span>' +
      '<span class="tma-dash__settings-switch-thumb"></span></span></label>';
  }

  function settingsRow(label, desc, control) {
    return (
      '<div class="tma-dash__settings-row">' +
      '<span class="tma-dash__settings-row-copy">' +
      '<span class="tma-dash__settings-row-label">' + esc(label) + '</span>' +
      (desc ? '<span class="tma-dash__settings-row-desc">' + esc(desc) + '</span>' : '') +
      '</span>' + (control || '') + '</div>'
    );
  }

  /* A small segmented control, the shape settings already use for a short,
   * mutually exclusive set of options. */
  function settingsChoice(key, value, options) {
    return (
      '<div class="tma-dash__email-settings-choice" role="radiogroup">' +
      options.map(function (option) {
        var on = option.id === value;

        return (
          '<button type="button" class="tma-dash__email-settings-choice-btn' +
          (on ? ' is-active' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '"' +
          ' data-email-pref-choice="' + esc(key) + '" data-email-pref-value="' + esc(option.id) + '">' +
          esc(option.label) + '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderCategoryChoices(prefs) {
    var enabled = Array.isArray(prefs.inboxCategories) ? prefs.inboxCategories : [];

    return (
      '<div class="tma-dash__email-settings-categories">' +
      INBOX_CATEGORIES.filter(function (category) { return !category.fixed; })
        .map(function (category) {
          var on = enabled.indexOf(category.id) !== -1;

          return settingsRow(category.label, '', settingsSwitch(on, category.label,
            'data-email-pref-category="' + esc(category.id) + '"'));
        }).join('') +
      '</div>'
    );
  }

  function renderMailboxSection(state) {
    var accounts = (state.settings && state.settings.accounts) || [];

    if (!accounts.length) {
      return (
        '<div class="tma-dash__email-settings-empty tma-dash__email-settings-empty--hero">' +
        '<img class="tma-dash__email-settings-empty-art" src="images/illustrations/Illustration15.svg" alt="" width="140" height="140" decoding="async">' +
        '<p class="tma-dash__email-settings-empty-title">No mailbox connected</p>' +
        '<p class="tma-dash__email-settings-empty-sub">Connect your work email to read and send it here.</p>' +
        '<div class="tma-dash__email-settings-empty-cta">' +
        '<a class="tma-dash__email-settings-btn tma-dash__email-settings-btn--brand"' +
        ' href="' + esc(api().connectUrl('google')) + '">' +
        '<img src="images/icons/brands/Google16.svg" alt="" width="16" height="16"><span>Connect Google</span></a>' +
        '<a class="tma-dash__email-settings-btn tma-dash__email-settings-btn--brand"' +
        ' href="' + esc(api().connectUrl('microsoft')) + '">' +
        '<img src="images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"><span>Connect Microsoft</span></a>' +
        '</div>' +
        '</div>'
      );
    }

    return accounts.map(function (account) {
      var name = account.provider === 'google' ? 'Google' : 'Microsoft';

      // The two states worth calling out: a grant too narrow to act on, and
      // a sync that actually failed.
      var warning = '';
      if (account.syncEnabled && !account.canWrite) {
        warning =
          '<p class="tma-dash__email-settings-warning">Connected for reading only. ' +
          'Reconnect to send and organise mail.</p>';
      } else if (account.status === 'error' && account.error) {
        warning = '<p class="tma-dash__email-settings-warning">' + esc(account.error) + '</p>';
      }

      var synced = account.syncedAt
        ? 'Last synced ' + new Date(account.syncedAt).toLocaleString()
        : 'Not synced yet';

      return (
        '<div class="tma-dash__email-settings-account">' +
        settingsRow(
          name + ': ' + (account.email || 'unknown'),
          account.syncEnabled ? synced : 'Mail sync is off',
          settingsSwitch(account.syncEnabled, 'Sync mail from ' + name,
            'data-email-settings-sync="' + esc(account.provider) + '"')
        ) +
        warning +
        '<div class="tma-dash__email-settings-account-actions">' +
        '<button type="button" class="tma-dash__email-settings-btn" data-email-settings-syncnow>Sync now</button>' +
        '<a class="tma-dash__email-settings-btn" href="' + esc(api().connectUrl(account.provider)) + '">Reconnect</a>' +
        '</div></div>'
      );
    }).join('');
  }

  var EMAIL_SETTINGS_TABS = [
    { key: 'mailbox', label: 'Mailbox' },
    { key: 'layout', label: 'Layout' },
    { key: 'inbox', label: 'Inbox' },
    { key: 'reading', label: 'Reading' },
    { key: 'sending', label: 'Sending' },
  ];

  function renderEmailSettingsTabs(activeKey) {
    var ui = window.TMAPortalUI;
    if (ui && typeof ui.tabs === 'function') {
      return (
        '<div class="tma-dash__email-settings-tabs" data-email-settings-tabs>' +
        ui.tabs(EMAIL_SETTINGS_TABS, activeKey) +
        '</div>'
      );
    }

    return (
      '<div class="tma-dash__email-settings-tabs" data-email-settings-tabs>' +
      '<div class="tma-tab-group tma-tab-group--underline" role="tablist" aria-label="Email settings sections">' +
      EMAIL_SETTINGS_TABS.map(function (tab, i) {
        var on = tab.key === activeKey;
        return (
          '<button type="button" class="tma-tab' + (on ? ' is-active' : '') + '" role="tab"' +
          ' data-tab-index="' + i + '" data-tab-key="' + esc(tab.key) + '"' +
          ' aria-selected="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? 0 : -1) + '">' +
          '<span class="tma-tab__label">' + esc(tab.label) + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
          '</button>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  function ensureSignatureLibrary(prefs) {
    var list = Array.isArray(prefs.signatures) ? prefs.signatures.slice() : [];
    var activeId = prefs.activeSignatureId || null;

    if (!list.length) {
      var id = 'sig-' + Date.now().toString(36);
      list = [{ id: id, name: 'Signature', html: prefs.signature || '' }];
      activeId = id;
    }

    if (!activeId || !list.some(function (entry) { return entry.id === activeId; })) {
      activeId = list[0].id;
    }

    return { signatures: list, activeSignatureId: activeId };
  }

  function renderSignatureLibrary(prefs) {
    var lib = ensureSignatureLibrary(prefs);

    return (
      '<div class="tma-dash__email-settings-signature-library" data-email-signature-library>' +
      '<div class="tma-dash__email-settings-signature-library-head">' +
      '<span class="tma-dash__settings-row-label">Choose a signature</span>' +
      '<button type="button" class="tma-dash__email-settings-btn" data-email-signature-add>' +
      '<img src="' + ICONS.Plus + '" alt=""> New</button>' +
      '</div>' +
      '<p class="tma-dash__email-settings-hint">The one marked In use is added when you write a new email. Click another to switch.</p>' +
      '<div class="tma-dash__email-settings-signature-list" role="listbox" aria-label="Signatures">' +
      lib.signatures.map(function (entry) {
        var on = entry.id === lib.activeSignatureId;
        var nameId = 'tma-mail-signature-name-' + String(entry.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        return (
          '<div class="tma-dash__email-settings-signature-item' + (on ? ' is-active' : '') + '"' +
          ' role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
          ' data-email-signature-id="' + esc(entry.id) + '"' +
          ' data-email-signature-select="' + esc(entry.id) + '">' +
          '<span class="tma-dash__email-settings-signature-radio" aria-hidden="true"></span>' +
          '<input id="' + esc(nameId) + '" type="text"' +
          ' class="tma-dash__email-settings-signature-name-input"' +
          ' data-email-signature-rename="' + esc(entry.id) + '"' +
          ' maxlength="80" value="' + esc(entry.name || 'Signature') + '"' +
          ' aria-label="Rename signature" placeholder="Signature name">' +
          '<span class="tma-dash__email-settings-signature-badge">' +
          (on ? 'In use' : 'Use') +
          '</span>' +
          '<button type="button" class="tma-dash__email-settings-signature-icon-btn"' +
          ' data-email-signature-delete="' + esc(entry.id) + '"' +
          ' aria-label="Delete ' + esc(entry.name || 'signature') + '"' +
          (lib.signatures.length <= 1 ? ' disabled' : '') + '>' +
          '<img src="' + ICONS.Trash + '" alt=""></button>' +
          '</div>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  function importSignatureButtonLabel(state) {
    var provider = state && state.account && state.account.provider;
    if (provider === 'microsoft') return 'Import from Outlook';
    if (provider === 'google') return 'Import from Gmail';
    return 'Import from mailbox';
  }

  function renderSignatureEditor(state, prefs) {
    var lib = ensureSignatureLibrary(prefs);
    var active = lib.signatures.find(function (entry) { return entry.id === lib.activeSignatureId; })
      || lib.signatures[0];
    var signature = (active && active.html) || prefs.signature || '';

    return (
      '<div class="tma-dash__email-settings-field tma-dash__email-settings-field--signature">' +
      renderSignatureLibrary(prefs) +
      '<div class="tma-dash__email-settings-signature-head">' +
      '<span class="tma-dash__settings-row-label">Edit "' + esc((active && active.name) || 'Signature') + '"</span>' +
      '<div class="tma-dash__email-settings-signature-actions">' +
      '<button type="button" class="tma-dash__email-settings-btn"' +
      ' data-email-settings-import-signature' +
      (state.connected ? '' : ' disabled') +
      '>' + esc(importSignatureButtonLabel(state)) + '</button>' +
      '</div></div>' +
      '<p class="tma-dash__email-settings-hint">Edits save as you type. Import shows the signatures found in Outlook or Gmail so you can pick the right one.</p>' +
      '<div class="tma-dash__email-settings-signature-editor" data-email-signature-shell>' +
      renderComposeToolbar({ expand: false, insertImage: true }) +
      '<div class="tma-dash__email-settings-signature-stage tma-dash__email-image-stage" data-email-image-stage>' +
      '<div id="tma-mail-signature" class="tma-dash__email-settings-signature-body"' +
      ' contenteditable="true" role="textbox" aria-multiline="true"' +
      ' aria-label="Signature content"' +
      ' data-email-signature-editor data-email-pref-html="signature"' +
      ' data-key="mail-signature-editor-' + esc((active && active.id) || 'none') + '"' +
      ' data-morph-skip' +
      ' data-placeholder="Name, title, phone and logo">' +
      signature +
      '</div>' +
      renderImageTransformOverlay() +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderImageTransformOverlay() {
    var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    return (
      '<div class="tma-dash__email-sig-transform" data-email-image-transform hidden>' +
      '<div class="tma-dash__email-sig-transform-box" data-sig-transform-box>' +
      handles.map(function (dir) {
        return '<button type="button" class="tma-dash__email-sig-transform-handle' +
          ' tma-dash__email-sig-transform-handle--' + dir + '"' +
          ' data-sig-handle="' + dir + '" aria-label="Resize ' + dir.toUpperCase() + '"></button>';
      }).join('') +
      '</div>' +
      '<div class="tma-dash__email-sig-transform-toolbar" data-sig-transform-toolbar>' +
      '<button type="button" class="tma-dash__email-sig-transform-tool" data-sig-transform-rotate="-90" aria-label="Rotate left">' +
      '<img src="' + ICONS.ArrowCounterClockwise + '" alt=""></button>' +
      '<button type="button" class="tma-dash__email-sig-transform-tool" data-sig-transform-rotate="90" aria-label="Rotate right">' +
      '<img src="' + ICONS.ArrowClockwise + '" alt=""></button>' +
      '<label class="tma-dash__email-sig-transform-size">' +
      '<span>W</span>' +
      '<input type="number" min="40" max="720" step="1" value="160" data-sig-transform-width aria-label="Image width">' +
      '<span>px</span></label>' +
      '<label class="tma-dash__email-sig-transform-size">' +
      '<span>H</span>' +
      '<input type="number" min="20" max="720" step="1" value="160" data-sig-transform-height aria-label="Image height">' +
      '<span>px</span></label>' +
      '<button type="button" class="tma-dash__email-sig-transform-tool tma-dash__email-sig-transform-tool--danger"' +
      ' data-sig-transform-delete aria-label="Remove image">' +
      '<img src="' + ICONS.Trash + '" alt=""></button>' +
      '</div></div>'
    );
  }

  function newSignatureId() {
    return 'sig-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function persistSignatureLibrary(root, state, render, next) {
    if (!state.settings) return;
    var prefs = state.settings.preferences || {};
    prefs.signatures = next.signatures;
    prefs.activeSignatureId = next.activeSignatureId;
    var active = next.signatures.find(function (entry) { return entry.id === next.activeSignatureId; });
    prefs.signature = active ? (active.html || '') : '';
    state.settings.preferences = prefs;
    if (state.preferences) {
      state.preferences.signatures = prefs.signatures;
      state.preferences.activeSignatureId = prefs.activeSignatureId;
      state.preferences.signature = prefs.signature;
    }

    var gen = state._signatureLocalGen || 0;
    api().saveSettings({
      preferences: {
        signatures: prefs.signatures,
        activeSignatureId: prefs.activeSignatureId,
        signature: prefs.signature,
      },
    }).then(function (data) {
      if ((state._signatureLocalGen || 0) !== gen) return;
      state.settings = data;
      if (render) render();
    }).catch(function (err) {
      reportMailError(state, err);
    });
  }

  function bumpSignatureLocalGen(state) {
    state._signatureLocalGen = (state._signatureLocalGen || 0) + 1;
  }

  function scheduleSignatureSave(root, state) {
    if (!state.settings) return;
    window.clearTimeout(state._signatureSaveTimer);
    state._signatureSaveTimer = window.setTimeout(function () {
      state._signatureSaveTimer = null;
      persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
    }, 400);
  }

  function flushSignatureEditor(root, state) {
    window.clearTimeout(state._signatureSaveTimer);
    state._signatureSaveTimer = null;
    if (!state.settings) return;
    var editor = root.querySelector('[data-email-signature-editor]');
    if (editor) {
      bumpSignatureLocalGen(state);
      syncActiveSignatureHtml(root, state, signatureEditorValue(editor));
    }
    persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
  }

  function syncActiveSignatureHtml(root, state, html) {
    if (!state.settings || !state.settings.preferences) return;
    var lib = ensureSignatureLibrary(state.settings.preferences);
    lib.signatures = lib.signatures.map(function (entry) {
      if (entry.id !== lib.activeSignatureId) return entry;
      return { id: entry.id, name: entry.name, html: html };
    });
    state.settings.preferences.signatures = lib.signatures;
    state.settings.preferences.activeSignatureId = lib.activeSignatureId;
    state.settings.preferences.signature = html;
    if (state.preferences) {
      state.preferences.signatures = lib.signatures;
      state.preferences.activeSignatureId = lib.activeSignatureId;
      state.preferences.signature = html;
    }
  }

  var SIGNATURE_IMAGE_TYPES = {
    'image/png': true,
    'image/jpeg': true,
    'image/jpg': true,
    'image/webp': true,
  };
  var SIGNATURE_IMAGE_DISPLAY_MAX = 720;
  var SIGNATURE_IMAGE_JPEG_QUALITY = 0.95;

  function isAllowedSignatureImage(file) {
    if (!file) return false;
    var type = String(file.type || '').toLowerCase();
    if (SIGNATURE_IMAGE_TYPES[type]) return true;
    var name = String(file.name || '').toLowerCase();
    return /\.(png|jpe?g|webp)$/.test(name);
  }

  function signatureImageMime(file) {
    var type = String((file && file.type) || '').toLowerCase();
    if (type === 'image/png' || type === 'image/webp') return type;
    return 'image/jpeg';
  }

  function canvasToSignatureDataUrl(canvas, mime) {
    if (mime === 'image/jpeg') {
      return canvas.toDataURL('image/jpeg', SIGNATURE_IMAGE_JPEG_QUALITY);
    }
    if (mime === 'image/webp') {
      var webp = canvas.toDataURL('image/webp', SIGNATURE_IMAGE_JPEG_QUALITY);
      if (webp.indexOf('data:image/webp') === 0) return webp;
    }
    return canvas.toDataURL('image/png');
  }

  function rasterizeRotatedSignatureImage(sourceImg, rotation, mime) {
    var natW = Math.max(1, sourceImg.naturalWidth || 1);
    var natH = Math.max(1, sourceImg.naturalHeight || 1);
    var swap = rotation % 180 !== 0;
    var canvas = document.createElement('canvas');
    canvas.width = swap ? natH : natW;
    canvas.height = swap ? natW : natH;
    var ctx = canvas.getContext('2d');
    if (!ctx) return '';
    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(sourceImg, -natW / 2, -natH / 2, natW, natH);
    return canvasToSignatureDataUrl(canvas, mime);
  }

  function insertSignatureImageFromFile(root, state, editor, file) {
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      var probe = new Image();
      probe.onload = function () {
        var naturalW = probe.naturalWidth || 160;
        var naturalH = probe.naturalHeight || 160;
        var width = Math.max(1, Math.min(SIGNATURE_IMAGE_DISPLAY_MAX, naturalW));
        var height = Math.max(1, Math.round(naturalH * (width / Math.max(1, naturalW))));
        insertSignatureImage(editor, dataUrl, width, height);
        prepareEditableImages(editor);
        persistEditableImageSelectionAfterInsert(root, state, editor, dataUrl);
        showEmailToast(root, 'Image added');
      };
      probe.onerror = function () {
        showEmailToast(root, 'That image could not be read');
      };
      probe.src = dataUrl;
    };
    reader.onerror = function () {
      showEmailToast(root, 'That image could not be read');
    };
    reader.readAsDataURL(file);
  }

  function insertSignatureImage(editor, dataUrl, width, height) {
    if (!editor) return;
    editor.focus();
    var html =
      '<img src="' + dataUrl + '" width="' + width + '" height="' + height + '"' +
      ' style="width:' + width + 'px;height:' + height + 'px;max-width:100%;" alt=""' +
      ' contenteditable="false" draggable="false">';
    try {
      document.execCommand('insertHTML', false, html);
    } catch (e) {
      editor.insertAdjacentHTML('beforeend', html);
    }
  }

  function signatureImageSize(img) {
    // Always prefer the on-screen box. Imported logos often keep a huge natural
    // width attribute while CSS max-width shrinks them, resizing the attribute
    // then looks like a no-op until it dips under the container width.
    var width = img.clientWidth
      || parseInt(img.style.width, 10)
      || parseInt(img.getAttribute('width'), 10)
      || img.naturalWidth
      || 160;
    var height = img.clientHeight
      || parseInt(img.style.height, 10)
      || parseInt(img.getAttribute('height'), 10)
      || img.naturalHeight
      || Math.round(width * 0.6);
    return {
      width: Math.max(40, Math.min(720, width || 160)),
      height: Math.max(20, Math.min(720, height || 160)),
    };
  }

  function applySignatureImageSize(img, width, height) {
    width = Math.max(40, Math.min(720, Math.round(width)));
    height = Math.max(20, Math.min(720, Math.round(height)));
    img.setAttribute('width', String(width));
    img.setAttribute('height', String(height));
    img.style.width = width + 'px';
    img.style.height = height + 'px';
    // Drop the stylesheet max-width clamp while transforming, otherwise drag
    // changes never become visible for wide imported signature cards.
    img.style.maxWidth = 'none';
  }

  function imageEditorSelector() {
    return '[data-email-signature-editor], [data-email-compose-body], [data-email-inline-compose-editor]';
  }

  function imageTransformHostFor(node) {
    if (!node || !node.closest) return null;
    var stage = node.closest('[data-email-image-stage]');
    if (!stage) return null;
    var editor = stage.querySelector(imageEditorSelector());
    var layer = stage.querySelector('[data-email-image-transform]');
    if (!editor || !layer) return null;
    var kind = 'compose';
    if (editor.hasAttribute('data-email-signature-editor')) kind = 'signature';
    else if (editor.hasAttribute('data-email-inline-compose-editor')) kind = 'inline';
    return { stage: stage, editor: editor, layer: layer, kind: kind };
  }

  function resolveImageEditor(fromEl, root) {
    var host = fromEl && imageTransformHostFor(fromEl);
    if (host) return host.editor;

    if (fromEl && fromEl.closest) {
      var compose = fromEl.closest('.tma-dash__email-compose');
      if (compose) {
        var composeBody = compose.querySelector('[data-email-compose-body]');
        if (composeBody) return composeBody;
      }
      var panel = fromEl.closest('[data-email-inline-compose-panel]');
      if (panel) {
        var inlineEditor = panel.querySelector('[data-email-inline-compose-editor]');
        if (inlineEditor) return inlineEditor;
      }
      var shell = fromEl.closest('[data-email-signature-shell]');
      if (shell) {
        var signatureEditor = shell.querySelector('[data-email-signature-editor]');
        if (signatureEditor) return signatureEditor;
      }
    }

    var focused = root.querySelector('.tma-dash__email-compose-window--focused [data-email-compose-body]');
    if (focused) return focused;
    var openCompose = root.querySelector('[data-email-compose-body]');
    if (openCompose) return openCompose;
    var inline = root.querySelector('[data-email-inline-compose-editor]');
    if (inline) return inline;
    return root.querySelector('[data-email-signature-editor]');
  }

  function prepareEditableImages(editor) {
    if (!editor) return;
    editor.querySelectorAll('img').forEach(function (img) {
      img.setAttribute('contenteditable', 'false');
      img.setAttribute('draggable', 'false');
    });
  }

  function clearEditableImageSelection(root, state) {
    root.querySelectorAll('[data-email-image-stage] img.is-selected').forEach(function (node) {
      node.classList.remove('is-selected');
    });
    state._editableSelectedImg = null;
    state._signatureSelectedImg = null;
    root.querySelectorAll('[data-email-image-transform]').forEach(function (layer) {
      layer.hidden = true;
      layer.setAttribute('aria-hidden', 'true');
    });
  }

  function updateEditableImageTransformFrame(root, state) {
    var img = state._editableSelectedImg;
    if (!img || !img.isConnected) {
      clearEditableImageSelection(root, state);
      return;
    }

    var host = imageTransformHostFor(img);
    if (!host) {
      clearEditableImageSelection(root, state);
      return;
    }

    var stage = host.stage;
    var layer = host.layer;
    var box = layer.querySelector('[data-sig-transform-box]');
    if (!box) return;

    // Hide overlays in other stages so only one transform UI is visible.
    root.querySelectorAll('[data-email-image-transform]').forEach(function (other) {
      if (other !== layer) {
        other.hidden = true;
        other.setAttribute('aria-hidden', 'true');
      }
    });

    var stageRect = stage.getBoundingClientRect();
    var imgRect = img.getBoundingClientRect();
    var top = imgRect.top - stageRect.top + stage.scrollTop;
    var left = imgRect.left - stageRect.left + stage.scrollLeft;
    var width = imgRect.width;
    var height = imgRect.height;

    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    box.style.top = Math.round(top) + 'px';
    box.style.left = Math.round(left) + 'px';
    box.style.width = Math.round(width) + 'px';
    box.style.height = Math.round(height) + 'px';

    var toolbar = layer.querySelector('[data-sig-transform-toolbar]');
    if (toolbar) {
      var toolbarTop = top - 44;
      if (toolbarTop < stage.scrollTop + 8) {
        toolbarTop = top + height + 10;
      }
      toolbar.style.top = Math.round(toolbarTop) + 'px';
      toolbar.style.left = Math.round(left + width / 2) + 'px';
    }

    var size = signatureImageSize(img);
    var wInput = layer.querySelector('[data-sig-transform-width]');
    var hInput = layer.querySelector('[data-sig-transform-height]');
    if (wInput && document.activeElement !== wInput) wInput.value = String(size.width);
    if (hInput && document.activeElement !== hInput) hInput.value = String(size.height);
  }

  function selectEditableImage(root, state, img) {
    var host = imageTransformHostFor(img);
    if (!host || !img || !host.editor.contains(img)) return;

    clearEditableImageSelection(root, state);
    img.classList.add('is-selected');
    img.setAttribute('contenteditable', 'false');
    img.setAttribute('draggable', 'false');

    var displayed = signatureImageSize(img);
    applySignatureImageSize(img, displayed.width, displayed.height);

    state._editableSelectedImg = img;
    state._signatureSelectedImg = img;
    updateEditableImageTransformFrame(root, state);
  }

  function persistEditableImage(root, state) {
    var img = state._editableSelectedImg;
    if (!img || !img.isConnected) return;
    var host = imageTransformHostFor(img);
    if (!host) return;

    if (host.kind === 'signature') {
      if (!state.settings) return;
      var value = signatureEditorValue(host.editor);
      syncActiveSignatureHtml(root, state, value);
      persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
    } else if (host.kind === 'compose') {
      var draft = findComposeDraft(state, host.editor.getAttribute('data-email-compose-body'));
      if (draft) {
        draft.bodyHtml = host.editor.innerHTML;
        scheduleDraftSave(state, draft);
      }
    } else if (host.kind === 'inline' && state.inlineCompose) {
      state.inlineCompose.bodyHtml = host.editor.innerHTML;
    }

    updateEditableImageTransformFrame(root, state);
  }

  function rotateEditableImage(root, state, degrees) {
    var img = state._editableSelectedImg;
    if (!img || !img.isConnected) return;

    var source = new Image();
    source.onload = function () {
      var display = signatureImageSize(img);
      var swap = Math.abs(degrees) % 180 !== 0;
      var src = String(img.getAttribute('src') || '');
      var mime = src.indexOf('data:image/png') === 0
        ? 'image/png'
        : (src.indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg');
      var dataUrl = rasterizeRotatedSignatureImage(source, degrees, mime);
      if (!dataUrl) return;

      img.setAttribute('src', dataUrl);
      applySignatureImageSize(
        img,
        swap ? display.height : display.width,
        swap ? display.width : display.height
      );
      persistEditableImage(root, state);
    };
    source.src = img.getAttribute('src') || '';
  }

  // Back-compat aliases used by older call sites in this file.
  function clearSignatureImageSelection(root, state) {
    clearEditableImageSelection(root, state);
  }
  function updateSignatureTransformFrame(root, state) {
    updateEditableImageTransformFrame(root, state);
  }
  function selectSignatureImage(root, state, img) {
    selectEditableImage(root, state, img);
  }
  function persistSelectedSignatureImage(root, state) {
    persistEditableImage(root, state);
  }
  function rotateSelectedSignatureImage(root, state, degrees) {
    rotateEditableImage(root, state, degrees);
  }

  function openInsertImagePicker(root, state, editor) {
    if (!editor) return;
    if (editor.hasAttribute('data-email-compose-body')
        || editor.hasAttribute('data-email-inline-compose-editor')) {
      attachFilesToComposeEditor(root, state, editor);
      return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,.jpg,.jpeg,.png,.webp,image/webp';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (!isAllowedSignatureImage(file)) {
        showEmailToast(root, 'Only PNG, JPEG, JPG and WebP images are allowed');
        return;
      }
      if (file.size > 2.5 * 1024 * 1024) {
        showEmailToast(root, 'Choose an image under 2.5 MB');
        return;
      }
      insertSignatureImageFromFile(root, state, editor, file);
    });
    input.click();
  }

  function persistEditableImageSelectionAfterInsert(root, state, editor, dataUrl) {
    var host = imageTransformHostFor(editor);
    if (!host) host = imageTransformHostFor(editor.parentElement);
    if (host && host.kind === 'signature' && state.settings) {
      var value = signatureEditorValue(editor);
      syncActiveSignatureHtml(root, state, value);
      persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
    } else if (host && host.kind === 'compose') {
      var draft = findComposeDraft(state, editor.getAttribute('data-email-compose-body'));
      if (draft) {
        draft.bodyHtml = editor.innerHTML;
        scheduleDraftSave(state, draft);
      }
    } else if (host && host.kind === 'inline' && state.inlineCompose) {
      state.inlineCompose.bodyHtml = editor.innerHTML;
    } else if (editor.hasAttribute('data-email-compose-body')) {
      var d = findComposeDraft(state, editor.getAttribute('data-email-compose-body'));
      if (d) {
        d.bodyHtml = editor.innerHTML;
        scheduleDraftSave(state, d);
      }
    } else if (editor.hasAttribute('data-email-inline-compose-editor') && state.inlineCompose) {
      state.inlineCompose.bodyHtml = editor.innerHTML;
    } else if (editor.hasAttribute('data-email-signature-editor') && state.settings) {
      var sigValue = signatureEditorValue(editor);
      syncActiveSignatureHtml(root, state, sigValue);
      persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
    }

    var inserted = null;
    editor.querySelectorAll('img').forEach(function (node) {
      if (node.getAttribute('src') === dataUrl) inserted = node;
    });
    if (inserted) selectEditableImage(root, state, inserted);
  }

  function renderEmailSettingsPanel(state, tab, prefs) {
    if (tab === 'mailbox') {
      return renderMailboxSection(state);
    }

    if (tab === 'layout') {
      return (
        settingsRow('Mailbox layout', 'Split keeps the list and the message side by side.',
          settingsChoice('layout', prefs.layout || 'split', [
            { id: 'split', label: 'Split view' },
            { id: 'single', label: 'Full width' },
          ])) +
        settingsRow('Email sidebar', 'Closing the folder list hides it completely. Icons only keeps a slim rail.',
          settingsChoice('sidebarMode', prefs.sidebarMode || 'hidden', [
            { id: 'full', label: 'Full' },
            { id: 'hidden', label: 'Hidden' },
            { id: 'icons', label: 'Icons only' },
          ]))
      );
    }

    if (tab === 'inbox') {
      return (
        settingsRow('Show category tabs', 'Switch the inbox between these sections.',
          settingsSwitch(prefs.showInboxCategories !== false, 'Show category tabs',
            'data-email-pref="showInboxCategories"')) +
        renderCategoryChoices(prefs)
      );
    }

    if (tab === 'reading') {
      return (
        settingsRow('Conversation view', 'Group replies into a single thread.',
          settingsSwitch(prefs.conversationView, 'Conversation view',
            'data-email-pref="conversationView"')) +
        settingsRow('Preview pane', 'Show the message beside the list.',
          settingsSwitch(prefs.previewPane, 'Preview pane', 'data-email-pref="previewPane"')) +
        settingsRow('Read receipts', 'Ask senders to confirm you opened their mail.',
          settingsSwitch(prefs.readReceipts, 'Read receipts', 'data-email-pref="readReceipts"'))
      );
    }

    // Sending
    return (
      settingsRow('Undo send window', 'Seconds to cancel a message after sending.',
        '<input type="number" class="tma-dash__email-settings-number" min="0" max="30"' +
        ' value="' + esc(prefs.undoSendSeconds == null ? 5 : prefs.undoSendSeconds) + '"' +
        ' data-email-pref-number="undoSendSeconds" aria-label="Undo send window in seconds">') +
      renderSignatureEditor(state, prefs)
    );
  }

  function renderEmailSettingsSkeleton() {
    var S = window.TMASkeleton;
    if (!S) {
      return '<div class="tma-dash__email-settings-body"><p>Loading…</p></div>';
    }

    // Mirror the loaded chrome: tab strip + settings rows (label + description).
    return (
      '<div class="tma-dash__email-settings-nav" aria-hidden="true">' +
      '<div class="tma-dash__email-settings-tabs tma-dash__email-settings-tabs--skeleton">' +
      [64, 56, 48, 64, 64].map(function (w) {
        return S.block({ width: w + 'px', height: '14px', radius: '6px' });
      }).join('') +
      '</div></div>' +
      '<div class="tma-dash__email-settings-body" role="status" aria-live="polite" aria-label="Loading">' +
      S.rows(5, { leading: false, width1: '36%', width2: '62%' }) +
      '</div>'
    );
  }

  function renderEmailSettings(state) {
    if (!state.settingsOpen) return '';

    var prefs = (state.settings && state.settings.preferences) || {};
    var loading = !state.settings;
    var tab = state.settingsTab || 'mailbox';
    if (!EMAIL_SETTINGS_TABS.some(function (item) { return item.key === tab; })) {
      tab = 'mailbox';
    }

    return (
      '<div class="tma-dash__email-settings" data-email-settings role="dialog" aria-modal="true"' +
      ' aria-label="Email settings">' +
      '<button type="button" class="tma-dash__email-settings-scrim" data-email-settings-close aria-label="Close settings"></button>' +
      '<div class="tma-dash__email-settings-card">' +
      '<div class="tma-dash__email-settings-head">' +
      '<h2 class="tma-dash__email-settings-title">Email settings</h2>' +
      '<button type="button" class="tma-dash__email-settings-close" data-email-settings-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>' +
      '</div>' +

      (loading
        ? renderEmailSettingsSkeleton()
        : '<div class="tma-dash__email-settings-nav">' +
          renderEmailSettingsTabs(tab) +
          '</div>' +
          '<div class="tma-dash__email-settings-body" role="tabpanel" data-email-settings-panel="' + esc(tab) + '">' +
          renderEmailSettingsPanel(state, tab, prefs) +
          '</div>') +

      '</div>' +
      renderSignatureImportPicker(state) +
      '</div>'
    );
  }

  function renderSignatureImportPicker(state) {
    var choices = state.signatureImportChoices;
    if (!choices || !choices.length) return '';
    var selected = Math.max(0, Math.min(choices.length - 1, state.signatureImportSelected || 0));

    return (
      '<div class="tma-dash__email-sig-import" data-email-sig-import role="dialog" aria-modal="true"' +
      ' aria-labelledby="tma-mail-sig-import-title">' +
      '<div class="tma-dash__email-sig-import-card">' +
      '<h3 id="tma-mail-sig-import-title" class="tma-dash__email-sig-import-title">Which signature should we use?</h3>' +
      (state.signatureImportReconnect
        ? '<p class="tma-dash__email-sig-import-notice"><a href="' + esc(api().connectUrl('google')) + '">Reconnect Gmail</a> to import the signature saved in Gmail.</p>'
        : '') +
      '<div class="tma-dash__email-sig-import-list" role="listbox" aria-label="Signature choices">' +
      choices.map(function (choice, index) {
        var on = index === selected;
        var preview = String(choice.preview || '').trim();
        return (
          '<button type="button" class="tma-dash__email-sig-import-choice' + (on ? ' is-selected' : '') + '"' +
          ' role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
          ' data-email-sig-import-choice="' + index + '">' +
          '<span class="tma-dash__email-sig-import-choice-head">' +
          '<span class="tma-dash__email-settings-signature-radio" aria-hidden="true"></span>' +
          '<span class="tma-dash__email-sig-import-choice-name">' + esc(choice.name || 'Signature') + '</span>' +
          '</span>' +
          (preview ? '<span class="tma-dash__email-sig-import-choice-preview-text">' + esc(preview) + '</span>' : '') +
          '<div class="tma-dash__email-sig-import-choice-html" aria-hidden="true">' + (choice.html || '') + '</div>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="tma-dash__email-sig-import-actions">' +
      '<button type="button" class="tma-dash__email-settings-btn" data-email-sig-import-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__email-settings-btn tma-dash__email-settings-btn--primary" data-email-sig-import-apply>Use this signature</button>' +
      '</div></div></div>'
    );
  }

  function signatureEditorValue(editor) {
    if (!editor) return '';
    var text = (editor.textContent || '').replace(/\u00a0/g, ' ').trim();
    var hasMedia = !!editor.querySelector('img, table');
    if (!text && !hasMedia) return '';
    return editor.innerHTML;
  }

  function closeEmailSettingsPanel(root, state, render) {
    flushSignatureEditor(root, state);
    state.signatureImportChoices = null;
    state.settingsOpen = false;
    render();
  }

  function openEmailSettings(root, state, render) {
    state.settingsOpen = true;
    if (!state.settingsTab) state.settingsTab = 'mailbox';
    render();

    // The panel is modal, so Escape has to work wherever focus happens to be.
    // The page's other Escape handling is bound to the email mount, which a
    // click on the scrim or a blurred field leaves behind.
    if (!state._settingsEscBound) {
      state._settingsEscBound = true;
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !state.settingsOpen) return;
        event.preventDefault();
        if (state.signatureImportChoices && state.signatureImportChoices.length) {
          state.signatureImportChoices = null;
          (state.render || render)();
          return;
        }
        closeEmailSettingsPanel(root, state, state.render || render);
      });
    }

    // Move focus into the dialog so screen readers land there and the first
    // Escape is heard even if the trigger button is gone.
    window.requestAnimationFrame(function () {
      var card = root.querySelector('[data-email-settings] .tma-dash__email-settings-close');
      if (card) card.focus();
    });

    api().getSettings().then(function (data) {
      state.settings = data;
      render();
    }).catch(function (err) {
      state.settingsOpen = false;
      reportMailError(state, err);
      render();
    });
  }

  /* Preferences save on change, there is no Save button to forget. */
  function saveEmailPreference(root, state, key, value) {
    if (!state.settings) return;
    state.settings.preferences[key] = value;
    if (state.preferences) state.preferences[key] = value;
    // Preferences that change the mailbox's shape have to reach live state as
    // well as the settings object, or the panel and the page disagree until
    // the next bootstrap.
    if (key === 'showInboxCategories') state.showInboxCategories = value;

    var payload = {};
    payload[key] = value;

    api().saveSettings({ preferences: payload }).then(function (data) {
      state.settings = data;
    }).catch(function (err) {
      reportMailError(state, err);
    });
  }

  function wireEditableImageTransforms(root, state) {
    // One binding for image selection + transform handles for the life of the
    // mount. Morph replaces editor nodes; root-level listeners survive that.
    if (root._emailImageTransformBound) return;
    root._emailImageTransformBound = true;

    root.addEventListener('click', function (event) {
      var rotate = event.target.closest('[data-sig-transform-rotate]');
      if (rotate) {
        event.preventDefault();
        rotateEditableImage(
          root,
          state,
          parseInt(rotate.getAttribute('data-sig-transform-rotate'), 10) || 90
        );
        return;
      }

      var remove = event.target.closest('[data-sig-transform-delete]');
      if (remove) {
        event.preventDefault();
        var selected = state._editableSelectedImg;
        if (selected && selected.isConnected) {
          var host = imageTransformHostFor(selected);
          selected.remove();
          clearEditableImageSelection(root, state);
          if (host) {
            if (host.kind === 'signature' && state.settings) {
              var value = signatureEditorValue(host.editor);
              syncActiveSignatureHtml(root, state, value);
              persistSignatureLibrary(root, state, null, ensureSignatureLibrary(state.settings.preferences));
            } else if (host.kind === 'compose') {
              var draft = findComposeDraft(state, host.editor.getAttribute('data-email-compose-body'));
              if (draft) {
                draft.bodyHtml = host.editor.innerHTML;
                scheduleDraftSave(state, draft);
              }
            } else if (host.kind === 'inline' && state.inlineCompose) {
              state.inlineCompose.bodyHtml = host.editor.innerHTML;
            }
          }
        }
        return;
      }

      if (event.target.closest('[data-email-image-transform]')) return;

      var stage = event.target.closest('[data-email-image-stage]');
      if (!stage) {
        if (!event.target.closest('[data-email-signature-shell], .tma-dash__email-compose, [data-email-inline-compose-panel]')) {
          clearEditableImageSelection(root, state);
        }
        return;
      }

      var host = imageTransformHostFor(stage);
      if (!host) return;
      var editor = host.editor;

      var link = event.target.closest('a');
      if (link && editor.contains(link)) event.preventDefault();

      var img = event.target.closest('img');
      if (!img && link && editor.contains(link)) img = link.querySelector('img');

      if (!img || !editor.contains(img)) {
        clearEditableImageSelection(root, state);
        return;
      }

      event.preventDefault();
      selectEditableImage(root, state, img);
    });

    root.addEventListener('pointerdown', function (event) {
      var handle = event.target.closest('[data-sig-handle]');
      if (!handle) return;
      var img = state._editableSelectedImg;
      if (!img || !img.isConnected) return;
      if (!imageTransformHostFor(img)) return;

      event.preventDefault();
      event.stopPropagation();

      var dir = handle.getAttribute('data-sig-handle');
      var startX = event.clientX;
      var startY = event.clientY;
      var start = signatureImageSize(img);
      var ratio = start.width / Math.max(1, start.height);
      state._signatureTransformDragging = true;

      try {
        handle.setPointerCapture(event.pointerId);
      } catch (e) { /* older engines */ }

      function onMove(moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        var nextW = start.width;
        var nextH = start.height;

        if (dir.indexOf('e') !== -1) nextW = start.width + dx;
        if (dir.indexOf('w') !== -1) nextW = start.width - dx;
        if (dir.indexOf('s') !== -1) nextH = start.height + dy;
        if (dir.indexOf('n') !== -1) nextH = start.height - dy;

        if (dir.length === 2) {
          nextW = Math.max(40, Math.min(720, nextW));
          nextH = Math.max(20, Math.min(720, Math.round(nextW / ratio)));
        } else if (dir === 'e' || dir === 'w') {
          nextW = Math.max(40, Math.min(720, nextW));
          nextH = start.height;
        } else {
          nextH = Math.max(20, Math.min(720, nextH));
          nextW = start.width;
        }

        applySignatureImageSize(img, nextW, nextH);
        updateEditableImageTransformFrame(root, state);
      }

      function onUp() {
        state._signatureTransformDragging = false;
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        persistEditableImage(root, state);
      }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    root.addEventListener('change', function (event) {
      var input = event.target.closest('[data-sig-transform-width], [data-sig-transform-height]');
      if (!input) return;
      var img = state._editableSelectedImg;
      if (!img || !img.isConnected) return;

      var size = signatureImageSize(img);
      var nextW = size.width;
      var nextH = size.height;
      if (input.hasAttribute('data-sig-transform-width')) {
        nextW = parseInt(input.value, 10) || size.width;
        nextH = Math.round(nextW * (size.height / Math.max(1, size.width)));
      } else {
        nextH = parseInt(input.value, 10) || size.height;
        nextW = Math.round(nextH * (size.width / Math.max(1, size.height)));
      }
      applySignatureImageSize(img, nextW, nextH);
      persistEditableImage(root, state);
    });

    root.addEventListener('scroll', function (event) {
      if (!event.target || !event.target.closest) return;
      if (event.target.closest('[data-email-image-stage]')) {
        updateEditableImageTransformFrame(root, state);
      }
    }, true);

    window.addEventListener('resize', function () {
      updateEditableImageTransformFrame(root, state);
    });
  }

  function wireEmailSettings(root, state, render) {
    MORPH.unwired(root, '[data-email-open-settings]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEmailSettings(root, state, render);
      });
    });

    // The empty state's own call to action. TMANoData names its button
    // generically, so it is claimed here rather than given a bespoke one.
    MORPH.unwired(root, '[data-no-data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEmailSettings(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-settings-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeEmailSettingsPanel(root, state, render);
      });
    });

    // Settings tabs are re-morphed on every switch, so per-button PortalTabGroup
    // listeners die after the first click. Delegate from the email root instead
    //, one binding for the life of the mount, active chrome comes from render.
    if (!root._emailSettingsTabsBound) {
      root._emailSettingsTabsBound = true;

      root.addEventListener('click', function (event) {
        if (!state.settingsOpen) return;
        var tab = event.target.closest('[data-email-settings-tabs] [data-tab-key]');
        if (!tab || !root.contains(tab)) return;
        var key = tab.getAttribute('data-tab-key');
        if (!key || key === state.settingsTab) return;
        flushSignatureEditor(root, state);
        state.settingsTab = key;
        render();
      });

      root.addEventListener('keydown', function (event) {
        if (!state.settingsOpen) return;
        var tab = event.target.closest('[data-email-settings-tabs] .tma-tab');
        if (!tab || !root.contains(tab)) return;

        var group = tab.closest('.tma-tab-group');
        if (!group) return;

        var tabs = Array.prototype.slice.call(group.querySelectorAll('.tma-tab'));
        var index = tabs.indexOf(tab);
        if (index < 0) return;

        var next = -1;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;

        event.preventDefault();
        var key = tabs[next].getAttribute('data-tab-key');
        if (!key) return;
        flushSignatureEditor(root, state);
        state.settingsTab = key;
        render();
        window.requestAnimationFrame(function () {
          var el = root.querySelector(
            '[data-email-settings-tabs] [data-tab-key="' + key + '"]'
          );
          if (el) el.focus();
        });
      });
    }

    MORPH.unwired(root, '[data-email-settings-sync]').forEach(function (input) {
      input.addEventListener('change', function () {
        var provider = input.getAttribute('data-email-settings-sync');
        api().saveSettings({ provider: provider, syncEnabled: input.checked })
          .then(function (data) {
            state.settings = data;
            render();
            // Turning sync on backfills the mailbox, so reload what it found.
            if (input.checked) {
              announceMailSync();
              bootstrapMailbox(root, state, render);
            }
          })
          .catch(function (err) {
            input.checked = !input.checked;
            reportMailError(state, err);
          });
      });
    });

    MORPH.unwired(root, '[data-email-settings-syncnow]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        announceMailSync();

        api().sync().then(function (data) {
          if (data && data.folders) state.folderCounts = data.folders;
          showEmailToast(root, 'Synced ' + (data && data.synced ? data.synced : 0) + ' messages');
          reloadMessages(root, state, render);
          return api().getSettings();
        }).then(function (data) {
          state.settings = data;
          render();
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Sync now';
          reportMailError(state, err);
        });
      });
    });

    MORPH.unwired(root, '[data-email-pref]').forEach(function (input) {
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-email-pref');
        saveEmailPreference(root, state, key, input.checked);
        // Only the ones that change what is on screen; re-rendering on every
        // switch would close the panel's own scroll position for nothing.
        if (key === 'showInboxCategories') render();
      });
    });

    MORPH.unwired(root, '[data-email-pref-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-email-pref-choice');
        var value = btn.getAttribute('data-email-pref-value');

        if (key === 'sidebarMode') {
          saveEmailPreference(root, state, key, value);
          setMailSidebarMode(root, state, render, value);
          return;
        }

        if (key === 'layout') {
          state.layoutStyle = value;
          saveLayoutStyle(value);
          // Split shows the list and the message together, so nothing is
          // "being read" to the exclusion of the list any more.
          if (value === 'split') state.reading = false;
        }

        saveEmailPreference(root, state, key, value);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-pref-category]').forEach(function (input) {
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-email-pref-category');
        var enabled = (state.inboxCategories || []).slice();
        var at = enabled.indexOf(id);

        if (input.checked && at === -1) enabled.push(id);
        else if (!input.checked && at !== -1) enabled.splice(at, 1);

        // Kept in the canonical order rather than the order they were ticked,
        // so the strip does not rearrange itself as the switches are used.
        enabled = INBOX_CATEGORIES.filter(function (category) {
          return !category.fixed && enabled.indexOf(category.id) !== -1;
        }).map(function (category) { return category.id; });

        state.inboxCategories = enabled;
        saveInboxCategories(enabled);

        // Turning off the category the reader is standing in would leave them
        // on a listing with no tab to come back from.
        if (state.folder === id && enabled.indexOf(id) === -1) {
          state.folder = 'inbox';
          reloadMessages(root, state, render);
        }

        saveEmailPreference(root, state, 'inboxCategories', enabled);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-pref-number]').forEach(function (input) {
      input.addEventListener('change', function () {
        var value = Math.max(0, Math.min(30, parseInt(input.value, 10) || 0));
        input.value = value;
        saveEmailPreference(root, state, input.getAttribute('data-email-pref-number'), value);
      });
    });

    MORPH.unwired(root, '[data-email-pref-text]').forEach(function (input) {
      // Plain text prefs (if any remain); save on blur rather than per keystroke.
      input.addEventListener('blur', function () {
        saveEmailPreference(root, state, input.getAttribute('data-email-pref-text'), input.value);
      });
    });

    MORPH.unwired(root, '[data-email-pref-html]').forEach(function (editor) {
      // Keep live HTML on state so a mailbox re-render cannot wipe typing.
      editor.addEventListener('input', function () {
        if (!state.settings) return;
        bumpSignatureLocalGen(state);
        syncActiveSignatureHtml(root, state, signatureEditorValue(editor));
        scheduleSignatureSave(root, state);
      });

      // Rich signature HTML, persist when the editor loses focus, not while
      // the toolbar is being used (mousedown on tools must not steal focus).
      editor.addEventListener('blur', function (event) {
        // Moving focus to transform controls is still "editing".
        var next = event.relatedTarget;
        if (next && next.closest && next.closest('[data-email-image-transform]')) {
          return;
        }
        flushSignatureEditor(root, state);
      });

      editor.addEventListener('paste', function (event) {
        // Keep pasted signature markup, but drop scripts by taking text/html
        // through the browser's own paste into contenteditable after we strip
        // dangerous tags via a temporary sanitising pass on plain fallback.
        var html = event.clipboardData && event.clipboardData.getData('text/html');
        var text = event.clipboardData && event.clipboardData.getData('text/plain');
        if (!html && !text) return;
        event.preventDefault();
        if (html) {
          var clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\son\w+="[^"]*"/gi, '')
            .replace(/\son\w+='[^']*'/gi, '');
          document.execCommand('insertHTML', false, clean);
        } else {
          document.execCommand('insertText', false, text);
        }
      });

      // Make every image a single selectable object (not editable text).
      editor.querySelectorAll('img').forEach(function (img) {
        img.setAttribute('contenteditable', 'false');
        img.setAttribute('draggable', 'false');
      });

      // Stale imports still carrying cid: logos cannot be sized until re-imported.
      if (/cid:/i.test(editor.innerHTML) && !state._signatureCidWarned) {
        state._signatureCidWarned = true;
        showEmailToast(root, 'This signature has mailbox images, use ' + importSignatureButtonLabel(state) + ' again to make them editable');
      }
    });

    // Transform binding lives in wireEditableImageTransforms, called once
    // from the main render path so compose/reply/forward share it.

    MORPH.unwired(root, '[data-email-signature-select]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        if (event.target.closest('[data-email-signature-delete], [data-email-signature-rename]')) return;
        var id = btn.getAttribute('data-email-signature-select');
        if (!id || !state.settings) return;
        var editor = root.querySelector('[data-email-signature-editor]');
        var lib = ensureSignatureLibrary(state.settings.preferences);
        if (id === lib.activeSignatureId) return;
        // Persist edits on the signature we are leaving.
        if (editor) {
          var leavingHtml = signatureEditorValue(editor);
          lib.signatures = lib.signatures.map(function (entry) {
            if (entry.id !== lib.activeSignatureId) return entry;
            return { id: entry.id, name: entry.name, html: leavingHtml };
          });
        }
        lib.activeSignatureId = id;
        persistSignatureLibrary(root, state, render, lib);
      });
    });

    MORPH.unwired(root, '[data-email-signature-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.settings) return;
        var editor = root.querySelector('[data-email-signature-editor]');
        var lib = ensureSignatureLibrary(state.settings.preferences);
        if (lib.signatures.length >= 10) {
          showEmailToast(root, 'You can keep up to 10 signatures');
          return;
        }
        if (editor) {
          var leavingHtml = signatureEditorValue(editor);
          lib.signatures = lib.signatures.map(function (entry) {
            if (entry.id !== lib.activeSignatureId) return entry;
            return { id: entry.id, name: entry.name, html: leavingHtml };
          });
        }
        var id = newSignatureId();
        lib.signatures.push({
          id: id,
          name: 'Signature ' + (lib.signatures.length + 1),
          html: '',
        });
        lib.activeSignatureId = id;
        persistSignatureLibrary(root, state, render, lib);
      });
    });

    MORPH.unwired(root, '[data-email-signature-delete]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (btn.disabled || !state.settings) return;
        var id = btn.getAttribute('data-email-signature-delete');
        var lib = ensureSignatureLibrary(state.settings.preferences);
        if (lib.signatures.length <= 1) return;
        lib.signatures = lib.signatures.filter(function (entry) { return entry.id !== id; });
        if (lib.activeSignatureId === id) {
          lib.activeSignatureId = lib.signatures[0].id;
        }
        persistSignatureLibrary(root, state, render, lib);
      });
    });

    MORPH.unwired(root, '[data-email-signature-rename]').forEach(function (input) {
      input.addEventListener('click', function (event) {
        event.stopPropagation();
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('change', function () {
        if (!state.settings) return;
        var id = input.getAttribute('data-email-signature-rename');
        if (!id) return;
        var lib = ensureSignatureLibrary(state.settings.preferences);
        var name = (input.value || '').trim() || 'Signature';
        input.value = name;
        var changed = false;
        lib.signatures = lib.signatures.map(function (entry) {
          if (entry.id !== id) return entry;
          if (entry.name === name) return entry;
          changed = true;
          return { id: entry.id, name: name, html: entry.html };
        });
        if (!changed) return;
        // Re-render so the edit heading picks up the new name.
        persistSignatureLibrary(root, state, render, lib);
      });
    });

    MORPH.unwired(root, '[data-email-insert-image]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (event) {
        // Same timing as the rest of the compose toolbar: keep the caret.
        event.preventDefault();
      });
      btn.addEventListener('click', function () {
        var editor = resolveImageEditor(btn, root);
        if (!editor) return;
        openInsertImagePicker(root, state, editor);
      });
    });

    MORPH.unwired(root, '[data-email-settings-import-signature]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        flushSignatureEditor(root, state);
        btn.disabled = true;
        var previous = btn.textContent;
        btn.textContent = 'Importing…';

        api().importSignature().then(function (data) {
          btn.disabled = false;
          btn.textContent = previous;
          var choices = (data && data.choices) || [];
          if (!choices.length) {
            showEmailToast(root, (data && data.message) || 'No signature was found');
            return;
          }
          state.signatureImportChoices = choices;
          state.signatureImportSelected = 0;
          state.signatureImportReconnect = !!(data && data.reconnect);
          state.settingsTab = 'sending';
          render();
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = previous;
          if (err && err.status === 422) {
            showEmailToast(root, (err.data && err.data.message) || err.message || 'No signature was found');
            return;
          }
          reportMailError(state, err);
        });
      });
    });

    MORPH.unwired(root, '[data-email-sig-import]').forEach(function (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target !== overlay) return;
        state.signatureImportChoices = null;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sig-import-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var index = parseInt(btn.getAttribute('data-email-sig-import-choice'), 10);
        if (isNaN(index)) return;
        state.signatureImportSelected = index;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sig-import-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.signatureImportChoices = null;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sig-import-apply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyImportedSignatureChoice(root, state, render, btn);
      });
    });
  }

  function applyImportedSignatureChoice(root, state, render, btn) {
    var choices = state.signatureImportChoices || [];
    var selected = choices[state.signatureImportSelected || 0];
    if (!selected || !selected.html) {
      showEmailToast(root, 'Pick a signature first');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    api().applyImportedSignature({
      html: selected.html,
      name: selected.name || '',
    }).then(function (data) {
      if (!state.settings) state.settings = {};
      state.settings.preferences = data.preferences || state.settings.preferences;
      if (state.preferences && data.preferences) {
        state.preferences.signature = data.preferences.signature;
        state.preferences.signatures = data.preferences.signatures;
        state.preferences.activeSignatureId = data.preferences.activeSignatureId;
      }
      state.signatureImportChoices = null;
      state._signatureCidWarned = false;
      showEmailToast(root, 'Signature imported');
      render();
    }).catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Use this signature';
      }
      reportMailError(state, err);
    });
  }

  function syncEmailUrl(folder) {
    var next = folder === 'templates' ? '/email/templates' : '/email';
    var current = window.location.pathname.replace(/\/$/, '') || '/';
    if (current === next) return;
    history.pushState(
      { navId: 'email', view: 'email', title: 'Email', crumb: folder === 'templates' ? 'Email / Templates' : 'Email' },
      '',
      next
    );
  }

  function closeEmailProfileMenu(root, state) {
    if (!state.profileMenuOpen) return;
    state.profileMenuOpen = false;
    state.profileMenuVariant = null;
    var dash = getEmailDashRoot(root);
    var scopes = [root];
    if (dash && scopes.indexOf(dash) === -1) scopes.push(dash);
    scopes.forEach(function (scope) {
      scope.querySelectorAll('[data-email-profile-menu]').forEach(function (menu) {
        menu.hidden = true;
      });
      scope.querySelectorAll('[data-email-profile-toggle]').forEach(function (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function openEmailProfileMenu(root, state, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailBulkMoreMenu(root, state);
    closeEmailLabelPopup(root, state);
    state.profileMenuOpen = true;
    state.profileMenuVariant = toggle.closest('[data-email-header-profile]') ? 'topbar' : 'sidebar';
    toggle.setAttribute('aria-expanded', 'true');
    var wrap = toggle.closest('.tma-dash__email-profile-wrap');
    var menu = wrap && wrap.querySelector('[data-email-profile-menu]');
    if (menu) {
      menu.hidden = false;
      menu.style.minWidth = Math.max(Math.round(toggle.getBoundingClientRect().width), 260) + 'px';
      positionEmailPopupMenu(toggle, menu);
    }
  }

  function getEmailDashRoot(root) {
    return root.closest('.tma-dash');
  }

  function renderEmailSearchMarkup(state) {
    var searchCls = 'tma-dash__email-search';
    if (state.searchFocused || state.search) searchCls += ' tma-dash__email-search--focused';
    if (state.search) searchCls += ' tma-dash__email-search--has-value';
    if (state.searchLoading) searchCls += ' tma-dash__email-search--loading';

    return (
      '<div class="' + searchCls + '" role="search" aria-label="Search mail">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="" aria-hidden="true">' +
      '<input type="search" class="tma-dash__email-search-input" data-email-search placeholder="Search in mail" value="' + esc(state.search || '') + '" aria-label="Search in mail">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-email-search-clear><img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      '<kbd class="tma-dash__kbd" data-email-search-shortcut aria-hidden="true">/</kbd>' +
      '</div>'
    );
  }

  function updateEmailSearchWrap(scope, state) {
    var searchWrap = scope.querySelector('.tma-dash__email-search');
    if (!searchWrap) return;
    searchWrap.classList.toggle('tma-dash__email-search--focused', !!(state.searchFocused || state.search));
    searchWrap.classList.toggle('tma-dash__email-search--has-value', !!state.search);
    searchWrap.classList.toggle('tma-dash__email-search--loading', !!state.searchLoading);
  }

  function ensureEmailHeaderSearch(root, state) {
    var dash = getEmailDashRoot(root);
    if (!dash) return null;
    var header = dash.querySelector('.tma-dash__header');
    if (!header) return null;

    var slot = header.querySelector('.tma-dash__header-center');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'tma-dash__header-center';
      var right = header.querySelector('.tma-dash__header-right');
      header.insertBefore(slot, right);
    }

    header.querySelectorAll('.tma-dash__header-center').forEach(function (el) {
      if (el !== slot) el.remove();
    });

    if (!slot._defaultSearchHtml && slot.querySelector('[data-action="open-search"]')) {
      slot._defaultSearchHtml = slot.innerHTML;
    }

    slot.className = 'tma-dash__header-center';
    slot.setAttribute('data-email-header-search', '');

    var activeSearch = slot.querySelector('[data-email-search]');
    if (activeSearch && document.activeElement === activeSearch) {
      updateEmailSearchWrap(slot, state);
    } else {
      slot.innerHTML = renderEmailSearchMarkup(state);
    }

    slot.hidden = false;
    return slot;
  }

  function syncEmailHeaderSearch(root, state) {
    var view = root.closest('[data-view="email"]');
    var onEmailPage = view && !view.hidden;
    if (!onEmailPage) {
      restoreHeaderSearch(root);
      return;
    }
    // On a phone the search lives in the drawer, and the header's search icon
    // opens it there, so the centre slot goes back to the shell's own.
    if (isEmailMobile()) {
      restoreHeaderSearchSlot(getEmailDashRoot(root));
      return;
    }
    ensureEmailHeaderSearch(root, state);
  }

  function teardownEmailMobileHeader(dash) {
    if (!dash) return;
    dash.classList.remove(
      'tma-dash--email-mobile',
      'tma-dash--email-mobile-reading',
      'tma-dash--email-profile-sidebar-open',
      'tma-dash--email-compose-open'
    );
    var profileSlot = dash.querySelector('[data-email-header-profile]');
    if (profileSlot) {
      profileSlot.hidden = true;
      profileSlot.innerHTML = '';
    }
    var readingBackSlot = dash.querySelector('[data-email-header-reading-back]');
    if (readingBackSlot) {
      readingBackSlot.hidden = true;
      readingBackSlot.innerHTML = '';
    }
    var readingToolsSlot = dash.querySelector('[data-email-header-reading-tools]');
    if (readingToolsSlot) {
      readingToolsSlot.hidden = true;
      readingToolsSlot.innerHTML = '';
    }
    var legacyReadingSlot = dash.querySelector('[data-email-header-reading-actions]');
    if (legacyReadingSlot) legacyReadingSlot.remove();
    var settingsBtn = dash.querySelector('[data-email-settings]');
    if (settingsBtn) settingsBtn.remove();
  }

  function restoreHeaderSearch(root) {
    var dash = root && root.classList && root.classList.contains('tma-dash') ? root : getEmailDashRoot(root);
    if (!dash) return;
    teardownEmailMobileHeader(dash);
    restoreHeaderSearchSlot(dash);
  }

  /* Puts the shell's own search back in the header's centre slot. */
  function restoreHeaderSearchSlot(dash) {
    if (!dash) return;
    var header = dash.querySelector('.tma-dash__header');
    if (!header) return;

    header.querySelectorAll('.tma-dash__header-center').forEach(function (el, index) {
      if (index > 0) el.remove();
    });

    var slot = header.querySelector('.tma-dash__header-center');
    if (!slot) return;

    header.querySelectorAll('.tma-dash__email-search').forEach(function (el) {
      if (!slot.contains(el)) {
        var wrap = el.closest('.tma-dash__header-center');
        if (wrap) wrap.remove();
      }
    });

    if (!slot._defaultSearchHtml) {
      slot.removeAttribute('data-email-header-search');
      return;
    }

    slot.innerHTML = slot._defaultSearchHtml;
    slot.removeAttribute('data-email-header-search');
  }

  function rowListAvatarInner(row) {
    if (row.brand) {
      return '<span class="tma-dash__email-row-icon"><img src="' + esc(brandSrc(row.brand)) + '" alt=""></span>';
    }
    // The sender's real photo, when we have one. Falls back to initials on a
    // load error so a dead URL never leaves an empty circle. Wired as a real
    // listener (see wireListRows), not an inline onerror string, embedding a
    // JSON.stringify()'d value there put literal double quotes inside this
    // double-quoted attribute, which silently truncated the handler.
    if (row.avatarUrl) {
      var initial = (displaySender(row) || '?').charAt(0).toUpperCase();
      return (
        '<span class="tma-dash__email-row-avatar">' +
        '<img src="' + esc(row.avatarUrl) + '" alt="" data-email-row-avatar-fallback="' + esc(initial) + '">' +
        '</span>'
      );
    }
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-row-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    // No photo for this sender, draw the portal's initials avatar, coloured
    // per address so each correspondent is recognisable at a glance.
    return '<span class="tma-dash__email-row-avatar">' +
      '<img src="' + esc(senderInitials(row)) + '" alt="" aria-hidden="true">' +
      '</span>';
  }

  /* Initials avatar for a message's sender, via the shared generator. */
  function senderInitials(row) {
    var name = displaySender(row) || '?';
    var seed = row.email || name;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsFor) {
      return window.TMACurrentUser.initialsFor(name, seed);
    }
    return '';
  }

  /*
   * The sender's picture *is* the row's checkbox.
   *
   * Click the profile picture to select for bulk actions. The photo stays
   * visible (no hover swap to a checkbox); a selected row gets a corner tick
   * badge. The real checkbox input stays in the DOM for select-all, the bulk
   * bar and keyboard users.
   */
  function rowListAvatar(row, state) {
    var checked = !!(state && isRowChecked(row, state));

    return (
      '<label class="tma-dash__email-row-select' + (checked ? ' is-checked' : '') + '"' +
      ' data-email-row-select title="Select">' +
      '<input type="checkbox" class="tma-dash__email-row-select-input" data-email-check' +
      (checked ? ' checked' : '') +
      ' aria-label="Select mail from ' + esc(displaySender(row) || 'this message') + '">' +
      '<span class="tma-dash__email-row-select-face">' + rowListAvatarInner(row) + '</span>' +
      '<span class="tma-dash__email-row-select-box" aria-hidden="true"></span>' +
      '</label>'
    );
  }

  function isEmailRowSelectTarget(el) {
    return !!(
      el.closest('[data-email-check]') ||
      el.closest('[data-email-row-select]') ||
      el.closest('.tma-dash__email-list-check')
    );
  }

  /*
   * The arrow that opens a conversation in the list.
   *
   * Only ever rendered where the server says there are two or more messages —
   * an arrow on a single message opens onto nothing, which reads as a bug. The
   * space is still reserved on one-message rows so senders and subjects stay
   * aligned down the column. The count itself sits beside the sender name as
   * a badge, not under the caret.
   */
  function renderConversationToggle(row, state) {
    if (!hasConversation(row)) {
      return '<span class="tma-dash__email-row-thread-spacer" aria-hidden="true"></span>';
    }

    var open = isConversationOpen(state, row.id);
    var count = conversationCount(row);

    return (
      '<button type="button" class="tma-dash__email-row-thread-toggle' +
      (open ? ' tma-dash__email-row-thread-toggle--open' : '') + '"' +
      ' data-email-conversation-toggle="' + esc(row.id) + '"' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' title="' + count + ' messages in this conversation"' +
      ' aria-label="' + (open ? 'Hide' : 'Show') + ' the other ' + (count - 1) +
      ' message' + (count === 2 ? '' : 's') + ' in this conversation">' +
      '<img src="' + ICONS.CaretRight + '" alt="">' +
      '</button>'
    );
  }

  function renderConversationCountBadge(row) {
    if (!hasConversation(row)) return '';
    var count = conversationCount(row);
    return '<span class="tma-dash__email-row-thread-count" aria-label="' +
      count + ' messages">' + count + '</span>';
  }

  function renderEmailRowMobileStar(row, state) {
    var starred = isRowStarred(row, state);
    return renderEmailIconTooltipBtn({
      tipId: 'email-row-tip-star-mobile-' + row.id,
      label: starred ? 'Remove star' : 'Add star',
      className:
        'tma-dash__email-row-action tma-dash__email-row-star-mobile' +
        (starred ? ' tma-dash__email-row-action--active tma-dash__email-row-action--starred' : ''),
      attrs: ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
      innerHtml: '<img src="' + starIconSrc(starred) + '" alt="">',
    });
  }

  function renderEmailMobileChrome(state) {
    var html = '';
    if (isEmailMobile()) {
      html += '<button type="button" class="tma-dash__email-mobile-scrim" data-email-mobile-scrim aria-label="Close menu"></button>';
    }
    if (isEmailMobile() && !isSingleReading(state)) {
      html +=
        '<button type="button" class="tma-dash__email-mobile-fab" data-email-mobile-compose aria-label="New Email">' +
        '<img src="' + ICONS.PencilSimpleLine + '" alt="">' +
        '<span>New Email</span>' +
        '</button>';
    }
    return html;
  }

  function ensureEmailMobileHeader(root, state) {
    var dash = getEmailDashRoot(root);
    if (!dash) return;

    // Same rule as syncEmailHeaderSearch: these modifiers restyle the shared
    // shell (header slots, and .tma-dash__main's padding on narrow screens),
    // so they may only be on while Email is the visible view. Email renders in
    // the background on sync and realtime updates.
    var view = root.closest('[data-view="email"]');
    if (view && view.hidden) {
      teardownEmailMobileHeader(dash);
      return;
    }

    var mobile = isEmailMobile();
    var reading = mobile && isSingleReading(state);
    var bulkActive = isEmailBulkActive(state);

    dash.classList.toggle('tma-dash--email-mobile', mobile);
    dash.classList.toggle('tma-dash--email-mobile-reading', reading);
    dash.classList.toggle('tma-dash--email-mobile-bulk', bulkActive);
    dash.classList.toggle('tma-dash--email-profile-sidebar-open', !!state.profileSidebarOpen);
    dash.classList.toggle('tma-dash--email-compose-open', false);

    var headerLeft = dash.querySelector('.tma-dash__header-left');
    if (headerLeft) {
      var legacyMenuBtn = headerLeft.querySelector('[data-email-mobile-menu]');
      if (legacyMenuBtn) legacyMenuBtn.remove();

      var readingBackSlot = headerLeft.querySelector('[data-email-header-reading-back]');
      if (!readingBackSlot) {
        readingBackSlot = document.createElement('div');
        readingBackSlot.setAttribute('data-email-header-reading-back', '');
        readingBackSlot.hidden = true;
        var toggleBtn = headerLeft.querySelector('[data-action="toggle-sidebar"]');
        if (toggleBtn) headerLeft.insertBefore(readingBackSlot, toggleBtn.nextSibling);
        else headerLeft.appendChild(readingBackSlot);
      }

      var legacyReadingSlot = headerLeft.querySelector('[data-email-header-reading-actions]');
      if (legacyReadingSlot) legacyReadingSlot.remove();

      if (reading) {
        readingBackSlot.hidden = false;
        readingBackSlot.innerHTML = renderEmailHeaderReadingBack(state);
      } else if (bulkActive) {
        readingBackSlot.hidden = false;
        readingBackSlot.innerHTML = renderEmailHeaderBulkClose();
      } else {
        readingBackSlot.hidden = true;
        readingBackSlot.innerHTML = '';
      }
    }

    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();

    var headerRight = dash.querySelector('.tma-dash__header-right');
    if (headerRight) {
      var readingToolsSlot = headerRight.querySelector('[data-email-header-reading-tools]');
      if (!readingToolsSlot) {
        readingToolsSlot = document.createElement('div');
        readingToolsSlot.setAttribute('data-email-header-reading-tools', '');
        readingToolsSlot.hidden = true;
        headerRight.insertBefore(readingToolsSlot, headerRight.firstChild);
      }

      var profileSlot = headerRight.querySelector('[data-email-header-profile]');
      if (!profileSlot) {
        profileSlot = document.createElement('div');
        profileSlot.setAttribute('data-email-header-profile', '');
        headerRight.insertBefore(profileSlot, readingToolsSlot.nextSibling);
      }

      if (reading) {
        readingToolsSlot.hidden = false;
        readingToolsSlot.innerHTML = renderEmailHeaderReadingTools(state);
        profileSlot.hidden = true;
        profileSlot.innerHTML = '';
      } else if (bulkActive) {
        readingToolsSlot.hidden = false;
        readingToolsSlot.innerHTML = renderEmailHeaderBulkTools(state);
        profileSlot.hidden = true;
        profileSlot.innerHTML = '';
      } else {
        readingToolsSlot.hidden = true;
        readingToolsSlot.innerHTML = '';
        if (mobile) {
          profileSlot.hidden = false;
          // Patched, not rewritten: the avatar would reload on every repaint.
          MORPH.patch(profileSlot, renderEmailHeaderMobileTools(state));
        } else {
          profileSlot.hidden = true;
          profileSlot.innerHTML = '';
        }
      }
    }
  }

  // Subject stands on its own line now (see .tma-dash__email-row-content in
  // CSS), the preview text runs in the separate .snippet line below it, not
  // concatenated here with a " - " separator the way it used to be.
  /* When a message arrived, on the reader's own clock: the time today, the
   * day this year, otherwise the date. Rendered from sentAt rather than the
   * server's label, which is formatted in UTC (see MailMessage::toRow), and
   * shared with the search popup's mail rows so both read the same. */
  function emailTimeLabel(iso, fallback) {
    if (!iso) return fallback || '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return fallback || '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderRowSubjectBody(lines) {
    var subject = lines.subject || '';
    return (
      '<span class="tma-dash__email-row-subject">' +
      '<span class="tma-dash__email-row-subject-text">' + esc(subject) + '</span>' +
      '</span>'
    );
  }

  function getEmailToastEl() {
    return document.querySelector('[data-email-toast]');
  }

  function ensureEmailToast(dash) {
    // Toast lives on <body> (fixed). Looking only inside .tma-dash recreated
    // a second host after the first move, the orphan kept --visible with no
    // hide timer, so "Message pinned" never went away.
    var existing = getEmailToastEl();
    if (existing) {
      if (existing.parentNode !== document.body) {
        document.body.appendChild(existing);
      }
      // Drop any duplicates left from older builds / double ensure.
      document.querySelectorAll('[data-email-toast]').forEach(function (el, i) {
        if (i === 0) return;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      wireEmailToastUndo(existing);
      return existing;
    }
    if (!dash && !document.body) return null;
    var toast = document.createElement('div');
    toast.className = 'tma-dash__email-toast';
    toast.setAttribute('data-email-toast', '');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    toast.innerHTML =
      '<img src="' + ICONS.CheckCircle + '" alt="">' +
      '<span data-email-toast-text></span>';
    document.body.appendChild(toast);
    wireEmailToastUndo(toast);
    return toast;
  }

  function wireEmailToastUndo(toast) {
    if (!toast || toast._undoWired) return;
    var btn = toast.querySelector('[data-email-toast-undo]');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tma-dash__email-toast-undo';
      btn.setAttribute('data-email-toast-undo', '');
      btn.hidden = true;
      btn.textContent = 'Undo';
      toast.appendChild(btn);
    }
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof showEmailToast._onUndo === 'function') showEmailToast._onUndo();
    });
    toast._undoWired = true;
  }

  function hideEmailToast(toast) {
    toast = toast || getEmailToastEl();
    if (!toast) return;
    toast.classList.remove('tma-dash__email-toast--visible');
    toast.classList.remove('tma-dash__email-toast--action');
    toast.hidden = true;
    var btn = toast.querySelector('[data-email-toast-undo]');
    if (btn) btn.hidden = true;
  }

  function showUndoSendToast(root, seconds, onUndo) {
    showEmailToast(root, 'Sending in ' + seconds + '\u2026', {
      persist: true,
      actionLabel: 'Undo',
      onUndo: onUndo,
    });
  }

  function showEmailToast(root, message, opts) {
    opts = opts || {};
    var dash = getEmailDashRoot(root) || (root && root.closest && root.closest('.tma-dash'));
    var toast = ensureEmailToast(dash);
    if (!toast) return;
    wireEmailToastUndo(toast);
    var text = toast.querySelector('[data-email-toast-text]');
    if (!text) return;
    var btn = toast.querySelector('[data-email-toast-undo]');

    text.textContent = message;
    toast.hidden = false;
    // Force a reflow so re-showing the same toast still animates in.
    void toast.offsetWidth;
    toast.classList.add('tma-dash__email-toast--visible');

    window.clearTimeout(showEmailToast._hideTimer);
    window.clearTimeout(showEmailToast._goneTimer);
    showEmailToast._hideTimer = null;
    showEmailToast._goneTimer = null;

    if (opts.persist) {
      showEmailToast._persist = true;
      showEmailToast._onUndo = opts.onUndo || null;
      toast.classList.add('tma-dash__email-toast--action');
      if (btn) {
        btn.hidden = false;
        btn.textContent = opts.actionLabel || 'Undo';
      }
      return;
    }

    showEmailToast._persist = false;
    showEmailToast._onUndo = null;
    toast.classList.remove('tma-dash__email-toast--action');
    if (btn) btn.hidden = true;
    showEmailToast._hideTimer = window.setTimeout(function () {
      toast.classList.remove('tma-dash__email-toast--visible');
      showEmailToast._goneTimer = window.setTimeout(function () {
        toast.hidden = true;
      }, 240);
    }, 2800);
  }

  function animateEmailRowDismiss(wrap, destination, callback) {
    if (!wrap) {
      if (callback) callback();
      return;
    }
    var track = wrap.querySelector('[data-email-row-swipe-track]');
    var max = wrap.offsetWidth || 0;
    var isDelete = destination === 'trash';
    wrap.style.setProperty('--email-swipe-row-h', wrap.offsetHeight + 'px');
    wrap.classList.remove('is-dragging', 'is-open-left', 'is-open-right');
    wrap.classList.add(isDelete ? 'is-deleting' : 'is-archiving');
    if (isDelete) {
      wrap.style.setProperty('--email-swipe-delete-width', max + 'px');
      wrap.classList.add('is-delete-wide');
      if (track) track.style.transform = 'translateX(-' + max + 'px)';
    } else {
      wrap.style.setProperty('--email-swipe-archive-width', max + 'px');
      wrap.classList.add('is-archive-wide');
      if (track) track.style.transform = 'translateX(' + max + 'px)';
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (callback) callback();
    }

    window.setTimeout(function () {
      wrap.classList.add('is-dismissing--collapse');
      function onCollapseEnd(e) {
        if (e.target !== wrap || e.propertyName !== 'max-height') return;
        wrap.removeEventListener('transitionend', onCollapseEnd);
        finish();
      }
      wrap.addEventListener('transitionend', onCollapseEnd);
      window.setTimeout(finish, 360);
    }, 280);
    window.setTimeout(finish, 720);
  }

  function commitEmailRowAction(root, state, render, id, destination) {
    var wasSelected = state.selectedId === id;
    dismissEmailRow(state, id, destination);
    if (destination === 'trash' || destination === 'delete') showEmailToast(root, 'Message deleted');
    else if (destination === 'archive') showEmailToast(root, 'Message archived');
    else if (destination === 'inbox') showEmailToast(root, 'Moved to inbox');
    else if (destination === 'spam') showEmailToast(root, 'Marked as spam');
    // Patch the list in place when the reading pane can stay put; full render
    // when the open message left so the detail pane clears immediately.
    if (wasSelected) render();
    else updateInboxList(root, state, render);
    var dashRoot = getEmailDashRoot(root);
    if (dashRoot && typeof dashRoot._syncTabBarBadges === 'function') dashRoot._syncTabBarBadges();
    announceInboxUnread(state);
  }

  /* Delete in Outlook sends mail to Deleted Items. Delete from Deleted Items
   * (portal Trash) removes it for good, matching Outlook. */
  function mailDeleteDestination(state, id) {
    if (state.folder === 'trash') return 'delete';
    var row = id ? (findAnyRow(state, id) || findRow(state, id)) : null;
    if (row && row.folder === 'trash') return 'delete';
    return 'trash';
  }

  function mailDeleteDestinationForIds(state, ids) {
    if (state.folder === 'trash') return 'delete';
    if (ids && ids.length && ids.every(function (id) {
      var row = findAnyRow(state, id) || findRow(state, id);
      return row && row.folder === 'trash';
    })) return 'delete';
    return 'trash';
  }

  function applyEmailRowAction(root, state, render, id, destination, wrap) {
    if (!id || (wrap && (wrap.classList.contains('is-deleting') || wrap.classList.contains('is-archiving')))) return;
    closeEmailRowSwipes(root);
    if ((destination === 'trash' || destination === 'delete' || destination === 'archive' || destination === 'inbox' || destination === 'spam') && wrap) {
      animateEmailRowDismiss(wrap, destination === 'archive' ? 'archive' : 'trash', function () {
        commitEmailRowAction(root, state, render, id, destination);
      });
      return;
    }
    commitEmailRowAction(root, state, render, id, destination);
  }

  /* Moving a message out of the current folder drops it from the list and
   * tells the provider. On failure the row is put back, because a message
   * that silently stayed where it was would otherwise look archived. */
  function dismissEmailRow(state, id, destination) {
    if (!id) return;

    var rows = rowsOf(state);
    var at = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { at = i; break; }
    }
    if (at === -1) return;

    var row = rows[at];
    rows.splice(at, 1);
    delete state.checkedIds[id];
    if (state.selectedId === id) {
      state.selectedId = null;
      state.reading = false;
    }

    adjustFolderCount(state, state.folder, -1, row.unread);
    if (destination !== 'delete') {
      adjustFolderCount(state, destination, 1, row.unread);
    }

    var request = destination === 'delete'
      ? api().remove(id)
      : api().move(id, destination);
    request.then(function (data) {
      if (data && data.folders) state.folderCounts = data.folders;
    }).catch(function (err) {
      rows.splice(at, 0, row);
      adjustFolderCount(state, state.folder, 1, row.unread);
      if (destination !== 'delete') {
        adjustFolderCount(state, destination, -1, row.unread);
      }
      reportMailError(state, err);
      if (state.render) state.render();
    });
  }

  /* ── Snooze ──────────────────────────────────────────────────────
   * A snoozed message hides from its folder until the chosen time, when the
   * server clears the snooze and sends a reminder notification (the
   * mail:wake-snoozed schedule). Portal-local, like pinning: the provider
   * mailbox is never touched, so it cannot fail on a dead token. */

  function formatSnoozeInstant(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((startTarget - startToday) / 86400e3);
    if (days === 0) return 'Today, ' + time;
    if (days === 1) return 'Tomorrow, ' + time;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + time;
  }

  function snoozePresets() {
    var now = new Date();
    var presets = [];

    // Short reminders first, these are what make snooze feel like a
    // reminder rather than "park it until tomorrow".
    presets.push({ id: '15m', label: 'In 15 minutes', at: new Date(now.getTime() + 15 * 60e3) });
    presets.push({ id: '1h', label: 'In 1 hour', at: new Date(now.getTime() + 3600e3) });

    // Later today: three hours out, on the hour, but only while that is
    // still today; at 11pm "later today" would be a lie.
    var later = new Date(now.getTime() + 3 * 3600e3);
    later.setMinutes(0, 0, 0);
    if (later.getDate() === now.getDate() && later.getMonth() === now.getMonth()) {
      presets.push({ id: 'later', label: 'Later today', at: later });
    }

    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
    presets.push({ id: 'tomorrow', label: 'Tomorrow', at: tomorrow });

    var daysToMonday = (8 - now.getDay()) % 7 || 7;
    var nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday, 8, 0, 0, 0);
    presets.push({ id: 'nextweek', label: 'Next week', at: nextWeek });

    return presets;
  }

  /* datetime-local wants "YYYY-MM-DDTHH:MM" in the user's own zone. */
  function toDatetimeLocalValue(d) {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function closeEmailSnoozeMenu(root) {
    var menu = document.querySelector('[data-email-snooze-menu]');
    if (menu) menu.remove();
    if (root._snoozeMenuCleanup) {
      root._snoozeMenuCleanup();
      root._snoozeMenuCleanup = null;
    }
  }

  /* The "Snooze until…" picker: presets plus a date-time field. Calls
   * onPick(isoString, humanLabel) and closes itself. */
  /* ── pointer menus ───────────────────────────────────────────────
   * One popup, two callers: a right-click on a message row, and the three-dot
   * button at the top of the open message. Both offer the same actions the
   * hover bar and the bulk toolbar already do, this is a second way to reach
   * them, not a second implementation of them.
   */
  var emailPointerMenu = null;

  function closeEmailPointerMenu() {
    if (!emailPointerMenu) return;

    var menu = emailPointerMenu;
    emailPointerMenu = null;
    document.removeEventListener('mousedown', menu._onDoc, true);
    document.removeEventListener('keydown', menu._onKey, true);
    window.removeEventListener('resize', menu._onDismiss);
    window.removeEventListener('scroll', menu._onDismiss, true);
    if (menu.parentNode) menu.parentNode.removeChild(menu);

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-email-message-menu][aria-expanded="true"]'),
      function (btn) { btn.setAttribute('aria-expanded', 'false'); }
    );
  }

  /*
   * @param items  [{id, label, icon, active, danger, separator}], a `separator`
   *               entry draws a rule and is not selectable.
   * @param at     {x, y} for a pointer, or a DOM element to hang under.
   */
  function openEmailPointerMenu(items, at, onPick) {
    closeEmailPointerMenu();
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();

    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-context-menu tma-dash__menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(function (item) {
      if (item.separator) {
        return '<div class="tma-dash__email-context-menu-divider" role="separator"></div>';
      }

      return (
        '<button type="button" class="tma-dash__email-context-menu-item' +
        (item.danger ? ' tma-dash__email-context-menu-item--danger' : '') +
        (item.active ? ' is-active' : '') + '"' +
        ' role="menuitem" data-email-context-item="' + esc(item.id) + '">' +
        (item.icon
          ? '<img class="tma-dash__email-context-menu-icon" src="' + esc(ICONS[item.icon]) + '" alt="">'
          : '<span class="tma-dash__email-context-menu-icon"></span>') +
        '<span>' + esc(item.label) + '</span>' +
        '</button>'
      );
    }).join('');

    document.body.appendChild(menu);

    // Kept inside the viewport: a right-click near the bottom edge would
    // otherwise open a menu that runs off the screen.
    var rect = menu.getBoundingClientRect();
    var point = at && at.nodeType
      ? { x: at.getBoundingClientRect().left, y: at.getBoundingClientRect().bottom + 4 }
      : { x: (at && at.x) || 0, y: (at && at.y) || 0 };
    var left = Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    menu._onDismiss = function () { closeEmailPointerMenu(); };
    menu._onDoc = function (event) {
      if (menu.contains(event.target)) return;
      closeEmailPointerMenu();
    };
    menu._onKey = function (event) {
      if (event.key === 'Escape') closeEmailPointerMenu();
    };

    menu.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-email-context-item]');
      if (!btn) return;
      event.preventDefault();
      var id = btn.getAttribute('data-email-context-item');
      closeEmailPointerMenu();
      onPick(id, btn);
    });

    document.addEventListener('mousedown', menu._onDoc, true);
    document.addEventListener('keydown', menu._onKey, true);
    window.addEventListener('resize', menu._onDismiss);
    window.addEventListener('scroll', menu._onDismiss, true);

    emailPointerMenu = menu;

    return menu;
  }

  /* Right-click on a message row. */
  function openEmailRowMenu(root, state, render, id, at) {
    var row = findAnyRow(state, id);
    if (!row) return;

    var unread = isRowUnread(row, state);
    var starred = isRowStarred(row, state);
    var important = isRowImportant(row, state);
    var pinned = !!row.pinned;
    var inArchive = state.folder === 'archive' || row.folder === 'archive';
    // Right-clicking inside a selection acts on the selection; right-clicking
    // elsewhere acts on that one row, which is what every file manager does.
    var selected = Object.keys(state.checkedIds);
    var bulk = selected.length > 1 && state.checkedIds[id];
    var ids = bulk ? selected : conversationIds(state, id);

    var items = [
      { id: 'open', label: 'Open', icon: 'Eye' },
      { id: 'window', label: 'Open in new window', icon: 'ArrowSquareOut' },
      { separator: true },
      { id: unread ? 'read' : 'unread', label: unread ? 'Mark as read' : 'Mark as unread',
        icon: unread ? 'EnvelopeSimpleOpen' : 'EnvelopeSimple' },
      { id: starred ? 'unstar' : 'star', label: starred ? 'Remove star' : 'Add star',
        icon: starred ? 'StarFilled' : 'Star', active: starred },
      { id: 'important', label: important ? 'Mark as not important' : 'Mark as important',
        icon: important ? 'FlagFilled' : 'Important', active: important },
      { id: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'PushPinFilled' : 'PushPin', active: pinned },
      { id: 'snooze', label: 'Snooze', icon: 'Clock' },
      { id: 'label', label: 'Label as', icon: 'Tag' },
      { separator: true },
      { id: inArchive ? 'inbox' : 'archive', label: inArchive ? 'Move to inbox' : 'Archive',
        icon: inArchive ? 'ArchiveTray' : 'Archive' },
      { id: 'spam', label: 'Report spam', icon: 'WarningOctagon' },
      { id: 'delete', label: 'Delete', icon: 'Trash', danger: true },
    ];

    if (bulk) {
      items[0] = { id: 'open', label: selected.length + ' selected', icon: 'CheckCircle' };
      items.splice(1, 1);
    }

    openEmailPointerMenu(items, at, function (action, btn) {
      if (action === 'open') {
        if (bulk) return;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
        return;
      }

      if (action === 'window') {
        openMailInWindow(root, id);
        return;
      }

      if (action === 'label') {
        // The label picker hangs off a real element, so re-anchor it to the
        // row, the menu it was opened from is already gone.
        var rowEl = root.querySelector('[data-email-row="' + id + '"]');
        if (rowEl) {
          state.labelPopupRowId = id;
          openEmailLabelPopup(root, state, rowEl, { rowId: id });
        }
        return;
      }

      if (action === 'snooze') {
        var anchor = btn || root.querySelector('[data-email-row="' + id + '"]');
        openEmailSnoozeMenu(root, anchor, function (iso, label) {
          applyEmailSnooze(root, state, render, id, iso, label);
        });
        return;
      }

      if (action === 'important') {
        var nextImportant = !important;
        eachRowCopy(state, id, function (copy) { copy.important = nextImportant; });
        api().setFlags(id, { important: nextImportant }).catch(function (err) {
          eachRowCopy(state, id, function (copy) { copy.important = !nextImportant; });
          reportMailError(state, err);
          render();
        });
        render();
        return;
      }

      if (action === 'pin') {
        applyBulkAction(root, state, render, ids, pinned ? 'unpin' : 'pin');
        return;
      }

      applyBulkAction(root, state, render, ids, action === 'delete' ? mailDeleteDestinationForIds(state, ids) : action);
    });
  }

  /* The three-dot button at the top of the open message. */
  function openEmailMessageMenu(root, state, render, btn, id) {
    var row = findAnyRow(state, id) || threadMessage(state, id);
    if (!row) return;

    btn.setAttribute('aria-expanded', 'true');

    var unread = isRowUnread(row, state);
    var inArchive = state.folder === 'archive' || row.folder === 'archive';

    openEmailPointerMenu([
      { id: 'reply', label: 'Reply', icon: 'ArrowBendUpLeft' },
      { id: 'reply-all', label: 'Reply all', icon: 'ArrowBendDoubleUpLeft' },
      { id: 'forward', label: 'Forward', icon: 'ArrowBendUpRight' },
      { separator: true },
      { id: 'window', label: 'Open in new window', icon: 'ArrowSquareOut' },
      { id: 'print', label: 'Print', icon: 'Printer' },
      { id: unread ? 'read' : 'unread', label: unread ? 'Mark as read' : 'Mark as unread',
        icon: unread ? 'EnvelopeSimpleOpen' : 'EnvelopeSimple' },
      { separator: true },
      { id: inArchive ? 'inbox' : 'archive', label: inArchive ? 'Move to inbox' : 'Archive',
        icon: inArchive ? 'ArchiveTray' : 'Archive' },
      { id: 'spam', label: 'Report spam', icon: 'WarningOctagon' },
      { id: 'delete', label: 'Delete', icon: 'Trash', danger: true },
    ], btn, function (action) {
      if (action === 'reply' || action === 'reply-all' || action === 'forward') {
        if (id !== state.selectedId) openMailMessage(root, state, render, id);
        openInlineCompose(state, action);
        render();
        window.requestAnimationFrame(function () { focusInlineComposeEditor(root); });
        return;
      }

      if (action === 'window') {
        openMailInWindow(root, id);
        return;
      }

      if (action === 'print') {
        // Printing from here would print the whole portal around the message,
        // so it goes through the standalone window, which is just the mail.
        openMailInWindow(root, id, { print: true });
        return;
      }

      if (action === 'read' || action === 'unread') {
        setRowRead(state, id, action === 'read');
        render();
        return;
      }

      applyEmailRowAction(root, state, render, id, action === 'delete' ? mailDeleteDestination(state, id) : action, null);
    });
  }

  function openEmailSnoozeMenu(root, anchor, onPick) {
    closeEmailSnoozeMenu(root);
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();

    var presets = snoozePresets();
    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-snooze-menu';
    menu.setAttribute('data-email-snooze-menu', '');
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<div class="tma-dash__email-snooze-menu-title">Snooze until\u2026</div>' +
      presets.map(function (p) {
        return (
          '<button type="button" class="tma-dash__email-snooze-menu-item" role="menuitem"' +
          ' data-email-snooze-preset="' + p.at.toISOString() + '">' +
          '<span>' + esc(p.label) + '</span>' +
          '<span class="tma-dash__email-snooze-menu-when">' + esc(formatSnoozeInstant(p.at)) + '</span>' +
          '</button>'
        );
      }).join('') +
      '<div class="tma-dash__email-snooze-menu-divider" role="separator"></div>' +
      '<div class="tma-dash__email-snooze-menu-custom">' +
      '<input type="datetime-local" class="tma-dash__email-snooze-menu-input" data-email-snooze-custom' +
      ' min="' + toDatetimeLocalValue(new Date(Date.now() + 60e3)) + '"' +
      ' value="' + toDatetimeLocalValue(presets[0].at) + '">' +
      '<button type="button" class="tma-dash__email-snooze-menu-save" data-email-snooze-save>Save</button>' +
      '</div>';

    document.body.appendChild(menu);
    positionEmailPopupMenu(anchor, menu);

    function pick(date) {
      if (!date || isNaN(date.getTime())) return;
      if (date.getTime() <= Date.now()) {
        showEmailToast(root, 'Pick a time in the future');
        return;
      }
      closeEmailSnoozeMenu(root);
      onPick(date.toISOString(), formatSnoozeInstant(date));
    }

    menu.querySelectorAll('[data-email-snooze-preset]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        pick(new Date(btn.getAttribute('data-email-snooze-preset')));
      });
    });

    menu.querySelector('[data-email-snooze-save]').addEventListener('click', function (e) {
      e.stopPropagation();
      var input = menu.querySelector('[data-email-snooze-custom]');
      pick(input.value ? new Date(input.value) : null);
    });

    // Typing in the field must not bubble into row selection handlers.
    menu.addEventListener('click', function (e) { e.stopPropagation(); });

    function onDocClick(e) {
      if (!menu.contains(e.target) && e.target !== anchor) closeEmailSnoozeMenu(root);
    }
    function onKey(e) {
      if (e.key === 'Escape') closeEmailSnoozeMenu(root);
    }
    // Deferred so the click that opened the menu doesn't instantly close it.
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    root._snoozeMenuCleanup = function () {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }

  /* Set or clear the snooze on one row, optimistically. Snoozing hides the
   * row from the current view (except inside Snoozed itself, where clearing
   * does the hiding); failure puts everything back. */
  function applyEmailSnooze(root, state, render, id, iso, label) {
    var rows = rowsOf(state);
    var at = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { at = i; break; }
    }
    if (at === -1) return;

    var row = rows[at];
    var previous = row.snoozedUntil || null;
    row.snoozedUntil = iso;

    // In every view the change removes the row: a snoozed row leaves its
    // folder, an unsnoozed row leaves Snoozed. The one exception is
    // unsnoozing while looking at the message's real folder, which cannot
    // happen because snoozed rows are not listed there.
    var removed = false;
    if ((state.folder === 'snoozed') === !iso) {
      rows.splice(at, 1);
      delete state.checkedIds[id];
      if (state.selectedId === id) {
        state.selectedId = null;
        state.reading = false;
      }
      removed = true;
      if (iso) {
        adjustFolderCount(state, state.folder, -1, row.unread);
        adjustFolderCount(state, 'snoozed', 1, row.unread);
      } else {
        adjustFolderCount(state, 'snoozed', -1, row.unread);
        adjustFolderCount(state, row.folder || 'inbox', 1, row.unread);
      }
    }

    render();
    showEmailToast(root, iso ? 'Snoozed until ' + label : 'Snooze removed');

    api().setFlags(id, { snooze: iso }).catch(function (err) {
      row.snoozedUntil = previous;
      if (removed) rows.splice(at, 0, row);
      reportMailError(state, err);
      reloadMessages(root, state, render);
    });
  }

  /* One toolbar action across a selection.
   *
   * The mock only ever wired read/unread here; archive, spam and delete drew
   * a button that did nothing. All of them now go through /portal/mail/bulk,
   * which applies them message by message and reports how many failed. */
  function applyBulkAction(root, state, render, ids, action) {
    if (!ids.length) return;

    var removes = ['archive', 'spam', 'trash', 'delete', 'inbox'].indexOf(action) !== -1;

    // Snapshot enough to restore the list if the call fails.
    var before = rowsOf(state).slice();

    if (removes) {
      state.rows = rowsOf(state).filter(function (row) {
        return ids.indexOf(row.id) === -1;
      });
      clearEmailSelection(state);
      if (state.selectedId && ids.indexOf(state.selectedId) !== -1) {
        state.selectedId = null;
        state.reading = false;
      }
    } else {
      ids.forEach(function (id) {
        var row = findRow(state, id);
        if (!row) return;
        if (action === 'read' || action === 'unread') row.unread = action === 'unread';
        if (action === 'star' || action === 'unstar') row.starred = action === 'star';
        if (action === 'pin' || action === 'unpin') row.pinned = action === 'pin';
      });
      if (action === 'pin' || action === 'unpin') resortPinnedRows(state);
    }

    // Keep the list head height stable: patch rows in place for moves;
    // flag toggles still need a light chrome refresh.
    if (removes) updateInboxList(root, state, render);
    else render();

    api().bulk(ids, action).then(function (data) {
      if (data && data.folders) state.folderCounts = data.folders;

      if (data && data.failed) {
        showEmailToast(root, data.failed + ' of ' + ids.length + " couldn't be updated");
        reloadMessages(root, state, render);
        return;
      }

      if (removes) {
        var toast =
          action === 'archive' ? 'Archived' :
          action === 'inbox' ? 'Moved to inbox' :
          action === 'delete' || action === 'trash' ? 'Deleted' :
          action === 'spam' ? 'Marked as spam' : 'Updated';
        showEmailToast(root, toast);
        announceInboxUnread(state);
      }
    }).catch(function (err) {
      state.rows = before;
      reportMailError(state, err);
      render();
    });
  }

  /* Keeps the sidebar badges honest between server round trips. */
  function adjustFolderCount(state, folder, delta, wasUnread) {
    if (!state.folderCounts || !state.folderCounts[folder]) return;
    var counts = state.folderCounts[folder];
    counts.total = Math.max(0, (counts.total || 0) + delta);
    if (wasUnread) counts.unread = Math.max(0, (counts.unread || 0) + delta);
  }

  function buildEmailRowSwipeWrap(row, state, rowHtml) {
    var rowId = row.id;
    return (
      '<div class="tma-dash__email-row-swipe" data-email-row-swipe="' + esc(rowId) + '">' +
      '<div class="tma-dash__email-row-swipe-actions tma-dash__email-row-swipe-actions--left" aria-hidden="true">' +
      '<button type="button" class="tma-dash__email-row-swipe-action tma-dash__email-row-swipe-action--archive"' +
      ' data-email-row-swipe-action="archive" data-email-row-id="' + esc(rowId) + '" aria-label="Archive">Archive</button>' +
      '</div>' +
      '<div class="tma-dash__email-row-swipe-actions tma-dash__email-row-swipe-actions--right" aria-hidden="true">' +
      '<button type="button" class="tma-dash__email-row-swipe-action tma-dash__email-row-swipe-action--delete"' +
      ' data-email-row-swipe-action="delete" data-email-row-id="' + esc(rowId) + '" aria-label="Delete">' +
      '<img class="tma-dash__email-row-swipe-delete-icon" src="' + ICONS.Trash + '" alt="" width="24" height="24">' +
      '</button></div>' +
      '<div class="tma-dash__email-row-swipe-track" data-email-row-swipe-track tabindex="0" role="group" aria-label="Email message">' +
      rowHtml +
      '</div></div>'
    );
  }

  function closeEmailRowSwipes(root, except) {
    if (!root) return;
    root.querySelectorAll('[data-email-row-swipe]').forEach(function (wrap) {
      if (except && wrap === except) return;
      if (!wrap.classList.contains('is-open-left') && !wrap.classList.contains('is-open-right')) return;
      wrap.classList.remove('is-open-left', 'is-open-right', 'is-delete-wide', 'is-archive-wide', 'is-dragging');
      wrap.style.removeProperty('--email-swipe-delete-width');
      wrap.style.removeProperty('--email-swipe-archive-width');
      var track = wrap.querySelector('[data-email-row-swipe-track]');
      if (track) track.style.transform = '';
    });
  }

  function bindEmailRowSwipes(root, state, render) {
    if (!isEmailMobile()) return;

    root.querySelectorAll('[data-email-row-swipe]').forEach(function (wrap) {
      if (wrap.dataset.swipeBound) return;
      wrap.dataset.swipeBound = '1';

      var track = wrap.querySelector('[data-email-row-swipe-track]');
      if (!track) return;

      var startX = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;

      function swipeMaxWidth() {
        return wrap.offsetWidth || 0;
      }

      function archiveSnapWidth() {
        return 100;
      }

      function deleteSnapWidth() {
        return 72;
      }

      function syncArchiveReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--email-swipe-archive-width');
          wrap.classList.remove('is-archive-wide');
          return 0;
        }
        wrap.style.setProperty('--email-swipe-archive-width', width + 'px');
        wrap.classList.toggle('is-archive-wide', width >= max * 0.92);
        return width;
      }

      function resetArchiveReveal() {
        wrap.style.removeProperty('--email-swipe-archive-width');
        wrap.classList.remove('is-archive-wide');
      }

      function syncDeleteReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--email-swipe-delete-width');
          wrap.classList.remove('is-delete-wide');
          return 0;
        }
        wrap.style.setProperty('--email-swipe-delete-width', width + 'px');
        wrap.classList.toggle('is-delete-wide', width >= max * 0.92);
        return width;
      }

      function resetDeleteReveal() {
        wrap.style.removeProperty('--email-swipe-delete-width');
        wrap.classList.remove('is-delete-wide');
      }

      function setOffset(px) {
        var max = swipeMaxWidth();
        var clamped = Math.max(-max, Math.min(max, px));

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          resetDeleteReveal();
          resetArchiveReveal();
          wrap.classList.remove('is-open-left', 'is-open-right');
          return 0;
        }

        if (clamped > 0) {
          resetDeleteReveal();
          var archiveReveal = syncArchiveReveal(clamped);
          track.style.transform = 'translateX(' + archiveReveal + 'px)';
          wrap.classList.toggle('is-open-left', archiveReveal > 8);
          wrap.classList.remove('is-open-right');
          return archiveReveal;
        }

        resetArchiveReveal();
        var deleteReveal = syncDeleteReveal(Math.abs(clamped));
        track.style.transform = 'translateX(-' + deleteReveal + 'px)';
        wrap.classList.remove('is-open-left');
        wrap.classList.toggle('is-open-right', deleteReveal > 8);
        return -deleteReveal;
      }

      function snapOpen(direction) {
        closeEmailRowSwipes(root, wrap);
        if (direction === 'left') {
          var snap = archiveSnapWidth();
          syncArchiveReveal(snap);
          track.style.transform = 'translateX(' + snap + 'px)';
          wrap.classList.add('is-open-left');
        } else if (direction === 'right') {
          var deleteSnap = deleteSnapWidth();
          syncDeleteReveal(deleteSnap);
          track.style.transform = 'translateX(-' + deleteSnap + 'px)';
          wrap.classList.add('is-open-right');
        }
      }

      function closeSwipe() {
        wrap.classList.remove('is-open-left', 'is-open-right', 'is-delete-wide', 'is-archive-wide', 'is-dragging');
        resetDeleteReveal();
        resetArchiveReveal();
        track.style.transform = '';
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isEmailRowSelectTarget(e.target)) return;
        if (e.target.closest('.tma-dash__email-row-action')) return;
        // The conversation arrow opens the drop in the list; the row's tap
        // must not also open the message and hide that drop behind the pane.
        if (e.target.closest('[data-email-conversation-toggle]')) return;
        if (isEmailMobile() && e.clientX <= DRAWER_EDGE_PX) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        startOffset = match ? parseFloat(match[1]) : 0;
        wrap.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var delta = e.clientX - startX;
        if (Math.abs(delta) > 6) moved = true;
        setOffset(startOffset + delta);
      });

      function openEmailRowFromSwipe(wrap, id) {
        if (!id) return;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      }

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove('is-dragging');
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);

        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        var current = match ? parseFloat(match[1]) : 0;
        var max = swipeMaxWidth();
        var id = wrap.getAttribute('data-email-row-swipe');
        var wasTap = !moved;

        if (current >= max * 0.75) {
          applyEmailRowAction(root, state, render, id, 'archive', wrap);
          return;
        }
        if (current <= -max * 0.75) {
          applyEmailRowAction(root, state, render, id, 'trash', wrap);
          return;
        }

        if (current > max * 0.35) snapOpen('left');
        else if (current < -max * 0.35) snapOpen('right');
        else closeSwipe();

        if (
          moved &&
          (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right'))
        ) {
          wrap.dataset.swipeMoved = '1';
          window.requestAnimationFrame(function () {
            delete wrap.dataset.swipeMoved;
          });
          return;
        }

        if (!wasTap) return;
        if (isEmailRowSelectTarget(e.target)) return;
        if (e.target.closest('.tma-dash__email-row-action')) return;
        if (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right')) {
          closeEmailRowSwipes(root);
          return;
        }
        wrap.dataset.tapHandled = '1';
        window.requestAnimationFrame(function () {
          delete wrap.dataset.tapHandled;
        });
        openEmailRowFromSwipe(wrap, id);
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);
    });

    MORPH.unwired(root, '[data-email-row-swipe-action]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-email-row-swipe-action');
        var id = btn.getAttribute('data-email-row-id');
        var wrap = btn.closest('[data-email-row-swipe]');
        applyEmailRowAction(root, state, render, id, action === 'delete' ? mailDeleteDestination(state, id) : 'archive', wrap);
      });
    });

    if (!root.dataset.emailSwipeDismissBound) {
      root.dataset.emailSwipeDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-email-row-swipe]')) closeEmailRowSwipes(root);
      });
    }
  }

  function buildInboxRowHtml(row, state, opts) {
    opts = opts || {};
    var active = state.selectedId === row.id;
    var unread = isRowUnread(row, state);
    var checked = isRowChecked(row, state);
    var lines = rowListLines(row);
    var rowCls = 'tma-dash__email-row';
    if (active) rowCls += ' tma-dash__email-row--active';
    if (unread) rowCls += ' tma-dash__email-row--unread';
    else rowCls += ' tma-dash__email-row--read';
    if (checked) rowCls += ' tma-dash__email-row--selected';
    // A message shown inside an opened conversation: indented under its parent
    // and never carrying an arrow of its own.
    if (opts.child) rowCls += ' tma-dash__email-row--child';

    var unreadDot = unread
      ? '<span class="tma-dash__email-row-unread" aria-hidden="true"></span>'
      : '<span class="tma-dash__email-row-unread-slot" aria-hidden="true"></span>';

    /* Conversation drop rows stay compact: unread dot, sender, snippet, time.
       No avatar, subject, or action chrome, those belong on the parent. */
    if (opts.child) {
      return (
        '<div class="' + rowCls + '" data-email-row="' + esc(row.id) + '"' +
        ' data-email-row-child="' + esc(opts.parentId) + '"' +
        ' role="button" tabindex="0">' +
        unreadDot +
        '<div class="tma-dash__email-row-content">' +
        '<div class="tma-dash__email-row-head">' +
        '<span class="tma-dash__email-row-sender">' + esc(displaySender(row)) + '</span>' +
        '</div>' +
        '<div class="tma-dash__email-row-snippet">' + esc(lines.body) + '</div>' +
        '</div>' +
        '<div class="tma-dash__email-row-side">' +
        '<span class="tma-dash__email-row-time">' + esc(emailTimeLabel(row.sentAt, row.time)) + '</span>' +
        '</div>' +
        '</div>'
      );
    }

    var rowHtml =
      '<div class="' + rowCls + '" data-email-row="' + esc(row.id) + '"' +
      ' role="button" tabindex="0">' +
      renderConversationToggle(row, state) +
      unreadDot +
      rowListAvatar(row, state) +
      '<div class="tma-dash__email-row-content">' +
      '<div class="tma-dash__email-row-head">' +
      '<span class="tma-dash__email-row-sender">' + esc(displaySender(row)) + '</span>' +
      renderConversationCountBadge(row) +
      renderInboxRowLabelChips(row.id, state) +
      '</div>' +
      renderRowSubjectBody(lines) +
      '<div class="tma-dash__email-row-snippet">' + esc(lines.body) + '</div>' +
      renderRowAttachmentChips(row) +
      '</div>' +
      '<div class="tma-dash__email-row-side">' +
      '<div class="tma-dash__email-row-actions-bar">' +
      renderEmailRowHoverActions(row, state) +
      '</div>' +
      '<div class="tma-dash__email-row-side-top">' +
      (row.pinned
        ? '<span class="tma-dash__email-row-pinned" role="img" aria-label="Pinned" title="Pinned"></span>'
        : '') +
      (row.snoozedUntil
        ? '<img class="tma-dash__email-row-snoozed" src="' + ICONS.Clock + '" alt="Snoozed"' +
          ' title="Snoozed until ' + esc(formatSnoozeInstant(row.snoozedUntil)) + '">'
        : '') +
      '<span class="tma-dash__email-row-time">' + esc(emailTimeLabel(row.sentAt, row.time)) + '</span>' +
      '</div>' +
      renderEmailRowMobileStar(row, state) +
      '</div>' +
      '</div>';

    if (isEmailMobile() && state.folder === 'inbox') {
      return buildEmailRowSwipeWrap(row, state, rowHtml);
    }
    return rowHtml;
  }

  /* One list row plus any open conversation drop beneath it. */
  function renderInboxRowWithThread(row, state) {
    var html = buildInboxRowHtml(row, state);
    if (!isConversationOpen(state, row.id)) return html;

    var children = conversationChildren(state, row.id);

    if (!children) {
      return html +
        '<div class="tma-dash__email-thread-children" data-email-thread-children="' + esc(row.id) + '">' +
        renderThreadSkeleton(Math.min(3, conversationCount(row))) +
        '</div>';
    }

    return html +
      '<div class="tma-dash__email-thread-children" data-email-thread-children="' + esc(row.id) + '">' +
      (children.length
        ? children.map(function (child) {
          return buildInboxRowHtml(child, state, { child: true, parentId: row.id });
        }).join('')
        : '') +
      '</div>';
  }

  /* The whole list body: date/pin sections wrapping the page of rows, with
   * each opened conversation inlined beneath its parent. One function so the
   * full render and the in-place patch can never disagree about what is on
   * screen. Empty sections are omitted; closed sections stay closed via
   * localStorage until the reader opens them again. */
  function buildInboxRowsHtml(rows, state) {
    var now = new Date();
    var buckets = {};
    INBOX_LIST_GROUPS.forEach(function (group) { buckets[group.id] = []; });

    rows.forEach(function (row) {
      var id = inboxListGroupId(row, now);
      if (!buckets[id]) buckets[id] = [];
      buckets[id].push(row);
    });

    return INBOX_LIST_GROUPS.map(function (group) {
      var groupRows = buckets[group.id];
      if (!groupRows || !groupRows.length) return '';

      var open = isListGroupOpen(state, group.id);
      var body = groupRows.map(function (row) {
        return renderInboxRowWithThread(row, state);
      }).join('');

      return (
        '<section class="tma-dash__email-list-group" data-email-list-group="' + esc(group.id) + '">' +
        '<button type="button" class="tma-dash__email-list-group-toggle"' +
        ' data-email-list-group-toggle="' + esc(group.id) + '"' +
        ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="tma-dash__email-list-group-caret' + (open ? ' is-open' : '') + '" aria-hidden="true">' +
        '<svg viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor"' +
        ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<span class="tma-dash__email-list-group-label">' + esc(group.label) + '</span>' +
        '</button>' +
        (open ? '<div class="tma-dash__email-list-group-body">' + body + '</div>' : '') +
        '</section>'
      );
    }).join('');
  }

  /*
   * Browser bug: pin/star/archive can drop .tma-dash--email off the shell for
   * a beat (or leave main-head + padding:28px live). That opens a ~74px white
   * band above the toolbar. Re-assert the email shell class and collapse the
   * page-title row whenever the email view is the one on screen.
   */
  function emailViewIsActive(root) {
    var dash = getEmailDashRoot(root);
    var view = root && root.closest ? root.closest('.tma-dash__view[data-view="email"]') : null;
    if (!view && dash) {
      view = dash.querySelector('.tma-dash__main > .tma-dash__view[data-view="email"]');
    }
    if (!view || view.hidden || view.hasAttribute('hidden')) return false;

    /*
     * Mail stays mounted after you leave it, and live patches still call
     * lockEmailShellSpacing. If any other main view is on screen, the page
     * title row belongs to that view — CIP Applications lifts the applicant
     * name into it — and locking it here is how that head vanished.
     */
    if (dash) {
      var shown = dash.querySelectorAll('.tma-dash__main > .tma-dash__view:not([hidden])');
      for (var i = 0; i < shown.length; i++) {
        if (shown[i].getAttribute('data-view') !== 'email') return false;
      }
    }
    return true;
  }

  /*
   * Inline properties lockEmailShellSpacing stamps on the shared page-title
   * row. Leaving any of them behind — visibility, position, flex — keeps the
   * row out of flow after Email, which is the CIP application head vanishing
   * in the desktop app.
   */
  var EMAIL_HEAD_LOCK_PROPS = [
    'display', 'margin', 'margin-bottom', 'height', 'max-height', 'min-height',
    'padding', 'overflow', 'flex', 'position', 'visibility', 'width',
    'pointer-events',
  ];

  function clearEmailMainHeadLock(head) {
    if (!head) return;
    /*
     * Strip the mailbox extras only. Chromeless views (Dashboard, Calendar)
     * still own [hidden]; removing it here would put Today back above the
     * hello row. CIP Applications unhides the row itself when it lifts the
     * applicant into it.
     */
    EMAIL_HEAD_LOCK_PROPS.forEach(function (prop) {
      head.style.removeProperty(prop);
    });
  }

  function releaseEmailShellSpacing(root) {
    var dash = getEmailDashRoot(root);
    if (!dash) return;
    var main = dash.querySelector('.tma-dash__main');
    if (main) {
      // Drop the email-only inline zeros so Dashboard / Messages / etc. can
      // take the desktop-bar top inset again.
      main.style.removeProperty('padding-top');
      main.style.removeProperty('padding-left');
      main.style.removeProperty('padding-right');
    }
    clearEmailMainHeadLock(dash.querySelector('.tma-dash__main-head'));
  }

  function lockEmailShellSpacing(root) {
    var dash = getEmailDashRoot(root);
    if (!dash) return;
    if (!emailViewIsActive(root)) {
      releaseEmailShellSpacing(root);
      return;
    }

    // Spacing CSS is keyed off this class, keep it on while Email is open.
    if (!dash.classList.contains('tma-dash--email')) {
      dash.classList.add('tma-dash--email');
    }

    var head = dash.querySelector('.tma-dash__main-head');
    if (head) {
      head.setAttribute('hidden', '');
      head.hidden = true;
      head.style.setProperty('display', 'none', 'important');
      head.style.setProperty('margin', '0', 'important');
      head.style.setProperty('margin-bottom', '0', 'important');
      head.style.setProperty('height', '0', 'important');
      head.style.setProperty('max-height', '0', 'important');
      head.style.setProperty('padding', '0', 'important');
      head.style.setProperty('overflow', 'hidden', 'important');
      head.style.setProperty('flex', '0 0 0', 'important');
      head.style.setProperty('position', 'absolute', 'important');
      head.style.setProperty('visibility', 'hidden', 'important');
    }

    var toolbar = dash.querySelector('.tma-dash__email-toolbar');
    var desktopBar = dash.classList.contains('tma-dash--desktop-bar');
    if (!toolbar && !desktopBar && isEmailMobile()) return;

    var main = dash.querySelector('.tma-dash__main');
    if (main && (toolbar || desktopBar || !isEmailMobile())) {
      main.style.setProperty('padding-top', '0', 'important');
      main.style.setProperty('padding-left', '0', 'important');
      main.style.setProperty('padding-right', '0', 'important');
    }

    if (window.PortalTooltip) {
      if (window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
      if (window.PortalTooltip.purgeOrphans) window.PortalTooltip.purgeOrphans();
    }
  }

  function ensureEmailShellWatch(root) {
    var dash = getEmailDashRoot(root);
    if (!dash || dash._emailShellWatch) return;
    dash._emailShellWatch = true;
    var timer = null;
    function kick() {
      if (timer) return;
      timer = window.setTimeout(function () {
        timer = null;
        if (emailViewIsActive(root)) lockEmailShellSpacing(root);
        else releaseEmailShellSpacing(root);
      }, 0);
    }
    var obs = new MutationObserver(kick);
    obs.observe(dash, { attributes: true, attributeFilter: ['class'] });
    var main = dash.querySelector('.tma-dash__main');
    if (main) {
      obs.observe(main, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
        childList: true,
        subtree: false,
      });
      var head = main.querySelector('.tma-dash__main-head');
      if (head) {
        obs.observe(head, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
      }
    }
  }

  function updateInboxList(root, state, render) {
    var listBody = root.querySelector('.tma-dash__email-list-body');
    if (!listBody) {
      render();
      return;
    }

    // Row actions rebuild this body; dismiss any tip still anchored to a
    // button that is about to be replaced so it cannot jump to the page top
    // or leave an empty band above the mail toolbar.
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    if (window.PortalTooltip && window.PortalTooltip.purgeOrphans) window.PortalTooltip.purgeOrphans();

    var rows = filteredInbox(state);
    // Keep the list-head chrome (checkbox / bulk / filter) at a fixed height
    // while only the body patch changes, avoids the header "bulge" on pin /
    // archive updates.
    MORPH.patch(listBody, rows.length
      ? buildInboxRowsHtml(rows, state)
      : renderListState(state, rows));

    lockEmailShellSpacing(root);
    window.requestAnimationFrame(function () { lockEmailShellSpacing(root); });
    syncSelectAllBox(root, state);

    updateEmailListBulk(root, state);
    wireListRows(root, state, render);
  }

  /* Keep a date-section header on the same screen Y after it opens or
     closes. Overflow anchoring and focus-scroll otherwise walk it up the
     pane and cover the mailbox tabs. */
  function snapshotListGroupToggle(btn) {
    return {
      key: btn.getAttribute('data-email-list-group-toggle'),
      top: btn.getBoundingClientRect().top,
    };
  }

  function restoreListGroupToggle(root, snap) {
    if (!snap || !snap.key) return;
    var next = root.querySelector('[data-email-list-group-toggle="' + snap.key + '"]');
    if (!next) return;
    var delta = next.getBoundingClientRect().top - snap.top;
    var node = next.parentElement;
    while (node && delta) {
      var oy = window.getComputedStyle(node).overflowY;
      var canScroll = (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
        && node.scrollHeight > node.clientHeight + 1;
      if (canScroll) {
        var before = node.scrollTop;
        node.scrollTop += delta;
        delta -= (node.scrollTop - before);
      }
      node = node.parentElement;
    }
    if (delta && window.scrollBy) window.scrollBy(0, delta);
    try {
      next.focus({ preventScroll: true });
    } catch (err) { /* ignore */ }
  }

  function wireListRows(root, state, render) {
    MORPH.unwired(root, '[data-email-list-group-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var key = btn.getAttribute('data-email-list-group-toggle');
        if (!key) return;
        var snap = snapshotListGroupToggle(btn);
        state.listGroups = state.listGroups || {};
        // Open by default; first click closes and persists false forever
        // until they open it again.
        state.listGroups[key] = state.listGroups[key] === false;
        saveListGroups(state.listGroups);
        updateInboxList(root, state, render);
        restoreListGroupToggle(root, snap);
        window.requestAnimationFrame(function () {
          restoreListGroupToggle(root, snap);
        });
      });
    });

    // A broken sender photo falls back to initials. Bound once on root (rows
    // are re-created every render) via capture, since `error` does not bubble.
    if (!root._avatarFallbackWired) {
      root._avatarFallbackWired = true;
      root.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || !img.matches || !img.matches('[data-email-row-avatar-fallback]')) return;
        var wrap = img.parentNode;
        if (!wrap) return;
        wrap.classList.add('tma-dash__email-row-avatar--initial');
        wrap.textContent = img.getAttribute('data-email-row-avatar-fallback') || '?';
      }, true);
    }

    MORPH.unwired(root, '[data-email-row]').forEach(function (rowEl) {
      rowEl.addEventListener('click', function (event) {
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        var swipeWrap = rowEl.closest('[data-email-row-swipe]');
        if (swipeWrap && swipeWrap.dataset.tapHandled) return;
        if (swipeWrap && swipeWrap.dataset.swipeMoved) return;
        if (swipeWrap && (swipeWrap.classList.contains('is-open-left') || swipeWrap.classList.contains('is-open-right'))) {
          closeEmailRowSwipes(root);
          return;
        }
        var chip = event.target.closest('[data-email-row-attachment-open]');
        if (chip) {
          var chipRow = findRow(state, rowEl.getAttribute('data-email-row'));
          var chipItems = (chipRow && chipRow.attachmentsPreview) || [];
          var chipIndex = parseInt(chip.getAttribute('data-email-row-attachment-open'), 10);
          if (chipItems.length && !isNaN(chipIndex)) openAttachmentLightbox(chipItems, chipIndex);
          return;
        }
        var id = rowEl.getAttribute('data-email-row');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });

      rowEl.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        event.preventDefault();
        var id = rowEl.getAttribute('data-email-row');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });

      /* Double-click opens the conversation in its own window, the reading
       * pane keeps the single click, so nothing is taken away. */
      rowEl.addEventListener('dblclick', function (event) {
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        if (event.target.closest('[data-email-conversation-toggle]')) return;
        event.preventDefault();
        // Two fast clicks select the row's text; clear it or the new window
        // opens behind a highlighted line.
        if (window.getSelection) {
          var selection = window.getSelection();
          if (selection && selection.removeAllRanges) selection.removeAllRanges();
        }
        openMailInWindow(root, rowEl.getAttribute('data-email-row'));
      });

      /* Right-click gets the same actions as the hover bar and the bulk menu,
       * at the pointer. */
      rowEl.addEventListener('contextmenu', function (event) {
        if (event.target.closest('a') || String(window.getSelection() || '')) return;
        event.preventDefault();
        openEmailRowMenu(root, state, render, rowEl.getAttribute('data-email-row'), {
          x: event.clientX,
          y: event.clientY,
        });
      });
    });

    /* The conversation arrow. Opening a conversation lists its other messages
     * under the row and does nothing else, in particular it must not open the
     * thread, or a glance at what is inside would mark it read. */
    MORPH.unwired(root, '[data-email-conversation-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleConversation(root, state, render, btn.getAttribute('data-email-conversation-toggle'));
      });
    });

    MORPH.unwired(root, '[data-email-check]').forEach(function (cb) {
      MORPH.on(cb, 'click', function (event) {
        event.stopPropagation();
      });

      MORPH.on(cb, 'change', function (event) {
        event.stopPropagation();
        var rowEl = cb.closest('[data-email-row]');
        if (!rowEl) return;
        setRowSelected(root, state, render, rowEl.getAttribute('data-email-row'), cb.checked);
      });
    });

    MORPH.unwired(root, '[data-email-selectall]').forEach(function (selectAll) {
      MORPH.on(selectAll, 'change', function () {
        var on = selectAll.checked;
        // Everything drawn, including the messages inside opened
        // conversations, those are rows the reader can see and expects to be
        // covered by "select all".
        visibleRows(state).forEach(function (row) {
          if (on) state.checkedIds[row.id] = true;
          else delete state.checkedIds[row.id];
        });
        applySelectionToDom(root, state);
        updateEmailListBulk(root, state);
      });
    });
    syncSelectAllBox(root, state);

    MORPH.unwired(root, '[data-email-refresh]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        refreshMailbox(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-star]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-star');
        var starRow = findAnyRow(state, id);
        if (!starRow) return;
        var starred = !starRow.starred;
        eachRowCopy(state, id, function (copy) { copy.starred = starred; });
        if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
        api().setFlags(id, { starred: starred }).catch(function (err) {
          eachRowCopy(state, id, function (copy) { copy.starred = !starred; });
          reportMailError(state, err);
          render();
        });
        MORPH.unwired(root, '[data-email-star="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-row-action--active', starred);
          el.classList.toggle('tma-dash__email-row-action--starred', starred);
          el.classList.toggle('tma-dash__email-detail-star--active', starred);
          el.setAttribute('aria-pressed', starred ? 'true' : 'false');
          el.setAttribute('aria-label', starred ? 'Remove star' : 'Add star');
          var img = el.querySelector('img');
          if (img) img.src = starIconSrc(starred);
        });
        pulseEmailActionBtn(btn);
        lockEmailShellSpacing(root);
        window.requestAnimationFrame(function () { lockEmailShellSpacing(root); });
      });
    });

    MORPH.unwired(root, '[data-email-important]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-important');
        var impRow = findAnyRow(state, id);
        if (!impRow) return;
        var important = !impRow.important;
        eachRowCopy(state, id, function (copy) { copy.important = important; });
        if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
        api().setFlags(id, { important: important }).catch(function (err) {
          eachRowCopy(state, id, function (copy) { copy.important = !important; });
          reportMailError(state, err);
          render();
        });
        MORPH.unwired(root, '[data-email-important="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-detail-important--active', important);
          el.classList.toggle('tma-dash__email-row-action--active', important);
          el.classList.toggle('tma-dash__email-row-action--important', important);
          el.setAttribute('aria-pressed', important ? 'true' : 'false');
          el.setAttribute('aria-label', important ? 'Mark as not important' : 'Mark as important');
          var img = el.querySelector('img');
          if (img) img.src = importantIconSrc(important);
        });
        pulseEmailActionBtn(btn);
        lockEmailShellSpacing(root);
        window.requestAnimationFrame(function () { lockEmailShellSpacing(root); });
      });
    });

    MORPH.unwired(root, '[data-email-detail-label-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var rowId = btn.getAttribute('data-email-row-id');
        var labelId = btn.getAttribute('data-email-label-id');
        if (!rowId || !labelId) return;
        if (labelId === 'address') {
          if (!state.hiddenDetailChips[rowId]) state.hiddenDetailChips[rowId] = {};
          state.hiddenDetailChips[rowId].address = true;
        } else {
          var labelRow = findRow(state, rowId);
          var at = labelRow && labelRow.labels ? labelRow.labels.indexOf(labelId) : -1;
          if (at !== -1) {
            labelRow.labels.splice(at, 1);
            adjustLabelCount(state, labelId, -1);
            api().setLabel(rowId, labelId, false).catch(function (err) {
              labelRow.labels.push(labelId);
              adjustLabelCount(state, labelId, 1);
              reportMailError(state, err);
              render();
            });
          }
        }
        render();
      });
    });

    MORPH.unwired(root, '[data-email-label]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-label');
        if (state.labelPopupOpen && state.labelPopupRowId === id && !state.labelPopupBulk) {
          closeEmailLabelPopup(root, state);
        } else {
          openEmailLabelPopup(root, state, btn, { rowId: id });
        }
      });
    });

    MORPH.unwired(root, '[data-email-label-option]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var labelId = btn.getAttribute('data-email-label-option');
        toggleLabelForTargets(labelId, state);
        syncLabelMenuChecks(root, state);
        syncRowLabelButtons(root, state);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sidebar-label]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var labelId = btn.getAttribute('data-email-sidebar-label');
        if (state.activeLabelId === labelId) state.activeLabelId = null;
        else state.activeLabelId = labelId;
        state.folder = 'inbox';
        state.sidebarList = 'labels';
        saveSidebarList('labels');
        state.reading = false;
        state.mobileNavOpen = false;
        syncEmailUrl('inbox');
        reloadMessages(root, state, render);
      });
    });

    // "+" in the sidebar and "Create new" in the Label-as menu both open the
    // editor blank; the pencil beside a sidebar label opens it filled in.
    MORPH.unwired(root, '[data-email-label-create]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        openEmailLabelEditor(root, state, btn, null);
      });
    });

    MORPH.unwired(root, '[data-email-label-edit]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        openEmailLabelEditor(root, state, btn, btn.getAttribute('data-email-label-edit'));
      });
    });

    MORPH.unwired(root, '[data-email-label-editor]').forEach(function (editor) {
      // Clicks inside must not bubble to the document handler that closes it.
      editor.addEventListener('click', function (event) {
        event.stopPropagation();
      });

      editor.querySelectorAll('[data-email-label-editor-tone]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setEmailLabelEditorTone(editor, btn.getAttribute('data-email-label-editor-tone'));
        });
      });

      var nameInput = editor.querySelector('[data-email-label-editor-name]');
      if (nameInput) {
        nameInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            saveLabelEditor();
          }
        });
      }

      function saveLabelEditor() {
        var name = nameInput ? nameInput.value.trim() : '';
        var tone = editor.dataset.tone || 'blue';
        if (!name) {
          setEmailLabelEditorError(editor, 'Give the label a name.');
          if (nameInput) nameInput.focus();
          return;
        }

        var saveBtn = editor.querySelector('[data-email-label-editor-save]');
        if (saveBtn) saveBtn.disabled = true;
        setEmailLabelEditorError(editor, null);

        var editingId = state.labelEditorId;
        var request = editingId
          ? api().updateLabel(editingId, { name: name, tone: tone })
          : api().createLabel(name, tone);

        request.then(function (data) {
          var saved = data && data.label;
          if (saved) {
            if (editingId) {
              var existing = getEmailLabel(editingId, state);
              if (existing) {
                existing.name = saved.name;
                existing.tone = saved.tone;
                if (typeof saved.count === 'number') existing.count = saved.count;
              }
            } else {
              if (saved.localOnly === undefined) saved.localOnly = true;
              state.labels.push(saved);
              state.labels.sort(function (a, b) {
                return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
              });
            }
          }
          closeEmailLabelEditor(root, state);
          render();
        }).catch(function (err) {
          if (saveBtn) saveBtn.disabled = false;
          setEmailLabelEditorError(editor, (err && err.message) || 'Could not save the label.');
        });
      }

      var save = editor.querySelector('[data-email-label-editor-save]');
      if (save) save.addEventListener('click', saveLabelEditor);

      var cancel = editor.querySelector('[data-email-label-editor-cancel]');
      if (cancel) {
        cancel.addEventListener('click', function () {
          closeEmailLabelEditor(root, state);
        });
      }

      var del = editor.querySelector('[data-email-label-editor-delete]');
      if (del) {
        del.addEventListener('click', function () {
          // Two-step confirm in place of a blocking dialog: the first click
          // arms the button, the second actually deletes.
          if (!del.classList.contains('tma-dash__email-label-editor-delete--confirm')) {
            del.classList.add('tma-dash__email-label-editor-delete--confirm');
            del.textContent = 'Really delete?';
            return;
          }

          var labelId = state.labelEditorId;
          if (!labelId) return;
          del.disabled = true;

          api().deleteLabel(labelId).then(function () {
            state.labels = emailLabels(state).filter(function (label) {
              return label.id !== labelId;
            });
            rowsOf(state).forEach(function (row) {
              if (!row.labels) return;
              var at = row.labels.indexOf(labelId);
              if (at !== -1) row.labels.splice(at, 1);
            });
            if (state.activeLabelId === labelId) {
              state.activeLabelId = null;
              closeEmailLabelEditor(root, state);
              reloadMessages(root, state, render);
              return;
            }
            closeEmailLabelEditor(root, state);
            render();
          }).catch(function (err) {
            del.disabled = false;
            del.classList.remove('tma-dash__email-label-editor-delete--confirm');
            del.textContent = 'Delete';
            setEmailLabelEditorError(editor, (err && err.message) || 'Could not delete the label.');
          });
        });
      }
    });

    MORPH.unwired(root, '[data-email-row-hover]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var action = btn.getAttribute('data-email-row-hover');
        var id = btn.getAttribute('data-email-row-id');
        var rowEl = root.querySelector('[data-email-row="' + id + '"]');
        if (!id || !rowEl) return;

        if (action === 'pin') {
          var pinRow = findRow(state, id);
          if (!pinRow) return;
          var nowPinned = !pinRow.pinned;
          pinRow.pinned = nowPinned;
          resortPinnedRows(state);
          if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
          // Patch the list only, a full render grows/shrinks the list head.
          updateInboxList(root, state, render);
          lockEmailShellSpacing(root);
          showEmailToast(root, nowPinned ? 'Message pinned' : 'Message unpinned');
          window.requestAnimationFrame(function () { lockEmailShellSpacing(root); });
          api().setFlags(id, { pinned: nowPinned }).catch(function (err) {
            var revert = findRow(state, id);
            if (revert) revert.pinned = !nowPinned;
            resortPinnedRows(state);
            reportMailError(state, err);
            updateInboxList(root, state, render);
            lockEmailShellSpacing(root);
          });
          return;
        }

        if (action === 'archive' || action === 'inbox' || action === 'delete') {
          var wrap = rowEl.closest('[data-email-row-swipe]');
          var destination = action === 'delete' ? mailDeleteDestination(state, id) : action;
          applyEmailRowAction(root, state, render, id, destination, wrap);
          return;
        }

        if (action === 'snooze') {
          var snoozeRow = findRow(state, id);
          if (!snoozeRow) return;
          if (snoozeRow.snoozedUntil) {
            applyEmailSnooze(root, state, render, id, null, '');
          } else {
            openEmailSnoozeMenu(root, btn, function (iso, label) {
              applyEmailSnooze(root, state, render, id, iso, label);
            });
          }
          return;
        }

        if (action === 'read') {
          if (isRowUnread(findRow(state, id), state)) {
            markRowRead(state, id);
            syncEmailRowReadClasses(rowEl, false);
          } else {
            markRowUnread(state, id);
            syncEmailRowReadClasses(rowEl, true);
          }
          var readBtn = rowEl.querySelector('[data-email-row-hover="read"]');
          if (readBtn) {
            var nowUnread = isRowUnread(findRow(state, id), state);
            readBtn.setAttribute('aria-label', nowUnread ? 'Mark as read' : 'Mark as unread');
            var readIcon = readBtn.querySelector('img');
            if (readIcon) readIcon.src = nowUnread ? ICONS.EnvelopeSimpleOpen : ICONS.EnvelopeSimple;
          }
          return;
        }
      });
    });

    bindEmailRowSwipes(root, state, render);
  }

  function closeEmailHeaderDetails(root) {
    root.querySelectorAll('[data-email-header-details-toggle][aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('tma-dash__email-message-head-to--open');
      var wrap = btn.closest('.tma-dash__email-message-head-recipient');
      if (!wrap) return;
      var panel = wrap.querySelector('[data-email-header-details-panel]');
      if (!panel) return;
      panel.hidden = true;
      panel.style.top = '';
      panel.style.left = '';
    });
  }

  function openEmailHeaderDetails(root, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    var wrap = toggle.closest('.tma-dash__email-message-head-recipient');
    if (!wrap) return;
    var panel = wrap.querySelector('[data-email-header-details-panel]');
    if (!panel) return;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.classList.add('tma-dash__email-message-head-to--open');
    positionEmailPopupMenu(toggle, panel);
  }

  function wireEvents(root, state, render) {
    // Selection can move without going through openMailMessage; this catches
    // those cases rather than leaving the pane on a stale conversation.
    ensureThreadLoaded(root, state, render);
    // Grow any open message to its full height (see sizeMessageFrames).
    sizeMessageFrames(root);
    wireAttachmentPreviews(root);
    wireAttachmentPdfPreviews(root);
    wireEmailSidebarSearch(root, state, render);

    // Pager: step pages, or change how many messages a page holds. Both refetch
    // from the server, the mailbox is far too large to page in memory.
    MORPH.unwired(root, '[data-email-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var target = parseInt(btn.getAttribute('data-email-page'), 10);
        if (!target || target === state.page) return;
        state.page = Math.max(1, Math.min(target, state.lastPage || 1));
        state.checkedIds = {};
        reloadMessages(root, state, render);
      });
    });

    var perPageSelect = MORPH.unwiredOne(root, '[data-email-perpage]');
    if (perPageSelect) {
      perPageSelect.addEventListener('change', function () {
        var n = parseInt(perPageSelect.value, 10);
        if (!n) return;
        state.perPage = n;
        state.page = 1;
        state.checkedIds = {};
        saveMailPerPage(n);
        reloadMessages(root, state, render);
      });
    }

    if (!root._emailToolbarBound) {
      root._emailToolbarBound = true;

      // mousedown, not click: execCommand needs the selection that's still
      // live in the editor the instant before the button would steal focus.
      // preventDefault on every branch is what keeps the caret in the editor —
      // without it the button takes focus, the selection collapses, and the
      // command applies to nothing.
      root.addEventListener('mousedown', function (event) {
        var menuBtn = event.target.closest('[data-email-compose-tool-menu]');
        if (menuBtn) {
          event.preventDefault();
          var kind = menuBtn.getAttribute('data-email-compose-tool-menu');
          // Clicking the open menu's own button closes it.
          if (composeMenuEl && composeMenuEl._kind === kind) {
            closeComposeMenu();
            return;
          }
          openComposeMenu(menuBtn, kind);
          if (composeMenuEl) { composeMenuEl._kind = kind; composeMenuEl._host = root; }
          return;
        }

        var toolBtn = event.target.closest('[data-email-compose-tool-cmd]');
        if (!toolBtn) return;
        event.preventDefault();
        closeComposeMenu();
        applyComposeCommand(toolBtn.getAttribute('data-email-compose-tool-cmd'));
        syncComposeToolbarState(root);
      });

      // Menu items live on document.body, outside root; the handler is shared
      // with every other surface hosting this toolbar and bound once.
      ensureComposeMenuDocHandler();

      // Keep the pressed states honest as the caret moves or the user types.
      document.addEventListener('selectionchange', function () {
        if (!root.querySelector('[data-email-compose-body], [data-email-signature-editor]')) return;
        syncComposeToolbarState(root);
      });

      // Keyboard shortcuts fire the browser's own commands, which the toolbar
      // then has to catch up with.
      root.addEventListener('keyup', function (event) {
        if (event.target.closest('[data-email-compose-body], [data-email-signature-editor]')) {
          syncComposeToolbarState(root);
        }
      });
    }

    if (!root._emailProfileBound) {
      root._emailProfileBound = true;

      root.addEventListener('click', function (event) {
        var headerToggle = event.target.closest('[data-email-header-details-toggle]');
        if (headerToggle) {
          event.preventDefault();
          event.stopPropagation();
          var headerOpen = headerToggle.getAttribute('aria-expanded') === 'true';
          closeEmailHeaderDetails(root);
          if (!headerOpen) openEmailHeaderDetails(root, headerToggle);
          return;
        }

        // ── thread controls ──
        var quoteBtn = event.target.closest('[data-email-thread-quote]');
        if (quoteBtn) {
          event.preventDefault();
          var quoteId = quoteBtn.getAttribute('data-email-thread-quote');
          if (state.thread) {
            state.thread.showQuoted[quoteId] = !state.thread.showQuoted[quoteId];
            render();
          }
          return;
        }

        // The three-dot menu at the top of the open message.
        var messageMenuBtn = event.target.closest('[data-email-message-menu]');
        if (messageMenuBtn) {
          event.preventDefault();
          event.stopPropagation();
          openEmailMessageMenu(
            root, state, render,
            messageMenuBtn,
            messageMenuBtn.getAttribute('data-email-message-menu')
          );
          return;
        }

        var inlineComposeBtn = event.target.closest('[data-email-inline-compose]');
        if (inlineComposeBtn && !inlineComposeBtn.closest('[data-email-inline-compose-panel]')) {
          var composeMode = inlineComposeBtn.getAttribute('data-email-inline-compose');
          if (composeMode === 'reply' || composeMode === 'reply-all' || composeMode === 'forward') {
            // A head button names the message it sits on, so replying from a
            // card that is not the selected one still answers the right mail.
            var composeTarget = inlineComposeBtn.getAttribute('data-email-message-id');
            if (composeTarget && composeTarget !== state.selectedId) {
              openMailMessage(root, state, render, composeTarget);
            }
            openInlineCompose(state, composeMode);
            render();
            window.requestAnimationFrame(function () {
              focusInlineComposeEditor(root);
            });
            return;
          }
        }

        var inlineComposeClose = event.target.closest('[data-email-inline-compose-close]');
        if (inlineComposeClose) {
          dismissComposePane(root, state, render, function () {
            closeInlineCompose(state);
          });
          return;
        }

        var toggle = event.target.closest('[data-email-profile-toggle]');
        if (toggle) {
          event.stopPropagation();
          if (state.profileSidebarOpen) closeEmailProfileSidebar(state);
          if (state.profileMenuOpen) closeEmailProfileMenu(root, state);
          else openEmailProfileMenu(root, state, toggle);
          return;
        }

        var actionBtn = event.target.closest('[data-email-profile-action]');
        if (actionBtn) {
          closeEmailProfileMenu(root, state);
          closeEmailProfileSidebar(state);
          var action = actionBtn.getAttribute('data-email-profile-action');
          // Opens over the mailbox instead of navigating to /settings.
          if (action === 'settings') {
            openEmailSettings(root, state, render);
            return;
          }
          // "Sign out" here means the mailbox, not the portal: it disconnects
          // the connected provider and drops back to the connect state. The
          // portal session stays, its sign-out is the shell sidebar profile.
          if (action === 'sign-out') {
            disconnectMailbox(root, state, render);
            return;
          }
          render();
          return;
        }

        if (state.profileMenuOpen && !event.target.closest('[data-email-profile-menu]') && !event.target.closest('[data-email-profile-toggle]')) {
          closeEmailProfileMenu(root, state);
        }

        if (
          state.profileSidebarOpen &&
          !event.target.closest('[data-email-profile-popup-card]') &&
          !event.target.closest('[data-email-profile-sidebar-toggle]')
        ) {
          closeEmailProfileSidebar(state);
          render();
        }

        if (state.bulkMoreMenuOpen && !event.target.closest('[data-email-bulk-more-menu]') && !event.target.closest('[data-email-bulk-more-toggle]')) {
          closeEmailBulkMoreMenu(root, state);
        }

        if (state.labelPopupOpen && !event.target.closest('[data-email-label-menu]') && !event.target.closest('[data-email-label]')) {
          closeEmailLabelPopup(root, state);
        }

        if (
          state.labelEditorOpen &&
          !event.target.closest('[data-email-label-editor]') &&
          !event.target.closest('[data-email-label-create]') &&
          !event.target.closest('[data-email-label-edit]')
        ) {
          closeEmailLabelEditor(root, state);
        }

        if (!event.target.closest('[data-email-row-swipe]')) {
          closeEmailRowSwipes(root);
        }

        if (
          !event.target.closest('[data-email-header-details-toggle]') &&
          !event.target.closest('[data-email-header-details-panel]')
        ) {
          closeEmailHeaderDetails(root);
        }
      });

      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        // Settings sits above everything else, so it closes first.
        if (state.settingsOpen) {
          if (state.signatureImportChoices && state.signatureImportChoices.length) {
            state.signatureImportChoices = null;
            render();
            return;
          }
          closeEmailSettingsPanel(root, state, render);
          return;
        }
        if (root.querySelector('[data-email-header-details-toggle][aria-expanded="true"]')) {
          closeEmailHeaderDetails(root);
          return;
        }
        if (state.labelEditorOpen) closeEmailLabelEditor(root, state);
        else if (state.labelPopupOpen) closeEmailLabelPopup(root, state);
        else if (state.bulkMoreMenuOpen) closeEmailBulkMoreMenu(root, state);
        else if (state.profileMenuOpen) closeEmailProfileMenu(root, state);
        else if (state.profileSidebarOpen) {
          closeEmailProfileSidebar(state);
          render();
        }
      });
    }

    if (!root._emailPopupBound) {
      root._emailPopupBound = true;
      window.addEventListener('resize', function () {
        if (state.bulkMoreMenuOpen) {
          var bulkToggle = root.querySelector('[data-email-bulk-more-toggle]');
          var bulkMenu = root.querySelector('[data-email-bulk-more-menu]');
          if (bulkToggle && bulkMenu) positionEmailPopupMenu(bulkToggle, bulkMenu);
        }
        if (state.labelPopupOpen) {
          var labelAnchor = state.labelPopupRowId
            ? root.querySelector('[data-email-label="' + state.labelPopupRowId + '"]')
            : root.querySelector('[data-email-bulk-more-item="label"]');
          var labelMenu = root.querySelector('[data-email-label-menu]');
          if (labelAnchor && labelMenu) positionEmailPopupMenu(labelAnchor, labelMenu);
        }
        if (state.profileMenuOpen) {
          var dashRoot = getEmailDashRoot(root);
          var profileToggle =
            (dashRoot && dashRoot.querySelector('[data-email-profile-toggle][aria-expanded="true"]')) ||
            root.querySelector('[data-email-profile-toggle][aria-expanded="true"]');
          var profileWrap = profileToggle && profileToggle.closest('.tma-dash__email-profile-wrap');
          var profileMenu = profileWrap && profileWrap.querySelector('[data-email-profile-menu]');
          if (profileToggle && profileMenu) {
            profileMenu.style.minWidth = Math.round(profileToggle.getBoundingClientRect().width) + 'px';
            positionEmailPopupMenu(profileToggle, profileMenu);
          }
        }
        if (state.profileSidebarOpen) {
          var dashRootProfile = getEmailDashRoot(root);
          var headerProfileToggle =
            dashRootProfile && dashRootProfile.querySelector('[data-email-profile-sidebar-toggle]');
          var profilePopup = root.querySelector('[data-email-profile-popup-card]');
          if (headerProfileToggle && profilePopup) {
            positionEmailProfilePopup(headerProfileToggle, profilePopup);
          }
        }
        var headerToggle = root.querySelector('[data-email-header-details-toggle][aria-expanded="true"]');
        if (headerToggle) {
          var headerPanel = headerToggle.closest('.tma-dash__email-message-head-recipient');
          headerPanel = headerPanel && headerPanel.querySelector('[data-email-header-details-panel]');
          if (headerPanel) positionEmailPopupMenu(headerToggle, headerPanel);
        }
      });
    }

    if (!root._emailSearchBound) {
      root._emailSearchBound = true;
      var dash = getEmailDashRoot(root);
      if (dash) {
        var searchTimer = null;
        dash.addEventListener('focusin', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.searchFocused = true;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
        });
        dash.addEventListener('focusout', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.searchFocused = false;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
        });
        dash.addEventListener('input', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.search = event.target.value;
          state.searchFocused = true;
          state.searchLoading = true;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () {
            state.searchLoading = false;
            var slotEl = dash.querySelector('.tma-dash__header-center');
            if (slotEl) updateEmailSearchWrap(slotEl, state);
            reloadMessages(root, state, render);
          }, 180);
        });
        dash.addEventListener('click', function (event) {
          if (event.target.closest('[data-email-search-clear]')) {
            event.preventDefault();
            clearTimeout(searchTimer);
            state.search = '';
            state.searchFocused = true;
            state.searchLoading = false;
            var slot = dash.querySelector('.tma-dash__header-center');
            if (slot) {
              var searchInput = slot.querySelector('[data-email-search]');
              if (searchInput) searchInput.value = '';
              updateEmailSearchWrap(slot, state);
            }
            reloadMessages(root, state, render);
            var focusInput = dash.querySelector('[data-email-search]');
            if (focusInput) focusInput.focus();
            return;
          }
          var searchWrap = event.target.closest('.tma-dash__email-search');
          if (searchWrap && !event.target.matches('[data-email-search]') && !event.target.closest('[data-email-search-clear]')) {
            var slot = dash.querySelector('.tma-dash__header-center');
            if (!state.searchFocused && !state.search) {
              state.searchFocused = true;
              if (slot) updateEmailSearchWrap(slot, state);
            }
            var searchInput = searchWrap.querySelector('[data-email-search]');
            if (searchInput) searchInput.focus();
          }
          if (event.target.closest('[data-email-search-shortcut]')) {
            event.preventDefault();
            var searchInput = dash.querySelector('[data-email-search]');
            if (searchInput) searchInput.focus();
          }
        });
      }
    }

    MORPH.unwired(root, '[data-email-list-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-email-list-tab');
        if (name !== 'folders' && name !== 'labels') return;
        state.sidebarList = name;
        saveSidebarList(name);
        applyEmailSidebarList(root, state);
      });
    });

    MORPH.unwired(root, '[data-email-group-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-email-group-toggle');
        state.sidebarGroups = state.sidebarGroups || {};
        state.sidebarGroups[key] = state.sidebarGroups[key] === false;
        saveSidebarGroups(state.sidebarGroups);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sidebar-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sidebarCollapsed = !state.sidebarCollapsed;
        saveSidebarCollapsed(state.sidebarCollapsed);
        // Closed = gone completely. Icons-only stays a settings choice, not
        // the default for this toggle.
        setMailSidebarMode(
          root, state, render,
          state.sidebarCollapsed ? 'hidden' : 'full'
        );
      });
    });

    MORPH.unwired(root, '[data-email-category]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var category = btn.getAttribute('data-email-category');
        if (!category || state.folder === category) return;
        state.folder = category;
        state.activeLabelId = null;
        state.listFilter = 'all';
        state.filterMenuOpen = false;
        state.reading = false;
        state.selectedId = null;
        clearEmailSelection(state);
        if (category === 'inbox') syncEmailUrl('inbox');
        reloadMessages(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-filter]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        state.filterMenuOpen = !state.filterMenuOpen;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-filter-item]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        state.listFilter = btn.getAttribute('data-email-filter-item') || 'all';
        state.filterMenuOpen = false;
        clearEmailSelection(state);
        render();
      });
    });

    if (!root._emailFilterOutsideBound) {
      root._emailFilterOutsideBound = true;
      root.addEventListener('click', function (event) {
        if (!state.filterMenuOpen) return;
        if (event.target.closest('[data-email-filter-wrap]')) return;
        state.filterMenuOpen = false;
        var menu = root.querySelector('[data-email-filter-menu]');
        var toggle = root.querySelector('[data-email-filter]');
        if (menu) menu.hidden = true;
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    }

    MORPH.unwired(root, '[data-email-detail-topbar]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-email-detail-topbar');
        var id = state.selectedId;
        if (!id || !action) return;
        if (action === 'more') {
          // Was a dead button. Same menu the message head's three dots open.
          openEmailMessageMenu(root, state, render, btn, id);

          return;
        }
        if (action === 'archive' || action === 'inbox' || action === 'delete') {
          applyEmailRowAction(root, state, render, id, action === 'delete' ? mailDeleteDestination(state, id) : action, null);
          return;
        }
        if (action === 'unread') {
          markRowUnread(state, id);
          render();
          return;
        }
        if (action === 'spam') {
          applyEmailRowAction(root, state, render, id, 'spam', null);
        }
      });
    });

    MORPH.unwired(root, '[data-email-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var folder = btn.getAttribute('data-email-folder');
        if (folder === 'compose') {
          openCompose(state, {});
          render();
          return;
        }
        state.folder = folder;
        state.activeLabelId = null;
        state.sidebarList = 'folders';
        saveSidebarList('folders');
        state.listFilter = 'all';
        state.filterMenuOpen = false;
        state.reading = false;
        state.mobileNavOpen = false;
        state.selectedId = null;
        clearEmailSelection(state);
        if (folder === 'templates' || folder === 'inbox') syncEmailUrl(folder);
        reloadMessages(root, state, render);
      });
    });

    // List bulk toolbar lives inside the email root (split + single). Wire it
    // directly so split-mode clicks are never lost to shell event quirks.
    MORPH.unwired(root, '[data-email-bulk-action]').forEach(function (bulkBtn) {
      bulkBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var action = bulkBtn.getAttribute('data-email-bulk-action');
        var ids = emailToolbarTargetIds(state);
        if (!ids.length) return;

        if (action === 'more') {
          if (state.bulkMoreMenuOpen) closeEmailBulkMoreMenu(root, state);
          else openEmailBulkMoreMenu(root, state, bulkBtn);
          ensureEmailMobileHeader(root, state);
          return;
        }

        closeEmailBulkMoreMenu(root, state);

        if (action === 'move') {
          openEmailLabelPopup(root, state, bulkBtn, { bulk: true });
          return;
        }

        applyBulkAction(root, state, render, ids, action);
      });
    });

    MORPH.unwired(root, '[data-email-bulk-more-item]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var item = btn.getAttribute('data-email-bulk-more-item');
        var ids = emailToolbarTargetIds(state);
        if (!ids.length) return;

        if (item === 'label') {
          closeEmailBulkMoreMenu(root, state);
          openEmailLabelPopup(root, state, btn, { bulk: true });
          return;
        }

        if (item === 'snooze') {
          closeEmailBulkMoreMenu(root, state);
          openEmailSnoozeMenu(root, btn, function (iso, label) {
            // Optimistic: every selected row leaves the current view (they
            // are all now snoozed), then the flags are written one by one —
            // snooze is a local flag, so there is no bulk provider call to
            // batch behind.
            var affected = ids.filter(function (rowId) { return !!findRow(state, rowId); });
            state.rows = rowsOf(state).filter(function (row) {
              if (ids.indexOf(row.id) === -1) return true;
              row.snoozedUntil = iso;
              if (state.folder !== 'snoozed') {
                adjustFolderCount(state, state.folder, -1, row.unread);
                adjustFolderCount(state, 'snoozed', 1, row.unread);
              }
              return state.folder === 'snoozed';
            });
            clearEmailSelection(state);
            render();
            showEmailToast(root, affected.length + ' snoozed until ' + label);
            Promise.all(affected.map(function (rowId) {
              return api().setFlags(rowId, { snooze: iso });
            })).catch(function (err) {
              reportMailError(state, err);
              reloadMessages(root, state, render);
            });
          });
          return;
        }

        var MORE_ACTIONS = {
          'unread': 'unread',
          'add-star': 'star',
          'remove-star': 'unstar',
        };

        if (MORE_ACTIONS[item]) {
          applyBulkAction(root, state, render, ids, MORE_ACTIONS[item]);
        }

        closeEmailBulkMoreMenu(root, state);
      });
    });

    var dashBulk = getEmailDashRoot(root);
    if (dashBulk && !dashBulk._emailBulkHeaderBound) {
      dashBulk._emailBulkHeaderBound = true;
      dashBulk.addEventListener('click', function (event) {
        var clearBtn = event.target.closest('[data-email-bulk-clear]');
        if (clearBtn) {
          event.preventDefault();
          event.stopPropagation();
          clearEmailSelection(state);
          render();
          return;
        }

        var bulkBtn = event.target.closest('[data-email-bulk-action]');
        if (!bulkBtn) return;
        event.stopPropagation();
        var action = bulkBtn.getAttribute('data-email-bulk-action');
        var ids = emailToolbarTargetIds(state);
        if (!ids.length) return;

        if (action === 'more') {
          if (state.bulkMoreMenuOpen) {
            closeEmailBulkMoreMenu(root, state);
          } else {
            openEmailBulkMoreMenu(root, state, bulkBtn);
          }
          ensureEmailMobileHeader(root, state);
          return;
        }

        closeEmailBulkMoreMenu(root, state);

        // 'move' opens a picker rather than acting directly; everything else
        // maps straight onto a bulk action.
        if (action === 'move') {
          openEmailLabelPopup(root, state, bulkBtn, { bulk: true });
          return;
        }

        applyBulkAction(root, state, render, ids, action);
      });
    }

    if (!FIRM_TEMPLATES.loaded && !FIRM_TEMPLATES.loading) loadFirmTemplates(render);

    MORPH.unwired(root, '[data-email-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedTemplateId = btn.getAttribute('data-email-template');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-signature]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var draft = findComposeDraft(state, sel.getAttribute('data-email-compose-signature'));
        if (!draft) return;
        var editor = root.querySelector(
          '[data-email-compose-body="' + sel.getAttribute('data-email-compose-signature') + '"]'
        );
        applyComposeSignature(draft, sel.value, editor);
        scheduleDraftSave(state, draft);
      });
    });

    MORPH.unwired(root, '[data-email-compose-template]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var draft = findComposeDraft(state, sel.getAttribute('data-email-compose-template'));
        var template = firmTemplateById(sel.value);
        if (!draft || !template) return;
        draft.subject = template.subject || draft.subject;
        draft.bodyHtml = firmTemplateBodyHtml(template);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-mobile-scrim]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeEmailMobileNav(root, state);
      });
    });

    MORPH.unwired(root, '[data-email-mobile-compose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompose(state, {});
        state.mobileNavOpen = false;
        render();
      });
    });

    var dashMobile = getEmailDashRoot(root);
    if (dashMobile) {
      if (!dashMobile._emailProfileSidebarBound) {
        dashMobile._emailProfileSidebarBound = true;
        dashMobile.addEventListener('click', function (event) {
          var profileSidebarToggle = event.target.closest('[data-email-profile-sidebar-toggle]');
          if (!profileSidebarToggle) return;
          event.stopPropagation();
          if (state.profileSidebarOpen) closeEmailProfileSidebar(state);
          else openEmailProfileSidebar(root, state);
          render();
        });
      }
    }

    if (!root._emailMobileResizeBound) {
      root._emailMobileResizeBound = true;
      var mobileMq = window.matchMedia(EMAIL_MOBILE_MQ);
      var wasMobile = isEmailMobile();
      var onMobileBreakpoint = function () {
        var mobile = isEmailMobile();
        if (mobile !== wasMobile) {
          wasMobile = mobile;
          if (!mobile && state.mobileNavOpen) state.mobileNavOpen = false;
          if (!mobile && state.mobileSearchOpen) resetEmailSidebarSearch(root, state);
          if (!mobile && state.profileSidebarOpen) closeEmailProfileSidebar(state);
          render();
          return;
        }
        if (!mobile && state.mobileNavOpen) {
          state.mobileNavOpen = false;
          render();
        }
        if (!mobile && state.profileSidebarOpen) {
          closeEmailProfileSidebar(state);
          render();
        }
      };
      window.addEventListener('resize', onMobileBreakpoint);
      if (typeof mobileMq.addEventListener === 'function') {
        mobileMq.addEventListener('change', onMobileBreakpoint);
      } else if (typeof mobileMq.addListener === 'function') {
        mobileMq.addListener(onMobileBreakpoint);
      }
    }

    MORPH.unwired(root, '[data-email-layout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var layout = btn.getAttribute('data-email-layout');
        if (layout !== 'split' && layout !== 'single') return;
        if (state.layoutStyle === layout) return;
        state.layoutStyle = layout;
        saveLayoutStyle(layout);
        persistMailPreference(state, 'layout', layout);
        if (layout === 'split') {
          state.reading = false;
        } else if (state.selectedId || (state.folder === 'templates' && state.selectedTemplateId)) {
          state.reading = true;
        } else {
          state.reading = false;
        }
        render();
      });
    });

    var dashRoot = getEmailDashRoot(root);
    var eventRoot = dashRoot || root;

    eventRoot.querySelectorAll('[data-email-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (isComposingInPane(state)) {
          dismissComposePane(root, state, render, function () {
            leaveComposeView(state);
            state.reading = false;
          });
          return;
        }
        state.reading = false;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var nav = getDetailNavState(state);
        if (!nav) return;
        var dir = btn.getAttribute('data-email-nav');
        var id = dir === 'prev' ? nav.prevId : nav.nextId;
        if (!id) return;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });
    });

    MORPH.unwired(root, '[data-email-use-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var template = firmTemplateById(btn.getAttribute('data-email-use-template'));
        if (!template) return;
        openCompose(state, { subject: template.subject, bodyHtml: firmTemplateBodyHtml(template) });
        syncEmailUrl('inbox');
        render();
      });
    });

    MORPH.unwired(root, '[data-email-template-viewport]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.templateViewport = btn.getAttribute('data-email-template-viewport');
        render();
      });
    });

    wireListRows(root, state, render);
    attachSplitResizer(root, state);
  }

  function isEmailSplitResizeEnabled() {
    return window.matchMedia('(min-width: 861px)').matches;
  }

  function applySplitListRatio(panel, ratio) {
    panel.style.setProperty('--email-split-list', Math.round(ratio * 1000) / 10 + '%');
  }

  function attachSplitResizer(root, state) {
    if (root._emailSplitDragCleanup) {
      root._emailSplitDragCleanup();
      root._emailSplitDragCleanup = null;
    }

    var panel = root.querySelector('.tma-dash__email-panel:not(.tma-dash__email-panel--single)');
    var resizer = root.querySelector('[data-email-split-resizer]');
    if (!panel || !resizer || !isEmailSplitResizeEnabled()) return;

    if (typeof state.splitListRatio !== 'number') {
      state.splitListRatio = loadSplitListRatio();
    }

    applySplitListRatio(panel, state.splitListRatio);
    resizer.setAttribute('aria-valuenow', String(Math.round(state.splitListRatio * 100)));

    var dragging = false;

    function updateRatio(clientX) {
      var rect = panel.getBoundingClientRect();
      if (rect.width <= 0) return;
      var ratio = clampSplitRatio((clientX - rect.left) / rect.width);
      state.splitListRatio = ratio;
      applySplitListRatio(panel, ratio);
      resizer.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('tma-dash__email-panel--split-dragging');
      resizer.classList.remove('tma-dash__email-split-resizer--dragging');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      saveSplitListRatio(state.splitListRatio);
    }

    function onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      panel.classList.add('tma-dash__email-panel--split-dragging');
      resizer.classList.add('tma-dash__email-split-resizer--dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      if (typeof resizer.setPointerCapture === 'function') {
        resizer.setPointerCapture(event.pointerId);
      }
      updateRatio(event.clientX);
    }

    function onPointerMove(event) {
      if (!dragging) return;
      event.preventDefault();
      updateRatio(event.clientX);
    }

    function onPointerUp(event) {
      if (!dragging) return;
      if (typeof resizer.releasePointerCapture === 'function' && resizer.hasPointerCapture(event.pointerId)) {
        resizer.releasePointerCapture(event.pointerId);
      }
      stopDrag();
    }

    function onKeyDown(event) {
      var step = 0.04;
      if (event.key === 'ArrowLeft') {
        state.splitListRatio = clampSplitRatio(state.splitListRatio - step);
      } else if (event.key === 'ArrowRight') {
        state.splitListRatio = clampSplitRatio(state.splitListRatio + step);
      } else if (event.key === 'Home') {
        state.splitListRatio = SPLIT_RATIO_MIN;
      } else if (event.key === 'End') {
        state.splitListRatio = SPLIT_RATIO_MAX;
      } else {
        return;
      }
      event.preventDefault();
      applySplitListRatio(panel, state.splitListRatio);
      resizer.setAttribute('aria-valuenow', String(Math.round(state.splitListRatio * 100)));
      saveSplitListRatio(state.splitListRatio);
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    resizer.addEventListener('keydown', onKeyDown);

    root._emailSplitDragCleanup = function () {
      stopDrag();
      resizer.removeEventListener('pointerdown', onPointerDown);
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      resizer.removeEventListener('keydown', onKeyDown);
    };
  }

  function pulseEmailActionBtn(btn) {
    if (!btn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btn.classList.remove('tma-dash__email-row-action--pulse', 'tma-dash__email-detail-important--pulse');
    void btn.offsetWidth;
    if (btn.classList.contains('tma-dash__email-detail-important')) {
      btn.classList.add('tma-dash__email-detail-important--pulse');
    } else {
      btn.classList.add('tma-dash__email-row-action--pulse');
    }
    window.setTimeout(function () {
      btn.classList.remove('tma-dash__email-row-action--pulse', 'tma-dash__email-detail-important--pulse');
    }, 420);
  }

  function mount(root, opts) {
    opts = opts || {};
    var path = window.location.pathname.replace(/\/$/, '');
    var initialFolder = opts.folder || (path === '/email/templates' ? 'templates' : 'inbox');
    var pendingMessageId = opts.messageId || window.__TMA_OPEN_MAIL || null;
    if (window.__TMA_OPEN_MAIL) window.__TMA_OPEN_MAIL = null;

    if (root._emailState && root._emailRender) {
      if (opts.folder) root._emailState.folder = opts.folder;
      // Backfill fields added after the first mount so a soft remount still
      // gets the closed-by-default icon rail and filter state.
      if (typeof root._emailState.sidebarCollapsed !== 'boolean') {
        root._emailState.sidebarCollapsed = loadSidebarCollapsed();
      }
      if (root._emailState.sidebarList !== 'labels' && root._emailState.sidebarList !== 'folders') {
        root._emailState.sidebarList = loadSidebarList();
      }
      if (!root._emailState.sidebarGroups) {
        root._emailState.sidebarGroups = loadSidebarGroups();
      }
      if (!root._emailState.listGroups) {
        root._emailState.listGroups = loadListGroups();
      }
      if (typeof root._emailState.listFilter !== 'string') {
        root._emailState.listFilter = 'all';
      }
      if (typeof root._emailState.filterMenuOpen !== 'boolean') {
        root._emailState.filterMenuOpen = false;
      }
      if (typeof root._emailState.mobileSearchOpen !== 'boolean') {
        root._emailState.mobileSearchOpen = false;
      }
      root._emailToggleMobileNav = function () {
        toggleEmailMobileNav(root, root._emailState);
      };
      root._emailCloseMobileNav = function () {
        closeEmailMobileNav(root, root._emailState);
      };
      if (pendingMessageId) {
        openMailById(root, root._emailState, root._emailRender, pendingMessageId);
        return;
      }

      root._emailRender();

      /*
       * Opening Email is also the moment to retry a boot that failed.
       *
       * The mailbox bootstraps once, at app start, alongside everything else
       * the shell wakes up. One blip there used to leave the page showing
       * "could not reach the mailbox" for the rest of the session, the only
       * way out was a browser refresh, which is exactly the complaint. This
       * re-boots quietly instead, keeping whatever mail is already on screen.
       */
      if (root._emailState.bootstrapFailed || root._emailState.connected === null) {
        bootstrapMailbox(root, root._emailState, root._emailRender);
      }
      return;
    }

    var state = {
      folder: initialFolder,
      composePopout: !!(opts.composePopout || isComposePopoutPath()),
      // Nothing is selected until the first page of real mail arrives.
      selectedId: null,
      selectedTemplateId: null,
      composeDrafts: [],
      nextComposeId: 1,
      focusedComposeId: null,
      templateViewport: 'desktop',
      profileMenuOpen: false,
      search: '',
      searchFocused: false,
      searchLoading: false,

      /* Server-backed mailbox state. Rows carry their own read/star/label
       * flags, so the old shadow maps (readIds, starredIds, rowLabels,
       * removedIds) are gone, checkedIds stays because selection is a
       * property of this view, not of the message. */
      rows: [],
      checkedIds: {},
      folderCounts: {},
      labels: [],
      account: null,
      connected: null,
      loading: true,
      loadError: null,
      loadToken: 0,
      hasMore: false,
      // Server-side paging: the mailbox can hold far more mail than one page.
      page: 1,
      perPage: loadMailPerPage(),
      lastPage: 1,
      total: 0,
      perPageOptions: [25, 50, 100, 200],
      bodyLoading: false,
      /* The open conversation: every message in it, and which have had their
       * quoted history revealed. Null until a message is opened. */
      thread: null,
      threadError: null,
      /* Which message the error belongs to, so selecting another one retries
       * instead of inheriting the failure. */
      threadErrorId: null,
      threadToken: 0,
      refreshing: false,
      settingsOpen: false,
      settingsTab: 'mailbox',
      settings: null,

      hiddenDetailChips: {},
      activeLabelId: null,
      bulkMoreMenuOpen: false,
      labelPopupOpen: false,
      labelPopupRowId: null,
      labelPopupBulk: false,
      labelEditorOpen: false,
      labelEditorId: null,
      layoutStyle: loadLayoutStyle(),
      splitListRatio: loadSplitListRatio(),
      sidebarCollapsed: loadSidebarCollapsed(),
      sidebarMode: loadSidebarMode(),
      sidebarList: loadSidebarList(),
      sidebarGroups: loadSidebarGroups(),
      listGroups: loadListGroups(),
      /* Which conversations the reader has opened in the list, and the
       * messages fetched for them. */
      openConversations: {},
      conversationRows: {},
      inboxCategories: loadInboxCategories(),
      showInboxCategories: true,
      preferences: null,
      listRefreshing: false,
      listFilter: 'all',
      filterMenuOpen: false,
      reading: false,
      inlineCompose: null,
      mobileNavOpen: false,
      mobileSearchOpen: false,
      profileSidebarOpen: false,
      _pendingMessageId: pendingMessageId || null,
    };

    function render() {
      state_active = state;
      if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
      closeEmailBulkMoreMenu(root, state);
      closeEmailLabelPopup(root, state);
      // A menu anchored to a row that is about to be replaced would be left
      // floating over nothing.
      closeEmailPointerMenu();
      if (!isEmailMobile()) state.mobileSearchOpen = false;
      if (!state.composePopout) {
        syncEmailHeaderSearch(root, state);
        ensureEmailMobileHeader(root, state);
      }
      MORPH.patch(root,
        state.composePopout
          ? ('<div class="tma-dash__email-page tma-dash__email-page--popout">' +
            '<div class="tma-dash__email-fit">' +
            '<div class="tma-dash__email-layout">' +
            renderDetail(state) +
            '</div></div></div>')
          : ('<div class="tma-dash__email-page' + (state.mobileNavOpen ? ' tma-dash__email-page--nav-open' : '') + '">' +
            renderEmailMobileChrome(state) +
            renderEmailProfilePopup(state) +
            '<div class="tma-dash__email-fit">' +
            renderEmailToolbar(state) +
            '<div class="tma-dash__email-layout">' +
            renderEmailSidebar(state) +
            renderEmailPanel(state) +
            '</div>' +
            '</div>' +
            renderComposeWindows(state) +
            renderComposeDock(state) +
            renderEmailSettings(state) +
            '</div>'));
      if (!state.composePopout) {
        ensureEmailShellWatch(root);
        lockEmailShellSpacing(root);
        window.requestAnimationFrame(function () { lockEmailShellSpacing(root); });
      }
      wireEvents(root, state, render);
      wireComposeEvents(root, state, render);
      wireInlineComposeEvents(root, state, render);
      wireEditableImageTransforms(root, state);
      wireEmailSettings(root, state, render);
      if (state._focusInlineCompose) {
        state._focusInlineCompose = false;
        window.requestAnimationFrame(function () {
          focusInlineComposeEditor(root);
        });
      }
      if (state._focusCompose) {
        var focusId = state._focusCompose;
        state._focusCompose = null;
        var wait = (state._composeEnter && !emailReduceMotion() && !state.composePopout) ? COMPOSE_PANE_MS : 0;
        window.setTimeout(function () {
          focusPaneCompose(root, focusId);
        }, wait);
      }
      if (state._composeEnter) {
        if (state.composePopout) {
          state._composeEnter = false;
        } else {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              var overlay = root.querySelector('[data-email-compose-overlay]');
              state._composeEnter = false;
              if (overlay) overlay.classList.add('is-open');
            });
          });
        }
      }
      if (state.profileMenuOpen) {
        var profileToggle = root.querySelector('.tma-dash__email-profile-wrap--sidebar [data-email-profile-toggle]');
        if (profileToggle) openEmailProfileMenu(root, state, profileToggle);
        else state.profileMenuOpen = false;
      }
      if (state.profileSidebarOpen) {
        var dashRoot = getEmailDashRoot(root);
        var headerProfileToggle =
          dashRoot && dashRoot.querySelector('[data-email-profile-sidebar-toggle]');
        var profilePopup = root.querySelector('[data-email-profile-popup-card]');
        if (headerProfileToggle && profilePopup) {
          positionEmailProfilePopup(headerProfileToggle, profilePopup);
        } else {
          state.profileSidebarOpen = false;
        }
      }
      var dash = getEmailDashRoot(root);
      var searchInput = dash && dash.querySelector('[data-email-search]');
      if (searchInput && state.searchFocused) {
        searchInput.focus();
        var len = searchInput.value.length;
        if (typeof searchInput.setSelectionRange === 'function') searchInput.setSelectionRange(len, len);
      }
      if (window.PortalTooltip) window.PortalTooltip.init();
      var dashRoot = getEmailDashRoot(root);
      if (dashRoot) {
        ensureEmailToast(dashRoot);
        // A prior bug left orphan body toasts stuck visible with no hide timer.
        // Undo-send stays up on purpose until the countdown ends or they undo.
        if (!showEmailToast._hideTimer && !showEmailToast._persist) hideEmailToast();
      }
      if (dashRoot && typeof dashRoot._syncTabBarBadges === 'function') dashRoot._syncTabBarBadges();
      announceInboxUnread(state);
    }

    root._emailState = state;
    root._emailRender = render;

    // Handlers that only hold `state` still need to repaint and to reach the
    // toast host, so both travel with it.
    state.root = root;
    state.render = render;
    state.reload = function () { reloadMessages(root, state, render); };

    root._emailToggleMobileNav = function () {
      toggleEmailMobileNav(root, state);
    };
    root._emailCloseMobileNav = function () {
      closeEmailMobileNav(root, state);
    };

    // Paint what the last visit ended on before touching the network, so a
    // reload comes back to real mail rather than to a skeleton. Nothing here
    // is trusted: the bootstrap below overwrites all of it either way.
    hydrateFromCache(state);

    if (state.composePopout) {
      var dashPop = getEmailDashRoot(root);
      if (dashPop) dashPop.classList.add('tma-dash--compose-popout');
      document.documentElement.classList.add('tma-dash--compose-popout');
      try { document.title = 'New Email'; } catch (e) { /* ignore */ }
      adoptComposePopoutDraft(state);
    }

    // Paint the shell first (sidebar, chrome, whatever the cache had), then
    // fill it from the server, the page should never look blank while it
    // waits.
    bindCurrentUser(render);
    render();
    bootstrapMailbox(root, state, render);
    // Show the sync's stage and counts, bottom-right.
    stopSyncPolling();
    pollSyncStatus();

    // Landing back from the OAuth connect flow: confirm the connection
    // immediately (the analysis is already running server-side) and strip
    // the notice from the URL so a refresh doesn't repeat it. Also captures
    // a snooze-reminder deep link (?message=uuid) for bootstrap to open.
    try {
      var mailParams = new URLSearchParams(window.location.search);
      var mailNotice = mailParams.get('notice');
      var mailMessage = mailParams.get('message');
      // Reply / Reply all / Forward in the standalone conversation window come
      // back here as ?compose=, since composing belongs in the mailbox.
      var mailCompose = mailParams.get('compose');
      if (!state.composePopout && (mailCompose === 'reply' || mailCompose === 'reply-all' || mailCompose === 'forward')) {
        state._pendingCompose = mailCompose;
      }
      if (!state.composePopout) {
        if (mailMessage) state._pendingMessageId = mailMessage;
        else if (pendingMessageId) state._pendingMessageId = pendingMessageId;
      }
      if (mailNotice === 'mail-connected' || mailNotice === 'mail-error' || mailMessage) {
        var mailReason = mailParams.get('reason');
        mailParams.delete('notice');
        mailParams.delete('reason');
        mailParams.delete('message');
        mailParams.delete('compose');
        var qs = mailParams.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
        if (mailNotice === 'mail-connected' || mailNotice === 'mail-error') {
          setTimeout(function () {
            showEmailToast(root, mailNotice === 'mail-connected'
              ? 'Mailbox connected successfully, analyzing your mailbox…'
              : (mailReason || 'The mailbox could not be connected.'));
          }, 300);
        }
      }
    } catch (e) { /* URL handling is cosmetic; never block the page on it. */ }

    // New mail shows up on its own, like a real inbox, quiet background
    // poll, no spinner, no toast.
    scheduleMailPoll(root, state, render);
    if (!root._mailPollVisibilityBound) {
      root._mailPollVisibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        // Catch up immediately instead of waiting out whatever's left of
        // the interval from before the tab was hidden.
        if (!document.hidden) pollNewMail(root, state, render);
      });
    }

    // When a snooze reminder fires, put the woken message back into the
    // open list without waiting for the next poll tick.
    if (!root._snoozeWakeBound) {
      root._snoozeWakeBound = true;
      window.addEventListener('tma:notification-arrived', function (event) {
        var item = event && event.detail;
        if (!item || item.type !== 'email.snooze_due') return;
        if (!state.connected) return;
        if (state.folder === 'snoozed' || state.folder === 'inbox' || state.folder === 'important') {
          reloadMessages(root, state, render);
        } else {
          pollNewMail(root, state, render);
        }
      });
    }
  }

  /*
   * Ask for the mailbox now, before the shell finishes building itself, and
   * long before anyone clicks Email.
   *
   * This file is deferred, so the DOM is already parsed here but the portal's
   * own boot work (a few hundred milliseconds of synchronous rendering across
   * a dozen modules) has not run yet. Two requests in flight across that gap
   * is most of the difference between an inbox that is ready when opened and
   * one that starts loading when opened.
   */
  primeMailbox();

  window.TMAEmail = {
    mount: mount,
    timeLabel: emailTimeLabel,
    /* Reload the mailbox in place, the shell's refresh gesture, which must
       not re-mount and so must not close the message being read. */
    refresh: function (rootEl) {
      var root = rootEl || document.querySelector('[data-email]');
      if (!root || !root._emailState || !root._emailRender) return Promise.resolve();
      return refreshMailbox(root, root._emailState, root._emailRender);
    },
    restoreHeaderSearch: restoreHeaderSearch,
    getInboxUnreadCount: getInboxUnreadCount,
    getPageTitle: getPageTitle,
    /* Open a specific message from a notification / toast deep-link. */
    openMessage: function (rootOrId, maybeId) {
      var root = document.querySelector('[data-email]');
      var id = maybeId;
      if (typeof rootOrId === 'string') id = rootOrId;
      else if (rootOrId && rootOrId.nodeType) root = rootOrId;
      if (!root || !id || !root._emailState || !root._emailRender) return;
      openMailById(root, root._emailState, root._emailRender, id);
    },
    /* Swap a broken directory photo for a single initials tile, never leave
     * two circles side by side. */
    _suggestPhotoFallback: function (img) {
      if (!img || !img.parentNode) return;
      img.onerror = null;
      var span = document.createElement('span');
      span.className = 'tma-dash__email-suggest-avatar tma-dash__email-suggest-avatar--initial';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = img.getAttribute('data-email-suggest-initial') || '?';
      var color = img.getAttribute('data-email-suggest-color');
      if (color) {
        span.style.background = color;
        span.style.color = '#fff';
      }
      img.parentNode.replaceChild(span, img);
    },
  };
})();
