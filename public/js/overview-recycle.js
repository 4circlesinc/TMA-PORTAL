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

  var KIND_FILTERS = [
    { value: '', label: 'All types' },
    { value: 'file', label: 'Files' },
    { value: 'folder', label: 'Folders' },
    { value: 'client', label: 'Clients' },
    { value: 'signature', label: 'Signatures' },
    { value: 'group', label: 'Groups' },
    { value: 'calendar_event', label: 'Calendar' },
    { value: 'message_attachment', label: 'Message files' },
  ];

  function api() { return window.TMANotifyAPI; }

  function toolBtn(icon, attr, label, opts) {
    opts = opts || {};
    return '<button type="button" class="tma-dash__tool-btn' + (opts.active ? ' is-active' : '') + '"' +
      (attr ? ' ' + attr : '') +
      (opts.disabled ? ' disabled' : '') +
      ' aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
      (opts.pressed != null ? ' aria-pressed="' + opts.pressed + '"' : '') + '>' +
      '<img src="' + ICON + esc(icon) + '.svg" alt=""></button>';
  }

  function toolMenu(btnAttr, aria, items, current, menuLabel) {
    var menuItems = items.map(function (it) {
      var active = String(it.value) === String(current) ? ' tma-dash__menu-item--active' : '';
      return '<button type="button" class="tma-dash__menu-item' + active + '" role="menuitem" data-head-dropdown-item="' +
        esc(it.value) + '">' + esc(it.label) + '</button>';
    }).join('');
    return '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap ' + btnAttr + '>' +
      '<button type="button" class="tma-dash__tool-btn" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(aria) + '">' +
      '<img src="' + TMA + 'FunnelSimple-16.svg" alt=""></button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--start" data-head-dropdown-menu hidden role="menu" aria-label="' + esc(menuLabel) + '">' +
      menuItems +
      '</div></div>';
  }

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

  function itemVisual(item, size) {
    var meta = item.meta || {};
    var kind = item.kind;
    var px = size || 24;
    var iconPx = px >= 40 ? 40 : 16;

    if (kind === 'folder') {
      var html = window.TMAFolderIcons
        ? window.TMAFolderIcons.html('FolderFilled', meta.colour, meta.iconName, px)
        : '<img src="' + ICON + 'Folder.svg" alt="" width="' + px + '" height="' + px + '">';
      return { html: html, tone: '' };
    }

    if (kind === 'client') {
      var photo = meta.avatarUrl;
      var src = avatarSrc(photo, item.name);
      return {
        html: '<img class="tma-dash__overview-recycle-avatar' + (px >= 40 ? ' tma-dash__overview-recycle-avatar--lg' : '') +
          '" src="' + esc(src) + '" alt="" width="' + px + '" height="' + px + '">',
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
          html: '<img class="' + (px >= 40 ? 'tma-portal-file-card__thumb-img' : 'tma-dash__overview-recycle-thumb') +
            '" src="' + esc(meta.thumbUrl) + '" alt="" width="' + px + '" height="' + px + '" loading="lazy"' +
            ' onerror="this.onerror=null;this.className=\'' + (px >= 40 ? 'tma-portal-file-card__icon' : '') +
            '\';this.src=\'' + esc(fallback) + '\'">',
          tone: tone,
        };
      }
      return {
        html: '<img class="' + (px >= 40 ? 'tma-portal-file-card__icon' : '') +
          '" src="' + esc(fallback) + '" alt="" width="' + iconPx + '" height="' + iconPx + '">',
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
      html: '<img src="' + ICON + esc(glyph) + '.svg" alt="" width="' + iconPx + '" height="' + iconPx + '">',
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
      view: 'table', // 'table' | 'grid'
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
      // Match Folders → Recycle Bin: empty-bin only when nothing is selected;
      // selection shows Restore + Delete forever (one trash, not two).
      var actions =
        toolMenu('data-recycle-filter-menu', 'Filter', KIND_FILTERS, state.kind, 'Filter by type') +
        (count === 0
          ? toolBtn('Trash', 'data-recycle-empty', 'Empty recycle bin', { disabled: !state.items.length })
          : '') +
        toolBtn('Rows', 'data-recycle-view="table"', 'List view', {
          active: state.view === 'table',
          pressed: state.view === 'table',
        }) +
        toolBtn('GridFour', 'data-recycle-view="grid"', 'Grid view', {
          active: state.view === 'grid',
          pressed: state.view === 'grid',
        });

      var bulk = '<div class="tma-dash__toolbar-bulk" data-recycle-bulk' + (count === 0 ? ' hidden' : '') + '>' +
        '<img class="tma-dash__toolbar-divider" src="' + TMA + 'Line-16.svg" alt="" aria-hidden="true">' +
        '<span class="tma-dash__toolbar-selection" aria-live="polite">' +
          (count === 1 ? '1 Selected' : count + ' Selected') +
        '</span>' +
        toolBtn('ArrowCounterClockwise', 'data-recycle-bulk-restore', 'Restore') +
        toolBtn('Trash', 'data-recycle-bulk-purge', 'Delete forever') +
      '</div>';

      return '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
        '<div class="tma-dash__toolbar-actions">' + actions + bulk + '</div>' +
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
          '<button type="button" class="tma-dash__row-more" data-recycle-row-more="' + esc(key) + '" aria-label="More actions for ' + esc(item.name) + '">' +
            '<img src="' + TMA + 'ThreeDots-16.svg" alt="" width="16" height="16">' +
          '</button>' +
        '</div>' +
      '</div>';
    }

    function closeRowMenu() {
      var open = document.querySelector('[data-overview-recycle-menu]');
      if (open) open.remove();
    }

    function openRowMenu(btn, item) {
      closeRowMenu();
      var key = rowKey(item);
      var menu = document.createElement('div');
      menu.className = 'tma-dash__menu tma-dash__overview-files-menu';
      menu.setAttribute('data-overview-recycle-menu', '');
      menu.setAttribute('role', 'menu');
      menu.innerHTML =
        '<button type="button" class="tma-dash__menu-item" role="menuitem" data-recycle-restore="' + esc(key) + '">Restore</button>' +
        '<button type="button" class="tma-dash__menu-item" role="menuitem" data-recycle-purge="' + esc(key) + '">Delete forever</button>';
      document.body.appendChild(menu);
      var rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
      menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + 'px';
      menu.style.zIndex = '80';

      menu.querySelector('[data-recycle-restore]').addEventListener('click', function (e) {
        e.preventDefault();
        closeRowMenu();
        restoreOne(item).then(function () {
          toast('Restored “' + item.name + '”');
          load();
        }).catch(function () {
          toast('Could not restore', 'negative');
        });
      });
      menu.querySelector('[data-recycle-purge]').addEventListener('click', function (e) {
        e.preventDefault();
        closeRowMenu();
        if (!window.confirm('Permanently delete “' + item.name + '”? This cannot be undone.')) return;
        purgeOne(item).then(function () {
          toast('Permanently deleted');
          load();
        }).catch(function () {
          toast('Could not delete', 'negative');
        });
      });
    }

    function renderStatus() {
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
      return null;
    }

    function renderCard(item) {
      var key = rowKey(item);
      var checked = !!state.selected[key];
      var visual = itemVisual(item, 40);
      var kindLabel = KIND_LABEL[item.kind] || item.kind;
      var sizeLabel = (item.meta && item.meta.sizeLabel) || '';
      var sub = sizeLabel && sizeLabel !== '—'
        ? kindLabel + ' · ' + sizeLabel
        : kindLabel;
      return '<div class="tma-portal-file-card' + (checked ? ' is-selected' : '') +
        '" data-recycle-row="' + esc(key) + '" tabindex="0">' +
        '<label class="tma-portal-file-card__check">' +
          '<input type="checkbox" class="tma-dash__check" data-recycle-check="' + esc(key) + '"' +
            (checked ? ' checked' : '') + ' aria-label="Select ' + esc(item.name) + '">' +
        '</label>' +
        '<button type="button" class="tma-portal-row-menu tma-dash__overview-recycle-card-more" data-recycle-row-more="' + esc(key) + '" aria-label="More actions for ' + esc(item.name) + '">' +
          '<img src="' + TMA + 'ThreeDots-16.svg" alt="" width="16" height="16">' +
        '</button>' +
        '<div class="tma-portal-file-card__thumb" aria-hidden="true">' + visual.html + '</div>' +
        '<span class="tma-portal-file-card__name" title="' + esc(item.name) + '">' + esc(item.name) + '</span>' +
        '<span class="tma-portal-file-card__meta">' + esc(sub) + '</span>' +
      '</div>';
    }

    function renderGrid() {
      return '<div class="tma-portal-grid" role="list" aria-label="Recycle bin">' +
        state.items.map(renderCard).join('') +
      '</div>';
    }

    function renderTable() {
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

    function renderBody() {
      var status = renderStatus();
      if (status) return status;
      return state.view === 'grid' ? renderGrid() : renderTable();
    }

    function render() {
      closeRowMenu();
      container.innerHTML =
        '<div class="tma-dash__files tma-dash__files--overview tma-dash__recycle--overview" data-overview-recycle>' +
          renderToolbar() +
          renderBody() +
        '</div>';
      wireChrome();
    }

    function wireChrome() {
      if (window.TMAPortalUI && window.TMAPortalUI.wireHeadDropdownAll) {
        window.TMAPortalUI.wireHeadDropdownAll(container, '[data-recycle-filter-menu]', function (sel) {
          state.kind = sel.action || '';
          load();
        });
      }
      if (state.searchFocused) {
        var focusInput = container.querySelector('[data-recycle-search]');
        if (focusInput) {
          focusInput.focus();
          var len = focusInput.value.length;
          focusInput.setSelectionRange(len, len);
        }
      }
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

    if (!container._recycleDocClick) {
      container._recycleDocClick = function (e) {
        if (!e.target.closest('[data-overview-recycle-menu]') && !e.target.closest('[data-recycle-row-more]')) {
          closeRowMenu();
        }
      };
      document.addEventListener('click', container._recycleDocClick);
    }

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

      var viewBtn = e.target.closest('[data-recycle-view]');
      if (viewBtn) {
        e.preventDefault();
        var nextView = viewBtn.getAttribute('data-recycle-view');
        if (nextView === 'table' || nextView === 'grid') {
          state.view = nextView;
          render();
        }
        return;
      }

      var moreBtn = e.target.closest('[data-recycle-row-more]');
      if (moreBtn) {
        e.preventDefault();
        e.stopPropagation();
        var moreItem = findItem(moreBtn.getAttribute('data-recycle-row-more'));
        if (moreItem) openRowMenu(moreBtn, moreItem);
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
