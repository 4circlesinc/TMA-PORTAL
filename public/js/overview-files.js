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

  var BASE_ROWS = [
    { name: 'Project tech requirements.pdf', icon: 'FilePdf', tone: 'purple', uploader: 'Natali Craig', avatar: 'AvatarFemale06', size: '5.6 MB', time: 'Just now' },
    { name: 'Create Project Wireframes.xls', icon: 'FileXls', tone: 'blue', uploader: 'Kate Morrison', avatar: 'AvatarFemale04', size: '2.3 MB', time: '1 minute ago' },
    { name: 'Q4 stakeholder deck.pptx', icon: 'FilePpt', tone: 'purple', uploader: 'Drew Cano', avatar: 'AvatarMale01', size: '8.1 MB', time: '1 hour ago' },
    { name: 'Product research notes.one', icon: 'FileOneNote', tone: 'blue', uploader: 'Orlando Diggs', avatar: 'AvatarMale03', size: '420 KB', time: 'Yesterday' },
    { name: 'Client intake form.form', icon: 'FileForm', tone: 'purple', uploader: 'Andi Lane', avatar: 'AvatarFemale01', size: '96 KB', time: 'Feb 2, 2026' },
    { name: 'Release checklist.txt', icon: 'FileTxt', tone: 'blue', uploader: 'Kate Morrison', avatar: 'AvatarFemale04', size: '12 KB', time: 'Feb 1, 2026' },
    { name: 'Sprint retro notes', icon: 'Notepad', tone: 'purple', uploader: 'Natali Craig', avatar: 'AvatarFemale06', size: '64 KB', time: 'Jan 30, 2026' },
    { name: 'Dashboard-design.jpg', icon: 'FileImage', tone: 'blue', uploader: 'Andi Lane', avatar: 'AvatarFemale01', size: '2.8 MB', time: 'Feb 2, 2026' },
  ];

  var DEFAULT_ROWS = BASE_ROWS.concat(BASE_ROWS.map(function (r) { return Object.assign({}, r); }));

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

  function renderToolbar(state) {
    var count = Object.keys(state.selected).length;
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';

    return '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Add file" data-files-add><img src="' + ICONS.Plus + '" alt=""></button>' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Filter" data-files-filter aria-pressed="false"><img src="' + ICONS.FunnelSimple + '" alt=""></button>' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-files-sort aria-pressed="false"><img src="' + ICONS.ArrowsDownUp + '" alt=""></button>' +
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

  function renderRow(row, index, checked) {
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    return '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' + selected + '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check"><input type="checkbox" class="tma-dash__check" data-files-check' + (checked ? ' checked' : '') + ' aria-label="Select ' + escapeHtml(row.name) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--activity">' +
        '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + escapeHtml(row.tone) + '">' +
          '<img src="' + fileIconSrc(row.icon, row.name) + '" alt="" width="16" height="16">' +
        '</span>' +
        '<span class="tma-dash__files-library-copy">' +
          '<span class="tma-dash__cc-truncate">' + escapeHtml(row.name) + '</span>' +
          '<span class="tma-dash__files-library-meta">' + escapeHtml(row.size) + ' · ' + escapeHtml(row.time) + ' · ' + escapeHtml(row.uploader) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--uploader">' +
        '<img src="' + AVATAR + escapeHtml(row.avatar) + '.png" alt="">' +
        '<span class="tma-dash__cc-truncate">' + escapeHtml(row.uploader) + '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--size"><span class="tma-dash__cc-truncate">' + escapeHtml(row.size) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--file-time"><img src="' + ICONS.CalendarBlank + '" alt="">' + escapeHtml(row.time) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--actions">' +
        '<button type="button" class="tma-dash__row-more" aria-label="More actions for ' + escapeHtml(row.name) + '" data-files-row-more><img src="' + ICONS.ThreeDots + '" alt="" width="16" height="16"></button>' +
      '</div>' +
    '</div>';
  }

  function applySearch(rows, query) {
    if (!query) return rows;
    var q = normalize(query);
    return rows.filter(function (row) {
      return [row.name, row.uploader, row.size, row.time].join(' ').toLowerCase().includes(q);
    });
  }

  function mount(container) {
    if (!container || container.hasAttribute('data-files-mounted')) return;

    var state = {
      rows: DEFAULT_ROWS.map(function (r) { return Object.assign({}, r); }),
      search: '',
      searchFocused: false,
      searchLoading: false,
      page: 1,
      pageSize: 10,
      selected: {},
    };

    container.setAttribute('data-files-mounted', '');

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

      var filtered = applySearch(state.rows, state.search);
      var totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
      if (state.page > totalPages) state.page = totalPages;
      var start = (state.page - 1) * state.pageSize;
      var pageRows = filtered.slice(start, start + state.pageSize);

      var bodyHtml = pageRows.length
        ? pageRows.map(function (row, i) {
            var globalIndex = start + i;
            return renderRow(row, globalIndex, !!state.selected[rowKey(globalIndex)]);
          }).join('')
        : '<div class="tma-dash__ctr tma-dash__ctr--empty" role="row"><div class="tma-dash__cc tma-dash__cc--empty">No results</div></div>';

      container.innerHTML =
        renderToolbar(state) +
        '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Files">' +
          '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
            '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head"><input type="checkbox" class="tma-dash__check" data-files-selectall aria-label="Select all"></div>' +
            '<div class="tma-dash__cc tma-dash__cc--activity tma-dash__cc--head">Activity</div>' +
            '<div class="tma-dash__cc tma-dash__cc--uploader tma-dash__cc--head">Uploader</div>' +
            '<div class="tma-dash__cc tma-dash__cc--size tma-dash__cc--head">File Size</div>' +
            '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Upload Time</div>' +
            '<div class="tma-dash__cc tma-dash__cc--actions tma-dash__cc--head" aria-hidden="true"></div>' +
          '</div>' +
          '<div data-files-body>' + bodyHtml + '</div>' +
        '</div>' +
        renderPagination(state, filtered.length);

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
    }

    render();
  }

  window.TMAOverviewFiles = { mount: mount };
})();
