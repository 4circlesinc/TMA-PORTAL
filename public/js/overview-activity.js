/*
 * TMA - Overview → Activity tab: the complete activity log (§8, §9, §10).
 *
 * Server-backed audit trail. Administrators see the whole firm; everyone else
 * sees only their own actions — the server enforces both (ActivityController).
 * Filters (module / status / actor / date / system) and full-text search run
 * server-side; results page in with a cursor "Load more" so the tab never
 * reloads. IP, device, and the value diff are shown only to viewers the server
 * serialises them for. Rows link to the affected record.
 *
 * Global: window.TMAOverviewActivity
 */
(function () {
  'use strict';

  function API() { return window.TMANotifyAPI; }
  function R() { return window.TMANotifyRender; }
  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/activity';

  var TMA = 'images/icons/tma/';
  var ICON = 'images/icons/phosphor/';

  var MODULE_ICON = {
    files: 'FileText', clients: 'AddressBook', calendar: 'CalendarBlank',
    email: 'EnvelopeSimple', messages: 'ChatCircle', signatures: 'PenNib',
    account: 'UserCircle', security: 'ShieldCheck', system: 'Gear',
  };
  var MODULE_LABEL = {
    files: 'Files', clients: 'Clients', calendar: 'Calendar', email: 'Email',
    messages: 'Messages', signatures: 'Signatures', account: 'Account',
    security: 'Security', system: 'System',
  };

  function esc(s) { return R() ? R().esc(s) : String(s == null ? '' : s); }

  function mount(container) {
    if (!container || container.hasAttribute('data-activity-mounted')) return;
    container.setAttribute('data-activity-mounted', '');

    var state = {
      items: [], cursor: null, hasMore: false, loading: false, error: false,
      isAdmin: false, loaded: false,
      search: '', searchFocused: false, sort: 'new', filtersOpen: false,
      filters: { module: '', status: '', actor: '', system: false, from: '', to: '' },
      options: { modules: [], statuses: [], actors: [] },
      expanded: {},
    };
    container._actlog = state;

    /* ── data ─────────────────────────────────────────────────── */
    function params(extra) {
      var f = state.filters;
      return Object.assign({
        limit: 25,
        search: state.search || '',
        module: f.module || '',
        status: f.status || '',
        actor: f.actor || '',
        from: f.from || '',
        to: f.to || '',
        system: f.system ? 1 : '',
      }, extra || {});
    }

    function load() {
      state.loading = true;
      state.error = false;
      state.cursor = null;
      renderBody();
      API().api(BASE + API().qs(params())).then(function (data) {
        state.items = data.items || [];
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.isAdmin = !!data.isAdmin;
        state.loaded = true;
        state.loading = false;
        renderBody();
      }).catch(function () { state.loading = false; state.error = true; renderBody(); });
    }

    function loadMore() {
      if (!state.hasMore || state.loading) return;
      state.loading = true;
      renderBody();
      API().api(BASE + API().qs(params({ cursor: state.cursor }))).then(function (data) {
        state.items = state.items.concat(data.items || []);
        state.cursor = data.nextCursor || null;
        state.hasMore = !!data.nextCursor;
        state.loading = false;
        renderBody();
      }).catch(function () { state.loading = false; state.error = true; renderBody(); });
    }

    function loadFilters() {
      API().api(BASE + '/filters').then(function (data) {
        state.options.modules = data.modules || [];
        state.options.statuses = data.statuses || [];
        state.options.actors = data.actors || [];
        var panel = container.querySelector('[data-actlog-filter-panel]');
        if (panel) panel.innerHTML = filterPanelInner();
      }).catch(function () {});
    }

    // Mark the log seen so the header activity badge clears (§12).
    function markSeen() { if (window.TMAActivities) window.TMAActivities.markSeen(); }

    /* ── rendering ────────────────────────────────────────────── */
    function toolbar() {
      var cls = ['tma-dash__toolbar-search'];
      if (state.searchFocused || state.search) cls.push('tma-dash__toolbar-search--focused');
      if (state.search) cls.push('tma-dash__toolbar-search--has-value');
      var activeFilters = countActiveFilters();
      return '<div class="tma-dash__toolbar">' +
        '<div class="tma-dash__toolbar-actions">' +
          '<button type="button" class="tma-dash__tool-btn' + (state.filtersOpen ? ' is-active' : '') + '" aria-label="Filter" data-actlog-filter aria-pressed="' + state.filtersOpen + '">' +
            '<img src="' + TMA + 'FunnelSimple-16.svg" alt="">' +
            (activeFilters ? '<span class="tma-dash__actlog-filter-count">' + activeFilters + '</span>' : '') +
          '</button>' +
          '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-actlog-sort title="' + (state.sort === 'new' ? 'Newest first' : 'Oldest first') + '"><img src="' + TMA + 'ArrowsDownUp.svg" alt=""></button>' +
        '</div>' +
        '<div class="' + cls.join(' ') + '" role="search">' +
          '<img src="' + TMA + 'Search-16.svg" alt="">' +
          '<input type="search" class="tma-dash__search-input" placeholder="Search activity" aria-label="Search activity" value="' + esc(state.search) + '" data-actlog-search autocomplete="off" spellcheck="false">' +
          '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-actlog-search-clear><img src="' + TMA + 'Xcircle.svg" alt=""></button>' +
        '</div>' +
      '</div>';
    }

    function countActiveFilters() {
      var f = state.filters, n = 0;
      ['module', 'status', 'actor', 'from', 'to'].forEach(function (k) { if (f[k]) n++; });
      if (f.system) n++;
      return n;
    }

    function selectField(name, label, value, options) {
      var opts = '<option value="">' + esc(label) + '</option>' + options.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (String(value) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('');
      return '<label class="tma-dash__actlog-field"><span>' + esc(label) + '</span>' +
        '<select data-actlog-filter-field="' + name + '">' + opts + '</select></label>';
    }

    function filterPanelInner() {
      var f = state.filters;
      var moduleOpts = (state.options.modules.length ? state.options.modules : Object.keys(MODULE_LABEL))
        .map(function (m) { return { value: m, label: MODULE_LABEL[m] || m }; });
      var statusOpts = (state.options.statuses.length ? state.options.statuses : ['success', 'failure', 'pending'])
        .map(function (s) { return { value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }; });
      var fields = selectField('module', 'Module', f.module, moduleOpts) +
        selectField('status', 'Status', f.status, statusOpts);
      if (state.isAdmin && state.options.actors.length) {
        fields += selectField('actor', 'User', f.actor, state.options.actors.map(function (a) { return { value: a.id, label: a.name }; }));
      }
      fields += '<label class="tma-dash__actlog-field"><span>From</span><input type="date" data-actlog-filter-field="from" value="' + esc(f.from) + '"></label>';
      fields += '<label class="tma-dash__actlog-field"><span>To</span><input type="date" data-actlog-filter-field="to" value="' + esc(f.to) + '"></label>';
      fields += '<label class="tma-dash__actlog-check"><input type="checkbox" data-actlog-filter-field="system"' + (f.system ? ' checked' : '') + '> System-generated only</label>';
      return fields +
        '<div class="tma-dash__actlog-filter-foot">' +
          '<button type="button" class="tma-dash__rb-retry" data-actlog-filter-clear>Clear</button>' +
        '</div>';
    }

    function filterPanel() {
      return '<div class="tma-dash__actlog-filter-panel" data-actlog-filter-panel' + (state.filtersOpen ? '' : ' hidden') + '>' + filterPanelInner() + '</div>';
    }

    function head() {
      return '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
        '<div class="tma-dash__cc tma-dash__cc--activity tma-dash__cc--head">Activity</div>' +
        '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head">User</div>' +
        '<div class="tma-dash__cc tma-dash__cc--module tma-dash__cc--head">Module</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Date</div>' +
        '<div class="tma-dash__cc tma-dash__cc--actions tma-dash__cc--head" aria-hidden="true"></div>' +
      '</div>';
    }

    function toneFor(item) {
      if (item.status === 'failure') return 'red';
      if (item.status === 'pending') return 'amber';
      return 'blue';
    }

    function userCell(item) {
      if (item.isSystem || !item.actor) {
        return '<div class="tma-dash__cc tma-dash__cc--user">' +
          '<span class="tma-dash__actlog-system-chip"><img src="' + ICON + 'Gear.svg" alt=""></span>' +
          '<span class="tma-dash__cc-truncate">System</span></div>';
      }
      var name = item.actor.name || 'User';
      var avatar = (item.actor.avatar && /^(https?:|\/(storage|media)\/|data:)/.test(item.actor.avatar))
        ? item.actor.avatar : (R() ? R().initialsUri(name) : '');
      var fallback = R() ? R().initialsUri(name) : '';
      return '<div class="tma-dash__cc tma-dash__cc--user">' +
        '<img src="' + esc(avatar) + '" alt="" onerror="this.onerror=null;this.src=\'' + fallback + '\'">' +
        '<span class="tma-dash__cc-truncate">' + esc(name) + '</span></div>';
    }

    function row(item) {
      var tone = toneFor(item);
      var icon = MODULE_ICON[item.module] || 'Notification';
      var url = R() ? R().actionUrlForActivity(item) : '';
      var canExpand = state.isAdmin && (item.ip || item.device || (item.oldValues) || (item.newValues) || item.status !== 'success');
      var open = !!state.expanded[item.id];
      var statusDot = item.status && item.status !== 'success'
        ? '<span class="tma-dash__actlog-status tma-dash__actlog-status--' + esc(item.status) + '">' + esc(item.status) + '</span>' : '';

      var main = '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview tma-dash__actlog-row" data-actlog-row="' + esc(item.id) + '" data-action-url="' + esc(url) + '" role="row">' +
        '<div class="tma-dash__cc tma-dash__cc--activity">' +
          '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + tone + '"><img src="' + ICON + esc(icon) + '.svg" alt="" width="16" height="16"></span>' +
          '<span class="tma-dash__cc-truncate">' + esc(item.description) + '</span>' + statusDot +
        '</div>' +
        userCell(item) +
        '<div class="tma-dash__cc tma-dash__cc--module"><span class="tma-dash__actlog-tag">' + esc(MODULE_LABEL[item.module] || item.module) + '</span></div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--activity-date"><img src="' + ICON + 'CalendarBlank.svg" alt="">' + esc(R() ? R().timeLabel(item.createdAt) : '') + '</div>' +
        '<div class="tma-dash__cc tma-dash__cc--actions">' +
          (canExpand ? '<button type="button" class="tma-dash__row-more" aria-label="Details" data-actlog-expand="' + esc(item.id) + '" aria-expanded="' + open + '"><img src="' + TMA + 'ThreeDots-16.svg" alt="" width="16" height="16"></button>' : '') +
        '</div>' +
      '</div>';

      if (canExpand && open) main += detailRow(item);
      return main;
    }

    function detailRow(item) {
      function line(label, value) {
        if (value == null || value === '') return '';
        return '<div class="tma-dash__actlog-detail-line"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
      }
      var diff = '';
      if (item.oldValues || item.newValues) {
        diff = '<div class="tma-dash__actlog-detail-line"><span>Changes</span><code>' +
          esc(JSON.stringify({ before: item.oldValues || null, after: item.newValues || null })) + '</code></div>';
      }
      return '<div class="tma-dash__actlog-detail" role="row">' +
        line('Type', item.type) +
        line('Status', item.status) +
        line('IP address', item.ip) +
        line('Device', item.device) +
        (item.client ? line('Client', item.client.name) : '') +
        diff +
      '</div>';
    }

    function orderedItems() {
      if (state.sort === 'old') return state.items.slice().reverse();
      return state.items;
    }

    function bodyInner() {
      if (!state.loaded && state.loading) return R().skeleton ? tableSkeleton() : '';
      if (state.error && !state.items.length) {
        return window.TMASectionError
          ? window.TMASectionError.render({
              title: 'Unable to load activity',
              message: 'Activity could not be loaded.',
              showRetry: true,
              retryAttr: 'data-actlog-retry',
            })
          : '<div class="tma-dash__actlog-empty">' + esc('Could not load activity.') + ' <button type="button" class="tma-dash__rb-retry" data-actlog-retry>Retry</button></div>';
      }
      if (!state.items.length) {
        return window.TMANoData
          ? window.TMANoData.render({ title: 'No activity yet', subtitle: 'Actions across the portal will appear here.', showButton: false, compact: true })
          : '<div class="tma-dash__actlog-empty">No activity yet.</div>';
      }
      var rows = orderedItems().map(row).join('');
      var more = state.hasMore
        ? '<button type="button" class="tma-dash__actlog-more" data-actlog-more' + (state.loading ? ' disabled' : '') + '>' + (state.loading ? 'Loading…' : 'Load more') + '</button>'
        : '';
      return rows + more;
    }

    function tableSkeleton() {
      var r = '';
      for (var i = 0; i < 8; i++) {
        r += '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview"><div class="tma-dash__cc tma-dash__cc--activity"><span class="tma-dash__rb-skel-avatar" style="width:24px;height:24px"></span><span class="tma-dash__rb-skel-lines" style="flex:1"><span></span></span></div><div class="tma-dash__cc tma-dash__cc--user"></div><div class="tma-dash__cc tma-dash__cc--module"></div><div class="tma-dash__cc tma-dash__cc--date"></div><div class="tma-dash__cc tma-dash__cc--actions"></div></div>';
      }
      return r;
    }

    function renderBody() {
      var body = container.querySelector('[data-actlog-body]');
      if (body) body.innerHTML = bodyInner();
      var fbtn = container.querySelector('[data-actlog-filter]');
      if (fbtn) {
        var n = countActiveFilters();
        var existing = fbtn.querySelector('.tma-dash__actlog-filter-count');
        if (n && !existing) fbtn.insertAdjacentHTML('beforeend', '<span class="tma-dash__actlog-filter-count">' + n + '</span>');
        else if (n && existing) existing.textContent = n;
        else if (!n && existing) existing.remove();
      }
    }

    function render() {
      container.className = 'tma-dash__activity tma-dash__activity--overview tma-dash__actlog';
      container.innerHTML =
        toolbar() +
        filterPanel() +
        '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Activity log">' +
          head() +
          '<div data-actlog-body>' + bodyInner() + '</div>' +
        '</div>';
    }

    /* ── events ───────────────────────────────────────────────── */
    var searchTimer = null;
    container.addEventListener('input', function (e) {
      var s = e.target.closest('[data-actlog-search]');
      if (s) {
        state.search = s.value;
        state.searchFocused = true;
        // Toggle the clear affordance imperatively so we never rebuild the
        // toolbar mid-type (which would drop focus and the caret).
        var wrap = container.querySelector('.tma-dash__toolbar-search');
        if (wrap) wrap.classList.toggle('tma-dash__toolbar-search--has-value', !!state.search);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { load(); }, 220);
        return;
      }
      var field = e.target.closest('[data-actlog-filter-field]');
      if (field) applyFilterField(field);
    });

    container.addEventListener('change', function (e) {
      var field = e.target.closest('[data-actlog-filter-field]');
      if (field) applyFilterField(field);
    });

    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-actlog-filter]')) { state.filtersOpen = !state.filtersOpen; togglePanel(); return; }
      if (e.target.closest('[data-actlog-sort]')) { state.sort = state.sort === 'new' ? 'old' : 'new'; renderBody(); syncSortTitle(); return; }
      if (e.target.closest('[data-actlog-search-clear]')) { state.search = ''; render(); focusSearch(); load(); return; }
      if (e.target.closest('[data-actlog-more]')) { loadMore(); return; }
      if (e.target.closest('[data-actlog-retry]')) { load(); return; }
      if (e.target.closest('[data-actlog-filter-clear]')) { clearFilters(); return; }

      var expand = e.target.closest('[data-actlog-expand]');
      if (expand) { e.stopPropagation(); var id = expand.getAttribute('data-actlog-expand'); state.expanded[id] = !state.expanded[id]; renderBody(); return; }

      var rowEl = e.target.closest('[data-actlog-row]');
      if (rowEl) {
        var url = rowEl.getAttribute('data-action-url');
        if (url) {
          var root = document.querySelector('.tma-dash');
          if (root && root._portalNavigate) root._portalNavigate(url);
          else if (url) window.location.assign((window.__TMA_SITE_ROOT || '') + url);
        }
      }
    });

    container.addEventListener('focusin', function (e) { if (e.target.closest('[data-actlog-search]')) state.searchFocused = true; });
    container.addEventListener('focusout', function (e) { if (e.target.closest('[data-actlog-search]')) state.searchFocused = false; });

    function applyFilterField(field) {
      var name = field.getAttribute('data-actlog-filter-field');
      state.filters[name] = field.type === 'checkbox' ? field.checked : field.value;
      load();
    }

    function clearFilters() {
      state.filters = { module: '', status: '', actor: '', system: false, from: '', to: '' };
      var panel = container.querySelector('[data-actlog-filter-panel]');
      if (panel) panel.innerHTML = filterPanelInner();
      load();
    }

    function togglePanel() {
      var panel = container.querySelector('[data-actlog-filter-panel]');
      var btn = container.querySelector('[data-actlog-filter]');
      if (panel) panel.hidden = !state.filtersOpen;
      if (btn) { btn.classList.toggle('is-active', state.filtersOpen); btn.setAttribute('aria-pressed', String(state.filtersOpen)); }
    }

    function syncSortTitle() {
      var btn = container.querySelector('[data-actlog-sort]');
      if (btn) btn.title = state.sort === 'new' ? 'Newest first' : 'Oldest first';
    }

    function focusSearch() {
      var input = container.querySelector('[data-actlog-search]');
      if (input) { input.focus(); var l = input.value.length; input.setSelectionRange(l, l); }
    }

    render();
    loadFilters();
    load();
    markSeen();
  }

  window.TMAOverviewActivity = { mount: mount };
})();
