/*
 * CBI — Citizenship by Investment (development preview).
 *
 * Portal-view-pattern module served standalone at /dev/cbi while the module
 * is dark. It self-mounts on #cbi-root; it ALSO registers with
 * TMAPortalViews, so promoting it into the SPA shell later is a view div +
 * SPA_PAGES entry, not a rewrite. All data is live from /portal/cbi/* —
 * loading, empty and error states only, never mock rows.
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/cbi';

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

  var state = {
    el: null,
    route: { view: 'list', uuid: null },
    summary: null,
    list: { items: [], total: 0, page: 1, lastPage: 1, loading: false, error: null },
    filters: { stage: '', status: '', referred_by: '', investment_option: '', assigned_to: '', q: '', sort: 'recent', needs_review: false },
    detail: { data: null, loading: false, error: null, uuid: null, posting: false },
    searchTimer: null,
  };

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
    state.list.loading = true; state.list.error = null; render();
    cbiFetch(BASE + '/applications?' + listQuery())
      .then(function (d) {
        state.list.items = d.items || [];
        state.list.total = d.total || 0;
        state.list.lastPage = d.lastPage || 1;
        state.list.loading = false;
        render();
      })
      .catch(function (e) {
        state.list.loading = false;
        state.list.error = (e && e.message) || 'Couldn’t load applications';
        render();
      });
  }

  function loadDetail(uuid) {
    state.detail = { data: null, loading: true, error: null, uuid: uuid, posting: false };
    render();
    cbiFetch(BASE + '/applications/' + encodeURIComponent(uuid))
      .then(function (d) { state.detail.data = d; state.detail.loading = false; render(); })
      .catch(function (e) {
        state.detail.loading = false;
        state.detail.error = e && e.status === 404 ? 'Application not found.' : ((e && e.message) || 'Couldn’t load');
        render();
      });
  }

  /* ── routing (hash-based: standalone page owns no real paths) ── */

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
  function stageChip(stage) {
    var label = STAGE_LABELS[stage] || stage || '—';
    return '<span class="cbi-chip cbi-chip--' + esc(stage || 'plain') + '">' + esc(label) + '</span>';
  }

  /* ── render: list ── */

  function renderHead() {
    var s = state.summary;
    var syncLine = 'Synchronised from Smartsheet.';
    if (s && s.sync) {
      if (!s.sync.configured) syncLine = 'Smartsheet is not configured in this environment.';
      else if (s.sync.syncing > 0) syncLine = 'Syncing ' + s.sync.syncing + ' sheet(s)…';
      else if (s.sync.lastSuccessAt) syncLine = 'Last synced ' + fmtDateTime(s.sync.lastSuccessAt);
      if (s.sync.sheetsWithErrors > 0) syncLine += ' · ' + s.sync.sheetsWithErrors + ' sheet(s) with errors';
    }
    return '<div class="cbi-head">' +
      '<div><h1 class="cbi-head__title">Citizenship by Investment</h1>' +
      '<p class="cbi-head__sub" data-cbi-syncline>' + esc(syncLine) + '</p></div>' +
      '<div class="cbi-head__actions">' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Sync status" data-cbi-action="sync-status" title="Sync status">' +
          '<img src="images/icons/phosphor/Info.svg" alt=""></button>' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Sync now" data-cbi-action="sync-now" title="Sync now">' +
          '<img src="images/icons/phosphor/ArrowsClockwise.svg" alt=""></button>' +
      '</div></div>';
  }

  function renderStages() {
    var counts = (state.summary && state.summary.stages) || {};
    var total = state.summary ? state.summary.total : null;
    return '<div class="cbi-stages">' + STAGES.map(function (s) {
      var n = s.key === '' ? total : counts[s.key];
      return '<button type="button" class="cbi-stage" aria-pressed="' + (state.filters.stage === s.key) + '" data-cbi-stage="' + esc(s.key) + '">' +
        esc(s.label) + (n != null ? ' <span class="cbi-stage__count">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function facetSelect(name, label, facet) {
    var current = state.filters[name];
    var rows = (state.summary && state.summary.facets && state.summary.facets[facet]) || [];
    var html = '<select data-cbi-filter="' + esc(name) + '" aria-label="' + esc(label) + '">' +
      '<option value="">' + esc(label) + '</option>';
    rows.forEach(function (r) {
      html += '<option value="' + esc(r.value) + '"' + (current === r.value ? ' selected' : '') + '>' +
        esc(r.value) + ' (' + r.n + ')</option>';
    });
    return html + '</select>';
  }

  function renderToolbar() {
    var f = state.filters;
    var searchBlock = ui() && ui().searchInput
      ? ui().searchInput('Search applicants', 'data-cbi-search', f.q)
      : '<div class="tma-dash__toolbar-search" role="search">' +
          '<input type="search" class="tma-dash__search-input" placeholder="Search" value="' + esc(f.q) + '" data-cbi-search autocomplete="off" spellcheck="false">' +
        '</div>';
    return '<div class="tma-dash__toolbar">' +
      '<div class="tma-dash__toolbar-actions">' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-cbi-action="sort" aria-pressed="' + (f.sort !== 'recent') + '" title="Sort: ' + esc(f.sort) + '">' +
          '<img src="images/icons/tma/ArrowsDownUp.svg" alt=""></button>' +
        '<button type="button" class="tma-dash__tool-btn" aria-label="Needs review" data-cbi-action="needs-review" aria-pressed="' + f.needs_review + '" title="Only records needing review">' +
          '<img src="images/icons/phosphor/Flag.svg" alt=""></button>' +
      '</div>' + searchBlock + '</div>';
  }

  function renderFilters() {
    return '<div class="cbi-filters">' +
      facetSelect('status', 'Status', 'statuses') +
      facetSelect('referred_by', 'Referred by', 'referredBy') +
      facetSelect('investment_option', 'Investment', 'investmentOptions') +
      facetSelect('assigned_to', 'Assigned', 'assigned') +
      '</div>';
  }

  function renderRows() {
    var l = state.list;
    if (l.loading) return '<div class="cbi-loading">Loading applications…</div>';
    if (l.error) return '<div class="cbi-error">' + esc(l.error) + '</div>';
    if (!l.items.length) return '<div class="cbi-empty">No applications match. Adjust the filters, or run a sync if this is a fresh environment.</div>';

    var rows = l.items.map(function (a) {
      return '<tr data-cbi-open="' + esc(a.uuid) + '" data-id="' + esc(a.uuid) + '">' +
        '<td><div class="cbi-app__name">' + esc(a.applicantName || 'Unnamed applicant') + '</div>' +
          (a.applicantNumber ? '<div class="cbi-app__number">' + esc(a.applicantNumber) + '</div>' : '') + '</td>' +
        '<td>' + stageChip(a.stage) + '</td>' +
        '<td>' + (a.status ? '<span class="cbi-chip cbi-chip--plain">' + esc(a.status) + '</span>' : '') +
          (a.needsReview ? ' <span class="cbi-chip cbi-chip--warn cbi-chip--plain" title="Weak identity — check for duplicates">review</span>' : '') + '</td>' +
        '<td class="cbi-hide-sm">' + esc(a.referredBy || '') + '</td>' +
        '<td class="cbi-hide-sm">' + esc(a.assignedTo || '') + '</td>' +
        '<td class="cbi-hide-sm">' + esc(fmtDate(a.receivedAt)) + '</td>' +
        '<td>' + esc(fmtDate(a.modifiedAt)) + '</td>' +
        '</tr>';
    }).join('');

    var from = (l.page - 1) * 50 + 1;
    var to = Math.min(l.total, from + l.items.length - 1);

    return '<div class="cbi-card"><table class="cbi-table">' +
      '<thead><tr><th>Applicant</th><th>Stage</th><th>Status</th>' +
      '<th class="cbi-hide-sm">Referred by</th><th class="cbi-hide-sm">Assigned</th>' +
      '<th class="cbi-hide-sm">Received</th><th>Updated</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="cbi-pagination">' +
        '<button type="button" data-cbi-action="prev"' + (l.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
        '<span>' + from + '–' + to + ' of ' + l.total + '</span>' +
        '<button type="button" data-cbi-action="next"' + (l.page >= l.lastPage ? ' disabled' : '') + '>Next</button>' +
      '</div></div>';
  }

  function renderList() {
    return renderHead() + renderStages() + renderToolbar() + renderFilters() + '<div data-cbi-body>' + renderRows() + '</div>';
  }

  /* ── render: detail ── */

  function fact(label, value, rawHtml) {
    if (value == null || value === '') return '';
    return '<dt>' + esc(label) + '</dt><dd>' + (rawHtml ? value : esc(value)) + '</dd>';
  }

  function panel(title, inner, opts) {
    opts = opts || {};
    if (!inner) return '';
    return '<section class="cbi-panel' + (opts.wide ? ' cbi-panel--wide' : '') + '">' +
      '<h3 class="cbi-panel__title"><span>' + esc(title) + '</span>' +
      (opts.hint ? '<small>' + esc(opts.hint) + '</small>' : '') + '</h3>' + inner + '</section>';
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
    if (d.loading) return '<button type="button" class="cbi-back" data-cbi-action="back">← Back to applications</button><div class="cbi-loading">Loading application…</div>';
    if (d.error) return '<button type="button" class="cbi-back" data-cbi-action="back">← Back to applications</button><div class="cbi-error">' + esc(d.error) + '</div>';
    if (!d.data) return '';

    var a = d.data.application;

    var head =
      '<button type="button" class="cbi-back" data-cbi-action="back">← Back to applications</button>' +
      '<div class="cbi-detail__head">' +
        '<div class="cbi-detail__title-row">' +
          '<h1 class="cbi-detail__title">' + esc(a.applicantName || 'Unnamed applicant') + '</h1>' +
          stageChip(a.stage) +
          (a.status ? '<span class="cbi-chip cbi-chip--plain">' + esc(a.status) + '</span>' : '') +
          (a.granted ? '<span class="cbi-chip cbi-chip--good">Granted</span>' : '') +
          (a.needsReview ? '<span class="cbi-chip cbi-chip--warn cbi-chip--plain" title="Weak identity — check for duplicates">Needs review</span>' : '') +
        '</div>' +
        '<div class="cbi-detail__meta">' +
          (a.applicantNumber ? '<span>№ ' + esc(a.applicantNumber) + '</span>' : '') +
          (a.progress ? '<span>' + esc(a.progress) + '</span>' : '') +
          (a.sourcePermalink ? '<a href="' + esc(a.sourcePermalink) + '" target="_blank" rel="noopener">Open in Smartsheet ↗</a>' : '') +
          (a.syncedAt ? '<span>Synced ' + esc(fmtDateTime(a.syncedAt)) + '</span>' : '') +
        '</div>' +
      '</div>';

    var applicant = '<dl class="cbi-facts">' +
      fact('Main applicant', a.mainApplicantName && a.mainApplicantName !== a.applicantName ? a.mainApplicantName : null) +
      fact('Date of birth', fmtDate(a.dateOfBirth)) +
      fact('Nationality', a.nationality) +
      fact('Dependents', a.dependents != null ? String(a.dependents) : null) +
      fact('Family structure', a.familyStructure) +
      fact('Contact', a.contactDetails) +
      '</dl>';

    var caseFacts = '<dl class="cbi-facts">' +
      fact('Investment option', a.investmentOption) +
      fact('Application type', a.applicationType) +
      fact('Referred by', a.referredBy) +
      fact('Promoter', a.promoter) +
      fact('Service provider', a.serviceProvider) +
      fact('Main contact', a.mainContact) +
      fact('COR number', a.corNumber) +
      fact('Passport number', a.passportNumber) +
      fact('Clio matter', a.clioMatterLink
        ? '<a href="' + esc(a.clioMatterLink) + '" target="_blank" rel="noopener">' + esc(a.clioMatterNumber || 'Open ↗') + '</a>'
        : a.clioMatterNumber, !!a.clioMatterLink) +
      fact('File location', a.fileLocation) +
      '</dl>';

    var team = '<dl class="cbi-facts">' +
      fact('Assigned', a.assignedTo) +
      fact('Verification officer', a.verificationOfficer) +
      fact('Due diligence officer', a.ddOfficer) +
      fact('PA assignment', a.paAssignment) +
      fact('File owner', a.fileOwner) +
      fact('Submitted by', a.submittedBy) +
      fact('Verified by', a.verifiedBy) +
      '</dl>';

    var timeline = TIMELINE_LABELS.map(function (t) {
      var v = a.timeline && a.timeline[t[0]];
      if (!v) return '';
      return '<div class="cbi-timeline__item"><b>' + esc(fmtDate(v)) + '</b><span>' + esc(t[1]) + '</span></div>';
    }).join('');

    var narrative = '<dl class="cbi-facts">' +
      fact('Notes', a.notes) +
      fact('Latest comment', a.latestComment) +
      fact('Issues log', a.issuesLog) +
      fact('Agent assessment', a.agentAssessment) +
      fact('Assessment response', a.assessmentResponse) +
      '</dl>';
    var hasNarrative = !!(a.notes || a.latestComment || a.issuesLog || a.agentAssessment || a.assessmentResponse);

    var assess = d.data.assessment || [];
    var doneCount = assess.filter(function (i) { return i.done; }).length;
    var assessHtml = assess.length ? '<ul class="cbi-check">' + assess.map(function (i) {
      var main = i.description || i.applicantLabel || i.label || '';
      var notes = [i.notes, i.agentAssessment, i.response].filter(Boolean).join(' · ');
      return '<li class="' + (i.indent ? 'cbi-check--indent ' : '') + (i.done ? 'cbi-check__done' : '') + '">' +
        '<span class="cbi-check__mark">' + (i.done ? '✓' : '○') + '</span>' +
        '<div class="cbi-check__body">' + esc(main || i.label || '') +
        (notes ? '<div class="cbi-check__notes">' + esc(notes) + '</div>' : '') + '</div></li>';
    }).join('') + '</ul>' : '';

    var files = d.data.attachments || [];
    var filesHtml = files.length ? '<ul class="cbi-files">' + files.map(function (f) {
      return '<li><a href="' + BASE + '/attachments/' + f.id + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
        '<span class="cbi-files__meta">' + esc([fmtSize(f.sizeKb), f.by, fmtDate(f.at)].filter(Boolean).join(' · ')) + '</span></li>';
    }).join('') + '</ul>' : '<div class="cbi-empty">No documents attached yet.</div>';

    var comments = d.data.comments || [];
    var commentsHtml = '<div class="cbi-comments" data-cbi-comments>' +
      (comments.length ? comments.map(function (c) {
        return '<div class="cbi-comment" data-id="c' + esc(c.id) + '">' +
          '<div class="cbi-comment__head"><span class="cbi-comment__author">' + esc(c.author) + '</span>' +
          '<span class="cbi-comment__time">' + esc(fmtDateTime(c.at)) + '</span>' +
          (c.source === 'smartsheet' ? '<span class="cbi-comment__src">Smartsheet</span>' : '') + '</div>' +
          '<div class="cbi-comment__body">' + esc(c.body) + '</div></div>';
      }).join('') : '<div class="cbi-empty">No comments yet.</div>') +
      '</div>' +
      '<div class="cbi-composer">' +
        '<textarea data-cbi-comment-input placeholder="Add a comment…" maxlength="8000"></textarea>' +
        '<button type="button" data-cbi-action="post-comment"' + (state.detail.posting ? ' disabled' : '') + '>Post</button>' +
      '</div>';

    var events = d.data.events || [];
    var EVENT_LABELS = {
      imported: 'Imported from Smartsheet', stage_changed: 'Stage changed', status_changed: 'Status changed',
      assigned: 'Assignment changed', comment_added: 'Comment added', field_changed: 'Field changed',
    };
    var activityHtml = events.length ? '<ul class="cbi-activity">' + events.map(function (e) {
      var what = '<b>' + esc(EVENT_LABELS[e.type] || e.type) + '</b>';
      if (e.from || e.to) {
        what += ' ' + (e.from ? esc(e.from) : '—') + '<span class="arrow">→</span>' + (e.to ? esc(e.to) : '—');
      }
      if (e.actor) what += ' · ' + esc(e.actor);
      return '<li><span class="cbi-activity__time">' + esc(fmtDateTime(e.at)) + '</span>' +
        '<span class="cbi-activity__what">' + what + '</span></li>';
    }).join('') + '</ul>' : '<div class="cbi-empty">History accrues from the first sync onward.</div>';

    function kvTable(obj) {
      var keys = Object.keys(obj || {});
      if (!keys.length) return '';
      return '<table class="cbi-kv">' + keys.sort().map(function (k) {
        return '<tr><td>' + esc(k) + '</td><td>' + esc(String(obj[k])) + '</td></tr>';
      }).join('') + '</table>';
    }
    var financials = kvTable(a.financials);
    var extra = kvTable(a.extra);
    var foldHtml = (financials || extra)
      ? '<details class="cbi-fold">' +
          '<summary>All imported fields</summary>' +
          (financials ? '<h4 style="font:600 12px Inter,sans-serif;margin:10px 0 4px;">Billing &amp; payments</h4>' + financials : '') +
          (extra ? '<h4 style="font:600 12px Inter,sans-serif;margin:10px 0 4px;">Other fields</h4>' + extra : '') +
        '</details>'
      : '';

    var sources = d.data.sources || [];
    var sourcesHint = sources.length > 1 ? sources.length + ' Smartsheet rows merged' : null;

    return head + '<div class="cbi-grid">' +
      panel('Applicant', applicant) +
      panel('Case', caseFacts) +
      panel('Team', team) +
      (timeline ? panel('Timeline', '<div class="cbi-timeline">' + timeline + '</div>', { wide: true }) : '') +
      (assessHtml ? panel('Assessment checklist', assessHtml, { hint: doneCount + ' of ' + assess.length + ' complete' }) : '') +
      (hasNarrative ? panel('Notes', narrative) : '') +
      panel('Documents', filesHtml, { hint: files.length ? files.length + ' file(s)' : null }) +
      panel('Comments', commentsHtml, { wide: false, hint: sourcesHint }) +
      panel('Activity', activityHtml) +
      (foldHtml ? panel('Everything else', foldHtml, { wide: true, hint: 'imported for completeness' }) : '') +
      '</div>';
  }

  /* ── render root ── */

  function render() {
    if (!state.el) return;
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

    var stageBtn = e.target.closest('[data-cbi-stage]');
    if (stageBtn) {
      state.filters.stage = stageBtn.getAttribute('data-cbi-stage');
      state.list.page = 1;
      loadList();
      return;
    }

    var action = e.target.closest('[data-cbi-action]');
    if (!action || action.disabled) return;
    handleAction(action.getAttribute('data-cbi-action'));
  }

  function onChange(e) {
    var filter = e.target.closest('[data-cbi-filter]');
    if (filter) {
      state.filters[filter.getAttribute('data-cbi-filter')] = filter.value;
      state.list.page = 1;
      loadList();
    }
  }

  function onInput(e) {
    var search = e.target.closest('[data-cbi-search]');
    if (!search) return;
    clearTimeout(state.searchTimer);
    var value = search.value;
    state.searchTimer = setTimeout(function () {
      state.filters.q = value.trim();
      state.list.page = 1;
      loadList();
    }, 300);
  }

  function handleAction(action) {
    switch (action) {
      case 'back':
        location.hash = '#/';
        loadSummary();
        loadList();
        break;
      case 'prev':
        if (state.list.page > 1) { state.list.page--; loadList(); }
        break;
      case 'next':
        if (state.list.page < state.list.lastPage) { state.list.page++; loadList(); }
        break;
      case 'sort': {
        var order = ['recent', 'name', 'received', 'status'];
        state.filters.sort = order[(order.indexOf(state.filters.sort) + 1) % order.length];
        toast('Sorted by ' + state.filters.sort);
        state.list.page = 1;
        loadList();
        break;
      }
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
    state.detail.posting = true; render();
    cbiFetch(BASE + '/applications/' + encodeURIComponent(state.detail.uuid) + '/comments', { method: 'POST', json: { body: body } })
      .then(function (c) {
        state.detail.posting = false;
        if (state.detail.data) state.detail.data.comments.push(c);
        render();
        var thread = state.el.querySelector('[data-cbi-comments]');
        if (thread) thread.scrollTop = thread.scrollHeight;
      })
      .catch(function (e) {
        state.detail.posting = false; render();
        toast((e && e.message) || 'Couldn’t post the comment', false);
      });
  }

  function openSyncStatus() {
    cbiFetch(BASE + '/sync').then(function (d) {
      var sheets = d.sheets || [];
      var withIssues = sheets.filter(function (s) { return s.lastError || s.status === 'error'; });
      var body = '<div style="max-height:60vh;overflow:auto;">' +
        '<p style="font:400 12.5px/1.5 Inter,sans-serif;opacity:.7;margin:0 0 10px;">' +
          sheets.length + ' sheet(s) mirrored' + (withIssues.length ? ' · ' + withIssues.length + ' with errors' : ' · all healthy') + '</p>' +
        '<table class="cbi-kv">' +
        sheets.slice(0, 80).map(function (s) {
          return '<tr><td>' + esc(s.name) + '<br><span style="opacity:.55">' + esc(s.category) + ' · ' + s.rows + ' rows</span></td>' +
            '<td>' + esc(s.status) + (s.lastSuccessAt ? '<br><span style="opacity:.55">' + esc(fmtDateTime(s.lastSuccessAt)) + '</span>' : '') +
            (s.lastError ? '<br><span style="color:var(--color-red)">' + esc(s.lastError) + '</span>' : '') + '</td></tr>';
        }).join('') + '</table></div>';
      if (ui() && ui().openModal) ui().openModal({ title: 'Smartsheet sync', body: body });
      else toast(sheets.length + ' sheets mirrored');
    }).catch(function (e) { toast((e && e.message) || 'Couldn’t load sync status', false); });
  }

  /* ── mount ── */

  function wire() {
    var el = state.el;
    if (!el) return;
    // Named handlers: addEventListener dedupes identical re-registrations.
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
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

  // Future SPA-shell promotion: a <div class="tma-dash__view" data-view="cbi">
  // with [data-portal-mount] is all it will take.
  if (window.TMAPortalViews && !standaloneRoot) {
    window.TMAPortalViews.register('cbi', mount);
  }
})();
