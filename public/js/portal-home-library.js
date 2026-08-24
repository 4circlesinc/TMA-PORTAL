/*
 * TMA - Dashboard home library strip
 * Default (organization) folders in a 3-up card row, plus a Recent Files /
 * Shared with me table that mirrors the Folders → All Files list design.
 * Global: window.TMAPortalHomeLibrary
 */
(function () {
  'use strict';

  var DEFAULT_VISIBLE = 3;
  var PREVIEW_FILES = 5;

  var state = {
    loaded: false,
    loadedAt: 0,
    inflight: null,
    showAllDefaults: false,
    defaults: [], // { id, name, colour, iconName, files: [], fileCount }
    tab: 'recent', // recent | shared
    recent: { folders: [], files: [] },
    shared: { folders: [], files: [] },
    // Selected row ids, per tab. Kept apart so switching tabs cannot carry a
    // selection onto rows the user never picked.
    selected: { recent: {}, shared: {} },
  };

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }
  function esc(s) { return ui() ? ui().esc(s) : String(s || ''); }

  function isStaffUser() {
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    if (!me) return null;
    if (me.isAdmin) return true;
    var type = String(me.accountType || '');
    return type === 'Administrator' || type === 'Employee';
  }

  function navigate(nav) {
    if (window.TMADashboard && window.TMADashboard.navigate) {
      window.TMADashboard.navigate(nav);
    }
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cap(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '-';
  }

  function fileIconSrc(item) {
    if (item.type === 'folder') {
      var base = item.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
      return window.TMAFolderColours
        ? window.TMAFolderColours.iconSrc(base, item.colour)
        : 'images/icons/phosphor/' + base + '.svg';
    }
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(item.icon, item.name);
    return 'images/icons/phosphor/File.svg';
  }

  function folderIconHtml(item, size) {
    var px = size || 28;
    var base = (item.fileCount === 0) ? 'FolderEmpty' : 'FolderFilled';
    // Always wrap at a fixed size, bare .tma-folder-icon__base is styled
    // width/height:100% in portal-files.css and balloons inside these cards.
    var inner = window.TMAFolderIcons
      ? window.TMAFolderIcons.html(base, item.colour, item.iconName, px)
      : '<img src="' + esc(fileIconSrc(item)) + '" alt="" width="' + px + '" height="' + px + '">';
    return '<span class="tma-portal-default-folder__icon" style="width:' + px + 'px;height:' + px + 'px">' +
      inner + '</span>';
  }

  function thumbOrIcon(item, size) {
    if (item.type === 'folder') return folderIconHtml(item, size);
    var icon = fileIconSrc(item);
    if (item.type === 'file' && item.thumbUrl) {
      return '<img class="tma-portal-file-thumb" src="' + esc(item.thumbUrl) + '" alt="" loading="lazy" width="' + size + '" height="' + size + '"' +
        ' onerror="this.onerror=null;this.classList.add(\'is-fallback\');this.src=\'' + esc(icon) + '\'">';
    }
    return '<img class="tma-portal-file-thumb is-fallback" src="' + esc(icon) + '" alt="" width="' + size + '" height="' + size + '">';
  }

  function ownerCell(person) {
    if (!person) return '-';
    var name = person.name || person.email || '-';
    var src = (window.TMACurrentUser && window.TMACurrentUser.avatarSrc)
      ? window.TMACurrentUser.avatarSrc(person.avatar, name)
      : (person.avatar || '');
    return '<span class="tma-portal-owner-cell">' +
      (src ? '<img class="tma-portal-owner-avatar" src="' + esc(src) + '" alt="" width="20" height="20">' : '') +
      '<span class="tma-portal-owner-name">' + esc(name) + '</span>' +
      '</span>';
  }

  function starBtn(it) {
    var on = !!it.favorite;
    var path = 'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';
    return '<button type="button" class="tma-portal-star' + (on ? ' is-on' : '') + '" data-home-lib-star="' + esc(it.id) + '" aria-label="' +
      (on ? 'Remove from favourites' : 'Add to favourites') + '" aria-pressed="' + on + '">' +
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
      '<path d="' + path + '" ' + (on ? 'fill="#ffcc00" stroke="#e0ac00"' : 'fill="none" stroke="currentColor"') +
      ' stroke-width="1.3" stroke-linejoin="round"/></svg></button>';
  }

  function openFolder(folderId) {
    if (!folderId) return;
    navigate({
      navId: 'folders-all',
      view: 'folders',
      title: 'Folders',
      crumb: 'Folders',
      folderId: folderId,
    });
  }

  function openItem(it) {
    if (!it) return;
    if (it.type === 'folder') {
      openFolder(it.id);
      return;
    }
    if (it.folder && it.folder.id) {
      openFolder(it.folder.id);
      return;
    }
    navigate({ navId: 'folders-recent', view: 'folders', title: 'Recent', crumb: 'File Library / Recent' });
  }

  /* ── default folders cards ─────────────────────────── */

  function renderDefaultFolderCard(folder) {
    var files = folder.files || [];
    var subfolders = folder.folders || [];

    // Subfolders first, then files, the same order the library itself uses.
    // Every row carries a data-key so a background poll re-render reuses the
    // existing node instead of rebuilding it (and re-requesting its thumbnail).
    var rows = subfolders.slice(0, PREVIEW_FILES).map(function (sub) {
      return '<button type="button" class="tma-portal-file-row" data-key="home-lib-sub-' + esc(sub.id) + '"' +
        ' data-home-lib-open-folder="' + esc(sub.id) + '">' +
        folderIconHtml(sub, 24) +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + esc(sub.name) + '</span>' +
        '<span class="tma-portal-file-row__path">' + esc(folderMeta(sub)) + '</span>' +
        '</span></button>';
    }).join('');

    rows += files.slice(0, Math.max(0, PREVIEW_FILES - subfolders.length)).map(function (f) {
      return '<button type="button" class="tma-portal-file-row" data-key="home-lib-file-' + esc(f.id) + '"' +
        ' data-home-lib-open-file="' + esc(f.id) + '"' +
        ' data-home-lib-open-folder="' + esc((f.folder && f.folder.id) || folder.id) + '">' +
        thumbOrIcon(f, 24) +
        '<span class="tma-portal-file-row__meta">' +
        '<span class="tma-portal-file-row__name">' + esc(f.name) + '</span>' +
        (f.sizeLabel ? '<span class="tma-portal-file-row__path">' + esc(f.sizeLabel) + '</span>' : '') +
        '</span></button>';
    }).join('');

    return '<section class="tma-portal-default-folder" data-key="default-folder-' + esc(folder.id) + '">' +
      '<button type="button" class="tma-portal-default-folder__head" data-home-lib-open-folder="' + esc(folder.id) + '">' +
      folderIconHtml(folder, 28) +
      '<span class="tma-portal-default-folder__name">' + esc(folder.name) + '</span>' +
      '</button>' +
      '<div class="tma-portal-default-folder__body">' +
      (rows || '<p class="tma-portal-panel__note" data-key="home-lib-empty-' + esc(folder.id) + '">Nothing in this folder yet.</p>') +
      (extraCount(folder) ? '<p class="tma-portal-panel__note" data-key="home-lib-more-' + esc(folder.id) + '">' + extraCount(folder) + '</p>' : '') +
      '</div></section>';
  }

  /** "3 files · 2 folders", or "Empty", the same shape the library uses. */
  function folderMeta(sub) {
    var parts = [];
    if (sub.fileCount) parts.push(sub.fileCount + (sub.fileCount === 1 ? ' file' : ' files'));
    if (sub.folderCount) parts.push(sub.folderCount + (sub.folderCount === 1 ? ' folder' : ' folders'));

    return parts.length ? parts.join(' · ') : 'Empty';
  }

  /** "+ 8 more" when the card shows only the first few. */
  function extraCount(folder) {
    var shown = Math.min((folder.folders || []).length, PREVIEW_FILES) +
      Math.max(0, Math.min((folder.files || []).length, PREVIEW_FILES - (folder.folders || []).length));
    var total = (folder.folderCount || 0) + (folder.fileCount || 0);

    return total > shown ? '+ ' + (total - shown) + ' more' : '';
  }

  function renderDefaultFolders() {
    // Clients never see Default Folders. Staff always see the section (even
    // empty) so it’s obvious the feature is there.
    if (isStaffUser() === false) return '';

    if (!state.loaded && !state.defaults.length) {
      return '<section class="tma-portal-home-defaults" data-key="home-defaults" aria-busy="true">' +
        '<div class="tma-portal-home-defaults__head" data-key="home-defaults-head">' +
        '<h2 class="tma-portal-home-defaults__title">Default Folders</h2>' +
        '</div>' +
        '<div class="tma-portal-home-defaults__grid" data-key="home-defaults-skeleton">' +
        new Array(3).fill('<div class="tma-portal-default-folder tma-portal-default-folder--skeleton" aria-hidden="true"></div>').join('') +
        '</div></section>';
    }

    var list = state.showAllDefaults ? state.defaults : state.defaults.slice(0, DEFAULT_VISIBLE);
    var moreCount = Math.max(0, state.defaults.length - DEFAULT_VISIBLE);
    var moreBtn = moreCount > 0
      ? '<button type="button" class="tma-portal-link" data-home-lib-defaults-more>' +
        (state.showAllDefaults ? 'Show less' : ('More (' + moreCount + ')')) +
        '</button>'
      : '';

    // Each shape (skeleton / grid / empty) carries its own key, so a change of
    // shape swaps that one block and everything else is reconciled in place.
    var body = state.defaults.length
      ? ('<div class="tma-portal-home-defaults__grid" data-key="home-defaults-grid">' +
        list.map(renderDefaultFolderCard).join('') + '</div>')
      : ('<div data-key="home-defaults-empty">' + (ui() && ui().emptyState
        ? ui().emptyState({
            illustration: 'Illustration07',
            title: 'No default folders yet',
            subtitle: 'Admins can open Folders, right‑click a top-level folder, and choose “Make default folder”.',
          })
        : '<p class="tma-portal-panel__note">No default folders yet.</p>') + '</div>');

    return '<section class="tma-portal-home-defaults" data-key="home-defaults">' +
      '<div class="tma-portal-home-defaults__head" data-key="home-defaults-head">' +
      '<h2 class="tma-portal-home-defaults__title">Default Folders</h2>' +
      moreBtn +
      '</div>' +
      body +
      '</section>';
  }

  /* ── files table (same columns/markup as Folders → All Files) ── */

  function tableItems() {
    var pack = state.tab === 'shared' ? state.shared : state.recent;
    return (pack.folders || []).concat(pack.files || []);
  }

  function acts() { return window.TMAFileActions; }

  /**
   * Run a bulk action on the current selection.
   *
   * Delegates to the File Library rather than reimplementing any of it, so the
   * destination picker, the confirm wording, the permission rules and the
   * endpoints are all literally the same code. On completion the list is
   * reloaded from the server, a move or delete changes what belongs in Recent
   * Files, and guessing locally would leave a row that no longer exists.
   */
  function runBulk(action) {
    var picked = selectedItems();
    if (!picked.length || !acts()) return;

    if (action === 'download') {
      picked.forEach(function (it) { acts().download(it); });

      return;
    }

    var done = function () {
      clearSelection();
      refresh();
    };

    if (action === 'delete') {
      var n = picked.length;
      acts().confirm({
        title: 'Move to recycle bin',
        message: 'Move ' + n + ' item' + (n === 1 ? '' : 's') + ' to the recycle bin?',
        confirmLabel: 'Move to bin',
        danger: true,
        onConfirm: function () { acts().run('delete', picked, done); },
      });

      return;
    }

    acts().run(action, picked, done);
  }

  function sel() { return state.selected[state.tab] || (state.selected[state.tab] = {}); }

  function selectedItems() {
    var picked = sel();

    // Resolved against the rows actually on screen, so an id left over from a
    // refresh that dropped the row cannot be acted on.
    return tableItems().filter(function (i) { return picked[i.id]; });
  }

  function setSelected(id, on) {
    if (on) sel()[id] = true;
    else delete sel()[id];
    rerenderHome();
  }

  function selectAll(on) {
    state.selected[state.tab] = {};
    if (on) tableItems().forEach(function (i) { state.selected[state.tab][i.id] = true; });
    rerenderHome();
  }

  function clearSelection() {
    state.selected[state.tab] = {};
  }

  /**
   * The bulk toolbar, mirroring the File Library's (and the Users table's).
   *
   * Same classes, same order, same hidden-until-selected behaviour, this is
   * the documented component, not a second one that merely looks similar.
   */
  function bulkToolbar() {
    var picked = selectedItems();
    var n = picked.length;

    if (!ui()) return '';

    function btn(icon, action, label, disabled) {
      return '<button type="button" class="tma-dash__tool-btn" data-home-lib-bulk="' + action + '"' +
        (disabled ? ' disabled' : '') + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<img src="images/icons/phosphor/' + icon + '.svg" alt="" width="16" height="16"></button>';
    }

    // Folders have no direct download URL in these lists, so offering it for a
    // mixed selection would half-work. Everything else applies to both.
    var onlyFiles = picked.every(function (i) { return i.type === 'file'; });

    return '<div class="tma-dash__toolbar tma-dash__toolbar--selected tma-portal-home-library__toolbar"' +
      (n === 0 ? ' hidden' : '') + ' data-home-lib-toolbar>' +
      '<div class="tma-dash__toolbar-actions">' +
      '<div class="tma-dash__toolbar-bulk">' +
      '<span class="tma-dash__toolbar-selection" aria-live="polite">' + n + ' Selected</span>' +
      btn('ArrowLineDown', 'download', 'Download', !onlyFiles) +
      btn('ArrowsOutCardinal', 'move', 'Move') +
      btn('Copy', 'copy', 'Copy') +
      btn('Trash', 'delete', 'Delete') +
      '</div></div></div>';
  }

  function renderFilesTable() {
    var all = tableItems();
    var picked = sel();
    var allOn = all.length > 0 && all.every(function (i) { return picked[i.id]; });
    var someOn = !allOn && all.some(function (i) { return picked[i.id]; });

    var headers = [
      {
        html: '<input type="checkbox" class="tma-dash__check" data-home-lib-all' +
          (allOn ? ' checked' : '') + (someOn ? ' data-indeterminate="1"' : '') +
          ' aria-label="Select all">',
        attrs: ' class="tma-portal-cell--tight"',
      },
      { html: '', attrs: ' class="tma-portal-cell--tight"' },
      'Name', 'Type', 'Size', 'Owner', 'Modified',
      { html: '', attrs: ' class="tma-portal-cell--tight"' },
    ];

    var rows = all.map(function (it) {
      var typeLabel = it.type === 'folder' ? 'Folder' : (it.category ? cap(it.category) : 'File');
      var size = it.type === 'folder' ? (it.sizeLabel || '-') : (it.sizeLabel || '-');
      var when = fmtDate(it.modifiedAt || it.createdAt || it.uploadedAt);

      return '<tr data-home-lib-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '"' +
        (picked[it.id] ? ' class="is-selected"' : '') + '>' +
        '<td class="tma-portal-cell--tight"><input type="checkbox" class="tma-dash__check" data-home-lib-check="' + esc(it.id) + '"' +
        (picked[it.id] ? ' checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></td>' +
        '<td class="tma-portal-cell--tight">' + starBtn(it) + '</td>' +
        '<td><span class="tma-portal-avatar-cell">' + thumbOrIcon(it, 24) +
        '<button type="button" class="tma-portal-file-link" data-home-lib-open="' + esc(it.id) + '">' + esc(it.name) + '</button>' +
        '</span></td>' +
        '<td class="tma-portal-table__muted">' + esc(typeLabel) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(size) + '</td>' +
        '<td class="tma-portal-table__muted">' + ownerCell(it.owner || it.uploadedBy) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(when) + '</td>' +
        '<td class="tma-portal-cell--tight"><button type="button" class="tma-portal-row-menu" data-home-lib-menu="' + esc(it.id) + '" aria-label="More actions">' +
        '<img src="images/icons/tma/ThreeDots-16.svg" alt="" width="16" height="16"></button></td>' +
        '</tr>';
    }).join('');

    var empty = !all.length
      ? (ui() && ui().emptyState
        ? ui().emptyState({
            illustration: 'Illustration07',
            title: state.tab === 'shared' ? 'Nothing shared with you' : 'No recent files',
            subtitle: state.tab === 'shared'
              ? 'Items other people share with you will show up here.'
              : 'Files you open or upload will show up here.',
          })
        : (window.TMANoData
          ? window.TMANoData.render({
              illustrationName: 'Illustration07',
              title: state.tab === 'shared' ? 'Nothing shared with you' : 'No recent files',
              subtitle: state.tab === 'shared'
                ? 'Items other people share with you will show up here.'
                : 'Files you open or upload will show up here.',
              showButton: false,
            })
          : '<p class="tma-portal-panel__note">No items yet.</p>'))
      : '';

    var tableHtml = ui() && ui().table
      ? ui().table(headers, rows || '')
      : '';

    return '<section class="tma-portal-home-library" data-key="home-library">' +
      '<div class="tma-portal-home-library__head">' +
      (ui() && ui().tabs
        ? ui().tabs([
            { key: 'recent', label: 'Recent Files' },
            { key: 'shared', label: 'Shared with me' },
          ], state.tab)
        : '') +
      '</div>' +
      bulkToolbar() +
      '<div class="tma-portal-home-library__body" data-home-lib-table>' +
      (empty && !rows ? empty : tableHtml) +
      '</div></section>';
  }

  function render() {
    /*
     * Reconciled, never replaced.
     *
     * This strip used to carry data-morph-replace so a stale empty defaults
     * block could not survive a folder being adopted. But the dashboard
     * re-renders on three background polls (inbox, chats, presence), and each
     * one then tore the whole strip out of the document and rebuilt it: every
     * folder icon and thumbnail became a new <img>, and the container's height
     * collapsed and came back within the same frame, which, mid-scroll, reads
     * as the page refreshing under you.
     *
     * The stale-block problem is solved properly instead: each shape inside
     * carries its own data-key (see renderDefaultFolders), so morph swaps the
     * block that actually changed and leaves the rest alone.
     */
    return '<div class="tma-portal-home-below" data-key="home-below">' +
      renderDefaultFolders() +
      renderFilesTable() +
      '</div>';
  }

  function findItem(id) {
    var all = tableItems().concat(
      state.defaults.reduce(function (acc, f) {
        return acc.concat(f.files || []);
      }, [])
    );
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function rerenderHome() {
    var dash = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
    if (dash && typeof dash._homeLibRerender === 'function') dash._homeLibRerender();
  }

  /*
   * "Some but not all selected" is a property, not an attribute.
   *
   * There is no HTML for it. `indeterminate` can only be set on the element —
   * so the header box has to be corrected after every render or a partial
   * selection renders as plain unchecked.
   */
  function syncIndeterminate(host) {
    var box = host.querySelector('[data-home-lib-all]');
    if (box) box.indeterminate = box.hasAttribute('data-indeterminate');
  }

  function wire(root) {
    var host = root.querySelector('[data-key="home-below"]') || root;
    if (!host) return;

    syncIndeterminate(host);

    // Bind once per element, via a property rather than an attribute: the strip
    // now survives re-renders, and morph strips any data-* attribute the fresh
    // markup doesn't repeat, a dataset flag would be wiped on every patch and
    // stack a new click handler each time.
    var bindOnce = window.TMAMorph
      ? function (el, type, fn, tag) { window.TMAMorph.on(el, type, fn, tag); }
      : function (el, type, fn, tag) {
        var flag = '__homeLibOn:' + type + ':' + (tag || '');
        if (el[flag]) return;
        el[flag] = true;
        el.addEventListener(type, fn);
      };

    bindOnce(host, 'click', function (e) {
      // Tabs: delegate so morph can replace tab buttons without losing the
      // handler (PortalTabGroup binds per-button and breaks after patch).
      var tabBtn = e.target.closest('[data-tab-key]');
      if (tabBtn && host.contains(tabBtn)) {
        var key = tabBtn.getAttribute('data-tab-key');
        if ((key === 'recent' || key === 'shared') && state.tab !== key) {
          state.tab = key;
          rerenderHome();
        }
        return;
      }

      var more = e.target.closest('[data-home-lib-defaults-more]');
      if (more && host.contains(more)) {
        state.showAllDefaults = !state.showAllDefaults;
        rerenderHome();
        return;
      }

      var folderBtn = e.target.closest('[data-home-lib-open-folder]');
      if (folderBtn && host.contains(folderBtn) && !e.target.closest('[data-home-lib-open-file]')) {
        openFolder(folderBtn.getAttribute('data-home-lib-open-folder'));
        return;
      }

      var rowMenu = e.target.closest('[data-home-lib-menu]');
      if (rowMenu && host.contains(rowMenu)) {
        e.preventDefault();
        e.stopPropagation();
        var menuItem = findItem(rowMenu.getAttribute('data-home-lib-menu'));
        // The File Library owns the menu, same actions, same permissions.
        if (menuItem && acts()) {
          var r = rowMenu.getBoundingClientRect();
          // Reload when an action changes something, a rename or a delete
          // leaves this row stale otherwise.
          acts().menu(r.left, r.bottom + 4, menuItem, function () { refresh(); });
        }
        return;
      }

      var bulkBtn = e.target.closest('[data-home-lib-bulk]');
      if (bulkBtn && host.contains(bulkBtn) && !bulkBtn.disabled) {
        e.preventDefault();
        runBulk(bulkBtn.getAttribute('data-home-lib-bulk'));
        return;
      }

      var openBtn = e.target.closest('[data-home-lib-open], [data-home-lib-open-file]');
      if (openBtn && host.contains(openBtn)) {
        var id = openBtn.getAttribute('data-home-lib-open') || openBtn.getAttribute('data-home-lib-open-file');
        openItem(findItem(id));
      }
    }, 'homeLib');

    // Checkboxes fire `change`, not `click`, binding click here would miss a
    // keyboard toggle entirely.
    bindOnce(host, 'change', function (e) {
      var all = e.target.closest('[data-home-lib-all]');
      if (all && host.contains(all)) { selectAll(all.checked); return; }

      var box = e.target.closest('[data-home-lib-check]');
      if (box && host.contains(box)) {
        setSelected(box.getAttribute('data-home-lib-check'), box.checked);
      }
    }, 'homeLibSelect');

    // Keep underline chrome in sync for a11y; switching itself is delegated above.
    if (ui() && ui().wireTabs) {
      var tabHost = host.querySelector('.tma-tab-group');
      if (tabHost) {
        var initFlag = '__homeLibTabs';
        if (!tabHost[initFlag]) {
          tabHost[initFlag] = true;
          if (window.PortalTabGroup) window.PortalTabGroup.init(tabHost);
        }
      }
    }
  }

  function loadFolderPreview(folder) {
    if (!net()) return Promise.resolve(folder);
    return net().fetchJSON(net().url('/?folder=' + encodeURIComponent(folder.id) + '&perPage=' + PREVIEW_FILES))
      .then(function (j) {
        folder.files = (j && j.files) || [];
        // Subfolders matter as much as files. A synced library keeps its
        // documents inside per-matter folders, so a card that only looked at
        // direct files reported "No files in this folder yet" on a folder
        // holding hundreds of them.
        folder.folders = (j && j.folders) || [];
        folder.fileCount = j && j.counts ? j.counts.files : folder.files.length;
        folder.folderCount = j && j.counts ? j.counts.folders : folder.folders.length;
        return folder;
      })
      .catch(function () { folder.files = folder.files || []; return folder; });
  }

  function normalizeOrgList(list) {
    var out = [];
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (f) {
      if (!f || !f.id || seen[f.id]) return;
      if (f.archived) return;
      seen[f.id] = true;
      out.push({
        id: f.id,
        name: f.name,
        colour: f.colour,
        iconName: f.iconName,
        fileCount: f.fileCount != null ? f.fileCount : 1,
        files: [],
      });
    });
    out.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return out;
  }

  function fetchAdminOrgFolders() {
    var root = window.__TMA_SITE_ROOT || '';
    return fetch(root + '/portal/file-library/settings', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        return (j && j.organizationFolders) || [];
      })
      .catch(function () { return []; });
  }

  function remountHome() {
    var dash = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
    if (dash && typeof dash._homeLibRerender === 'function') {
      dash._homeLibRerender();
      return;
    }
    // Dashboard not mounted yet, next visit will render from state.
  }

  /*
   * What the strip currently draws.
   *
   * A background revalidation that returns exactly what is already on screen
   * must not repaint anything, that repaint is what the dashboard's callers
   * see as the strip "reloading" on every visit.
   */
  function itemSig(it) {
    return [
      it.id, it.name || '', it.type || '', it.sizeLabel || '',
      it.modifiedAt || it.createdAt || it.uploadedAt || '',
      it.favorite ? 1 : 0, it.shared ? 1 : 0, it.thumbUrl || '',
    ].join(':');
  }

  function packSig(pack) {
    return ((pack && pack.folders) || []).concat((pack && pack.files) || []).map(itemSig).join('|');
  }

  function defaultsSig(list) {
    return (list || []).map(function (f) {
      return [
        f.id, f.name || '', f.colour || '', f.iconName || '',
        f.fileCount == null ? '' : f.fileCount,
        f.folderCount == null ? '' : f.folderCount,
        (f.folders || []).map(function (s) { return s.id + ':' + s.name; }).join(','),
        (f.files || []).map(function (s) { return s.id + ':' + s.name; }).join(','),
      ].join('~');
    }).join('|');
  }

  function snapshot() {
    return [defaultsSig(state.defaults), packSig(state.recent), packSig(state.shared)].join('#');
  }

  /**
   * Merge a freshly fetched default-folder list onto what is already drawn.
   *
   * The previews are a second round of requests, so a folder that survives the
   * refresh keeps the contents it is already showing until its own preview
   * comes back. Replacing the list outright, which is what this used to do —
   * left every card reading "Nothing in this folder yet" for as long as the
   * preview requests took, on every single visit to the Dashboard.
   */
  function mergeDefaults(next) {
    var known = {};
    state.defaults.forEach(function (f) { known[f.id] = f; });

    return next.map(function (f) {
      var prev = known[f.id];
      if (!prev) return f;
      f.files = prev.files || [];
      f.folders = prev.folders || [];
      if (prev.fileCount != null) f.fileCount = prev.fileCount;
      if (prev.folderCount != null) f.folderCount = prev.folderCount;
      return f;
    });
  }

  /* Revalidation window. Nothing on this strip moves in the seconds it takes
     to open another page and come back; a real change arrives on the `files`
     signal (see watchLiveFiles in portal-home.js), which forces past it. */
  var FRESH_MS = 60000;

  /**
   * Load defaults + recent/shared. Pass true as 2nd arg (or { force: true })
   * to refetch after creating/adopting a default folder.
   *
   * `remount` may be a callback or `true` for the default one; it is invoked
   * only when the payload differs from what is already on screen.
   */
  function load(remount, force) {
    if (force && typeof force === 'object') force = !!force.force;
    var done = typeof remount === 'function' ? remount : (remount ? remountHome : null);

    if (!net()) {
      state.loaded = true;
      if (done) done();
      return Promise.resolve();
    }
    if (state.inflight) {
      if (!force) return state.inflight;
      return state.inflight.then(function () { return load(remount, true); });
    }
    // Already current, answer from what we have rather than asking again.
    if (!force && state.loaded && (Date.now() - state.loadedAt) < FRESH_MS) {
      return Promise.resolve();
    }

    var before = snapshot();

    function settle() {
      state.loaded = true;
      state.loadedAt = Date.now();
      if (done && snapshot() !== before) done();
    }

    state.inflight = Promise.all([
      net().fetchJSON(net().url('/shortcuts')).catch(function () { return null; }),
      net().fetchJSON(net().url('/?section=recent&perPage=40')).catch(function () { return null; }),
      net().fetchJSON(net().url('/?section=shared&perPage=40')).catch(function () { return null; }),
      // Admin File Library list, backup if shortcuts race or cache is stale.
      fetchAdminOrgFolders(),
    ]).then(function (res) {
      state.inflight = null;
      var shortcuts = res[0];
      var recent = res[1];
      var shared = res[2];
      var adminOrg = res[3] || [];

      var nextDefaults;
      if (isStaffUser() === false) {
        nextDefaults = [];
      } else {
        var fromShortcuts = (shortcuts && shortcuts.groups && shortcuts.groups.organization) || [];
        nextDefaults = mergeDefaults(normalizeOrgList(fromShortcuts.concat(adminOrg)));
      }
      state.defaults = nextDefaults;

      if (recent) {
        state.recent = {
          folders: recent.folders || [],
          files: recent.files || [],
        };
      }
      if (shared) {
        state.shared = {
          folders: shared.folders || [],
          files: shared.files || [],
        };
      }

      // Paint the folder list as soon as we know it, then again once the
      // previews land, the cards keep their old contents in between.
      if (snapshot() !== before) {
        before = snapshot();
        if (done) done();
      }

      return Promise.all(nextDefaults.map(loadFolderPreview)).then(function (folders) {
        state.defaults = folders;
        settle();
      });
    }).catch(function () {
      state.inflight = null;
      settle();
    });

    return state.inflight;
  }

  function refresh(remount) {
    return load(remount == null ? true : remount, true);
  }

  window.TMAPortalHomeLibrary = {
    render: render,
    wire: wire,
    load: load,
    refresh: refresh,
    state: state,
  };
})();
