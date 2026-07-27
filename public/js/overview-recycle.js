/**
 * Overview → Recycle Bin (administrators only).
 * Uses the same overview table chrome as Files / Activity, with real file
 * icons / thumbs, folder colours, and people avatars.
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

  function avatarSrc(avatar, name) {
    if (window.TMACurrentUser && TMACurrentUser.avatarSrc) {
      return TMACurrentUser.avatarSrc(avatar, name);
    }
    if (window.TMANotifyRender && TMANotifyRender.initialsUri) {
      return (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar))
        ? avatar
        : TMANotifyRender.initialsUri(name || 'User');
    }
    if (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar)) return avatar;
    return ICON + 'User.svg';
  }

  function fileIconSrc(icon, name) {
    if (window.TMAFileIcons && TMAFileIcons.fileIconSrc) {
      return TMAFileIcons.fileIconSrc(icon, name);
    }
    return ICON + 'File.svg';
  }

  function toneFor(ext, category) {
    ext = String(ext || '').toLowerCase();
    category = String(category || '').toLowerCase();
    if (ext === 'pdf' || category === 'pdf') return 'red';
    if (/^(doc|docx)$/.test(ext) || category === 'word' || category === 'document') return 'blue';
    if (/^(xls|xlsx|csv)$/.test(ext) || category === 'excel' || category === 'spreadsheet') return 'green';
    if (/^(png|jpe?g|gif|webp|svg)$/.test(ext) || category === 'image') return 'purple';
    return 'grey';
  }

  function itemVisual(item) {
    var meta = item.meta || {};
    var kind = item.kind;

    if (kind === 'folder') {
      var html = window.TMAFolderIcons
        ? window.TMAFolderIcons.html('FolderFilled', meta.colour, meta.iconName, 24)
        : '<img src="' + ICON + 'Folder.svg" alt="" width="24" height="24">';
      return { html: html, tone: '' };
    }

    if (kind === 'client') {
      var photo = meta.avatarUrl;
      var src = avatarSrc(photo, item.name);
      return {
        html: '<img class="tma-dash__overview-recycle-avatar" src="' + esc(src) + '" alt="" width="24" height="24">',
        tone: '',
      };
    }

    if (kind === 'file' || kind === 'message_attachment') {
      var icon = meta.icon || (window.TMAFileIcons && TMAFileIcons.iconKeyFor
        ? TMAFileIcons.iconKeyFor(item.name)
        : 'File');
      var fallback = fileIconSrc(icon, item.name);
      var tone = toneFor(meta.extension, meta.category);
      if (meta.thumbUrl) {
        return {
          html: '<img class="tma-dash__overview-recycle-thumb" src="' + esc(meta.thumbUrl) + '" alt="" width="24" height="24" loading="lazy"' +
            ' onerror="this.onerror=null;this.src=\'' + esc(fallback) + '\'">',
          tone: tone,
        };
      }
      return {
        html: '<img src="' + esc(fallback) + '" alt="" width="16" height="16">',
        tone: tone,
      };
    }

    var glyph = meta.icon || (
      kind === 'signature' ? 'PenNib'
        : kind === 'group' ? 'UsersThree'
          : kind === 'calendar_event' ? 'CalendarBlank'
            : 'Trash'
    );
    return {
      html: '<img src="' + ICON + esc(glyph) + '.svg" alt="" width="16" height="16">',
      tone: 'grey',
    };
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
      searchFocused: false,
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

    function rowKey(item) {
      return item.kind + ':' + item.id;
    }

    function selectedKeys() {
      return Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
    }

    function findItem(key) {
      for (var i = 0; i < state.items.length; i++) {
        if (rowKey(state.items[i]) === key) return state.items[i];
      }
      return null;
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

    function renderSearchBar() {
      var classes = ['tma-dash__toolbar-search'];
      if (state.searchFocused || state.search) classes.push('tma-dash__toolbar-search--focused');
      if (state.search) classes.push('tma-dash__toolbar-search--has-value');
      return '<div class="' + classes.join(' ') + '" role="search">' +
        '<img src="' + TMA + 'Search-16.svg" alt="">' +
        '<input type="search" class="tma-dash__search-input" placeholder="Search" aria-label="Search recycle bin" value="' + esc(state.search) + '" data-recycle-search autocomplete="off" spellcheck="false">' +
        (state.search
          ? '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-recycle-search-clear><img src="' + TMA + 'Xcircle.svg" alt=""></button>'
          : '') +
      '</div>';
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

      return '<div class="tma-dash__toolbar' + (count ? ' tma-dash__toolbar--selected' : '') + '">' +
        '<div class="tma-dash__toolbar-actions">' +
          '<label class="tma-dash__overview-recycle-filter">' +
            '<select class="tma-dash__overview-recycle-select" data-recycle-kind aria-label="Filter by type">' + kindOpts + '</select>' +
          '</label>' +
          '<div class="tma-dash__toolbar-bulk" data-recycle-bulk' + (count ? '' : ' hidden') + '>' +
            '<img class="tma-dash__toolbar-divider" src="' + TMA + 'Line-16.svg" alt="" aria-hidden="true">' +
            '<span class="tma-dash__toolbar-selection" aria-live="polite">' +
              (count === 1 ? '1 Selected' : count + ' Selected') +
            '</span>' +
            '<button type="button" class="tma-dash__tool-btn" data-recycle-bulk-restore aria-label="Restore selected">' +
              '<img src="' + ICON + 'ArrowCounterClockwise.svg" alt="" width="16" height="16">' +
            '</button>' +
            '<button type="button" class="tma-dash__tool-btn" data-recycle-bulk-purge aria-label="Delete selected forever">' +
              '<img src="' + ICON + 'Trash.svg" alt="" width="16" height="16">' +
            '</button>' +
          '</div>' +
          '<button type="button" class="tma-dash__tool-btn" data-recycle-empty aria-label="Empty recycle bin"' +
            (state.items.length ? '' : ' disabled') + '>' +
            '<img src="' + ICON + 'Trash.svg" alt="" width="16" height="16">' +
          '</button>' +
        '</div>' +
        renderSearchBar() +
      '</div>';
    }

    function renderRow(item) {
      var key = rowKey(item);
      var checked = !!state.selected[key];
      var visual = itemVisual(item);
      var kindLabel = KIND_LABEL[item.kind] || item.kind;
      var by = item.deletedBy || {};
      var byName = by.name || '—';
      var byAvatar = avatarSrc(by.avatar, byName);
      var sizeLabel = (item.meta && item.meta.sizeLabel) || '—';
      var iconWrap = visual.tone
        ? '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + esc(visual.tone) + '">' + visual.html + '</span>'
        : '<span class="tma-dash__overview-recycle-visual">' + visual.html + '</span>';

      return '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' +
        (checked ? ' tma-dash__ctr--selected' : '') + '" role="row" data-recycle-row="' + esc(key) + '">' +
        '<div class="tma-dash__cc tma-dash__cc--check">' +
          '<input type="checkbox" class="tma-dash__check" data-recycle-check="' + esc(key) + '"' +
            (checked ? ' checked' : '') + ' aria-label="Select ' + esc(item.name) + '">' +
        '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--filename">' +
          iconWrap +
          '<span class="tma-dash__cc-truncate" title="' + esc(item.name) + '">' + esc(item.name) + '</span>' +
        '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--type"><span class="tma-dash__cc-truncate">' + esc(kindLabel) + '</span></div>' +
        '<div class="tma-dash__cc tma-dash__cc--size"><span class="tma-dash__cc-truncate">' + esc(sizeLabel) + '</span></div>' +
        '<div class="tma-dash__cc tma-dash__cc--uploader">' +
          '<span class="tma-dash__files-uploader-btn" aria-hidden="true">' +
            '<img src="' + esc(byAvatar) + '" alt="">' +
          '</span>' +
          '<span class="tma-dash__cc-truncate">' + esc(byName) + '</span>' +
        '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date">' +
          '<img src="' + ICON + 'CalendarBlank.svg" alt="" width="16" height="16">' +
          '<span class="tma-dash__cc-truncate">' + esc(formatWhen(item.deletedAt)) + '</span>' +
        '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--actions">' +
          '<button type="button" class="tma-dash__row-more" data-recycle-restore="' + esc(key) + '" aria-label="Restore ' + esc(item.name) + '" title="Restore">' +
            '<img src="' + ICON + 'ArrowCounterClockwise.svg" alt="" width="16" height="16">' +
          '</button>' +
          '<button type="button" class="tma-dash__row-more" data-recycle-purge="' + esc(key) + '" aria-label="Delete ' + esc(item.name) + ' forever" title="Delete forever">' +
            '<img src="' + ICON + 'Trash.svg" alt="" width="16" height="16">' +
          '</button>' +
        '</div>' +
      '</div>';
    }

    function renderTable() {
      if (state.loading) {
        return '<div class="tma-dash__files-empty">' +
          (window.TMASkeleton ? window.TMASkeleton.rows(6) : 'Loading…') +
          '</div>';
      }
      if (state.forbidden) {
        return window.TMANoData
          ? window.TMANoData.render({
              illustrationName: 'Illustration07',
              title: 'Administrators only',
              subtitle: 'The firm-wide recycle bin is available to administrators.',
              showButton: false,
            })
          : '<p class="tma-dash__overview-empty">Administrators only</p>';
      }
      if (state.error) {
        return '<div class="tma-dash__files-empty">' +
          '<p class="tma-dash__overview-empty">Could not load recycle bin</p>' +
          '<button type="button" class="tma-dash__overview-btn" data-recycle-retry>Try again</button>' +
          '</div>';
      }
      if (!state.items.length) {
        return window.TMANoData
          ? window.TMANoData.render({
              illustrationName: 'Illustration07',
              title: 'Recycle bin is empty',
              subtitle: 'Deleted files, folders, clients, and more will appear here.',
              showButton: false,
            })
          : '<p class="tma-dash__overview-empty">Recycle bin is empty</p>';
      }

      var allChecked = state.items.length && state.items.every(function (item) {
        return !!state.selected[rowKey(item)];
      });

      return '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Recycle bin">' +
        '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview" role="row">' +
          '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head">' +
            '<input type="checkbox" class="tma-dash__check" data-recycle-selectall aria-label="Select all"' +
              (allChecked ? ' checked' : '') + '>' +
          '</div>' +
          '<div class="tma-dash__cc tma-dash__cc--filename tma-dash__cc--head">Name</div>' +
          '<div class="tma-dash__cc tma-dash__cc--type tma-dash__cc--head">Type</div>' +
          '<div class="tma-dash__cc tma-dash__cc--size tma-dash__cc--head">Size</div>' +
          '<div class="tma-dash__cc tma-dash__cc--uploader tma-dash__cc--head">Deleted by</div>' +
          '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Deleted</div>' +
          '<div class="tma-dash__cc tma-dash__cc--actions tma-dash__cc--head" aria-hidden="true"></div>' +
        '</div>' +
        '<div data-recycle-body>' +
          state.items.map(renderRow).join('') +
        '</div>' +
      '</div>';
    }

    function render() {
      container.innerHTML =
        '<div class="tma-dash__files tma-dash__files--overview tma-dash__recycle--overview" data-overview-recycle>' +
          renderToolbar() +
          renderTable() +
        '</div>';
    }

    var searchTimer = null;
    container.addEventListener('input', function (e) {
      var input = e.target.closest('[data-recycle-search]');
      if (!input) return;
      state.search = input.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 180);
    });

    container.addEventListener('focusin', function (e) {
      if (e.target.closest('[data-recycle-search]')) state.searchFocused = true;
    });
    container.addEventListener('focusout', function (e) {
      if (e.target.closest('[data-recycle-search]')) state.searchFocused = false;
    });

    container.addEventListener('change', function (e) {
      var kind = e.target.closest('[data-recycle-kind]');
      if (kind) {
        state.kind = kind.value || '';
        load();
        return;
      }
      var selectAll = e.target.closest('[data-recycle-selectall]');
      if (selectAll) {
        var on = !!selectAll.checked;
        state.selected = {};
        if (on) {
          state.items.forEach(function (item) { state.selected[rowKey(item)] = true; });
        }
        render();
        return;
      }
      var check = e.target.closest('[data-recycle-check]');
      if (check) {
        state.selected[check.getAttribute('data-recycle-check')] = !!check.checked;
        render();
      }
    });

    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-recycle-search-clear]')) {
        state.search = '';
        load();
        return;
      }
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
          toast('Permanently deleted');
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
