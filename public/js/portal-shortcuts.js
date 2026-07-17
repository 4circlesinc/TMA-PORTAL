/*
 * TMA - Sidebar folder shortcuts (the "Folder Shortcuts" tab).
 *
 * Each user pins their own folders from the File Library; the list lives
 * server-side (/portal/files/shortcuts) so it follows them between devices.
 * The server is the authority on what may appear — it drops folders that were
 * deleted or are no longer shared with the viewer — so this module just
 * renders whatever comes back. Reuses the existing sidebar nav-item chrome.
 *
 * Globals: window.TMASidebarShortcuts
 */
(function () {
  'use strict';

  function net() { return window.TMAFilesNet; }
  function ui() { return window.TMAPortalUI; }
  function esc(s) { return ui() ? ui().esc(s) : String(s == null ? '' : s); }

  var host = null;
  var items = null;      // null = not loaded yet (pinned folders)
  var groups = null;     // server-provided auto sections (assigned/org/staff)
  var status = 'idle';   // 'idle' | 'loading' | 'ready' | 'error'
  var inFlight = null;

  /* ── rendering ─────────────────────────────────────── */

  function skeleton() {
    var row = '<div class="tma-dash__shortcut-skeleton tma-skeleton"></div>';
    return row + row + row;
  }

  function itemHtml(it, opts) {
    opts = opts || {};
    // The parent name only rides along in the tooltip, so a nested folder is
    // still identifiable when several siblings share a name.
    var title = it.parent ? it.parent + ' / ' + it.name : it.name;
    var pinned = opts.pinned;
    return '<div class="tma-dash__shortcut" data-shortcut="' + esc(it.id) + '"' +
      (pinned ? ' draggable="true"' : '') + ' role="listitem">' +
      '<a class="tma-dash__nav-item tma-dash__nav-item--shortcut" href="/folders/all" data-shortcut-open="' + esc(it.id) + '" title="' + esc(title) + '">' +
      '<span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>' +
      '<img class="tma-dash__nav-icon" src="images/icons/phosphor/FolderFilled.svg" alt="">' +
      '<span>' + esc(it.name) + '</span>' +
      '</a>' +
      (pinned
        ? '<button type="button" class="tma-dash__shortcut-remove" data-shortcut-remove="' + esc(it.id) + '"' +
          ' aria-label="Remove ' + esc(it.name) + ' from Folder Shortcuts">' +
          '<img src="images/icons/phosphor/X.svg" alt="" width="12" height="12">' +
          '</button>'
        : '') +
      '</div>';
  }

  // An automatic (server-provided) section: a labelled group of folders the
  // user didn't pin. Rendered only when it has folders.
  function groupHtml(label, list) {
    if (!list || !list.length) return '';
    return '<div class="tma-dash__group-label">' + esc(label) + '</div>' +
      list.map(function (it) { return itemHtml(it, { pinned: false }); }).join('');
  }

  function render() {
    if (!host) return;
    if (status === 'loading' && !items) { host.innerHTML = skeleton(); return; }
    if (status === 'error') {
      host.innerHTML = '<p class="tma-dash__shortcut-note">Could not load your shortcuts. ' +
        '<button type="button" class="tma-dash__shortcut-retry" data-shortcut-retry>Retry</button></p>';
      return;
    }

    var g = groups || {};
    var auto =
      groupHtml('Assigned Clients', g.assignedClients) +
      groupHtml('Organization Folders', g.organization) +
      groupHtml('My Staff Folder', g.staff);

    var pinned = (items && items.length)
      ? '<div class="tma-dash__group-label">Pinned Folders</div>' +
        items.map(function (it) { return itemHtml(it, { pinned: true }); }).join('')
      : '';

    if (!auto && !pinned) {
      host.innerHTML = '<p class="tma-dash__shortcut-note">Add folders from the File Library for quick access.</p>';
      return;
    }

    host.innerHTML = auto + pinned;
  }

  /* ── data ──────────────────────────────────────────── */

  function apply(res) {
    items = (res && res.shortcuts) || [];
    groups = (res && res.groups) || {};
    status = 'ready';
    render();
    return items;
  }

  function load(force) {
    if (!net()) return Promise.resolve([]);
    if (!force && status === 'ready') { render(); return Promise.resolve(items); }
    if (inFlight) return inFlight;

    status = 'loading';
    render();
    inFlight = net().fetchJSON(net().url('/shortcuts'))
      .then(apply)
      .catch(function () { status = 'error'; render(); return []; })
      .then(function (r) { inFlight = null; return r; });
    return inFlight;
  }

  function isPinned(folderId) {
    return !!(items && items.some(function (i) { return i.id === folderId; }));
  }

  function add(folderId) {
    return net().fetchJSON(net().url('/shortcuts'), { method: 'POST', json: { folder: folderId } })
      .then(function (res) {
        apply(res);
        if (ui()) ui().toast('Added to Folder Shortcuts');
        return items;
      })
      .catch(function (err) {
        if (ui()) ui().toastError(err.message || 'Could not add the shortcut');
        throw err;
      });
  }

  function remove(folderId) {
    return net().fetchJSON(net().url('/shortcuts/' + encodeURIComponent(folderId)), { method: 'DELETE' })
      .then(function (res) {
        apply(res);
        if (ui()) ui().toast('Removed from Folder Shortcuts');
        return items;
      })
      .catch(function (err) {
        if (ui()) ui().toastError(err.message || 'Could not remove the shortcut');
        throw err;
      });
  }

  function persistOrder(order) {
    net().fetchJSON(net().url('/shortcuts/reorder'), { method: 'PUT', json: { order: order } })
      .then(apply)
      .catch(function () {
        if (ui()) ui().toastError('Could not save the new order');
        load(true);
      });
  }

  /* ── opening ───────────────────────────────────────── */

  function open(folderId) {
    var it = (items || []).filter(function (i) { return i.id === folderId; })[0];
    if (!window.TMADashboard) return;
    window.TMADashboard.navigate({
      navId: 'folders-all',
      view: 'folders',
      title: it ? it.name : 'All Files',
      crumb: it ? 'Folders / ' + it.name : 'Folders / All Files',
      folderId: folderId,
    });
  }

  /* ── drag to reorder ───────────────────────────────── */

  var dragged = null;

  // Only pinned rows are draggable; auto sections (assigned/org/staff) stay put.
  function rowFrom(target) {
    var row = target && target.closest ? target.closest('[data-shortcut]') : null;
    return row && row.getAttribute('draggable') === 'true' ? row : null;
  }

  function bindDrag() {
    host.addEventListener('dragstart', function (e) {
      var row = rowFrom(e.target);
      if (!row) return;
      dragged = row;
      row.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox won't start a drag without data on the transfer.
      try { e.dataTransfer.setData('text/plain', row.getAttribute('data-shortcut')); } catch (err) {}
    });

    host.addEventListener('dragover', function (e) {
      if (!dragged) return;
      var row = rowFrom(e.target);
      if (!row || row === dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var box = row.getBoundingClientRect();
      var after = e.clientY > box.top + box.height / 2;
      host.insertBefore(dragged, after ? row.nextSibling : row);
    });

    host.addEventListener('drop', function (e) { if (dragged) e.preventDefault(); });

    host.addEventListener('dragend', function () {
      if (!dragged) return;
      dragged.classList.remove('is-dragging');
      dragged = null;
      var order = Array.prototype.map.call(
        host.querySelectorAll('[data-shortcut][draggable="true"]'),
        function (r) { return r.getAttribute('data-shortcut'); }
      );
      // Re-seat the cache in DOM order so a failed save can be rolled back.
      items = order.map(function (id) {
        return (items || []).filter(function (i) { return i.id === id; })[0];
      }).filter(Boolean);
      persistOrder(order);
    });
  }

  /* ── wiring ────────────────────────────────────────── */

  function mount() {
    host = document.querySelector('[data-shortcuts]');
    if (!host) return;

    host.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-shortcut-remove]');
      if (rm) {
        e.preventDefault();
        remove(rm.getAttribute('data-shortcut-remove')).catch(function () {});
        return;
      }
      var link = e.target.closest('[data-shortcut-open]');
      if (link) {
        e.preventDefault();
        open(link.getAttribute('data-shortcut-open'));
        return;
      }
      var retry = e.target.closest('[data-shortcut-retry]');
      if (retry) load(true);
    });

    bindDrag();

    // Folders deleted, renamed or unshared elsewhere change what may appear
    // here — the server re-filters, we just re-ask.
    document.addEventListener('tma:folders-changed', function () {
      if (status === 'ready') load(true);
    });

    // Loaded up front (not on first tab open) so the File Library's folder
    // menu can offer the right "Add"/"Remove" wording straight away.
    load();
  }

  window.TMASidebarShortcuts = {
    load: load,
    refresh: function () { return load(true); },
    isPinned: isPinned,
    add: add,
    remove: remove,
    open: open,
  };

  document.addEventListener('DOMContentLoaded', mount);
})();
