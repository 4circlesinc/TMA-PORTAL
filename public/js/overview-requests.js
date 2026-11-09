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

  var TOOL = {
    Search: 'images/icons/tma/Search-16.svg',
    XCircle: 'images/icons/tma/Xcircle.svg',
    Calendar: 'images/icons/phosphor/CalendarBlank.svg',
    Caret: 'images/icons/phosphor/CaretDown.svg',
  };

  function matches(req, q) {
    if (!q) return true;
    var hay = [req.title, req.recipientName, req.recipientEmail, req.client && req.client.name]
      .concat(((req.progress || {}).items || []).map(function (i) { return i.label; }))
      .join(' ').toLowerCase();
    return hay.indexOf(q.toLowerCase()) !== -1;
  }

  /* The Files tab's own toolbar: underline tabs on the left, search on the right. */
  function renderTabs(state, counts) {
    var tabs = [
      { key: 'open', label: 'Outstanding', n: counts.open },
      { key: 'done', label: 'Completed', n: counts.done },
      { key: 'all', label: 'All', n: counts.all },
    ];

    return '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-files-tabs" role="tablist">' +
      tabs.map(function (t, i) {
        var on = state.filter === t.key;
        return '<button type="button" class="tma-tab' + (on ? ' is-active' : '') + '" role="tab"' +
          ' data-tab-index="' + i + '" data-tab-key="' + t.key + '" data-req-filter="' + t.key + '"' +
          ' aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' +
          '<span class="tma-tab__label">' + esc(t.label) + '</span>' +
          '<span class="tma-tab__count">' + t.n + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span></button>';
      }).join('') +
      '</div>';
  }

  function renderToolbar(state) {
    var classes = ['tma-dash__toolbar-search'];
    if (state.search) classes.push('tma-dash__toolbar-search--focused', 'tma-dash__toolbar-search--has-value');

    return '<div class="tma-dash__toolbar">' +
      '<div class="tma-dash__toolbar-actions"></div>' +
      '<div class="tma-dash__toolbar-end">' +
      '<div class="' + classes.join(' ') + '" role="search">' +
      '<img src="' + TOOL.Search + '" alt="">' +
      '<input type="search" class="tma-dash__search-input" placeholder="Search" aria-label="Search requests"' +
      ' value="' + esc(state.search) + '" data-req-search autocomplete="off" spellcheck="false">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-req-search-clear><img src="' + TOOL.XCircle + '" alt=""></button>' +
      '</div></div></div>';
  }

  /* One request: a row of the Files table, and its documents under it when opened. */
  function renderRow(req, open) {
    var p = req.progress || { items: [], received: 0, total: 0 };
    var who = req.recipientName || req.recipientEmail || (req.client && req.client.name) || '—';
    var count = p.total ? p.received + ' of ' + p.total : String(p.received);

    var row = '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' + (open ? ' tma-dash__ctr--selected' : '') + '"' +
      ' role="row" data-req-row="' + esc(req.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" tabindex="0">' +
      '<div class="tma-dash__cc tma-dash__cc--filename">' +
      '<img class="tma-overview-requests__caret' + (open ? ' is-open' : '') + '" src="' + TOOL.Caret + '" alt="" width="16" height="16">' +
      '<span class="tma-dash__cc-truncate">' + esc(req.title || 'Request') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--folder"><span class="tma-dash__cc-truncate">' + esc(who) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--size"><span class="tma-dash__cc-truncate">' + esc(count) + ' received</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--date"><img src="' + TOOL.Calendar + '" alt="">' + esc(shortDate(req.createdAt)) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--date"><span class="tma-dash__cc-truncate">' + esc(req.lastUploadAt ? shortDate(req.lastUploadAt) : '—') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--shared">' + chip(p.statusLabel || 'Waiting', TONES[p.status]) + '</div>' +
      '</div>';

    if (!open) return row;

    var meta = [
      req.expiresAt && p.status !== 'complete' ? 'Upload by ' + shortDate(req.expiresAt) : null,
      req.client && req.client.name ? 'Filed under ' + req.client.name : null,
    ].filter(Boolean).join(' · ');

    return row +
      '<div class="tma-overview-requests__detail" role="row">' +
      (meta ? '<p class="tma-dash__clients-checklist-empty">' + esc(meta) + '</p>' : '') +
      ((p.items || []).length
        ? '<ul class="tma-dash__clients-checklist">' + p.items.map(itemRow).join('') + '</ul>'
        : '<p class="tma-dash__clients-checklist-empty">Nothing has arrived yet.</p>') +
      (req.open && req.link
        ? '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
          '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-req-copy="' + esc(req.link) + '">' +
          '<img class="tma-no-data__btn-icon" src="' + ICON + 'LinkSimple.svg" alt="" width="16" height="16"><span>Copy link</span></button>' +
          '</div>'
        : '') +
      '</div>';
  }

  function render(state) {
    var el = state.el;
    if (!el) return;
    el.className = 'tma-dash__files tma-dash__files--overview';

    var rows = state.rows || [];
    var open = rows.filter(outstanding);
    var done = rows.filter(function (r) { return !outstanding(r); });
    var list = (state.filter === 'done' ? done : (state.filter === 'all' ? rows : open))
      .filter(function (r) { return matches(r, state.search); });

    var emptyTitle = state.error ? 'Could not load your requests'
      : !state.rows ? 'Loading requests'
      : state.search ? 'No matching requests'
      : state.filter === 'done' ? 'No completed requests yet'
      : rows.length ? 'Nothing outstanding' : 'No requests yet';
    var emptyText = state.error ? state.error
      : !state.rows ? 'One moment…'
      : state.search ? 'Try a different search.'
      : rows.length ? 'Everything you asked for has arrived.'
      : 'Files and documents you request show up here, with what has arrived.';
    var emptyHtml = window.TMANoData
      ? window.TMANoData.render({ illustrationName: 'Illustration07', title: emptyTitle, subtitle: emptyText, showButton: false })
      : '<p class="tma-dash__overview-empty">' + esc(emptyText) + '</p>';

    var body = list.length
      ? '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Requested files">' +
        '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
        '<div class="tma-dash__cc tma-dash__cc--filename tma-dash__cc--head">Request</div>' +
        '<div class="tma-dash__cc tma-dash__cc--folder tma-dash__cc--head">Sent to</div>' +
        '<div class="tma-dash__cc tma-dash__cc--size tma-dash__cc--head">Progress</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Sent</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Last upload</div>' +
        '<div class="tma-dash__cc tma-dash__cc--shared tma-dash__cc--head">Status</div>' +
        '</div>' +
        list.map(function (r) { return renderRow(r, !!state.expanded[r.id]); }).join('') +
        '</div>'
      : '<div class="tma-dash__files-empty">' + emptyHtml + '</div>';

    var focused = document.activeElement && document.activeElement.hasAttribute
      && document.activeElement.hasAttribute('data-req-search');
    var caret = focused ? document.activeElement.selectionStart : null;

    el.innerHTML = renderTabs(state, { open: open.length, done: done.length, all: rows.length }) +
      renderToolbar(state) + body;

    if (focused) {
      var input = el.querySelector('[data-req-search]');
      if (input) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
    }
  }

  function load(state, quiet) {
    if (!net()) return;
    if (!quiet && !state.rows) render(state);
    net().fetchJSON('/portal/files/requests?mine=1&progress=1')
      .then(function (res) {
        var first = state.rows === null;
        state.rows = (res && res.requests) || [];
        state.error = null;
        if (first) {
          var lead = state.rows.filter(outstanding)[0];
          if (lead) state.expanded[lead.id] = true;
        }
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
      state = el._requestsState = { el: el, rows: null, error: null, filter: 'open', timer: null, search: '', expanded: {} };

      el.addEventListener('input', function (e) {
        if (!e.target.hasAttribute('data-req-search')) return;
        state.search = e.target.value.trim();
        render(state);
      });

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
        if (e.target.closest('[data-req-search-clear]')) {
          state.search = '';
          render(state);
          return;
        }
        var row = e.target.closest('[data-req-row]');
        if (row) {
          var id = row.getAttribute('data-req-row');
          state.expanded[id] = !state.expanded[id];
          render(state);
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
