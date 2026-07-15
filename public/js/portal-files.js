/*
 * TMA - File & Folder manager view (registers the 'folders' view).
 *
 * Real, server-backed replacement for the localStorage folders prototype.
 * Sections: All Files / My Files / Shared with me / Shared Folders /
 * Favourites / File Box / Recent / Recycle Bin. Table + grid views, toolbar,
 * right-click menu, multi-select bulk actions, details, and chunked uploads
 * via the global TMAUpload manager. Reuses the existing design system
 * (TMAPortalUI helpers, portal.css chrome) — no new design language.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }
  function esc(s) { return ui().esc(s); }

  var NAV_SECTION = {
    'folders-all': 'all',
    'folders-personal': 'my',
    'folders-sharedwithme': 'shared',
    'folders-shared': 'shared-folders',
    'folders-favorites': 'favorites',
    'folders-filebox': 'filebox',
    'folders-recent': 'recent',
    'folders-recycle': 'recycle',
  };

  var SECTIONS = {
    all: { title: 'All Files', desc: 'All files and folders you can access.', empty: 'No files yet' },
    my: { title: 'My Files', desc: 'Files and folders you own.', empty: 'You haven’t created any files yet' },
    shared: { title: 'Shared with me', desc: 'Items other people have shared with you.', empty: 'Nothing has been shared with you yet' },
    'shared-folders': { title: 'Shared Folders', desc: 'Folders with active sharing or assigned people.', empty: 'No shared folders yet' },
    favorites: { title: 'Favourites', desc: 'Files and folders you starred for quick access.', empty: 'No favourites yet' },
    filebox: { title: 'File Box', desc: 'Loose files not yet organised into a folder.', empty: 'Your File Box is empty' },
    recent: { title: 'Recent', desc: 'Files you recently uploaded or changed.', empty: 'Nothing recent yet' },
    recycle: { title: 'Recycle Bin', desc: 'Deleted items are kept here until permanently removed.', empty: 'The recycle bin is empty' },
  };

  var UPLOADABLE = { all: 1, my: 1, filebox: 1 };

  var state = {
    el: null,
    navId: 'folders-all',
    section: 'all',
    folder: null,        // current folder uuid (browsing) or null = section root
    folderName: '',
    breadcrumb: [],
    view: 'table',       // 'table' | 'grid'
    sort: 'name',
    dir: 'asc',
    search: '',
    filterType: '',
    selected: {},        // uuid -> { type, name, perms, favorite }
    data: { folders: [], files: [] },
    loading: false,
    clipboard: null,     // { mode:'cut'|'copy', items:[{type,id,name}] }
  };

  var globalsBound = false;

  /* ── helpers ───────────────────────────────────────── */

  function fileIconSrc(item) {
    if (item.type === 'folder') return 'images/icons/phosphor/FolderFilled.svg';
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(item.icon, item.name);
    return 'images/icons/phosphor/File.svg';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function items() { return state.data.folders.concat(state.data.files); }
  function findItem(id) { return items().filter(function (i) { return i.id === id; })[0]; }
  function selectedIds() { return Object.keys(state.selected); }
  function selectedItems() { return selectedIds().map(findItem).filter(Boolean); }
  function isRecycle() { return state.section === 'recycle'; }

  function canCreateHere() {
    if (isRecycle() || state.section === 'recent' || state.section === 'shared') return false;
    if (state.folder) return true; // browsing inside a folder
    return !!UPLOADABLE[state.section];
  }

  /* ── data loading ──────────────────────────────────── */

  function load() {
    state.loading = true;
    render();
    var params = new URLSearchParams();
    params.set('section', state.section);
    if (state.folder) params.set('folder', state.folder);
    if (state.search) params.set('search', state.search);
    if (state.filterType) params.set('type', state.filterType);
    params.set('sort', state.sort);
    params.set('dir', state.dir);
    params.set('perPage', '200');

    net().fetchJSON(net().url('/?' + params.toString()))
      .then(function (res) {
        state.loading = false;
        state.data = { folders: res.folders || [], files: res.files || [] };
        state.breadcrumb = res.breadcrumb || [];
        if (res.folder) state.folderName = res.folder.name;
        pruneSelection();
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || 'Could not load this folder.';
        render();
      });
  }

  function pruneSelection() {
    var present = {};
    items().forEach(function (i) { present[i.id] = true; });
    Object.keys(state.selected).forEach(function (id) { if (!present[id]) delete state.selected[id]; });
  }

  /* ── render ─────────────────────────────────────────── */

  function render() {
    if (!state.el) return;
    var meta = SECTIONS[state.section] || SECTIONS.all;

    var html = '<div class="tma-portal-page tma-portal-page--files">';
    html += '<div class="tma-portal-page__head">' +
      '<div><h2 class="tma-portal-page__title">' + esc(meta.title) + '</h2>' +
      '<p class="tma-portal-page__desc">' + esc(meta.desc) + '</p></div></div>';

    html += renderBreadcrumb();
    html += renderToolbar();

    if (selectedIds().length) html += renderSelectionBar();

    html += '<div class="tma-portal-files__body" data-files-body>';
    if (state.loading) html += renderLoading();
    else if (state.error) html += ui().banner('warning', esc(state.error));
    else if (!items().length) html += renderEmpty(meta);
    else html += (state.view === 'grid' ? renderGrid() : renderTable());
    html += '</div></div>';

    state.el.innerHTML = html;
    wire();
    bindGlobals();
  }

  function renderLoading() {
    return '<div class="tma-portal-files__loading" role="status" aria-live="polite">' +
      '<img src="images/icons/tma/Loading-16.svg" alt="" width="20" height="20"><span>Loading…</span></div>';
  }

  function renderEmpty(meta) {
    if (state.search) {
      return ui().emptyState({ title: 'No results for “' + state.search + '”', subtitle: 'Try a different search.', illustration: 'Illustration07' });
    }
    var btn = canCreateHere()
      ? ui().btn({ label: 'Upload files', icon: 'ArrowLineUp', attrs: ' data-files-action="upload"' })
      : '';
    if (isRecycle()) btn = '';
    return ui().emptyState({ title: meta.empty, subtitle: canCreateHere() ? 'Create a folder or upload files to get started.' : '', button: btn });
  }

  function renderBreadcrumb() {
    if (!state.folder && !state.breadcrumb.length) return '';
    var crumbs = '<button type="button" class="tma-portal-breadcrumb__item" data-files-crumb="">' +
      esc((SECTIONS[state.section] || SECTIONS.all).title) + '</button>';
    state.breadcrumb.forEach(function (c, i) {
      var last = i === state.breadcrumb.length - 1;
      crumbs += '<span class="tma-portal-breadcrumb__sep">/</span>';
      crumbs += last
        ? '<span class="tma-portal-breadcrumb__item tma-portal-breadcrumb__item--current">' + esc(c.name) + '</span>'
        : '<button type="button" class="tma-portal-breadcrumb__item" data-files-crumb="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    });
    return '<nav class="tma-portal-breadcrumb" aria-label="Folder path">' + crumbs + '</nav>';
  }

  function toolbarBtn(label, icon, action, opts) {
    opts = opts || {};
    return '<button type="button" class="tma-portal-tool" data-files-action="' + action + '"' +
      (opts.disabled ? ' disabled' : '') + (opts.title ? ' title="' + esc(opts.title) + '"' : '') +
      ' aria-label="' + esc(label) + '">' +
      '<img src="images/icons/phosphor/' + icon + '.svg" alt="" width="16" height="16">' +
      '<span>' + esc(label) + '</span></button>';
  }

  function renderToolbar() {
    var sel = selectedItems();
    var create = canCreateHere();

    var left = '';
    if (create) {
      left += toolbarBtn('New folder', 'FolderPlus', 'new-folder');
      left += toolbarBtn('Upload', 'ArrowLineUp', 'upload');
      left += toolbarBtn('Upload folder', 'FolderNotchPlus', 'upload-folder');
    }
    if (state.clipboard && create) {
      left += toolbarBtn('Paste (' + state.clipboard.items.length + ')', 'Clipboard', 'paste');
    }
    if (isRecycle()) {
      left += toolbarBtn('Empty bin', 'Trash', 'empty-bin', { disabled: !items().length });
    }

    var right = '';
    // View toggle
    right += '<div class="tma-portal-view-toggle" role="group" aria-label="View">' +
      '<button type="button" class="tma-portal-view-toggle__btn' + (state.view === 'table' ? ' is-active' : '') + '" data-files-view="table" aria-label="List view" aria-pressed="' + (state.view === 'table') + '"><img src="images/icons/phosphor/Rows.svg" alt="" width="16" height="16"></button>' +
      '<button type="button" class="tma-portal-view-toggle__btn' + (state.view === 'grid' ? ' is-active' : '') + '" data-files-view="grid" aria-label="Grid view" aria-pressed="' + (state.view === 'grid') + '"><img src="images/icons/phosphor/GridFour.svg" alt="" width="16" height="16"></button>' +
      '</div>';
    right += '<button type="button" class="tma-portal-tool tma-portal-tool--icon" data-files-action="refresh" aria-label="Refresh"><img src="images/icons/phosphor/ArrowClockwise.svg" alt="" width="16" height="16"></button>';
    right += sortControl();
    right += filterControl();

    var search = ui().searchInput('Search files', 'data-files-search', state.search);

    return '<div class="tma-portal-toolbar tma-portal-files__toolbar">' +
      '<div class="tma-portal-toolbar__group">' + left + '</div>' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--search">' + search + '</div>' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--filters">' + right + '</div>' +
      '</div>';
  }

  function sortControl() {
    var opts = [
      { value: 'name', label: 'Name' },
      { value: 'modified', label: 'Modified' },
      { value: 'created', label: 'Created' },
      { value: 'size', label: 'Size' },
      { value: 'type', label: 'Type' },
    ];
    return '<div class="tma-portal-field tma-portal-files__sort">' +
      ui().select(opts, state.sort, 'data-files-sort', 'Sort by') +
      '<button type="button" class="tma-portal-tool tma-portal-tool--icon" data-files-action="sortdir" aria-label="Sort direction" title="' + (state.dir === 'asc' ? 'Ascending' : 'Descending') + '">' +
      '<img src="images/icons/phosphor/' + (state.dir === 'asc' ? 'SortAscending' : 'SortDescending') + '.svg" alt="" width="16" height="16"></button>' +
      '</div>';
  }

  function filterControl() {
    var opts = [
      { value: '', label: 'All types' },
      { value: 'pdf', label: 'PDF' }, { value: 'word', label: 'Word' },
      { value: 'excel', label: 'Excel' }, { value: 'powerpoint', label: 'PowerPoint' },
      { value: 'image', label: 'Images' }, { value: 'video', label: 'Video' },
      { value: 'audio', label: 'Audio' }, { value: 'archive', label: 'Archives' },
      { value: 'text', label: 'Text' },
    ];
    return '<div class="tma-portal-field tma-portal-files__filter">' +
      ui().select(opts, state.filterType, 'data-files-filter', 'Filter by type') + '</div>';
  }

  /* ── table view ─────────────────────────────────────── */

  function renderTable() {
    var showStar = !isRecycle();
    var all = items();
    var selectable = all;
    var allSel = selectable.length && selectedIds().length === selectable.length;

    var headers = [
      { html: '<input type="checkbox" class="tma-portal-check" data-files-selectall ' + (allSel ? 'checked' : '') + ' aria-label="Select all">', attrs: ' class="tma-portal-cell--tight"' },
    ];
    if (showStar) headers.push({ html: '', attrs: ' class="tma-portal-cell--tight"' });
    headers.push('Name', 'Type', 'Size', 'Owner', isRecycle() ? 'Deleted' : 'Modified', 'Sharing');

    var rows = all.map(function (it) {
      var sel = state.selected[it.id] ? ' class="tma-portal-table__row--selected"' : '';
      var star = showStar ? '<td class="tma-portal-cell--tight">' + starBtn(it) + '</td>' : '';
      var typeLabel = it.type === 'folder' ? 'Folder' : (it.category ? cap(it.category) : 'File');
      var size = it.type === 'folder' ? (it.sizeLabel || '—') : it.sizeLabel;
      var owner = it.owner ? it.owner.name : '—';
      var when = isRecycle() ? fmtDate(it.deletedAt) : fmtDate(it.modifiedAt || it.createdAt);
      var sharing = (it.assignedTo && it.assignedTo.length)
        ? '<span class="tma-portal-chip tma-portal-chip--shared">Shared</span>'
        : '<span class="tma-portal-table__muted">Private</span>';

      return '<tr' + sel + ' data-files-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '">' +
        '<td class="tma-portal-cell--tight"><input type="checkbox" class="tma-portal-check" data-files-check="' + esc(it.id) + '" ' + (state.selected[it.id] ? 'checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></td>' +
        star +
        '<td><span class="tma-portal-avatar-cell"><img src="' + esc(fileIconSrc(it)) + '" alt="" width="20" height="20" style="border-radius:0">' +
        '<button type="button" class="tma-portal-file-link" data-files-open="' + esc(it.id) + '">' + esc(it.name) + '</button></span></td>' +
        '<td class="tma-portal-table__muted">' + esc(typeLabel) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(size || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(owner) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(when) + '</td>' +
        '<td>' + sharing + '</td>' +
        '<td class="tma-portal-cell--tight"><button type="button" class="tma-portal-row-menu" data-files-menu="' + esc(it.id) + '" aria-label="More actions"><img src="images/icons/tma/ThreeDots-16.svg" alt="" width="16" height="16"></button></td>' +
        '</tr>';
    }).join('');

    return ui().table(headers, rows);
  }

  /* ── grid view ──────────────────────────────────────── */

  function renderGrid() {
    var cards = items().map(function (it) {
      var sel = state.selected[it.id] ? ' is-selected' : '';
      var thumb = (it.type === 'file' && it.previewable && it.category === 'image')
        ? '<img class="tma-portal-file-card__thumb-img" src="' + esc(it.previewUrl) + '" alt="" loading="lazy">'
        : '<img class="tma-portal-file-card__icon" src="' + esc(fileIconSrc(it)) + '" alt="" width="40" height="40">';
      var sub = it.type === 'folder'
        ? ((it.fileCount != null ? it.fileCount : 0) + ' items')
        : (it.sizeLabel || '');
      return '<div class="tma-portal-file-card' + sel + '" data-files-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '" tabindex="0">' +
        '<label class="tma-portal-file-card__check"><input type="checkbox" class="tma-portal-check" data-files-check="' + esc(it.id) + '" ' + (state.selected[it.id] ? 'checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></label>' +
        (isRecycle() ? '' : '<span class="tma-portal-file-card__star">' + starBtn(it) + '</span>') +
        '<button type="button" class="tma-portal-file-card__thumb" data-files-open="' + esc(it.id) + '">' + thumb + '</button>' +
        '<button type="button" class="tma-portal-file-card__name" data-files-open="' + esc(it.id) + '" title="' + esc(it.name) + '">' + esc(it.name) + '</button>' +
        '<span class="tma-portal-file-card__meta">' + esc(sub) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="tma-portal-grid">' + cards + '</div>';
  }

  function starBtn(it) {
    var on = !!it.favorite;
    return '<button type="button" class="tma-portal-star' + (on ? ' is-on' : '') + '" data-files-star="' + esc(it.id) + '" aria-label="' + (on ? 'Remove from favourites' : 'Add to favourites') + '" aria-pressed="' + on + '">' +
      '<img src="images/icons/phosphor/' + (on ? 'StarFilled' : 'Star') + '.svg" alt="" width="16" height="16"></button>';
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  /* ── selection bar ──────────────────────────────────── */

  function renderSelectionBar() {
    var sel = selectedItems();
    var n = sel.length;
    var canDelete = sel.every(function (i) { return perm(i, 'delete'); });
    var canMove = sel.every(function (i) { return perm(i, 'move'); });
    var canCopy = sel.every(function (i) { return perm(i, 'copy'); });

    var actions = '';
    if (isRecycle()) {
      actions += selAction('Restore', 'ArrowCounterClockwise', 'bulk-restore');
      actions += selAction('Delete forever', 'Trash', 'bulk-force');
    } else {
      actions += selAction('Download', 'ArrowLineDown', 'bulk-download');
      actions += selAction('Move', 'ArrowsOutCardinal', 'bulk-move', !canMove);
      actions += selAction('Copy', 'Copy', 'bulk-copy', !canCopy);
      actions += selAction('Favourite', 'Star', 'bulk-favorite');
      actions += selAction('Delete', 'Trash', 'bulk-delete', !canDelete);
    }

    return '<div class="tma-portal-selection-bar" role="region" aria-label="Selection">' +
      '<div class="tma-portal-selection-bar__count"><strong>' + n + '</strong> selected</div>' +
      '<div class="tma-portal-selection-bar__actions">' + actions + '</div>' +
      '<button type="button" class="tma-portal-selection-bar__clear" data-files-action="clear-selection" aria-label="Clear selection">Clear</button>' +
      '</div>';
  }

  function selAction(label, icon, action, disabled) {
    return '<button type="button" class="tma-portal-selection-bar__action" data-files-action="' + action + '"' + (disabled ? ' disabled' : '') + '>' +
      '<img src="images/icons/phosphor/' + icon + '.svg" alt="" width="16" height="16"><span class="tma-portal-selection-bar__label">' + esc(label) + '</span></button>';
  }

  function perm(item, ability) {
    if (!item.permissions) return true;
    return item.permissions[ability] !== false;
  }

  /* ── wiring ─────────────────────────────────────────── */

  function wire() {
    var el = state.el;

    // search
    ui().wireToolbarSearch(el, '[data-files-search]', function (v) {
      state.search = v.trim();
      debouncedLoad();
    });

    el.querySelectorAll('[data-files-view]').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-files-view'); render(); });
    });
    var sortSel = el.querySelector('[data-files-sort]');
    if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; load(); });
    var filterSel = el.querySelector('[data-files-filter]');
    if (filterSel) filterSel.addEventListener('change', function () { state.filterType = filterSel.value; load(); });

    // toolbar + selection-bar + generic actions (delegated)
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('contextmenu', onContextMenu);
  }

  var loadTimer = null;
  function debouncedLoad() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(load, 300);
  }

  function onClick(e) {
    var actionEl = e.target.closest('[data-files-action]');
    if (actionEl && !actionEl.disabled) { e.preventDefault(); handleAction(actionEl.getAttribute('data-files-action')); return; }

    var crumb = e.target.closest('[data-files-crumb]');
    if (crumb) { e.preventDefault(); openFolder(crumb.getAttribute('data-files-crumb') || null); return; }

    var open = e.target.closest('[data-files-open]');
    if (open) { e.preventDefault(); openItem(open.getAttribute('data-files-open')); return; }

    var star = e.target.closest('[data-files-star]');
    if (star) { e.preventDefault(); toggleStar(star.getAttribute('data-files-star')); return; }

    var menu = e.target.closest('[data-files-menu]');
    if (menu) { e.preventDefault(); e.stopPropagation(); var it = findItem(menu.getAttribute('data-files-menu')); if (it) { var r = menu.getBoundingClientRect(); openContextMenu(r.left, r.bottom + 4, it); } return; }
  }

  function onChange(e) {
    var check = e.target.closest('[data-files-check]');
    if (check) { toggleSelect(check.getAttribute('data-files-check'), check.checked); return; }
    if (e.target.closest('[data-files-selectall]')) { toggleSelectAll(e.target.checked); return; }
  }

  function onContextMenu(e) {
    var row = e.target.closest('[data-files-row]');
    if (!row) return;
    e.preventDefault();
    var it = findItem(row.getAttribute('data-id'));
    if (it) openContextMenu(e.clientX, e.clientY, it);
  }

  function bindGlobals() {
    if (globalsBound) return;
    globalsBound = true;
    document.addEventListener('tma:upload-complete', function (e) {
      var d = e.detail || {};
      if ((d.folderId || null) === (state.folder || null)) load();
    });
  }

  /* ── selection ──────────────────────────────────────── */

  function toggleSelect(id, on) {
    var it = findItem(id);
    if (!it) return;
    if (on) state.selected[id] = { type: it.type, name: it.name };
    else delete state.selected[id];
    render();
  }

  function toggleSelectAll(on) {
    state.selected = {};
    if (on) items().forEach(function (i) { state.selected[i.id] = { type: i.type, name: i.name }; });
    render();
  }

  function clearSelection() { state.selected = {}; render(); }

  /* ── navigation ─────────────────────────────────────── */

  function openFolder(uuid) {
    state.folder = uuid;
    state.selected = {};
    load();
  }

  function openItem(id) {
    var it = findItem(id);
    if (!it) return;
    if (it.type === 'folder' && !isRecycle()) openFolder(it.id);
    else if (it.type === 'file') previewOrDetails(it);
    else openDetails(it);
  }

  function previewOrDetails(file) {
    if (file.previewable && file.previewUrl && perm(file, 'preview')) {
      window.open(file.previewUrl, '_blank', 'noopener');
    } else {
      openDetails(file);
    }
  }

  /* ── actions ────────────────────────────────────────── */

  function handleAction(action) {
    switch (action) {
      case 'new-folder': return newFolderModal();
      case 'upload': return triggerUpload(false);
      case 'upload-folder': return triggerUpload(true);
      case 'paste': return pasteClipboard();
      case 'refresh': return load();
      case 'sortdir': state.dir = state.dir === 'asc' ? 'desc' : 'asc'; return load();
      case 'empty-bin': return emptyBin();
      case 'clear-selection': return clearSelection();
      case 'bulk-download': return bulkDownload();
      case 'bulk-move': return bulkDestination('move');
      case 'bulk-copy': return bulkDestination('copy');
      case 'bulk-delete': return bulkDelete();
      case 'bulk-restore': return bulk('restore');
      case 'bulk-force': return bulkForce();
      case 'bulk-favorite': return bulk('favorite');
    }
  }

  /* upload inputs (created once, reused) */
  var fileInput, folderInput;
  function ensureInputs() {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.multiple = true; fileInput.hidden = true;
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) window.TMAUpload.add(fileInput.files, { folderId: state.folder });
        fileInput.value = '';
      });
    }
    if (!folderInput) {
      folderInput = document.createElement('input');
      folderInput.type = 'file'; folderInput.hidden = true;
      folderInput.setAttribute('webkitdirectory', ''); folderInput.setAttribute('directory', '');
      document.body.appendChild(folderInput);
      folderInput.addEventListener('change', function () {
        if (folderInput.files && folderInput.files.length) uploadFolderTree(folderInput.files);
        folderInput.value = '';
      });
    }
  }

  function triggerUpload(folder) {
    ensureInputs();
    (folder ? folderInput : fileInput).click();
  }

  /* Recreate the picked folder structure, then upload each file into place. */
  function uploadFolderTree(fileList) {
    var files = Array.prototype.slice.call(fileList);
    var cache = {}; // relativeDir -> folder uuid (or state.folder for root)
    cache[''] = state.folder || null;

    function ensurePath(dir) {
      if (dir in cache) return Promise.resolve(cache[dir]);
      var parts = dir.split('/');
      var name = parts.pop();
      var parentDir = parts.join('/');
      return ensurePath(parentDir).then(function (parentUuid) {
        return net().fetchJSON(net().url('/folders'), { method: 'POST', json: { name: name, parent: parentUuid } })
          .then(function (f) { cache[dir] = f.id; return f.id; })
          .catch(function () {
            // Folder may already exist — fall back to the parent so files still land somewhere.
            cache[dir] = parentUuid; return parentUuid;
          });
      });
    }

    // Process sequentially so folders are created before their files.
    var chain = Promise.resolve();
    files.forEach(function (file) {
      var rel = file.webkitRelativePath || file.name;
      var segs = rel.split('/');
      segs.pop(); // filename
      var dir = segs.join('/');
      chain = chain.then(function () {
        return ensurePath(dir).then(function (folderUuid) {
          window.TMAUpload.add([file], { folderId: folderUuid });
        });
      });
    });
    chain.then(function () { setTimeout(load, 800); });
  }

  function newFolderModal() {
    ui().openModal({
      title: 'New folder',
      body: '<div class="tma-portal-field"><span class="tma-portal-field__label">Folder name</span>' +
        ui().input({ placeholder: 'Untitled folder', attrs: 'data-new-folder-name maxlength="255"' }) + '</div>' +
        '<div class="tma-portal-modal__foot"><button type="button" class="tma-no-data__btn" data-new-folder-save>Create folder</button></div>',
      onMount: function (host) {
        var inputEl = host.querySelector('[data-new-folder-name]');
        var save = host.querySelector('[data-new-folder-save]');
        function submit() {
          var name = (inputEl.value || '').trim();
          if (!name) { inputEl.focus(); return; }
          save.disabled = true;
          net().fetchJSON(net().url('/folders'), { method: 'POST', json: { name: name, parent: state.folder } })
            .then(function () { ui().closeModal(); ui().toast('Folder created'); load(); })
            .catch(function (err) { save.disabled = false; showModalError(host, err.message); });
        }
        save.addEventListener('click', submit);
        inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      },
    });
  }

  function renameModal(item) {
    ui().openModal({
      title: 'Rename ' + (item.type === 'folder' ? 'folder' : 'file'),
      body: '<div class="tma-portal-field"><span class="tma-portal-field__label">Name</span>' +
        ui().input({ value: item.name, attrs: 'data-rename-name maxlength="255"' }) + '</div>' +
        '<div class="tma-portal-modal__foot"><button type="button" class="tma-no-data__btn" data-rename-save>Save</button></div>',
      onMount: function (host) {
        var inputEl = host.querySelector('[data-rename-name]');
        var save = host.querySelector('[data-rename-save]');
        inputEl.focus(); inputEl.select();
        function submit() {
          var name = (inputEl.value || '').trim();
          if (!name) return;
          save.disabled = true;
          var url = item.type === 'folder' ? '/folders/' + item.id : '/files/' + item.id;
          net().fetchJSON(net().url(url), { method: 'PATCH', json: { name: name } })
            .then(function () { ui().closeModal(); ui().toast('Renamed'); load(); })
            .catch(function (err) { save.disabled = false; showModalError(host, err.message); });
        }
        save.addEventListener('click', submit);
        inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      },
    });
  }

  function showModalError(host, message) {
    var body = host.querySelector('.tma-portal-modal__body');
    var old = host.querySelector('.tma-portal-modal__error');
    if (old) old.remove();
    var div = document.createElement('div');
    div.className = 'tma-portal-modal__error';
    div.textContent = message || 'Something needs attention.';
    body.insertBefore(div, body.firstChild);
  }

  function confirmModal(opts) {
    ui().openModal({
      title: opts.title,
      body: '<p class="tma-portal-modal__text">' + esc(opts.message) + '</p>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-confirm-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn' + (opts.danger ? ' tma-portal-btn--danger' : '') + '" data-confirm-ok>' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
        '</div>',
      onMount: function (host) {
        host.querySelector('[data-confirm-cancel]').addEventListener('click', ui().closeModal);
        host.querySelector('[data-confirm-ok]').addEventListener('click', function () { ui().closeModal(); opts.onConfirm(); });
      },
    });
  }

  function toggleStar(id) {
    var it = findItem(id);
    if (!it) return;
    net().fetchJSON(net().url('/favorites/toggle'), { method: 'POST', json: { type: it.type, id: it.id } })
      .then(function (res) {
        it.favorite = res.favorite;
        if (state.section === 'favorites' && !res.favorite) load();
        else render();
      })
      .catch(function (err) { ui().toast(err.message || 'Could not update favourite'); });
  }

  function deleteItem(item) {
    confirmModal({
      title: 'Move to recycle bin',
      message: 'Move “' + item.name + '” to the recycle bin?' + (item.type === 'folder' ? ' Its contents go with it and can be restored.' : ''),
      confirmLabel: 'Move to bin', danger: true,
      onConfirm: function () {
        var url = item.type === 'folder' ? '/folders/' + item.id : '/files/' + item.id;
        net().fetchJSON(net().url(url), { method: 'DELETE' })
          .then(function () { ui().toast('Moved to recycle bin'); load(); })
          .catch(function (err) { ui().toast(err.message || 'Could not delete'); });
      },
    });
  }

  function restoreItem(item) {
    var url = (item.type === 'folder' ? '/folders/' : '/files/') + item.id + '/restore';
    net().fetchJSON(net().url(url), { method: 'POST' })
      .then(function () { ui().toast('Restored'); load(); })
      .catch(function (err) { ui().toast(err.message || 'Could not restore'); });
  }

  function forceDeleteItem(item) {
    confirmModal({
      title: 'Delete permanently',
      message: 'Permanently delete “' + item.name + '”? This cannot be undone.',
      confirmLabel: 'Delete forever', danger: true,
      onConfirm: function () {
        var url = (item.type === 'folder' ? '/folders/' : '/files/') + item.id + '/force';
        net().fetchJSON(net().url(url), { method: 'DELETE' })
          .then(function () { ui().toast('Permanently deleted'); load(); })
          .catch(function (err) { ui().toast(err.message || 'Could not delete'); });
      },
    });
  }

  function emptyBin() {
    confirmModal({
      title: 'Empty recycle bin',
      message: 'Permanently delete everything in the recycle bin? This cannot be undone.',
      confirmLabel: 'Empty bin', danger: true,
      onConfirm: function () {
        net().fetchJSON(net().url('/recycle-bin/empty'), { method: 'POST' })
          .then(function (r) { ui().toast('Recycle bin emptied'); load(); })
          .catch(function (err) { ui().toast(err.message || 'Could not empty bin'); });
      },
    });
  }

  function downloadItem(item) {
    var url = item.type === 'folder'
      ? net().url('/folders/' + item.id + '/download')
      : item.downloadUrl;
    var a = document.createElement('a');
    a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  }

  function copyItem(item) { setClipboard('copy', [item]); }
  function cutItem(item) { setClipboard('cut', [item]); }
  function setClipboard(mode, list) {
    state.clipboard = { mode: mode, items: list.map(function (i) { return { type: i.type, id: i.id, name: i.name }; }) };
    ui().toast((mode === 'cut' ? 'Cut ' : 'Copied ') + list.length + ' item' + (list.length === 1 ? '' : 's'));
    render();
  }

  function pasteClipboard() {
    if (!state.clipboard) return;
    var action = state.clipboard.mode === 'cut' ? 'move' : 'copy';
    bulkRun(action, state.clipboard.items, state.folder, function () {
      if (state.clipboard.mode === 'cut') state.clipboard = null;
      load();
    });
  }

  /* ── details ────────────────────────────────────────── */

  function openDetails(item) {
    var url = (item.type === 'folder' ? '/folders/' : '/files/') + item.id;
    net().fetchJSON(net().url(url)).then(function (d) { renderDetails(d); });
  }

  function renderDetails(d) {
    function row(label, value) {
      return '<div class="tma-portal-details__row"><span class="tma-portal-details__label">' + esc(label) + '</span><span class="tma-portal-details__value">' + esc(value == null || value === '' ? '—' : value) + '</span></div>';
    }
    var rows = '';
    rows += row('Name', d.name);
    rows += row('Type', d.type === 'folder' ? 'Folder' : (d.category ? cap(d.category) : 'File'));
    if (d.type === 'file') {
      rows += row('Extension', d.extension ? '.' + d.extension : '—');
      rows += row('MIME type', d.mime);
      rows += row('Size', d.sizeLabel);
      rows += row('Location', d.folder ? d.folder.name : 'File Box');
      rows += row('Uploaded', fmtDate(d.uploadedAt));
      rows += row('Modified', fmtDate(d.modifiedAt));
      rows += row('Uploaded by', d.uploadedBy ? d.uploadedBy.name : '—');
    } else {
      rows += row('Files', d.fileCount);
      rows += row('Subfolders', d.folderCount);
      rows += row('Total size', d.sizeLabel);
      rows += row('Location', d.parent ? d.parent.name : 'Top level');
      rows += row('Created', fmtDate(d.createdAt));
      rows += row('Modified', fmtDate(d.modifiedAt));
      rows += row('Created by', d.createdBy ? d.createdBy.name : '—');
    }
    rows += row('Owner', d.owner ? d.owner.name : '—');
    rows += row('Assigned to', (d.assignedTo && d.assignedTo.length) ? d.assignedTo.join(', ') : 'No one');
    rows += row('Sharing', (d.assignedTo && d.assignedTo.length) ? 'Shared' : 'Private');
    rows += row('Favourite', d.favorite ? 'Yes' : 'No');

    ui().openModal({
      title: 'Details',
      body: '<div class="tma-portal-details">' +
        '<div class="tma-portal-details__head"><img src="' + esc(fileIconSrc(d)) + '" alt="" width="32" height="32" style="border-radius:0"><strong>' + esc(d.name) + '</strong></div>' +
        rows +
        (d.type === 'file' && perm(d, 'download') ? '<div class="tma-portal-modal__foot"><a class="tma-no-data__btn" href="' + esc(d.downloadUrl) + '" download>Download</a></div>' : '') +
        '</div>',
    });
  }

  /* ── context menu ───────────────────────────────────── */

  var ctxEl = null;
  function closeContextMenu() {
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
    document.removeEventListener('click', closeContextMenu);
    document.removeEventListener('contextmenu', onDocCtx, true);
    document.removeEventListener('keydown', onCtxKey);
    document.removeEventListener('scroll', closeContextMenu, true);
  }
  function onCtxKey(e) { if (e.key === 'Escape') closeContextMenu(); }
  function onDocCtx(e) { if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu(); }

  function contextItems(item) {
    var list = [];
    var isFolder = item.type === 'folder';
    if (isRecycle()) {
      list.push({ label: 'Restore', fn: function () { restoreItem(item); } });
      list.push({ label: 'Delete permanently', danger: true, fn: function () { forceDeleteItem(item); } });
      list.push({ sep: true });
      list.push({ label: 'View details', fn: function () { openDetails(item); } });
      return list;
    }
    list.push({ label: isFolder ? 'Open' : 'Preview', fn: function () { openItem(item.id); } });
    if (perm(item, 'download')) list.push({ label: isFolder ? 'Download as ZIP' : 'Download', fn: function () { downloadItem(item); } });
    list.push({ sep: true });
    list.push({ label: 'Share', disabled: true, title: 'Available soon' });
    list.push({ label: 'Assign', disabled: true, title: 'Available soon' });
    list.push({ label: 'Copy link', disabled: true, title: 'Available soon' });
    list.push({ sep: true });
    if (perm(item, 'move')) list.push({ label: 'Cut', fn: function () { cutItem(item); } });
    if (perm(item, 'copy')) list.push({ label: 'Copy', fn: function () { copyItem(item); } });
    if (perm(item, 'move')) list.push({ label: 'Move to…', fn: function () { bulkRun('move', [item], null, load, true); } });
    if (perm(item, 'rename')) list.push({ label: 'Rename', fn: function () { renameModal(item); } });
    list.push({ label: item.favorite ? 'Remove from favourites' : 'Add to favourites', fn: function () { toggleStar(item.id); } });
    list.push({ sep: true });
    list.push({ label: 'View details', fn: function () { openDetails(item); } });
    if (perm(item, 'delete')) list.push({ label: 'Delete', danger: true, fn: function () { deleteItem(item); } });
    return list;
  }

  function openContextMenu(x, y, item) {
    closeContextMenu();
    // Right-clicking an item selects just it, matching common file managers.
    if (!state.selected[item.id]) { /* keep multi-select if already selected */ }

    var list = contextItems(item);
    ctxEl = document.createElement('div');
    ctxEl.className = 'tma-portal-context-menu';
    ctxEl.setAttribute('role', 'menu');
    ctxEl.innerHTML = list.map(function (it, i) {
      if (it.sep) return '<div class="tma-portal-context-menu__sep" role="separator"></div>';
      return '<button type="button" class="tma-portal-context-menu__item' + (it.danger ? ' tma-portal-context-menu__item--danger' : '') + '" role="menuitem" data-ctx="' + i + '"' + (it.disabled ? ' disabled' : '') + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' + esc(it.label) + '</button>';
    }).join('');
    document.body.appendChild(ctxEl);

    var w = ctxEl.offsetWidth, h = ctxEl.offsetHeight;
    var left = Math.min(x, window.innerWidth - w - 8);
    var top = Math.min(y, window.innerHeight - h - 8);
    ctxEl.style.left = Math.max(8, left) + 'px';
    ctxEl.style.top = Math.max(8, top) + 'px';

    ctxEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ctx]');
      if (!b || b.disabled) return;
      var picked = list[parseInt(b.getAttribute('data-ctx'), 10)];
      closeContextMenu();
      if (picked && picked.fn) picked.fn();
    });

    setTimeout(function () {
      document.addEventListener('click', closeContextMenu);
      document.addEventListener('contextmenu', onDocCtx, true);
      document.addEventListener('keydown', onCtxKey);
      document.addEventListener('scroll', closeContextMenu, true);
    }, 0);
  }

  /* ── bulk operations ────────────────────────────────── */

  function bulkPayload() {
    return selectedItems().map(function (i) { return { type: i.type, id: i.id }; });
  }

  function bulk(action) {
    bulkRun(action, bulkPayload(), null, function () { clearSelection(); load(); });
  }

  function bulkDelete() {
    var n = selectedIds().length;
    confirmModal({
      title: 'Move to recycle bin', message: 'Move ' + n + ' item' + (n === 1 ? '' : 's') + ' to the recycle bin?',
      confirmLabel: 'Move to bin', danger: true,
      onConfirm: function () { bulk('delete'); },
    });
  }

  function bulkForce() {
    var n = selectedIds().length;
    confirmModal({
      title: 'Delete permanently', message: 'Permanently delete ' + n + ' item' + (n === 1 ? '' : 's') + '? This cannot be undone.',
      confirmLabel: 'Delete forever', danger: true,
      onConfirm: function () { bulk('forceDelete'); },
    });
  }

  function bulkDownload() {
    selectedItems().forEach(function (it) { downloadItem(it); });
  }

  function bulkDestination(mode) {
    bulkRun(mode, bulkPayload(), null, function () { clearSelection(); load(); }, true);
  }

  /* Run a bulk action; when pickTarget is true, open the destination picker. */
  function bulkRun(action, payload, target, onDone, pickTarget) {
    if (!payload.length) return;
    if ((action === 'move' || action === 'copy') && pickTarget) {
      openDestinationPicker(action === 'move' ? 'Move to' : 'Copy to', function (dest) {
        postBulk(action, payload, dest, onDone);
      });
      return;
    }
    postBulk(action, payload, target, onDone);
  }

  function postBulk(action, payload, target, onDone) {
    net().fetchJSON(net().url('/bulk'), { method: 'POST', json: { action: action, items: payload, target: target } })
      .then(function (res) {
        if (res.errors && res.errors.length) ui().toast(res.errors[0].message);
        else ui().toast('Done');
        if (onDone) onDone();
      })
      .catch(function (err) { ui().toast(err.message || 'Action failed'); });
  }

  /* ── destination picker (mini folder browser) ───────── */

  function openDestinationPicker(title, onPick) {
    var pick = { folder: null, name: (SECTIONS[state.section] || SECTIONS.all).title, crumb: [] };

    ui().openModal({
      title: title,
      body: '<div class="tma-portal-picker" data-picker><div class="tma-portal-picker__loading">Loading…</div></div>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-picker-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-picker-ok>' + esc(title.split(' ')[0]) + ' here</button></div>',
      onMount: function (host) {
        var body = host.querySelector('[data-picker]');
        host.querySelector('[data-picker-cancel]').addEventListener('click', ui().closeModal);
        host.querySelector('[data-picker-ok]').addEventListener('click', function () { ui().closeModal(); onPick(pick.folder); });

        function loadPicker() {
          body.innerHTML = '<div class="tma-portal-picker__loading">Loading…</div>';
          var p = new URLSearchParams();
          p.set('section', 'my');
          if (pick.folder) p.set('folder', pick.folder);
          p.set('perPage', '200'); p.set('sort', 'name');
          net().fetchJSON(net().url('/?' + p.toString())).then(function (res) {
            pick.crumb = res.breadcrumb || [];
            var crumbHtml = '<button type="button" class="tma-portal-picker__crumb" data-pick-crumb="">Top level</button>';
            (res.breadcrumb || []).forEach(function (c) {
              crumbHtml += ' / <button type="button" class="tma-portal-picker__crumb" data-pick-crumb="' + esc(c.id) + '">' + esc(c.name) + '</button>';
            });
            var folders = (res.folders || []);
            var listHtml = folders.length
              ? folders.map(function (f) {
                  return '<button type="button" class="tma-portal-picker__folder" data-pick-open="' + esc(f.id) + '">' +
                    '<img src="images/icons/phosphor/FolderFilled.svg" alt="" width="20" height="20"><span>' + esc(f.name) + '</span></button>';
                }).join('')
              : '<p class="tma-portal-picker__empty">No subfolders here.</p>';
            body.innerHTML = '<div class="tma-portal-picker__crumbs">' + crumbHtml + '</div><div class="tma-portal-picker__list">' + listHtml + '</div>';

            body.querySelectorAll('[data-pick-open]').forEach(function (b) {
              b.addEventListener('click', function () { pick.folder = b.getAttribute('data-pick-open'); loadPicker(); });
            });
            body.querySelectorAll('[data-pick-crumb]').forEach(function (b) {
              b.addEventListener('click', function () { pick.folder = b.getAttribute('data-pick-crumb') || null; loadPicker(); });
            });
          }).catch(function () { body.innerHTML = '<p class="tma-portal-picker__empty">Could not load folders.</p>'; });
        }
        loadPicker();
      },
    });
  }

  /* ── mount / registration ───────────────────────────── */

  function mount(el, opts) {
    opts = opts || {};
    state.el = el;
    state.navId = opts.navId && NAV_SECTION[opts.navId] ? opts.navId : (opts.navId || 'folders-all');
    state.section = NAV_SECTION[state.navId] || 'all';
    state.folder = null;
    state.selected = {};
    state.error = null;
    render();
    load();
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('folders', mount);
  }
})();
