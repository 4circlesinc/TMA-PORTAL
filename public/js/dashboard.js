/*
 * TMA - Dashboard application controller
 * Wires navigation, header controls, theme, search palette, and drawers.
 * Global: window.TMADashboard
 *
 * Menu order source of truth: resources/views/pages/dashboard.html
 * (served for / and all SPA routes via LegacyPageController::SPA_PAGES).
 * There is no user-reorderable menu preference — do not invent one in
 * localStorage. Shell version below forces browsers to drop stale HTML caches
 * when the approved order changes.
 */
(function () {
  'use strict';

  var NAV_SHELL_VERSION = '2026-07-24-menu-v3';
  var SIDEBAR_BP = 1024; // sidebar becomes a drawer at/below this width
  var RIGHTBAR_BP = 1024; // rightbar becomes a drawer at/below this width (match sidebar)

  /* Official order — stable data-nav / data-expand ids. Permissions may hide
     items but must not change relative order. Enforced on every mount so a
     stale cached shell cannot keep an old arrangement on screen. */
  var APPROVED_PRIMARY_NAV = [
    'dash-dashboard',
    'dash-project-overview',
    'clients',
    'email',
    'so-messages',
    'so-feed',
    'calendar',
    'signatures',
    'folders',
  ];
  var APPROVED_PAGES_NAV = [
    'users',
    'templates',
    'projects',
    'workflows',
    'people',
    'account-settings',
  ];
  var APPROVED_MOBILE_PRIMARY = APPROVED_PRIMARY_NAV.map(function (id) {
    return id === 'folders' ? 'folders-personal' : id;
  });
  var APPROVED_MOBILE_PAGES = [
    'users',
    'templates',
    'projects-all',
    'workflows-automated',
    'people-home',
    'account-settings',
  ];

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // Drop any legacy keys that once tried to persist a custom menu order.
  try {
    ['tma.menuOrder', 'tma.navOrder', 'tma.sidebarOrder', 'tma.menuItems'].forEach(function (k) {
      localStorage.removeItem(k);
    });
    if (store.get('tma.navShellVersion', '') !== NAV_SHELL_VERSION) {
      store.set('tma.navShellVersion', NAV_SHELL_VERSION);
    }
  } catch (e) { /* ignore */ }

  function navKey(el) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute('data-nav') || el.getAttribute('data-expand') || '';
  }

  function takeNavBlock(map, id) {
    var el = map[id];
    if (!el) return null;
    var nodes = [el];
    // Expandable groups keep their subnav sibling immediately after.
    if (el.getAttribute('data-expand') && el.nextElementSibling &&
        el.nextElementSibling.getAttribute('data-subnav') === id) {
      nodes.push(el.nextElementSibling);
    }
    return nodes;
  }

  function enforceApprovedSidebarOrder(root) {
    var sections = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__sidebar .tma-dash__nav-section[data-list="main"]'));
    if (sections.length < 2) return;

    var primarySection = sections[0];
    var pagesSection = null;
    for (var s = 0; s < sections.length; s++) {
      if (sections[s].querySelector('.tma-dash__group-label')) {
        pagesSection = sections[s];
        break;
      }
    }
    if (!pagesSection) pagesSection = sections[1];

    var map = {};
    root.querySelectorAll('.tma-dash__sidebar .tma-dash__nav-item[data-nav], .tma-dash__sidebar .tma-dash__nav-item[data-expand]').forEach(function (el) {
      var key = navKey(el);
      if (key) map[key] = el;
    });

    var label = pagesSection.querySelector('.tma-dash__group-label');

    APPROVED_PRIMARY_NAV.forEach(function (id) {
      var nodes = takeNavBlock(map, id);
      if (!nodes) return;
      nodes.forEach(function (n) { primarySection.appendChild(n); });
    });

    if (label) pagesSection.appendChild(label);
    APPROVED_PAGES_NAV.forEach(function (id) {
      var nodes = takeNavBlock(map, id);
      if (!nodes) return;
      nodes.forEach(function (n) { pagesSection.appendChild(n); });
    });
  }

  function enforceApprovedMobileOrder(root) {
    var cards = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__mmenu-card'));
    if (cards.length < 2) return;

    // Favorites card (optional) then Dashboards then Pages then Account.
    var dashCard = null;
    var pagesCard = null;
    cards.forEach(function (card) {
      if (card.querySelector('[data-nav="dash-dashboard"]')) dashCard = card;
      else if (card.querySelector('[data-nav="account-settings"]') && card.querySelector('[data-nav="users"], [data-nav="templates"], [data-nav="projects-all"]')) pagesCard = card;
    });
    if (!pagesCard) {
      cards.forEach(function (card) {
        if (card.querySelector('[data-nav="account-settings"]') && card !== dashCard) pagesCard = card;
      });
    }
    if (!dashCard || !pagesCard) return;

    var map = {};
    root.querySelectorAll('.tma-dash__mmenu [data-mrow][data-nav]').forEach(function (el) {
      map[el.getAttribute('data-nav')] = el;
    });

    APPROVED_MOBILE_PRIMARY.forEach(function (id) {
      if (map[id]) dashCard.appendChild(map[id]);
    });
    APPROVED_MOBILE_PAGES.forEach(function (id) {
      if (map[id]) pagesCard.appendChild(map[id]);
    });
  }

  function enforceApprovedMenuOrder(root) {
    try {
      enforceApprovedSidebarOrder(root);
      enforceApprovedMobileOrder(root);
    } catch (e) { /* never block the app on menu repair */ }
  }

  var ACCENT_COLORS = {
    indigo: '#136da0', /* TMA brand blue (accent id kept as "indigo" for stored prefs) */
    yellow: '#ffcc00',
    red: '#ff4747',
    blue: '#7dbbff',
    orange: '#ffb55b',
    green: '#71dd8c',
  };

  function getThemeMode() {
    var mode = store.get('tma.themeMode', '');
    if (mode === 'system' || mode === 'light' || mode === 'dark') return mode;
    var legacy = store.get('tma.theme', '');
    if (legacy === 'dark' || legacy === 'light') return legacy;
    return 'system';
  }

  function resolveTheme(mode) {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode === 'dark' ? 'dark' : 'light';
  }

  function getFontScale() {
    var scale = parseInt(store.get('tma.fontScale', '3'), 10);
    return scale >= 1 && scale <= 5 ? scale : 3;
  }

  function getAccentColor() {
    var color = store.get('tma.accentColor', 'indigo');
    return ACCENT_COLORS[color] ? color : 'indigo';
  }

  function getSidebarStyle() {
    return store.get('tma.sidebarStyle', '') === 'standard' ? 'standard' : 'hover';
  }

  function mount(root) {
    if (!root) return;

    enforceApprovedMenuOrder(root);

    var sidebar = root.querySelector('.tma-dash__sidebar');
    // Programmatically focusable (but not Tab-reachable) so toggleSidebar()
    // can pin the hover-expand overlay open for click/keyboard users.
    if (sidebar && !sidebar.hasAttribute('tabindex')) sidebar.setAttribute('tabindex', '-1');
    var scrim = root.querySelector('[data-dash-scrim]');
    var breadcrumbEl = root.querySelector('[data-breadcrumb]');
    var pageTitleEl = root.querySelector('[data-page-title]');
    var backBtn = root.querySelector('[data-page-back]');
    var leaves = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__nav-item[data-nav]:not([hidden])'));

    /* Nested views that show a back button in the page header */
    var addDataSourceNav = 'users';

    function backRouteForAddData() {
      return { navId: 'users', view: 'users', title: 'Users', crumb: 'Users' };
    }

    function siteRoot() {
      return window.__TMA_SITE_ROOT || '';
    }

    function appUrl(path) {
      var p = String(path == null ? '/' : path);
      if (!p || p === '/') return siteRoot() || '/';
      if (p.charAt(0) !== '/') p = '/' + p;
      return siteRoot() + p;
    }

    function prefixRootAnchors() {
      var root = siteRoot();
      if (!root) return;
      Array.prototype.slice.call(document.querySelectorAll('a[href^="/"]')).forEach(function (a) {
        var href = a.getAttribute('href');
        if (href && href.indexOf(root) !== 0) a.setAttribute('href', root + href);
      });
    }

    function normalizePath(path) {
      var p = String(path || '').replace(/\/index\.html$/i, '');
      var root = siteRoot();
      if (root && p.indexOf(root) === 0) p = p.slice(root.length) || '/';
      if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
      return p || '/';
    }

    function routeFromPath(path) {
      var p = normalizePath(path);
      if (p === '/users/new') {
        return {
          navId: 'users',
          view: 'add-data',
          title: 'New entry',
          crumb: 'Users / New',
        };
      }
      if (p === '/users') {
        return {
          navId: 'users',
          view: 'users',
          title: 'Users',
          crumb: 'Users',
        };
      }
      if (p === '/projects') {
        return {
          navId: 'dash-projects',
          view: 'projects',
          title: 'My Projects',
          crumb: 'Dashboards / Projects',
        };
      }
      if (p === '/overview') {
        return {
          navId: 'dash-project-overview',
          view: 'overview',
          title: 'Project Overview',
          crumb: 'Dashboard / Overview',
        };
      }
      if (p === '/account') {
        return {
          navId: 'ac-overview',
          view: 'account',
          title: 'Overview',
          crumb: 'Account / Overview',
        };
      }
      if (p === '/settings/change-email') {
        return {
          navId: 'settings',
          view: 'settings',
          title: 'Settings',
          crumb: 'Settings',
          openChangeEmail: true,
        };
      }
      if (p === '/account-settings') {
        return {
          navId: 'account-settings',
          view: 'admin',
          title: 'Settings',
          crumb: 'Settings',
        };
      }
      if (p === '/settings') {
        var settingsParams = typeof URLSearchParams !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : null;
        return {
          navId: 'settings',
          view: 'settings',
          title: 'Settings',
          crumb: 'Settings',
          settingsNav: settingsParams && settingsParams.get('nav'),
          paymentAdded: settingsParams && settingsParams.get('paymentAdded') === '1',
        };
      }
      if (p === '/email') {
        return {
          navId: 'email',
          view: 'email',
          title: 'Email',
          crumb: 'Email',
        };
      }
      if (p === '/email/templates') {
        return {
          navId: 'email',
          view: 'email',
          title: 'Email',
          crumb: 'Email / Templates',
          emailFolder: 'templates',
        };
      }
      if (p === '/social/messages') {
        return {
          navId: 'so-messages',
          view: 'messages',
          title: 'Messages',
          crumb: 'Messages',
        };
      }
      if (p === '/social/feed') {
        return {
          navId: 'so-feed',
          view: 'feed',
          title: 'Feed',
          crumb: 'Social / Feed',
        };
      }
      if (p === '/clients/new') {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'New client',
          crumb: 'Clients / New',
          clientsScreen: 'add',
        };
      }
      var clientsEditMatch = p.match(/^\/clients\/([^/]+)\/edit$/);
      if (clientsEditMatch) {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Client',
          crumb: 'Clients',
          clientsScreen: 'edit',
          contactId: decodeURIComponent(clientsEditMatch[1]),
        };
      }
      var clientsDetailMatch = p.match(/^\/clients\/([^/]+)$/);
      if (clientsDetailMatch) {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Client',
          crumb: 'Clients',
          clientsScreen: 'detail',
          contactId: decodeURIComponent(clientsDetailMatch[1]),
        };
      }
      if (p === '/clients' || p === '/user-profile/clients') {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Clients',
          crumb: 'Clients',
          clientsScreen: 'list',
        };
      }
      if (p === '/contacts/new') {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'New client',
          crumb: 'Clients / New',
          clientsScreen: 'add',
          legacyRedirect: true,
        };
      }
      var legacyClientsEditMatch = p.match(/^\/contacts\/([^/]+)\/edit$/);
      if (legacyClientsEditMatch) {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Client',
          crumb: 'Clients',
          clientsScreen: 'edit',
          contactId: decodeURIComponent(legacyClientsEditMatch[1]),
          legacyRedirect: true,
        };
      }
      var legacyClientsDetailMatch = p.match(/^\/contacts\/([^/]+)$/);
      if (legacyClientsDetailMatch) {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Client',
          crumb: 'Clients',
          clientsScreen: 'detail',
          contactId: decodeURIComponent(legacyClientsDetailMatch[1]),
          legacyRedirect: true,
        };
      }
      if (p === '/contacts' || p === '/user-profile/contacts') {
        return {
          navId: 'clients',
          view: 'clients',
          title: 'Clients',
          crumb: 'Clients',
          clientsScreen: 'list',
          legacyRedirect: true,
        };
      }
      if (p === '/calendar') {
        return {
          navId: 'calendar',
          view: 'calendar',
          title: 'Calendar',
          crumb: 'Calendar',
        };
      }
      if (p === '/pricing') {
        return {
          navId: 'pricing',
          view: 'pricing',
          title: 'Pricing',
          crumb: 'Dashboards / Pricing',
        };
      }
      if (p === '/') {
        return { navId: 'dash-dashboard', view: 'dashboard', title: 'Dashboard', crumb: 'Dashboard' };
      }
      /* Generic fallback: any sidebar leaf whose href matches the path */
      var genericLeaf = leaves.filter(function (l) {
        var href = l.getAttribute('href') || '';
        return href.charAt(0) === '/' && normalizePath(href) === p;
      })[0];
      if (genericLeaf) {
        return {
          navId: genericLeaf.getAttribute('data-nav'),
          view: genericLeaf.getAttribute('data-view') || 'dashboard',
          title: genericLeaf.getAttribute('data-title'),
          crumb: genericLeaf.getAttribute('data-crumb'),
        };
      }
      return null;
    }

    function clientsPathFor(screen, contactId) {
      if (screen === 'add') return '/clients/new';
      if (screen === 'edit' && contactId) {
        return '/clients/' + encodeURIComponent(contactId) + '/edit';
      }
      if (screen === 'detail' && contactId) {
        return '/clients/' + encodeURIComponent(contactId);
      }
      return '/clients';
    }

    function pathForRoute(navId, view, extra) {
      extra = extra || {};
      if (view === 'clients' || navId === 'clients') {
        return clientsPathFor(extra.clientsScreen || 'list', extra.contactId);
      }
      if (view === 'users' || navId === 'users') return '/users';
      if (view === 'add-data') return '/users/new';
      if (view === 'overview' || navId === 'dash-project-overview') return '/overview';
      if (view === 'settings' || navId === 'settings' || navId === 'ac-settings') {
        return '/settings';
      }
      if (view === 'account' || navId === 'ac-overview' || navId === 'ac-security' || navId === 'ac-billing' || navId === 'ac-statements' || navId === 'ac-referrals' || navId === 'ac-api-keys' || navId === 'ac-logs') return '/account';
      if (view === 'projects' || navId === 'dash-projects' || navId === 'fav-projects') return '/projects';
      if (view === 'email' || navId === 'email') {
        if (normalizePath(window.location.pathname) === '/email/templates') return '/email/templates';
        return '/email';
      }
      if (view === 'messages' || navId === 'so-messages') return '/social/messages';
      if (view === 'feed' || navId === 'so-feed') return '/social/feed';
      if (view === 'calendar' || navId === 'calendar') return '/calendar';
      if (view === 'pricing' || navId === 'pricing') return '/pricing';
      /* Generic fallback: use the sidebar leaf's href for this nav id */
      var leafForNav = leaves.filter(function (l) { return l.getAttribute('data-nav') === navId; })[0];
      if (leafForNav) {
        var leafHref = leafForNav.getAttribute('href');
        if (leafHref && leafHref.charAt(0) === '/') return leafHref;
      }
      return '/';
    }

    function syncUrl(opts) {
      if (opts.skipUrl) return;
      if (window.TMA_CLASSIC) return; /* classic shell lives at /classic - no URL sync */
      var next = pathForRoute(opts.navId, opts.view, opts);
      var current = normalizePath(window.location.pathname);
      if (current === next) return;
      history.pushState(
        {
          navId: opts.navId,
          view: opts.view,
          title: opts.title,
          crumb: opts.crumb,
          clientsScreen: opts.clientsScreen,
          contactId: opts.contactId,
        },
        '',
        appUrl(next)
      );
    }

    /* ── helpers ───────────────────────────────── */
    function isMobileSidebar() { return window.innerWidth <= SIDEBAR_BP; }
    function isMobileRightbar() { return window.innerWidth <= RIGHTBAR_BP; }

    function closeEmailMobileNav() {
      var emailMount = root.querySelector('[data-email]');
      if (emailMount && emailMount._emailCloseMobileNav) emailMount._emailCloseMobileNav();
    }

    function closeDrawers() {
      root.classList.remove('is-nav-open', 'is-rb-open');
      resetMobileSidebarSearch();
      closeEmailMobileNav();
    }

    function resetMobileSidebarSearch() {
      if (!sidebar) return;
      if (sidebar._sidebarSearch && sidebar._sidebarSearch.isOpen()) {
        sidebar._sidebarSearch.close();
        return;
      }
      sidebar.classList.remove('tma-dash__sidebar--mobile-search');
      var panel = sidebar.querySelector('[data-sidebar-search-panel]');
      if (panel) panel.hidden = true;
    }

    function setupMobileSidebarHead() {
      if (!sidebar || sidebar.querySelector('[data-sidebar-mobile-head]')) return;

      var head = document.createElement('div');
      head.className = 'tma-dash__sidebar-mobile-head';
      head.setAttribute('data-sidebar-mobile-head', '');

      var searchTrigger = document.createElement('button');
      searchTrigger.type = 'button';
      searchTrigger.className = 'tma-dash__sidebar-mobile-search';
      searchTrigger.setAttribute('data-sidebar-mobile-search-toggle', '');
      searchTrigger.setAttribute('aria-label', 'Search');
      searchTrigger.innerHTML =
        '<img src="images/icons/tma/Search-16.svg" alt="" aria-hidden="true">' +
        '<span class="tma-dash__search-text">Search</span>';

      var logo = sidebar.querySelector('.tma-dash__sidebar-logo');
      if (logo) sidebar.insertBefore(head, logo);
      else sidebar.insertBefore(head, sidebar.firstChild);
      head.appendChild(searchTrigger);

      if (!sidebar.querySelector('[data-sidebar-search-panel]')) {
        var panel = document.createElement('div');
        panel.className = 'tma-dash__sidebar-search-panel';
        panel.setAttribute('data-sidebar-search-panel', '');
        panel.hidden = true;
        panel.innerHTML = '<div class="tma-dash__sidebar-search-mount" data-sidebar-search-mount></div>';
        var profile = sidebar.querySelector('.tma-dash__profile');
        if (profile) sidebar.insertBefore(panel, profile);
        else sidebar.appendChild(panel);
      }
    }

    function setupMobileHeaderLogo() {
      var headerCenter = root.querySelector('.tma-dash__header-center');
      if (!headerCenter) return;

      function syncHeaderLogo() {
        var existing = headerCenter.querySelector('[data-header-logo]');
        if (!isMobileSidebar()) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;

        var logo = document.createElement('a');
        logo.className = 'tma-dash__header-logo';
        logo.setAttribute('data-header-logo', '');
        logo.href = appUrl(window.TMA_CLASSIC ? '/classic' : '/');
        logo.setAttribute('aria-label', 'TM ANTOINE Advisory home');
        logo.innerHTML =
          '<span class="tma-dash__logo-expanded">' +
          '<img class="tma-dash__logo-horizontal" src="images/brand/tma/tma-logo-horizontal.png" alt="" loading="lazy">' +
          '</span>' +
          '<span class="tma-dash__logo-collapsed">' +
          '<img class="tma-dash__logo-mark" src="images/brand/tma/tma-logo-mark.png" alt="TM ANTOINE Advisory" width="32" height="32" loading="lazy">' +
          '</span>';

        headerCenter.insertBefore(logo, headerCenter.firstChild);
      }

      syncHeaderLogo();
      window.addEventListener('resize', syncHeaderLogo, { passive: true });
    }

    function syncMobileHeaderScrollNow() {
      if (!isMobileSidebar()) {
        root.classList.remove('is-header-scrolled');
        root.style.removeProperty('--header-logo-progress');
        return;
      }
      var mainEl = root.querySelector('.tma-dash__main');
      if (!mainEl) {
        root.classList.remove('is-header-scrolled');
        root.style.removeProperty('--header-logo-progress');
        return;
      }

      var scrollTop = mainEl.scrollTop;
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduceMotion) {
        root.style.removeProperty('--header-logo-progress');
        root.classList.toggle('is-header-scrolled', scrollTop > 24);
        return;
      }

      var start = 6;
      var end = 92;
      var raw = Math.min(1, Math.max(0, (scrollTop - start) / (end - start)));
      var progress = raw * raw * (3 - 2 * raw);
      root.style.setProperty('--header-logo-progress', progress.toFixed(4));
      root.classList.toggle('is-header-scrolled', progress > 0.45);
    }

    var mobileHeaderScrollRaf = null;
    function syncMobileHeaderScroll() {
      if (mobileHeaderScrollRaf != null) return;
      mobileHeaderScrollRaf = requestAnimationFrame(function () {
        mobileHeaderScrollRaf = null;
        syncMobileHeaderScrollNow();
      });
    }

    function setupMobileHeaderScroll() {
      var mainEl = root.querySelector('.tma-dash__main');
      if (!mainEl || mainEl.getAttribute('data-header-scroll-wired')) return;
      mainEl.setAttribute('data-header-scroll-wired', '1');
      mainEl.addEventListener('scroll', syncMobileHeaderScroll, { passive: true });
      syncMobileHeaderScroll();
    }

    function wireMobileSidebarSearch(searchIndex) {
      if (!sidebar || !window.TMAGlobalSearch || !window.TMAGlobalSearch.mountSidebarSearch) return;
      var head = sidebar.querySelector('[data-sidebar-mobile-head]');
      if (!head || head.getAttribute('data-sidebar-search-wired')) return;
      head.setAttribute('data-sidebar-search-wired', '');

      var searchTrigger = head.querySelector('[data-sidebar-mobile-search-toggle]');
      var panel = sidebar.querySelector('[data-sidebar-search-panel]');
      var mount = sidebar.querySelector('[data-sidebar-search-mount]');
      if (!searchTrigger || !panel || !mount) return;

      var sidebarSearch = window.TMAGlobalSearch.mountSidebarSearch(mount, {
        index: searchIndex,
        onNavigate: function (item) {
          if (item.navId) {
            activate(item.navId, {});
          } else if (item.href && String(item.href).charAt(0) === '#') {
            activate(String(item.href).slice(1), {});
          }
        },
        onClose: function () {
          sidebar.classList.remove('tma-dash__sidebar--mobile-search');
          panel.hidden = true;
        },
      });
      sidebar._sidebarSearch = sidebarSearch;

      function openSidebarSearch() {
        sidebar.classList.add('tma-dash__sidebar--mobile-search');
        panel.hidden = false;
        if (sidebarSearch) sidebarSearch.open();
      }

      searchTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (sidebar.classList.contains('tma-dash__sidebar--mobile-search')) {
          resetMobileSidebarSearch();
          return;
        }
        openSidebarSearch();
      });
    }

    setupMobileSidebarHead();
    setupMobileHeaderLogo();
    setupMobileHeaderScroll();
    setupSidebarProfileActions();

    function setupSidebarProfileActions() {
      if (!sidebar) return;
      var profile = sidebar.querySelector('.tma-dash__profile');
      if (!profile || profile.querySelector('[data-sidebar-profile-actions]')) return;

      var avatar = profile.querySelector('.tma-dash__profile-avatar');
      var meta = profile.querySelector('.tma-dash__profile-meta');
      if (!avatar || !meta) return;

      profile.classList.add('tma-dash__profile--with-actions');

      var main = document.createElement('div');
      main.className = 'tma-dash__profile-main';
      profile.insertBefore(main, avatar);
      main.appendChild(avatar);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'tma-dash__profile-actions';
      actions.setAttribute('data-sidebar-profile-actions', '');
      actions.innerHTML =
        '<button type="button" class="tma-dash__profile-action-btn" data-sidebar-profile-action="logout" aria-label="Log out">' +
        '<img src="images/icons/phosphor/SignOut.svg" alt="" aria-hidden="true"></button>';
      profile.appendChild(actions);
    }

    var mmenu = root.querySelector('[data-mmenu]');
    function closeMobileMenu() {
      if (mmenu) mmenu.hidden = true;
      closeDrawers();
    }
    function toggleNavDrawer() {
      var open = root.classList.contains('is-nav-open');
      closeDrawers();
      if (mmenu) mmenu.hidden = true;
      if (!open) root.classList.add('is-nav-open');
    }
    function openRightbarDrawer() { closeDrawers(); root.classList.add('is-rb-open'); }

    var todayWrap = root.querySelector('[data-today-dropdown]');
    var viewToggleWrap = root.querySelector('[data-page-view-toggle]');
    var mainHead = root.querySelector('.tma-dash__main-head');
    function syncBackButton(viewName) {
      if (!backBtn) return;
      var route = viewName === 'add-data' ? backRouteForAddData() : null;
      backBtn.hidden = !route;
      backBtn._route = route;
    }

    function getViewElements() {
      var main = root.querySelector('.tma-dash__main');
      if (main) {
        return Array.prototype.slice.call(main.querySelectorAll('.tma-dash__view'));
      }
      return Array.prototype.slice.call(root.querySelectorAll('.tma-dash__view'));
    }

    function showView(name) {
      var viewEls = getViewElements();
      if (!name || !viewEls.some(function (v) { return v.getAttribute('data-view') === name; })) {
        name = 'dashboard';
      }
      if (viewEls.length) {
        viewEls.forEach(function (v) {
          if (!v.hidden && v.getAttribute('data-view') === 'add-data' && name !== 'add-data') {
            var addRoot = document.querySelector('[data-add-data-page]');
            if (addRoot && typeof addRoot._addDataStageFromForm === 'function') {
              addRoot._addDataStageFromForm();
            }
          }
        });
        viewEls.forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; });
      }
      syncBackButton(name);
      if (todayWrap) todayWrap.style.display = (name === 'dashboard' || name === 'projects') ? '' : 'none';
      var portalChromeless = ['client-hub', 'folders', 'projects-hub', 'workflows', 'templates', 'signatures', 'inbox', 'people', 'admin', 'dashboard'];
      var hideMainChrome = name === 'overview' || name === 'account' || name === 'messages' || name === 'feed' || name === 'email' || name === 'calendar' || name === 'pricing' || name === 'settings' || portalChromeless.indexOf(name) !== -1;
      if (mainHead) mainHead.style.display = hideMainChrome ? 'none' : '';
      if (pageTitleEl) {
        var mainHeadLeft = pageTitleEl.closest('.tma-dash__main-head-left');
        if (mainHeadLeft) mainHeadLeft.style.display = hideMainChrome ? 'none' : '';
      }
      root.classList.toggle('tma-dash--settings', name === 'settings');
      root.classList.toggle('tma-dash--email', name === 'email');
      root.classList.toggle('tma-dash--messages', name === 'messages');
      root.classList.toggle('tma-dash--feed', name === 'feed');
      root.classList.toggle('tma-dash--calendar', name === 'calendar');
      root.classList.toggle('tma-dash--clients', name === 'clients');
      /* Always clear signature-wizard scroll lock when leaving that flow.
         A stuck tma-dash--signatures-wizard class kills content scrolling. */
      if (name !== 'signatures') {
        if (window.TMAPortalSignatures && window.TMAPortalSignatures.closeWizardChrome) {
          window.TMAPortalSignatures.closeWizardChrome();
        } else if (window.TMAPortalSignatures && window.TMAPortalSignatures.clearLock) {
          window.TMAPortalSignatures.clearLock();
        } else {
          root.classList.remove('tma-dash--signatures-wizard');
          document.documentElement.classList.remove('tma-dash--signatures-wizard');
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
        }
      }
      if (name !== 'clients') {
        root.classList.remove('tma-dash--clients-detail');
      }
      if (name !== 'calendar') {
        root.classList.remove('tma-dash--calendar-panel-open');
      }
      if (name !== 'email') {
        root.classList.remove(
          'tma-dash--email-mobile',
          'tma-dash--email-mobile-reading',
          'tma-dash--email-profile-sidebar-open'
        );
        var emailMenuBtn = root.querySelector('[data-email-mobile-menu]');
        if (emailMenuBtn) emailMenuBtn.hidden = true;
      }
      if (name !== 'messages') {
        root.classList.remove('tma-dash--messages-mobile', 'tma-dash--messages-mobile-reading');
        if (window.TMAMessages && window.TMAMessages.clearMobileHeader) {
          window.TMAMessages.clearMobileHeader();
        }
      }
      if (name !== 'email' && window.TMAEmail && window.TMAEmail.restoreHeaderSearch) {
        window.TMAEmail.restoreHeaderSearch(root);
      }
      syncSidebarToggleIcon();
      var activeViewEl = viewEls.filter(function (v) { return v.getAttribute('data-view') === name; })[0];
      var isTableView = !!(activeViewEl && activeViewEl.hasAttribute('data-table-view'));
      if (viewToggleWrap) {
        viewToggleWrap.hidden = !isTableView;
        if (isTableView && window.TMATableViewToggle) {
          window.TMATableViewToggle.activate(name);
        }
      }
      var clientsPageActions = root.querySelector('[data-clients-page-actions]');
      if (clientsPageActions && name !== 'clients') {
        clientsPageActions.hidden = true;
        clientsPageActions.innerHTML = '';
      }
      if (name === 'users' && window.TMAUsers && window.TMAUsers.setActiveContext) {
        window.TMAUsers.setActiveContext('page');
      }
    }

    var currentCrumbPath = '';

    function buildCrumbRoutes() {
      var routes = {};
      leaves.forEach(function (leaf) {
        var crumb = leaf.getAttribute('data-crumb');
        if (!crumb) return;
        routes[crumb] = {
          navId: leaf.getAttribute('data-nav'),
          view: leaf.getAttribute('data-view') || null,
          title: leaf.getAttribute('data-title'),
          crumb: crumb,
        };
      });
      routes['Users / New'] = {
        navId: 'users',
        view: 'add-data',
        title: 'New entry',
        crumb: 'Users / New',
      };
      return routes;
    }

    var crumbRoutes = buildCrumbRoutes();

    var crumbSectionDefaults = {
      'Dashboards': { navId: 'dash-dashboard', title: 'Dashboard', crumb: 'Dashboard' },
      'User Profile': { navId: 'up-overview', title: 'Overview', crumb: 'User Profile / Overview' },
      'Account': { navId: 'ac-overview', title: 'Overview', crumb: 'Account / Overview' },
      'Settings': { navId: 'settings', view: 'settings', title: 'Settings', crumb: 'Settings' },
      'Social': { navId: 'so-feed', title: 'Feed', crumb: 'Social / Feed' },
      'Messages': { navId: 'so-messages', view: 'messages', title: 'Messages', crumb: 'Messages' },
    };

    function resolveCrumbTarget(path) {
      if (crumbRoutes[path]) return crumbRoutes[path];
      if (crumbSectionDefaults[path]) return crumbSectionDefaults[path];
      var prefix = path + ' /';
      var candidates = Object.keys(crumbRoutes).filter(function (key) {
        return key.indexOf(prefix) === 0;
      });
      if (!candidates.length) return null;
      candidates.sort(function (a, b) {
        return a.length - b.length || a.localeCompare(b);
      });
      return crumbRoutes[candidates[0]];
    }

    function renderBreadcrumb(crumb) {
      if (!breadcrumbEl) return;
      currentCrumbPath = String(crumb || '');
      var parts = currentCrumbPath.split(' / ').filter(Boolean);
      var html = '';
      parts.forEach(function (part, i) {
        if (i === parts.length - 1) {
          html += '<span class="tma-dash__crumb--current" title="' + escape(part) + '">' + escape(part) + '</span>';
        } else {
          html += '<a class="tma-dash__crumb" href="#" data-crumb-index="' + i + '" title="' + escape(part) + '">' + escape(part) + '</a>';
          html += '<span class="tma-dash__crumb-sep">/</span>';
        }
      });
      breadcrumbEl.innerHTML = html;
    }

    if (breadcrumbEl) {
      breadcrumbEl.addEventListener('click', function (e) {
        var link = e.target.closest('[data-crumb-index]');
        if (!link) return;
        e.preventDefault();
        var idx = parseInt(link.getAttribute('data-crumb-index'), 10);
        var parts = currentCrumbPath.split(' / ').filter(Boolean);
        if (isNaN(idx) || idx < 0 || idx >= parts.length - 1) return;
        var targetPath = parts.slice(0, idx + 1).join(' / ');
        var target = resolveCrumbTarget(targetPath);
        if (!target) return;
        var opts = {
          keepDrawer: true,
          title: target.title,
          crumb: target.crumb || targetPath,
        };
        if (target.view) opts.view = target.view;
        activate(target.navId, opts);
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var route = backBtn._route;
        if (!route) return;
        activate(route.navId, {
          view: route.view,
          title: route.title,
          crumb: route.crumb,
          keepDrawer: true,
        });
      });
    }

    function escape(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function expandGroupFor(leaf) {
      var sub = leaf.closest('.tma-dash__subnav');
      if (!sub) return;
      var key = sub.getAttribute('data-subnav');
      var btn = root.querySelector('[data-expand="' + key + '"]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') setExpanded(btn, true);
    }

    function activate(navId, opts) {
      opts = opts || {};
      // Navigating away is a completed interaction — release any focus-pin
      // that's keeping the hover-expand overlay open (only touches it when
      // focus is actually inside the sidebar, so this is a no-op otherwise).
      closeSidebarHoverPin();
      var leaf = leaves.filter(function (l) { return l.getAttribute('data-nav') === navId; })[0];
      var navEl = leaf || root.querySelector('.tma-dash__nav-item[data-nav="' + navId + '"]');
      leaves.forEach(function (l) { l.classList.remove('tma-dash__nav-item--active'); l.removeAttribute('aria-current'); });
      if (leaf) {
        leaf.classList.add('tma-dash__nav-item--active');
        leaf.setAttribute('aria-current', 'page');
        if (!opts.skipExpand) expandGroupFor(leaf);
      }
      var title = opts.title || (navEl && navEl.getAttribute('data-title'));
      var crumb = opts.crumb != null ? opts.crumb : (navEl && navEl.getAttribute('data-crumb'));
      if (title && pageTitleEl) pageTitleEl.textContent = title;
      if (crumb != null) renderBreadcrumb(crumb);
      var viewName = opts.view || (navEl && navEl.getAttribute('data-view')) || 'dashboard';
      if (viewName === 'add-data') {
        addDataSourceNav = 'users';
        root._addDataSourceNav = addDataSourceNav;
      }
      showView(viewName);
      if (window.TMAPortalViews && window.TMAPortalViews.has(viewName)) {
        window.TMAPortalViews.activate(viewName, root, {
          navId: navId,
          adminPage: opts.adminPage,
          folderId: opts.folderId,
        });
      }
      if (viewName === 'email' && window.TMAEmail) {
        var emailMount = root.querySelector('[data-email]');
        if (emailMount) {
          var emailPath = normalizePath(window.location.pathname);
          var emailFolder = opts.emailFolder
            || (emailPath === '/email/templates' ? 'templates' : 'inbox');
          window.TMAEmail.mount(emailMount, {
            folder: emailFolder,
            messageId: opts.emailMessageId || null,
          });
        }
      }
      if (viewName === 'messages' && window.TMAMessages) {
        var messagesMount = root.querySelector('[data-messages]');
        if (messagesMount) window.TMAMessages.mount(messagesMount);
      }
      if (viewName === 'feed' && window.TMAFeed) {
        var feedMount = root.querySelector('[data-feed]');
        if (feedMount) window.TMAFeed.mount(feedMount);
      }
      if (viewName === 'account' && window.TMAAccount) {
        var accountMount = root.querySelector('[data-account]');
        if (accountMount) {
          window.TMAAccount.setActiveTab(accountMount, window.TMAAccount.tabForNav(navId));
        }
      }
      if (viewName === 'settings' && window.TMASettings) {
        var settingsMount = root.querySelector('[data-settings]');
        if (settingsMount) {
          window.TMASettings.mount(settingsMount, {
            openChangeEmail: !!opts.openChangeEmail,
            activeNav: opts.settingsNav || null,
            paymentAdded: !!opts.paymentAdded,
          });
        }
      }
      if (viewName === 'clients' && window.TMAClients) {
        var clientsScreen = opts.clientsScreen;
        var contactId = opts.contactId;
        if (!clientsScreen) {
          if (opts.skipUrl) {
            var clientsRoute = window.TMAClients.routeFromPath(normalizePath(window.location.pathname));
            if (clientsRoute) {
              clientsScreen = clientsRoute.screen;
              contactId = clientsRoute.contactId;
            } else {
              clientsScreen = 'list';
              contactId = null;
            }
          } else {
            clientsScreen = 'list';
            contactId = null;
          }
        }
        window.TMAClients.syncRoute({
          screen: clientsScreen || 'list',
          contactId: contactId || null,
        });
      }
      syncUrl({
        navId: navId,
        view: opts.view || (navEl && navEl.getAttribute('data-view')) || 'dashboard',
        title: title,
        crumb: crumb,
        skipUrl: opts.skipUrl,
        clientsScreen: opts.clientsScreen,
        contactId: opts.contactId,
      });
      store.set('tma.activeNav', navId);
      if (!opts.keepDrawer && isMobileSidebar()) closeDrawers();
      if (!opts.keepMenu) closeMobileMenu();
      syncTabFromView(viewName);
    }

    /*
     * Open a portal path in-place (no full reload) — the destination a
     * notification, activity, or client item points at (§15, §25). Resolves the
     * path to an SPA view when this shell contains it, opening a specific record
     * where the module supports it (a client detail, the Overview activity tab).
     * Only genuinely cross-shell targets fall back to a real navigation.
     * Returns true once handled.
     */
    function portalNavigate(path) {
      if (!path) return false;
      var base = String(path);
      var q = '';
      var qi = base.indexOf('?');
      if (qi !== -1) { q = base.slice(qi + 1); base = base.slice(0, qi); }
      base = normalizePath(base);
      var params = {};
      q.split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
      });

      if (base === '/clients' || base.indexOf('/clients/') === 0) {
        var contactId = params.client || null;
        if (!contactId) {
          var mm = base.match(/^\/clients\/([^/]+)/);
          if (mm) contactId = decodeURIComponent(mm[1]);
        }
        if (root.querySelector('.tma-dash__view[data-view="clients"]')) {
          activate('clients', {
            view: 'clients', title: 'Clients', crumb: 'Clients',
            clientsScreen: contactId ? 'detail' : 'list', contactId: contactId,
          });
          return true;
        }
      }

      if (base === '/overview') {
        if (root.querySelector('.tma-dash__view[data-view="overview"]')) {
          activate('dash-project-overview', { view: 'overview', title: 'Project Overview', crumb: 'Dashboard / Overview' });
          if (params.tab) {
            if (window.TMAOverview && window.TMAOverview.selectTab) window.TMAOverview.selectTab(params.tab);
            else root._pendingOverviewTab = params.tab;
          }
          return true;
        }
      }

      if (base === '/email' || base.indexOf('/email/') === 0) {
        if (root.querySelector('.tma-dash__view[data-view="email"]')) {
          activate('email', {
            view: 'email',
            title: 'Email',
            crumb: 'Email',
            emailFolder: base === '/email/templates' ? 'templates' : 'inbox',
            emailMessageId: params.message || null,
          });
          return true;
        }
      }

      if (base === '/settings' || base === '/account-settings') {
        if (root.querySelector('.tma-dash__view[data-view="settings"]')) {
          activate('settings', { view: 'settings', title: 'Settings', crumb: 'Settings', settingsNav: params['settings-page'] || null });
          return true;
        }
      }

      var leaf = leaves.filter(function (l) { return normalizePath(l.getAttribute('href') || '') === base; })[0];
      if (leaf && root.querySelector('.tma-dash__view[data-view="' + (leaf.getAttribute('data-view') || '') + '"]')) {
        activate(leaf.getAttribute('data-nav'), {
          view: leaf.getAttribute('data-view') || undefined,
          title: leaf.getAttribute('data-title') || undefined,
          crumb: leaf.getAttribute('data-crumb') || undefined,
        });
        return true;
      }

      var route = routeFromPath(base);
      if (route && root.querySelector('.tma-dash__view[data-view="' + route.view + '"]')) {
        activate(route.navId, { view: route.view, title: route.title, crumb: route.crumb });
        return true;
      }

      // Cross-shell target this page can't render in place: real navigation.
      window.location.assign(appUrl(base + (q ? '?' + q : '')));
      return true;
    }
    root._portalNavigate = portalNavigate;

    /* ── expandable nav groups ─────────────────── */
    function setExpanded(btn, open) {
      btn.setAttribute('aria-expanded', String(open));
      var key = btn.getAttribute('data-expand');
      var sub = root.querySelector('[data-subnav="' + key + '"]');
      if (sub) sub.hidden = !open;
    }

    root.querySelectorAll('.tma-dash__nav-item--expand').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setExpanded(btn, btn.getAttribute('aria-expanded') !== 'true');
      });
    });

    /* ── nav leaf navigation ───────────────────── */
    leaves.forEach(function (leaf) {
      leaf.addEventListener('click', function (e) {
        var href = leaf.getAttribute('href');
        if (href && href.charAt(0) === '/' && href !== window.location.pathname) {
          e.preventDefault();
          activate(leaf.getAttribute('data-nav'), {
            view: leaf.getAttribute('data-view') || undefined,
            title: leaf.getAttribute('data-title') || undefined,
            crumb: leaf.getAttribute('data-crumb') || undefined,
          });
          return;
        }
        e.preventDefault();
        activate(leaf.getAttribute('data-nav'));
      });
    });

    window.addEventListener('popstate', function (e) {
      var state = e.state || routeFromPath(window.location.pathname);
      if (!state) return;
      activate(state.navId, {
        view: state.view,
        title: state.title,
        crumb: state.crumb,
        clientsScreen: state.clientsScreen,
        contactId: state.contactId,
        keepDrawer: true,
        skipExpand: true,
        skipUrl: true,
      });
    });

    /* ── sidebar tabs: Main Menu / Folder Shortcuts ── */
    var listTabs = Array.prototype.slice.call(root.querySelectorAll('[data-list-tab]'));
    function showList(name) {
      listTabs.forEach(function (t) {
        var on = t.getAttribute('data-list-tab') === name;
        t.classList.toggle('tma-dash__tab--active', on);
        t.setAttribute('aria-selected', String(on));
      });
      root.querySelectorAll('[data-list]').forEach(function (l) {
        l.hidden = l.getAttribute('data-list') !== name;
      });
      // Shortcuts are fetched lazily, the first time the tab is opened.
      if (name === 'shortcuts' && window.TMASidebarShortcuts) window.TMASidebarShortcuts.load();
    }
    listTabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-list-tab');
        showList(name);
        store.set('tma.sidebarList', name);
      });
    });

    /* ── chart tabs ────────────────────────────── */
    var chartTabs = root.querySelector('[data-chart-tabs]');
    if (chartTabs) {
      chartTabs.querySelectorAll('.tma-dash__chart-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          chartTabs.querySelectorAll('.tma-dash__chart-tab').forEach(function (t) {
            t.classList.remove('tma-dash__chart-tab--active');
            t.classList.add('tma-dash__chart-tab--muted');
            t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('tma-dash__chart-tab--active');
          tab.classList.remove('tma-dash__chart-tab--muted');
          tab.setAttribute('aria-selected', 'true');
        });
      });
    }

    /* ── theme / appearance prefs ──────────────── */
    var themeBtn = root.querySelector('[data-action="toggle-theme"]');
    var systemThemeMq = window.matchMedia('(prefers-color-scheme: dark)');

    function applyThemeVisual(resolved) {
      if (resolved === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
      if (themeBtn) {
        var img = themeBtn.querySelector('img');
        if (img) img.src = resolved === 'dark' ? 'images/icons/phosphor/MoonStars.svg' : 'images/icons/phosphor/Sun.svg';
      }
      store.set('tma.theme', resolved);
    }

    function applyFontScale(scale) {
      var level = Math.max(1, Math.min(5, parseInt(String(scale), 10) || 3));
      root.setAttribute('data-font-scale', String(level));
      store.set('tma.fontScale', String(level));
    }

    function applyAccentColor(colorId) {
      var id = ACCENT_COLORS[colorId] ? colorId : 'indigo';
      root.setAttribute('data-accent', id);
      store.set('tma.accentColor', id);
    }

    function applyUserPreferences() {
      applyThemeVisual(resolveTheme(getThemeMode()));
      applyFontScale(getFontScale());
      applyAccentColor(getAccentColor());
      applySidebarStyle(getSidebarStyle());
    }

    function setThemeMode(mode) {
      if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return;
      store.set('tma.themeMode', mode);
      applyThemeVisual(resolveTheme(mode));
    }

    function setFontScalePref(scale) {
      applyFontScale(scale);
    }

    function setAccentColorPref(colorId) {
      applyAccentColor(colorId);
    }

    function getUserPreferences() {
      return {
        themeMode: getThemeMode(),
        fontScale: getFontScale(),
        accentColor: getAccentColor(),
        sidebarStyle: getSidebarStyle(),
      };
    }

    if (!root.dataset.themeListenerBound) {
      root.dataset.themeListenerBound = '1';
      systemThemeMq.addEventListener('change', function () {
        if (getThemeMode() === 'system') applyThemeVisual(resolveTheme('system'));
      });
    }

    root._setThemeMode = setThemeMode;
    root._setFontScale = setFontScalePref;
    root._setAccentColor = setAccentColorPref;
    root._getUserPreferences = getUserPreferences;

    /* ── sidebar / rightbar toggles ────────────── */
    function applyRailTitles(on) {
      root.querySelectorAll('.tma-dash__sidebar .tma-dash__nav-item').forEach(function (item) {
        if (on) {
          var title = item.getAttribute('data-title') || '';
          var label = item.querySelector(':scope > span:not(.tma-dash__nav-caret):not(.tma-dash__nav-count)');
          if (!title && label) title = label.textContent.trim();
          var badge = item.querySelector('.tma-dash__nav-count');
          if (badge && !badge.hidden && badge.textContent) {
            title = title ? title + ' (' + badge.textContent + ')' : badge.textContent;
          }
          if (title) item.setAttribute('title', title);
          else item.removeAttribute('title');
        } else {
          item.removeAttribute('title');
        }
      });
    }
    function closeSidebarHoverPin() {
      if (sidebar && sidebar.contains(document.activeElement) && document.activeElement.blur) {
        document.activeElement.blur();
      }
    }

    function toggleSidebar() {
      if (isMobileSidebar()) {
        if (root.classList.contains('tma-dash--email')) {
          var emailMount = root.querySelector('[data-email]');
          if (emailMount && emailMount._emailToggleMobileNav) {
            root.classList.remove('is-nav-open', 'is-rb-open');
            resetMobileSidebarSearch();
            emailMount._emailToggleMobileNav();
            return;
          }
        }
        toggleNavDrawer();
      } else if (sidebar && getSidebarStyle() === 'standard') {
        // Standard style: a plain click-to-collapse rail, content shifts
        // beside it — no hover/focus overlay involved.
        var collapsed = root.classList.toggle('is-sidebar-collapsed');
        applyRailTitles(collapsed);
        store.set('tma.sidebarCollapsed', collapsed ? '1' : '0');
        // The icon-only rail has no room for the tabs, so it always shows the
        // main menu — leaving the shortcuts tab active would empty the rail.
        if (collapsed) showList('main');
        syncSidebarToggleIcon();
      } else if (sidebar) {
        // Desktop hover style: the rail is always collapsed at rest and
        // expands as a hover overlay (see CSS). This button pins that same
        // expanded state open via focus, for mouse-click and keyboard users
        // who aren't hovering it — it never leaves the sidebar permanently
        // expanded, it just closes again on the next click, on blur, or on
        // Escape.
        if (sidebar.contains(document.activeElement)) {
          closeSidebarHoverPin();
        } else {
          sidebar.focus({ preventScroll: true });
        }
      }
    }

    var SIDEBAR_TOGGLE_ICON = 'images/icons/phosphor/Sidebar.svg';
    var MOBILE_MENU_ICON = 'images/icons/phosphor/List.svg';

    function syncSidebarToggleIcon() {
      var btn = root.querySelector('[data-action="toggle-sidebar"]');
      if (!btn) return;
      var img = btn.querySelector('img');
      if (!img) return;
      if (isMobileSidebar()) {
        img.src = MOBILE_MENU_ICON;
        btn.setAttribute(
          'aria-label',
          root.classList.contains('tma-dash--email') ? 'Open mail menu' : 'Open menu'
        );
        btn.hidden = root.classList.contains('tma-dash--email-mobile-reading');
      } else {
        img.src = SIDEBAR_TOGGLE_ICON;
        btn.setAttribute('aria-label', 'Toggle sidebar');
        btn.hidden = false;
      }
    }

    root._syncSidebarToggleIcon = syncSidebarToggleIcon;

    // Per-user sidebar style (Settings → Appearance → Sidebar Style):
    // "standard" is a click-to-collapse rail that shifts the page content;
    // "hover" (default, matches the pre-existing behaviour) rests collapsed
    // and expands as a hover/focus overlay that never shifts content. Mobile
    // ignores this entirely and always uses the drawer.
    function applySidebarStyle(style) {
      root.classList.toggle('tma-dash--sidebar-standard', style === 'standard');
      if (isMobileSidebar()) return;
      if (style === 'standard') {
        var collapsed = store.get('tma.sidebarCollapsed', '0') === '1';
        root.classList.toggle('is-sidebar-collapsed', collapsed);
        applyRailTitles(collapsed);
        if (collapsed) showList('main');
      } else {
        root.classList.add('is-sidebar-collapsed');
        applyRailTitles(true);
      }
      syncSidebarToggleIcon();
    }

    function setSidebarStyle(style) {
      var next = style === 'standard' ? 'standard' : 'hover';
      store.set('tma.sidebarStyle', next);
      applySidebarStyle(next);
    }

    root._setSidebarStyle = setSidebarStyle;

    /* ── mobile menu rows + bottom tab bar ─────── */
    function upgradeTabButtons() {
      var hrefs = {
        dashboard: '/',
        home: '/',
        messages: '/social/messages',
        alerts: '#notifications',
        email: '/email',
        profile: '/account',
      };
      Array.prototype.slice.call(root.querySelectorAll('.tma-dash__tab-btn')).forEach(function (btn) {
        var tab = btn.getAttribute('data-tab');
        if (tab === 'home') {
          tab = 'dashboard';
          btn.setAttribute('data-tab', 'dashboard');
        }
        if (tab === 'dashboard') {
          btn.setAttribute('aria-label', 'Dashboard');
          var icon = btn.querySelector('img');
          if (icon) {
            icon.src = 'images/icons/phosphor/House.svg';
            icon.alt = '';
          }
        }
        if (btn.tagName === 'A') {
          if (tab && hrefs[tab]) btn.setAttribute('href', hrefs[tab]);
          return;
        }
        var link = document.createElement('a');
        link.className = btn.className;
        link.setAttribute('data-tab', tab);
        link.setAttribute('aria-label', btn.getAttribute('aria-label') || '');
        link.href = (tab && hrefs[tab]) || '#';
        link.innerHTML = btn.innerHTML;
        btn.replaceWith(link);
      });
    }

    upgradeTabButtons();
    syncSidebarToggleIcon();
    var tabBtns = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__tab-btn'));

    function formatTabBadgeCount(count) {
      if (!count || count <= 0) return '';
      // Sidebar / tab-bar badges stay compact — full totals belong on the
      // dashboard Email shortcut tile, not here.
      if (count > 99) return '99+';
      return String(count);
    }

    var cachedEmailUnread = null;

    function getEmailBadgeCount() {
      if (cachedEmailUnread !== null) return cachedEmailUnread;
      if (!window.TMAEmail || !window.TMAEmail.getInboxUnreadCount) return 0;
      var emailMount = root.querySelector('[data-email]');
      var emailState = emailMount && emailMount._emailState;
      return window.TMAEmail.getInboxUnreadCount(emailState);
    }

    document.addEventListener('tma-email-count', function (e) {
      if (!e || !e.detail || e.detail.count == null) return;
      cachedEmailUnread = Math.max(0, parseInt(e.detail.count, 10) || 0);
      if (typeof syncNavBadges === 'function') syncNavBadges();
    });

    function getMessagesBadgeCount() {
      if (!window.TMAMessages || !window.TMAMessages.getInboxUnreadCount) return 0;
      var messagesMount = root.querySelector('[data-messages]');
      var messagesState = messagesMount && messagesMount._messagesState;
      return window.TMAMessages.getInboxUnreadCount(messagesState);
    }

    function getCalendarBadgeCount() {
      if (!window.TMACalendar || !window.TMACalendar.getTodayEventCount) return 0;
      return window.TMACalendar.getTodayEventCount();
    }

    function getSocialBadgeCount() {
      if (!window.TMAFeed || !window.TMAFeed.getUnreadCount) return 0;
      return window.TMAFeed.getUnreadCount();
    }

    function ensureNavCount(el) {
      var badge = el.querySelector('.tma-dash__nav-count');
      if (badge) return badge;
      badge = document.createElement('span');
      badge.className = 'tma-dash__nav-count';
      badge.setAttribute('aria-hidden', 'true');
      // The badge always sits on the icon's corner. It can't be a child of
      // the icon itself — the icon is a masked span, and a mask clips its
      // whole subtree, badge included — so give the icon an unmasked
      // wrapper the first time this item gets a count.
      var icon = el.querySelector('.tma-dash__nav-icon');
      var host = el;
      if (icon) {
        var wrap = icon.parentElement;
        if (!wrap || !wrap.classList.contains('tma-dash__nav-icon-wrap')) {
          wrap = document.createElement('span');
          wrap.className = 'tma-dash__nav-icon-wrap';
          icon.parentNode.insertBefore(wrap, icon);
          wrap.appendChild(icon);
        }
        host = wrap;
      }
      host.appendChild(badge);
      return badge;
    }

    function setNavCount(el, count) {
      if (!el) return;
      var badge = ensureNavCount(el);
      var text = formatTabBadgeCount(count);
      if (!text) {
        badge.hidden = true;
        badge.textContent = '';
        return;
      }
      badge.hidden = false;
      badge.textContent = text;
    }

    function syncNavBadges() {
      setNavCount(root.querySelector('.tma-dash__nav-item[data-nav="email"]'), getEmailBadgeCount());
      setNavCount(root.querySelector('.tma-dash__nav-item[data-nav="so-messages"]'), getMessagesBadgeCount());
      setNavCount(root.querySelector('.tma-dash__nav-item[data-nav="calendar"]'), getCalendarBadgeCount());
      setNavCount(root.querySelector('.tma-dash__nav-item[data-expand="social"]'), getSocialBadgeCount());
      setNavCount(root.querySelector('.tma-dash__mrow[data-nav="email"]'), getEmailBadgeCount());
      setNavCount(root.querySelector('.tma-dash__mrow[data-nav="so-messages"]'), getMessagesBadgeCount());
      setNavCount(root.querySelector('.tma-dash__mrow[data-nav="calendar"]'), getCalendarBadgeCount());
      setNavCount(root.querySelector('.tma-dash__mrow[data-nav="so-feed"]'), getSocialBadgeCount());
      if (root.classList.contains('is-sidebar-collapsed')) applyRailTitles(true);
    }

    root._syncNavBadges = syncNavBadges;

    function syncPendingUsersBadge() {
      fetch('/admin/users/pending-count', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      })
        .then(function (r) { return r.ok ? r.json() : { count: 0 }; })
        .then(function (j) {
          var n = (j && j.count) || 0;
          setNavCount(root.querySelector('.tma-dash__nav-item[data-nav="users"]'), n);
          setNavCount(root.querySelector('.tma-dash__mrow[data-nav="users"]'), n);
        })
        .catch(function () {});
    }
    root._syncPendingUsersBadge = syncPendingUsersBadge;
    syncPendingUsersBadge();

    // Exact inbox unread for the Email nav badge — same source as home shortcuts.
    // Without this the badge stays at 0 until the mailbox view opens.
    fetch('/portal/mail', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var n = (j && j.connected && j.folders && j.folders.inbox)
          ? (j.folders.inbox.unread || 0)
          : 0;
        cachedEmailUnread = n;
        syncNavBadges();
        try {
          document.dispatchEvent(new CustomEvent('tma-email-count', { detail: { count: n } }));
        } catch (e) { /* ignore */ }
      })
      .catch(function () {});

    function ensureTabBadge(btn, kind) {
      var host = btn.querySelector('.tma-dash__tab-btn-icon') || btn;
      var badge = host.querySelector('.tma-dash__tab-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tma-dash__tab-badge tma-dash__tab-badge--' + kind;
        badge.setAttribute('aria-hidden', 'true');
        badge.hidden = true;
        host.appendChild(badge);
      }
      return badge;
    }

    function setTabBadge(btn, count, kind, labelBase) {
      if (!btn) return;
      var badge = ensureTabBadge(btn, kind);
      var text = formatTabBadgeCount(count);
      if (!text) {
        badge.hidden = true;
        badge.textContent = '';
        btn.setAttribute('aria-label', labelBase);
        return;
      }
      badge.hidden = false;
      badge.textContent = text;
      btn.setAttribute('aria-label', labelBase + ' (' + text + ')');
    }

    function ensureIconBtnBadge(btn, kind) {
      var badge = btn.querySelector('.tma-dash__icon-btn-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tma-dash__icon-btn-badge tma-dash__icon-btn-badge--' + kind;
        badge.setAttribute('aria-hidden', 'true');
        badge.hidden = true;
        btn.appendChild(badge);
      }
      return badge;
    }

    function setIconBtnBadge(btn, count, kind, labelBase) {
      if (!btn) return;
      var badge = ensureIconBtnBadge(btn, kind);
      var text = formatTabBadgeCount(count);
      if (!text) {
        badge.hidden = true;
        badge.textContent = '';
        btn.setAttribute('aria-label', labelBase);
        return;
      }
      badge.hidden = false;
      badge.textContent = text;
      btn.setAttribute('aria-label', labelBase + ' (' + text + ')');
    }

    function getNotificationBadgeCount() {
      if (root._activityPopups && root._activityPopups.getNotificationCount) {
        return root._activityPopups.getNotificationCount();
      }
      if (window.TMAActivityPopups && window.TMAActivityPopups.getNotificationCount) {
        return window.TMAActivityPopups.getNotificationCount();
      }
      return 0;
    }

    function getActivityBadgeCount() {
      if (root._activityPopups && root._activityPopups.getActivityCount) {
        return root._activityPopups.getActivityCount();
      }
      if (window.TMAActivityPopups && window.TMAActivityPopups.getActivityCount) {
        return window.TMAActivityPopups.getActivityCount();
      }
      return 0;
    }

    function syncHeaderIconBadges() {
      setIconBtnBadge(
        root.querySelector('[data-action="toggle-notifications-popup"]'),
        getNotificationBadgeCount(),
        'alerts',
        'Notifications'
      );
      setIconBtnBadge(
        root.querySelector('[data-action="toggle-activities-popup"]'),
        getActivityBadgeCount(),
        'activities',
        'Activities'
      );
    }

    function syncTabBarBadges() {
      syncNavBadges();
      syncHeaderIconBadges();
      if (!isMobileSidebar()) return;
      var alertsBtn = root.querySelector('.tma-dash__tab-btn[data-tab="alerts"]');
      var emailBtn = root.querySelector('.tma-dash__tab-btn[data-tab="email"]');
      var messagesBtn = root.querySelector('.tma-dash__tab-btn[data-tab="messages"]');
      var notifCount = getNotificationBadgeCount();
      setTabBadge(alertsBtn, notifCount, 'alerts', 'Notifications');
      setTabBadge(emailBtn, getEmailBadgeCount(), 'email', 'Email');
      setTabBadge(messagesBtn, getMessagesBadgeCount(), 'messages', 'Messages');
      if (tabIndicator) {
        if (!isMobileSidebar()) {
          tabIndicator.hide();
        } else if (!tabIndicator.isAnimating()) {
          var activeBtn = tabBtns.filter(function (b) {
            return b.classList.contains('tma-dash__tab-btn--active');
          })[0];
          if (activeBtn) {
            tabIndicator.moveTo(activeBtn.getAttribute('data-tab') || '', true);
          }
        }
      }
    }

    root._syncTabBarBadges = syncTabBarBadges;

    var tabbarRow = root.querySelector('.tma-dash__tabbar-row');
    var tabIndicator =
      window.TMATabbarIndicator && tabbarRow
        ? window.TMATabbarIndicator.create(tabbarRow, tabBtns)
        : null;
    var tabIndicatorPrimed = false;

    if (tabIndicator && isMobileSidebar()) {
      var bootActive = tabBtns.filter(function (b) {
        return b.classList.contains('tma-dash__tab-btn--active');
      })[0];
      if (bootActive) {
        tabIndicator.moveTo(bootActive.getAttribute('data-tab') || '', true);
        tabIndicatorPrimed = true;
      }
    }

    function getActiveTabName() {
      var active = tabBtns.filter(function (b) {
        return b.classList.contains('tma-dash__tab-btn--active');
      })[0];
      return active ? active.getAttribute('data-tab') : '';
    }

    function setTab(name) {
      tabBtns.forEach(function (b) {
        b.classList.toggle('tma-dash__tab-btn--active', !!name && b.getAttribute('data-tab') === name);
      });
      if (!tabIndicator) return;
      if (!isMobileSidebar()) {
        tabIndicator.hide();
        return;
      }
      if (!name) {
        tabIndicator.moveTo('', true);
        return;
      }
      if (!tabIndicatorPrimed && window.TMATabbarIndicator) {
        var handoff = window.TMATabbarIndicator.consumeHandoff(name);
        if (handoff) {
          tabIndicator.moveFromTo(handoff.from, name, false);
          tabIndicatorPrimed = true;
          return;
        }
      }
      tabIndicator.moveTo(name, !tabIndicatorPrimed);
      tabIndicatorPrimed = true;
    }

    function getActiveViewName() {
      var active = getViewElements().filter(function (v) { return !v.hidden; })[0];
      return active ? active.getAttribute('data-view') : 'dashboard';
    }

    function syncTabFromView(viewName) {
      if (!isMobileSidebar()) return;
      if (root._activityPopups && root._activityPopups.isOpen && root._activityPopups.isOpen()) return;
      if (viewName === 'email') setTab('email');
      else if (viewName === 'messages') setTab('messages');
      else if (viewName === 'account') setTab('profile');
      else if (viewName === 'dashboard') setTab('dashboard');
      else setTab('');
    }

    function handleTabAction(tab, btn, e) {
      if (e) e.preventDefault();
      if (tab === 'home') tab = 'dashboard';

      var fromTab = getActiveTabName();
      if (
        fromTab &&
        fromTab !== tab &&
        window.TMATabbarIndicator &&
        isMobileSidebar()
      ) {
        window.TMATabbarIndicator.storeHandoff(fromTab, tab);
      }

      if (tab === 'dashboard') {
        if (root._activityPopups && root._activityPopups.isOpen && root._activityPopups.isOpen()) {
          root._activityPopups.close();
        }
        closeMobileMenu();
        setTab('dashboard');
        activate('dash-dashboard', {
          view: 'dashboard',
          title: 'Dashboard',
          crumb: 'Dashboard',
          keepDrawer: true,
        });
        return;
      }

      closeMobileMenu();

      if (tab === 'messages') {
        setTab('messages');
        if (root._activityPopups && root._activityPopups.isOpen && root._activityPopups.isOpen()) {
          root._activityPopups.close();
        }
        activate('so-messages', {
          view: 'messages',
          title: 'Messages',
          crumb: 'Messages',
          keepDrawer: true,
        });
        return;
      }

      if (tab === 'alerts') {
        setTab('alerts');
        if (root._activityPopups) root._activityPopups.openNotifications(btn);
        return;
      }

      if (tab === 'email') {
        setTab('email');
        activate('email', { view: 'email', title: 'Email', crumb: 'Email', keepDrawer: true });
        return;
      }

      if (tab === 'profile') {
        setTab('profile');
        activate('ac-overview', {
          view: 'account',
          title: 'Overview',
          crumb: 'Account / Overview',
          keepDrawer: true,
        });
      }
    }

    if (tabbarRow) {
      tabbarRow.addEventListener(
        'click',
        function (e) {
          var btn = e.target.closest('.tma-dash__tab-btn');
          if (!btn || !tabbarRow.contains(btn)) return;
          e.preventDefault();
          handleTabAction(btn.getAttribute('data-tab'), btn, e);
        },
        true
      );
    }
    function toggleRightbar() {
      if (isMobileRightbar()) {
        var open = root.classList.contains('is-rb-open');
        closeDrawers();
        if (!open) root.classList.add('is-rb-open');
      } else {
        var collapsed = root.classList.toggle('is-rightbar-collapsed');
        store.set('tma.rightbarCollapsed', collapsed ? '1' : '0');
      }
    }

    function bindSidebarResize() {
      if (!sidebar || !root.querySelector('.tma-dash__rightbar')) return;

      var rightbar = root.querySelector('.tma-dash__rightbar');
      var SIDEBAR_DEFAULT = 225;
      var SIDEBAR_MIN = 225;
      var SIDEBAR_MAX = 420;
      var RIGHTBAR_DEFAULT = 280;
      var RIGHTBAR_MIN = 220;
      var RIGHTBAR_MAX = 480;

      function parseWidth(value, fallback) {
        var n = parseInt(String(value || '').trim(), 10);
        return isNaN(n) ? fallback : n;
      }

      function currentSidebarWidth() {
        return parseWidth(getComputedStyle(root).getPropertyValue('--dash-sidebar-w'), SIDEBAR_DEFAULT);
      }

      function currentRightbarWidth() {
        return parseWidth(getComputedStyle(root).getPropertyValue('--dash-rightbar-w'), RIGHTBAR_DEFAULT);
      }

      function setSidebarWidth(px) {
        var width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
        root.style.setProperty('--dash-sidebar-w', width + 'px');
        store.set('tma.sidebarWidth', String(width));
      }

      function setRightbarWidth(px) {
        var width = Math.max(RIGHTBAR_MIN, Math.min(RIGHTBAR_MAX, Math.round(px)));
        root.style.setProperty('--dash-rightbar-w', width + 'px');
        store.set('tma.rightbarWidth', String(width));
      }

      function createHandle(side) {
        var handle = document.createElement('div');
        handle.className = 'tma-dash__resize-handle tma-dash__resize-handle--' + side;
        handle.setAttribute('data-resize-handle', side);
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', side === 'sidebar' ? 'Resize sidebar' : 'Resize right panel');
        handle.setAttribute('tabindex', '0');
        return handle;
      }

      if (!sidebar.querySelector('[data-resize-handle="sidebar"]')) {
        sidebar.appendChild(createHandle('sidebar'));
      }
      if (!rightbar.querySelector('[data-resize-handle="rightbar"]')) {
        rightbar.insertBefore(createHandle('rightbar'), rightbar.firstChild);
      }

      var savedSidebar = store.get('tma.sidebarWidth', '');
      var savedRightbar = store.get('tma.rightbarWidth', '');
      if (savedSidebar) setSidebarWidth(parseWidth(savedSidebar, SIDEBAR_DEFAULT));
      if (savedRightbar) setRightbarWidth(parseWidth(savedRightbar, RIGHTBAR_DEFAULT));

      var drag = null;

      function canResize() {
        return window.innerWidth > SIDEBAR_BP;
      }

      function startDrag(e, side) {
        if (!canResize()) return;
        if (side === 'sidebar' && root.classList.contains('is-sidebar-collapsed')) return;
        if (side === 'rightbar' && root.classList.contains('is-rightbar-collapsed')) return;
        if (typeof e.button === 'number' && e.button !== 0) return;

        drag = {
          side: side,
          startX: e.clientX,
          startWidth: side === 'sidebar' ? currentSidebarWidth() : currentRightbarWidth(),
          handle: e.currentTarget,
        };
        drag.handle.classList.add('is-dragging');
        if (drag.handle.setPointerCapture) drag.handle.setPointerCapture(e.pointerId);
        root.classList.add('is-resizing');
        e.preventDefault();
      }

      function moveDrag(e) {
        if (!drag) return;
        var delta = e.clientX - drag.startX;
        if (drag.side === 'sidebar') setSidebarWidth(drag.startWidth + delta);
        else setRightbarWidth(drag.startWidth - delta);
      }

      function endDrag(e) {
        if (!drag) return;
        drag.handle.classList.remove('is-dragging');
        if (drag.handle.releasePointerCapture) {
          try { drag.handle.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        drag = null;
        root.classList.remove('is-resizing');
      }

      root.querySelectorAll('[data-resize-handle]').forEach(function (handle) {
        if (handle.dataset.resizeBound) return;
        handle.dataset.resizeBound = '1';
        var side = handle.getAttribute('data-resize-handle');
        handle.addEventListener('pointerdown', function (e) { startDrag(e, side); });
        handle.addEventListener('keydown', function (e) {
          if (!canResize()) return;
          if (side === 'sidebar' && root.classList.contains('is-sidebar-collapsed')) return;
          if (side === 'rightbar' && root.classList.contains('is-rightbar-collapsed')) return;
          var step = e.shiftKey ? 20 : 8;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            var mult = side === 'sidebar'
              ? (e.key === 'ArrowRight' ? 1 : -1)
              : (e.key === 'ArrowLeft' ? 1 : -1);
            if (side === 'sidebar') setSidebarWidth(currentSidebarWidth() + mult * step);
            else setRightbarWidth(currentRightbarWidth() + mult * step);
          }
        });
      });

      if (!root.dataset.resizeBound) {
        root.dataset.resizeBound = '1';
        window.addEventListener('pointermove', moveDrag);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
      }
    }

    bindSidebarResize();

    if (window.TMAHeadDropdown) window.TMAHeadDropdown.mount();

    /* ── Today dropdown (shared head-dropdown pattern) ── */
    var todayMenu = root.querySelector('[data-today-menu]');
    var todayLabel = root.querySelector('[data-today-label]');
    function closeToday() {
      if (window.TMAHeadDropdown) window.TMAHeadDropdown.closeAll();
      else if (todayMenu) todayMenu.hidden = true;
    }
    if (todayWrap && todayMenu) {
      todayWrap.addEventListener('head-dropdown:select', function (event) {
        var item = event.detail && event.detail.item;
        if (!item) return;
        var val = item.getAttribute('data-today') || item.textContent.trim();
        if (todayLabel) todayLabel.textContent = val;
        todayMenu.querySelectorAll('[data-today]').forEach(function (m) {
          m.classList.remove('tma-dash__menu-item--active');
        });
        item.classList.add('tma-dash__menu-item--active');
        store.set('tma.today', val);
      });
    }

    /* ── search / command palette (Figma SearchPopup 33257:43316) ── */
    var searchIndex = leaves.map(function (l) {
      var title = l.getAttribute('data-title') || '';
      var crumb = l.getAttribute('data-crumb') || '';
      var navId = l.getAttribute('data-nav') || '';
      return {
        type: 'page',
        label: title,
        title: title,
        navId: navId,
        href: '#' + navId,
        keywords: [title, crumb, navId].filter(Boolean),
      };
    });

    var searchPalette = window.TMAGlobalSearch && window.TMAGlobalSearch.mountDashboardSearch
      ? window.TMAGlobalSearch.mountDashboardSearch(root, {
          index: searchIndex,
          onNavigate: function (item) {
            if (item.navId) {
              activate(item.navId, { keepDrawer: true });
            } else if (item.href && String(item.href).charAt(0) === '#') {
              activate(String(item.href).slice(1), { keepDrawer: true });
            }
          },
          onClose: function () {
            if (sidebar && sidebar.classList.contains('tma-dash__sidebar--mobile-search')) {
              resetMobileSidebarSearch();
            }
          },
        })
      : null;

    wireMobileSidebarSearch(searchIndex);

    function openSearch() {
      if (root.classList.contains('tma-dash--email')) {
        var emailView = root.querySelector('.tma-dash__view[data-view="email"]');
        var emailInput = emailView && !emailView.hidden ? root.querySelector('[data-email-search]') : null;
        if (emailInput) {
          emailInput.focus();
          emailInput.select();
          return;
        }
      }
      if (window.TMAUsers && window.TMAUsers.focusSearch(root)) return;
      if (searchPalette) searchPalette.open();
    }
    function closeSearch() {
      if (searchPalette) searchPalette.close();
    }
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || !root.contains(btn)) return;
      var action = btn.getAttribute('data-action');
      if (action === 'toggle-theme') return;
      if (action === 'toggle-sidebar') {
        e.preventDefault();
        toggleSidebar();
      } else if (action === 'toggle-rightbar') {
        e.preventDefault();
        toggleRightbar();
      } else if (action === 'open-search') {
        e.preventDefault();
        openSearch();
      } else if (action === 'show-recently') {
        e.preventDefault();
        showList('recently');
        if (isMobileSidebar()) { closeDrawers(); root.classList.add('is-nav-open'); }
      }
    });
    root.addEventListener('click', function (e) {
      var mrow = e.target.closest('[data-mrow]');
      if (!mrow || !root.contains(mrow)) return;
      e.preventDefault();
      activate(mrow.getAttribute('data-nav'), {
        view: mrow.getAttribute('data-view') || undefined,
        title: mrow.getAttribute('data-title') || undefined,
        crumb: mrow.getAttribute('data-crumb') || undefined,
      });
    });
    root.addEventListener('click', function (e) {
      var profileBtn = e.target.closest('[data-sidebar-profile-action]');
      if (!profileBtn || !sidebar || !sidebar.contains(profileBtn)) return;
      e.preventDefault();
      var profileAction = profileBtn.getAttribute('data-sidebar-profile-action');
      if (profileAction === 'settings') {
        closeMobileMenu();
        activate('settings', { view: 'settings', title: 'Settings', crumb: 'Settings' });
      } else if (profileAction === 'logout') {
        // Hand off to the shell's shared sign-out, which POSTs to Fortify with
        // the CSRF token. Navigating to a URL left the session signed in.
        var out = document.querySelector('[data-action="sign-out"]');
        if (out) out.click();
        else window.location.href = '/auth/login';
      }
    });
    if (themeBtn) themeBtn.addEventListener('click', function () {
      setThemeMode(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    /* ── scrim + global keys ───────────────────── */
    if (scrim) scrim.addEventListener('click', closeDrawers);
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && (!searchPalette || !searchPalette.isOpen())) {
        var active = document.activeElement;
        var tag = (active && active.tagName) || '';
        // contenteditable counts as typing too: the Messages composer is one,
        // and without this a "/" in a URL opened search instead of being typed.
        var editing = /input|textarea|select/i.test(tag) || !!(active && active.isContentEditable);
        if (!editing) {
          e.preventDefault();
          openSearch();
        }
      } else if (e.key === 'Escape') {
        closeSearch(); closeToday(); closeDrawers(); closeMobileMenu(); closeSidebarHoverPin();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > RIGHTBAR_BP) closeDrawers();
      if (window.innerWidth > SIDEBAR_BP) closeMobileMenu();
      // Mobile uses the drawer instead of the rail; keep the rail's class in
      // sync (per the user's sidebar style) as the viewport crosses the
      // breakpoint.
      if (isMobileSidebar()) {
        root.classList.remove('is-sidebar-collapsed');
      } else {
        applySidebarStyle(getSidebarStyle());
      }
      syncSidebarToggleIcon();
      syncMobileHeaderScroll();
      syncTabBarBadges();
    });

    /* Task avatars: only show profile tooltips for real names (data-user-name
       or a meaningful alt). Never invent names from stock avatar filenames. */
    function wireTaskAvatarTooltips() {
      var avatars = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__tasks .tma-dash__avatar'));
      var tipIndex = 0;
      avatars.forEach(function (avatar) {
        if (avatar.classList.contains('tma-dash__avatar--more') || avatar.tagName !== 'IMG') return;

        var name = avatar.getAttribute('data-user-name')
          || avatar.getAttribute('data-name')
          || '';
        var alt = avatar.getAttribute('alt') || '';
        if (!name && alt && !/^avatar/i.test(alt) && alt !== '') name = alt;
        if (!name) return;

        var src = avatar.getAttribute('src');
        var tipId = 'task-avatar-tip-' + tipIndex++;
        avatar.setAttribute('alt', name);

        var trigger = document.createElement('span');
        trigger.className = 'tma-tooltip-trigger tma-dash__avatar-trigger';
        trigger.setAttribute('data-tooltip-trigger', '');
        trigger.setAttribute('data-tooltip-type', 'avatar');
        trigger.setAttribute('data-tooltip-position', 'top');
        trigger.setAttribute('data-tooltip-initial-delay', '1500');
        trigger.setAttribute('data-tooltip-rehover-delay', '500');
        trigger.setAttribute('data-tooltip-rehover-window', '30000');
        trigger.setAttribute('aria-describedby', tipId);

        avatar.parentNode.replaceChild(trigger, avatar);
        trigger.appendChild(avatar);

        var tip = document.createElement('div');
        tip.id = tipId;
        tip.className = 'tma-tooltip tma-tooltip--profile tma-tooltip--top tma-tooltip-trigger__tip';
        tip.setAttribute('role', 'tooltip');
        tip.setAttribute('aria-hidden', 'true');
        tip.style.cssText = '--tooltip-font-size:12px;--tooltip-line-height:16px;--tooltip-padding-x:8px;--tooltip-padding-y:4px;--tooltip-radius:12px;';
        tip.innerHTML = '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--profile">' +
          '<img class="tma-tooltip__profile-avatar" src="' + src + '" alt="" width="24" height="24">' +
          '<span class="tma-tooltip__profile-name">' + name + '</span></div></div>' +
          '<span class="tma-tooltip__arrow" aria-hidden="true"></span>';
        trigger.appendChild(tip);
      });
    }

    /* ── card metric tooltips (TMA tooltip component) ── */
    function wireCardMetricTooltips() {
      var deltas = Array.prototype.slice.call(root.querySelectorAll('.tma-dash__card-delta'));
      deltas.forEach(function (delta, i) {
        var text = delta.textContent.replace(/\s+/g, ' ').trim();
        var match = text.match(/([+-]?\d+(?:\.\d+)?%)/);
        var pct = match ? match[1] : text;
        var isDown = pct.charAt(0) === '-';
        var absPct = pct.replace(/^\+|-/, '');
        var lines = isDown
          ? ['Compared with yesterday,', 'it is down ' + absPct]
          : ['Compared with yesterday,', 'it is up ' + absPct];

        var tipId = 'card-metric-tip-' + i;
        var trigger = document.createElement('span');
        trigger.className = 'tma-tooltip-trigger';
        trigger.setAttribute('data-tooltip-trigger', '');
        trigger.setAttribute('data-tooltip-type', 'metric');
        trigger.setAttribute('data-tooltip-position', 'top');
        trigger.setAttribute('data-tooltip-initial-delay', '1500');
        trigger.setAttribute('data-tooltip-rehover-delay', '500');
        trigger.setAttribute('data-tooltip-rehover-window', '30000');
        trigger.setAttribute('aria-describedby', tipId);

        delta.parentNode.replaceChild(trigger, delta);
        trigger.appendChild(delta);

        var tip = document.createElement('div');
        tip.id = tipId;
        tip.className = 'tma-tooltip tma-tooltip--multiline tma-tooltip--top tma-tooltip-trigger__tip';
        tip.setAttribute('role', 'tooltip');
        tip.setAttribute('aria-hidden', 'true');
        tip.style.cssText = '--tooltip-font-size:12px;--tooltip-line-height:16px;--tooltip-padding-x:8px;--tooltip-padding-y:4px;--tooltip-radius:12px;--tooltip-max-width:240px;';
        tip.innerHTML = '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--multiline">' +
          lines.map(function (line) { return '<p class="tma-tooltip__line">' + line + '</p>'; }).join('') +
          '</div></div><span class="tma-tooltip__arrow" aria-hidden="true"></span>';
        trigger.appendChild(tip);
      });
    }

    /* ── chart hover tooltips (TMA tooltip component) ── */
    function wireBarTooltips(selector, values) {
      var bars = Array.prototype.slice.call(root.querySelectorAll(selector));
      bars.forEach(function (bar, i) {
        var value = values[i % values.length];
        bar.setAttribute('data-tooltip-trigger', '');
        bar.setAttribute('data-tooltip-type', 'chart');
        bar.setAttribute('data-tooltip-position', 'top');
        bar.setAttribute('data-tooltip-initial-delay', '0');
        bar.setAttribute('data-tooltip-rehover-delay', '0');
        var tip = document.createElement('div');
        tip.className = 'tma-tooltip tma-tooltip--compact tma-tooltip--top';
        tip.setAttribute('role', 'tooltip');
        tip.setAttribute('aria-hidden', 'true');
        tip.innerHTML = '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--inline">' +
          '<span class="tma-tooltip__text">' + value + '</span></div></div>' +
          '<span class="tma-tooltip__arrow" aria-hidden="true"></span>';
        bar.appendChild(tip);
      });
    }
    var OVERVIEW_VALUES = ['18,200', '24,100', '15,400', '27,300', '9,800', '21,600', '18,200', '26,598', '15,400', '27,300', '9,800', '21,600'];
    wireCardMetricTooltips();
    wireTaskAvatarTooltips();
    wireBarTooltips('.tma-dash__panel--overview .tma-dash__vbar', OVERVIEW_VALUES);
    if (window.PortalTooltip) window.PortalTooltip.init();

    if (window.TMAActivityPopups) {
      window.TMAActivityPopups.mount(root);
      if (root._activityPopups) {
        root._activityPopups.onClose = function () { syncTabFromView(getActiveViewName()); };
      }
      syncTabBarBadges();
    }

    // Fill the right sidebar's three sections with live data (§1, §5).
    if (window.TMARightSidebar) window.TMARightSidebar.mount(root);

    var usersRoot = root.querySelector('[data-users]');
    if (usersRoot && window.TMAUsers) {
      window.TMAUsers.mount(usersRoot);
    }

    var emailRoot = root.querySelector('[data-email]');
    if (emailRoot && window.TMAEmail) {
      window.TMAEmail.mount(emailRoot);
      syncTabBarBadges();
    }

    var messagesRoot = root.querySelector('[data-messages]');
    if (messagesRoot && window.TMAMessages) {
      window.TMAMessages.mount(messagesRoot);
      syncTabBarBadges();
    }

    var feedRoot = root.querySelector('[data-feed]');
    if (feedRoot && window.TMAFeed) {
      window.TMAFeed.mount(feedRoot);
      syncTabBarBadges();
    }

    var clientsRoot = root.querySelector('[data-clients]');
    if (clientsRoot && window.TMAClients) {
      window.TMAClients.mount(clientsRoot);
    }

    var calendarRoot = root.querySelector('[data-calendar]');
    if (calendarRoot && window.TMACalendar) {
      window.TMACalendar.mount(calendarRoot);
      syncTabBarBadges();
    }

    var pricingRoot = root.querySelector('[data-pricing]');
    if (pricingRoot && window.TMAPricing) {
      window.TMAPricing.mount(pricingRoot);
    }

    var projectsRoot = root.querySelector('[data-projects]');
    if (projectsRoot && window.TMAProjects) {
      window.TMAProjects.mount(projectsRoot);
    }

    if (viewToggleWrap && window.TMATableViewToggle) {
      window.TMATableViewToggle.init(viewToggleWrap);
    }

    /* ── Add Data view ─────────────────────────── */
    var addDataRoot = root.querySelector('[data-dashboard-add-data]');
    if (addDataRoot && window.TMADashboardAddData) {
      window.TMADashboardAddData.mount(addDataRoot);
    }

    /* ── Dashboard metrics + project overview ──── */
    var metricsRoot = root.querySelector('[data-dashboard-metrics]');
    if (metricsRoot && window.TMADashboardMetrics) {
      window.TMADashboardMetrics.mount(metricsRoot);
    }
    var overviewRoot = root.querySelector('[data-overview]');
    if (overviewRoot && window.TMAOverview) {
      window.TMAOverview.mount(overviewRoot);
    }

    var accountRoot = root.querySelector('[data-account]');
    if (accountRoot && window.TMAAccount) {
      window.TMAAccount.mount(accountRoot);
    }

    var settingsRoot = root.querySelector('[data-settings]');
    if (settingsRoot && window.TMASettings) {
      window.TMASettings.mount(settingsRoot);
    }

    /* ── restore persisted state ───────────────── */
    applyUserPreferences();
    // applyUserPreferences() → applySidebarStyle() already set the collapsed
    // rail correctly for the user's chosen desktop sidebar style. The HTML
    // ships with the collapsed class already on <div class="tma-dash"> to
    // avoid a flash of the expanded layout before this runs; this is just a
    // safety net for mobile, which never uses the collapsed-rail concept.
    if (isMobileSidebar()) {
      root.classList.remove('is-sidebar-collapsed');
    }
    if (window.innerWidth > RIGHTBAR_BP && store.get('tma.rightbarCollapsed', '0') === '1') root.classList.add('is-rightbar-collapsed');
    if (store.get('tma.sidebarList', 'main') === 'shortcuts') {
      showList('shortcuts');
    }
    var savedToday = store.get('tma.today', '');
    if (savedToday && todayLabel) {
      todayLabel.textContent = savedToday;
      var match = todayMenu && todayMenu.querySelector('[data-today="' + savedToday + '"]');
      if (match) match.classList.add('tma-dash__menu-item--active');
    }
    var savedNav = store.get('tma.activeNav', 'dash-dashboard');
    if (savedNav === 'dash-default' || savedNav === 'fav-default' || savedNav === 'dash-overview' || savedNav === 'fav-overview') savedNav = 'dash-dashboard';
    if (savedNav === 'contacts') savedNav = 'clients';
    if (savedNav === 'dash-clients') savedNav = 'clients';
    if (savedNav === 'dash-users') savedNav = 'users';
    var hiddenAccountNav = { 'ac-billing': 1, 'ac-statements': 1, 'ac-referrals': 1, 'ac-api-keys': 1 };
    if (hiddenAccountNav[savedNav]) savedNav = 'ac-overview';
    if (!leaves.some(function (l) { return l.getAttribute('data-nav') === savedNav; })) savedNav = 'dash-dashboard';
    var bootRoute = routeFromPath(window.location.pathname);
    var bootSettingsPage = null;
    try { bootSettingsPage = new URLSearchParams(window.location.search).get('settings-page'); } catch (e) {}
    if (window.TMAPortalSignatures && window.TMAPortalSignatures.clearLock) {
      window.TMAPortalSignatures.clearLock();
    } else {
      root.classList.remove('tma-dash--signatures-wizard');
      document.documentElement.classList.remove('tma-dash--signatures-wizard');
    }
    if (bootSettingsPage) {
      activate('account-settings', {
        view: 'admin',
        adminPage: bootSettingsPage,
        title: 'Account settings',
        crumb: 'Account settings',
        keepDrawer: true,
        skipUrl: true,
      });
    } else if (bootRoute) {
      activate(bootRoute.navId, {
        view: bootRoute.view,
        title: bootRoute.title,
        crumb: bootRoute.crumb,
        emailFolder: bootRoute.emailFolder,
        openChangeEmail: bootRoute.openChangeEmail,
        settingsNav: bootRoute.settingsNav,
        paymentAdded: bootRoute.paymentAdded,
        clientsScreen: bootRoute.clientsScreen,
        contactId: bootRoute.contactId,
        keepDrawer: true,
        skipExpand: true,
        skipUrl: true,
      });
      history.replaceState(
        {
          navId: bootRoute.navId,
          view: bootRoute.view,
          title: bootRoute.title,
          crumb: bootRoute.crumb,
          clientsScreen: bootRoute.clientsScreen,
          contactId: bootRoute.contactId,
        },
        '',
        pathForRoute(bootRoute.navId, bootRoute.view, bootRoute)
      );
    } else {
      activate(savedNav, { keepDrawer: true, skipExpand: true, skipUrl: true });
    }
    prefixRootAnchors();
    root._activate = activate;
    root._updatePageMeta = function (meta) {
      meta = meta || {};
      if (meta.title && pageTitleEl) pageTitleEl.textContent = meta.title;
      if (meta.crumb != null) renderBreadcrumb(meta.crumb);
    };
  }

  window.TMADashboard = {
    mount: mount,
    navigate: function (opts) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._activate) dash._activate(opts.navId || 'dash-dashboard', opts);
    },
    updatePageMeta: function (meta) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._updatePageMeta) dash._updatePageMeta(meta);
    },
    getPrefs: function () {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._getUserPreferences) return dash._getUserPreferences();
      return { themeMode: getThemeMode(), fontScale: getFontScale(), accentColor: getAccentColor(), sidebarStyle: getSidebarStyle() };
    },
    setThemeMode: function (mode) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._setThemeMode) dash._setThemeMode(mode);
    },
    setFontScale: function (scale) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._setFontScale) dash._setFontScale(scale);
    },
    setSidebarStyle: function (style) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._setSidebarStyle) dash._setSidebarStyle(style);
    },
    setAccentColor: function (colorId) {
      var dash = document.querySelector('.tma-dash');
      if (dash && dash._setAccentColor) dash._setAccentColor(colorId);
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    mount(document.querySelector('.tma-dash'));
  });
})();
