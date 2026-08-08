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
        if (window.TMAPortalHomeLibrary && window.TMAPortalHomeLibrary.refresh) {
          window.TMAPortalHomeLibrary.refresh();
        }
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

  /*
   * Rows belonging to some OTHER list that is driving these actions.
   *
   * The dashboard's Recent Files and Shared-with-me tables open this view's row
   * menu. Most actions take the item they were handed, but several re-look it
   * up by id — toggleStar is one — and that lookup only ever searched this
   * view's own data. Driven from the dashboard it found nothing and returned
   * silently: the menu opened, every item was clickable, and choosing one did
   * absolutely nothing.
   *
   * This view's own data is still checked first, so nothing here can be
   * shadowed by a caller's stale copy of the same row.
   */
  var externalItems = [];
  var externalOnChange = null;

  function findItem(id) {
    return items().filter(function (i) { return i.id === id; })[0]
      || externalItems.filter(function (i) { return i.id === id; })[0];
  }

  /**
   * Tell an external list its rows may have changed.
   *
   * Only when this view is not the one on screen — otherwise every ordinary
   * re-render inside the File Library would also poke the dashboard.
   */
  function notifyExternal() {
    if (!externalOnChange) return;
    if (state.el && document.body.contains(state.el)) return;
    externalOnChange();
  }
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
    // Status is cheap and answers "where are my files?" before anyone asks.
    if (!silent) loadSyncStatus();
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

    // Returned so a live refresh can wait for it and avoid stacking refetches
    // on top of each other when several changes land at once.
    return net().fetchJSON(net().url('/?' + params.toString()))
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
        // A silent refresh is nobody's request. Replacing a working list with
        // an error because a background poll lost the network is a worse
        // outcome than showing slightly stale rows until the next one lands.
        if (silent) return;
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
    notifyExternal();
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
    html += '<div data-sync-host>' + syncStatusHtml() + '</div>';
    html += renderToolbar();

    html += '<div class="tma-portal-files__body" data-files-body>';
    if (state.loading) html += renderLoading();
    else if (state.error) html += ui().banner('warning', esc(state.error));
    else if (!items().length) html += renderEmpty(meta);
    else html += (state.view === 'grid' ? renderGrid() : renderTable());
    html += '</div></div>';

    /*
     * Reconciled, not replaced. Rebuilding this subtree threw away every file
     * thumbnail and folder icon on each render — including renames, colour
     * changes and selection toggles, none of which touch the images at all.
     * Rows and cards key on their data-id, so an unchanged file is left alone.
     */
    if (window.TMAMorph) window.TMAMorph.patch(state.el, html);
    else state.el.innerHTML = html;
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

    // Bound once per element rather than once per render: these buttons now
    // survive reconciliation, so re-binding would stack handlers. The
    // delegated listeners further down are safe as they are — they pass named
    // functions, and addEventListener ignores an identical re-registration.
    var viewBtns = window.TMAMorph
      ? window.TMAMorph.unwired(el, '[data-files-view]')
      : Array.prototype.slice.call(el.querySelectorAll('[data-files-view]'));
    viewBtns.forEach(function (b) {
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
    if (e.target.closest('[data-sync-dismiss]')) { e.preventDefault(); dismissSyncNotice(); return; }
    if (e.target.closest('[data-sync-retry]')) { retrySync(); return; }
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

  /* ── library sync status ─────────────────────────────
   *
   * The mailbox shows whether it is syncing; the File Library did not, so an
   * import in progress was indistinguishable from missing files. This renders
   * a small strip above the list and polls only while something is happening.
   */

  var syncState = null;
  var syncTimer = null;

  function loadSyncStatus() {
    net().fetchJSON(net().url('/sync-status'))
      .then(function (data) {
        var wasBusy = syncState && syncState.syncing;
        syncState = data;
        paintSyncStatus();

        // Poll while syncing, then stop. A finished import refreshes the list
        // once so the newly imported files appear without a manual reload.
        if (data.syncing) {
          if (!syncTimer) syncTimer = setInterval(loadSyncStatus, 5000);
        } else {
          if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
          if (wasBusy) load(true);
        }
      })
      .catch(function () { /* never worth an error toast */ });
  }

  function syncStatusHtml() {
    var d = syncState;
    if (!d || !d.connections || !d.connections.length) return '';

    var busy = d.connections.filter(function (c) { return c.status === 'syncing'; });
    var failed = d.connections.filter(function (c) { return c.status === 'error' || c.failedItems > 0; });

    if (busy.length) {
      var c = busy[0];
      return '<div class="tma-portal-sync tma-portal-sync--busy" data-sync-strip>' +
        '<span class="tma-portal-sync__spinner"></span>' +
        '<span>' + esc(c.initialImport ? 'Importing ' + c.name + '…' : 'Syncing ' + c.name + '…') +
        (c.items ? ' <b>' + c.items + '</b> items so far' : '') + '</span>' +
      '</div>';
    }

    if (failed.length) {
      var f = failed[0];
      return '<div class="tma-portal-sync tma-portal-sync--error" data-sync-strip>' +
        '<img src="images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16">' +
        '<span>' + esc(f.name) + ' — ' +
          esc(f.lastError ? 'sync failed' : f.failedItems + ' item(s) could not sync') + '</span>' +
        (isAdminUser() ? '<button type="button" class="tma-portal-sync__btn" data-sync-retry>Retry</button>' : '') +
      '</div>';
    }

    // Quiet, and only worth a line when there is something connected.
    var newest = d.connections.filter(function (c) { return c.lastSuccessAt; })
      .sort(function (a, b) { return new Date(b.lastSuccessAt) - new Date(a.lastSuccessAt); })[0];
    if (!newest) return '';

    /*
     * Dismissed for good.
     *
     * "Citizenship Applications synced 1d ago" is not news — after the first
     * read it is just a line that never goes away. Closing it hides it
     * permanently, on the account rather than in this browser.
     *
     * Only this quiet line is dismissible. A sync in progress and a sync
     * error are handled above and always show: hiding a failure because
     * somebody once closed a success message would be a different thing
     * entirely. A conflict keeps it visible too, since that needs a decision.
     */
    if (syncNoticeDismissed() && !d.conflicts) return '';

    return '<div class="tma-portal-sync" data-sync-strip>' +
      '<img src="images/icons/phosphor/CloudCheck.svg" alt="" width="16" height="16">' +
      '<span>' + esc(newest.name) + ' synced ' + esc(relativeTime(newest.lastSuccessAt)) + '</span>' +
      (d.conflicts ? '<span class="tma-portal-sync__flag">' + d.conflicts + ' conflict(s)</span>' : '') +
      '<button type="button" class="tma-portal-sync__close" data-sync-dismiss' +
        ' aria-label="Hide sync status">' +
        '<span class="tma-portal-sync__close-glyph" aria-hidden="true"></span></button>' +
    '</div>';
  }

  var SYNC_NOTICE_KEY = 'tma.files.syncNoticeDismissed';

  /*
   * Booleans ride in localStorage as '1'/'0', not 'true'/'false'.
   *
   * That is the codec settings.js uses for every other boolean preference, in
   * both directions — hydration writes '1' back from the account. Writing
   * 'true' here made the sync to the server send `false` (the codec reads
   * anything that is not '1' as off), so it hid locally and un-hid itself on
   * the next device.
   */
  function syncNoticeDismissed() {
    try { return localStorage.getItem(SYNC_NOTICE_KEY) === '1'; } catch (e) { return false; }
  }

  function dismissSyncNotice() {
    var prev = syncNoticeDismissed() ? '1' : '0';
    try { localStorage.setItem(SYNC_NOTICE_KEY, '1'); } catch (e) {}
    // Write through to the account so it stays closed on every other browser.
    if (window.TMAPrefs && window.TMAPrefs.push) {
      try { window.TMAPrefs.push(SYNC_NOTICE_KEY, '1', prev); } catch (e) {}
    }
    paintSyncStatus();
  }

  function paintSyncStatus() {
    if (!state.el) return;
    var host = state.el.querySelector('[data-sync-host]');
    if (host) host.innerHTML = syncStatusHtml();
  }

  function relativeTime(iso) {
    var secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.round(secs / 60) + ' min ago';
    if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
    return Math.round(secs / 86400) + 'd ago';
  }

  function retrySync() {
    net().fetchJSON(net().url('/sync-status/retry'), { method: 'POST', json: {} })
      .then(function () { ui().toast('Sync queued'); loadSyncStatus(); })
      .catch(function (err) { ui().toast((err && err.message) || 'Could not start a sync'); });
  }

  /* ── navigation ─────────────────────────────────────── */

  /* ── deep links ─────────────────────────────────────────
   *
   * Where you are is in the URL: which folder you opened, and which file you
   * have in the viewer. Reloading used to drop you back at All Files, which
   * on a hard refresh mid-read meant finding your way back through the tree.
   *
   * Query parameters rather than path segments, so no route has to exist for
   * every folder: the section paths in SPA_PAGES keep serving the shell
   * exactly as they do, and anything after the `?` never reaches the router.
   */
  function currentUrl(params) {
    var qs = params.toString();

    return window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
  }

  /**
   * Write the open folder and file into the address bar.
   *
   * @param {boolean} [replace] Replace the entry instead of adding one. Used
   *   when restoring on mount, where pushing would put a duplicate of the page
   *   you just arrived at into the history and make Back a no-op.
   */
  /*
   * Set while the view is being rebuilt *from* the URL rather than changing
   * it. Reopening the viewer during a restore goes through openLightbox, which
   * writes the URL — so without this, arriving on a link would push a copy of
   * the entry just landed on, and pressing Back after popstate would push a
   * forward entry and trap the reader in the viewer.
   */
  var restoringFromUrl = false;

  function syncUrl(replace) {
    if (restoringFromUrl) return;
    if (!window.history || !window.history.pushState) return;

    var params = new URLSearchParams(window.location.search);

    if (state.folder) params.set('folder', state.folder);
    else params.delete('folder');

    if (state.openFile) params.set('file', state.openFile);
    else params.delete('file');

    var url = currentUrl(params);
    if (url === window.location.pathname + window.location.search + window.location.hash) return;

    try {
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    } catch (e) {
      // A blocked pushState is not a reason to fail the navigation itself.
    }
  }

  function urlParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function openFolder(uuid) {
    state.folder = uuid;
    state.selected = {};
    syncUrl();

    return load();
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

  /* ── collaboration viewer ───────────────────────────────
   *
   * Three regions, per the SharePoint reference: a thumbnail rail for moving
   * between the files in the current view, the preview stage, and a details
   * panel carrying metadata, activity and access.
   *
   * The shell is painted ONCE per open. Only the region that actually changed
   * repaints — rebuilding the whole subtree would reset the preview's scroll
   * and zoom, drop the panel's scroll position, and re-collapse whatever the
   * reader had expanded, which §29 of the spec forbids.
   *
   * Panels fetch on first view, not on open: a firm-wide access roll-up or a
   * long history must never delay the preview.
   */

  var lb = null;

  /* The websocket details come from /me, the same place notifications and
   * messaging read them. Fetched once per page and remembered — including a
   * negative answer, so a portal with no socket configured does not re-ask on
   * every file that is opened. */
  var rtConfig = null;
  var rtPending = null;

  function realtimeConfig(cb) {
    if (rtConfig !== null) { cb(rtConfig); return; }
    if (rtPending) { rtPending.push(cb); return; }
    rtPending = [cb];

    fetch((window.__TMA_SITE_ROOT || '') + '/me', {
      headers: { Accept: 'application/json' }, credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) { settleRealtime((me && me.realtime) || false); })
      .catch(function () { settleRealtime(false); });
  }

  function settleRealtime(cfg) {
    rtConfig = cfg;
    var waiting = rtPending || [];
    rtPending = null;
    waiting.forEach(function (fn) { fn(cfg); });
  }

  // Panel choice, activity filter and panel visibility outlive a single file:
  // stepping through a folder keeps the reader where they were.
  var viewerPrefs = { panel: true, tab: 'details', filter: 'all' };

  /*
   * `count` names the key in the details payload's `counts` block that this
   * tab should show. Tabs without one are never numbered: Activity is a log
   * that only grows, so a number on it measures the file's age rather than
   * anything to attend to, and Access counts people rather than work.
   */
  var VIEWER_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'comments', label: 'Comments', count: 'comments' },
    { id: 'versions', label: 'Versions', count: 'versions' },
    { id: 'approvals', label: 'Approvals', count: 'approvals' },
    { id: 'activity', label: 'Activity' },
    { id: 'access', label: 'Access' },
  ];

  function openLightbox(file) {
    // Quietly: the close is an implementation detail of reopening, and letting
    // it write the URL would push a fileless entry between the two files and
    // make Back land on the folder instead of the previous file.
    closeLightbox(true);

    var gallery = items().filter(function (it) { return it.type === 'file'; });
    var idx = gallery.findIndex(function (f) { return f.id === file.id; });
    if (idx < 0) { gallery = [file]; idx = 0; }

    state.openFile = file.id;
    syncUrl();

    // Per-file caches, so flipping back to a file doesn't re-fetch it.
    var cache = {};

    lb = document.createElement('div');
    lb.className = 'tma-portal-viewer';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'File viewer');

    /*
     * Carry the shell's theme across.
     *
     * Every dark rule in the portal is written as `.tma-dash[data-theme=…]`,
     * and the viewer is appended to <body> so that it can sit above the whole
     * shell — which also puts it outside .tma-dash, where none of those rules
     * can reach it. That is why this panel stayed white in dark mode.
     *
     * Copied once at open: the theme toggle lives in the shell header, which
     * the viewer covers, so it cannot change while this is on screen.
     */
    var dash = document.querySelector('.tma-dash');
    var theme = dash && dash.getAttribute('data-theme');
    if (theme) lb.setAttribute('data-theme', theme);

    document.body.appendChild(lb);
    document.body.style.overflow = 'hidden';

    function current() { return gallery[idx] || file; }
    function entry(f) {
      if (!cache[f.id]) cache[f.id] = { details: null, activity: null, access: null, comments: null, versions: null, approvals: null,
        expanded: {}, draft: '', pendingMentions: [], editing: null, replyingTo: null };
      return cache[f.id];
    }

    /* ── the shell, painted once ─────────────────────── */

    function paintShell() {
      var f = current();
      lb.innerHTML =
        '<div class="tma-portal-viewer__backdrop" data-lb-close></div>' +
        '<div class="tma-portal-viewer__frame">' +
          viewerHead(f) +
          '<div class="tma-portal-viewer__body">' +
            (gallery.length > 1 ? '<div class="tma-portal-viewer__rail" data-lb-rail>' + railHtml() + '</div>' : '') +
            '<div class="tma-portal-viewer__main">' +
              '<div class="tma-portal-viewer__stage" data-lb-stage>' + lightboxBody(f) + '</div>' +
              '<div class="tma-portal-viewer__foot" data-lb-foot>' + footHtml(f) + '</div>' +
            '</div>' +
            '<aside class="tma-portal-viewer__panel" data-lb-panel' + (viewerPrefs.panel ? '' : ' hidden') + '>' +
              panelChromeHtml() +
              '<div class="tma-portal-viewer__panel-body" data-lb-panel-body></div>' +
            '</aside>' +
          '</div>' +
        '</div>';

      paintPanel();
      subscribeToFile(f);
      startPresence(f);
      // Same reasoning as the approval badge below: the tab counts say what is
      // worth opening, so they cannot wait for the reader to open something.
      loadTabCounts(f);
      // Fetch the badge up front: §20 puts the approval status in the centre
      // header, which must not wait for the reader to open a tab.
      if (!entry(f).approvals) loadApprovals(f);
      if (f.previewable && f.category === 'text' && f.previewUrl) loadText(f);
    }

    /* ── active viewers (presence) ───────────────────── */

    /* One id per TAB, not per person: the same file open twice must count as
     * two sessions, or closing one wrongly announces that they left. */
    var sessionId = 'vw-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var presenceTimer = null;

    /* Announce departure immediately rather than letting the heartbeat lapse:
     * 45 seconds of a ghost avatar reads as the feature being broken. */
    lb._leave = function () {
      stopPresence();
      var f = current();
      if (!f) return;
      var url = net().url('/files/' + encodeURIComponent(f.id) + '/presence');
      var body = JSON.stringify({ session: sessionId });
      // sendBeacon survives the page going away; fetch does not.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url + '?_method=DELETE&session=' + encodeURIComponent(sessionId));
      }
      net().fetchJSON(url, { method: 'DELETE', json: { session: sessionId } }).catch(function () {});
    };

    window.addEventListener('beforeunload', function () { if (lb && lb._leave) lb._leave(); });

    function startPresence(f) {
      stopPresence();
      beat(f);
      // Comfortably inside the 45s staleness window, so a missed beat does not
      // make someone flicker out of everyone else's stack.
      presenceTimer = setInterval(function () { if (lb) beat(current()); }, 20000);
    }

    function stopPresence() {
      if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    }

    function currentAction() {
      // What the reader is actually doing, not merely which tab is selected.
      var box = lb && lb.querySelector('[data-lb-input]');
      if (box && box.value.trim()) return 'commenting';
      return 'viewing';
    }

    function beat(f) {
      if (!f) return;
      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/presence'), {
        method: 'POST', json: { session: sessionId, action: currentAction() },
      })
        .then(function (data) { paintPresence(f, data); })
        .catch(function () { /* presence is never worth an error toast */ });
    }

    function loadPresence(f) {
      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/presence'))
        .then(function (data) { paintPresence(f, data); })
        .catch(function () {});
    }

    function paintPresence(f, data) {
      if (!lb || current().id !== f.id) return;
      f.presence = data;
      var host = lb.querySelector('[data-lb-presence]');
      if (host) host.innerHTML = presenceHtml(data);
    }

    function presenceHtml(data) {
      var people = (data && data.viewers) || [];
      if (!people.length) return '';

      var faces = people.map(function (p) {
        return '<img class="tma-portal-viewer__avatar tma-portal-viewer__avatar--stack" ' +
          'src="' + esc(avatarFor(p)) + '" alt="" width="26" height="26" ' +
          'title="' + esc([p.name, p.email, p.role, p.label].filter(Boolean).join(' · ')) + '">';
      }).join('');

      var extra = data.extra > 0
        ? '<span class="tma-portal-viewer__avatar-more">+' + data.extra + '</span>'
        : '';

      return '<button type="button" class="tma-portal-viewer__presence" data-lb-presence-open ' +
        'aria-label="' + data.total + ' people have this open">' + faces + extra + '</button>';
    }

    function openPresenceList() {
      var data = current().presence;
      var people = (data && data.all) || [];
      if (!people.length) { ui().toast('Nobody else has this open'); return; }

      var host = ui().openModal({
        title: 'Active viewers',
        body: '<div class="tma-portal-viewer__source-members">' +
          people.map(function (p) {
            return '<div class="tma-portal-viewer__member">' +
              '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(p)) + '" alt="" width="28" height="28">' +
              '<span class="tma-portal-viewer__member-text">' +
                '<strong>' + esc(p.name) + (p.isSelf ? ' (you)' : '') + '</strong>' +
                '<span class="tma-portal-viewer__member-email">' + esc(p.email) + '</span>' +
              '</span>' +
              '<span class="tma-portal-viewer__member-role">' + esc(p.label) + '</span>' +
            '</div>';
          }).join('') + '</div>',
      });
      if (lb && host) host.style.zIndex = '700';
    }

    /* ── header: identity, status, toolbar ───────────── */

    function viewerHead(f) {
      return '<header class="tma-portal-viewer__head">' +
        '<div class="tma-portal-viewer__identity">' +
          '<img class="tma-portal-viewer__filetype" src="' + esc(fileIconSrc(f)) + '" alt="" width="28" height="28">' +
          '<div class="tma-portal-viewer__namewrap">' +
            '<span class="tma-portal-viewer__name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
            '<span class="tma-portal-viewer__sub">' + headMetaHtml(f) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tma-portal-viewer__presence-wrap" data-lb-presence>' +
          presenceHtml(f.presence) + '</div>' +
        '<div class="tma-portal-viewer__tools">' + toolbarHtml(f) + '</div>' +
      '</header>';
    }

    // Compact status line under the file name. Only facts we actually hold —
    // version, sync and approval badges arrive with the phases that own them.
    function headMetaHtml(f) {
      var bits = [];
      if (f.category) bits.push(esc(cap(f.category)));
      // Only worth stating once there is history to state — "Version 1" on
      // every file is noise.
      if (f.versionNumber > 1) bits.push('Version ' + f.versionNumber);
      if (f.sizeLabel) bits.push(esc(f.sizeLabel));
      if (f.modifiedAt) bits.push('Modified ' + esc(fmtDate(f.modifiedAt)));
      if (f.folder) bits.push('in ' + esc(f.folder.name));

      var line = bits.join(' &middot; ');
      var b = f.workflowBadge;
      if (b) {
        // A badge on a file whose content has moved on since the decision must
        // say which version it describes, or it reads as approving the file as
        // it stands today.
        line += ' <span class="tma-portal-status tma-portal-status--' + esc(b.tone) + '">' + esc(b.label) +
          (b.stale && b.appliesToVersion ? ' (v' + b.appliesToVersion + ')' : '') + '</span>';
      }
      return line;
    }

    function toolBtnHtml(icon, action, label, opts) {
      opts = opts || {};
      return '<button type="button" class="tma-portal-viewer__tool' + (opts.active ? ' is-active' : '') + '"' +
        ' data-lb-act="' + action + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
        (opts.pressed !== undefined ? ' aria-pressed="' + opts.pressed + '"' : '') + '>' +
        '<img src="images/icons/phosphor/' + icon + '.svg" alt="" width="18" height="18">' +
        '</button>';
    }

    /**
     * Only actions the viewer may actually perform are rendered — and every
     * one of them is re-checked server-side when it runs. Hiding a button is
     * a courtesy, never the control.
     */
    function toolbarHtml(f) {
      var html = '';
      if (perm(f, 'download')) html += toolBtnHtml('ArrowLineDown', 'download', 'Download');
      html += favouriteToolHtml(f);
      if (perm(f, 'preview')) html += toolBtnHtml('Printer', 'print', 'Print');
      if (perm(f, 'share')) html += toolBtnHtml('ShareNetwork', 'share', 'Share');
      if (perm(f, 'delete')) html += toolBtnHtml('Trash', 'delete', 'Delete');
      html += toolBtnHtml('ChatCircle', 'comments', 'Comments',
        { active: viewerPrefs.panel && viewerPrefs.tab === 'comments' });
      html += toolBtnHtml('Clipboard', 'approvals', 'Reviews and approvals',
        { active: viewerPrefs.panel && viewerPrefs.tab === 'approvals' });
      html += toolBtnHtml('ClockCounterClockwise', 'versions', 'Version history',
        { active: viewerPrefs.panel && viewerPrefs.tab === 'versions' });
      html += toolBtnHtml('Info', 'panel', 'File details', { pressed: viewerPrefs.panel, active: viewerPrefs.panel });
      html += toolBtnHtml('DotsThree', 'more', 'More actions');
      html += '<span class="tma-portal-viewer__tool-sep"></span>';
      html += toolBtnHtml('X', 'close', 'Close');
      return html;
    }

    /* Same inline star as the file list: an <img> can only be dimmed, so the
     * "on" state has to be drawn to read as a filled yellow star. */
    function favouriteToolHtml(f) {
      var on = !!f.favorite;
      var path = 'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';
      var label = on ? 'Remove from favourites' : 'Add to favourites';
      return '<button type="button" class="tma-portal-viewer__tool' + (on ? ' is-active' : '') + '"' +
        ' data-lb-act="favorite" aria-label="' + esc(label) + '" title="' + esc(label) + '" aria-pressed="' + on + '">' +
        '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">' +
        '<path d="' + path + '" ' + (on ? 'fill="#ffcc00" stroke="#e0ac00"' : 'fill="none" stroke="currentColor"') +
        ' stroke-width="1.3" stroke-linejoin="round"/></svg></button>';
    }

    /* ── left rail: the other files in this view ─────── */

    function railHtml() {
      return gallery.map(function (g, i) {
        var thumb = g.thumbUrl
          ? '<img src="' + esc(g.thumbUrl) + '" alt="" loading="lazy">'
          : '<img class="tma-portal-viewer__rail-icon" src="' + esc(fileIconSrc(g)) + '" alt="">';
        return '<button type="button" class="tma-portal-viewer__rail-item' + (i === idx ? ' is-current' : '') + '"' +
          ' data-lb-go="' + i + '" title="' + esc(g.name) + '" aria-current="' + (i === idx) + '">' +
          thumb + '<span class="tma-portal-viewer__rail-name">' + esc(g.name) + '</span></button>';
      }).join('');
    }

    function footHtml(f) {
      var pos = gallery.length > 1 ? (idx + 1) + ' of ' + gallery.length : '';
      return (pos ? '<span>' + pos + '</span>' : '') +
        (f.sizeLabel ? '<span>' + esc(f.sizeLabel) + '</span>' : '');
    }

    /* ── right panel ─────────────────────────────────── */

    /**
     * The documented Tab Group (underline), not a set of buttons of our own.
     *
     * These were a bespoke `.tma-portal-viewer__tab` — a second tab component
     * in a portal that already has one, which Rule 5 exists to prevent. The
     * label lives in its own span because the indicator is a sibling element;
     * anything writing to the button's textContent erases both.
     */
    function tabsHtml() {
      var counts = (entry(current()).details || {}).counts || {};

      return VIEWER_TABS.map(function (t) {
        var active = viewerPrefs.tab === t.id;
        var n = t.count ? counts[t.count] : 0;
        // Only when there is something there. A row of "(0)" tells the reader
        // nothing except that six tabs exist, which they can already see.
        var label = n > 0 ? t.label + ' (' + n + ')' : t.label;

        return '<button type="button" role="tab" class="tma-tab' + (active ? ' is-active' : '') + '"' +
          ' data-lb-tab="' + t.id + '" aria-selected="' + active + '">' +
          '<span class="tma-tab__label">' + esc(label) + '</span>' +
          '<span class="tma-tab__indicator"></span>' +
        '</button>';
      }).join('');
    }

    function panelChromeHtml() {
      return '<div class="tma-portal-viewer__panel-head">' +
        '<div class="tma-portal-viewer__tabs tma-tab-group tma-tab-group--underline" role="tablist">' +
          tabsHtml() +
        '</div>' +
        '<button type="button" class="tma-portal-viewer__panel-close" data-lb-act="panel" aria-label="Hide details">' +
          '<img src="images/icons/phosphor/X.svg" alt="" width="16" height="16"></button>' +
      '</div>';
    }

    // Repaints ONLY the panel body, so the stage keeps its scroll and zoom.
    function paintPanel() {
      var host = lb.querySelector('[data-lb-panel-body]');
      if (!host) return;

      var tabs = lb.querySelector('.tma-portal-viewer__tabs');
      if (tabs) tabs.innerHTML = tabsHtml();

      if (viewerPrefs.tab === 'details') return paintDetails(host);
      if (viewerPrefs.tab === 'comments') return paintComments(host);
      if (viewerPrefs.tab === 'versions') return paintVersions(host);
      if (viewerPrefs.tab === 'approvals') return paintApprovals(host);
      if (viewerPrefs.tab === 'activity') return paintActivity(host);
      return paintAccess(host);
    }

    /* Details -------------------------------------------------------- */

    function paintDetails(host) {
      var f = current();
      var e = entry(f);

      /*
       * The file leads, then only what the name does not already say.
       *
       * This used to open with a "FILE" heading over six rows, the first of
       * which repeated the filename already in the viewer's title bar, and two
       * more of which ("Pdf", "176.9 KB") are one short line together. The
       * heading labelled a panel whose tab already says Details, and the rows
       * left a wide empty gutter between each label and its value.
       *
       * So: the file's own icon and name as the subject, its type and size as
       * the caption beneath, and rows only for the three facts the name cannot
       * carry — where it lives, whose it is, when it last changed.
       */
      host.innerHTML =
        '<div class="tma-portal-viewer__card">' +
          '<div class="tma-portal-viewer__file">' +
            '<img class="tma-portal-viewer__file-icon" src="' + esc(fileIconSrc(f)) + '" alt="" width="36" height="36">' +
            '<div class="tma-portal-viewer__file-text">' +
              '<p class="tma-portal-viewer__file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</p>' +
              '<p class="tma-portal-viewer__file-meta">' + esc(fileMetaLine(f)) + '</p>' +
            '</div>' +
          '</div>' +
          '<section class="tma-portal-viewer__section">' +
            detailRow('Location', f.folder ? f.folder.name : 'File Box') +
            detailRow('Owner', f.owner ? f.owner.name : null) +
            detailRow('Modified', f.modifiedAt ? fmtDate(f.modifiedAt) : null) +
          '</section>' +
          /*
           * What the other tabs are holding.
           *
           * Buttons, not labels: having told somebody there are two open
           * comments, the next thing they want is to read them, and making
           * them find the tab afterwards would be a worse panel than one that
           * never mentioned it.
           *
           * Rendered empty until the details request answers — the counts ride
           * along with it, so there is nothing to show and nothing to fetch.
           */
          '<div data-lb-counts>' + (e.details ? countsHtml(e.details) : '') + '</div>' +
        '</div>' +
        /*
         * No skeleton while the extra metadata loads.
         *
         * "More details" is a collapsed disclosure — one line when it arrives.
         * Standing in for it with three placeholder rows put the largest,
         * greyest shape on the panel where almost nothing was about to appear,
         * so a slow request looked like a broken panel rather than a link that
         * had not shown up yet. It fades in when it is ready.
         */
        '<div data-lb-more>' + (e.details ? moreDetailsHtml(e.details) : '') + '</div>';

      if (e.details) return;
      ensureDetails(f)
        .then(function (data) {
          if (current().id !== f.id || viewerPrefs.tab !== 'details') return;
          var slot = lb.querySelector('[data-lb-more]');
          if (slot) slot.innerHTML = moreDetailsHtml(data);
          var counts = lb.querySelector('[data-lb-counts]');
          if (counts) counts.innerHTML = countsHtml(data);
        })
        .catch(function (err) { panelError('[data-lb-more]', err, 'details'); });
    }

    /**
     * Fetch a file's details once, whoever asks first.
     *
     * Both the Details panel and the tab counts want this, and the counts are
     * wanted whichever tab is showing — so it can no longer live inside
     * paintDetails. The in-flight promise is cached as well as the result:
     * opening on Comments asks for it to label the tabs while the panel asks
     * for it too, and without that they would both fetch.
     */
    function ensureDetails(f) {
      var e = entry(f);

      if (e.details) return Promise.resolve(e.details);
      if (e.detailsPromise) return e.detailsPromise;

      e.detailsPromise = net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/details'))
        .then(function (data) {
          e.details = data;
          e.detailsPromise = null;

          return data;
        })
        .catch(function (err) {
          e.detailsPromise = null;
          throw err;
        });

      return e.detailsPromise;
    }

    /* Load the counts and label the tabs, whatever tab is on show. */
    function loadTabCounts(f) {
      ensureDetails(f)
        .then(function () {
          if (!lb || current().id !== f.id) return;
          var tabs = lb.querySelector('.tma-portal-viewer__tabs');
          if (tabs) tabs.innerHTML = tabsHtml();
        })
        .catch(function () {
          // No counts is the state the tabs already render in.
        });
    }

    /**
     * "PDF · 176.9 KB" — the two facts that used to be a row each.
     *
     * The extension rather than the category, uppercased: the category made
     * "Pdf", which reads as a typo for a format everybody writes as PDF. Any
     * extension survives this correctly (DOCX, XLSX, PNG), which a list of
     * special cases would not.
     */
    function fileMetaLine(f) {
      var bits = [];
      var dot = String(f.name || '').lastIndexOf('.');
      var ext = dot > 0 ? f.name.slice(dot + 1) : '';

      if (ext && ext.length <= 5) bits.push(ext.toUpperCase());
      else if (f.category) bits.push(cap(f.category));

      if (f.sizeLabel) bits.push(f.sizeLabel);

      return bits.join(' · ');
    }

    /**
     * "2 comments · 3 versions" — each one a way into its tab.
     *
     * Zeroes are left out rather than shown as "0 comments". A file with
     * nothing on it says nothing, which is the honest answer and keeps the
     * card short; three zeroes would be three lines of nothing to do.
     */
    function countsHtml(data) {
      var counts = (data && data.counts) || {};

      var chips = [
        { tab: 'comments', n: counts.comments, one: 'comment', many: 'comments' },
        { tab: 'versions', n: counts.versions, one: 'version', many: 'versions' },
        { tab: 'approvals', n: counts.approvals, one: 'approval', many: 'approvals' },
      ].filter(function (c) { return c.n > 0; });

      if (!chips.length) return '';

      return '<div class="tma-portal-viewer__counts">' +
        chips.map(function (c) {
          return '<button type="button" class="tma-portal-viewer__count" data-lb-tab="' + c.tab + '">' +
            c.n + ' ' + (c.n === 1 ? c.one : c.many) +
          '</button>';
        }).join('') +
      '</div>';
    }

    function detailRow(label, value) {
      if (value == null || value === '') return '';
      return '<div class="tma-portal-viewer__row">' +
        '<span class="tma-portal-viewer__row-label">' + esc(label) + '</span>' +
        '<span class="tma-portal-viewer__row-value">' + esc(value) + '</span></div>';
    }

    /*
     * Open by default.
     *
     * §30 asked for this collapsed so the panel would not dump every field on
     * open. In practice the card above now carries the handful of facts people
     * actually came for, so what is left behind the disclosure is the detail
     * somebody opening a Details tab is looking for — and a closed <details>
     * over an otherwise empty panel just made them click once more to reach
     * it. Kept as a <details> so it can still be collapsed.
     */
    function moreDetailsHtml(data) {
      var groups = (data && data.groups) || [];
      if (!groups.length) return '';
      return '<details class="tma-portal-viewer__more" open>' +
        '<summary class="tma-portal-viewer__more-summary">' +
          // The phosphor caret rather than a "▸" character: the glyph renders
          // at a different weight and baseline on every platform, and it was
          // the only arrow in the portal not drawn from the icon set.
          '<img class="tma-portal-viewer__more-caret" src="images/icons/phosphor/CaretRight.svg" alt="" width="12" height="12">' +
          '<span>More details</span>' +
        '</summary>' +
        groups.map(function (g) {
          return '<section class="tma-portal-viewer__section">' +
            '<h4 class="tma-portal-viewer__section-title">' + esc(g.title) + '</h4>' +
            g.rows.map(function (r) { return detailRow(r.label, r.value); }).join('') +
          '</section>';
        }).join('') +
      '</details>';
    }

    /* Repaints only the comment list — the composer keeps its text and caret. */
    function repaintComments(e) {
      var slot = lb.querySelector('[data-lb-comments]');
      if (slot && e.comments) slot.innerHTML = commentsHtml(e.comments, e);
    }

    /**
     * Emoji insertion, built from the portal's own emoji data rather than a
     * second picker implementation. Comments are plain text, so an emoji is
     * simply a character typed at the caret.
     */
    function openEmojiPicker() {
      var data = window.TMAEmojiData;
      if (!data) { ui().toast('Emoji are unavailable'); return; }

      var existing = lb.querySelector('[data-lb-emojipop]');
      if (existing) { existing.remove(); return; }

      var pop = document.createElement('div');
      pop.className = 'tma-portal-viewer__emoji-pop';
      pop.setAttribute('data-lb-emojipop', '');
      pop.innerHTML = (data.groups || []).slice(0, 4).map(function (g) {
        return '<div class="tma-portal-viewer__emoji-group">' +
          '<h6>' + esc(g.label) + '</h6>' +
          (g.items || []).slice(0, 48).map(function (it) {
            return '<button type="button" class="tma-portal-viewer__emoji" data-lb-emojichar="' +
              esc(it.c) + '" title="' + esc(it.n) + '">' + esc(it.c) + '</button>';
          }).join('') +
        '</div>';
      }).join('');

      pop.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-lb-emojichar]');
        if (!b) return;
        insertAtCaret(b.getAttribute('data-lb-emojichar'));
        pop.remove();
      });

      var composer = lb.querySelector('[data-lb-composer]');
      if (composer) composer.appendChild(pop);
    }

    function insertAtCaret(text) {
      var input = lb.querySelector('[data-lb-input]');
      if (!input) return;
      var pos = input.selectionStart;
      input.value = input.value.slice(0, pos) + text + input.value.slice(input.selectionEnd);
      input.focus();
      input.setSelectionRange(pos + text.length, pos + text.length);
      entry(current()).draft = input.value;
    }

    /**
     * Live comments from other people.
     *
     * The event carries no body — only that something changed — so the panel
     * refetches the thread and patches it in. Nothing reloads, and the reader's
     * scroll, open composer and half-typed reply all survive (§29).
     */
    function subscribeToFile(f) {
      realtimeConfig(function (cfg) {
        var rt = window.TMAMessagingRealtime;
        if (!lb || !rt || !cfg || !rt.start(cfg)) return;
        bindFileChannel(rt, f);
      });
    }

    function bindFileChannel(rt, f) {
      var name = 'private-file.' + f.id;
      if (lb._channel === name) return;
      if (lb._channel) rt.leave(lb._channel);
      lb._channel = name;

      rt.listen(name, 'file.presence.changed', function (payload) {
        if (!lb || !payload || payload.fileId !== current().id) return;
        loadPresence(current());
      });

      rt.listen(name, 'file.comment.changed', function (payload) {
        if (!lb || !payload || payload.fileId !== current().id) return;
        var e = entry(current());
        e.comments = null;
        if (viewerPrefs.tab === 'comments') loadComments(current());
        else refreshOpenCountOnly(current());
      });

      /*
       * Versions, approvals and activity, on the same terms as comments above.
       *
       * Only the tab on show is refetched; the others have their cache dropped
       * so they reload when opened. Refetching all three on every signal would
       * be two wasted requests for panels nobody is looking at, and leaving the
       * caches alone would show a stale list the moment the reader switched
       * tabs — which looks more broken than never updating at all.
       */
      rt.listen(name, 'file.detail.changed', function (payload) {
        if (!lb || !payload || payload.fileId !== current().id) return;

        var f = current();
        var e = entry(f);
        var section = payload.section;

        // The counts live in the details payload, so a new version landing has
        // to invalidate that too — otherwise the panel shows the new version
        // while the tab beside it still says how many there were before.
        e.details = null;
        loadTabCounts(f);

        if (section === 'versions') {
          e.versions = null;
          if (viewerPrefs.tab === 'versions') loadVersions(f);
        } else if (section === 'approvals') {
          e.approvals = null;
          if (viewerPrefs.tab === 'approvals') loadApprovals(f);
        } else if (section === 'activity') {
          e.activity = null;
          if (viewerPrefs.tab === 'activity') loadActivity(f);
        }
      });
    }

    // Keeps the tab's badge honest while the reader is on another tab.
    function refreshOpenCountOnly(f) {
      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments'))
        .then(function (data) { entry(f).comments = data; refreshCommentCount(data); })
        .catch(function () {});
    }

    /* Comments ------------------------------------------------------- */

    function paintComments(host) {
      var f = current();
      var e = entry(f);
      var stale = e.comments;

      host.innerHTML =
        '<div data-lb-comments>' + (stale ? commentsHtml(stale, e) : ui().loading({ count: 3 })) + '</div>' +
        composerHtml(f, e);

      // Always refetch: someone else may have commented since this was cached.
      // The stale copy stays on screen meanwhile, so there is no flicker.
      loadComments(f);
      restoreDraft(e);
    }

    function loadComments(f, append) {
      var e = entry(f);
      var q = append && e.comments && e.comments.nextCursor ? '?before=' + e.comments.nextCursor : '';
      var seq = e.commentsSeq = (e.commentsSeq || 0) + 1;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments' + q))
        .then(function (data) {
          // A response that has been overtaken is thrown away: applying it
          // would undo whatever the newer request already showed.
          if (seq !== e.commentsSeq) return;
          if (append && e.comments) {
            data.threads = data.threads.concat(e.comments.threads);
          }
          e.comments = data;
          if (current().id !== f.id || viewerPrefs.tab !== 'comments') return;
          var slot = lb.querySelector('[data-lb-comments]');
          if (slot) slot.innerHTML = commentsHtml(data, e);
          refreshCommentCount(data);
        })
        .catch(function (err) { panelError('[data-lb-comments]', err, 'comments'); });
    }

    // The tab label carries the open-thread count, so an unread discussion is
    // visible without opening the panel.
    function refreshCommentCount(data) {
      var n = (data && data.openCount) || 0;

      /*
       * Into the cache as well as onto the label.
       *
       * The tab row is rebuilt from the cached counts on every panel repaint,
       * so a count written only to the DOM survives until the reader switches
       * tabs and then silently reverts to whatever the details request last
       * said — which, after posting a comment, is one short.
       */
      var e = entry(current());
      if (e.details && e.details.counts) e.details.counts.comments = n;

      // The label span, not the button: the underline tab keeps its indicator
      // as a sibling, and writing to the button's textContent removes it.
      var label = lb.querySelector('[data-lb-tab="comments"] .tma-tab__label');
      if (!label) return;
      label.textContent = n ? 'Comments (' + n + ')' : 'Comments';
    }

    function commentsHtml(data, e) {
      var threads = (data && data.threads) || [];
      if (!threads.length) {
        return '<p class="tma-portal-viewer__empty">No comments yet. Start the discussion below.</p>';
      }

      var html = data.nextCursor
        ? '<button type="button" class="tma-portal-viewer__more-btn" data-lb-more-comments>Show earlier comments</button>'
        : '';

      html += threads.map(function (t) { return threadHtml(t, e); }).join('');

      return html;
    }

    function threadHtml(t, e) {
      var replies = (t.replies || []).map(function (r) {
        return '<div class="tma-portal-viewer__reply">' + commentHtml(r, e) + '</div>';
      }).join('');

      return '<div class="tma-portal-viewer__thread' + (t.resolved ? ' is-resolved' : '') + '" data-thread="' + esc(t.id) + '">' +
        commentHtml(t, e) +
        replies +
        (t.can.reply ? replyControlHtml(t, e) : '') +
      '</div>';
    }

    function commentHtml(c, e) {
      if (c.deleted) {
        return '<div class="tma-portal-viewer__comment is-deleted">' +
          '<p class="tma-portal-viewer__comment-body"><em>This comment was deleted.</em></p></div>';
      }

      var editing = e.editing === c.id;
      var who = c.author ? (c.author.isSelf ? 'You' : c.author.name) : 'Someone';

      var actions = '';
      if (!editing) {
        if (c.can.resolve) {
          actions += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-resolve="' + esc(c.id) + '"' +
            ' data-resolved="' + c.resolved + '">' + (c.resolved ? 'Reopen' : 'Resolve') + '</button>';
        }
        if (c.can.edit) actions += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-edit="' + esc(c.id) + '">Edit</button>';
        if (c.can.delete) actions += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-del="' + esc(c.id) + '">Delete</button>';
      }

      var body = editing
        ? '<div class="tma-portal-viewer__editbox">' +
            '<textarea class="tma-portal-viewer__input" data-lb-editinput rows="3">' + esc(c.body || '') + '</textarea>' +
            '<div class="tma-portal-viewer__composer-actions">' +
              '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-editcancel>Cancel</button>' +
              '<button type="button" class="tma-portal-viewer__btn" data-lb-editsave="' + esc(c.id) + '">Save</button>' +
            '</div>' +
          '</div>'
        : '<p class="tma-portal-viewer__comment-body">' + decorateMentions(c) + '</p>';

      return '<div class="tma-portal-viewer__comment" data-comment="' + esc(c.id) + '">' +
        '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(c.author)) + '" alt="" width="28" height="28">' +
        '<div class="tma-portal-viewer__comment-main">' +
          '<div class="tma-portal-viewer__comment-head">' +
            '<strong>' + esc(who) + '</strong>' +
            '<time datetime="' + esc(c.createdAt) + '">' + esc(fmtDateTime(c.createdAt)) + '</time>' +
            (c.editedAt ? '<span class="tma-portal-viewer__comment-flag">edited</span>' : '') +
            (c.resolved ? '<span class="tma-portal-viewer__comment-flag tma-portal-viewer__comment-flag--ok">Resolved' +
              (c.resolvedBy ? ' by ' + esc(c.resolvedBy) : '') + '</span>' : '') +
          '</div>' +
          body +
          (actions ? '<div class="tma-portal-viewer__comment-actions">' + actions + '</div>' : '') +
        '</div>' +
      '</div>';
    }

    /**
     * Escape first, then wrap the mentioned names.
     *
     * The body is plain text from the server and is escaped here before any
     * markup is added, so a comment can never inject HTML into someone else's
     * viewer — the highlight is applied to the *escaped* string.
     */
    function decorateMentions(c) {
      var text = esc(c.body || '');
      (c.mentions || []).forEach(function (m) {
        var safe = esc(m.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp('@?' + safe, 'g'),
          '<span class="tma-portal-viewer__mention">@' + esc(m.name) + '</span>');
      });
      return text.replace(/\n/g, '<br>');
    }

    function replyControlHtml(t, e) {
      if (e.replyingTo === t.id) {
        return '<div class="tma-portal-viewer__reply tma-portal-viewer__replybox">' +
          '<textarea class="tma-portal-viewer__input" data-lb-replyinput rows="2" placeholder="Write a reply…"></textarea>' +
          '<div class="tma-portal-viewer__composer-actions">' +
            '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-replycancel>Cancel</button>' +
            '<button type="button" class="tma-portal-viewer__btn" data-lb-replysend="' + esc(t.id) + '">Reply</button>' +
          '</div>' +
        '</div>';
      }
      return '<button type="button" class="tma-portal-viewer__comment-act tma-portal-viewer__reply-open" data-lb-replyopen="' + esc(t.id) + '">Reply</button>';
    }

    function composerHtml(f, e) {
      if (e.comments && e.comments.canComment === false) {
        return '<p class="tma-portal-viewer__empty">You can view this discussion but not add to it.</p>';
      }

      return '<div class="tma-portal-viewer__composer" data-lb-composer>' +
        '<textarea class="tma-portal-viewer__input" data-lb-input rows="3" ' +
          'placeholder="Add a comment. Use @ to mention someone."></textarea>' +
        '<div class="tma-portal-viewer__mention-pop" data-lb-mentions hidden></div>' +
        '<div class="tma-portal-viewer__composer-actions">' +
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-emoji title="Insert emoji" aria-label="Insert emoji">🙂</button>' +
          '<span class="tma-portal-viewer__composer-spacer"></span>' +
          // Cancel and Send sit in a row with a gap — §16 asks specifically
          // that the clear control never overlap the send control.
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-clear>Cancel</button>' +
          '<button type="button" class="tma-portal-viewer__btn" data-lb-send>Comment</button>' +
        '</div>' +
      '</div>';
    }

    /* Draft survives a tab switch — losing half a typed comment because you
     * checked the file's details is exactly what §29 is about. */
    function restoreDraft(e) {
      var input = lb.querySelector('[data-lb-input]');
      if (input && e.draft) input.value = e.draft;
    }

    function sendComment() {
      var f = current();
      var e = entry(f);
      var input = lb.querySelector('[data-lb-input]');
      if (!input) return;

      var body = input.value.trim();
      if (!body) return;

      var mentions = (e.pendingMentions || []).filter(function (m) {
        return body.indexOf(m.name) !== -1;
      });

      input.value = '';
      e.draft = '';
      e.pendingMentions = [];

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments'), {
        method: 'POST',
        json: { body: body, mentions: mentions.map(function (m) { return m.id; }) },
      })
        .then(function () { e.comments = null; loadComments(f); })
        .catch(function (err) {
          // Give the words back rather than losing them to a failed request.
          input.value = body;
          e.draft = body;
          ui().toast((err && err.message) || 'Could not post that comment');
        });
    }

    function sendReply(threadId) {
      var f = current();
      var e = entry(f);
      var input = lb.querySelector('[data-lb-replyinput]');
      if (!input) return;
      var body = input.value.trim();
      if (!body) return;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments'), {
        method: 'POST',
        json: { body: body, parent: threadId },
      })
        .then(function () { e.replyingTo = null; e.comments = null; loadComments(f); })
        .catch(function (err) { ui().toast((err && err.message) || 'Could not post that reply'); });
    }

    function saveEdit(commentId) {
      var f = current();
      var e = entry(f);
      var input = lb.querySelector('[data-lb-editinput]');
      if (!input) return;
      var body = input.value.trim();
      if (!body) return;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments/' + encodeURIComponent(commentId)), {
        method: 'PATCH', json: { body: body },
      })
        .then(function () { e.editing = null; e.comments = null; loadComments(f); })
        .catch(function (err) { ui().toast((err && err.message) || 'Could not save that edit'); });
    }

    function deleteComment(commentId) {
      var f = current();
      var e = entry(f);
      confirmModal({
        title: 'Delete comment',
        message: 'Delete this comment? Replies to it stay in the thread.',
        confirmLabel: 'Delete', danger: true,
        onConfirm: function () {
          net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments/' + encodeURIComponent(commentId)), { method: 'DELETE' })
            .then(function () { e.comments = null; loadComments(f); })
            .catch(function (err) { ui().toast((err && err.message) || 'Could not delete that comment'); });
        },
      });
    }

    function toggleResolve(commentId, resolved) {
      var f = current();
      var e = entry(f);
      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments/' + encodeURIComponent(commentId) + '/resolve'), {
        method: 'POST', json: { resolved: !resolved },
      })
        .then(function (updated) {
          // Patch the one thread rather than rebuilding the list. A wholesale
          // repaint replaces every node, so in a long list the row somebody is
          // interacting with is swapped out from under them.
          if (e.comments) {
            e.comments.threads = e.comments.threads.map(function (th) {
              return th.id === commentId
                ? Object.assign({}, th, updated, { replies: th.replies })
                : th;
            });
            e.comments.openCount += updated.resolved ? -1 : 1;
            var node = lb.querySelector('.tma-portal-viewer__thread[data-thread="' + commentId + '"]');
            var fresh = e.comments.threads.filter(function (th) { return th.id === commentId; })[0];
            if (node && fresh) {
              node.outerHTML = threadHtml(fresh, e);
              refreshCommentCount(e.comments);

              return;
            }
          }
          e.comments = null;
          loadComments(f);
        })
        .catch(function (err) { ui().toast((err && err.message) || 'Could not update that thread'); });
    }

    /* ── @mention autocomplete ───────────────────────── */

    function onComposerInput(input) {
      var f = current();
      var e = entry(f);
      e.draft = input.value;

      var upto = input.value.slice(0, input.selectionStart);
      var m = /@([\w' -]{0,40})$/.exec(upto);
      var pop = lb.querySelector('[data-lb-mentions]');
      if (!pop) return;

      if (!m) { pop.hidden = true; return; }

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/mentionable?q=' + encodeURIComponent(m[1])))
        .then(function (data) {
          var people = (data && data.people) || [];
          if (!people.length) { pop.hidden = true; return; }
          pop.innerHTML = people.map(function (p) {
            return '<button type="button" class="tma-portal-viewer__mention-item" data-lb-mention="' + p.id + '"' +
              ' data-name="' + esc(p.name) + '">' +
              '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(p)) + '" alt="" width="22" height="22">' +
              '<span><strong>' + esc(p.name) + '</strong><span class="tma-portal-viewer__member-email">' + esc(p.email) + '</span></span>' +
            '</button>';
          }).join('');
          pop.hidden = false;
        })
        .catch(function () { pop.hidden = true; });
    }

    function insertMention(id, name) {
      var f = current();
      var e = entry(f);
      var input = lb.querySelector('[data-lb-input]');
      var pop = lb.querySelector('[data-lb-mentions]');
      if (!input) return;

      var pos = input.selectionStart;
      var before = input.value.slice(0, pos).replace(/@([\w' -]{0,40})$/, '');
      var after = input.value.slice(pos);
      input.value = before + '@' + name + ' ' + after;
      input.focus();
      var caret = (before + '@' + name + ' ').length;
      input.setSelectionRange(caret, caret);

      e.pendingMentions = (e.pendingMentions || []).concat([{ id: parseInt(id, 10), name: name }]);
      e.draft = input.value;
      if (pop) pop.hidden = true;
    }

    /* Versions -------------------------------------------------------- */

    function paintVersions(host) {
      var f = current();
      var e = entry(f);

      host.innerHTML = '<div data-lb-versions>' +
        (e.versions ? versionsHtml(e.versions, f) : ui().loading({ count: 3 })) + '</div>';

      loadVersions(f);
    }

    function loadVersions(f) {
      var e = entry(f);
      var seq = e.versionsSeq = (e.versionsSeq || 0) + 1;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/versions'))
        .then(function (data) {
          if (seq !== e.versionsSeq) return;
          e.versions = data;
          if (current().id !== f.id || viewerPrefs.tab !== 'versions') return;
          var slot = lb.querySelector('[data-lb-versions]');
          if (slot) slot.innerHTML = versionsHtml(data, f);
        })
        .catch(function (err) { panelError('[data-lb-versions]', err, 'version history'); });
    }

    function versionsHtml(data, f) {
      var list = (data && data.versions) || [];
      if (!list.length) return '<p class="tma-portal-viewer__empty">No version history for this file.</p>';

      var head = data.canAddVersion
        ? '<button type="button" class="tma-portal-viewer__btn tma-portal-viewer__version-add" data-lb-newversion>' +
            'Upload new version</button>' +
          '<input type="file" hidden data-lb-versionfile>'
        : '';

      return head + list.map(function (v) {
        var who = v.uploadedBy ? v.uploadedBy.name : 'Someone';
        var acts = '';
        // The current version is downloaded through the file's own toolbar, so
        // only older ones carry their own actions.
        if (!v.isCurrent && v.can.preview) acts += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-vpreview="' + esc(v.id) + '">Preview</button>';
        if (!v.isCurrent && v.can.download) acts += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-vdownload="' + esc(v.id) + '">Download</button>';
        if (v.can.restore) acts += '<button type="button" class="tma-portal-viewer__comment-act" data-lb-vrestore="' + esc(v.id) + '" data-num="' + v.number + '">Restore</button>';

        return '<div class="tma-portal-viewer__version' + (v.isCurrent ? ' is-current' : '') + '">' +
          '<div class="tma-portal-viewer__version-mark">v' + v.number + '</div>' +
          '<div class="tma-portal-viewer__version-main">' +
            '<div class="tma-portal-viewer__comment-head">' +
              '<strong>' + esc(who) + '</strong>' +
              '<time datetime="' + esc(v.uploadedAt) + '">' + esc(fmtDateTime(v.uploadedAt)) + '</time>' +
              (v.isCurrent ? '<span class="tma-portal-viewer__comment-flag tma-portal-viewer__comment-flag--ok">Current</span>' : '') +
              (v.restoredFrom ? '<span class="tma-portal-viewer__comment-flag">restored from v' + v.restoredFrom + '</span>' : '') +
              (v.approvalStatus ? '<span class="tma-portal-viewer__comment-flag">' + esc(v.approvalStatus) + '</span>' : '') +
            '</div>' +
            (v.note ? '<p class="tma-portal-viewer__version-note">' + esc(v.note) + '</p>' : '') +
            '<p class="tma-portal-viewer__version-meta">' + esc(v.sizeLabel) +
              (v.checksum ? ' &middot; ' + esc(v.checksum) : '') + '</p>' +
            (acts ? '<div class="tma-portal-viewer__comment-actions">' + acts + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    /**
     * Uploading a new version. The note is asked for BEFORE the bytes go up,
     * because §5 wants the reason recorded — and asking afterwards means a
     * large upload finishes with nothing to say about it.
     */
    function pickNewVersion() {
      var input = lb.querySelector('[data-lb-versionfile]');
      if (input) input.click();
    }

    function uploadNewVersion(file) {
      var f = current();
      var e = entry(f);

      confirmModal({
        title: 'Upload new version',
        message: 'Add “' + file.name + '” as the next version of “' + f.name + '”? ' +
          'The current version is kept and stays downloadable.',
        prompt: { label: 'Why is this version being uploaded? (optional)', placeholder: 'e.g. Client asked for clause 4 to change' },
        confirmLabel: 'Upload version',
        onConfirm: function (note) {
          var form = new FormData();
          form.append('file', file);
          if (note) form.append('note', note);

          ui().toast('Uploading new version…');
          net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/versions'), {
            method: 'POST', body: form,
          })
            .then(function (res) {
              ui().toast('Version ' + res.version + ' uploaded');
              e.versions = null;
              // The file's own row and the header both changed (size, modified,
              // version), so refresh what we hold rather than guessing.
              if (res.file) {
                updateItem(f.id, res.file);
                Object.assign(f, res.file);
              }
              var head = lb.querySelector('.tma-portal-viewer__head');
              if (head) head.outerHTML = viewerHead(f);
              bustPreview(f, res.version);
              repaintStage(f);
              loadVersions(f);
            })
            .catch(function (err) { ui().toast((err && err.message) || 'Could not upload that version'); });
        },
      });
    }

    function restoreVersion(versionId, number) {
      var f = current();
      var e = entry(f);

      confirmModal({
        title: 'Restore version ' + number,
        message: 'This adds version ' + number + '’s content as a NEW current version. ' +
          'Nothing is deleted — every later version stays in the history.',
        prompt: { label: 'Note (optional)', placeholder: 'Why are you restoring this?' },
        confirmLabel: 'Restore',
        onConfirm: function (note) {
          net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/versions/' + encodeURIComponent(versionId) + '/restore'), {
            method: 'POST', json: note ? { note: note } : {},
          })
            .then(function (res) {
              ui().toast('Restored as version ' + res.version);
              e.versions = null;
              if (res.file) {
                updateItem(f.id, res.file);
                Object.assign(f, res.file);
              }
              var head = lb.querySelector('.tma-portal-viewer__head');
              if (head) head.outerHTML = viewerHead(f);
              bustPreview(f, res.version);
              repaintStage(f);
              loadVersions(f);
            })
            .catch(function (err) { ui().toast((err && err.message) || 'Could not restore that version'); });
        },
      });
    }

    /* The preview and thumbnail URLs do not change when the content does, so
     * without a cache-buster the viewer keeps showing the previous version's
     * bytes after an upload — which reads as the upload having failed. */
    function bustPreview(f, version) {
      ['previewUrl', 'thumbUrl'].forEach(function (key) {
        if (!f[key]) return;
        f[key] = f[key].split('?')[0] + '?v=' + version;
      });
    }

    function versionUrl(versionId, action) {
      return net().url('/files/' + encodeURIComponent(current().id) +
        '/versions/' + encodeURIComponent(versionId) + '/' + action);
    }

    /* Approvals ------------------------------------------------------- */

    function paintApprovals(host) {
      var f = current();
      var e = entry(f);

      host.innerHTML = '<div data-lb-approvals>' +
        (e.approvals ? approvalsHtml(e.approvals) : ui().loading({ count: 3 })) + '</div>';

      loadApprovals(f);
    }

    function loadApprovals(f) {
      var e = entry(f);
      var seq = e.approvalsSeq = (e.approvalsSeq || 0) + 1;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/workflows'))
        .then(function (data) {
          if (seq !== e.approvalsSeq) return;
          e.approvals = data;
          if (current().id !== f.id) return;
          if (viewerPrefs.tab === 'approvals') {
            var slot = lb.querySelector('[data-lb-approvals]');
            if (slot) slot.innerHTML = approvalsHtml(data);
          }
          // The header badge belongs to the file, not to this tab.
          f.workflowBadge = data.badge;
          var head = lb.querySelector('.tma-portal-viewer__head');
          if (head) head.outerHTML = viewerHead(f);
        })
        .catch(function (err) { panelError('[data-lb-approvals]', err, 'requests'); });
    }

    function approvalsHtml(data) {
      var list = (data && data.workflows) || [];
      var html = '';

      if (data.canSend) {
        html += '<div class="tma-portal-viewer__send-row">' +
          '<button type="button" class="tma-portal-viewer__btn" data-lb-send-wf="approval">Send for approval</button>' +
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-send-wf="feedback">Feedback</button>' +
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-send-wf="review">Review</button>' +
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-send-wf="acknowledgement">Acknowledge</button>' +
          (canSignHere(current())
            ? '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-send-signature>Send for signature</button>'
            : '') +
        '</div>';
      }

      if (data.lockReason) {
        html += '<p class="tma-portal-viewer__lock">' + esc(data.lockReason) + '</p>';
      }

      if (!list.length) {
        return html + '<p class="tma-portal-viewer__empty">This file hasn’t been sent for review.</p>';
      }

      return html + list.map(workflowHtml).join('');
    }

    function workflowHtml(w) {
      var steps = (w.steps || []).map(function (s) {
        return '<div class="tma-portal-viewer__member">' +
          '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(s)) + '" alt="" width="24" height="24">' +
          '<span class="tma-portal-viewer__member-text">' +
            '<strong>' + esc(s.name || s.email || 'Someone') + '</strong>' +
            (s.comment ? '<span class="tma-portal-viewer__member-email">“' + esc(s.comment) + '”</span>' : '') +
          '</span>' +
          '<span class="tma-portal-viewer__member-role">' + esc(s.statusLabel) +
            (s.delegatedFrom ? ' (delegated)' : '') + '</span>' +
        '</div>';
      }).join('');

      // Whatever this viewer is being asked to do about it, right now.
      var mine = '';
      if (w.myStep && w.isOpen) {
        mine = '<div class="tma-portal-viewer__respond" data-wf="' + esc(w.id) + '">' +
          '<textarea class="tma-portal-viewer__input" data-lb-wf-comment rows="2" placeholder="' +
            (w.requireComment ? 'A comment is required' : 'Add a comment (optional)') + '"></textarea>' +
          '<div class="tma-portal-viewer__composer-actions">' +
            w.myActions.map(function (a) {
              var label = { approve: 'Approve', decline: 'Decline', request_changes: 'Request changes',
                acknowledge: 'Acknowledge', submit_feedback: 'Send feedback' }[a] || a;
              var cls = a === 'approve' || a === 'acknowledge' || a === 'submit_feedback'
                ? 'tma-portal-viewer__btn' : 'tma-portal-viewer__btn-ghost';
              return '<button type="button" class="' + cls + '" data-lb-wf-act="' + esc(a) +
                '" data-wf="' + esc(w.id) + '">' + label + '</button>';
            }).join('') +
          '</div>' +
        '</div>';
      }

      var notes = [];
      if (w.version) notes.push('Reviewing version ' + w.version);
      if (w.ordered) notes.push('One at a time');
      if (!w.requireAll) notes.push('Any one response settles it');
      if (w.lockFile) notes.push('File locked');
      if (w.reminderDays) notes.push('Reminders every ' + w.reminderDays + 'd');

      return '<div class="tma-portal-viewer__workflow">' +
        '<div class="tma-portal-viewer__comment-head">' +
          statusBadgeHtml(w.status, w.statusLabel, w.tone) +
          '<strong>' + esc(cap(w.type)) + '</strong>' +
          '<time datetime="' + esc(w.sentAt) + '">' + esc(fmtDateTime(w.sentAt)) + '</time>' +
          (w.overdue ? '<span class="tma-portal-viewer__comment-flag tma-portal-viewer__comment-flag--warn">Overdue</span>' : '') +
        '</div>' +
        (w.message ? '<p class="tma-portal-viewer__version-note">' + esc(w.message) + '</p>' : '') +
        // §6: when a newer version exists, say so rather than letting the
        // badge imply the file as it stands today was approved.
        (w.supersededBy
          ? '<p class="tma-portal-viewer__lock">Version ' + w.supersededBy +
            ' has been uploaded since this was sent. This request still refers to version ' + w.version + '.</p>'
          : '') +
        (w.dueAt ? '<p class="tma-portal-viewer__version-meta">Due ' + esc(fmtDateTime(w.dueAt)) + '</p>' : '') +
        (notes.length ? '<p class="tma-portal-viewer__version-meta">' + esc(notes.join(' · ')) + '</p>' : '') +
        '<div class="tma-portal-viewer__source-members">' + steps + '</div>' +
        (w.signedFile
          ? '<p class="tma-portal-viewer__version-meta">Signed copy: ' +
            '<a href="' + esc(w.signedFile.downloadUrl) + '" download>' + esc(w.signedFile.name) + '</a>' +
            ' — the original is unchanged.</p>'
          : '') +
        mine +
        (w.canManage && w.isOpen
          ? '<div class="tma-portal-viewer__comment-actions">' +
            '<button type="button" class="tma-portal-viewer__comment-act" data-lb-wf-cancel="' + esc(w.id) + '">Cancel request</button>' +
            '</div>'
          : '') +
      '</div>';
    }

    /* Signing needs fields placed on the rendered document, which only the
     * signature editor can do. Rather than pretending otherwise, the viewer
     * creates the request and hands over to that editor. */
    function canSignHere(f) {
      return !!(window.TMAPortalSignatures
        && window.TMAPortalSignatures.isSignableName
        && window.TMAPortalSignatures.isSignableName(f.name));
    }

    function startSignature() {
      var f = current();
      if (!canSignHere(f)) { ui().toast('Only PDF and image files can be signed'); return; }

      confirmModal({
        title: 'Send for signature',
        message: 'This opens the signature editor, where you add recipients and place ' +
          'the signature fields on the document. The original file is never changed — ' +
          'the signed copy is filed alongside it.',
        confirmLabel: 'Open signature editor',
        onConfirm: function () {
          closeLightbox();
          window.TMAPortalSignatures.sendFileForSignature(f.id).catch(function () {});
        },
      });
    }

    function statusBadgeHtml(status, label, tone) {
      return '<span class="tma-portal-status tma-portal-status--' + esc(tone) + '">' + esc(label) + '</span>';
    }

    function respondToWorkflow(workflowId, action) {
      var f = current();
      var e = entry(f);
      var box = lb.querySelector('.tma-portal-viewer__respond[data-wf="' + workflowId + '"] [data-lb-wf-comment]');
      var comment = box ? box.value.trim() : '';

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/workflows/' + encodeURIComponent(workflowId) + '/respond'), {
        method: 'POST', json: { action: action, comment: comment },
      })
        .then(function (w) {
          ui().toast(w.statusLabel);
          e.approvals = null;
          loadApprovals(f);
        })
        .catch(function (err) { ui().toast((err && err.message) || 'Could not record that response'); });
    }

    function cancelWorkflow(workflowId) {
      var f = current();
      var e = entry(f);
      confirmModal({
        title: 'Cancel request',
        message: 'Cancel this request? The people asked will no longer be able to respond.',
        confirmLabel: 'Cancel request', danger: true,
        onConfirm: function () {
          net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/workflows/' + encodeURIComponent(workflowId) + '/cancel'), { method: 'POST' })
            .then(function () { e.approvals = null; loadApprovals(f); })
            .catch(function (err) { ui().toast((err && err.message) || 'Could not cancel that request'); });
        },
      });
    }

    /**
     * The send dialog. Everything §6 asks to be configurable is here, and every
     * one of these settings is re-checked server-side when responses arrive —
     * "comments required" in particular is enforced, not merely suggested.
     */
    function openSendWorkflow(type) {
      var f = current();
      var e = entry(f);
      var chosen = [];

      var labels = {
        approval: 'Send for approval', feedback: 'Send for feedback',
        review: 'Send for review', acknowledgement: 'Request acknowledgement',
      };

      var host = ui().openModal({
        title: labels[type] || 'Send for review',
        body: '<div class="tma-portal-wf-form">' +
          '<label class="tma-portal-modal__label">Who should respond?</label>' +
          '<input type="text" class="tma-portal-viewer__input tma-portal-modal__input" data-wf-search ' +
            'placeholder="Search people who can open this file">' +
          '<div class="tma-portal-viewer__mention-pop" data-wf-results hidden></div>' +
          '<div class="tma-portal-wf-chosen" data-wf-chosen></div>' +

          '<label class="tma-portal-modal__label" for="wf-msg">Message (optional)</label>' +
          '<textarea id="wf-msg" class="tma-portal-viewer__input" rows="2" data-wf-message ' +
            'placeholder="Anything they should know"></textarea>' +

          '<label class="tma-portal-modal__label" for="wf-due">Due date (optional)</label>' +
          '<input type="date" id="wf-due" class="tma-portal-viewer__input tma-portal-modal__input" data-wf-due>' +

          '<label class="tma-portal-modal__label" for="wf-rem">Remind every (days, optional)</label>' +
          '<input type="number" id="wf-rem" min="1" max="60" class="tma-portal-viewer__input tma-portal-modal__input" data-wf-remind>' +

          '<label class="tma-portal-wf-check"><input type="checkbox" data-wf-all checked> Everyone must respond</label>' +
          '<label class="tma-portal-wf-check"><input type="checkbox" data-wf-ordered> Ask one person at a time, in order</label>' +
          '<label class="tma-portal-wf-check"><input type="checkbox" data-wf-comment> A comment is required</label>' +
          '<label class="tma-portal-wf-check"><input type="checkbox" data-wf-lock> Lock the file while this is open</label>' +

          '<div class="tma-portal-modal__foot">' +
            '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-wf-cancel>Cancel</button>' +
            '<button type="button" class="tma-no-data__btn" data-wf-send>Send</button>' +
          '</div>' +
        '</div>',
        onMount: function (host) {
          var search = host.querySelector('[data-wf-search]');
          var results = host.querySelector('[data-wf-results]');
          var chosenBox = host.querySelector('[data-wf-chosen]');

          function paintChosen() {
            chosenBox.innerHTML = chosen.map(function (p, i) {
              return '<span class="tma-portal-wf-chip">' +
                (chosen.length > 1 ? '<b>' + (i + 1) + '.</b> ' : '') + esc(p.name) +
                '<button type="button" data-wf-remove="' + p.id + '" aria-label="Remove">×</button></span>';
            }).join('');
          }

          search.addEventListener('input', function () {
            var q = search.value.trim();
            // Reuses the mention endpoint: the same "people who can open this
            // file" rule, so a request can never be sent to someone who would
            // be unable to act on it.
            net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/mentionable?q=' + encodeURIComponent(q)))
              .then(function (data) {
                var people = (data && data.people) || [];
                if (!people.length) { results.hidden = true; return; }
                results.innerHTML = people.map(function (p) {
                  return '<button type="button" class="tma-portal-viewer__mention-item" data-wf-pick="' + p.id +
                    '" data-name="' + esc(p.name) + '">' +
                    '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(p)) + '" alt="" width="22" height="22">' +
                    '<span><strong>' + esc(p.name) + '</strong>' +
                    '<span class="tma-portal-viewer__member-email">' + esc(p.email) + '</span></span></button>';
                }).join('');
                results.hidden = false;
              })
              .catch(function () { results.hidden = true; });
          });

          host.addEventListener('click', function (ev) {
            var pick = ev.target.closest('[data-wf-pick]');
            if (pick) {
              var id = parseInt(pick.getAttribute('data-wf-pick'), 10);
              if (!chosen.some(function (c) { return c.id === id; })) {
                chosen.push({ id: id, name: pick.getAttribute('data-name') });
                paintChosen();
              }
              results.hidden = true;
              search.value = '';
              return;
            }
            var rm = ev.target.closest('[data-wf-remove]');
            if (rm) {
              var rid = parseInt(rm.getAttribute('data-wf-remove'), 10);
              chosen = chosen.filter(function (c) { return c.id !== rid; });
              paintChosen();
              return;
            }
            if (ev.target.closest('[data-wf-cancel]')) { ui().closeModal(); return; }
            if (ev.target.closest('[data-wf-send]')) {
              if (!chosen.length) { ui().toast('Choose at least one person'); return; }
              var due = host.querySelector('[data-wf-due]').value;
              var remind = parseInt(host.querySelector('[data-wf-remind]').value, 10);

              net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/workflows'), {
                method: 'POST',
                json: {
                  type: type,
                  // Position is the order they were picked in, which is what
                  // the chips show — so an ordered flow matches the list.
                  recipients: chosen.map(function (c, i) { return { userId: c.id, position: i + 1 }; }),
                  message: host.querySelector('[data-wf-message]').value.trim() || null,
                  dueAt: due || null,
                  requireAll: host.querySelector('[data-wf-all]').checked,
                  ordered: host.querySelector('[data-wf-ordered]').checked,
                  requireComment: host.querySelector('[data-wf-comment]').checked,
                  lockFile: host.querySelector('[data-wf-lock]').checked,
                  reminderDays: remind > 0 ? remind : null,
                },
              })
                .then(function () {
                  ui().closeModal();
                  ui().toast('Request sent');
                  e.approvals = null;
                  viewerPrefs.tab = 'approvals';
                  paintPanel();
                })
                .catch(function (err) { ui().toast((err && err.message) || 'Could not send that request'); });
            }
          });
        },
      });

      if (lb && host) host.style.zIndex = '700';
    }

    /* Activity ------------------------------------------------------- */

    function paintActivity(host) {
      var f = current();
      var e = entry(f);
      var stale = e.activity && e.activity.filter === viewerPrefs.filter ? e.activity : null;

      host.innerHTML =
        '<div class="tma-portal-viewer__filter">' +
          '<label class="tma-portal-viewer__filter-label" for="lb-activity-filter">View:</label>' +
          '<select class="tma-portal-viewer__filter-select" id="lb-activity-filter" data-lb-filter>' +
            activityFilterOptions(e.activity) +
          '</select>' +
        '</div>' +
        '<div data-lb-activity>' + (stale ? activityHtml(stale) : ui().loading({ count: 4 })) + '</div>';

      // Always refetch. Downloading, sharing or favouriting from this very
      // toolbar appends rows, so a cached page is wrong the moment the reader
      // does anything. The cached rows stay on screen while it reloads, so
      // there is no flicker and no scroll jump.
      loadActivity(f, false);
    }

    function activityFilterOptions(loaded) {
      var opts = (loaded && loaded.filters) || [
        { value: 'all', label: 'All activity' },
      ];
      return opts.map(function (o) {
        return '<option value="' + esc(o.value) + '"' +
          (o.value === viewerPrefs.filter ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('');
    }

    function loadActivity(f, append) {
      var e = entry(f);
      var q = '?filter=' + encodeURIComponent(viewerPrefs.filter);
      if (append && e.activity && e.activity.nextCursor) q += '&before=' + e.activity.nextCursor;
      var seq = e.activitySeq = (e.activitySeq || 0) + 1;

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/activity' + q))
        .then(function (data) {
          if (seq !== e.activitySeq) return;
          if (append && e.activity) {
            data.entries = e.activity.entries.concat(data.entries);
          }
          e.activity = data;
          if (current().id !== f.id || viewerPrefs.tab !== 'activity') return;
          var slot = lb.querySelector('[data-lb-activity]');
          if (slot) slot.innerHTML = activityHtml(data);
          // The server owns the filter list. On first paint we only had the
          // fallback single option, so repopulate once it arrives — guarding
          // on "no options" left the dropdown stuck at just "All activity".
          var sel = lb.querySelector('[data-lb-filter]');
          if (sel && data.filters && sel.options.length !== data.filters.length) {
            sel.innerHTML = activityFilterOptions(data);
          }
        })
        .catch(function (err) { panelError('[data-lb-activity]', err, 'activity'); });
    }

    function activityHtml(data) {
      var entries = (data && data.entries) || [];
      if (!entries.length) {
        return '<p class="tma-portal-viewer__empty">' +
          (viewerPrefs.filter === 'all'
            ? 'No activity recorded for this file yet.'
            : 'No activity of this kind yet.') + '</p>';
      }

      var html = '';
      var band = null;
      entries.forEach(function (a) {
        if (a.group !== band) {
          band = a.group;
          html += '<h5 class="tma-portal-viewer__band">' + esc(band) + '</h5>';
        }
        html += activityRow(a);
      });

      if (data.nextCursor) {
        html += '<button type="button" class="tma-portal-viewer__more-btn" data-lb-more-activity>Show older activity</button>';
      }
      return html;
    }

    function activityRow(a) {
      // The sentence says "You"; the face stays the person's own, so their
      // initials don't collapse to a "Y".
      var who = a.actor ? (a.actor.isSelf ? 'You' : a.actor.name) : 'Someone';
      var face = a.actor
        ? '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(a.actor)) + '" alt="" width="28" height="28">'
        : '<span class="tma-portal-viewer__avatar tma-portal-viewer__avatar--icon">' +
            '<img src="images/icons/phosphor/' + esc(a.icon || 'ClockCounterClockwise') + '.svg" alt="" width="14" height="14"></span>';

      return '<div class="tma-portal-viewer__event">' +
        face +
        '<div class="tma-portal-viewer__event-body">' +
          '<p class="tma-portal-viewer__event-text"><strong>' + esc(who) + '</strong> ' + esc(a.text) + '</p>' +
          '<time class="tma-portal-viewer__event-time" datetime="' + esc(a.at) + '">' + esc(fmtDateTime(a.at)) + '</time>' +
        '</div>' +
      '</div>';
    }

    /* Access --------------------------------------------------------- */

    function paintAccess(host) {
      var f = current();
      var e = entry(f);

      host.innerHTML = '<div data-lb-access>' +
        (e.access ? accessHtml(e.access, e) : ui().loading({ count: 3 })) + '</div>';

      if (e.access) return;
      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/access'))
        .then(function (data) {
          e.access = data;
          if (current().id !== f.id || viewerPrefs.tab !== 'access') return;
          var slot = lb.querySelector('[data-lb-access]');
          if (slot) slot.innerHTML = accessHtml(data, e);
        })
        .catch(function (err) { panelError('[data-lb-access]', err, 'access'); });
    }

    /**
     * Access is shown as the *reasons* people can reach the file, each
     * expandable. Listing every member of staff individually would be hundreds
     * of rows that go stale on the next hire.
     */
    function accessHtml(data, e) {
      var sources = (data && data.sources) || [];
      if (!sources.length) return '<p class="tma-portal-viewer__empty">Only you can see this file.</p>';

      // Lead with the faces: "who can see this?" answered in one glance, with
      // the grouped sources below answering "and why?".
      var html = sharedStackHtml(data.shared);

      html += sources.map(function (s) {
        var open = !!e.expanded[s.key];
        var faces = (s.members || []).slice(0, 5).map(function (m) {
          return '<img class="tma-portal-viewer__avatar tma-portal-viewer__avatar--stack" src="' + esc(avatarFor(m)) +
            '" alt="" width="24" height="24" title="' + esc(personTitle(m)) + '">';
        }).join('');
        var overflow = s.total > 5
          ? '<span class="tma-portal-viewer__avatar-more">+' + (s.total - 5) + '</span>'
          : '';

        return '<div class="tma-portal-viewer__source">' +
          '<button type="button" class="tma-portal-viewer__source-head" data-lb-expand="' + esc(s.key) + '"' +
            ' aria-expanded="' + open + '">' +
            '<img class="tma-portal-viewer__source-icon" src="images/icons/phosphor/' + esc(s.icon) + '.svg" alt="" width="18" height="18">' +
            '<span class="tma-portal-viewer__source-text">' +
              '<strong>' + esc(s.label) + '</strong>' +
              '<span class="tma-portal-viewer__source-detail">' + esc(s.detail) +
                (s.role ? ' &middot; ' + esc(s.role) : '') + '</span>' +
            '</span>' +
            '<span class="tma-portal-viewer__faces">' + faces + overflow + '</span>' +
          '</button>' +
          (open ? '<div class="tma-portal-viewer__source-members">' +
            (s.members || []).map(memberRow).join('') +
            (s.truncated ? '<p class="tma-portal-viewer__empty">Showing the first ' + (s.members || []).length +
              ' of ' + s.total + '.</p>' : '') +
          '</div>' : '') +
          (s.origin ? '<p class="tma-portal-viewer__source-origin">' + esc(s.origin) + '</p>' : '') +
        '</div>';
      }).join('');

      return html;
    }

    /**
     * The shared-with face stack: up to five real profile pictures, then a
     * "+N" circle. Clicking anywhere on it opens the full list.
     */
    function sharedStackHtml(shared) {
      if (!shared || !shared.total) return '';

      var faces = (shared.faces || []).map(function (p) {
        return '<img class="tma-portal-viewer__avatar tma-portal-viewer__avatar--stack" ' +
          'src="' + esc(avatarFor(p)) + '" alt="" width="30" height="30" ' +
          'title="' + esc([p.name, p.email, p.role, p.via].filter(Boolean).join(' · ')) + '">';
      }).join('');

      var extra = shared.extra > 0
        ? '<span class="tma-portal-viewer__avatar-more tma-portal-viewer__avatar-more--lg">+' + shared.extra + '</span>'
        : '';

      return '<div class="tma-portal-viewer__shared">' +
        '<button type="button" class="tma-portal-viewer__shared-stack" data-lb-shared-open ' +
          'aria-label="Shared with ' + shared.total + ' people">' + faces + extra + '</button>' +
        '<div class="tma-portal-viewer__shared-text">' +
          '<strong>Shared with</strong>' +
          '<span class="tma-portal-viewer__source-detail">' + esc(shared.summary) + '</span>' +
        '</div>' +
      '</div>';
    }

    function openSharedList() {
      var e = entry(current());
      var shared = e.access && e.access.shared;
      var people = (shared && shared.all) || [];

      if (!people.length) { ui().toast('Nobody else has access yet'); return; }

      // When access comes from a rule rather than a list — everyone on staff,
      // the client team — say so, and be honest that the faces are a sample
      // rather than pretending the list is complete.
      var note = shared.total > people.length
        ? '<p class="tma-portal-viewer__empty">' + esc(shared.summary) + ' — showing ' +
          people.length + ' of ' + shared.total + '.</p>'
        : '<p class="tma-portal-viewer__empty">' + esc(shared.summary) + '</p>';

      var host = ui().openModal({
        title: 'Shared with',
        body: note + '<div class="tma-portal-viewer__source-members">' +
          people.map(function (p) {
            return '<div class="tma-portal-viewer__member">' +
              '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(p)) + '" alt="" width="28" height="28">' +
              '<span class="tma-portal-viewer__member-text">' +
                '<strong>' + esc(p.name || p.email) + '</strong>' +
                '<span class="tma-portal-viewer__member-email">' + esc(p.email || '') + '</span>' +
              '</span>' +
              '<span class="tma-portal-viewer__member-role">' + esc(p.role || p.via || '') + '</span>' +
            '</div>';
          }).join('') + '</div>',
      });
      if (lb && host) host.style.zIndex = '700';
    }

    function memberRow(m) {
      return '<div class="tma-portal-viewer__member" title="' + esc(personTitle(m)) + '">' +
        '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(m)) + '" alt="" width="24" height="24">' +
        '<span class="tma-portal-viewer__member-text">' +
          '<strong>' + esc(m.name || m.email || 'Someone') + '</strong>' +
          (m.email ? '<span class="tma-portal-viewer__member-email">' + esc(m.email) + '</span>' : '') +
        '</span>' +
        (m.role ? '<span class="tma-portal-viewer__member-role">' + esc(m.role) + '</span>' : '') +
      '</div>';
    }

    // Hover reveals name, email, role and permission — §19.
    function personTitle(m) {
      return [m.name, m.email, m.jobTitle || m.accountType, m.role]
        .filter(Boolean).join(' · ');
    }

    function panelError(selector, err, what) {
      var slot = lb && lb.querySelector(selector);
      if (!slot) return;
      slot.innerHTML = '<p class="tma-portal-viewer__empty">' +
        esc((err && err.message) || ('Could not load ' + what + '.')) + '</p>';
    }

    /* ── moving between files ────────────────────────── */

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= gallery.length) return;
      showAt(next);
    }

    function showAt(next) {
      idx = next;
      var f = current();

      // Flipping through the rail is navigation too — reloading on the third
      // file should reopen the third file, not the one first clicked.
      state.openFile = f.id;
      syncUrl();

      // Only the regions that depend on the file change; the panel keeps its
      // tab and the reader keeps their place in the shell.
      var head = lb.querySelector('.tma-portal-viewer__head');
      if (head) head.outerHTML = viewerHead(f);
      repaintStage(f);
      startPresence(f);
      var foot = lb.querySelector('[data-lb-foot]');
      if (foot) foot.innerHTML = footHtml(f);
      var rail = lb.querySelector('[data-lb-rail]');
      if (rail) rail.innerHTML = railHtml();

      paintPanel();
      subscribeToFile(f);
      // Stepping to the next file needs its counts, not the last file's.
      loadTabCounts(f);
      if (f.previewable && f.category === 'text' && f.previewUrl) loadText(f);
    }

    /* Repainting the stage is never just innerHTML: a text preview renders a
     * placeholder that only loadText() fills in, so replacing the markup
     * without re-running it leaves a permanent "Loading…". */
    function repaintStage(f) {
      var stage = lb.querySelector('[data-lb-stage]');
      if (!stage) return;
      stage.innerHTML = lightboxBody(f);
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

    /* ── interaction ─────────────────────────────────── */

    lb.addEventListener('click', function (e) {
      var f = current();

      var goBtn = e.target.closest('[data-lb-go]');
      if (goBtn) { showAt(parseInt(goBtn.getAttribute('data-lb-go'), 10) || 0); return; }

      var tab = e.target.closest('[data-lb-tab]');
      if (tab) { viewerPrefs.tab = tab.getAttribute('data-lb-tab'); paintPanel(); return; }

      var expand = e.target.closest('[data-lb-expand]');
      if (expand) {
        var key = expand.getAttribute('data-lb-expand');
        var en = entry(f);
        en.expanded[key] = !en.expanded[key];
        var slot = lb.querySelector('[data-lb-access]');
        if (slot && en.access) slot.innerHTML = accessHtml(en.access, en);
        return;
      }

      if (e.target.closest('[data-lb-more-activity]')) { loadActivity(f, true); return; }
      if (e.target.closest('[data-lb-more-comments]')) { loadComments(f, true); return; }

      /* ── approvals ────────────────────────────────── */
      if (e.target.closest('[data-lb-send-signature]')) { startSignature(); return; }
      var wfSend = e.target.closest('[data-lb-send-wf]');
      if (wfSend) { openSendWorkflow(wfSend.getAttribute('data-lb-send-wf')); return; }
      var wfAct = e.target.closest('[data-lb-wf-act]');
      if (wfAct) { respondToWorkflow(wfAct.getAttribute('data-wf'), wfAct.getAttribute('data-lb-wf-act')); return; }
      var wfCancel = e.target.closest('[data-lb-wf-cancel]');
      if (wfCancel) { cancelWorkflow(wfCancel.getAttribute('data-lb-wf-cancel')); return; }

      /* ── versions ─────────────────────────────────── */
      if (e.target.closest('[data-lb-newversion]')) { pickNewVersion(); return; }
      var vPrev = e.target.closest('[data-lb-vpreview]');
      if (vPrev) { window.open(versionUrl(vPrev.getAttribute('data-lb-vpreview'), 'preview'), '_blank'); return; }
      var vDown = e.target.closest('[data-lb-vdownload]');
      if (vDown) { window.location.href = versionUrl(vDown.getAttribute('data-lb-vdownload'), 'download'); return; }
      var vRest = e.target.closest('[data-lb-vrestore]');
      if (vRest) { restoreVersion(vRest.getAttribute('data-lb-vrestore'), vRest.getAttribute('data-num')); return; }

      /* ── comments ─────────────────────────────────── */
      var en = entry(f);
      var mention = e.target.closest('[data-lb-mention]');
      if (mention) {
        insertMention(mention.getAttribute('data-lb-mention'), mention.getAttribute('data-name'));
        return;
      }
      if (e.target.closest('[data-lb-send]')) { sendComment(); return; }
      if (e.target.closest('[data-lb-clear]')) {
        var box = lb.querySelector('[data-lb-input]');
        if (box) box.value = '';
        en.draft = '';
        en.pendingMentions = [];
        var pop = lb.querySelector('[data-lb-mentions]');
        if (pop) pop.hidden = true;
        return;
      }
      if (e.target.closest('[data-lb-emoji]')) { openEmojiPicker(); return; }

      var replyOpen = e.target.closest('[data-lb-replyopen]');
      if (replyOpen) {
        en.replyingTo = replyOpen.getAttribute('data-lb-replyopen');
        repaintComments(en);
        return;
      }
      if (e.target.closest('[data-lb-replycancel]')) { en.replyingTo = null; repaintComments(en); return; }
      var replySend = e.target.closest('[data-lb-replysend]');
      if (replySend) { sendReply(replySend.getAttribute('data-lb-replysend')); return; }

      var editBtn = e.target.closest('[data-lb-edit]');
      if (editBtn) { en.editing = editBtn.getAttribute('data-lb-edit'); repaintComments(en); return; }
      if (e.target.closest('[data-lb-editcancel]')) { en.editing = null; repaintComments(en); return; }
      var editSave = e.target.closest('[data-lb-editsave]');
      if (editSave) { saveEdit(editSave.getAttribute('data-lb-editsave')); return; }

      var delBtn = e.target.closest('[data-lb-del]');
      if (delBtn) { deleteComment(delBtn.getAttribute('data-lb-del')); return; }

      var resolveBtn = e.target.closest('[data-lb-resolve]');
      if (resolveBtn) {
        toggleResolve(resolveBtn.getAttribute('data-lb-resolve'),
          resolveBtn.getAttribute('data-resolved') === 'true');
        return;
      }

      if (e.target.closest('[data-lb-shared-open]')) { openSharedList(); return; }
      if (e.target.closest('[data-lb-presence-open]')) { openPresenceList(); return; }
      if (e.target.closest('[data-lb-close]')) { closeLightbox(); return; }

      var act = e.target.closest('[data-lb-act]');
      if (!act) return;
      switch (act.getAttribute('data-lb-act')) {
        case 'close': return closeLightbox();
        case 'download': return downloadItem(f);
        case 'print': return printFile(f);
        case 'share': return openShareModal(f);
        case 'delete': return deleteFromViewer(f);
        case 'favorite': return favoriteFromViewer(f);
        case 'panel':
          viewerPrefs.panel = !viewerPrefs.panel;
          var panel = lb.querySelector('[data-lb-panel]');
          if (panel) panel.hidden = !viewerPrefs.panel;
          var head2 = lb.querySelector('.tma-portal-viewer__head');
          if (head2) head2.outerHTML = viewerHead(current());
          if (viewerPrefs.panel) paintPanel();
          return;
        case 'approvals':
          viewerPrefs.tab = 'approvals';
          viewerPrefs.panel = true;
          var apanel = lb.querySelector('[data-lb-panel]');
          if (apanel) apanel.hidden = false;
          var ahead = lb.querySelector('.tma-portal-viewer__head');
          if (ahead) ahead.outerHTML = viewerHead(current());
          paintPanel();
          return;
        case 'versions':
          viewerPrefs.tab = 'versions';
          viewerPrefs.panel = true;
          var vpanel = lb.querySelector('[data-lb-panel]');
          if (vpanel) vpanel.hidden = false;
          var vhead = lb.querySelector('.tma-portal-viewer__head');
          if (vhead) vhead.outerHTML = viewerHead(current());
          paintPanel();
          return;
        case 'comments':
          viewerPrefs.tab = 'comments';
          viewerPrefs.panel = true;
          var cpanel = lb.querySelector('[data-lb-panel]');
          if (cpanel) cpanel.hidden = false;
          var chead = lb.querySelector('.tma-portal-viewer__head');
          if (chead) chead.outerHTML = viewerHead(current());
          paintPanel();
          return;
        case 'more': return openViewerMenu(act, f);
      }
    });

    lb.addEventListener('input', function (e) {
      if (e.target.closest('[data-lb-input]')) onComposerInput(e.target);
    });

    // Enter sends, Shift+Enter makes a new line — §16.
    lb.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (e.target.closest('[data-lb-input]')) { e.preventDefault(); sendComment(); }
      else if (e.target.closest('[data-lb-replyinput]')) {
        var box = e.target.closest('.tma-portal-viewer__thread');
        if (box) { e.preventDefault(); sendReply(box.getAttribute('data-thread')); }
      }
    });

    lb.addEventListener('change', function (e) {
      var vfile = e.target.closest('[data-lb-versionfile]');
      if (vfile) {
        if (vfile.files && vfile.files[0]) uploadNewVersion(vfile.files[0]);
        vfile.value = '';
        return;
      }
      if (!e.target.closest('[data-lb-filter]')) return;
      viewerPrefs.filter = e.target.value;
      var en = entry(current());
      en.activity = null;
      var slot = lb.querySelector('[data-lb-activity]');
      if (slot) slot.innerHTML = ui().loading({ count: 4 });
      loadActivity(current(), false);
    });

    lb._key = function (e) {
      // Anything opened on top of the viewer owns the keyboard. Without the
      // context-menu case, Escape dismissed the menu AND closed the viewer
      // behind it in the same keypress.
      if (document.querySelector('.tma-portal-modal')) return;
      if (document.querySelector('.tma-portal-context-menu')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', lb._key);

    /* ── toolbar actions that need the viewer's own state ── */

    // Reuses the list's own star handler, so the optimistic flip, the busy
    // guard and the favourites-view removal all behave identically here.
    //
    // toggleStar() already flips `favorite` on the very object the viewer is
    // holding — they are the same reference. Flipping it again here turned the
    // button straight back to its old state.
    function favoriteFromViewer(f) {
      toggleStar(f.id);
      var head = lb.querySelector('.tma-portal-viewer__head');
      if (head) head.outerHTML = viewerHead(f);
    }

    // Reuses the list's delete flow — same confirmation wording, same recycle
    // semantics — then closes, since the file is no longer where we are.
    function deleteFromViewer(f) {
      if (!perm(f, 'delete')) { ui().toast('You can’t delete this file'); return; }
      closeLightbox();
      deleteItem(f);
    }

    /**
     * The three-dot menu is the SAME menu the file list uses, so the actions,
     * icons, ordering and styling can never drift apart — it just adds the
     * entries that only make sense inside the viewer.
     */
    function openViewerMenu(anchor, f) {
      var list = contextItems(f).filter(function (it) {
        // "Preview" is meaningless here: the file is already open.
        return it.label !== 'Preview';
      });
      list.push({ sep: true });
      list.push({
        label: 'View activity', icon: 'ClockCounterClockwise',
        fn: function () {
          viewerPrefs.tab = 'activity';
          viewerPrefs.panel = true;
          var panel = lb.querySelector('[data-lb-panel]');
          if (panel) panel.hidden = false;
          var head = lb.querySelector('.tma-portal-viewer__head');
          if (head) head.outerHTML = viewerHead(current());
          paintPanel();
        },
      });

      var box = anchor.getBoundingClientRect();
      openContextMenu(box.right, box.bottom + 4, f, list);
    }

    paintShell();
  }

  /* Printing goes through the same authorized preview stream the viewer uses;
   * there is no separate print URL, so an unprintable type simply opens. */
  function printFile(f) {
    if (!f.previewUrl) { ui().toast('This file type can’t be printed from the portal'); return; }
    var w = window.open(f.previewUrl, '_blank');
    if (!w) { ui().toast('Allow pop-ups to print this file'); return; }
    w.addEventListener('load', function () { try { w.print(); } catch (e) { /* user can print manually */ } });
  }

  function avatarFor(person) {
    var name = (person && person.name) || (person && person.email) || '?';
    var avatar = person && person.avatar;
    return (window.TMACurrentUser && window.TMACurrentUser.avatarSrc)
      ? window.TMACurrentUser.avatarSrc(avatar, name)
      : (avatar || '');
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function lightboxBody(f) {
    // SVG has a previewUrl (the hardened thumb) but isn't flagged previewable,
    // so key off previewUrl presence rather than the previewable flag.
    if (f.previewUrl && perm(f, 'preview')) {
      switch (f.category) {
        case 'image':
          return '<img class="tma-portal-viewer__img" src="' + esc(f.previewUrl) + '" alt="' + esc(f.name) + '">';
        case 'pdf':
          return '<iframe class="tma-portal-viewer__frame-doc" src="' + esc(f.previewUrl) + '" title="' + esc(f.name) + '"></iframe>';
        case 'video':
          return '<video class="tma-portal-viewer__media" src="' + esc(f.previewUrl) + '" controls autoplay playsinline></video>';
        case 'audio':
          return '<div class="tma-portal-viewer__audio"><img src="' + esc(fileIconSrc(f)) + '" alt="" width="64" height="64">' +
            '<audio src="' + esc(f.previewUrl) + '" controls autoplay></audio></div>';
        case 'text':
          return '<pre class="tma-portal-viewer__text" data-lb-text>Loading…</pre>';
      }
    }
    // Office docs, archives, and anything we can't render safely.
    return '<div class="tma-portal-viewer__nopreview">' +
      '<img src="' + esc(fileIconSrc(f)) + '" alt="" width="72" height="72">' +
      '<p class="tma-portal-viewer__nopreview-title">' + esc(f.name) + '</p>' +
      '<p class="tma-portal-viewer__nopreview-text">No in-browser preview for this file type.</p>' +
      (perm(f, 'download') ? '<button type="button" class="tma-no-data__btn" data-lb-act="download"><img class="tma-no-data__btn-icon" src="images/icons/phosphor/ArrowLineDown.svg" alt="" width="16" height="16"><span>Download</span></button>' : '') +
      '</div>';
  }

  /** @param {boolean} [silent] Skip the URL update — see openLightbox. */
  function closeLightbox(silent) {
    if (!lb) return;
    if (!silent) {
      state.openFile = null;
      syncUrl();
    }
    if (lb._key) document.removeEventListener('keydown', lb._key);
    if (lb._leave) lb._leave();
    // Leave the file's channel, or every file opened this session keeps a
    // subscription alive for the rest of the page's life.
    if (lb._channel && window.TMAMessagingRealtime) {
      window.TMAMessagingRealtime.leave(lb._channel);
    }
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

  function showModalError(host, message) {
    var body = host.querySelector('.tma-portal-modal__body');
    var old = host.querySelector('.tma-portal-modal__error');
    if (old) old.remove();
    var div = document.createElement('div');
    div.className = 'tma-portal-modal__error';
    div.textContent = message || 'Something needs attention.';
    body.insertBefore(div, body.firstChild);
  }

  /**
   * `opts.prompt` adds a single free-text field and passes its value to
   * onConfirm — used for version notes, where §5 asks that the reason a
   * version exists is recorded at the moment it is created.
   */
  function confirmModal(opts) {
    var host = ui().openModal({
      title: opts.title,
      body: '<p class="tma-portal-modal__text">' + esc(opts.message) + '</p>' +
        (opts.prompt
          ? '<label class="tma-portal-modal__label" for="tma-confirm-note">' + esc(opts.prompt.label) + '</label>' +
            '<input type="text" id="tma-confirm-note" class="tma-portal-viewer__input tma-portal-modal__input" ' +
            'data-confirm-note placeholder="' + esc(opts.prompt.placeholder || '') + '" maxlength="2000">'
          : '') +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-confirm-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn' + (opts.danger ? ' tma-portal-btn--danger' : '') + '" data-confirm-ok>' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
        '</div>',
      onMount: function (host) {
        var note = host.querySelector('[data-confirm-note]');
        if (note) note.focus();
        host.querySelector('[data-confirm-cancel]').addEventListener('click', ui().closeModal);
        host.querySelector('[data-confirm-ok]').addEventListener('click', function () {
          var value = note ? note.value.trim() : undefined;
          ui().closeModal();
          opts.onConfirm(value);
        });
      },
    });
    // Opened from inside the viewer (z-index 600) it must sit in front of it,
    // the same lift the details modal and context menu already take.
    if (lb && host) host.style.zIndex = '700';
  }

  function toggleStar(id) {
    if (isBusy(id)) return;
    var it = findItem(id);
    if (!it) return;
    var prev = !!it.favorite;
    setBusy(id, true);
    // Optimistic: flip to yellow (or off) immediately, reconcile with server.
    it.favorite = !prev;
    rerender();
    net().fetchJSON(net().url('/favorites/toggle'), { method: 'POST', json: { type: it.type, id: it.id } })
      .then(function (res) {
        setBusy(id, false);
        // Already known locally that it must leave a favorites-only view -
        // no need to hit the network again to find that out.
        if (state.section === 'favorites' && !res.favorite) removeItem(id);
        else it.favorite = res.favorite;
        rerender();
      })
      .catch(function (err) {
        setBusy(id, false);
        it.favorite = prev;
        rerender();
        ui().toast(err.message || 'Could not update favourite');
      });
  }

  function deleteItem(item) {
    if (isBusy(item.id)) return;
    confirmModal({
      title: 'Move to recycle bin',
      message: 'Move “' + item.name + '” to the recycle bin?' + (item.type === 'folder' ? ' Its contents go with it and can be restored.' : ''),
      confirmLabel: 'Move to bin', danger: true,
      onConfirm: function () {
        setBusy(item.id, true);
        rerender();
        var url = item.type === 'folder' ? '/folders/' + item.id : '/files/' + item.id;
        net().fetchJSON(net().url(url), { method: 'DELETE' })
          .then(function () {
            setBusy(item.id, false);
            removeItem(item.id);
            ui().toast('Moved to recycle bin');
            foldersChanged();
            rerender();
          })
          .catch(function (err) { setBusy(item.id, false); ui().toast(err.message || 'Could not delete'); rerender(); });
      },
    });
  }

  function restoreItem(item) {
    if (isBusy(item.id)) return;
    setBusy(item.id, true);
    rerender();
    var url = (item.type === 'folder' ? '/folders/' : '/files/') + item.id + '/restore';
    net().fetchJSON(net().url(url), { method: 'POST' })
      .then(function () {
        setBusy(item.id, false);
        removeItem(item.id);
        ui().toast('Restored');
        foldersChanged();
        rerender();
      })
      .catch(function (err) { setBusy(item.id, false); ui().toast(err.message || 'Could not restore'); rerender(); });
  }

  function forceDeleteItem(item) {
    if (isBusy(item.id)) return;
    confirmModal({
      title: 'Delete permanently',
      message: 'Permanently delete “' + item.name + '”? This cannot be undone.',
      confirmLabel: 'Delete forever', danger: true,
      onConfirm: function () {
        setBusy(item.id, true);
        rerender();
        var url = (item.type === 'folder' ? '/folders/' : '/files/') + item.id + '/force';
        net().fetchJSON(net().url(url), { method: 'DELETE' })
          .then(function () {
            setBusy(item.id, false);
            removeItem(item.id);
            ui().toast('Permanently deleted');
            foldersChanged();
            rerender();
          })
          .catch(function (err) { setBusy(item.id, false); ui().toast(err.message || 'Could not delete'); rerender(); });
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
          .then(function (r) { state.data = { folders: [], files: [] }; state.selected = {}; ui().toast('Recycle bin emptied'); rerender(); })
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
    var wasCut = state.clipboard.mode === 'cut';
    bulkRun(action, state.clipboard.items, state.folder, function () {
      if (wasCut) state.clipboard = null;
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
    function colourRow(item) {
      var colours = window.TMAFolderColours;
      if (!colours) return '';
      var key = colours.isValid(item.colour) ? item.colour : 'default';
      var swatch = colours.PALETTE.filter(function (c) { return c.key === key; })[0];
      return '<div class="tma-portal-details__row"><span class="tma-portal-details__label">Colour</span>' +
        '<span class="tma-portal-details__value tma-portal-details__value--colour">' +
        '<span class="tma-portal-colour-dot" style="background:' + esc(swatch ? swatch.hex : '#fec656') + '"></span>' +
        esc(colours.label(key)) + '</span></div>';
    }
    function iconRow(item) {
      if (!item.iconName) return '';
      return '<div class="tma-portal-details__row"><span class="tma-portal-details__label">Icon</span>' +
        '<span class="tma-portal-details__value tma-portal-details__value--colour">' +
        '<span style="margin-right:var(--space-6, 6px)">' + folderIconHtml(item, 18) + '</span>' + esc(item.iconName) + '</span></div>';
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
      rows += colourRow(d);
      rows += iconRow(d);
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

    var canRecolour = d.type === 'folder' && perm(d, 'colour');
    var canReicon = d.type === 'folder' && perm(d, 'icon');
    var headIcon = d.type === 'folder' ? folderIconHtml(d, 32) : '<img src="' + esc(fileIconSrc(d)) + '" alt="" width="32" height="32" style="border-radius:0">';
    var host = ui().openModal({
      title: 'Details',
      body: '<div class="tma-portal-details">' +
        '<div class="tma-portal-details__head">' + headIcon + '<strong>' + esc(d.name) + '</strong></div>' +
        rows +
        (d.type === 'file' && perm(d, 'download') ? '<div class="tma-portal-modal__foot"><a class="tma-no-data__btn" href="' + esc(d.downloadUrl) + '" download>Download</a></div>' : '') +
        (canRecolour || canReicon ? '<div class="tma-portal-modal__foot"><button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-details-appearance>Change appearance</button></div>' : '') +
        '</div>',
      onMount: function (host) {
        if (!canRecolour && !canReicon) return;
        host.querySelector('[data-details-appearance]').addEventListener('click', function () {
          ui().closeModal();
          openAppearanceModal(d);
        });
      },
    });
    // When opened from the lightbox, the details modal must sit IN FRONT of it
    // (the lightbox is z-index 600; the modal is normally 240).
    if (lb && host) host.style.zIndex = '700';
  }

  /* ── sharing ────────────────────────────────────────── */

  var ROLE_LABELS = { viewer: 'Can view', downloader: 'Can download', editor: 'Can edit', full: 'Full access' };

  // Avatar for a person (user or client): their real photo, else initials.
  // Reuses the shared resolver so it matches the rest of the portal.
  /* The Owner column: the person's picture beside their name.
   *
   * A column of identical names is hard to scan; a face is recognised before
   * it is read. Falls back to initials through TMACurrentUser.avatarSrc, the
   * same helper the rest of the portal uses — never an invented avatar. */
  function ownerCell(person) {
    if (!person) return '\u2014';

    var name = person.name || person.email || '\u2014';
    var src = (window.TMACurrentUser && window.TMACurrentUser.avatarSrc)
      ? window.TMACurrentUser.avatarSrc(person.avatar, name)
      : (person.avatar || '');

    return '<span class="tma-portal-owner-cell">' +
      (src ? '<img class="tma-portal-owner-avatar" src="' + esc(src) + '" alt="" width="20" height="20">' : '') +
      '<span class="tma-portal-owner-name">' + esc(name) + '</span>' +
      '</span>';
  }

  function personAvatar(person) {
    var name = (person && person.name) || (person && person.email) || '?';
    var avatar = person && person.avatar;
    var src = (window.TMACurrentUser && window.TMACurrentUser.avatarSrc)
      ? window.TMACurrentUser.avatarSrc(avatar, name)
      : (avatar || '');
    return '<img class="tma-portal-share__avatar" src="' + esc(src) + '" alt="" width="32" height="32">';
  }

  function roleSelect(roles, current, attrs) {
    return '<select class="tma-portal-share__role"' + (attrs || '') + '>' +
      (roles || ['viewer', 'downloader', 'editor', 'full']).map(function (r) {
        return '<option value="' + r + '"' + (r === current ? ' selected' : '') + '>' + esc(ROLE_LABELS[r] || r) + '</option>';
      }).join('') + '</select>';
  }

  // Share = the public link. Assign = give a specific user/client access.

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
    // which then appears on the Dashboard and in every staff member's shortcuts.
    if (isFolder && !(item.parent && item.parent.id) && isAdminUser()) {
      list.push({ label: 'Make default folder', icon: 'Buildings', fn: function () { makeDefaultFolder(item); } });
    }
    list.push({ sep: true });
    list.push({ label: 'View details', icon: 'Info', fn: function () { openDetails(item); } });
    if (perm(item, 'delete')) list.push({ label: 'Delete', icon: 'Trash', danger: true, fn: function () { deleteItem(item); } });
    return list;
  }

  /**
   * `list` overrides the default item menu. The file viewer passes its own so
   * the three-dot menu is this exact component — same actions, icons, keyboard
   * handling and styling — rather than a second menu that drifts out of sync.
   */
  function openContextMenu(x, y, item, list) {
    closeContextMenu();
    // Right-clicking an item selects just it, matching common file managers.
    if (!state.selected[item.id]) { /* keep multi-select if already selected */ }

    list = list || contextItems(item);
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

    // The menu is z-index 500, the file viewer is 600 — opened from inside the
    // viewer it lands *behind* it: in the DOM, readable, and entirely
    // invisible. Same lift the details modal already does from here.
    if (lb) ctxEl.style.zIndex = '700';

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
    /*
     * A sidebar folder shortcut lands straight inside its folder; otherwise
     * the URL decides. The shortcut wins because it is a fresh instruction,
     * where the URL is only ever a record of where the reader already was.
     */
    state.folder = opts.folderId || urlParam('folder') || null;
    state.selected = {};
    state.error = null;

    /*
     * Read the wanted file *before* touching the URL. syncUrl below clears the
     * file parameter (nothing is open yet at this point), so reading it
     * afterwards returns null every time and the viewer never reopens.
     */
    var wanted = opts.folderId ? null : urlParam('file');

    // Replace rather than push: this entry *is* the page just arrived at, and
    // pushing a copy of it would make the first Back a no-op.
    state.openFile = null;
    syncUrl(true);

    render();

    return load().then(function () {
      if (!wanted) return;

      /*
       * Reopen the viewer on the file the URL names.
       *
       * Only if it is in the folder that was just loaded — the file parameter
       * travels with a folder parameter, so a file that is not here means a
       * stale or hand-edited link, and silently showing a file from somewhere
       * else would be worse than showing the folder.
       */
      var file = findItem(wanted);

      if (file && file.type === 'file') {
        restoringFromUrl = true;
        try { openLightbox(file); } finally { restoringFromUrl = false; }
        // The address bar already says this; record it without a second entry.
        syncUrl(true);
      } else {
        // A stale link: drop the file parameter rather than leaving the URL
        // claiming a viewer that is not open.
        syncUrl(true);
      }
    });
  }

  /*
   * Back and forward.
   *
   * Without this the address bar would change while the page stayed put — the
   * reader presses Back expecting to leave the viewer and nothing happens.
   */
  window.addEventListener('popstate', function () {
    if (!state.el || !document.contains(state.el)) return;

    var folder = urlParam('folder') || null;
    var file = urlParam('file');

    if (folder !== state.folder) {
      state.folder = folder;
      state.selected = {};
      load().then(function () { restoreViewer(file); });

      return;
    }

    restoreViewer(file);
  });

  function restoreViewer(fileId) {
    if (!fileId) {
      if (lb) closeLightbox(true);
      state.openFile = null;

      return;
    }

    if (state.openFile === fileId) return;

    var file = findItem(fileId);
    if (!file || file.type !== 'file') return;

    // Rebuilding from history, not navigating: openLightbox must not write a
    // new entry on top of the one being restored.
    restoringFromUrl = true;
    try {
      openLightbox(file);
      state.openFile = fileId;
    } finally {
      restoringFromUrl = false;
    }
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('folders', mount);
  }

  /*
   * Live updates: somebody else uploading, renaming, sharing or binning
   * something shows up here without a refresh.
   *
   * Registered once rather than per mount — this module is a singleton and
   * mount() only re-points state.el, so registering there would stack a new
   * watcher on every navigation. The active() check is what makes that safe:
   * the view stays registered after you navigate away, and refetching a
   * detached element would be work nobody can see.
   */
  if (window.TMALive) {
    window.TMALive.register(
      window.TMALive.RESOURCES.FILES,
      function () { return load(true); },
      { active: function () { return !!state.el && document.contains(state.el); } }
    );
  }

  /*
   * The file actions, for lists that live outside this view.
   *
   * The dashboard's Recent Files and Shared-with-me tables render the same rows
   * with the same checkboxes and the same three-dot button, but they had no
   * behaviour behind any of it — the controls were decoration. Rather than
   * grow a second, drifting copy of download/move/copy/delete (with its own
   * permission rules and its own destination picker), those tables drive the
   * implementations here.
   *
   * Everything exposed takes its items EXPLICITLY. Nothing reads this view's
   * own selection, so a caller's list can never be confused with whatever the
   * File Library happens to have selected.
   */
  window.TMAFileActions = {
    /**
     * The row menu, anchored at a point, for one item.
     *
     * `onChange` fires when an action has altered something, so the calling
     * list can reload rather than sit on a stale row.
     */
    menu: function (x, y, item, onChange) {
      externalItems = [item];
      externalOnChange = onChange || null;
      openContextMenu(x, y, item);
    },

    /** Download one file or folder. */
    download: downloadItem,

    /** [{type, id}] for a list of items, the shape bulk endpoints expect. */
    payload: function (items) {
      return (items || []).map(function (i) { return { type: i.type, id: i.id }; });
    },

    /**
     * Run a bulk action over an explicit list.
     *
     * `move` and `copy` open the destination picker themselves. onDone fires
     * after the server confirms, so callers refresh from it rather than
     * guessing when the list changed.
     */
    run: function (action, items, onDone) {
      var payload = this.payload(items);
      if (!payload.length) return;

      var pickTarget = action === 'move' || action === 'copy';
      bulkRun(action, payload, null, onDone || function () {}, pickTarget);
    },

    /** The shared confirm dialog, so destructive actions read identically. */
    confirm: confirmModal,
  };
})();
