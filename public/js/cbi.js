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

  function pushSmartsheetToast(docs) {
    if (!window.TMASyncToasts) return;
    if (!docs || !docs.active) {
      if (state._smartsheetToastWatching && docs && docs.done > 0 && window.TMASyncToasts.update) {
        window.TMASyncToasts.update('smartsheet', {
          state: 'done',
          synced: docs.done,
          total: docs.total || docs.done,
          clients: docs.clients,
        });
      }
      state._smartsheetToastWatching = false;
      return;
    }
    // Same bottom-right card Outlook uses while mail is uploading/syncing.
    // watch() once so minimise/dismiss state isn't reset every poll tick.
    if (!state._smartsheetToastWatching) {
      state._smartsheetToastWatching = true;
      if (window.TMASyncToasts.watch) window.TMASyncToasts.watch('smartsheet');
    }
    if (window.TMASyncToasts.update) {
      window.TMASyncToasts.update('smartsheet', {
        state: 'syncing',
        synced: docs.done || 0,
        total: docs.total || 0,
        pending: docs.pending || 0,
        clients: docs.clients || 0,
      });
    }
  }

  function loadSummary() {
    return cbiFetch(BASE + '/summary').then(function (d) {
      state.summary = d;
      if (d && d.documents) {
        pushSmartsheetToast(d.documents);
        if (d.documents.active) scheduleDocsPoll();
      }
      render();
    }).catch(function () { /* summary is decoration; the list is the load-bearing call */ });
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

  function loadDetail(uuid, opts) {
    // Identity check on the request's own detail object: a response only
    // applies while this object is still the live one, which also covers
    // re-opening the same uuid.
    var opts = opts || {};
    var keepTab = opts.keepTab && state.detail && state.detail.uuid === uuid
      ? (state.detail.tab || 'overview')
      : 'overview';
    var quiet = !!opts.quiet;
    var req = {
      data: quiet && state.detail && state.detail.uuid === uuid ? state.detail.data : null,
      loading: !quiet,
      error: null,
      uuid: uuid,
      posting: false,
      commentDraft: (state.detail && state.detail.uuid === uuid) ? (state.detail.commentDraft || '') : '',
      tab: keepTab,
    };
    state.detail = req;
    if (!quiet) render();
    return cbiFetch(BASE + '/applications/' + encodeURIComponent(uuid))
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
  /*
   * Which of the five tones a status wears. Smartsheet is free text, so this
   * matches on meaning rather than listing the forty strings the caseload
   * happens to hold today — a status typed tomorrow still lands somewhere,
   * and the order is load-bearing: "PENDING COR - NCR" is waiting on somebody,
   * "APPLY FOR COR" is ours to do, and both mention COR.
   */
  function statusTone(status) {
    var s = String(status || '').toUpperCase().trim();
    if (!s) return null;

    // Refused, and every way the caseload says so.
    if (/DENIED|NON.?COMPLIANT|RESCINDED|REJECT|APPEAL LOST|FAILED/.test(s)) return 'danger';
    // Finished, and it went well.
    if (/GRANTED|CITIZEN|APPROVED|APPEAL WON|COMPLETE|RECEIVED|REVIEWED|DELIVERED/.test(s)) return 'success';
    // Parked or over without an outcome.
    if (/CLOSED|WITHDRAWN|CANCEL|FUNDS RETURNED|ON HOLD/.test(s)) return 'neutral';
    // Waiting on somebody else — the whole PENDING family, including the
    // artefact stages (NIC, COR, PADS, passport) the office tracks by name.
    if (/PENDING|AWAITING|DELAYED|BACKGROUND CHECK|APPEALED|IN PROGRESS/.test(s)) return 'pending';
    // The firm's move next.
    if (/^NEW|TO SUBMIT|APPLY FOR|READY FOR|SUBMIT|REVISION|POST APPROVAL|ASSESS/.test(s)) return 'action';

    // Anything unrecognised still gets a chip. A status with no colour reads
    // as a status with no meaning, which is what this change set out to fix.
    return 'neutral';
  }

  /*
   * Everyone on the case, as faces and first names.
   *
   * These were seven labelled rows — assigned, verification officer, DD
   * officer, PA, file owner, submitted by, verified by — most of them empty on
   * most files, and where they were filled they usually named the same two
   * people. It is a list of who is on this, so it reads as one: a face, a
   * first name, commas between. The role survives on hover rather than taking
   * a row of its own.
   */
  /* Who is on this case: the shared people cell (person-card.js), which the
     File Library's Owner column draws too. This lived here first; it moved out
     whole when the second caller appeared, rather than being copied. */
  function peopleOnCase(a) {
    var people = (a && a.people) || [];
    if (!window.TMAPersonCard) {
      return '<span class="tma-portal-table__muted">' +
        esc(people.map(function (p) { return p.first || p.name; }).join(', ') || 'Unassigned') + '</span>';
    }
    return window.TMAPersonCard.faces(people, { emptyLabel: 'Unassigned' });
  }

  /* The person card itself now lives in public/js/person-card.js
     (window.TMAPersonCard), shared with the File Library. */

  function statusCell(status) {
    if (!status) return '<span class="tma-portal-table__muted">—</span>';
    return '<span class="tma-portal-status tma-portal-status--' + statusTone(status) + '">' +
      esc(status) + '</span>';
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

  /*
   * A colleague, as a face and a name. The portal's own initials avatar
   * (TMACurrentUser.initialsFor) colours the circle by hashing the name, so
   * one person keeps the same colour everywhere and two people beside each
   * other are told apart at a glance — which a column of identical grey
   * circles never managed.
   */


  /* ── render: list ── */

  function docsProgress() {
    return (state.summary && state.summary.documents) || null;
  }

  function docsProgressLine() {
    var d = docsProgress();
    if (!d || !d.active) return '';
    return 'Importing documents: ' + num(d.done) + ' of ' + num(d.total) +
      ' filed (' + num(d.pending) + ' left · ' + d.percent + '%)';
  }

  function syncLine() {
    var s = state.summary;
    var docs = docsProgressLine();
    if (docs) return docs;
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

  /*
   * The sync controls, and nothing else.
   *
   * The page title is gone: the sidebar row and the browser tab already say
   * which page this is, and a heading repeating it cost a whole band above the
   * only thing the reader came for. The buttons move onto the tab row — the
   * one line the page already had — rather than keeping a row to themselves.
   */
  function renderHeadActions() {
    var s = state.summary;
    var unhealthy = !!(s && s.sync && (s.sync.sheetsWithErrors > 0 || !s.sync.configured));
    var docs = docsProgress();
    var statusLine = docs && docs.active ? docsProgressLine() : (unhealthy ? syncLine() : '');

    return '<div class="cbi-tabs__actions">' +
      (statusLine
        ? '<span class="tma-portal-subtitle' + (unhealthy && !(docs && docs.active) ? ' cbi-tabs__warning' : '') +
          '" data-cbi-docs-progress>' + esc(statusLine) + '</span>'
        : '') +
      ui().btn({
        label: 'Sync now', icon: 'Smart_sheet', variant: 'ghost', small: true,
        attrs: ' data-cbi-action="sync-now" title="Check Smartsheet for changes now"',
      }) +
      ui().btn({
        label: 'Sync status', icon: 'Smart_sheet', variant: 'ghost', small: true,
        attrs: ' data-cbi-action="sync-status" title="' + esc(syncLine()) + '"',
      }) +
      '</div>';
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
        '<td>' + peopleOnCase(a) + '</td>' +
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
    return '<div class="cbi-tabs">' + renderTabs() + renderHeadActions() + '</div>' +
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
  function factGroup(title, rowsHtml, full) {
    if (!rowsHtml) return '';
    return '<section class="tma-portal-section cbi-card' + (full ? ' cbi-card--full' : '') + '">' +
      '<h3 class="tma-portal-section__title">' + esc(title) + '</h3>' +
      '<div class="cbi-group__body">' + rowsHtml + '</div></section>';
  }

  /* A titled group wrapping arbitrary content (a table, a thread). */
  function contentGroup(title, html, note, full) {
    if (!html) return '';
    return '<section class="tma-portal-section cbi-card' + (full ? ' cbi-card--full' : '') + '">' +
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
    // The Clients hub's back button, not a ghost pill: the two record pages
    // sit next to each other in the sidebar and the way out of them should not
    // be two different shapes. dashboard.css is loaded on both CBI shells, so
    // this is the same button rather than a copy of it.
    var back =
      '<button type="button" class="tma-dash__clients-back-btn" data-cbi-action="back"' +
      ' aria-label="Back to applications">' +
      '<img src="' + PH_ICON + 'CaretLeft.svg" alt="" aria-hidden="true">' +
      '<span>Applications</span></button>';
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

    // Key facts, in a card of their own. They used to sit flat on the page
    // under the name; on a page that is otherwise all cards the one unbacked
    // band read as something that had failed to load.
    var strip =
      fact('Received', fmtDate(a.timeline && a.timeline.received)) +
      fact('Submitted', fmtDate(a.timeline && a.timeline.submitted)) +
      fact('Decision', fmtDate(a.timeline && a.timeline.decisionReceived)) +
      fact('Investment', a.investmentOption) +
      fact('Referred by', a.referredBy) +
      // Everyone on the file, as faces and first names, in the one fact the
      // reader looks for first.
      fact('Assigned', peopleOnCase(a), true) +
      // The applicant's record in the Client hub. The case is the record of
      // truth for the file; the client is the record of truth for the person.
      fact('Client record', a.clientUid
        ? '<a class="tma-dash__clients-list-link" href="' + esc((window.__TMA_SITE_ROOT || '') + '/clients/' + encodeURIComponent(a.clientUid)) +
          '">' + esc(a.clientName || 'Open in Client hub') + '</a>'
        : null, true);
    var stripHtml = strip
      ? '<section class="cbi-card cbi-card--strip"><div class="cbi-strip">' + strip + '</div></section>'
      : '';

    var tabs = [{ key: 'overview', label: 'Overview' }];
    if (assess.length) tabs.push({ key: 'assessment', label: 'Assessment  ' + num(assess.length) });
    // Count starts as mirrored attachments; the folder panel replaces it with
    // the live File Library total once the listing loads.
    var mirrored = files.filter(function (f) { return f.fileId; }).length;
    tabs.push({ key: 'documents', label: 'Documents' + (mirrored ? '  ' + num(mirrored) : (files.length ? '  ' + num(files.length) : '')) });
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

    // Tabs above the facts card: the card is the case at a glance and stays
    // put whichever tab is open, so the tab row belongs between the name and
    // everything that follows it.
    return head +
      '<div class="cbi-tabs">' + ui().tabs(tabs, activeTab) + '</div>' +
      stripHtml +
      tabPanel('overview', renderOverviewTab(a)) +
      (assess.length ? tabPanel('assessment', renderAssessmentTab(assess)) : '') +
      tabPanel('documents', renderDocumentsTab(d)) +
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

    /*
     * A card grid rather than two balanced columns of headings. The short
     * groups pair up; Timeline and Notes are the two that run long, so they
     * take the full width instead of stretching one column down the page.
     * Empty groups drop out, so a sparsely filled file shows three tidy cards
     * rather than a scaffold of empty headings.
     */
    var cards = [
      factGroup('Applicant', applicant),
      factGroup('Case', caseFacts),
      contentGroup('Timeline', timeline),
      factGroup('Notes', narrative),
    ].filter(Boolean).join('');

    if (!cards) {
      return ui().emptyState({
        title: 'Nothing recorded yet',
        subtitle: 'Details appear here as the trackers are filled in.',
        illustration: 'Illustration07',
      });
    }

    return '<div class="cbi-cards">' + cards + '</div>';
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

  /*
   * Documents — the client's File Library folder, same window the Client hub
   * opens under its Documents tab.
   *
   * Smartsheet attachments are mirrored into that folder on sync. Showing the
   * live folder (icons, review chips, lightbox) rather than a separate
   * attachment table means both doors open the same file.
   */
  var cbiFolderNav = null;
  var cbiFolderFiles = [];
  var cbiFolderFolders = [];

  function renderDocumentsTab(d) {
    var folderUuid = d.data && d.data.folderUuid;
    var pending = (d.data && d.data.pendingDocuments) || 0;
    var clientUid = d.data && d.data.application && d.data.application.clientUid;

    if (!folderUuid) {
      return ui().emptyState({
        title: clientUid ? 'Folder not ready yet' : 'No client folder yet',
        subtitle: clientUid
          ? 'Run Sync to provision this client’s File Library folder and pull documents across.'
          : 'Sync links this applicant to the Client hub and files Smartsheet documents in their folder.',
        illustration: 'Illustration07',
      });
    }

    var global = docsProgress();
    var pendingBits = [];
    if (pending) {
      pendingBits.push(pending === 1
        ? '1 Smartsheet file for this client is still copying into this folder'
        : pending + ' Smartsheet files for this client are still copying into this folder');
    }
    if (global && global.active) {
      pendingBits.push('Overall: ' + num(global.done) + ' of ' + num(global.total) +
        ' filed (' + global.percent + '% · ' + num(global.pending) + ' left across the caseload)');
    }
    var pendingNote = pendingBits.length
      ? '<p class="tma-portal-subtitle cbi-docs-pending" data-cbi-docs-progress>' +
        esc(pendingBits.join('. ') + '.') + '</p>'
      : '';

    return contentGroup('Documents',
      pendingNote +
      '<div class="tma-dash__clients-folders-head">' +
        '<span class="tma-dash__clients-folders-title" data-cbi-folder-crumbs>Client documents</span>' +
        '<div class="tma-dash__clients-folders-actions">' +
          '<button type="button" class="tma-dash__clients-folders-add" data-cbi-folder-new>' +
            '<img src="' + PH_ICON + 'Plus.svg" alt=""><span>New folder</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-cbi-folder-upload>' +
            '<img src="' + PH_ICON + 'ArrowLineUp.svg" alt=""><span>Upload</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-cbi-folder-request>' +
            '<img src="' + PH_ICON + 'DownloadSimple.svg" alt=""><span>Request files</span></button>' +
          '<button type="button" class="tma-dash__clients-folders-add" data-cbi-open-library>' +
            '<img src="' + PH_ICON + 'FolderNotch.svg" alt=""><span>Open in File Library</span></button>' +
          '<input type="file" multiple hidden data-cbi-folder-fileinput>' +
        '</div>' +
      '</div>' +
      '<div class="tma-dash__clients-folders" data-cbi-folder-drop' +
        ' data-folder-uuid="' + esc(folderUuid) + '"' +
        ' data-root-uuid="' + esc(folderUuid) + '"' +
        (clientUid ? ' data-client-uid="' + esc(clientUid) + '"' : '') + '>' +
        '<div data-cbi-folder-canvas data-morph-skip>' +
          '<div class="tma-dash__clients-assigned-empty" data-cbi-folder-list>Loading…</div>' +
        '</div>' +
      '</div>',
      '');
  }

  function filesNet() { return window.TMAFilesNet; }

  function cbiStatusChip(f) {
    var s = f && f.status;
    if (!s || !s.label) return '';
    return '<span class="tma-portal-status tma-portal-status--' + esc(s.tone || 'neutral') +
      ' tma-portal-status--inline">' + esc(s.label) + '</span>';
  }

  function cbiFolderMetaLabel(f) {
    var parts = [];
    var files = f.fileCount || 0;
    var folders = f.folderCount || 0;
    if (files) parts.push(files + (files === 1 ? ' file' : ' files'));
    if (folders) parts.push(folders + (folders === 1 ? ' folder' : ' folders'));
    if (!parts.length) return 'Empty';
    if (f.sizeLabel) parts.push(f.sizeLabel);
    return parts.join(' · ');
  }

  function fmtShortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cbiFolderCanvas(root) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    if (!wrap) return null;
    return wrap.querySelector('[data-cbi-folder-canvas]') || wrap;
  }

  function renderCbiFolderList(root, res) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    var canvas = cbiFolderCanvas(root);
    if (!wrap || !canvas) return;
    var folders = (res && res.folders) || [];
    var files = (res && res.files) || [];
    cbiFolderFiles = files;
    cbiFolderFolders = folders;

    if (!folders.length && !files.length) {
      var ui = window.TMAPortalUI;
      canvas.innerHTML = '<div data-cbi-folder-list>' +
        (ui && ui.emptyState
          ? ui.emptyState({
              illustration: 'Illustration03',
              title: 'No files yet',
              subtitle: 'Use “Upload”, “New folder”, or drag files here.',
            })
          : '<div class="tma-dash__clients-assigned-empty">' +
            'No files yet. Use “Upload”, “New folder”, or drag files here.</div>') +
        '</div>';
      return;
    }

    var html = '';
    folders.forEach(function (f) {
      var count = (f.fileCount || 0) + (f.folderCount || 0);
      var folderBase = f.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
      var folderIcon = window.TMAFolderIcons
        ? window.TMAFolderIcons.html(folderBase, f.colour, f.iconName, 24)
        : '<img src="' + PH_ICON + 'FolderNotch.svg" alt="">';
      html += '<button type="button" class="tma-dash__clients-folder" draggable="true" data-cbi-row data-cbi-subfolder="' + esc(f.id) +
        '" data-cbi-subfolder-name="' + esc(f.name) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true">' + folderIcon + '</span>' +
        '<span class="tma-dash__clients-folder-main"><span class="tma-dash__clients-folder-name" data-cbi-rename-name>' + esc(f.name) + '</span>' +
        '<span class="tma-dash__clients-folder-meta">' + esc(cbiFolderMetaLabel(f)) + '</span></span>' +
        '<span class="tma-dash__clients-folder-count" aria-hidden="true">' + count + '</span>' +
        '</button>';
    });

    files.forEach(function (f) {
      var icon = (window.TMAFileIcons && window.TMAFileIcons.fileIconSrc)
        ? window.TMAFileIcons.fileIconSrc(f.icon, f.name)
        : PH_ICON + 'File.svg';
      var who = f.uploadedBy && f.uploadedBy.name ? f.uploadedBy.name : null;
      var meta = [f.sizeLabel, f.uploadedAt ? fmtShortDate(f.uploadedAt) : null, who]
        .filter(Boolean).join(' · ');

      html += '<button type="button" class="tma-dash__clients-folder" draggable="true" data-cbi-row data-cbi-file="' + esc(f.id) + '">' +
        '<span class="tma-dash__clients-folder-icon" aria-hidden="true"><img src="' + esc(icon) + '" alt=""></span>' +
        '<span class="tma-dash__clients-folder-main">' +
          '<span class="tma-dash__clients-folder-name" data-cbi-rename-name>' + esc(f.name) + cbiStatusChip(f) + '</span>' +
          (meta ? '<span class="tma-dash__clients-folder-meta">' + esc(meta) + '</span>' : '') +
        '</span></button>';
    });
    canvas.innerHTML = html;
  }

  function setDocumentsTabCount(count) {
    if (!state.el) return;
    var label = state.el.querySelector('[data-tab-key="documents"] .tma-tab__label');
    if (!label) return;
    label.textContent = count ? ('Documents  ' + Number(count).toLocaleString()) : 'Documents';
  }

  function captureCbiDocCount(root, res) {
    if (!cbiFolderNav) return;
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    if (!wrap) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    if (!uuid || uuid !== cbiFolderNav.rootUuid) return;

    var counts = (res && res.counts) || {};
    var total = typeof counts.files === 'number' ? counts.files : ((res && res.files) || []).length;
    ((res && res.folders) || []).forEach(function (f) {
      if (typeof f.fileCount === 'number') total += f.fileCount;
    });
    setDocumentsTabCount(total);
  }

  function renderCbiFolderCrumbs(root) {
    var host = root.querySelector('[data-cbi-folder-crumbs]');
    if (!host || !cbiFolderNav) return;
    var path = cbiFolderNav.path;
    host.innerHTML = path.map(function (node, i) {
      if (i === path.length - 1) {
        return '<span class="tma-dash__clients-crumb tma-dash__clients-crumb--current">' + esc(node.name) + '</span>';
      }
      return '<button type="button" class="tma-dash__clients-crumb" data-cbi-crumb="' + i + '">' + esc(node.name) + '</button>' +
        '<span class="tma-dash__clients-crumb-sep" aria-hidden="true">›</span>';
    }).join('');
  }

  function cbiFolderCacheKey(uuid) {
    return 'files:folder:' + uuid;
  }

  function invalidateCbiFolder(uuid) {
    if (window.TMAStore && uuid) window.TMAStore.invalidate(cbiFolderCacheKey(uuid));
  }

  function cbiFolderRow(id) {
    return (cbiFolderFiles || []).concat(cbiFolderFolders || [])
      .filter(function (r) { return r.id === id; })[0];
  }

  function loadCbiFolder(root, opts) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    var net = filesNet();
    if (!wrap || !net) return;
    var uuid = wrap.getAttribute('data-folder-uuid');
    var url = net.url('/?folder=' + encodeURIComponent(uuid) + '&perPage=0');

    if (opts && opts.changed) invalidateCbiFolder(uuid);

    var renamed = false;
    var paint = function (res) {
      if (wrap.getAttribute('data-folder-uuid') !== uuid) return;
      renderCbiFolderList(root, res);
      captureCbiDocCount(root, res);
      if (opts && opts.renameId && !renamed && cbiFolderRow(opts.renameId)) {
        renamed = true;
        startCbiFolderRename(root, opts.renameId);
      }
    };

    var fail = function () {
      var canvas = cbiFolderCanvas(root) || wrap;
      var list = canvas.querySelector('[data-cbi-folder-list]') || canvas;
      list.textContent = 'Could not load this folder.';
    };

    if (!window.TMAStore) {
      net.fetchJSON(url).then(paint).catch(fail);
      return;
    }

    window.TMAStore
      .swr(cbiFolderCacheKey(uuid), function () { return net.fetchJSON(url); }, paint)
      .catch(fail);
  }

  function showCbiFolderCurrent(root) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    if (!wrap || !cbiFolderNav) return;
    var current = cbiFolderNav.path[cbiFolderNav.path.length - 1];
    wrap.setAttribute('data-folder-uuid', current.uuid);
    renderCbiFolderCrumbs(root);
    loadCbiFolder(root);
  }

  function uploadToCbiFolder(fileList, uuid) {
    if (!fileList || !fileList.length || !window.TMAUpload) return;
    window.TMAUpload.add(fileList, { folderId: uuid });
    toast(fileList.length > 1 ? fileList.length + ' files uploading…' : 'Uploading…');
  }

  function hasCbiOsFiles(e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
  }

  function createCbiUntitledFolder(root) {
    var drop = root.querySelector('[data-cbi-folder-drop]');
    var current = drop && drop.getAttribute('data-folder-uuid');
    var net = filesNet();
    if (!current || !net) return;
    net.fetchJSON(net.url('/folders'), {
      method: 'POST',
      json: { name: 'Untitled folder', parent: current, auto: true },
    }).then(function (folder) {
      loadCbiFolder(root, { changed: true, renameId: folder && folder.id });
    }).catch(function (err) {
      toast((err && err.message) || 'Could not create the folder', false);
    });
  }

  function startCbiFolderRename(root, id) {
    var row = cbiFolderRow(id);
    var net = filesNet();
    if (!row || !net) return;
    var btn = root.querySelector('[data-cbi-subfolder="' + id + '"], [data-cbi-file="' + id + '"]');
    var nameEl = btn && btn.querySelector('[data-cbi-rename-name]');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tma-portal-rename-input';
    input.value = row.name;
    input.setAttribute('maxlength', '255');
    input.setAttribute('aria-label', 'Rename ' + row.name);
    nameEl.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();

    var settled = false;
    function finish() { loadCbiFolder(root, { changed: true }); }
    function commit() {
      if (settled) return;
      settled = true;
      var next = input.value.trim();
      if (!next || next === row.name) { finish(); return; }
      var url = (row.type === 'folder' ? '/folders/' : '/files/') + row.id;
      net.fetchJSON(net.url(url), { method: 'PATCH', json: { name: next } })
        .then(finish)
        .catch(function (err) {
          toast((err && err.message) || 'Could not rename', false);
          finish();
        });
    }
    function cancel() {
      if (settled) return;
      settled = true;
      finish();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation();
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', commit);
  }

  function moveCbiFolderItems(root, items, targetId) {
    var net = filesNet();
    if (!items || !items.length || !targetId || !net) return;
    var payload = items.filter(function (it) { return it.id && it.id !== targetId; })
      .map(function (it) { return { id: it.id, type: it.type }; });
    if (!payload.length) return;
    net.fetchJSON(net.url('/bulk'), {
      method: 'POST',
      json: { action: 'move', items: payload, target: targetId },
    }).then(function () {
      toast(payload.length === 1 ? 'Moved' : payload.length + ' items moved');
      loadCbiFolder(root, { changed: true });
    }).catch(function (err) {
      toast((err && err.message) || 'Could not move', false);
    });
  }

  function openCbiFolderInLibrary(root, rootUuid) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    var dest = (wrap && wrap.getAttribute('data-folder-uuid')) || rootUuid;
    if (!dest) return;
    if (window.TMADashboard && window.TMADashboard.navigate) {
      var here = cbiFolderNav && cbiFolderNav.path[cbiFolderNav.path.length - 1];
      window.TMADashboard.navigate({
        navId: 'folders-all',
        view: 'folders',
        title: here && here.name ? here.name : 'Client documents',
        crumb: 'File Library / ' + (here && here.name ? here.name : 'Client'),
        folderId: dest,
      });
      return;
    }
    location.href = (window.__TMA_SITE_ROOT || '') + '/files?folder=' + encodeURIComponent(dest);
  }

  function requestCbiFiles(root) {
    if (!window.TMAFileRequests) {
      toast('Request Files isn’t available right now', false);
      return;
    }
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    var here = cbiFolderNav
      ? cbiFolderNav.path[cbiFolderNav.path.length - 1]
      : { uuid: wrap && wrap.getAttribute('data-folder-uuid'), name: 'Client documents' };
    var clientId = wrap && wrap.getAttribute('data-client-uid');
    window.TMAFileRequests.open({
      folderId: here.uuid,
      folderName: here.name,
      clientId: clientId || null,
      title: 'Please upload your documents',
      onCreated: function () { loadCbiFolder(root, { changed: true }); },
    });
  }

  function cbiFolderPanelHasContents(wrap) {
    var canvas = wrap.querySelector('[data-cbi-folder-canvas]') || wrap;
    if (canvas.querySelector('[data-cbi-subfolder], [data-cbi-file]')) return true;
    var empty = canvas.querySelector('[data-cbi-folder-list]');
    return !!(empty && empty.textContent && empty.textContent !== 'Loading…');
  }

  function wireCbiFolderPanel(root) {
    var wrap = root.querySelector('[data-cbi-folder-drop]');
    if (!wrap) return;
    var rootUuid = wrap.getAttribute('data-root-uuid');

    var switchedClient = !cbiFolderNav || cbiFolderNav.rootUuid !== rootUuid;
    if (switchedClient) {
      cbiFolderNav = { rootUuid: rootUuid, path: [{ uuid: rootUuid, name: 'Client documents' }] };
    }
    wrap.setAttribute('data-folder-uuid', cbiFolderNav.path[cbiFolderNav.path.length - 1].uuid);
    renderCbiFolderCrumbs(root);
    if (switchedClient || !cbiFolderPanelHasContents(wrap)) loadCbiFolder(root);

    if (root._cbiFolderWired) return;
    root._cbiFolderWired = true;

    root.addEventListener('click', function (e) {
      if (e.target.closest('.tma-portal-rename-input')) return;

      var sub = e.target.closest('[data-cbi-subfolder]');
      if (sub && root.contains(sub)) {
        if (sub._suppressClick) { e.preventDefault(); sub._suppressClick = false; return; }
        e.preventDefault();
        if (!cbiFolderNav) return;
        cbiFolderNav.path.push({
          uuid: sub.getAttribute('data-cbi-subfolder'),
          name: sub.getAttribute('data-cbi-subfolder-name') || 'Folder',
        });
        showCbiFolderCurrent(root);
        return;
      }

      var fileBtn = e.target.closest('[data-cbi-file]');
      if (fileBtn && root.contains(fileBtn)) {
        if (fileBtn._suppressClick) { e.preventDefault(); fileBtn._suppressClick = false; return; }
        e.preventDefault();
        openCbiFile(fileBtn.getAttribute('data-cbi-file'), function () { loadCbiFolder(root, { changed: true }); });
        return;
      }

      var crumb = e.target.closest('[data-cbi-crumb]');
      if (crumb && root.contains(crumb)) {
        e.preventDefault();
        if (!cbiFolderNav) return;
        var idx = parseInt(crumb.getAttribute('data-cbi-crumb'), 10);
        if (isNaN(idx)) return;
        cbiFolderNav.path = cbiFolderNav.path.slice(0, idx + 1);
        showCbiFolderCurrent(root);
        return;
      }

      if (e.target.closest('[data-cbi-folder-new]')) {
        e.preventDefault();
        createCbiUntitledFolder(root);
        return;
      }

      if (e.target.closest('[data-cbi-folder-upload]')) {
        e.preventDefault();
        var input = root.querySelector('[data-cbi-folder-fileinput]');
        if (input) input.click();
        return;
      }

      if (e.target.closest('[data-cbi-folder-request]')) {
        e.preventDefault();
        requestCbiFiles(root);
        return;
      }

      if (e.target.closest('[data-cbi-open-library]')) {
        e.preventDefault();
        openCbiFolderInLibrary(root, rootUuid);
      }
    });

    root.addEventListener('change', function (e) {
      var input = e.target.closest('[data-cbi-folder-fileinput]');
      if (!input || !root.contains(input)) return;
      var drop = root.querySelector('[data-cbi-folder-drop]');
      uploadToCbiFolder(input.files, drop && drop.getAttribute('data-folder-uuid'));
      input.value = '';
    });

    var draggingItems = null;

    function clearDropHighlight() {
      var drop = root.querySelector('[data-cbi-folder-drop]');
      if (!drop) return;
      drop.classList.remove('is-drop-into');
      drop.querySelectorAll('.is-drop-into').forEach(function (n) { n.classList.remove('is-drop-into'); });
    }

    function currentDrop() {
      var drop = root.querySelector('[data-cbi-folder-drop]');
      return drop;
    }

    root.addEventListener('dragstart', function (e) {
      var drop = currentDrop();
      var row = e.target.closest('[data-cbi-row]');
      if (!drop || !row || !drop.contains(row)) return;
      var id = row.getAttribute('data-cbi-subfolder') || row.getAttribute('data-cbi-file');
      var it = cbiFolderRow(id);
      if (!it) return;
      draggingItems = [{ id: it.id, type: it.type || (row.hasAttribute('data-cbi-subfolder') ? 'folder' : 'file') }];
      try { e.dataTransfer.setData('text/plain', it.name || 'item'); } catch (err) {}
      try { e.dataTransfer.setData('application/x-tma-move', '1'); } catch (err) {}
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });

    root.addEventListener('dragover', function (e) {
      var drop = currentDrop();
      if (!drop || !drop.contains(e.target)) return;
      var folderRow = e.target.closest('[data-cbi-subfolder]');
      if (hasCbiOsFiles(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        clearDropHighlight();
        (folderRow && drop.contains(folderRow) ? folderRow : drop).classList.add('is-drop-into');
        return;
      }
      if (!draggingItems || !folderRow || !drop.contains(folderRow)) return;
      if (draggingItems.some(function (d) { return d.id === folderRow.getAttribute('data-cbi-subfolder'); })) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropHighlight();
      folderRow.classList.add('is-drop-into');
    });

    root.addEventListener('drop', function (e) {
      var drop = currentDrop();
      if (!drop || !drop.contains(e.target)) return;
      var folderRow = e.target.closest('[data-cbi-subfolder]');
      var dest = folderRow && drop.contains(folderRow)
        ? folderRow.getAttribute('data-cbi-subfolder')
        : drop.getAttribute('data-folder-uuid');
      clearDropHighlight();
      if (hasCbiOsFiles(e) && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        uploadToCbiFolder(e.dataTransfer.files, dest);
        draggingItems = null;
        return;
      }
      if (!draggingItems || !folderRow || !drop.contains(folderRow)) return;
      e.preventDefault();
      var moving = draggingItems;
      draggingItems = null;
      moveCbiFolderItems(root, moving, dest);
    });

    root.addEventListener('dragend', function () {
      clearDropHighlight();
      var drop = currentDrop();
      var row = drop && drop.querySelector('.is-dragging');
      if (row) {
        row.classList.remove('is-dragging');
        row._suppressClick = true;
      }
      draggingItems = null;
    });

    if (!document._cbiUploadRefresh) {
      document._cbiUploadRefresh = true;
      document.addEventListener('tma:upload-complete', function (e) {
        if (!state.el) return;
        var drop = state.el.querySelector('[data-cbi-folder-drop]');
        if (!drop) return;
        var done = e.detail && e.detail.folderId;
        if (!done || done === drop.getAttribute('data-folder-uuid')) {
          loadCbiFolder(state.el, { changed: true });
        }
      });
    }
  }

  /*
   * Open a filed document in the portal lightbox (review, comments, versions).
   * Uses the folder listing row when we already have it; otherwise fetches the
   * File Library record so a just-imported attachment still opens here.
   */
  function openCbiFile(fileUuid, onChange) {
    if (!fileUuid) return;
    if (!window.TMAFileActions || !window.TMAFileActions.open) {
      toast('The viewer isn’t available here.', false);
      return;
    }

    var refresh = onChange || function () {
      if (state.el) loadCbiFolder(state.el);
    };

    var row = (cbiFolderFiles || []).filter(function (f) {
      return f.id === fileUuid || f.uuid === fileUuid;
    })[0];

    if (row) {
      window.TMAFileActions.open(row, refresh);
      return;
    }

    var net = filesNet();
    if (!net) {
      toast('The viewer isn’t available here.', false);
      return;
    }

    net.fetchJSON(net.url('/files/' + encodeURIComponent(fileUuid)))
      .then(function (res) {
        var item = (res && (res.file || res.item || res)) || null;
        if (!item || !item.id) {
          toast('That document isn’t in the client’s folder yet.', false);
          return;
        }
        if (!item.type) item.type = 'file';
        window.TMAFileActions.open(item, refresh);
      })
      .catch(function () {
        toast('That document isn’t in the client’s folder yet.', false);
      });
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
      }).join('') : ui().emptyState({ title: 'No comments yet', illustration: 'Illustration02' })) +
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
        if (window.TMASyncToasts && window.TMASyncToasts.watch) {
          window.TMASyncToasts.watch('smartsheet');
        }
        cbiFetch(BASE + '/sync', { method: 'POST' })
          .then(function (d) {
            var parts = [];
            if (d.queued) parts.push('Queued ' + d.queued + ' sheet sync(s)');
            if (d.hubQueued) parts.push('filing documents into client folders');
            toast(parts.length ? parts.join(' — ') + '.' : 'Everything already up to date.');
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
      var docs = d.documents || {};
      var withIssues = sheets.filter(function (s) { return s.lastError || s.status === 'error'; });
      var rows = sheets.slice(0, 80).map(function (s) {
        return '<tr><td>' + esc(s.name) +
          '<div class="tma-portal-table__muted">' + esc(s.category) + ' · ' + s.rows + ' rows</div></td>' +
          '<td>' + esc(s.status) +
          (s.lastSuccessAt ? '<div class="tma-portal-table__muted">' + esc(fmtDateTime(s.lastSuccessAt)) + '</div>' : '') +
          (s.lastError ? '<div class="tma-portal-field__error">' + esc(s.lastError) + '</div>' : '') + '</td></tr>';
      }).join('');

      var docsBlock = '<div class="cbi-sync-docs">' +
        '<h3 class="tma-portal-section__title">' +
          '<img class="cbi-sync-docs__logo" src="' + PH_ICON + 'Smart_sheet.svg" alt="" width="18" height="18">' +
          'Document import</h3>' +
        (docs.active
          ? '<p class="tma-portal-subtitle">' + esc(num(docs.done) + ' of ' + num(docs.total) +
            ' Smartsheet files filed into client folders (' + docs.percent + '%). ' +
            num(docs.pending) + ' still copying · ' + num(docs.clients) + ' clients receiving files.') + '</p>' +
            '<div class="cbi-sync-docs__bar" role="progressbar" aria-valuenow="' + docs.percent +
            '" aria-valuemin="0" aria-valuemax="100">' +
            '<span style="width:' + docs.percent + '%"></span></div>'
          : '<p class="tma-portal-subtitle">' +
            (docs.done
              ? esc(num(docs.done) + ' Smartsheet files are in client folders. Import is up to date.')
              : 'No documents have been filed into client folders yet.') +
            '</p>') +
        '</div>';

      var body = '<div class="cbi-sync-scroll">' + docsBlock +
        '<p class="tma-portal-subtitle">' + sheets.length + ' sheet(s) mirrored' +
        (withIssues.length ? ' · ' + withIssues.length + ' with errors' : ' · all healthy') + '</p>' +
        ui().table(['Sheet', 'Status'], rows) + '</div>';
      ui().openModal({ title: 'Smartsheet sync', body: body });
    }).catch(function (e) { toast((e && e.message) || 'Couldn’t load sync status', false); });
  }

  /* Poll while Smartsheet files are still landing in client folders, so the
     toolbar and Documents tab show live counts without a manual refresh. */
  var docsPollTimer = null;
  function scheduleDocsPoll() {
    if (docsPollTimer) return;
    docsPollTimer = setInterval(function () {
      if (!live()) return;
      var wasActive = !!(docsProgress() && docsProgress().active);
      loadSummary().then(function () {
        var active = !!(docsProgress() && docsProgress().active);
        if (!active && docsPollTimer) {
          clearInterval(docsPollTimer);
          docsPollTimer = null;
        }
        // Refresh the open application so its Documents tab picks up new files.
        if (state.route.view === 'detail' && state.detail.uuid && (active || wasActive)) {
          loadDetail(state.detail.uuid, { keepTab: true, quiet: true });
        }
      });
    }, 15000);
  }

  /* ── mount ── */

  function wire() {
    // The faces wire themselves: person-card.js delegates on the document at
    // load, so there is nothing for the page to attach or re-attach.
    if (window.TMAPersonCard) window.TMAPersonCard.wire();
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

    // Documents tab: live File Library folder for the linked client.
    if (el.querySelector('[data-cbi-folder-drop]')) {
      wireCbiFolderPanel(el);
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
