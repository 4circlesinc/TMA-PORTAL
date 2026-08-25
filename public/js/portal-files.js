/*
 * TMA - File & Folder manager view (registers the 'folders' view).
 *
 * Real, server-backed replacement for the localStorage folders prototype.
 * Sections: All Files / Clients / My Files / Shared with me / Shared Folders /
 * Favourites / File Box / Recent / Recycle Bin. Table + grid views, toolbar,
 * right-click menu, multi-select bulk actions, details, and chunked uploads
 * via the global TMAUpload manager. Reuses the existing design system
 * (TMAPortalUI helpers, portal.css chrome), no new design language.
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
    'folders-clients': 'clients',
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
    clients: {
      title: 'Clients',
      desc: 'Client folders you can open.',
      empty: 'No client folders yet',
      emptyHint: 'Folders for the clients you work with will appear here.',
    },
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
    // Whose files to show, and who there is to choose from. The list is
    // whatever the last listing reported, so it follows the folder.
    filterOwner: '',
    owners: [],
    /*
     * One page of the folder, not the whole of it.
     *
     * This used to ask for everything (perPage=0) on the reasoning that a
     * library shows whole folders. That holds at a few hundred rows and
     * breaks completely at eleven thousand: "Clients" answered with a
     * 19MB payload the browser then reconciled into eleven thousand rows, and
     * the folder simply never opened. Sorting, searching and filtering all
     * already run in the database, so a page is a window on the same ordered
     * listing rather than a smaller version of it.
     */
    page: 1,
    pageSize: 100,
    total: 0,
    selected: {},        // uuid -> { type, name, perms, favorite }
    data: { folders: [], files: [] },
    loading: false,
    clipboard: null,     // { mode:'cut'|'copy', items:[{type,id,name}] }
    busy: {},            // uuid -> true while an action on that item is in flight
  };

  var globalsBound = false;
  var nameClickTimer = null;

  /* ── helpers ───────────────────────────────────────── */

  /**
   * A file's review state, beside its name.
   *
   * Next to the name rather than in a column of its own: most files have never
   * been sent anywhere, so a Status column would be empty down almost its whole
   * length while taking width from the name, and a badge reads as belonging to
   * the thing it sits against, which a distant column does not.
   *
   * Nothing at all when there is no status. "Draft" against every ordinary file
   * would be decoration, not information.
   */
  function statusChip(it) {
    var s = it.status;
    if (!s || !s.label) return '';

    return '<span class="tma-portal-status tma-portal-status--' + esc(s.tone || 'neutral') +
      ' tma-portal-status--inline">' + esc(s.label) + '</span>';
  }

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
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* Something happened that may change which folders exist or what they're
     called, anything mirroring folders (the sidebar shortcuts) re-reads. */
  function foldersChanged() {
    try { document.dispatchEvent(new CustomEvent('tma:folders-changed')); } catch (e) {}
  }

  function items() { return state.data.folders.concat(state.data.files); }

  /*
   * Rows belonging to some OTHER list that is driving these actions.
   *
   * The dashboard's Recent Files and Shared-with-me tables open this view's row
   * menu. Most actions take the item they were handed, but several re-look it
   * up by id, toggleStar is one, and that lookup only ever searched this
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
   * Only when this view is not the one on screen, otherwise every ordinary
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
    var staffLibrary = window.TMAPortalAccess && window.TMAPortalAccess.can('files.viewOrg');
    if (state.section === 'all' && !staffLibrary) {
      if (!state.folder) return false;
      // The Clients root is view-only; files go in a client folder under it.
      if ((state.breadcrumb || []).length <= 1) return false;
    }
    if (state.folder) return true;
    return !!UPLOADABLE[state.section];
  }

  /* ── data loading ──────────────────────────────────── */

  function listingParams() {
    var params = new URLSearchParams();
    params.set('section', state.section);
    if (state.folder) params.set('folder', state.folder);
    if (state.search) params.set('search', state.search);
    if (state.filterType) params.set('type', state.filterType);
    if (state.filterOwner) params.set('owner', state.filterOwner);
    params.set('sort', state.sort);
    params.set('dir', state.dir);
    params.set('perPage', String(state.pageSize));
    params.set('page', String(state.page));
    return params;
  }

  /*
   * Sizes the server will actually honour. BrowserController clamps perPage
   * to 200 as a runaway guard, so offering 250 or 500 (as the Clients
   * directory does, it pages in the browser) produced a pager that counted
   * in pages of 250 while the server answered in pages of 200: the labels
   * lied and the last eleven pages could not be reached.
   */
  var PAGE_SIZES = [100, 25, 50, 200];

  function totalPages() {
    return Math.max(1, Math.ceil((state.total || 0) / state.pageSize));
  }

  /*
   * Anything that changes WHICH rows the listing holds puts the reader back
   * on page one. Staying on page 40 of a folder after searching it lands on
   * an empty page and reads as "no results".
   */
  function reload(silent) {
    state.page = 1;
    return load(silent);
  }

  function goToPage(page) {
    var next = Math.min(Math.max(1, page), totalPages());
    if (next === state.page) return;
    state.page = next;
    return load().then(scrollListingToTop);
  }

  /*
   * A page turn starts at the top of the new page.
   *
   * The pager sits at the foot of the list, so by the time it is clicked the
   * reader is scrolled to the bottom, and the next page arrived showing its
   * last rows, which reads as the button having done nothing.
   */
  function scrollListingToTop() {
    if (!state.el) return;
    // Every scrolling ancestor, not just the first: the table scrolls inside
    // its own container AND that container sits in the scrolling <main>, so
    // resetting one of the two still leaves the reader down the page.
    var node = state.el.querySelector('[data-files-body]') || state.el;
    while (node && node !== document.documentElement) {
      if (node.scrollTop > 0) {
        var overflow = window.getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') node.scrollTop = 0;
      }
      node = node.parentElement;
    }
  }

  /*
   * Which listings the store keeps. Plain browsing, a section, a folder, a
   * sort, is what people come back to and what should open instantly; a
   * search or a filter is a question asked once, and caching every variant
   * would fill the store with answers nobody returns to. The key carries the
   * whole query string, so two sorts of one folder are two entries rather
   * than one lying about the other.
   */
  function listingCacheKey(params) {
    if (state.search || state.filterType || state.filterOwner) return null;
    return 'files:listing:' + params.toString();
  }

  function load(silent) {
    // Status is cheap and answers "where are my files?" before anyone asks.
    if (!silent) loadSyncStatus();

    var params = listingParams();
    var url = net().url('/?' + params.toString());
    var key = window.TMAStore ? listingCacheKey(params) : null;
    var expected = params.toString();

    /*
     * Guard every paint against the reader having moved on. The cached copy
     * and the server's answer land at different times, and a fast navigator
     * can be two folders away by the second one, applied unguarded, the
     * folder they left overwrites the folder they are in. (The old
     * single-answer code had the same race; the cache just made it likely
     * enough to matter.)
     */
    var apply = function (res, meta) {
      if (listingParams().toString() !== expected) return;
      state.loading = false;
      state.error = null;
      state.data = { folders: res.folders || [], files: res.files || [] };
      state.total = typeof res.total === 'number'
        ? res.total
        : (res.folders || []).length + (res.files || []).length;
      // The server has the last word on the window it served; believing our
      // own request instead is how a clamped perPage desynchronised the pager.
      if (typeof res.perPage === 'number' && res.perPage > 0) state.pageSize = res.perPage;
      // A page beyond the end (rows deleted underneath us, a filter narrowing
      // the set) shows nothing at all; step back rather than leave a blank.
      if (state.page > 1 && !state.data.folders.length && !state.data.files.length && state.total > 0) {
        state.page = totalPages();
        load();
        return;
      }
      state.owners = res.owners || [];
      state.breadcrumb = res.breadcrumb || [];
      if (res.folder) state.folderName = res.folder.name;
      pruneSelection();
      render();
    };

    /*
     * The skeleton only goes up when there is nothing better to show. With a
     * memory hit the cached rows paint in the same breath; holding a
     * skeleton in front of them for one frame is the flash the store exists
     * to end.
     */
    if (!silent && !(key && window.TMAStore.peek(key))) {
      state.loading = true;
      render();
    }

    var fetcher = function () { return net().fetchJSON(url); };

    /*
     * A silent refresh, a live signal, a background poll, skips the cached
     * paint on purpose: the screen already shows something at least as new
     * (an optimistic insert may be newer than the store), and only the
     * server's answer is worth a repaint. It still writes the store, so the
     * next visit benefits from what the signal fetched.
     *
     * Returned so a live refresh can wait for it and avoid stacking refetches
     * on top of each other when several changes land at once.
     */
    var request = key
      ? (silent
        ? fetcher().then(function (res) { window.TMAStore.put(key, res); apply(res); return res; })
        : window.TMAStore.swr(key, fetcher, apply))
      : fetcher().then(function (res) { apply(res); return res; });

    return request.catch(function (err) {
      // swr resolves quietly when a cached copy was already painted and only
      // the refresh failed, that is the offline case working as designed.
      // Reaching here means there was nothing to show at all.
      if (listingParams().toString() !== expected) return;
      // A silent refresh is nobody's request. Replacing a working list with
      // an error because a background poll lost the network is a worse
      // outcome than showing slightly stale rows until the next one lands.
      if (silent) { state.loading = false; return; }

      // Before admitting defeat: the replica. A folder nobody ever visited
      // has no cached listing, but on the desktop its rows may all be
      // sitting in the record layer the sync walker filled.
      return assembleFromReplica(expected).then(function (painted) {
        if (painted) return;
        state.loading = false;
        state.error = err.message || 'Could not load this folder.';
        render();
      });
    });
  }

  /*
   * A listing built from the record replica instead of the network.
   *
   * This is what phase 3 was for (docs/offline-plan.md): the sync walker
   * pulls every visible folder and file into the store as presented rows,
   * and this arranges them into the same shape the server would have sent —
   * so a never-visited folder opens offline, not just the ones somebody
   * happened to browse while connected.
   *
   * Only the shapes whose server semantics are reproducible from the records
   * alone: browsing inside a folder (children by parent link), the All Files
   * root (no parent), and Personal (owned by the reader). Shared,
   * favourites and recent encode questions the rows themselves cannot
   * answer, whose share reached me, what I starred, and a wrong listing
   * offline is worse than a plain "not available offline".
   */
  function assembleFromReplica(expected) {
    var store = window.TMAStore;
    if (!store || !store.persistent || !store.list) return Promise.resolve(false);
    if (state.search || state.filterType || state.filterOwner) return Promise.resolve(false);

    var folderId = state.folder;
    var section = state.section;
    if (!folderId && section !== 'all' && section !== 'my') return Promise.resolve(false);

    return Promise.all([store.list('files:folder:'), store.list('files:item:')]).then(function (held) {
      var folders = held[0];
      var files = held[1];
      if (!folders.length && !files.length) return false;
      // The reader may have navigated while the store was answering.
      if (listingParams().toString() !== expected) return true;

      var childOf = function (rec, link) {
        return folderId ? (rec[link] && rec[link].id === folderId) : !rec[link];
      };
      var shownFolders = folders.filter(function (f) { return childOf(f, 'parent'); });
      var shownFiles = files.filter(function (f) { return childOf(f, 'folder'); });

      if (!folderId && section === 'my') {
        var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
        // Whose files "Personal" means is not guessable: without /me answered
        // (or remembered, current-user.js keeps it on the desktop), showing
        // everything as "mine" would be a wrong listing, not a helpful one.
        if (!me || me.id == null) return false;
        var mine = function (rec) { return rec.owner && rec.owner.userId === me.id; };
        shownFolders = shownFolders.filter(mine);
        shownFiles = shownFiles.filter(mine);
      }

      var dir = state.dir === 'desc' ? -1 : 1;
      var compare = state.sort === 'modified'
        ? function (a, b) { return dir * String(a.modifiedAt || '').localeCompare(String(b.modifiedAt || '')); }
        : function (a, b) { return dir * String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }); };
      shownFolders.sort(compare);
      shownFiles.sort(compare);

      // The breadcrumb is a walk up the parent links, the replica holds the
      // ancestors by the same right it holds the folder.
      var crumb = [];
      if (folderId) {
        var byId = {};
        folders.forEach(function (f) { byId[f.id] = f; });
        var hop = byId[folderId];
        if (hop) state.folderName = hop.name;
        while (hop) {
          crumb.unshift({ id: hop.id, name: hop.name });
          hop = hop.parent ? byId[hop.parent.id] : null;
        }
      }

      state.loading = false;
      state.error = null;
      // Windowed the same way the server windows it, folders first, then
      // files, so the pager below reads the same offline as online.
      state.total = shownFolders.length + shownFiles.length;
      var offset = (state.page - 1) * state.pageSize;
      var pageFolders = shownFolders.slice(offset, offset + state.pageSize);
      var fileOffset = Math.max(0, offset - shownFolders.length);
      state.data = {
        folders: pageFolders,
        files: shownFiles.slice(fileOffset, fileOffset + (state.pageSize - pageFolders.length)),
      };
      state.owners = [];
      state.breadcrumb = crumb;
      pruneSelection();
      render();

      return true;
    }).catch(function () { return false; });
  }

  function pruneSelection() {
    var present = {};
    items().forEach(function (i) { present[i.id] = true; });
    Object.keys(state.selected).forEach(function (id) { if (!present[id]) delete state.selected[id]; });
  }

  /* ── seamless insert ────────────────────────────────
     A newly created folder / uploaded file drops into the current listing in
     its sorted position and flashes in, no full-library refresh. */

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
     (renamed, recoloured, resorted, sharing changed), always local, never
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
    html += renderBreadcrumb();
    html += '<div data-sync-host>' + syncStatusHtml() + '</div>';
    html += renderToolbar();

    html += '<div class="tma-portal-files__body" data-files-body>';
    if (state.loading) html += renderLoading();
    else if (state.error) html += ui().banner('warning', esc(state.error));
    else if (!items().length) html += renderEmpty(meta);
    else html += (state.view === 'grid' ? renderGrid() : renderTable());
    html += '</div>';
    html += renderPagination();
    html += '</div>';

    /*
     * Reconciled, not replaced. Rebuilding this subtree threw away every file
     * thumbnail and folder icon on each render, including renames, colour
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
    return ui().emptyState({
      title: meta.empty,
      subtitle: canCreateHere()
        ? 'Create a folder or upload files to get started.'
        : (meta.emptyHint || ''),
      button: btn,
    });
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
      // Collecting files into this folder is the mirror of uploading into it,
      // and it belongs to the same permission, if you can put files here you
      // can ask somebody else to.
      actions += toolBtn('DownloadSimple', 'request-files', 'Request files');
    }
    if (state.clipboard && create) actions += toolBtn('Clipboard', 'paste', 'Paste (' + state.clipboard.items.length + ')');
    if (isRecycle()) actions += toolBtn('Trash', 'empty-bin', 'Empty recycle bin', { disabled: !items().length });

    actions += toolBtn('Rows', null, 'List view', { view: 'table', active: state.view === 'table', pressed: state.view === 'table' });
    actions += toolBtn('GridFour', null, 'Grid view', { view: 'grid', active: state.view === 'grid', pressed: state.view === 'grid' });
    actions += toolBtn(state.dir === 'asc' ? 'SortAscending' : 'SortDescending', 'sortdir', 'Sort ' + (state.dir === 'asc' ? 'descending' : 'ascending'));
    actions += toolBtn('ArrowClockwise', 'refresh', 'Refresh');
    actions += sortFieldSelect();
    actions += filterControl();
    actions += ownerControl();

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

  /*
   * Filter by who owns it, the Owner column's facet.
   *
   * The owners and their counts come from the server with each listing, and
   * are measured before the filter narrows anything, so choosing one does not
   * empty the menu of everyone else. Drawn as the same head dropdown as the
   * type filter rather than CBI's cascading popover: one toolbar should not
   * carry two ways of asking the same kind of question, and the dropdown
   * already shows what is applied in its own label.
   *
   * Hidden entirely when one person owns everything in view, a filter whose
   * only option is "all of it" is a control that cannot do anything.
   */
  function ownerControl() {
    var owners = state.owners || [];
    if (owners.length < 2) return '';

    var opts = [{ value: '', label: 'All owners' }].concat(owners.map(function (o) {
      return { value: String(o.id), label: o.name + ' (' + o.n + ')' };
    }));

    return menuControl(opts, state.filterOwner, 'data-files-owner-menu', 'Filter by owner');
  }

  /* ── table view ─────────────────────────────────────── */

  /*
   * The footer pager, in the portal's documented pagination component, the
   * same `tma-pagination-bar--footer` the Clients directory uses, for the
   * same reason it got one: eleven thousand rows are not a listing anyone
   * scrolls, and shipping them all is what stopped the folder opening.
   *
   * Hidden entirely when a folder fits on one page, so the ordinary small
   * folder looks exactly as it did.
   */
  function renderPagination() {
    var pages = totalPages();
    if (state.loading || state.error || (pages <= 1 && state.total <= state.pageSize)) return '';

    var windowSize = 5;
    var start = Math.max(1, Math.min(state.page - Math.floor(windowSize / 2), pages - windowSize + 1));
    var end = Math.min(pages, start + windowSize - 1);

    function pageBtn(p) {
      var active = p === state.page;
      return '<button type="button" class="tma-pagination__button' + (active ? ' is-active' : '') + '"' +
        ' data-files-page="' + p + '"' + (active ? ' aria-current="page"' : '') +
        ' aria-label="Page ' + p + '">' + p.toLocaleString() + '</button>';
    }

    var buttons = '';
    // Keep page 1 reachable once the window has moved past it.
    if (start > 1) {
      buttons += pageBtn(1);
      if (start > 2) buttons += '<span class="tma-pagination__gap" aria-hidden="true">…</span>';
    }
    for (var p = start; p <= end; p++) buttons += pageBtn(p);
    if (end < pages) {
      if (end < pages - 1) buttons += '<span class="tma-pagination__gap" aria-hidden="true">…</span>';
      buttons += pageBtn(pages);
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= pages ? ' disabled' : '';
    var results = state.total.toLocaleString() + (state.total === 1 ? ' item' : ' items') +
      ' · page ' + state.page.toLocaleString() + ' of ' + pages.toLocaleString();

    function iconBtn(direction, label, icon, disabled, extra) {
      return '<button type="button" class="tma-pagination__button tma-pagination__button--icon' +
        (extra || '') + '" aria-label="' + label + '" data-files-direction="' + direction + '"' + disabled + '>' +
        '<img src="images/icons/phosphor/' + icon + '.svg" class="tma-pagination__icon" width="16" height="16" alt=""></button>';
    }

    return '<div class="tma-pagination-bar tma-pagination-bar--footer" data-files-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
      '<button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page"' +
      ' aria-haspopup="listbox" aria-expanded="false" data-files-page-size>' +
      '<span class="tma-pagination__label">' + state.pageSize + '</span>' +
      '<img src="images/icons/phosphor/ArrowLineDown.svg" class="tma-pagination__icon" width="16" height="16" alt="" aria-hidden="true">' +
      '</button>' +
      '<span class="tma-pagination-bar__results">' + esc(results) + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' +
      iconBtn('first', 'First page', 'ArrowLineLeft', prevDisabled) +
      iconBtn('prev', 'Previous page', 'CaretLeft', prevDisabled) +
      buttons +
      iconBtn('next', 'Next page', 'CaretRight', nextDisabled) +
      iconBtn('last', 'Last page', 'ArrowLineRight', nextDisabled, ' tma-pagination__button--next') +
      '</nav></div>';
  }

  function renderTable() {
    var showStar = !isRecycle();
    var all = items();
    var selectable = all;
    var allSel = selectable.length && selectedIds().length === selectable.length;

    var headers = [
      { html: '<input type="checkbox" class="tma-dash__check" data-files-selectall ' + (allSel ? 'checked' : '') + ' aria-label="Select all">', attrs: ' class="tma-portal-cell--tight"' },
    ];
    if (showStar) headers.push({ html: '', attrs: ' class="tma-portal-cell--tight"' });
    /*
     * Every column is named, because the table lays out fixed: a filename is
     * arbitrarily long, and letting the browser size the Name column to fit
     * one pushed Owner and Modified off to the right, the columns
     * moved about as you browsed from folder to folder. Widths come from the
     * class on each header now, and a long name is clipped with an ellipsis.
     *
     * The row-menu column had no header cell at all, which a fixed layout has
     * no width to take; it gets one now, empty like the star's.
     */
    headers.push(
      { html: 'Name', attrs: ' class="tma-portal-cell--name"' },
      { html: 'Type', attrs: ' class="tma-portal-cell--type"' },
      { html: 'Size', attrs: ' class="tma-portal-cell--size"' },
      { html: 'Shared with', attrs: ' class="tma-portal-cell--owner"' },
      { html: isRecycle() ? 'Deleted' : 'Modified', attrs: ' class="tma-portal-cell--when"' },
      { html: '', attrs: ' class="tma-portal-cell--menu"' }
    );

    var rows = all.map(function (it) {
      var busy = isBusy(it.id);
      var rowClasses = [];
      if (state.selected[it.id]) rowClasses.push('tma-portal-table__row--selected');
      if (busy) rowClasses.push('is-busy');
      var cls = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';
      var star = showStar ? '<td class="tma-portal-cell--tight">' + starBtn(it) + '</td>' : '';
      var typeLabel = it.type === 'folder' ? 'Folder' : (it.category ? cap(it.category) : 'File');
      var size = it.type === 'folder' ? (it.sizeLabel || '-') : it.sizeLabel;
      var owner = ownerCell(it);
      var when = isRecycle() ? fmtDate(it.deletedAt) : fmtDate(it.modifiedAt || it.createdAt);
      var busySpin = busy ? '<img class="tma-portal-row-spinner" src="images/icons/tma/Loading-16.svg" alt="" width="14" height="14">' : '';

      return '<tr' + cls + ' data-files-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '">' +
        '<td class="tma-portal-cell--tight"><input type="checkbox" class="tma-dash__check" data-files-check="' + esc(it.id) + '" ' + (state.selected[it.id] ? 'checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></td>' +
        star +
        '<td class="tma-portal-cell--name"><span class="tma-portal-avatar-cell">' + thumbOrIcon(it, 24) +
        // title: the full name is still reachable when the cell clips it.
        '<button type="button" class="tma-portal-file-link" data-files-open="' + esc(it.id) + '" title="' + esc(it.name) + '">' + esc(it.name) + '</button>' +
        statusChip(it) + busySpin + '</span></td>' +
        '<td class="tma-portal-table__muted tma-portal-cell--type">' + esc(typeLabel) + '</td>' +
        '<td class="tma-portal-table__muted tma-portal-cell--size">' + esc(size || '-') + '</td>' +
        '<td class="tma-portal-table__muted tma-portal-cell--owner">' + owner + '</td>' +
        '<td class="tma-portal-table__muted tma-portal-cell--when">' + esc(when) + '</td>' +
        '<td class="tma-portal-cell--menu"><button type="button" class="tma-portal-row-menu" data-files-menu="' + esc(it.id) + '" aria-label="More actions"><img src="images/icons/tma/ThreeDots-16.svg" alt="" width="16" height="16"></button></td>' +
        '</tr>';
    }).join('');

    return ui().table(headers, rows, { cls: 'tma-portal-files-table' });
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
        statusChip(it) +
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
      state.page = 1;
      debouncedLoad();
    });

    // Bound once per element rather than once per render: these buttons now
    // survive reconciliation, so re-binding would stack handlers. The
    // delegated listeners further down are safe as they are, they pass named
    // functions, and addEventListener ignores an identical re-registration.
    var viewBtns = window.TMAMorph
      ? window.TMAMorph.unwired(el, '[data-files-view]')
      : Array.prototype.slice.call(el.querySelectorAll('[data-files-view]'));
    viewBtns.forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-files-view'); render(); });
    });
    ui().wireHeadDropdownAll(el, '[data-files-sort-menu]', function (sel) { state.sort = sel.action; reload(); });
    ui().wireHeadDropdownAll(el, '[data-files-filter-menu]', function (sel) { state.filterType = sel.action; reload(); });
    ui().wireHeadDropdownAll(el, '[data-files-owner-menu]', function (sel) { state.filterOwner = sel.action; reload(); });

    wirePagination(el);

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

  /*
   * The pager's buttons, bound the way every morphed control here has to be:
   * through TMAMorph.unwired, or a handler is added again on each render and
   * one click turns three pages.
   */
  function wirePagination(el) {
    var bar = el.querySelector('[data-files-pagination]');
    if (!bar) return;

    var fresh = function (selector) {
      return window.TMAMorph
        ? window.TMAMorph.unwired(bar, selector)
        : Array.prototype.slice.call(bar.querySelectorAll(selector));
    };

    fresh('[data-files-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        goToPage(parseInt(btn.getAttribute('data-files-page'), 10) || 1);
      });
    });

    fresh('[data-files-direction]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        switch (btn.getAttribute('data-files-direction')) {
          case 'first': return goToPage(1);
          case 'prev': return goToPage(state.page - 1);
          case 'next': return goToPage(state.page + 1);
          case 'last': return goToPage(totalPages());
        }
      });
    });

    fresh('[data-files-page-size]').forEach(function (btn) {
      // Cycles rather than opening a listbox, the same interaction the
      // Clients directory's page-size control has.
      btn.addEventListener('click', function () {
        var idx = PAGE_SIZES.indexOf(state.pageSize);
        state.pageSize = PAGE_SIZES[(idx + 1) % PAGE_SIZES.length];
        savePageSize(state.pageSize);
        reload();
      });
    });
  }

  var PAGE_SIZE_KEY = 'tma:files:pageSize';

  function savePageSize(size) {
    try { window.localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch (e) {}
  }

  function restorePageSize() {
    try {
      var saved = parseInt(window.localStorage.getItem(PAGE_SIZE_KEY), 10);
      if (PAGE_SIZES.indexOf(saved) !== -1) state.pageSize = saved;
    } catch (e) {}
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

    // Click anywhere on the row (name, cells, card) opens the item, but not
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
    function dropActive() {
      if (!state.el || !state.el.isConnected) return false;
      /*
       * Not while the viewer is open.
       *
       * This listens on the window and uploads into the current folder, so
       * with a file open it would answer a drop aimed at the viewer's own
       * version drop zone, quietly adding a *new file* to the folder behind
       * it instead of a new version of the thing on screen. Two very different
       * outcomes for the same gesture.
       */
      if (lb) return false;
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
        '<span>' + esc(f.name) + ', ' +
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
     * "Citizenship Applications synced 1d ago" is not news, after the first
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
   * both directions, hydration writes '1' back from the account. Writing
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
   * writes the URL, so without this, arriving on a link would push a copy of
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
    state.page = 1;
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
   * repaints, rebuilding the whole subtree would reset the preview's scroll
   * and zoom, drop the panel's scroll position, and re-collapse whatever the
   * reader had expanded, which §29 of the spec forbids.
   *
   * Panels fetch on first view, not on open: a firm-wide access roll-up or a
   * long history must never delay the preview.
   */

  var lb = null;

  /** Is this drag carrying files, as opposed to a row being moved? */
  function hasFiles(e) {
    var dt = e.dataTransfer;

    return !!dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1;
  }

  /* The websocket details come from /me, the same place notifications and
   * messaging read them. Fetched once per page and remembered, including a
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
  // Details stay closed until asked for; comments live in their own floating
  // column (not a tab) and are likewise opt-in.
  /*
   * `comments: true` is not a preference any more, the discussion is part
   * of the viewer, always open, floating over the right edge. The toggle
   * taught people to lose it; the file's conversation should be as present
   * as the file.
   */
  var viewerPrefs = { panel: false, tab: 'details', filter: 'all', comments: true };

  /*
   * `count` names the key in the details payload's `counts` block that this
   * tab should show. Tabs without one are never numbered: Activity is a log
   * that only grows, so a number on it measures the file's age rather than
   * anything to attend to, and Access counts people rather than work.
   *
   * Comments are not a tab, they float beside the document.
   */
  var VIEWER_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'versions', label: 'Versions', count: 'versions' },
    { id: 'approvals', label: 'Approvals', count: 'approvals' },
    { id: 'activity', label: 'Activity' },
    { id: 'access', label: 'Access' },
  ];

  /* pdf.js is ESM (~1.7 MB with worker), load on first PDF open only. */
  var pdfjsPromise = null;

  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    pdfjsPromise = import(root + '/js/vendor/pdf-loader.mjs').then(function (lib) {
      try {
        lib.GlobalWorkerOptions.workerSrc = new URL(root + '/js/vendor/pdf-worker.mjs', window.location.href).href;
      } catch (e) {
        lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf-worker.mjs';
      }
      return lib;
    }).catch(function (err) {
      pdfjsPromise = null;
      throw err;
    });
    return pdfjsPromise;
  }

  /* Bytes on the page, then pdf.js, see TMAPortalLightbox.pdfDocument. */
  function loadPdfDocument(url) {
    if (window.TMAPortalLightbox && typeof window.TMAPortalLightbox.pdfDocument === 'function') {
      return window.TMAPortalLightbox.pdfDocument(url);
    }
    var path = url;
    try {
      var parsed = new URL(url, window.location.href);
      path = parsed.pathname + parsed.search;
    } catch (e) { /* keep url */ }
    return loadPdfjs().then(function (pdfjs) {
      return fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } })
        .then(function (res) {
          if (!res.ok) throw new Error('Could not load this PDF.');
          return res.arrayBuffer();
        })
        .then(function (buf) {
          if (!buf || !buf.byteLength) {
            var empty = new Error('This file is not a valid PDF.');
            empty.name = 'InvalidPDFException';
            throw empty;
          }
          return pdfjs.getDocument({
            data: new Uint8Array(buf),
            disableRange: true,
            disableStream: true,
            useWorkerFetch: false,
            isEvalSupported: false
          }).promise;
        });
    });
  }

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
     * shell, which also puts it outside .tma-dash, where none of those rules
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
        expanded: {}, draft: '', pendingMentions: [], editing: null, replyingTo: null, composerOpen: false,
        pdfDoc: null, pdfUrl: null, pdfPage: 1, pdfZoomMode: 'width', pdfZoomScale: 1 };
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
            leftRailHtml(f) +
            '<div class="tma-portal-viewer__main">' +
              '<div class="tma-portal-viewer__stage" data-lb-stage>' + lightboxBody(f) + '</div>' +
              '<div class="tma-portal-viewer__foot" data-lb-foot>' + footHtml(f) + '</div>' +
            '</div>' +
            '<aside class="tma-portal-viewer__comments" data-lb-comments-panel aria-label="Comments">' +
              '<div class="tma-portal-viewer__comments-body" data-lb-comments-body></div>' +
            '</aside>' +
            '<aside class="tma-portal-viewer__panel" data-lb-panel' + (viewerPrefs.panel ? '' : ' hidden') + '>' +
              panelChromeHtml() +
              '<div class="tma-portal-viewer__panel-body" data-lb-panel-body></div>' +
            '</aside>' +
          '</div>' +
        '</div>';

      // Once per viewer, not per file: the panel is rebuilt constantly and
      // binding on render would stack a listener every time.
      bindVersionDrop();

      var stage = lb.querySelector('[data-lb-stage]');
      if (stage) {
        stage.classList.toggle(
          'tma-portal-viewer__stage--pdf',
          f.category === 'pdf' && f.previewUrl && perm(f, 'preview')
        );
        swapFullImage(stage);
      }

      paintPanel();
      paintCommentsPanel();
      bindAnchorSelect();
      mountPdf(f);
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

    /**
     * Left column: PDF page thumbs when a PDF is open; otherwise the other
     * files in this folder when there is more than one.
     */
    function leftRailHtml(f) {
      if (f.category === 'pdf' && f.previewUrl && perm(f, 'preview')) {
        return '<div class="tma-portal-viewer__pages" data-lb-pages aria-label="Pages"></div>';
      }
      if (gallery.length > 1) {
        return '<div class="tma-portal-viewer__rail" data-lb-rail>' + railHtml() + '</div>';
      }
      return '';
    }

    /* Insert, replace or remove the left rail when the open file's preview type changes. */
    function syncLeftRail(f) {
      var body = lb.querySelector('.tma-portal-viewer__body');
      var oldRail = lb.querySelector('[data-lb-rail], [data-lb-pages]');
      var railMarkup = leftRailHtml(f);
      if (oldRail && railMarkup) {
        oldRail.outerHTML = railMarkup;
      } else if (oldRail && !railMarkup) {
        oldRail.remove();
      } else if (!oldRail && railMarkup && body) {
        body.insertAdjacentHTML('afterbegin', railMarkup);
      }
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
      // Only worth stating once there is history to state, "Version 1" on
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

    // Instant labels: native `title` waits ~1s, and icon-only tools need a name
    // the moment the pointer lands. Same type across the bar so sliding from
    // Download to Print swaps with no second delay.
    function toolTipHtml(id, label) {
      return '<div id="' + esc(id) + '" class="tma-tooltip tma-tooltip--compact tma-tooltip--bottom tma-tooltip-trigger__tip" role="tooltip" aria-hidden="true">' +
        '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--inline"><span class="tma-tooltip__text">' + esc(label) + '</span></div></div>' +
        '<span class="tma-tooltip__arrow" aria-hidden="true"></span>' +
        '</div>';
    }

    function toolBtnAttrs(action, label, tipId) {
      return ' data-lb-act="' + action + '"' +
        ' aria-label="' + esc(label) + '"' +
        ' aria-describedby="' + esc(tipId) + '"' +
        ' data-tooltip-trigger data-tooltip-type="viewer-tool" data-tooltip-position="bottom"' +
        ' data-tooltip-initial-delay="0" data-tooltip-rehover-delay="0" data-tooltip-rehover-window="30000"';
    }

    function toolBtnHtml(icon, action, label, opts) {
      opts = opts || {};
      var tipId = 'lb-tip-' + action;
      return '<button type="button" class="tma-portal-viewer__tool tma-tooltip-trigger' + (opts.active ? ' is-active' : '') + '"' +
        toolBtnAttrs(action, label, tipId) +
        (opts.pressed !== undefined ? ' aria-pressed="' + opts.pressed + '"' : '') + '>' +
        '<img src="images/icons/phosphor/' + icon + '.svg" alt="" width="18" height="18">' +
        toolTipHtml(tipId, label) +
        '</button>';
    }

    /**
     * Only actions the viewer may actually perform are rendered, and every
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
      html += toolBtnHtml('ChatCircle', 'comments', 'Add a comment');
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
      var tipId = 'lb-tip-favorite';
      return '<button type="button" class="tma-portal-viewer__tool tma-tooltip-trigger' + (on ? ' is-active' : '') + '"' +
        toolBtnAttrs('favorite', label, tipId) + ' aria-pressed="' + on + '">' +
        '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">' +
        '<path d="' + path + '" ' + (on ? 'fill="#ffcc00" stroke="#e0ac00"' : 'fill="none" stroke="currentColor"') +
        ' stroke-width="1.3" stroke-linejoin="round"/></svg>' +
        toolTipHtml(tipId, label) +
        '</button>';
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
      var bits = [];
      if (f.category !== 'pdf' && gallery.length > 1) {
        bits.push((idx + 1) + ' of ' + gallery.length);
      }
      if (f.sizeLabel) bits.push(esc(f.sizeLabel));
      return bits.map(function (b) { return '<span>' + b + '</span>'; }).join('');
    }

    /* ── right panel ─────────────────────────────────── */

    /**
     * The documented Tab Group (underline), not a set of buttons of our own.
     *
     * These were a bespoke `.tma-portal-viewer__tab`, a second tab component
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
      if (viewerPrefs.tab === 'versions') return paintVersions(host);
      if (viewerPrefs.tab === 'approvals') return paintApprovals(host);
      if (viewerPrefs.tab === 'activity') return paintActivity(host);
      return paintAccess(host);
    }

    /* Floating comments column (not a panel tab) ------------------------ */

    function paintCommentsPanel() {
      var panel = lb.querySelector('[data-lb-comments-panel]');
      if (!panel) return;
      // Persist the composer before we hide or rebuild it.
      if (!viewerPrefs.comments) {
        var openInput = lb.querySelector('[data-lb-input]');
        if (openInput) entry(current()).draft = openInput.value;
      }
      /*
       * The details panel and the bubbles share the same edge of the screen,
       * so they take turns: any details tab open puts the comments away, and
       * closing it brings them straight back. One flag stays the reader's
       * (comments), the other is the panel's own state, visibility is
       * derived, never juggled.
       */
      panel.hidden = !viewerPrefs.comments || viewerPrefs.panel;
      var head = lb.querySelector('.tma-portal-viewer__head');
      if (head) head.outerHTML = viewerHead(current());
      if (!viewerPrefs.comments) return;
      var host = panel.querySelector('[data-lb-comments-body]');
      if (host) paintComments(host);
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
       * carry, where it lives, whose it is, when it last changed.
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
           * Rendered empty until the details request answers, the counts ride
           * along with it, so there is nothing to show and nothing to fetch.
           */
          reviewHtml(f) +
          '<div data-lb-counts>' + (e.details ? countsHtml(e.details) : '') + '</div>' +
        '</div>' +
        /*
         * No skeleton while the extra metadata loads.
         *
         * "More details" is a collapsed disclosure, one line when it arrives.
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
     * wanted whichever tab is showing, so it can no longer live inside
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
     * "PDF · 176.9 KB", the two facts that used to be a row each.
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
     * "2 comments · 3 versions", each one a way into its tab.
     *
     * Zeroes are left out rather than shown as "0 comments". A file with
     * nothing on it says nothing, which is the honest answer and keeps the
     * card short; three zeroes would be three lines of nothing to do.
     */
    function countsHtml(data) {
      var counts = (data && data.counts) || {};

      var chips = [
        { act: 'comments', n: counts.comments, one: 'comment', many: 'comments' },
        { tab: 'versions', n: counts.versions, one: 'version', many: 'versions' },
        // "1 approval" counted requests still waiting, but reads as one having
        // been given, the opposite of what the number means.
        { tab: 'approvals', n: counts.approvals, one: 'open request', many: 'open requests' },
      ].filter(function (c) { return c.n > 0; });

      if (!chips.length) return '';

      return '<div class="tma-portal-viewer__counts">' +
        chips.map(function (c) {
          var attr = c.act ? ('data-lb-act="' + c.act + '"') : ('data-lb-tab="' + c.tab + '"');
          return '<button type="button" class="tma-portal-viewer__count" ' + attr + '>' +
            c.n + ' ' + (c.n === 1 ? c.one : c.many) +
          '</button>';
        }).join('') +
      '</div>';
    }

    /**
     * The review state of a client document, and the way to move it on.
     *
     * Only for files that are in a review, an ordinary library file has no
     * status and gets no control, which is what keeps this from appearing on
     * every logo and template in the portal.
     *
     * The buttons are whatever the server says may follow the current state
     * (review.next), rather than a fixed row: the allowed moves are a rule
     * about the workflow, and duplicating it here would let the two disagree.
     */
    /* Mirrors ReviewStatus::tone so a review badge and an approval badge are
       the same four colours meaning the same four things. */
    function reviewTone(status) {
      if (status === 'ready_for_submission' || status === 'approved') return 'success';
      if (status === 'update_required' || status === 'rejected' || status === 'changes_requested') return 'danger';
      if (status === 'application_review' || status === 'pending_review' || status === 'under_review' || status === 'awaiting_approval') return 'pending';
      if (status === 'pending_upload') return 'neutral';

      return 'neutral';
    }

    function reviewHtml(f) {
      var r = f.review;
      if (!r || !r.status) return '';

      /*
       * One picker rather than a row of verbs.
       *
       * Three buttons. Start review, Approve, Reject, read as three
       * unrelated actions when they are one field with four possible values,
       * and they could only ever offer the moves allowed from where the
       * document already was. A picker shows the whole set, says which one is
       * current, and grows a state without growing the panel.
       */
      var actions = r.canReview
        ? '<button type="button" class="tma-portal-viewer__review-pick" data-lb-review-open>' +
            '<span>Change status</span>' +
            '<img src="images/icons/phosphor/CaretDown.svg" alt="" width="12" height="12">' +
          '</button>'
        : '';

      return '<div class="tma-portal-viewer__review">' +
        '<div class="tma-portal-viewer__review-head">' +
          '<span class="tma-portal-viewer__review-label">Review</span>' +
          statusBadgeHtml(r.status, r.label || r.status, reviewTone(r.status)) +
        '</div>' +
        (r.note ? '<p class="tma-portal-viewer__review-note">“' + esc(r.note) + '”</p>' : '') +
        (r.reviewedBy && r.reviewedAt
          ? '<p class="tma-portal-viewer__review-by">' + esc(r.reviewedBy.name) + ' · ' + esc(fmtDateTime(r.reviewedAt)) + '</p>'
          : '') +
        (actions ? '<div class="tma-portal-viewer__review-actions">' + actions + '</div>' : '') +
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
     * somebody opening a Details tab is looking for, and a closed <details>
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

    /* Repaints only the comment list, the composer keeps its text and caret. */
    function repaintComments(e) {
      var slot = lb.querySelector('[data-lb-comments]');
      if (slot && e.comments) slot.innerHTML = commentsHtml(e.comments, e);
      paintComposerAnchor(e);
    }

    // The composer's little "on a highlighted area" chip, redrawn without
    // rebuilding the box the reader may be mid-sentence in.
    function paintComposerAnchor(e) {
      var composer = lb.querySelector('[data-lb-composer]');
      if (!composer) return;
      var chip = composer.querySelector('[data-lb-anchor-chip]');
      if (chip) chip.remove();

      if (!e.pendingAnchor) return;

      var el = document.createElement('div');
      el.className = 'tma-portal-viewer__anchor-chip';
      el.setAttribute('data-lb-anchor-chip', '');
      el.innerHTML = 'On a highlighted area' + (e.pendingAnchor.page > 1 ? ' · page ' + e.pendingAnchor.page : '') +
        '<button type="button" data-lb-anchor-clear aria-label="Remove the highlight">×</button>';
      composer.insertBefore(el, composer.firstChild.nextSibling);
    }

    /* ── highlight-to-comment ─────────────────────────
     *
     * Drag on the document to name the part a comment is about. The
     * rectangle is stored as fractions of the rendered media, so the same
     * anchor lands on the same words at any zoom on any screen; a click on a
     * thread's "Highlighted area" tag draws it back.
     */

    function anchorMedia() {
      var stage = lb.querySelector('[data-lb-stage]');

      // Whatever the stage is showing: a PDF page's canvas, a plain image
      // (which wears __img), or the audio/video media element.
      return stage && stage.querySelector('canvas, img.tma-portal-viewer__img, .tma-portal-viewer__media');
    }

    function clearAnchorOverlay() {
      var box = lb && lb.querySelector('[data-lb-anchor-box]');
      if (box) box.remove();
    }

    function showAnchorOverlay(anchor) {
      clearAnchorOverlay();
      if (!anchor) return;

      var e = entry(current());

      // Another page of the PDF: go there first; the overlay would otherwise
      // point at the right coordinates on the wrong words.
      if (e.pdfDoc && anchor.page && anchor.page !== e.pdfPage) {
        renderPdfPage(current(), anchor.page);
        setTimeout(function () { showAnchorOverlay(anchor); }, 350);
        return;
      }

      var media = anchorMedia();
      var stage = lb.querySelector('[data-lb-stage]');
      if (!media || !stage) return;

      var mr = media.getBoundingClientRect();
      var sr = stage.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'tma-portal-viewer__anchor-box';
      box.setAttribute('data-lb-anchor-box', '');
      box.style.left = (mr.left - sr.left + anchor.x * mr.width) + 'px';
      box.style.top = (mr.top - sr.top + anchor.y * mr.height) + 'px';
      box.style.width = (anchor.w * mr.width) + 'px';
      box.style.height = (anchor.h * mr.height) + 'px';
      stage.appendChild(box);

      // It fades rather than staying: the overlay answers "where", and once
      // read it must not sit on the document the reader is trying to see.
      setTimeout(clearAnchorOverlay, 2600);
    }

    function bindAnchorSelect() {
      var stage = lb.querySelector('[data-lb-stage]');
      if (!stage || stage._anchorBound) return;
      stage._anchorBound = true;

      var start = null;
      var box = null;

      stage.addEventListener('mousedown', function (ev) {
        var media = anchorMedia();
        if (!media || ev.button !== 0) return;
        if (!media.contains(ev.target) && ev.target !== media) return;

        var mr = media.getBoundingClientRect();
        start = { x: ev.clientX, y: ev.clientY, mr: mr };
        box = null;
        // Without this an <img> begins the browser's own picture-drag on the
        // first moved pixel, and the highlight never gets a single mousemove.
        ev.preventDefault();
      });

      stage.addEventListener('mousemove', function (ev) {
        if (!start) return;

        var dx = Math.abs(ev.clientX - start.x);
        var dy = Math.abs(ev.clientY - start.y);
        // A wobble is a click; only a real drag starts a highlight.
        if (!box && dx < 6 && dy < 6) return;

        if (!box) {
          box = document.createElement('div');
          box.className = 'tma-portal-viewer__anchor-box is-drawing';
          box.setAttribute('data-lb-anchor-box', '');
          stage.appendChild(box);
        }

        var sr = stage.getBoundingClientRect();
        box.style.left = (Math.min(start.x, ev.clientX) - sr.left) + 'px';
        box.style.top = (Math.min(start.y, ev.clientY) - sr.top) + 'px';
        box.style.width = dx + 'px';
        box.style.height = dy + 'px';
        ev.preventDefault();
      });

      window.addEventListener('mouseup', function (ev) {
        if (!start) return;
        var began = start;
        start = null;

        if (!box) return;
        var drawn = box;
        box = null;

        var mr = began.mr;
        var x1 = Math.max(mr.left, Math.min(began.x, ev.clientX));
        var y1 = Math.max(mr.top, Math.min(began.y, ev.clientY));
        var x2 = Math.min(mr.right, Math.max(began.x, ev.clientX));
        var y2 = Math.min(mr.bottom, Math.max(began.y, ev.clientY));
        drawn.remove();

        if (x2 - x1 < 12 || y2 - y1 < 12) return;

        var en = entry(current());
        en.pendingAnchor = {
          page: en.pdfDoc ? en.pdfPage : 1,
          x: (x1 - mr.left) / mr.width,
          y: (y1 - mr.top) / mr.height,
          w: (x2 - x1) / mr.width,
          h: (y2 - y1) / mr.height,
        };
        en.composerOpen = true;
        var cbody = lb.querySelector('[data-lb-comments-body]');
        if (cbody) paintComments(cbody);
        showAnchorOverlay(en.pendingAnchor);

        var input = lb.querySelector('[data-lb-input]');
        if (input) input.focus();
      });
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
     * The event carries no body, only that something changed, so the panel
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
        if (viewerPrefs.comments) loadComments(current());
        else refreshOpenCountOnly(current());
      });

      /*
       * Versions, approvals and activity, on the same terms as comments above.
       *
       * Only the tab on show is refetched; the others have their cache dropped
       * so they reload when opened. Refetching all three on every signal would
       * be two wasted requests for panels nobody is looking at, and leaving the
       * caches alone would show a stale list the moment the reader switched
       * tabs, which looks more broken than never updating at all.
       */
      rt.listen(name, 'file.detail.changed', function (payload) {
        if (!lb || !payload || payload.fileId !== current().id) return;

        var f = current();
        var e = entry(f);
        var section = payload.section;

        // The counts live in the details payload, so a new version landing has
        // to invalidate that too, otherwise the panel shows the new version
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

      /*
       * The box is summoned, not resident. By default the column is only the
       * conversation; highlighting a spot on the document, or the comments
       * count chip in the details panel, opens the composer in its place at
       * the bottom, and posting puts it away again. A form that always sat
       * there made every file read as a request to say something.
       */
      host.innerHTML =
        '<div class="tma-portal-viewer__comments-feed" data-lb-comments>' +
          (stale ? commentsHtml(stale, e) : ui().loading({ count: 3 })) +
        '</div>' +
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
            // Newest-first feed: older pages append below what is already shown.
            data.threads = e.comments.threads.concat(data.threads);
          }
          e.comments = data;
          if (current().id !== f.id || !viewerPrefs.comments) return;
          var slot = lb.querySelector('[data-lb-comments]');
          if (slot) slot.innerHTML = commentsHtml(data, e);
          refreshCommentCount(data);
        })
        .catch(function (err) { panelError('[data-lb-comments]', err, 'comments'); });
    }

    // Open-thread count for the details chips and any badge that needs it.
    function refreshCommentCount(data) {
      var n = (data && data.openCount) || 0;

      /*
       * Into the cache as well as onto the label.
       *
       * The details chips are rebuilt from the cached counts on every panel
       * repaint, so a count written only to the DOM survives until the reader
       * switches tabs and then silently reverts to whatever the details
       * request last said, which, after posting a comment, is one short.
       */
      var e = entry(current());
      if (e.details && e.details.counts) e.details.counts.comments = n;

      var counts = lb.querySelector('[data-lb-counts]');
      if (counts && e.details) counts.innerHTML = countsHtml(e.details);
    }

    function commentsHtml(data, e) {
      var threads = (data && data.threads) || [];
      if (!threads.length) {
        // Nothing, an empty feed is the composer waiting, and a sentence
        // announcing the emptiness only pushes the box people came to type in.
        return '';
      }

      // Latest on top; "earlier" loads older threads underneath.
      var html = threads.map(function (t) { return threadHtml(t, e); }).join('');

      if (data.nextCursor) {
        html += '<button type="button" class="tma-portal-viewer__more-btn" data-lb-more-comments>Show earlier comments</button>';
      }

      return html;
    }

    function threadHtml(t, e) {
      var replies = (t.replies || []).map(function (r) {
        return '<div class="tma-portal-viewer__reply">' + commentHtml(r, e, { root: false }) + '</div>';
      }).join('');

      return '<div class="tma-portal-viewer__thread' + (t.resolved ? ' is-resolved' : '') + '" data-thread="' + esc(t.id) + '">' +
        // Reply belongs to the thread, so it is drawn with the opening
        // comment's own actions rather than as a row of its own underneath —
        // which is what put two lines of controls under every comment.
        commentHtml(t, e, { root: true, canReply: !!t.can.reply, threadId: t.id }) +
        replies +
        (t.can.reply ? replyControlHtml(t, e) : '') +
      '</div>';
    }

    /**
     * @param {object} [opts] { root, canReply, threadId }, a reply is not a
     *   thread, so it gets neither the Reply control nor Resolve.
     */
    function commentHtml(c, e, opts) {
      opts = opts || { root: true };
      if (c.deleted) {
        return '<div class="tma-portal-viewer__comment is-deleted">' +
          '<p class="tma-portal-viewer__comment-body"><em>This comment was deleted.</em></p></div>';
      }

      var editing = e.editing === c.id;
      var who = c.author ? (c.author.isSelf ? 'You' : c.author.name) : 'Someone';

      /*
       * One row, in the order they get used: reply, then resolve, then the
       * two that change what is already written.
       *
       * Resolve only on the opening comment, resolving is something that
       * happens to a *thread*, so offering it against every reply was both
       * repetition and a small lie about what the button does.
       */
      /*
       * The verbs live in the bubble's top corner and show on hover: a tick
       * to mark the thread resolved, and a ⋯ holding Edit and Delete, the
       * two that change what is already written earn a step of intent. Reply
       * keeps a visible line of its own below; it is the one verb a reader
       * came to use.
       */
      var hover = '';
      if (!editing) {
        if (opts.root && c.can.resolve) {
          hover += '<button type="button" class="tma-portal-viewer__hover-act" data-lb-resolve="' + esc(c.id) + '"' +
            ' data-resolved="' + c.resolved + '" title="' + (c.resolved ? 'Reopen' : 'Mark as resolved') + '"' +
            ' aria-label="' + (c.resolved ? 'Reopen' : 'Mark as resolved') + '">' +
            '<img src="images/icons/phosphor/' + (c.resolved ? 'ArrowCounterClockwise' : 'Check') + '.svg" alt="" width="14" height="14"></button>';
        }
        if (c.can.edit || c.can.delete) {
          hover += '<button type="button" class="tma-portal-viewer__hover-act" data-lb-commentmenu="' + esc(c.id) + '"' +
            ' title="More" aria-label="More options" aria-haspopup="menu">' +
            '<img src="images/icons/phosphor/DotsThree.svg" alt="" width="14" height="14"></button>' +
            '<div class="tma-portal-viewer__comment-menu" data-lb-commentmenu-pop="' + esc(c.id) + '" hidden>' +
            (c.can.edit
              ? '<button type="button" data-lb-edit="' + esc(c.id) + '"><img src="images/icons/phosphor/PencilSimple.svg" alt="" width="14" height="14">Edit</button>'
              : '') +
            (c.can.delete
              ? '<button type="button" data-lb-del="' + esc(c.id) + '"><img src="images/icons/phosphor/Trash.svg" alt="" width="14" height="14">Delete</button>'
              : '') +
            '</div>';
        }
      }

      // No Reply line: the whole bubble answers to a click, and a label
      // repeating what the card already does was one more word per comment.
      var actions = '';

      var body = editing
        ? '<div class="tma-portal-viewer__editbox">' +
            '<textarea class="tma-portal-viewer__input" data-lb-editinput rows="3">' + esc(c.body || '') + '</textarea>' +
            '<div class="tma-portal-viewer__composer-actions">' +
              '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-editcancel>Cancel</button>' +
              '<button type="button" class="tma-portal-viewer__btn" data-lb-editsave="' + esc(c.id) + '">Save</button>' +
            '</div>' +
          '</div>'
        : '<p class="tma-portal-viewer__comment-body">' + decorateMentions(c) + '</p>';

      /*
       * The face and the name head the bubble; the message runs the full
       * width UNDER them, flush with the face's own left edge, the head
       * identifies, the body speaks, and neither is squeezed into the
       * other's column.
       */
      return '<div class="tma-portal-viewer__comment" data-comment="' + esc(c.id) + '">' +
        '<div class="tma-portal-viewer__comment-top">' +
          '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(c.author)) + '" alt="" width="24" height="24">' +
          '<div class="tma-portal-viewer__comment-head">' +
            '<span class="tma-portal-viewer__comment-name"><strong>' + esc(who) + '</strong>' +
            (c.editedAt ? '<span class="tma-portal-viewer__comment-flag">edited</span>' : '') +
            (c.resolved ? '<span class="tma-portal-viewer__comment-flag tma-portal-viewer__comment-flag--ok">Resolved' +
              (c.resolvedBy ? ' by ' + esc(c.resolvedBy) : '') + '</span>' : '') +
            '</span>' +
            '<time datetime="' + esc(c.createdAt) + '">' + esc(fmtDateTime(c.createdAt)) + '</time>' +
          '</div>' +
          (hover ? '<div class="tma-portal-viewer__hover-acts">' + hover + '</div>' : '') +
        '</div>' +
        (c.anchor
          ? '<button type="button" class="tma-portal-viewer__anchor-tag" data-lb-anchor-show="' + esc(c.id) + '"' +
            ' data-anchor="' + esc(JSON.stringify(c.anchor)) + '">' +
            'Highlighted area' + (c.anchor.page > 1 ? ' · page ' + c.anchor.page : '') + '</button>'
          : '') +
        body +
        (actions ? '<div class="tma-portal-viewer__comment-actions">' + actions + '</div>' : '') +
      '</div>';
    }

    /**
     * Escape first, then wrap the mentioned names.
     *
     * The body is plain text from the server and is escaped here before any
     * markup is added, so a comment can never inject HTML into someone else's
     * viewer, the highlight is applied to the *escaped* string.
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
          '<div class="tma-portal-viewer__mention-pop" data-lb-mentions hidden></div>' +
          '<div class="tma-portal-viewer__composer-actions">' +
            '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-replycancel>Cancel</button>' +
            '<button type="button" class="tma-portal-viewer__btn" data-lb-replysend="' + esc(t.id) + '">Reply</button>' +
          '</div>' +
        '</div>';
      }
      // The collapsed Reply now sits in the opening comment's action row; all
      // that is left down here is the box it opens.
      return '';
    }

    function composerHtml(f, e) {
      if (e.comments && e.comments.canComment === false) {
        return '<p class="tma-portal-viewer__empty">You can view this discussion but not add to it.</p>';
      }

      var me = (window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get()) || {};
      var pending = e.pendingAnchor;

      // Nothing until asked for, the button above or a highlight opens it.
      if (!e.composerOpen && !pending) return '';

      return '<div class="tma-portal-viewer__composer" data-lb-composer>' +
        // The author's own face and name over the box, so the composer reads
        // as "you, about to speak" rather than an anonymous form.
        '<div class="tma-portal-viewer__composer-who">' +
          '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor({ name: me.name, avatar: me.avatarUrl || me.avatar })) + '" alt="" width="24" height="24">' +
          '<strong>' + esc(me.name || 'You') + '</strong>' +
        '</div>' +
        (pending
          ? '<div class="tma-portal-viewer__anchor-chip" data-lb-anchor-chip>' +
            'On a highlighted area' + (pending.page > 1 ? ' · page ' + pending.page : '') +
            '<button type="button" data-lb-anchor-clear aria-label="Remove the highlight">×</button></div>'
          : '') +
        // "Use @ to mention someone" was a second sentence teaching a
        // convention every messaging surface in the portal already uses, sat
        // in front of an empty box on every single file.
        '<textarea class="tma-portal-viewer__input" data-lb-input rows="3" ' +
          'placeholder="Comment or add others with @"></textarea>' +
        '<div class="tma-portal-viewer__mention-pop" data-lb-mentions hidden></div>' +
        '<div class="tma-portal-viewer__composer-actions">' +
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-emoji title="Insert emoji" aria-label="Insert emoji">🙂</button>' +
          '<span class="tma-portal-viewer__composer-spacer"></span>' +
          // Cancel and Send sit in a row with a gap. §16 asks specifically
          // that the clear control never overlap the send control.
          '<button type="button" class="tma-portal-viewer__btn-ghost" data-lb-clear>Cancel</button>' +
          '<button type="button" class="tma-portal-viewer__btn" data-lb-send>Comment</button>' +
        '</div>' +
      '</div>';
    }

    /* Draft survives a tab switch, losing half a typed comment because you
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

      var anchor = e.pendingAnchor || null;

      input.value = '';
      e.draft = '';
      e.pendingMentions = [];
      e.pendingAnchor = null;
      // Said and sent: the box goes away until it is asked for again.
      e.composerOpen = false;
      clearAnchorOverlay();

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments'), {
        method: 'POST',
        json: { body: body, mentions: mentions.map(function (m) { return m.id; }), anchor: anchor },
      })
        .then(function () {
          e.comments = null;
          // The whole column, not just the feed: the composer has to leave
          // the screen with the words it delivered.
          var cbody = lb.querySelector('[data-lb-comments-body]');
          if (cbody) paintComments(cbody);
          else loadComments(f);
        })
        .catch(function (err) {
          // Give the words back rather than losing them to a failed request.
          e.draft = body;
          e.pendingAnchor = anchor;
          e.composerOpen = true;
          var cbody = lb.querySelector('[data-lb-comments-body]');
          if (cbody) paintComments(cbody);
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

      // The same rule as the composer: only names still in the text count.
      var mentions = (e.pendingMentions || []).filter(function (m) {
        return body.indexOf(m.name) !== -1;
      });
      e.pendingMentions = [];

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/comments'), {
        method: 'POST',
        json: { body: body, parent: threadId, mentions: mentions.map(function (m) { return m.id; }) },
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

    /**
     * "Will be given access", against anyone the file hasn't reached yet.
     *
     * Whoever may share a file may add anyone to it, and that person is granted
     * access as they are added. Saying so on the row is what keeps that from
     * being a surprise: the sender learns it while choosing, not afterwards
     * from the Access panel.
     */
    function grantNoteHtml(p) {
      if (p.hasAccess !== false) return '';

      return '<span class="tma-portal-viewer__member-role">Will be given access</span>';
    }

    function onComposerInput(input) {
      var f = current();
      var e = entry(f);
      // Only the main composer keeps a draft; a reply box lives and dies
      // with its thread.
      if (input.hasAttribute('data-lb-input')) e.draft = input.value;

      var upto = input.value.slice(0, input.selectionStart);
      var m = /@([\w' -]{0,40})$/.exec(upto);
      // The pop that belongs to THIS box, the reply box carries its own, or
      // @ing in a reply would open the suggestion list under the composer.
      var box = input.closest('[data-lb-composer], .tma-portal-viewer__replybox');
      var pop = box && box.querySelector('[data-lb-mentions]');
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
              grantNoteHtml(p) +
            '</button>';
          }).join('');
          pop.hidden = false;
        })
        .catch(function () { pop.hidden = true; });
    }

    function insertMention(id, name, item) {
      var f = current();
      var e = entry(f);
      // The box the suggestion list belongs to, composer or a reply.
      var box = item && item.closest('[data-lb-composer], .tma-portal-viewer__replybox');
      var input = (box && box.querySelector('textarea')) || lb.querySelector('[data-lb-input]');
      var pop = box && box.querySelector('[data-lb-mentions]');
      if (!input) return;

      var pos = input.selectionStart;
      var before = input.value.slice(0, pos).replace(/@([\w' -]{0,40})$/, '');
      var after = input.value.slice(pos);
      input.value = before + '@' + name + ' ' + after;
      input.focus();
      var caret = (before + '@' + name + ' ').length;
      input.setSelectionRange(caret, caret);

      e.pendingMentions = (e.pendingMentions || []).concat([{ id: parseInt(id, 10), name: name }]);
      if (input.hasAttribute('data-lb-input')) e.draft = input.value;
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

    /**
     * A database value, said out loud.
     *
     * The approval chip printed the column verbatim, so a version sat there
     * labelled "changes_requested", the underscore and all. Done generically
     * rather than as a lookup table so a status added later reads properly
     * instead of leaking through the same way this one did.
     */
    function statusLabel(value) {
      var words = String(value || '').replace(/[_-]+/g, ' ').trim();

      return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
    }

    function versionsHtml(data, f) {
      var list = (data && data.versions) || [];
      if (!list.length) return '<p class="tma-portal-viewer__empty">No version history for this file.</p>';

      /*
       * Drop target as well as a button.
       *
       * The hint earns its line: dragging a file here is otherwise invisible,
       * and the alternative, dragging onto the file list behind, adds a
       * separate file to the folder rather than a version of this one.
       */
      var head = data.canAddVersion
        ? '<div class="tma-portal-viewer__vdrop" data-lb-vdrop>' +
            '<button type="button" class="tma-portal-viewer__btn tma-portal-viewer__version-add" data-lb-newversion>' +
              'Upload new version</button>' +
            '<p class="tma-portal-viewer__vdrop-hint">or drop a file here</p>' +
          '</div>' +
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
              (v.approvalStatus ? '<span class="tma-portal-viewer__comment-flag">' + esc(statusLabel(v.approvalStatus)) + '</span>' : '') +
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
     * The review picker, from the panel's own button.
     *
     * The states, the PATCH and the picker itself are shared with the row
     * menu, see openReviewStatusMenu. All this adds is where it hangs and
     * what to repaint: the panel first, then the list behind it, because
     * closing the viewer must not reveal a row still showing the badge this
     * just changed.
     */
    function openReviewMenu(anchor) {
      var box = anchor.getBoundingClientRect();

      openReviewStatusMenu(box.left, box.bottom + 4, current(), function () {
        paintPanel();
        load(true);
      });
    }

    /**
     * Uploading a new version. The note is asked for BEFORE the bytes go up,
     * because §5 wants the reason recorded, and asking afterwards means a
     * large upload finishes with nothing to say about it.
     */
    function pickNewVersion() {
      var input = lb.querySelector('[data-lb-versionfile]');
      if (input) input.click();
    }

    /**
     * Dropping a file onto the versions panel.
     *
     * Bound once on the viewer rather than per render, since the panel is
     * rebuilt on every tab switch and refresh, binding inside versionsHtml
     * would stack a listener each time.
     *
     * stopPropagation on both: the window-level folder drop is already stood
     * down while the viewer is open, but a drag that starts here should not
     * reach it even if that guard is ever relaxed.
     */
    function bindVersionDrop() {
      var zoneFor = function (e) {
        return e.target && e.target.closest ? e.target.closest('[data-lb-vdrop]') : null;
      };

      lb.addEventListener('dragover', function (e) {
        var zone = zoneFor(e);
        if (!zone || !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('is-over');
      });

      lb.addEventListener('dragleave', function (e) {
        var zone = zoneFor(e);
        // Leaving for a child of the zone is not leaving the zone.
        if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
      });

      lb.addEventListener('drop', function (e) {
        var zone = zoneFor(e);
        if (!zone || !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-over');

        var files = (e.dataTransfer && e.dataTransfer.files) || [];
        if (!files.length) return;

        // A version is one file. Saying so beats silently ignoring the rest,
        // and beats uploading five versions of the same document at once.
        if (files.length > 1) {
          ui().toast('Drop one file, a version replaces a single document.', false);

          return;
        }

        uploadNewVersion(files[0]);
      });
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
          'Nothing is deleted, every later version stays in the history.',
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
     * bytes after an upload, which reads as the upload having failed. */
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
          refreshApprovalCount(data);
          // The header badge belongs to the file, not to this tab.
          f.workflowBadge = data.badge;
          var head = lb.querySelector('.tma-portal-viewer__head');
          if (head) head.outerHTML = viewerHead(f);
        })
        .catch(function (err) { panelError('[data-lb-approvals]', err, 'requests'); });
    }

    /**
     * The Approvals tab label, on the same terms as Comments.
     *
     * The count came only from /details, which is fetched once when the viewer
     * opens, so sending a request left the tab unnumbered, and answering the
     * last one left it claiming work that was finished. Both are read as the
     * request having failed. The count is written back into the cached details
     * as well as onto the label, because the tab row is rebuilt from that cache
     * on every panel repaint and would otherwise revert on the next tab switch.
     */
    function refreshApprovalCount(data) {
      var n = (data && data.openCount) || 0;

      var e = entry(current());
      if (e.details && e.details.counts) e.details.counts.approvals = n;

      var label = lb.querySelector('[data-lb-tab="approvals"] .tma-tab__label');
      if (!label) return;
      label.textContent = n ? 'Approvals (' + n + ')' : 'Approvals';
    }

    function approvalsHtml(data) {
      var list = (data && data.workflows) || [];
      var html = '';

      /*
       * One primary action, the rest as text.
       *
       * These were five buttons of near-equal weight wrapping onto two lines,
       * which asked the reader to first work out the difference between
       * Feedback, Review and Acknowledge before doing the thing they came for.
       * Approval is what this panel is called and what people overwhelmingly
       * want; the others stay one click away, just not competing for the eye.
       */
      if (data.canSend) {
        var others = [
          { type: 'feedback', label: 'feedback' },
          { type: 'review', label: 'review' },
          { type: 'acknowledgement', label: 'acknowledgement' },
        ].map(function (o) {
          return '<button type="button" class="tma-portal-viewer__comment-act" data-lb-send-wf="' +
            o.type + '">' + o.label + '</button>';
        }).join('');

        html += '<div class="tma-portal-viewer__send">' +
          '<button type="button" class="tma-portal-viewer__btn" data-lb-send-wf="approval">Send for approval</button>' +
          '<p class="tma-portal-viewer__send-alt">or ask for ' + others + '</p>' +
          (canSignHere(current())
            ? '<p class="tma-portal-viewer__send-alt">' +
              '<button type="button" class="tma-portal-viewer__comment-act" data-lb-send-signature>Send for signature</button>' +
              '</p>'
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
      /*
       * Per-person outcomes only when there is more than one person.
       *
       * With a single reviewer the badge above already says how it went, so
       * the line read "Completed … Responded" and "Changes requested …
       * Requested changes", the same fact twice, in two different wordings,
       * which invites the reader to look for the difference between them.
       * With several people it is the only place you can see who did what.
       */
      var people = w.steps || [];
      var answered = people.filter(hasAnswered).length;
      var showOutcome = people.length > 1;

      var steps = people.map(function (s) {
        return '<div class="tma-portal-viewer__member">' +
          '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(s)) + '" alt="" width="24" height="24">' +
          '<span class="tma-portal-viewer__member-text">' +
            '<strong>' + esc(s.name || s.email || 'Someone') + '</strong>' +
            (s.comment ? '<span class="tma-portal-viewer__member-email">“' + esc(s.comment) + '”</span>' : '') +
          '</span>' +
          (showOutcome || s.delegatedFrom
            ? '<span class="tma-portal-viewer__member-role">' + esc(s.statusLabel) +
              (s.delegatedFrom ? ' (delegated)' : '') + '</span>'
            : '') +
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

      /*
       * The settings only while they still govern something.
       *
       * "One at a time", "Any one response settles it", "File locked",
       * "Reminders every 3d" describe how a request will be *run*. Once it has
       * finished they are answers to questions nobody is asking, sitting above
       * the outcome somebody opened the panel to read.
       *
       * The version is dropped from this line entirely: it said "Reviewing
       * version 1" on every request, including the overwhelming case where
       * version 1 is simply the file. When a newer version does exist,
       * supersededBy says so below in a full sentence, which is the only time
       * it changes what the badge means.
       */
      var notes = [];
      if (w.isOpen) {
        if (w.ordered) notes.push('One at a time');
        if (!w.requireAll) notes.push('Any one response settles it');
        if (w.lockFile) notes.push('File locked');
        if (w.reminderDays) notes.push('Reminders every ' + w.reminderDays + 'd');
      }

      var headline = workflowHeadline(w);

      /*
       * Type and timing as one quiet line under the headline.
       *
       * Both were competing with the status for attention up top, a bold
       * type name and a full timestamp on the same row as the badge, three
       * things of equal weight and no obvious reading order. They are context
       * for the sentence above, so they read as context.
       */
      var sub = [cap(w.type)];
      if (w.isOpen && w.dueAt) sub.push((w.overdue ? 'overdue since ' : 'due ') + relativeWhen(w.dueAt));
      else if (w.sentAt) sub.push('sent ' + relativeWhen(w.sentAt));

      // Progress, but only where there is any to report. With one reviewer
      // "0 of 1 responded" is the headline again, in arithmetic.
      var progress = people.length > 1
        ? '<p class="tma-portal-viewer__wf-progress">' + answered + ' of ' + people.length + ' responded</p>'
        : '';

      return '<div class="tma-portal-viewer__workflow' + (w.myStep && w.isOpen ? ' is-mine' : '') + '">' +
        '<p class="tma-portal-viewer__wf-headline tma-portal-viewer__wf-headline--' + esc(headline.tone) + '">' +
          esc(headline.text) +
        '</p>' +
        '<p class="tma-portal-viewer__wf-sub"' +
          (w.dueAt ? ' title="Due ' + esc(fmtDateTime(w.dueAt)) + '"' : '') + '>' +
          esc(sub.join(' · ')) +
        '</p>' +
        (w.message ? '<p class="tma-portal-viewer__version-note">' + esc(w.message) + '</p>' : '') +
        // §6: when a newer version exists, say so rather than letting the
        // badge imply the file as it stands today was approved.
        (w.supersededBy
          ? '<p class="tma-portal-viewer__lock">Version ' + w.supersededBy +
            ' has been uploaded since this was sent. This request still refers to version ' + w.version + '.</p>'
          : '') +
        (notes.length ? '<p class="tma-portal-viewer__version-meta">' + esc(notes.join(' · ')) + '</p>' : '') +
        progress +
        '<div class="tma-portal-viewer__source-members">' + steps + '</div>' +
        (w.signedFile
          ? '<p class="tma-portal-viewer__version-meta">Signed copy: ' +
            '<a href="' + esc(w.signedFile.downloadUrl) + '" download>' + esc(w.signedFile.name) + '</a>' +
            ', the original is unchanged.</p>'
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
          'the signature fields on the document. The original file is never changed, ' +
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

    /** Has this person answered yet? */
    function hasAnswered(step) {
      return step.status !== 'pending' && step.status !== 'invited';
    }

    /**
     * "in 2 days", "2 days ago", "today".
     *
     * A deadline is a question about *how long is left*, and an exact
     * timestamp makes the reader do that arithmetic against today's date
     * before they know whether to worry. The full date stays on the title
     * attribute for anyone who wants it.
     */
    function relativeWhen(iso) {
      var then = new Date(iso);
      if (isNaN(then)) return '';

      var days = Math.round((then - new Date()) / 86400000);

      if (days === 0) return 'today';
      if (days === 1) return 'tomorrow';
      if (days === -1) return 'yesterday';

      var n = Math.abs(days);
      if (n < 31) return days > 0 ? 'in ' + n + ' days' : n + ' days ago';

      var months = Math.round(n / 30);

      return days > 0
        ? 'in ' + months + (months === 1 ? ' month' : ' months')
        : months + (months === 1 ? ' month' : ' months') + ' ago';
    }

    /**
     * The one sentence this request is about.
     *
     * A beginner opening this panel is asking two things: what is happening,
     * and is it on me? "Awaiting approval" against a status chip answers
     * neither, it names an internal state and leaves them to work out who is
     * holding it up. So the request leads with a sentence instead: whose turn
     * it is, by name where there is a single name to give.
     */
    function workflowHeadline(w) {
      if (w.myStep && w.isOpen) {
        return { text: 'Your response is needed', tone: 'action' };
      }

      if (!w.isOpen) {
        return { text: w.statusLabel, tone: w.tone };
      }

      var waiting = (w.steps || []).filter(function (s) { return !hasAnswered(s); });

      if (waiting.length === 1) {
        return { text: 'Waiting on ' + (waiting[0].name || waiting[0].email || 'someone'), tone: w.tone };
      }

      if (waiting.length > 1) {
        return { text: 'Waiting on ' + waiting.length + ' people', tone: w.tone };
      }

      return { text: w.statusLabel, tone: w.tone };
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
            'placeholder="Search people">' +
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
            // Reuses the mention endpoint, which answers the same question:
            // who may this person add to this file. Anyone the file has not
            // reached yet is offered too, and told so on the row.
            net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id) + '/mentionable?q=' + encodeURIComponent(q)))
              .then(function (data) {
                var people = (data && data.people) || [];
                if (!people.length) { results.hidden = true; return; }
                results.innerHTML = people.map(function (p) {
                  return '<button type="button" class="tma-portal-viewer__mention-item" data-wf-pick="' + p.id +
                    '" data-name="' + esc(p.name) + '">' +
                    '<img class="tma-portal-viewer__avatar" src="' + esc(avatarFor(p)) + '" alt="" width="22" height="22">' +
                    '<span><strong>' + esc(p.name) + '</strong>' +
                    '<span class="tma-portal-viewer__member-email">' + esc(p.email) + '</span></span>' +
                    grantNoteHtml(p) + '</button>';
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
                  // the chips show, so an ordered flow matches the list.
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
          // fallback single option, so repopulate once it arrives, guarding
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

      /*
       * The same hover card as the table's faces and CBI's Assigned column:
       * the person's name, the role they hold here, and a way to reach them.
       * A title attribute said as much in a tooltip you cannot click.
       *
       * The card resolves a face through the data-tma-people wrapper below, so
       * the people are serialised in the shape it reads. `via` already
       * describes how each of them reaches this file, which is the role.
       */
      var cardPeople = (shared.faces || []).map(function (p) {
        return {
          name: p.name || p.email || 'Someone',
          email: p.email,
          avatar: avatarFor(p),
          userId: p.userId || p.id,
          roles: [p.role, p.via].filter(Boolean),
        };
      });

      var faces = cardPeople.map(function (p, i) {
        return '<img class="tma-portal-viewer__avatar tma-portal-viewer__avatar--stack" ' +
          'src="' + esc(p.avatar) + '" alt="" width="30" height="30" ' +
          'data-tma-person="' + i + '" tabindex="0" title="' + esc(p.name) + '">';
      }).join('');

      var extra = shared.extra > 0
        ? '<span class="tma-portal-viewer__avatar-more tma-portal-viewer__avatar-more--lg">+' + shared.extra + '</span>'
        : '';

      return '<div class="tma-portal-viewer__shared" data-tma-people="' +
          esc(JSON.stringify(cardPeople)) + '">' +
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

      // When access comes from a rule rather than a list, everyone on staff,
      // the client team, say so, and be honest that the faces are a sample
      // rather than pretending the list is complete.
      var note = shared.total > people.length
        ? '<p class="tma-portal-viewer__empty">' + esc(shared.summary) + ', showing ' +
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

    // Hover reveals name, email, role and permission. §19.
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

      // Flipping through the rail is navigation too, reloading on the third
      // file should reopen the third file, not the one first clicked.
      state.openFile = f.id;
      syncUrl();

      // Only the regions that depend on the file change; the panel keeps its
      // tab and the reader keeps their place in the shell.
      var head = lb.querySelector('.tma-portal-viewer__head');
      if (head) head.outerHTML = viewerHead(f);

      // Left rail can switch between page thumbs (PDF) and file thumbs.
      syncLeftRail(f);

      repaintStage(f);
      startPresence(f);
      var foot = lb.querySelector('[data-lb-foot]');
      if (foot) foot.innerHTML = footHtml(f);

      paintPanel();
      if (viewerPrefs.comments) paintCommentsPanel();
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
      stage.classList.toggle(
        'tma-portal-viewer__stage--pdf',
        f.category === 'pdf' && f.previewUrl && perm(f, 'preview')
      );
      stage.innerHTML = lightboxBody(f);
      if (f.previewable && f.category === 'text' && f.previewUrl) loadText(f);
      mountPdf(f);
      swapFullImage(stage);
    }

    /* Put the real image in once it has decoded, so the picture never flashes
     * empty on the way from thumbnail to full size. */
    function swapFullImage(stage) {
      var img = stage && stage.querySelector('[data-lb-full]');
      if (!img) return;

      var full = img.getAttribute('data-lb-full');
      var loader = new Image();
      loader.decoding = 'async';
      loader.onload = function () {
        if (!img.isConnected) return;
        img.src = full;
        img.classList.remove('is-preview');
        img.removeAttribute('data-lb-full');
      };
      loader.src = full;
    }

    /* ── PDF via pdf.js, continuous scroll, floating toolbar ── */

    var PDF_ZOOM_STEP = 1.25;
    var PDF_ZOOM_MIN = 0.25;
    var PDF_ZOOM_MAX = 4;

    /* Scale for a given mode relative to the scroll container width/height. */
    function pdfEffectiveScale(e, scrollEl, vp1) {
      var pad = 32;
      var w = Math.max(120, scrollEl.clientWidth - pad);
      var h = Math.max(120, scrollEl.clientHeight - pad);
      var fitWidth = w / vp1.width;
      var fitPage  = Math.min(fitWidth, h / vp1.height);
      if (e.pdfZoomMode === 'page')   return fitPage;
      if (e.pdfZoomMode === 'custom') return fitPage * e.pdfZoomScale;
      return fitPage; // default / 'page'
    }

    function pdfUpdateToolbar(f) {
      var e = entry(f);
      var host = lb.querySelector('[data-lb-pdf]');
      if (!host || !e.pdfDoc) return;
      var toolbar = host.querySelector('[data-lb-pdf-toolbar]');
      if (toolbar) toolbar.hidden = false;

      var pageLabel = host.querySelector('[data-lb-pdf-page-label]');
      if (pageLabel) pageLabel.textContent = e.pdfPage + ' / ' + e.pdfDoc.numPages;

      var zoomLabel = host.querySelector('[data-lb-pdf-zoom-label]');
      if (zoomLabel) {
        var pct = e.pdfZoomMode === 'custom' ? Math.round(e.pdfZoomScale * 100) : 'Fit';
        zoomLabel.textContent = pct + (e.pdfZoomMode === 'custom' ? '%' : '');
      }
    }

    function pdfZoomIn(f) {
      var e = entry(f);
      if (!e.pdfDoc) return;
      if (e.pdfZoomMode !== 'custom') {
        // Leaving fit-page: seed the scale at 1× (fit-page), then step up.
        e.pdfZoomMode = 'custom';
        e.pdfZoomScale = 1;
      }
      e.pdfZoomScale = Math.min(PDF_ZOOM_MAX, e.pdfZoomScale * PDF_ZOOM_STEP);
      renderAllPdfPages(f);
    }

    function pdfZoomOut(f) {
      var e = entry(f);
      if (!e.pdfDoc) return;
      if (e.pdfZoomMode !== 'custom') {
        e.pdfZoomMode = 'custom';
        e.pdfZoomScale = 1;
      }
      e.pdfZoomScale = Math.max(PDF_ZOOM_MIN, e.pdfZoomScale / PDF_ZOOM_STEP);
      renderAllPdfPages(f);
    }

    function pdfFitWidth(f) {
      var e = entry(f);
      e.pdfZoomMode = 'width';
      e.pdfZoomScale = 1;
      renderAllPdfPages(f);
    }

    function pdfFitPage(f) {
      var e = entry(f);
      e.pdfZoomMode = 'page';
      e.pdfZoomScale = 1;
      renderAllPdfPages(f);
    }

    /* Render all pages into the scroll container as a vertical stack. */
    function renderAllPdfPages(f) {
      var e = entry(f);
      var pdf = e.pdfDoc;
      var host = lb.querySelector('[data-lb-pdf]');
      var scroll = host && host.querySelector('[data-lb-pdf-scroll]');
      if (!pdf || !scroll) return;

      // Measure scale from page 1's viewport.
      pdf.getPage(1).then(function (firstPage) {
        if (current().id !== f.id) return;
        var vp1 = firstPage.getViewport({ scale: 1 });
        var scale = pdfEffectiveScale(e, scroll, vp1);
        var dpr = window.devicePixelRatio || 1;

        // Remove old canvases, rebuild.
        scroll.innerHTML = '';

        for (var p = 1; p <= pdf.numPages; p++) {
          (function (pageNum) {
            var canvas = document.createElement('canvas');
            canvas.setAttribute('data-lb-pdf-canvas', pageNum);
            canvas.style.display = 'block';
            canvas.style.margin = '0 auto';
            canvas.style.borderRadius = '0';
            scroll.appendChild(canvas);

            pdf.getPage(pageNum).then(function (page) {
              if (current().id !== f.id) return;
              var viewport = page.getViewport({ scale: scale * dpr });
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
              canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
              if (canvas._pdfTask) canvas._pdfTask.cancel();
              var task = page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
              canvas._pdfTask = task;
              return task.promise.then(
                function () { canvas._pdfTask = null; },
                function (err) {
                  canvas._pdfTask = null;
                  if (err && err.name !== 'RenderingCancelledException') throw err;
                }
              );
            }).catch(function () { /* best-effort */ });
          })(p);
        }

        pdfUpdateToolbar(f);
        attachPdfScrollTracker(f, scroll);
      }).catch(function () {});
    }

    /* Update the active page indicator as the user scrolls continuously. */
    function attachPdfScrollTracker(f, scroll) {
      // Remove any old listener on this scroll container.
      if (scroll._pdfScrollOff) { scroll._pdfScrollOff(); scroll._pdfScrollOff = null; }

      function onScroll() {
        var e = entry(f);
        if (!e.pdfDoc) return;
        var scrollMid = scroll.scrollTop + scroll.clientHeight / 2;
        var best = 1;
        var bestDist = Infinity;
        for (var n = 1; n <= e.pdfDoc.numPages; n++) {
          var canvas = scroll.querySelector('[data-lb-pdf-canvas="' + n + '"]');
          if (!canvas) continue;
          var mid = canvas.offsetTop + canvas.offsetHeight / 2;
          var dist = Math.abs(mid - scrollMid);
          if (dist < bestDist) { bestDist = dist; best = n; }
        }
        if (best !== e.pdfPage) {
          e.pdfPage = best;
          // Update left-rail highlights.
          lb.querySelectorAll('[data-lb-pdf-page]').forEach(function (btn) {
            var n = parseInt(btn.getAttribute('data-lb-pdf-page'), 10);
            btn.classList.toggle('is-current', n === best);
            btn.setAttribute('aria-current', n === best ? 'true' : 'false');
            if (n === best) { btn.scrollIntoView({ block: 'nearest' }); }
          });
          // Update floating toolbar page label.
          var pageLabel = scroll.closest('[data-lb-pdf]') &&
            scroll.closest('[data-lb-pdf]').querySelector('[data-lb-pdf-page-label]');
          if (pageLabel) pageLabel.textContent = best + ' / ' + e.pdfDoc.numPages;
        }
      }

      scroll.addEventListener('scroll', onScroll, { passive: true });
      scroll._pdfScrollOff = function () {
        scroll.removeEventListener('scroll', onScroll);
      };
    }

    function mountPdf(f) {
      if (!f || f.category !== 'pdf' || !f.previewUrl || !perm(f, 'preview')) return;
      var host = lb.querySelector('[data-lb-pdf]');
      if (!host) return;

      var e = entry(f);
      var loading = host.querySelector('[data-lb-pdf-loading]');

      var ready = (e.pdfDoc && e.pdfUrl === f.previewUrl)
        ? Promise.resolve(e.pdfDoc)
        : loadPdfDocument(f.previewUrl).then(function (pdf) {
            if (current().id !== f.id) {
              if (pdf && pdf.destroy) { try { pdf.destroy(); } catch (err) { /* ignore */ } }
              return null;
            }
            if (e.pdfDoc && e.pdfDoc.destroy) {
              try { e.pdfDoc.destroy(); } catch (err) { /* ignore */ }
            }
            e.pdfDoc = pdf;
            e.pdfUrl = f.previewUrl;
            e.pdfPage = 1;
            e.pdfZoomMode = 'page'; // always open fit-page
            e.pdfZoomScale = 1;
            return pdf;
          });

      ready
        .then(function (pdf) {
          if (!pdf || current().id !== f.id) return;
          if (loading) loading.hidden = true;
          paintPdfThumbs(f, pdf);
          // Two-frame wait: first frame lets the scroll container get its height
          // from flexbox, second ensures the layout has settled.
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              if (current().id === f.id && entry(f).pdfDoc) renderAllPdfPages(f);
            });
          });
        })
        .catch(function (err) {
          if (current().id !== f.id) return;
          if (loading) {
            loading.hidden = false;
            loading.textContent = err && err.name === 'InvalidPDFException'
              ? 'This file is not a valid PDF.'
              : 'Could not load this PDF.';
          }
        });
    }

    function paintPdfThumbs(f, pdf) {
      var rail = lb.querySelector('[data-lb-pages]');
      if (!rail) return;
      var e = entry(f);
      var html = '';
      for (var i = 1; i <= pdf.numPages; i++) {
        html += '<button type="button" class="tma-portal-viewer__page' +
          (i === e.pdfPage ? ' is-current' : '') + '" data-lb-pdf-page="' + i + '"' +
          ' aria-label="Page ' + i + '" aria-current="' + (i === e.pdfPage) + '">' +
          '<canvas class="tma-portal-viewer__page-canvas" data-lb-pdf-thumb="' + i + '"></canvas>' +
          '<span class="tma-portal-viewer__page-num">' + i + '</span>' +
        '</button>';
      }
      rail.innerHTML = html;

      var thumbWidth = Math.max(120, rail.clientWidth - 32);

      for (var p = 1; p <= pdf.numPages; p++) {
        (function (pageNum) {
          pdf.getPage(pageNum).then(function (page) {
            if (current().id !== f.id) return;
            var canvas = rail.querySelector('[data-lb-pdf-thumb="' + pageNum + '"]');
            if (!canvas) return;
            var cssWidth = thumbWidth;
            var unscaled = page.getViewport({ scale: 1 });
            var scale = cssWidth / unscaled.width;
            var viewport = page.getViewport({ scale: scale });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
          }).catch(function () { /* thumb best-effort */ });
        })(p);
      }
    }

    /* Scroll to a page in the continuous view, used by left-rail clicks. */
    function renderPdfPage(f, pageNum) {
      var e = entry(f);
      var pdf = e.pdfDoc;
      if (!pdf) return;
      var host = lb.querySelector('[data-lb-pdf]');
      var scroll = host && host.querySelector('[data-lb-pdf-scroll]');
      if (!scroll) return;

      e.pdfPage = pageNum;
      lb.querySelectorAll('[data-lb-pdf-page]').forEach(function (btn) {
        var n = parseInt(btn.getAttribute('data-lb-pdf-page'), 10);
        btn.classList.toggle('is-current', n === pageNum);
        btn.setAttribute('aria-current', n === pageNum ? 'true' : 'false');
      });

      // Scroll the canvas for that page into view.
      var canvas = scroll.querySelector('[data-lb-pdf-canvas="' + pageNum + '"]');
      if (canvas) canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pdfUpdateToolbar(f);
    }

    /** @returns {boolean} true when the key was consumed as a PDF page turn */
    function pdfNav(delta) {
      var f = current();
      if (!f || f.category !== 'pdf') return false;
      var e = entry(f);
      if (!e.pdfDoc || e.pdfDoc.numPages < 2) return false;
      var next = e.pdfPage + delta;
      if (next < 1 || next > e.pdfDoc.numPages) return false;
      renderPdfPage(f, next);
      return true;
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

      var pdfPageBtn = e.target.closest('[data-lb-pdf-page]');
      if (pdfPageBtn) {
        renderPdfPage(current(), parseInt(pdfPageBtn.getAttribute('data-lb-pdf-page'), 10) || 1);
        return;
      }
      if (e.target.closest('[data-lb-pdf-zoom-in]')) { pdfZoomIn(current()); return; }
      if (e.target.closest('[data-lb-pdf-zoom-out]')) { pdfZoomOut(current()); return; }

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
      var pick = e.target.closest('[data-lb-review-open]');
      if (pick) { openReviewMenu(pick); return; }
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
        insertMention(mention.getAttribute('data-lb-mention'), mention.getAttribute('data-name'), mention);
        return;
      }
      if (e.target.closest('[data-lb-send]')) { sendComment(); return; }
      if (e.target.closest('[data-lb-clear]')) {
        // Cancel puts the composer away entirely, it came out for a reason
        // that no longer holds.
        en.draft = '';
        en.pendingMentions = [];
        en.pendingAnchor = null;
        en.composerOpen = false;
        clearAnchorOverlay();
        var cbody = lb.querySelector('[data-lb-comments-body]');
        if (cbody) paintComments(cbody);
        return;
      }
      if (e.target.closest('[data-lb-emoji]')) { openEmojiPicker(); return; }

      if (e.target.closest('[data-lb-composer-open]')) {
        en.composerOpen = true;
        var chost = lb.querySelector('[data-lb-comments-body]');
        if (chost) paintComments(chost);
        var cinput = lb.querySelector('[data-lb-input]');
        if (cinput) cinput.focus();
        return;
      }

      /*
       * The bubble itself is the reply control: clicking anywhere in a
       * thread that is not already a button opens its reply box. The Reply
       * line stays for whoever looks for it, but the whole card answering to
       * a click is what a conversation feels like.
       */
      var bubble = e.target.closest('.tma-portal-viewer__thread');
      if (bubble && !e.target.closest('button, a, textarea, input, [data-lb-commentmenu-pop]')) {
        var tid = bubble.getAttribute('data-thread');
        if (tid && en.replyingTo !== tid) {
          en.replyingTo = tid;
          repaintComments(en);
          var rinput = lb.querySelector('[data-lb-replyinput]');
          if (rinput) rinput.focus();
          return;
        }
      }

      // The bubble's ⋯, open its little menu; any other click closes it.
      var menuBtn = e.target.closest('[data-lb-commentmenu]');
      if (menuBtn) {
        var pop = lb.querySelector('[data-lb-commentmenu-pop="' + menuBtn.getAttribute('data-lb-commentmenu') + '"]');
        lb.querySelectorAll('[data-lb-commentmenu-pop]').forEach(function (m) { if (m !== pop) m.hidden = true; });
        if (pop) pop.hidden = !pop.hidden;
        return;
      }
      if (!e.target.closest('[data-lb-commentmenu-pop]')) {
        lb.querySelectorAll('[data-lb-commentmenu-pop]').forEach(function (m) { m.hidden = true; });
      }

      // A highlighted-area tag: show the rectangle it names on the page.
      var anchorShow = e.target.closest('[data-lb-anchor-show]');
      if (anchorShow) {
        try { showAnchorOverlay(JSON.parse(anchorShow.getAttribute('data-anchor'))); } catch (err) {}
        return;
      }
      if (e.target.closest('[data-lb-anchor-clear]')) {
        en.pendingAnchor = null;
        clearAnchorOverlay();
        repaintComments(en);
        return;
      }

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
          paintCommentsPanel();
          return;
        case 'approvals':
          viewerPrefs.tab = 'approvals';
          viewerPrefs.panel = true;
          var apanel = lb.querySelector('[data-lb-panel]');
          if (apanel) apanel.hidden = false;
          var ahead = lb.querySelector('.tma-portal-viewer__head');
          if (ahead) ahead.outerHTML = viewerHead(current());
          paintPanel();
          paintCommentsPanel();
          return;
        case 'versions':
          viewerPrefs.tab = 'versions';
          viewerPrefs.panel = true;
          var vpanel = lb.querySelector('[data-lb-panel]');
          if (vpanel) vpanel.hidden = false;
          var vhead = lb.querySelector('.tma-portal-viewer__head');
          if (vhead) vhead.outerHTML = viewerHead(current());
          paintPanel();
          paintCommentsPanel();
          return;
        case 'comments': {
          // Adding a comment, not opening and closing: the button summons the
          // composer, and takes the details panel with it, since the two
          // share the same edge of the screen.
          viewerPrefs.comments = true;
          viewerPrefs.panel = false;
          var cpanel = lb.querySelector('[data-lb-panel]');
          if (cpanel) cpanel.hidden = true;
          var chead = lb.querySelector('.tma-portal-viewer__head');
          if (chead) chead.outerHTML = viewerHead(current());
          entry(f).composerOpen = true;
          paintCommentsPanel();
          var openedInput = lb.querySelector('[data-lb-input]');
          if (openedInput) openedInput.focus();
          return;
        }
        case 'more': return openViewerMenu(act, f);
      }
    });

    lb.addEventListener('input', function (e) {
      if (e.target.closest('[data-lb-input], [data-lb-replyinput]')) onComposerInput(e.target);
    });

    // Enter sends, Shift+Enter makes a new line. §16.
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
      else if (e.key === 'ArrowLeft') { if (!pdfNav(-1)) go(-1); }
      else if (e.key === 'ArrowRight') { if (!pdfNav(1)) go(1); }
      else if (e.key === '+' || e.key === '=') {
        if (current().category === 'pdf') { e.preventDefault(); pdfZoomIn(current()); }
      } else if (e.key === '-') {
        if (current().category === 'pdf') { e.preventDefault(); pdfZoomOut(current()); }
      }
    };
    document.addEventListener('keydown', lb._key);

    var pdfResizeTimer = null;
    function onPdfResize() {
      clearTimeout(pdfResizeTimer);
      pdfResizeTimer = setTimeout(function () {
        var cf = current();
        if (!cf || cf.category !== 'pdf' || !entry(cf).pdfDoc) return;
        renderAllPdfPages(cf);
      }, 150);
    }
    window.addEventListener('resize', onPdfResize);
    lb._pdfResize = function () {
      clearTimeout(pdfResizeTimer);
      window.removeEventListener('resize', onPdfResize);
    };

    function onPdfWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      var host = lb.querySelector('[data-lb-pdf]');
      if (!host || !host.contains(e.target)) return;
      e.preventDefault();
      var cf = current();
      if (!cf || cf.category !== 'pdf') return;
      if (e.deltaY < 0) pdfZoomIn(cf);
      else pdfZoomOut(cf);
    }
    lb.addEventListener('wheel', onPdfWheel, { passive: false });
    lb._pdfWheel = function () { lb.removeEventListener('wheel', onPdfWheel); };

    /* ── toolbar actions that need the viewer's own state ── */

    // Reuses the list's own star handler, so the optimistic flip, the busy
    // guard and the favourites-view removal all behave identically here.
    //
    // toggleStar() already flips `favorite` on the very object the viewer is
    // holding, they are the same reference. Flipping it again here turned the
    // button straight back to its old state.
    function favoriteFromViewer(f) {
      toggleStar(f.id);
      var head = lb.querySelector('.tma-portal-viewer__head');
      if (head) head.outerHTML = viewerHead(f);
    }

    // Reuses the list's delete flow, same confirmation wording, same recycle
    // semantics, then closes, since the file is no longer where we are.
    function deleteFromViewer(f) {
      if (!perm(f, 'delete')) { ui().toast('You can’t delete this file'); return; }
      closeLightbox();
      deleteItem(f);
    }

    /**
     * The three-dot menu is the SAME menu the file list uses, so the actions,
     * icons, ordering and styling can never drift apart, it just adds the
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
          paintCommentsPanel();
        },
      });

      var box = anchor.getBoundingClientRect();
      openContextMenu(box.right, box.bottom + 4, f, list);
    }

    paintShell();

    /* When the item was opened from outside the File Library (e.g. cip-intake's
     * "Open filed document") it arrives as a bare { id } stub with no category,
     * previewUrl or permissions.  The viewer has already rendered a shell so the
     * user sees a frame immediately, now fetch the full row and swap in the
     * real stage so the PDF (or image/text) loads exactly like normal. */
    (function resolveStub() {
      var f = current();
      if (f.category) return; // already a full row, nothing to do

      net().fetchJSON(net().url('/files/' + encodeURIComponent(f.id)))
        .then(function (row) {
          if (!lb || current().id !== f.id) return; // viewer was closed / moved on
          // Merge all server fields into the gallery entry in-place so that
          // `current()` immediately reflects the full shape.
          Object.keys(row).forEach(function (k) { gallery[idx][k] = row[k]; });
          var full = gallery[idx];

          // Stub shell had no category, so the PDF page rail was never painted.
          syncLeftRail(full);

          var head = lb.querySelector('.tma-portal-viewer__head');
          if (head) head.outerHTML = viewerHead(full);

          repaintStage(full);

          var foot = lb.querySelector('[data-lb-foot]');
          if (foot) foot.innerHTML = footHtml(full);
        })
        .catch(function () {
          // Best-effort, if the fetch fails the viewer is still usable for
          // non-preview actions (download, activity, etc.).
        });
    })();
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

  /*
   * The year only when it is not this one.
   *
   * Almost everything in a viewer panel happened recently, so "Aug 7, 2026 at
   * 3:58 PM" spent four characters on the one part nobody was asking about —
   * against every comment, version and activity row at once. An older file
   * still says which year, because there it is the whole question.
   */
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';

    // "Aug 18 at 3:07 AM", the date and the moment read as one phrase.
    var day = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) day.year = 'numeric';

    return d.toLocaleDateString(undefined, day) + ' at '
      + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function lightboxBody(f) {
    // SVG has a previewUrl (the hardened thumb) but isn't flagged previewable,
    // so key off previewUrl presence rather than the previewable flag.
    if (f.previewUrl && perm(f, 'preview')) {
      switch (f.category) {
        case 'image':
          /* The thumbnail we already hold, swapped for the real file once it
           * has decoded, a phone photo is megabytes and the stage used to sit
           * empty for all of them. See swapFullImage below. */
          return '<img class="tma-portal-viewer__img' + (f.thumbUrl ? ' is-preview' : '') +
            '" src="' + esc(f.thumbUrl || f.previewUrl) + '" alt="' + esc(f.name) + '" decoding="async"' +
            (f.thumbUrl ? ' data-lb-full="' + esc(f.previewUrl) + '"' : '') + '>';
        case 'pdf':
          return '<div class="tma-portal-viewer__pdf" data-lb-pdf>' +
            '<div class="tma-portal-viewer__pdf-scroll" data-lb-pdf-scroll></div>' +
            '<div class="tma-portal-viewer__pdf-toolbar" data-lb-pdf-toolbar hidden role="toolbar" aria-label="PDF controls">' +
              '<button type="button" class="tma-portal-viewer__pdf-tool" data-lb-pdf-zoom-out aria-label="Zoom out">' +
                '<img src="images/icons/phosphor/MagnifyingGlassMinus.svg" alt="" width="16" height="16">' +
              '</button>' +
              '<span class="tma-portal-viewer__pdf-zoom-label" data-lb-pdf-zoom-label>Fit</span>' +
              '<button type="button" class="tma-portal-viewer__pdf-tool" data-lb-pdf-zoom-in aria-label="Zoom in">' +
                '<img src="images/icons/phosphor/MagnifyingGlassPlus.svg" alt="" width="16" height="16">' +
              '</button>' +
              '<span class="tma-portal-viewer__pdf-tool-sep" aria-hidden="true"></span>' +
              '<span class="tma-portal-viewer__pdf-page-label" data-lb-pdf-page-label></span>' +
            '</div>' +
            '<p class="tma-portal-viewer__pdf-loading" data-lb-pdf-loading>Loading PDF…</p>' +
          '</div>';
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

  /** @param {boolean} [silent] Skip the URL update, see openLightbox. */
  function closeLightbox(silent) {
    if (!lb) return;
    if (!silent) {
      state.openFile = null;
      syncUrl();
    }
    if (lb._key) document.removeEventListener('keydown', lb._key);
    if (lb._pdfResize) lb._pdfResize();
    if (lb._pdfWheel) lb._pdfWheel();
    var pdfScroll = lb.querySelector('[data-lb-pdf-scroll]');
    if (pdfScroll && pdfScroll._pdfScrollOff) { pdfScroll._pdfScrollOff(); pdfScroll._pdfScrollOff = null; }
    if (lb._leave) lb._leave();
    // Leave the file's channel, or every file opened this session keeps a
    // subscription alive for the rest of the page's life.
    if (lb._channel && window.TMAMessagingRealtime) {
      window.TMAMessagingRealtime.leave(lb._channel);
    }
    // Drop any in-flight pdf.js document so closing the viewer frees memory.
    try {
      var pdfHost = lb.querySelector('[data-lb-pdf-canvas]');
      if (pdfHost && pdfHost._pdfTask) pdfHost._pdfTask.cancel();
    } catch (err) { /* ignore */ }
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
      case 'request-files': return requestFilesHere();
      case 'paste': return pasteClipboard();
      case 'refresh': return load();
      case 'sortdir': state.dir = state.dir === 'asc' ? 'desc' : 'asc'; return reload();
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

  /**
   * Ask somebody outside the portal to upload into a folder.
   *
   * Defaults to wherever the reader is standing, the toolbar button means
   * "collect files *here*", and to the named folder when it comes from that
   * folder's own menu. The shared dialog owns everything after that
   * (portal-file-requests.js); this only supplies the destination.
   */
  function requestFilesHere(item) {
    if (!window.TMAFileRequests) { ui().toast('Request Files isn’t available right now.'); return; }

    var folderId = item ? item.id : state.folder;
    var crumb = state.breadcrumb.length ? state.breadcrumb[state.breadcrumb.length - 1] : null;
    var folderName = item ? item.name : (crumb ? crumb.name : 'File Box');

    window.TMAFileRequests.open({
      folderId: folderId || null,
      folderName: folderName,
      title: folderId ? 'Documents for ' + folderName : 'Please upload your documents',
    });
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
            // Folder may already exist, fall back to the parent so files still land somewhere.
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
            // when the colour changes, this is the whole reason the two
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
          // second write sees the first, the response carries the merged row.
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
   * onConfirm, used for version notes, where §5 asks that the reason a
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
      return '<div class="tma-portal-details__row"><span class="tma-portal-details__label">' + esc(label) + '</span><span class="tma-portal-details__value">' + esc(value == null || value === '' ? '-' : value) + '</span></div>';
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
      rows += row('Extension', d.extension ? '.' + d.extension : '-');
      rows += row('MIME type', d.mime);
      rows += row('Size', d.sizeLabel);
      rows += row('Location', d.folder ? d.folder.name : 'File Box');
      rows += row('Uploaded', fmtDate(d.uploadedAt));
      rows += row('Modified', fmtDate(d.modifiedAt));
      rows += row('Uploaded by', d.uploadedBy ? d.uploadedBy.name : '-');
    } else {
      rows += row('Files', d.fileCount);
      rows += row('Subfolders', d.folderCount);
      rows += colourRow(d);
      rows += iconRow(d);
      rows += row('Total size', d.sizeLabel);
      rows += row('Location', d.parent ? d.parent.name : 'Top level');
      rows += row('Created', fmtDate(d.createdAt));
      rows += row('Modified', fmtDate(d.modifiedAt));
      rows += row('Created by', d.createdBy ? d.createdBy.name : '-');
    }
    rows += row('Owner', d.owner ? d.owner.name : '-');
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
  /* The Owner column: everyone on the row, owner first.
   *
   * A column of identical names is hard to scan; a face is recognised before
   * it is read. It used to draw the owner alone, which split the answer to
   * column saying the word "Shared". The faces put it in one place.
   *
   * Drawn by TMAPersonCard, the same component as CBI's Assigned column, so
   * hovering a face gives that person's roles here and a way to reach them.
   * Falls back to the owner's name alone if the component has not loaded. */
  function ownerCell(item) {
    var people = (item && item.people) || [];
    var owner = item && item.owner;

    if (!window.TMAPersonCard) {
      if (!owner) return '-';
      return '<span class="tma-portal-owner-cell">' +
        '<span class="tma-portal-owner-name">' + esc(owner.name || owner.email || '-') + '</span>' +
        '</span>';
    }

    // One person is worth naming; several are quicker to read as faces, and
    // hovering any of them says who it is. Four fit before the "+N" takes over,
    // which counts everyone rather than only the handful the server sent.
    return window.TMAPersonCard.faces(people, {
      max: 4,
      names: 'single',
      total: item && item.peopleTotal,
      emptyLabel: '-',
    });
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

  /* The flyout beside a parent entry. Only ever one. */
  var ctxSubEl = null;
  function closeContextMenu() {
    closeCtxSub();
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
    document.removeEventListener('click', onCtxDocClick);
    document.removeEventListener('contextmenu', onDocCtx, true);
    document.removeEventListener('keydown', onCtxKey);
    document.removeEventListener('scroll', closeContextMenu, true);
  }
  function onCtxKey(e) { if (e.key === 'Escape') closeContextMenu(); }
  function onDocCtx(e) { if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu(); }
  /* A click inside either menu is the menu's own business, closing on it
     would kill the flyout before its handler ran. */
  function onCtxDocClick(e) {
    if (e.target.closest('.tma-portal-context-menu')) return;
    closeContextMenu();
  }

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

  /*
   * A client document's review, from anywhere that lists one.
   *
   * The states and the PATCH used to live inside the viewer, which meant the
   * only way to move a document on was to open it. It is one field with a
   * fixed set of values and one endpoint, so it lives out here and the viewer
   * and the row menu both call it.
   */

  /* The states, in the order the process runs, the same four-status
     workflow the CIP checklist draws, minus Pending upload (a row here is
     already a file). */
  var REVIEW_STATES = [
    { id: 'application_review', label: 'Application review', icon: 'Eye' },
    { id: 'update_required', label: 'Update required', icon: 'ArrowUUpLeft' },
    { id: 'ready_for_submission', label: 'Ready for submission', icon: 'CheckCircle' },
  ];

  /* Only a document actually in a review, and only for a reader who may move
     it, the same two conditions the viewer's panel has always applied. */
  function canReview(item) {
    return !!(item && item.type !== 'folder' && item.review && item.review.status && item.review.canReview);
  }

  /**
   * Move a document to a review state.
   *
   * Sending it back asks for a reason before it goes, because the server
   * refuses one without it, and finding that out through an error message
   * after the click would be the interface hiding a rule it could have just
   * asked about. Every other move goes straight through.
   */
  function setItemReviewStatus(item, status, onDone) {
    var send = function (note) {
      net().fetchJSON(net().url('/files/' + encodeURIComponent(item.id) + '/review'), {
        method: 'PATCH',
        json: { status: status, note: note || '' },
      })
        .then(function (res) {
          // Written back onto the row the caller holds, so a list that keeps
          // its own copy is not left showing the badge this just changed.
          item.review = (res && res.file && res.file.review) || item.review;
          item.status = (res && res.file && res.file.status) || item.status;
          if (onDone) onDone(res);
          ui().toast('Status updated.');
        })
        .catch(function (err) {
          ui().toast((err && err.message) || 'Could not update the status.', false);
        });
    };

    if (status !== 'update_required' && status !== 'rejected') return send('');

    confirmModal({
      title: 'Request an update',
      message: 'The uploader will see why this needs changing.',
      prompt: { label: 'Reason', placeholder: 'e.g. Expired, please send a current copy' },
      confirmLabel: 'Request update',
      onConfirm: function (note) {
        if (!String(note || '').trim()) {
          ui().toast('Say what needs changing.', false);

          return;
        }
        send(note);
      },
    });
  }

  /**
   * The status picker, on the portal's own menu.
   *
   * All of them are listed, current one included: leaving it out makes the
   * list shorter than the thing it describes, and the reader has to remember
   * what is missing to know where they are. It carries a tick and does
   * nothing instead.
   */
  function reviewSubmenu(item, onDone) {
    var current = (item.review || {}).status;
    var next = (item.review && item.review.next) || null;
    var states = reviewStatesFor(item);

    return states.map(function (s) {
      var isCurrent = s.id === current;
      var allowed = !next || next.indexOf(s.id) !== -1;

      return {
        label: s.label,
        icon: s.icon,
        note: isCurrent ? '✓' : '',
        disabled: !isCurrent && !allowed,
        fn: (isCurrent || !allowed) ? function () {} : function () { setItemReviewStatus(item, s.id, onDone); },
      };
    });
  }

  /* The server's list when it sent one, so a CIP slot and an ordinary client
     file cannot disagree with the picker about which statuses exist. */
  function reviewStatesFor(item) {
    var all = (item.review && item.review.all) || [];
    if (!all.length) return REVIEW_STATES;

    return all.map(function (id) {
      for (var i = 0; i < REVIEW_STATES.length; i++) {
        if (REVIEW_STATES[i].id === id) return REVIEW_STATES[i];
      }
      return { id: id, label: id.replace(/_/g, ' '), icon: 'Circle' };
    });
  }

  /** The same picker where there is no menu to hang it off, the viewer's
      panel button, which opens it as a menu of its own. */
  function openReviewStatusMenu(x, y, item, onDone) {
    openContextMenu(x, y, item, reviewSubmenu(item, onDone));
  }

  /* ── assigning from the row menu ────────────────────── */

  /**
   * The people this item can be assigned to.
   *
   * Fetched when the flyout opens rather than with the menu: it is a request
   * per item, and right-clicking a row to rename it should not ask the server
   * who else could have it. The server decides who may appear, see
   * Assignable, and answers 403 to a reader who may not assign at all, which
   * is the same answer they would get for trying.
   *
   * Picking somebody grants `viewer`, the role the assign dialog opens on. The
   * dialog is still there, last in the list, for any other role or for
   * somebody who has no account yet.
   */
  function assignSubmenu(item, fill) {
    var withDialog = function (rows) {
      return rows.concat([
        { sep: true },
        { label: 'Assign with a role…', icon: 'SlidersHorizontal', fn: function () { openAssignModal(item); } },
      ]);
    };

    net().fetchJSON(net().url('/shares/people?type=' + item.type + '&id=' + encodeURIComponent(item.id)))
      .then(function (res) {
        var people = (res && res.people) || [];
        if (!people.length) {
          fill(withDialog([{ label: 'Nobody to assign to', static: true }]));

          return;
        }

        fill(withDialog(people.map(function (p) {
          return {
            label: p.name || p.email || 'Someone',
            avatar: ctxAvatarHtml(p),
            // Said before they commit, not after: assigning somebody who can
            // already open it is a no-op worth knowing about first.
            note: p.hasAccess ? 'Has access' : '',
            fn: function () { assignTo(item, p); },
          };
        })));
      })
      .catch(function () {
        fill(withDialog([{ label: 'Couldn\u2019t load people', static: true }]));
      });
  }

  /* Their real photo where there is one, their initial where there is not —
     the portal never invents a face. */
  function ctxAvatarHtml(person) {
    if (person && person.avatar) {
      return '<img class="tma-portal-context-menu__avatar" src="' + esc(person.avatar) + '" alt="" width="20" height="20">';
    }
    var initial = String((person && person.name) || (person && person.email) || '?').charAt(0).toUpperCase();

    return '<span class="tma-portal-context-menu__avatar tma-portal-context-menu__avatar--initial">' +
      esc(initial) + '</span>';
  }

  function assignTo(item, person) {
    net().fetchJSON(net().url('/shares'), {
      method: 'POST',
      json: { type: item.type, id: item.id, mode: 'invite', email: person.email, role: 'viewer' },
    })
      .then(function () {
        ui().toast('Assigned to ' + (person.name || person.email) + '.');
        load(true);
        notifyExternal();
      })
      .catch(function (err) {
        ui().toast((err && err.message) || 'Could not assign this.', false);
      });
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
    if (perm(item, 'assign')) {
      list.push({
        label: 'Assign to people',
        icon: 'UserPlus',
        submenu: function (fill) { assignSubmenu(item, fill); },
      });
    }
    if (perm(item, 'share')) list.push({ label: 'Copy link', icon: 'LinkSimple', fn: function () { copyShareLink(item); } });
    // Only for folders, and only where the reader could upload themselves: a
    // request hands out write access, so it cannot be wider than write access.
    if (isFolder && perm(item, 'upload')) {
      list.push({ label: 'Request files into this folder', icon: 'DownloadSimple', fn: function () { requestFilesHere(item); } });
    }
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
    /*
     * Moving a document's review on without opening it.
     *
     * The reviewer's job is a queue of rows, and the status was reachable only
     * from inside the viewer, so approving five documents meant opening and
     * closing five of them. It opens the same picker the viewer's panel opens,
     * in place of this menu, and reloads the list behind it.
     */
    if (canReview(item)) {
      list.push({
        label: 'Change status',
        icon: 'SealCheck',
        submenu: function (fill) {
          fill(reviewSubmenu(item, function () { load(true); notifyExternal(); }));
        },
      });
    }
    list.push({ label: 'View details', icon: 'Info', fn: function () { openDetails(item); } });
    if (perm(item, 'delete')) list.push({ label: 'Delete', icon: 'Trash', danger: true, fn: function () { deleteItem(item); } });
    return list;
  }

  /* Placed where asked, then pulled back inside the window.
     Grows left from the point when the right edge would run off, the CIP
     Assigned To column is the last one, and a menu that only clamped after
     opening as file-actions (narrow) then filling with people (wide) is how
     that picker vanished off the right of the window. */
  function placeMenu(el, x, y) {
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = x;
    if (left + w > window.innerWidth - 8) left = x - w;
    el.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
    var top = y;
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h);
    el.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + 'px';
  }

  function menuFaceHtml(it) {
    if (it.avatar) return it.avatar;
    if (it.face) {
      return '<img class="tma-portal-context-menu__face" src="' + esc(it.face) + '" alt="" width="24" height="24">';
    }
    if (it.icon) {
      return '<img class="tma-portal-context-menu__icon" src="images/icons/phosphor/' + it.icon + '.svg" alt="" width="16" height="16">';
    }
    return '<span class="tma-portal-context-menu__icon"></span>';
  }

  function menuItemHtml(it, i) {
    if (it.sep) return '<div class="tma-portal-context-menu__sep" role="separator"></div>';
    if (it.static) {
      return '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--static">' +
        '<span class="tma-portal-context-menu__label">' + esc(it.label) + '</span></div>';
    }
    /*
     * Somebody already on the record is not a thing to click, they are a
     * thing to take off. The row is inert and carries an × of its own, so
     * the only click that does nothing is the one that would have changed
     * nothing anyway.
     */
    if (it.on) {
      return '<div class="tma-portal-context-menu__item tma-portal-context-menu__item--person' +
        ' tma-portal-context-menu__item--on">' +
        menuFaceHtml(it) +
        '<span class="tma-portal-context-menu__label">' + esc(it.label) + '</span>' +
        (it.meta ? '<span class="tma-portal-context-menu__meta">' + esc(it.meta) + '</span>' : '') +
        (it.remove
          ? '<button type="button" class="tma-portal-context-menu__off" data-ctx-off="' + i + '"' +
            ' title="Take this off ' + esc(it.label) + '"' +
            ' aria-label="Take this off ' + esc(it.label) + '">' +
            '<img src="images/icons/tma/Close-12.svg" width="8" height="8" alt=""></button>'
          : '') +
        '</div>';
    }
    var person = !!(it.face || (it.avatar && !it.icon));

    return '<button type="button" class="tma-portal-context-menu__item' +
      (person ? ' tma-portal-context-menu__item--person' : '') +
      (it.danger ? ' tma-portal-context-menu__item--danger' : '') +
      (it.submenu ? ' tma-portal-context-menu__item--parent' : '') +
      '" role="menuitem" data-ctx="' + i + '"' +
      (it.disabled ? ' disabled' : '') +
      (it.submenu ? ' aria-haspopup="true"' : '') +
      (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' +
      menuFaceHtml(it) +
      '<span class="tma-portal-context-menu__label">' + esc(it.label) + '</span>' +
      (it.meta ? '<span class="tma-portal-context-menu__meta">' + esc(it.meta) + '</span>' : '') +
      (it.note ? '<span class="tma-portal-context-menu__note">' + esc(it.note) + '</span>' : '') +
      (it.submenu
        ? '<img class="tma-portal-context-menu__chevron" src="images/icons/phosphor/CaretRight.svg" alt="" width="16" height="16" aria-hidden="true">'
        : '') +
      '</button>';
  }

  function closeCtxSub() {
    if (ctxSubEl) { ctxSubEl.remove(); ctxSubEl = null; }
    if (ctxEl) {
      var open = ctxEl.querySelector('[data-ctx][data-open]');
      if (open) open.removeAttribute('data-open');
    }
  }

  /**
   * A flyout beside the entry that opened it.
   *
   * `entry.submenu` is a function given a callback to fill the flyout with —
   * so a list that has to be fetched can paint "Loading…" first and answer
   * later, without every caller writing that dance out.
   */
  function openCtxSub(parentBtn, entry) {
    if (ctxSubEl && parentBtn.hasAttribute('data-open')) return;
    closeCtxSub();
    parentBtn.setAttribute('data-open', 'true');

    ctxSubEl = document.createElement('div');
    ctxSubEl.className = 'tma-portal-context-menu tma-portal-context-menu--sub';
    ctxSubEl.setAttribute('role', 'menu');
    if (lb) ctxSubEl.style.zIndex = '701';
    document.body.appendChild(ctxSubEl);

    // Vertically off the entry, horizontally off the MENU: the entry sits
    // inside the menu's padding, so hanging the flyout off it left the two
    // overlapping by those few pixels.
    var box = parentBtn.getBoundingClientRect();
    var menu = ctxEl.getBoundingClientRect();
    var sub = ctxSubEl;

    var fill = function (items) {
      if (sub !== ctxSubEl) return;
      sub.innerHTML = items.map(menuItemHtml).join('');
      // Placed after filling: an empty flyout has no width, so there was
      // nothing yet to measure against the window's edge.
      // Left of the menu when the right will not hold it, rather than clamped
      // back over the menu it belongs beside.
      var w = sub.offsetWidth;
      var right = menu.right + 2;
      var x = right + w + 8 <= window.innerWidth ? right : menu.left - w - 2;
      placeMenu(sub, x, box.top - 4);

      sub.onclick = function (e) {
        var b = e.target.closest('[data-ctx]');
        if (!b || b.disabled) return;
        var picked = items[parseInt(b.getAttribute('data-ctx'), 10)];
        closeContextMenu();
        if (picked && picked.fn) picked.fn();
      };
    };

    fill([{ label: 'Loading…', static: true }]);
    entry.submenu(fill);
  }

  /**
   * `list` overrides the default item menu. The file viewer passes its own so
   * the three-dot menu is this exact component, same actions, icons, keyboard
   * handling and styling, rather than a second menu that drifts out of sync.
   *
   * Callers that are not a file (the CIP table's Assigned To picker) pass the
   * rows themselves. Without that, this would build file actions for an
   * application uuid, a menu that cannot assign anybody, which is how that
   * column's control came to look broken.
   */
  function openContextMenu(x, y, item, list) {
    closeContextMenu();
    // Right-clicking an item selects just it, matching common file managers.
    if (item && item.id && !state.selected[item.id]) { /* keep multi-select if already selected */ }

    list = list || contextItems(item);
    ctxEl = document.createElement('div');
    ctxEl.className = 'tma-portal-context-menu';
    ctxEl.setAttribute('role', 'menu');
    ctxEl.innerHTML = list.map(menuItemHtml).join('');
    document.body.appendChild(ctxEl);
    placeMenu(ctxEl, x, y);

    // The menu is z-index 500, the file viewer is 600, opened from inside the
    // viewer it lands *behind* it: in the DOM, readable, and entirely
    // invisible. Same lift the details modal already does from here.
    if (lb) ctxEl.style.zIndex = '700';

    ctxEl.addEventListener('click', function (e) {
      var off = e.target.closest('[data-ctx-off]');
      if (off) {
        var take = list[parseInt(off.getAttribute('data-ctx-off'), 10)];
        closeContextMenu();
        if (take && take.remove) take.remove();
        return;
      }
      var b = e.target.closest('[data-ctx]');
      if (!b || b.disabled) return;
      var picked = list[parseInt(b.getAttribute('data-ctx'), 10)];
      // A parent row only opens its flyout; it is not an action itself.
      if (picked && picked.submenu) { openCtxSub(b, picked); return; }
      closeContextMenu();
      if (picked && picked.fn) picked.fn();
    });

    // Hovering a parent opens its flyout; hovering any other row closes it, so
    // two can never be open at once.
    ctxEl.addEventListener('mouseover', function (e) {
      var b = e.target.closest('[data-ctx]');
      if (!b) return;
      var over = list[parseInt(b.getAttribute('data-ctx'), 10)];
      if (over && over.submenu) openCtxSub(b, over);
      else closeCtxSub();
    });

    setTimeout(function () {
      document.addEventListener('click', onCtxDocClick);
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
          p.set('perPage', '0'); p.set('sort', 'name');
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
    state.page = 1;
    restorePageSize();
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
       * Only if it is in the folder that was just loaded, the file parameter
       * travels with a folder parameter, so a file that is not here means a
       * stale or hand-edited link, and silently showing a file from somewhere
       * else would be worse than showing the folder.
       */
      var file = findItem(wanted);

      if (file && file.type === 'file') {
        openFromUrl(file);

        return;
      }

      return fetchWantedFile(wanted);
    });
  }

  /* Open the viewer on a file the URL named, without writing a second history
     entry on top of the one being restored. */
  function openFromUrl(file) {
    restoringFromUrl = true;
    try { openLightbox(file); } finally { restoringFromUrl = false; }
    // The address bar already says this; record it without a second entry.
    syncUrl(true);
  }

  /**
   * A file the current listing does not contain.
   *
   * This used to be treated as a stale link and dropped, which was wrong: the
   * browse query lists what you own or were shared with, while *access* is
   * wider than that, the firm-wide staff default reaches files nobody ever
   * shared explicitly, and they appear in no section's list. So a perfectly
   * valid link from a notification, the Workflows page or a comment landed on
   * a folder with no viewer open and no explanation.
   *
   * Ask the server for the one file instead. It authorizes the request the
   * same way it would any other, so a link to something genuinely out of reach
   * still opens nothing, it just no longer takes reachable files with it.
   */
  function fetchWantedFile(id) {
    return net().fetchJSON(net().url('/files/' + encodeURIComponent(id)))
      .then(function (item) {
        if (!item || item.type !== 'file') { syncUrl(true); return; }

        // The viewer resolves what it was handed through findItem, which only
        // knows rows this listing loaded.
        externalItems = [item];
        openFromUrl(item);
      })
      .catch(function () {
        // Gone, or not this reader's to open. Drop the parameter rather than
        // leaving the URL claiming a viewer that is not there.
        syncUrl(true);
      });
  }

  /*
   * Back and forward.
   *
   * Without this the address bar would change while the page stayed put, the
   * reader presses Back expecting to leave the viewer and nothing happens.
   */
  window.addEventListener('popstate', function () {
    if (!state.el || !document.contains(state.el)) return;

    var folder = urlParam('folder') || null;
    var file = urlParam('file');

    if (folder !== state.folder) {
      state.folder = folder;
      state.selected = {};
      state.page = 1;
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

    // Same reason as on mount: not being in this listing does not mean the
    // reader may not open it.
    if (!file) {
      fetchWantedFile(fileId);

      return;
    }

    if (file.type !== 'file') return;

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
   * Registered once rather than per mount, this module is a singleton and
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
   * behaviour behind any of it, the controls were decoration. Rather than
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
     *
     * `list` is the rows to draw. Omit it for a file's own actions; pass it
     * when the caller is not a file (CIP Assigned To) so this does not build
     * Preview/Download for an application uuid.
     */
    menu: function (x, y, item, onChange, list) {
      externalItems = item ? [item] : [];
      externalOnChange = onChange || null;
      openContextMenu(x, y, item || { id: '', type: 'application' }, list);
    },

    /**
     * Open a file in the viewer, from a list that is not the File Library.
     *
     * The client's Documents tab used to window.open() the raw preview URL, so
     * the same PDF was a browser tab from one screen and the portal's viewer
     * from the other, no comments, no versions, no review, and no way back
     * except the back button. It is the same file, so it gets the same window.
     *
     * The item is registered as an external one first: the viewer resolves the
     * file it was handed through findItem, which otherwise only knows about
     * rows the library itself loaded.
     */
    open: function (item, onChange) {
      if (!item || item.type === 'folder') return;
      externalItems = [item];
      externalOnChange = onChange || null;
      openLightbox(item);
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
