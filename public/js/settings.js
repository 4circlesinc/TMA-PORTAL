/*
 * TMA - Settings (30919:278108 Profile, change email/name/password, 2-step popups)
 * Global: window.TMASettings
 */
(function () {
  'use strict';

  var ICON = '/images/icons/phosphor/';
  var BRAND = '/images/icons/brands/';
  var AVATAR = '/images/avatars/';

  var CHEVRON_RIGHT = 'M11.3193 24.7071C10.8936 24.3166 10.8936 23.6834 11.3193 23.2929L18.5 16.7071C18.9258 16.3166 18.9258 15.6834 18.5 15.2929L11.3194 8.70711C10.8936 8.31658 10.8936 7.68342 11.3194 7.29289C11.7451 6.90237 12.4355 6.90237 12.8613 7.29289L20.042 13.8787C21.3193 15.0503 21.3194 16.9497 20.042 18.1213L12.8613 24.7071C12.4355 25.0976 11.7451 25.0976 11.3193 24.7071Z';

  var NAV = [
    { id: 'profile', label: 'ByeWind', avatar: true },
    { id: 'theme', label: 'Theme', icon: 'Palette' },
    { id: 'time', label: 'Time and language', icon: 'SunHorizon' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'privacy', label: 'Privacy', icon: 'HandPalm' },
    { id: 'account-security', label: 'Account security', icon: 'ShieldCheck' },
    { id: 'payment', label: 'Payment', icon: 'CurrencyCircleDollar' },
    { id: 'plugins', label: 'Plugins', icon: 'Plugs' },
  ];

  var MOBILE_SETTINGS_MQ = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 960px)')
    : null;

  function isSettingsMobile() {
    return !!(MOBILE_SETTINGS_MQ && MOBILE_SETTINGS_MQ.matches);
  }

  function navLabel(id) {
    var item = NAV.find(function (entry) { return entry.id === id; });
    return item ? item.label : 'Settings';
  }

  function detailTitle(id) {
    if (id === 'profile') return 'Profile';
    return navLabel(id);
  }

  function getActiveNavId(root) {
    var active = root.querySelector('[data-settings-nav].is-active');
    return active ? active.getAttribute('data-settings-nav') : 'profile';
  }

  function setMobileView(root, mode, activeId) {
    var card = root.querySelector('[data-settings-card]');
    var mobileHead = root.querySelector('[data-settings-mobile-head]');
    var mobileTitle = root.querySelector('[data-settings-mobile-title]');
    if (!card || !isSettingsMobile()) return;
    var inDetail = mode === 'detail';
    card.classList.toggle('is-settings-menu', !inDetail);
    card.classList.toggle('is-settings-detail', inDetail);
    if (mobileHead) mobileHead.hidden = !inDetail;
    if (mobileTitle) mobileTitle.textContent = detailTitle(activeId || getActiveNavId(root));
  }

  function showSettingsMenu(root) {
    if (!isSettingsMobile()) return;
    closePaymentPayout(root);
    closePaymentSwipes(root);
    closePopups(root);
    setMobileView(root, 'menu');
  }

  function syncSettingsLayout(root, activeId) {
    var card = root.querySelector('[data-settings-card]');
    var mobileHead = root.querySelector('[data-settings-mobile-head]');
    if (!card) return;
    if (!isSettingsMobile()) {
      card.classList.remove('is-settings-menu', 'is-settings-detail');
      if (mobileHead) mobileHead.hidden = true;
      return;
    }
    if (!card.classList.contains('is-settings-detail')) {
      setMobileView(root, 'menu');
    } else {
      setMobileView(root, 'detail', activeId || getActiveNavId(root));
    }
    syncPluginsMobileChrome(root, activeId || getActiveNavId(root));
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderSwitch(checked, ariaLabel, inputAttrs) {
    return '<label class="tma-dash__settings-switch">' +
      '<input class="tma-dash__settings-switch-input" type="checkbox"' + (checked ? ' checked' : '') +
      (inputAttrs ? ' ' + inputAttrs : '') +
      ' role="switch" aria-label="' + esc(ariaLabel || 'Support access') + '">' +
      '<span class="tma-dash__settings-switch-ui" aria-hidden="true">' +
      '<span class="tma-dash__settings-switch-track"></span>' +
      '<span class="tma-dash__settings-switch-thumb"></span></span></label>';
  }

  function chevronSvg(className) {
    return '<svg class="' + className + '" width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="' + CHEVRON_RIGHT + '" fill="currentColor"></path></svg>';
  }

  function chevronIcon() {
    return chevronSvg('tma-dash__settings-chevron');
  }

  function renderRow(opts) {
    var tag = opts.href ? 'a' : 'button';
    var rowClass = 'tma-dash__settings-row' +
      (opts.highlight ? ' tma-dash__settings-row--highlight' : '') +
      (opts.disabled ? ' tma-dash__settings-row--disabled' : '');
    var open = tag === 'a'
      ? '<a class="' + rowClass + '" href="' + esc(opts.href) + '"'
      : '<button type="button" class="' + rowClass + '"' + (opts.disabled ? ' disabled' : '');
    var attrs = open +
      (opts.action ? ' data-settings-action="' + esc(opts.action) + '"' : '') + '>';
    var valueClass = 'tma-dash__settings-row-value' +
      (opts.value ? '' : ' tma-dash__settings-row-value--icon-only') +
      (opts.valueMuted ? ' tma-dash__settings-row-value--muted' : '');
    var chevron = opts.chevron !== false
      ? '<span class="' + valueClass + '">' +
        (opts.value ? '<span data-settings-row-value="' + esc(opts.action || opts.label) + '">' + esc(opts.value) + '</span>' : '') +
        chevronIcon() + '</span>'
      : '';
    if (opts.switch) {
      chevron = renderSwitch(!!opts.switchChecked, opts.switchLabel || opts.label, opts.switchAttrs || '');
    }
    return attrs +
      '<span class="tma-dash__settings-row-copy">' +
      '<span class="tma-dash__settings-row-label' + (opts.danger ? ' tma-dash__settings-row-label--danger' : '') + '">' + esc(opts.label) + '</span>' +
      (opts.descHtml ? '<span class="tma-dash__settings-row-desc">' + opts.descHtml + '</span>' :
        (opts.desc ? '<span class="tma-dash__settings-row-desc">' + esc(opts.desc) + '</span>' : '')) +
      '</span>' + chevron + '</' + tag + '>';
  }

  function profileInnerDivider() {
    return '<hr class="tma-dash__settings-profile-inner-divider" aria-hidden="true">';
  }

  function renderProfilePanel() {
    return '<section class="tma-dash__settings-panel is-active" data-settings-panel="profile">' +
      '<div class="tma-dash__settings-profile-stack">' +
      '<div class="tma-dash__settings-profile-head">' +
      '<img class="tma-dash__settings-avatar" src="' + AVATAR + 'AvatarByewind.png" alt="" width="48" height="48">' +
      '<div><p class="tma-dash__settings-profile-name">ByeWind</p><p class="tma-dash__settings-profile-email">byewind@twitter.com</p></div></div>' +
      '<div class="tma-dash__settings-profile-block tma-dash__settings-profile-block--solo">' +
      renderRow({ label: 'Name', value: 'ByeWind', valueMuted: true, action: 'change-name' }) +
      '</div>' +
      '<hr class="tma-dash__settings-divider tma-dash__settings-profile-outer-divider">' +
      '<div class="tma-dash__settings-profile-block tma-dash__settings-profile-block--group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-profile-group-label">Account security</h2>' +
      renderRow({ label: 'Email', value: 'byewind@twitter.com', valueMuted: true, action: 'change-email' }) +
      profileInnerDivider() +
      renderRow({
        label: 'Password',
        desc: 'Set a permanent password to login to your account.',
        highlight: true,
        action: 'change-password',
        value: '',
      }) +
      profileInnerDivider() +
      renderRow({
        label: '2-step verification',
        desc: 'Add an additional layer of security to your account during sign in.',
        value: 'Off',
        valueMuted: true,
        action: 'two-step',
      }) +
      '</div>' +
      '<hr class="tma-dash__settings-divider tma-dash__settings-profile-outer-divider">' +
      '<div class="tma-dash__settings-profile-block tma-dash__settings-profile-block--group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-profile-group-label">Support</h2>' +
      renderRow({
        label: 'Support access',
        descHtml: 'Grant TMA support temporary access to your account so we can troubleshoot problems or recover content on your behalf.<br><br>You can revoke access at any time.',
        switch: true,
        switchChecked: true,
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Log out of all devices',
        desc: 'Log out of all other active sessions on other devices besides this one.',
        action: 'logout-all',
        value: '',
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Delete my account',
        desc: 'Permanently delete the account and remove access from all devices.',
        danger: true,
        action: 'delete-account',
        value: '',
      }) +
      '</div></div></section>';
  }

  function renderPlaceholderPanel(id, label) {
    return '<section class="tma-dash__settings-panel" data-settings-panel="' + esc(id) + '" hidden>' +
      '<p class="tma-dash__settings-placeholder">' + esc(label) + ' settings are coming soon.</p></section>';
  }

  var THEME_MODES = [
    { id: 'system', label: 'System', preview: 'system' },
    { id: 'light', label: 'Light', preview: 'light' },
    { id: 'dark', label: 'Dark', preview: 'dark' },
  ];

  var ACCENT_SWATCHES = [
    { id: 'indigo', color: 'var(--color-indigo)' },
    { id: 'yellow', color: 'var(--color-yellow)' },
    { id: 'red', color: 'var(--color-red)' },
    { id: 'blue', color: 'var(--color-blue)' },
    { id: 'orange', color: 'var(--color-orange)' },
    { id: 'green', color: 'var(--color-green)' },
  ];

  var SIDEBAR_STYLES = [
    {
      id: 'standard',
      label: 'Standard Sidebar',
      desc: 'Opens beside the content and can be expanded or collapsed by clicking.',
    },
    {
      id: 'hover',
      label: 'Hover Overlay Sidebar',
      desc: 'Opens over the content when hovered and stays collapsed when not in use.',
    },
  ];

  function renderThemePreview(type) {
    return '<span class="tma-dash__settings-theme-preview tma-dash__settings-theme-preview--' + esc(type) + '" aria-hidden="true">' +
      '<span class="tma-dash__settings-theme-preview-sidebar"></span>' +
      '<span class="tma-dash__settings-theme-preview-main">' +
      '<span class="tma-dash__settings-theme-preview-block tma-dash__settings-theme-preview-block--header"></span>' +
      '<span class="tma-dash__settings-theme-preview-block"></span>' +
      '<span class="tma-dash__settings-theme-preview-panel">' +
      '<span class="tma-dash__settings-theme-preview-line"></span>' +
      '<span class="tma-dash__settings-theme-preview-line"></span>' +
      '<span class="tma-dash__settings-theme-preview-line tma-dash__settings-theme-preview-line--short"></span>' +
      '</span></span></span>';
  }

  function renderThemeModeOption(mode) {
    return '<button type="button" class="tma-dash__settings-theme-option" data-theme-mode="' + esc(mode.id) + '" aria-pressed="false">' +
      renderThemePreview(mode.preview) +
      '<span class="tma-dash__settings-theme-option-label">' + esc(mode.label) + '</span></button>';
  }

  function renderSidebarStylePreview(type) {
    return '<span class="tma-dash__settings-theme-preview tma-dash__settings-theme-preview--light tma-dash__settings-sidebar-preview tma-dash__settings-sidebar-preview--' + esc(type) + '" aria-hidden="true">' +
      '<span class="tma-dash__settings-theme-preview-sidebar"></span>' +
      '<span class="tma-dash__settings-theme-preview-main">' +
      '<span class="tma-dash__settings-theme-preview-block tma-dash__settings-theme-preview-block--header"></span>' +
      '<span class="tma-dash__settings-theme-preview-block"></span>' +
      '</span></span>';
  }

  function renderSidebarStyleOption(style) {
    return '<button type="button" class="tma-dash__settings-theme-option tma-dash__settings-sidebar-style-option" data-sidebar-style="' + esc(style.id) + '" aria-pressed="false">' +
      renderSidebarStylePreview(style.id) +
      '<span class="tma-dash__settings-sidebar-style-copy">' +
      '<span class="tma-dash__settings-theme-option-label">' + esc(style.label) + '</span>' +
      '<span class="tma-dash__settings-sidebar-style-desc">' + esc(style.desc) + '</span>' +
      '</span></button>';
  }

  function renderFontScaleStep(step) {
    return '<button type="button" class="tma-dash__settings-font-scale-step" data-font-scale="' + step + '" role="radio" aria-checked="false" aria-label="Font size step ' + step + '"></button>';
  }

  function renderThemePanel() {
    var fontSteps = '';
    var i;
    for (i = 1; i <= 5; i++) fontSteps += renderFontScaleStep(i);

    return '<section class="tma-dash__settings-panel tma-dash__settings-panel--theme" data-settings-panel="theme" hidden data-node-id="30919:278123" data-node-id-mobile="30919:293276">' +
      '<div class="tma-dash__settings-theme-stack">' +
      '<div class="tma-dash__settings-theme-group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-theme-section-title">Theme</h2>' +
      '<p class="tma-dash__settings-theme-group-label">Theme</p>' +
      '<div class="tma-dash__settings-theme-options" role="radiogroup" aria-label="Theme">' +
      THEME_MODES.map(renderThemeModeOption).join('') +
      '</div></div>' +
      '<hr class="tma-dash__settings-divider tma-dash__settings-theme-divider">' +
      '<div class="tma-dash__settings-theme-group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-theme-section-title">Font size</h2>' +
      '<p class="tma-dash__settings-theme-group-label">Font size</p>' +
      '<div class="tma-dash__settings-font-scale" role="radiogroup" aria-label="Font size">' +
      '<img class="tma-dash__settings-font-scale-icon tma-dash__settings-font-scale-icon--sm" src="' + ICON + 'TextAa.svg" alt="" width="20" height="20">' +
      '<div class="tma-dash__settings-font-scale-track">' + fontSteps + '</div>' +
      '<img class="tma-dash__settings-font-scale-icon tma-dash__settings-font-scale-icon--lg" src="' + ICON + 'TextAa.svg" alt="" width="32" height="32">' +
      '</div></div>' +
      '<hr class="tma-dash__settings-divider tma-dash__settings-theme-divider">' +
      '<div class="tma-dash__settings-theme-group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-theme-section-title">Color</h2>' +
      '<p class="tma-dash__settings-theme-group-label">Color</p>' +
      '<div class="tma-dash__settings-color-row" role="radiogroup" aria-label="Accent color">' +
      ACCENT_SWATCHES.map(function (swatch) {
        return '<button type="button" class="tma-dash__settings-color-swatch" data-accent-color="' + esc(swatch.id) + '" style="--settings-swatch:' + swatch.color + '" aria-pressed="false" aria-label="' + esc(swatch.id) + '">' +
          '<img src="' + ICON + 'Check.svg" alt="" width="28" height="28"></button>';
      }).join('') +
      '</div></div>' +
      '<hr class="tma-dash__settings-divider tma-dash__settings-theme-divider">' +
      '<div class="tma-dash__settings-theme-group">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-theme-section-title">Sidebar style</h2>' +
      '<p class="tma-dash__settings-theme-group-label">Sidebar style</p>' +
      '<div class="tma-dash__settings-theme-options tma-dash__settings-sidebar-style-options" role="radiogroup" aria-label="Sidebar style">' +
      SIDEBAR_STYLES.map(renderSidebarStyleOption).join('') +
      '</div></div></div></section>';
  }

  function getPrefsApi() {
    return window.TMADashboard || null;
  }

  function readThemePrefs() {
    var api = getPrefsApi();
    if (api && api.getPrefs) return api.getPrefs();
    return { themeMode: 'system', fontScale: 3, accentColor: 'indigo', sidebarStyle: 'hover' };
  }

  function syncThemePanelUI(root) {
    var prefs = readThemePrefs();
    root.querySelectorAll('[data-theme-mode]').forEach(function (btn) {
      var on = btn.getAttribute('data-theme-mode') === prefs.themeMode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('[data-font-scale]').forEach(function (btn) {
      var on = parseInt(btn.getAttribute('data-font-scale'), 10) === prefs.fontScale;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    root.querySelectorAll('[data-accent-color]').forEach(function (btn) {
      var on = btn.getAttribute('data-accent-color') === prefs.accentColor;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('[data-sidebar-style]').forEach(function (btn) {
      var on = btn.getAttribute('data-sidebar-style') === (prefs.sidebarStyle || 'hover');
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function bindThemePanel(root) {
    root.querySelectorAll('[data-theme-mode]').forEach(function (btn) {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-theme-mode');
        var api = getPrefsApi();
        if (api && api.setThemeMode) api.setThemeMode(mode);
        syncThemePanelUI(root);
      });
    });

    root.querySelectorAll('[data-font-scale]').forEach(function (btn) {
      if (btn.dataset.fontScaleBound) return;
      btn.dataset.fontScaleBound = '1';
      btn.addEventListener('click', function () {
        var scale = parseInt(btn.getAttribute('data-font-scale'), 10);
        var api = getPrefsApi();
        if (api && api.setFontScale) api.setFontScale(scale);
        syncThemePanelUI(root);
      });
    });

    root.querySelectorAll('[data-accent-color]').forEach(function (btn) {
      if (btn.dataset.accentBound) return;
      btn.dataset.accentBound = '1';
      btn.addEventListener('click', function () {
        var colorId = btn.getAttribute('data-accent-color');
        var api = getPrefsApi();
        if (api && api.setAccentColor) api.setAccentColor(colorId);
        syncThemePanelUI(root);
      });
    });

    root.querySelectorAll('[data-sidebar-style]').forEach(function (btn) {
      if (btn.dataset.sidebarStyleBound) return;
      btn.dataset.sidebarStyleBound = '1';
      btn.addEventListener('click', function () {
        var style = btn.getAttribute('data-sidebar-style');
        // Unlike theme/font/accent (local-only), sidebar style is a
        // per-user preference that must persist server-side and sync
        // across the user's other sessions — store.set write-throughs to
        // /me/preferences (see PREF_SERVER_KEYS below), and the prefs API
        // call applies it to the live sidebar immediately.
        store.set('tma.sidebarStyle', style);
        // A discrete click, not a continuous input like typing — flush the
        // write-through right away instead of waiting out the 400ms debounce
        // (meant for rapid-fire changes). Otherwise a reload moments after
        // picking a style can race the debounced PUT: hydratePrefs() would
        // fetch the still-stale server value and revert what was just picked.
        flushPrefSync();
        var api = getPrefsApi();
        if (api && api.setSidebarStyle) api.setSidebarStyle(style);
        syncThemePanelUI(root);
      });
    });

    syncThemePanelUI(root);
  }

  /* localStorage key ↔ server preference key, for settings we persist to the
     account (Time and language, sidebar style). Changing one of these
     write-through saves to /me/preferences; on mount we hydrate localStorage
     from the server. */
  var PREF_SERVER_KEYS = {
    'tma.autoTimezone': 'autoTimezone',
    'tma.timezone': 'timezone',
    'tma.language': 'language',
    'tma.voice': 'voice',
    'tma.sidebarStyle': 'sidebarStyle',
  };

  function prefXsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  var prefPending = {}, prefTimer = null;
  function queuePrefSync(serverKey, localKey, rawValue) {
    prefPending[serverKey] = localKey === 'tma.autoTimezone'
      ? (rawValue === '1' || rawValue === true)
      : rawValue;
    if (prefTimer) clearTimeout(prefTimer);
    prefTimer = setTimeout(flushPrefSync, 400);
  }
  function flushPrefSync() {
    var body = prefPending; prefPending = {}; prefTimer = null;
    if (!Object.keys(body).length) return;
    fetch('/me/preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': prefXsrf(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    }).catch(function () {});
  }

  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? d : v;
      } catch (e) {
        return d;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
      if (PREF_SERVER_KEYS[k]) queuePrefSync(PREF_SERVER_KEYS[k], k, v);
    },
  };

  function applyLanguage() {
    try {
      var lang = localStorage.getItem('tma.language');
      if (lang) document.documentElement.setAttribute('lang', lang);
    } catch (e) {}
  }

  var prefsHydrated = false;
  function hydratePrefs(root) {
    fetch('/me/preferences', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p) return;
      var changed = false;
      Object.keys(PREF_SERVER_KEYS).forEach(function (localKey) {
        var serverKey = PREF_SERVER_KEYS[localKey];
        if (p[serverKey] === undefined || p[serverKey] === null) return;
        var val = localKey === 'tma.autoTimezone' ? (p[serverKey] ? '1' : '0') : String(p[serverKey]);
        if (localStorage.getItem(localKey) !== val) {
          try { localStorage.setItem(localKey, val); } catch (e) {}
          changed = true;
        }
      });
      applyLanguage();
      // Sidebar style needs to actually take effect on load (not just sit in
      // localStorage until the user visits Settings), so this always applies
      // it — idempotent when it hasn't changed from what dashboard.js booted
      // with.
      if (p.sidebarStyle) {
        var api = getPrefsApi();
        if (api && api.setSidebarStyle) api.setSidebarStyle(p.sidebarStyle);
      }
      if (p.toasts) {
        writeToastPrefs(p.toasts, { sync: false, preview: false });
      }
      if (changed && root && document.body.contains(root)) {
        try { syncTimePanelUI(root); } catch (e) {}
        try { syncThemePanelUI(root); } catch (e) {}
        try { syncNotificationsPanelUI(root); } catch (e) {}
      } else if (root && document.body.contains(root) && p.toasts) {
        try { syncNotificationsPanelUI(root); } catch (e) {}
      }
    }).catch(function () {});
  }

  var TIMEZONES = [
    { id: 'utc-12', label: 'UTC-12 Baker Island Time' },
    { id: 'utc-11', label: 'UTC-11 Niue Time' },
    { id: 'utc-10', label: 'UTC-10 Hawaii-Aleutian Standard Time' },
    { id: 'utc-9', label: 'UTC-9 Alaska Standard Time' },
    { id: 'utc-8', label: 'UTC-8 Pacific Standard Time' },
    { id: 'utc-7', label: 'UTC-7 Mountain Standard Time' },
    { id: 'utc-6', label: 'UTC-6 Central Standard Time' },
    { id: 'utc-5', label: 'UTC-5 Eastern Standard Time' },
    { id: 'utc-4', label: 'UTC-4 Atlantic Standard Time' },
    { id: 'utc-3', label: 'UTC-3 Argentina Time' },
    { id: 'utc-2', label: 'UTC-2 South Georgia Time' },
    { id: 'utc-1', label: 'UTC-1 Azores Time' },
    { id: 'utc+0', label: 'UTC+0 Greenwich Mean Time' },
    { id: 'utc+1', label: 'UTC+1 Central European Time' },
    { id: 'utc+2', label: 'UTC+2 Eastern European Time' },
    { id: 'utc+3', label: 'UTC+3 Moscow Standard Time' },
    { id: 'utc+4', label: 'UTC+4 Gulf Standard Time' },
    { id: 'utc+5', label: 'UTC+5 Pakistan Standard Time, Maldives, Yekaterinburg' },
    { id: 'utc+8', label: 'UTC+8 China Standard Time' },
  ];

  var LANGUAGES = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Espa\u00f1ol' },
    { id: 'zh-hans', label: '\u4e2d\u6587(\u7b80\u4f53)' },
    { id: 'zh-hant', label: '\u4e2d\u6587(\u7e41\u4f53)' },
    { id: 'fr', label: 'Fran\u00e7ais' },
    { id: 'de', label: 'Deutsch' },
    { id: 'ja', label: '\u65e5\u672c\u8a9e' },
    { id: 'ko', label: '\ud55c\uad6d\uc5b4' },
    { id: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
    { id: 'nl', label: 'Nederlands' },
    { id: 'sv', label: 'Svenska' },
    { id: 'no', label: 'Norsk' },
    { id: 'da', label: 'Dansk' },
    { id: 'fi', label: 'Suomi' },
    { id: 'el', label: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac' },
  ];

  var MOBILE_SELECT_TITLES = {
    timezone: 'Select time zone',
    language: 'Select language',
    voice: 'Select voice',
    slack: 'Slack notifications',
    'toast-position': 'Toast position',
    'toast-duration': 'Display duration',
  };

  var MOBILE_SELECT_PANEL = {
    timezone: 'time',
    language: 'time',
    voice: 'time',
    slack: 'notifications',
    'toast-position': 'notifications',
    'toast-duration': 'notifications',
  };

  function getMobileSelectPanel(root, selectId) {
    var panelId = MOBILE_SELECT_PANEL[selectId] || 'time';
    return root.querySelector('[data-settings-panel="' + panelId + '"]');
  }

  function getMobileSelectOverlay(root, selectId) {
    var panel = getMobileSelectPanel(root, selectId);
    return panel && panel.querySelector('[data-settings-mobile-select]');
  }

  var VOICES = [
    { id: 'en-us', label: 'English (United States)' },
    { id: 'en-gb', label: 'English (United Kingdom)' },
    { id: 'es-es', label: 'Espa\u00f1ol (Espa\u00f1a)' },
    { id: 'zh-cn', label: '\u4e2d\u6587(\u7b80\u4f53)' },
    { id: 'fr-fr', label: 'Fran\u00e7ais (France)' },
  ];

  function findOption(list, id, fallbackId) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].id === fallbackId) return list[i];
    }
    return list[0];
  }

  function readTimePrefs() {
    return {
      autoTimezone: store.get('tma.autoTimezone', '0') === '1',
      timezone: store.get('tma.timezone', 'utc+0'),
      language: store.get('tma.language', 'zh-hans'),
      voice: store.get('tma.voice', 'en-us'),
    };
  }

  function renderPickerList(items, selectedId) {
    return items.map(function (item) {
      var on = item.id === selectedId;
      return '<button type="button" class="tma-dash__settings-picker-option' + (on ? ' is-active' : '') + '" role="option" aria-selected="' + String(on) + '" data-picker-option="' + esc(item.id) + '">' +
        '<span class="tma-dash__settings-picker-option-label">' + esc(item.label) + '</span>' +
        (on ? '<img class="tma-dash__settings-picker-check" src="' + ICON + 'Check.svg" alt="" width="16" height="16">' : '') +
        '</button>';
    }).join('');
  }

  function renderPicker(id, nodeId, items, selectedId) {
    return '<div class="tma-dash__settings-picker" data-settings-picker="' + esc(id) + '" hidden role="listbox" data-node-id="' + esc(nodeId) + '">' +
      '<label class="tma-dash__settings-picker-search-wrap">' +
      '<input class="tma-dash__settings-picker-search" type="search" placeholder="Type a value..." data-picker-search aria-label="Search ' + esc(id) + '">' +
      '</label>' +
      '<div class="tma-dash__settings-picker-list" data-picker-list>' + renderPickerList(items, selectedId) + '</div></div>';
  }

  function renderMobileSelectOption(item, selectedId) {
    var on = item.id === selectedId;
    return '<button type="button" class="tma-dash__settings-mobile-select-option' + (on ? ' is-active' : '') + '" data-mobile-select-option="' + esc(item.id) + '">' +
      '<span class="tma-dash__settings-mobile-select-option-label">' + esc(item.label) + '</span></button>';
  }

  function renderMobileSelectOverlay(nodeId) {
    return '<div class="tma-dash__settings-mobile-select" data-settings-mobile-select hidden data-node-id="' + esc(nodeId || '30919:293299') + '">' +
      '<label class="tma-dash__settings-mobile-select-search">' +
      '<img src="' + ICON + 'MagnifyingGlass.svg" alt="" width="20" height="20">' +
      '<input type="search" class="tma-dash__settings-mobile-select-search-input" data-mobile-select-search placeholder="Search" autocomplete="off" aria-label="Search options">' +
      '<img class="tma-dash__settings-mobile-select-mic" src="' + ICON + 'Microphone.svg" alt="" width="20" height="20" aria-hidden="true">' +
      '</label>' +
      '<div class="tma-dash__settings-mobile-select-pinned" data-mobile-select-pinned hidden></div>' +
      '<div class="tma-dash__settings-mobile-select-card" data-mobile-select-list></div></div>';
  }

  function renderTimePanel() {
    var prefs = readTimePrefs();
    var timezone = findOption(TIMEZONES, prefs.timezone, 'utc+0');

    return '<section class="tma-dash__settings-panel tma-dash__settings-panel--time" data-settings-panel="time" hidden data-node-id="30919:278124" data-node-id-mobile="30919:293272">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-time-section-title">Time and language</h2>' +
      '<div class="tma-dash__settings-time-stack">' +
      '<div class="tma-dash__settings-time-group">' +
      '<p class="tma-dash__settings-time-group-label">Time and language</p>' +
      renderRow({
        label: 'Automatically set time zone',
        desc: 'Reminders, notifications and emails are delivered based on your time zone.',
        switch: true,
        switchChecked: prefs.autoTimezone,
        switchLabel: 'Automatically set time zone',
        switchAttrs: 'data-settings-auto-timezone',
        chevron: false,
        highlight: true,
      }) +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="timezone">' +
      '<div class="tma-dash__settings-time-tz-row tma-dash__settings-time-tz-row--desktop">' +
      renderRow({
        label: 'Time Zone',
        desc: 'Current time zone setting.',
        action: 'pick-timezone',
        value: timezone.label,
        valueMuted: true,
        disabled: prefs.autoTimezone,
      }) +
      '</div>' +
      '<div class="tma-dash__settings-time-tz-row tma-dash__settings-time-tz-row--mobile">' +
      renderRow({
        label: 'Date and time',
        desc: 'Time zone, calendar display.',
        action: 'pick-timezone',
        value: '',
        disabled: prefs.autoTimezone,
      }) +
      '</div>' +
      renderPicker('timezone', '30919:278185', TIMEZONES, prefs.timezone) +
      '</div>' +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="language">' +
      renderRow({
        label: 'Language and Region',
        desc: 'Display language, region format.',
        action: 'pick-language',
        value: '',
      }) +
      renderPicker('language', '30919:278186', LANGUAGES, prefs.language) +
      '</div>' +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="voice">' +
      renderRow({
        label: 'Voice',
        desc: 'Speech language, speech recognition, sound.',
        action: 'pick-voice',
        value: '',
      }) +
      renderPicker('voice', '30919:278186', VOICES, prefs.voice) +
      '</div></div></div>' +
      renderMobileSelectOverlay() +
      '</section>';
  }

  function getTimeSelectList(id) {
    if (id === 'timezone') return TIMEZONES;
    if (id === 'language') return LANGUAGES;
    return VOICES;
  }

  function getTimeSelectValue(prefs, id) {
    if (id === 'timezone') return prefs.timezone;
    if (id === 'language') return prefs.language;
    return prefs.voice;
  }

  function getMobileSelectList(id) {
    if (id === 'slack') return SLACK_STATES;
    if (id === 'toast-position') return TOAST_POSITIONS;
    if (id === 'toast-duration') return TOAST_DURATIONS;
    return getTimeSelectList(id);
  }

  function getMobileSelectValue(id) {
    if (id === 'slack') return readNotificationsPrefs().slack;
    if (id === 'toast-position') return String(readToastPrefs().position);
    if (id === 'toast-duration') return String(readToastPrefs().durationSec);
    return getTimeSelectValue(readTimePrefs(), id);
  }

  function syncMobileSelectUI(root, id) {
    var overlay = id
      ? getMobileSelectOverlay(root, id)
      : root.querySelector('[data-settings-panel].is-mobile-select-open [data-settings-mobile-select]');
    if (!overlay) return;
    id = id || overlay.getAttribute('data-active-select');
    if (!id) return;

    var list = getMobileSelectList(id);
    var selected = getMobileSelectValue(id);
    var selectedItem = findOption(list, selected, list[0].id);
    var pinnedEl = overlay.querySelector('[data-mobile-select-pinned]');
    var listEl = overlay.querySelector('[data-mobile-select-list]');

    if (pinnedEl) {
      pinnedEl.innerHTML = renderMobileSelectOption(selectedItem, selected);
      pinnedEl.hidden = false;
    }
    if (listEl) {
      listEl.innerHTML = list.filter(function (item) { return item.id !== selectedItem.id; })
        .map(function (item) { return renderMobileSelectOption(item, selected); }).join('');
    }
  }

  function filterMobileSelectList(overlay, query) {
    var q = String(query || '').trim().toLowerCase();
    overlay.querySelectorAll('[data-mobile-select-option]').forEach(function (btn) {
      var label = btn.querySelector('.tma-dash__settings-mobile-select-option-label');
      var text = label ? label.textContent.toLowerCase() : '';
      btn.hidden = q && text.indexOf(q) === -1;
    });
  }

  function closeMobileSelect(root) {
    var panel = root.querySelector('[data-settings-panel].is-mobile-select-open');
    var overlay = panel && panel.querySelector('[data-settings-mobile-select]');
    if (!overlay) return;

    overlay.hidden = true;
    overlay.removeAttribute('data-active-select');
    panel.classList.remove('is-mobile-select-open');

    var mobileTitle = root.querySelector('[data-settings-mobile-title]');
    if (mobileTitle && overlay.dataset.previousTitle) {
      mobileTitle.textContent = overlay.dataset.previousTitle;
      delete overlay.dataset.previousTitle;
    }

    root.classList.remove('is-settings-mobile-select-open');
  }

  function openMobileSelect(root, id) {
    var panel = getMobileSelectPanel(root, id);
    var overlay = panel && panel.querySelector('[data-settings-mobile-select]');
    if (!overlay) return;

    var mobileTitle = root.querySelector('[data-settings-mobile-title]');
    if (mobileTitle) {
      overlay.dataset.previousTitle = mobileTitle.textContent;
      mobileTitle.textContent = MOBILE_SELECT_TITLES[id] || 'Select';
    }

    overlay.setAttribute('data-active-select', id);
    overlay.hidden = false;
    panel.classList.add('is-mobile-select-open');
    root.classList.add('is-settings-mobile-select-open');

    var search = overlay.querySelector('[data-mobile-select-search]');
    if (search) {
      search.value = '';
      filterMobileSelectList(overlay, '');
      window.setTimeout(function () { search.focus(); }, 0);
    }

    syncMobileSelectUI(root, id);
  }

  function closePickers(root) {
    closeMobileSelect(root);
    root.querySelectorAll('[data-settings-picker], [data-settings-cookie-popover]').forEach(function (picker) {
      picker.hidden = true;
    });
    root.classList.remove('is-settings-picker-open');
  }

  function openCookiePopover(root) {
    closePickers(root);
    var anchor = root.querySelector('[data-picker-anchor="cookies"]');
    var popover = anchor && anchor.querySelector('[data-settings-cookie-popover]');
    if (!popover) return;
    popover.hidden = false;
    root.classList.add('is-settings-picker-open');
  }

  function openPicker(root, id) {
    closePickers(root);
    if (isSettingsMobile() && MOBILE_SELECT_TITLES[id]) {
      openMobileSelect(root, id);
      return;
    }
    var anchor = root.querySelector('[data-picker-anchor="' + id + '"]');
    var picker = anchor && anchor.querySelector('[data-settings-picker="' + id + '"]');
    if (!picker) return;
    picker.hidden = false;
    root.classList.add('is-settings-picker-open');
    var search = picker.querySelector('[data-picker-search]');
    if (search) {
      search.value = '';
      filterPickerList(picker, '');
      window.setTimeout(function () { search.focus(); }, 0);
    }
    var selected = picker.querySelector('[data-picker-option].is-active');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function filterPickerList(picker, query) {
    var q = String(query || '').trim().toLowerCase();
    picker.querySelectorAll('[data-picker-option]').forEach(function (btn) {
      var label = btn.querySelector('.tma-dash__settings-picker-option-label');
      var text = label ? label.textContent.toLowerCase() : '';
      btn.hidden = q && text.indexOf(q) === -1;
    });
  }

  function syncTimePanelUI(root) {
    var prefs = readTimePrefs();
    var timezone = findOption(TIMEZONES, prefs.timezone, 'utc+0');

    root.querySelectorAll('[data-settings-action="pick-timezone"]').forEach(function (tzRow) {
      tzRow.disabled = prefs.autoTimezone;
      tzRow.classList.toggle('tma-dash__settings-row--disabled', prefs.autoTimezone);
      var tzValue = tzRow.querySelector('[data-settings-row-value="pick-timezone"]');
      if (tzValue) tzValue.textContent = timezone.label;
    });

    var autoToggle = root.querySelector('[data-settings-auto-timezone]');
    if (autoToggle) autoToggle.checked = prefs.autoTimezone;

    root.querySelectorAll('[data-settings-picker="timezone"], [data-settings-picker="language"], [data-settings-picker="voice"]').forEach(function (picker) {
      var id = picker.getAttribute('data-settings-picker');
      var list = getTimeSelectList(id);
      var selected = getTimeSelectValue(prefs, id);
      var listEl = picker.querySelector('[data-picker-list]');
      if (listEl) listEl.innerHTML = renderPickerList(list, selected);
    });

    var timePanel = root.querySelector('[data-settings-panel="time"]');
    if (timePanel && timePanel.classList.contains('is-mobile-select-open')) {
      var mobileOverlay = timePanel.querySelector('[data-settings-mobile-select]');
      if (mobileOverlay && mobileOverlay.getAttribute('data-active-select')) {
        syncMobileSelectUI(root, mobileOverlay.getAttribute('data-active-select'));
      }
    }
  }

  function bindMobileSelectOverlays(root) {
    root.querySelectorAll('[data-settings-mobile-select]').forEach(function (mobileSelect) {
      if (mobileSelect.dataset.bound) return;
      mobileSelect.dataset.bound = '1';
      var mobileSearch = mobileSelect.querySelector('[data-mobile-select-search]');
      if (mobileSearch) {
        mobileSearch.addEventListener('input', function () {
          filterMobileSelectList(mobileSelect, mobileSearch.value);
        });
      }
      mobileSelect.addEventListener('click', function (e) {
        var option = e.target.closest('[data-mobile-select-option]');
        if (!option) return;
        e.preventDefault();
        var id = mobileSelect.getAttribute('data-active-select');
        var value = option.getAttribute('data-mobile-select-option');
        if (id === 'toast-position' || id === 'toast-duration') {
          applyToastPickerChoice(id, value);
          closeMobileSelect(root);
          syncNotificationsPanelUI(root);
          return;
        }
        var storageKey = PICKER_STORAGE_KEYS[id];
        if (!storageKey) return;
        store.set(storageKey, value);
        closeMobileSelect(root);
        if (id === 'slack') syncNotificationsPanelUI(root);
        else syncTimePanelUI(root);
      });
    });
  }

  function bindTimePanel(root) {
    var autoToggle = root.querySelector('[data-settings-auto-timezone]');
    if (autoToggle && !autoToggle.dataset.bound) {
      autoToggle.dataset.bound = '1';
      autoToggle.addEventListener('change', function () {
        store.set('tma.autoTimezone', autoToggle.checked ? '1' : '0');
        syncTimePanelUI(root);
        if (autoToggle.checked) closePickers(root);
      });
    }

    root.querySelectorAll('[data-settings-action^="pick-"]').forEach(function (btn) {
      if (btn.dataset.pickerBound) return;
      btn.dataset.pickerBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        var action = btn.getAttribute('data-settings-action');
        var id = action.replace('pick-', '');
        if (isSettingsMobile() && MOBILE_SELECT_TITLES[id]) {
          var overlay = getMobileSelectOverlay(root, id);
          if (overlay && overlay.getAttribute('data-active-select') === id && !overlay.hidden) {
            closePickers(root);
            return;
          }
        } else {
          var picker = root.querySelector('[data-settings-picker="' + id + '"]');
          if (picker && !picker.hidden) {
            closePickers(root);
            return;
          }
        }
        openPicker(root, id);
      });
    });

    root.querySelectorAll('[data-settings-picker]').forEach(function (picker) {
      if (picker.dataset.bound) return;
      picker.dataset.bound = '1';
      var id = picker.getAttribute('data-settings-picker');
      var storageKey = PICKER_STORAGE_KEYS[id];

      var search = picker.querySelector('[data-picker-search]');
      if (search) {
        search.addEventListener('input', function () {
          filterPickerList(picker, search.value);
        });
        search.addEventListener('click', function (e) {
          e.stopPropagation();
        });
      }

      picker.addEventListener('click', function (e) {
        e.stopPropagation();
        var option = e.target.closest('[data-picker-option]');
        if (!option) return;
        e.preventDefault();
        var value = option.getAttribute('data-picker-option');
        if (id === 'toast-position' || id === 'toast-duration') {
          applyToastPickerChoice(id, value);
          closePickers(root);
          syncNotificationsPanelUI(root);
          return;
        }
        if (!storageKey) return;
        store.set(storageKey, value);
        closePickers(root);
        if (id === 'slack') syncNotificationsPanelUI(root);
        else if (id === 'history') syncPrivacyPanelUI(root);
        else syncTimePanelUI(root);
      });
    });

    if (!root.dataset.pickerDismissBound) {
      root.dataset.pickerDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!root.classList.contains('is-settings-picker-open')) return;
        if (e.target.closest('[data-settings-picker], [data-settings-cookie-popover], [data-settings-action^="pick-"], [data-settings-action="open-cookies"]')) return;
        closePickers(root);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && root.classList.contains('is-settings-picker-open')) {
          closePickers(root);
        }
        if (e.key === 'Escape' && root.classList.contains('is-settings-mobile-select-open')) {
          closeMobileSelect(root);
        }
      });
    }

    syncTimePanelUI(root);
  }

  var SLACK_STATES = [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ];

  var TOAST_POSITIONS = [
    { id: 'bottom-right', label: 'Bottom Right' },
    { id: 'top-right', label: 'Top Right' },
    { id: 'bottom-left', label: 'Bottom Left' },
  ];

  var TOAST_DURATIONS = [
    { id: '3', label: '3 seconds' },
    { id: '5', label: '5 seconds' },
    { id: '8', label: '8 seconds' },
    { id: '10', label: '10 seconds' },
  ];

  var TOAST_PREF_DEFAULTS = {
    enabled: true,
    position: 'bottom-right',
    durationSec: 10,
    stickyImportant: false,
    sound: false,
    previewText: true,
    groupSimilar: false,
  };

  var NOTIFY_STORAGE_KEYS = {
    'mobile-push': 'tma.notify.mobilePush',
    email: 'tma.notify.email',
    'always-email': 'tma.notify.alwaysEmail',
  };

  var PICKER_STORAGE_KEYS = {
    timezone: 'tma.timezone',
    language: 'tma.language',
    voice: 'tma.voice',
    slack: 'tma.notify.slack',
    history: 'tma.privacy.historyDays',
  };

  function readToastPrefs() {
    var cached = null;
    try {
      cached = JSON.parse(localStorage.getItem('tma.toasts') || 'null');
    } catch (e) { cached = null; }
    var base = Object.assign({}, TOAST_PREF_DEFAULTS, cached && typeof cached === 'object' ? cached : {});
    if (window.TMAToast && window.TMAToast.getToastPrefs) {
      base = Object.assign(base, window.TMAToast.getToastPrefs());
    }
    base.durationSec = parseInt(base.durationSec, 10) || 10;
    return base;
  }

  function writeToastPrefs(partial, opts) {
    opts = opts || {};
    var next = Object.assign({}, readToastPrefs(), partial || {});
    next.durationSec = parseInt(next.durationSec, 10) || 10;
    try { localStorage.setItem('tma.toasts', JSON.stringify(next)); } catch (e) {}
    if (window.TMAToast && window.TMAToast.applyToastPrefs) {
      window.TMAToast.applyToastPrefs(next);
    }
    if (opts.sync !== false) queueToastPrefSync(next);
    if (opts.preview && window.TMAToast && window.TMAToast.previewNotificationToast) {
      window.TMAToast.previewNotificationToast();
    }
    return next;
  }

  var toastPrefTimer = null;
  function queueToastPrefSync(prefs) {
    if (toastPrefTimer) clearTimeout(toastPrefTimer);
    toastPrefTimer = setTimeout(function () {
      toastPrefTimer = null;
      fetch('/me/preferences', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': prefXsrf(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ toasts: prefs }),
      }).catch(function () {});
    }, 350);
  }

  function applyToastPickerChoice(id, value) {
    if (id === 'toast-position') {
      writeToastPrefs({ position: value }, { preview: true });
    } else if (id === 'toast-duration') {
      writeToastPrefs({ durationSec: parseInt(value, 10) || 10 }, { preview: true });
    }
  }

  function readNotificationsPrefs() {
    return {
      mobilePush: store.get('tma.notify.mobilePush', '1') === '1',
      email: store.get('tma.notify.email', '1') === '1',
      alwaysEmail: store.get('tma.notify.alwaysEmail', '1') === '1',
      slack: store.get('tma.notify.slack', 'off'),
    };
  }

  function renderToastSettingsGroup() {
    var prefs = readToastPrefs();
    var position = findOption(TOAST_POSITIONS, prefs.position, 'bottom-right');
    var duration = findOption(TOAST_DURATIONS, String(prefs.durationSec), '10');

    return '<div class="tma-dash__settings-notifications-group">' +
      '<p class="tma-dash__settings-notifications-group-label">Notification toasts</p>' +
      '<p class="tma-dash__settings-notifications-hint">Choose where toast pop-ups appear and how they behave across the portal.</p>' +
      renderRow({
        label: 'Enable toast notifications',
        desc: 'Show pop-up toasts for new messages, email, calendar, files, and other updates.',
        switch: true,
        switchChecked: prefs.enabled,
        switchLabel: 'Enable toast notifications',
        switchAttrs: 'data-settings-toast-pref="enabled"',
        chevron: false,
      }) +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="toast-position">' +
      renderRow({
        label: 'Toast position',
        desc: 'Where notification toasts appear on your screen.',
        action: 'pick-toast-position',
        value: position.label + (position.id === 'bottom-right' ? ' (Default)' : ''),
        valueMuted: true,
      }) +
      renderPicker('toast-position', '30919:278125', TOAST_POSITIONS, prefs.position) +
      '</div>' +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="toast-duration">' +
      renderRow({
        label: 'Display duration',
        desc: 'How long toasts stay visible before dismissing.',
        action: 'pick-toast-duration',
        value: duration.label,
        valueMuted: true,
      }) +
      renderPicker('toast-duration', '30919:278125', TOAST_DURATIONS, String(prefs.durationSec)) +
      '</div>' +
      profileInnerDivider() +
      renderRow({
        label: 'Keep important notifications visible',
        desc: 'Security, approvals, and other important toasts stay until you dismiss them.',
        switch: true,
        switchChecked: prefs.stickyImportant,
        switchLabel: 'Keep important notifications visible',
        switchAttrs: 'data-settings-toast-pref="stickyImportant"',
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Play notification sound',
        desc: 'Play a short sound when a toast appears.',
        switch: true,
        switchChecked: prefs.sound,
        switchLabel: 'Play notification sound',
        switchAttrs: 'data-settings-toast-pref="sound"',
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Show notification preview text',
        desc: 'Include the message preview under the toast title.',
        switch: true,
        switchChecked: prefs.previewText,
        switchLabel: 'Show notification preview text',
        switchAttrs: 'data-settings-toast-pref="previewText"',
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Group similar notifications',
        desc: 'Combine similar toasts that arrive close together into one.',
        switch: true,
        switchChecked: prefs.groupSimilar,
        switchLabel: 'Group similar notifications',
        switchAttrs: 'data-settings-toast-pref="groupSimilar"',
        chevron: false,
      }) +
      '</div>';
  }

  function renderNotificationsPanel() {
    var prefs = readNotificationsPrefs();
    var slack = findOption(SLACK_STATES, prefs.slack, 'off');

    return '<section class="tma-dash__settings-panel tma-dash__settings-panel--notifications" data-settings-panel="notifications" hidden data-node-id="30919:278125" data-node-id-mobile="30919:293271">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-notifications-section-title">Notifications</h2>' +
      '<div class="tma-dash__settings-notifications-stack">' +
      '<div class="tma-dash__settings-notifications-group">' +
      '<p class="tma-dash__settings-notifications-group-label">Notifications</p>' +
      renderRow({
        label: 'Mobile push notifications',
        desc: 'Receive push notifications on your mobile app.',
        switch: true,
        switchChecked: prefs.mobilePush,
        switchLabel: 'Mobile push notifications',
        switchAttrs: 'data-settings-notify="mobile-push"',
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Email notifications',
        desc: 'Receive email updates.',
        switch: true,
        switchChecked: prefs.email,
        switchLabel: 'Email notifications',
        switchAttrs: 'data-settings-notify="email"',
        chevron: false,
      }) +
      profileInnerDivider() +
      renderRow({
        label: 'Always send email notifications',
        desc: 'Receive updates by email, even when you\u2019re active on the app.',
        switch: true,
        switchChecked: prefs.alwaysEmail,
        switchLabel: 'Always send email notifications',
        switchAttrs: 'data-settings-notify="always-email"',
        chevron: false,
      }) +
      profileInnerDivider() +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="slack">' +
      renderRow({
        label: 'Slack notifications',
        desc: 'Receive notifications in your Slack workspace.',
        action: 'pick-slack',
        value: slack.label,
        valueMuted: true,
      }) +
      renderPicker('slack', '30919:278125', SLACK_STATES, prefs.slack) +
      '</div></div>' +
      renderToastSettingsGroup() +
      renderNotificationPrefsGroup() +
      '</div>' +
      renderMobileSelectOverlay('30919:293271') +
      '</section>';
  }

  /* Per-module notification preferences (§21), backed by the server. Portal
     delivery of Security and Approval alerts can't be switched off. */
  var NOTIF_PREF_MODULES = [
    { id: 'email', label: 'Email' },
    { id: 'messages', label: 'Messages' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'files', label: 'Files' },
    { id: 'signatures', label: 'Signatures' },
    { id: 'clients', label: 'Clients' },
    { id: 'groups', label: 'Groups' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'security', label: 'Security' },
    { id: 'system', label: 'System updates' },
  ];
  var NOTIF_PREF_CHANNELS = [
    { id: 'portal', label: 'Portal' },
    { id: 'email', label: 'Email' },
    { id: 'desktop', label: 'Desktop' },
    { id: 'sound', label: 'Sound' },
  ];
  var NOTIF_PREF_LOCKED = ['security', 'approvals'];

  function renderNotificationPrefsGroup() {
    return '<div class="tma-dash__settings-notifications-group">' +
      '<p class="tma-dash__settings-notifications-group-label">Notify me about</p>' +
      '<p class="tma-dash__settings-notifications-hint">Choose how each kind of update reaches you. Security and approval alerts can’t be turned off in the portal.</p>' +
      '<div class="tma-dash__notifprefs" data-notif-prefs>' +
        '<div class="tma-dash__notifprefs-loading">Loading…</div>' +
      '</div>' +
    '</div>';
  }

  function notifPrefsGridHtml(prefs) {
    var head = '<div class="tma-dash__notifprefs-row tma-dash__notifprefs-row--head">' +
      '<span class="tma-dash__notifprefs-module"></span>' +
      NOTIF_PREF_CHANNELS.map(function (c) { return '<span class="tma-dash__notifprefs-col">' + c.label + '</span>'; }).join('') +
    '</div>';
    var rows = NOTIF_PREF_MODULES.map(function (m) {
      var group = prefs[m.id] || {};
      var cells = NOTIF_PREF_CHANNELS.map(function (c) {
        var checked = !!group[c.id];
        var locked = c.id === 'portal' && NOTIF_PREF_LOCKED.indexOf(m.id) !== -1;
        return '<span class="tma-dash__notifprefs-col">' +
          renderSwitch(checked || locked, m.label + ' ' + c.label,
            'data-notif-pref="' + m.id + ':' + c.id + '"' + (locked ? ' disabled' : '')) +
        '</span>';
      }).join('');
      return '<div class="tma-dash__notifprefs-row">' +
        '<span class="tma-dash__notifprefs-module">' + m.label + '</span>' + cells +
      '</div>';
    }).join('');
    return head + rows;
  }

  function loadNotificationPrefs(root) {
    var host = root.querySelector('[data-notif-prefs]');
    if (!host || host.dataset.loaded === '1' || host.dataset.loading === '1') return;
    host.dataset.loading = '1';
    fetch('/portal/notifications/preferences', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        host.dataset.loading = '';
        if (!data || !data.preferences) { host.innerHTML = '<div class="tma-dash__notifprefs-loading">Could not load preferences.</div>'; return; }
        host.dataset.loaded = '1';
        host.innerHTML = notifPrefsGridHtml(data.preferences);
      })
      .catch(function () { host.dataset.loading = ''; if (host) host.innerHTML = '<div class="tma-dash__notifprefs-loading">Could not load preferences.</div>'; });
  }

  function saveNotificationPref(group, channel, on) {
    var body = {}; body[group] = {}; body[group][channel] = on;
    fetch('/portal/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrfToken() },
      credentials: 'same-origin',
      body: JSON.stringify({ preferences: body }),
    }).catch(function () {});
  }

  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function syncNotificationsPanelUI(root) {
    loadNotificationPrefs(root);
    var prefs = readNotificationsPrefs();
    var toastPrefs = readToastPrefs();
    var slack = findOption(SLACK_STATES, prefs.slack, 'off');
    var position = findOption(TOAST_POSITIONS, toastPrefs.position, 'bottom-right');
    var duration = findOption(TOAST_DURATIONS, String(toastPrefs.durationSec), '10');

    root.querySelectorAll('[data-settings-notify]').forEach(function (input) {
      var key = input.getAttribute('data-settings-notify');
      if (key === 'mobile-push') input.checked = prefs.mobilePush;
      else if (key === 'email') input.checked = prefs.email;
      else if (key === 'always-email') input.checked = prefs.alwaysEmail;
    });

    root.querySelectorAll('[data-settings-toast-pref]').forEach(function (input) {
      var key = input.getAttribute('data-settings-toast-pref');
      if (key && Object.prototype.hasOwnProperty.call(toastPrefs, key)) {
        input.checked = !!toastPrefs[key];
      }
    });

    var slackRow = root.querySelector('[data-settings-action="pick-slack"]');
    if (slackRow) {
      var slackValue = slackRow.querySelector('[data-settings-row-value="pick-slack"]');
      if (slackValue) slackValue.textContent = slack.label;
    }

    var positionRow = root.querySelector('[data-settings-action="pick-toast-position"]');
    if (positionRow) {
      var positionValue = positionRow.querySelector('[data-settings-row-value="pick-toast-position"]');
      if (positionValue) {
        positionValue.textContent = position.label + (position.id === 'bottom-right' ? ' (Default)' : '');
      }
    }

    var durationRow = root.querySelector('[data-settings-action="pick-toast-duration"]');
    if (durationRow) {
      var durationValue = durationRow.querySelector('[data-settings-row-value="pick-toast-duration"]');
      if (durationValue) durationValue.textContent = duration.label;
    }

    var slackPicker = root.querySelector('[data-settings-picker="slack"]');
    if (slackPicker) {
      var listEl = slackPicker.querySelector('[data-picker-list]');
      if (listEl) listEl.innerHTML = renderPickerList(SLACK_STATES, prefs.slack);
    }

    var positionPicker = root.querySelector('[data-settings-picker="toast-position"]');
    if (positionPicker) {
      var positionList = positionPicker.querySelector('[data-picker-list]');
      if (positionList) positionList.innerHTML = renderPickerList(TOAST_POSITIONS, toastPrefs.position);
    }

    var durationPicker = root.querySelector('[data-settings-picker="toast-duration"]');
    if (durationPicker) {
      var durationList = durationPicker.querySelector('[data-picker-list]');
      if (durationList) durationList.innerHTML = renderPickerList(TOAST_DURATIONS, String(toastPrefs.durationSec));
    }

    var notifPanel = root.querySelector('[data-settings-panel="notifications"]');
    if (notifPanel && notifPanel.classList.contains('is-mobile-select-open')) {
      var mobileOverlay = notifPanel.querySelector('[data-settings-mobile-select]');
      if (mobileOverlay && mobileOverlay.getAttribute('data-active-select')) {
        syncMobileSelectUI(root, mobileOverlay.getAttribute('data-active-select'));
      }
    }
  }

  function bindNotificationsPanel(root) {
    root.querySelectorAll('[data-settings-notify]').forEach(function (input) {
      if (input.dataset.notifyBound) return;
      input.dataset.notifyBound = '1';
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-settings-notify');
        var storageKey = NOTIFY_STORAGE_KEYS[key];
        if (storageKey) store.set(storageKey, input.checked ? '1' : '0');
        syncNotificationsPanelUI(root);
      });
    });

    root.querySelectorAll('[data-settings-toast-pref]').forEach(function (input) {
      if (input.dataset.toastBound) return;
      input.dataset.toastBound = '1';
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-settings-toast-pref');
        if (!key) return;
        var patch = {};
        patch[key] = !!input.checked;
        writeToastPrefs(patch, {
          preview: (key === 'enabled' && input.checked) || key === 'previewText' || (key === 'sound' && input.checked),
        });
        syncNotificationsPanelUI(root);
      });
    });

    // Per-module preference toggles are added asynchronously, so listen on the
    // panel and save each change through to the server.
    var panel = root.querySelector('[data-settings-panel="notifications"]');
    if (panel && !panel.dataset.notifPrefsBound) {
      panel.dataset.notifPrefsBound = '1';
      panel.addEventListener('change', function (e) {
        var input = e.target.closest('[data-notif-pref]');
        if (!input) return;
        var parts = input.getAttribute('data-notif-pref').split(':');
        saveNotificationPref(parts[0], parts[1], input.checked);
      });
    }

    syncNotificationsPanelUI(root);
  }

  var HISTORY_DAYS = [
    { id: '7', label: '7 days' },
    { id: '14', label: '14 days' },
    { id: '30', label: '30 days' },
    { id: '60', label: '60 days' },
    { id: '90', label: '90 days' },
    { id: '365', label: '1 year' },
  ];

  var COOKIE_STORAGE_KEYS = {
    functional: 'tma.privacy.cookie.functional',
    analytics: 'tma.privacy.cookie.analytics',
    marketing: 'tma.privacy.cookie.marketing',
  };

  function readPrivacyPrefs() {
    return {
      functional: store.get('tma.privacy.cookie.functional', '1') === '1',
      analytics: store.get('tma.privacy.cookie.analytics', '1') === '1',
      marketing: store.get('tma.privacy.cookie.marketing', '1') === '1',
      historyDays: store.get('tma.privacy.historyDays', '30'),
    };
  }

  function renderCookieSwitchRow(opts) {
    return '<div class="tma-dash__settings-cookie-row">' +
      '<div class="tma-dash__settings-cookie-copy">' +
      '<span class="tma-dash__settings-cookie-label">' + esc(opts.label) + '</span>' +
      '<span class="tma-dash__settings-cookie-desc">' + esc(opts.desc) + '</span></div>' +
      renderSwitch(!!opts.checked, opts.switchLabel || opts.label, opts.switchAttrs || '') +
      '</div>';
  }

  function renderCookiePopover(prefs) {
    return '<div class="tma-dash__settings-cookie-popover" data-settings-cookie-popover hidden data-node-id="33303:7651" role="dialog" aria-label="Cookie settings">' +
      renderCookieSwitchRow({
        label: 'Strictly necessary',
        desc: 'Essential for the site to function. Always On.',
        checked: true,
        switchAttrs: 'data-settings-cookie="necessary" disabled checked',
      }) +
      renderCookieSwitchRow({
        label: 'Functional',
        desc: 'Used to remember preference selections and provide enhanced features.',
        checked: prefs.functional,
        switchAttrs: 'data-settings-cookie="functional"',
      }) +
      renderCookieSwitchRow({
        label: 'Analytics',
        desc: 'Used to measure usage and improve your experience.',
        checked: prefs.analytics,
        switchAttrs: 'data-settings-cookie="analytics"',
      }) +
      renderCookieSwitchRow({
        label: 'Marketing',
        desc: 'Used for targeted advertising.',
        checked: prefs.marketing,
        switchAttrs: 'data-settings-cookie="marketing"',
      }) +
      '</div>';
  }

  function renderPrivacyPanel() {
    var prefs = readPrivacyPrefs();
    var history = findOption(HISTORY_DAYS, prefs.historyDays, '30');

    return '<section class="tma-dash__settings-panel" data-settings-panel="privacy" hidden data-node-id="33319:118350">' +
      '<h2 class="tma-dash__settings-section-title">Privacy</h2>' +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="cookies">' +
      renderRow({
        label: 'Cookie settings',
        descHtml: 'Customize cookies. See <a class="tma-dash__settings-row-link" href="#" data-settings-cookie-notice>Cookie Notice</a> for details.',
        action: 'open-cookies',
        value: 'Customize',
        valueMuted: true,
      }) +
      renderCookiePopover(prefs) +
      '</div>' +
      '<div class="tma-dash__settings-picker-anchor" data-picker-anchor="history">' +
      renderRow({
        label: 'History',
        desc: 'Number of days to keep history.',
        action: 'pick-history',
        value: history.label,
        valueMuted: true,
      }) +
      renderPicker('history', '33319:118350', HISTORY_DAYS, prefs.historyDays) +
      '</div></section>';
  }

  function syncPrivacyPanelUI(root) {
    var prefs = readPrivacyPrefs();
    var history = findOption(HISTORY_DAYS, prefs.historyDays, '30');

    root.querySelectorAll('[data-settings-cookie]').forEach(function (input) {
      var key = input.getAttribute('data-settings-cookie');
      if (key === 'necessary') {
        input.checked = true;
        return;
      }
      if (key === 'functional') input.checked = prefs.functional;
      else if (key === 'analytics') input.checked = prefs.analytics;
      else if (key === 'marketing') input.checked = prefs.marketing;
    });

    var historyRow = root.querySelector('[data-settings-action="pick-history"]');
    if (historyRow) {
      var historyValue = historyRow.querySelector('[data-settings-row-value="pick-history"]');
      if (historyValue) historyValue.textContent = history.label;
    }

    var historyPicker = root.querySelector('[data-settings-picker="history"]');
    if (historyPicker) {
      var listEl = historyPicker.querySelector('[data-picker-list]');
      if (listEl) listEl.innerHTML = renderPickerList(HISTORY_DAYS, prefs.historyDays);
    }
  }

  function bindPrivacyPanel(root) {
    var cookieBtn = root.querySelector('[data-settings-action="open-cookies"]');
    if (cookieBtn && !cookieBtn.dataset.privacyBound) {
      cookieBtn.dataset.privacyBound = '1';
      cookieBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var popover = root.querySelector('[data-settings-cookie-popover]');
        if (popover && !popover.hidden) {
          closePickers(root);
          return;
        }
        openCookiePopover(root);
      });
    }

    root.querySelectorAll('[data-settings-cookie-notice]').forEach(function (link) {
      if (link.dataset.noticeBound) return;
      link.dataset.noticeBound = '1';
      link.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    var cookiePopover = root.querySelector('[data-settings-cookie-popover]');
    if (cookiePopover && !cookiePopover.dataset.bound) {
      cookiePopover.dataset.bound = '1';
      cookiePopover.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }

    root.querySelectorAll('[data-settings-cookie]').forEach(function (input) {
      if (input.dataset.cookieBound) return;
      input.dataset.cookieBound = '1';
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-settings-cookie');
        if (key === 'necessary') {
          input.checked = true;
          return;
        }
        var storageKey = COOKIE_STORAGE_KEYS[key];
        if (storageKey) store.set(storageKey, input.checked ? '1' : '0');
        syncPrivacyPanelUI(root);
      });
    });

    syncPrivacyPanelUI(root);
  }

  function renderPaymentCard(opts) {
    if (window.TMACard && typeof window.TMACard.renderCreditCard === 'function') {
      return window.TMACard.renderCreditCard(opts);
    }
    return '';
  }

  function renderPaymentAddButton(label) {
    if (window.TMACard && typeof window.TMACard.renderAddAddressCard === 'function') {
      return window.TMACard.renderAddAddressCard({ label: label || 'Payment method' });
    }
    return '<button type="button" class="tma-dash__settings-payment-add" data-settings-add-payment-method>' +
      '<img src="' + ICON + 'Plus.svg" alt="" width="20" height="20">' +
      esc(label || 'Payment method') + '</button>';
  }

  var DEFAULT_PAYMENT_METHODS = window.TMAPaymentMethods
    ? window.TMAPaymentMethods.DEFAULT_PAYMENT_METHODS
    : [];

  function readPaymentMethods() {
    return window.TMAPaymentMethods
      ? window.TMAPaymentMethods.readPaymentMethods()
      : DEFAULT_PAYMENT_METHODS.slice();
  }

  function writePaymentMethods(methods) {
    if (window.TMAPaymentMethods) {
      window.TMAPaymentMethods.writePaymentMethods(methods);
    }
  }

  function renderPaymentMethodOption(opts) {
    return '<button type="button" class="tma-dash__settings-payment-option" data-payment-method="' + esc(opts.id) + '" data-node-id="' + esc(opts.nodeId || '') + '">' +
      '<img class="tma-dash__settings-payment-option-icon" src="' + esc(opts.icon) + '" alt="" width="32" height="32">' +
      '<span class="tma-dash__settings-payment-option-copy">' +
      '<span class="tma-dash__settings-payment-option-title">' + esc(opts.title) + '</span>' +
      '<span class="tma-dash__settings-payment-option-desc">' + esc(opts.desc) + '</span></span></button>';
  }

  function renderPaymentMethodMobileCard(opts) {
    return '<button type="button" class="tma-dash__settings-payment-mobile-option" data-payment-method="' + esc(opts.id) + '" data-node-id-mobile="30919:293348">' +
      '<span class="tma-dash__settings-payment-mobile-option-inner">' +
      '<span class="tma-dash__settings-payment-mobile-option-icon-wrap" aria-hidden="true">' +
      '<img class="tma-dash__settings-payment-mobile-option-icon" src="' + esc(opts.icon) + '" alt="" width="32" height="32">' +
      '</span>' +
      '<span class="tma-dash__settings-payment-mobile-option-copy">' +
      '<span class="tma-dash__settings-payment-mobile-option-title">' + esc(opts.title) + '</span>' +
      '<span class="tma-dash__settings-payment-mobile-option-desc">' + esc(opts.desc) + '</span></span></span></button>';
  }

  function renderPaymentFieldStep(fieldStep, fieldHtml) {
    var cls = 'tma-dash__settings-payment-field-step';
    if (fieldStep === 1) cls += ' is-active';
    if (fieldStep === 5) cls += ' tma-dash__settings-payment-field-step--save';
    return '<div class="' + cls + '" data-payment-card-field="' + fieldStep + '"' +
      (fieldStep === 5 ? ' hidden' : '') + '>' + fieldHtml + '</div>';
  }

  function renderPaymentFloatingField(opts) {
    var cls = 'tma-dash__settings-payment-input';
    if (opts.modifier) cls += ' tma-dash__settings-payment-input--' + opts.modifier;
    return '<label class="' + cls + '">' +
      '<span class="tma-dash__settings-payment-input-label">' + esc(opts.label) + '</span>' +
      '<span class="tma-dash__settings-payment-input-row">' +
      '<input class="tma-dash__settings-payment-input-control" type="' + (opts.type || 'text') + '" name="' + esc(opts.name) + '"' +
      (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
      (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : '') +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
      (opts.attrs ? ' ' + opts.attrs : '') +
      ' aria-label="' + esc(opts.label) + '">' +
      (opts.brand ? '<img class="tma-dash__settings-payment-input-brand" data-card-brand alt="" width="24" height="24" hidden>' : '') +
      '</span></label>';
  }

  function renderPaymentCardPreview() {
    return '<div class="tma-dash__settings-payment-preview" data-payment-card-preview aria-hidden="true" data-node-id-mobile="30919:293349">' +
      '<div class="tma-dash__settings-payment-preview-bg" aria-hidden="true"></div>' +
      '<div class="tma-dash__settings-payment-preview-face tma-dash__settings-payment-preview-face--front" data-payment-preview-front>' +
      '<img class="tma-dash__settings-payment-preview-chip" src="/images/icons/tma/Chip48.svg" alt="" width="48" height="48">' +
      '<p class="tma-dash__settings-payment-preview-number" data-payment-preview-number>' +
      '<span>0000</span><span>0000</span><span>0000</span><span>0000</span></p>' +
      '<p class="tma-dash__settings-payment-preview-expiry" data-payment-preview-expiry>MM/YY</p>' +
      '<p class="tma-dash__settings-payment-preview-name" data-payment-preview-name>Cardholder Name</p>' +
      '<span class="tma-dash__settings-payment-preview-brand" data-payment-preview-brand aria-hidden="true">' +
      '<img class="tma-dash__settings-payment-preview-brand-img" src="/images/payment/card-brand-mastercard.svg" alt="" width="48" height="29"></span></div>' +
      '<div class="tma-dash__settings-payment-preview-face tma-dash__settings-payment-preview-face--back" data-payment-preview-back hidden>' +
      '<div class="tma-dash__settings-payment-preview-stripe" aria-hidden="true"></div>' +
      '<p class="tma-dash__settings-payment-preview-cvv" data-payment-preview-cvv>•••</p></div></div>';
  }

  function renderPaymentPreviewBrand(cardType) {
    if (window.TMACardIcons && typeof window.TMACardIcons.svg === 'function') {
      if (cardType === 'visa') {
        return window.TMACardIcons.svg('Visa40', 'tma-dash__settings-payment-preview-brand-svg', 48, 17);
      }
      return window.TMACardIcons.svg('Mastercard40', 'tma-dash__settings-payment-preview-brand-svg', 48, 29);
    }
    if (cardType === 'visa') {
      return '<img class="tma-dash__settings-payment-preview-brand-img" src="/images/icons/brands/Visa40.svg" alt="" width="48" height="17">';
    }
    return '<img class="tma-dash__settings-payment-preview-brand-img" src="/images/payment/card-brand-mastercard.svg" alt="" width="48" height="29">';
  }

  function renderAddPaymentMethodPopup() {
    var methodCards = [
      { id: 'stripe', title: 'Stripe', desc: 'Connect your Stripe account.', icon: BRAND + 'Stripe40.svg', nodeId: '33319:144155' },
      { id: 'paypal', title: 'PayPal', desc: 'Connect your PayPal account.', icon: BRAND + 'PayPal40.svg', nodeId: '33319:144156' },
      { id: 'card', title: 'Credit card', desc: 'Add a credit card.', icon: ICON + 'CreditCardDuotone.svg', nodeId: '33319:144157' },
    ];

    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--sheet tma-dash__settings-popup--payment" data-settings-popup="add-payment-method" data-payment-active-step="pick" hidden role="dialog" aria-modal="true" aria-label="Add payment method" data-node-id="30919:278156" data-node-id-mobile="30919:293348">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--payment-flow">' +
      renderPopupClose() +
      renderMobileFlowSheet({
        backDataAttr: 'data-payment-back',
        titleDataAttr: 'data-payment-flow-mobile-title',
        title: 'Add Payment method',
        nextDataAttr: 'data-payment-next',
        saveDataAttr: 'data-payment-save',
        sheetDataAttr: 'data-payment-mobile',
      }) +
      '<button type="button" class="tma-dash__settings-payment-step-back tma-dash__settings-payment-step-back--desktop" data-payment-back-desktop hidden>Back</button>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-title--desktop">' +
      '<h3 class="tma-dash__settings-change-title" data-payment-flow-title>Add Payment method</h3></div>' +
      '<div class="tma-dash__settings-flow-body tma-dash__settings-payment-flow-body">' +
      '<div class="tma-dash__settings-payment-step is-active" data-payment-step="pick" data-node-id="30919:278156" data-node-id-mobile="30919:293348">' +
      '<div class="tma-dash__settings-payment-pick-desktop tma-dash__settings-change-step-desktop-only">' +
      '<div class="tma-dash__settings-change-icon" aria-hidden="true"><img src="' + ICON + 'CardholderDuotone.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-payment-options">' +
      methodCards.map(renderPaymentMethodOption).join('') +
      '</div></div>' +
      '<div class="tma-dash__settings-payment-pick-mobile tma-dash__settings-payment-pick-screen" data-node-id-mobile="30919:293348" hidden>' +
      methodCards.map(renderPaymentMethodMobileCard).join('') +
      '</div></div>' +
      '<div class="tma-dash__settings-payment-step" data-payment-step="card" hidden data-node-id="30919:278157" data-node-id-mobile="30919:293349">' +
      renderPaymentCardPreview() +
      '<form class="tma-dash__settings-payment-form" data-add-payment-form action="#" method="post" novalidate>' +
      '<div class="tma-dash__settings-payment-form-grid">' +
      renderPaymentFieldStep(1, renderPaymentFloatingField({ label: 'Card Number', name: 'cardNumber', inputmode: 'numeric', autocomplete: 'cc-number', placeholder: 'Card Number', brand: true, modifier: 'wide', attrs: 'data-payment-card-number' })) +
      renderPaymentFieldStep(2, renderPaymentFloatingField({ label: 'Cardholder Name', name: 'nameOnCard', autocomplete: 'cc-name', placeholder: 'Name On Card', modifier: 'wide' })) +
      renderPaymentFieldStep(3, renderPaymentFloatingField({ label: 'Expiration Date', name: 'expiry', autocomplete: 'cc-exp', placeholder: 'MM/YY', maxlength: '5', modifier: 'half', attrs: 'data-payment-expiry' })) +
      renderPaymentFieldStep(4, renderPaymentFloatingField({ label: 'CVV', name: 'cvv', inputmode: 'numeric', autocomplete: 'cc-csc', placeholder: '•••', maxlength: '4', modifier: 'half', attrs: 'data-payment-cvv' })) +
      '</div>' +
      renderPaymentFieldStep(5, renderRow({
        label: 'Save Card for further billing?',
        desc: 'If you need more info, please check budget planning.',
        switch: true,
        switchChecked: true,
        switchLabel: 'Save Card',
        switchAttrs: 'data-settings-save-card',
        chevron: false,
        highlight: false,
      })) +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--payment-desktop" data-payment-submit>Next</button></form></div>' +
      '<div class="tma-dash__settings-payment-step" data-payment-step="paypal" hidden>' +
      '<div class="tma-dash__settings-change-icon tma-dash__settings-payment-step-icon--desktop" aria-hidden="true"><img src="' + BRAND + 'PayPal40.svg" alt="" width="80" height="80"></div>' +
      '<form class="tma-dash__settings-payment-form" data-paypal-connect-form action="#" method="post" novalidate>' +
      renderPaymentFloatingField({ label: 'PayPal email', name: 'paypalEmail', type: 'email', autocomplete: 'email', placeholder: 'Email address', modifier: 'wide' }) +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--payment-desktop">Connect</button></form></div>' +
      '<div class="tma-dash__settings-payment-step" data-payment-step="stripe" hidden>' +
      '<div class="tma-dash__settings-change-icon tma-dash__settings-payment-step-icon--desktop" aria-hidden="true"><img src="' + BRAND + 'Stripe40.svg" alt="" width="80" height="80"></div>' +
      '<p class="tma-dash__settings-change-text">You will be redirected to Stripe to connect your account for billing.</p>' +
      '<button type="button" class="tma-dash__settings-submit tma-dash__settings-submit--payment-desktop" data-stripe-connect>Connect Stripe</button></div>' +
      '</div></div></div>';
  }

  function getPaymentCardFieldStep(root) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    return parseInt(popup && popup.dataset.paymentCardField ? popup.dataset.paymentCardField : '1', 10);
  }

  function setPaymentCardFieldStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    if (!popup) return;
    popup.dataset.paymentCardField = String(step);
    popup.querySelectorAll('[data-payment-card-field]').forEach(function (el) {
      var fieldNum = parseInt(el.getAttribute('data-payment-card-field'), 10);
      var on = fieldNum === step;
      el.classList.toggle('is-active', on);
      if (isSettingsMobile()) {
        el.hidden = !on;
      } else {
        el.hidden = false;
      }
    });
    syncPaymentFlowMobileActions(root);
    syncPaymentCardPreview(root);
    if (!isSettingsMobile()) return;
    var active = popup.querySelector('[data-payment-card-field="' + step + '"] input');
    if (active) window.setTimeout(function () { active.focus(); }, 0);
  }

  function syncPaymentFlowMobileActions(root) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    if (!popup) return;
    var step = popup.getAttribute('data-payment-active-step') || 'pick';
    var titleEl = popup.querySelector('[data-payment-flow-mobile-title]');
    var nextBtn = popup.querySelector('[data-payment-next]');
    var saveBtn = popup.querySelector('[data-payment-save]');
    var titles = {
      pick: 'Add Payment method',
      card: 'Add credit card',
      paypal: 'Connect PayPal',
      stripe: 'Connect Stripe',
    };
    if (titleEl) titleEl.textContent = titles[step] || titles.pick;
    if (!isSettingsMobile()) return;
    if (step === 'pick') {
      if (nextBtn) nextBtn.hidden = true;
      if (saveBtn) saveBtn.hidden = true;
      return;
    }
    if (step === 'card') {
      var fieldStep = getPaymentCardFieldStep(root);
      var form = root.querySelector('[data-add-payment-form]');
      if (fieldStep >= 5) {
        if (nextBtn) nextBtn.hidden = true;
        if (saveBtn) saveBtn.hidden = !isCardFormComplete(form);
      } else {
        if (nextBtn) nextBtn.hidden = false;
        if (saveBtn) saveBtn.hidden = true;
      }
      return;
    }
    if (step === 'paypal') {
      if (nextBtn) nextBtn.hidden = false;
      if (saveBtn) saveBtn.hidden = true;
      if (nextBtn) nextBtn.textContent = 'Connect';
      return;
    }
    if (step === 'stripe') {
      if (nextBtn) {
        nextBtn.hidden = true;
        nextBtn.textContent = 'Next';
      }
      if (saveBtn) {
        saveBtn.hidden = false;
        saveBtn.textContent = 'Connect';
      }
      return;
    }
    if (nextBtn) nextBtn.textContent = 'Next';
  }

  function validatePaymentCardFieldStep(root, fieldStep) {
    var form = root.querySelector('[data-add-payment-form]');
    if (!form) return false;
    if (fieldStep === 1) {
      var digits = ((form.querySelector('[name="cardNumber"]') || {}).value || '').replace(/\D/g, '');
      if (digits.length < 12) {
        var numberInput = form.querySelector('[name="cardNumber"]');
        if (numberInput) numberInput.focus();
        return false;
      }
      return true;
    }
    if (fieldStep === 2) {
      var nameInput = form.querySelector('[name="nameOnCard"]');
      if (!nameInput || !nameInput.value.trim()) {
        if (nameInput) nameInput.focus();
        return false;
      }
      return true;
    }
    if (fieldStep === 3) {
      var expiry = parseExpiryValue((form.querySelector('[name="expiry"]') || {}).value);
      var expiryInput = form.querySelector('[name="expiry"]');
      if (expiry.month.length !== 2 || expiry.year.length !== 4) {
        if (expiryInput) expiryInput.focus();
        return false;
      }
      return true;
    }
    if (fieldStep === 4) {
      var cvv = ((form.querySelector('[name="cvv"]') || {}).value || '').replace(/\D/g, '');
      var cvvInput = form.querySelector('[name="cvv"]');
      if (cvv.length < 3) {
        if (cvvInput) cvvInput.focus();
        return false;
      }
      return true;
    }
    return true;
  }

  function advancePaymentCardFieldStep(root) {
    var fieldStep = getPaymentCardFieldStep(root);
    if (!validatePaymentCardFieldStep(root, fieldStep)) return;
    if (fieldStep < 5) setPaymentCardFieldStep(root, fieldStep + 1);
  }

  function syncPaymentPickLayout(root) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    if (!popup) return;
    var desktop = popup.querySelector('.tma-dash__settings-payment-pick-desktop');
    var mobile = popup.querySelector('.tma-dash__settings-payment-pick-mobile');
    var mobileMode = isSettingsMobile();
    if (desktop) desktop.hidden = mobileMode;
    if (mobile) mobile.hidden = !mobileMode;
  }

  function setPaymentStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    if (!popup) return;
    popup.querySelectorAll('[data-payment-step]').forEach(function (panel) {
      var on = panel.getAttribute('data-payment-step') === step;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
      if (on) panel.scrollTop = 0;
    });
    var titleEl = popup.querySelector('[data-payment-flow-title]');
    var backBtn = popup.querySelector('[data-payment-back-desktop]');
    var titles = {
      pick: 'Add Payment method',
      card: 'Add credit card',
      paypal: 'Connect PayPal',
      stripe: 'Connect Stripe',
    };
    if (titleEl) titleEl.textContent = titles[step] || titles.pick;
    if (backBtn) backBtn.hidden = step === 'pick';
    popup.setAttribute('data-payment-active-step', step);
    if (step === 'card') setPaymentCardFieldStep(root, 1);
    else delete popup.dataset.paymentCardField;
    syncPaymentPickLayout(root);
    syncPaymentFlowMobileActions(root);
    var nextBtn = popup.querySelector('[data-payment-next]');
    if (nextBtn && step !== 'paypal') nextBtn.textContent = 'Next';
  }

  function detectCardBrandIcon(digits) {
    if (!digits || digits.length < 1) return '';
    if (digits.charAt(0) === '5') return '/images/icons/brands/Mastercard40.svg';
    if (digits.charAt(0) === '4') return '/images/icons/brands/Visa40.svg';
    return '';
  }

  function formatCardNumberDisplay(digits) {
    var groups = [];
    var i;
    for (i = 0; i < 16; i += 4) {
      var chunk = digits.slice(i, i + 4);
      if (!chunk) groups.push('0000');
      else if (chunk.length < 4) groups.push(chunk + '•'.repeat(4 - chunk.length));
      else groups.push(chunk);
    }
    return groups;
  }

  function syncPaymentCardPreview(root) {
    var form = root.querySelector('[data-add-payment-form]');
    var preview = root.querySelector('[data-payment-card-preview]');
    if (!form || !preview) return;
    var numberInput = form.querySelector('[name="cardNumber"]');
    var nameInput = form.querySelector('[name="nameOnCard"]');
    var expiryInput = form.querySelector('[name="expiry"]');
    var cvvInput = form.querySelector('[name="cvv"]');
    var digits = numberInput ? numberInput.value.replace(/\D/g, '') : '';
    var groups = formatCardNumberDisplay(digits);
    var numberEl = preview.querySelector('[data-payment-preview-number]');
    if (numberEl) {
      numberEl.innerHTML = groups.map(function (g) { return '<span>' + esc(g) + '</span>'; }).join('');
    }
    var nameEl = preview.querySelector('[data-payment-preview-name]');
    if (nameEl) nameEl.textContent = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Cardholder Name';
    var expiryEl = preview.querySelector('[data-payment-preview-expiry]');
    if (expiryEl) expiryEl.textContent = expiryInput && expiryInput.value.trim() ? expiryInput.value.trim() : 'MM/YY';
    var cvvEl = preview.querySelector('[data-payment-preview-cvv]');
    if (cvvEl) {
      var cvv = cvvInput ? cvvInput.value.replace(/\D/g, '') : '';
      cvvEl.textContent = cvv ? cvv.replace(/./g, '•') : '•••';
    }
    var brandImg = form.querySelector('[data-card-brand]');
    var brandSrc = detectCardBrandIcon(digits);
    if (brandImg) {
      if (brandSrc) {
        brandImg.src = brandSrc;
        brandImg.hidden = false;
      } else {
        brandImg.hidden = true;
      }
    }
    var cardType = digits.charAt(0) === '5' ? 'mastercard' : (digits.charAt(0) === '4' ? 'visa' : 'mastercard');
    preview.setAttribute('data-card-type', cardType);
    var brandEl = preview.querySelector('[data-payment-preview-brand]');
    if (brandEl) brandEl.innerHTML = renderPaymentPreviewBrand(cardType);
    var cvvFocused = cvvInput && document.activeElement === cvvInput;
    var cardFieldStep = getPaymentCardFieldStep(root);
    var showCvvBack = cvvFocused || (isSettingsMobile() && cardFieldStep === 4);
    preview.classList.toggle('is-cvv-focus', showCvvBack);
    var front = preview.querySelector('[data-payment-preview-front]');
    var back = preview.querySelector('[data-payment-preview-back]');
    if (front) front.hidden = showCvvBack;
    if (back) back.hidden = !showCvvBack;
  }

  function parseExpiryValue(value) {
    var parts = String(value || '').split('/');
    var month = (parts[0] || '').replace(/\D/g, '').slice(0, 2);
    var year = (parts[1] || '').replace(/\D/g, '');
    if (year.length === 2) year = '20' + year;
    return { month: month, year: year };
  }

  function isCardFormComplete(form) {
    if (!form) return false;
    var nameOnCard = (form.querySelector('[name="nameOnCard"]') || {}).value || '';
    var digits = ((form.querySelector('[name="cardNumber"]') || {}).value || '').replace(/\D/g, '');
    var expiry = parseExpiryValue((form.querySelector('[name="expiry"]') || {}).value);
    var cvv = ((form.querySelector('[name="cvv"]') || {}).value || '').replace(/\D/g, '');
    return nameOnCard.trim().length > 0 && digits.length >= 12 && expiry.month.length === 2 && expiry.year.length === 4 && cvv.length >= 3;
  }

  function focusFirstCardError(form) {
    var nameInput = form.querySelector('[name="nameOnCard"]');
    var numberInput = form.querySelector('[name="cardNumber"]');
    var expiryInput = form.querySelector('[name="expiry"]');
    var cvvInput = form.querySelector('[name="cvv"]');
    var digits = numberInput ? numberInput.value.replace(/\D/g, '') : '';
    var expiry = parseExpiryValue(expiryInput ? expiryInput.value : '');
    var cvv = cvvInput ? cvvInput.value.replace(/\D/g, '') : '';
    if (!numberInput || digits.length < 12) { if (numberInput) numberInput.focus(); return; }
    if (!nameInput || !nameInput.value.trim()) { if (nameInput) nameInput.focus(); return; }
    if (!expiryInput || expiry.month.length !== 2 || expiry.year.length !== 4) { if (expiryInput) expiryInput.focus(); return; }
    if (!cvvInput || cvv.length < 3) { if (cvvInput) cvvInput.focus(); return; }
  }

  function updatePaymentSubmitLabel(root) {
    var form = root.querySelector('[data-add-payment-form]');
    var btn = root.querySelector('[data-payment-submit]');
    if (!form || !btn) return;
    btn.textContent = isCardFormComplete(form) ? 'Save' : 'Next';
  }

  function resetAddPaymentForm(root) {
    var form = root.querySelector('[data-add-payment-form]');
    if (form) form.reset();
    var paypalForm = root.querySelector('[data-paypal-connect-form]');
    if (paypalForm) paypalForm.reset();
    var saveToggle = root.querySelector('[data-settings-save-card]');
    if (saveToggle) saveToggle.checked = true;
    setPaymentStep(root, 'pick');
    syncPaymentCardPreview(root);
    updatePaymentSubmitLabel(root);
  }

  function submitPaymentCard(root, form) {
    if (!isCardFormComplete(form)) {
      if (isSettingsMobile()) {
        var fieldStep = getPaymentCardFieldStep(root);
        if (!validatePaymentCardFieldStep(root, fieldStep)) return;
        advancePaymentCardFieldStep(root);
      } else {
        focusFirstCardError(form);
        updatePaymentSubmitLabel(root);
      }
      return;
    }
    var methods = readPaymentMethods();
    var saveToggle = root.querySelector('[data-settings-save-card]');
    var makeDefault = methods.length === 0 || (saveToggle && saveToggle.checked);
    var nameOnCard = form.querySelector('[name="nameOnCard"]').value.trim();
    var digits = form.querySelector('[name="cardNumber"]').value.replace(/\D/g, '');
    var expiry = parseExpiryValue(form.querySelector('[name="expiry"]').value);
    if (window.TMAPaymentMethods) {
      window.TMAPaymentMethods.addCardMethod({
        nameOnCard: nameOnCard,
        digits: digits,
        expMonth: expiry.month,
        expYear: expiry.year,
        makeDefault: makeDefault,
      });
    } else {
      if (makeDefault) methods.forEach(function (m) { m.isDefault = false; });
      methods.push({
        id: 'pm-' + Date.now(),
        type: digits.charAt(0) === '5' ? 'mastercard' : 'visa',
        name: nameOnCard,
        groups: formatCardNumberDisplay(digits),
        expiry: 'Exp ' + expiry.month + '/' + String(expiry.year).slice(-2),
        isDefault: makeDefault,
      });
      writePaymentMethods(methods);
    }
    closePopups(root);
    resetAddPaymentForm(root);
    syncPaymentPanelUI(root);
    showToast(root, 'Credit card added.');
  }

  function connectPayPal(root, paypalForm) {
    var emailInput = paypalForm.querySelector('[name="paypalEmail"]');
    var email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
      if (emailInput) emailInput.focus();
      return;
    }
    var methods = readPaymentMethods();
    if (window.TMAPaymentMethods) {
      window.TMAPaymentMethods.addPayPalMethod({ email: email, makeDefault: methods.length === 0 });
    } else {
      methods.push({
        id: 'pm-' + Date.now(),
        type: 'paypal',
        name: 'PayPal',
        email: email,
        isDefault: methods.length === 0,
      });
      writePaymentMethods(methods);
    }
    closePopups(root);
    resetAddPaymentForm(root);
    syncPaymentPanelUI(root);
    showToast(root, 'PayPal connected.');
  }

  function handlePaymentFlowBack(root) {
    var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
    if (!popup) return;
    var step = popup.getAttribute('data-payment-active-step') || 'pick';
    if (step === 'pick') {
      closePopups(root);
      return;
    }
    if (step === 'card' && isSettingsMobile()) {
      var fieldStep = getPaymentCardFieldStep(root);
      if (fieldStep > 1) {
        setPaymentCardFieldStep(root, fieldStep - 1);
        return;
      }
    }
    setPaymentStep(root, 'pick');
  }

  function bindAddPaymentMethodPopup(root) {
    root.querySelectorAll('[data-payment-method]').forEach(function (btn) {
      if (btn.dataset.paymentMethodBound) return;
      btn.dataset.paymentMethodBound = '1';
      btn.addEventListener('click', function () {
        var method = btn.getAttribute('data-payment-method');
        if (method === 'card') setPaymentStep(root, 'card');
        else if (method === 'paypal') setPaymentStep(root, 'paypal');
        else if (method === 'stripe') setPaymentStep(root, 'stripe');
      });
    });

    root.querySelectorAll('[data-payment-back], [data-payment-back-desktop]').forEach(function (btn) {
      if (btn.dataset.paymentBackBound) return;
      btn.dataset.paymentBackBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlePaymentFlowBack(root);
      });
    });

    var nextBtn = root.querySelector('[data-payment-next]');
    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = '1';
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
        if (!popup) return;
        var step = popup.getAttribute('data-payment-active-step') || 'pick';
        if (step === 'card') {
          advancePaymentCardFieldStep(root);
          return;
        }
        if (step === 'paypal') {
          var paypalForm = root.querySelector('[data-paypal-connect-form]');
          if (paypalForm) connectPayPal(root, paypalForm);
        }
      });
    }

    var saveBtn = root.querySelector('[data-payment-save]');
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var popup = root.querySelector('[data-settings-popup="add-payment-method"]');
        if (!popup) return;
        var step = popup.getAttribute('data-payment-active-step') || 'pick';
        if (step === 'card') {
          var form = root.querySelector('[data-add-payment-form]');
          if (form) submitPaymentCard(root, form);
          return;
        }
        if (step === 'stripe') {
          closePopups(root);
          resetAddPaymentForm(root);
          showToast(root, 'Stripe connection started.');
        }
      });
    }

    var form = root.querySelector('[data-add-payment-form]');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('input', function (e) {
        var target = e.target;
        if (target && target.name === 'cardNumber') {
          var digits = target.value.replace(/\D/g, '').slice(0, 16);
          target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
        }
        if (target && target.name === 'expiry') {
          var raw = target.value.replace(/[^\d/]/g, '');
          if (raw.length === 2 && !raw.includes('/') && target.value.length > 2) {
            raw = raw.slice(0, 2) + '/' + raw.slice(2);
          } else if (raw.length >= 2 && raw.indexOf('/') === -1) {
            raw = raw.slice(0, 2) + '/' + raw.slice(2, 4);
          }
          target.value = raw.slice(0, 5);
        }
        if (target && target.name === 'cvv') {
          target.value = target.value.replace(/\D/g, '').slice(0, 4);
        }
        syncPaymentCardPreview(root);
        updatePaymentSubmitLabel(root);
        syncPaymentFlowMobileActions(root);
      });
      form.addEventListener('focusin', function () {
        syncPaymentCardPreview(root);
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitPaymentCard(root, form);
      });
    }

    var paypalForm = root.querySelector('[data-paypal-connect-form]');
    if (paypalForm && !paypalForm.dataset.bound) {
      paypalForm.dataset.bound = '1';
      paypalForm.addEventListener('submit', function (e) {
        e.preventDefault();
        connectPayPal(root, paypalForm);
      });
    }

    root.querySelectorAll('[data-stripe-connect]').forEach(function (btn) {
      if (btn.dataset.stripeBound) return;
      btn.dataset.stripeBound = '1';
      btn.addEventListener('click', function () {
        closePopups(root);
        resetAddPaymentForm(root);
        showToast(root, 'Stripe connection started.');
      });
    });

    var paymentPopup = root.querySelector('[data-settings-popup="add-payment-method"]');
    var paymentBackdrop = paymentPopup && paymentPopup.querySelector('.tma-dash__settings-popup-backdrop');
    if (paymentBackdrop && !paymentBackdrop.dataset.bound) {
      paymentBackdrop.dataset.bound = '1';
      paymentBackdrop.addEventListener('click', function () {
        if (!isSettingsMobile()) return;
        closePopups(root);
        resetAddPaymentForm(root);
      });
    }
  }

  function renderStoredPaymentCard(method) {
    if (method.type === 'paypal') {
      return renderPaymentCard({
        cardType: 'paypal',
        name: method.name || 'PayPal',
        email: method.email || '',
        nodeId: '30919:278127',
      });
    }
    return renderPaymentCard({
      cardType: method.type || 'visa',
      name: method.name || 'ByeWind',
      groups: method.groups || ['0000', '0000', '0000', '0000'],
      expiry: method.expiry || 'Exp 06/25',
      status: method.isDefault ? 'Default' : 'Active',
      showStatus: !!method.isDefault,
      edit: false,
      nodeId: method.type === 'mastercard' ? '30919:278126' : '30919:278125',
    });
  }

  function renderPaymentSwipeRow(method, cardHtml) {
    return '<div class="tma-dash__settings-payment-swipe" data-payment-swipe="' + esc(method.id) + '" data-node-id-mobile="30919:293269">' +
      '<div class="tma-dash__settings-payment-swipe-actions" aria-hidden="true">' +
      '<button type="button" class="tma-dash__settings-payment-swipe-action tma-dash__settings-payment-swipe-action--default" data-payment-set-default="' + esc(method.id) + '">Set to default</button>' +
      '<button type="button" class="tma-dash__settings-payment-swipe-action tma-dash__settings-payment-swipe-action--delete" data-payment-delete="' + esc(method.id) + '" aria-label="Delete payment method">' +
      '<img class="tma-dash__settings-payment-swipe-delete-icon" src="' + ICON + 'Trash.svg" alt="" width="24" height="24">' +
      '<span class="tma-dash__settings-payment-swipe-delete-label">Confirm delete?</span></button></div>' +
      '<div class="tma-dash__settings-payment-swipe-track" data-payment-swipe-track tabindex="0" role="group" aria-label="Payment method">' +
      cardHtml + '</div></div>';
  }

  function renderPaymentMethodItem(method) {
    var cardHtml = renderStoredPaymentCard(method);
    if (method.isDefault) {
      return '<div class="tma-dash__settings-payment-card-slot" data-payment-method-id="' + esc(method.id) + '">' + cardHtml + '</div>';
    }
    return renderPaymentSwipeRow(method, cardHtml);
  }

  function renderPaymentMethodsList() {
    return readPaymentMethods().map(renderPaymentMethodItem).join('');
  }

  function renderPaymentAddRow() {
    return '<button type="button" class="tma-dash__settings-payment-add-row" data-settings-add-payment-method data-node-id-mobile="30919:293269">' +
      '<img src="' + ICON + 'Plus.svg" alt="" width="24" height="24">' +
      '<span>Payment method</span></button>';
  }

  function renderPaymentPayoutRow() {
    return '<button type="button" class="tma-dash__settings-payment-payout-row" data-settings-open-payout data-node-id-mobile="30919:293269">' +
      '<span class="tma-dash__settings-payment-payout-row-copy">' +
      '<span class="tma-dash__settings-payment-payout-row-title">Payout invoice info</span>' +
      '<span class="tma-dash__settings-payment-payout-row-desc">Optional. Information added here, such as your business name address, VAT number, etc. will be included when generating a payout invoice.</span>' +
      '</span>' + chevronSvg('tma-dash__settings-chevron') + '</button>';
  }

  function renderPaymentPayoutDetail(prefs) {
    return '<div class="tma-dash__settings-payment-payout-detail" data-settings-payment-payout hidden data-node-id-mobile="30919:293269">' +
      '<p class="tma-dash__settings-payment-payout-detail-desc">Optional. Information added here, such as your business name address, VAT number, etc. will be included when generating a payout invoice.</p>' +
      '<label class="tma-dash__settings-payment-invoice-wrap">' +
      '<textarea class="tma-dash__settings-payment-invoice" data-settings-payout-invoice rows="6" placeholder="Enter your business name, address,VAT number, etc." aria-label="Payout invoice info">' + esc(prefs.payoutInvoice) + '</textarea>' +
      '</label></div>';
  }

  function readPaymentPrefs() {
    return {
      payoutInvoice: store.get('tma.payment.payoutInvoice', ''),
    };
  }

  function renderPaymentCardsGridHtml() {
    var addWrap = isSettingsMobile()
      ? ''
      : '<div class="tma-dash__settings-payment-add-wrap">' + renderPaymentAddButton('Payment method') + '</div>';
    return addWrap + renderPaymentMethodsList();
  }

  function bindPaymentAddButtons(root) {
    root.querySelectorAll('[data-settings-add-payment-method], .tma-dash__settings-payment-add-wrap .tma-card--add-address').forEach(function (btn) {
      if (btn.dataset.paymentAddBound) return;
      btn.dataset.paymentAddBound = '1';
      btn.addEventListener('click', function () {
        resetAddPaymentForm(root);
        openPopup(root, 'add-payment-method');
      });
    });
  }

  function renderPaymentPanel() {
    var prefs = readPaymentPrefs();

    return '<section class="tma-dash__settings-panel tma-dash__settings-panel--payment" data-settings-panel="payment" hidden data-node-id="30919:278127" data-node-id-mobile="30919:293269">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-payment-section-title">Payment</h2>' +
      '<div class="tma-dash__settings-payment-stack">' +
      renderPaymentAddRow() +
      '<div class="tma-dash__settings-payment-cards" data-settings-payment-cards>' + renderPaymentCardsGridHtml() + '</div>' +
      '<div class="tma-dash__settings-payment-payout-desktop">' +
      '<hr class="tma-dash__settings-divider">' +
      '<h2 class="tma-dash__settings-section-title">Payout invoice info</h2>' +
      '<p class="tma-dash__settings-payment-desc">Optional. Information added here, such as your business name address, VAT number, etc. will be included when generating a payout invoice.</p>' +
      '<label class="tma-dash__settings-payment-invoice-wrap">' +
      '<textarea class="tma-dash__settings-payment-invoice" data-settings-payout-invoice rows="3" placeholder="Enter your business name, address,VAT number, etc." aria-label="Payout invoice info">' + esc(prefs.payoutInvoice) + '</textarea>' +
      '</label></div>' +
      renderPaymentPayoutRow() +
      '</div>' +
      renderPaymentPayoutDetail(prefs) +
      '</section>';
  }

  function closePaymentSwipes(root, except) {
    root.querySelectorAll('[data-payment-swipe].is-open').forEach(function (row) {
      if (except && row === except) return;
      row.classList.remove('is-open', 'is-delete-pending');
      var track = row.querySelector('[data-payment-swipe-track]');
      if (track) track.style.transform = '';
    });
  }

  function syncPaymentSwipeOffset(row) {
    var actions = row.querySelector('.tma-dash__settings-payment-swipe-actions');
    if (!actions) return;
    row.style.setProperty('--payment-swipe-offset', actions.offsetWidth + 'px');
  }

  function openPaymentPayout(root) {
    var panel = root.querySelector('[data-settings-panel="payment"]');
    var detail = panel && panel.querySelector('[data-settings-payment-payout]');
    if (!panel || !detail) return;
    closePaymentSwipes(root);
    var mobileTitle = root.querySelector('[data-settings-mobile-title]');
    if (mobileTitle) {
      panel.dataset.previousPayoutTitle = mobileTitle.textContent;
      mobileTitle.textContent = 'Payout invoice info';
    }
    detail.hidden = false;
    panel.classList.add('is-payment-payout-open');
    root.classList.add('is-settings-payment-payout-open');
    var field = detail.querySelector('[data-settings-payout-invoice]');
    if (field) window.setTimeout(function () { field.focus(); }, 0);
  }

  function closePaymentPayout(root) {
    var panel = root.querySelector('[data-settings-panel="payment"]');
    var detail = panel && panel.querySelector('[data-settings-payment-payout]');
    if (!panel || !detail) return;
    detail.hidden = true;
    panel.classList.remove('is-payment-payout-open');
    root.classList.remove('is-settings-payment-payout-open');
    var mobileTitle = root.querySelector('[data-settings-mobile-title]');
    if (mobileTitle && panel.dataset.previousPayoutTitle) {
      mobileTitle.textContent = panel.dataset.previousPayoutTitle;
      delete panel.dataset.previousPayoutTitle;
    }
  }

  function syncPaymentPanelUI(root) {
    var prefs = readPaymentPrefs();
    root.querySelectorAll('[data-settings-payout-invoice]').forEach(function (field) {
      if (document.activeElement !== field && field.value !== prefs.payoutInvoice) {
        field.value = prefs.payoutInvoice;
      }
    });
    var cardsEl = root.querySelector('[data-settings-payment-cards]');
    if (cardsEl) {
      closePaymentSwipes(root);
      cardsEl.innerHTML = renderPaymentCardsGridHtml();
      bindPaymentAddButtons(root);
      bindPaymentSwipeRows(root);
    }
  }

  function bindPaymentSwipeRows(root) {
    function openPaymentSwipe(row) {
      closePaymentSwipes(root, row);
      syncPaymentSwipeOffset(row);
      var track = row.querySelector('[data-payment-swipe-track]');
      var limit = row.querySelector('.tma-dash__settings-payment-swipe-actions');
      var width = limit ? limit.offsetWidth : 176;
      if (track) track.style.transform = 'translateX(-' + width + 'px)';
      row.classList.add('is-open');
    }

    root.querySelectorAll('[data-payment-swipe]').forEach(function (row) {
      if (row.dataset.swipeBound) return;
      row.dataset.swipeBound = '1';
      syncPaymentSwipeOffset(row);

      var track = row.querySelector('[data-payment-swipe-track]');
      var startX = 0;
      var startOffset = 0;
      var dragging = false;

      function setOffset(px) {
        var max = row.querySelector('.tma-dash__settings-payment-swipe-actions');
        var limit = max ? max.offsetWidth : 0;
        var clamped = Math.max(-limit, Math.min(0, px));
        track.style.transform = clamped ? 'translateX(' + clamped + 'px)' : '';
        row.classList.toggle('is-open', clamped < -8);
      }

      function openSwipe() {
        closePaymentSwipes(root, row);
        syncPaymentSwipeOffset(row);
        var limit = row.querySelector('.tma-dash__settings-payment-swipe-actions');
        setOffset(limit ? -limit.offsetWidth : -176);
      }

      function closeSwipe() {
        row.classList.remove('is-open', 'is-delete-pending');
        track.style.transform = '';
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        startOffset = match ? parseFloat(match[1]) : 0;
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        setOffset(startOffset + (e.clientX - startX));
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        var current = match ? parseFloat(match[1]) : 0;
        var limit = row.querySelector('.tma-dash__settings-payment-swipe-actions');
        var width = limit ? limit.offsetWidth : 176;
        if (current < -(width * 0.35)) openSwipe();
        else closeSwipe();
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);
    });

    root.querySelectorAll('[data-payment-set-default]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-payment-set-default');
        if (window.TMAPaymentMethods) window.TMAPaymentMethods.setDefaultPaymentMethod(id);
        syncPaymentPanelUI(root);
        showToast(root, 'Default payment method updated.');
      });
    });

    root.querySelectorAll('[data-payment-delete]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var row = btn.closest('[data-payment-swipe]');
        var id = btn.getAttribute('data-payment-delete');
        if (!row) return;
        if (!row.classList.contains('is-delete-pending')) {
          row.classList.add('is-delete-pending');
          syncPaymentSwipeOffset(row);
          openPaymentSwipe(row);
          return;
        }
        if (window.TMAPaymentMethods) window.TMAPaymentMethods.removePaymentMethod(id);
        syncPaymentPanelUI(root);
        showToast(root, 'Payment method removed.');
      });
    });

    if (!root.dataset.paymentSwipeDismissBound) {
      root.dataset.paymentSwipeDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-payment-swipe]')) closePaymentSwipes(root);
      });
    }
  }

  function bindPaymentPanel(root) {
    root.querySelectorAll('[data-settings-payout-invoice]').forEach(function (payoutField) {
      if (payoutField.dataset.bound) return;
      payoutField.dataset.bound = '1';
      payoutField.addEventListener('input', function () {
        store.set('tma.payment.payoutInvoice', payoutField.value);
      });
    });

    root.querySelectorAll('[data-settings-open-payout]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (isSettingsMobile()) openPaymentPayout(root);
      });
    });

    bindPaymentAddButtons(root);

    bindPaymentSwipeRows(root);
    syncPaymentPanelUI(root);
  }

  var DEFAULT_PLUGINS = [
    {
      id: 'figma',
      name: 'Figma',
      desc: 'the collaborative interface design tool.',
      icon: '/images/icons/brands/Figma40.svg',
      enabled: false,
      nodeId: '33319:134731',
    },
    {
      id: 'twitter',
      name: 'Twitter',
      desc: 'From breaking news and entertainment to sports and politics, get the full story with all the live commentary.',
      icon: '/images/icons/tma/TwitterSocial.svg',
      enabled: false,
      nodeId: '33319:134732',
    },
    {
      id: 'instagram',
      name: 'Instagram',
      desc: 'A simple, fun & creative way to capture, edit & share photos, videos & messages with friends & family.',
      icon: '/images/icons/tma/InstagramSocial.svg',
      enabled: false,
      nodeId: '33319:134733',
    },
    {
      id: 'slack',
      name: 'Slack',
      desc: 'Slack is a new way to communicate with your team. It\u2019s faster, better organized, and more secure than email.',
      icon: '/images/icons/brands/Slack40.svg',
      enabled: false,
      nodeId: '33319:134734',
    },
  ];

  function readPlugins() {
    try {
      var raw = store.get('tma.plugins.list', '');
      if (!raw) return DEFAULT_PLUGINS.map(function (p) { return Object.assign({}, p); });
      var saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return DEFAULT_PLUGINS.map(function (p) { return Object.assign({}, p); });
      return DEFAULT_PLUGINS.map(function (plugin) {
        var match = saved.find(function (item) { return item.id === plugin.id; });
        return Object.assign({}, plugin, match ? { enabled: !!match.enabled } : {});
      });
    } catch (e) {
      return DEFAULT_PLUGINS.map(function (p) { return Object.assign({}, p); });
    }
  }

  function writePlugins(plugins) {
    store.set('tma.plugins.list', JSON.stringify(plugins.map(function (p) {
      return { id: p.id, enabled: !!p.enabled };
    })));
  }

  function renderPluginRow(plugin) {
    return '<div class="tma-dash__settings-plugin" data-settings-plugin="' + esc(plugin.id) + '" data-node-id="' + esc(plugin.nodeId) + '">' +
      '<img class="tma-dash__settings-plugin-icon" src="' + esc(plugin.icon) + '" alt="" width="32" height="32">' +
      '<div class="tma-dash__settings-plugin-copy">' +
      '<span class="tma-dash__settings-plugin-name">' + esc(plugin.name) + '</span>' +
      '<span class="tma-dash__settings-plugin-desc">' + esc(plugin.desc) + '</span></div>' +
      '<div class="tma-dash__settings-plugin-actions">' +
      '<div class="tma-dash__settings-plugin-menu-wrap">' +
      '<button type="button" class="tma-dash__settings-plugin-menu" data-settings-plugin-menu="' + esc(plugin.id) + '" aria-label="More options for ' + esc(plugin.name) + '" aria-haspopup="menu" aria-expanded="false">' +
      '<img src="' + ICON + 'DotsThree.svg" alt="" width="16" height="16"></button>' +
      '<div class="tma-dash__settings-plugin-dropdown" data-settings-plugin-dropdown="' + esc(plugin.id) + '" role="menu" hidden>' +
      '<button type="button" class="tma-dash__settings-plugin-dropdown-item" role="menuitem" data-settings-plugin-action="configure">Configure plugin</button>' +
      '<button type="button" class="tma-dash__settings-plugin-dropdown-item" role="menuitem" data-settings-plugin-action="remove">Remove plugin</button>' +
      '</div></div>' +
      renderSwitch(!!plugin.enabled, plugin.name, 'data-settings-plugin-toggle="' + esc(plugin.id) + '"') +
      '</div></div>';
  }

  function renderPluginsPanel() {
    var plugins = readPlugins();
    return '<section class="tma-dash__settings-panel tma-dash__settings-panel--plugins" data-settings-panel="plugins" hidden data-node-id="30919:278129" data-node-id-mobile="30919:293275">' +
      '<h2 class="tma-dash__settings-section-title tma-dash__settings-section-title--count tma-dash__settings-plugins-section-title">' +
      'Plugins <span class="tma-dash__settings-section-count" data-settings-plugin-count>' + plugins.length + '</span></h2>' +
      '<div class="tma-dash__settings-plugins-stack">' +
      '<div class="tma-dash__settings-plugins-group">' +
      '<p class="tma-dash__settings-plugins-group-label">Plugins <span data-settings-plugin-count-inline>' + plugins.length + '</span></p>' +
      '<div class="tma-dash__settings-plugins" data-settings-plugins>' +
      plugins.map(renderPluginRow).join('') +
      '</div></div></div></section>';
  }

  function closePluginMenus(root) {
    root.querySelectorAll('[data-settings-plugin-dropdown]').forEach(function (menu) {
      menu.hidden = true;
    });
    root.querySelectorAll('[data-settings-plugin-menu]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function syncPluginsPanelUI(root) {
    var plugins = readPlugins();
    var count = String(plugins.length);
    var countEl = root.querySelector('[data-settings-plugin-count]');
    if (countEl) countEl.textContent = count;
    var countInlineEl = root.querySelector('[data-settings-plugin-count-inline]');
    if (countInlineEl) countInlineEl.textContent = count;
    var listEl = root.querySelector('[data-settings-plugins]');
    if (listEl) listEl.innerHTML = plugins.map(renderPluginRow).join('');
    bindPluginsPanel(root);
  }

  function syncPluginsMobileChrome(root, activeId) {
    var moreBtn = root.querySelector('[data-settings-mobile-more]');
    if (!moreBtn) return;
    var show = isSettingsMobile() && activeId === 'plugins';
    moreBtn.hidden = !show;
  }

  function bindPluginsPanel(root) {
    root.querySelectorAll('[data-settings-plugin-toggle]').forEach(function (input) {
      if (input.dataset.pluginToggleBound) return;
      input.dataset.pluginToggleBound = '1';
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-settings-plugin-toggle');
        var plugins = readPlugins();
        var plugin = plugins.find(function (p) { return p.id === id; });
        if (!plugin) return;
        plugin.enabled = input.checked;
        writePlugins(plugins);
        showToast(root, plugin.name + (plugin.enabled ? ' enabled' : ' disabled'));
      });
    });

    root.querySelectorAll('[data-settings-plugin-menu]').forEach(function (btn) {
      if (btn.dataset.pluginMenuBound) return;
      btn.dataset.pluginMenuBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-settings-plugin-menu');
        var menu = root.querySelector('[data-settings-plugin-dropdown="' + id + '"]');
        if (!menu) return;
        var open = menu.hidden;
        closePluginMenus(root);
        if (open) {
          menu.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    root.querySelectorAll('[data-settings-plugin-dropdown-item]').forEach(function (item) {
      if (item.dataset.pluginActionBound) return;
      item.dataset.pluginActionBound = '1';
      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var row = item.closest('[data-settings-plugin]');
        var id = row ? row.getAttribute('data-settings-plugin') : '';
        var plugins = readPlugins();
        var plugin = plugins.find(function (p) { return p.id === id; });
        var action = item.getAttribute('data-settings-plugin-action');
        closePluginMenus(root);
        if (action === 'remove' && plugin) {
          var next = plugins.filter(function (p) { return p.id !== id; });
          writePlugins(next);
          syncPluginsPanelUI(root);
          showToast(root, plugin.name + ' removed');
          return;
        }
        if (plugin) showToast(root, 'Configure ' + plugin.name);
      });
    });

    if (!root.dataset.pluginMenuDismissBound) {
      root.dataset.pluginMenuDismissBound = '1';
      root.addEventListener('click', function (e) {
        if (e.target.closest('[data-settings-plugin-menu], [data-settings-plugin-dropdown]')) return;
        closePluginMenus(root);
      });
    }
  }

  var CURRENT_EMAIL = 'byewind@twitter.com';
  var TWO_STEP_AUTH_KEY = 'ABCD EFGH IJKL MNOP';
  var TWO_STEP_BACKUP_CODES = ['12345678', '23456789', '34567890', '45678901', '56789012', '67890123', '78901234', '89012345'];
  var TWO_STEP_PINNED_COUNTRY_CODE = '+1-758';
  var TWO_STEP_COUNTRIES = window.TMA_TWO_STEP_COUNTRIES || [
    { flag: '🇱🇨', name: 'Saint Lucia', code: '+1-758' },
    { flag: '🇺🇸', name: 'United States', code: '+1' },
    { flag: '🇬🇧', name: 'United Kingdom', code: '+44' },
  ];

  function renderPopupClose(className) {
    return '<button type="button" class="' + (className || 'tma-dash__settings-change-close') + ' tma-dash__settings-change-close--desktop" data-settings-popup-close aria-label="Close">' +
      '<img src="' + ICON + 'X.svg" alt="" width="16" height="16"></button>';
  }

  function renderPopupBackdrop() {
    return '<div class="tma-dash__settings-popup-backdrop" aria-hidden="true"></div>';
  }

  function renderMobileFlowSheet(opts) {
    var trailing = opts.trailingHtml;
    if (!trailing) {
      trailing = '<button type="button" class="tma-dash__settings-flow-mobile-action" ' + opts.nextDataAttr + '>Next</button>';
      if (opts.saveDataAttr) {
        trailing += '<button type="submit" class="tma-dash__settings-flow-mobile-action tma-dash__settings-flow-mobile-action--save" ' +
          opts.saveDataAttr + ' hidden>Save</button>';
      }
    }
    return '<div class="tma-dash__settings-flow-mobile-sheet"' + (opts.sheetDataAttr ? ' ' + opts.sheetDataAttr : '') + '>' +
      '<div class="tma-dash__settings-flow-mobile-chrome" data-settings-flow-drag>' +
      (opts.hideHandle ? '' : '<div class="tma-dash__settings-flow-mobile-handle" aria-hidden="true"></div>') +
      '<div class="tma-dash__settings-flow-mobile-head">' +
      '<button type="button" class="tma-dash__settings-flow-mobile-back" ' + opts.backDataAttr + ' aria-label="Back">' +
      '<img src="' + ICON + 'CaretLeft.svg" alt="" width="24" height="24"></button>' +
      '<h3 class="tma-dash__settings-flow-mobile-title" ' + opts.titleDataAttr + '>' + esc(opts.title) + '</h3>' +
      '<div class="tma-dash__settings-flow-mobile-actions">' + trailing + '</div></div></div></div>';
  }

  function renderFlowPasswordField(opts) {
    return '<label class="tma-dash__settings-flow-field tma-dash__settings-flow-field--password">' +
      '<input class="tma-dash__settings-flow-input" type="password" name="' + esc(opts.name) + '" placeholder="' + esc(opts.placeholder) + '"' +
      (opts.autocomplete ? ' autocomplete="' + esc(opts.autocomplete) + '"' : '') +
      ' aria-label="' + esc(opts.placeholder) + '">' +
      '<button type="button" class="tma-dash__settings-flow-field-toggle" data-password-toggle aria-label="Show password">' +
      '<img src="' + ICON + 'EyeSlash.svg" alt="" width="20" height="20"></button></label>';
  }

  function renderChangeEmailPopup() {
    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--email" data-settings-popup="change-email" hidden role="dialog" aria-modal="true" aria-label="Change email" data-node-id="30919:278149">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--email">' +
      renderPopupClose() +
      renderMobileFlowSheet({
        backDataAttr: 'data-change-email-back',
        titleDataAttr: 'data-change-email-mobile-title',
        title: 'Change email',
        nextDataAttr: 'data-change-email-next',
        sheetDataAttr: 'data-change-email-mobile',
      }) +
      '<div class="tma-dash__settings-flow-body">' +
      '<div class="tma-dash__settings-change-step is-active" data-change-email-step="1" data-node-id="30919:293311">' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-copy--email-intro">' +
      '<p class="tma-dash__settings-change-text">Your current email is</p>' +
      '<p class="tma-dash__settings-change-email tma-dash__settings-change-email--lg" data-change-email-current>' + esc(CURRENT_EMAIL) + '</p></div>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--step" data-change-email-form-step="1" action="#" method="post" novalidate>' +
      renderFlowPasswordField({ name: 'password', placeholder: 'Password', autocomplete: 'current-password' }) +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Next</button></form></div>' +
      '<div class="tma-dash__settings-change-step" data-change-email-step="2" hidden data-node-id="30919:293315">' +
      '<p class="tma-dash__settings-change-text tma-dash__settings-change-text--center">Please enter a new email and we will send you a verification code.</p>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--step" data-change-email-form-step="2" action="#" method="post" novalidate>' +
      '<input class="tma-dash__settings-flow-input" type="email" name="newEmail" placeholder="Enter new email" autocomplete="email" aria-label="Enter new email">' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Send</button></form></div>' +
      '<div class="tma-dash__settings-change-step" data-change-email-step="3" hidden data-node-id="30919:293318">' +
      '<div class="tma-dash__settings-change-icon tma-dash__settings-change-step-desktop-only" aria-hidden="true"><img src="' + ICON + 'EnvelopeSimple.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-step-desktop-only">' +
      '<h3 class="tma-dash__settings-change-title">Check your inbox</h3>' +
      '<p class="tma-dash__settings-change-text">Please open the link in the email to continue or Enter the verification code we sent to</p></div>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-copy--email-verify-mobile">' +
      '<p class="tma-dash__settings-change-text">Enter the verification code we sent to</p>' +
      '<p class="tma-dash__settings-change-email" data-change-email-target>' + esc(CURRENT_EMAIL) + '</p></div>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--step" data-change-email-form-step="3" action="#" method="post" novalidate>' +
      renderOtpGroup(4, '4 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Submit</button></form>' +
      '<div class="tma-dash__settings-change-footer">' +
      '<p class="tma-dash__settings-resend" data-resend>Resend (60s)</p>' +
      '<p class="tma-dash__settings-help"><a href="#">Need help?</a></p></div></div>' +
      '</div></div></div>';
  }

  function renderPasswordField(opts) {
    return '<label class="tma-dash__settings-field tma-dash__settings-field--password">' +
      '<input class="tma-dash__settings-field-input" type="password" name="' + esc(opts.name) + '" placeholder="' + esc(opts.placeholder) + '"' +
      (opts.autocomplete ? ' autocomplete="' + esc(opts.autocomplete) + '"' : '') +
      ' aria-label="' + esc(opts.placeholder) + '">' +
      '<button type="button" class="tma-dash__settings-field-toggle" data-password-toggle aria-label="Show password">' +
      '<img src="' + ICON + 'EyeSlash.svg" alt="" width="20" height="20"></button></label>';
  }

  function renderPasswordStrengthGroup() {
    return '<div class="tma-dash__settings-password-group">' +
      '<div class="tma-dash__settings-strength" data-password-strength aria-hidden="true">' +
      '<span class="tma-dash__settings-strength-seg"></span>' +
      '<span class="tma-dash__settings-strength-seg"></span>' +
      '<span class="tma-dash__settings-strength-seg"></span>' +
      '<span class="tma-dash__settings-strength-seg"></span></div>' +
      '<p class="tma-dash__settings-password-hint">Use 8 or more characters with a mix of letters, numbers &amp; symbols.</p></div>';
  }

  function renderChangePasswordPopup() {
    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--password" data-settings-popup="change-password" hidden role="dialog" aria-modal="true" aria-label="Change password" data-node-id="30919:278181">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--password">' +
      renderPopupClose() +
      '<h3 class="tma-dash__settings-change-title tma-dash__settings-change-title--desktop">Change password</h3>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--password" data-change-password-form action="#" method="post" novalidate>' +
      renderMobileFlowSheet({
        backDataAttr: 'data-change-password-back',
        titleDataAttr: 'data-change-password-mobile-title',
        title: 'Change password',
        nextDataAttr: 'data-change-password-next',
        saveDataAttr: 'data-change-password-save',
        sheetDataAttr: 'data-change-password-mobile',
      }) +
      '<div class="tma-dash__settings-flow-body">' +
      '<div class="tma-dash__settings-change-step is-active" data-change-password-step="1" data-node-id="30919:293308">' +
      renderFlowPasswordField({ name: 'currentPassword', placeholder: 'Current password', autocomplete: 'current-password' }) +
      '</div>' +
      '<hr class="tma-dash__settings-change-divider tma-dash__settings-change-divider--password-step">' +
      '<div class="tma-dash__settings-change-step" data-change-password-step="2" hidden data-node-id="30919:293310">' +
      renderFlowPasswordField({ name: 'newPassword', placeholder: 'New password', autocomplete: 'new-password' }) +
      renderPasswordStrengthGroup() +
      '</div>' +
      '<div class="tma-dash__settings-change-step" data-change-password-step="3" hidden data-node-id="30919:293309">' +
      renderFlowPasswordField({ name: 'repeatPassword', placeholder: 'Repeat Password', autocomplete: 'new-password' }) +
      '</div></div>' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--password-desktop">Save</button>' +
      '</form></div></div>';
  }

  function renderLogoutAllPopup() {
    return '<div class="tma-dash__settings-popup" data-settings-popup="logout-all" hidden role="dialog" aria-modal="true" aria-label="Log out of all devices" data-node-id="30919:278182">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--logout">' +
      renderPopupClose() +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked">' +
      '<p class="tma-dash__settings-change-text">You have been logged out from other active sessions for</p>' +
      '<p class="tma-dash__settings-change-email tma-dash__settings-change-email--lg" data-logout-email>' + esc(CURRENT_EMAIL) + '</p></div>' +
      '<button type="button" class="tma-dash__settings-submit tma-dash__settings-submit--secondary" data-logout-all-ok>OK</button></div></div>';
  }

  function renderOtpGroup(count, label) {
    var html = '<div class="tma-dash__settings-otp' + (count === 6 ? ' tma-dash__settings-otp--6' : '') + '" data-otp-group role="group" aria-label="' + esc(label) + '">';
    var i;
    for (i = 1; i <= count; i++) {
      html += '<input class="tma-dash__settings-otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1"' +
        (i === 1 ? ' autocomplete="one-time-code"' : '') + ' aria-label="Digit ' + i + '">';
    }
    return html + '</div>';
  }

  function renderTwoStepBackupCodesMarkup() {
    return TWO_STEP_BACKUP_CODES.map(function (code) {
      return '<span class="tma-dash__settings-two-step-backup-code">' + esc(code) + '</span>';
    }).join('');
  }

  function getTwoStepPinnedCountry() {
    var pinned = TWO_STEP_COUNTRIES.find(function (country) { return country.code === TWO_STEP_PINNED_COUNTRY_CODE; });
    if (pinned) return pinned;
    return TWO_STEP_COUNTRIES.find(function (country) { return country.name === 'Saint Lucia'; }) || TWO_STEP_COUNTRIES[0];
  }

  function getDefaultTwoStepPhoneCode() {
    return TWO_STEP_PINNED_COUNTRY_CODE;
  }

  function renderTwoStepCountryRow(country, extraClass) {
    return '<button type="button" class="tma-dash__settings-two-step-country' + (extraClass || '') + '" data-two-step-country="' + esc(country.code) + '" data-two-step-country-name="' + esc(country.name) + '">' +
      '<span class="tma-dash__settings-two-step-country-label">' + country.flag + ' ' + esc(country.name) + ' ' + esc(country.code) + '</span></button>';
  }

  function renderTwoStepCountryPicker() {
    var pinned = getTwoStepPinnedCountry();
    var list = TWO_STEP_COUNTRIES.filter(function (country) { return country.code !== pinned.code; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<div class="tma-dash__settings-two-step-country-picker">' +
      '<label class="tma-dash__settings-two-step-country-search">' +
      '<img src="' + ICON + 'MagnifyingGlass.svg" alt="" width="20" height="20">' +
      '<input type="search" class="tma-dash__settings-two-step-country-search-input" data-two-step-country-search placeholder="Search" autocomplete="off" aria-label="Search countries">' +
      '<img class="tma-dash__settings-two-step-country-search-mic" src="' + ICON + 'Microphone.svg" alt="" width="20" height="20" aria-hidden="true">' +
      '</label>' +
      renderTwoStepCountryRow(pinned, ' tma-dash__settings-two-step-country--pinned is-selected') +
      '<div class="tma-dash__settings-two-step-country-card" data-two-step-country-list">' +
      list.map(function (country) { return renderTwoStepCountryRow(country); }).join('') +
      '</div></div>';
  }

  function syncTwoStepCountrySelection(popup, code) {
    popup.querySelectorAll('[data-two-step-country]').forEach(function (item) {
      item.classList.toggle('is-selected', item.getAttribute('data-two-step-country') === code);
    });
  }

  function filterTwoStepCountries(popup, query) {
    var q = query.trim().toLowerCase();
    popup.querySelectorAll('[data-two-step-country]').forEach(function (btn) {
      var text = btn.textContent.toLowerCase();
      btn.hidden = !!(q && text.indexOf(q) === -1);
    });
  }

  function renderTwoStepMethodCard(opts) {
    return '<button type="button" class="tma-dash__settings-two-step-method' + (opts.active ? ' is-active' : '') + (opts.configured ? ' is-configured' : '') + '" data-two-step-method="' + esc(opts.id) + '">' +
      (opts.configured ? '<img class="tma-dash__settings-two-step-method-check" src="' + ICON + 'CheckCircle.svg" alt="" width="20" height="20">' : '') +
      '<img class="tma-dash__settings-two-step-method-icon" src="' + ICON + opts.icon + '.svg" alt="" width="32" height="32">' +
      '<span class="tma-dash__settings-two-step-method-copy">' +
      '<span class="tma-dash__settings-two-step-method-title">' + esc(opts.title) + '</span>' +
      '<span class="tma-dash__settings-two-step-method-desc">' + opts.desc + '</span></span></button>';
  }

  function renderTwoStepPopup() {
    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--two-step" data-settings-popup="two-step" hidden role="dialog" aria-modal="true" aria-label="2-step verification" data-node-id="30919:278155">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--two-step">' +
      renderPopupClose() +
      renderMobileFlowSheet({
        backDataAttr: 'data-two-step-back',
        titleDataAttr: 'data-two-step-mobile-title',
        title: '2-step verification',
        nextDataAttr: 'data-two-step-next',
        sheetDataAttr: 'data-two-step-mobile',
      }) +
      '<div class="tma-dash__settings-flow-body">' +
      '<div class="tma-dash__settings-change-step is-active" data-two-step-step="overview" data-node-id="30919:278155">' +
      '<div class="tma-dash__settings-change-icon tma-dash__settings-change-step-desktop-only" aria-hidden="true"><img src="' + ICON + 'LockKeyOpen.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-step-desktop-only">' +
      '<h3 class="tma-dash__settings-change-title" data-two-step-status-title>2-step verification is off</h3>' +
      '<p class="tma-dash__settings-change-text">For the security of your account, please turn on the 2-step verification.</p>' +
      '<p class="tma-dash__settings-change-text">Add any of the following ways to turn on 2-step verification.</p></div>' +
      '<hr class="tma-dash__settings-change-divider tma-dash__settings-change-step-desktop-only">' +
      '<div class="tma-dash__settings-two-step-toggle-card" data-node-id="30919:293325">' +
      '<div class="tma-dash__settings-two-step-toggle-row">' +
      '<span class="tma-dash__settings-two-step-toggle-label">2-step verification</span>' +
      renderSwitch(false, '2-step verification') +
      '</div></div>' +
      '<div class="tma-dash__settings-two-step-intro tma-dash__settings-change-step-mobile-only">' +
      '<p class="tma-dash__settings-change-text">For the security of your account, please turn on the 2-step verification.</p>' +
      '<p class="tma-dash__settings-change-text">Add any of the following ways to turn on 2-step verification.</p></div>' +
      '<hr class="tma-dash__settings-change-divider tma-dash__settings-change-step-desktop-only">' +
      '<div class="tma-dash__settings-two-step-methods">' +
      renderTwoStepMethodCard({
        id: 'authenticator',
        icon: 'ShieldStar',
        title: 'Authenticator app',
        desc: 'Use an authenticator app such as <a href="#" class="tma-dash__settings-inline-link" data-two-step-link>Google Authenticator</a>.',
      }) +
      renderTwoStepMethodCard({
        id: 'phone',
        icon: 'Phone',
        title: 'Phone number',
        desc: 'Use phone number for 2-step verification.',
      }) +
      renderTwoStepMethodCard({
        id: 'email',
        icon: 'EnvelopeSimple',
        title: 'Email',
        desc: 'Use Email for 2-step verification.',
      }) +
      '<p class="tma-dash__settings-two-step-hint">Adjust the sorting to change the default 2-step verification.</p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-desktop-only" data-two-step-step="authenticator" hidden data-node-id="30919:278173">' +
      '<div class="tma-dash__settings-change-copy">' +
      '<h3 class="tma-dash__settings-change-title">Scan QR code in authenticator app</h3></div>' +
      '<img class="tma-dash__settings-two-step-qr" src="/images/settings/authenticator-qr.svg" alt="QR code for authenticator app setup" width="200" height="200">' +
      '<p class="tma-dash__settings-change-text tma-dash__settings-change-text--center">Enter the one-time code from authenticator to complete setup.</p>' +
      '<form class="tma-dash__settings-change-form" data-two-step-verify-form action="#" method="post" novalidate>' +
      renderOtpGroup(6, '6 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Verify code</button></form>' +
      '<div class="tma-dash__settings-change-footer">' +
      '<p class="tma-dash__settings-resend">Can\u2019t scan code?</p>' +
      '<p class="tma-dash__settings-help"><a href="#">Download authenticator app</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="authenticator-qr" hidden data-node-id="30919:293333">' +
      '<p class="tma-dash__settings-two-step-mobile-heading">Scan QR code in authenticator app</p>' +
      '<img class="tma-dash__settings-two-step-qr" src="/images/settings/authenticator-qr.svg" alt="QR code for authenticator app setup" width="200" height="200">' +
      '<div class="tma-dash__settings-change-footer tma-dash__settings-change-footer--authenticator-qr">' +
      '<p class="tma-dash__settings-resend"><button type="button" class="tma-dash__settings-inline-btn" data-two-step-show-key>Can\u2019t scan code?</button></p>' +
      '<p class="tma-dash__settings-help"><a href="#">Download authenticator app</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="authenticator-key" hidden data-node-id="30919:293331">' +
      '<p class="tma-dash__settings-two-step-mobile-heading">Enter this key in authenticator app</p>' +
      '<div class="tma-dash__settings-two-step-key-card">' +
      '<code class="tma-dash__settings-two-step-key" data-two-step-auth-key>' + esc(TWO_STEP_AUTH_KEY) + '</code>' +
      '<button type="button" class="tma-dash__settings-two-step-copy" data-two-step-copy-key>Copy</button></div>' +
      '<div class="tma-dash__settings-change-footer tma-dash__settings-change-footer--authenticator-key">' +
      '<p class="tma-dash__settings-resend"><button type="button" class="tma-dash__settings-inline-btn" data-two-step-show-qr>Scan QR code</button></p>' +
      '<p class="tma-dash__settings-help"><a href="#">Download authenticator app</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="authenticator-verify" hidden data-node-id="30919:293334">' +
      '<p class="tma-dash__settings-two-step-mobile-heading">Enter the one-time code from authenticator to complete setup.</p>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--authenticator-verify" data-two-step-verify-form action="#" method="post" novalidate>' +
      renderOtpGroup(6, '6 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Verify code</button></form></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="authenticator-backup" hidden data-node-id="30919:293332">' +
      '<p class="tma-dash__settings-two-step-mobile-heading">Save these backup codes</p>' +
      '<p class="tma-dash__settings-change-text tma-dash__settings-change-text--backup">You\u2019ll need them if you lose your device or can\u2019t sign in with your authenticator app.</p>' +
      '<div class="tma-dash__settings-two-step-backup-grid" data-two-step-backup-codes>' + renderTwoStepBackupCodesMarkup() + '</div>' +
      '<div class="tma-dash__settings-two-step-backup-actions">' +
      '<button type="button" class="tma-dash__settings-two-step-copy" data-two-step-copy-backup>Copy</button>' +
      '<button type="button" class="tma-dash__settings-two-step-copy" data-two-step-download-backup>Download</button></div>' +
      '<button type="button" class="tma-dash__settings-submit tma-dash__settings-submit--backup-done" data-two-step-backup-done>I\u2019ve saved them</button></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="phone-country" hidden data-node-id="30919:293343">' +
      renderTwoStepCountryPicker() + '</div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="phone-enter" hidden data-node-id="30919:293344">' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--phone-enter" data-two-step-phone-form action="#" method="post" novalidate>' +
      '<input class="tma-dash__settings-flow-input" type="tel" name="twoStepPhone" placeholder="Email or Phone number" autocomplete="tel" inputmode="tel" aria-label="Email or Phone number">' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Next</button></form></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="phone-verify" hidden data-node-id="30919:293346">' +
      '<div class="tma-dash__settings-change-icon" aria-hidden="true"><img src="' + ICON + 'DeviceMobile.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-copy--two-step-verify-mobile">' +
      '<p class="tma-dash__settings-change-text">Enter the verification code we sent to</p>' +
      '<p class="tma-dash__settings-change-email" data-two-step-phone-target>+1-758 19850622</p></div>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--phone-verify" data-two-step-phone-verify-form action="#" method="post" novalidate>' +
      renderOtpGroup(4, '4 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Submit</button></form>' +
      '<div class="tma-dash__settings-change-footer">' +
      '<p class="tma-dash__settings-resend" data-two-step-phone-resend>Resend (60s)</p>' +
      '<p class="tma-dash__settings-help"><a href="#">Need help?</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-desktop-only" data-two-step-step="email-enter" hidden data-node-id="30919:278176">' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--email-enter" data-two-step-email-form action="#" method="post" novalidate>' +
      '<input class="tma-dash__settings-flow-input tma-dash__settings-field-input--solo" type="email" name="twoStepEmail" placeholder="Enter your Email" autocomplete="email" aria-label="Enter your Email" value="' + esc(CURRENT_EMAIL) + '">' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Next</button></form></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="email-enter" hidden data-node-id="30919:293345">' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--email-enter" data-two-step-email-form action="#" method="post" novalidate>' +
      '<input class="tma-dash__settings-flow-input" type="email" name="twoStepEmail" placeholder="Enter your Email" autocomplete="email" aria-label="Enter your Email">' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Next</button></form></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-desktop-only" data-two-step-step="email-verify" hidden data-node-id="30919:278178">' +
      '<div class="tma-dash__settings-change-icon" aria-hidden="true"><img src="' + ICON + 'EnvelopeSimple.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy">' +
      '<h3 class="tma-dash__settings-change-title">Check your inbox</h3>' +
      '<p class="tma-dash__settings-change-text">Please open the link in the email to continue or enter the verification code we sent to</p>' +
      '<p class="tma-dash__settings-change-email" data-two-step-email-target>' + esc(CURRENT_EMAIL) + '</p></div>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--email-verify" data-two-step-email-verify-form action="#" method="post" novalidate>' +
      renderOtpGroup(4, '4 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Submit</button></form>' +
      '<div class="tma-dash__settings-change-footer">' +
      '<p class="tma-dash__settings-resend" data-two-step-resend>Resend (60s)</p>' +
      '<p class="tma-dash__settings-help"><a href="#">Need help?</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step tma-dash__settings-change-step-mobile-only" data-two-step-step="email-verify" hidden data-node-id="30919:293347">' +
      '<div class="tma-dash__settings-change-icon" aria-hidden="true"><img src="' + ICON + 'EnvelopeSimple.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-copy--two-step-verify-mobile">' +
      '<p class="tma-dash__settings-change-text">Enter the verification code we sent to</p>' +
      '<p class="tma-dash__settings-change-email" data-two-step-email-target>' + esc(CURRENT_EMAIL) + '</p></div>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--email-verify" data-two-step-email-verify-form action="#" method="post" novalidate>' +
      renderOtpGroup(4, '4 digit verification code') +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--step-desktop">Submit</button></form>' +
      '<div class="tma-dash__settings-change-footer">' +
      '<p class="tma-dash__settings-resend" data-two-step-email-resend>Resend (60s)</p>' +
      '<p class="tma-dash__settings-help"><a href="#" data-two-step-switch-method>Switch verification method</a></p></div></div>' +
      '<div class="tma-dash__settings-change-step" data-two-step-step="done" hidden data-node-id="30919:278169">' +
      '<div class="tma-dash__settings-change-icon" aria-hidden="true"><img src="' + ICON + 'CheckCircle.svg" alt="" width="80" height="80"></div>' +
      '<div class="tma-dash__settings-change-copy">' +
      '<h3 class="tma-dash__settings-change-title" data-two-step-done-title>Authenticator app has been added</h3></div>' +
      '<button type="button" class="tma-dash__settings-submit tma-dash__settings-submit--secondary" data-two-step-view-methods>View 2-step methods</button></div>' +
      '</div>' +
      '<div class="tma-dash__settings-two-step-alert" data-two-step-alert hidden role="alertdialog" aria-modal="true" aria-labelledby="two-step-alert-title" data-node-id="30919:293336">' +
      '<div class="tma-dash__settings-two-step-alert-card">' +
      '<p class="tma-dash__settings-two-step-alert-title" id="two-step-alert-title" data-two-step-alert-title>Authenticator app has been added</p>' +
      '<button type="button" class="tma-dash__settings-two-step-alert-action" data-two-step-alert-action>View 2-step methods</button></div></div>' +
      '</div></div>';
  }

  function renderDeleteAccountPopup() {
    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--delete" data-settings-popup="delete-account" hidden role="dialog" aria-modal="true" aria-label="Delete my account" data-node-id="30919:278183">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--delete">' +
      renderPopupClose() +
      '<h3 class="tma-dash__settings-change-title tma-dash__settings-change-title--desktop">Delete my account</h3>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--delete" data-delete-account-form action="#" method="post" novalidate>' +
      renderMobileFlowSheet({
        backDataAttr: 'data-delete-account-back',
        titleDataAttr: 'data-delete-account-mobile-title',
        title: 'Delete my account',
        sheetDataAttr: 'data-delete-account-mobile',
        trailingHtml: '<button type="submit" class="tma-dash__settings-flow-mobile-action tma-dash__settings-flow-mobile-action--danger" data-delete-account-submit>Delete</button>',
      }) +
      '<div class="tma-dash__settings-flow-body">' +
      '<div class="tma-dash__settings-change-copy tma-dash__settings-change-copy--stacked tma-dash__settings-change-copy--delete" data-node-id="30919:293316">' +
      '<h3 class="tma-dash__settings-change-title tma-dash__settings-change-title--delete-warning">This operation will permanently delete the account</h3>' +
      '<p class="tma-dash__settings-change-text">After deleting your account, you cannot recover it by any means, so please proceed with caution.</p></div>' +
      '<hr class="tma-dash__settings-change-divider">' +
      '<div class="tma-dash__settings-delete-confirm">' +
      '<p class="tma-dash__settings-delete-hint">Please type in your email to confirm.</p>' +
      '<input class="tma-dash__settings-flow-input tma-dash__settings-flow-input--email" type="email" name="confirmEmail" data-delete-account-email placeholder="' + esc(CURRENT_EMAIL) + '" autocomplete="email" aria-label="Confirm email" required></div>' +
      '</div>' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--danger tma-dash__settings-submit--delete-desktop">Delete</button>' +
      '</form></div></div>';
  }

  function renderChangeNamePopup() {
    return '<div class="tma-dash__settings-popup tma-dash__settings-popup--flow tma-dash__settings-popup--name" data-settings-popup="change-name" hidden role="dialog" aria-modal="true" aria-label="Change name" data-node-id="30919:278184">' +
      renderPopupBackdrop() +
      '<div class="tma-dash__settings-change-card tma-dash__settings-change-card--name">' +
      renderPopupClose() +
      '<h3 class="tma-dash__settings-change-title tma-dash__settings-change-title--name tma-dash__settings-change-title--desktop">Change name</h3>' +
      '<form class="tma-dash__settings-change-form tma-dash__settings-change-form--name" data-change-name-form action="#" method="post" novalidate>' +
      renderMobileFlowSheet({
        backDataAttr: 'data-change-name-back',
        titleDataAttr: 'data-change-name-mobile-title',
        title: 'Change name',
        nextDataAttr: 'data-change-name-next',
        saveDataAttr: 'data-change-name-save',
        sheetDataAttr: 'data-change-name-mobile',
      }) +
      '<div class="tma-dash__settings-flow-body">' +
      '<div class="tma-dash__settings-change-step is-active" data-change-name-step="1" data-node-id="30919:293307">' +
      '<input class="tma-dash__settings-flow-input" type="text" name="firstName" placeholder="First name" autocomplete="given-name" aria-label="First name">' +
      '</div>' +
      '<div class="tma-dash__settings-change-step" data-change-name-step="2" hidden data-node-id="30919:293317">' +
      '<input class="tma-dash__settings-flow-input" type="text" name="lastName" placeholder="Last name" autocomplete="family-name" aria-label="Last name">' +
      '</div></div>' +
      '<button type="submit" class="tma-dash__settings-submit tma-dash__settings-submit--name-desktop">Save</button>' +
      '</form></div></div>';
  }

  function renderNav(activeId) {
    return NAV.map(function (item) {
      var icon = item.avatar
        ? '<span class="tma-dash__settings-nav-icon tma-dash__settings-nav-icon--avatar"><img src="' + AVATAR + 'AvatarByewind.png" alt=""></span>'
        : '<span class="tma-dash__settings-nav-icon"><img src="' + ICON + item.icon + '.svg" alt=""></span>';
      return '<button type="button" class="tma-dash__settings-nav-item' + (item.id === activeId ? ' is-active' : '') + '" data-settings-nav="' + esc(item.id) + '">' +
        icon +
        '<span class="tma-dash__settings-nav-label">' + esc(item.label) + '</span>' +
        chevronIcon() +
        '</button>';
    }).join('');
  }

  function renderAccountSecurityPanel() {
    return '<section class="tma-dash__settings-panel" data-settings-panel="account-security" hidden>' +
      '<div data-account-security-mount>' + (window.TMASkeleton ? window.TMASkeleton.rows(4) : '<p class="tma-dash__settings-change-text">Loading…</p>') + '</div>' +
      '</section>';
  }

  function render(activeNav) {
    return '<div class="tma-dash__settings-layout" data-node-id="30919:278108">' +
      '<div class="tma-dash__settings-card" data-settings-card>' +
      '<nav class="tma-dash__settings-nav" aria-label="Settings sections" data-settings-sidebar>' + renderNav(activeNav || 'profile') + '</nav>' +
      '<div class="tma-dash__settings-content" data-settings-content>' +
      '<div class="tma-dash__settings-mobile-head" data-settings-mobile-head hidden>' +
      '<button type="button" class="tma-dash__settings-mobile-back" data-settings-menu-back aria-label="Back to settings menu">' +
      '<img src="' + ICON + 'CaretLeft.svg" alt="" width="24" height="24"></button>' +
      '<h2 class="tma-dash__settings-mobile-title" data-settings-mobile-title>Settings</h2>' +
      '<button type="button" class="tma-dash__settings-mobile-more" data-settings-mobile-more hidden aria-label="More options">' +
      '<img src="' + ICON + 'DotsThree.svg" alt="" width="24" height="24"></button></div>' +
      renderProfilePanel() +
      renderAccountSecurityPanel() +
      renderThemePanel() +
      renderTimePanel() +
      renderNotificationsPanel() +
      renderPrivacyPanel() +
      renderPaymentPanel() +
      renderPluginsPanel() +
      renderChangeEmailPopup() +
      renderChangeNamePopup() +
      renderChangePasswordPopup() +
      renderLogoutAllPopup() +
      renderDeleteAccountPopup() +
      renderTwoStepPopup() +
      renderAddPaymentMethodPopup() +
      '</div></div></div>' +
      '<div class="tma-dash__settings-toast" data-settings-toast role="status" aria-live="polite" hidden>' +
      '<img src="' + ICON + 'CheckCircle.svg" alt=""><span data-settings-toast-text>Email changed</span></div>';
  }

  function activateNav(root, id) {
    closePaymentPayout(root);
    closePaymentSwipes(root);
    root.querySelectorAll('[data-settings-nav]').forEach(function (btn) {
      var on = btn.getAttribute('data-settings-nav') === id;
      btn.classList.toggle('is-active', on);
    });
    root.querySelectorAll('[data-settings-panel]').forEach(function (panel) {
      var pid = panel.getAttribute('data-settings-panel');
      var on = pid === id;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    if (id === 'theme') syncThemePanelUI(root);
    if (id === 'time') {
      syncTimePanelUI(root);
      closePickers(root);
    }
    if (id === 'notifications') {
      syncNotificationsPanelUI(root);
      closePickers(root);
    }
    if (id === 'privacy') {
      syncPrivacyPanelUI(root);
      closePickers(root);
    }
    if (id === 'payment') syncPaymentPanelUI(root);
    if (id === 'plugins') {
      syncPluginsPanelUI(root);
      closePluginMenus(root);
    }
    syncPluginsMobileChrome(root, id);
    if (isSettingsMobile()) {
      setMobileView(root, 'detail', id);
    }
  }

  function closePopups(root) {
    closePickers(root);
    root.querySelectorAll('[data-settings-popup]').forEach(function (popup) {
      popup.hidden = true;
    });
    root.classList.remove('is-settings-popup-open');
    if (root.querySelector('[data-change-name-step]')) {
      setChangeNameStep(root, 1);
    }
    if (root.querySelector('[data-change-email-step]')) {
      resetChangeEmailFlow(root);
    }
    if (root.querySelector('[data-change-password-step]')) {
      resetChangePasswordFlow(root);
    }
    if (root.querySelector('[data-two-step-step]')) {
      resetTwoStepFlow(root);
    }
    if (root.querySelector('[data-payment-step]')) {
      resetAddPaymentForm(root);
    }
  }

  function setChangePasswordStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="change-password"]');
    if (!popup) return;
    popup.querySelectorAll('[data-change-password-step]').forEach(function (panel) {
      var on = panel.getAttribute('data-change-password-step') === String(step);
      panel.classList.toggle('is-active', on);
      if (isSettingsMobile()) {
        panel.hidden = !on;
      } else {
        panel.hidden = false;
      }
    });
    var nextBtn = popup.querySelector('[data-change-password-next]');
    var saveBtn = popup.querySelector('[data-change-password-save]');
    if (nextBtn) nextBtn.hidden = step === 3;
    if (saveBtn) saveBtn.hidden = step !== 3;
    var focusEl = popup.querySelector('[data-change-password-step="' + step + '"] input');
    if (focusEl) window.setTimeout(function () { focusEl.focus(); }, 0);
  }

  function resetChangePasswordFlow(root) {
    var form = root.querySelector('[data-change-password-form]');
    if (form) form.reset();
    updatePasswordStrength(root, '');
    setChangePasswordStep(root, 1);
  }

  function advanceChangePasswordMobile(root) {
    var popup = root.querySelector('[data-settings-popup="change-password"]');
    if (!popup) return;
    var active = popup.querySelector('[data-change-password-step].is-active');
    if (!active) return;
    var step = active.getAttribute('data-change-password-step');
    var input = active.querySelector('input');
    if (input && !input.value.trim()) {
      input.focus();
      return;
    }
    if (step === '1') {
      setChangePasswordStep(root, 2);
      return;
    }
    if (step === '2') {
      setChangePasswordStep(root, 3);
    }
  }

  function setChangeNameStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="change-name"]');
    if (!popup) return;
    popup.querySelectorAll('[data-change-name-step]').forEach(function (panel) {
      var on = panel.getAttribute('data-change-name-step') === String(step);
      panel.classList.toggle('is-active', on);
      if (isSettingsMobile()) {
        panel.hidden = !on;
      } else {
        panel.hidden = false;
      }
    });
    var nextBtn = popup.querySelector('[data-change-name-next]');
    var saveBtn = popup.querySelector('[data-change-name-save]');
    if (nextBtn) nextBtn.hidden = step !== 1;
    if (saveBtn) saveBtn.hidden = step !== 2;
    var focusEl = popup.querySelector('[data-change-name-step="' + step + '"] input');
    if (focusEl) window.setTimeout(function () { focusEl.focus(); }, 0);
  }

  function openPopup(root, id) {
    var popup = root.querySelector('[data-settings-popup="' + id + '"]');
    if (!popup) return;
    closePopups(root);
    var toast = root.querySelector('[data-settings-toast]');
    if (toast) toast.hidden = true;
    popup.hidden = false;
    root.classList.add('is-settings-popup-open');
    if (id === 'change-name') {
      prefillChangeNameForm(root);
      setChangeNameStep(root, 1);
      return;
    }
    if (id === 'change-email') {
      resetChangeEmailFlow(root);
      return;
    }
    if (id === 'change-password') {
      resetChangePasswordFlow(root);
      return;
    }
    if (id === 'add-payment-method') {
      resetAddPaymentForm(root);
      syncPaymentPickLayout(root);
      return;
    }
    var focusEl = popup.querySelector('input, button, [href], textarea, select');
    if (focusEl) window.setTimeout(function () { focusEl.focus(); }, 0);
  }

  function prefillChangeNameForm(root) {
    var form = root.querySelector('[data-change-name-form]');
    if (!form) return;
    var displayEl = root.querySelector('.tma-dash__settings-profile-name');
    var raw = displayEl ? displayEl.textContent.trim() : 'ByeWind';
    var parts = raw.split(/\s+/).filter(Boolean);
    var first = form.querySelector('[name="firstName"]');
    var last = form.querySelector('[name="lastName"]');
    if (first) first.value = parts[0] || '';
    if (last) last.value = parts.slice(1).join(' ');
  }

  function openChangeNamePopup(root) {
    openPopup(root, 'change-name');
  }

  function showToast(root, message) {
    var toast = root.querySelector('[data-settings-toast]');
    var text = root.querySelector('[data-settings-toast-text]');
    if (!toast) return;
    if (text) text.textContent = message;
    toast.hidden = false;
    window.setTimeout(function () { toast.hidden = true; }, 3000);
  }

  function setChangeEmailStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="change-email"]');
    if (!popup) return;
    popup.querySelectorAll('[data-change-email-step]').forEach(function (panel) {
      var on = panel.getAttribute('data-change-email-step') === String(step);
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    popup.dataset.changeEmailStep = String(step);
    var titleEl = popup.querySelector('[data-change-email-mobile-title]');
    if (titleEl) titleEl.textContent = step === 3 ? 'Verification' : 'Change email';
    var nextBtn = popup.querySelector('[data-change-email-next]');
    if (nextBtn) nextBtn.hidden = step === 3;
    var focusEl = popup.querySelector('[data-change-email-step="' + step + '"] input');
    if (focusEl) window.setTimeout(function () { focusEl.focus(); }, 0);
  }

  function advanceChangeEmailMobile(root) {
    var popup = root.querySelector('[data-settings-popup="change-email"]');
    if (!popup) return;
    var step = parseInt(popup.dataset.changeEmailStep || '1', 10);
    if (step === 1) {
      setChangeEmailStep(root, 2);
      return;
    }
    if (step === 2) {
      var input = popup.querySelector('[name="newEmail"]');
      var newEmail = input && input.value.trim();
      if (!newEmail) {
        if (input) input.focus();
        return;
      }
      var target = popup.querySelector('[data-change-email-target]');
      if (target) target.textContent = newEmail;
      popup.dataset.pendingEmail = newEmail;
      setChangeEmailStep(root, 3);
      bindResend(root);
    }
  }

  function resetChangeEmailFlow(root) {
    var popup = root.querySelector('[data-settings-popup="change-email"]');
    if (!popup) return;
    popup.querySelectorAll('form[data-change-email-form-step]').forEach(function (form) {
      form.reset();
    });
    popup.querySelectorAll('[data-change-email-step="3"] .tma-dash__settings-otp-digit').forEach(function (digit) {
      digit.value = '';
      digit.classList.remove('is-filled');
    });
    var target = popup.querySelector('[data-change-email-target]');
    var profileEmail = root.querySelector('.tma-dash__settings-profile-email');
    var emailText = profileEmail ? profileEmail.textContent.trim() : CURRENT_EMAIL;
    if (target) target.textContent = emailText;
    var current = popup.querySelector('[data-change-email-current]');
    if (current) current.textContent = emailText;
    var resendEl = popup.querySelector('[data-resend]');
    if (resendEl) {
      delete resendEl.dataset.bound;
      resendEl.textContent = 'Resend (60s)';
      resendEl.style.color = '';
      resendEl.style.cursor = '';
    }
    setChangeEmailStep(root, 1);
  }

  function openDeleteAccountPopup(root) {
    openPopup(root, 'delete-account');
    var email = root.querySelector('.tma-dash__settings-profile-email');
    var form = root.querySelector('[data-delete-account-form]');
    if (form) form.reset();
    var input = root.querySelector('[data-delete-account-email]');
    if (email && input) input.placeholder = email.textContent.trim();
    if (input) window.setTimeout(function () { input.focus(); }, 0);
  }

  function openLogoutAllPopup(root) {
    openPopup(root, 'logout-all');
    var email = root.querySelector('.tma-dash__settings-profile-email');
    var target = root.querySelector('[data-logout-email]');
    if (email && target) target.textContent = email.textContent.trim();
  }

  function isTwoStepEnabled(root) {
    return root.dataset.twoStepEnabled === '1';
  }

  function updateTwoStepProfileRow(root) {
    var enabled = isTwoStepEnabled(root);
    root.querySelectorAll('[data-settings-action="two-step"] .tma-dash__settings-row-value > span').forEach(function (el) {
      el.textContent = enabled ? 'On' : 'Off';
    });
  }

  function updateTwoStepOverviewUI(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var enabled = isTwoStepEnabled(root);
    var title = popup.querySelector('[data-two-step-status-title]');
    if (title) title.textContent = enabled ? '2-step verification is on' : '2-step verification is off';
    var toggle = popup.querySelector('[data-two-step-step="overview"] .tma-dash__settings-switch-input');
    if (toggle) toggle.checked = enabled;
    updateTwoStepMethodCards(root);
  }

  function getTwoStepMethods(root) {
    try {
      return JSON.parse(root.dataset.twoStepMethods || '{}');
    } catch (e) {
      return {};
    }
  }

  function markTwoStepMethodConfigured(root, id) {
    var methods = getTwoStepMethods(root);
    methods[id] = true;
    root.dataset.twoStepMethods = JSON.stringify(methods);
    updateTwoStepMethodCards(root);
  }

  function updateTwoStepMethodCards(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var methods = getTwoStepMethods(root);
    popup.querySelectorAll('[data-two-step-method]').forEach(function (btn) {
      var id = btn.getAttribute('data-two-step-method');
      var configured = !!methods[id];
      btn.classList.toggle('is-configured', configured);
      var check = btn.querySelector('.tma-dash__settings-two-step-method-check');
      if (configured && !check) {
        btn.insertAdjacentHTML('afterbegin', '<img class="tma-dash__settings-two-step-method-check" src="' + ICON + 'CheckCircle.svg" alt="" width="20" height="20">');
      } else if (!configured && check) {
        check.remove();
      }
    });
  }

  function showTwoStepAlert(root, title) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var titleEl = popup.querySelector('[data-two-step-alert-title]');
    if (titleEl) titleEl.textContent = title;
    var alert = popup.querySelector('[data-two-step-alert]');
    if (alert) alert.hidden = false;
  }

  function hideTwoStepAlert(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var alert = popup.querySelector('[data-two-step-alert]');
    if (alert) alert.hidden = true;
  }

  function copyToClipboard(text, root, toastMsg) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      if (toastMsg) showToast(root, toastMsg);
    });
  }

  function finishTwoStepMethod(root, methodId, alertTitle) {
    markTwoStepMethodConfigured(root, methodId);
    root.dataset.twoStepEnabled = '1';
    updateTwoStepProfileRow(root);
    updateTwoStepOverviewUI(root);
    if (isSettingsMobile()) {
      showTwoStepAlert(root, alertTitle);
    } else {
      setTwoStepDoneTitle(root, alertTitle);
      setTwoStepStep(root, 'done');
    }
  }

  function advanceTwoStepMobile(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var step = popup.dataset.twoStepStep;
    if (step === 'authenticator-qr' || step === 'authenticator-key') {
      setTwoStepStep(root, 'authenticator-verify');
      return;
    }
    if (step === 'phone-enter') {
      var input = popup.querySelector('[name="twoStepPhone"]');
      var phone = input && input.value.trim();
      if (!phone) {
        if (input) input.focus();
        return;
      }
      var code = popup.dataset.twoStepPhoneCode || getDefaultTwoStepPhoneCode();
      var target = popup.querySelector('[data-two-step-phone-target]');
      if (target) target.textContent = code + ' ' + phone;
      popup.dataset.pendingTwoStepPhone = phone;
      clearTwoStepOtp(root);
      setTwoStepStep(root, 'phone-verify');
      bindTwoStepResend(root, '[data-two-step-phone-resend]');
      return;
    }
    if (step === 'email-enter') {
      var activeEmailStep = popup.querySelector('[data-two-step-step="email-enter"].is-active');
      var emailForm = activeEmailStep && activeEmailStep.querySelector('[data-two-step-email-form]');
      if (emailForm) emailForm.requestSubmit();
    }
  }

  function updateTwoStepMobileUI(root, step) {
    if (!isSettingsMobile()) return;
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var titleEl = popup.querySelector('[data-two-step-mobile-title]');
    var nextBtn = popup.querySelector('[data-two-step-next]');
    var backBtn = popup.querySelector('[data-two-step-back]');
    var titles = {
      overview: '2-step verification',
      'authenticator-qr': 'Add authenticator app',
      'authenticator-key': 'Add authenticator app',
      'authenticator-verify': 'Add authenticator app',
      'authenticator-backup': 'Add authenticator app',
      'phone-enter': 'Add phone number',
      'phone-country': 'Select country',
      'phone-verify': 'Add phone number',
      'email-enter': 'Add email',
      'email-verify': 'Add email',
      done: '2-step verification',
    };
    if (titleEl) titleEl.textContent = titles[step] || '2-step verification';
    if (nextBtn) {
      nextBtn.hidden = step !== 'authenticator-qr' && step !== 'authenticator-key' && step !== 'phone-enter' && step !== 'email-enter';
    }
    if (backBtn) backBtn.hidden = step === 'authenticator-backup';
  }

  function goToAuthenticatorStep(root) {
    setTwoStepStep(root, isSettingsMobile() ? 'authenticator-qr' : 'authenticator');
  }

  function setTwoStepStep(root, step) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    popup.querySelectorAll('[data-two-step-step]').forEach(function (panel) {
      var panelStep = panel.getAttribute('data-two-step-step');
      var mobileOnly = panel.classList.contains('tma-dash__settings-change-step-mobile-only');
      var desktopOnly = panel.classList.contains('tma-dash__settings-change-step-desktop-only');
      if (!isSettingsMobile() && mobileOnly) {
        panel.hidden = true;
        panel.classList.remove('is-active');
        return;
      }
      if (isSettingsMobile() && desktopOnly) {
        panel.hidden = true;
        panel.classList.remove('is-active');
        return;
      }
      var on = panelStep === step;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    popup.dataset.twoStepStep = step;
    updateTwoStepMobileUI(root, step);
    var activePanel = popup.querySelector('[data-two-step-step="' + step + '"].is-active');
    var focusEl = activePanel && activePanel.querySelector('input, button:not([hidden])');
    if (focusEl) window.setTimeout(function () { focusEl.focus(); }, 0);
  }

  function clearTwoStepOtp(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    popup.querySelectorAll('.tma-dash__settings-otp-digit').forEach(function (digit) {
      digit.value = '';
      digit.classList.remove('is-filled');
    });
  }

  function setTwoStepDoneTitle(root, title) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup) return;
    var el = popup.querySelector('[data-two-step-done-title]');
    if (el) el.textContent = title;
  }

  function completeTwoStepMethod(root, methodId, alertTitle) {
    finishTwoStepMethod(root, methodId, alertTitle);
  }

  function resetTwoStepFlow(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (popup) {
      var emailForms = popup.querySelectorAll('[data-two-step-email-form]');
      emailForms.forEach(function (emailForm) { emailForm.reset(); });
      var desktopEmailInput = popup.querySelector('[data-two-step-step="email-enter"].tma-dash__settings-change-step-desktop-only [name="twoStepEmail"]');
      if (desktopEmailInput) desktopEmailInput.value = CURRENT_EMAIL;
      var phoneForm = popup.querySelector('[data-two-step-phone-form]');
      if (phoneForm) phoneForm.reset();
      delete popup.dataset.pendingTwoStepEmail;
      delete popup.dataset.pendingTwoStepPhone;
      popup.dataset.twoStepPhoneCode = getDefaultTwoStepPhoneCode();
      delete popup.dataset.twoStepPhoneCountry;
      var search = popup.querySelector('[data-two-step-country-search]');
      if (search) {
        search.value = '';
        filterTwoStepCountries(popup, '');
      }
      syncTwoStepCountrySelection(popup, getDefaultTwoStepPhoneCode());
      popup.querySelectorAll('[data-two-step-resend], [data-two-step-phone-resend], [data-two-step-email-resend]').forEach(function (resendEl) {
        delete resendEl.dataset.bound;
        resendEl.textContent = 'Resend (60s)';
        resendEl.style.color = '';
        resendEl.style.cursor = '';
      });
    }
    hideTwoStepAlert(root);
    setTwoStepStep(root, 'overview');
    clearTwoStepOtp(root);
    setTwoStepDoneTitle(root, 'Authenticator app has been added');
    updateTwoStepOverviewUI(root);
  }

  function openTwoStepPopup(root) {
    openPopup(root, 'two-step');
    resetTwoStepFlow(root);
    updateTwoStepMethodCards(root);
  }

  function openChangeEmailPopup(root) {
    openPopup(root, 'change-email');
  }

  function closeChangeEmailPopup(root) {
    closePopups(root);
  }

  function bindOtpContainer(container) {
    if (!container || container.dataset.otpBound) return;
    container.dataset.otpBound = '1';
    var digits = Array.prototype.slice.call(container.querySelectorAll('.tma-dash__settings-otp-digit'));
    if (!digits.length) return;

    function focusDigit(index) {
      if (index >= 0 && index < digits.length) digits[index].focus();
    }

    digits.forEach(function (input, index) {
      input.addEventListener('input', function () {
        var val = input.value.replace(/\D/g, '');
        input.value = val.slice(-1);
        input.classList.toggle('is-filled', !!input.value);
        if (input.value && index < digits.length - 1) {
          focusDigit(index + 1);
          return;
        }
        if (index === digits.length - 1) {
          var allFilled = digits.every(function (digit) { return !!digit.value; });
          var form = container.closest(
            'form[data-change-email-form-step="3"], form[data-two-step-verify-form], form[data-two-step-email-verify-form], form[data-two-step-phone-verify-form]'
          );
          if (allFilled && form && isSettingsMobile()) form.requestSubmit();
        }
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !input.value && index > 0) focusDigit(index - 1);
      });
      input.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, digits.length);
        text.split('').forEach(function (char, i) {
          digits[i].value = char;
          digits[i].classList.add('is-filled');
        });
        focusDigit(Math.min(text.length, digits.length - 1));
        if (text.length === digits.length) {
          var form = container.closest(
            'form[data-change-email-form-step="3"], form[data-two-step-verify-form], form[data-two-step-email-verify-form], form[data-two-step-phone-verify-form]'
          );
          if (form && isSettingsMobile()) form.requestSubmit();
        }
      });
    });
  }

  function bindOtp(root) {
    root.querySelectorAll('[data-otp-group]').forEach(bindOtpContainer);
  }

  function bindTwoStepResend(root, selector) {
    var resendEl = root.querySelector('[data-settings-popup="two-step"] ' + (selector || '[data-two-step-resend]'));
    if (!resendEl || resendEl.dataset.bound) return;
    resendEl.dataset.bound = '1';
    var countdown = 60;
    var timer = window.setInterval(function () {
      countdown -= 1;
      if (countdown <= 0) {
        window.clearInterval(timer);
        resendEl.textContent = 'Resend';
        resendEl.style.color = 'var(--color-text-link)';
        resendEl.style.cursor = 'pointer';
        return;
      }
      resendEl.textContent = 'Resend (' + countdown + 's)';
    }, 1000);
  }

  function bindTwoStepPopup(root) {
    var popup = root.querySelector('[data-settings-popup="two-step"]');
    if (!popup || popup.dataset.bound) return;
    popup.dataset.bound = '1';
    popup.dataset.twoStepPhoneCode = getDefaultTwoStepPhoneCode();

    popup.querySelectorAll('[data-two-step-method="authenticator"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        goToAuthenticatorStep(root);
      });
    });

    popup.querySelectorAll('[data-two-step-method="phone"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        popup.dataset.twoStepPhoneCode = getDefaultTwoStepPhoneCode();
        syncTwoStepCountrySelection(popup, getDefaultTwoStepPhoneCode());
        setTwoStepStep(root, 'phone-country');
      });
    });

    var nextBtn = popup.querySelector('[data-two-step-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        advanceTwoStepMobile(root);
      });
    }

    var backBtn = popup.querySelector('[data-two-step-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var step = popup.dataset.twoStepStep;
        if (isSettingsMobile() && step === 'authenticator-verify') {
          clearTwoStepOtp(root);
          setTwoStepStep(root, 'authenticator-qr');
          return;
        }
        if (isSettingsMobile() && (step === 'authenticator-qr' || step === 'authenticator-key')) {
          setTwoStepStep(root, 'overview');
          return;
        }
        if (isSettingsMobile() && step === 'phone-verify') {
          clearTwoStepOtp(root);
          setTwoStepStep(root, 'phone-enter');
          return;
        }
        if (isSettingsMobile() && step === 'phone-country') {
          setTwoStepStep(root, 'overview');
          return;
        }
        if (isSettingsMobile() && step === 'phone-enter') {
          setTwoStepStep(root, 'phone-country');
          return;
        }
        if (isSettingsMobile() && step === 'email-verify') {
          clearTwoStepOtp(root);
          setTwoStepStep(root, 'email-enter');
          return;
        }
        if (isSettingsMobile() && step === 'email-enter') {
          setTwoStepStep(root, 'overview');
          return;
        }
        closePopups(root);
      });
    }

    popup.querySelectorAll('[data-two-step-method="email"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        setTwoStepStep(root, 'email-enter');
      });
    });

    var showKeyBtn = popup.querySelector('[data-two-step-show-key]');
    if (showKeyBtn) {
      showKeyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setTwoStepStep(root, 'authenticator-key');
      });
    }

    var showQrBtn = popup.querySelector('[data-two-step-show-qr]');
    if (showQrBtn) {
      showQrBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setTwoStepStep(root, 'authenticator-qr');
      });
    }

    var copyKeyBtn = popup.querySelector('[data-two-step-copy-key]');
    if (copyKeyBtn) {
      copyKeyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var keyEl = popup.querySelector('[data-two-step-auth-key]');
        copyToClipboard(keyEl ? keyEl.textContent.trim() : TWO_STEP_AUTH_KEY, root, 'Key copied');
      });
    }

    var copyBackupBtn = popup.querySelector('[data-two-step-copy-backup]');
    if (copyBackupBtn) {
      copyBackupBtn.addEventListener('click', function (e) {
        e.preventDefault();
        copyToClipboard(TWO_STEP_BACKUP_CODES.join('\n'), root, 'Backup codes copied');
      });
    }

    var downloadBackupBtn = popup.querySelector('[data-two-step-download-backup]');
    if (downloadBackupBtn) {
      downloadBackupBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var blob = new Blob([TWO_STEP_BACKUP_CODES.join('\n')], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'backup-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
      });
    }

    var backupDoneBtn = popup.querySelector('[data-two-step-backup-done]');
    if (backupDoneBtn) {
      backupDoneBtn.addEventListener('click', function (e) {
        e.preventDefault();
        finishTwoStepMethod(root, 'authenticator', 'Authenticator app has been added');
      });
    }

    var countrySearch = popup.querySelector('[data-two-step-country-search]');
    if (countrySearch) {
      countrySearch.addEventListener('input', function () {
        filterTwoStepCountries(popup, countrySearch.value);
      });
    }

    popup.querySelectorAll('[data-two-step-country]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var code = btn.getAttribute('data-two-step-country');
        popup.dataset.twoStepPhoneCode = code;
        popup.dataset.twoStepPhoneCountry = btn.getAttribute('data-two-step-country-name') || '';
        syncTwoStepCountrySelection(popup, code);
        setTwoStepStep(root, 'phone-enter');
      });
    });

    popup.querySelectorAll('[data-two-step-switch-method]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        clearTwoStepOtp(root);
        setTwoStepStep(root, 'overview');
      });
    });

    popup.querySelectorAll('[data-two-step-link]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });

    var emailFormSubmit = function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var input = form.querySelector('[name="twoStepEmail"]');
      var email = input && input.value.trim();
      if (!email) {
        if (input) input.focus();
        return;
      }
      popup.querySelectorAll('[data-two-step-email-target]').forEach(function (target) {
        target.textContent = email;
      });
      popup.dataset.pendingTwoStepEmail = email;
      clearTwoStepOtp(root);
      setTwoStepStep(root, 'email-verify');
      bindTwoStepResend(root, isSettingsMobile() ? '[data-two-step-email-resend]' : '[data-two-step-resend]');
    };
    popup.querySelectorAll('[data-two-step-email-form]').forEach(function (emailForm) {
      emailForm.addEventListener('submit', emailFormSubmit);
    });

    var phoneForm = popup.querySelector('[data-two-step-phone-form]');
    if (phoneForm) {
      phoneForm.addEventListener('submit', function (e) {
        e.preventDefault();
        advanceTwoStepMobile(root);
      });
    }

    var emailVerifySubmit = function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var digits = form.querySelectorAll('.tma-dash__settings-otp-digit');
      var code = Array.prototype.map.call(digits, function (d) { return d.value; }).join('');
      if (code.length < 4) {
        if (digits[code.length]) digits[code.length].focus();
        return;
      }
      finishTwoStepMethod(root, 'email', 'Email has been added');
    };
    popup.querySelectorAll('[data-two-step-email-verify-form]').forEach(function (emailVerifyForm) {
      emailVerifyForm.addEventListener('submit', emailVerifySubmit);
    });

    var phoneVerifyForm = popup.querySelector('[data-two-step-phone-verify-form]');
    if (phoneVerifyForm) {
      phoneVerifyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var digits = phoneVerifyForm.querySelectorAll('.tma-dash__settings-otp-digit');
        var code = Array.prototype.map.call(digits, function (d) { return d.value; }).join('');
        if (code.length < 4) {
          if (digits[code.length]) digits[code.length].focus();
          return;
        }
        finishTwoStepMethod(root, 'phone', 'Phone number has been added');
      });
    }

    popup.querySelectorAll('[data-two-step-verify-form]').forEach(function (verifyForm) {
      if (verifyForm.dataset.bound) return;
      verifyForm.dataset.bound = '1';
      verifyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var digits = verifyForm.querySelectorAll('.tma-dash__settings-otp-digit');
        var code = Array.prototype.map.call(digits, function (d) { return d.value; }).join('');
        if (code.length < 6) {
          if (digits[code.length]) digits[code.length].focus();
          return;
        }
        if (isSettingsMobile()) {
          setTwoStepStep(root, 'authenticator-backup');
          return;
        }
        finishTwoStepMethod(root, 'authenticator', 'Authenticator app has been added');
      });
    });

    function returnToTwoStepOverview() {
      hideTwoStepAlert(root);
      clearTwoStepOtp(root);
      updateTwoStepOverviewUI(root);
      setTwoStepStep(root, 'overview');
    }

    var viewMethodsBtn = popup.querySelector('[data-two-step-view-methods]');
    if (viewMethodsBtn) {
      viewMethodsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        returnToTwoStepOverview();
      });
    }

    var alertActionBtn = popup.querySelector('[data-two-step-alert-action]');
    if (alertActionBtn) {
      alertActionBtn.addEventListener('click', function (e) {
        e.preventDefault();
        returnToTwoStepOverview();
      });
    }

    var masterToggle = popup.querySelector('[data-two-step-step="overview"] .tma-dash__settings-switch-input');
    if (masterToggle) {
      masterToggle.addEventListener('change', function () {
        if (masterToggle.checked && !isTwoStepEnabled(root)) {
          masterToggle.checked = false;
          goToAuthenticatorStep(root);
          return;
        }
        if (!masterToggle.checked && isTwoStepEnabled(root)) {
          root.dataset.twoStepEnabled = '0';
          updateTwoStepProfileRow(root);
          updateTwoStepOverviewUI(root);
        }
      });
    }
  }

  function bindMobileFlowSheetDrag(root) {
    root.querySelectorAll('[data-settings-flow-drag]').forEach(function (zone) {
      if (zone.dataset.dragBound) return;
      zone.dataset.dragBound = '1';

      var popup = zone.closest('[data-settings-popup]');
      var card = popup && popup.querySelector('.tma-dash__settings-change-card');
      if (!popup || !card) return;

      var drag = null;
      var DISMISS_THRESHOLD = 72;

      function resetCardTransform(animate) {
        card.style.transition = animate ? 'transform 0.22s ease' : '';
        card.style.transform = '';
        if (animate) {
          window.setTimeout(function () { card.style.transition = ''; }, 220);
        }
      }

      function dismissSheet() {
        card.style.transition = 'transform 0.22s ease';
        card.style.transform = 'translateY(100%)';
        window.setTimeout(function () {
          resetCardTransform(false);
          var popupId = popup.getAttribute('data-settings-popup');
          if (popupId === 'two-step' && popup.dataset.twoStepStep === 'authenticator-backup') {
            clearTwoStepOtp(root);
            setTwoStepStep(root, 'authenticator-verify');
            return;
          }
          var backBtn = popup.querySelector('.tma-dash__settings-flow-mobile-back');
          if (backBtn && !backBtn.hidden) backBtn.click();
          else closePopups(root);
        }, 180);
      }

      zone.addEventListener('pointerdown', function (e) {
        if (!isSettingsMobile() || popup.hidden) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target.closest('.tma-dash__settings-flow-mobile-back, .tma-dash__settings-flow-mobile-action, [data-delete-account-submit]')) return;

        drag = {
          pointerId: e.pointerId,
          startY: e.clientY,
          currentY: e.clientY,
          lastY: e.clientY,
          lastTime: e.timeStamp,
          velocity: 0,
        };
        zone.classList.add('is-dragging');
        if (zone.setPointerCapture) zone.setPointerCapture(e.pointerId);
      });

      zone.addEventListener('pointermove', function (e) {
        if (!drag || drag.pointerId !== e.pointerId) return;
        var delta = Math.max(0, e.clientY - drag.startY);
        var dt = e.timeStamp - drag.lastTime;
        if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
        drag.currentY = e.clientY;
        drag.lastY = e.clientY;
        drag.lastTime = e.timeStamp;
        card.style.transition = 'none';
        card.style.transform = delta > 0 ? 'translateY(' + delta + 'px)' : '';
      });

      function endDrag(e) {
        if (!drag || drag.pointerId !== e.pointerId) return;
        zone.classList.remove('is-dragging');
        if (zone.releasePointerCapture) {
          try { zone.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        var delta = Math.max(0, drag.currentY - drag.startY);
        var shouldDismiss = delta > DISMISS_THRESHOLD || drag.velocity > 0.65;
        drag = null;
        if (shouldDismiss) dismissSheet();
        else resetCardTransform(true);
      }

      zone.addEventListener('pointerup', endDrag);
      zone.addEventListener('pointercancel', endDrag);
    });
  }

  function bindResend(root) {
    var resendEl = root.querySelector('[data-settings-popup="change-email"] [data-resend]');
    if (!resendEl || resendEl.dataset.bound) return;
    resendEl.dataset.bound = '1';
    var countdown = 60;
    var timer = window.setInterval(function () {
      countdown -= 1;
      if (countdown <= 0) {
        window.clearInterval(timer);
        resendEl.textContent = 'Resend';
        resendEl.style.color = 'var(--color-text-link)';
        resendEl.style.cursor = 'pointer';
        return;
      }
      resendEl.textContent = 'Resend (' + countdown + 's)';
    }, 1000);
  }

  function bindPasswordToggles(root) {
    root.querySelectorAll('[data-password-toggle]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var field = btn.closest('.tma-dash__settings-field, .tma-dash__settings-flow-field');
        var input = field && field.querySelector('input');
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        var img = btn.querySelector('img');
        if (img) img.src = ICON + (show ? 'Eye.svg' : 'EyeSlash.svg');
      });
    });
  }

  function bindChangeEmailForms(root) {
    var popup = root.querySelector('[data-settings-popup="change-email"]');
    if (!popup) return;

    var nextBtn = popup.querySelector('[data-change-email-next]');
    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = '1';
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        advanceChangeEmailMobile(root);
      });
    }

    var backBtn = popup.querySelector('[data-change-email-back]');
    if (backBtn && !backBtn.dataset.bound) {
      backBtn.dataset.bound = '1';
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var step = parseInt(popup.dataset.changeEmailStep || '1', 10);
        if (isSettingsMobile() && step > 1) {
          setChangeEmailStep(root, step - 1);
          return;
        }
        closePopups(root);
      });
    }

    var step1 = popup.querySelector('[data-change-email-form-step="1"]');
    if (step1 && !step1.dataset.bound) {
      step1.dataset.bound = '1';
      step1.addEventListener('submit', function (e) {
        e.preventDefault();
        setChangeEmailStep(root, 2);
      });
    }

    var step2 = popup.querySelector('[data-change-email-form-step="2"]');
    if (step2 && !step2.dataset.bound) {
      step2.dataset.bound = '1';
      step2.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = step2.querySelector('[name="newEmail"]');
        var newEmail = input && input.value.trim();
        if (!newEmail) {
          if (input) input.focus();
          return;
        }
        var target = popup.querySelector('[data-change-email-target]');
        if (target) target.textContent = newEmail;
        popup.dataset.pendingEmail = newEmail;
        setChangeEmailStep(root, 3);
        bindResend(root);
      });
    }

    var step3 = popup.querySelector('[data-change-email-form-step="3"]');
    if (step3 && !step3.dataset.bound) {
      step3.dataset.bound = '1';
      step3.addEventListener('submit', function (e) {
        e.preventDefault();
        var newEmail = popup.dataset.pendingEmail || CURRENT_EMAIL;
        closePopups(root);
        showToast(root, 'Email changed');
        root.querySelectorAll('.tma-dash__settings-profile-email').forEach(function (el) {
          el.textContent = newEmail;
        });
        root.querySelectorAll('[data-settings-action="change-email"] .tma-dash__settings-row-value > span').forEach(function (el) {
          el.textContent = newEmail;
        });
        delete popup.dataset.pendingEmail;
      });
    }
  }

  function passwordStrengthScore(value) {
    var val = String(value || '');
    var score = 0;
    if (val.length >= 8) score += 1;
    if (/[a-z]/.test(val) && /[A-Z]/.test(val)) score += 1;
    if (/[0-9]/.test(val)) score += 1;
    if (/[^a-zA-Z0-9]/.test(val)) score += 1;
    return score;
  }

  function updatePasswordStrength(root, value) {
    var meter = root.querySelector('[data-password-strength]');
    if (!meter) return;
    var score = passwordStrengthScore(value);
    meter.querySelectorAll('.tma-dash__settings-strength-seg').forEach(function (seg, index) {
      seg.classList.toggle('is-active', index < score);
    });
  }

  function bindChangePasswordForm(root) {
    var form = root.querySelector('[data-change-password-form]');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    var newPassword = form.querySelector('[name="newPassword"]');
    if (newPassword) {
      newPassword.addEventListener('input', function () {
        updatePasswordStrength(root, newPassword.value);
      });
    }

    var nextBtn = root.querySelector('[data-change-password-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        advanceChangePasswordMobile(root);
      });
    }

    var backBtn = root.querySelector('[data-change-password-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var popup = root.querySelector('[data-settings-popup="change-password"]');
        var step2 = popup && popup.querySelector('[data-change-password-step="2"]');
        var step3 = popup && popup.querySelector('[data-change-password-step="3"]');
        if (isSettingsMobile() && step3 && step3.classList.contains('is-active')) {
          setChangePasswordStep(root, 2);
          return;
        }
        if (isSettingsMobile() && step2 && step2.classList.contains('is-active')) {
          setChangePasswordStep(root, 1);
          return;
        }
        closePopups(root);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (isSettingsMobile()) {
        var active = form.querySelector('[data-change-password-step].is-active');
        var step = active && active.getAttribute('data-change-password-step');
        if (step === '1' || step === '2') {
          advanceChangePasswordMobile(root);
          return;
        }
      }
      var repeat = form.querySelector('[name="repeatPassword"]');
      var next = form.querySelector('[name="newPassword"]');
      if (repeat && next && repeat.value !== next.value) {
        repeat.focus();
        showToast(root, "Passwords don't match.");
        return;
      }

      var saveBtn = form.querySelector('.tma-dash__settings-submit--password-desktop, [data-change-password-save]');
      if (saveBtn) saveBtn.disabled = true;

      fetch('/auth/user/password', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': prefXsrf(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          current_password: (form.querySelector('[name="currentPassword"]') || {}).value || '',
          password: next ? next.value : '',
          password_confirmation: repeat ? repeat.value : '',
        }),
      }).then(function (res) {
        if (res.ok) {
          closePopups(root);
          showToast(root, 'Password changed');
          root.querySelectorAll('[data-settings-action="change-password"]').forEach(function (row) {
            row.classList.remove('tma-dash__settings-row--highlight');
          });
          form.reset();
          updatePasswordStrength(root, '');
          resetChangePasswordFlow(root);
          return;
        }
        res.json().catch(function () { return null; }).then(function (json) {
          var errors = json && json.errors;
          var message = errors && (errors.current_password || errors.password) ?
            (errors.current_password || errors.password)[0] :
            (json && json.message) || 'Could not change your password.';
          showToast(root, message);
        });
      }).catch(function () {
        showToast(root, 'Could not reach the server. Try again.');
      }).finally(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
    });
  }

  function bindDeleteAccountForm(root) {
    var form = root.querySelector('[data-delete-account-form]');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    var backBtn = root.querySelector('[data-delete-account-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closePopups(root);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('[data-delete-account-email]');
      var profileEmail = root.querySelector('.tma-dash__settings-profile-email');
      var expected = profileEmail ? profileEmail.textContent.trim().toLowerCase() : CURRENT_EMAIL.toLowerCase();
      var entered = input && input.value.trim().toLowerCase();
      if (!entered || entered !== expected) {
        if (input) input.focus();
        return;
      }
      closePopups(root);
      showToast(root, 'Your account has been deleted.');
      form.reset();
    });
  }

  function bindChangeNameForm(root) {
    var form = root.querySelector('[data-change-name-form]');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var first = form.querySelector('[name="firstName"]');
      var last = form.querySelector('[name="lastName"]');
      var display = [first && first.value.trim(), last && last.value.trim()].filter(Boolean).join(' ') || 'ByeWind';
      closePopups(root);
      showToast(root, 'Name changed.');
      root.querySelectorAll('.tma-dash__settings-profile-name').forEach(function (el) {
        el.textContent = display;
      });
      root.querySelectorAll('[data-settings-action="change-name"] .tma-dash__settings-row-value > span').forEach(function (el) {
        el.textContent = display;
      });
    });

    var nextBtn = root.querySelector('[data-change-name-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setChangeNameStep(root, 2);
      });
    }

    var backBtn = root.querySelector('[data-change-name-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var step2 = root.querySelector('[data-change-name-step="2"]');
        if (isSettingsMobile() && step2 && step2.classList.contains('is-active')) {
          setChangeNameStep(root, 1);
          return;
        }
        closePopups(root);
      });
    }
  }

  function bindLogoutAllPopup(root) {
    root.querySelectorAll('[data-logout-all-ok]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closePopups(root);
      });
    });
  }

  function bind(root) {
    if (root.dataset.settingsBound) return;
    root.dataset.settingsBound = '1';

    root.querySelectorAll('[data-settings-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activateNav(root, btn.getAttribute('data-settings-nav'));
        if (btn.getAttribute('data-settings-nav') === 'account-security' && window.TMAAccountSecurity) {
          var mountEl = root.querySelector('[data-account-security-mount]');
          if (mountEl) window.TMAAccountSecurity.mount(mountEl);
        }
      });
    });

    var menuBack = root.querySelector('[data-settings-menu-back]');
    if (menuBack && !menuBack.dataset.bound) {
      menuBack.dataset.bound = '1';
      menuBack.addEventListener('click', function (e) {
        e.preventDefault();
        if (root.classList.contains('is-settings-mobile-select-open')) {
          closeMobileSelect(root);
          return;
        }
        if (root.classList.contains('is-settings-payment-payout-open')) {
          closePaymentPayout(root);
          return;
        }
        showSettingsMenu(root);
      });
    }

    var mobileMore = root.querySelector('[data-settings-mobile-more]');
    if (mobileMore && !mobileMore.dataset.bound) {
      mobileMore.dataset.bound = '1';
      mobileMore.addEventListener('click', function (e) {
        e.preventDefault();
        showToast(root, 'Plugin options');
      });
    }

    if (MOBILE_SETTINGS_MQ && !root.dataset.settingsMqBound) {
      root.dataset.settingsMqBound = '1';
      var onSettingsMqChange = function () {
        syncSettingsLayout(root, getActiveNavId(root));
        var paymentPopup = root.querySelector('[data-settings-popup="add-payment-method"]:not([hidden])');
        if (paymentPopup) syncPaymentPickLayout(root);
      };
      if (typeof MOBILE_SETTINGS_MQ.addEventListener === 'function') {
        MOBILE_SETTINGS_MQ.addEventListener('change', onSettingsMqChange);
      } else if (typeof MOBILE_SETTINGS_MQ.addListener === 'function') {
        MOBILE_SETTINGS_MQ.addListener(onSettingsMqChange);
      }
    }

    root.querySelectorAll('[data-settings-action="change-email"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openChangeEmailPopup(root);
      });
    });

    root.querySelectorAll('[data-settings-action="change-name"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openChangeNamePopup(root);
      });
    });

    root.querySelectorAll('[data-settings-action="change-password"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openPopup(root, 'change-password');
      });
    });

    root.querySelectorAll('[data-settings-action="logout-all"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openLogoutAllPopup(root);
      });
    });

    root.querySelectorAll('[data-settings-action="delete-account"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openDeleteAccountPopup(root);
      });
    });

    root.querySelectorAll('[data-settings-action="two-step"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openTwoStepPopup(root);
      });
    });

    root.querySelectorAll('[data-settings-popup-close]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closePopups(root);
      });
    });

    bindChangeEmailForms(root);
    bindChangePasswordForm(root);
    bindLogoutAllPopup(root);
    bindDeleteAccountForm(root);
    bindTwoStepPopup(root);
    bindPasswordToggles(root);
    bindThemePanel(root);
    bindMobileSelectOverlays(root);
    bindTimePanel(root);
    bindNotificationsPanel(root);
    bindPrivacyPanel(root);
    bindPaymentPanel(root);
    bindAddPaymentMethodPopup(root);
    bindPluginsPanel(root);
    bindChangeNameForm(root);

    bindOtp(root);
    bindResend(root);
    bindMobileFlowSheetDrag(root);
  }

  function mount(root, opts) {
    if (!root) return;
    // Pull the account's saved Time-and-language prefs into localStorage (once
    // per page load), so the panels reflect what's stored on the account.
    applyLanguage();
    if (!prefsHydrated) { prefsHydrated = true; hydratePrefs(root); }
    var initialNav = (opts && (opts.activeNav || opts.settingsNav)) || 'profile';
    var openDetailOnMobile = !!(opts && (opts.activeNav || opts.settingsNav || opts.paymentAdded || opts.openChangeEmail));
    root.innerHTML = render(initialNav);
    delete root.dataset.settingsBound;
    bind(root);
    activateNav(root, initialNav);
    if (isSettingsMobile()) {
      setMobileView(root, openDetailOnMobile ? 'detail' : 'menu', initialNav);
    } else {
      syncSettingsLayout(root, initialNav);
    }
    if (opts && opts.openChangeEmail) openChangeEmailPopup(root);
    if (opts && opts.paymentAdded) {
      activateNav(root, 'payment');
      syncPaymentPanelUI(root);
      showToast(root, 'Payment method added');
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', '/settings?nav=payment');
      }
    }
  }

  window.TMASettings = {
    mount: mount,
    openChangeEmail: openChangeEmailPopup,
    openChangeName: openChangeNamePopup,
    openChangePassword: function (root) { openPopup(root, 'change-password'); },
    openLogoutAll: openLogoutAllPopup,
    openDeleteAccount: openDeleteAccountPopup,
    openTwoStep: openTwoStepPopup,
    closePopups: closePopups,
    closeChangeEmail: closeChangeEmailPopup,
  };
})();
