/*
 * TMA - Shared rendering for notifications & activity items.
 *
 * The one place the visual rules live (§3, §4, §5, §14):
 *   - A person did it  -> their photo, or an initials tile when there's none.
 *                         Never a broken <img>; a failed photo falls back to
 *                         the same initials tile.
 *   - The system did it -> a Phosphor glyph inside a circular, level-toned
 *                          background. Never an emoji.
 * Every surface (right sidebar, header popups, overview log) renders through
 * these helpers so they always look and behave identically.
 *
 * Global: window.TMANotifyRender
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function iconUrl(name) {
    return ICON + (name || 'Notification') + '.svg';
  }

  /* Initials tile as a data URI — same palette/algorithm as current-user.js so
     a person looks the same everywhere, and with no dependency on load order. */
  function initialsUri(name) {
    var initials = String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var colors = ['#136da0', '#03a5e9', '#0f9d8c', '#3f9142', '#c77d18', '#b5497e', '#3b6fb8'];
    var n = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) n = (n + s.charCodeAt(i)) % 997;
    var bg = colors[n % colors.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<rect width="40" height="40" rx="20" fill="' + bg + '"/>' +
      '<text x="20" y="21" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" ' +
      'fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + esc(initials) + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function isRealPhoto(src) {
    // Portal-served sender photos live under /portal/mail/sender-photo/…
    return !!src && /^(https?:|\/(storage|media|portal)\/|data:)/.test(src);
  }

  /* §14 level -> existing design-system tone. No new colours are invented;
     these all map to tokens the dashboard already ships. */
  var TONES = {
    info: 'blue', reminder: 'blue', success: 'green', warning: 'amber',
    error: 'red', security: 'purple', action_required: 'amber', approval_required: 'purple',
  };
  function levelTone(level) { return TONES[level] || 'blue'; }

  /* Relative time in the portal's existing phrasing ("Just now", "5 minutes
     ago", "Yesterday", "Feb 2, 2026"). */
  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 45) return 'Just now';
    if (diff < 90) return '1 minute ago';
    if (diff < 3600) { var m = Math.round(diff / 60); return m + ' minute' + (m > 1 ? 's' : '') + ' ago'; }
    if (diff < 5400) return '1 hour ago';
    if (diff < 86400) { var h = Math.round(diff / 3600); return h + ' hour' + (h > 1 ? 's' : '') + ' ago'; }
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
    if (d >= startYest && d < startToday) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* The leading visual: a person's photo/initials, or a system glyph. Popups
     wrap the photo in a sized span (existing CSS); the sidebar uses a bare
     rb-avatar image — so the markup follows each surface's existing styles. */
  function personVisual(item, cfg) {
    var name = (item.actor && item.actor.name) || (item.meta && item.meta.from_name) || '';
    var fallback = initialsUri(name);
    var src = item.image || (item.actor && item.actor.avatar) || '';
    var url = isRealPhoto(src) ? src : fallback;
    var img = '<img ' + (cfg.avatarImgClass ? 'class="' + cfg.avatarImgClass + '" ' : '') +
      'src="' + esc(url) + '" alt="" ' +
      "onerror=\"this.onerror=null;this.src='" + fallback + "'\">";
    if (cfg.avatarWrap) return '<span class="' + cfg.avatarWrap + '">' + img + '</span>';
    return img;
  }

  function systemVisual(item, cfg) {
    var tone = levelTone(item.level);
    return '<span class="' + cfg.iconSpan + ' ' + cfg.iconSpan + '--' + tone + '" aria-hidden="true">' +
      '<img src="' + iconUrl(item.icon) + '" alt=""></span>';
  }

  /* A notification's leading element. A person is anyone with an actor (§3);
     an explicit image (sender photo / client logo) also counts; email rows
     with a known sender show initials until their photo is cached. */
  function notificationLeading(item, cfg) {
    var fromName = item.meta && item.meta.from_name;
    if (item.actor || item.image || (item.module === 'email' && fromName)) {
      return personVisual(item, cfg);
    }
    return systemVisual(item, cfg);
  }

  /* An activity's leading element follows the same rule (§4). */
  function activityLeading(item, cfg) {
    if (item.actor) return personVisual(item, cfg);
    return systemVisual(item, cfg);
  }

  var VARIANTS = {
    popup: {
      item: 'tma-dash__header-popup-item',
      activityItem: 'tma-dash__header-popup-item',
      body: 'tma-dash__header-popup-copy',
      title: 'tma-dash__header-popup-title',
      desc: 'tma-dash__header-popup-desc',
      meta: 'tma-dash__header-popup-meta',
      cta: 'tma-dash__header-popup-cta',
      avatarWrap: 'tma-dash__header-popup-avatar',
      avatarImgClass: '',
      iconSpan: 'tma-dash__header-popup-icon',
      unread: 'tma-dash__header-popup-item--unread',
    },
    sidebar: {
      item: 'tma-dash__notice',
      // Activities keep their own class so the connector-line design still hits.
      activityItem: 'tma-dash__activity',
      body: 'tma-dash__notice-body',
      title: 'tma-dash__notice-title',
      desc: 'tma-dash__notice-desc',
      meta: 'tma-dash__notice-meta',
      cta: 'tma-dash__notice-cta',
      avatarWrap: null,
      avatarImgClass: 'tma-dash__rb-avatar',
      iconSpan: 'tma-dash__notice-icon',
      unread: 'tma-dash__notice--unread',
    },
  };

  function notificationItem(item, variant) {
    var cfg = VARIANTS[variant] || VARIANTS.popup;
    var cls = cfg.item;
    if (!item.read) cls += ' ' + cfg.unread;
    if (item.requiresAction) cls += ' ' + cfg.item + '--action';

    var desc = item.message ? '<div class="' + cfg.desc + '">' + esc(item.message) + '</div>' : '';
    var cta = (item.actionLabel && item.actionUrl)
      ? '<span class="' + cfg.cta + '">' + esc(item.actionLabel) + '</span>' : '';

    return '<div class="' + cls + '" role="button" tabindex="0" ' +
      'data-notification-id="' + esc(item.id) + '" ' +
      'data-action-url="' + esc(item.actionUrl || '') + '" ' +
      'data-level="' + esc(item.level) + '">' +
      notificationLeading(item, cfg) +
      '<div class="' + cfg.body + '">' +
        '<div class="' + cfg.title + '">' + esc(item.title) + '</div>' +
        desc +
        '<div class="' + cfg.meta + '">' + esc(timeLabel(item.createdAt)) + '</div>' +
        cta +
      '</div>' +
      (item.read ? '' : '<span class="tma-dash__unread-dot" aria-label="Unread"></span>') +
      '<button type="button" class="tma-dash__notif-dismiss" data-notification-dismiss="' + esc(item.id) + '" aria-label="Dismiss notification" title="Dismiss">&times;</button>' +
    '</div>';
  }

  function activityItem(item, variant) {
    var cfg = VARIANTS[variant] || VARIANTS.popup;
    return '<div class="' + (cfg.activityItem || cfg.item) + '" ' +
      'data-activity-id="' + esc(item.id) + '" ' +
      'data-action-url="' + esc(actionUrlForActivity(item)) + '" ' +
      'data-status="' + esc(item.status) + '">' +
      activityLeading(item, cfg) +
      '<div class="' + cfg.body + '">' +
        '<div class="' + cfg.title + '">' + esc(item.description) + '</div>' +
        '<div class="' + cfg.meta + '">' + esc(timeLabel(item.createdAt)) + '</div>' +
      '</div>' +
    '</div>';
  }

  /* Activity rows link to their subject where the module has a landing page. */
  function actionUrlForActivity(item) {
    var m = item.module;
    if (m === 'clients' && item.client) return '/clients?client=' + encodeURIComponent(item.client.id);
    var MAP = {
      files: '/portal/files', calendar: '/calendar', email: '/email',
      messages: '/social/messages', signatures: '/signatures', clients: '/clients',
      account: '/overview?tab=activity', security: '/account-settings?settings-page=security',
    };
    return MAP[m] || '';
  }

  function emptyState(message, iconName) {
    return '<div class="tma-dash__rb-empty">' +
      '<span class="tma-dash__rb-empty-icon"><img src="' + iconUrl(iconName || 'Notification') + '" alt=""></span>' +
      '<span class="tma-dash__rb-empty-text">' + esc(message) + '</span>' +
    '</div>';
  }

  function errorState(message) {
    return '<div class="tma-dash__rb-empty tma-dash__rb-empty--error">' +
      '<span class="tma-dash__rb-empty-icon"><img src="' + iconUrl('WarningCircle') + '" alt=""></span>' +
      '<span class="tma-dash__rb-empty-text">' + esc(message || 'Could not load. Try again.') + '</span>' +
      '<button type="button" class="tma-dash__rb-retry" data-rb-retry>Retry</button>' +
    '</div>';
  }

  function skeleton(rows) {
    var out = '';
    for (var i = 0; i < (rows || 3); i++) {
      out += '<div class="tma-dash__rb-skel"><span class="tma-dash__rb-skel-avatar"></span>' +
        '<span class="tma-dash__rb-skel-lines"><span></span><span></span></span></div>';
    }
    return out;
  }

  window.TMANotifyRender = {
    esc: esc,
    iconUrl: iconUrl,
    initialsUri: initialsUri,
    levelTone: levelTone,
    timeLabel: timeLabel,
    notificationItem: notificationItem,
    activityItem: activityItem,
    actionUrlForActivity: actionUrlForActivity,
    emptyState: emptyState,
    errorState: errorState,
    skeleton: skeleton,
  };
})();
