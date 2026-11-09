/*
 * Requested Files (Workflows → Requests → Requested Files).
 *
 * Every request the signed-in person has sent, and how far each has got:
 * which documents have arrived and which are still outstanding, when each
 * came in, and a click straight to where it was filed. Outstanding first,
 * completed after; refreshed as uploads land (on return to the window, and
 * every half minute while it is on screen).
 *
 * Drawn with the Files table's rows and the checklist rows the application's
 * Documents list uses. Embedded (opts.embedded), the page around it owns the
 * tabs, the search and the Show filter, and this draws the table alone.
 *
 * Global: window.TMAOverviewRequests (the name it was first mounted under).
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
      '<span class="tma-dash__clients-checklist-label">' +
      '<span class="tma-dash__cc-truncate">' + esc(item.label || 'Document') + '</span>' +
      (item.person ? '<span class="tma-dash__clients-checklist-optional tma-overview-requests__person">' + esc(item.person) + '</span>' : '') +
      (when ? '<span class="tma-dash__clients-checklist-optional tma-overview-requests__when">' + esc(when) + '</span>' : '') +
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
          '<span class="tma-tab__label">' + esc(t.label) + '<span class="tma-tab__count">' + t.n + '</span></span>' +
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

    var sent = shortDate(req.createdAt);
    var meta = [who, count + ' received', sent ? 'Sent ' + sent : ''].filter(Boolean).join(' · ');

    var row = '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' + (open ? ' tma-dash__ctr--selected' : '') + '"' +
      ' role="row" data-req-row="' + esc(req.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" tabindex="0">' +
      '<div class="tma-dash__cc tma-dash__cc--filename">' +
      '<img class="tma-overview-requests__caret' + (open ? ' is-open' : '') + '" src="' + TOOL.Caret + '" alt="" width="16" height="16">' +
      '<span class="tma-dash__files-library-copy">' +
      '<span class="tma-dash__cc-truncate">' + esc(req.title || 'Request') + '</span>' +
      '<span class="tma-dash__files-library-meta">' + esc(meta) + '</span>' +
      '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--folder"><span class="tma-dash__cc-truncate">' + esc(who) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--size"><span class="tma-dash__cc-truncate">' + esc(count) + ' received</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-overview-requests__sent"><img src="' + TOOL.Calendar + '" alt=""><span class="tma-dash__cc-truncate">' + esc(sent || '—') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-overview-requests__last"><span class="tma-dash__cc-truncate">' + esc(req.lastUploadAt ? shortDate(req.lastUploadAt) : '—') + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--shared">' + chip(p.statusLabel || 'Waiting', TONES[p.status]) + '</div>' +
      '</div>';

    if (!open) return row;

    var detailMeta = [
      req.expiresAt && p.status !== 'complete' ? 'Upload by ' + shortDate(req.expiresAt) : null,
      p.outstanding && req.reminderEveryDays ? 'Reminded ' + String(req.reminderLabel || '').toLowerCase() : null,
      req.remindedAt ? 'Last reminder ' + shortDate(req.remindedAt) : null,
      req.client && req.client.name ? 'Filed under ' + req.client.name : null,
    ].filter(Boolean).join(' · ');

    return row +
      '<div class="tma-overview-requests__detail" role="row">' +
      (detailMeta ? '<p class="tma-dash__clients-checklist-empty">' + esc(detailMeta) + '</p>' : '') +
      ((p.items || []).length
        ? '<ul class="tma-dash__clients-checklist">' + p.items.map(itemRow).join('') + '</ul>'
        : '<p class="tma-dash__clients-checklist-empty">Nothing has arrived yet.</p>') +
      (canResend(req) || canRemind(req) || (req.open && req.link)
        ? '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
          (canRemind(req)
            ? '<button type="button" class="tma-no-data__btn" data-req-remind="' + esc(req.id) + '">' +
              '<img class="tma-no-data__btn-icon" src="' + ICON + 'BellRinging.svg" alt="" width="16" height="16"><span>Send reminder</span></button>'
            : '') +
          (canResend(req)
            ? '<button type="button" class="tma-no-data__btn' + (canRemind(req) ? ' tma-portal-btn--ghost' : '') + '" data-req-resend="' + esc(req.id) + '">' +
              '<img class="tma-no-data__btn-icon" src="' + ICON + 'PaperPlaneTilt.svg" alt="" width="16" height="16"><span>Resend</span></button>'
            : '') +
          (req.open && req.link
            ? '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-req-copy="' + esc(req.link) + '">' +
              '<img class="tma-no-data__btn-icon" src="' + ICON + 'LinkSimple.svg" alt="" width="16" height="16"><span>Copy link</span></button>'
            : '') +
          '</div>'
        : '') +
      '</div>';
  }

  function render(state) {
    var el = state.el;
    if (!el) return;
    // The Files table's own scope, so its rows and columns apply; embedded,
    // the page's own class on the host stays as well.
    if (state.embedded) el.classList.add('tma-dash__files', 'tma-dash__files--overview');
    else el.className = 'tma-dash__files tma-dash__files--overview';

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
      ? '<div class="tma-dash__ctable tma-dash__ctable--overview tma-dash__ctable--requests" role="table" aria-label="Requested files">' +
        '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
        '<div class="tma-dash__cc tma-dash__cc--filename tma-dash__cc--head">Request</div>' +
        '<div class="tma-dash__cc tma-dash__cc--folder tma-dash__cc--head">Sent to</div>' +
        '<div class="tma-dash__cc tma-dash__cc--size tma-dash__cc--head">Progress</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head tma-overview-requests__sent">Sent</div>' +
        '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head tma-overview-requests__last">Last upload</div>' +
        '<div class="tma-dash__cc tma-dash__cc--shared tma-dash__cc--head">Status</div>' +
        '</div>' +
        list.map(function (r) { return renderRow(r, !!state.expanded[r.id]); }).join('') +
        '</div>'
      : '<div class="tma-dash__files-empty">' + emptyHtml + '</div>';

    var focused = document.activeElement && document.activeElement.hasAttribute
      && document.activeElement.hasAttribute('data-req-search');
    var caret = focused ? document.activeElement.selectionStart : null;

    el.innerHTML = state.embedded
      ? body
      : renderTabs(state, { open: open.length, done: done.length, all: rows.length }) + renderToolbar(state) + body;

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
        var first = !state.loadedAt;
        state.rows = cache = (res && res.requests) || [];
        state.loadedAt = Date.now();
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

  /* Still waiting on somebody who was sent the link, and the link is open. */
  function canRemind(req) {
    var p = req.progress || {};
    return !!(req.open && p.outstanding && (p.sentTo || []).length);
  }

  function remind(state, req, btn) {
    var ui = window.TMAPortalUI;
    btn.disabled = true;
    var label = btn.querySelector('span');
    if (label) label.textContent = 'Sending…';
    net().fetchJSON('/portal/files/requests/' + encodeURIComponent(req.id) + '/remind', { method: 'POST', json: {} })
      .then(function () {
        if (ui) ui.toast('Reminder sent');
        load(state, true);
      })
      .catch(function (err) {
        btn.disabled = false;
        if (label) label.textContent = 'Send reminder';
        if (ui) ui.toastError((err && err.message) || 'Could not send the reminder.');
      });
  }

  /* Something is still to come, and somebody was emailed the link. */
  function canResend(req) {
    var p = req.progress || {};
    if (req.closedReason === 'revoked' || p.status === 'complete') return false;
    return (p.sentTo || []).length > 0;
  }

  function isoDay(d) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /*
   * Send the same link again with a new deadline: to everyone it went to
   * before, and open again until the new date if it had lapsed.
   */
  function openResend(state, req) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var suggested = new Date();
    suggested.setDate(suggested.getDate() + 14);
    var current = req.expiresAt ? new Date(req.expiresAt) : null;
    if (current && !isNaN(current.getTime()) && current > suggested) suggested = current;

    var to = (req.progress && req.progress.sentTo) || [];
    var p = req.progress || {};
    var left = p.total ? (p.total - p.received) : 0;

    var body =
      '<p class="tma-portal-modal__text">Email the upload link for <strong>' + esc(req.title || 'this request') + '</strong> again' +
      (left ? ', for the ' + left + (left === 1 ? ' document' : ' documents') + ' still outstanding' : '') + '.</p>' +
      '<div class="tma-dash__clients-field tma-dash__clients-field--stacked">' +
      '<span class="tma-dash__clients-field-label">Sent to</span>' +
      '<div class="tma-cip-cc">' + to.map(function (email) {
        return '<span class="tma-cip-cc__tag tma-cip-cc__tag--static"><span class="tma-cip-cc__tag-text">' + esc(email) + '</span></span>';
      }).join('') + '</div>' +
      '</div>' +
      '<div class="tma-dash__clients-field">' +
      '<label class="tma-dash__clients-field-label" for="req-resend-expiry">Upload by</label>' +
      '<input type="date" id="req-resend-expiry" class="tma-dash__clients-field-input" data-req-resend-expiry' +
      ' min="' + isoDay(tomorrow) + '" value="' + isoDay(suggested) + '">' +
      '</div>' +
      '<div class="tma-portal-modal__foot">' +
      '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-req-resend-cancel>Cancel</button>' +
      '<button type="button" class="tma-no-data__btn" data-req-resend-send>Resend</button>' +
      '</div>';

    ui.openModal({
      title: 'Resend request',
      cls: 'tma-cip-not-ready tma-cip-docreq',
      body: body,
      onMount: function (el) {
        el.querySelector('[data-req-resend-cancel]').addEventListener('click', function () { ui.closeModal(); });
        var send = el.querySelector('[data-req-resend-send]');
        send.addEventListener('click', function () {
          var date = el.querySelector('[data-req-resend-expiry]').value;
          if (!date) {
            ui.toastError('Choose the date they should upload by.');
            return;
          }
          send.disabled = true;
          send.textContent = 'Sending…';
          net().fetchJSON('/portal/files/requests/' + encodeURIComponent(req.id) + '/resend', {
            method: 'POST',
            json: { expiresAt: date },
          }).then(function (res) {
            ui.closeModal();
            var who = (res && res.sentTo && res.sentTo.length) ? res.sentTo.join(', ') : 'them';
            ui.toast('Request sent again to ' + who);
            load(state, true);
          }).catch(function (err) {
            send.disabled = false;
            send.textContent = 'Resend';
            ui.toastError((err && err.message) || 'Could not send the request again.');
          });
        });
      },
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

  /* The last list read, so arriving back on the tab draws it at once. */
  var cache = null;

  /**
   * @param {Element} el
   * @param {{embedded?: boolean, filter?: 'open'|'done'|'all', search?: string}} [opts]
   */
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var state = el._requestsState;
    var fresh = !state;
    if (!state) {
      state = el._requestsState = { el: el, rows: cache, error: null, filter: 'open', timer: null, search: '', expanded: {}, embedded: false, loadedAt: 0 };

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
        var remindBtn = e.target.closest('[data-req-remind]');
        if (remindBtn) {
          var due = (state.rows || []).filter(function (r) { return r.id === remindBtn.getAttribute('data-req-remind'); })[0];
          if (due) remind(state, due, remindBtn);
          return;
        }
        var resend = e.target.closest('[data-req-resend]');
        if (resend) {
          var target = (state.rows || []).filter(function (r) { return r.id === resend.getAttribute('data-req-resend'); })[0];
          if (target) openResend(state, target);
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

    if (opts.embedded) {
      state.embedded = true;
      if (opts.filter) state.filter = opts.filter;
      if (typeof opts.search === 'string') state.search = opts.search.trim();
    }

    // Embedded, the page calls this on every repaint (a keystroke in its
    // search, a change of filter): draw from what is held, and read again
    // only when it is getting old — the half-minute poll keeps it current.
    if (state.rows) render(state);
    if (fresh || Date.now() - state.loadedAt > 5000) load(state, !!state.rows);
  }

  window.TMAOverviewRequests = { mount: mount };
})();
