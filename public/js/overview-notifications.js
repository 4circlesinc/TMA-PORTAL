/*
 * TMA - Overview → Notifications tab: the complete notification inbox.
 *
 * Uses the shared TMANotifications store so counts stay consistent with the
 * right sidebar and header bell. Load-more pagination; mark-all-read; unread
 * filter; bulk selection. Rows open their action URL in place via the shell
 * navigator.
 *
 * The toolbar deliberately mirrors the Users table — same
 * .tma-dash__toolbar / .tma-dash__tool-btn / .tma-dash__check parts, same
 * "N Selected" bulk group that appears only once something is picked.
 *
 * Global: window.TMAOverviewNotifications
 */
(function () {
  'use strict';

  function R() { return window.TMANotifyRender; }
  function Store() { return window.TMANotifications; }
  var ROOT = window.__TMA_SITE_ROOT || '';
  var TMA = 'images/icons/tma/';
  var ICON = 'images/icons/phosphor/';

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
      // id -> true. Kept across re-renders, pruned against the loaded list so a
      // filter change can never act on a row that is no longer on screen.
      selected: {},
    };

    function items() { return Store().state.items || []; }

    function pruneSelection() {
      var live = {};
      items().forEach(function (it) { live[it.id] = true; });
      Object.keys(state.selected).forEach(function (id) {
        if (!live[id]) delete state.selected[id];
      });
    }

    function selectedIds() {
      pruneSelection();
      return Object.keys(state.selected);
    }

    function navigate(url) {
      if (!url) return;
      var root = document.querySelector('.tma-dash');
      if (root && root._portalNavigate) root._portalNavigate(url);
      else window.location.assign(ROOT + url);
    }

    /*
     * The one count on this screen, and the only place it is stated: how many
     * of the caller's notifications are still unread, straight from the store
     * (which is the same number the bell and the sidebar render). It is not
     * repeated on the filter button — a badge there read as "how many rows this
     * filter would show", which it never was.
     */
    function countLabel() {
      var unread = Store().state.unread || 0;
      if (!unread) return 'All caught up';
      return unread + ' unread';
    }

    function head() {
      var unread = Store().state.unread || 0;
      return '<div class="tma-dash__notifpage-head">' +
        '<h2 class="tma-dash__notifpage-title">Notifications</h2>' +
        '<span class="tma-dash__notifpage-count' + (unread ? '' : ' is-empty') + '" data-notifpage-count ' +
          'aria-live="polite">' + esc(countLabel()) + '</span>' +
      '</div>';
    }

    function bulkBtn(action, icon, label) {
      return '<button type="button" class="tma-dash__tool-btn" data-notifpage-bulk="' + action + '" ' +
        'aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        '<img src="' + icon + '" alt=""></button>';
    }

    function toolbar() {
      var s = Store().state;
      var cls = ['tma-dash__toolbar-search'];
      if (state.searchFocused || state.search) cls.push('tma-dash__toolbar-search--focused');
      if (state.search) cls.push('tma-dash__toolbar-search--has-value');

      var picked = selectedIds().length;
      var total = items().length;
      var allPicked = total > 0 && picked === total;
      var selectionLabel = picked === 1 ? '1 Selected' : picked + ' Selected';

      return '<div class="tma-dash__toolbar' + (picked ? ' tma-dash__toolbar--selected' : '') + '">' +
        '<div class="tma-dash__toolbar-actions">' +
          '<label class="tma-dash__notifpage-selectall">' +
            '<input type="checkbox" class="tma-dash__check" data-notifpage-selectall' +
              (allPicked ? ' checked' : '') + (picked && !allPicked ? ' data-indeterminate' : '') +
              (total ? '' : ' disabled') + ' aria-label="Select all notifications">' +
          '</label>' +
          '<button type="button" class="tma-dash__tool-btn' + (state.unreadOnly ? ' is-active' : '') +
            '" data-notifpage-unread aria-pressed="' + (state.unreadOnly ? 'true' : 'false') + '" title="Unread only">' +
            '<img src="' + TMA + 'FunnelSimple-16.svg" alt="">' +
          '</button>' +
          '<button type="button" class="tma-dash__tool-btn" data-notifpage-read-all' +
            (s.unread ? '' : ' disabled') + ' title="Mark all as read">' +
            '<img src="' + ICON + 'Checks.svg" alt="">' +
          '</button>' +
          '<div class="tma-dash__toolbar-bulk" data-notifpage-bulkbar' + (picked ? '' : ' hidden') + '>' +
            '<img class="tma-dash__toolbar-divider" src="' + TMA + 'Line.svg" alt="" aria-hidden="true">' +
            '<span class="tma-dash__toolbar-selection" data-notifpage-selection aria-live="polite">' +
              esc(selectionLabel) + '</span>' +
            bulkBtn('read', ICON + 'EnvelopeSimpleOpen.svg', 'Mark selected as read') +
            bulkBtn('unread', ICON + 'EnvelopeSimple.svg', 'Mark selected as unread') +
            bulkBtn('delete', ICON + 'Trash.svg', 'Delete selected') +
          '</div>' +
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
      // The checkbox is wrapped around the shared row rather than built into
      // it: the bell popup and the right sidebar render the same component and
      // have nothing to select.
      var rows = s.items.map(function (it) {
        var picked = !!state.selected[it.id];
        return '<div class="tma-dash__notifpage-row' + (picked ? ' is-selected' : '') + '">' +
          '<input type="checkbox" class="tma-dash__check" data-notifpage-check="' + esc(it.id) + '"' +
            (picked ? ' checked' : '') + ' aria-label="Select notification">' +
          R().notificationItem(it, 'popup') +
        '</div>';
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
      syncSelectAll();
    }

    /* The "some but not all" state has no HTML attribute — it is a property. */
    function syncSelectAll() {
      var all = container.querySelector('[data-notifpage-selectall]');
      if (!all) return;
      var picked = selectedIds().length;
      var total = items().length;
      all.checked = total > 0 && picked === total;
      all.indeterminate = picked > 0 && picked < total;
    }

    function syncCount() {
      var countEl = container.querySelector('[data-notifpage-count]');
      if (!countEl) return;
      countEl.textContent = countLabel();
      countEl.classList.toggle('is-empty', !(Store().state.unread || 0));
    }

    /* Toolbar bits that change without the list being rebuilt. */
    function syncToolbar() {
      syncCount();
      var picked = selectedIds().length;
      var bulkbar = container.querySelector('[data-notifpage-bulkbar]');
      var label = container.querySelector('[data-notifpage-selection]');
      var toolbarEl = container.querySelector('.tma-dash__toolbar');
      if (bulkbar) bulkbar.hidden = picked === 0;
      if (label) label.textContent = picked === 1 ? '1 Selected' : picked + ' Selected';
      if (toolbarEl) toolbarEl.classList.toggle('tma-dash__toolbar--selected', picked > 0);

      var unreadBtn = container.querySelector('[data-notifpage-unread]');
      if (unreadBtn) {
        unreadBtn.classList.toggle('is-active', state.unreadOnly);
        unreadBtn.setAttribute('aria-pressed', state.unreadOnly ? 'true' : 'false');
      }
      var readAll = container.querySelector('[data-notifpage-read-all]');
      if (readAll) readAll.disabled = !Store().state.unread;
      syncSelectAll();
    }

    function renderBody() {
      var body = container.querySelector('[data-notifpage-body]');
      if (body) body.innerHTML = bodyInner();
      syncToolbar();
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

    container.addEventListener('change', function (e) {
      var all = e.target.closest('[data-notifpage-selectall]');
      if (all) {
        state.selected = {};
        if (all.checked) items().forEach(function (it) { state.selected[it.id] = true; });
        container.querySelectorAll('[data-notifpage-check]').forEach(function (cb) {
          cb.checked = all.checked;
          var row = cb.closest('.tma-dash__notifpage-row');
          if (row) row.classList.toggle('is-selected', all.checked);
        });
        syncToolbar();
        return;
      }

      var check = e.target.closest('[data-notifpage-check]');
      if (check) {
        var id = check.getAttribute('data-notifpage-check');
        if (check.checked) state.selected[id] = true;
        else delete state.selected[id];
        var rowEl = check.closest('.tma-dash__notifpage-row');
        if (rowEl) rowEl.classList.toggle('is-selected', check.checked);
        syncToolbar();
      }
    });

    container.addEventListener('click', function (e) {
      // A click on a checkbox (or its row padding) must never also open the
      // notification underneath it.
      if (e.target.closest('[data-notifpage-check], [data-notifpage-selectall]')) {
        e.stopPropagation();
        return;
      }

      var bulk = e.target.closest('[data-notifpage-bulk]');
      if (bulk) {
        var ids = selectedIds();
        if (!ids.length) return;
        var action = bulk.getAttribute('data-notifpage-bulk');
        state.selected = {};
        Store().bulk(ids, action);
        return;
      }

      if (e.target.closest('[data-notifpage-unread]')) {
        state.unreadOnly = !state.unreadOnly;
        state.selected = {};
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
