/*
 * TMA - Notifications & Activities header popups (Figma 32546:96099).
 *
 * The bell and clock icons in the header. Both popups read from the shared
 * stores (so they agree with the right sidebar and the badges to the item),
 * render through the shared render layer, and are mutually exclusive: opening
 * one closes the other, clicking outside or pressing Escape closes it, and the
 * two never overlap (§2, §6, §7, §11, §12).
 *
 * Global: window.TMAActivityPopups
 */
(function () {
  'use strict';

  function R() { return window.TMANotifyRender; }
  function NOTIF() { return window.TMANotifications; }
  function ACT() { return window.TMAActivities; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function notificationsPanelShell() {
    return '<section class="tma-dash__header-popup tma-dash__header-popup--notifications" data-popup-panel="notifications" data-node-id="33296:181107" hidden aria-label="Notifications">' +
      '<div class="tma-dash__header-popup-head">' +
        '<h2 class="tma-dash__header-popup-heading">Notifications</h2>' +
        '<button type="button" class="tma-dash__header-popup-action" data-popup-action="toggle-unread" aria-pressed="false">Unread</button>' +
        '<button type="button" class="tma-dash__header-popup-action" data-popup-action="mark-notifications-read">Mark all as read</button>' +
      '</div>' +
      '<div class="tma-dash__header-popup-list" data-popup-list></div>' +
      '<div class="tma-dash__header-popup-foot">' +
        '<button type="button" class="tma-dash__header-popup-action tma-dash__header-popup-action--footer" data-popup-action="see-all-notifications">See all notifications</button>' +
      '</div>' +
    '</section>';
  }

  function activitiesPanelShell() {
    return '<section class="tma-dash__header-popup tma-dash__header-popup--notifications" data-popup-panel="activities" data-node-id="33296:146832" hidden aria-label="Activities">' +
      '<h2 class="tma-dash__header-popup-heading">Activities</h2>' +
      '<div class="tma-dash__header-popup-list" data-popup-list></div>' +
      '<div class="tma-dash__header-popup-foot">' +
        '<button type="button" class="tma-dash__header-popup-action tma-dash__header-popup-action--footer" data-popup-action="see-all-activities">See all activities</button>' +
      '</div>' +
    '</section>';
  }

  function mount(root) {
    var host = root.querySelector('[data-header-popups]');
    if (!host) return;
    if (host.parentNode !== document.body) document.body.appendChild(host);
    host.setAttribute('data-node-id', '32546:96099');
    host.innerHTML = notificationsPanelShell() + activitiesPanelShell();

    var state = { notifications: false, activities: false, unreadOnly: false };
    var notificationsBtn = root.querySelector('[data-action="toggle-notifications-popup"]');
    var activitiesBtn = root.querySelector('[data-action="toggle-activities-popup"]');
    var notificationsPanel = host.querySelector('[data-popup-panel="notifications"]');
    var activitiesPanel = host.querySelector('[data-popup-panel="activities"]');

    function syncBadges() { if (root._syncTabBarBadges) root._syncTabBarBadges(); }

    /* ── rendering from the stores ─────────────────────────────── */
    function renderNotifications() {
      var listEl = notificationsPanel.querySelector('[data-popup-list]');
      if (!listEl) return;
      var s = NOTIF().state;
      var items = state.unreadOnly ? s.items.filter(function (it) { return !it.read; }) : s.items;
      if (!s.loaded && s.loading) listEl.innerHTML = R().skeleton(4);
      else if (s.error && !s.items.length) listEl.innerHTML = R().errorState('Could not load notifications.');
      else if (!items.length) listEl.innerHTML = R().emptyState(state.unreadOnly ? 'No unread notifications.' : 'You are all caught up.', 'Bell');
      else {
        listEl.innerHTML = items.map(function (it) { return R().notificationItem(it, 'popup'); }).join('') +
          (!state.unreadOnly && s.hasMore ? '<button type="button" class="tma-dash__header-popup-more" data-popup-loadmore="notifications">Load more</button>' : '');
      }
      var markBtn = notificationsPanel.querySelector('[data-popup-action="mark-notifications-read"]');
      if (markBtn) markBtn.disabled = s.unread === 0;
      var unreadBtn = notificationsPanel.querySelector('[data-popup-action="toggle-unread"]');
      if (unreadBtn) {
        unreadBtn.setAttribute('aria-pressed', String(state.unreadOnly));
        unreadBtn.classList.toggle('tma-dash__header-popup-action--active', state.unreadOnly);
      }
    }

    function renderActivities() {
      var listEl = activitiesPanel.querySelector('[data-popup-list]');
      if (!listEl) return;
      var s = ACT().state;
      if (!s.loaded && s.loading) listEl.innerHTML = R().skeleton(4);
      else if (s.error && !s.items.length) listEl.innerHTML = R().errorState('Could not load activity.');
      else if (!s.items.length) listEl.innerHTML = R().emptyState('No recent activity.', 'ClockCounterClockwise');
      else {
        listEl.innerHTML = s.items.map(function (it) { return R().activityItem(it, 'popup'); }).join('') +
          (s.hasMore ? '<button type="button" class="tma-dash__header-popup-more" data-popup-loadmore="activities">Load more</button>' : '');
      }
    }

    NOTIF().subscribe(function () { if (state.notifications) renderNotifications(); syncBadges(); });
    ACT().subscribe(function () { if (state.activities) renderActivities(); syncBadges(); });

    /* ── interactions ──────────────────────────────────────────── */
    host.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-popup-action]');
      if (actionBtn) {
        e.preventDefault();
        var action = actionBtn.getAttribute('data-popup-action');
        if (action === 'mark-notifications-read') NOTIF().markAllRead();
        else if (action === 'toggle-unread') { state.unreadOnly = !state.unreadOnly; renderNotifications(); }
        else if (action === 'see-all-notifications') seeAllNotifications();
        else if (action === 'see-all-activities') seeAllActivities();
        return;
      }
      var more = e.target.closest('[data-popup-loadmore]');
      if (more) {
        e.preventDefault();
        if (more.getAttribute('data-popup-loadmore') === 'notifications') NOTIF().loadMore();
        else ACT().loadMore();
        return;
      }
      var retry = e.target.closest('[data-rb-retry]');
      if (retry) {
        e.preventDefault();
        if (retry.closest('[data-popup-panel="notifications"]')) NOTIF().load({ limit: 20 });
        else ACT().load({ limit: 25 });
        return;
      }
      var dismiss = e.target.closest('[data-notification-dismiss]');
      if (dismiss) { e.preventDefault(); e.stopPropagation(); NOTIF().remove(dismiss.getAttribute('data-notification-dismiss')); return; }
      var notif = e.target.closest('[data-notification-id]');
      if (notif) { e.preventDefault(); openNotification(notif.getAttribute('data-notification-id'), notif.getAttribute('data-action-url')); return; }
      var act = e.target.closest('[data-activity-id]');
      if (act) { e.preventDefault(); navigate(act.getAttribute('data-action-url')); }
    });

    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('[data-notification-id],[data-activity-id]');
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    function openNotification(uid, url) {
      NOTIF().markRead(uid);
      navigate(url);
    }

    function navigate(url) {
      closeAll();
      if (!url) return;
      if (root._portalNavigate) root._portalNavigate(url);
      else window.location.assign((window.__TMA_SITE_ROOT || '') + url);
    }

    function seeAllNotifications() {
      closeAll();
      openRightbar();
      if (window.TMARightSidebar && window.TMARightSidebar.expand) {
        window.TMARightSidebar.expand(root, 'notifications');
      }
    }

    function seeAllActivities() {
      // The complete activity log lives in Overview → Activity (§7).
      navigate('/overview?tab=activity');
    }

    function openRightbar() {
      if (window.innerWidth <= 1024) {
        root.classList.remove('is-nav-open');
        root.classList.add('is-rb-open');
      } else {
        root.classList.remove('is-rightbar-collapsed');
      }
      var rightbar = root.querySelector('.tma-dash__rightbar');
      if (rightbar) rightbar.scrollTop = 0;
    }

    /* ── open/close + single-panel-at-a-time ───────────────────── */
    function syncTheme() {
      host.setAttribute('data-popup-theme', root.getAttribute('data-theme') || 'light');
    }

    function syncTriggers() {
      syncTheme();
      if (notificationsBtn) {
        notificationsBtn.setAttribute('aria-expanded', String(state.notifications));
        notificationsBtn.classList.toggle('tma-dash__icon-btn--active', state.notifications);
      }
      if (activitiesBtn) {
        activitiesBtn.setAttribute('aria-expanded', String(state.activities));
        activitiesBtn.classList.toggle('tma-dash__icon-btn--active', state.activities);
      }
      var anyOpen = state.notifications || state.activities;
      host.hidden = !anyOpen;
      // Only ever one panel — they must never overlap (§2).
      host.classList.toggle('tma-dash__header-popups--single', anyOpen);
      host.classList.remove('tma-dash__header-popups--both');
      if (notificationsPanel) notificationsPanel.hidden = !state.notifications;
      if (activitiesPanel) activitiesPanel.hidden = !state.activities;
      if (anyOpen) requestAnimationFrame(function () { positionPopups(); });
      else clearPopupHeights();
    }

    function clearPopupHeights() {
      [notificationsPanel, activitiesPanel].forEach(function (panel) {
        if (!panel) return;
        panel.style.minHeight = '';
        panel.style.height = '';
      });
    }

    function applySinglePopupHeight(top) {
      clearPopupHeights();
      var panel = state.notifications ? notificationsPanel : (state.activities ? activitiesPanel : null);
      if (!panel || panel.hidden) return;
      var margin = 16, shadowRoom = 28, hostPadding = 40;
      var available = window.innerHeight - top - margin - shadowRoom - hostPadding;
      var minHeight = Math.max(320, Math.min(available, 560));
      panel.style.minHeight = minHeight + 'px';
      panel.style.height = minHeight + 'px';
    }

    function positionPopups() {
      var tabbar = root.querySelector('.tma-dash__tabbar');
      var useTabBar = window.innerWidth <= 1024 && tabbar && getComputedStyle(tabbar).display !== 'none';

      if (useTabBar) {
        host.classList.add('tma-dash__header-popups--tabbar');
        host.style.top = 'auto';
        host.style.left = '16px';
        host.style.right = '16px';
        host.style.bottom = 'calc(60px + env(safe-area-inset-bottom, 0px))';
        host.style.width = 'auto';
        clearPopupHeights();
        var panel = state.notifications ? notificationsPanel : activitiesPanel;
        if (panel && !panel.hidden) {
          panel.style.minHeight = '';
          panel.style.maxHeight = 'calc(100vh - 140px - env(safe-area-inset-bottom, 0px))';
        }
        return;
      }

      host.classList.remove('tma-dash__header-popups--tabbar');
      var icons = root.querySelector('.tma-dash__header-icons');
      if (!icons) return;

      var rect = icons.getBoundingClientRect();
      var margin = 16, shadowRoom = 28;
      var top = Math.round(rect.bottom + 8);

      host.style.top = top + 'px';
      host.style.right = Math.round(window.innerWidth - rect.right) + 'px';
      host.style.left = 'auto';
      host.style.bottom = 'auto';

      var hostRect = host.getBoundingClientRect();
      var maxBottom = window.innerHeight - margin - shadowRoom;
      var overflow = hostRect.bottom - maxBottom;
      if (overflow > 0) {
        top = Math.max(margin, top - overflow);
        host.style.top = top + 'px';
      }

      applySinglePopupHeight(top);
    }

    function closeAll() {
      if (!state.notifications && !state.activities) return;
      state.notifications = false;
      state.activities = false;
      syncTriggers();
      if (root._activityPopups && root._activityPopups.onClose) root._activityPopups.onClose();
    }

    function onOpen(kind) {
      if (kind === 'notifications') {
        NOTIF().ensureLoaded({ limit: 20 });
        renderNotifications();
      } else {
        ACT().ensureLoaded({ limit: 25 });
        renderActivities();
        // Opening the panel means the user has now seen the activity (§12).
        ACT().markSeen();
      }
      syncBadges();
    }

    function openKind(kind) {
      state.notifications = kind === 'notifications';
      state.activities = kind === 'activities';
      syncTriggers();
      onOpen(kind);
      requestAnimationFrame(function () { positionPopups(); });
    }

    function toggle(kind) {
      var willOpen = !state[kind];
      // Single-open: opening one always closes the other.
      state.notifications = false;
      state.activities = false;
      state[kind] = willOpen;
      syncTriggers();
      if (willOpen) onOpen(kind);
    }

    if (notificationsBtn) {
      notificationsBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggle('notifications'); });
    }
    if (activitiesBtn) {
      activitiesBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggle('activities'); });
    }

    document.addEventListener('click', function (e) {
      if (!state.notifications && !state.activities) return;
      if (e.target.closest('[data-header-popups]')) return;
      if (e.target.closest('[data-action="toggle-notifications-popup"]')) return;
      if (e.target.closest('[data-action="toggle-activities-popup"]')) return;
      if (e.target.closest('.tma-dash__tab-btn[data-tab="alerts"]')) return;
      if (e.target.closest('.tma-dash__tab-btn[data-tab="messages"]')) return;
      closeAll();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (state.notifications || state.activities)) closeAll();
    });

    window.addEventListener('resize', function () {
      if (state.notifications || state.activities) positionPopups();
    });

    var themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    // Prime the badge counts so the bell/clock are accurate before first open.
    NOTIF().refreshCount();
    ACT().refreshCount();

    root._activityPopups = {
      toggle: toggle,
      close: closeAll,
      isOpen: function () { return state.notifications || state.activities; },
      openNotifications: function () { openKind('notifications'); },
      openActivities: function () { openKind('activities'); },
      getNotificationCount: function () { return NOTIF() ? NOTIF().getUnreadCount() : 0; },
      getActivityCount: function () { return ACT() ? ACT().getNewCount() : 0; },
      markAllNotificationsRead: function () { NOTIF().markAllRead(); },
      seeAllNotifications: seeAllNotifications,
      onClose: null,
    };

    syncTriggers();
    syncBadges();
  }

  window.TMAActivityPopups = {
    mount: mount,
    getNotificationCount: function () { return window.TMANotifications ? window.TMANotifications.getUnreadCount() : 0; },
    getActivityCount: function () { return window.TMAActivities ? window.TMAActivities.getNewCount() : 0; },
  };
})();
