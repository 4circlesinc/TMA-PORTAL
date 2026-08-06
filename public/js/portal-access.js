/*
 * Applies the signed-in account's capabilities to the shell.
 *
 * The sidebar, the mobile menu and the bottom tab bar are static HTML shared
 * by every account type, so a client used to see Clients, Users, Email,
 * Templates, Workflows and People — click any of them and the page loaded,
 * then filled with permission errors. This removes what the server would
 * refuse, so the portal only ever offers what the account can actually use.
 *
 * Removal, not hiding: the global search index is built by reading nav items
 * out of the DOM (portal-search-index.js), so a detached item disappears from
 * search for free. Hiding would have left it findable.
 *
 * This is presentation only. Every capability below is enforced again on the
 * server — see App\Support\Access\Role.
 *
 * Global: window.TMAPortalAccess  ({ can, ready, apply })
 */
(function () {
  'use strict';

  /* data-nav id => the capability needed to see it. Anything absent is open
     to every account: their own dashboard, calendar, files, signatures,
     messages, projects and settings. Names match Role::MATRIX exactly. */
  var NAV_CAPABILITIES = {
    'dash-project-overview': 'overview.view',
    'clients': 'clients.view',
    'email': 'mail.use',
    'so-feed': 'feed.view',
    'users': 'users.view',
    'templates': 'templates.view',
    'folders-all': 'files.viewOrg',
    'folders-shared': 'files.viewOrg',
    'workflows-automated': 'workflows.view',
    'workflows-feedback': 'workflows.view',
    'people-home': 'directory.view',
    'people-employees': 'directory.view',
    /* The client and group screens live inside People, so reaching People at
       all is the first requirement — see Role::PAGE_CAPABILITIES, where these
       carry both capabilities. Listing the narrower one here would leave the
       row in a section the account cannot open. */
    'people-clients': 'directory.view',
    'people-prospects': 'directory.view',
    'people-shared-address': 'directory.view',
    'people-personal-address': 'directory.view',
    'people-groups': 'directory.view',
    'people-resend': 'users.manage',
  };

  /* Bottom tab bar (mobile). data-tab => capability. */
  var TAB_CAPABILITIES = {
    email: 'mail.use',
  };

  /* Account settings rail (portal-admin.js): section id => capability.
     Anything absent is personal — profile, theme, time, notifications,
     privacy, account security, payment, plugins, and linking your own storage
     account. Everything here is the firm's administration, which the rail used
     to offer to every account because it is one static list.
     Mirrors Role::SETTINGS_PAGE_CAPABILITIES; PortalAccessTest holds the two
     together. */
  var SETTINGS_CAPABILITIES = {
    'background-ops': 'settings.operations',
    'reporting': 'settings.reporting',
    'notification-history': 'settings.reporting',
    'branding': 'settings.branding',
    'billing-convert': 'settings.billing',
    'billing-cancel': 'settings.billing',
    'clienthub-access': 'settings.clientHub',
    'service-teams': 'settings.clientHub',
    'custom-fields': 'settings.clientHub',
    'security-insights': 'settings.security',
    'dlp': 'settings.security',
    'signin-policy': 'settings.security',
    'security-policy': 'settings.security',
    'alert-settings': 'settings.security',
    'device-security': 'settings.security',
    'super-users': 'settings.security',
    'quarantined': 'settings.security',
    'storage-usage': 'settings.storage',
    'ai-settings': 'settings.advanced',
    'email-settings': 'settings.advanced',
    'permissions': 'settings.advanced',
    'tools': 'settings.advanced',
    'file-settings': 'files.settings',
    'default-folders': 'files.settings',
    'folder-templates': 'files.settings',
    'upload-forms': 'files.settings',
    'file-drops': 'files.settings',
  };

  var caps = null;
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });

  function can(capability) {
    if (!capability) return true;
    // Before /me resolves nothing is known; callers should await ready().
    if (!caps) return false;
    return caps.indexOf(capability) !== -1;
  }

  function remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* Sidebar and mobile-menu rows both carry data-nav, so one pass covers
     both. The mobile rows use data-mrow but the same ids. */
  function pruneNavItems(scope) {
    scope.querySelectorAll('[data-nav]').forEach(function (el) {
      var need = NAV_CAPABILITIES[el.getAttribute('data-nav')];
      if (need && !can(need)) remove(el);
    });
  }

  /* A group whose children have all gone should not leave an empty
     disclosure behind — drop the toggle and its panel together. */
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
     held nav rows — the Main Menu / Folder Shortcuts tab row, the shortcuts
     list — carry buttons and containers rather than [data-nav], so a live
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

  function pruneTabs(scope) {
    scope.querySelectorAll('[data-tab]').forEach(function (el) {
      var need = TAB_CAPABILITIES[el.getAttribute('data-tab')];
      if (need && !can(need)) remove(el);
    });
  }

  function apply() {
    var scope = document;
    var sections = navSections(scope);
    pruneNavItems(scope);
    pruneEmptyGroups(scope);
    pruneEmptySections(sections);
    pruneTabs(scope);
    document.documentElement.setAttribute('data-tma-access', 'ready');
  }

  /* Hide the gated items until we know, so a client never sees Clients or
     Users flash on screen before /me answers. Staff see them a beat later,
     which is the same beat the profile skeleton already waits for. */
  function injectHoldCss() {
    if (document.getElementById('tma-access-css')) return;
    var selectors = Object.keys(NAV_CAPABILITIES).map(function (id) {
      return '[data-nav="' + id + '"]';
    }).concat(Object.keys(TAB_CAPABILITIES).map(function (id) {
      return '[data-tab="' + id + '"]';
    }));

    var style = document.createElement('style');
    style.id = 'tma-access-css';
    style.textContent = 'html:not([data-tma-access="ready"]) ' +
      selectors.join(', html:not([data-tma-access="ready"]) ') +
      '{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  injectHoldCss();

  function adopt(me) {
    if (!me) return;
    caps = Array.isArray(me.capabilities) ? me.capabilities : [];
    apply();
    readyResolve(caps);
  }

  /* If /me never answers we must not leave the sidebar permanently hidden.
     Reveal everything and let the server refuse — a nav item that 403s is a
     far better failure than a portal with half a menu and no explanation. */
  function releaseHold() {
    if (caps) return;
    document.documentElement.setAttribute('data-tma-access', 'ready');
    readyResolve([]);
  }

  function start() {
    if (!window.TMACurrentUser) {
      // No identity source on this shell — reveal rather than strand the nav.
      releaseHold();
      return;
    }
    window.TMACurrentUser.onChange(adopt);
    setTimeout(releaseHold, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.TMAPortalAccess = {
    can: can,
    canSettingsPage: function (pageId) { return can(SETTINGS_CAPABILITIES[pageId]); },
    settingsCapabilities: function () { return SETTINGS_CAPABILITIES; },
    apply: apply,
    ready: function () { return readyPromise; },
    capabilities: function () { return caps ? caps.slice() : []; },
  };
})();
