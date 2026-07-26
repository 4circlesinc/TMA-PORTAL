/*
 * TMA - Overview Files tab (Figma 32546:96116)
 * Global: window.TMAOverviewFiles
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';
  var AVATAR = 'images/avatars/';

  function fileIconSrc(key, filename) {
    if (window.TMAFileIcons && TMAFileIcons.fileIconSrc) {
      return TMAFileIcons.fileIconSrc(key, filename);
    }
    return ICON + key + '.svg';
  }

  var ICONS = {
    Plus: 'images/icons/phosphor/Plus.svg',
    FunnelSimple: 'images/icons/tma/FunnelSimple-16.svg',
    ArrowsDownUp: 'images/icons/tma/ArrowsDownUp.svg',
    Search: 'images/icons/tma/Search-16.svg',
    XCircle: 'images/icons/tma/Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
    ArrowLineRight: 'images/icons/tma/ArrowLineRight-16.svg',
    ArrowLineLeft: 'images/icons/tma/ArrowLineLeft-16.svg',
    CalendarBlank: 'images/icons/phosphor/CalendarBlank.svg',
    ThreeDots: 'images/icons/tma/ThreeDots-16.svg',
  };

  /* Live Overview → Files only. Never seed sample uploaders/filenames. */
  var DEFAULT_ROWS = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function normalize(value) {
    return String(value || '').toLowerCase().trim();
  }

  function rowKey(index) {
    return String(index);
  }

  function cap(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
  }

  function renderSearchBar(state) {
    var classes = ['tma-dash__toolbar-search'];
    if (state.searchFocused || state.search) classes.push('tma-dash__toolbar-search--focused');
    if (state.search) classes.push('tma-dash__toolbar-search--has-value');
    if (state.searchLoading) classes.push('tma-dash__toolbar-search--loading');

    var clearBtn = '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-files-search-clear><img src="' + ICONS.XCircle + '" alt=""></button>';
    var spinner = '<span class="tma-dash__search-spinner"><img src="' + ICONS.Loading16 + '" alt=""></span>';
    var kbd = state.search ? '' : '<kbd class="tma-dash__kbd" data-files-search-shortcut>/</kbd>';

    return '<div class="' + classes.join(' ') + '" role="search">' +
      '<img src="' + ICONS.Search + '" alt="">' +
      '<input type="search" class="tma-dash__search-input" placeholder="Search" aria-label="Search files" value="' + escapeHtml(state.search) + '" data-files-search autocomplete="off" spellcheck="false">' +
      clearBtn + spinner + kbd +
    '</div>';
  }

  function menuItems(items, current) {
    return items.map(function (it) {
      var active = String(it.value) === String(current) ? ' tma-dash__menu-item--active' : '';
      return '<button type="button" class="tma-dash__menu-item' + active + '" role="menuitem" data-head-dropdown-item="' +
        escapeHtml(it.value) + '">' + escapeHtml(it.label) + '</button>';
    }).join('');
  }

  function toolMenu(btnAttr, aria, iconSrc, items, current, menuLabel) {
    return '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap ' + btnAttr + '>' +
      '<button type="button" class="tma-dash__tool-btn" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false" aria-label="' + escapeHtml(aria) + '">' +
      '<img src="' + iconSrc + '" alt=""></button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--start" data-head-dropdown-menu hidden role="menu" aria-label="' + escapeHtml(menuLabel) + '">' +
      menuItems(items, current) +
      '</div></div>';
  }

  function renderToolbar(state) {
    var count = Object.keys(state.selected).length;
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';

    var filterItems = [
      { value: '', label: 'All types' },
      { value: 'word', label: 'Documents' },
      { value: 'excel', label: 'Spreadsheets' },
      { value: 'powerpoint', label: 'Presentations' },
      { value: 'image', label: 'Images' },
      { value: 'pdf', label: 'PDF' },
      { value: 'other', label: 'Other' },
    ];
    var sortItems = [
      { value: 'name', label: 'File name' },
      { value: 'uploaded', label: 'Uploaded' },
      { value: 'modified', label: 'Modified' },
      { value: 'size', label: 'Size' },
      { value: 'uploader', label: 'Uploader' },
    ];

    return '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Add file" data-files-add><img src="' + ICONS.Plus + '" alt=""></button>' +
        '<input type="file" hidden multiple data-files-add-input>' +
        toolMenu('data-files-filter-menu', 'Filter', ICONS.FunnelSimple, filterItems, state.filterType, 'Filter by type') +
        toolMenu('data-files-sort-menu', 'Sort', ICONS.ArrowsDownUp, sortItems, state.sort, 'Sort by') +
        '<div class="tma-dash__toolbar-bulk" data-files-bulk' + bulkHidden + '>' +
          '<img class="tma-dash__toolbar-divider" src="' + TMA + 'Line-16.svg" alt="" aria-hidden="true">' +
          '<span class="tma-dash__toolbar-selection" data-files-selection-count aria-live="polite">' + selectionLabel + '</span>' +
        '</div>' +
      '</div>' +
      renderSearchBar(state) +
    '</div>';
  }

  function renderPagination(state, totalRows) {
    var pageSize = state.pageSize;
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    var pages = '';
    for (var p = 1; p <= 5; p++) {
      var active = p === state.page;
      var disabled = p > totalPages ? ' disabled' : '';
      pages += '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') + '" aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') + ' data-page="' + p + '"' + disabled + '><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';

    return '<div class="tma-pagination-bar tma-pagination-bar--overview" data-files-pagination>' +
      '<nav class="tma-pagination tma-pagination--overview" aria-label="Pagination">' + pages +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '><img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-direction="next"' + nextDisabled + '><img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>';
  }

  function avatarSrc(avatar, name) {
    if (window.TMACurrentUser && TMACurrentUser.avatarSrc) {
      return TMACurrentUser.avatarSrc(avatar, name);
    }
    if (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar)) return avatar;
    return AVATAR + 'Avatar3d01.png';
  }

  function renderRow(row, index, checked) {
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    var sharedLabel = row.shared ? 'Shared' : 'Private';
    return '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' + selected + '" data-row-index="' + index + '" role="row" data-files-row>' +
      '<div class="tma-dash__cc tma-dash__cc--check"><input type="checkbox" class="tma-dash__check" data-files-check' + (checked ? ' checked' : '') + ' aria-label="Select ' + escapeHtml(row.name) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--filename" data-files-open>' +
        '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + escapeHtml(row.tone) + '">' +
          '<img src="' + fileIconSrc(row.icon, row.name) + '" alt="" width="16" height="16">' +
        '</span>' +
        '<span class="tma-dash__cc-truncate">' + escapeHtml(row.name) + '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--type"><span class="tma-dash__cc-truncate">' + escapeHtml(row.typeLabel) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--folder" data-files-open-folder="' + escapeHtml(row.folderId || '') + '">' +
        '<span class="tma-dash__cc-truncate">' + escapeHtml(row.folder || '—') + '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--size"><span class="tma-dash__cc-truncate">' + escapeHtml(row.size) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--uploader">' +
        '<button type="button" class="tma-dash__files-uploader-btn" data-files-uploader-photo aria-label="View ' + escapeHtml(row.uploader) + ' photo">' +
          '<img src="' + escapeHtml(row.avatarUrl) + '" alt="">' +
        '</button>' +
        '<span class="tma-dash__cc-truncate">' + escapeHtml(row.uploader) + '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--file-time"><img src="' + ICONS.CalendarBlank + '" alt="">' + escapeHtml(row.uploaded) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--file-modified"><span class="tma-dash__cc-truncate">' + escapeHtml(row.modified) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--shared"><span class="tma-dash__cc-truncate">' + escapeHtml(sharedLabel) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--actions">' +
        '<button type="button" class="tma-dash__row-more" aria-label="More actions for ' + escapeHtml(row.name) + '" data-files-row-more><img src="' + ICONS.ThreeDots + '" alt="" width="16" height="16"></button>' +
      '</div>' +
    '</div>';
  }

  function applyFilters(rows, state) {
    var list = rows;
    if (state.filterType) {
      list = list.filter(function (row) {
        var cat = row.category || '';
        var ext = row.extension || '';
        if (state.filterType === 'pdf') return ext === 'pdf' || cat === 'pdf';
        if (state.filterType === 'word') {
          return cat === 'word' || cat === 'document' || /^(doc|docx|rtf|txt)$/.test(ext);
        }
        if (state.filterType === 'excel') {
          return cat === 'excel' || cat === 'spreadsheet' || /^(xls|xlsx|csv)$/.test(ext);
        }
        if (state.filterType === 'powerpoint') {
          return cat === 'powerpoint' || /^(ppt|pptx)$/.test(ext);
        }
        if (state.filterType === 'image') {
          return cat === 'image' || /^(png|jpe?g|gif|webp|svg)$/.test(ext);
        }
        if (state.filterType === 'other') {
          return !/^(word|excel|powerpoint|pdf|image|document|spreadsheet)$/.test(cat)
            && !/^(pdf|doc|docx|xls|xlsx|csv|ppt|pptx|png|jpe?g|gif|webp|svg)$/.test(ext);
        }
        return cat === state.filterType;
      });
    }
    if (state.search) {
      var q = normalize(state.search);
      list = list.filter(function (row) {
        return [row.name, row.uploader, row.folder, row.typeLabel, row.size].join(' ').toLowerCase().includes(q);
      });
    }
    return list;
  }

  function sortRows(rows, sort) {
    var list = rows.slice();
    list.sort(function (a, b) {
      switch (sort) {
        case 'size': return (a.bytes || 0) - (b.bytes || 0);
        case 'uploaded': return String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''));
        case 'modified': return String(a.modifiedAt || '').localeCompare(String(b.modifiedAt || ''));
        case 'uploader': return String(a.uploader || '').localeCompare(String(b.uploader || ''));
        default: return String(a.name || '').localeCompare(String(b.name || ''));
      }
    });
    return list;
  }

  function formatWhen(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function mapApiFile(f) {
    var name = f.name || 'File';
    var uploader = (f.uploadedBy && f.uploadedBy.name) || (f.owner && f.owner.name) || 'Someone';
    var avatar = (f.uploadedBy && f.uploadedBy.avatar) || (f.owner && f.owner.avatar) || null;
    var ext = (f.extension || name.split('.').pop() || '').toLowerCase();
    var category = f.category || '';
    var tone = 'grey';
    if (ext === 'pdf') tone = 'red';
    else if (ext === 'doc' || ext === 'docx') tone = 'blue';
    else if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') tone = 'green';
    else if (/png|jpe?g|gif|webp/.test(ext)) tone = 'purple';
    var typeLabel = ext === 'pdf' ? 'PDF' : (category ? cap(category) : (ext ? ext.toUpperCase() : 'File'));
    return {
      id: f.id,
      name: name,
      extension: ext,
      category: category,
      typeLabel: typeLabel,
      size: f.sizeLabel || '—',
      bytes: f.size || 0,
      uploaded: formatWhen(f.uploadedAt || f.createdAt),
      modified: formatWhen(f.modifiedAt || f.updatedAt || f.uploadedAt),
      uploadedAt: f.uploadedAt || f.createdAt || '',
      modifiedAt: f.modifiedAt || f.updatedAt || '',
      uploader: uploader,
      avatarUrl: avatarSrc(avatar, uploader),
      avatarRaw: avatar,
      tone: tone,
      icon: f.icon || ((window.TMAFileIcons && TMAFileIcons.iconKeyFor) ? TMAFileIcons.iconKeyFor(name) : 'File'),
      mime: f.mime || '',
      previewUrl: f.previewUrl || null,
      downloadUrl: f.downloadUrl || null,
      folder: (f.folder && f.folder.name) || '',
      folderId: (f.folder && f.folder.id) || null,
      shared: !!f.shared,
      raw: f,
    };
  }

  function closeRowMenu() {
    var open = document.querySelector('[data-overview-files-menu]');
    if (open) open.remove();
  }

  function openRowMenu(btn, row) {
    closeRowMenu();
    var menu = document.createElement('div');
    menu.className = 'tma-dash__menu tma-dash__overview-files-menu';
    menu.setAttribute('data-overview-files-menu', '');
    menu.setAttribute('role', 'menu');
    var items = [
      { label: 'Preview', action: 'preview' },
      { label: 'Download', action: 'download', disabled: !row.downloadUrl },
      { label: 'Open folder', action: 'folder', disabled: !row.folderId },
    ];
    menu.innerHTML = items.map(function (it) {
      return '<button type="button" class="tma-dash__menu-item" role="menuitem" data-files-menu-action="' +
        escapeHtml(it.action) + '"' + (it.disabled ? ' disabled' : '') + '>' + escapeHtml(it.label) + '</button>';
    }).join('');
    document.body.appendChild(menu);
    var rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
    menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + 'px';
    menu.style.zIndex = '1200';

    menu.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-files-menu-action]');
      if (!actionBtn || actionBtn.disabled) return;
      var action = actionBtn.getAttribute('data-files-menu-action');
      closeRowMenu();
      if (action === 'preview') openFilePreview(row);
      else if (action === 'download') downloadFile(row);
      else if (action === 'folder') openFolder(row.folderId);
    });

    setTimeout(function () {
      function onDoc(ev) {
        if (menu.contains(ev.target) || btn.contains(ev.target)) return;
        closeRowMenu();
        document.removeEventListener('mousedown', onDoc);
      }
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }

  function downloadFile(row) {
    if (!row || !row.downloadUrl) return;
    var a = document.createElement('a');
    a.href = row.downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openFolder(folderId) {
    if (!folderId) return;
    if (window.TMADashboard && typeof window.TMADashboard.navigate === 'function') {
      window.TMADashboard.navigate({
        navId: 'folders-all',
        view: 'folders',
        title: 'Folders',
        crumb: 'Folders',
        folderId: folderId,
      });
      return;
    }
    var root = window.__TMA_SITE_ROOT || '';
    window.location.assign(root + '/folders?folder=' + encodeURIComponent(folderId));
  }

  function openFilePreview(row) {
    var url = row.previewUrl || row.downloadUrl;
    if (!url) return;
    if (window.TMAPortalLightbox) {
      TMAPortalLightbox.open([{
        name: row.name,
        mime: row.mime || '',
        size: row.bytes || 0,
        url: url,
        downloadUrl: row.downloadUrl || url,
      }], 0);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function renderSectionTabs(section) {
    var tabs = [
      { key: 'recent', label: 'Recent Files' },
      { key: 'shared', label: 'Shared with me' },
    ];
    return '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-files-tabs" role="tablist" data-overview-files-tabs>' +
      tabs.map(function (it, i) {
        var on = it.key === section;
        return '<button type="button" class="tma-tab' + (on ? ' is-active' : '') + '" role="tab"' +
          ' data-tab-index="' + i + '" data-tab-key="' + escapeHtml(it.key) + '"' +
          ' data-overview-files-section="' + escapeHtml(it.key) + '"' +
          ' aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' +
          '<span class="tma-tab__label">' + escapeHtml(it.label) + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
          '</button>';
      }).join('') +
      '</div>';
  }

  function mount(container) {
    if (!container || container.hasAttribute('data-files-mounted')) return;

    var state = {
      rows: DEFAULT_ROWS.map(function (r) { return Object.assign({}, r); }),
      section: 'recent',
      cache: { recent: null, shared: null },
      search: '',
      searchFocused: false,
      searchLoading: false,
      page: 1,
      pageSize: 10,
      selected: {},
      filterType: '',
      sort: 'uploaded',
    };

    container.setAttribute('data-files-mounted', '');

    // Delegate section tabs so clicks still work after full re-renders.
    if (!container.dataset.overviewFilesTabsWired) {
      container.dataset.overviewFilesTabsWired = '1';
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-overview-files-section]');
        if (!btn || !container.contains(btn)) return;
        var next = btn.getAttribute('data-overview-files-section');
        if (!next || next === state.section) return;
        state.section = next;
        state.page = 1;
        state.selected = {};
        state.search = '';
        state.filterType = '';
        if (state.cache[next]) {
          state.rows = state.cache[next];
          render();
        } else {
          state.rows = [];
          render();
          reloadFiles();
        }
      });
    }

    function updateToolbarSelection() {
      var count = Object.keys(state.selected).length;
      var bulk = container.querySelector('[data-files-bulk]');
      var label = container.querySelector('[data-files-selection-count]');
      var toolbar = container.querySelector('.tma-dash__toolbar');
      if (!bulk || !label || !toolbar) return;
      bulk.hidden = count === 0;
      toolbar.classList.toggle('tma-dash__toolbar--selected', count > 0);
      label.textContent = count === 1 ? '1 Selected' : count + ' Selected';
    }

    function render() {
      container.className = 'tma-dash__files tma-dash__files--overview';

      var filtered = sortRows(applyFilters(state.rows, state), state.sort);
      var totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
      if (state.page > totalPages) state.page = totalPages;
      var start = (state.page - 1) * state.pageSize;
      var pageRows = filtered.slice(start, start + state.pageSize);

      var emptyMsg = state.search || state.filterType
        ? 'Try a different search or filter.'
        : (state.section === 'shared'
          ? 'Items other people share with you will show up here.'
          : 'Files you open or upload will show up here.');
      var emptyHtml = window.TMANoData
        ? window.TMANoData.render({
            illustrationName: 'Illustration07',
            title: state.search || state.filterType
              ? 'No matching files'
              : (state.section === 'shared' ? 'Nothing shared with you' : 'No recent files'),
            subtitle: emptyMsg,
            showButton: false,
          })
        : '<p class="tma-dash__overview-empty">' + escapeHtml(emptyMsg) + '</p>';

      var listHtml = pageRows.length
        ? (
          '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Files">' +
            '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
              '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head"><input type="checkbox" class="tma-dash__check" data-files-selectall aria-label="Select all"></div>' +
              '<div class="tma-dash__cc tma-dash__cc--filename tma-dash__cc--head">File name</div>' +
              '<div class="tma-dash__cc tma-dash__cc--type tma-dash__cc--head">Type</div>' +
              '<div class="tma-dash__cc tma-dash__cc--folder tma-dash__cc--head">Folder</div>' +
              '<div class="tma-dash__cc tma-dash__cc--size tma-dash__cc--head">Size</div>' +
              '<div class="tma-dash__cc tma-dash__cc--uploader tma-dash__cc--head">Uploader</div>' +
              '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Uploaded</div>' +
              '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Modified</div>' +
              '<div class="tma-dash__cc tma-dash__cc--shared tma-dash__cc--head">Shared</div>' +
              '<div class="tma-dash__cc tma-dash__cc--actions tma-dash__cc--head" aria-hidden="true"></div>' +
            '</div>' +
            '<div data-files-body>' +
              pageRows.map(function (row, i) {
                var globalIndex = start + i;
                return renderRow(row, globalIndex, !!state.selected[rowKey(globalIndex)]);
              }).join('') +
            '</div>' +
          '</div>' +
          renderPagination(state, filtered.length)
        )
        : ('<div class="tma-dash__files-empty" data-files-body>' + emptyHtml + '</div>');

      container.innerHTML =
        renderSectionTabs(state.section) +
        renderToolbar(state) +
        listHtml;

      wireEvents(filtered, pageRows, start);
      if (state.searchFocused) {
        var focusInput = container.querySelector('[data-files-search]');
        if (focusInput) {
          focusInput.focus();
          var len = focusInput.value.length;
          focusInput.setSelectionRange(len, len);
        }
      }
    }

    function wireEvents(filtered, pageRows, start) {
      var searchInput = container.querySelector('[data-files-search]');
      var searchTimer = null;

      if (searchInput) {
        searchInput.addEventListener('input', function () {
          state.search = searchInput.value;
          state.searchFocused = true;
          state.searchLoading = true;
          if (window.TMADashSearchChrome) window.TMADashSearchChrome.syncToolbar(container, state);
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () {
            state.searchLoading = false;
            state.page = 1;
            render();
          }, 180);
        });
        searchInput.addEventListener('focus', function () {
          state.searchFocused = true;
          var wrap = container.querySelector('.tma-dash__toolbar-search');
          if (wrap) wrap.classList.add('tma-dash__toolbar-search--focused');
        });
        searchInput.addEventListener('blur', function () {
          state.searchFocused = false;
          var wrap = container.querySelector('.tma-dash__toolbar-search');
          if (wrap) wrap.classList.remove('tma-dash__toolbar-search--focused');
        });
      }

      container.querySelector('[data-files-search-clear]')?.addEventListener('click', function (e) {
        e.preventDefault();
        clearTimeout(searchTimer);
        state.search = '';
        state.searchFocused = true;
        state.searchLoading = false;
        state.page = 1;
        render();
      });

      container.querySelector('[data-files-search-shortcut]')?.addEventListener('click', function (e) {
        e.preventDefault();
        state.searchFocused = true;
        render();
      });

      if (window.TMAPortalUI && window.TMAPortalUI.wireHeadDropdownAll) {
        window.TMAPortalUI.wireHeadDropdownAll(container, '[data-files-filter-menu]', function (sel) {
          state.filterType = sel.action || '';
          state.page = 1;
          render();
        });
        window.TMAPortalUI.wireHeadDropdownAll(container, '[data-files-sort-menu]', function (sel) {
          state.sort = sel.action || 'uploaded';
          state.page = 1;
          render();
        });
      }

      var pagination = container.querySelector('[data-files-pagination]');
      pagination?.querySelectorAll('[data-page]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          state.page = parseInt(btn.getAttribute('data-page'), 10) || 1;
          render();
        });
      });
      pagination?.querySelector('[data-direction="prev"]')?.addEventListener('click', function () {
        if (state.page > 1) { state.page--; render(); }
      });
      pagination?.querySelector('[data-direction="next"]')?.addEventListener('click', function () {
        var totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
        if (state.page < totalPages) { state.page++; render(); }
      });

      var selectAll = container.querySelector('[data-files-selectall]');
      var rowChecks = Array.prototype.slice.call(container.querySelectorAll('[data-files-check]'));

      function syncRow(cb, rowIndex) {
        var key = rowKey(rowIndex);
        if (cb.checked) state.selected[key] = true;
        else delete state.selected[key];
        var rowEl = cb.closest('[data-row-index]');
        if (rowEl) rowEl.classList.toggle('tma-dash__ctr--selected', cb.checked);
        updateToolbarSelection();
      }

      rowChecks.forEach(function (cb) {
        var rowEl = cb.closest('[data-row-index]');
        var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
        cb.addEventListener('change', function () {
          syncRow(cb, rowIndex);
          syncSelectAll();
        });
      });

      function syncSelectAll() {
        if (!selectAll) return;
        var checked = rowChecks.filter(function (c) { return c.checked; }).length;
        selectAll.checked = checked === rowChecks.length && rowChecks.length > 0;
        selectAll.indeterminate = checked > 0 && checked < rowChecks.length;
      }

      if (selectAll) {
        selectAll.addEventListener('change', function () {
          rowChecks.forEach(function (cb, i) {
            cb.checked = selectAll.checked;
            syncRow(cb, start + i);
          });
          selectAll.indeterminate = false;
        });
        syncSelectAll();
      }

      var addBtn = container.querySelector('[data-files-add]');
      var addInput = container.querySelector('[data-files-add-input]');
      if (addBtn && addInput) {
        addBtn.addEventListener('click', function () { addInput.click(); });
        addInput.addEventListener('change', function () {
          if (addInput.files && addInput.files.length && window.TMAUpload) {
            window.TMAUpload.add(addInput.files, { folderId: null });
          }
          addInput.value = '';
        });
      }

      container.querySelectorAll('[data-files-open]').forEach(function (cell) {
        cell.addEventListener('click', function () {
          var rowEl = cell.closest('[data-row-index]');
          var idx = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : -1;
          var row = filtered[idx];
          if (!row) return;
          openFilePreview(row);
        });
      });

      container.querySelectorAll('[data-files-open-folder]').forEach(function (cell) {
        cell.addEventListener('click', function (e) {
          var folderId = cell.getAttribute('data-files-open-folder');
          if (!folderId) return;
          e.preventDefault();
          e.stopPropagation();
          openFolder(folderId);
        });
      });

      container.querySelectorAll('[data-files-row-more]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var rowEl = btn.closest('[data-row-index]');
          var idx = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : -1;
          var row = filtered[idx];
          if (row) openRowMenu(btn, row);
        });
      });

      container.querySelectorAll('[data-files-uploader-photo]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var rowEl = btn.closest('[data-row-index]');
          var idx = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : -1;
          var row = filtered[idx];
          if (!row || !row.avatarRaw || !window.TMAPortalLightbox) return;
          TMAPortalLightbox.open([{
            name: row.uploader || 'Profile photo',
            mime: 'image/jpeg',
            size: 0,
            url: row.avatarRaw,
            canDownload: false,
          }], 0);
        });
      });
    }

    function reloadFiles() {
      var siteRoot = window.__TMA_SITE_ROOT || '';
      var section = state.section === 'shared' ? 'shared' : 'recent';
      var only = section === 'recent' ? '&only=files' : '';
      fetch(siteRoot + '/portal/files?section=' + encodeURIComponent(section) + '&perPage=50' + only, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return;
          // Shared with me can include folders; keep both, files first for this table.
          var mappedFiles = (j.files || []).map(mapApiFile);
          var mappedFolders = (j.folders || []).map(function (f) {
            return mapApiFile({
              id: f.id,
              name: f.name,
              type: 'folder',
              category: 'folder',
              extension: '',
              sizeLabel: f.sizeLabel || ((f.fileCount != null ? f.fileCount : 0) + ' items'),
              size: f.size || 0,
              uploadedAt: f.createdAt,
              createdAt: f.createdAt,
              modifiedAt: f.modifiedAt,
              uploadedBy: f.owner,
              owner: f.owner,
              shared: !!f.shared,
              folder: null,
              icon: 'FolderFilled',
            });
          });
          var rows = mappedFolders.concat(mappedFiles);
          state.cache[section] = rows;
          if (state.section === section) {
            state.rows = rows;
            state.page = 1;
            render();
          }
        })
        .catch(function () { /* keep current rows */ });
    }

    render();
    reloadFiles();

    document.addEventListener('tma:upload-complete', function () {
      if (!container.isConnected) return;
      reloadFiles();
    });
  }

  window.TMAOverviewFiles = { mount: mount };
})();
