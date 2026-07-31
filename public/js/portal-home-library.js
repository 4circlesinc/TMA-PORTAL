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
    inflight: null,
    showAllDefaults: false,
    defaults: [], // { id, name, colour, iconName, files: [], fileCount }
    tab: 'recent', // recent | shared
    recent: { folders: [], files: [] },
    shared: { folders: [], files: [] },
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
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cap(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
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
    // Always wrap at a fixed size — bare .tma-folder-icon__base is styled
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
    if (!person) return '—';
    var name = person.name || person.email || '—';
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
    var rows = files.slice(0, PREVIEW_FILES).map(function (f) {
      return '<button type="button" class="tma-portal-file-row" data-home-lib-open-file="' + esc(f.id) + '"' +
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
      (rows || '<p class="tma-portal-panel__note">No files in this folder yet.</p>') +
      '</div></section>';
  }

  function renderDefaultFolders() {
    // Clients never see Default Folders. Staff always see the section (even
    // empty) so it’s obvious the feature is there.
    if (isStaffUser() === false) return '';

    if (!state.loaded && !state.defaults.length) {
      return '<section class="tma-portal-home-defaults" data-key="home-defaults" aria-busy="true">' +
        '<div class="tma-portal-home-defaults__head">' +
        '<h2 class="tma-portal-home-defaults__title">Default Folders</h2>' +
        '</div>' +
        '<div class="tma-portal-home-defaults__grid">' +
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

    var body = state.defaults.length
      ? ('<div class="tma-portal-home-defaults__grid">' + list.map(renderDefaultFolderCard).join('') + '</div>')
      : (ui() && ui().emptyState
        ? ui().emptyState({
            illustration: 'Illustration07',
            title: 'No default folders yet',
            subtitle: 'Admins can open Folders, right‑click a top-level folder, and choose “Make default folder”.',
          })
        : '<p class="tma-portal-panel__note">No default folders yet.</p>');

    return '<section class="tma-portal-home-defaults" data-key="home-defaults">' +
      '<div class="tma-portal-home-defaults__head">' +
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

  function renderFilesTable() {
    var all = tableItems();
    var headers = [
      { html: '', attrs: ' class="tma-portal-cell--tight"' },
      { html: '', attrs: ' class="tma-portal-cell--tight"' },
      'Name', 'Type', 'Size', 'Owner', 'Modified', 'Sharing',
      { html: '', attrs: ' class="tma-portal-cell--tight"' },
    ];

    var rows = all.map(function (it) {
      var typeLabel = it.type === 'folder' ? 'Folder' : (it.category ? cap(it.category) : 'File');
      var size = it.type === 'folder' ? (it.sizeLabel || '—') : (it.sizeLabel || '—');
      var when = fmtDate(it.modifiedAt || it.createdAt || it.uploadedAt);
      var sharing = (it.assignedTo && it.assignedTo.length) || it.shared
        ? '<span class="tma-portal-chip tma-portal-chip--shared">Shared</span>'
        : '<span class="tma-portal-table__muted">Private</span>';

      return '<tr data-home-lib-row data-id="' + esc(it.id) + '" data-type="' + esc(it.type) + '">' +
        '<td class="tma-portal-cell--tight"><input type="checkbox" class="tma-dash__check" aria-label="Select ' + esc(it.name) + '"></td>' +
        '<td class="tma-portal-cell--tight">' + starBtn(it) + '</td>' +
        '<td><span class="tma-portal-avatar-cell">' + thumbOrIcon(it, 24) +
        '<button type="button" class="tma-portal-file-link" data-home-lib-open="' + esc(it.id) + '">' + esc(it.name) + '</button>' +
        '</span></td>' +
        '<td class="tma-portal-table__muted">' + esc(typeLabel) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(size) + '</td>' +
        '<td class="tma-portal-table__muted">' + ownerCell(it.owner || it.uploadedBy) + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(when) + '</td>' +
        '<td>' + sharing + '</td>' +
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
      '<div class="tma-portal-home-library__body" data-home-lib-table>' +
      (empty && !rows ? empty : tableHtml) +
      '</div></section>';
  }

  function render() {
    // Replace the whole strip on each remount so morph never keeps a stale
    // empty defaults block after folders are adopted.
    return '<div class="tma-portal-home-below" data-key="home-below" data-morph-replace>' +
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

  function wire(root) {
    var host = root.querySelector('[data-key="home-below"]') || root;
    if (!host) return;

    if (!host.dataset.homeLibWired) {
      host.dataset.homeLibWired = '1';
      host.addEventListener('click', function (e) {
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

        var openBtn = e.target.closest('[data-home-lib-open], [data-home-lib-open-file]');
        if (openBtn && host.contains(openBtn)) {
          var id = openBtn.getAttribute('data-home-lib-open') || openBtn.getAttribute('data-home-lib-open-file');
          openItem(findItem(id));
        }
      });
    }

    // Keep underline chrome in sync for a11y; switching itself is delegated above.
    if (ui() && ui().wireTabs) {
      var tabHost = host.querySelector('.tma-tab-group');
      if (tabHost && !tabHost.dataset.homeLibTabs) {
        tabHost.dataset.homeLibTabs = '1';
        if (window.PortalTabGroup) window.PortalTabGroup.init(tabHost);
      }
    }
  }

  function loadFolderPreview(folder) {
    if (!net()) return Promise.resolve(folder);
    return net().fetchJSON(net().url('/?folder=' + encodeURIComponent(folder.id) + '&perPage=' + PREVIEW_FILES))
      .then(function (j) {
        folder.files = (j && j.files) || [];
        folder.fileCount = j && j.counts ? j.counts.files : folder.files.length;
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
    // Dashboard not mounted yet — next visit will render from state.
  }

  /**
   * Load defaults + recent/shared. Pass true as 2nd arg (or { force: true })
   * to refetch after creating/adopting a default folder.
   */
  function load(remount, force) {
    if (force && typeof force === 'object') force = !!force.force;
    if (!net()) {
      state.loaded = true;
      if (typeof remount === 'function') remount();
      else if (remount) remountHome();
      return Promise.resolve();
    }
    if (state.inflight) {
      if (!force) return state.inflight;
      return state.inflight.then(function () { return load(remount, true); });
    }

    var done = typeof remount === 'function' ? remount : (remount ? remountHome : null);

    state.inflight = Promise.all([
      net().fetchJSON(net().url('/shortcuts')).catch(function () { return null; }),
      net().fetchJSON(net().url('/?section=recent&perPage=40')).catch(function () { return null; }),
      net().fetchJSON(net().url('/?section=shared&perPage=40')).catch(function () { return null; }),
      // Admin File Library list — backup if shortcuts race or cache is stale.
      fetchAdminOrgFolders(),
    ]).then(function (res) {
      state.inflight = null;
      var shortcuts = res[0];
      var recent = res[1];
      var shared = res[2];
      var adminOrg = res[3] || [];

      if (isStaffUser() === false) {
        state.defaults = [];
      } else {
        var fromShortcuts = (shortcuts && shortcuts.groups && shortcuts.groups.organization) || [];
        state.defaults = normalizeOrgList(fromShortcuts.concat(adminOrg));
      }

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

      return Promise.all(state.defaults.map(loadFolderPreview)).then(function (folders) {
        state.defaults = folders;
        state.loaded = true;
        if (done) done();
      });
    }).catch(function () {
      state.inflight = null;
      state.loaded = true;
      if (done) done();
    });

    return state.inflight;
  }

  function refresh() {
    return load(true, true);
  }

  window.TMAPortalHomeLibrary = {
    render: render,
    wire: wire,
    load: load,
    refresh: refresh,
    state: state,
  };
})();
