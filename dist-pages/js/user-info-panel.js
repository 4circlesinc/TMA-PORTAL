/*
 * TMA - User information side panel (Figma 32546:96148)
 * Global: window.TMAUserInfoPanel
 */
(function () {
  'use strict';

  function icon(key, className, width, height) {
    if (window.TMAUserInfoPanelIcons) {
      return window.TMAUserInfoPanelIcons.svg(key, className || 'tma-user-info-panel__icon', width, height);
    }
    return '';
  }

  var PANEL_MODE_KEY = 'tma.userInfoPanelMode.v2';
  var DOCKED_BP = 1281;

  var session = null;
  var overlayEl = null;
  var panelMode = 'docked';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function formatPanelDate(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/,\s*\d{1,2}:\d{2}\s*(AM|PM)/i.test(text)) return text;
    if (/^feb 2,\s*2026$/i.test(text)) return 'Feb 2, 2026, 8:00 AM';
    return text;
  }

  function loadPanelMode() {
    // The panel always opens docked; the mode toggle was removed by design.
    panelMode = 'docked';
  }

  function canUseDockedMode() {
    return window.innerWidth >= DOCKED_BP;
  }

  function isDockedActive() {
    return panelMode === 'docked' && canUseDockedMode();
  }

  function savePanelMode() {
    try { localStorage.setItem(PANEL_MODE_KEY, panelMode); } catch (e) {}
  }

  function syncBodyScroll() {
    if (!session || !overlayEl || !overlayEl.hasAttribute('data-open')) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = isDockedActive() ? '' : 'hidden';
  }

  function updateModeButton() {
    if (!overlayEl) return;
    var btn = overlayEl.querySelector('[data-user-info-toggle-mode]');
    if (!btn) return;
    var docked = isDockedActive();
    btn.setAttribute('aria-pressed', docked ? 'true' : 'false');
    btn.classList.toggle('tma-user-info-panel__icon-btn--active', docked);
  }

  function applyPanelMode() {
    if (!overlayEl) return;
    var docked = isDockedActive();
    overlayEl.classList.toggle('tma-user-info-overlay--docked', docked);
    var dash = document.querySelector('.tma-dash');
    if (dash) {
      dash.classList.toggle('is-user-info-docked', docked && overlayEl.hasAttribute('data-open'));
    }
    updateModeButton();
    syncBodyScroll();
  }

  function togglePanelMode() {
    panelMode = panelMode === 'overlay' ? 'docked' : 'overlay';
    savePanelMode();
    applyPanelMode();
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'tma-user-info-overlay';
    overlayEl.setAttribute('data-user-info-overlay', '');
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML =
      '<button type="button" class="tma-user-info-overlay__mask" data-user-info-close aria-label="Close user information"></button>' +
      '<aside class="tma-user-info-panel" role="dialog" aria-modal="true" aria-label="User information" data-user-info-panel></aside>';

    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-user-info-close]')) {
        e.preventDefault();
        close();
        return;
      }
      if (e.target.closest('[data-user-info-prev]')) {
        e.preventDefault();
        navigate(-1);
        return;
      }
      if (e.target.closest('[data-user-info-next]')) {
        e.preventDefault();
        navigate(1);
        return;
      }
      if (e.target.closest('[data-user-info-avatar-open]')) {
        e.preventDefault();
        session.avatarOpen = !session.avatarOpen;
        paint();
        return;
      }
      var pick = e.target.closest('[data-user-info-avatar-pick]');
      if (pick) {
        e.preventDefault();
        session.row.avatar = pick.getAttribute('data-user-info-avatar-pick');
        session.avatarOpen = false;
        paint();
        return;
      }
      var tabBtn = e.target.closest('[data-user-info-tab]');
      if (tabBtn) {
        e.preventDefault();
        session.activeTab = tabBtn.getAttribute('data-user-info-tab');
        paint();
        return;
      }
      if (e.target.closest('[data-user-info-save]')) {
        e.preventDefault();
        save();
        return;
      }
      if (e.target.closest('[data-user-info-cancel]')) {
        e.preventDefault();
        close();
        return;
      }
      if (e.target.closest('[data-user-info-delete]')) {
        e.preventDefault();
        if (session && session.onDelete) session.onDelete(session.row, session.index);
        return;
      }
      if (e.target.closest('[data-user-info-duplicate]')) {
        e.preventDefault();
        if (session && session.onDuplicate) session.onDuplicate(session.row, session.index);
        return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!session || !overlayEl.hasAttribute('data-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    window.addEventListener('resize', function () {
      if (!overlayEl || !overlayEl.hasAttribute('data-open')) return;
      applyPanelMode();
    });

    loadPanelMode();

    return overlayEl;
  }

  function readForm(panel) {
    function fieldValue(el) {
      if (!el) return '';
      if ('value' in el) return String(el.value || '').trim();
      return String(el.textContent || '').trim();
    }

    return {
      user: fieldValue(panel.querySelector('[data-user-info-field="user"]')),
      firstName: fieldValue(panel.querySelector('[data-user-info-field="firstName"]')),
      middleName: fieldValue(panel.querySelector('[data-user-info-field="middleName"]')),
      lastName: fieldValue(panel.querySelector('[data-user-info-field="lastName"]')),
      email: fieldValue(panel.querySelector('[data-user-info-field="email"]')),
      address: fieldValue(panel.querySelector('[data-user-info-field="address"]')),
      date: fieldValue(panel.querySelector('[data-user-info-field="date"]')) || (session ? session.row.date : ''),
      note: fieldValue(panel.querySelector('[data-user-info-field="note"]')),
      avatar: session ? session.row.avatar : '',
      jobTitle: fieldValue(panel.querySelector('[data-user-info-field="jobTitle"]')),
      gender: fieldValue(panel.querySelector('[data-user-info-field="gender"]')),
      bio: fieldValue(panel.querySelector('[data-user-info-field="bio"]')),
      linkedin: fieldValue(panel.querySelector('[data-user-info-field="linkedin"]')),
      phone: fieldValue(panel.querySelector('[data-user-info-field="phone"]')),
    };
  }

  function renderField(label, fieldId, value, options) {
    options = options || {};
    var muted = options.muted ? ' tma-user-info-panel__field--muted' : '';
    var inputType = options.textarea ? 'textarea' : 'input';
    var extra = '';

    if (options.textarea) {
      return '<div class="tma-user-info-panel__field tma-user-info-panel__note' + muted + '">' +
        '<' + inputType + ' class="tma-user-info-panel__field-input" data-user-info-field="' + fieldId + '" placeholder="' + escapeHtml(label) + '" rows="3">' + escapeHtml(value || '') + '</' + inputType + '>' +
        (options.resizeIcon ? icon('RoundedCorner16', 'tma-user-info-panel__note-resize') : '') +
      '</div>';
    }

    if (options.select) {
      var current = value || '';
      var known = options.select.indexOf(current) !== -1;
      extra = '<select class="tma-user-info-panel__field-input" data-user-info-field="' + fieldId + '">' +
        (known ? '' : '<option value="" selected>' + escapeHtml(current || 'Not assigned') + '</option>') +
        options.select.map(function (opt) {
          return '<option value="' + escapeHtml(opt) + '"' + (opt === current ? ' selected' : '') + '>' + escapeHtml(opt) + '</option>';
        }).join('') +
        '</select>';
      return '<div class="tma-user-info-panel__field' + muted + '">' +
        '<p class="tma-user-info-panel__field-label">' + escapeHtml(label) + '</p>' +
        extra +
      '</div>';
    }

    if (options.readOnly) {
      extra = '<div class="tma-user-info-panel__field-row">' +
        '<span class="tma-user-info-panel__field-value" data-user-info-field="' + fieldId + '">' + escapeHtml(value || '') + '</span>' +
        (options.icon ? icon(options.icon, 'tma-user-info-panel__field-icon') : '') +
      '</div>';
    } else if (options.leadingIcon) {
      extra = '<div class="tma-user-info-panel__field-row">' +
        '<img class="tma-user-info-panel__field-brand" src="images/icons/' +
        (options.leadingIcon.indexOf('/') === -1 ? 'brands/' : '') + escapeHtml(options.leadingIcon) + '.svg" alt="" width="16" height="16" aria-hidden="true">' +
        '<input class="tma-user-info-panel__field-input" data-user-info-field="' + fieldId + '" value="' + escapeHtml(value || '') + '"' +
        (options.placeholder ? ' placeholder="' + escapeHtml(options.placeholder) + '"' : '') + '>' +
      '</div>';
    } else {
      extra = '<input class="tma-user-info-panel__field-input" data-user-info-field="' + fieldId + '" value="' + escapeHtml(value || '') + '"' +
        (options.placeholder ? ' placeholder="' + escapeHtml(options.placeholder) + '"' : '') + '>';
    }

    return '<div class="tma-user-info-panel__field' + muted + '">' +
      '<p class="tma-user-info-panel__field-label">' + escapeHtml(label) + '</p>' +
      extra +
    '</div>';
  }

  function fieldLabels(session) {
    var labels = {
      user: 'Name',
      email: 'Email',
      address: 'Address',
      date: 'Registration date',
      note: 'Note',
    };
    if (session && session.fieldLabels) {
      Object.keys(session.fieldLabels).forEach(function (key) {
        if (session.fieldLabels[key]) labels[key] = session.fieldLabels[key];
      });
    }
    return labels;
  }

  function renderPanel(row, index, rows, session) {
    var labels = fieldLabels(session);
    var entity = (session && session.entityLabel) || 'user';
    var avatarSrc = /^(https?:|data:|\/)/.test(row.avatar || '')
      ? escapeHtml(row.avatar)
      : 'images/avatars/' + escapeHtml(row.avatar) + '.png';
    var canPrev = index > 0;
    var canNext = index < rows.length - 1;

    return '' +
      '<div class="tma-user-info-panel__toolbar tma-user-info-panel__toolbar--top">' +
        '<div class="tma-user-info-panel__toolbar-group">' +
          '<button type="button" class="tma-user-info-panel__icon-btn" data-user-info-prev aria-label="Previous user"' + (canPrev ? '' : ' disabled') + '>' + icon('ArrowLineDown16', 'tma-user-info-panel__icon tma-user-info-panel__icon--up') + '</button>' +
          '<button type="button" class="tma-user-info-panel__icon-btn" data-user-info-next aria-label="Next user"' + (canNext ? '' : ' disabled') + '>' + icon('ArrowLineDown16') + '</button>' +
        '</div>' +
        '<button type="button" class="tma-user-info-panel__icon-btn" data-user-info-close aria-label="Close">' + icon('Close16') + '</button>' +
      '</div>' +
      '<div class="tma-user-info-panel__heading">' +
        '<h2 class="tma-user-info-panel__heading-title">' + escapeHtml(row.user) + '</h2>' +
        '<p class="tma-user-info-panel__heading-id">' + escapeHtml(row.serial) + '</p>' +
      '</div>' +
      (session && session.extraTabs && session.extraTabs.length
        ? '<div class="tma-rup__tabs" role="tablist">' +
          '<button type="button" class="tma-dash__tab' + (session.activeTab === 'details' ? ' tma-dash__tab--active' : '') + '" data-user-info-tab="details" role="tab" aria-selected="' + (session.activeTab === 'details') + '">Details</button>' +
          session.extraTabs.map(function (tab) {
            return '<button type="button" class="tma-dash__tab' + (session.activeTab === tab.id ? ' tma-dash__tab--active' : '') + '" data-user-info-tab="' + escapeHtml(tab.id) + '" role="tab" aria-selected="' + (session.activeTab === tab.id) + '">' + escapeHtml(tab.label) + '</button>';
          }).join('') +
          '</div>'
        : '') +
      '<div class="tma-user-info-panel__pane" data-user-info-pane="details"' + (!session || !session.activeTab || session.activeTab === 'details' ? '' : ' hidden') + '>' +
      (session && session.avatarChoices && session.avatarChoices.length
        ? '<div class="tma-user-info-panel__avatar-wrap">' +
          '<button type="button" class="tma-user-info-panel__avatar-btn" data-user-info-avatar-open aria-label="Change profile picture" title="Change profile picture">' +
          '<img class="tma-user-info-panel__avatar" src="' + avatarSrc + '" alt="">' +
          '<span class="tma-user-info-panel__avatar-edit">Change</span>' +
          '</button>' +
          '<div class="tma-user-info-panel__avatar-grid" data-user-info-avatar-grid' + (session.avatarOpen ? '' : ' hidden') + '>' +
          '<p class="tma-user-info-panel__field-label">System profile pictures</p>' +
          '<div class="tma-user-info-panel__avatar-grid-inner">' +
          session.avatarChoices.map(function (name) {
            var on = row.avatar === name;
            return '<button type="button" class="tma-user-info-panel__avatar-choice' + (on ? ' is-selected' : '') + '"' +
              ' data-user-info-avatar-pick="' + escapeHtml(name) + '" aria-pressed="' + on + '" title="' + escapeHtml(name) + '">' +
              '<img src="images/avatars/' + escapeHtml(name) + '.png" alt="' + escapeHtml(name) + '">' +
              '</button>';
          }).join('') +
          '</div>' +
          '<p class="tma-user-info-panel__field-label">Save to apply. A Google or Microsoft photo replaces this on their next sign-in.</p>' +
          '</div></div>'
        : '<img class="tma-user-info-panel__avatar" src="' + avatarSrc + '" alt="">') +
      (session && session.nameParts
        ? renderField('First name', 'firstName', row.firstName || '') +
          renderField('Middle name', 'middleName', row.middleName || '') +
          renderField('Last name', 'lastName', row.lastName || '')
        : renderField(labels.user, 'user', row.user)) +
      renderField(labels.email, 'email', row.email, session && session.readOnlyEmail ? { readOnly: true, muted: true } : null) +
      renderField(labels.address, 'address', row.address, session && session.addressOptions ? { select: session.addressOptions } : null) +
      renderField(labels.date, 'date', formatPanelDate(row.date), { readOnly: true, muted: true, icon: 'CalendarBlank16' }) +
      (session && session.profileFields
        ? renderField('Phone', 'phone', row.phone || '', { leadingIcon: 'phosphor/DeviceMobile', placeholder: '+1 555 123 4567' }) +
          renderField('Role', 'jobTitle', row.jobTitle || '') +
          renderField('Gender', 'gender', row.gender || '', { select: ['Female', 'Male', 'Non-binary', 'Prefer not to say'] }) +
          renderField('About', 'bio', row.bio || '', { textarea: true }) +
          renderField('LinkedIn', 'linkedin', row.linkedin || '', { leadingIcon: 'LinkedIn16', placeholder: 'linkedin.com/in/name' })
        : '') +
      renderField(labels.note, 'note', row.note || '', { textarea: true, resizeIcon: true }) +
      '</div>' +
      (session && session.extraTabs
        ? session.extraTabs.map(function (tab) {
            return '<div class="tma-user-info-panel__pane" data-user-info-pane="' + escapeHtml(tab.id) + '"' + (session.activeTab === tab.id ? '' : ' hidden') + '></div>';
          }).join('')
        : '') +
      '<div class="tma-user-info-panel__toolbar tma-user-info-panel__toolbar--bottom">' +
        '<div class="tma-user-info-panel__toolbar-group">' +
          '<button type="button" class="tma-user-info-panel__icon-btn" data-user-info-delete aria-label="Delete ' + escapeHtml(entity) + '">' + icon('Trash16') + '</button>' +
          (session && session.hideDuplicate ? '' : '<button type="button" class="tma-user-info-panel__icon-btn" data-user-info-duplicate aria-label="Duplicate ' + escapeHtml(entity) + '">' + icon('Copy16') + '</button>') +
        '</div>' +
        '<div class="tma-user-info-panel__actions">' +
          '<button type="button" class="tma-user-info-panel__text-btn" data-user-info-cancel>Cancel</button>' +
          '<button type="button" class="tma-user-info-panel__text-btn tma-user-info-panel__text-btn--save" data-user-info-save>Save</button>' +
        '</div>' +
      '</div>';
  }

  function paint() {
    if (!session) return;
    var panel = overlayEl.querySelector('[data-user-info-panel]');
    panel.innerHTML = renderPanel(session.row, session.index, session.rows, session);
    panel.setAttribute('aria-label', session.panelLabel || 'User information');
    panel.querySelector('.tma-user-info-panel__heading-title').textContent = session.row.user;
    panel.querySelector('.tma-user-info-panel__heading-id').textContent = session.row.serial;
    updateModeButton();

    if (session.extraTabs && session.activeTab && session.activeTab !== 'details') {
      session.extraTabs.forEach(function (tab) {
        if (tab.id !== session.activeTab || typeof tab.render !== 'function') return;
        var pane = panel.querySelector('[data-user-info-pane="' + tab.id + '"]');
        if (pane) tab.render(session.row, pane);
      });
    }
  }

  function navigate(delta) {
    if (!session) return;
    var nextIndex = session.index + delta;
    if (nextIndex < 0 || nextIndex >= session.rows.length) return;
    session.index = nextIndex;
    session.row = session.rows[nextIndex];
    if (session.onNavigate) session.onNavigate(session.row, session.index);
    paint();
  }

  function save() {
    if (!session) return;
    var panel = overlayEl.querySelector('[data-user-info-panel]');
    var data = readForm(panel);
    if (session.onSave) session.onSave(session.row, session.index, data);
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.removeAttribute('data-open');
    overlayEl.setAttribute('aria-hidden', 'true');
    var dash = document.querySelector('.tma-dash');
    if (dash) dash.classList.remove('is-user-info-docked');
    if (session && session.onClose) session.onClose();
    session = null;
    document.body.style.overflow = '';
  }

  function open(options) {
    if (!options || !options.row || !options.rows) return;

    ensureOverlay();
    session = {
      row: options.row,
      rows: options.rows,
      index: options.index || 0,
      fieldLabels: options.fieldLabels || null,
      readOnlyEmail: !!options.readOnlyEmail,
      extraTabs: options.extraTabs || null,
      addressOptions: options.addressOptions || null,
      avatarChoices: options.avatarChoices || null,
      profileFields: !!options.profileFields,
      nameParts: !!options.nameParts,
      avatarOpen: false,
      activeTab: 'details',
      entityLabel: options.entityLabel || 'user',
      panelLabel: options.panelLabel || 'User information',
      onSave: options.onSave,
      onDelete: options.onDelete,
      onDuplicate: options.onDuplicate,
      hideDuplicate: !!options.hideDuplicate,
      onNavigate: options.onNavigate,
      onClose: options.onClose,
    };

    paint();
    overlayEl.setAttribute('data-open', '');
    overlayEl.setAttribute('aria-hidden', 'false');
    applyPanelMode();

    var firstInput = overlayEl.querySelector('[data-user-info-field="user"]');
    if (firstInput) firstInput.focus();
  }

  function isOpen() {
    return !!(overlayEl && overlayEl.hasAttribute('data-open'));
  }

  function getActiveRow() {
    return session ? session.row : null;
  }

  function syncRows(rows, index) {
    if (!session) return;
    session.rows = rows;
    if (typeof index === 'number') {
      session.index = index;
      session.row = rows[index] || session.row;
    }
    paint();
  }

  function refresh() {
    paint();
  }

  window.TMAUserInfoPanel = {
    open: open,
    close: close,
    isOpen: isOpen,
    getActiveRow: getActiveRow,
    refresh: refresh,
    syncRows: syncRows,
  };
})();
