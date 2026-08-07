/*
 * CBI — Citizenship by Investment.
 *
 * Portal-view-pattern module: mounts standalone at /dev/cbi and registers
 * with TMAPortalViews for the SPA shell (/cbi). All data is live from
 * /portal/cbi/* — loading, empty and error states only, never mock rows.
 *
 * Rendering is design-system components only (DESIGN_SYSTEM.md):
 * .tma-portal-head, ui().tabs, the Users-table .tma-dash__toolbar (icon tool
 * buttons + tma-filter-popover menus + documented search + filter chips),
 * ui().table, .tma-pagination-bar, tma-portal-status, ui().openModal.
 *
 * Two restraint rules earned the hard way, after a first pass that read as
 * clutter: colour marks exceptions only (a chip on every row carries no
 * information), and read-only facts sit flat on the page — filled cards are
 * for forms, and nesting them produced boxes inside boxes. cbi.css is
 * page-layout glue only: tokens, no new component styling.
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/cbi';
  var TMA_ICON = 'images/icons/tma/';
  var PH_ICON = 'images/icons/phosphor/';

  function ui() { return window.TMAPortalUI || null; }
  function esc(s) {
    if (ui() && ui().esc) return ui().esc(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ok) {
    if (ui() && ui().toast) { ok === false ? ui().toastError(msg) : ui().toast(msg); return; }
    console[ok === false ? 'error' : 'log']('[CBI]', msg);
  }

  // Imported cell text becomes hrefs in a couple of places; only http(s)
  // ever renders as a link — a javascript: URL typed into Smartsheet must
  // degrade to plain text, not an anchor.
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function cbiFetch(url, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (opts.method && opts.method !== 'GET') headers['X-XSRF-TOKEN'] = csrf();
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(url, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign(headers, opts.headers || {}),
      body: opts.body,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || 'Request failed');
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  var STAGES = [
    { key: 'all', label: 'All' },
    { key: 'applications', label: 'Applications' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'tracker', label: 'Tracker' },
    { key: 'closed', label: 'Closed' },
  ];
  var STAGE_LABELS = { applications: 'Applications', assessment: 'Assessment', tracker: 'Tracker', closed: 'Closed' };

  var SORTS = [
    { value: 'recent', label: 'Recently updated' },
    { value: 'name', label: 'Name' },
    { value: 'received', label: 'Received' },
    { value: 'status', label: 'Status' },
  ];

  var FACETS = [
    { name: 'status', label: 'Status', facet: 'statuses' },
    { name: 'referred_by', label: 'Referred by', facet: 'referredBy' },
    { name: 'investment_option', label: 'Investment', facet: 'investmentOptions' },
    { name: 'assigned_to', label: 'Assigned', facet: 'assigned' },
  ];

  var PER_PAGE = 50;

  var state = {
    el: null,
    route: { view: 'list', uuid: null },
    summary: null,
    list: { items: [], total: 0, page: 1, lastPage: 1, loading: false, error: null },
    filters: { stage: '', status: '', referred_by: '', investment_option: '', assigned_to: '', q: '', sort: 'recent', needs_review: false },
    detail: { data: null, loading: false, error: null, uuid: null, posting: false, commentDraft: '', tab: 'overview' },
    searchTimer: null,
  };

  // Monotonic request tokens: without them a slow response for an earlier
  // filter (or another applicant's detail) lands after a faster later one
  // and silently overwrites it.
  var listReq = 0;

  /* ── data ── */

  function loadSummary() {
    return cbiFetch(BASE + '/summary').then(function (d) { state.summary = d; render(); })
      .catch(function () { /* summary is decoration; the list is the load-bearing call */ });
  }

  function listQuery() {
    var f = state.filters;
    var p = new URLSearchParams();
    if (f.stage) p.set('stage', f.stage);
    if (f.status) p.set('status', f.status);
    if (f.referred_by) p.set('referred_by', f.referred_by);
    if (f.investment_option) p.set('investment_option', f.investment_option);
    if (f.assigned_to) p.set('assigned_to', f.assigned_to);
    if (f.q) p.set('q', f.q);
    if (f.sort) p.set('sort', f.sort);
    if (f.needs_review) p.set('needs_review', '1');
    p.set('page', String(state.list.page));
    return p.toString();
  }

  function loadList() {
    var req = ++listReq;
    state.list.loading = true; state.list.error = null; render();
    cbiFetch(BASE + '/applications?' + listQuery())
      .then(function (d) {
        if (req !== listReq) return; // superseded by a newer request
        state.list.items = d.items || [];
        state.list.total = d.total || 0;
        state.list.lastPage = d.lastPage || 1;
        state.list.loading = false;
        render();
      })
      .catch(function (e) {
        if (req !== listReq) return;
        state.list.loading = false;
        state.list.error = (e && e.message) || 'Couldn’t load applications';
        render();
      });
  }

  function loadDetail(uuid) {
    // Identity check on the request's own detail object: a response only
    // applies while this object is still the live one, which also covers
    // re-opening the same uuid.
    var req = { data: null, loading: true, error: null, uuid: uuid, posting: false, commentDraft: '', tab: 'overview' };
    state.detail = req;
    render();
    cbiFetch(BASE + '/applications/' + encodeURIComponent(uuid))
      .then(function (d) {
        if (state.detail !== req) return;
        req.data = d; req.loading = false; render();
      })
      .catch(function (e) {
        if (state.detail !== req) return;
        req.loading = false;
        req.error = e && e.status === 404 ? 'Application not found.' : ((e && e.message) || 'Couldn’t load');
        render();
      });
  }

  /* ── routing (hash-based: works in both shells) ── */

  function parseHash() {
    var m = (location.hash || '').match(/^#\/app\/([a-f0-9-]+)/i);
    return m ? { view: 'detail', uuid: m[1] } : { view: 'list', uuid: null };
  }

  function syncRoute() {
    var route = parseHash();
    state.route = route;
    if (route.view === 'detail') {
      if (state.detail.uuid !== route.uuid || (!state.detail.data && !state.detail.loading)) loadDetail(route.uuid);
      else render();
    } else {
      render();
      if (!state.list.items.length && !state.list.loading) loadList();
    }
  }

  /* ── formatting ── */

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function fmtSize(kb) {
    if (kb == null) return '';
    if (kb < 1024) return kb + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  }
  function short(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /*
   * Colour is reserved for the exceptions. Painting a chip on every row is
   * what made this read as noise: in a 50-row table nearly every status is
   * some flavour of "in progress", so the colour carried no information.
   * Ordinary statuses render as plain muted text (the File Library's
   * treatment of Type/Sharing); only a decided outcome earns a chip.
   */
  function statusTone(status) {
    var s = String(status || '').toUpperCase();
    if (!s) return null;
    if (/GRANTED|CITIZEN/.test(s)) return 'success';
    if (/DENIED|NON COMPLIANT|RESCINDED|WITHDRAWN/.test(s)) return 'danger';
    return null;
  }
  function statusCell(status) {
    if (!status) return '<span class="tma-portal-table__muted">—</span>';
    var tone = statusTone(status);
    return tone
      ? '<span class="tma-portal-status tma-portal-status--' + tone + '">' + esc(status) + '</span>'
      : esc(status);
  }
  function stageChip(stage) {
    var label = STAGE_LABELS[stage] || stage || '—';
    return '<span class="tma-portal-status tma-portal-status--neutral">' + esc(label) + '</span>';
  }
  function reviewChip() {
    return '<span class="tma-portal-status tma-portal-status--pending" title="Weak identity — check for duplicates">Review</span>';
  }
  function num(n) {
    return (n == null) ? '' : Number(n).toLocaleString();
  }

  /* ── render: list ── */

  function syncLine() {
    var s = state.summary;
    var line = 'Synchronised from Smartsheet.';
    if (s && s.sync) {
      if (!s.sync.configured) line = 'Smartsheet is not configured in this environment.';
      else if (s.sync.syncing > 0) line = s.sync.syncing === 1 ? 'Syncing 1 sheet…' : 'Syncing ' + s.sync.syncing + ' sheets…';
      else if (s.sync.lastSuccessAt) line = 'Last synced ' + fmtDateTime(s.sync.lastSuccessAt);
      if (s.sync.sheetsWithErrors > 0) {
        line += s.sync.sheetsWithErrors === 1
          ? ' · 1 sheet needs attention'
          : ' · ' + s.sync.sheetsWithErrors + ' sheets need attention';
      }
    }
    return line;
  }

  function renderHead() {
    // Title and actions only, like every other list page. The sync state is
    // detail, not headline — it lives on the Sync button and in its dialog.
    var s = state.summary;
    var unhealthy = !!(s && s.sync && (s.sync.sheetsWithErrors > 0 || !s.sync.configured));
    var actions =
      ui().btn({
        label: 'Sync now', icon: 'ArrowsClockwise', variant: 'ghost', small: true,
        attrs: ' data-cbi-action="sync-now" title="Check Smartsheet for changes now"',
      }) +
      ui().btn({
        label: 'Sync status', icon: 'Info', variant: 'ghost', small: true,
        attrs: ' data-cbi-action="sync-status" title="' + esc(syncLine()) + '"',
      });
    return '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Citizenship by Investment</h2>' +
      (unhealthy ? '<p class="tma-portal-subtitle">' + esc(syncLine()) + '</p>' : '') +
      '</div><div class="tma-portal-head__actions">' + actions + '</div></div>';
  }

  function renderTabs() {
    var counts = (state.summary && state.summary.stages) || {};
    var total = state.summary ? state.summary.total : null;
    var items = STAGES.map(function (s) {
      var n = s.key === 'all' ? total : counts[s.key];
      return { key: s.key, label: s.label + (n != null ? '  ' + num(n) : '') };
    });
    // 'all' rather than '': tab-group.js turns an empty key into null and
    // wireTabs drops null, which made the All tab a no-op.
    return ui().tabs(items, state.filters.stage || 'all');
  }

  /* Flat documented toolbar icon button (Users-table recipe). */
  function toolBtn(iconPath, action, label, pressed, extraAttrs) {
    return '<button type="button" class="tma-dash__tool-btn' + (pressed ? ' is-active' : '') + '"' +
      ' data-cbi-action="' + esc(action) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
      (pressed != null ? ' aria-pressed="' + pressed + '"' : '') + (extraAttrs || '') + '>' +
      '<img src="' + iconPath + '" alt=""></button>';
  }

  /*
   * Two icon buttons and a search field — the Users table's toolbar. Filter
   * values live in the documented tma-filter-popover (a fields list that
   * cascades into values), so the bar stays quiet however many facets the
   * data has; what is actually applied shows as chips underneath.
   */
  function renderToolbar() {
    var f = state.filters;
    var anyFilter = !!(f.status || f.referred_by || f.investment_option || f.assigned_to || f.needs_review);
    var actions =
      toolBtn(TMA_ICON + 'FunnelSimple-16.svg', 'filter', 'Filter', anyFilter, ' data-cbi-filter-trigger aria-expanded="false"') +
      toolBtn(TMA_ICON + 'ArrowsDownUp.svg', 'sort', 'Sort', f.sort !== 'recent', ' data-cbi-sort-trigger aria-expanded="false"');

    return '<div class="tma-dash__toolbar">' +
      '<div class="tma-dash__toolbar-actions">' + actions + '</div>' +
      ui().searchInput('Search applicants', 'data-cbi-search', f.q) +
      '</div>';
  }

  /* Active filters as removable chips — the Users-table filter bar recipe. */
  function renderFilterChips() {
    var f = state.filters;
    var tags = [];
    FACETS.forEach(function (fc) {
      if (f[fc.name]) tags.push({ id: fc.name, label: fc.label + ': ' + f[fc.name], icon: 'funnel' });
    });
    if (f.needs_review) tags.push({ id: 'needs_review', label: 'Needs review', icon: 'funnel' });
    if (f.sort !== 'recent') {
      var sortLabel = 'Sort';
      SORTS.forEach(function (s) { if (s.value === f.sort) sortLabel = s.label; });
      tags.push({ id: 'sort', label: sortLabel, icon: 'arrows' });
    }
    if (!tags.length) return '';

    var html = tags.map(function (tag) {
      var icon = tag.icon === 'arrows' ? TMA_ICON + 'ArrowsDown-16.svg' : TMA_ICON + 'FunnelSimple-16.svg';
      return '<div class="tma-dash__filter-tag" role="listitem" data-tag-id="' + esc(tag.id) + '">' +
        '<img src="' + icon + '" width="16" height="16" alt="" aria-hidden="true">' +
        '<span>' + esc(tag.label) + '</span>' +
        '<button type="button" class="tma-dash__filter-tag-remove" aria-label="Remove ' + esc(tag.label) + '" data-cbi-remove-tag="' + esc(tag.id) + '">' +
        '<img src="' + TMA_ICON + 'Close-12.svg" width="6" height="6" alt=""></button></div>';
    }).join('');

    return '<div class="tma-dash__filter-bar" role="list">' + html +
      '<button type="button" class="tma-dash__filter-reset" data-cbi-action="reset-filters">Reset</button></div>';
  }

  function renderRows() {
    var l = state.list;
    if (l.loading) return ui().loading({ count: 8 });
    if (l.error) return ui().banner('warning', esc(l.error));
    if (!l.items.length) {
      return ui().emptyState({
        title: state.filters.q ? 'No results for “' + state.filters.q + '”' : 'No applications match',
        subtitle: state.filters.q ? 'Try a different search.' : 'Adjust the filters, or run a sync if this is a fresh environment.',
        illustration: 'Illustration07',
      });
    }

    // The stage column only earns its place on the unfiltered view — inside
    // a stage tab every row would repeat the tab's own name.
    var showStage = !state.filters.stage;

    var rows = l.items.map(function (a) {
      return '<tr data-cbi-open="' + esc(a.uuid) + '" data-id="' + esc(a.uuid) + '">' +
        '<td data-cbi-name>' + esc(a.applicantName || 'Unnamed applicant') +
          (a.applicantNumber ? '<div class="tma-portal-table__muted">' + esc(a.applicantNumber) + '</div>' : '') + '</td>' +
        (showStage ? '<td class="tma-portal-table__muted">' + esc(STAGE_LABELS[a.stage] || a.stage || '—') + '</td>' : '') +
        '<td>' + statusCell(a.status) + (a.needsReview ? ' ' + reviewChip() : '') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.referredBy || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.assignedTo || '—') + '</td>' +
        '<td class="tma-portal-table__muted cbi-nowrap">' + esc(fmtDate(a.receivedAt) || '—') + '</td>' +
        '<td class="tma-portal-table__muted cbi-nowrap">' + esc(fmtDate(a.modifiedAt) || '—') + '</td>' +
        '</tr>';
    }).join('');

    var headers = ['Applicant'];
    if (showStage) headers.push('Stage');
    headers.push('Status', 'Referred by', 'Assigned', 'Received', 'Updated');

    return ui().table(headers, rows, { cls: 'cbi-table' }) + renderPagination();
  }

  /* Documented pagination bar (pagination.css + the Users-table recipe). */
  function renderPagination() {
    var l = state.list;
    if (l.total <= PER_PAGE) return '';

    // A window of up to five page buttons centred on the current page.
    var start = Math.max(1, Math.min(l.page - 2, l.lastPage - 4));
    var end = Math.min(l.lastPage, start + 4);
    var pages = '';
    for (var p = start; p <= end; p++) {
      var active = p === l.page;
      pages += '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') + '"' +
        ' aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') + ' data-cbi-page="' + p + '">' +
        '<span class="tma-pagination__label">' + p + '</span></button>';
    }

    var results = l.total + (l.total === 1 ? ' result' : ' results');

    return '<div class="tma-pagination-bar tma-pagination-bar--footer" data-cbi-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
      '<span class="tma-pagination-bar__results">' + results + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' + pages +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-cbi-direction="prev"' + (l.page <= 1 ? ' disabled' : '') + '>' +
      '<img src="' + TMA_ICON + 'ArrowLineLeft-16.svg" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-cbi-direction="next"' + (l.page >= l.lastPage ? ' disabled' : '') + '>' +
      '<img src="' + TMA_ICON + 'ArrowLineRight-16.svg" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>';
  }

  function renderList() {
    // The tab group is wrapped: PortalTabGroup stamps data-tab-group-init on
    // the live node, so its role signature never matches the freshly rendered
    // one and morph rebuilds it. Contained in a plain wrapper, that rebuild
    // stops there instead of taking the toolbar (and search focus) with it.
    return renderHead() + '<div class="cbi-tabs">' + renderTabs() + '</div>' +
      renderToolbar() + renderFilterChips() +
      '<div data-cbi-body>' + renderRows() + '</div>';
  }

  /* ── filter + sort popovers (documented tma-filter-popover) ──
   *
   * Created once into document.body and positioned on open, exactly like
   * the Users table: a fields list that cascades into a values list, plus a
   * sort list. Living outside the view means a re-render never destroys
   * them mid-interaction.
   */

  var pop = null;

  function popShell(name, inner) {
    return '<div class="tma-filter-popover tma-filter-popover--fixed cbi-popover" data-cbi-popover="' + name + '" aria-hidden="true">' +
      (inner || '') + '</div>';
  }

  function ensurePopovers() {
    if (pop && pop.host && document.body.contains(pop.host)) return pop;
    var host = document.createElement('div');
    host.className = 'cbi-popover-host';
    host.innerHTML = popShell('fields') + popShell('values') + popShell('sort');
    document.body.appendChild(host);
    pop = {
      host: host,
      fields: host.querySelector('[data-cbi-popover="fields"]'),
      values: host.querySelector('[data-cbi-popover="values"]'),
      sort: host.querySelector('[data-cbi-popover="sort"]'),
    };
    wirePopovers();
    return pop;
  }

  function popItem(attr, value, label, opts) {
    opts = opts || {};
    return '<button type="button" class="tma-filter-popover__item"' +
      ' ' + attr + '="' + esc(value) + '"' + (opts.selected ? ' data-selected' : '') + '>' +
      (opts.icon ? '<img src="' + opts.icon + '" alt="" class="tma-filter-popover__item-icon" width="16" height="16">' : '') +
      '<span class="tma-filter-popover__item-label">' + esc(label) + '</span>' +
      (opts.meta ? '<span class="tma-filter-popover__item-meta">' + esc(opts.meta) + '</span>' : '') +
      (opts.chevron ? '<img src="' + TMA_ICON + 'ArrowLineRight-16.svg" alt="" class="tma-filter-popover__item-chevron" width="16" height="16" aria-hidden="true">' : '') +
      '</button>';
  }

  function fillFields() {
    var f = state.filters;
    var html = FACETS.map(function (fc) {
      return popItem('data-cbi-field', fc.name, fc.label, { chevron: true, meta: f[fc.name] ? short(f[fc.name], 14) : '' });
    }).join('') +
      '<div class="tma-filter-popover__divider"></div>' +
      popItem('data-cbi-toggle', 'needs_review', 'Needs review', { selected: f.needs_review, meta: f.needs_review ? 'On' : '' });
    pop.fields.innerHTML = html;
  }

  function fillValues(fieldName) {
    var fc = null;
    FACETS.forEach(function (x) { if (x.name === fieldName) fc = x; });
    if (!fc) return;
    var rows = (state.summary && state.summary.facets && state.summary.facets[fc.facet]) || [];
    var current = state.filters[fieldName];
    var html = popItem('data-cbi-value', '', 'All', { selected: !current });
    html += rows.map(function (r) {
      return popItem('data-cbi-value', r.value, r.value, { selected: current === r.value, meta: num(r.n) });
    }).join('');
    pop.values.innerHTML = html;
    pop.values.setAttribute('data-cbi-field-name', fieldName);
  }

  function fillSort() {
    pop.sort.innerHTML = SORTS.map(function (s) {
      return popItem('data-cbi-sort', s.value, s.label, { selected: state.filters.sort === s.value });
    }).join('');
  }

  function positionPopover(el, anchorOrRect) {
    var rect = anchorOrRect;
    if (!rect) return;
    if (typeof rect.getBoundingClientRect === 'function') rect = rect.getBoundingClientRect();
    var width = el.offsetWidth || 240;
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    var top = rect.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - el.offsetHeight - 4);
    }
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  /* The view is live when its element is still in the document and, in the
     SPA shell, its .tma-dash__view is not hidden. The standalone /dev/cbi
     shell has no such ancestor, which the `!view` arm allows for. */
  function live() {
    if (!state.el || !state.el.isConnected) return false;
    var view = state.el.closest ? state.el.closest('.tma-dash__view') : null;
    return !view || !view.hidden;
  }

  function closePopovers(keep) {
    if (!pop) return;
    [pop.fields, pop.values, pop.sort].forEach(function (el) {
      if (!el || (keep && keep.indexOf(el) !== -1)) return;
      el.removeAttribute('data-open');
      el.setAttribute('aria-hidden', 'true');
    });
    if (!keep && state.el) {
      state.el.querySelectorAll('[data-cbi-filter-trigger],[data-cbi-sort-trigger]').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
      });
    }
  }

  function openPopover(el, anchor, keep) {
    closePopovers(keep);
    el.setAttribute('data-open', 'true');
    el.setAttribute('aria-hidden', 'false');
    el._anchorRect = anchor ? anchor.getBoundingClientRect() : null;
    if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
    // offsetWidth is 0 until the element is displayed.
    requestAnimationFrame(function () { positionPopover(el, el._anchorRect); });
  }

  function wirePopovers() {
    pop.host.addEventListener('click', function (e) {
      // A popover that outlived its view must not drive a hidden page.
      if (!live()) { closePopovers(); return; }
      var field = e.target.closest('[data-cbi-field]');
      if (field) {
        e.preventDefault();
        fillValues(field.getAttribute('data-cbi-field'));
        openPopover(pop.values, field, [pop.fields]);
        return;
      }
      var toggle = e.target.closest('[data-cbi-toggle]');
      if (toggle) {
        e.preventDefault();
        state.filters.needs_review = !state.filters.needs_review;
        closePopovers();
        state.list.page = 1;
        loadList();
        return;
      }
      var value = e.target.closest('[data-cbi-value]');
      if (value) {
        e.preventDefault();
        setFilter(pop.values.getAttribute('data-cbi-field-name'), value.getAttribute('data-cbi-value'));
        closePopovers();
        return;
      }
      var sort = e.target.closest('[data-cbi-sort]');
      if (sort) {
        e.preventDefault();
        setFilter('sort', sort.getAttribute('data-cbi-sort'));
        closePopovers();
      }
    });

    document.addEventListener('click', function (e) {
      if (!pop || !pop.host.isConnected) return;
      if (!live()) { closePopovers(); return; }
      if (e.target.closest('.cbi-popover') ||
          e.target.closest('[data-cbi-filter-trigger]') ||
          e.target.closest('[data-cbi-sort-trigger]')) return;
      closePopovers();
    });

    window.addEventListener('resize', function () {
      if (!pop) return;
      [pop.fields, pop.values, pop.sort].forEach(function (el) {
        if (el && el.hasAttribute('data-open')) positionPopover(el, el._anchorRect);
      });
    });
  }

  /* ── render: detail ── */

  /*
   * A read-only fact: quiet 12px label above a 14px value, on the page
   * surface. This is the Clients profile's list-item treatment — read-only
   * facts do not belong in filled form cards, which is what made the first
   * pass read as boxes-inside-boxes.
   */
  function fact(label, value, rawHtml) {
    if (value == null || value === '') return '';
    return '<div class="tma-dash__clients-list-main">' +
      '<span class="tma-dash__clients-list-label">' + esc(label) + '</span>' +
      '<span class="tma-dash__clients-list-value">' + (rawHtml ? value : esc(value)) + '</span></div>';
  }

  function rowCount(html) {
    return (String(html || '').match(/clients-list-main/g) || []).length;
  }

  /* A titled group of facts. The shared section primitive carries the
     heading type; the grey fill lives on its separate __card class, which
     read-only facts do not want, so we omit it. */
  function factGroup(title, rowsHtml) {
    if (!rowsHtml) return '';
    return '<section class="tma-portal-section">' +
      '<h3 class="tma-portal-section__title">' + esc(title) + '</h3>' +
      '<div class="cbi-group__body">' + rowsHtml + '</div></section>';
  }

  /* A titled group wrapping arbitrary content (a table, a thread). */
  function contentGroup(title, html, note) {
    if (!html) return '';
    return '<section class="tma-portal-section">' +
      '<h3 class="tma-portal-section__title">' + esc(title) +
      (note ? '<span class="tma-portal-section__desc">' + esc(note) + '</span>' : '') + '</h3>' +
      html + '</section>';
  }

  var TIMELINE_LABELS = [
    ['received', 'Received'], ['preProcessing', 'Pre-processing'], ['submitted', 'Submitted'],
    ['accepted', 'Accepted for processing'], ['complianceDue', 'Compliance due'],
    ['decisionRequired', 'Decision required'], ['decisionReceived', 'Decision received'],
    ['corSubmitted', 'COR submitted'], ['corReceived', 'COR received'],
    ['nicRequestSent', 'NIC request sent'], ['nicLetterReceived', 'NIC letter received'],
    ['passportPadsReceived', 'Passport PADs received'], ['readyForPassportSubmission', 'Ready for passport submission'],
    ['passportSubmitted', 'Passport submitted'], ['passportReceived', 'Passports received by TMA'],
    ['originalsDelivered', 'Originals delivered'], ['finalDocumentsSent', 'Final documents sent'],
    ['appealRequested', 'Appeal requested'], ['appealSent', 'Appeal sent'], ['appealDecided', 'Appeal decided'],
  ];

  /*
   * The application workspace mirrors the portal's flagship record screen —
   * the Clients profile: a case header (name, chips, actions), a key-facts
   * strip, then underline tabs whose panels all render at once and toggle
   * with `hidden` (the documented clients-profile pattern), so switching
   * tabs never refetches.
   */
  function renderDetail() {
    var d = state.detail;
    var back = ui().btn({ label: 'Back to applications', icon: 'CaretLeft', variant: 'ghost', small: true, attrs: ' data-cbi-action="back"' });
    if (d.loading) return '<div class="cbi-backrow">' + back + '</div>' + ui().loading({ count: 6 });
    if (d.error) return '<div class="cbi-backrow">' + back + '</div>' + ui().banner('warning', esc(d.error));
    if (!d.data) return '';

    var a = d.data.application;
    var assess = d.data.assessment || [];
    var files = d.data.attachments || [];
    var comments = d.data.comments || [];
    var events = d.data.events || [];

    // One chip for the stage; the outcome only when it is decided.
    var chips =
      stageChip(a.stage) +
      (a.granted ? ' <span class="tma-portal-status tma-portal-status--success">Granted</span>' : '') +
      (a.needsReview ? ' ' + reviewChip() : '');

    var meta = [];
    if (a.applicantNumber) meta.push(esc(a.applicantNumber));
    if (a.status) meta.push(esc(a.status));
    if (a.progress) meta.push(esc(a.progress));

    var headActions =
      (safeUrl(a.sourcePermalink)
        ? '<a class="tma-no-data__btn tma-portal-btn--ghost tma-portal-btn--small" href="' + esc(safeUrl(a.sourcePermalink)) + '" target="_blank" rel="noopener">' +
          '<img class="tma-no-data__btn-icon" src="' + PH_ICON + 'ArrowSquareOut.svg" alt="" width="16" height="16"><span>Open in Smartsheet</span></a>'
        : '');

    var head =
      '<div class="cbi-backrow">' + back + '</div>' +
      '<div class="tma-portal-head cbi-detail-head"><div>' +
      '<h2 class="tma-portal-head__title cbi-detail-name">' + esc(a.applicantName || 'Unnamed applicant') + '</h2>' +
      '<p class="tma-portal-subtitle cbi-meta">' + chips +
      (meta.length ? '<span class="cbi-meta__facts">' + meta.join(' &middot; ') + '</span>' : '') + '</p>' +
      '</div><div class="tma-portal-head__actions">' + headActions + '</div></div>';

    // Key facts as flat rows on the page surface — no card. Six values a
    // case worker reads first, in one quiet band under the name.
    var strip =
      fact('Received', fmtDate(a.timeline && a.timeline.received)) +
      fact('Submitted', fmtDate(a.timeline && a.timeline.submitted)) +
      fact('Decision', fmtDate(a.timeline && a.timeline.decisionReceived)) +
      fact('Investment', a.investmentOption) +
      fact('Referred by', a.referredBy) +
      fact('Assigned', a.assignedTo);
    var stripHtml = strip ? '<div class="cbi-strip">' + strip + '</div>' : '';

    var tabs = [{ key: 'overview', label: 'Overview' }];
    if (assess.length) tabs.push({ key: 'assessment', label: 'Assessment  ' + num(assess.length) });
    tabs.push({ key: 'documents', label: 'Documents  ' + num(files.length) });
    tabs.push({ key: 'comments', label: 'Comments  ' + num(comments.length) });
    tabs.push({ key: 'activity', label: 'Activity' });
    if ((a.financials && Object.keys(a.financials).length) || (a.extra && Object.keys(a.extra).length)) {
      tabs.push({ key: 'fields', label: 'All fields' });
    }
    var activeTab = d.tab || 'overview';
    var known = tabs.some(function (t) { return t.key === activeTab; });
    if (!known) activeTab = 'overview';

    // Every panel renders; the inactive ones carry `hidden` — the documented
    // clients-profile tab-panel pattern (no refetch on switch).
    function tabPanel(key, html) {
      return '<div class="cbi-tabpanel" role="tabpanel" data-cbi-panel="' + key + '"' +
        (key === activeTab ? '' : ' hidden') + '>' + html + '</div>';
    }

    return head + stripHtml +
      '<div class="cbi-tabs">' + ui().tabs(tabs, activeTab) + '</div>' +
      tabPanel('overview', renderOverviewTab(a)) +
      (assess.length ? tabPanel('assessment', renderAssessmentTab(assess)) : '') +
      tabPanel('documents', renderDocumentsTab(files)) +
      tabPanel('comments', renderCommentsTab(comments, d)) +
      tabPanel('activity', renderActivityTab(events)) +
      tabPanel('fields', renderFieldsTab(a));
  }


  function renderOverviewTab(a) {
    var applicant =
      fact('Main applicant', a.mainApplicantName && a.mainApplicantName !== a.applicantName ? a.mainApplicantName : null) +
      fact('Date of birth', fmtDate(a.dateOfBirth)) +
      fact('Nationality', a.nationality) +
      fact('Dependents', a.dependents != null ? String(a.dependents) : null) +
      fact('Family structure', a.familyStructure) +
      fact('Contact', a.contactDetails);

    var caseFacts =
      fact('Investment option', a.investmentOption) +
      fact('Application type', a.applicationType) +
      fact('Referred by', a.referredBy) +
      fact('Promoter', a.promoter) +
      fact('Service provider', a.serviceProvider) +
      fact('Main contact', a.mainContact) +
      fact('COR number', a.corNumber) +
      fact('Passport number', a.passportNumber) +
      fact('Clio matter', safeUrl(a.clioMatterLink)
        ? '<a class="tma-portal-file-link" href="' + esc(safeUrl(a.clioMatterLink)) + '" target="_blank" rel="noopener">' + esc(a.clioMatterNumber || 'Open') + '</a>'
        : a.clioMatterNumber, !!safeUrl(a.clioMatterLink)) +
      fact('File location', a.fileLocation);

    var team =
      fact('Assigned', a.assignedTo) +
      fact('Verification officer', a.verificationOfficer) +
      fact('Due diligence officer', a.ddOfficer) +
      fact('PA assignment', a.paAssignment) +
      fact('File owner', a.fileOwner) +
      fact('Submitted by', a.submittedBy) +
      fact('Verified by', a.verifiedBy);

    var narrative =
      fact('Notes', a.notes) +
      fact('Latest comment', a.latestComment) +
      fact('Issues log', a.issuesLog) +
      fact('Agent assessment', a.agentAssessment) +
      fact('Assessment response', a.assessmentResponse);

    // Milestones as clean label/date rows, in process order — only the
    // dates the file has actually reached.
    var timelineRows = TIMELINE_LABELS.map(function (t) {
      var v = a.timeline && a.timeline[t[0]];
      if (!v) return '';
      return '<li class="tma-portal-details__row">' +
        '<span>' + esc(t[1]) + '</span>' +
        '<span class="tma-portal-details__label">' + esc(fmtDate(v)) + '</span></li>';
    }).join('');
    var timeline = timelineRows ? '<ul class="cbi-tl">' + timelineRows + '</ul>' : '';

    /* Balance the two columns by content weight. A fixed left/right split
       left one column stranded whenever a file carried few fields — which
       is most of them, since the trackers are sparsely filled. */
    var groups = [
      { html: factGroup('Applicant', applicant), weight: rowCount(applicant) },
      { html: factGroup('Case', caseFacts), weight: rowCount(caseFacts) },
      { html: factGroup('Team', team), weight: rowCount(team) },
      { html: contentGroup('Timeline', timeline), weight: (timeline.match(/<li>/g) || []).length },
      { html: factGroup('Notes', narrative), weight: rowCount(narrative) * 2 },
    ].filter(function (g) { return !!g.html; });

    var cols = [{ html: '', w: 0 }, { html: '', w: 0 }];
    groups.forEach(function (g) {
      var target = cols[0].w <= cols[1].w ? cols[0] : cols[1];
      target.html += g.html;
      target.w += g.weight + 1;   // +1 so the heading itself carries weight
    });

    return '<div class="cbi-overview-grid">' +
      cols.map(function (c) {
        return c.html ? '<div class="cbi-overview-grid__col">' + c.html + '</div>' : '';
      }).join('') +
      '</div>';
  }

  function renderAssessmentTab(assess) {
    var doneCount = assess.filter(function (i) { return i.done; }).length;
    var rows = assess.map(function (i) {
      var main = i.description || i.applicantLabel || i.label || '';
      var notes = [i.notes, i.agentAssessment, i.response].filter(Boolean).join(' · ');
      return '<tr>' +
        '<td class="tma-portal-cell--tight">' + (i.done
          ? '<span class="tma-portal-status tma-portal-status--success">Done</span>'
          : '<span class="tma-portal-status tma-portal-status--neutral">Open</span>') + '</td>' +
        '<td' + (i.indent ? ' class="cbi-indent"' : '') + '>' + esc(main) +
        (notes ? '<div class="tma-portal-table__muted">' + esc(notes) + '</div>' : '') + '</td>' +
        '</tr>';
    }).join('');
    return contentGroup('Assessment checklist',
      ui().table([{ html: '', attrs: ' class="tma-portal-cell--tight"' }, 'Item'], rows),
      doneCount + ' of ' + assess.length + ' complete');
  }

  function renderDocumentsTab(files) {
    if (!files.length) {
      return ui().emptyState({ title: 'No documents yet', subtitle: 'Files attached in Smartsheet appear here after a sync.', illustration: 'Illustration07' });
    }
    var rows = files.map(function (f) {
      return '<tr>' +
        '<td><a class="tma-portal-file-link" href="' + BASE + '/attachments/' + f.id + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></td>' +
        '<td class="tma-portal-table__muted">' + esc(fmtSize(f.sizeKb) || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(f.by || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(fmtDate(f.at) || '—') + '</td>' +
        '</tr>';
    }).join('');
    return contentGroup('Documents',
      ui().table(['Name', 'Size', 'Added by', 'Date'], rows),
      files.length === 1 ? '1 file' : files.length + ' files');
  }

  function renderCommentsTab(comments, d) {
    var sources = (d.data && d.data.sources) || [];
    var thread = '<div class="cbi-comments" data-cbi-comments>' +
      (comments.length ? comments.map(function (c) {
        return '<div class="cbi-comment" data-id="c' + esc(c.id) + '">' +
          '<div class="cbi-comment__head"><span class="cbi-comment__author">' + esc(c.author) + '</span>' +
          '<span class="tma-portal-table__muted">' + esc(fmtDateTime(c.at)) + '</span>' +
          (c.source === 'smartsheet' ? '<span class="tma-portal-chip">Smartsheet</span>' : '') + '</div>' +
          '<div class="cbi-comment__body">' + esc(c.body) + '</div></div>';
      }).join('') : '<p class="tma-portal-subtitle">No comments yet — start the conversation below.</p>') +
      '</div>' +
      '<div class="cbi-composer">' +
        // The draft lives in state, not just the DOM: a morph that touches
        // an unfocused textarea syncs it to the rendered value, so an
        // unmanaged draft would vanish on the next re-render.
        '<textarea class="tma-portal-input" data-cbi-comment-input placeholder="Add a comment…" maxlength="8000" aria-label="Add a comment">' + esc(d.commentDraft || '') + '</textarea>' +
        ui().btn({ label: d.posting ? 'Posting…' : 'Post', small: true, attrs: ' data-cbi-action="post-comment"', disabled: d.posting }) +
      '</div>';
    return contentGroup('Comments', thread,
      sources.length > 1 ? sources.length + ' Smartsheet rows merged into this file' : '');
  }

  function renderActivityTab(events) {
    var EVENT_LABELS = {
      imported: 'Imported from Smartsheet', stage_changed: 'Stage changed', status_changed: 'Status changed',
      assigned: 'Assignment changed', comment_added: 'Comment added', field_changed: 'Field changed',
    };
    var body;
    if (events.length) {
      body = '<ul class="cbi-activity">' + events.map(function (e) {
        var what = '<strong>' + esc(EVENT_LABELS[e.type] || e.type) + '</strong>';
        if (e.from || e.to) what += ' ' + (e.from ? esc(e.from) : '—') + ' → ' + (e.to ? esc(e.to) : '—');
        if (e.actor) what += ' · ' + esc(e.actor);
        return '<li><span class="tma-portal-table__muted cbi-activity__time">' + esc(fmtDateTime(e.at)) + '</span>' +
          '<span>' + what + '</span></li>';
      }).join('') + '</ul>';
    } else {
      body = '<p class="tma-portal-subtitle">History accrues from the first sync onward.</p>';
    }
    return contentGroup('Activity', body);
  }

  function renderFieldsTab(a) {
    function kvRows(obj) {
      var keys = Object.keys(obj || {});
      if (!keys.length) return '';
      return keys.sort().map(function (k) {
        return '<tr><td class="tma-portal-table__muted">' + esc(k) + '</td><td>' + esc(String(obj[k])) + '</td></tr>';
      }).join('');
    }
    var finRows = kvRows(a.financials);
    var extraRows = kvRows(a.extra);
    if (!finRows && !extraRows) {
      return ui().emptyState({ title: 'Nothing extra imported', illustration: 'Illustration07' });
    }
    return (finRows ? contentGroup('Billing & payments', ui().table(['Field', 'Value'], finRows)) : '') +
      (extraRows ? contentGroup('Other imported fields', ui().table(['Field', 'Value'], extraRows),
        'Imported for completeness') : '');
  }

  /* ── render root ── */

  function render() {
    if (!state.el || !ui()) return;
    var html = '<div class="tma-portal-page tma-portal-page--cbi">' +
      (state.route.view === 'detail' ? renderDetail() : renderList()) +
      '</div>';
    if (window.TMAMorph) window.TMAMorph.patch(state.el, html);
    else state.el.innerHTML = html;
    wire();
  }

  /* ── events (delegated named handlers — safe across morphs) ── */

  function onClick(e) {
    var open = e.target.closest('[data-cbi-open]');
    if (open) { location.hash = '#/app/' + open.getAttribute('data-cbi-open'); return; }

    var page = e.target.closest('[data-cbi-page]');
    if (page && !page.disabled) {
      state.list.page = parseInt(page.getAttribute('data-cbi-page'), 10) || 1;
      loadList();
      return;
    }
    var dir = e.target.closest('[data-cbi-direction]');
    if (dir && !dir.disabled) {
      var delta = dir.getAttribute('data-cbi-direction') === 'prev' ? -1 : 1;
      var next = state.list.page + delta;
      if (next >= 1 && next <= state.list.lastPage) { state.list.page = next; loadList(); }
      return;
    }

    var removeTag = e.target.closest('[data-cbi-remove-tag]');
    if (removeTag) {
      var id = removeTag.getAttribute('data-cbi-remove-tag');
      if (id === 'needs_review') state.filters.needs_review = false;
      else if (id === 'sort') state.filters.sort = 'recent';
      else state.filters[id] = '';
      state.list.page = 1;
      loadList();
      return;
    }

    var filterBtn = e.target.closest('[data-cbi-filter-trigger]');
    if (filterBtn) {
      e.preventDefault();
      var p = ensurePopovers();
      if (p.fields.hasAttribute('data-open')) { closePopovers(); return; }
      fillFields();
      openPopover(p.fields, filterBtn);
      return;
    }
    var sortBtn = e.target.closest('[data-cbi-sort-trigger]');
    if (sortBtn) {
      e.preventDefault();
      var p2 = ensurePopovers();
      if (p2.sort.hasAttribute('data-open')) { closePopovers(); return; }
      fillSort();
      openPopover(p2.sort, sortBtn);
      return;
    }

    var action = e.target.closest('[data-cbi-action]');
    if (!action || action.disabled) return;
    handleAction(action.getAttribute('data-cbi-action'));
  }

  function commitSearch(value) {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(function () {
      state.filters.q = (value || '').trim();
      state.list.page = 1;
      loadList();
    }, 300);
  }

  function onInput(e) {
    // The comment draft mirrors into state so morphs can't eat it.
    var comment = e.target.closest('[data-cbi-comment-input]');
    if (comment) { state.detail.commentDraft = comment.value; return; }

    // Search normally goes through wireToolbarSearch (which also powers the
    // clear button and focus classes); this is the standalone fallback.
    var search = e.target.closest('[data-cbi-search]');
    if (search && !search._portalToolbarSearchWired) commitSearch(search.value);
  }

  function setFilter(name, value) {
    state.filters[name] = value;
    state.list.page = 1;
    loadList();
  }

  function handleAction(action) {
    switch (action) {
      case 'back':
        location.hash = '#/';
        loadSummary();
        loadList();
        break;
      case 'reset-filters':
        state.filters.status = '';
        state.filters.referred_by = '';
        state.filters.investment_option = '';
        state.filters.assigned_to = '';
        state.filters.needs_review = false;
        state.filters.sort = 'recent';
        state.list.page = 1;
        loadList();
        break;
      case 'sync-now':
        cbiFetch(BASE + '/sync', { method: 'POST' })
          .then(function (d) {
            toast(d.queued ? 'Queued ' + d.queued + ' sheet sync(s).' : 'Everything already up to date.');
            loadSummary();
          })
          .catch(function (e) { toast((e && e.message) || 'Sync failed to start', false); });
        break;
      case 'sync-status':
        openSyncStatus();
        break;
      case 'post-comment':
        postComment();
        break;
    }
  }

  function postComment() {
    // Capture the request's own detail object exactly as loadDetail does: the
    // reader can go back and open another applicant while the POST is in
    // flight, and a late response must not land on whoever is open then.
    var d = state.detail;
    var input = state.el.querySelector('[data-cbi-comment-input]');
    if (!input) return;
    var body = input.value.trim();
    if (!body || d.posting) return;
    d.posting = true;
    d.commentDraft = body;
    render();
    cbiFetch(BASE + '/applications/' + encodeURIComponent(d.uuid) + '/comments', { method: 'POST', json: { body: body } })
      .then(function (c) {
        d.posting = false;
        d.commentDraft = '';
        if (d.data) d.data.comments.push(c);
        if (state.detail !== d) return;   // reader moved on; nothing to repaint
        render();
        // The morph never rewrites a FOCUSED textarea, so clear it directly
        // for the case where the cursor stayed in the composer.
        var live = state.el.querySelector('[data-cbi-comment-input]');
        if (live) live.value = '';
        var thread = state.el.querySelector('[data-cbi-comments]');
        if (thread) thread.scrollTop = thread.scrollHeight;
      })
      .catch(function (e) {
        // Draft stays in state, so the failure render restores the text.
        d.posting = false;
        if (state.detail === d) render();
        toast((e && e.message) || 'Couldn’t post the comment', false);
      });
  }

  function openSyncStatus() {
    cbiFetch(BASE + '/sync').then(function (d) {
      var sheets = d.sheets || [];
      var withIssues = sheets.filter(function (s) { return s.lastError || s.status === 'error'; });
      var rows = sheets.slice(0, 80).map(function (s) {
        return '<tr><td>' + esc(s.name) +
          '<div class="tma-portal-table__muted">' + esc(s.category) + ' · ' + s.rows + ' rows</div></td>' +
          '<td>' + esc(s.status) +
          (s.lastSuccessAt ? '<div class="tma-portal-table__muted">' + esc(fmtDateTime(s.lastSuccessAt)) + '</div>' : '') +
          (s.lastError ? '<div class="tma-portal-field__error">' + esc(s.lastError) + '</div>' : '') + '</td></tr>';
      }).join('');
      var body = '<div class="cbi-sync-scroll">' +
        '<p class="tma-portal-subtitle">' + sheets.length + ' sheet(s) mirrored' +
        (withIssues.length ? ' · ' + withIssues.length + ' with errors' : ' · all healthy') + '</p>' +
        ui().table(['Sheet', 'Status'], rows) + '</div>';
      ui().openModal({ title: 'Smartsheet sync', body: body });
    }).catch(function (e) { toast((e && e.message) || 'Couldn’t load sync status', false); });
  }

  /* ── mount ── */

  function wire() {
    var el = state.el;
    if (!el) return;
    // Named handlers: addEventListener dedupes identical re-registrations.
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);

    // The shared toolbar-search wiring owns the clear (X) button, focus
    // classes and keystroke commits; its own guard makes re-calls safe.
    if (ui() && ui().wireToolbarSearch) {
      ui().wireToolbarSearch(el, '[data-cbi-search]', commitSearch);
    }

    /* The tab markup is new on every repaint and needs re-initialising, but
       `el` is the same node — wiring the change listener again would stack
       another handler on it each time (the documented portal-admin guard).
       One handler serves both tab groups: the stage tabs on the list and
       the workspace tabs on the detail never coexist, so the route decides
       what a key means. */
    if (el._cbiTabsWired) {
      if (window.PortalTabGroup) window.PortalTabGroup.init(el);
    } else if (ui() && ui().wireTabs) {
      el._cbiTabsWired = true;
      ui().wireTabs(el, function (key) {
        if (state.route.view === 'detail') {
          state.detail.tab = key;
          render();
        } else {
          state.filters.stage = (key === 'all') ? '' : key;
          state.list.page = 1;
          loadList();
        }
      });
    }
  }

  function mount(el) {
    state.el = el;
    // A stale popover from a previous visit must not hang over the fresh one.
    closePopovers();
    render();
    loadSummary();
    syncRoute();
    if (!window.__cbiHashWired) {
      window.__cbiHashWired = true;
      window.addEventListener('hashchange', syncRoute);
      // Leaving CBI hides the view rather than unmounting it, so nothing else
      // would ever dismiss a popover left open on the way out.
      document.addEventListener('tma:view-rendered', function () {
        if (!live()) closePopovers();
      });
    }
  }

  // Standalone page (the /dev/cbi preview shell).
  var standaloneRoot = document.getElementById('cbi-root');
  if (standaloneRoot) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mount(standaloneRoot); });
    } else {
      mount(standaloneRoot);
    }
  }

  if (window.TMAPortalViews && !standaloneRoot) {
    window.TMAPortalViews.register('cbi', mount);
  }
})();
