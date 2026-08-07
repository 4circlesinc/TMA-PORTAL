/*
 * CBI — Citizenship by Investment.
 *
 * Portal-view-pattern module: mounts standalone at /dev/cbi and registers
 * with TMAPortalViews for the SPA shell (/cbi). All data is live from
 * /portal/cbi/* — loading, empty and error states only, never mock rows.
 *
 * Rendering is design-system components only (DESIGN_SYSTEM.md):
 * .tma-portal-head, ui().tabs, the .tma-dash__toolbar recipe from the Users
 * table (tool buttons, head-dropdown menus, documented search, filter chips),
 * ui().table, .tma-pagination-bar, ui().section/field, tma-portal-status
 * chips, ui().openModal. cbi.css carries page-layout glue only — no new
 * component styling.
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
    { key: '', label: 'All' },
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
    detail: { data: null, loading: false, error: null, uuid: null, posting: false, commentDraft: '' },
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
    var req = { data: null, loading: true, error: null, uuid: uuid, posting: false, commentDraft: '' };
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

  /* Documented tone-only status chip (portal-files.css). Never a bespoke
     colour per status — statuses map onto the four documented tones. */
  function statusTone(status) {
    var s = String(status || '').toUpperCase();
    if (!s) return null;
    if (/GRANTED|CITIZEN|APPROVED|COMPLETED/.test(s)) return 'success';
    if (/DENIED|NON COMPLIANT|RESCINDED|FAILED/.test(s)) return 'danger';
    if (/PENDING|DELAYED|QUERIES|TO SUBMIT|BACKGROUND CHECK|UPDATE|INTERVIEW|APPEAL/.test(s)) return 'pending';
    return 'neutral';
  }
  function statusChip(status) {
    var tone = statusTone(status);
    if (!tone) return '';
    return '<span class="tma-portal-status tma-portal-status--' + tone + '">' + esc(status) + '</span>';
  }
  function stageChip(stage) {
    var label = STAGE_LABELS[stage] || stage || '—';
    return '<span class="tma-portal-chip' + (stage === 'closed' ? '' : ' tma-portal-chip--ok') + '">' + esc(label) + '</span>';
  }
  function reviewChip() {
    return '<span class="tma-portal-status tma-portal-status--pending" title="Weak identity — check for duplicates">Review</span>';
  }

  /* ── render: list ── */

  function syncLine() {
    var s = state.summary;
    var line = 'Synchronised from Smartsheet.';
    if (s && s.sync) {
      if (!s.sync.configured) line = 'Smartsheet is not configured in this environment.';
      else if (s.sync.syncing > 0) line = 'Syncing ' + s.sync.syncing + ' sheet(s)…';
      else if (s.sync.lastSuccessAt) line = 'Last synced ' + fmtDateTime(s.sync.lastSuccessAt);
      if (s.sync.sheetsWithErrors > 0) line += ' · ' + s.sync.sheetsWithErrors + ' sheet(s) with errors';
    }
    return line;
  }

  function renderHead() {
    var actions =
      ui().btn({ label: 'Sync status', icon: 'Info', variant: 'ghost', small: true, attrs: ' data-cbi-action="sync-status"' }) +
      ui().btn({ label: 'Sync now', icon: 'ArrowsClockwise', variant: 'ghost', small: true, attrs: ' data-cbi-action="sync-now"' });
    return '<div class="tma-portal-head"><div>' +
      '<h2 class="tma-portal-head__title">Citizenship by Investment</h2>' +
      '<p class="tma-portal-subtitle" data-cbi-syncline>' + esc(syncLine()) + '</p>' +
      '</div><div class="tma-portal-head__actions">' + actions + '</div></div>';
  }

  function renderTabs() {
    var counts = (state.summary && state.summary.stages) || {};
    var total = state.summary ? state.summary.total : null;
    var items = STAGES.map(function (s) {
      var n = s.key === '' ? total : counts[s.key];
      return { key: s.key, label: s.label + (n != null ? ' (' + n + ')' : '') };
    });
    return ui().tabs(items, state.filters.stage);
  }

  /* Flat documented toolbar icon button (Users-table recipe). */
  function toolBtn(iconPath, action, label, pressed) {
    return '<button type="button" class="tma-dash__tool-btn' + (pressed ? ' is-active' : '') + '"' +
      ' data-cbi-action="' + esc(action) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
      (pressed != null ? ' aria-pressed="' + pressed + '"' : '') + '>' +
      '<img src="' + iconPath + '" alt=""></button>';
  }

  /* Toolbar "select": the documented head-dropdown component (styled button
     + caret + menu), never a raw <select> — same as the File Library. */
  function menuControl(name, label, options, current) {
    var sel = null;
    for (var i = 0; i < options.length; i++) {
      if (String(options[i].value) === String(current)) { sel = options[i]; break; }
    }
    return ui().headDropdown({
      label: current && sel ? short(sel.label, 20) : label,
      menuLabel: label,
      wrapAttrs: 'data-cbi-menu-' + name,
      items: options.map(function (o) { return { label: o.label, action: o.value }; }),
    });
  }

  function facetOptions(facetKey, label) {
    var rows = (state.summary && state.summary.facets && state.summary.facets[facetKey]) || [];
    var options = [{ value: '', label: 'All' }];
    rows.forEach(function (r) { options.push({ value: r.value, label: r.value + ' (' + r.n + ')' }); });
    return options;
  }

  function renderToolbar() {
    var f = state.filters;
    var actions =
      toolBtn(TMA_ICON + 'FunnelSimple-16.svg', 'noop-filter', 'Filters are the dropdowns to the right', null) +
      menuControl('status', 'Status', facetOptions('statuses'), f.status) +
      menuControl('referred', 'Referred by', facetOptions('referredBy'), f.referred_by) +
      menuControl('investment', 'Investment', facetOptions('investmentOptions'), f.investment_option) +
      menuControl('assigned', 'Assigned', facetOptions('assigned'), f.assigned_to) +
      menuControl('sort', 'Sort', SORTS, f.sort) +
      toolBtn(PH_ICON + 'Flag.svg', 'needs-review', 'Only records needing review', f.needs_review);

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
      tags.push({ id: 'sort', label: 'Sorted: ' + sortLabel, icon: 'arrows' });
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

    var rows = l.items.map(function (a) {
      return '<tr data-cbi-open="' + esc(a.uuid) + '" data-id="' + esc(a.uuid) + '">' +
        '<td><strong>' + esc(a.applicantName || 'Unnamed applicant') + '</strong>' +
          (a.applicantNumber ? '<div class="tma-portal-table__muted">' + esc(a.applicantNumber) + '</div>' : '') + '</td>' +
        '<td>' + stageChip(a.stage) + '</td>' +
        '<td>' + statusChip(a.status) + (a.needsReview ? ' ' + reviewChip() : '') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.referredBy || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(a.assignedTo || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(fmtDate(a.receivedAt) || '—') + '</td>' +
        '<td class="tma-portal-table__muted">' + esc(fmtDate(a.modifiedAt) || '—') + '</td>' +
        '</tr>';
    }).join('');

    return ui().table(
      ['Applicant', 'Stage', 'Status', 'Referred by', 'Assigned', 'Received', 'Updated'],
      rows,
      { cls: 'cbi-table' }
    ) + renderPagination();
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
    return renderHead() + renderTabs() + renderToolbar() + renderFilterChips() +
      '<div data-cbi-body>' + renderRows() + '</div>';
  }

  /* ── render: detail ── */

  /* Read-only fact row: the documented field recipe with a plain value. */
  function fact(label, value, rawHtml) {
    if (value == null || value === '') return '';
    return '<div class="tma-portal-field"><span class="tma-portal-field__label">' + esc(label) + '</span>' +
      '<span class="cbi-fact-value">' + (rawHtml ? value : esc(value)) + '</span></div>';
  }

  function factSection(title, factsHtml, opts) {
    if (!factsHtml) return '';
    return ui().section(title, '<div class="cbi-facts">' + factsHtml + '</div>', opts);
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

  function renderDetail() {
    var d = state.detail;
    var back = ui().btn({ label: 'Back to applications', icon: 'CaretLeft', variant: 'ghost', small: true, attrs: ' data-cbi-action="back"' });
    if (d.loading) return '<div class="tma-portal-head"><div>' + back + '</div></div>' + ui().loading({ count: 6 });
    if (d.error) return '<div class="tma-portal-head"><div>' + back + '</div></div>' + ui().banner('warning', esc(d.error));
    if (!d.data) return '';

    var a = d.data.application;

    // Meta line: ·-joined facts with inline documented status chips (the
    // File Library viewer-head recipe).
    var meta = [];
    if (a.applicantNumber) meta.push('№ ' + esc(a.applicantNumber));
    if (a.progress) meta.push(esc(a.progress));
    if (a.syncedAt) meta.push('Synced ' + esc(fmtDateTime(a.syncedAt)));
    var metaLine = meta.join(' &middot; ') +
      ' ' + stageChip(a.stage) +
      (a.status ? ' ' + statusChip(a.status) : '') +
      (a.granted ? ' <span class="tma-portal-status tma-portal-status--success">Granted</span>' : '') +
      (a.needsReview ? ' ' + reviewChip() : '');

    var headActions =
      (safeUrl(a.sourcePermalink)
        ? '<a class="tma-no-data__btn tma-portal-btn--ghost tma-portal-btn--small" href="' + esc(safeUrl(a.sourcePermalink)) + '" target="_blank" rel="noopener">' +
          '<img class="tma-no-data__btn-icon" src="' + PH_ICON + 'ArrowSquareOut.svg" alt="" width="16" height="16"><span>Open in Smartsheet</span></a>'
        : '');

    var head = '<div class="tma-portal-head"><div>' +
      '<div class="cbi-backrow">' + back + '</div>' +
      '<h2 class="tma-portal-head__title">' + esc(a.applicantName || 'Unnamed applicant') + '</h2>' +
      '<p class="tma-portal-subtitle cbi-meta">' + metaLine + '</p>' +
      '</div><div class="tma-portal-head__actions">' + headActions + '</div></div>';

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

    var timeline = TIMELINE_LABELS.map(function (t) {
      var v = a.timeline && a.timeline[t[0]];
      return v ? fact(t[1], fmtDate(v)) : '';
    }).join('');

    var narrative =
      fact('Notes', a.notes) +
      fact('Latest comment', a.latestComment) +
      fact('Issues log', a.issuesLog) +
      fact('Agent assessment', a.agentAssessment) +
      fact('Assessment response', a.assessmentResponse);

    var assess = d.data.assessment || [];
    var doneCount = assess.filter(function (i) { return i.done; }).length;
    var assessHtml = '';
    if (assess.length) {
      var assessRows = assess.map(function (i) {
        var main = i.description || i.applicantLabel || i.label || '';
        var notes = [i.notes, i.agentAssessment, i.response].filter(Boolean).join(' · ');
        return '<tr>' +
          '<td>' + (i.done
            ? '<span class="tma-portal-status tma-portal-status--success">Done</span>'
            : '<span class="tma-portal-status tma-portal-status--neutral">Open</span>') + '</td>' +
          '<td' + (i.indent ? ' class="cbi-indent"' : '') + '>' + esc(main) +
          (notes ? '<div class="tma-portal-table__muted">' + esc(notes) + '</div>' : '') + '</td>' +
          '</tr>';
      }).join('');
      assessHtml = ui().table([{ html: '', attrs: ' class="tma-portal-cell--tight"' }, 'Item'], assessRows);
    }

    var files = d.data.attachments || [];
    var filesHtml;
    if (files.length) {
      var fileRows = files.map(function (f) {
        return '<tr>' +
          '<td><a class="tma-portal-file-link" href="' + BASE + '/attachments/' + f.id + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></td>' +
          '<td class="tma-portal-table__muted">' + esc(fmtSize(f.sizeKb) || '—') + '</td>' +
          '<td class="tma-portal-table__muted">' + esc(f.by || '—') + '</td>' +
          '<td class="tma-portal-table__muted">' + esc(fmtDate(f.at) || '—') + '</td>' +
          '</tr>';
      }).join('');
      filesHtml = ui().table(['Name', 'Size', 'Added by', 'Date'], fileRows);
    } else {
      filesHtml = '<p class="tma-portal-subtitle">No documents attached yet.</p>';
    }

    var comments = d.data.comments || [];
    var commentsHtml = '<div class="cbi-comments" data-cbi-comments>' +
      (comments.length ? comments.map(function (c) {
        return '<div class="cbi-comment" data-id="c' + esc(c.id) + '">' +
          '<div class="cbi-comment__head"><span class="cbi-comment__author">' + esc(c.author) + '</span>' +
          '<span class="tma-portal-table__muted">' + esc(fmtDateTime(c.at)) + '</span>' +
          (c.source === 'smartsheet' ? '<span class="tma-portal-chip">Smartsheet</span>' : '') + '</div>' +
          '<div class="cbi-comment__body">' + esc(c.body) + '</div></div>';
      }).join('') : '<p class="tma-portal-subtitle">No comments yet.</p>') +
      '</div>' +
      '<div class="cbi-composer">' +
        // The draft lives in state, not just the DOM: a morph that touches
        // an unfocused textarea syncs it to the rendered value, so an
        // unmanaged draft would vanish on the next re-render.
        '<textarea class="tma-portal-input" data-cbi-comment-input placeholder="Add a comment…" maxlength="8000" aria-label="Add a comment">' + esc(state.detail.commentDraft || '') + '</textarea>' +
        ui().btn({ label: state.detail.posting ? 'Posting…' : 'Post', small: true, attrs: ' data-cbi-action="post-comment"', disabled: state.detail.posting }) +
      '</div>';

    var events = d.data.events || [];
    var EVENT_LABELS = {
      imported: 'Imported from Smartsheet', stage_changed: 'Stage changed', status_changed: 'Status changed',
      assigned: 'Assignment changed', comment_added: 'Comment added', field_changed: 'Field changed',
    };
    var activityHtml;
    if (events.length) {
      activityHtml = '<ul class="cbi-activity">' + events.map(function (e) {
        var what = '<strong>' + esc(EVENT_LABELS[e.type] || e.type) + '</strong>';
        if (e.from || e.to) what += ' ' + (e.from ? esc(e.from) : '—') + ' → ' + (e.to ? esc(e.to) : '—');
        if (e.actor) what += ' · ' + esc(e.actor);
        return '<li><span class="tma-portal-table__muted cbi-activity__time">' + esc(fmtDateTime(e.at)) + '</span>' +
          '<span>' + what + '</span></li>';
      }).join('') + '</ul>';
    } else {
      activityHtml = '<p class="tma-portal-subtitle">History accrues from the first sync onward.</p>';
    }

    function kvRows(obj) {
      var keys = Object.keys(obj || {});
      if (!keys.length) return '';
      return keys.sort().map(function (k) {
        return '<tr><td class="tma-portal-table__muted">' + esc(k) + '</td><td>' + esc(String(obj[k])) + '</td></tr>';
      }).join('');
    }
    var finRows = kvRows(a.financials);
    var extraRows = kvRows(a.extra);
    var foldHtml = (finRows || extraRows)
      ? '<details class="cbi-fold">' +
          '<summary class="tma-portal-subtitle">Show all imported fields</summary>' +
          (finRows ? ui().table(['Billing & payments', ''], finRows) : '') +
          (extraRows ? ui().table(['Other fields', ''], extraRows) : '') +
        '</details>'
      : '';

    var sources = d.data.sources || [];
    var sourcesHint = sources.length > 1 ? sources.length + ' Smartsheet rows merged' : null;

    return head + '<div class="cbi-detail-grid">' +
      wrapCol(factSection('Applicant', applicant)) +
      wrapCol(factSection('Case', caseFacts)) +
      wrapCol(factSection('Team', team)) +
      wrapWide(timeline ? factSection('Timeline', timeline) : '') +
      wrapWide(assessHtml ? ui().section('Assessment checklist', assessHtml, { description: doneCount + ' of ' + assess.length + ' complete' }) : '') +
      wrapCol(narrative ? factSection('Notes', narrative) : '') +
      wrapCol(ui().section('Documents', filesHtml, files.length ? { description: files.length + ' file(s)' } : undefined)) +
      wrapWide(ui().section('Comments', commentsHtml, sourcesHint ? { description: sourcesHint } : undefined)) +
      wrapWide(ui().section('Activity', activityHtml)) +
      wrapWide(foldHtml ? ui().section('Everything else', foldHtml, { description: 'Imported for completeness' }) : '') +
      '</div>';
  }

  function wrapCol(html) { return html ? '<div class="cbi-detail-grid__col">' + html + '</div>' : ''; }
  function wrapWide(html) { return html ? '<div class="cbi-detail-grid__wide">' + html + '</div>' : ''; }

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
      case 'needs-review':
        state.filters.needs_review = !state.filters.needs_review;
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
    var input = state.el.querySelector('[data-cbi-comment-input]');
    if (!input) return;
    var body = input.value.trim();
    if (!body || state.detail.posting) return;
    state.detail.posting = true;
    state.detail.commentDraft = body;
    render();
    cbiFetch(BASE + '/applications/' + encodeURIComponent(state.detail.uuid) + '/comments', { method: 'POST', json: { body: body } })
      .then(function (c) {
        state.detail.posting = false;
        state.detail.commentDraft = '';
        if (state.detail.data) state.detail.data.comments.push(c);
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
        state.detail.posting = false; render();
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

  function onMenuSelect(name) {
    return function (pick) { setFilter(name, pick.action); };
  }

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

    // Head-dropdown filter menus (documented component; guard is a JS
    // property inside wireHeadDropdown, so re-calls are safe under morph).
    if (ui() && ui().wireHeadDropdownAll) {
      ui().wireHeadDropdownAll(el, '[data-cbi-menu-status]', onMenuSelect('status'));
      ui().wireHeadDropdownAll(el, '[data-cbi-menu-referred]', onMenuSelect('referred_by'));
      ui().wireHeadDropdownAll(el, '[data-cbi-menu-investment]', onMenuSelect('investment_option'));
      ui().wireHeadDropdownAll(el, '[data-cbi-menu-assigned]', onMenuSelect('assigned_to'));
      ui().wireHeadDropdownAll(el, '[data-cbi-menu-sort]', onMenuSelect('sort'));
    }

    /* The tab markup is new on every repaint and needs re-initialising, but
       `el` is the same node — wiring the change listener again would stack
       another handler on it each time (the documented portal-admin guard). */
    if (el._cbiTabsWired) {
      if (window.PortalTabGroup) window.PortalTabGroup.init(el);
    } else if (ui() && ui().wireTabs) {
      el._cbiTabsWired = true;
      ui().wireTabs(el, function (key) {
        state.filters.stage = key;
        state.list.page = 1;
        loadList();
      });
    }
  }

  function mount(el) {
    state.el = el;
    render();
    loadSummary();
    syncRoute();
    if (!window.__cbiHashWired) {
      window.__cbiHashWired = true;
      window.addEventListener('hashchange', syncRoute);
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
