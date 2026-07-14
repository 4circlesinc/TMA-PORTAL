/*
 * TMA - Notifications & Activities header popups (Figma 32546:96099)
 * Global: window.TMAActivityPopups
 */
(function () {
  'use strict';

  var AVATAR = '/TMA-PORTAL/images/avatars/';
  var ICON = '/TMA-PORTAL/images/icons/phosphor/';

  var NOTIFICATIONS = [
    { id: 'n1', icon: 'BugBeetle', title: 'You fixed a bug.', meta: 'Just now', read: false },
    { id: 'n2', icon: 'User', title: 'New user registered.', meta: '59 minutes ago', read: false },
    { id: 'n3', icon: 'BugBeetle', title: 'You fixed a bug.', meta: '12 hours ago', read: false },
    { id: 'n4', icon: 'Broadcast', title: 'Andi Lane subscribed to you.', meta: 'Today, 11:59 AM', read: false },
    { id: 'n5', icon: 'BugBeetle', title: 'You have a bug that needs to be fixed.', meta: 'Yesterday', read: false },
    { id: 'n6', icon: 'User', title: 'New user registered', meta: 'Feb 4, 2026', read: false },
    { id: 'n7', icon: 'Bell', title: 'Reminder: team standup in 15 minutes.', meta: 'Feb 3, 2026', read: false },
    { id: 'n8', icon: 'Broadcast', title: 'Andi Lane subscribed to you', meta: 'Feb 2, 2026', read: false },
  ];

  function getNotificationCount() {
    return NOTIFICATIONS.filter(function (item) { return !item.read; }).length;
  }

  function getActivityCount() {
    return ACTIVITIES.length;
  }

  var ACTIVITIES = [
    { avatar: 'AvatarAbstract03', title: 'Changed the style.', meta: 'Just now' },
    { avatar: 'AvatarFemale03', title: 'Released a new version.', meta: '59 minutes ago' },
    { avatar: 'AvatarMale02', title: 'Submitted a bug.', meta: '12 hours ago' },
    { avatar: 'Avatar3d03', title: 'Modified A data in Page X.', meta: 'Today, 11:59 AM' },
    { avatar: 'AvatarAbstract04', title: 'Deleted a page in Project X.', meta: 'Feb 2, 2026' },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderNotificationItem(item) {
    var cls = 'tma-dash__header-popup-item';
    if (!item.read) cls += ' tma-dash__header-popup-item--unread';
    return (
      '<button type="button" class="' + cls + '" data-notification-id="' + esc(item.id) + '">' +
      '<span class="tma-dash__header-popup-icon" aria-hidden="true">' +
      '<img src="' + ICON + esc(item.icon) + '.svg" alt="">' +
      '</span>' +
      '<div class="tma-dash__header-popup-copy">' +
      '<div class="tma-dash__header-popup-title">' + esc(item.title) + '</div>' +
      '<div class="tma-dash__header-popup-meta">' + esc(item.meta) + '</div>' +
      '</div></button>'
    );
  }

  function renderActivityItem(item) {
    return (
      '<div class="tma-dash__header-popup-item">' +
      '<span class="tma-dash__header-popup-avatar" aria-hidden="true">' +
      '<img src="' + AVATAR + esc(item.avatar) + '.png" alt="">' +
      '</span>' +
      '<div class="tma-dash__header-popup-copy">' +
      '<div class="tma-dash__header-popup-title">' + esc(item.title) + '</div>' +
      '<div class="tma-dash__header-popup-meta">' + esc(item.meta) + '</div>' +
      '</div></div>'
    );
  }

  function renderNotificationsPanel() {
    var hasUnread = NOTIFICATIONS.some(function (item) { return !item.read; });
    return (
      '<section class="tma-dash__header-popup tma-dash__header-popup--notifications" data-popup-panel="notifications" data-node-id="33296:181107" hidden aria-label="Notifications">' +
      '<div class="tma-dash__header-popup-head">' +
      '<h2 class="tma-dash__header-popup-heading">Notifications</h2>' +
      '<button type="button" class="tma-dash__header-popup-action" data-popup-action="mark-notifications-read"' +
      (hasUnread ? '' : ' disabled') +
      '>Mark all as read</button>' +
      '</div>' +
      '<div class="tma-dash__header-popup-list">' + NOTIFICATIONS.map(renderNotificationItem).join('') + '</div>' +
      '<div class="tma-dash__header-popup-foot">' +
      '<button type="button" class="tma-dash__header-popup-action tma-dash__header-popup-action--footer" data-popup-action="see-all-notifications">See all notifications</button>' +
      '</div>' +
      '</section>'
    );
  }

  function renderPanel(kind, title, bodyHtml) {
    return (
      '<section class="tma-dash__header-popup" data-popup-panel="' + kind + '" data-node-id="' +
      (kind === 'notifications' ? '33296:181107' : '33296:146832') +
      '" hidden aria-label="' + esc(title) + '">' +
      '<h2 class="tma-dash__header-popup-heading">' + esc(title) + '</h2>' +
      '<div class="tma-dash__header-popup-list">' + bodyHtml + '</div>' +
      '</section>'
    );
  }

  function mount(root) {
    var host = root.querySelector('[data-header-popups]');
    if (!host) return;

    if (host.parentNode !== document.body) {
      document.body.appendChild(host);
    }

    host.setAttribute('data-node-id', '32546:96099');
    host.innerHTML =
      renderNotificationsPanel() +
      renderPanel('activities', 'Activities', ACTIVITIES.map(renderActivityItem).join(''));

    var state = { notifications: false, activities: false };
    var notificationsBtn = root.querySelector('[data-action="toggle-notifications-popup"]');
    var activitiesBtn = root.querySelector('[data-action="toggle-activities-popup"]');
    var notificationsPanel = host.querySelector('[data-popup-panel="notifications"]');
    var activitiesPanel = host.querySelector('[data-popup-panel="activities"]');

    function syncBadgeCounts() {
      if (root._syncTabBarBadges) root._syncTabBarBadges();
    }

    function refreshNotificationsPanel() {
      if (!notificationsPanel) return;
      var list = notificationsPanel.querySelector('.tma-dash__header-popup-list');
      var markBtn = notificationsPanel.querySelector('[data-popup-action="mark-notifications-read"]');
      if (list) list.innerHTML = NOTIFICATIONS.map(renderNotificationItem).join('');
      if (markBtn) markBtn.disabled = !NOTIFICATIONS.some(function (item) { return !item.read; });
    }

    function markAllNotificationsRead() {
      NOTIFICATIONS.forEach(function (item) { item.read = true; });
      refreshNotificationsPanel();
      syncBadgeCounts();
    }

    function markNotificationRead(id) {
      var item = NOTIFICATIONS.find(function (entry) { return entry.id === id; });
      if (!item || item.read) return;
      item.read = true;
      refreshNotificationsPanel();
      syncBadgeCounts();
    }

    function seeAllNotifications() {
      closeAll();
      if (window.innerWidth <= 1024) {
        root.classList.remove('is-nav-open');
        root.classList.add('is-rb-open');
      } else {
        root.classList.remove('is-rightbar-collapsed');
      }
      var rightbar = root.querySelector('.tma-dash__rightbar');
      if (!rightbar) return;
      rightbar.scrollTop = 0;
      var section = rightbar.querySelector('.tma-dash__rb-section');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    host.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-popup-action]');
      if (actionBtn) {
        e.preventDefault();
        var action = actionBtn.getAttribute('data-popup-action');
        if (action === 'mark-notifications-read') markAllNotificationsRead();
        if (action === 'see-all-notifications') seeAllNotifications();
        return;
      }
      var itemBtn = e.target.closest('[data-notification-id]');
      if (itemBtn) {
        e.preventDefault();
        markNotificationRead(itemBtn.getAttribute('data-notification-id'));
      }
    });

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
      var openCount = (state.notifications ? 1 : 0) + (state.activities ? 1 : 0);
      host.hidden = !anyOpen;
      host.classList.toggle('tma-dash__header-popups--single', openCount === 1);
      host.classList.toggle('tma-dash__header-popups--both', openCount === 2);
      if (notificationsPanel) notificationsPanel.hidden = !state.notifications;
      if (activitiesPanel) activitiesPanel.hidden = !state.activities;
      if (anyOpen) {
        requestAnimationFrame(positionPopups);
      } else {
        clearPopupHeights();
      }
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
      var openCount = (state.notifications ? 1 : 0) + (state.activities ? 1 : 0);
      if (openCount !== 1) return;

      var panel = state.notifications ? notificationsPanel : activitiesPanel;
      if (!panel || panel.hidden) return;

      var margin = 16;
      var shadowRoom = 28;
      var hostPadding = 40;
      var available = window.innerHeight - top - margin - shadowRoom - hostPadding;
      var minHeight = Math.max(320, Math.min(available, 560));
      panel.style.minHeight = minHeight + 'px';
      if (state.notifications) panel.style.height = minHeight + 'px';
    }

    function positionPopups(anchorEl) {
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
      var margin = 16;
      var shadowRoom = 28;
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

    function openKind(kind) {
      state.notifications = kind === 'notifications';
      state.activities = kind === 'activities';
      syncTriggers();
      requestAnimationFrame(function () { positionPopups(); });
    }

    function toggle(kind) {
      if (kind === 'notifications') state.notifications = !state.notifications;
      if (kind === 'activities') state.activities = !state.activities;
      syncTriggers();
    }

    if (notificationsBtn) {
      notificationsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggle('notifications');
      });
    }

    if (activitiesBtn) {
      activitiesBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggle('activities');
      });
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

    root._activityPopups = {
      toggle: toggle,
      close: closeAll,
      isOpen: function () { return state.notifications || state.activities; },
      openNotifications: function () { openKind('notifications'); },
      openActivities: function () { openKind('activities'); },
      getNotificationCount: getNotificationCount,
      getActivityCount: getActivityCount,
      markAllNotificationsRead: markAllNotificationsRead,
      seeAllNotifications: seeAllNotifications,
      onClose: null,
    };

    syncTriggers();
  }

  window.TMAActivityPopups = {
    mount: mount,
    getNotificationCount: getNotificationCount,
    getActivityCount: getActivityCount,
  };
})();
