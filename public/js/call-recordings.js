/*
 * Client Call Recordings — the staff area for recordings of client calls.
 *
 * Portal-view-pattern module (§ cbi.js): registers with TMAPortalViews for
 * the SPA shell (/call-recordings). All data is live from
 * /portal/call-recordings — loading, empty and error states only, never mock
 * rows (§ the file-manager rule). Rendering is design-system components
 * only: .tma-portal-head, the Users-table .tma-dash__toolbar, ui().table,
 * the documented pagination bar, ui().openModal.
 *
 * Who sees what is the server's decision (callRecordings.view; admins see
 * the firm, an employee their own calls) — this module only draws it.
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/call-recordings';
  var TMA_ICON = 'images/icons/tma/';
  var PH_ICON = 'images/icons/phosphor/';

  function ui() { return window.TMAPortalUI || null; }

  function esc(s) {
    if (ui() && ui().esc) return ui().esc(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function get(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error('Request failed');
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  var state = {
    q: '',
    clientId: '',
    from: '',
    to: '',
    page: 1,
    loading: false,
    error: null,
    data: null,
  };

  function query() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.clientId) parts.push('clientId=' + encodeURIComponent(state.clientId));
    if (state.from) parts.push('from=' + encodeURIComponent(state.from));
    if (state.to) parts.push('to=' + encodeURIComponent(state.to));
    if (state.page > 1) parts.push('page=' + state.page);
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* ── Formatting ──
   * Instants arrive as ISO and are rendered on the reader's clock — the
   * same rule the mail thread follows; never a server-formatted time. */

  function dateLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function durationLabel(ms) {
    var secs = Math.round((ms || 0) / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    if (m >= 60) {
      return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  /* "John Smith — Client Call — August 10, 2026 — 2:15 PM — 34:21" */
  function displayName(r) {
    return [
      r.clientName || 'Client',
      'Client Call',
      dateLabel(r.startedAt),
      timeLabel(r.startedAt),
      r.status === 'ready' ? durationLabel(r.durationMs) : null,
    ].filter(Boolean).join(' — ');
  }

  /* The documented five-tone system (portal-files.css): tones answer "whose
   * move is it", never a bespoke colour per status. */
  var STATUS = {
    ready: { label: 'Ready', tone: 'success' },
    recording: { label: 'Recording now', tone: 'action' },
    interrupted: { label: 'Interrupted', tone: 'pending' },
    failed: { label: 'Failed', tone: 'danger' },
  };

  function statusBadge(status) {
    var s = STATUS[status] || { label: status, tone: 'neutral' };
    return '<span class="tma-portal-status tma-portal-status--' + s.tone + '">' + esc(s.label) + '</span>';
  }

  /* ── Data ── */

  /* Monotonic request token: the LAST REQUEST wins, not whichever response
   * happens to resolve last — search latency varies per term, and without
   * this the table could settle on results for a query the box no longer
   * shows. */
  var loadSeq = 0;

  function load(root) {
    var seq = ++loadSeq;
    state.loading = true;
    state.error = null;
    renderBody(root);

    get(BASE + query()).then(function (data) {
      if (seq !== loadSeq) return;
      state.data = data;
      state.loading = false;
      renderBody(root);
    }).catch(function (err) {
      if (seq !== loadSeq) return;
      state.loading = false;
      state.error = err.status === 404
        ? 'Call recordings are not available on this account.'
        : 'Recordings could not be loaded.';
      renderBody(root);
    });
  }

  /* ── Rendering ── */

  function toolBtn(iconPath, label, active, extra) {
    return '<button type="button" class="tma-dash__tool-btn' + (active ? ' is-active' : '') +
      '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (extra || '') + '>' +
      '<img src="' + iconPath + '" alt=""></button>';
  }

  function renderShell(root) {
    root.innerHTML =
      '<div class="tma-portal-page call-recordings">' +
      '<div class="tma-dash__toolbar">' +
      '<div class="tma-dash__toolbar-actions">' +
      toolBtn(TMA_ICON + 'FunnelSimple-16.svg', 'Filter', false, ' data-recordings-filter aria-expanded="false"') +
      '</div>' +
      '<div class="tma-dash__toolbar-end">' +
      ui().searchInput('Search by client', 'data-recordings-search', state.q) +
      '</div>' +
      '</div>' +
      '<div data-recordings-chips></div>' +
      '<div data-recordings-body></div>' +
      '</div>';
  }

  function renderChips(root) {
    var host = root.querySelector('[data-recordings-chips]');
    if (!host) return;
    var chips = [];
    var clients = (state.data && state.data.clients) || [];

    if (state.clientId) {
      var client = clients.filter(function (c) { return String(c.id) === String(state.clientId); })[0];
      chips.push({ key: 'clientId', label: 'Client: ' + ((client && client.name) || state.clientId) });
    }
    if (state.from) chips.push({ key: 'from', label: 'From: ' + state.from });
    if (state.to) chips.push({ key: 'to', label: 'To: ' + state.to });

    // The documented filter-tag bar — the Users-table recipe cbi.js follows.
    host.innerHTML = chips.length
      ? '<div class="tma-dash__filter-bar" role="list">' + chips.map(function (chip) {
        return '<div class="tma-dash__filter-tag" role="listitem">' +
          '<img src="' + TMA_ICON + 'FunnelSimple-16.svg" width="16" height="16" alt="" aria-hidden="true">' +
          '<span>' + esc(chip.label) + '</span>' +
          '<button type="button" class="tma-dash__filter-tag-remove" aria-label="Remove ' + esc(chip.label) +
          '" data-recordings-chip="' + chip.key + '">' +
          '<img src="' + TMA_ICON + 'Close-12.svg" width="6" height="6" alt=""></button></div>';
      }).join('') + '</div>'
      : '';

    host.querySelectorAll('[data-recordings-chip]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state[btn.getAttribute('data-recordings-chip')] = '';
        state.page = 1;
        renderChips(root);
        load(root);
      });
    });
  }

  function renderBody(root) {
    var host = root.querySelector('[data-recordings-body]');
    if (!host) return;

    if (state.loading && !state.data) {
      host.innerHTML = ui().loading({ count: 8 });
      return;
    }
    if (state.error) {
      host.innerHTML = '<div class="tma-portal-status" role="alert">' + esc(state.error) + '</div>';
      return;
    }
    if (!state.data) return;

    var rows = state.data.recordings || [];
    if (!rows.length) {
      host.innerHTML = ui().emptyState({
        title: 'No recordings yet',
        subtitle: 'Recordings appear here after a call is captured.',
      });
      renderChips(root);
      return;
    }

    var body = rows.map(function (r) {
      var kind = r.media === 'video' ? 'Video' : 'Voice';
      return '<tr class="call-recordings__row" data-recordings-open="' + esc(r.id) + '" tabindex="0">' +
        '<td><span class="call-recordings__name">' + esc(r.clientName || 'Client') + '</span></td>' +
        '<td>' + esc(kind) + '</td>' +
        '<td>' + esc(dateLabel(r.startedAt)) + '</td>' +
        '<td>' + esc(timeLabel(r.startedAt)) + '</td>' +
        '<td>' + (r.status === 'ready' ? esc(durationLabel(r.durationMs)) : '—') + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '</tr>';
    }).join('');

    var total = state.data.total || rows.length;
    var perPage = state.data.perPage || 50;
    var lastPage = Math.max(1, Math.ceil(total / perPage));

    var pagination = '';
    if (lastPage > 1) {
      pagination =
        '<div class="tma-pagination-bar tma-pagination-bar--footer">' +
        '<div class="tma-pagination-bar__meta">' +
        '<span class="tma-pagination-bar__results">' + total + ' recording' + (total === 1 ? '' : 's') + '</span></div>' +
        '<nav class="tma-pagination" aria-label="Pagination">' +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-recordings-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>' +
        '<img src="' + TMA_ICON + 'ArrowLineLeft-16.svg" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
        '<span class="tma-pagination__label">' + state.page + ' / ' + lastPage + '</span>' +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Next page" data-recordings-page="next"' + (state.page >= lastPage ? ' disabled' : '') + '>' +
        '<img src="' + TMA_ICON + 'ArrowLineRight-16.svg" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
        '</nav></div>';
    }

    host.innerHTML =
      ui().table(['Client', 'Call', 'Date', 'Time', 'Duration', 'Status'], body, { cls: 'call-recordings__table' }) +
      pagination;
    renderChips(root);

    host.querySelectorAll('[data-recordings-open]').forEach(function (row) {
      row.addEventListener('click', function () { openDetail(row.getAttribute('data-recordings-open')); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') openDetail(row.getAttribute('data-recordings-open'));
      });
    });

    host.querySelectorAll('[data-recordings-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.page += btn.getAttribute('data-recordings-page') === 'next' ? 1 : -1;
        load(root);
      });
    });
  }

  /* ── Detail: metadata, the player, and the two ways onward ── */

  function findRecording(id) {
    return ((state.data && state.data.recordings) || []).filter(function (r) {
      return r.id === id;
    })[0] || null;
  }

  function metaRow(label, value) {
    if (!value) return '';
    return '<div class="call-recordings__meta-row">' +
      '<span class="call-recordings__meta-label">' + esc(label) + '</span>' +
      '<span class="call-recordings__meta-value">' + esc(value) + '</span></div>';
  }

  function openDetail(id) {
    var r = findRecording(id);
    if (!r || !ui()) return;

    var mediaUrl = BASE + '/' + encodeURIComponent(r.id) + '/media';
    var player = '';
    if (r.status === 'ready') {
      player = r.media === 'video'
        ? '<video class="call-recordings__player" src="' + esc(mediaUrl) + '" controls preload="metadata"></video>'
        : '<audio class="call-recordings__player" src="' + esc(mediaUrl) + '" controls preload="metadata"></audio>';
    } else {
      player = '<div class="tma-portal-status">' +
        (r.status === 'recording' ? 'This call is still being recorded.' : 'No playable recording was captured for this call.') +
        '</div>';
    }

    var participants = (r.participants || []).map(function (p) { return p.name; }).join(', ');

    var actions =
      (r.status === 'ready'
        ? '<a class="tma-no-data__btn" href="' + esc(mediaUrl) + '?download=1">Download</a>'
        : '') +
      (r.clientUid
        ? '<a class="tma-no-data__btn tma-portal-btn--ghost" href="' + esc(ROOT + '/clients/' + r.clientUid) + '">Open client</a>'
        : '') +
      (r.conversationId
        ? '<a class="tma-no-data__btn tma-portal-btn--ghost" href="' + esc(ROOT + '/social/messages?conversation=' + r.conversationId) + '">Open conversation</a>'
        : '');

    ui().openModal({
      title: displayName(r),
      body:
        '<div class="call-recordings__detail">' +
        player +
        '<div class="call-recordings__meta">' +
        metaRow('Client', r.clientName) +
        metaRow('Participants', participants) +
        metaRow('Call type', r.media === 'video' ? 'Video' : 'Voice') +
        metaRow('Date', dateLabel(r.startedAt)) +
        metaRow('Start time', timeLabel(r.startedAt)) +
        metaRow('End time', timeLabel(r.endedAt)) +
        metaRow('Duration', r.status === 'ready' ? durationLabel(r.durationMs) : null) +
        metaRow('Status', (STATUS[r.status] || { label: r.status }).label) +
        '</div>' +
        (actions ? '<div class="call-recordings__actions">' + actions + '</div>' : '') +
        '</div>',
    });
  }

  /* ── Filters ── */

  function openFilters(root) {
    if (!ui()) return;
    var clients = (state.data && state.data.clients) || [];

    var clientOptions = '<option value="">All clients</option>' + clients.map(function (c) {
      return '<option value="' + esc(String(c.id)) + '"' +
        (String(c.id) === String(state.clientId) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');

    ui().openModal({
      title: 'Filter recordings',
      body:
        '<div class="call-recordings__filters">' +
        '<label class="tma-portal-field"><span class="tma-portal-field__label">Client</span>' +
        '<select class="tma-portal-input" data-filter-client>' + clientOptions + '</select></label>' +
        '<label class="tma-portal-field"><span class="tma-portal-field__label">From</span>' +
        '<input type="date" class="tma-portal-input" data-filter-from value="' + esc(state.from) + '"></label>' +
        '<label class="tma-portal-field"><span class="tma-portal-field__label">To</span>' +
        '<input type="date" class="tma-portal-input" data-filter-to value="' + esc(state.to) + '"></label>' +
        '<div class="call-recordings__actions">' +
        '<button type="button" class="tma-no-data__btn" data-filter-apply>Apply</button>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-filter-clear>Clear</button>' +
        '</div></div>',
      onMount: function (host) {
        var apply = host.querySelector('[data-filter-apply]');
        var clear = host.querySelector('[data-filter-clear]');
        if (apply) apply.addEventListener('click', function () {
          state.clientId = host.querySelector('[data-filter-client]').value;
          state.from = host.querySelector('[data-filter-from]').value;
          state.to = host.querySelector('[data-filter-to]').value;
          state.page = 1;
          ui().closeModal();
          renderChips(root);
          load(root);
        });
        if (clear) clear.addEventListener('click', function () {
          state.clientId = '';
          state.from = '';
          state.to = '';
          state.page = 1;
          ui().closeModal();
          renderChips(root);
          load(root);
        });
      },
    });
  }

  /* ── Mount ── */

  function mount(root) {
    if (!root || !ui()) return;
    renderShell(root);
    renderChips(root);

    var filterBtn = root.querySelector('[data-recordings-filter]');
    if (filterBtn) filterBtn.addEventListener('click', function () { openFilters(root); });

    // Debounced like the Users table: one fetch per pause, not per keystroke.
    var searchTimer = null;
    ui().wireToolbarSearch(root, '[data-recordings-search]', function (value) {
      state.q = value;
      state.page = 1;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { load(root); }, 250);
    });

    load(root);
  }

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('call-recordings', mount);
  }
})();
