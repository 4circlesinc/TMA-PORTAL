/*
 * Overview → Requested Files.
 *
 * Every request the signed-in person has sent, and how far each has got:
 * which documents have arrived and which are still outstanding, when each
 * came in, and a click straight to where it was filed. Outstanding first,
 * completed after; refreshed as uploads land (on return to the tab, and
 * every half minute while it is open).
 *
 * Drawn with the portal's own cards, checklist rows and status chips — the
 * same pieces the application's Documents list uses.
 *
 * Global: window.TMAOverviewRequests
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var POLL_MS = 30000;

  function net() { return window.TMAFilesNet; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var TONES = { complete: 'success', partial: 'action', waiting: 'pending', expired: 'danger', closed: 'neutral' };

  function chip(label, tone) {
    return '<span class="tma-portal-status tma-portal-status--' + esc(tone || 'neutral') +
      ' tma-portal-status--inline">' + esc(label) + '</span>';
  }

  function outstanding(req) {
    var p = req.progress || {};
    return p.status === 'waiting' || p.status === 'partial';
  }

  function itemRow(item) {
    var when = item.received && item.uploadedAt ? 'Uploaded ' + shortDate(item.uploadedAt) : '';
    var state = item.received
      ? chip('Received', 'success')
      : (item.closed ? chip('No longer needed', 'neutral') : chip('Outstanding', 'pending'));
    var open = item.file && item.file.id
      ? '<button type="button" class="tma-portal-link" data-req-open-file="' + esc(item.file.id) + '"' +
        ' data-req-open-folder="' + esc(item.file.folderId || '') + '">Open</button>'
      : '';

    return '<li class="tma-dash__clients-checklist-row">' +
      '<span class="tma-dash__clients-checklist-label">' + esc(item.label || 'Document') +
      (item.person ? ' <span class="tma-dash__clients-checklist-optional">' + esc(item.person) + '</span>' : '') +
      (when ? ' <span class="tma-dash__clients-checklist-optional">' + esc(when) + '</span>' : '') +
      '</span>' + open + state + '</li>';
  }

  function card(req) {
    var p = req.progress || { items: [], received: 0, total: 0 };
    var who = req.recipientName || req.recipientEmail || (req.client && req.client.name) || 'Not sent yet';
    var meta = [
      'To ' + who,
      'Sent ' + shortDate(req.createdAt),
      req.lastUploadAt ? 'Last upload ' + shortDate(req.lastUploadAt) : null,
      req.expiresAt && p.status !== 'complete' ? 'Upload by ' + shortDate(req.expiresAt) : null,
    ].filter(Boolean).join(' · ');
    var count = p.total ? p.received + ' of ' + p.total + ' received' : p.received + ' received';

    return '<section class="tma-dash__clients-card">' +
      '<header class="tma-dash__clients-card-head">' +
      '<h3 class="tma-dash__clients-card-title">' + esc(req.title || 'Request') + '</h3>' +
      '<span class="tma-tab__count">' + esc(count) + '</span>' +
      '<span class="tma-dash__clients-card-action">' + chip(p.statusLabel || 'Waiting', TONES[p.status]) + '</span>' +
      '</header>' +
      '<p class="tma-dash__clients-checklist-empty">' + esc(meta) + '</p>' +
      ((p.items || []).length
        ? '<ul class="tma-dash__clients-checklist">' + p.items.map(itemRow).join('') + '</ul>'
        : '<p class="tma-dash__clients-checklist-empty">Nothing has arrived yet.</p>') +
      (req.open && req.link
        ? '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
          '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-req-copy="' + esc(req.link) + '">' +
          '<img class="tma-no-data__btn-icon" src="' + ICON + 'LinkSimple.svg" alt="" width="16" height="16"><span>Copy link</span></button>' +
          '</div>'
        : '') +
      '</section>';
  }

  function render(state) {
    var el = state.el;
    if (!el) return;

    if (state.error && !state.rows) {
      el.innerHTML = '<div class="tma-dash__overview-empty">' + esc(state.error) + '</div>';
      return;
    }
    if (!state.rows) {
      el.innerHTML = '<div class="tma-dash__overview-empty">Loading requests…</div>';
      return;
    }

    var open = state.rows.filter(outstanding);
    var done = state.rows.filter(function (r) { return !outstanding(r); });
    var list = state.filter === 'done' ? done : (state.filter === 'all' ? state.rows : open);

    var tabs = [
      { key: 'open', label: 'Outstanding', n: open.length },
      { key: 'done', label: 'Completed', n: done.length },
      { key: 'all', label: 'All', n: state.rows.length },
    ];

    el.innerHTML =
      '<div class="tma-tab-group tma-tab-group--segmented" role="tablist" aria-label="Requests">' +
      tabs.map(function (t) {
        var on = state.filter === t.key;
        return '<button type="button" class="tma-tab' + (on ? ' is-active' : '') + '" role="tab"' +
          ' aria-selected="' + (on ? 'true' : 'false') + '" data-req-filter="' + t.key + '">' +
          '<span class="tma-tab__label">' + esc(t.label) + '</span>' +
          '<span class="tma-tab__count">' + t.n + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span></button>';
      }).join('') +
      '</div>' +
      (list.length
        ? '<div class="tma-dash__clients-cards tma-overview-requests">' + list.map(card).join('') + '</div>'
        : '<div class="tma-dash__overview-empty">' +
          (state.filter === 'done' ? 'No completed requests yet.' : (state.rows.length ? 'Nothing outstanding.' : 'You have not requested any files yet. Use Request Files in the File Library or on an application.')) +
          '</div>');
  }

  function load(state, quiet) {
    if (!net()) return;
    if (!quiet && !state.rows) render(state);
    net().fetchJSON('/portal/files/requests?mine=1&progress=1')
      .then(function (res) {
        state.rows = (res && res.requests) || [];
        state.error = null;
        render(state);
      })
      .catch(function (err) {
        state.error = (err && err.message) || 'Could not load your requests.';
        render(state);
      });
  }

  function openFile(folderId, fileId) {
    var dash = window.TMADashboard;
    if (dash && dash.navigate) {
      dash.navigate({ navId: 'folders-all', folderId: folderId || null, fileId: fileId });
      return;
    }
    window.location.href = '/folders?' + (folderId ? 'folder=' + encodeURIComponent(folderId) + '&' : '') +
      'file=' + encodeURIComponent(fileId);
  }

  function mount(el) {
    if (!el) return;
    var state = el._requestsState;
    if (!state) {
      state = el._requestsState = { el: el, rows: null, error: null, filter: 'open', timer: null };

      el.addEventListener('click', function (e) {
        var filter = e.target.closest('[data-req-filter]');
        if (filter) {
          state.filter = filter.getAttribute('data-req-filter');
          render(state);
          return;
        }
        var file = e.target.closest('[data-req-open-file]');
        if (file) {
          openFile(file.getAttribute('data-req-open-folder'), file.getAttribute('data-req-open-file'));
          return;
        }
        var copy = e.target.closest('[data-req-copy]');
        if (copy) {
          var link = copy.getAttribute('data-req-copy');
          if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function () {});
          var label = copy.querySelector('span');
          if (label) label.textContent = 'Copied';
        }
      });

      // Uploads land while the tab is open: read again on return to the
      // window and every half minute while the panel is on screen.
      window.addEventListener('focus', function () {
        if (el.isConnected && !el.closest('[hidden]')) load(state, true);
      });
      state.timer = setInterval(function () {
        if (!el.isConnected) { clearInterval(state.timer); return; }
        if (!document.hidden && !el.closest('[hidden]')) load(state, true);
      }, POLL_MS);
    }

    load(state, !!state.rows);
  }

  window.TMAOverviewRequests = { mount: mount };
})();
