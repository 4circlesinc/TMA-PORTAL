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
    'templates-email': 'templates.view',
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
    'security-insights': 'settings.security',
    'signin-policy': 'settings.security',
    'security-policy': 'settings.security',
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
      if (!navIds.length && !tabIds.length && !bootGated.length) return;
    }

    var selectors = navIds.map(function (id) {
      return '[data-nav="' + id + '"]';
    }).concat(tabIds.map(function (id) {
      return '[data-tab="' + id + '"]';
    })).concat(bootGated.map(function (capability) {
      return '[data-boot-needs="' + capability + '"]';
    }));

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

  window.TMAPortalAccess = {
    can: can,
    holds: holds,
    canSettingsPage: function (pageId) { return can(SETTINGS_CAPABILITIES[pageId]); },
    settingsCapabilities: function () { return SETTINGS_CAPABILITIES; },
    apply: apply,
    ready: function () { return readyPromise; },
    capabilities: function () { return caps ? caps.slice() : []; },
    cipReach: function () { return !!cipReach; },
    isProviderContact: function () { return !!providerContact; },
  };
})();
