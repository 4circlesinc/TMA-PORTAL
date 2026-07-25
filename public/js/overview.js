/*
 * TMA - Dashboard Overview (Figma 32546:96118, Files 32546:96116, Activity 32546:96119)
 * Global: window.TMAOverview
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';
  var AVATAR = 'images/avatars/';

  function fileIconSrc(key, filename) {
    if (window.TMAFileIcons && TMAFileIcons.fileIconSrc) {
      return TMAFileIcons.fileIconSrc(key, filename);
    }
    return ICON + key + '.svg';
  }

  /* Targets, Budget and Settings were removed from this page along with the
     Project Spendings table and the Add Target action — none of them were
     backed by anything, and the page reads as a real dashboard, so figures
     nobody entered are worse than absent sections. */
  var TABS = ['Overview', 'Users', 'Files', 'Activity'];

  /* Real calendar week chrome — never hardcode sample day numbers. */
  function currentWeekDays() {
    var now = new Date();
    var day = now.getDay(); // 0 = Sunday
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    var labels = ['SU', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push({
        label: labels[i],
        day: String(d.getDate()),
        active: d.toDateString() === now.toDateString(),
      });
    }
    return days;
  }

  var ROAD = [];
  var FILES = [];
  var METRICS = null;
  var WORK_PLAN = null;
  var ROOT = window.__TMA_SITE_ROOT || '';

  function apiGet(url) {
    return fetch(ROOT + url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function formatRoadTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function weekRangeIso() {
    var now = new Date();
    var day = now.getDay();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0, 0);
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  function avatarSrc(avatar, name) {
    if (window.TMACurrentUser && TMACurrentUser.avatarSrc) {
      return TMACurrentUser.avatarSrc(avatar, name);
    }
    if (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar)) return avatar;
    return AVATAR + 'Avatar3d01.png';
  }

  function loadRoadFromCalendar() {
    var range = weekRangeIso();
    return apiGet('/portal/calendar/events?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to))
      .then(function (j) {
        var events = (j && j.events) || [];
        ROAD = events.slice(0, 8).map(function (ev) {
          return {
            text: ev.title || 'Untitled event',
            time: formatRoadTime(ev.startsAt || ev.starts_at),
            avatarUrl: avatarSrc(null, ev.organizerName || ev.title),
          };
        });
      });
  }

  function fileTone(name) {
    var ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'red';
    if (ext === 'doc' || ext === 'docx') return 'blue';
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'green';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'purple';
    return 'grey';
  }

  function loadLatestFiles() {
    return apiGet('/portal/files?section=recent&perPage=6')
      .then(function (j) {
        var files = (j && j.files) || [];
        FILES = files.slice(0, 6).map(function (f) {
          var name = f.name || f.filename || 'File';
          var uploader = (f.uploadedBy && f.uploadedBy.name) || (f.owner && f.owner.name) || '';
          var meta = [
            f.sizeLabel || f.size || '',
            f.uploadedAtLabel || f.updatedAtLabel || f.uploadedAt || '',
            uploader,
          ].filter(Boolean).join(' · ');
          return {
            id: f.id || f.uuid,
            name: name,
            meta: meta || 'Recent file',
            icon: (window.TMAFileIcons && TMAFileIcons.iconKeyFor) ? TMAFileIcons.iconKeyFor(name) : 'File',
            tone: fileTone(name),
            downloadUrl: f.downloadUrl || null,
            previewUrl: f.previewUrl || null,
            mime: f.mime || f.mimeType || '',
            uploader: uploader,
            uploaderAvatar: avatarSrc(
              (f.uploadedBy && f.uploadedBy.avatar) || (f.owner && f.owner.avatar),
              uploader
            ),
            raw: f,
          };
        });
      });
  }

  function loadMetrics() {
    return apiGet('/portal/dashboard/metrics').then(function (j) {
      METRICS = j;
    });
  }

  function loadWorkPlan() {
    var today = new Date();
    var key = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return apiGet('/portal/calendar/work-plan/' + encodeURIComponent(key)).then(function (j) {
      WORK_PLAN = (j && j.day) || null;
    });
  }

  var TAB_PANELS = {
    Overview: '.tma-dash__overview-grid',
    Users: '.tma-dash__overview-users',
    Files: '.tma-dash__overview-files-tab',
    Activity: '.tma-dash__overview-activity-tab',
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTabs(activeTab) {
    var current = activeTab || 'Overview';
    var items = TABS.map(function (label) {
      var active = label === current;
      return '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" data-overview-tab="' + esc(label) + '">' +
        '<span class="tma-tab__label">' + esc(label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
    return '<div class="tma-dash__overview-toolbar">' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-tabs" role="tablist">' + items + '</div>' +
      // Add Target and the overflow menu went with the Targets tab. Add User
      // stays: it is the one action here that leads somewhere real.
      '<div class="tma-dash__overview-actions">' +
      '<button type="button" class="tma-dash__overview-btn" data-overview-add-user><img src="' + ICON + 'Plus.svg" alt=""><span>Add User</span></button>' +
      '</div></div>';
  }

  function metricCardsFromApi(j) {
    if (!j || j.staff === false || !j.cards) return null;
    var cards = j.cards;
    var order = [
      ['clientResponse', 'Client response'],
      ['filesShared', 'Files shared'],
      ['awaitingReply', 'Awaiting reply'],
      ['awaitingSignature', 'Awaiting signature'],
    ];
    return order.map(function (pair) {
      var c = cards[pair[0]] || {};
      return {
        label: pair[1],
        value: c.value != null ? String(c.value) : '—',
        hint: c.delta || '',
      };
    });
  }

  function formatPlanHours(plan) {
    if (!plan) return '';
    if (plan.startsAt && plan.endsAt) {
      return formatClock(plan.startsAt) + ' – ' + formatClock(plan.endsAt);
    }
    return plan.statusLabel || '';
  }

  function formatClock(hm) {
    try {
      var parts = String(hm || '').split(':');
      if (parts.length < 2) return String(hm || '');
      var d = new Date();
      d.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return String(hm || ''); }
  }

  function renderHero() {
    var cards = metricCardsFromApi(METRICS);
    var plan = WORK_PLAN;
    var when = '';
    if (plan && plan.date) {
      try {
        when = new Date(plan.date + 'T12:00:00').toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        });
      } catch (e) { when = plan.date; }
    }

    var planHtml =
      '<aside class="tma-dash__overview-workplan" data-overview-workplan>' +
      '<div class="tma-dash__overview-workplan-head">' +
      '<span class="tma-dash__overview-metric-label">Your work plan</span>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--icon" data-overview-workplan-edit aria-label="Edit work plan">' +
      '<img src="' + ICON + 'Gear.svg" alt=""></button></div>' +
      '<p class="tma-dash__overview-workplan-date">' + esc(when || 'Today') + '</p>' +
      '<p class="tma-dash__overview-metric-value"><strong>' + esc(formatPlanHours(plan) || '—') + '</strong></p>' +
      (plan && plan.location
        ? '<p class="tma-dash__overview-workplan-loc">' + esc(plan.location) + '</p>'
        : '') +
      (plan && plan.statusLabel
        ? '<p class="tma-dash__overview-workplan-status">' + esc(plan.statusLabel) + '</p>'
        : '') +
      '</aside>';

    var metricsHtml;
    if (!cards) {
      metricsHtml =
        '<div class="tma-dash__overview-metrics tma-dash__overview-metrics--empty">' +
        '<div class="tma-dash__overview-metric">' +
        '<span class="tma-dash__overview-metric-label">Workspace metrics</span>' +
        '<p class="tma-dash__overview-metric-value"><strong>No data yet</strong></p>' +
        '<p class="tma-dash__overview-metric-empty-hint">Metrics appear for staff accounts once activity is recorded.</p>' +
        '</div></div>';
    } else {
      metricsHtml =
        '<div class="tma-dash__overview-metrics" aria-label="Workspace metrics">' +
        cards.map(function (c, i) {
          return (i ? '<span class="tma-dash__overview-metric-divider" aria-hidden="true"></span>' : '') +
            '<div class="tma-dash__overview-metric">' +
            '<span class="tma-dash__overview-metric-label">' + esc(c.label) + '</span>' +
            '<p class="tma-dash__overview-metric-value"><strong>' + esc(c.value) + '</strong></p>' +
            (c.hint ? '<p class="tma-dash__overview-metric-empty-hint">' + esc(c.hint) + '</p>' : '') +
            '</div>';
        }).join('') +
        '</div>';
    }

    return '<section class="tma-dash__overview-block tma-dash__overview-block--hero" data-node-id="32546:46983">' +
      '<div class="tma-dash__overview-hero-main">' +
      '<h3 class="tma-dash__overview-block-title">Workspace metrics</h3>' +
      metricsHtml +
      '</div>' +
      '<div class="tma-dash__overview-hero-side">' + planHtml + '</div>' +
      '</section>';
  }

  function renderWeek() {
    return currentWeekDays().map(function (d) {
      return '<button type="button" class="tma-dash__overview-day' + (d.active ? ' tma-dash__overview-day--active' : '') + '">' +
        '<span class="tma-dash__overview-day-label">' + esc(d.label) + '</span>' +
        '<span class="tma-dash__overview-day-num">' + esc(d.day) + '</span></button>';
    }).join('');
  }

  function renderRoad() {
    var items = ROAD.length
      ? ROAD.map(function (item) {
          return '<div class="tma-dash__overview-road-item">' +
            '<img class="tma-dash__overview-road-avatar" src="' + esc(item.avatarUrl || AVATAR + 'Avatar3d01.png') + '" alt="">' +
            '<div class="tma-dash__overview-road-body">' +
            '<span class="tma-dash__overview-road-text">' + esc(item.text) + '</span>' +
            '<span class="tma-dash__overview-road-time">' + esc(item.time) + '</span></div></div>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No upcoming items yet.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--road" data-node-id="32546:46995">' +
      '<h3 class="tma-dash__overview-block-title">What\'s on the road?</h3>' +
      '<div class="tma-dash__overview-week">' + renderWeek() + '</div>' +
      '<div class="tma-dash__overview-road">' +
      '<div class="tma-dash__overview-road-line" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-road-list">' + items + '</div></div></section>';
  }

  function renderFiles() {
    var rows = FILES.length
      ? FILES.map(function (f) {
          return '<button type="button" class="tma-dash__overview-file-row" data-overview-file="' +
            esc(f.id || '') + '">' +
            '<div class="tma-dash__overview-file-main">' +
            '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + esc(f.tone) + '">' +
            '<img src="' + fileIconSrc(f.icon, f.name) + '" alt=""></span>' +
            '<div class="tma-dash__overview-file-copy">' +
            '<p class="tma-dash__overview-file-name">' + esc(f.name) + '</p>' +
            '<p class="tma-dash__overview-file-meta">' + esc(f.meta) + '</p></div>' +
            (f.uploader
              ? '<img class="tma-dash__overview-file-uploader" src="' + esc(f.uploaderAvatar) +
                '" alt="' + esc(f.uploader) + '" title="' + esc(f.uploader) + '">'
              : '') +
            '</div></button>';
        }).join('')
      : '<p class="tma-dash__overview-empty">No files yet.</p>';
    return '<section class="tma-dash__overview-block tma-dash__overview-block--files" data-node-id="32546:47005">' +
      '<h3 class="tma-dash__overview-block-title">Latest Files</h3>' +
      '<div class="tma-dash__overview-files-body">' +
      '<div class="tma-dash__overview-files">' + rows + '</div>' +
      '<div class="tma-dash__overview-upload" data-overview-upload-zone>' +
      '<p class="tma-dash__overview-upload-hint">Drop files here or upload files</p>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--solid" data-overview-upload><span>Upload</span></button>' +
      '<input type="file" hidden multiple data-overview-file-input>' +
      '</div></div></section>';
  }

  function renderUsers(activeTab) {
    return '<div class="tma-dash__overview-users" data-node-id="32546:96120"' + (activeTab !== 'Users' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__users" data-users-overview></div></div>';
  }

  function renderFilesTab(activeTab) {
    return '<div class="tma-dash__overview-files-tab" data-node-id="32546:96116"' + (activeTab !== 'Files' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__files" data-files-overview></div></div>';
  }

  function renderActivityTab(activeTab) {
    return '<div class="tma-dash__overview-activity-tab" data-node-id="32546:96119"' + (activeTab !== 'Activity' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__activity" data-activity-overview></div></div>';
  }

  function mountUsersTab(container) {
    var mountEl = container.querySelector('[data-users-overview]');
    if (!mountEl || !window.TMAUsers || typeof window.TMAUsers.mount !== 'function') return;
    window.TMAUsers.mount(mountEl, { context: 'overview' });
  }

  function mountFilesTab(container) {
    var mountEl = container.querySelector('[data-files-overview]');
    if (!mountEl || !window.TMAOverviewFiles || typeof window.TMAOverviewFiles.mount !== 'function') return;
    window.TMAOverviewFiles.mount(mountEl);
  }

  function mountActivityTab(container) {
    var mountEl = container.querySelector('[data-activity-overview]');
    if (!mountEl || !window.TMAOverviewActivity || typeof window.TMAOverviewActivity.mount !== 'function') return;
    window.TMAOverviewActivity.mount(mountEl);
  }

  function syncOverviewChrome(tab) {
    var dash = document.querySelector('.tma-dash');
    var overviewView = dash && dash.querySelector('.tma-dash__view[data-view="overview"]');
    if (!overviewView || overviewView.hidden) return;

    var mainHead = dash.querySelector('.tma-dash__main-head');
    var viewToggleWrap = dash.querySelector('[data-page-view-toggle]');
    if (mainHead) mainHead.style.display = 'none';
    if (viewToggleWrap) viewToggleWrap.hidden = true;

    if (tab === 'Users' && window.TMAUsers && typeof window.TMAUsers.setActiveContext === 'function') {
      window.TMAUsers.setActiveContext('overview');
    }
  }

  function render(activeTab) {
    var tab = activeTab || 'Overview';
    return '<div class="tma-dash__overview" data-node-id="32546:96118">' +
      renderTabs(tab) +
      '<div class="tma-dash__overview-grid"' + (tab !== 'Overview' ? ' hidden' : '') + '>' +
      renderHero() + renderRoad() + renderFiles() +
      '</div>' +
      renderUsers(tab) +
      renderFilesTab(tab) +
      renderActivityTab(tab) +
      '</div>';
  }

  function setActiveTab(container, tab) {
    if (!container) return;
    var overview = container.querySelector('.tma-dash__overview');
    if (!overview) return;

    overview.querySelectorAll('[role="tab"]').forEach(function (btn) {
      var isActive = btn.getAttribute('data-overview-tab') === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Object.keys(TAB_PANELS).forEach(function (key) {
      var panel = overview.querySelector(TAB_PANELS[key]);
      if (panel) panel.hidden = tab !== key;
    });

    if (tab === 'Users') mountUsersTab(container);
    if (tab === 'Files') mountFilesTab(container);
    if (tab === 'Activity') mountActivityTab(container);
    syncOverviewChrome(tab);
  }

  function bindTabs(container) {
    if (!container || container.dataset.overviewTabsBound) return;
    container.dataset.overviewTabsBound = '1';
    container.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-overview-tab]');
      if (!tabBtn || !container.contains(tabBtn)) return;
      setActiveTab(container, tabBtn.getAttribute('data-overview-tab'));
    });
  }

  /* Map a deep-link tab token (?tab=activity, or the pending value the shell
     stored) to a real tab label, so "See all activities" lands on Activity. */
  function normalizeTab(token) {
    var map = { overview: 'Overview', users: 'Users', files: 'Files', activity: 'Activity' };
    return map[String(token || '').toLowerCase()] || null;
  }

  function tabFromUrl() {
    try {
      var t = new URLSearchParams(window.location.search).get('tab');
      return normalizeTab(t);
    } catch (e) { return null; }
  }

  function remountOverviewGrid(container, activeTab) {
    if (!container || activeTab !== 'Overview') return;
    var grid = container.querySelector('.tma-dash__overview-grid');
    if (!grid) return;
    var scrollY = window.scrollY || 0;
    grid.innerHTML = renderHero() + renderRoad() + renderFiles();
    try { window.scrollTo(0, scrollY); } catch (e) {}
  }

  function openFilePreview(file) {
    if (!file) return;
    var url = file.previewUrl || file.downloadUrl;
    if (!url) return;
    if (window.TMAPortalLightbox && typeof TMAPortalLightbox.open === 'function') {
      TMAPortalLightbox.open([{
        name: file.name,
        mime: file.mime || '',
        size: (file.raw && file.raw.size) || 0,
        url: url,
        downloadUrl: file.downloadUrl || url,
      }], 0);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function openUploaderPhoto(file) {
    var src = file && file.uploaderAvatar;
    if (!src || !window.TMAPortalLightbox) return;
    if (/Avatar3d|initials|data:image\/svg/i.test(src) && !(file.raw && file.raw.uploadedBy && file.raw.uploadedBy.avatar)) {
      return;
    }
    var real = (file.raw && file.raw.uploadedBy && file.raw.uploadedBy.avatar) || src;
    if (!real || !/^(https?:|\/(storage|media)\/)/.test(real)) return;
    TMAPortalLightbox.open([{
      name: file.uploader || 'Profile photo',
      mime: 'image/jpeg',
      size: 0,
      url: real,
      canDownload: false,
    }], 0);
  }

  function startOverviewUpload(container, fileList) {
    if (!fileList || !fileList.length || !window.TMAUpload) return;
    window.TMAUpload.add(fileList, { folderId: null });
  }

  function bindOverviewActions(container) {
    if (!container || container.dataset.overviewActionsBound) return;
    container.dataset.overviewActionsBound = '1';

    container.addEventListener('click', function (e) {
      var addUser = e.target.closest('[data-overview-add-user]');
      if (addUser && container.contains(addUser)) {
        e.preventDefault();
        if (window.TMAUsers && typeof TMAUsers.openInvite === 'function') {
          TMAUsers.openInvite();
        } else {
          var usersTab = container.querySelector('[data-overview-tab="Users"]');
          if (usersTab) usersTab.click();
        }
        return;
      }

      var workEdit = e.target.closest('[data-overview-workplan-edit]');
      if (workEdit && container.contains(workEdit)) {
        e.preventDefault();
        var today = new Date();
        var key = today.getFullYear() + '-' +
          String(today.getMonth() + 1).padStart(2, '0') + '-' +
          String(today.getDate()).padStart(2, '0');
        window.__TMA_OPEN_WORKPLAN = key;
        var calNav = document.querySelector('.tma-dash__nav-item[data-nav="calendar"], .tma-dash__mrow[data-nav="calendar"]');
        if (calNav) calNav.click();
        else if (window.TMACalendar && typeof TMACalendar.openWorkPlan === 'function') {
          TMACalendar.openWorkPlan(key);
        }
        return;
      }

      var uploaderImg = e.target.closest('.tma-dash__overview-file-uploader');
      if (uploaderImg && container.contains(uploaderImg)) {
        e.preventDefault();
        e.stopPropagation();
        var rowBtn = uploaderImg.closest('[data-overview-file]');
        var id = rowBtn && rowBtn.getAttribute('data-overview-file');
        var file = FILES.filter(function (f) { return String(f.id) === String(id); })[0];
        openUploaderPhoto(file);
        return;
      }

      var fileBtn = e.target.closest('[data-overview-file]');
      if (fileBtn && container.contains(fileBtn)) {
        e.preventDefault();
        var fid = fileBtn.getAttribute('data-overview-file');
        openFilePreview(FILES.filter(function (f) { return String(f.id) === String(fid); })[0]);
        return;
      }

      var uploadBtn = e.target.closest('[data-overview-upload]');
      if (uploadBtn && container.contains(uploadBtn)) {
        e.preventDefault();
        var input = container.querySelector('[data-overview-file-input]');
        if (input) input.click();
      }
    });

    container.addEventListener('change', function (e) {
      var input = e.target.closest('[data-overview-file-input]');
      if (!input || !container.contains(input)) return;
      startOverviewUpload(container, input.files);
      input.value = '';
    });

    container.addEventListener('dragover', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
    container.addEventListener('dragleave', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      zone.classList.remove('is-dragover');
    });
    container.addEventListener('drop', function (e) {
      var zone = e.target.closest('[data-overview-upload-zone]');
      if (!zone || !container.contains(zone)) return;
      e.preventDefault();
      zone.classList.remove('is-dragover');
      startOverviewUpload(container, e.dataTransfer && e.dataTransfer.files);
    });

    document.addEventListener('tma:upload-complete', function () {
      var current = container.querySelector('[role="tab"][aria-selected="true"]');
      var tab = (current && current.getAttribute('data-overview-tab')) || 'Overview';
      if (tab !== 'Overview') return;
      loadLatestFiles().then(function () {
        remountOverviewGrid(container, 'Overview');
      });
    });
  }

  function refreshOverviewData(container) {
    return Promise.all([
      loadRoadFromCalendar(),
      loadLatestFiles(),
      loadMetrics(),
      loadWorkPlan(),
    ]).then(function () {
      var current = container.querySelector('[role="tab"][aria-selected="true"]');
      var tab = (current && current.getAttribute('data-overview-tab')) || 'Overview';
      if (tab === 'Overview') remountOverviewGrid(container, 'Overview');
    });
  }

  function mount(container, opts) {
    if (!container) return;
    var pending = (typeof document !== 'undefined' && document.querySelector('.tma-dash'))
      ? document.querySelector('.tma-dash')._pendingOverviewTab : null;
    var activeTab = (opts && opts.tab) || normalizeTab(pending) || tabFromUrl() || 'Overview';
    if (pending) { try { document.querySelector('.tma-dash')._pendingOverviewTab = null; } catch (e) {} }
    container.innerHTML = render(activeTab);
    bindTabs(container);
    bindOverviewActions(container);
    if (activeTab === 'Users') mountUsersTab(container);
    if (activeTab === 'Files') mountFilesTab(container);
    if (activeTab === 'Activity') mountActivityTab(container);
    setActiveTab(container, activeTab);

    refreshOverviewData(container);
  }

  /* Open a tab on an already-mounted Overview (used by the "See all
     activities" deep link). Mounts the tab's content on demand. */
  function selectTab(token) {
    var tab = normalizeTab(token) || 'Overview';
    var container = document.querySelector('[data-overview]');
    if (!container || !container.querySelector('.tma-dash__overview')) {
      // Not mounted yet — leave a marker mount() will pick up.
      var dash = document.querySelector('.tma-dash');
      if (dash) dash._pendingOverviewTab = token;
      return;
    }
    setActiveTab(container, tab);
  }

  window.TMAOverview = {
    mount: mount,
    render: render,
    setActiveTab: setActiveTab,
    selectTab: selectTab,
    renderRoad: renderRoad,
    refresh: function () {
      var container = document.querySelector('[data-overview]');
      if (container) refreshOverviewData(container);
    },
  };
})();
