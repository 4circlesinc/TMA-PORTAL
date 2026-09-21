/*
 * Applies the signed-in account's capabilities to the shell.
 *
 * The sidebar, the mobile menu and the bottom tab bar are static HTML shared
 * by every account type, so a client used to see Clients, Users, Email,
 * Workflows and People, click any of them and the page loaded,
 * then filled with permission errors. This removes what the server would
 * refuse, so the portal only ever offers what the account can actually use.
 *
 * Removal, not hiding: the global search index is built by reading nav items
 * out of the DOM (portal-search-index.js), so a detached item disappears from
 * search for free. Hiding would have left it findable.
 *
 * This is presentation only. Every capability below is enforced again on the
 * server, see App\Support\Access\Role.
 *
 * Global: window.TMAPortalAccess  ({ can, holds, ready, apply })
 */
(function () {
  'use strict';

  /* data-nav id => the capability needed to see it. Anything absent is open
     to every account: their own dashboard, calendar, files, signatures,
     messages and settings. Names match Role::MATRIX exactly. */
  var NAV_CAPABILITIES = {
    'dash-project-overview': 'overview.view',
    'clients': 'clients.view',
    'email': 'mail.use',
    'so-feed': 'feed.view',
    'users': 'users.view',
    'reporting': 'settings.reporting',
    'templates': 'templates.view',
    'templates-system': 'templates.view',
    'templates-email': 'templates.email',
    'templates-letters': 'templates.view',
    'templates-documents': 'templates.view',
    'folders-all': 'files.viewOrg',
    'folders-shared': 'files.viewOrg',
    'workflows-automated': 'workflows.view',
    'workflows-feedback': 'workflows.view',
    'workflows-updates': 'workflows.view',
    'call-recordings': 'callRecordings.view',
    'people-home': 'directory.view',
    'people-employees': 'directory.view',
    /* The client and group screens live inside People, so reaching People at
       all is the first requirement, see Role::PAGE_CAPABILITIES, where these
       carry both capabilities. Listing the narrower one here would leave the
       row in a section the account cannot open. */
    'people-clients': 'directory.view',
    'people-prospects': 'directory.view',
    'people-shared-address': 'directory.view',
    'people-personal-address': 'directory.view',
    'people-groups': 'directory.view',
    'people-resend': 'users.manage',
  };

  /*
   * File Library rows a service-provider contact has no use for.
   *
   * Their whole reason to be in the library is the client folders their firm
   * filed: everything they upload belongs in one of those, and the server
   * refuses anywhere else. File Box and Personal Folders are both "somewhere
   * outside a client folder", so offering them is offering a destination that
   * answers 403 — and, worse, a place to leave a client's passport where the
   * client's file will never show it.
   *
   * Capability-based pruning cannot express this: external accounts hold no
   * matrix capability at all, so there is no row in Role::MATRIX to hang it on.
   */
  var PROVIDER_CONTACT_HIDDEN_NAV = ['folders-filebox', 'folders-personal'];

  /*
   * Nav rows that say the wrong thing to a service-provider contact.
   *
   * Overview is "Admin Overview" in the shell because for years only staff
   * reached it. A provider contact reaches the same page now, and none of what
   * they see there is administration — telling them otherwise reads either as
   * a mistake or as a door they are not allowed through. The label is the only
   * thing that changes; the row, the icon and the href are the same one.
   *
   * data-title and data-crumb travel with it: they are what the page header
   * and the breadcrumb print, so relabelling only the visible span would leave
   * "Admin Overview" at the top of the page it opened.
   */
  var PROVIDER_CONTACT_NAV_LABELS = {
    'dash-project-overview': 'Overview',
  };

  /* Bottom tab bar (mobile). data-tab => capability. */
  var TAB_CAPABILITIES = {
    email: 'mail.use',
  };

  /* Pieces of the shell's first-paint skeleton that stand in for role-gated
     content. [data-boot-needs="<capability>"]. The Dashboard's KPI row is
     staff-only for most accounts, so portal-access.js drops it for anyone
     without overview.view, except service-provider contacts who get their
     own CIP-and-inbox cards. Every capability used in the shell markup is
     listed here so the hold CSS can be written before the DOM exists to prune. */
  var BOOT_GATED_CAPABILITIES = ['overview.view'];

  /* Account settings rail (portal-admin.js): section id => capability.
     Anything absent is personal, profile, theme, time, notifications,
     privacy, account security, payment, plugins, and linking your own storage
     account. Everything here is the firm's administration, which the rail used
     to offer to every account because it is one static list.
     Mirrors Role::SETTINGS_PAGE_CAPABILITIES; PortalAccessTest holds the two
     together. */
  var SETTINGS_CAPABILITIES = {
    'background-ops': 'settings.operations',
    'notification-history': 'settings.reporting',
    'branding': 'settings.branding',
    'clienthub-access': 'settings.clientHub',
    'service-teams': 'settings.clientHub',
    'custom-fields': 'settings.clientHub',
    'cip-documents': 'settings.clientHub',
    'cip-letters': 'settings.clientHub',
    'cip-distribution': 'settings.clientHub',
    'cip-admin': 'settings.clientHub',
    'security-insights': 'settings.security',
    'signin-policy': 'settings.security',
    'security-policy': 'settings.security',
    'geo-access': 'settings.security',
    'alert-settings': 'settings.security',
    'device-security': 'settings.security',
    'storage-usage': 'settings.storage',
    'permissions': 'settings.advanced',
    'default-folders': 'files.settings',
    'folder-templates': 'files.settings',
  };

  /* The shell is served with the reader's capabilities already in the
     document (App\Support\PortalShell), so on those pages nothing here has to
     wait for /me: the nav is decided before the sidebar has even parsed.
     Shells without it, the classic and onboarding layouts, fall back to
     holding the gated rows until /me answers, exactly as before. */
  var boot = Array.isArray(window.TMABootCapabilities) ? window.TMABootCapabilities : null;
  var cipReach = window.TMABootCipReach === true || window.TMABootCipReach === 'true';
  var providerContact = window.TMABootProviderContact === true || window.TMABootProviderContact === 'true';
  var serviceProviderAdmin = window.TMABootServiceProviderAdmin === true || window.TMABootServiceProviderAdmin === 'true';
  var providerCompany = parseProviderCompany(window.TMABootProviderCompany);

  function parseProviderCompany(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    return { id: String(raw.id), name: raw.name ? String(raw.name) : '' };
  }

  var caps = boot;
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });

  if (boot) readyResolve(boot.slice());

  /*
   * The matrix, without the nav spoofs in can().
   *
   * can('clients.view') is true for a CIP-reach account so Applications stays
   * in the sidebar. The directory APIs still 403 for that account. Callers
   * that would hit /portal/clients, /portal/companies or the staff live
   * channel must ask holds() instead, or the browser logs a failed request
   * even when the catch path is already correct.
   */
  function holds(capability) {
    if (!capability) return true;
    if (!caps) return false;
    return caps.indexOf(capability) !== -1;
  }

  function bespokeOn() {
    if (window.TMACurrentUser && window.TMACurrentUser.get) {
      var me = window.TMACurrentUser.get();
      if (me && me.bespoke && typeof me.bespoke.enabled === 'boolean') {
        return me.bespoke.enabled;
      }
    }
    return window.TMABootBespoke === true || window.TMABootBespoke === 'true';
  }

  function can(capability) {
    if (!capability) return true;
    // Before /me resolves nothing is known; callers should await ready().
    if (!caps) return false;
    // Service-provider / private-client CIP reach: keep Applications nav
    // without granting the staff clients.view capability.
    if (capability === 'clients.view' && cipReach) return true;
    // Service-provider contacts keep Workflows without workflows.view.
    // Generic clients still do not see it.
    if (capability === 'workflows.view' && providerContact) return true;
    // And Overview. Its administrator tabs are chosen off isAdmin inside
    // overview.js, so what a provider contact reaches is their own profile,
    // week, files, notifications and activity — and the KPI row they already
    // have on the Dashboard. Mirrors LegacyPageController::canViewOverviewPage.
    if (capability === 'overview.view' && providerContact) return true;
    return caps.indexOf(capability) !== -1;
  }

  function remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* Sidebar and mobile-menu rows both carry data-nav, so one pass covers
     both. The mobile rows use data-mrow but the same ids. */
  function pruneNavItems(scope) {
    scope.querySelectorAll('[data-nav]').forEach(function (el) {
      var nav = el.getAttribute('data-nav');

      if (nav === 'bespoke' && !bespokeOn()) {
        remove(el);
        return;
      }

      if (providerContact && PROVIDER_CONTACT_HIDDEN_NAV.indexOf(nav) !== -1) {
        remove(el);
        return;
      }

      var need = NAV_CAPABILITIES[nav];
      if (!need) return;
      // All Files is also for CIP-reach accounts. Shared Folders stays
      // staff-only, so this must not reuse can('files.viewOrg').
      if (nav === 'folders-all' && (can(need) || cipReach)) return;
      if (!can(need)) remove(el);
    });
  }

  /* A group whose children have all gone should not leave an empty
     disclosure behind, drop the toggle and its panel together. */
  function pruneEmptyGroups(scope) {
    scope.querySelectorAll('[data-subnav]').forEach(function (panel) {
      if (panel.querySelector('[data-nav]')) return;

      var name = panel.getAttribute('data-subnav');
      var toggle = scope.querySelector('[data-expand="' + name + '"]');
      remove(toggle);
      remove(panel);
    });
  }

  /* A section left with nothing in it would still draw its divider. Takes the
     list snapshotted before pruning, NOT a live query: sections that never
     held nav rows, the Main Menu / Folder Shortcuts tab row, the shortcuts
     list, carry buttons and containers rather than [data-nav], so a live
     query reads them as empty and deletes them for every user. */
  function pruneEmptySections(sections) {
    sections.forEach(function (section) {
      if (!section.querySelector('[data-nav], [data-expand]')) remove(section);
    });
  }

  /* The sections that actually hold nav rows, captured before anything is
     removed, so only sections emptied *by* the prune are dropped. */
  function navSections(scope) {
    return Array.prototype.filter.call(
      scope.querySelectorAll('.tma-dash__nav-section'),
      function (section) { return !!section.querySelector('[data-nav], [data-expand]'); }
    );
  }

  /* The label, the header title and the breadcrumb, for rows whose staff
     wording does not fit the account reading it. */
  function relabelNavItems(scope) {
    if (!providerContact) return;

    scope.querySelectorAll('[data-nav]').forEach(function (el) {
      var label = PROVIDER_CONTACT_NAV_LABELS[el.getAttribute('data-nav')];
      if (!label) return;

      el.setAttribute('data-title', label);
      el.setAttribute('data-crumb', label);

      // The text sits in the row's last span, after the caret and the icon in
      // the sidebar and after the image on a mobile row.
      var spans = el.querySelectorAll('span');
      var text = spans[spans.length - 1];
      if (text && !text.className) text.textContent = label;
    });
  }

  /*
   * Service Provider admins land on their firm, not the applications table.
   * The row stays labelled CIP Applications; only the href changes.
   */
  function rewriteProviderAdminNav(scope) {
    if (!serviceProviderAdmin || !providerCompany || !providerCompany.id) return;

    scope.querySelectorAll('[data-nav="clients"]').forEach(function (el) {
      el.setAttribute('href', '/citizenship-applications/companies/' + encodeURIComponent(providerCompany.id));
    });
  }

  function pruneTabs(scope) {
    scope.querySelectorAll('[data-tab]').forEach(function (el) {
      var need = TAB_CAPABILITIES[el.getAttribute('data-tab')];
      if (need && !can(need)) remove(el);
    });
  }

  /* Boot-skeleton pieces standing in for content this account may not have. */
  function pruneBootGated(scope) {
    scope.querySelectorAll('[data-boot-needs]').forEach(function (el) {
      // Service-provider contacts keep the KPI placeholder: can() holds that
      // rule now, alongside the one that keeps their Overview nav row.
      if (!can(el.getAttribute('data-boot-needs'))) remove(el);
    });
  }

  function apply() {
    var scope = document;
    var sections = navSections(scope);
    pruneNavItems(scope);
    relabelNavItems(scope);
    rewriteProviderAdminNav(scope);
    pruneEmptyGroups(scope);
    pruneEmptySections(sections);
    pruneTabs(scope);
    pruneBootGated(scope);
    document.documentElement.setAttribute('data-tma-access', 'ready');
  }

  /* What to do about the gated rows before the DOM exists to prune.
     `apply()` can only run once the sidebar has parsed, and the browser is
     free to paint before then, so the answer has to be CSS injected from
     <head> either way. What differs is how much it has to hide:

     - With boot capabilities we know precisely which rows this account may
       not have, so hide only those, and with `display:none`, the row leaves
       the layout entirely, so the menu paints closed up and correct.
     - Without them nothing is known yet, so every gated row is held with
       `visibility:hidden`. That reserves its space, which is deliberate: the
       menu must not jump when the missing rows arrive. It is also what put
       six blank gaps in the sidebar for the length of a /me round trip, which
       is the whole reason the boot path above exists.

     Both are released by the `data-tma-access="ready"` flag `apply()` sets,
     by which point it has removed the denied rows outright. */
  function injectHoldCss() {
    if (document.getElementById('tma-access-css')) return;

    var navIds = Object.keys(NAV_CAPABILITIES);
    var tabIds = Object.keys(TAB_CAPABILITIES);
    var bootGated = BOOT_GATED_CAPABILITIES;

    if (boot) {
      navIds = navIds.filter(function (id) { return !can(NAV_CAPABILITIES[id]); });
      tabIds = tabIds.filter(function (id) { return !can(TAB_CAPABILITIES[id]); });
      bootGated = bootGated.filter(function (capability) { return !can(capability); });
    }

    var selectors = navIds.map(function (id) {
      return '[data-nav="' + id + '"]';
    }).concat(tabIds.map(function (id) {
      return '[data-tab="' + id + '"]';
    })).concat(bootGated.map(function (capability) {
      return '[data-boot-needs="' + capability + '"]';
    }));
    if (!bespokeOn()) selectors.push('[data-nav="bespoke"]');
    if (!selectors.length) return;

    var style = document.createElement('style');
    style.id = 'tma-access-css';
    style.textContent = 'html:not([data-tma-access="ready"]) ' +
      selectors.join(', html:not([data-tma-access="ready"]) ') +
      (boot ? '{display:none!important}' : '{visibility:hidden!important}');
    (document.head || document.documentElement).appendChild(style);
  }

  injectHoldCss();

  function adopt(me) {
    if (!me) return;
    caps = Array.isArray(me.capabilities) ? me.capabilities : [];
    cipReach = !!me.cipReach;
    providerContact = !!me.isProviderContact;
    serviceProviderAdmin = !!me.isServiceProviderAdmin;
    if (me.serviceProvider) providerCompany = parseProviderCompany(me.serviceProvider);
    apply();
    readyResolve(caps);
  }

  /* If /me never answers we must not leave the sidebar permanently hidden.
     Reveal everything and let the server refuse, a nav item that 403s is a
     far better failure than a portal with half a menu and no explanation. */
  function releaseHold() {
    if (caps) return;
    document.documentElement.setAttribute('data-tma-access', 'ready');
    readyResolve([]);
  }

  function start() {
    // Boot capabilities: the DOM is here, so prune for real now rather than
    // leaving the rows hidden-but-present until /me lands.
    if (boot) apply();

    if (!window.TMACurrentUser) {
      // No identity source on this shell, reveal rather than strand the nav.
      releaseHold();
      return;
    }
    window.TMACurrentUser.onChange(adopt);
    if (!boot) setTimeout(releaseHold, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* Native apps cache the last shell. A copy taken before Bespoke AI shipped
     has no launcher tags; this file is fetched from the network when the
     deploy moves, so inject the assistant there. Wait for DOMContentLoaded
     so a current shell's bottom-of-page tag is already in the document. */
  function ensureBespoke() {
    if (document.documentElement.classList.contains('tma-dash--compose-popout')) return;
    if (window.TMABespoke || document.querySelector('script[src*="bespoke-ai.js"]')) return;
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'css/bespoke-ai.css?v=17';
    (document.head || document.documentElement).appendChild(css);
    var js = document.createElement('script');
    js.src = 'js/bespoke-ai.js?v=14';
    js.defer = true;
    (document.head || document.documentElement).appendChild(js);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBespoke);
  } else {
    ensureBespoke();
  }

  /* ── Sidebar rhythm: spread the menu to the window's height ──
     The menu is a fixed set of rows, so on a tall window it ended well above
     the profile block with a large dead gap under the last item. Measure
     what is actually left under the last section and hand it back to the row
     gaps: the rail breathes on a big monitor and tightens back to its
     resting rhythm on a short one (or in the desktop app, whose title bar
     eats height) rather than scrolling. Measured, not a vh formula, so role
     pruning, an expanded submenu and the shortcuts tab all re-fit.

     It lives here rather than in dashboard.js because it has to run before
     the first paint as well as after every later change. dashboard.js runs
     deferred, at the end of the bundle, and an administrator's eighteen rows
     overflow any laptop-height window, so the menu painted at its resting
     10px rhythm and then tightened by 2px a row when the bundle got round to
     it: every row from Overview down moved. fitNavBeforePaint() below does
     the same fit the moment the sidebar has parsed; dashboard.js then calls
     fitNavSpacing() with the same element on every later change and lands on
     the value already on screen. Below the drawer breakpoint (1024px,
     SIDEBAR_BP in dashboard.js) the mobile drawer has its own tighter,
     scrolling rhythm and the property is left alone. */
  var NAV_GAP_BASE = 10;  // --space-10, the resting rhythm
  var NAV_GAP_TIGHT = 8;  // long menu: keep a readable gap; the rail scrolls instead
  var NAV_GAP_MAX = 18;   // past this the rows stop reading as one list
  var NAV_DRAWER_BP = 1024;

  function isVisibleNavChild(el) {
    return !el.hidden && el.getClientRects().length > 0;
  }

  function isSubnav(el) {
    return !!(el.classList && el.classList.contains('tma-dash__subnav'));
  }

  /* One unit per gap the leftover space is split across: every gap between
     visible rows, plus the break above a divided section (it tracks the same
     custom property). An open submenu is deliberately not a row here, see
     fitNavSpacing. */
  function countNavGapUnits(sections) {
    var units = 0;
    sections.forEach(function (section) {
      var rows = Array.prototype.slice.call(section.children).filter(function (el) {
        return isVisibleNavChild(el) && !isSubnav(el);
      });
      if (!rows.length) return;
      units += rows.length - 1;
      if (section.classList.contains('tma-dash__nav-section--divided')) units += 1;
    });
    return units;
  }

  /* How much height the open submenus are taking: each one's box, its
     margins, and the single row gap that separates it from its parent. */
  function openSubnavHeight(sections, gap) {
    var total = 0;
    sections.forEach(function (section) {
      Array.prototype.slice.call(section.children).forEach(function (el) {
        if (!isSubnav(el) || !isVisibleNavChild(el)) return;
        var cs = window.getComputedStyle(el);
        total += el.getBoundingClientRect().height +
          (parseFloat(cs.marginTop) || 0) +
          (parseFloat(cs.marginBottom) || 0) +
          gap;
      });
    });
    return total;
  }

  function fitNavSpacing(navEl) {
    if (!navEl) return;
    if (window.innerWidth <= NAV_DRAWER_BP) { navEl.style.removeProperty('--dash-nav-gap'); return; }
    // Always measure from the resting gap, never from whatever the last run
    // grew it to, or each pass would compound the one before it.
    navEl.style.setProperty('--dash-nav-gap', NAV_GAP_BASE + 'px');
    var sections = Array.prototype.slice
      .call(navEl.querySelectorAll('.tma-dash__nav-section'))
      .filter(isVisibleNavChild);
    var last = sections[sections.length - 1];
    if (!last) return;
    var units = countNavGapUnits(sections);
    if (!units) return;
    // scrollHeight floors at the client height, so it can't report a *short*
    // content box, measure the last section's bottom edge instead.
    var padBottom = parseFloat(window.getComputedStyle(navEl).paddingBottom) || 0;
    var free = navEl.getBoundingClientRect().bottom - padBottom - last.getBoundingClientRect().bottom;
    /*
     * Both rects are in viewport coordinates, so a scrolled nav reports its
     * last section that much higher and the sum reads as spare room that is
     * not there. Nothing scrolled the rail before an open submenu could
     * overflow it; now clicking a group near the bottom scrolls it into
     * view, and without this the menu jumped to its widest spacing.
     */
    free -= navEl.scrollTop;
    /*
     * Measure as if every group were closed.
     *
     * Otherwise opening File Library ate the free space and this handed the
     * shortfall to every gap in the menu, so expanding one group visibly
     * squeezed all the rows above and below it together, and closing it
     * spread them back out. The rail's rhythm is a property of the window's
     * height, not of which group happens to be open: a submenu now simply
     * drops in underneath its parent, and the nav scrolls if the two no
     * longer fit together.
     */
    free += openSubnavHeight(sections, NAV_GAP_BASE);
    // Negative free space means the rows already overflow. Keep a readable
    // floor and let the rail scroll rather than packing the long admin list.
    var gap = NAV_GAP_BASE + Math.floor(free / units);
    gap = Math.max(NAV_GAP_TIGHT, Math.min(NAV_GAP_MAX, gap));
    navEl.style.setProperty('--dash-nav-gap', gap + 'px');
  }

  /* The fit before the first paint. This file runs while <head> is parsing,
     so the sidebar does not exist yet; a mutation observer sees the parser's
     insertions as they happen, in a microtask, which the browser always
     drains before it renders. The header follows the sidebar in the shell,
     so its arrival is the sign that the rail, profile block included, has
     parsed in full: measured any earlier the nav would read taller than the
     space the profile leaves it. The hold CSS above has already taken the
     denied rows out of the layout, so they are not counted. */
  function fitNavBeforePaint() {
    if (document.readyState !== 'loading' || !window.MutationObserver) return;
    if (window.innerWidth <= NAV_DRAWER_BP) return;
    var observer = new MutationObserver(function () {
      if (!document.querySelector('.tma-dash__header')) return;
      observer.disconnect();
      fitNavSpacing(document.querySelector('.tma-dash__sidebar-nav'));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { observer.disconnect(); });
  }

  fitNavBeforePaint();

  window.TMAPortalAccess = {
    can: can,
    fitNavSpacing: fitNavSpacing,
    holds: holds,
    canSettingsPage: function (pageId) { return can(SETTINGS_CAPABILITIES[pageId]); },
    settingsCapabilities: function () { return SETTINGS_CAPABILITIES; },
    apply: apply,
    ready: function () { return readyPromise; },
    capabilities: function () { return caps ? caps.slice() : []; },
    cipReach: function () { return !!cipReach; },
    isProviderContact: function () { return !!providerContact; },
    isServiceProviderAdmin: function () { return !!serviceProviderAdmin; },
  };
})();
