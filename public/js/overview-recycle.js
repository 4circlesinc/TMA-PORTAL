/**
 * Overview → Recycle Bin (administrators only).
 * Soft-deleted files, folders, clients, signatures, groups, calendar events,
 * and message attachments. Email / chat messages themselves are excluded.
 *
 * Global: window.TMAOverviewRecycle
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/admin/recycle-bin';
  var ICON = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';

  var KIND_LABEL = {
    file: 'File',
    folder: 'Folder',
    client: 'Client',
    signature: 'Signature',
    group: 'Group',
    calendar_event: 'Calendar',
    message_attachment: 'Message file',
  };

  var KIND_ICON = {
    file: 'FileText',
    folder: 'Folder',
    client: 'UsersThree',
    signature: 'PenNib',
    group: 'UsersThree',
    calendar_event: 'CalendarBlank',
    message_attachment: 'Paperclip',
  };

  function api() { return window.TMANotifyAPI; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (e) {
      return '—';
    }
  }

  function mount(container) {
    if (!container) return;
    if (container._recycleMounted) {
      container._recycleReload && container._recycleReload();
      return;
    }
    container._recycleMounted = true;

    var state = {
      items: [],
      total: 0,
      loading: false,
      error: false,
      forbidden: false,
      search: '',
      kind: '',
      selected: {},
    };

    function qs(extra) {
      return api().qs(Object.assign({
        search: state.search || '',
        kind: state.kind || '',
      }, extra || {}));
    }

    function load() {
      if (!api()) {
        state.error = true;
        render();
        return;
      }
      state.loading = true;
      state.error = false;
      state.forbidden = false;
      render();
      api().api(BASE + qs()).then(function (data) {
        state.items = (data && data.items) || [];
        state.total = (data && data.total) || state.items.length;
        state.loading = false;
        render();
      }).catch(function (err) {
        state.loading = false;
        state.forbidden = !!(err && err.status === 403);
        state.error = !state.forbidden;
        render();
      });
    }

    container._recycleReload = load;

    function selectedKeys() {
      return Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
    }

    function rowKey(item) {
      return item.kind + ':' + item.id;
    }

    function restoreOne(item) {
      return api().api(BASE + '/' + encodeURIComponent(item.kind) + '/' + encodeURIComponent(item.id) + '/restore', {
        method: 'POST',
        json: {},
      });
    }

    function purgeOne(item) {
      return api().api(BASE + '/' + encodeURIComponent(item.kind) + '/' + encodeURIComponent(item.id), {
        method: 'DELETE',
      });
    }

    function toast(msg, stateName) {
      if (window.TMAToast && window.TMAToast.showFloatingToast) {
        window.TMAToast.showFloatingToast(msg, { state: stateName || 'positive' });
      }
    }

    function renderToolbar() {
      var count = selectedKeys().length;
      var kindOpts = [
        { value: '', label: 'All types' },
        { value: 'file', label: 'Files' },
        { value: 'folder', label: 'Folders' },
        { value: 'client', label: 'Clients' },
        { value: 'signature', label: 'Signatures' },
        { value: 'group', label: 'Groups' },
        { value: 'calendar_event', label: 'Calendar' },
        { value: 'message_attachment', label: 'Message files' },
      ].map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (state.kind === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('');

      return '<div class="tma-dash__overview-recycle-toolbar">' +
        '<div class="tma-dash__toolbar-search' + (state.search ? ' tma-dash__toolbar-search--has-value' : '') + '" role="search">' +
          '<img src="' + TMA + 'Search-16.svg" alt="">' +
          '<input type="search" class="tma-dash__search-input" placeholder="Search recycle bin" aria-label="Search recycle bin" value="' + esc(state.search) + '" data-recycle-search autocomplete="off">' +
        '</div>' +
        '<label class="tma-dash__overview-recycle-filter">' +
          '<select data-recycle-kind aria-label="Filter by type">' + kindOpts + '</select>' +
        '</label>' +
        '<div class="tma-dash__overview-recycle-actions">' +
          (count
            ? '<button type="button" class="tma-dash__overview-btn" data-recycle-bulk-restore>Restore (' + count + ')</button>' +
              '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--danger" data-recycle-bulk-purge>Delete forever (' + count + ')</button>'
            : '') +
          '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--danger" data-recycle-empty' +
            (state.items.length ? '' : ' disabled') + '>Empty bin</button>' +
        '</div>' +
      '</div>';
    }

    function renderRows() {
      if (state.loading) {
        return '<div class="tma-dash__overview-recycle-empty">' +
          (window.TMASkeleton ? window.TMASkeleton.rows(6) : 'Loading…') +
          '</div>';
      }
      if (state.forbidden) {
        return '<div class="tma-dash__overview-recycle-empty">' +
          '<p class="tma-dash__overview-recycle-empty-title">Administrators only</p>' +
          '<p>The firm-wide recycle bin is available to administrators.</p></div>';
      }
      if (state.error) {
        return '<div class="tma-dash__overview-recycle-empty">' +
          '<p class="tma-dash__overview-recycle-empty-title">Could not load recycle bin</p>' +
          '<button type="button" class="tma-dash__overview-btn" data-recycle-retry>Try again</button></div>';
      }
      if (!state.items.length) {
        return '<div class="tma-dash__overview-recycle-empty">' +
          '<img src="' + ICON + 'Trash.svg" alt="" width="48" height="48">' +
          '<p class="tma-dash__overview-recycle-empty-title">Recycle bin is empty</p>' +
          '<p>Deleted files, folders, clients, and more will appear here.</p></div>';
      }

      var rows = state.items.map(function (item) {
        var key = rowKey(item);
        var checked = !!state.selected[key];
        var icon = KIND_ICON[item.kind] || 'Trash';
        var kindLabel = KIND_LABEL[item.kind] || item.kind;
        var by = item.deletedBy && item.deletedBy.name ? item.deletedBy.name : '—';
        return '<div class="tma-dash__overview-recycle-row" role="row" data-recycle-row="' + esc(key) + '">' +
          '<label class="tma-dash__overview-recycle-check">' +
            '<input type="checkbox" data-recycle-check="' + esc(key) + '"' + (checked ? ' checked' : '') + ' aria-label="Select ' + esc(item.name) + '">' +
          '</label>' +
          '<span class="tma-dash__overview-recycle-icon" aria-hidden="true">' +
            '<img src="' + ICON + esc(icon) + '.svg" alt="" width="20" height="20">' +
          '</span>' +
          '<div class="tma-dash__overview-recycle-main">' +
            '<div class="tma-dash__overview-recycle-name">' + esc(item.name) + '</div>' +
            '<div class="tma-dash__overview-recycle-sub">' + esc(item.subtitle || kindLabel) + '</div>' +
          '</div>' +
          '<div class="tma-dash__overview-recycle-meta">' +
            '<span class="tma-dash__overview-recycle-kind">' + esc(kindLabel) + '</span>' +
            '<span class="tma-dash__overview-recycle-when" title="Deleted">' + esc(formatWhen(item.deletedAt)) + '</span>' +
            '<span class="tma-dash__overview-recycle-by" title="Deleted by">' + esc(by) + '</span>' +
          '</div>' +
          '<div class="tma-dash__overview-recycle-row-actions">' +
            '<button type="button" class="tma-dash__overview-btn" data-recycle-restore="' + esc(key) + '">Restore</button>' +
            '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--danger" data-recycle-purge="' + esc(key) + '">Delete forever</button>' +
          '</div>' +
        '</div>';
      }).join('');

      return '<div class="tma-dash__overview-recycle-list" role="table" aria-label="Recycle bin">' +
        '<div class="tma-dash__overview-recycle-head" role="row">' +
          '<span></span><span></span><span>Name</span>' +
          '<span class="tma-dash__overview-recycle-meta">' +
            '<span>Type</span><span>Deleted</span><span>By</span>' +
          '</span><span></span>' +
        '</div>' +
        rows +
        '<p class="tma-dash__overview-recycle-count">' + state.total + ' item' + (state.total === 1 ? '' : 's') + '</p>' +
      '</div>';
    }

    function render() {
      container.innerHTML =
        '<div class="tma-dash__overview-recycle" data-overview-recycle>' +
          '<div class="tma-dash__overview-recycle-intro">' +
            '<h2 class="tma-dash__overview-recycle-title">Recycle Bin</h2>' +
            '<p class="tma-dash__overview-recycle-desc">Everything soft-deleted across the portal (except email and chat messages). Message files are kept here.</p>' +
          '</div>' +
          renderToolbar() +
          renderRows() +
        '</div>';
    }

    function findItem(key) {
      for (var i = 0; i < state.items.length; i++) {
        if (rowKey(state.items[i]) === key) return state.items[i];
      }
      return null;
    }

    var searchTimer = null;
    container.addEventListener('input', function (e) {
      var input = e.target.closest('[data-recycle-search]');
      if (!input) return;
      state.search = input.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 180);
    });

    container.addEventListener('change', function (e) {
      var kind = e.target.closest('[data-recycle-kind]');
      if (kind) {
        state.kind = kind.value || '';
        load();
        return;
      }
      var check = e.target.closest('[data-recycle-check]');
      if (check) {
        state.selected[check.getAttribute('data-recycle-check')] = !!check.checked;
        render();
      }
    });

    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-recycle-retry]')) {
        load();
        return;
      }

      var restoreBtn = e.target.closest('[data-recycle-restore]');
      if (restoreBtn) {
        var rItem = findItem(restoreBtn.getAttribute('data-recycle-restore'));
        if (!rItem) return;
        restoreOne(rItem).then(function () {
          toast('Restored “' + rItem.name + '”');
          load();
        }).catch(function () {
          toast('Could not restore', 'negative');
        });
        return;
      }

      var purgeBtn = e.target.closest('[data-recycle-purge]');
      if (purgeBtn) {
        var pItem = findItem(purgeBtn.getAttribute('data-recycle-purge'));
        if (!pItem) return;
        if (!window.confirm('Permanently delete “' + pItem.name + '”? This cannot be undone.')) return;
        purgeOne(pItem).then(function () {
          toast('Permanently deleted', 'positive');
          load();
        }).catch(function () {
          toast('Could not delete', 'negative');
        });
        return;
      }

      if (e.target.closest('[data-recycle-bulk-restore]')) {
        var restoreList = selectedKeys().map(findItem).filter(Boolean);
        if (!restoreList.length) return;
        Promise.all(restoreList.map(restoreOne)).then(function () {
          toast('Restored ' + restoreList.length + ' item' + (restoreList.length === 1 ? '' : 's'));
          state.selected = {};
          load();
        }).catch(function () {
          toast('Could not restore some items', 'negative');
          load();
        });
        return;
      }

      if (e.target.closest('[data-recycle-bulk-purge]')) {
        var purgeList = selectedKeys().map(findItem).filter(Boolean);
        if (!purgeList.length) return;
        if (!window.confirm('Permanently delete ' + purgeList.length + ' item(s)? This cannot be undone.')) return;
        Promise.all(purgeList.map(purgeOne)).then(function () {
          toast('Permanently deleted');
          state.selected = {};
          load();
        }).catch(function () {
          toast('Could not delete some items', 'negative');
          load();
        });
        return;
      }

      if (e.target.closest('[data-recycle-empty]')) {
        if (!state.items.length) return;
        if (!window.confirm('Empty the entire recycle bin? Everything listed will be permanently deleted.')) return;
        api().api(BASE + '/empty', { method: 'POST', json: {} }).then(function () {
          toast('Recycle bin emptied');
          state.selected = {};
          load();
        }).catch(function () {
          toast('Could not empty recycle bin', 'negative');
        });
      }
    });

    render();
    load();
  }

  window.TMAOverviewRecycle = { mount: mount };
})();
