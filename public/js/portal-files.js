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

  function isAdminUser() {
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    return !!(me && me.isAdmin);
  }

  // Promote an existing top-level folder to a shared organization default.
  function makeDefaultFolder(item) {
    var url = (window.__TMA_SITE_ROOT || '') + '/portal/file-library/adopt-folder';
    net().fetchJSON(url, { method: 'POST', json: { folder: item.id, audience: 'all_staff', role: 'viewer' } })
      .then(function () {
        ui().toast('“' + item.name + '” is now a default folder for all staff');
        if (window.TMASidebarShortcuts && window.TMASidebarShortcuts.refresh) window.TMASidebarShortcuts.refresh();
        load();
      })
      .catch(function (e) { ui().toast((e && e.message) || 'Couldn’t make this a default folder'); });
  }

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
    busy: {},            // uuid -> true while an action on that item is in flight
  };

  var globalsBound = false;
  var nameClickTimer = null;

  /* ── helpers ───────────────────────────────────────── */

  function fileIconSrc(item) {
    if (item.type === 'folder') {
      var base = item.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
      return window.TMAFolderColours ? window.TMAFolderColours.iconSrc(base, item.colour) : 'images/icons/phosphor/' + base + '.svg';
    }
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(item.icon, item.name);
    return 'images/icons/phosphor/File.svg';
  }

  // Full folder icon markup: the coloured folder image, plus the optional
  // stamped content icon layered on its front panel. Falls back to a bare
  // <img> (today's exact markup) when no custom icon is set.
  function folderIconHtml(item, size) {
    var base = item.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
    return window.TMAFolderIcons
      ? window.TMAFolderIcons.html(base, item.colour, item.iconName, size)
      : '<img src="' + esc(fileIconSrc(item)) + '" alt="" width="' + size + '" height="' + size + '">';
  }

  // A real image thumbnail (server-generated) when available, else the type
  // icon. Falls back to the icon if the thumbnail can't be produced.
  function thumbOrIcon(item, size) {
    if (item.type === 'folder') return folderIconHtml(item, size);
    var icon = fileIconSrc(item);
    if (item.type === 'file' && item.thumbUrl) {
      return '<img class="tma-portal-file-thumb" src="' + esc(item.thumbUrl) + '" alt="" loading="lazy" width="' + size + '" height="' + size + '"' +
        ' onerror="this.onerror=null;this.classList.add(\'is-fallback\');this.src=\'' + esc(icon) + '\'">';
    }
    return '<img class="tma-portal-file-thumb is-fallback" src="' + esc(icon) + '" alt="" width="' + size + '" height="' + size + '">';
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

  /* Something happened that may change which folders exist or what they're
     called — anything mirroring folders (the sidebar shortcuts) re-reads. */
  function foldersChanged() {
    try { document.dispatchEvent(new CustomEvent('tma:folders-changed')); } catch (e) {}
  }

  function items() { return state.data.folders.concat(state.data.files); }
  function findItem(id) { return items().filter(function (i) { return i.id === id; })[0]; }
  function selectedIds() { return Object.keys(state.selected); }
  function selectedItems() { return selectedIds().map(findItem).filter(Boolean); }
  function isRecycle() { return state.section === 'recycle'; }

  // One in-flight action per item at a time - a second click on the same
  // row while it's saving is ignored rather than firing a duplicate request.
  function isBusy(id) { return !!state.busy[id]; }
  function setBusy(id, on) { if (on) state.busy[id] = true; else delete state.busy[id]; }

  function canCreateHere() {
    if (isRecycle() || state.section === 'recent' || state.section === 'shared') return false;
    if (state.folder) return true; // browsing inside a folder
    return !!UPLOADABLE[state.section];
  }

  /* ── data loading ──────────────────────────────────── */

  function load(silent) {
    if (!silent) {
      state.loading = true;
      render();
    }
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

  /* ── seamless insert ────────────────────────────────
     A newly created folder / uploaded file drops into the current listing in
     its sorted position and flashes in — no full-library refresh. */

  function insertItem(item) {
    if (!item || !item.id || !matchesCurrentView(item)) return;
    var list = item.type === 'folder' ? state.data.folders : state.data.files;

    // Replace an existing entry with the same id; for files also drop a prior
    // same-name file (a "replace" upload) so we don't show a stale duplicate.
    for (var i = list.length - 1; i >= 0; i--) {
      var same = list[i].id === item.id ||
        (item.type === 'file' && String(list[i].name).toLowerCase() === String(item.name).toLowerCase());
      if (same) list.splice(i, 1);
    }
    list.push(item);
    sortList(list);
    render();
    flashNew(item.id);
  }

  // Does a freshly created item belong in exactly what's on screen right now?
  function matchesCurrentView(item) {
    if (!canCreateHere()) return false; // recycle/recent/shared aren't plain listings
    var parentId = (item.type === 'folder' ? (item.parent && item.parent.id) : (item.folder && item.folder.id)) || null;
    if (parentId !== (state.folder || null)) return false;
    if (state.section === 'filebox' && !state.folder && item.type === 'folder') return false;
    if (item.type === 'file' && state.filterType && item.category !== state.filterType) return false;
    if (state.search && String(item.name || '').toLowerCase().indexOf(state.search.toLowerCase()) === -1) return false;
    return true;
  }

  function sortList(list) {
    var dir = state.dir === 'desc' ? -1 : 1;
    list.sort(function (a, b) { return compareItems(a, b) * dir; });
  }

  function compareItems(a, b) {
    switch (state.sort) {
      case 'modified': return cmpStr(a.modifiedAt || a.updatedAt, b.modifiedAt || b.updatedAt);
      case 'created': return cmpStr(a.createdAt, b.createdAt);
      case 'size': return (a.size || 0) - (b.size || 0);
      case 'type': return String(a.extension || '').localeCompare(String(b.extension || '')) || cmpName(a, b);
      default: return cmpName(a, b);
    }
  }
  function cmpName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }); }
  function cmpStr(x, y) { x = x || ''; y = y || ''; return x < y ? -1 : (x > y ? 1 : 0); }

  function flashNew(id) {
    if (!state.el) return;
    var node = state.el.querySelector('[data-files-row][data-id="' + id + '"]');
    if (!node) return;
    node.classList.add('is-new');
    if (node.scrollIntoView) { try { node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
  }

  /* ── seamless remove / patch / rerender ─────────────
     The counterparts to insertItem(): drop an item that no longer belongs
     (deleted, moved elsewhere) or patch fields on one that's still here
     (renamed, recoloured, resorted, sharing changed) — always local, never
     a network refetch of the listing. */

  function removeItem(id) {
    ['folders', 'files'].forEach(function (key) {
      var list = state.data[key];
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].id === id) list.splice(i, 1);
      }
    });
    delete state.selected[id];
    if (state.clipboard) {
      state.clipboard.items = state.clipboard.items.filter(function (i) { return i.id !== id; });
    }
  }

  function updateItem(id, patch) {
    var it = findItem(id);
    if (it) { for (var k in patch) { if (patch.hasOwnProperty(k)) it[k] = patch[k]; } }
    return it;
  }

  // The page's own scroll container (.tma-dash__main) is never part of the
  // innerHTML that render() replaces, so it already keeps its scroll
  // position across a render() call - this just makes that guarantee
  // explicit instead of relying on the DOM structure never changing.
  function scrollContainer() { return state.el ? state.el.closest('.tma-dash__main') : null; }

  function rerender() {
    var sc = scrollContainer();
    var top = sc ? sc.scrollTop : null;
    render();
    if (sc && top != null) sc.scrollTop = top;
  }

  /* ── instant new folder + inline rename ─────────────── */

  // "New folder" creates an auto-named "Untitled folder" immediately, pops it
  // in, and drops straight into inline rename (text pre-selected).
  function createUntitledFolder() {
    net().fetchJSON(net().url('/folders'), { method: 'POST', json: { name: 'Untitled folder', parent: state.folder, auto: true } })
      .then(function (folder) { insertItem(folder); startRename(folder.id); })
      .catch(function (err) { ui().toast(err.message || 'Could not create folder'); });
  }

  // Turn an item's name into an inline editable field. Enter or clicking away
  // keeps the name; Escape reverts. No modal, no right-click.
  function startRename(id) {
    if (isBusy(id)) return;
    var it = findItem(id);
    if (!it || !perm(it, 'rename') || !state.el) return;
    var nameEl = state.el.querySelector('[data-files-row][data-id="' + id + '"] [data-files-open="' + id + '"]');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tma-portal-rename-input';
    input.value = it.name;
    input.setAttribute('maxlength', '255');
    input.setAttribute('aria-label', 'Rename ' + it.name);
    nameEl.replaceWith(input);
    // preventScroll: focusing a field that's already on screen must not
    // nudge the list's scroll position - the browser's default focus
    // behaviour otherwise scrolls it back into "ideal" view.
    input.focus({ preventScroll: true });
    input.select();

    var settled = false;
    function commit() {
      if (settled) return; settled = true;
      var next = input.value.trim();
      if (!next || next === it.name) { rerender(); return; } // keep as-is
      doRename(it, next);
    }
    function cancel() {
      if (settled) return; settled = true;
      rerender();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation();
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', commit);
  }

  function doRename(it, next) {
    setBusy(it.id, true);
    rerender();
    var url = (it.type === 'folder' ? '/folders/' : '/files/') + it.id;
    net().fetchJSON(net().url(url), { method: 'PATCH', json: { name: next } })
      .then(function (updated) {
        setBusy(it.id, false);
        var list = it.type === 'folder' ? state.data.folders : state.data.files;
        for (var i = 0; i < list.length; i++) { if (list[i].id === it.id) { list[i] = updated; break; } }
        sortList(list);
        rerender();
        if (it.type === 'folder') foldersChanged();
      })
      .catch(function (err) { setBusy(it.id, false); ui().toast(err.message || 'Could not rename'); rerender(); });
  }

  /* ── render ─────────────────────────────────────────── */

  function render() {
    if (!state.el) return;
    var meta = SECTIONS[state.section] || SECTIONS.all;

    var html = '<div class="tma-portal-page tma-portal-page--files">';
    html += '<div class="tma-portal-page__head">' +
      '<div><h2 class="tma-portal-page__title">' + esc(meta.title) + '</h2></div></div>';

    html += renderBreadcrumb();
    html += renderToolbar();

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
    // Global skeleton placeholder (no spinner, never dummy rows).
    if (window.TMASkeleton) {
      return state.view === 'grid'
        ? window.TMASkeleton.cards(10)
        : window.TMASkeleton.rows(8, { trailing: true });
    }
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

  // Documented flat toolbar icon button (same as the Users table): no pill,
  // no border, hover background only. opts.view uses the view-toggle hook.
  function toolBtn(icon, action, label, opts) {
    opts = opts || {};
    var hook = opts.view ? ' data-files-view="' + opts.view + '"' : ' data-files-action="' + esc(action) + '"';
    return '<button type="button" class="tma-dash__tool-btn' + (opts.active ? ' is-active' : '') + '"' + hook +
      (opts.disabled ? ' disabled' : '') +
      ' aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
      (opts.pressed != null ? ' aria-pressed="' + opts.pressed + '"' : '') + '>' +
      '<img src="images/icons/phosphor/' + icon + '.svg" alt=""></button>';
  }

  function renderToolbar() {
    var sel = selectedItems();
    var n = sel.length;
    var create = canCreateHere();

    var actions = '';
    if (create) {
      actions += toolBtn('FolderPlus', 'new-folder', 'New folder');
      actions += toolBtn('CloudUpload', 'upload', 'Upload files');
      actions += toolBtn('FolderNotchPlus', 'upload-folder', 'Upload folder');
    }
    if (state.clipboard && create) actions += toolBtn('Clipboard', 'paste', 'Paste (' + state.clipboard.items.length + ')');
    if (isRecycle()) actions += toolBtn('Trash', 'empty-bin', 'Empty recycle bin', { disabled: !items().length });

    actions += toolBtn('Rows', null, 'List view', { view: 'table', active: state.view === 'table', pressed: state.view === 'table' });
    actions += toolBtn('GridFour', null, 'Grid view', { view: 'grid', active: state.view === 'grid', pressed: state.view === 'grid' });
    actions += toolBtn(state.dir === 'asc' ? 'SortAscending' : 'SortDescending', 'sortdir', 'Sort ' + (state.dir === 'asc' ? 'descending' : 'ascending'));
    actions += toolBtn('ArrowClockwise', 'refresh', 'Refresh');
    actions += sortFieldSelect();
    actions += filterControl();

    // Bulk actions appear inline after a divider + "N Selected", exactly like
    // the Users table, and stay hidden until something is selected.
    var bulk = '<div class="tma-dash__toolbar-bulk" data-files-bulk' + (n === 0 ? ' hidden' : '') + '>' +
      '<img class="tma-dash__toolbar-divider" src="images/icons/tma/Line-16.svg" alt="" aria-hidden="true">' +
      '<span class="tma-dash__toolbar-selection" aria-live="polite">' + n + ' Selected</span>' +
      bulkButtons(sel) +
      '</div>';

    var search = ui().searchInput('Search files', 'data-files-search', state.search);

    return '<div class="tma-dash__toolbar' + (n > 0 ? ' tma-dash__toolbar--selected' : '') + ' tma-portal-files__toolbar">' +
      '<div class="tma-dash__toolbar-actions">' + actions + bulk + '</div>' +
      search +
      '</div>';
  }

  function bulkButtons(sel) {
    if (isRecycle()) {
      return toolBtn('ArrowCounterClockwise', 'bulk-restore', 'Restore') +
        toolBtn('Trash', 'bulk-force', 'Delete forever');
    }
    var canDelete = sel.every(function (i) { return perm(i, 'delete'); });
    var canMove = sel.every(function (i) { return perm(i, 'move'); });
    var canCopy = sel.every(function (i) { return perm(i, 'copy'); });
    // A request signs exactly one document, so this appears only for a single
    // signable file - never for a folder or a multi-selection.
    var signable = sel.length === 1 && sel[0].type === 'file' && canSendForSignature(sel[0]);
    // Colour/icon are per-folder settings - only offered for a single
    // folder, never a multi-selection (which could mix regular and
    // default-type folders).
    var colourable = sel.length === 1 && sel[0].type === 'folder' && perm(sel[0], 'colour');
    var iconable = sel.length === 1 && sel[0].type === 'folder' && perm(sel[0], 'icon');
    return toolBtn('ArrowLineDown', 'bulk-download', 'Download') +
      (signable ? toolBtn('Signature', 'bulk-signature', 'Send for signature') : '') +
      (colourable || iconable ? toolBtn('Palette', 'bulk-appearance', 'Folder appearance') : '') +
      toolBtn('ArrowsOutCardinal', 'bulk-move', 'Move', { disabled: !canMove }) +
      toolBtn('Copy', 'bulk-copy', 'Copy', { disabled: !canCopy }) +
      toolBtn('Star', 'bulk-favorite', 'Add to favourites') +
      toolBtn('Trash', 'bulk-delete', 'Delete', { disabled: !canDelete });
  }

  // Sort + type controls use the documented head-dropdown component (styled
  // button + caret + menu), not a raw <select>.
  function menuControl(opts, current, attr, menuLabel) {
    var sel = opts.filter(function (o) { return String(o.value) === String(current); })[0] || opts[0];
    return ui().headDropdown({
      label: sel.label,
      menuLabel: menuLabel,
      wrapAttrs: attr,
      items: opts.map(function (o) { return { label: o.label, action: o.value }; }),
    });
  }

  function sortFieldSelect() {
    return menuControl([
      { value: 'name', label: 'Name' },
      { value: 'modified', label: 'Modified' },
      { value: 'created', label: 'Created' },
      { value: 'size', label: 'Size' },
      { value: 'type', label: 'Type' },
    ], state.sort, 'data-files-sort-menu', 'Sort by');
  }

  function filterControl() {
    return menuControl([
      { value: '', label: 'All types' },
      { value: 'pdf', label: 'PDF' }, { value: 'word', label: 'Word' },
      { value: 'excel', label: 'Excel' }, { value: 'powerpoint', label: 'PowerPoint' },
      { value: 'image', label: 'Images' }, { value: 'video', label: 'Video' },
      { value: 'audio', label: 'Audio' }, { value: 'archive', label: 'Archives' },
      { value: 'text', label: 'Text' },
    ], state.filterType, 'data-files-filter-menu', 'Filter by type');
  }

  /* ── table view ─────────────────────────────────────── */

  function renderTable() {
    var showStar = !isRecycle();
    var all = items();
    var selectable = all;
    var allSel = selectable.length && selectedIds().length === selectable.length;

    var headers = [
      { html: '<input type="checkbox" class="tma-dash__check" data-files-selectall ' + (allSel ? 'checked' : '') + ' aria-label="Select all">', attrs: ' class="tma-portal-cell--tight"' },
    ];
    if (showStar) headers.push({ html: '', attrs: ' class="tma-portal-cell--tight"' });
    headers.push('Name', 'Type', 'Size', 'Owner', isRecycle() ? 'Deleted' : 'Modified', 'Sharing');

    var rows = all.map(function (it) {
      var busy = isBusy(it.id);
      var rowClasses = [];
      if (state.selected[it.id]) rowClasses.push('tma-portal-table__row--selected');
      if (busy) rowClasses.push('is-busy');
      var cls = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';
      var star = showStar ? '<td class="tma-portal-cell--tight">' + starBtn(it) + '</td>' : '';
      var typeLabel = it.type === 'folder' ? 'Folder' : (it.category ? cap(it.category) : 'File');
      var size = it.type === 'folder' ? (it.sizeLabel || '—') : it.sizeLabel;
      var owner = ownerCell(it.owner);
      var when = isRecycle() ? fmtDate(it.deletedAt) : fmtDate(it.modifiedAt || it.createdAt);
      var sharing = (it.assignedTo && it.assignedTo.length)
        ? '<span class="tma-portal-chip tma-portal-chip--shared">Shared</span>'
        : '<span class="tma-portal-table__muted">Private</span>';
      var busySpin = busy ? '<img class="tma-portal-row-spinner" src="images/icons/tma/Loading-16.svg" alt="" width="14" height="14">' : '';

      return '<tr' + cls + ' data-files-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '">' +
        '<td class="tma-portal-cell--tight"><input type="checkbox" class="tma-dash__check" data-files-check="' + esc(it.id) + '" ' + (state.selected[it.id] ? 'checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></td>' +
        star +
        '<td><span class="tma-portal-avatar-cell">' + thumbOrIcon(it, 24) +
        '<button type="button" class="tma-portal-file-link" data-files-open="' + esc(it.id) + '">' + esc(it.name) + '</button>' + busySpin + '</span></td>' +
        '<td class="tma-portal-table__muted">' + esc(typeLabel) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(size || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + owner + '</td>' +
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
      var busy = isBusy(it.id);
      var cardClasses = [];
      if (state.selected[it.id]) cardClasses.push('is-selected');
      if (busy) cardClasses.push('is-busy');
      var cls = cardClasses.length ? ' ' + cardClasses.join(' ') : '';
      var thumb = it.type === 'folder'
        ? folderIconHtml(it, 40)
        : (it.thumbUrl
          ? '<img class="tma-portal-file-card__thumb-img" src="' + esc(it.thumbUrl) + '" alt="" loading="lazy"' +
            ' onerror="this.onerror=null;this.classList.remove(\'tma-portal-file-card__thumb-img\');this.classList.add(\'tma-portal-file-card__icon\');this.src=\'' + esc(fileIconSrc(it)) + '\'">'
          : '<img class="tma-portal-file-card__icon" src="' + esc(fileIconSrc(it)) + '" alt="" width="40" height="40">');
      var sub = it.type === 'folder'
        ? ((it.fileCount != null ? it.fileCount : 0) + ' items')
        : (it.sizeLabel || '');
      var busySpin = busy ? '<img class="tma-portal-row-spinner tma-portal-row-spinner--card" src="images/icons/tma/Loading-16.svg" alt="" width="14" height="14">' : '';
      return '<div class="tma-portal-file-card' + cls + '" data-files-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '" tabindex="0">' +
        '<label class="tma-portal-file-card__check"><input type="checkbox" class="tma-dash__check" data-files-check="' + esc(it.id) + '" ' + (state.selected[it.id] ? 'checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></label>' +
        (isRecycle() ? '' : '<span class="tma-portal-file-card__star">' + starBtn(it) + '</span>') +
        busySpin +
        '<button type="button" class="tma-portal-file-card__thumb" data-files-open="' + esc(it.id) + '">' + thumb + '</button>' +
        '<button type="button" class="tma-portal-file-card__name" data-files-open="' + esc(it.id) + '" title="' + esc(it.name) + '">' + esc(it.name) + '</button>' +
        '<span class="tma-portal-file-card__meta">' + esc(sub) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="tma-portal-grid">' + cards + '</div>';
  }

  function starBtn(it) {
    var on = !!it.favorite;
    // Inline SVG so the "on" state is a clear filled yellow star (not an
    // <img> we can only dim). Off = hollow grey outline.
    var path = 'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';
    return '<button type="button" class="tma-portal-star' + (on ? ' is-on' : '') + '" data-files-star="' + esc(it.id) + '" aria-label="' + (on ? 'Remove from favourites' : 'Add to favourites') + '" aria-pressed="' + on + '">' +
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
      '<path d="' + path + '" ' + (on ? 'fill="#ffcc00" stroke="#e0ac00"' : 'fill="none" stroke="currentColor"') + ' stroke-width="1.3" stroke-linejoin="round"/></svg></button>';
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  /* Bulk actions now live inline in the toolbar (see renderToolbar /
     bulkButtons), matching the Users table's toolbar-bulk layout. */

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
    ui().wireHeadDropdownAll(el, '[data-files-sort-menu]', function (sel) { state.sort = sel.action; load(); });
    ui().wireHeadDropdownAll(el, '[data-files-filter-menu]', function (sel) { state.filterType = sel.action; load(); });

    // toolbar + selection-bar + generic actions (delegated)
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('change', onChange);
    el.addEventListener('contextmenu', onContextMenu);

    // drag-to-move: rows and grid cards are draggable (except the recycle bin)
    if (!isRecycle()) {
      el.querySelectorAll('[data-files-row]').forEach(function (r) { r.setAttribute('draggable', 'true'); });
    }
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
    if (open) {
      e.preventDefault();
      // Delay the open just enough that a double-click on the name renames
      // instead of opening.
      var oid = open.getAttribute('data-files-open');
      if (nameClickTimer) clearTimeout(nameClickTimer);
      nameClickTimer = setTimeout(function () { nameClickTimer = null; openItem(oid); }, 220);
      return;
    }

    var star = e.target.closest('[data-files-star]');
    if (star) { e.preventDefault(); toggleStar(star.getAttribute('data-files-star')); return; }

    var menu = e.target.closest('[data-files-menu]');
    if (menu) { e.preventDefault(); e.stopPropagation(); var it = findItem(menu.getAttribute('data-files-menu')); if (it) { var r = menu.getBoundingClientRect(); openContextMenu(r.left, r.bottom + 4, it); } return; }

    // Click anywhere on the row (name, cells, card) opens the item — but not
    // the checkbox/label (selection), the star, or the row menu.
    var row = e.target.closest('[data-files-row]');
    if (row && !e.target.closest('input, label, .tma-portal-star, [data-files-menu]')) {
      openItem(row.getAttribute('data-id'));
    }
  }

  function onChange(e) {
    var check = e.target.closest('[data-files-check]');
    if (check) { toggleSelect(check.getAttribute('data-files-check'), check.checked); return; }
    if (e.target.closest('[data-files-selectall]')) { toggleSelectAll(e.target.checked); return; }
  }

  // Double-click a name → inline rename (cancels the pending single-click open).
  function onDblClick(e) {
    var open = e.target.closest('[data-files-open]');
    if (!open) return;
    e.preventDefault();
    if (nameClickTimer) { clearTimeout(nameClickTimer); nameClickTimer = null; }
    startRename(open.getAttribute('data-files-open'));
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
      // Pop the finished file into place without refreshing the whole library.
      if (d.file) insertItem(d.file);
      else if ((d.folderId || null) === (state.folder || null)) load(true);
    });
    bindDrop();
    bindInternalMove();
  }

  /* ── drag items onto a folder / breadcrumb to move them ── */

  var draggingItems = null;

  function bindInternalMove() {
    var el = state.el;
    if (!el) return;

    el.addEventListener('dragstart', function (e) {
      var row = e.target.closest('[data-files-row]');
      if (!row || isRecycle()) return;
      var id = row.getAttribute('data-id');
      var it = findItem(id);
      if (!it) return;
      // Drag the whole selection if the grabbed item is part of it; else just it.
      var ids = state.selected[id] ? selectedIds() : [id];
      draggingItems = ids.map(findItem).filter(Boolean).map(function (i) { return { id: i.id, type: i.type }; });
      try { e.dataTransfer.setData('application/x-tma-move', '1'); } catch (err) {}
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });

    el.addEventListener('dragover', function (e) {
      var t = moveTarget(e);
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!t.el.classList.contains('is-drop-into')) { clearMoveHighlight(); t.el.classList.add('is-drop-into'); }
    });

    el.addEventListener('dragleave', function (e) {
      var into = e.target.closest('.is-drop-into');
      if (into && !into.contains(e.relatedTarget)) into.classList.remove('is-drop-into');
    });

    el.addEventListener('drop', function (e) {
      var t = moveTarget(e);
      clearMoveHighlight();
      if (!t) return;
      e.preventDefault();
      var moving = draggingItems;
      draggingItems = null;
      if (moving && moving.length) bulkRun('move', moving, t.id, clearSelection);
    });

    el.addEventListener('dragend', function () {
      clearMoveHighlight();
      var d = el.querySelector('.is-dragging');
      if (d) d.classList.remove('is-dragging');
      draggingItems = null;
    });
  }

  // A valid drop target: a folder row/card, or a breadcrumb crumb (null = root).
  function moveTarget(e) {
    if (!draggingItems) return null;
    var crumb = e.target.closest('[data-files-crumb]');
    if (crumb) {
      var cid = crumb.getAttribute('data-files-crumb') || null;
      if (cid && draggingItems.some(function (d) { return d.id === cid; })) return null;
      return { el: crumb, id: cid };
    }
    var row = e.target.closest('[data-files-row]');
    if (!row || row.getAttribute('data-type') !== 'folder') return null;
    var fid = row.getAttribute('data-id');
    if (draggingItems.some(function (d) { return d.id === fid; })) return null; // not onto itself
    return { el: row, id: fid };
  }

  function clearMoveHighlight() {
    if (!state.el) return;
    state.el.querySelectorAll('.is-drop-into').forEach(function (n) { n.classList.remove('is-drop-into'); });
  }

  /* ── drag-and-drop upload ───────────────────────────── */

  var dropOverlay = null;
  function ensureDropOverlay() {
    if (dropOverlay) return dropOverlay;
    dropOverlay = document.createElement('div');
    dropOverlay.className = 'tma-portal-dropzone';
    dropOverlay.hidden = true;
    dropOverlay.innerHTML =
      '<div class="tma-portal-dropzone__inner">' +
        '<img class="tma-portal-dropzone__icon" src="images/icons/phosphor/CloudUpload.svg" alt="" aria-hidden="true">' +
        '<p class="tma-portal-dropzone__text">Drop files to upload</p>' +
      '</div>';
    document.body.appendChild(dropOverlay);
    return dropOverlay;
  }

  /* Full-window drag-and-drop overlay. Shows while files are dragged over any
     file-manager page; the drop uploads into the current folder. */
  function bindDrop() {
    var depth = 0;
    function hasFiles(e) { var dt = e.dataTransfer; return dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1; }
    function dropActive() {
      if (!state.el || !state.el.isConnected) return false;
      var view = state.el.closest('.tma-dash__view');
      if (view && view.hasAttribute('hidden')) return false; // folders view not on screen
      return canCreateHere() && !isRecycle();
    }
    function show() { ensureDropOverlay().hidden = false; }
    function hide() { if (dropOverlay) dropOverlay.hidden = true; depth = 0; }

    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e) || !dropActive()) return;
      e.preventDefault(); depth++; show();
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e) || !dropActive()) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth--; if (depth <= 0) hide();
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e) || !dropActive()) { hide(); return; }
      e.preventDefault(); hide();
      handleDrop(e.dataTransfer);
    });
    window.addEventListener('dragend', hide);
  }

  function handleDrop(dt) {
    var out = [];
    var itemList = dt.items;
    if (itemList && itemList.length && itemList[0] && itemList[0].webkitGetAsEntry) {
      var entries = [];
      for (var i = 0; i < itemList.length; i++) {
        var en = itemList[i].webkitGetAsEntry && itemList[i].webkitGetAsEntry();
        if (en) entries.push(en);
      }
      if (entries.length) {
        Promise.all(entries.map(function (en) { return readEntry(en, '', out); })).then(function () { uploadCollected(out); });
        return;
      }
    }
    Array.prototype.forEach.call(dt.files || [], function (f) { out.push({ file: f, rel: f.name }); });
    uploadCollected(out);
  }

  function readEntry(entry, prefix, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(function (file) { out.push({ file: file, rel: prefix + file.name }); resolve(); }, resolve);
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var acc = [];
        (function readBatch() {
          reader.readEntries(function (batch) {
            if (!batch.length) {
              Promise.all(acc.map(function (e) { return readEntry(e, prefix + entry.name + '/', out); })).then(resolve);
            } else { acc = acc.concat(Array.prototype.slice.call(batch)); readBatch(); }
          }, resolve);
        })();
      } else { resolve(); }
    });
  }

  function uploadCollected(list) {
    if (!list.length) return;
    var nested = list.some(function (it) { return it.rel.indexOf('/') !== -1; });
    if (!nested) {
      window.TMAUpload.add(list.map(function (it) { return it.file; }), { folderId: state.folder });
      return;
    }
    // Nested folders dropped: recreate the tree, then upload each file into place.
    var cache = {}; cache[''] = state.folder || null;
    function ensurePath(dir) {
      if (dir in cache) return Promise.resolve(cache[dir]);
      var parts = dir.split('/'); var name = parts.pop(); var parentDir = parts.join('/');
      return ensurePath(parentDir).then(function (parentUuid) {
        return net().fetchJSON(net().url('/folders'), { method: 'POST', json: { name: name, parent: parentUuid } })
          // insertItem() only actually shows it if its parent is the folder
          // currently open - same rule a full reload would apply.
          .then(function (f) { cache[dir] = f.id; insertItem(f); return f.id; })
          .catch(function () { cache[dir] = parentUuid; return parentUuid; });
      });
    }
    var chain = Promise.resolve();
    list.forEach(function (it) {
      var segs = it.rel.split('/'); segs.pop(); var dir = segs.join('/');
      chain = chain.then(function () {
        return ensurePath(dir).then(function (folderUuid) { window.TMAUpload.add([it.file], { folderId: folderUuid }); });
      });
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
    openLightbox(file);
  }

  /* ── lightbox preview ───────────────────────────────── */

  var lb = null;

  function openLightbox(file) {
    closeLightbox();
    var gallery = items().filter(function (it) { return it.type === 'file'; });
    var idx = gallery.findIndex(function (f) { return f.id === file.id; });
    if (idx < 0) { gallery = [file]; idx = 0; }
    var showInfo = false;

    lb = document.createElement('div');
    lb.className = 'tma-portal-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    document.body.appendChild(lb);
    document.body.style.overflow = 'hidden';

    function paint() {
      var f = gallery[idx] || file;
      var many = gallery.length > 1;
      lb.innerHTML =
        '<div class="tma-portal-lightbox__backdrop" data-lb-close></div>' +
        '<div class="tma-portal-lightbox__head">' +
          '<span class="tma-portal-lightbox__title" title="' + esc(f.name) + '">' +
            '<img src="' + esc(fileIconSrc(f)) + '" alt="" width="18" height="18">' + esc(f.name) + '</span>' +
          '<div class="tma-portal-lightbox__head-actions">' +
            (perm(f, 'download') ? '<button type="button" class="tma-portal-tool" data-lb-download><img src="images/icons/phosphor/ArrowLineDown.svg" alt="" width="16" height="16"><span>Download</span></button>' : '') +
            '<button type="button" class="tma-portal-tool tma-portal-tool--icon' + (showInfo ? ' is-active' : '') + '" data-lb-details aria-label="Details" aria-pressed="' + showInfo + '"><img src="images/icons/phosphor/Info.svg" alt="" width="16" height="16"></button>' +
            '<button type="button" class="tma-portal-tool tma-portal-tool--icon" data-lb-close aria-label="Close"><img src="images/icons/phosphor/X.svg" alt="" width="16" height="16"></button>' +
          '</div>' +
        '</div>' +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--prev" data-lb-prev aria-label="Previous"><img src="images/icons/phosphor/CaretLeft.svg" alt="" width="24" height="24"></button>' : '') +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--next" data-lb-next aria-label="Next"><img src="images/icons/phosphor/CaretRight.svg" alt="" width="24" height="24"></button>' : '') +
        '<div class="tma-portal-lightbox__stage" data-lb-stage>' + lightboxBody(f) + '</div>' +
        (showInfo ? '<div class="tma-portal-lightbox__details">' + lightboxDetails(f) + '</div>' : '') +
        '<div class="tma-portal-lightbox__foot">' + (many ? (idx + 1) + ' of ' + gallery.length + ' &middot; ' : '') + esc(f.sizeLabel || '') + '</div>';

      if (f.previewable && f.category === 'text' && f.previewUrl) loadText(f);
    }

    function loadText(f) {
      var pre = lb.querySelector('[data-lb-text]');
      if (!pre) return;
      fetch(f.previewUrl, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
        .then(function (t) { pre.textContent = t.length > 200000 ? t.slice(0, 200000) + '\n…' : t; })
        .catch(function () { pre.textContent = 'Could not load this file.'; });
    }

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= gallery.length) return;
      idx = next;
      paint();
    }

    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-close]')) { closeLightbox(); return; }
      if (e.target.closest('[data-lb-prev]')) { go(-1); return; }
      if (e.target.closest('[data-lb-next]')) { go(1); return; }
      if (e.target.closest('[data-lb-download]')) { downloadItem(gallery[idx]); return; }
      if (e.target.closest('[data-lb-details]')) { showInfo = !showInfo; paint(); return; }
    });

    lb._key = function (e) {
      // A details modal opened on top of the lightbox owns the keyboard.
      if (document.querySelector('.tma-portal-modal')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', lb._key);

    paint();
  }

  function lightboxBody(f) {
    // SVG has a previewUrl (the hardened thumb) but isn't flagged previewable,
    // so key off previewUrl presence rather than the previewable flag.
    if (f.previewUrl && perm(f, 'preview')) {
      switch (f.category) {
        case 'image':
          return '<img class="tma-portal-lightbox__img" src="' + esc(f.previewUrl) + '" alt="' + esc(f.name) + '">';
        case 'pdf':
          return '<iframe class="tma-portal-lightbox__frame" src="' + esc(f.previewUrl) + '" title="' + esc(f.name) + '"></iframe>';
        case 'video':
          return '<video class="tma-portal-lightbox__media" src="' + esc(f.previewUrl) + '" controls autoplay playsinline></video>';
        case 'audio':
          return '<div class="tma-portal-lightbox__audio"><img src="' + esc(fileIconSrc(f)) + '" alt="" width="64" height="64">' +
            '<audio src="' + esc(f.previewUrl) + '" controls autoplay></audio></div>';
        case 'text':
          return '<pre class="tma-portal-lightbox__text" data-lb-text>Loading…</pre>';
      }
    }
    // Office docs, archives, and anything we can't render safely.
    return '<div class="tma-portal-lightbox__nopreview">' +
      '<img src="' + esc(fileIconSrc(f)) + '" alt="" width="72" height="72">' +
      '<p class="tma-portal-lightbox__nopreview-title">' + esc(f.name) + '</p>' +
      '<p class="tma-portal-lightbox__nopreview-text">No in-browser preview for this file type.</p>' +
      (perm(f, 'download') ? '<button type="button" class="tma-no-data__btn" data-lb-download><img class="tma-no-data__btn-icon" src="images/icons/phosphor/ArrowLineDown.svg" alt="" width="16" height="16"><span>Download</span></button>' : '') +
      '</div>';
  }

  // Details panel shown inside the lightbox (built from the item we already
  // have — no fetch, always renders above the preview).
  function lightboxDetails(f) {
    function row(label, value) {
      return '<div class="tma-portal-details__row"><span class="tma-portal-details__label">' + esc(label) + '</span><span class="tma-portal-details__value">' + esc(value == null || value === '' ? '—' : value) + '</span></div>';
    }
    var shared = f.assignedTo && f.assignedTo.length;
    return '<h4>Details</h4>' +
      row('Name', f.name) +
      row('Type', f.category ? cap(f.category) : 'File') +
      row('Extension', f.extension ? '.' + f.extension : '—') +
      row('MIME type', f.mime) +
      row('Size', f.sizeLabel) +
      row('Location', f.folder ? f.folder.name : 'File Box') +
      row('Uploaded', fmtDate(f.uploadedAt)) +
      row('Modified', fmtDate(f.modifiedAt)) +
      row('Uploaded by', f.uploadedBy ? f.uploadedBy.name : '—') +
      row('Owner', f.owner ? f.owner.name : '—') +
      row('Assigned to', shared ? f.assignedTo.join(', ') : 'No one') +
      row('Sharing', shared ? 'Shared' : 'Private') +
      row('Favourite', f.favorite ? 'Yes' : 'No');
  }

  function closeLightbox() {
    if (!lb) return;
    if (lb._key) document.removeEventListener('keydown', lb._key);
    lb.remove();
    lb = null;
    document.body.style.overflow = '';
  }

  /* ── actions ────────────────────────────────────────── */

  function handleAction(action) {
    switch (action) {
      case 'new-folder': return createUntitledFolder();
      case 'upload': return triggerUpload(false);
      case 'upload-folder': return triggerUpload(true);
      case 'paste': return pasteClipboard();
      case 'refresh': return load();
      case 'sortdir': state.dir = state.dir === 'asc' ? 'desc' : 'asc'; return load();
      case 'empty-bin': return emptyBin();
      case 'clear-selection': return clearSelection();
      case 'bulk-download': return bulkDownload();
      case 'bulk-signature': return sendSelectionForSignature();
      case 'bulk-appearance': return bulkAppearance();
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
          // insertItem() only actually shows it if its parent is the folder
          // currently open - same rule a full reload would apply.
          .then(function (f) { cache[dir] = f.id; insertItem(f); return f.id; })
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
            .then(function (folder) { ui().closeModal(); ui().toast('Folder created'); insertItem(folder); })
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
            .then(function (updated) {
              var list = item.type === 'folder' ? state.data.folders : state.data.files;
              for (var i = 0; i < list.length; i++) { if (list[i].id === item.id) { list[i] = updated; break; } }
              sortList(list);
              ui().closeModal();
              ui().toast('Renamed');
              if (item.type === 'folder') foldersChanged();
              rerender();
            })
            .catch(function (err) { save.disabled = false; showModalError(host, err.message); });
        }
        save.addEventListener('click', submit);
        inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      },
    });
  }

  /*
   * Folder appearance: colour and icon in one place.
   *
   * They were two menu entries opening two modals, which meant setting a
   * folder's look was two trips and you could never see the pair together —
   * yet the icon is tinted from the colour, so they are one decision. One
   * modal, one live preview, one Save.
   *
   * The two values still have their own endpoints, so Save issues whichever
   * of them actually changed rather than always writing both.
   */
  function openAppearanceModal(item) {
    var colours = window.TMAFolderColours;
    var icons = window.TMAFolderIcons;
    if (!colours) return;

    var isDefaultFolder = item.folderType && item.folderType !== 'user';
    var base = item.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';

    var startColour = colours.isValid(item.colour) ? item.colour : 'default';
    var startIcon = (icons && icons.isValid(item.iconName)) ? item.iconName : null;
    var colour = startColour;
    var icon = startIcon;

    var canColour = perm(item, 'colour');
    var canIcon = icons && perm(item, 'icon');

    function previewHtml() {
      return icons
        ? icons.html(base, colour === 'default' ? null : colour, icon, 40)
        : '<img src="' + esc(colours.iconSrc(base, colour)) + '" alt="" width="40" height="40">';
    }

    function swatchHtml(c) {
      var isSel = c.key === colour;
      return '<button type="button" class="tma-portal-colour-swatch' + (isSel ? ' is-selected' : '') + '"' +
        ' data-colour-key="' + esc(c.key) + '" style="background:' + esc(c.hex) + '"' +
        ' aria-label="' + esc(c.label) + '" aria-pressed="' + isSel + '" title="' + esc(c.label) + '"></button>';
    }

    function glyphHtml(name) {
      var url = icons.iconPath(name);
      var shade = colours.shade(colour === 'default' ? null : colour);
      return '<span class="tma-portal-icon-swatch__glyph" style="background-color:' + shade + ';' +
        'mask-image:url(\'' + url + '\');-webkit-mask-image:url(\'' + url + '\')"></span>';
    }

    function categoryHtml(label, names) {
      var buttons = names.map(function (name) {
        var isSel = name === icon;
        return '<button type="button" class="tma-portal-icon-swatch' + (isSel ? ' is-selected' : '') + '"' +
          ' data-icon-name="' + esc(name) + '" aria-pressed="' + isSel + '" title="' + esc(name) + '">' + glyphHtml(name) + '</button>';
      }).join('');
      return '<div class="tma-portal-icon-category" data-icon-category="' + esc(label) + '">' +
        '<div class="tma-portal-icon-category__label">' + esc(label) + '</div>' +
        '<div class="tma-portal-icon-grid">' + buttons + '</div></div>';
    }

    var colourSection = canColour
      ? '<div class="tma-portal-appearance__section">' +
        '<div class="tma-portal-appearance__label">Colour</div>' +
        '<div class="tma-portal-colour-swatches" data-colour-swatches>' +
        colours.PALETTE.map(swatchHtml).join('') +
        '</div></div>'
      : '';

    var iconSection = canIcon
      ? '<div class="tma-portal-appearance__section">' +
        '<div class="tma-portal-appearance__label">Icon</div>' +
        '<div class="tma-portal-icon-search">' + ui().input({ placeholder: 'Search icons…', attrs: 'data-icon-search maxlength="60"' }) + '</div>' +
        '<div class="tma-portal-icon-categories" data-icon-categories>' +
        Object.keys(icons.CATEGORIES).map(function (label) {
          return categoryHtml(label, icons.CATEGORIES[label]);
        }).join('') +
        '</div>' +
        '<p class="tma-portal-icon-empty" data-icon-empty hidden>No icons match your search.</p>' +
        '</div>'
      : '';

    ui().openModal({
      title: 'Folder appearance',
      body: '<div class="tma-portal-colour-head">' +
        '<span data-appearance-preview>' + previewHtml() + '</span>' +
        '<strong>' + esc(item.name) + '</strong>' +
        '</div>' +
        colourSection + iconSection +
        (isDefaultFolder ? '<p class="tma-portal-modal__text">This applies to everyone in the organization.</p>' : '') +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-portal-link" data-appearance-reset>Reset to default</button>' +
        '<span class="tma-portal-modal__foot-spacer"></span>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-appearance-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-appearance-save>Save</button>' +
        '</div>',
      onMount: function (host) {
        var preview = host.querySelector('[data-appearance-preview]');
        var save = host.querySelector('[data-appearance-save]');

        function repaint() {
          preview.innerHTML = previewHtml();

          host.querySelectorAll('[data-colour-key]').forEach(function (btn) {
            var isSel = btn.getAttribute('data-colour-key') === colour;
            btn.classList.toggle('is-selected', isSel);
            btn.setAttribute('aria-pressed', isSel);
          });

          host.querySelectorAll('[data-icon-name]').forEach(function (btn) {
            var isSel = btn.getAttribute('data-icon-name') === icon;
            btn.classList.toggle('is-selected', isSel);
            btn.setAttribute('aria-pressed', isSel);
            // The glyph is tinted from the colour, so it has to be redrawn
            // when the colour changes — this is the whole reason the two
            // belong in one dialog.
            var glyph = btn.querySelector('.tma-portal-icon-swatch__glyph');
            if (glyph) glyph.style.backgroundColor = colours.shade(colour === 'default' ? null : colour);
          });
        }

        host.querySelectorAll('[data-colour-key]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            colour = btn.getAttribute('data-colour-key');
            repaint();
          });
        });

        host.querySelectorAll('[data-icon-name]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var name = btn.getAttribute('data-icon-name');
            // Clicking the chosen icon again clears it.
            icon = icon === name ? null : name;
            repaint();
          });
        });

        var search = host.querySelector('[data-icon-search]');
        if (search) {
          search.addEventListener('input', function () {
            var term = search.value.trim().toLowerCase();
            var emptyEl = host.querySelector('[data-icon-empty]');
            var anyVisible = false;

            host.querySelectorAll('[data-icon-category]').forEach(function (cat) {
              var catVisible = false;
              cat.querySelectorAll('[data-icon-name]').forEach(function (btn) {
                var hit = !term || btn.getAttribute('data-icon-name').toLowerCase().indexOf(term) !== -1;
                btn.hidden = !hit;
                if (hit) catVisible = true;
              });
              cat.hidden = !catVisible;
              if (catVisible) anyVisible = true;
            });

            if (emptyEl) emptyEl.hidden = anyVisible;
          });
        }

        host.querySelector('[data-appearance-reset]').addEventListener('click', function () {
          colour = 'default';
          icon = null;
          repaint();
        });

        host.querySelector('[data-appearance-cancel]').addEventListener('click', ui().closeModal);

        save.addEventListener('click', function () {
          save.disabled = true;
          setBusy(item.id, true);

          // Only what actually changed. Chained rather than parallel so the
          // second write sees the first — the response carries the merged row.
          var work = Promise.resolve(null);

          if (canColour && colour !== startColour) {
            work = work.then(function () {
              return net().fetchJSON(net().url('/folders/' + item.id + '/colour'), {
                method: 'PATCH', json: { colour: colour === 'default' ? null : colour },
              });
            });
          }

          if (canIcon && icon !== startIcon) {
            work = work.then(function (res) {
              return net().fetchJSON(net().url('/folders/' + item.id + '/icon'), {
                method: 'PATCH', json: { icon: icon },
              }).then(function (iconRes) { return iconRes || res; });
            });
          }

          work.then(function (res) {
            setBusy(item.id, false);
            if (res) updateItem(item.id, res);
            ui().closeModal();
            ui().toast('Folder appearance updated');
            foldersChanged();
            rerender();
          }).catch(function (err) {
            setBusy(item.id, false);
            save.disabled = false;
            showModalError(host, err.message);
            rerender();
          });
        });
      },
    });
  }

  function openShareModal(item) { openShareUi(item, 'link'); }
  function openAssignModal(item) { openShareUi(item, 'assign'); }

  function openShareUi(item, mode) {
    var need = mode === 'assign' ? 'assign' : 'share';
    if (!perm(item, need)) { ui().toast('You can’t ' + (mode === 'assign' ? 'assign' : 'share') + ' this item'); return; }
    ui().openModal({
      title: (mode === 'assign' ? 'Assign “' : 'Share “') + item.name + '”',
      body: '<div class="tma-portal-share" data-share-body>' + ui().loading({ count: 3 }) + '</div>',
      onMount: function (host) { loadShareAccess(host, item, mode); },
    });
  }

  function loadShareAccess(host, item, mode) {
    net().fetchJSON(net().url('/shares?type=' + item.type + '&id=' + encodeURIComponent(item.id)))
      .then(function (data) { renderShare(host, item, data, mode); })
      .catch(function (err) {
        var b = host.querySelector('[data-share-body]');
        if (b) b.innerHTML = '<p class="tma-portal-modal__text">' + esc(err.message || 'Could not load sharing.') + '</p>';
      });
  }

  function renderShare(host, item, data, mode) {
    var body = host.querySelector('[data-share-body]');
    if (!body) return;
    var roles = data.roles || ['viewer', 'downloader', 'editor', 'full'];

    var people = '<div class="tma-portal-share__row tma-portal-share__person">' +
      personAvatar(data.owner) +
      '<div class="tma-portal-share__who"><strong>' + esc(data.owner ? data.owner.name : 'Owner') + '</strong>' +
      '<span class="tma-portal-share__email">' + esc(data.owner ? data.owner.email : '') + '</span></div>' +
      '<span class="tma-portal-share__owner-tag">Owner</span></div>';

    (data.people || []).forEach(function (p) {
      people += '<div class="tma-portal-share__row tma-portal-share__person" data-share-id="' + esc(p.id) + '">' +
        personAvatar(p.person) +
        '<div class="tma-portal-share__who"><strong>' + esc((p.person && p.person.name) || (p.person && p.person.email) || 'Someone') + '</strong>' +
        '<span class="tma-portal-share__email">' + esc((p.person && p.person.email) || '') + (p.kind === 'email' ? ' · invited by email' : '') + '</span></div>' +
        roleSelect(roles, p.role, ' data-share-role') +
        '<button type="button" class="tma-portal-row-menu" data-share-remove aria-label="Remove access"><img src="images/icons/phosphor/X.svg" alt="" width="14" height="14"></button>' +
        '</div>';
    });

    var link = data.link;
    var linkSection;
    if (link) {
      linkSection =
        '<div class="tma-portal-share__link-row">' +
          '<input type="text" class="tma-portal-share__link" data-share-link readonly value="' + esc(link.link) + '">' +
          '<button type="button" class="tma-no-data__btn" data-share-copy>Copy</button>' +
        '</div>' +
        '<div class="tma-portal-share__opts">' +
          roleSelect(['viewer', 'downloader'], link.role, ' data-link-role') +
          '<label class="tma-portal-share__opt"><input type="checkbox" data-link-download' + (link.allowDownload ? ' checked' : '') + '> Allow download</label>' +
          '<label class="tma-portal-share__opt">Expires <input type="date" data-link-expiry value="' + (link.expiresAt ? link.expiresAt.slice(0, 10) : '') + '"></label>' +
          '<label class="tma-portal-share__opt">Password <input type="text" data-link-password placeholder="' + (link.hasPassword ? '•••••• (set)' : 'none') + '"></label>' +
        '</div>' +
        '<div class="tma-portal-share__link-actions">' +
          '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-link-save>Save link settings</button>' +
          '<button type="button" class="tma-portal-share__disable" data-link-disable>Disable link</button>' +
        '</div>';
    } else {
      linkSection = '<button type="button" class="tma-no-data__btn" data-link-create><img class="tma-no-data__btn-icon" src="images/icons/phosphor/LinkSimple.svg" alt="" width="16" height="16"><span>Create shareable link</span></button>';
    }

    if (mode === 'assign') {
      body.innerHTML =
        '<div class="tma-portal-share__invite">' +
          '<input type="email" class="tma-portal-input" data-share-email placeholder="Add people by email">' +
          roleSelect(roles, 'viewer', ' data-invite-role') +
          '<button type="button" class="tma-no-data__btn" data-share-add>Assign</button>' +
        '</div>' +
        '<div class="tma-portal-share__people">' + people + '</div>';
    } else {
      body.innerHTML = '<div class="tma-portal-share__link-section">' + linkSection + '</div>';
    }

    wireShare(host, item, data, mode);
  }

  function wireShare(host, item, data, mode) {
    // Keep the underlying row's "Shared" indicator in sync the moment a
    // share/assignment/role changes - the modal never reloads the library,
    // but the row behind it was going stale until the next full reload.
    function reload(resp) {
      renderShare(host, item, resp, mode);
      var assignedTo = (resp.people || [])
        .filter(function (p) { return p.kind === 'user'; })
        .map(function (p) { return p.person && p.person.name; })
        .filter(Boolean);
      updateItem(item.id, { assignedTo: assignedTo, shared: assignedTo.length > 0 });
      rerender();
    }
    function post(json) { return net().fetchJSON(net().url('/shares'), { method: 'POST', json: json }); }
    var type = item.type, id = item.id;

    var addBtn = host.querySelector('[data-share-add]');
    if (addBtn) addBtn.addEventListener('click', function () {
      var email = (host.querySelector('[data-share-email]').value || '').trim();
      var role = host.querySelector('[data-invite-role]').value;
      if (!email) return;
      addBtn.disabled = true;
      post({ type: type, id: id, mode: 'invite', email: email, role: role })
        .then(reload).catch(function (e) { addBtn.disabled = false; ui().toast(e.message || 'Could not add'); });
    });

    host.querySelectorAll('[data-share-id]').forEach(function (rowEl) {
      var sid = rowEl.getAttribute('data-share-id');
      var roleSel = rowEl.querySelector('[data-share-role]');
      if (roleSel) roleSel.addEventListener('change', function () {
        net().fetchJSON(net().url('/shares/' + sid), { method: 'PATCH', json: { role: roleSel.value } }).then(reload).catch(function (e) { ui().toast(e.message); });
      });
      var rm = rowEl.querySelector('[data-share-remove]');
      if (rm) rm.addEventListener('click', function () {
        net().fetchJSON(net().url('/shares/' + sid), { method: 'DELETE' }).then(reload).catch(function (e) { ui().toast(e.message); });
      });
    });

    var create = host.querySelector('[data-link-create]');
    if (create) create.addEventListener('click', function () {
      create.disabled = true;
      post({ type: type, id: id, mode: 'link', role: 'viewer', allowDownload: true }).then(reload).catch(function (e) { create.disabled = false; ui().toast(e.message); });
    });

    var copy = host.querySelector('[data-share-copy]');
    if (copy) copy.addEventListener('click', function () {
      var input = host.querySelector('[data-share-link]');
      copyText(input.value); ui().toast('Link copied');
    });

    var save = host.querySelector('[data-link-save]');
    if (save) save.addEventListener('click', function () {
      save.disabled = true;
      var json = {
        type: type, id: id, mode: 'link',
        role: host.querySelector('[data-link-role]').value,
        allowDownload: host.querySelector('[data-link-download]').checked,
        expiresAt: host.querySelector('[data-link-expiry]').value || null,
      };
      var pw = host.querySelector('[data-link-password]').value;
      if (pw) json.password = pw;
      post(json).then(function (r) { reload(r); ui().toast('Link updated'); }).catch(function (e) { save.disabled = false; ui().toast(e.message); });
    });

    var disable = host.querySelector('[data-link-disable]');
    if (disable && data.link) disable.addEventListener('click', function () {
      net().fetchJSON(net().url('/shares/' + data.link.id), { method: 'DELETE' }).then(reload).catch(function (e) { ui().toast(e.message); });
    });
  }

  // Quick "Copy link": ensure a link exists, then copy it.
  function copyShareLink(item) {
    if (!perm(item, 'share')) { ui().toast('You can’t share this item'); return; }
    net().fetchJSON(net().url('/shares'), { method: 'POST', json: { type: item.type, id: item.id, mode: 'link', role: 'viewer', allowDownload: true } })
      .then(function (data) {
        if (data.link && data.link.link) { copyText(data.link.link); ui().toast('Link copied to clipboard'); }
      })
      .catch(function (err) { ui().toast(err.message || 'Could not create link'); });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(function () {}); return; }
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
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

  /* Only offer signing for files the pipeline accepts, that aren't in the
     recycle bin, and that the viewer may actually read. */
  function canSendForSignature(item) {
    if (isRecycle() || !window.TMAPortalSignatures) return false;
    if (!window.TMAPortalSignatures.isSignableName(item.name)) return false;
    return perm(item, 'download') || perm(item, 'preview');
  }

  function sendForSignature(item) {
    window.TMAPortalSignatures.sendFileForSignature(item.id)
      .catch(function () { /* toast already shown */ });
  }

  function sendSelectionForSignature() {
    var sel = selectedItems();
    if (sel.length !== 1 || !canSendForSignature(sel[0])) return;
    sendForSignature(sel[0]);
  }

  function bulkAppearance() {
    var sel = selectedItems();
    if (sel.length !== 1 || sel[0].type !== 'folder') return;
    if (!perm(sel[0], 'colour') && !perm(sel[0], 'icon')) return;
    openAppearanceModal(sel[0]);
  }

  function contextItems(item) {
    var list = [];
    var isFolder = item.type === 'folder';
    if (isRecycle()) {
      list.push({ label: 'Restore', icon: 'ArrowCounterClockwise', fn: function () { restoreItem(item); } });
      list.push({ label: 'Delete permanently', icon: 'Trash', danger: true, fn: function () { forceDeleteItem(item); } });
      list.push({ sep: true });
      list.push({ label: 'View details', icon: 'Info', fn: function () { openDetails(item); } });
      return list;
    }
    list.push({ label: isFolder ? 'Open' : 'Preview', icon: isFolder ? 'FolderOpen' : 'Eye', fn: function () { openItem(item.id); } });
    if (perm(item, 'download')) list.push({ label: isFolder ? 'Download as ZIP' : 'Download', icon: 'ArrowLineDown', fn: function () { downloadItem(item); } });
    if (!isFolder && canSendForSignature(item)) {
      list.push({ label: 'Send for signature', icon: 'Signature', fn: function () { sendForSignature(item); } });
    }
    list.push({ sep: true });
    if (perm(item, 'share')) list.push({ label: 'Share', icon: 'ShareNetwork', fn: function () { openShareModal(item); } });
    if (perm(item, 'assign')) list.push({ label: 'Assign to people', icon: 'UserPlus', fn: function () { openAssignModal(item); } });
    if (perm(item, 'share')) list.push({ label: 'Copy link', icon: 'LinkSimple', fn: function () { copyShareLink(item); } });
    list.push({ sep: true });
    if (perm(item, 'move')) list.push({ label: 'Cut', icon: 'Scissors', fn: function () { cutItem(item); } });
    if (perm(item, 'copy')) list.push({ label: 'Copy', icon: 'Copy', fn: function () { copyItem(item); } });
    if (perm(item, 'move')) list.push({ label: 'Move to…', icon: 'ArrowsOutCardinal', fn: function () { bulkRun('move', [item], null, load, true); } });
    if (perm(item, 'rename')) list.push({ label: 'Rename', icon: 'PencilSimple', fn: function () { startRename(item.id); } });
    // Colour and icon are one decision (the icon is tinted from the colour),
    // so they are one entry opening one dialog.
    if (isFolder && (perm(item, 'colour') || perm(item, 'icon'))) {
      list.push({ label: 'Folder appearance', icon: 'Palette', fn: function () { openAppearanceModal(item); } });
    }
    list.push({ label: item.favorite ? 'Remove from favourites' : 'Add to favourites', icon: 'Star', fn: function () { toggleStar(item.id); } });
    if (isFolder && window.TMASidebarShortcuts) {
      var pinned = window.TMASidebarShortcuts.isPinned(item.id);
      list.push({
        label: pinned ? 'Remove from Folder Shortcuts' : 'Add to Folder Shortcuts',
        icon: pinned ? 'PushPinSlash' : 'PushPin',
        fn: function () {
          var s = window.TMASidebarShortcuts;
          (pinned ? s.remove(item.id) : s.add(item.id)).catch(function () {});
        },
      });
    }
    // Admins can promote a top-level folder to a shared organization default,
    // which then appears in every staff member's Folder Shortcuts automatically.
    if (isFolder && !item.parent && isAdminUser()) {
      list.push({ label: 'Make default folder', icon: 'Buildings', fn: function () { makeDefaultFolder(item); } });
    }
    list.push({ sep: true });
    list.push({ label: 'View details', icon: 'Info', fn: function () { openDetails(item); } });
    if (perm(item, 'delete')) list.push({ label: 'Delete', icon: 'Trash', danger: true, fn: function () { deleteItem(item); } });
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
      var iconHtml = it.icon ? '<img class="tma-portal-context-menu__icon" src="images/icons/phosphor/' + it.icon + '.svg" alt="" width="16" height="16">' : '<span class="tma-portal-context-menu__icon"></span>';
      return '<button type="button" class="tma-portal-context-menu__item' + (it.danger ? ' tma-portal-context-menu__item--danger' : '') + '" role="menuitem" data-ctx="' + i + '"' + (it.disabled ? ' disabled' : '') + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' + iconHtml + '<span>' + esc(it.label) + '</span></button>';
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
    bulkRun(action, bulkPayload(), null, clearSelection);
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
    bulkRun(mode, bulkPayload(), null, clearSelection, true);
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
    payload = payload.filter(function (p) { return !isBusy(p.id); });
    if (!payload.length) return;
    payload.forEach(function (p) { setBusy(p.id, true); });
    rerender();
    net().fetchJSON(net().url('/bulk'), { method: 'POST', json: { action: action, items: payload, target: target } })
      .then(function (res) {
        payload.forEach(function (p) { setBusy(p.id, false); });
        if (res.errors && res.errors.length) ui().toast(res.errors[0].message);
        else ui().toast('Done');
        reconcileBulk(action, payload, res.results, res.errors);
        if (payload.some(function (p) { return p.type === 'folder'; })) foldersChanged();
        if (onDone) onDone();
        rerender();
      })
      .catch(function (err) {
        payload.forEach(function (p) { setBusy(p.id, false); });
        ui().toast(err.message || 'Action failed');
        rerender();
      });
  }

  // Apply a /bulk response locally - never a listing refetch. Skips any ref
  // that came back in `errors` (it's still exactly as it was).
  function reconcileBulk(action, payload, results, errors) {
    var failedIds = {};
    (errors || []).forEach(function (e) { failedIds[e.id] = true; });
    var byId = {};
    (results || []).forEach(function (r) { byId[r.id] = r.item; });

    payload.forEach(function (ref) {
      if (failedIds[ref.id]) return;
      switch (action) {
        case 'delete': case 'forceDelete': case 'restore':
          removeItem(ref.id);
          break;
        case 'favorite':
          updateItem(ref.id, { favorite: true });
          break;
        case 'unfavorite':
          if (state.section === 'favorites') removeItem(ref.id);
          else updateItem(ref.id, { favorite: false });
          break;
        case 'move':
          // Same id, possibly a new parent/name - drop the stale entry, then
          // reinsert only if it now belongs in the view that's open (e.g. a
          // paste into the current folder); insertItem() no-ops otherwise.
          removeItem(ref.id);
          if (byId[ref.id]) insertItem(byId[ref.id]);
          break;
        case 'copy':
          // A new id - only shows up if the destination is the open folder.
          if (byId[ref.id]) insertItem(byId[ref.id]);
          break;
      }
    });
  }

  /* ── destination picker (mini folder browser) ───────── */

  function openDestinationPicker(title, onPick) {
    var pick = { folder: null, name: (SECTIONS[state.section] || SECTIONS.all).title, crumb: [] };

    ui().openModal({
      title: title,
      body: '<div class="tma-portal-picker" data-picker>' + ui().loading({ count: 4 }) + '</div>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-picker-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-picker-ok>' + esc(title.split(' ')[0]) + ' here</button></div>',
      onMount: function (host) {
        var body = host.querySelector('[data-picker]');
        host.querySelector('[data-picker-cancel]').addEventListener('click', ui().closeModal);
        host.querySelector('[data-picker-ok]').addEventListener('click', function () { ui().closeModal(); onPick(pick.folder); });

        function loadPicker() {
          body.innerHTML = ui().loading({ count: 4 });
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
                    folderIconHtml(f, 20) + '<span>' + esc(f.name) + '</span></button>';
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
    // A sidebar folder shortcut lands straight inside its folder.
    state.folder = opts.folderId || null;
    state.selected = {};
    state.error = null;
    render();
    load();
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('folders', mount);
  }
})();
