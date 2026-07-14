/*
 * TMA - Portal Folders + Client hub views
 * Folders: Personal / Shared / Favorites / File Box / Recycle Bin
 * sections with create-folder and upload actions. File Box shows the
 * 180-day retention default.
 * Registers views: 'folders', 'client-hub'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  var SECTIONS = {
    'folders-personal': { key: 'personal', title: 'Personal Folders', note: 'Your private folders. Only people you share with can see these files.' },
    'folders-shared': { key: 'shared', title: 'Shared Folders', note: 'Folders shared across your account. Access is controlled per folder.' },
    'folders-favorites': { key: 'favorites', title: 'Favorites', note: 'Files and folders you starred for quick access.' },
    'folders-filebox': { key: 'filebox', title: 'File Box', note: '' },
    'folders-recycle': { key: 'recycle', title: 'Recycle Bin', note: 'Deleted files are kept here until permanently removed.' },
  };

  var state = { el: null, navId: 'folders-personal', selected: {} };

  /* sections that accept uploads (button + drag-and-drop) */
  var UPLOADABLE = { personal: 1, shared: 1, filebox: 1 };

  function fileboxList(s) {
    if (!s.folders.filebox) s.folders.filebox = [];
    return s.folders.filebox;
  }

  function sourceLists(s) {
    return { personal: s.folders.personal, shared: s.folders.shared, filebox: fileboxList(s) };
  }

  function sectionItems(section) {
    var s = data().state();
    if (section.key === 'personal') {
      return s.folders.personal.filter(function (f) { return f.kind !== 'filebox'; });
    }
    if (section.key === 'shared') return s.folders.shared;
    if (section.key === 'recycle') return s.folders.recycle;
    if (section.key === 'filebox') return fileboxList(s);
    if (section.key === 'favorites') {
      var lists = sourceLists(s);
      return lists.personal.concat(lists.shared, lists.filebox).filter(function (f) { return f.starred; });
    }
    return [];
  }

  function uploadTargetList(s, sectionKey) {
    if (sectionKey === 'shared') return s.folders.shared;
    if (sectionKey === 'filebox') return fileboxList(s);
    return s.folders.personal;
  }

  function findItem(s, id) {
    var lists = sourceLists(s);
    var found = null;
    Object.keys(lists).forEach(function (key) {
      lists[key].forEach(function (f) { if (f.id === id) found = { item: f, list: lists[key], origin: key }; });
    });
    s.folders.recycle.forEach(function (f) { if (f.id === id) found = { item: f, list: s.folders.recycle, origin: 'recycle' }; });
    return found;
  }

  function selectedIds() {
    return Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
  }

  function isSelected(id) {
    return !!state.selected[id];
  }

  function pruneSelection(items) {
    var visible = {};
    items.forEach(function (f) {
      if (f.kind !== 'filebox') visible[f.id] = true;
    });
    Object.keys(state.selected).forEach(function (id) {
      if (!visible[id]) delete state.selected[id];
    });
  }

  function selectableItems(section) {
    return sectionItems(section).filter(function (f) { return f.kind !== 'filebox'; });
  }

  function deleteSelected() {
    var s = data().state();
    var ids = selectedIds();
    ids.forEach(function (id) {
      var found = findItem(s, id);
      if (!found || found.origin === 'recycle') return;
      found.list.splice(found.list.indexOf(found.item), 1);
      found.item.origin = found.origin;
      s.folders.recycle.push(found.item);
    });
    state.selected = {};
    data().save();
    ui().toast(ids.length === 1 ? 'Moved to Recycle Bin' : ids.length + ' items moved to Recycle Bin');
    render();
  }

  function restoreSelected() {
    var s = data().state();
    var ids = selectedIds();
    ids.forEach(function (id) {
      var index = -1;
      s.folders.recycle.forEach(function (f, i) { if (f.id === id) index = i; });
      if (index === -1) return;
      var item = s.folders.recycle.splice(index, 1)[0];
      var target = sourceLists(s)[item.origin] || s.folders.personal;
      delete item.origin;
      target.push(item);
    });
    state.selected = {};
    data().save();
    ui().toast('Restored');
    render();
  }

  function purgeSelected() {
    var s = data().state();
    var ids = selectedIds();
    s.folders.recycle = s.folders.recycle.filter(function (f) { return ids.indexOf(f.id) === -1; });
    state.selected = {};
    data().save();
    ui().toast('Permanently deleted');
    render();
  }

  /* native checkbox - same pattern as Users/Files tables (empty box when unchecked) */
  function checkboxInput(attr, checked, label) {
    return '<input type="checkbox" class="tma-dash__check" ' + attr +
      (checked ? ' checked' : '') +
      ' aria-label="' + ui().esc(label) + '">';
  }

  function starBtn(item) {
    return '<button type="button" class="tma-portal-icon-btn tma-portal-star' + (item.starred ? ' is-starred' : '') + '"' +
      ' data-folders-star="' + ui().esc(item.id) + '" aria-pressed="' + !!item.starred + '"' +
      ' aria-label="' + (item.starred ? 'Remove from favorites' : 'Add to favorites') + '">' +
      '<img src="images/icons/phosphor/' + (item.starred ? 'StarFilled' : 'Star') + '.svg" alt="" width="16" height="16">' +
      '</button>';
  }

  function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    var s = data().state();
    var section = SECTIONS[state.navId] || SECTIONS['folders-personal'];
    var list = uploadTargetList(s, section.key);
    Array.prototype.forEach.call(fileList, function (file) {
      list.push({ id: data().uid('file'), name: file.name, kind: 'file', items: null, created: data().shortDate() });
      s.recentFiles.unshift({ id: data().uid('file'), name: file.name, path: section.title, type: (file.name.split('.').pop() || '').toLowerCase() });
    });
    s.recentFiles = s.recentFiles.slice(0, 6);
    data().save();
    data().logBackgroundOp('Upload to ' + section.title);
    ui().toast(fileList.length === 1 ? 'Upload complete' : fileList.length + ' files uploaded');
    render();
  }

  function createFolderModal(section) {
    ui().openModal({
      title: 'Create Folder',
      body:
        ui().field('Folder name', ui().input({ placeholder: 'e.g. Client Documents', attrs: 'data-folder-name' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-folder-create' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-folder-create]').addEventListener('click', function () {
          var name = host.querySelector('[data-folder-name]').value.trim();
          if (!name) { host.querySelector('[data-folder-name]').focus(); return; }
          var s = data().state();
          var list = section.key === 'shared' ? s.folders.shared : s.folders.personal;
          list.push({ id: data().uid('folder'), name: name, kind: 'folder', items: 0, created: data().shortDate() });
          data().save();
          ui().closeModal();
          ui().toast('Folder created');
          render();
        });
      },
    });
  }

  function renderFileBoxEmpty() {
    return '<div class="tma-portal-filebox-empty">' +
      '<p class="tma-portal-filebox-empty__title">This folder is empty</p>' +
      '<div class="tma-portal-dropzone__badge tma-portal-filebox-empty__badge">' +
      '<img src="images/icons/phosphor/FolderNotchOpen.svg" alt="" width="64" height="64">' +
      '</div>' +
      '<p class="tma-portal-filebox-empty__hint">Drag files here</p>' +
      '<button type="button" class="tma-portal-link tma-portal-filebox-empty__browse" data-filebox-browse>Browse files</button>' +
      '</div>';
  }

  function itemIconSrc(f) {
    if (f.kind === 'file' && window.TMAFileIcons) {
      return window.TMAFileIcons.fileIconFromFilename(f.name) || window.TMAFileIcons.fileIconSrc('DefaultIcon');
    }
    if (f.kind === 'filebox') return 'images/icons/phosphor/ArchiveTray.svg';
    return 'images/icons/phosphor/FolderFilled.svg';
  }

  function renderItemNameCell(f) {
    var icon = '<img src="' + ui().esc(itemIconSrc(f)) + '" alt="" style="border-radius:0">';
    if (f.kind !== 'file') {
      return '<td><span class="tma-portal-avatar-cell">' + icon +
        '<strong>' + ui().esc(f.name) + '</strong></span></td>';
    }
    return '<td><span class="tma-portal-avatar-cell">' + icon +
      '<span class="tma-portal-file-name">' +
      '<strong class="tma-portal-file-name__text">' + ui().esc(f.name) + '</strong>' +
      '<button type="button" class="tma-portal-file-name__edit" data-folders-rename="' + ui().esc(f.id) + '" ' +
      'aria-label="Rename ' + ui().esc(f.name) + '">' +
      '<img src="images/icons/phosphor/PencilSimple.svg" alt="" width="16" height="16"></button>' +
      '</span></span></td>';
  }

  /* shared items table: [select-all] [star] Name / Type / Items / Created */
  function renderItemsTable(items, section) {
    var s = data().state();
    pruneSelection(items);
    var showStar = section.key !== 'recycle';
    var selectable = items.filter(function (f) { return f.kind !== 'filebox'; });
    var selectedCount = selectable.filter(function (f) { return isSelected(f.id); }).length;
    var allSelected = selectable.length > 0 && selectedCount === selectable.length;
    var someSelected = selectedCount > 0 && !allSelected;

    var hasSelection = selectedIds().length > 0;

    var rows = items.map(function (f) {
      var rowSelected = isSelected(f.id) ? ' class="tma-portal-table__row--selected"' : '';
      var controls = f.kind === 'filebox'
        ? '<td class="tma-portal-cell--tight"></td>' + (showStar ? '<td class="tma-portal-cell--tight"></td>' : '')
        : '<td class="tma-portal-cell--tight">' +
          checkboxInput('data-folders-check="' + ui().esc(f.id) + '"', isSelected(f.id), 'Select ' + f.name) +
          '</td>' +
          (showStar ? '<td class="tma-portal-cell--tight">' + starBtn(f) + '</td>' : '');
      var itemsLabel = f.kind === 'filebox'
        ? fileboxList(s).length + ' items'
        : (f.items != null ? f.items + ' items' : '-');
      return '<tr' + rowSelected + ' data-folders-row data-item-id="' + ui().esc(f.id) + '" data-item-kind="' + ui().esc(f.kind) + '">' + controls +
        renderItemNameCell(f) +
        '<td class="tma-portal-table__muted">' + (f.kind === 'file' ? 'File' : f.kind === 'filebox' ? 'File Box' : 'Folder') + '</td>' +
        '<td class="tma-portal-table__muted">' + itemsLabel + '</td>' +
        '<td class="tma-portal-table__muted">' + ui().esc(f.created || '-') + '</td>' +
        '</tr>';
    }).join('');

    var headers = [
      {
        html: selectable.length
          ? checkboxInput('data-folders-select-all', allSelected, 'Select all')
          : '',
        attrs: ' class="tma-portal-cell--tight"',
      },
    ];
    if (showStar) headers.push({ html: '', attrs: ' class="tma-portal-cell--tight" aria-hidden="true"' });
    headers.push('Name', 'Type', 'Items', 'Created');

    return (hasSelection ? renderSelectionToolbar(section) : '') +
      ui().table(headers, rows, { tableAttrs: hasSelection ? ' data-has-selection' : '' });
  }

  var SELECTION_ICON = 'images/icons/phosphor/';
  var SELECTION_LINE = 'images/icons/tma/Line-16.svg';

  var SELECTION_MORE_ITEMS = [
    { label: 'Request Files' },
    { label: 'Move' },
    { label: 'Copy' },
    { label: 'Add People to Folder' },
    { label: 'Rename' },
    { label: 'Favorite' },
    { label: 'Add Note' },
  ];

  var FILE_CONTEXT_MENU = [
    'Download',
    'Share',
    'Send for Signature',
    'New Document Template',
    'Initiate Approval',
    'Delete',
    'Preview',
    'Move',
    'Copy',
    'Rename',
    'Edit Document',
    'Check Out',
    'Favorite',
    'Add Note',
    'Sign Yourself',
  ];

  var contextMenuEl = null;

  function closeFileContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
    document.removeEventListener('click', closeFileContextMenu);
    document.removeEventListener('contextmenu', closeFileContextMenu);
    document.removeEventListener('keydown', onFileContextMenuKey);
    document.removeEventListener('scroll', closeFileContextMenu, true);
  }

  function onFileContextMenuKey(e) {
    if (e.key === 'Escape') closeFileContextMenu();
  }

  function openFileContextMenu(x, y, item) {
    closeFileContextMenu();
    var menu = document.createElement('div');
    menu.className = 'tma-portal-context-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = FILE_CONTEXT_MENU.map(function (label, i) {
      return '<button type="button" class="tma-portal-context-menu__item" role="menuitem" data-ctx-index="' + i + '">' +
        '<span class="tma-portal-context-menu__label">' + ui().esc(label) + '</span></button>';
    }).join('');
    document.body.appendChild(menu);
    contextMenuEl = menu;

    var rect = menu.getBoundingClientRect();
    var left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    menu.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-ctx-index]');
      if (!btn) return;
      ev.stopPropagation();
      var label = FILE_CONTEXT_MENU[parseInt(btn.getAttribute('data-ctx-index'), 10)];
      closeFileContextMenu();
      handleFileContextAction(label, item);
    });

    setTimeout(function () {
      document.addEventListener('click', closeFileContextMenu);
      document.addEventListener('contextmenu', closeFileContextMenu);
      document.addEventListener('keydown', onFileContextMenuKey);
      document.addEventListener('scroll', closeFileContextMenu, true);
    }, 0);
  }

  function deleteItem(id) {
    var s = data().state();
    var found = findItem(s, id);
    if (!found || found.origin === 'recycle') return;
    found.list.splice(found.list.indexOf(found.item), 1);
    found.item.origin = found.origin;
    s.folders.recycle.push(found.item);
    delete state.selected[id];
    data().save();
    ui().toast('Moved to Recycle Bin');
    render();
  }

  function handleFileContextAction(label, item) {
    if (label === 'Delete') {
      deleteItem(item.id);
      return;
    }
    if (label === 'Favorite') {
      var s = data().state();
      var found = findItem(s, item.id);
      if (!found) return;
      found.item.starred = true;
      data().save();
      ui().toast('Added to Favorites');
      render();
      return;
    }
    if (label === 'Download') {
      ui().toast('Preparing download…');
      return;
    }
    if (label === 'Rename') {
      renameItemModal(item);
      return;
    }
    if (label === 'Send for Signature' && window.TMADashboard) {
      window.TMADashboard.navigate({
        navId: 'signatures',
        view: 'signatures',
        title: 'Signature requests',
        crumb: 'Signatures',
      });
      return;
    }
    ui().toast(label + '…');
  }

  function renameItemModal(item) {
    ui().openModal({
      title: 'Rename',
      body:
        ui().field('Name', ui().input({ value: item.name, attrs: 'data-rename-input' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-rename-save' }) + '</div>',
      onMount: function (host) {
        var input = host.querySelector('[data-rename-input]');
        input.focus();
        input.select();
        host.querySelector('[data-rename-save]').addEventListener('click', function () {
          var name = input.value.trim();
          if (!name) { input.focus(); return; }
          var found = findItem(data().state(), item.id);
          if (found) found.item.name = name;
          data().save();
          ui().closeModal();
          ui().toast('Renamed');
          render();
        });
      },
    });
  }

  function wireFileContextMenu(host) {
    if (!host || host.dataset.fileCtxBound) return;
    host.dataset.fileCtxBound = '1';
    host.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('[data-folders-row][data-item-kind="file"]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      var id = row.getAttribute('data-item-id');
      var found = findItem(data().state(), id);
      if (!found) return;
      openFileContextMenu(e.clientX, e.clientY, found.item);
    });
    host.addEventListener('click', function (e) {
      var renameBtn = e.target.closest('[data-folders-rename]');
      if (!renameBtn) return;
      e.preventDefault();
      e.stopPropagation();
      var found = findItem(data().state(), renameBtn.getAttribute('data-folders-rename'));
      if (found) renameItemModal(found.item);
    });
  }

  function selectionAction(opts) {
    return '<button type="button" class="tma-portal-selection-bar__action"' + (opts.attrs || '') +
      ' aria-label="' + ui().esc(opts.label) + '">' +
      '<img src="' + SELECTION_ICON + opts.icon + '.svg" alt="" width="16" height="16" aria-hidden="true">' +
      '<span class="tma-portal-selection-bar__label">' + ui().esc(opts.label) + '</span></button>';
  }

  function selectionDivider() {
    return '<img class="tma-portal-selection-bar__divider" src="' + SELECTION_LINE + '" alt="" aria-hidden="true" width="16" height="16">';
  }

  /* selection toolbar shown above the table while rows are checked */
  function renderSelectionToolbar(section) {
    if (!selectedIds().length) return '';

    if (section.key === 'recycle') {
      return '<div class="tma-portal-selection-bar" data-folders-selection-bar role="toolbar" aria-label="Selection actions">' +
        '<div class="tma-portal-selection-bar__actions">' +
        selectionAction({ label: 'Restore', icon: 'ArrowCounterClockwise', attrs: ' data-folders-restore' }) +
        selectionDivider() +
        selectionAction({ label: 'Delete Permanently', icon: 'Trash', attrs: ' data-folders-purge' }) +
        '</div></div>';
    }

    return '<div class="tma-portal-selection-bar" data-folders-selection-bar role="toolbar" aria-label="Selection actions">' +
      '<div class="tma-portal-selection-bar__actions">' +
      selectionAction({ label: 'Download', icon: 'DownloadSimple', attrs: ' data-folders-download' }) +
      selectionDivider() +
      selectionAction({ label: 'Share', icon: 'ShareNetwork', attrs: ' data-folders-share' }) +
      selectionDivider() +
      selectionAction({ label: 'Delete', icon: 'Trash', attrs: ' data-folders-delete' }) +
      selectionDivider() +
      selectionAction({ label: 'View Details', icon: 'Info', attrs: ' data-folders-details' }) +
      selectionDivider() +
      selectionAction({ label: 'More', icon: 'DotsThree', attrs: ' data-folders-more' }) +
      '</div></div>';
  }

  function renderFileBox(s) {
    var items = fileboxList(s);
    var section = SECTIONS['folders-filebox'];

    return '<div class="tma-portal-head">' +
      '<div><h2 class="tma-portal-head__title">File Box</h2></div>' +
      '</div>' +
      '<div class="tma-portal-section__card">' +
      '<p>You can temporarily store your files in the File Box when sending or requesting files. ' +
      'The default expiration policy for this folder is ' + s.settings.fileSettings.fileBoxRetentionDays + ' days. ' +
      'To store files for a longer period of time, use Move to move your files into a permanent folder.</p>' +
      '</div>' +
      '<div class="tma-portal-fab-anchor">' +
      '<button type="button" class="tma-portal-fab" data-filebox-fab aria-haspopup="true" aria-expanded="false" ' +
      'title="Upload and other Folder Actions" aria-label="Upload and other Folder Actions">' +
      '<img src="images/icons/phosphor/Plus.svg" alt=""></button>' +
      '<div class="tma-portal-fab-menu" data-filebox-fab-menu hidden role="menu">' +
      '<button type="button" class="tma-portal-fab-menu__item" role="menuitem" data-filebox-action="upload">' +
      '<img src="images/icons/phosphor/UploadSimple.svg" alt=""><span>Upload</span></button>' +
      '<button type="button" class="tma-portal-fab-menu__item" role="menuitem" data-filebox-action="request">' +
      '<img src="images/icons/phosphor/DownloadSimple.svg" alt=""><span>Request Files</span></button>' +
      '</div></div>' +
      (items.length
        ? renderItemsTable(items, section)
        : renderFileBoxEmpty());
  }

  function renderFolders() {
    var section = SECTIONS[state.navId] || SECTIONS['folders-personal'];
    var items = sectionItems(section);
    var s = data().state();

    if (section.key === 'filebox') return renderFileBox(s);

    var hasSelection = selectedIds().length > 0;
    var headActions = (!hasSelection && (section.key === 'personal' || section.key === 'shared'))
      ? ui().btn({ label: 'Create Folder', icon: 'FolderSimplePlus', variant: 'ghost', attrs: 'data-folders-create' }) +
        ui().btn({ label: 'Upload', icon: 'UploadSimple', attrs: 'data-folders-upload' })
      : '';

    var head =
      '<div class="tma-portal-head">' +
      '<div><h2 class="tma-portal-head__title">' + ui().esc(section.title) + '</h2></div>' +
      (headActions ? '<div class="tma-portal-head__actions">' + headActions + '</div>' : '') +
      '</div>';

    if (!items.length) {
      var emptyCopy = {
        shared: { title: 'No shared folders yet', subtitle: 'Create a folder and grant access to employees or client contacts.' },
        favorites: { title: 'No favorites yet', subtitle: 'Star files or folders to pin them here.' },
        recycle: { title: 'Recycle Bin is empty', subtitle: 'Deleted files will appear here.' },
        filebox: { title: 'File Box is empty', subtitle: 'Files sent to you without a destination folder land here.' },
        personal: { title: 'No folders yet', subtitle: 'Create your first folder to organize files.' },
      }[section.key];
      return head + ui().emptyState({
        illustration: 'Illustration03',
        title: emptyCopy.title,
        subtitle: emptyCopy.subtitle,
      });
    }

    return head + renderItemsTable(items, section);
  }

  function render() {
    var el = state.el;
    if (!el) return;
    el.innerHTML = '<div class="tma-portal-page">' + renderFolders() + '</div>';

    var create = el.querySelector('[data-folders-create]');
    if (create) create.addEventListener('click', function () {
      createFolderModal(SECTIONS[state.navId] || SECTIONS['folders-personal']);
    });

    var upload = el.querySelector('[data-folders-upload]');
    if (upload) upload.addEventListener('click', openFilePicker);

    /* File Box: floating folder-actions button + empty-state browse link */
    var fab = el.querySelector('[data-filebox-fab]');
    var fabMenu = el.querySelector('[data-filebox-fab-menu]');
    if (fab && fabMenu) {
      function setFabOpen(open) {
        fabMenu.hidden = !open;
        fab.setAttribute('aria-expanded', String(open));
        fab.classList.toggle('is-open', open);
        fab.querySelector('img').src = 'images/icons/phosphor/' + (open ? 'X' : 'Plus') + '.svg';
      }
      fab.addEventListener('click', function (e) {
        e.stopPropagation();
        setFabOpen(fabMenu.hidden);
      });
      document.addEventListener('click', function (e) {
        if (!fabMenu.hidden && !e.target.closest('.tma-portal-fab-anchor')) setFabOpen(false);
      });
      el.querySelectorAll('[data-filebox-action]').forEach(function (b) {
        b.addEventListener('click', function () {
          setFabOpen(false);
          if (b.getAttribute('data-filebox-action') === 'upload') openFilePicker();
          else requestFilesModal();
        });
      });
    }
    var browse = el.querySelector('[data-filebox-browse]');
    if (browse) browse.addEventListener('click', openFilePicker);

    /* selection checkboxes + select-all */
    var selectAll = el.querySelector('[data-folders-select-all]');
    var rowChecks = Array.prototype.slice.call(el.querySelectorAll('[data-folders-check]'));
    var section = SECTIONS[state.navId] || SECTIONS['folders-personal'];
    var selectable = selectableItems(section);
    var selectedCount = selectable.filter(function (f) { return isSelected(f.id); }).length;
    var allSelected = selectable.length > 0 && selectedCount === selectable.length;
    var someSelected = selectedCount > 0 && !allSelected;

    if (selectAll) {
      selectAll.checked = allSelected;
      selectAll.indeterminate = someSelected;
    }

    rowChecks.forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-folders-check');
        if (cb.checked) state.selected[id] = true;
        else delete state.selected[id];
        render();
      });
    });

    if (selectAll) {
      selectAll.addEventListener('change', function () {
        var section = SECTIONS[state.navId] || SECTIONS['folders-personal'];
        var selectable = selectableItems(section);
        if (selectAll.checked) {
          selectable.forEach(function (f) { state.selected[f.id] = true; });
        } else {
          selectable.forEach(function (f) { delete state.selected[f.id]; });
        }
        render();
      });
    }

    /* star / favorites */
    el.querySelectorAll('[data-folders-star]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var s = data().state();
        var found = findItem(s, b.getAttribute('data-folders-star'));
        if (!found) return;
        found.item.starred = !found.item.starred;
        data().save();
        ui().toast(found.item.starred ? 'Added to Favorites' : 'Removed from Favorites');
        render();
      });
    });

    /* selection toolbar */
    var del = el.querySelector('[data-folders-delete]');
    if (del) del.addEventListener('click', deleteSelected);
    var restore = el.querySelector('[data-folders-restore]');
    if (restore) restore.addEventListener('click', restoreSelected);
    var purge = el.querySelector('[data-folders-purge]');
    if (purge) purge.addEventListener('click', purgeSelected);
    var download = el.querySelector('[data-folders-download]');
    if (download) download.addEventListener('click', function () {
      ui().toast('Preparing download…');
      state.selected = {};
      render();
    });
    var share = el.querySelector('[data-folders-share]');
    if (share) share.addEventListener('click', function () {
      ui().toast('Share…');
    });
    var details = el.querySelector('[data-folders-details]');
    if (details) details.addEventListener('click', function () {
      ui().toast('View details…');
    });
    var more = el.querySelector('[data-folders-more]');
    if (more) {
      ui().wireMenu(more, SELECTION_MORE_ITEMS, function (item) {
        if (item.label === 'Request Files') requestFilesModal();
        else if (item.label === 'Favorite') favoriteSelected();
        else ui().toast(item.label + '…');
      });
    }
  }

  function favoriteSelected() {
    var s = data().state();
    var ids = selectedIds();
    ids.forEach(function (id) {
      var found = findItem(s, id);
      if (found) found.item.starred = true;
    });
    data().save();
    ui().toast(ids.length === 1 ? 'Added to Favorites' : 'Added to Favorites');
    render();
  }

  function openFilePicker() {
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.addEventListener('change', function () {
      addFiles(picker.files);
    });
    picker.click();
  }

  function requestFilesModal() {
    ui().openModal({
      title: 'Request Files',
      body:
        ui().field('To (email address)', ui().input({ type: 'email', placeholder: 'client@example.com', attrs: 'data-filebox-req-to' })) +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Message</span>' +
        '<textarea class="tma-portal-textarea" data-filebox-req-msg placeholder="Add a note (optional)"></textarea></div>' +
        '<p>The recipient gets a secure upload link. Uploads land in your File Box and you are notified by email.</p>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Send Request', attrs: 'data-filebox-req-send' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-filebox-req-send]').addEventListener('click', function () {
          var to = host.querySelector('[data-filebox-req-to]').value.trim();
          if (!to) { host.querySelector('[data-filebox-req-to]').focus(); return; }
          data().logNotification('File request sent to ' + to, to);
          data().logBackgroundOp('Request files (' + to + ')');
          ui().closeModal();
          ui().toast('File request sent');
        });
      },
    });
  }

  /* ── drag & drop upload ("Drop files here" overlay) ── */
  var dropzone = null;
  var dragDepth = 0;

  function sectionAllowsDrop() {
    if (!state.el) return false;
    var view = state.el.closest('.tma-dash__view');
    if (!view || view.hidden) return false;
    var section = SECTIONS[state.navId] || SECTIONS['folders-personal'];
    return !!UPLOADABLE[section.key];
  }

  function dragHasFiles(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
  }

  function ensureDropzone() {
    if (dropzone) return dropzone;
    dropzone = document.createElement('div');
    dropzone.className = 'tma-portal-dropzone';
    dropzone.hidden = true;
    dropzone.setAttribute('aria-hidden', 'true');
    dropzone.innerHTML =
      '<div class="tma-portal-dropzone__badge">' +
      '<img src="images/icons/phosphor/CloudUpload.svg" alt="" width="96" height="96">' +
      '</div>' +
      '<p class="tma-portal-dropzone__label">Drop files here</p>';
    document.body.appendChild(dropzone);
    return dropzone;
  }

  function hideDropzone() {
    dragDepth = 0;
    if (dropzone) dropzone.hidden = true;
  }

  function wireDragAndDrop() {
    if (document.body.dataset.portalDropWired) return;
    document.body.dataset.portalDropWired = '1';

    document.addEventListener('dragenter', function (e) {
      if (!sectionAllowsDrop() || !dragHasFiles(e)) return;
      e.preventDefault();
      dragDepth += 1;
      ensureDropzone().hidden = false;
    });

    document.addEventListener('dragover', function (e) {
      if (sectionAllowsDrop() && dragHasFiles(e)) e.preventDefault();
    });

    document.addEventListener('dragleave', function (e) {
      if (!dropzone || dropzone.hidden) return;
      dragDepth -= 1;
      if (dragDepth <= 0) hideDropzone();
    });

    document.addEventListener('drop', function (e) {
      var active = dropzone && !dropzone.hidden;
      if (!active) return;
      e.preventDefault();
      hideDropzone();
      if (sectionAllowsDrop() && e.dataTransfer) addFiles(e.dataTransfer.files);
    });
  }

  function mountFolders(el, opts) {
    state.el = el;
    opts = opts || {};
    state.selected = {};
    state.navId = opts.navId && SECTIONS[opts.navId] ? opts.navId : state.navId;
    wireDragAndDrop();
    wireFileContextMenu(el);
    render();
  }

  /* ── Client hub ─────────────────────────────────── */
  function mountClientHub(el) {
    var s = data().state();
    var contacts = s.clientContacts.length;
    el.innerHTML =
      '<div class="tma-portal-page">' +
      '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Client hub</h2>' +
      '<p class="tma-portal-subtitle">A dedicated space where each client sees their shared files, requests, and projects.</p>' +
      '</div></div>' +
      (s.clientHubAccess.enabled
        ? ui().banner('info', 'Client hub is <strong>enabled</strong> for this account. Manage access under Account settings &rsaquo; Client hub management.')
        : ui().banner('warning', 'Client hub is currently <strong>disabled</strong>. Enable it under Account settings &rsaquo; Client hub management.')) +
      (contacts
        ? ui().table(['Client', 'Email', 'Company'], s.clientContacts.map(function (c) {
            return '<tr><td><strong>' + ui().esc(c.firstName + ' ' + c.lastName) + '</strong></td>' +
              '<td class="tma-portal-table__muted">' + ui().esc(c.email) + '</td>' +
              '<td class="tma-portal-table__muted">' + ui().esc(c.company || '-') + '</td></tr>';
          }).join(''))
        : ui().emptyState({
            illustration: 'Illustration14',
            title: 'No clients in your hub yet',
            subtitle: 'Add client contacts under People to give them a personalized hub experience.',
            button: ui().btn({ label: 'Add client contact', attrs: 'data-hub-add-client' }),
          })) +
      '</div>';

    var add = el.querySelector('[data-hub-add-client]');
    if (add) add.addEventListener('click', function () {
      if (window.TMADashboard) window.TMADashboard.navigate({
        navId: 'people-clients', view: 'people',
        title: 'Browse client contacts', crumb: 'People / Browse client contacts',
      });
    });
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('folders', mountFolders);
    window.TMAPortalViews.register('client-hub', mountClientHub);
  }
})();
