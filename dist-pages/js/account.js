/*
 * TMA — Account (32546:96114 Overview, 32546:96111 Settings, 32546:96108 Security, 32546:96113 Billing, 32546:96107 Statements, 32546:96110 Referrals, 32546:96112 API Keys, 32546:96109 Logs)
 * Global: window.TMAAccount
 */
(function () {
  'use strict';

  var ICON = '/TMA-PORTAL/images/icons/phosphor/';
  var TMA = '/TMA-PORTAL/images/icons/tma/';
  var AVATAR = '/TMA-PORTAL/images/avatars/';
  var ILLUSTRATIONS = '/TMA-PORTAL/images/illustrations/';

  var TABS = ['Overview', 'Settings', 'Security', 'Billing', 'Statements', 'Referrals', 'API Keys', 'Logs'];

  var HIDDEN_TABS = {
    Billing: true,
    Statements: true,
    Referrals: true,
    'API Keys': true,
  };

  function isTabVisible(tab) {
    return !HIDDEN_TABS[tab];
  }

  var NAV_TAB = {
    'ac-overview': 'Overview',
    'ac-settings': 'Settings',
    'ac-security': 'Security',
    'ac-billing': 'Billing',
    'ac-statements': 'Statements',
    'ac-referrals': 'Referrals',
    'ac-api-keys': 'API Keys',
    'ac-logs': 'Logs',
  };

  var PROFILE_DETAILS = [
    { label: 'Company', value: 'Advisory Portal' },
    { label: 'Contact Phone', value: '+852 19850622', icon: 'Info', pill: { label: 'Verified', color: 'green' } },
    { label: 'Company Site', value: 'portal.tma.com' },
    { label: 'Country', value: 'United States', icon: 'Info' },
    { label: 'Communication', value: 'Email, Phone' },
    { label: 'Allow Changes', value: 'Yes' },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderPill(label, color) {
    return '<span class="tma-dash__pill tma-dash__pill--' + esc(color) + '">' + esc(label) + '</span>';
  }

  function renderTabs(activeTab) {
    var current = activeTab || 'Overview';
    var items = TABS.filter(isTabVisible).map(function (label) {
      var active = label === current && isTabVisible(current);
      return '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" data-account-tab="' + esc(label) + '">' +
        '<span class="tma-tab__label">' + esc(label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
    return '<div class="tma-dash__overview-toolbar tma-dash__account-toolbar" data-node-id="32546:96114">' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-tabs tma-dash__account-tabs" role="tablist">' + items + '</div>' +
      '<div class="tma-dash__overview-actions">' +
      '<button type="button" class="tma-dash__overview-btn"><span>Follow</span></button>' +
      '<button type="button" class="tma-dash__overview-btn"><span>Hire Me</span></button>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--icon" aria-label="More"><img src="' + TMA + 'ThreeDots-16.svg" alt="" width="16" height="16"></button>' +
      '</div></div>';
  }

  function renderProfileHeader() {
    return '<section class="tma-dash__account-block tma-dash__account-block--profile" data-node-id="32546:46791">' +
      '<div class="tma-dash__account-profile-main">' +
      '<div class="tma-dash__account-profile-head">' +
      '<h2 class="tma-dash__account-name">ByeWind</h2>' +
      '<div class="tma-dash__account-meta">' +
      '<span class="tma-dash__account-meta-item"><img src="' + ICON + 'UserCircle.svg" alt="" width="16" height="16">Developer</span>' +
      '<span class="tma-dash__account-meta-item"><img src="' + ICON + 'MapPin.svg" alt="" width="16" height="16">SF, Bay Area</span>' +
      '<span class="tma-dash__account-meta-item"><img src="' + ICON + 'EnvelopeSimple.svg" alt="" width="16" height="16">byewind@twitter.com</span>' +
      '</div></div>' +
      '<div class="tma-dash__account-stats">' +
      '<div class="tma-dash__account-stat tma-dash__account-stat--completion">' +
      '<span class="tma-dash__account-stat-label">Profile Completion</span>' +
      '<div class="tma-dash__account-strip" aria-label="Profile completion 51 percent">' +
      '<div class="tma-dash__account-strip-fill" style="width:51%"></div>' +
      '<span class="tma-dash__account-strip-text"><strong>51</strong>%</span>' +
      '</div></div>' +
      '<div class="tma-dash__account-stat-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__account-stat"><span class="tma-dash__account-stat-label">Earnings</span><p class="tma-dash__account-stat-value">$4,500</p></div>' +
      '<div class="tma-dash__account-stat-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__account-stat"><span class="tma-dash__account-stat-label">Projects</span><p class="tma-dash__account-stat-value">75</p></div>' +
      '<div class="tma-dash__account-stat-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__account-stat"><span class="tma-dash__account-stat-label">Success Rate</span><p class="tma-dash__account-stat-value">60%</p></div>' +
      '</div></div>' +
      '<img class="tma-dash__account-avatar" src="' + AVATAR + 'AvatarByewind.png" alt="ByeWind" width="40" height="40">' +
      '</section>';
  }

  function renderDetailRow(row) {
    var labelHtml = esc(row.label);
    if (row.icon) {
      labelHtml = '<span class="tma-dash__account-detail-label-wrap"><span>' + esc(row.label) + '</span>' +
        '<img src="' + ICON + row.icon + '.svg" alt="" width="16" height="16"></span>';
    }
    var valueHtml = esc(row.value);
    if (row.pill) {
      valueHtml = '<span class="tma-dash__account-detail-value-wrap"><span>' + esc(row.value) + '</span>' +
        renderPill(row.pill.label, row.pill.color) + '</span>';
    }
    return '<div class="tma-dash__account-detail-row">' +
      '<div class="tma-dash__account-detail-label">' + labelHtml + '</div>' +
      '<div class="tma-dash__account-detail-value">' + valueHtml + '</div></div>';
  }

  function renderProfileDetails() {
    var rows = PROFILE_DETAILS.map(renderDetailRow).join('');
    return '<section class="tma-dash__account-block tma-dash__account-block--details" data-node-id="32546:46802">' +
      '<div class="tma-dash__account-block-head">' +
      '<h3 class="tma-dash__account-block-title">Profile Details</h3>' +
      '<button type="button" class="tma-dash__account-block-link">Edit Profile</button></div>' +
      '<div class="tma-dash__account-details">' + rows + '</div></section>';
  }

  function renderPromo() {
    return '<section class="tma-dash__account-block tma-dash__account-block--promo" data-node-id="32546:46816">' +
      '<div class="tma-dash__account-promo-copy">' +
      '<p class="tma-dash__account-promo-title">Have you tried<br>new Mobile Application?</p>' +
      '<div class="tma-dash__account-promo-actions">' +
      '<button type="button" class="tma-dash__account-promo-link">Learn more</button>' +
      '<button type="button" class="tma-dash__account-promo-btn">Try Now</button>' +
      '</div></div>' +
      '<img class="tma-dash__account-promo-art" src="' + ILLUSTRATIONS + 'Illustration18.svg" alt="" width="100" height="75" decoding="async">' +
      '</section>';
  }

  function settingsField(type, opts) {
    if (!window.TMAInput) return '';
    if (type === 'value' && window.TMAInput.renderFormTitleValue) {
      return window.TMAInput.renderFormTitleValue(Object.assign({ glass: true }, opts));
    }
    if (type === 'placeholder' && window.TMAInput.renderFormPlaceholder1Row) {
      return window.TMAInput.renderFormPlaceholder1Row(opts);
    }
    if (type === 'tags' && window.TMAInput.renderFormTagInput) {
      return window.TMAInput.renderFormTagInput(opts);
    }
    if (type === 'select' && window.TMAInput.renderFormSelectValue) {
      return window.TMAInput.renderFormSelectValue(Object.assign({ glass: true }, opts));
    }
    if (type === 'switch' && window.TMAInput.renderFormSwitchField) {
      return window.TMAInput.renderFormSwitchField(Object.assign({ glass: true }, opts));
    }
    return '';
  }

  function renderSettingsCheck(checked) {
    if (window.TMAInput && typeof window.TMAInput.renderCheckbox === 'function') {
      return window.TMAInput.renderCheckbox({ checked: checked ? 'checked' : 'unchecked' });
    }
    return '<input type="checkbox" class="tma-dash__check"' + (checked ? ' checked' : '') + '>';
  }

  function renderSettingsSwitch(on) {
    if (window.TMAInput && typeof window.TMAInput.renderSwitch === 'function') {
      return window.TMAInput.renderSwitch({ on: !!on });
    }
    return '<input type="checkbox" class="tma-dash__check"' + (on ? ' checked' : '') + '>';
  }

  function renderSettingsActions() {
    return '<div class="tma-dash__account-settings-actions">' +
      '<button type="button" class="tma-dash__account-settings-btn">Cancel</button>' +
      '<button type="button" class="tma-dash__account-settings-btn tma-dash__account-settings-btn--primary">Save Changes</button>' +
      '</div>';
  }

  function renderSettingsSectionHead(title, actionsHtml) {
    return '<div class="tma-dash__account-settings-head">' +
      '<h3 class="tma-dash__account-block-title">' + esc(title) + '</h3>' +
      (actionsHtml || '') +
      '</div>';
  }

  function renderSettingsPref(title, desc, checked, bordered) {
    return '<div class="tma-dash__account-settings-pref' + (bordered ? ' tma-dash__account-settings-pref--border' : '') + '">' +
      '<div class="tma-dash__account-settings-pref-check">' + renderSettingsCheck(checked) + '</div>' +
      '<div class="tma-dash__account-settings-pref-copy">' +
        '<p class="tma-dash__account-settings-pref-title">' + esc(title) + '</p>' +
        (desc ? '<p class="tma-dash__account-settings-pref-desc">' + esc(desc) + '</p>' : '') +
      '</div></div>';
  }

  function renderSettingsNotifyRow(label, emailOn, phoneOn, bordered) {
    return '<div class="tma-dash__account-settings-notify-row' + (bordered ? ' tma-dash__account-settings-notify-row--border' : '') + '">' +
      '<span class="tma-dash__account-settings-notify-label">' + esc(label) + '</span>' +
      '<div class="tma-dash__account-settings-notify-checks">' +
        '<label class="tma-dash__account-settings-notify-check">' + renderSettingsCheck(emailOn) + '<span>Email</span></label>' +
        '<label class="tma-dash__account-settings-notify-check">' + renderSettingsCheck(phoneOn) + '<span>Phone</span></label>' +
      '</div></div>';
  }

  function renderSettingsConnectRow(name, desc, iconSrc, on, bordered) {
    return '<div class="tma-dash__account-settings-connect-row' + (bordered ? ' tma-dash__account-settings-connect-row--border' : '') + '">' +
      '<div class="tma-dash__account-settings-connect-main">' +
        '<img class="tma-dash__account-settings-connect-icon" src="' + iconSrc + '" alt="" width="32" height="32">' +
        '<div class="tma-dash__account-settings-connect-copy">' +
          '<p class="tma-dash__account-settings-connect-title">' + esc(name) + '</p>' +
          '<p class="tma-dash__account-settings-connect-desc">' + esc(desc) + '</p>' +
        '</div></div>' +
      '<div class="tma-dash__account-settings-connect-switch">' + renderSettingsSwitch(on) + '</div>' +
      '</div>';
  }

  function renderSettingsProfileBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46603">' +
      renderSettingsSectionHead('Profile Details') +
      '<div class="tma-dash__account-settings-grid">' +
        settingsField('value', { nodeId: '32546:46605', title: 'First Name', value: 'ByeWind' }) +
        settingsField('placeholder', { nodeId: '32546:46606', placeholder: 'Last Name' }) +
        settingsField('value', { nodeId: '32546:46607', title: 'Contact Phone', value: '+852 19850622' }) +
        settingsField('tags', { nodeId: '32546:46608', title: 'Skill', tags: ['UX/UI', 'Product design'] }) +
        settingsField('value', { nodeId: '32546:46609', title: 'Company', value: 'Advisory Portal' }) +
        settingsField('value', { nodeId: '32546:46610', title: 'Company Site', value: 'portal.tma.com' }) +
        settingsField('select', {
          nodeId: '32546:46611',
          title: 'Country',
          value: 'United States',
          options: [
            { value: 'United States', label: 'United States', selected: true },
            { value: 'United Kingdom', label: 'United Kingdom' },
            { value: 'Canada', label: 'Canada' },
          ],
        }) +
        settingsField('select', {
          nodeId: '32546:46612',
          title: 'Language',
          value: 'English',
          options: [
            { value: 'English', label: 'English', selected: true },
            { value: 'Spanish', label: 'Spanish' },
            { value: 'French', label: 'French' },
          ],
        }) +
        '<div class="tma-dash__account-settings-grid-span">' +
          settingsField('switch', { nodeId: '32546:46613', title: 'Status', text: 'Active', on: true }) +
        '</div>' +
      '</div></section>';
  }

  function renderSettingsSignInBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46614">' +
      renderSettingsSectionHead('Sign-in Method') +
      '<div class="tma-dash__account-settings-grid">' +
        settingsField('value', { nodeId: '32546:46616', title: 'Email Address', value: 'byewind@twitter.com' }) +
        settingsField('value', { nodeId: '32546:46617', title: 'Password', value: '*******************', type: 'password' }) +
        '<div class="tma-dash__account-settings-grid-span">' +
          '<div class="tma-dash__account-settings-callout">' +
            '<img src="' + ICON + 'ShieldCheck.svg" alt="" width="20" height="20">' +
            '<div class="tma-dash__account-settings-callout-copy">' +
              '<p class="tma-dash__account-settings-callout-title">Secure Your Account</p>' +
              '<p class="tma-dash__account-settings-callout-desc">Two-factor authentication adds an extra layer of security to your account. To log in, in addition you\'ll need to provide a 6 digit code.</p>' +
            '</div>' +
            '<button type="button" class="tma-dash__account-settings-callout-btn">Enable</button>' +
          '</div>' +
        '</div>' +
      '</div></section>';
  }

  function renderSettingsConnectedBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46619">' +
      renderSettingsSectionHead('Connected Accounts') +
      '<div class="tma-dash__account-settings-callout tma-dash__account-settings-callout--compact">' +
        '<img src="' + ICON + 'ShieldCheck.svg" alt="" width="20" height="20">' +
        '<p class="tma-dash__account-settings-callout-desc">Two-factor authentication adds an extra layer of security to your account. To log in, in you\'ll need to provide a 4 digit amazing code. <a href="#">Learn More</a></p>' +
      '</div>' +
      renderSettingsConnectRow(
        'Advisory Portal',
        'An advanced Dashboard / SaaS UI kit and design system for Figma.',
        '/TMA-PORTAL/images/brand/tma/tma-logo-mark.png',
        true,
        true
      ) +
      renderSettingsConnectRow(
        'Figma',
        'the collaborative interface design tool.',
        '/TMA-PORTAL/images/icons/brands/Figma40.svg',
        true,
        true
      ) +
      renderSettingsConnectRow(
        'Twitter',
        'From breaking news and entertainment to sports and politics, get the full story with all the live commentary.',
        '/TMA-PORTAL/images/icons/tma/TwitterSocial.svg',
        false,
        false
      ) +
      renderSettingsConnectRow(
        'Instagram',
        'A simple, fun & creative way to capture, edit & share photos, videos & messages with friends & family.',
        '/TMA-PORTAL/images/icons/tma/InstagramSocial.svg',
        false,
        false
      ) +
      '</section>';
  }

  function renderSettingsEmailPrefsBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46626">' +
      renderSettingsSectionHead('Email Preferences', renderSettingsActions()) +
      renderSettingsPref(
        'Webhook API Endpoints',
        'Receive notifications for consistently failing webhook API endpoints.',
        false,
        false
      ) +
      '</section>';
  }

  function renderSettingsNotificationsBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46634">' +
      renderSettingsSectionHead('Notifications', renderSettingsActions()) +
      renderSettingsNotifyRow('Notifications', true, true, true) +
      renderSettingsNotifyRow('New Team Members', true, true, true) +
      renderSettingsNotifyRow('Completed Projects', false, true, true) +
      renderSettingsNotifyRow('Newsletters', true, false, false) +
      '</section>';
  }

  function renderSettingsDeactivateBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--settings" data-node-id="32546:46641">' +
      '<div class="tma-dash__account-settings-head">' +
        '<h3 class="tma-dash__account-block-title">Deactivate account</h3>' +
        '<button type="button" class="tma-dash__account-settings-btn tma-dash__account-settings-btn--danger">Deactivate Account</button>' +
      '</div>' +
      '<div class="tma-dash__account-settings-deactivate-warn">' +
        '<img src="' + ICON + 'WarningCircle.svg" alt="" width="20" height="20">' +
        '<div class="tma-dash__account-settings-deactivate-copy">' +
          '<p class="tma-dash__account-settings-deactivate-title">You Are Deactivating Your Account</p>' +
          '<p class="tma-dash__account-settings-deactivate-desc">For extra security, this requires you to confirm your email or phone number when you reset your password. <a href="#">Learn more</a></p>' +
        '</div></div>' +
      '<label class="tma-dash__account-settings-deactivate-confirm">' +
        renderSettingsCheck(false) +
        '<span>I confirm my account deactivation</span>' +
      '</label>' +
      '</section>';
  }

  var SECURITY_STATUS_COLORS = {
    purple: '#03a5e9',
    green: '#71dd8c',
    blue: '#7dbbff',
    orange: '#ffb55b',
    muted: 'rgba(0, 0, 0, 0.4)',
  };

  var SECURITY_STATUS_VARIANT = {
    success: 'green',
    failure: 'muted',
    'in-progress': 'purple',
    complete: 'green',
    pending: 'blue',
    approved: 'orange',
    rejected: 'muted',
  };

  var SIGN_IN_SESSIONS = [
    { location: 'USA(5)', device: 'Chrome - Windows', ipAddress: '236.125.56.78', time: '2 minutes ago', status: 'success', statusLabel: 'Success' },
    { location: 'United Kingdom(10)', device: 'Safari - Mac OS', ipAddress: '236.125.56.69', time: '10 minutes ago', status: 'success', statusLabel: 'Success' },
    { location: 'Norway(-)', device: 'Firefox - Windows', ipAddress: '236.125.56.10', time: '20 minutes ago', status: 'success', statusLabel: 'Success' },
    { location: 'Japan(112)', device: 'iOS - iPhone Pro', ipAddress: '236.125.56.54', time: '30 minutes ago', status: 'failure', statusLabel: 'Failure' },
    { location: 'Italy(5)', device: 'Samsung Noted 5- Android', ipAddress: '236.100.56.50', time: '40 minutes ago', status: 'failure', statusLabel: 'Failure' },
  ];

  var LICENSE_USAGE = [
    { operator: 'DSI: Workstation 2', ipAddress: '236.125.56.78', time: '2 minutes ago', apiKey: 'ffft456765gjkkjhi8306767', copy: false, status: 'in-progress', statusLabel: 'In Progress' },
    { operator: 'ReXe: Workstation 29', ipAddress: '236.125.56.69', time: '10 minutes ago', apiKey: 'ertt456765gjkkjhi8303434', copy: false, status: 'complete', statusLabel: 'Complete' },
    { operator: 'RamenLC: Workstation 2', ipAddress: '236.125.56.10', time: '20 minutes ago', apiKey: 'dctt456765gjkkjhi83093985', copy: true, status: 'pending', statusLabel: 'Pending' },
    { operator: 'Nest Five: Workstation 86', ipAddress: '236.125.56.54', time: '30 minutes ago', apiKey: 'uytt456765gjkkjhi4312673', copy: false, status: 'approved', statusLabel: 'Approved' },
    { operator: 'DSI: Workstation 2', ipAddress: '236.100.56.50', time: '40 minutes ago', apiKey: 'ygd456765gjkkjhi83095427', copy: false, status: 'rejected', statusLabel: 'Rejected' },
  ];

  var SECURITY_CHART_BARS = [
    { value: 14000, primary: 46.9, secondary: 50 },
    { value: 26000, primary: 81.9, secondary: 87.5 },
    { value: 18000, primary: 58.8, secondary: 62.5 },
    { value: 30000, primary: 93.8, secondary: 100 },
    { value: 11000, primary: 35.6, secondary: 37.5 },
    { value: 22000, primary: 70.6, secondary: 75 },
  ];

  function renderSecurityStatusBadge(label, status) {
    var colorKey = SECURITY_STATUS_VARIANT[status] || 'muted';
    var color = SECURITY_STATUS_COLORS[colorKey];
    return '<span class="tma-status-badge tma-status-badge--dot tma-status-badge--' + esc(colorKey) + '" style="--status-badge-color:' + color + '">' +
      '<span class="tma-status-badge__dot" aria-hidden="true"></span>' +
      '<span class="tma-status-badge__label">' + esc(label) + '</span></span>';
  }

  function renderSecurityMiniTabs(tabs, groupName) {
    return tabs.map(function (tab) {
      return '<button type="button" class="tma-dash__account-security-mini-tab' + (tab.active ? ' is-active' : '') + '" data-security-tab-group="' + esc(groupName) + '" data-security-tab="' + esc(tab.id) + '">' + esc(tab.label) + '</button>';
    }).join('');
  }

  function renderSecurityInfoCard(title, body, date, actionLabel) {
    return '<section class="tma-dash__account-block tma-dash__account-block--security-info">' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title">' + esc(title) + '</h3>' +
        '<button type="button" class="tma-dash__account-security-menu" aria-label="More"><img src="' + TMA + 'ThreeDots-16.svg" alt="" width="16" height="16"></button>' +
      '</div>' +
      '<p class="tma-dash__account-security-info-body">' + esc(body) + '</p>' +
      '<div class="tma-dash__account-security-info-foot">' +
        '<span class="tma-dash__account-security-info-date">' + esc(date) + '</span>' +
        '<button type="button" class="tma-dash__overview-btn"><span>' + esc(actionLabel) + '</span></button>' +
      '</div>' +
      '</section>';
  }

  function renderSecuritySignInChartBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--signin-chart" data-node-id="32546:96108">' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title">Sign in times</h3>' +
        '<div class="tma-dash__account-security-mini-tabs" role="tablist" aria-label="Sign in period">' +
          renderSecurityMiniTabs([
            { id: '12h', label: '12 Hours', active: true },
            { id: 'day', label: 'Day', active: false },
            { id: 'week', label: 'Week', active: false },
          ], 'period') +
        '</div>' +
      '</div>' +
      '<div class="tma-dash__account-security-stats">' +
        '<div class="tma-dash__account-security-stat"><span class="tma-dash__account-security-stat-label">User</span><strong class="tma-dash__account-security-stat-value">36,899</strong></div>' +
        '<span class="tma-dash__account-security-stat-sep" aria-hidden="true"></span>' +
        '<div class="tma-dash__account-security-stat"><span class="tma-dash__account-security-stat-label">Admin</span><strong class="tma-dash__account-security-stat-value">75</strong></div>' +
        '<span class="tma-dash__account-security-stat-sep" aria-hidden="true"></span>' +
        '<div class="tma-dash__account-security-stat"><span class="tma-dash__account-security-stat-label">Failed</span><strong class="tma-dash__account-security-stat-value">291</strong></div>' +
      '</div>' +
      '<div class="tma-dash__account-security-mini-tabs tma-dash__account-security-mini-tabs--chart" role="tablist" aria-label="Chart type">' +
        renderSecurityMiniTabs([
          { id: 'agents', label: 'Agents Chart', active: true },
          { id: 'clients', label: 'Clients Chart', active: false },
        ], 'chart') +
      '</div>' +
      '<div class="tma-dash__account-security-chart-wrap">' +
        '<div class="tma-dash__account-security-chart-y" aria-hidden="true"><span>30K</span><span>20K</span><span>10K</span><span>0</span></div>' +
        '<div class="tma-dash__account-security-chart-main">' +
          '<div class="tma-chart-vertical-07 tma-dash__account-security-chart" data-account-security-chart role="group" aria-label="Sign in bar chart"></div>' +
          '<div class="tma-dash__account-security-chart-x" aria-hidden="true">' +
            ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map(function (m) { return '<span>' + m + '</span>'; }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '</section>';
  }

  function renderSecurityTableCell(column, row) {
    if (column.type === 'time') {
      return '<span class="tma-table-b-sessions__time"><img src="' + ICON + 'Clock.svg" alt="" class="tma-table-b-sessions__time-icon" width="16" height="16"><span>' + esc(row.time) + '</span></span>';
    }
    if (column.type === 'date') {
      return '<span class="tma-table-b-sessions__time"><img src="' + ICON + 'CalendarBlank.svg" alt="" class="tma-table-b-sessions__time-icon" width="16" height="16"><span>' + esc(row.date) + '</span></span>';
    }
    if (column.type === 'status') {
      return renderSecurityStatusBadge(row.statusLabel, row.status);
    }
    if (column.type === 'apiKey') {
      var copyBtn = row.copy
        ? '<button type="button" class="tma-dash__account-security-copy" aria-label="Copy API key"><img src="' + TMA + 'Clipboard-16.svg" alt="" width="16" height="16"></button>'
        : '';
      return '<span class="tma-dash__account-security-api-key">' + esc(row.apiKey) + copyBtn + '</span>';
    }
    return esc(row[column.key] || '');
  }

  function renderSecurityDataTable(title, tableId, columns, rows, columnsCss, opts) {
    opts = opts || {};
    var showFilter = opts.filter !== false;
    function cellClass(column) {
      var cls = 'tma-table-b-sessions__cell';
      if (column.padding === 'location') cls += ' tma-table-b-sessions__cell--location';
      if (column.padding === 'status') cls += ' tma-table-b-sessions__cell--status';
      return cls;
    }

    var head = columns.map(function (col) {
      return '<div class="' + cellClass(col) + '" role="columnheader">' + esc(col.label) + '</div>';
    }).join('');

    var body = rows.map(function (row) {
      var cells = columns.map(function (col) {
        return '<div class="' + cellClass(col) + '" role="cell" data-label="' + esc(col.label) + '">' + renderSecurityTableCell(col, row) + '</div>';
      }).join('');
      return '<div class="tma-table-b-sessions__row" role="row">' + cells + '</div>';
    }).join('');

    var filterPopover = '<div class="tma-table-b__popover" data-table-b-popover="filter" role="listbox" aria-hidden="true" hidden>' +
      '<button type="button" class="tma-table-b__popover-item" role="option" data-popover-value="1h" data-selected>1 hour</button>' +
      '<button type="button" class="tma-table-b__popover-item" role="option" data-popover-value="3h">3 hours</button>' +
      '<button type="button" class="tma-table-b__popover-item" role="option" data-popover-value="1d">1 day</button>' +
      '<button type="button" class="tma-table-b__popover-item" role="option" data-popover-value="1w">1 week</button>' +
      '</div>';

    var variant = showFilter ? 'filter' : 'plain';
    var filterClass = showFilter ? ' tma-table-b-sessions--filter' : '';
    var headerHtml = showFilter
      ? '<div class="tma-table-b-sessions__header">' +
          '<h3 class="tma-table-b-sessions__title">' + esc(title) + '</h3>' +
          '<button type="button" class="tma-table-b-sessions__header-control tma-table-b-sessions__header-control--filter" data-sessions-filter aria-haspopup="listbox" aria-expanded="false">' +
            '<span data-sessions-filter-label>1 hour</span>' +
            '<img src="' + TMA + 'ArrowLineDown-16.svg" alt="" class="tma-table-b-sessions__header-control-icon" width="16" height="16">' +
          '</button>' +
        '</div>'
      : '';

    return '<div class="tma-table-b-sessions' + filterClass + ' tma-dash__account-security-table" data-table-b-sessions data-variant="' + variant + '" data-account-security-table="' + esc(tableId) + '" style="--table-b-sessions-columns:' + columnsCss + ';">' +
      headerHtml +
      '<div class="tma-table-b-sessions__sheet" role="table" aria-label="' + esc(title) + '">' +
        '<div class="tma-table-b-sessions__row tma-table-b-sessions__row--head" role="row">' + head + '</div>' +
        body +
      '</div>' +
      (showFilter ? filterPopover : '') +
      '</div>';
  }

  function renderSecuritySessionsTable() {
    var columns = [
      { key: 'location', type: 'text', label: 'Location', padding: 'location' },
      { key: 'device', type: 'text', label: 'Device' },
      { key: 'ipAddress', type: 'text', label: 'IP Address' },
      { key: 'time', type: 'time', label: 'Time' },
      { key: 'status', type: 'status', label: 'Status', padding: 'status' },
    ];
    return renderSecurityDataTable('Sign in Sessions', 'sessions', columns, SIGN_IN_SESSIONS, '174px 1fr 158px 165px 120px');
  }

  function renderSecurityLicenseTable() {
    var columns = [
      { key: 'operator', type: 'text', label: 'Operator', padding: 'location' },
      { key: 'ipAddress', type: 'text', label: 'IP Address' },
      { key: 'time', type: 'time', label: 'Time' },
      { key: 'apiKey', type: 'apiKey', label: 'API Keys' },
      { key: 'status', type: 'status', label: 'Status', padding: 'status' },
    ];
    return renderSecurityDataTable('License Usage', 'license', columns, LICENSE_USAGE, '174px 158px 165px 1fr 120px');
  }

  function renderSecurityPanel(activeTab) {
    var hidden = activeTab !== 'Security' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--security"' + hidden + ' data-account-panel="Security" data-node-id="32546:96108">' +
      '<div class="tma-dash__account-security-top">' +
        renderSecuritySignInChartBlock() +
        '<div class="tma-dash__account-security-side">' +
          renderSecurityInfoCard(
            'Recent Alerts',
            'In the last year, you\u2019ve probably had to adapt to new ways of living and working.',
            'Jun 11, 2026',
            'Learn More'
          ) +
          renderSecurityInfoCard(
            'Security Guidelines',
            'As we approach one year of working remotely, we wanted to take a look back and share some ways teams around the world have collaborated effectively.',
            'Jun 10, 2026',
            'Explore'
          ) +
        '</div>' +
      '</div>' +
      renderSecuritySessionsTable() +
      renderSecurityLicenseTable() +
      '</div>';
  }

  function mountSecurityChart(root) {
    if (!root || root.dataset.accountSecurityChartMounted) return;
    root.dataset.accountSecurityChartMounted = '1';

    var barsEl = document.createElement('div');
    barsEl.className = 'tma-chart-vertical-07__bars';

    SECURITY_CHART_BARS.forEach(function (bar, index) {
      var el = document.createElement('div');
      el.className = 'tma-chart-vertical-07__bar';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Bar ' + (index + 1) + ': ' + bar.value.toLocaleString());

      var tooltip = document.createElement('span');
      tooltip.className = 'tma-chart-vertical-07__tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.textContent = bar.value.toLocaleString();

      var pins = document.createElement('div');
      pins.className = 'tma-chart-vertical-07__pins';
      pins.setAttribute('aria-hidden', 'true');

      var primary = document.createElement('div');
      primary.className = 'tma-chart-vertical-07__pin tma-chart-vertical-07__pin--primary';
      primary.style.height = bar.primary + '%';

      var secondary = document.createElement('div');
      secondary.className = 'tma-chart-vertical-07__pin tma-chart-vertical-07__pin--secondary';
      secondary.style.height = bar.secondary + '%';

      pins.appendChild(primary);
      pins.appendChild(secondary);
      el.appendChild(tooltip);
      el.appendChild(pins);
      barsEl.appendChild(el);
    });

    root.appendChild(barsEl);

    if (window.PortalChartMotion && typeof window.PortalChartMotion.initChart === 'function') {
      window.PortalChartMotion.initChart(root);
    }
  }

  function bindSecurityPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--security');
    if (!panel || panel.dataset.accountSecurityBound) return;
    panel.dataset.accountSecurityBound = '1';

    mountSecurityChart(panel.querySelector('[data-account-security-chart]'));

    panel.addEventListener('click', function (e) {
      var miniTab = e.target.closest('[data-security-tab]');
      if (!miniTab || !panel.contains(miniTab)) return;
      var group = miniTab.getAttribute('data-security-tab-group');
      panel.querySelectorAll('[data-security-tab-group="' + group + '"]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn === miniTab);
      });
    });

    if (window.TMATableB && typeof window.TMATableB.init === 'function') {
      window.TMATableB.init();
    }
  }

  function renderAccountFilterTabs(tabs, groupName) {
    return tabs.map(function (tab) {
      return '<button type="button" class="tma-dash__account-filter-tab' + (tab.active ? ' is-active' : '') + '" data-account-filter-group="' + esc(groupName) + '" data-account-filter-tab="' + esc(tab.id) + '">' + esc(tab.label) + '</button>';
    }).join('');
  }

  function sheetCellClass(column) {
    var cls = 'tma-dash__account-sheet-cell';
    if (column.key === 'description' || column.key === 'details' || column.type === 'manager') {
      cls += ' tma-dash__account-sheet-cell--primary';
    }
    if (column.type === 'amount') cls += ' tma-dash__account-sheet-cell--amount';
    if (column.type === 'pdf') cls += ' tma-dash__account-sheet-cell--action';
    return cls;
  }

  function renderAccountSheetCell(column, row) {
    if (column.type === 'manager') {
      return '<span class="tma-dash__account-sheet-manager">' +
        '<img class="tma-dash__account-sheet-avatar" src="' + AVATAR + esc(row.avatar) + '.png" alt="" width="24" height="24">' +
        '<span>' + esc(row.manager) + '</span></span>';
    }
    if (column.type === 'date') {
      return '<span class="tma-table-b-sessions__time"><img src="' + ICON + 'CalendarBlank.svg" alt="" class="tma-table-b-sessions__time-icon" width="16" height="16"><span>' + esc(row.date) + '</span></span>';
    }
    if (column.type === 'pdf') {
      return '<span class="tma-dash__account-sheet-pdf"><img src="' + ICON + 'FilePdf.svg" alt="" width="16" height="16"><span>PDF</span></span>';
    }
    if (column.type === 'amount') {
      var amount = row[column.key] || '';
      var negative = String(amount).indexOf('$-') === 0;
      return '<span class="tma-dash__account-sheet-amount' + (negative ? ' tma-dash__account-sheet-amount--negative' : '') + '">' + esc(amount) + '</span>';
    }
    return esc(row[column.key] || '');
  }

  function renderAccountSheetTable(opts) {
    var columns = opts.columns || [];
    var rows = opts.rows || [];
    var tabsHtml = opts.tabs
      ? '<div class="tma-dash__account-filter-tabs" role="tablist" aria-label="' + esc(opts.tabAriaLabel || 'Filter') + '">' +
          renderAccountFilterTabs(opts.tabs, opts.tabGroup) +
        '</div>'
      : '';

    var head = columns.map(function (col) {
      return '<div class="tma-dash__account-sheet-cell tma-dash__account-sheet-cell--head" role="columnheader">' + esc(col.label) + '</div>';
    }).join('');

    var body = rows.map(function (row, index) {
      var cells = columns.map(function (col) {
        return '<div class="' + sheetCellClass(col) + '" role="cell" data-label="' + esc(col.label) + '">' + renderAccountSheetCell(col, row) + '</div>';
      }).join('');
      var last = index === rows.length - 1 ? ' tma-dash__account-sheet-row--last' : '';
      return '<div class="tma-dash__account-sheet-row' + last + '" role="row">' + cells + '</div>';
    }).join('');

    return '<section class="tma-dash__account-block' + (opts.blockClass ? ' ' + opts.blockClass : '') + '"' + (opts.nodeId ? ' data-node-id="' + esc(opts.nodeId) + '"' : '') + '>' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title' + (opts.titleLarge ? ' tma-dash__account-block-title--lg' : '') + '">' + esc(opts.title) + '</h3>' +
        tabsHtml +
      '</div>' +
      '<div class="tma-dash__account-sheet" role="table" aria-label="' + esc(opts.title) + '" style="--account-sheet-columns:' + esc(opts.gridCols) + '">' +
        '<div class="tma-dash__account-sheet-row tma-dash__account-sheet-row--head" role="row">' + head + '</div>' +
        body +
      '</div></section>';
  }

  function renderCreditCardMarkup(opts) {
    if (window.TMACard && typeof window.TMACard.renderCreditCard === 'function') {
      return window.TMACard.renderCreditCard(opts);
    }
    return '';
  }

  function renderAddressCardMarkup(opts) {
    if (window.TMACard && typeof window.TMACard.renderAddressCard === 'function') {
      return window.TMACard.renderAddressCard(opts);
    }
    return '';
  }

  function renderAddCardMarkup(label) {
    if (window.TMACard && typeof window.TMACard.renderAddAddressCard === 'function') {
      return window.TMACard.renderAddAddressCard({ label: label || 'Add card' });
    }
    return '';
  }

  var BILLING_HISTORY = [
    { date: 'Feb 5, 2026', description: 'Invoice for Ocrober 2026', amount: '$123.79' },
    { date: 'Feb 4, 2026', description: 'Invoice for September 2026', amount: '$98.03' },
    { date: 'Feb 3, 2026', description: 'Paypal', amount: '$35.07' },
    { date: 'Feb 2, 2026', description: 'Invoice for July 2026', amount: '$142.80' },
    { date: 'Feb 1, 2026', description: 'Invoice for June 2026', amount: '$123.79' },
  ];

  function renderBillingUsageStrip() {
    if (window.TMAStrip && typeof window.TMAStrip.renderStrip === 'function') {
      return window.TMAStrip.renderStrip({
        track: true,
        height: 8,
        paddingRight: 240,
        segments: ['indigo', 'black', 'black', 'black', 'black', 'black', 'black'],
      });
    }
    return '<div class="tma-dash__account-strip" aria-label="Users 86 percent"><div class="tma-dash__account-strip-fill" style="width:86%"></div></div>';
  }

  function renderBillingOverviewBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--billing-overview" data-node-id="32546:96113">' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title tma-dash__account-block-title--lg">Overview</h3>' +
        '<div class="tma-dash__account-billing-actions">' +
          '<button type="button" class="tma-dash__overview-btn"><span>Cancel Subscription</span></button>' +
          '<button type="button" class="tma-dash__account-settings-btn tma-dash__account-settings-btn--primary"><span>Upgrade Plan</span></button>' +
        '</div></div>' +
      '<p class="tma-dash__account-billing-metric"><strong>Users</strong> <span>86 of 100 Used</span></p>' +
      renderBillingUsageStrip() +
      '<p class="tma-dash__account-billing-muted tma-dash__account-billing-muted--border">14 Users remaining until your plan requires update</p>' +
      '<div class="tma-dash__account-billing-copy-block">' +
        '<p class="tma-dash__account-billing-copy-title">Active until Dec 9, 2026</p>' +
        '<p class="tma-dash__account-billing-muted">We will send you a notification upon Subscription expiration.</p>' +
      '</div>' +
      '<div class="tma-dash__account-billing-copy-block tma-dash__account-billing-copy-block--plain">' +
        '<p class="tma-dash__account-billing-copy-title">$24.99 Per Month</p>' +
        '<p class="tma-dash__account-billing-muted">Extended Pro Package. Up to 100 Agents &amp; 25 Projects.</p>' +
      '</div>' +
      '<div class="tma-dash__account-billing-alert">' +
        '<img src="' + ICON + 'WarningCircle.svg" alt="" width="20" height="20">' +
        '<div class="tma-dash__account-billing-alert-copy">' +
          '<p class="tma-dash__account-billing-alert-title">We need your attention!</p>' +
          '<p class="tma-dash__account-billing-alert-desc">Your payment was declined. To start using tools, please <button type="button" class="tma-dash__account-billing-alert-link">Add Payment Method</button>.</p>' +
        '</div></div></section>';
  }

  function renderBillingPaymentMethodsBlock() {
    var cards = renderCreditCardMarkup({ cardType: 'visa', edit: true }) +
      renderCreditCardMarkup({
        cardType: 'mastercard',
        edit: false,
        showStatus: false,
        groups: ['1235', '6321', '1343', '7542'],
      }) +
      renderCreditCardMarkup({ cardType: 'paypal', name: 'PayPal', email: 'byewind@twitter.com' }) +
      renderAddCardMarkup('Add card');

    return '<section class="tma-dash__account-block tma-dash__account-block--billing-cards" data-node-id="32546:96113">' +
      '<h3 class="tma-dash__account-block-title">Payment Methods</h3>' +
      '<div class="tma-dash__account-billing-cards tma-dash__account-billing-cards--payment">' + cards + '</div></section>';
  }

  function renderBillingAddressBlock() {
    var cards = renderAddressCardMarkup({
      label: "ByeWind's house",
      active: true,
      edit: true,
      lines: ['One Apple Park Way', 'Cupertino, CA 95014', 'US'],
    }) +
      renderAddressCardMarkup({
        label: 'Company',
        static: true,
        lines: ['Ap #285-7193 Ullamcorper Avenue', 'Amesbury HI 93373', 'US'],
      }) +
      renderAddCardMarkup('Add Address');

    return '<section class="tma-dash__account-block tma-dash__account-block--billing-cards" data-node-id="32546:96113">' +
      '<h3 class="tma-dash__account-block-title">Billing Address</h3>' +
      '<div class="tma-dash__account-billing-cards tma-dash__account-billing-cards--address">' + cards + '</div>' +
      '<p class="tma-dash__account-billing-muted">Tax Location : United States - 10% VAT</p></section>';
  }

  function renderBillingHistoryBlock() {
    var rows = BILLING_HISTORY.map(function (row) {
      return { date: row.date, description: row.description, amount: row.amount, invoice: 'PDF' };
    });
    return renderAccountSheetTable({
      title: 'Billing History',
      nodeId: '32546:96113',
      blockClass: 'tma-dash__account-block--billing-history',
      tabGroup: 'billing-history',
      tabAriaLabel: 'Billing history period',
      tabs: [
        { id: 'month', label: 'Month', active: true },
        { id: 'year', label: 'Year', active: false },
        { id: 'all', label: 'All Time', active: false },
      ],
      columns: [
        { key: 'date', label: 'Date', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'text' },
        { key: 'invoice', label: 'Invoice', type: 'pdf' },
      ],
      rows: rows,
      gridCols: '120px 1fr 100px 88px',
    });
  }

  function renderBillingPanel(activeTab) {
    var hidden = activeTab !== 'Billing' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--billing"' + hidden + ' data-account-panel="Billing" data-node-id="32546:96113">' +
      renderBillingOverviewBlock() +
      renderBillingPaymentMethodsBlock() +
      renderBillingAddressBlock() +
      renderBillingHistoryBlock() +
      '</div>';
  }

  function bindAccountFilterTabs(panel) {
    if (!panel || panel.dataset.accountFiltersBound) return;
    panel.dataset.accountFiltersBound = '1';
    panel.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-account-filter-tab]');
      if (!tabBtn || !panel.contains(tabBtn)) return;
      var group = tabBtn.getAttribute('data-account-filter-group');
      panel.querySelectorAll('[data-account-filter-group="' + group + '"]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn === tabBtn);
      });
    });
  }

  function bindBillingPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--billing');
    if (!panel || panel.dataset.accountBillingBound) return;
    panel.dataset.accountBillingBound = '1';
    bindAccountFilterTabs(panel);
  }

  var STATEMENT_ROWS = [
    { orderId: '678935899', details: 'Darknight transparency 36 Icons Pack', date: 'Just now', amount: '$123.79', invoice: 'PDF' },
    { orderId: '578433345', details: 'Seller Fee', date: '1 minute ago', amount: '$-2.60', invoice: 'PDF' },
    { orderId: '678935899', details: 'Cartoon Mobile Emoji Phone Pack', date: '1 hour ago', amount: '$35.07', invoice: 'PDF' },
    { orderId: '098669322', details: 'Iphone 12 Pro Mockup Mega Bundle', date: 'Yesterday', amount: '$-5.00', invoice: 'PDF' },
    { orderId: '245899092', details: 'Parcel Shipping / Delivery Service App', date: 'Feb 2, 2026', amount: '$123.79', invoice: 'PDF' },
  ];

  function renderStatementsEarningsBlock() {
    var stats = [
      { label: 'Net Earnings', value: '$6,840' },
      { label: 'Change', value: '80%' },
      { label: 'Fees', value: '$1,240' },
    ].map(function (stat, index) {
      var sep = index ? '<span class="tma-dash__account-referrals-stat-sep" aria-hidden="true"></span>' : '';
      return sep + '<div class="tma-dash__account-referrals-stat">' +
        '<span class="tma-dash__account-referrals-stat-label">' + esc(stat.label) + '</span>' +
        '<strong class="tma-dash__account-referrals-stat-value">' + esc(stat.value) + '</strong></div>';
    }).join('');

    return '<section class="tma-dash__account-block tma-dash__account-block--statements-earnings" data-node-id="32546:96107">' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title">Earnings</h3>' +
        '<button type="button" class="tma-dash__overview-btn"><span>Withdraw Earnings</span></button>' +
      '</div>' +
      '<div class="tma-dash__account-referrals-stats tma-dash__account-statements-stats">' + stats + '</div>' +
      '<p class="tma-dash__account-billing-muted">Last 30 day earnings calculated. Apart from arranging the order of topics.</p>' +
      '</section>';
  }

  function renderStatementsInvoicesBlock() {
    return '<section class="tma-dash__account-block tma-dash__account-block--statements-invoices" data-node-id="32546:96107">' +
      '<h3 class="tma-dash__account-block-title">Invoices</h3>' +
      '<div class="tma-dash__account-statements-invoices-row">' +
        '<div class="tma-dash__account-statements-select" role="button" tabindex="0" aria-haspopup="listbox" aria-label="Invoice account">' +
          '<span class="tma-dash__account-statements-select-label">Individual Seller Account</span>' +
          '<img src="' + TMA + 'ArrowLineUpDown.svg" alt="" width="16" height="16">' +
        '</div>' +
        '<button type="button" class="tma-dash__account-statements-download" aria-label="Download invoices"><img src="' + ICON + 'DownloadSimple.svg" alt="" width="20" height="20"></button>' +
      '</div>' +
      '<p class="tma-dash__account-billing-muted">Download apart from order of the good awesome invoice topics.</p>' +
      '</section>';
  }

  function renderStatementsTableBlock() {
    return renderAccountSheetTable({
      title: 'Statement',
      nodeId: '32546:96107',
      blockClass: 'tma-dash__account-block--statements-table',
      tabGroup: 'statements-year',
      tabAriaLabel: 'Statement year',
      tabs: [
        { id: 'this-year', label: 'This Year', active: true },
        { id: '2023', label: '2023', active: false },
        { id: '2022', label: '2022', active: false },
      ],
      columns: [
        { key: 'orderId', label: 'Order ID', type: 'text' },
        { key: 'details', label: 'Details', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'amount', label: 'Amount', type: 'amount' },
        { key: 'invoice', label: 'Invoice', type: 'pdf' },
      ],
      rows: STATEMENT_ROWS,
      gridCols: '118px 1fr minmax(88px, 200px) 100px 88px',
    });
  }

  function renderStatementsPanel(activeTab) {
    var hidden = activeTab !== 'Statements' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--statements"' + hidden + ' data-account-panel="Statements" data-node-id="32546:96107">' +
      '<div class="tma-dash__account-row">' +
        renderStatementsEarningsBlock() +
        renderStatementsInvoicesBlock() +
      '</div>' +
      renderStatementsTableBlock() +
      '</div>';
  }

  function bindStatementsPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--statements');
    if (!panel || panel.dataset.accountStatementsBound) return;
    panel.dataset.accountStatementsBound = '1';
    bindAccountFilterTabs(panel);
  }

  var REFERRED_USERS = [
    { orderId: '678935899', manager: 'ByeWind', avatar: 'AvatarByewind', date: 'Just now', bonus: '26%', profit: '$1,200.00' },
    { orderId: '578433345', manager: 'Natali Craig', avatar: 'AvatarFemale06', date: '1 minute ago', bonus: '35%', profit: '$2,400.00' },
    { orderId: '678935899', manager: 'Drew Cano', avatar: 'AvatarMale01', date: '1 hour ago', bonus: '18%', profit: '$940.00' },
    { orderId: '098669322', manager: 'Orlando Diggs', avatar: 'AvatarMale03', date: 'Yesterday', bonus: '43%', profit: '$200.00' },
    { orderId: '245899092', manager: 'Andi Lane', avatar: 'AvatarFemale01', date: 'Feb 2, 2026', bonus: '21%', profit: '$380.00' },
  ];

  function renderReferralsProgramBlock() {
    var stats = [
      { label: 'Net Earnings', value: '$6,840' },
      { label: 'Balance', value: '$8,530' },
      { label: 'Avg Deal Size', value: '$2,600' },
      { label: 'Referral Signups', value: '783' },
    ].map(function (stat, index) {
      var sep = index ? '<span class="tma-dash__account-referrals-stat-sep" aria-hidden="true"></span>' : '';
      return sep + '<div class="tma-dash__account-referrals-stat">' +
        '<span class="tma-dash__account-referrals-stat-label">' + esc(stat.label) + '</span>' +
        '<strong class="tma-dash__account-referrals-stat-value">' + esc(stat.value) + '</strong></div>';
    }).join('');

    return '<section class="tma-dash__account-block tma-dash__account-block--referrals-program" data-node-id="32546:96110">' +
      '<h3 class="tma-dash__account-block-title tma-dash__account-block-title--lg">Referral Program</h3>' +
      '<div class="tma-dash__account-referrals-stats">' + stats + '</div>' +
      '<p class="tma-dash__account-referrals-subtitle">Your Referral Link</p>' +
      '<div class="tma-dash__account-referrals-link">' +
        '<span class="tma-dash__account-referrals-link-text">https://portal.tma.com/referral/TMAAdvisoryPortal</span>' +
        '<button type="button" class="tma-dash__account-referrals-copy" aria-label="Copy referral link"><img src="' + TMA + 'Clipboard-16.svg" alt="" width="16" height="16"></button>' +
      '</div>' +
      '<p class="tma-dash__account-billing-muted tma-dash__account-billing-muted--border">Plan your blog post by choosing a topic, creating an outline conduct research, and checking facts.</p>' +
      '<div class="tma-dash__account-referrals-action-row">' +
        '<div class="tma-dash__account-referrals-action-copy">' +
          '<p class="tma-dash__account-billing-copy-title">How to use Referral Program</p>' +
          '<p class="tma-dash__account-billing-muted">Use images to enhance your post, improve its flow, add humor and explain complex topics.</p>' +
        '</div>' +
        '<button type="button" class="tma-dash__overview-btn"><span>Get Started</span></button>' +
      '</div>' +
      '<div class="tma-dash__account-referrals-withdraw">' +
        '<div class="tma-dash__account-referrals-withdraw-main">' +
          '<img src="' + ICON + 'CurrencyCircleDollar.svg" alt="" width="20" height="20">' +
          '<div class="tma-dash__account-referrals-withdraw-copy">' +
            '<p class="tma-dash__account-billing-copy-title">Withdraw Your Money to a Bank Account</p>' +
            '<p class="tma-dash__account-billing-muted">Withdraw money securily to your bank account. Commision is $25 per transaction under $50,000.</p>' +
          '</div></div>' +
        '<button type="button" class="tma-dash__overview-btn"><span>Withdraw Money</span></button>' +
      '</div></section>';
  }

  function renderReferralsUsersBlock() {
    return renderAccountSheetTable({
      title: 'Referred Users',
      nodeId: '32546:96110',
      blockClass: 'tma-dash__account-block--referrals-users',
      tabGroup: 'referrals-year',
      tabAriaLabel: 'Referrals year',
      tabs: [
        { id: 'this-year', label: 'This Year', active: true },
        { id: '2023', label: '2023', active: false },
        { id: '2022', label: '2022', active: false },
      ],
      columns: [
        { key: 'orderId', label: 'Order ID', type: 'text' },
        { key: 'manager', label: 'Manager', type: 'manager' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'bonus', label: 'Bonus', type: 'text' },
        { key: 'profit', label: 'Profit', type: 'text' },
      ],
      rows: REFERRED_USERS,
      gridCols: '1fr minmax(160px, 224px) minmax(88px, 120px) 72px 96px',
    });
  }

  function renderReferralsPanel(activeTab) {
    var hidden = activeTab !== 'Referrals' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--referrals"' + hidden + ' data-account-panel="Referrals" data-node-id="32546:96110">' +
      renderReferralsProgramBlock() +
      renderReferralsUsersBlock() +
      '</div>';
  }

  function bindReferralsPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--referrals');
    if (!panel || panel.dataset.accountReferralsBound) return;
    panel.dataset.accountReferralsBound = '1';
    bindAccountFilterTabs(panel);
  }

  var API_KEYS_ROWS = [
    { label: 'none set', apiKey: 'ffft456765gjkkjhi83093985', date: 'Just now', status: 'in-progress', statusLabel: 'In Progress' },
    { label: 'Navitare', apiKey: 'jk076590ygghgh324vd33', date: '1 minute ago', status: 'complete', statusLabel: 'Complete' },
    { label: 'Docs API Key', apiKey: 'jk076590ygghgh324vd3568', date: '1 hour ago', status: 'pending', statusLabel: 'Pending' },
    { label: 'Identity Key', apiKey: 'hhet6454788gfg555hhh4', date: 'Yesterday', status: 'approved', statusLabel: 'Approved' },
    { label: 'Remore Interface', apiKey: 'ffft456765gjkkjhi83093985', date: 'Feb 2, 2026', status: 'rejected', statusLabel: 'Rejected' },
  ];

  function renderApiKeysOverviewBlock() {
    function actionRow(title, body, actionLabel, bordered) {
      var borderClass = bordered ? ' tma-dash__account-api-keys-action-row--border' : '';
      return '<div class="tma-dash__account-referrals-action-row tma-dash__account-api-keys-action-row' + borderClass + '">' +
        '<div class="tma-dash__account-referrals-action-copy">' +
          '<p class="tma-dash__account-billing-copy-title">' + esc(title) + '</p>' +
          '<p class="tma-dash__account-billing-muted">' + esc(body) + '</p>' +
        '</div>' +
        '<button type="button" class="tma-dash__overview-btn"><span>' + esc(actionLabel) + '</span></button>' +
      '</div>';
    }

    return '<section class="tma-dash__account-block tma-dash__account-block--api-keys-overview" data-node-id="32546:96112">' +
      '<h3 class="tma-dash__account-block-title tma-dash__account-block-title--lg">API Overview</h3>' +
      actionRow(
        'How to set API',
        'Use images to enhance your post, improve its flow, add humor and explain complex topics.',
        'Get Started',
        true
      ) +
      actionRow(
        'Developer Tools',
        'Plan your blog post by choosing a topic, creating an outline conduct research, and checking facts.',
        'Create Rule',
        false
      ) +
      '</section>';
  }

  function renderApiKeysSessionsTable() {
    var columns = [
      { key: 'location', type: 'text', label: 'Location', padding: 'location' },
      { key: 'device', type: 'text', label: 'Device' },
      { key: 'ipAddress', type: 'text', label: 'IP Address' },
      { key: 'time', type: 'time', label: 'Time' },
      { key: 'status', type: 'status', label: 'Status', padding: 'status' },
    ];
    return renderSecurityDataTable('Sign in Sessions', 'api-keys-sessions', columns, LOGS_SIGN_IN_SESSIONS, '174px 1fr 158px 165px 120px');
  }

  function renderApiKeysTableBlock() {
    var columns = [
      { key: 'label', type: 'text', label: 'Label', padding: 'location' },
      { key: 'apiKey', type: 'text', label: 'API Keys' },
      { key: 'date', type: 'date', label: 'Date' },
      { key: 'status', type: 'status', label: 'Status', padding: 'status' },
    ];
    return '<section class="tma-dash__account-block tma-dash__account-block--api-keys-table">' +
      '<h3 class="tma-dash__account-block-title">API Keys</h3>' +
      renderSecurityDataTable('API Keys', 'api-keys-list', columns, API_KEYS_ROWS, '1fr 263px minmax(88px, 240px) 120px', { filter: false }) +
      '</section>';
  }

  function renderApiKeysPanel(activeTab) {
    var hidden = activeTab !== 'API Keys' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--api-keys"' + hidden + ' data-account-panel="API Keys" data-node-id="32546:96112">' +
      renderApiKeysOverviewBlock() +
      renderApiKeysSessionsTable() +
      renderApiKeysTableBlock() +
      '</div>';
  }

  function bindApiKeysPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--api-keys');
    if (!panel || panel.dataset.accountApiKeysBound) return;
    panel.dataset.accountApiKeysBound = '1';
    if (window.TMATableB && typeof window.TMATableB.init === 'function') {
      window.TMATableB.init();
    }
  }

  var LOGS_SIGN_IN_SESSIONS = [
    { location: 'USA(5)', device: 'Chrome - Windows', ipAddress: '236.125.56.78', time: '2 minutes ago', status: 'in-progress', statusLabel: 'In Progress' },
    { location: 'United Kingdom(10)', device: 'Safari - Mac OS', ipAddress: '236.125.56.69', time: '10 minutes ago', status: 'complete', statusLabel: 'Complete' },
    { location: 'Norway(-)', device: 'Firefox - Windows', ipAddress: '236.125.56.10', time: '20 minutes ago', status: 'pending', statusLabel: 'Pending' },
    { location: 'Japan(112)', device: 'iOS - iPhone Pro', ipAddress: '236.125.56.54', time: '30 minutes ago', status: 'approved', statusLabel: 'Approved' },
    { location: 'Italy(5)', device: 'Samsung Noted 5- Android', ipAddress: '236.100.56.50', time: '40 minutes ago', status: 'rejected', statusLabel: 'Rejected' },
  ];

  var ACCOUNT_LOGS = [
    { timestamp: 'Feb 1, 2026, 9:23 PM', path: 'POST /v1/invoice/in_3585_9341/invalid' },
    { timestamp: 'Feb 2, 2026, 11:05 AM', path: 'POST /v1/customer/c_630faaba0c57b/not_found' },
    { timestamp: 'Feb 2, 2026, 10:10 PM', path: 'POST /v1/customer/c_630faaba0c579/not_found' },
    { timestamp: 'Feb 3, 2026, 10:10 PM', path: 'POST /v1/invoices/in_1881_1220/payment' },
    { timestamp: 'Feb 3, 2026, 10:10 PM', path: 'POST /v1/customer/c_630faaba0c57b/not_found' },
  ];

  function renderLogsSessionsTable() {
    var columns = [
      { key: 'location', type: 'text', label: 'Location', padding: 'location' },
      { key: 'device', type: 'text', label: 'Device' },
      { key: 'ipAddress', type: 'text', label: 'IP Address' },
      { key: 'time', type: 'time', label: 'Time' },
      { key: 'status', type: 'status', label: 'Status', padding: 'status' },
    ];
    return renderSecurityDataTable('Sign in Sessions', 'logs-sessions', columns, LOGS_SIGN_IN_SESSIONS, '174px 1fr 158px 165px 120px');
  }

  function renderLogsListBlock() {
    var rows = ACCOUNT_LOGS.map(function (entry, index) {
      var last = index === ACCOUNT_LOGS.length - 1;
      var rowClass = 'tma-dash__account-logs-row' + (last ? ' tma-dash__account-logs-row--last' : '');
      return '<div class="' + rowClass + '" role="row">' +
        '<div class="tma-dash__account-logs-cell tma-dash__account-logs-cell--time" role="cell">' + esc(entry.timestamp) + '</div>' +
        '<div class="tma-dash__account-logs-cell tma-dash__account-logs-cell--path" role="cell">' + esc(entry.path) + '</div>' +
        '<div class="tma-dash__account-logs-cell tma-dash__account-logs-cell--action" role="cell">' +
          '<button type="button" class="tma-dash__account-logs-download" aria-label="Download log entry"><img src="' + ICON + 'DownloadSimple.svg" alt="" width="16" height="16"></button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="tma-dash__account-block tma-dash__account-block--logs" data-node-id="32546:96109">' +
      '<div class="tma-dash__account-block-head">' +
        '<h3 class="tma-dash__account-block-title">Logs</h3>' +
        '<button type="button" class="tma-dash__overview-btn"><span>Download Report</span></button>' +
      '</div>' +
      '<div class="tma-dash__account-logs-sheet" role="table" aria-label="Logs">' + rows + '</div>' +
      '</section>';
  }

  function renderLogsPanel(activeTab) {
    var hidden = activeTab !== 'Logs' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--logs"' + hidden + ' data-account-panel="Logs" data-node-id="32546:96109">' +
      renderLogsSessionsTable() +
      renderLogsListBlock() +
      '</div>';
  }

  function bindLogsPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--logs');
    if (!panel || panel.dataset.accountLogsBound) return;
    panel.dataset.accountLogsBound = '1';
    if (window.TMATableB && typeof window.TMATableB.init === 'function') {
      window.TMATableB.init();
    }
  }

  function renderSettingsPanel(activeTab) {
    var hidden = activeTab !== 'Settings' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--settings"' + hidden + ' data-account-panel="Settings" data-node-id="32546:96111">' +
      renderSettingsProfileBlock() +
      renderSettingsSignInBlock() +
      renderSettingsConnectedBlock() +
      renderSettingsEmailPrefsBlock() +
      renderSettingsNotificationsBlock() +
      renderSettingsDeactivateBlock() +
      '</div>';
  }

  function renderOverviewPanel(activeTab) {
    var hidden = activeTab !== 'Overview' ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--overview"' + hidden + ' data-account-panel="Overview">' +
      '<div class="tma-dash__account-row">' + renderProfileHeader() + renderProfileDetails() + '</div>' +
      '<div class="tma-dash__account-row">' + renderPromo() + '</div></div>';
  }

  function renderStubPanel(tab, activeTab) {
    var hidden = tab !== activeTab ? ' hidden' : '';
    return '<div class="tma-dash__account-panel tma-dash__account-panel--stub"' + hidden + ' data-account-panel="' + esc(tab) + '">' +
      '<section class="tma-dash__account-block tma-dash__account-block--stub">' +
      '<h3 class="tma-dash__account-block-title">' + esc(tab) + '</h3>' +
      '<p class="tma-dash__account-stub-text">This section is coming soon.</p></section></div>';
  }

  function render(activeTab) {
    var tab = activeTab || 'Overview';
    var stubs = TABS.filter(function (t) {
      return t !== 'Overview' && t !== 'Settings' && t !== 'Security' && t !== 'Billing' && t !== 'Statements' && t !== 'Referrals' && t !== 'API Keys' && t !== 'Logs';
    }).map(function (t) {
      return renderStubPanel(t, tab);
    }).join('');
    return '<div class="tma-dash__account">' +
      renderTabs(tab) +
      '<div class="tma-dash__account-panels">' +
      renderOverviewPanel(tab) +
      renderSettingsPanel(tab) +
      renderSecurityPanel(tab) +
      renderBillingPanel(tab) +
      renderStatementsPanel(tab) +
      renderReferralsPanel(tab) +
      renderApiKeysPanel(tab) +
      renderLogsPanel(tab) +
      stubs +
      '</div></div>';
  }

  function bindSettingsPanel(container) {
    var panel = container.querySelector('.tma-dash__account-panel--settings');
    if (!panel || panel.dataset.accountSettingsBound) return;
    panel.dataset.accountSettingsBound = '1';
    if (window.TMAInput && typeof window.TMAInput.mountInteractive === 'function') {
      window.TMAInput.mountInteractive(panel);
    }
  }

  function setActiveTab(container, tabName) {
    if (!container) return;
    var tab = tabName || 'Overview';
    container.querySelectorAll('[data-account-tab]').forEach(function (btn) {
      var active = btn.getAttribute('data-account-tab') === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    container.querySelectorAll('[data-account-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-account-panel') !== tab;
    });
    if (tab === 'Settings') bindSettingsPanel(container);
    if (tab === 'Security') bindSecurityPanel(container);
    if (tab === 'Billing') bindBillingPanel(container);
    if (tab === 'Statements') bindStatementsPanel(container);
    if (tab === 'Referrals') bindReferralsPanel(container);
    if (tab === 'API Keys') bindApiKeysPanel(container);
    if (tab === 'Logs') bindLogsPanel(container);
  }

  function bindTabs(container) {
    if (!container || container.dataset.accountTabsBound) return;
    container.dataset.accountTabsBound = '1';
    container.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-account-tab]');
      if (!tabBtn || !container.contains(tabBtn)) return;
      setActiveTab(container, tabBtn.getAttribute('data-account-tab'));
    });
  }

  function mount(container, opts) {
    if (!container) return;
    var activeTab = (opts && opts.tab) || 'Overview';
    container.innerHTML = render(activeTab);
    bindTabs(container);
    bindSettingsPanel(container);
    bindSecurityPanel(container);
    bindBillingPanel(container);
    bindStatementsPanel(container);
    bindReferralsPanel(container);
    bindApiKeysPanel(container);
    bindLogsPanel(container);
    setActiveTab(container, activeTab);
  }

  function tabForNav(navId) {
    return NAV_TAB[navId] || 'Overview';
  }

  window.TMAAccount = {
    mount: mount,
    render: render,
    setActiveTab: setActiveTab,
    tabForNav: tabForNav,
    isTabVisible: isTabVisible,
    hiddenTabs: HIDDEN_TABS,
  };
})();
