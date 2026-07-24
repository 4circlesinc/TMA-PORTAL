/*
 * TMA - Users page ( /users )
 * Search, filter, sort, add row, pagination (table-search + filter-sort guidance rules).
 * Global: window.TMAUsers
 */
(function () {
  'use strict';

  var ICONS = {
    Add: 'images/icons/tma/Add.svg',
    FunnelSimple: 'images/icons/tma/FunnelSimple-16.svg',
    ArrowsDownUp: 'images/icons/tma/ArrowsDownUp.svg',
    ArrowsDown: 'images/icons/tma/ArrowsDown-16.svg',
    ArrowsUp: 'images/icons/tma/ArrowsUp.svg',
    Search: 'images/icons/tma/Search-16.svg',
    Close: 'images/icons/tma/Close-12.svg',
    Dot: 'images/icons/tma/Dot-12.svg',
    ArrowLineRight: 'images/icons/tma/ArrowLineRight-16.svg',
    ArrowLineLeft: 'images/icons/tma/ArrowLineLeft-16.svg',
    ArrowLineDown: 'images/icons/tma/ArrowLineDown-16.svg',
    XCircle: 'images/icons/tma/Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
    CalendarBlank: 'images/icons/phosphor/CalendarBlank.svg',
    ListNumbers: 'images/icons/phosphor/ListNumbers.svg',
    User: 'images/icons/phosphor/User.svg',
    MapPin: 'images/icons/phosphor/MapPin.svg',
    CirclesThreePlus: 'images/icons/phosphor/CirclesThreePlus.svg',
    Broom: 'images/icons/phosphor/Broom.svg',
    Plus: 'images/icons/phosphor/Plus.svg',
    Line: 'images/icons/tma/Line-16.svg',
    Trash: 'images/icons/phosphor/Trash.svg',
    Copy: 'images/icons/tma/Copy-16.svg',
    EnvelopeSimple: 'images/icons/phosphor/EnvelopeSimple.svg',
    ThreeDots: 'images/icons/tma/ThreeDots-16.svg',
  };

  /* ── real user directory (database-backed, admin only) ── */
  /* the design system's own avatar set - filled from the server */
  var SYSTEM_AVATARS = [];

  function usersApi(method, url, body) {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function refreshPendingBadge() {
    var d = document.querySelector('.tma-dash');
    if (d && d._syncPendingUsersBadge) d._syncPendingUsersBadge();
  }

  function usersToast(message, ok) {
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(message, { state: ok ? 'positive' : 'negative' });
    }
  }

  function realRow(u) {
    return {
      serial: '#U' + String(u.id).padStart(4, '0'),
      user: u.name,
      avatar: u.avatar || initialsAvatar(u.name, u.id),
      email: u.email,
      address: u.accountType || 'Not assigned',
      date: u.joined,
      _ts: u.joinedIso ? Date.parse(u.joinedIso) : null,
      _status: u.status,
      _id: u.id,
      _self: u.self,
      firstName: u.firstName || '',
      middleName: u.middleName || '',
      lastName: u.lastName || '',
      phone: u.phone || '',
      jobTitle: u.jobTitle || '',
      gender: u.gender || '',
      bio: u.bio || '',
      linkedin: u.linkedin || '',
      _twoFactor: u.twoFactor,
      _lastActive: u.lastActive,
      note: u.note || '',
    };
  }

  var ACT_LABELS = {
    registered: 'Account created', email_verified: 'Email verified', login: 'Signed in',
    logout: 'Signed out', login_failed: 'Failed sign-in attempt', password_reset: 'Password reset',
    lockout: 'Sign-in locked', social_connected: 'Sign-in method connected',
    social_disconnected: 'Sign-in method disconnected', user_invited: 'Invited to the portal',
    account_approved: 'Account approved', account_suspended: 'Account suspended',
    account_reactivated: 'Account reactivated', account_updated: 'Profile updated by admin',
    password_reset_link_sent: 'Password reset link sent', password_generated: 'Temporary password generated',
    account_deleted: 'Account deleted',
  };

  function renderActivityPane(row, el, type) {
    el.innerHTML = window.TMASkeleton ? window.TMASkeleton.rows(3, { leading: false }) : '<p class="tma-user-info-panel__field-label">Loading…</p>';
    usersApi('GET', '/admin/users/' + row._id + '/activity?type=' + type).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (j) {
      if (!j) { el.innerHTML = '<p class="tma-user-info-panel__field-label">Couldn\'t load activity.</p>'; return; }
      var last = (type === 'login' && j.lastLogin)
        ? '<div class="tma-user-info-panel__field tma-user-info-panel__field--muted">' +
          '<p class="tma-user-info-panel__field-label">Last signed in</p>' +
          '<div class="tma-user-info-panel__field-row"><span class="tma-user-info-panel__field-value">' + escapeHtml(j.lastLogin) + '</span></div></div>'
        : '';
      var empty = type === 'login'
        ? 'No sign-ins yet.'
        : 'No application activity yet - this fills in as they use the portal.';
      var rows = j.events.length ? j.events.map(function (ev) {
        var at = ev.atIso ? new Date(ev.atIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ev.when;
        return '<div class="tma-rup__event"><strong>' + escapeHtml(ACT_LABELS[ev.event] || ev.event) + '</strong>' +
          '<span>' + escapeHtml(at) + (ev.ip ? ' · ' + escapeHtml(ev.ip) : '') + (ev.device ? ' · ' + escapeHtml(ev.device) : '') + '</span></div>';
      }).join('') : '<p class="tma-user-info-panel__field-label">' + empty + '</p>';
      el.innerHTML = last + '<div>' + rows + '</div>';
    }).catch(function () {
      el.innerHTML = '<p class="tma-user-info-panel__field-label">Couldn\'t load activity.</p>';
    });
  }

  function initialsAvatar(name, id) {
    var initials = String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var colors = ['#136da0', '#03a5e9', '#0f9d8c', '#3f9142', '#c77d18', '#b5497e', '#3b6fb8'];
    var bg = colors[Math.abs(id || 0) % colors.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<rect width="40" height="40" rx="20" fill="' + bg + '"/>' +
      '<text x="20" y="21" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" ' +
      'fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + initials + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function avatarUrl(name) {
    // Real photos: an absolute URL, an inline data-URI (initials), or an
    // uploaded /storage/… path. Anything else is a legacy system-avatar name.
    return /^(https?:|data:|\/)/.test(name || '') ? name : 'images/avatars/' + name + '.png';
  }

  function statusBadge(row) {
    if (!row._status) return '';
    var label = row._status === 'pending' ? 'Pending' : (row._status === 'suspended' ? 'Suspended' : 'Active');
    return '<button type="button" class="tma-dash__ustatus tma-dash__ustatus--' + row._status + '"' +
      ' data-users-status data-user-id="' + row._id + '" aria-haspopup="menu" title="Account actions">' + label + '</button>';
  }

  var DATE_WEIGHT = {
    'just now': 0,
    '1 minute ago': 1,
    '1 hour ago': 2,
    yesterday: 3,
    'feb 2, 2026': 4,
  };

  var FILTER_FIELDS = [
    { id: 'serial', label: 'Serial', icon: 'ListNumbers' },
    { id: 'user', label: 'User', icon: 'User' },
    { id: 'email', label: 'Email', icon: 'EnvelopeSimple' },
    { id: 'address', label: 'Account type', icon: 'MapPin' },
  ];

  var mounts = {};
  var activeContext = 'page';

  function getActiveMount() {
    return mounts[activeContext] || null;
  }

  function registerViewToggle(entry) {
    if (!window.TMATableViewToggle || !entry) return;
    window.TMATableViewToggle.register('users', {
      getViewMode: function () { return entry.state.viewMode; },
      setViewMode: function (mode) {
        entry.state.viewMode = mode;
        entry.state.page = 1;
      },
      render: entry.render,
    });
  }

  function setActiveContext(context) {
    if (!mounts[context]) return;
    activeContext = context;
    if (context === 'overview') return;
    registerViewToggle(mounts[context]);
    if (window.TMATableViewToggle) window.TMATableViewToggle.sync('users');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function normalize(value) {
    return String(value || '').toLowerCase().trim();
  }

  function dateWeight(label) {
    return DATE_WEIGHT[normalize(label)] != null ? DATE_WEIGHT[normalize(label)] : 99;
  }

  function rowKey(row, state) {
    var idx = state.rows.indexOf(row);
    return idx >= 0 ? String(idx) : row.serial;
  }

  function closePopovers(except, keep) {
    var keepSet = keep ? keep.slice() : [];
    if (except) keepSet.push(except);

    document.querySelectorAll('.tma-dash__users-popover[data-open]').forEach(function (el) {
      if (keepSet.indexOf(el) === -1) {
        el.removeAttribute('data-open');
        el.setAttribute('aria-hidden', 'true');
      }
    });

    document.querySelectorAll('[data-users-filter-trigger], [data-users-sort-trigger], [data-users-page-size]').forEach(function (btn) {
      if (!except || btn !== except._trigger) {
        btn.setAttribute('aria-expanded', 'false');
        if (btn.hasAttribute('data-users-filter-trigger')) {
          btn.setAttribute('aria-pressed', 'false');
        }
      }
    });
  }

  function positionPopover(popover, anchorOrRect) {
    var rect = anchorOrRect;
    if (!rect) return;
    if (typeof rect.getBoundingClientRect === 'function') {
      rect = rect.getBoundingClientRect();
    }
    if (!rect.width && !rect.height && rect.top === 0 && rect.left === 0) return;

    var width = popover.offsetWidth || 240;
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    var top = rect.bottom + 4;
    if (top + popover.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popover.offsetHeight - 4);
    }
    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
  }

  function openPopover(popover, anchor, options) {
    options = options || {};
    var anchorRect = options.rect || (anchor ? anchor.getBoundingClientRect() : null);
    var keep = options.keep ? options.keep.slice() : [];

    closePopovers(popover, keep);
    popover.setAttribute('data-open', 'true');
    popover.setAttribute('aria-hidden', 'false');
    popover._trigger = anchor;
    popover._anchorRect = anchorRect;

    if (anchor) {
      anchor.setAttribute('aria-expanded', 'true');
      if (anchor.hasAttribute('data-users-filter-trigger')) {
        anchor.setAttribute('aria-pressed', 'true');
      }
    }

    requestAnimationFrame(function () {
      positionPopover(popover, popover._anchorRect || anchor);
    });
  }

  function renderPageSizePopover(state) {
    var items = PAGE_SIZES.map(function (size) {
      var selected = size === state.pageSize;
      return '<button type="button" class="tma-filter-popover__item" role="option" data-page-size="' + size + '"' +
        (selected ? ' data-selected aria-selected="true"' : ' aria-selected="false"') +
        '><span class="tma-filter-popover__item-label">' + size + '</span></button>';
    }).join('');
    return '<div class="tma-filter-popover tma-filter-popover--compact tma-filter-popover--fixed tma-dash__users-popover" data-users-popover="page-size" role="listbox" aria-label="Rows per page" aria-hidden="true">' + items + '</div>';
  }

  function syncPageSizePopover(popoverEls, state) {
    if (!popoverEls.pageSize) return;
    popoverEls.pageSize.querySelectorAll('[data-page-size]').forEach(function (btn) {
      var size = parseInt(btn.getAttribute('data-page-size'), 10);
      var selected = size === state.pageSize;
      btn.toggleAttribute('data-selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function createPopovers(state) {
    var host = document.createElement('div');
    host.className = 'tma-dash__users-popover-host';
    host.innerHTML =
      renderFieldsPopover() +
      renderOperatorsPopover() +
      renderUsersPopover() +
      renderSortPopover() +
      renderPageSizePopover(state);
    document.body.appendChild(host);

    return {
      fields: host.querySelector('[data-users-popover="fields"]'),
      operators: host.querySelector('[data-users-popover="operators"]'),
users: host.querySelector('[data-users-popover="users"]'),
      sort: host.querySelector('[data-users-popover="sort"]'),
      pageSize: host.querySelector('[data-users-popover="page-size"]'),
      host: host,
    };
  }

  function buildTags(state) {
    var tags = [];
if (state.filters.user) {
      tags.push({ id: 'user', label: 'User: ' + state.filters.user, icon: 'FunnelSimple' });
    }
    if (state.filters.text) {
      tags.push({ id: 'text', label: state.filters.text.fieldLabel + ': ' + state.filters.text.value, icon: 'FunnelSimple' });
    }
    if (state.sort.column) {
      var dir = state.sort.direction === 'asc' ? 'A - Z' : 'Z - A';
      var colLabel = state.sort.column.charAt(0).toUpperCase() + state.sort.column.slice(1);
      tags.push({ id: 'sort', label: colLabel + ' (' + dir + ')', icon: 'ArrowsDown' });
    }
    return tags;
  }

  function applyPipeline(state) {
    var rows = state.rows.slice();

if (state.filters.user) {
      rows = rows.filter(function (row) {
        return normalize(row.user) === normalize(state.filters.user);
      });
    }

    if (state.filters.text) {
      var needle = normalize(state.filters.text.value);
      var field = state.filters.text.field;
      var op = state.filters.text.op;
      rows = rows.filter(function (row) {
        var hay = normalize(row[field] || '');
        if (op === 'starts with') return hay.startsWith(needle);
        if (op === 'ends with') return hay.endsWith(needle);
        if (op === 'is not') return hay !== needle;
        if (op === 'does not contain') return !hay.includes(needle);
        if (op === 'is') return hay === needle;
        return hay.includes(needle);
      });
    }

    if (state.search) {
      var q = normalize(state.search);
      rows = rows.filter(function (row) {
        return [row.serial, row.user, row.email, row.address, row.date]
          .join(' ').toLowerCase().includes(q);
      });
    }

    if (state.sort.column === 'date') {
      rows.sort(function (a, b) {
        var diff = (a._ts != null && b._ts != null)
          ? a._ts - b._ts
          : dateWeight(a.date) - dateWeight(b.date);
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    } else if (state.sort.column === 'user') {
      rows.sort(function (a, b) {
        var diff = normalize(a.user).localeCompare(normalize(b.user));
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    } else if (state.sort.column === 'serial') {
      rows.sort(function (a, b) {
        var diff = normalize(a.serial).localeCompare(normalize(b.serial));
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    } else if (state.sort.column === 'email') {
      rows.sort(function (a, b) {
        var diff = normalize(a.email).localeCompare(normalize(b.email));
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    } else if (state.sort.column === 'address') {
      rows.sort(function (a, b) {
        var diff = normalize(a.address).localeCompare(normalize(b.address));
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    }

    return rows;
  }


  function renderOverviewRow(row, index, checked) {
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    return '<div class="tma-dash__ctr tma-dash__ctr--body tma-dash__ctr--overview' + selected + '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check"><input type="checkbox" class="tma-dash__check" data-users-check' + (checked ? ' checked' : '') + ' aria-label="Select ' + escapeHtml(row.user) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user"><img src="' + escapeHtml(avatarUrl(row.avatar)) + '" alt=""><span class="tma-dash__cc-truncate">' + escapeHtml(row.user) + '</span>' + statusBadge(row) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--email"><span class="tma-dash__cc-truncate">' + escapeHtml(row.email) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--overview-date">' + escapeHtml(row.date) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--actions">' +
        '<button type="button" class="tma-dash__row-more" aria-label="More actions for ' + escapeHtml(row.user) + '" data-users-row-more><img src="' + ICONS.ThreeDots + '" alt="" width="16" height="16"></button>' +
      '</div>' +
    '</div>';
  }

  function renderRow(row, index, checked, infoOpen) {
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    var active = infoOpen ? ' tma-dash__ctr--info-open' : '';
    return '<div class="tma-dash__ctr tma-dash__ctr--body' + selected + active + '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check"><input type="checkbox" class="tma-dash__check" data-users-check' + (checked ? ' checked' : '') + '></div>' +
      '<div class="tma-dash__cc tma-dash__cc--id">' + escapeHtml(row.serial) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--user"><img src="' + escapeHtml(avatarUrl(row.avatar)) + '" alt=""><span class="tma-dash__cc-truncate">' + escapeHtml(row.user) + '</span>' + statusBadge(row) + '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--email"><span class="tma-dash__cc-truncate">' + escapeHtml(row.email) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--address">' +
        '<span class="tma-dash__cc-truncate">' + escapeHtml(row.address) + '</span>' +
      '</div>' +
      '<div class="tma-dash__cc tma-dash__cc--date"><img src="' + ICONS.CalendarBlank + '" alt="">' + escapeHtml(row.date) + '</div>' +
    '</div>';
  }

  function renderAvatarTile(row, index, checked, infoOpen) {
    var selected = checked ? ' tma-dash__uavatar-tile--selected' : '';
    var active = infoOpen ? ' tma-dash__uavatar-tile--info-open' : '';
    var tipId = 'users-avatar-tip-' + index;
    var avatarSrc = escapeHtml(avatarUrl(row.avatar));
    return '<button type="button" class="tma-dash__uavatar-tile' + selected + active + '" data-row-index="' + index + '" aria-label="' + escapeHtml(row.user) + '" aria-pressed="' + (checked ? 'true' : 'false') + '" aria-describedby="' + tipId + '" data-tooltip-trigger data-tooltip-type="avatar" data-tooltip-position="top" data-tooltip-initial-delay="1500" data-tooltip-rehover-delay="500" data-tooltip-rehover-window="30000">' +
      '<img src="' + avatarSrc + '" alt="">' +
      '<div id="' + tipId + '" class="tma-tooltip tma-tooltip--profile tma-tooltip--top tma-tooltip-trigger__tip" role="tooltip" aria-hidden="true" style="--tooltip-font-size:12px;--tooltip-line-height:16px;--tooltip-padding-x:8px;--tooltip-padding-y:4px;--tooltip-radius:12px;">' +
        '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--profile">' +
          '<img class="tma-tooltip__profile-avatar" src="' + avatarSrc + '" alt="" width="24" height="24">' +
          '<span class="tma-tooltip__profile-name">' + escapeHtml(row.user) + '</span>' +
        '</div></div>' +
        '<span class="tma-tooltip__arrow" aria-hidden="true"></span>' +
      '</div>' +
    '</button>';
  }

  var GRID_PAGE_SIZE = 55;

  function getPageSize(state) {
    return state.viewMode === 'grid' ? GRID_PAGE_SIZE : state.pageSize;
  }

  function renderFilterTags(tags) {
    if (!tags.length) {
      return '<div class="tma-dash__filter-bar tma-dash__filter-bar--empty" hidden></div>';
    }
    var html = tags.map(function (tag) {
      var icon = tag.icon === 'Dot' ? ICONS.Dot : (tag.icon === 'ArrowsDown' ? ICONS.ArrowsDown : ICONS.FunnelSimple);
      var iconSize = tag.icon === 'Dot' ? 12 : 16;
      return '<div class="tma-dash__filter-tag" role="listitem" data-tag-id="' + tag.id + '">' +
        '<img src="' + icon + '" width="' + iconSize + '" height="' + iconSize + '" alt="" aria-hidden="true">' +
        '<span>' + escapeHtml(tag.label) + '</span>' +
        '<button type="button" class="tma-dash__filter-tag-remove" aria-label="Remove ' + escapeHtml(tag.label) + '" data-remove-tag="' + tag.id + '">' +
          '<img src="' + ICONS.Close + '" width="6" height="6" alt="">' +
        '</button></div>';
    }).join('');
    return '<div class="tma-dash__filter-bar" role="list">' + html +
      '<button type="button" class="tma-dash__filter-reset" data-reset-filters>Reset</button></div>';
  }

  function selectedCount(state) {
    return Object.keys(state.selected).length;
  }

  function renderBulkToolBtn(action, icon, label) {
    return '<button type="button" class="tma-dash__tool-btn" aria-label="' + escapeHtml(label) + '" data-users-bulk-action="' + action + '">' +
      '<img src="' + icon + '" alt=""></button>';
  }

  function renderToolbar(state) {
    var count = selectedCount(state);
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';

    return '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
        '<div class="tma-dash__toolbar-actions">' +
          '<button type="button" class="tma-dash__tool-btn" aria-label="Add row" data-users-add><img src="' + ICONS.Plus + '" alt=""></button>' +
          '<button type="button" class="tma-dash__tool-btn" aria-label="Filter" data-users-filter-trigger aria-expanded="false" aria-pressed="false"><img src="' + ICONS.FunnelSimple + '" alt=""></button>' +
          '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-users-sort-trigger aria-expanded="false"><img src="' + ICONS.ArrowsDownUp + '" alt=""></button>' +
          '<div class="tma-dash__toolbar-bulk" data-users-bulk' + bulkHidden + '>' +
            '<img class="tma-dash__toolbar-divider" src="' + ICONS.Line + '" alt="" aria-hidden="true">' +
            '<span class="tma-dash__toolbar-selection" data-users-selection-count aria-live="polite">' + selectionLabel + '</span>' +
            renderBulkToolBtn('delete', ICONS.Trash, 'Delete selected users') +
          '</div>' +
        '</div>' +
        renderSearchBar(state) +
      '</div>';
  }

  function updateToolbarSelection(container, state) {
    var count = selectedCount(state);
    var bulk = container.querySelector('[data-users-bulk]');
    var label = container.querySelector('[data-users-selection-count]');
    var toolbar = container.querySelector('.tma-dash__toolbar');
    if (!bulk || !label || !toolbar) return;
    bulk.hidden = count === 0;
    toolbar.classList.toggle('tma-dash__toolbar--selected', count > 0);
    label.textContent = count === 1 ? '1 Selected' : count + ' Selected';
  }

  function renderSearchBar(state) {
    var classes = ['tma-dash__toolbar-search'];
    if (state.searchFocused || state.search) classes.push('tma-dash__toolbar-search--focused');
    if (state.search) classes.push('tma-dash__toolbar-search--has-value');
    if (state.searchLoading) classes.push('tma-dash__toolbar-search--loading');

    var clearBtn = '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-search-clear><img src="' + ICONS.XCircle + '" alt=""></button>';
    var spinner = '<span class="tma-dash__search-spinner"><img src="' + ICONS.Loading16 + '" alt=""></span>';
    var kbd = state.search ? '' : '<kbd class="tma-dash__kbd" data-search-shortcut>/</kbd>';

    return '<div class="' + classes.join(' ') + '" role="search">' +
      '<img src="' + ICONS.Search + '" alt="">' +
      '<input type="search" class="tma-dash__search-input" placeholder="Search" aria-label="Search table" value="' + escapeHtml(state.search) + '" data-users-search autocomplete="off" spellcheck="false">' +
      clearBtn + spinner + kbd +
    '</div>';
  }

  var PAGE_SIZES = [5, 10, 20];

  function renderPagination(state, totalRows) {
    var pageSize = getPageSize(state);
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    var pages = '';
    var maxButtons = Math.min(5, totalPages);
    for (var p = 1; p <= maxButtons; p++) {
      var active = p === state.page;
      pages += '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') + '" aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') + ' data-page="' + p + '"><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';
    var resultsText = totalRows + (totalRows === 1 ? ' result' : ' results');

    return '<div class="tma-pagination-bar tma-pagination-bar--footer" data-users-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
        '<button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page" aria-haspopup="listbox" aria-expanded="false" data-users-page-size' + (state.viewMode === 'grid' ? ' hidden' : '') + '>' +
          '<span class="tma-pagination__label">' + state.pageSize + '</span>' +
          '<img src="' + ICONS.ArrowLineDown + '" class="tma-pagination__icon" width="16" height="16" alt="" aria-hidden="true">' +
        '</button>' +
        '<span class="tma-pagination-bar__results" data-users-results-count>' + resultsText + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' + pages +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '><img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-direction="next"' + nextDisabled + '><img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav>' +
    '</div>';
  }

  function renderOverviewPagination(state, totalRows) {
    var pageSize = getPageSize(state);
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    var pages = '';
    for (var p = 1; p <= 5; p++) {
      var active = p === state.page;
      var disabled = p > totalPages ? ' disabled' : '';
      pages += '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') + '" aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') + ' data-page="' + p + '"' + disabled + '><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';

    return '<div class="tma-pagination-bar tma-pagination-bar--overview" data-users-pagination>' +
      '<nav class="tma-pagination tma-pagination--overview" aria-label="Pagination">' + pages +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '><img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
        '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-direction="next"' + nextDisabled + '><img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>';
  }

  function renderFieldsPopover() {
    var items = FILTER_FIELDS.map(function (field) {
      return '<button type="button" class="tma-filter-popover__item" data-filter-field="' + field.id + '" data-filter-field-label="' + escapeHtml(field.label) + '">' +
        '<img src="' + ICONS[field.icon] + '" alt="" class="tma-filter-popover__item-icon" width="16" height="16">' +
        '<span class="tma-filter-popover__item-label">' + escapeHtml(field.label) + '</span>' +
        '<img src="' + ICONS.ArrowLineRight + '" alt="" class="tma-filter-popover__item-chevron" width="16" height="16" aria-hidden="true">' +
      '</button>';
    }).join('');
    return '<div class="tma-filter-popover tma-filter-popover--fixed tma-dash__users-popover" data-users-popover="fields" aria-hidden="true">' + items + '</div>';
  }

  function renderOperatorsPopover() {
    var ops = ['Is', 'Is not', 'Contains', 'Does not contain', 'Starts with', 'Ends with'];
    var items = ops.map(function (op) {
      return '<button type="button" class="tma-filter-popover__item" data-filter-operator="' + op.toLowerCase() + '"><span class="tma-filter-popover__item-label">' + op + '</span></button>';
    }).join('');
    return '<div class="tma-filter-popover tma-filter-popover--fixed tma-dash__users-popover" data-users-popover="operators" aria-hidden="true">' +
      '<div class="tma-filter-popover__value-input"><input type="text" placeholder="Type a value..." data-operator-value></div>' + items + '</div>';
  }


  function renderUsersPopover() {
    return '<div class="tma-filter-popover tma-filter-popover--fixed tma-dash__users-popover" data-users-popover="users" aria-hidden="true">' +
      '<div class="tma-filter-popover__item" style="opacity:0.5;pointer-events:none">No users</div></div>';
  }

  function renderSortPopover() {
    var sorts = [
      { action: 'date-asc', label: 'Date', meta: 'Oldest first', icon: 'ArrowsUp' },
      { action: 'date-desc', label: 'Date', meta: 'Newest first', icon: 'ArrowsDown' },
      { action: 'email-asc', label: 'Email', meta: 'A - Z', icon: 'ArrowsUp' },
      { action: 'email-desc', label: 'Email', meta: 'Z - A', icon: 'ArrowsDown' },
      { action: 'user-asc', label: 'User', meta: 'A - Z', icon: 'ArrowsUp' },
      { action: 'user-desc', label: 'User', meta: 'Z - A', icon: 'ArrowsDown' },
      { action: 'clear-sort', label: 'Clear sort', meta: '', icon: 'Broom' },
    ];
    var items = sorts.map(function (s) {
      return '<button type="button" class="tma-filter-popover__item" data-sort-action="' + s.action + '">' +
        '<img src="' + ICONS[s.icon] + '" alt="" class="tma-filter-popover__item-icon" width="16" height="16">' +
        '<span class="tma-filter-popover__item-label">' + escapeHtml(s.label) + '</span>' +
        (s.meta ? '<span class="tma-filter-popover__item-meta">' + escapeHtml(s.meta) + '</span>' : '') +
      '</button>';
    }).join('');
    return '<div class="tma-filter-popover tma-filter-popover--fixed tma-dash__users-popover" data-users-popover="sort" aria-hidden="true">' + items + '</div>';
  }

  function mount(container, opts) {
    opts = opts || {};
    var context = opts.context || 'page';
    var isOverview = context === 'overview';
    if (!container) return;
    if (container.hasAttribute('data-users-mounted')) {
      if (mounts[context]) setActiveContext(context);
      return;
    }

    var state = {
      rows: [],
      loadError: false,
      search: '',
      searchFocused: false,
      searchLoading: false,
      filters: {},
      sort: { column: null, direction: null },
      page: 1,
      pageSize: isOverview ? 10 : 5,
      selected: {},
      nextId: 9806,
      activeField: null,
      viewMode: 'list',
      infoPanelIndex: null,
      isOverview: isOverview,
    };

    container.setAttribute('data-users-mounted', '');
    container.setAttribute('data-users-context', context);
    var popoverEls = createPopovers(state);

    function loadRealUsers() {
      usersApi('GET', '/admin/users').then(function (res) {
        if (!res.ok) {
          // Keep empty — never fall back to design-system demo rows in production.
          state.rows = [];
          state.loadError = true;
          state.live = false;
          state.selected = {};
          render();
          return;
        }
        return res.json().then(function (j) {
          if (j.accountTypes) ACCOUNT_TYPES = j.accountTypes;
          if (j.avatarChoices) SYSTEM_AVATARS = j.avatarChoices;
          state.rows = (j.users || []).map(realRow);
          state.loadError = false;
          state.live = true;
          state.selected = {};
          state.page = 1;
          render();
        });
      }).catch(function (err) {
        state.rows = [];
        state.loadError = true;
        state.live = false;
        state.selected = {};
        if (window.console && console.warn) console.warn('Users: failed to load real accounts —', err);
        render();
      });
    }
    state.reloadReal = loadRealUsers;
    loadRealUsers();

    function closeStatusMenu() {
      var open = document.querySelector('[data-users-status-menu]');
      if (open) open.remove();
    }

    function statusAction(url, body) {
      usersApi('POST', url, body).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) { usersToast('Done', true); loadRealUsers(); refreshPendingBadge(); }
          else usersToast((j && j.message) || 'That action failed.', false);
        });
      }).catch(function () { usersToast('That action failed.', false); });
    }

    function openStatusMenu(btn) {
      closeStatusMenu();
      var row = null;
      var id = parseInt(btn.getAttribute('data-user-id'), 10);
      state.rows.forEach(function (r) { if (r._id === id) row = r; });
      if (!row) return;

      var items = '';
      if (row._status === 'pending') {
        items = ACCOUNT_TYPES.map(function (type) {
          return '<button type="button" class="tma-dash__menu-item" role="menuitem" data-ustatus-act="approve" data-ustatus-type="' + type + '">Approve as ' + type + '</button>';
        }).join('');
      } else if (row._status === 'suspended') {
        items = '<button type="button" class="tma-dash__menu-item" role="menuitem" data-ustatus-act="reactivate">Reactivate account</button>';
      } else if (!row._self) {
        items = '<button type="button" class="tma-dash__menu-item" role="menuitem" data-ustatus-act="suspend">Suspend account</button>';
      }
      items += '<button type="button" class="tma-dash__menu-item" role="menuitem" data-ustatus-act="send-reset">Email password reset link</button>' +
        '<button type="button" class="tma-dash__menu-item" role="menuitem" data-ustatus-act="generate-password">Generate temporary password</button>';

      var menu = document.createElement('div');
      menu.className = 'tma-dash__menu';
      menu.setAttribute('data-users-status-menu', '');
      menu.setAttribute('role', 'menu');
      menu.style.position = 'fixed';
      menu.style.zIndex = '90';
      menu.innerHTML = items;
      document.body.appendChild(menu);
      var r2 = btn.getBoundingClientRect();
      menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, r2.bottom + 4) + 'px';
      menu.style.left = Math.min(window.innerWidth - menu.offsetWidth - 8, r2.left) + 'px';

      menu.addEventListener('click', function (ev2) {
        var act = ev2.target.closest('[data-ustatus-act]');
        if (!act) return;
        var kind = act.getAttribute('data-ustatus-act');
        closeStatusMenu();
        if (kind === 'approve') statusAction('/admin/users/' + row._id + '/approve', { account_type: act.getAttribute('data-ustatus-type') });
        if (kind === 'suspend') statusAction('/admin/users/' + row._id + '/suspend');
        if (kind === 'reactivate') statusAction('/admin/users/' + row._id + '/reactivate');
        if (kind === 'send-reset') {
          usersApi('POST', '/admin/users/' + row._id + '/send-reset').then(function (res) {
            usersToast(res.ok ? 'Reset link sent to ' + row.email : 'Could not send the link.', res.ok);
          });
        }
        if (kind === 'generate-password') {
          usersApi('POST', '/admin/users/' + row._id + '/generate-password').then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (j) {
              if (!res.ok || !j.password) { usersToast('Could not generate a password.', false); return; }
              window.prompt('Temporary password for ' + row.user + ' - shown once, share it securely:', j.password);
            });
          });
        }
      });
      window.setTimeout(function () {
        document.addEventListener('click', function once(ev3) {
          if (!menu.contains(ev3.target)) { closeStatusMenu(); document.removeEventListener('click', once); }
        });
      }, 0);
    }

    function toggleSort(col) {
      if (state.sort.column === col) {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.column = col;
        state.sort.direction = 'asc';
      }
      state.page = 1;
      render();
    }

    container.addEventListener('keydown', function (e) {
      var head = e.target.closest('[data-sort-col]');
      if (head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSort(head.getAttribute('data-sort-col')); }
    });

    container.addEventListener('click', function (e) {
      var sortHeadEl = e.target.closest('[data-sort-col]');
      if (sortHeadEl) { toggleSort(sortHeadEl.getAttribute('data-sort-col')); return; }
      var statusBtn = e.target.closest('[data-users-status]');
      if (statusBtn) {
        e.preventDefault();
        e.stopPropagation();
        openStatusMenu(statusBtn);
        return;
      }
      if (state.isOverview) {
        if (e.target.closest('[data-users-row-more]') || e.target.closest('[data-users-check]')) return;
        return;
      }
      if (state.viewMode === 'grid') {
        var tile = e.target.closest('.tma-dash__uavatar-tile');
        if (!tile || !container.contains(tile)) return;
        e.preventDefault();
        openUserInfoPanel(parseInt(tile.getAttribute('data-row-index'), 10));
        return;
      }

      var rowEl = e.target.closest('.tma-dash__ctr--body');
      if (!rowEl || !container.contains(rowEl)) return;
      if (e.target.closest('[data-users-check]')) return;
      openUserInfoPanel(parseInt(rowEl.getAttribute('data-row-index'), 10));
    });

    // Shared delete confirmation. run() must return the fetch promise.
    function openDeleteConfirm(opts) {
      var existing = document.querySelector('[data-users-delete]');
      if (existing) existing.remove();
      var wrap = document.createElement('div');
      wrap.className = 'tma-dash__settings-popup';
      wrap.setAttribute('data-users-delete', '');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', opts.title);
      wrap.innerHTML =
        '<div class="tma-dash__settings-popup-backdrop" aria-hidden="true"></div>' +
        '<div class="tma-dash__settings-change-card tma-users-dialog">' +
        '<h3 class="tma-dash__settings-change-title">' + escapeHtml(opts.title) + '</h3>' +
        '<p class="tma-dash__settings-change-text">' + escapeHtml(opts.text) + '</p>' +
        '<p class="tma-dash__settings-change-text" data-del-error hidden style="color: var(--color-red);"></p>' +
        '<div class="tma-users-delete-actions">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-del-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn tma-users-delete-confirm" data-del-confirm>' + escapeHtml(opts.confirmLabel) + '</button>' +
        '</div></div>';
      document.body.appendChild(wrap);
      function close() { wrap.remove(); }
      function fail(msg) {
        wrap.querySelector('[data-del-confirm]').disabled = false;
        var e = wrap.querySelector('[data-del-error]');
        e.textContent = msg;
        e.hidden = false;
      }
      wrap.querySelector('[data-del-cancel]').addEventListener('click', close);
      wrap.querySelector('.tma-dash__settings-popup-backdrop').addEventListener('click', close);
      document.addEventListener('keydown', function esc(ev) {
        if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
      });
      wrap.querySelector('[data-del-confirm]').addEventListener('click', function () {
        wrap.querySelector('[data-del-confirm]').disabled = true;
        opts.run().then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            if (!res.ok) { fail((j && j.message) || 'Could not delete.'); return; }
            close();
            usersToast(opts.success || 'Deleted', true);
            state.selected = {};
            state.infoPanelIndex = null;
            if (window.TMAUserInfoPanel && window.TMAUserInfoPanel.isOpen()) window.TMAUserInfoPanel.close();
            loadRealUsers();
            refreshPendingBadge();
          });
        }).catch(function () { fail('Could not delete.'); });
      });
      wrap.querySelector('[data-del-cancel]').focus();
    }

    function confirmDeleteUser(row) {
      openDeleteConfirm({
        title: 'Delete ' + row.user + '?',
        text: "This permanently removes their account, sign-in methods, sessions, and connected accounts. This can't be undone.",
        confirmLabel: 'Delete account',
        success: 'Account deleted',
        run: function () { return usersApi('DELETE', '/admin/users/' + row._id); },
      });
    }

    function confirmBulkDelete(ids) {
      openDeleteConfirm({
        title: 'Delete ' + ids.length + (ids.length === 1 ? ' user' : ' users') + '?',
        text: "This permanently removes the selected accounts, their sign-in methods, sessions, and connected accounts. This can't be undone. (Your own account is never deleted.)",
        confirmLabel: 'Delete ' + ids.length + (ids.length === 1 ? ' account' : ' accounts'),
        success: 'Accounts deleted',
        run: function () { return usersApi('POST', '/admin/users/bulk-delete', { ids: ids }); },
      });
    }

    function openUserInfoPanel(filteredIndex) {
      if (!window.TMAUserInfoPanel) return;
      var filtered = applyPipeline(state);
      var row = filtered[filteredIndex];
      if (!row) return;

      state.infoPanelIndex = filteredIndex;

      window.TMAUserInfoPanel.open({
        row: row,
        rows: filtered,
        index: filteredIndex,
        fieldLabels: state.live ? { address: 'Account type' } : null,
        hideDuplicate: !!state.live,
        addressOptions: state.live ? ACCOUNT_TYPES : null,
        avatarChoices: state.live ? SYSTEM_AVATARS : null,
        profileFields: !!state.live,
        nameParts: !!state.live,
        extraTabs: state.live ? [
          { id: 'logins', label: 'Logins', render: function (r2, el) { renderActivityPane(r2, el, 'login'); } },
          { id: 'activity', label: 'Activity', render: function (r2, el) { renderActivityPane(r2, el, 'app'); } },
        ] : null,
        onSave: function (targetRow, index, data) {
          if (state.live) {
            usersApi('PATCH', '/admin/users/' + targetRow._id, {
              first_name: data.firstName,
              middle_name: data.middleName,
              last_name: data.lastName,
              email: data.email,
              account_type: ACCOUNT_TYPES.indexOf(data.address) !== -1 ? data.address : null,
              note: data.note,
              avatar: SYSTEM_AVATARS.indexOf(data.avatar) !== -1 ? data.avatar : null,
              phone: data.phone,
              job_title: data.jobTitle,
              gender: data.gender || null,
              bio: data.bio,
              linkedin_url: data.linkedin,
            }).then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (j) {
                if (!res.ok) {
                  var msg = (j && j.message) || 'Could not save.';
                  if (j && j.errors) { var k = Object.keys(j.errors); if (k.length) msg = j.errors[k[0]][0]; }
                  usersToast(msg, false);
                  return;
                }
                usersToast('Saved', true);
                targetRow.firstName = data.firstName;
                targetRow.middleName = data.middleName;
                targetRow.lastName = data.lastName;
                targetRow.user = [data.firstName, data.middleName, data.lastName]
                  .filter(function (s) { return s; }).join(' ');
                targetRow.email = data.email;
                if (ACCOUNT_TYPES.indexOf(data.address) !== -1) targetRow.address = data.address;
                targetRow.note = data.note;
                targetRow.phone = data.phone;
                targetRow.jobTitle = data.jobTitle;
                targetRow.bio = data.bio;
                targetRow.linkedin = data.linkedin;
                render();
                if (window.TMAUserInfoPanel.isOpen()) {
                  var nf = applyPipeline(state);
                  window.TMAUserInfoPanel.syncRows(nf, index);
                }
                loadRealUsers();
              });
            }).catch(function () { usersToast('Could not save.', false); });
            return;
          }
          targetRow.user = data.user || targetRow.user;
          targetRow.email = data.email || targetRow.email;
          targetRow.address = data.address || targetRow.address;
          targetRow.date = data.date || targetRow.date;
          targetRow.note = data.note || '';
          render();
          if (window.TMAUserInfoPanel.isOpen()) {
            var nextFiltered = applyPipeline(state);
            var nextRow = nextFiltered[index];
            if (nextRow) window.TMAUserInfoPanel.syncRows(nextFiltered, index);
          }
        },
        onDelete: function (targetRow) {
          if (state.live) { confirmDeleteUser(targetRow); return; }
          var idx = state.rows.indexOf(targetRow);
          if (idx >= 0) state.rows.splice(idx, 1);
          state.infoPanelIndex = null;
          window.TMAUserInfoPanel.close();
          render();
        },
        onNavigate: function (targetRow, index) {
          state.infoPanelIndex = index;
          render();
        },
        onClose: function () {
          state.infoPanelIndex = null;
          render();
        },
      });
      render();
    }

    function render() {
      if (!state.rows.length) {
        container.className = 'tma-dash__users tma-dash__users--empty';
        if (window.TMATableViewToggle) window.TMATableViewToggle.sync('users');
        if (window.TMANoData && window.TMANoData.mount) {
          window.TMANoData.mount(container, {
            itemLabel: 'User',
            illustrationName: 'Illustration07',
          });
        } else {
          container.innerHTML = '<p class="tma-dash__cc--empty">No data</p>';
        }
        return;
      }

      container.className = state.isOverview
        ? 'tma-dash__users tma-dash__users--overview'
        : (state.viewMode === 'grid'
          ? 'tma-dash__users tma-dash__users--grid'
          : 'tma-dash__users');

      var filtered = applyPipeline(state);
      var pageSize = getPageSize(state);
      var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (state.page > totalPages) state.page = totalPages;
      var start = (state.page - 1) * pageSize;
      var pageRows = filtered.slice(start, start + pageSize);

      var bodyHtml = '';
      var isGrid = state.viewMode === 'grid';
      if (!pageRows.length) {
        if (isGrid) {
          bodyHtml = '<div class="tma-dash__uavatar-grid-empty">No results</div>';
        } else {
          bodyHtml = '<div class="tma-dash__ctr tma-dash__ctr--empty" role="row"><div class="tma-dash__cc tma-dash__cc--empty">No results</div></div>';
        }
      } else {
        bodyHtml = pageRows.map(function (row, i) {
          var globalIndex = start + i;
          var key = rowKey(row, state);
          var infoOpen = state.infoPanelIndex === globalIndex;
          if (state.isOverview) {
            return renderOverviewRow(row, globalIndex, !!state.selected[key]);
          }
          return isGrid
            ? renderAvatarTile(row, globalIndex, !!state.selected[key], infoOpen)
            : renderRow(row, globalIndex, !!state.selected[key], infoOpen);
        }).join('');
      }

      var tags = buildTags(state);
      var dataBlock;
      if (state.isOverview) {
        dataBlock = '<div class="tma-dash__ctable tma-dash__ctable--overview" role="table" aria-label="Users">' +
            '<div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview">' +
              '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head"><input type="checkbox" class="tma-dash__check" data-users-selectall aria-label="Select all"></div>' +
              '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head">User</div>' +
              '<div class="tma-dash__cc tma-dash__cc--email tma-dash__cc--head">Email</div>' +
              '<div class="tma-dash__cc tma-dash__cc--date tma-dash__cc--head">Registration Date</div>' +
              '<div class="tma-dash__cc tma-dash__cc--actions tma-dash__cc--head" aria-hidden="true"></div>' +
            '</div>' +
            '<div data-users-body>' + bodyHtml + '</div>' +
          '</div>';
      } else if (isGrid) {
        dataBlock = '<div class="tma-dash__uavatar-grid" role="list" aria-label="Users">' + bodyHtml + '</div>';
      } else {
        function sortHead(cls, col, label) {
          var active = state.sort.column === col;
          var arrow = active ? (state.sort.direction === 'asc' ? '↑' : '↓') : '';
          return '<div class="tma-dash__cc ' + cls + ' tma-dash__cc--head tma-dash__cc--sortable' + (active ? ' is-sorted' : '') + '"' +
            ' data-sort-col="' + col + '" role="button" tabindex="0" aria-label="Sort by ' + label + (active ? (state.sort.direction === 'asc' ? ', ascending' : ', descending') : '') + '">' +
            label + (arrow ? '<span class="tma-dash__sort-arrow" aria-hidden="true">' + arrow + '</span>' : '') + '</div>';
        }
        dataBlock = '<div class="tma-dash__ctable" role="table" aria-label="Users">' +
            '<div class="tma-dash__ctr tma-dash__ctr--head">' +
              '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head"><input type="checkbox" class="tma-dash__check" data-users-selectall aria-label="Select all"></div>' +
              sortHead('tma-dash__cc--id', 'serial', 'Serial') +
              sortHead('tma-dash__cc--user', 'user', 'User') +
              sortHead('tma-dash__cc--email', 'email', 'Email') +
              sortHead('tma-dash__cc--address', 'address', 'Account type') +
              sortHead('tma-dash__cc--date', 'date', 'Registration date') +
            '</div>' +
            '<div data-users-body>' + bodyHtml + '</div>' +
          '</div>';
      }

      if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();

      container.innerHTML =
        renderToolbar(state) +
        renderFilterTags(tags) +
        dataBlock +
        (state.isOverview ? renderOverviewPagination(state, filtered.length) : renderPagination(state, filtered.length));

      if (!state.isOverview && window.TMATableViewToggle) window.TMATableViewToggle.sync('users');
      if (state.viewMode === 'grid' && window.PortalTooltip) window.PortalTooltip.init();

      wireTableEvents(filtered, pageRows, start);
      syncPageSizePopover(popoverEls, state);

      if (state.searchFocused) {
        var focusInput = container.querySelector('[data-users-search]');
        if (focusInput) {
          focusInput.focus();
          var len = focusInput.value.length;
          focusInput.setSelectionRange(len, len);
        }
      }
    }

    function wireTableEvents(filtered, pageRows, start) {
      var searchInput = container.querySelector('[data-users-search]');
      var searchTimer = null;

      if (searchInput) {
        searchInput.addEventListener('input', function () {
          state.search = searchInput.value;
          state.searchFocused = true;
          state.searchLoading = true;
          if (window.TMADashSearchChrome) window.TMADashSearchChrome.syncToolbar(container, state);
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () {
            state.searchLoading = false;
            state.page = 1;
            render();
          }, 180);
        });
        searchInput.addEventListener('focus', function () {
          state.searchFocused = true;
          var wrap = container.querySelector('.tma-dash__toolbar-search');
          if (wrap) wrap.classList.add('tma-dash__toolbar-search--focused');
        });
        searchInput.addEventListener('blur', function () {
          state.searchFocused = false;
          var wrap = container.querySelector('.tma-dash__toolbar-search');
          if (wrap) wrap.classList.remove('tma-dash__toolbar-search--focused');
        });
      }

      container.querySelector('[data-search-clear]')?.addEventListener('click', function (e) {
        e.preventDefault();
        clearTimeout(searchTimer);
        state.search = '';
        state.searchFocused = true;
        state.searchLoading = false;
        state.page = 1;
        render();
      });

      container.querySelector('[data-search-shortcut]')?.addEventListener('click', function (e) {
        e.preventDefault();
        state.searchFocused = true;
        render();
      });

      container.querySelector('[data-users-add]')?.addEventListener('click', function () {
        if (state.live) { openInviteDialog(); return; }
        if (window.TMATableAddData && window.TMATableAddData.openAddData) {
          window.TMATableAddData.openAddData({ navId: 'users' });
        }
      });

      var filterBtn = container.querySelector('[data-users-filter-trigger]');
      var sortBtn = container.querySelector('[data-users-sort-trigger]');

      if (filterBtn && popoverEls.fields) {
        filterBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (popoverEls.fields.hasAttribute('data-open')) closePopovers();
          else { markOpenField(null); openPopover(popoverEls.fields, filterBtn); }
        });
      }

      if (sortBtn && popoverEls.sort) {
        sortBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (popoverEls.sort.hasAttribute('data-open')) closePopovers();
          else openPopover(popoverEls.sort, sortBtn);
        });
      }

      container.querySelector('[data-reset-filters]')?.addEventListener('click', function (e) {
        e.preventDefault();
        state.filters = {};
        state.sort = { column: null, direction: null };
        state.page = 1;
        render();
      });

      container.querySelectorAll('[data-remove-tag]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var id = btn.getAttribute('data-remove-tag');
if (id === 'user') delete state.filters.user;
          if (id === 'text') delete state.filters.text;
          if (id === 'sort') state.sort = { column: null, direction: null };
          state.page = 1;
          render();
        });
      });

      var pagination = container.querySelector('[data-users-pagination]');

      pagination?.querySelectorAll('[data-page]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.page = parseInt(btn.getAttribute('data-page'), 10) || 1;
          render();
        });
      });

      pagination?.querySelector('[data-direction="prev"]')?.addEventListener('click', function () {
        if (state.page > 1) { state.page--; render(); }
      });

      pagination?.querySelector('[data-direction="next"]')?.addEventListener('click', function () {
        var totalPages = Math.max(1, Math.ceil(filtered.length / getPageSize(state)));
        if (state.page < totalPages) { state.page++; render(); }
      });

      pagination?.querySelector('[data-users-page-size]')?.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!popoverEls.pageSize) return;
        if (popoverEls.pageSize.hasAttribute('data-open')) {
          closePopovers();
          return;
        }
        openPopover(popoverEls.pageSize, e.currentTarget);
      });

      var selectAll = container.querySelector('[data-users-selectall]');
      var rowChecks = Array.prototype.slice.call(container.querySelectorAll('[data-users-check]'));

      function syncRow(cb, rowIndex) {
        var rowEl = cb.closest('[data-row-index]');
        var row = pageRows[rowIndex - start];
        if (!row) return;
        var key = rowKey(row, state);
        if (cb.checked) state.selected[key] = true;
        else delete state.selected[key];
        if (rowEl) {
          rowEl.classList.toggle('tma-dash__ctr--selected', cb.checked);
        }
        updateToolbarSelection(container, state);
      }

      if (state.viewMode !== 'grid') {
        rowChecks.forEach(function (cb) {
          var rowEl = cb.closest('[data-row-index]');
          var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
          cb.addEventListener('change', function () {
            syncRow(cb, rowIndex);
            syncSelectAll();
          });
        });

        function syncSelectAll() {
          if (!selectAll) return;
          var checked = rowChecks.filter(function (c) { return c.checked; }).length;
          selectAll.checked = checked === rowChecks.length && rowChecks.length > 0;
          selectAll.indeterminate = checked > 0 && checked < rowChecks.length;
        }

        if (selectAll) {
          selectAll.addEventListener('change', function () {
            rowChecks.forEach(function (cb, i) {
              cb.checked = selectAll.checked;
              syncRow(cb, start + i);
            });
            selectAll.indeterminate = false;
          });
          syncSelectAll();
        }
      }

      container.querySelectorAll('[data-users-bulk-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = btn.getAttribute('data-users-bulk-action');
          var keys = Object.keys(state.selected);
          if (!keys.length) return;
          if (action === 'delete') {
            if (state.live) {
              var ids = keys.map(function (key) {
                var row = state.rows.find(function (r) { return rowKey(r, state) === key; });
                return row && row._id;
              }).filter(Boolean);
              if (!ids.length) return;
              confirmBulkDelete(ids);
              return;
            }
            state.rows = state.rows.filter(function (row) {
              return !state.selected[rowKey(row, state)];
            });
            state.selected = {};
            state.page = 1;
            render();
            return;
          }
        });
      });
    }

    function markOpenField(id) {
      if (!popoverEls.fields) return;
      popoverEls.fields.querySelectorAll('[data-filter-field]').forEach(function (b) {
        b.classList.toggle('is-open', b.getAttribute('data-filter-field') === id);
      });
    }

    function fillUsersPopover() {
      if (!popoverEls.users) return;
      var seen = {};
      var items = state.rows.filter(function (r) {
        if (seen[r.user]) return false;
        seen[r.user] = 1;
        return true;
      }).map(function (r) {
        return '<button type="button" class="tma-filter-popover__item" data-filter-user="' + escapeHtml(r.user) + '">' +
          '<span class="tma-filter-popover__user-row"><img src="' + escapeHtml(avatarUrl(r.avatar)) + '" alt="" class="tma-filter-popover__user-avatar" width="24" height="24">' +
          '<span class="tma-filter-popover__item-label">' + escapeHtml(r.user) + '</span></span></button>';
      }).join('');
      popoverEls.users.innerHTML = items ||
        '<div class="tma-filter-popover__item" style="opacity:0.5;pointer-events:none">No users</div>';
    }

    popoverEls.host.addEventListener('click', function (e) {
      var fieldItem = e.target.closest('[data-filter-field]');
      if (fieldItem && popoverEls.fields && popoverEls.fields.contains(fieldItem)) {
        e.preventDefault();
        var fieldId = fieldItem.getAttribute('data-filter-field');
        var sub = fieldId === 'user' ? popoverEls.users : popoverEls.operators;

        // clicking a field whose submenu is already open collapses it
        if (sub && sub.hasAttribute('data-open') && state.activeField && state.activeField.id === fieldId) {
          closePopovers(popoverEls.fields);
          markOpenField(null);
          return;
        }

        var anchorRect = fieldItem.getBoundingClientRect();
        state.activeField = { id: fieldId, label: fieldItem.getAttribute('data-filter-field-label') };
        markOpenField(fieldId);

        if (fieldId === 'user' && popoverEls.users) {
          fillUsersPopover();
          openPopover(popoverEls.users, fieldItem, { rect: anchorRect, keep: [popoverEls.fields] });
          return;
        }
        if (popoverEls.operators) {
          var input = popoverEls.operators.querySelector('[data-operator-value]');
          if (input) { input.value = ''; }
          openPopover(popoverEls.operators, fieldItem, { rect: anchorRect, keep: [popoverEls.fields] });
          if (input) setTimeout(function () { input.focus(); }, 0);
        }
        return;
      }

      var operatorItem = e.target.closest('[data-filter-operator]');
      if (operatorItem && popoverEls.operators && popoverEls.operators.contains(operatorItem)) {
        e.preventDefault();
        var valueInput = popoverEls.operators.querySelector('[data-operator-value]');
        var value = valueInput ? valueInput.value.trim() : '';
        if (!value || !state.activeField) return;
        var fieldKey = state.activeField.id;
        state.filters.text = {
          field: fieldKey,
          fieldLabel: state.activeField.label,
          op: operatorItem.getAttribute('data-filter-operator'),
          value: value,
        };
        closePopovers();
        state.page = 1;
        render();
        return;
      }


      var userItem = e.target.closest('[data-filter-user]');
      if (userItem && popoverEls.users && popoverEls.users.contains(userItem)) {
        e.preventDefault();
        state.filters.user = userItem.getAttribute('data-filter-user');
        closePopovers();
        state.page = 1;
        render();
        return;
      }

      var sortItem = e.target.closest('[data-sort-action]');
      if (sortItem && popoverEls.sort && popoverEls.sort.contains(sortItem)) {
        e.preventDefault();
        var action = sortItem.getAttribute('data-sort-action');
        if (action === 'clear-sort') {
          state.sort = { column: null, direction: null };
        } else {
          var parts = action.split('-');
          state.sort = { column: parts[0], direction: parts[1] };
        }
        closePopovers();
        state.page = 1;
        render();
        return;
      }

      var pageSizeItem = e.target.closest('[data-page-size]');
      if (pageSizeItem && popoverEls.pageSize && popoverEls.pageSize.contains(pageSizeItem)) {
        e.preventDefault();
        state.pageSize = parseInt(pageSizeItem.getAttribute('data-page-size'), 10) || state.pageSize;
        closePopovers();
        state.page = 1;
        render();
        return;
      }
    });

    document.addEventListener('click', function (e) {
      if (!container.isConnected) return;
      if (e.target.closest('.tma-dash__users-popover') ||
          e.target.closest('[data-users-filter-trigger]') ||
          e.target.closest('[data-users-sort-trigger]') ||
          e.target.closest('[data-users-page-size]') ||
          e.target.closest('[data-filter-field]') ||
          e.target.closest('[data-filter-operator]') ||
e.target.closest('[data-filter-user]') ||
          e.target.closest('[data-sort-action]') ||
          e.target.closest('[data-page-size]')) return;
      closePopovers();
    });

    window.addEventListener('resize', function () {
      document.querySelectorAll('.tma-dash__users-popover[data-open]').forEach(function (popover) {
        positionPopover(popover, popover._anchorRect || popover._trigger);
      });
    });

    mounts[context] = { container: container, state: state, render: render, context: context };
    setActiveContext(context);
    render();
  }

  function focusSearch(dashRoot) {
    dashRoot = dashRoot || document.querySelector('.tma-dash');
    if (!dashRoot) return false;

    var overviewPanel = dashRoot.querySelector('.tma-dash__overview-users');
    var overviewView = dashRoot.querySelector('.tma-dash__view[data-view="overview"]');
    if (overviewPanel && !overviewPanel.hidden && overviewView && !overviewView.hidden) {
      var overviewInput = overviewPanel.querySelector('[data-users-search]');
      if (overviewInput) {
        overviewInput.focus();
        overviewInput.select();
        return true;
      }
    }

    var usersView = dashRoot.querySelector('.tma-dash__view[data-view="users"]');
    if (!usersView || usersView.hidden) return false;
    var input = usersView.querySelector('[data-users-search]');
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  }

  function isUsersActive(dashRoot) {
    dashRoot = dashRoot || document.querySelector('.tma-dash');
    if (!dashRoot) return false;

    var overviewPanel = dashRoot.querySelector('.tma-dash__overview-users');
    var overviewView = dashRoot.querySelector('.tma-dash__view[data-view="overview"]');
    if (overviewView && !overviewView.hidden && overviewPanel && !overviewPanel.hidden) return true;

    var usersView = dashRoot.querySelector('.tma-dash__view[data-view="users"]');
    return !!(usersView && !usersView.hidden);
  }

  function addRowFromForm(data) {
    var activeMount = getActiveMount();
    if (!activeMount || !activeMount.state) return;
    var state = activeMount.state;
    if (state.live) { openInviteDialog(); return; }
    var name = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'New User';
    state.rows.unshift({
      serial: '#CM' + state.nextId++,
      user: name,
      avatar: 'AvatarAbstract01',
      email: data.email || 'user@example.com',
      address: 'TBD',
      date: data.date || 'Just now',
    });
    state.page = 1;
    if (activeMount.render) activeMount.render();
  }

  function openInviteDialog() {
    var existing = document.querySelector('[data-users-invite]');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.className = 'tma-dash__settings-popup';
    wrap.setAttribute('data-users-invite', '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Invite user');
    wrap.innerHTML =
      '<div class="tma-dash__settings-popup-backdrop" aria-hidden="true"></div>' +
      '<div class="tma-dash__settings-change-card">' +
      '<button type="button" class="tma-dash__settings-change-close tma-dash__settings-change-close--desktop" data-invite-close aria-label="Close">' +
      '<img src="images/icons/phosphor/X.svg" alt="" width="16" height="16"></button>' +
      '<h3 class="tma-dash__settings-change-title">Invite user</h3>' +
      '<form class="tma-dash__settings-change-form" data-invite-form>' +
      '<label class="tma-dash__settings-flow-field"><input class="tma-dash__settings-flow-input" type="text" name="name" placeholder="Full name" autocomplete="off" aria-label="Full name" required></label>' +
      '<label class="tma-dash__settings-flow-field"><input class="tma-dash__settings-flow-input" type="email" name="email" placeholder="Email" autocomplete="off" aria-label="Email" required></label>' +
      '<label class="tma-dash__settings-flow-field"><input class="tma-dash__settings-flow-input" type="tel" name="phone" placeholder="Phone number (optional)" autocomplete="off" aria-label="Phone number"></label>' +
      '<label class="tma-dash__settings-flow-field"><select class="tma-dash__settings-flow-input" name="account_type" aria-label="Account type">' +
      ACCOUNT_TYPES.map(function (type) { return '<option value="' + type + '">' + type + '</option>'; }).join('') +
      '</select></label>' +
      '<p class="tma-dash__settings-change-text" data-invite-error hidden style="color: var(--color-red);"></p>' +
      '<button type="submit" class="tma-dash__settings-submit">Send invite</button>' +
      '<p class="tma-dash__settings-change-text">They get an email link to set their password.</p>' +
      '</form></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.querySelector('[data-invite-close]').addEventListener('click', close);
    wrap.querySelector('.tma-dash__settings-popup-backdrop').addEventListener('click', close);
    wrap.querySelector('[data-invite-form]').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target;
      usersApi('POST', '/admin/users', {
        name: form.querySelector('[name="name"]').value,
        email: form.querySelector('[name="email"]').value,
        phone: form.querySelector('[name="phone"]').value,
        account_type: form.querySelector('[name="account_type"]').value,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) {
            close();
            usersToast('Invite sent', true);
            var m2 = getActiveMount();
            if (m2 && m2.state && m2.state.reloadReal) m2.state.reloadReal();
          } else {
            var e2 = wrap.querySelector('[data-invite-error]');
            var msg = 'Could not send the invite.';
            if (j && j.errors) { var k = Object.keys(j.errors); if (k.length) msg = j.errors[k[0]][0]; }
            else if (j && j.message) msg = j.message;
            e2.textContent = msg;
            e2.hidden = false;
          }
        });
      });
    });
    wrap.querySelector('input[name="name"]').focus();
  }

  window.TMAUsers = {
    mount: mount,
    setActiveContext: setActiveContext,
    focusSearch: focusSearch,
    isUsersActive: isUsersActive,
    addRowFromForm: addRowFromForm,
  };
})();
