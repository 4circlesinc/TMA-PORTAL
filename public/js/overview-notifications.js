/*
 * TMA - Overview → Notifications tab: the complete notification inbox.
 *
 * Uses the shared TMANotifications store so counts stay consistent with the
 * right sidebar and header bell. Load-more pagination; mark-all-read; unread
 * filter. Rows open their action URL in place via the shell navigator.
 *
 * Global: window.TMAOverviewNotifications
 */
(function () {
  'use strict';

  function R() { return window.TMANotifyRender; }
  function Store() { return window.TMANotifications; }
  var ROOT = window.__TMA_SITE_ROOT || '';
  var TMA = 'images/icons/tma/';

  function esc(s) {
    return R() ? R().esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function mount(container) {
    if (!container || container.hasAttribute('data-notifpage-mounted')) return;
    container.setAttribute('data-notifpage-mounted', '');

    var state = {
      unreadOnly: false,
      search: '',
      searchFocused: false,
      searchTimer: null,
    };

    function navigate(url) {
      if (!url) return;
      var root = document.querySelector('.tma-dash');
      if (root && root._portalNavigate) root._portalNavigate(url);
      else window.location.assign(ROOT + url);
    }

    function countLabel(unread) {
      return unread ? unread + ' unread' : 'All caught up';
    }

    function head() {
      var s = Store().state;
      var unread = s.unread || 0;
      return '<div class="tma-dash__notifpage-head">' +
        '<h2 class="tma-dash__notifpage-title">Notifications</h2>' +
        '<span class="tma-dash__notifpage-count' + (unread ? '' : ' is-empty') + '" data-notifpage-count>' +
          esc(countLabel(unread)) +
        '</span>' +
      '</div>';
    }

    function toolbar() {
      var s = Store().state;
      var cls = ['tma-dash__toolbar-search'];
      if (state.searchFocused || state.search) cls.push('tma-dash__toolbar-search--focused');
      if (state.search) cls.push('tma-dash__toolbar-search--has-value');
      return '<div class="tma-dash__toolbar">' +
        '<div class="tma-dash__toolbar-actions">' +
          '<button type="button" class="tma-dash__tool-btn' + (state.unreadOnly ? ' is-active' : '') +
            '" data-notifpage-unread aria-pressed="' + (state.unreadOnly ? 'true' : 'false') + '" title="Unread only">' +
            '<img src="' + TMA + 'FunnelSimple-16.svg" alt="">' +
            (s.unread ? '<span class="tma-dash__actlog-filter-count">' + esc(String(s.unread)) + '</span>' : '') +
          '</button>' +
          '<button type="button" class="tma-dash__tool-btn" data-notifpage-read-all' +
            (s.unread ? '' : ' disabled') + ' title="Mark all as read">' +
            '<img src="images/icons/phosphor/Checks.svg" alt="">' +
          '</button>' +
        '</div>' +
        '<div class="' + cls.join(' ') + '" role="search">' +
          '<img src="' + TMA + 'Search-16.svg" alt="">' +
          '<input type="search" class="tma-dash__search-input" placeholder="Search notifications" aria-label="Search notifications" value="' +
            esc(state.search) + '" data-notifpage-search autocomplete="off" spellcheck="false">' +
          '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-notifpage-search-clear>' +
            '<img src="' + TMA + 'Xcircle.svg" alt=""></button>' +
        '</div>' +
      '</div>';
    }

    function bodyInner() {
      var s = Store().state;
      if (!s.loaded && s.loading) {
        return R() && R().skeleton ? R().skeleton(6) : '';
      }
      if (s.error && !s.items.length) {
        return window.TMASectionError
          ? window.TMASectionError.render({
              title: 'Unable to load notifications',
              message: 'Notifications could not be loaded.',
              showRetry: true,
              retryAttr: 'data-notifpage-retry',
            })
          : '<div class="tma-dash__actlog-empty">Could not load notifications. ' +
            '<button type="button" class="tma-dash__rb-retry" data-notifpage-retry>Retry</button></div>';
      }
      if (!s.items.length) {
        return window.TMANoData
          ? window.TMANoData.render({
              title: 'You are all caught up',
              subtitle: 'New notifications will appear here.',
              showButton: false,
              compact: true,
            })
          : '<div class="tma-dash__actlog-empty">You are all caught up.</div>';
      }
      var rows = s.items.map(function (it) {
        return R().notificationItem(it, 'popup');
      }).join('');
      var more = s.hasMore
        ? '<button type="button" class="tma-dash__actlog-more" data-notifpage-more' +
          (s.loading ? ' disabled' : '') + '>' + (s.loading ? 'Loading…' : 'Load more') + '</button>'
        : '';
      return '<div class="tma-dash__notifpage-list" role="list">' + rows + '</div>' + more;
    }

    function render() {
      container.className = 'tma-dash__activity tma-dash__activity--overview tma-dash__notifpage';
      container.innerHTML =
        head() +
        toolbar() +
        '<div class="tma-dash__notifpage-body" data-notifpage-body>' + bodyInner() + '</div>';
    }

    function renderBody() {
      var body = container.querySelector('[data-notifpage-body]');
      if (body) body.innerHTML = bodyInner();
      var countEl = container.querySelector('[data-notifpage-count]');
      if (countEl) {
        var unreadNow = Store().state.unread || 0;
        countEl.textContent = countLabel(unreadNow);
        countEl.classList.toggle('is-empty', !unreadNow);
      }
      var unreadBtn = container.querySelector('[data-notifpage-unread]');
      if (unreadBtn) {
        unreadBtn.classList.toggle('is-active', state.unreadOnly);
        unreadBtn.setAttribute('aria-pressed', state.unreadOnly ? 'true' : 'false');
        var badge = unreadBtn.querySelector('.tma-dash__actlog-filter-count');
        var unread = Store().state.unread;
        if (unread && !badge) {
          unreadBtn.insertAdjacentHTML('beforeend', '<span class="tma-dash__actlog-filter-count">' + esc(String(unread)) + '</span>');
        } else if (unread && badge) {
          badge.textContent = String(unread);
        } else if (!unread && badge) {
          badge.remove();
        }
      }
      var readAll = container.querySelector('[data-notifpage-read-all]');
      if (readAll) readAll.disabled = !Store().state.unread;
    }

    function reload() {
      Store().load({
        limit: 30,
        filters: {
          unread: state.unreadOnly,
          search: state.search || '',
        },
      });
    }

    Store().subscribe(function () {
      // Avoid rebuilding the search field mid-type.
      if (document.activeElement && container.contains(document.activeElement) &&
          document.activeElement.matches('[data-notifpage-search]')) {
        renderBody();
        return;
      }
      render();
    });

    container.addEventListener('input', function (e) {
      var s = e.target.closest('[data-notifpage-search]');
      if (!s) return;
      state.search = s.value;
      state.searchFocused = true;
      var wrap = container.querySelector('.tma-dash__toolbar-search');
      if (wrap) wrap.classList.toggle('tma-dash__toolbar-search--has-value', !!state.search);
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(reload, 220);
    });

    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-notifpage-unread]')) {
        state.unreadOnly = !state.unreadOnly;
        reload();
        return;
      }
      if (e.target.closest('[data-notifpage-read-all]')) {
        Store().markAllRead();
        return;
      }
      if (e.target.closest('[data-notifpage-search-clear]')) {
        state.search = '';
        render();
        reload();
        return;
      }
      if (e.target.closest('[data-notifpage-more]')) {
        Store().loadMore();
        return;
      }
      if (e.target.closest('[data-notifpage-retry]')) {
        reload();
        return;
      }

      var dismiss = e.target.closest('[data-notification-dismiss]');
      if (dismiss) {
        e.preventDefault();
        e.stopPropagation();
        Store().remove(dismiss.getAttribute('data-notification-dismiss'));
        return;
      }

      var notif = e.target.closest('[data-notification-id]');
      if (notif) {
        e.preventDefault();
        var id = notif.getAttribute('data-notification-id');
        var url = notif.getAttribute('data-action-url');
        Store().markRead(id);
        navigate(url);
      }
    });

    container.addEventListener('focusin', function (e) {
      if (e.target.closest('[data-notifpage-search]')) state.searchFocused = true;
    });
    container.addEventListener('focusout', function (e) {
      if (e.target.closest('[data-notifpage-search]')) state.searchFocused = false;
    });

    render();
    reload();
  }

  window.TMAOverviewNotifications = { mount: mount };
})();
