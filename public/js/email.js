/*
 * TMA - Email page ( /email )
 * Global: window.TMAEmail
 */
(function () {
  'use strict';

  /*
   * Keyed DOM reconciliation (js/dom-morph.js). The inbox list is the reason
   * this matters most here: rebuilding it threw away every sender photo and
   * attachment thumbnail whenever a single row was read, starred or labelled.
   * Rows key on data-email-row, so only the row that changed is rewritten.
   *
   * Wiring goes through MORPH.unwired / unwiredOne / on because nodes now
   * survive a render — plain addEventListener in a render path would stack a
   * handler per render.
   */
  var MORPH = window.TMAMorph || {
    patch: function (root, html) { root.innerHTML = html; },
    unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
    unwiredOne: function (root, sel) { return root.querySelector(sel); },
    on: function (el, type, fn) { if (el) el.addEventListener(type, fn); },
  };

  var AVATAR = 'images/avatars/';
  var ICON = 'images/icons/phosphor/';
  var BRAND = 'images/icons/brands/';

  var ICONS = {
    PencilSimpleLine: ICON + 'PencilSimpleLine.svg',
    Tray: ICON + 'Tray.svg',
    PaperPlaneRight: ICON + 'PaperPlaneRight.svg',
    FileText: ICON + 'FileText.svg',
    WarningOctagon: ICON + 'WarningOctagon.svg',
    Trash: ICON + 'Trash.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
    Check: ICON + 'Check.svg',
    Archive: ICON + 'Archive.svg',
    SquaresFour: ICON + 'SquaresFour.svg',
    FunnelSimple: ICON + 'FunnelSimple.svg',
    ArrowBendUpLeft: ICON + 'ArrowBendUpLeft.svg',
    ArrowBendUpRight: ICON + 'ArrowBendUpRight.svg',
    ArrowBendDoubleUpLeft: ICON + 'ArrowBendDoubleUpLeft.svg',
    ArrowsClockwise: ICON + 'ArrowsClockwise.svg',
    DotsThree: ICON + 'DotsThree.svg',
    Prohibit: ICON + 'Prohibit.svg',
    Star: ICON + 'Star.svg',
    ArrowUUpLeft: ICON + 'ArrowUUpLeft.svg',
    ArrowUUpRight: ICON + 'ArrowUUpRight.svg',
    TextT: ICON + 'TextT.svg',
    TextAa: ICON + 'TextAa.svg',
    TextB: ICON + 'TextB.svg',
    TextItalic: ICON + 'TextItalic.svg',
    TextUnderline: ICON + 'TextUnderline.svg',
    TextStrikethrough: ICON + 'TextStrikethrough.svg',
    ListBullets: ICON + 'ListBullets.svg',
    Link: ICON + 'Link.svg',
    ArrowsOutSimple: ICON + 'ArrowsOutSimple.svg',
    CornersIn: ICON + 'CornersIn.svg',
    Minus: ICON + 'Minus.svg',
    X: ICON + 'X.svg',
    Paperclip: ICON + 'Paperclip.svg',
    Image: ICON + 'Image.svg',
    CaretDown: ICON + 'CaretDown.svg',
    CaretUp: ICON + 'CaretUp.svg',
    ArrowLineUpDown: 'images/icons/tma/ArrowLineUpDown.svg',
    EnvelopeSimpleOpen: ICON + 'EnvelopeSimpleOpen.svg',
    FolderSimple: ICON + 'FolderSimple.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    Clock: ICON + 'Clock.svg',
    Tag: ICON + 'Tag.svg',
    // A proper flag, not a price-tag shape — TagChevron's notched silhouette
    // read as "two icons overlapping" at toolbar size, and a tag was never
    // the right shape for "mark as important" to begin with.
    Important: ICON + 'Flag.svg',
    ArrowLineRight: ICON + 'ArrowLineRight.svg',
    ArrowLineLeft: ICON + 'ArrowLineLeft.svg',
    ArrowLineDown: ICON + 'ArrowLineDown.svg',
    Eye: ICON + 'Eye.svg',
    PaperclipHorizontal: ICON + 'PaperclipHorizontal.svg',
    SpeakerSlash: ICON + 'SpeakerSlash.svg',
    ChatCircleDots: ICON + 'ChatCircleDots.svg',
    ArrowsHorizontal: ICON + 'ArrowsHorizontal.svg',
    Flag: ICON + 'Flag.svg',
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    XCircle: 'images/icons/tma/Xcircle.svg',
    Loading16: 'images/icons/tma/Loading-16.svg',
    Plus: ICON + 'Plus.svg',
    SidebarSimple: ICON + 'SidebarSimple.svg',
    List: ICON + 'List.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    CaretRight: ICON + 'CaretRight.svg',
    Smiley: ICON + 'Smiley.svg',
  };

  var LAYOUT_STORE_KEY = 'tma.email.layoutStyle';
  var SPLIT_RATIO_STORE_KEY = 'tma.email.splitListRatio';
  var SPLIT_RATIO_MIN = 0.22;
  var SPLIT_RATIO_MAX = 0.78;
  var SPLIT_RATIO_DEFAULT = 0.5;

  function clampSplitRatio(ratio) {
    return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
  }

  function loadSplitListRatio() {
    try {
      var saved = parseFloat(localStorage.getItem(SPLIT_RATIO_STORE_KEY));
      if (!isNaN(saved)) return clampSplitRatio(saved);
    } catch (e) { /* ignore */ }
    return SPLIT_RATIO_DEFAULT;
  }

  function saveSplitListRatio(ratio) {
    try {
      localStorage.setItem(SPLIT_RATIO_STORE_KEY, String(ratio));
    } catch (e) { /* ignore */ }
  }

  var MAIL_PER_PAGE_KEY = 'tma.mail.perPage.v1';

  function loadMailPerPage() {
    try {
      var saved = parseInt(localStorage.getItem(MAIL_PER_PAGE_KEY), 10);
      if ([25, 50, 100, 200].indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return 50;
  }

  function saveMailPerPage(n) {
    try { localStorage.setItem(MAIL_PER_PAGE_KEY, String(n)); } catch (e) { /* ignore */ }
  }

  function loadLayoutStyle() {
    try {
      var saved = localStorage.getItem(LAYOUT_STORE_KEY);
      if (saved === 'single' || saved === 'split') return saved;
    } catch (e) { /* ignore */ }
    return 'split';
  }

  function saveLayoutStyle(style) {
    try {
      localStorage.setItem(LAYOUT_STORE_KEY, style);
    } catch (e) { /* ignore */ }
  }

  var EMAIL_MOBILE_MQ = '(max-width: 1024px)';

  function isEmailMobile() {
    return window.matchMedia(EMAIL_MOBILE_MQ).matches;
  }

  function isSingleReading(state) {
    if (isEmailMobile()) {
      if (!state.reading) return false;
      if (state.folder === 'templates') return !!state.selectedTemplateId;
      return !!state.selectedId;
    }
    if (state.layoutStyle !== 'single' || !state.reading) return false;
    if (state.folder === 'templates') return !!state.selectedTemplateId;
    return !!state.selectedId;
  }

  function isEmailBulkActive(state) {
    return isEmailMobile() && !isSingleReading(state) && selectedEmailCount(state) > 0;
  }

  function getFolderLabel(state) {
    if (state.activeLabelId) {
      var label = getEmailLabel(state.activeLabelId, state);
      return label ? label.name : 'Inbox';
    }
    for (var i = 0; i < FOLDERS.length; i++) {
      if (FOLDERS[i].id === state.folder) return FOLDERS[i].label;
    }
    return 'Inbox';
  }

  function renderDetailBack(state, iconOnly) {
    if (!(state.layoutStyle === 'single' || isEmailMobile()) || !state.reading) return '';
    var label = state.folder === 'templates' ? 'Templates' : 'Inbox';
    if (iconOnly) {
      return (
        '<button type="button" class="tma-dash__email-detail-topbar-btn tma-dash__email-detail-back" data-email-back aria-label="Back to ' + esc(label) + '">' +
        '<img src="' + ICONS.CaretLeft + '" alt="">' +
        '</button>'
      );
    }
    return (
      '<button type="button" class="tma-dash__email-detail-back" data-email-back aria-label="Back to ' + esc(label) + '">' +
      '<img src="' + ICONS.CaretLeft + '" alt="">' +
      '<span>' + esc(label) + '</span>' +
      '</button>'
    );
  }

  function getDetailNavState(state) {
    if (state.folder !== 'inbox' || !state.selectedId) return null;
    var rows = filteredInbox(state);
    if (!rows.length) return null;
    var index = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === state.selectedId) {
        index = i;
        break;
      }
    }
    if (index === -1) return null;
    return {
      index: index,
      total: rows.length,
      prevId: index > 0 ? rows[index - 1].id : null,
      nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    };
  }

  function renderDetailNavBtn(dir, label, enabled) {
    var cls = 'tma-dash__email-detail-nav-btn';
    if (!enabled) cls += ' tma-dash__email-detail-nav-btn--disabled';
    var attrs = ' data-email-nav="' + dir + '"';
    if (!enabled) attrs += ' disabled aria-disabled="true"';
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-nav-' + dir,
      label: label,
      className: cls,
      attrs: attrs,
      innerHtml: '<img src="' + ICONS[dir === 'prev' ? 'CaretLeft' : 'CaretRight'] + '" alt="">',
    });
  }

  function renderDetailNav(state) {
    var nav = getDetailNavState(state);
    if (!nav) return '';
    return (
      '<nav class="tma-dash__email-detail-nav" aria-label="Message navigation">' +
      renderDetailNavBtn('prev', 'Previous message', !!nav.prevId) +
      '<span class="tma-dash__email-detail-nav-count">' + (nav.index + 1) + ' of ' + nav.total.toLocaleString() + '</span>' +
      renderDetailNavBtn('next', 'Next message', !!nav.nextId) +
      '</nav>'
    );
  }

  var DETAIL_TOPBAR_ACTIONS = [
    { id: 'archive', icon: 'Archive', label: 'Archive' },
    { id: 'spam', icon: 'WarningOctagon', label: 'Report spam' },
    { id: 'delete', icon: 'Trash', label: 'Delete' },
    { id: 'unread', icon: 'EnvelopeSimple', label: 'Mark as unread' },
    { id: 'more', icon: 'DotsThree', label: 'More' },
  ];

  var DETAIL_MESSAGE_ACTIONS = [
    { id: 'star', icon: 'Star', label: 'Star' },
    { id: 'reply', icon: 'ArrowBendUpLeft', label: 'Reply' },
    { id: 'forward', icon: 'ArrowBendUpRight', label: 'Forward' },
    { id: 'more', icon: 'DotsThree', label: 'More' },
  ];

  var DETAIL_MESSAGE_ACTIONS_MOBILE = [
    { id: 'react', icon: 'Smiley', label: 'Add reaction' },
    { id: 'reply', icon: 'ArrowBendUpLeft', label: 'Reply' },
    { id: 'more', icon: 'DotsThree', label: 'More' },
  ];

  function renderDetailTopbarBtn(action) {
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-topbar-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-detail-topbar-btn',
      attrs: ' data-email-detail-topbar="' + esc(action.id) + '"',
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderDetailMessageActionBtn(action) {
    var attrs = '';
    if (action.id === 'reply') attrs = ' data-email-inline-compose="reply"';
    if (action.id === 'forward') attrs = ' data-email-inline-compose="forward"';
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-action',
      attrs: attrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function syncInlineCompose(state) {
    if (state.inlineCompose && state.inlineCompose.messageId !== state.selectedId) {
      state.inlineCompose = null;
    }
  }

  function getReplySubject(subject) {
    var trimmed = (subject || '').trim();
    if (/^re:/i.test(trimmed)) return trimmed;
    return 'Re: ' + trimmed;
  }

  function getForwardSubject(subject) {
    var trimmed = (subject || '').trim();
    if (/^fwd:/i.test(trimmed)) return trimmed;
    return 'Fwd: ' + trimmed;
  }

  function isSelfAddress(address) {
    var email = typeof address === 'string' ? address : address && address.email;
    return !!email && email.toLowerCase() === (PROFILE.email || '').toLowerCase();
  }

  /* {name, email}[] -> "Name <a@b.com>, c@d.com" for an editable address field. */
  function formatAddressList(list) {
    if (!Array.isArray(list)) return '';
    return list
      .map(function (address) {
        if (!address) return '';
        if (typeof address === 'string') return address;
        if (!address.email) return '';
        return address.name ? address.name + ' <' + address.email + '>' : address.email;
      })
      .filter(Boolean)
      .join(', ');
  }

  function rowSenderEmail(row) {
    return row.email || (row.sender.toLowerCase().replace(/\s+/g, '') + '@example.com');
  }

  function renderInlineComposeAvatar() {
    return (
      '<span class="tma-dash__email-message-avatar">' +
      '<img src="' + esc(profileAvatarSrc()) + '" alt="">' +
      '</span>'
    );
  }

  function renderReplyQuote(row, metaEmail, metaDate, bodyText) {
    var text = (bodyText || '').trim();
    if (!text) return '';
    return (
      '<div class="tma-dash__email-inline-quote">' +
      '<p class="tma-dash__email-inline-quote-lead">On ' + esc(metaDate) + ', ' + esc(row.sender) +
      ' &lt;' + esc(metaEmail) + '&gt; wrote:</p>' +
      '<blockquote class="tma-dash__email-inline-quote-body">' + esc(text) + '</blockquote>' +
      '</div>'
    );
  }

  function renderForwardQuote(row, metaEmail, metaDate, subject, bodyText) {
    var text = (bodyText || '').trim();
    return (
      '<div class="tma-dash__email-inline-quote tma-dash__email-inline-quote--forward">' +
      '<p class="tma-dash__email-inline-quote-lead">---------- Forwarded message ---------</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>From:</strong> ' + esc(row.sender) + ' &lt;' + esc(metaEmail) + '&gt;</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>Date:</strong> ' + esc(metaDate) + '</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>Subject:</strong> ' + esc(subject) + '</p>' +
      '<p class="tma-dash__email-inline-quote-meta"><strong>To:</strong> ' + esc(PROFILE.email) + '</p>' +
      (text ? '<blockquote class="tma-dash__email-inline-quote-body">' + esc(text) + '</blockquote>' : '') +
      '</div>'
    );
  }

  function renderInlineCompose(state, row, mode, metaEmail, metaDate, subject, bodyText) {
    var isReply = mode === 'reply';
    var isForward = mode === 'forward';
    var isReplyAll = mode === 'reply-all';
    var composeSubject = isForward ? getForwardSubject(subject) : getReplySubject(subject);
    var ic = state.inlineCompose || {};

    var toRow = isReply
      ? '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">To</span>' +
        '<span class="tma-dash__email-inline-compose-value">' + esc(row.sender) + ' &lt;' + esc(metaEmail) + '&gt;</span>' +
        '</div>'
      : '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">To</span>' +
        '<input type="text" class="tma-dash__email-inline-compose-input" data-email-inline-compose-field="to"' +
        ' value="' + esc(ic.to || '') + '" placeholder="Recipients" aria-label="To">' +
        '</div>';

    var ccRow = isReplyAll
      ? '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">Cc</span>' +
        '<input type="text" class="tma-dash__email-inline-compose-input" data-email-inline-compose-field="cc"' +
        ' value="' + esc(ic.cc || '') + '" placeholder="Cc" aria-label="Cc">' +
        '</div>'
      : '';

    var subjectRow = isForward
      ? '<div class="tma-dash__email-inline-compose-row">' +
        '<span class="tma-dash__email-inline-compose-label">Subject</span>' +
        '<span class="tma-dash__email-inline-compose-value">' + esc(composeSubject) + '</span>' +
        '</div>'
      : '';

    return (
      '<div class="tma-dash__email-thread-actions">' +
      '<div class="tma-dash__email-inline-compose" data-email-inline-compose-panel>' +
      '<div class="tma-dash__email-inline-compose-head">' +
      renderInlineComposeAvatar() +
      '<div class="tma-dash__email-inline-compose-fields">' +
      toRow + ccRow + subjectRow +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-editor-wrap">' +
      '<div class="tma-dash__email-inline-compose-editor" contenteditable="true" data-email-inline-compose-editor data-placeholder="Compose your ' + (isForward ? 'message' : 'reply') + '" aria-label="Message body" role="textbox">' + (ic.bodyHtml || '') + '</div>' +
      (isForward
        ? renderForwardQuote(row, metaEmail, metaDate, subject, bodyText)
        : renderReplyQuote(row, metaEmail, metaDate, bodyText)) +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-bar">' +
      renderComposeToolbar() +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-actions">' +
      '<button type="button" class="tma-dash__email-inline-compose-send" data-email-inline-compose-send' + (ic.sending ? ' disabled' : '') + '>' +
      (ic.sending ? 'Sending…' : 'Send') + '</button>' +
      '<button type="button" class="tma-dash__email-inline-compose-discard" data-email-inline-compose-close aria-label="Discard draft">' +
      '<img src="' + ICONS.Trash + '" alt="">' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDetailThreadActions(state, row, metaEmail, metaDate, subject, bodyText) {
    var active = state.inlineCompose && state.inlineCompose.messageId === row.id;
    if (active) {
      return renderInlineCompose(state, row, state.inlineCompose.mode, metaEmail, metaDate, subject, bodyText);
    }
    var mobile = isEmailMobile();
    return (
      '<div class="tma-dash__email-thread-actions' + (mobile ? ' tma-dash__email-thread-actions--mobile' : '') + '">' +
      '<div class="tma-dash__email-thread-btns">' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="reply">' +
      '<img src="' + ICONS.ArrowBendUpLeft + '" alt=""> Reply' +
      '</button>' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="reply-all">' +
      '<img src="' + ICONS.ArrowBendDoubleUpLeft + '" alt=""> Reply all' +
      '</button>' +
      '<button type="button" class="tma-dash__email-thread-btn" data-email-inline-compose="forward">' +
      '<img src="' + ICONS.ArrowBendUpRight + '" alt=""> Forward' +
      '</button>' +
      '</div>' +
      (mobile
        ? '<button type="button" class="tma-dash__email-thread-react" aria-label="Add reaction">' +
          '<img src="' + ICONS.Smiley + '" alt="">' +
          '</button>'
        : '') +
      '</div>'
    );
  }

  function openInlineCompose(state, mode) {
    if (!state.selectedId) return;
    var row = findRow(state, state.selectedId);
    var to = '';
    var cc = '';
    if (row && mode === 'reply-all') {
      var toList = [{ name: row.sender, email: rowSenderEmail(row) }].concat(
        (Array.isArray(row.to) ? row.to : []).filter(function (address) { return !isSelfAddress(address); })
      );
      to = formatAddressList(toList);
      cc = formatAddressList(
        (Array.isArray(row.cc) ? row.cc : []).filter(function (address) { return !isSelfAddress(address); })
      );
    }
    state.inlineCompose = { mode: mode, messageId: state.selectedId, to: to, cc: cc, bodyHtml: '', sending: false };
  }

  function closeInlineCompose(state) {
    state.inlineCompose = null;
  }

  function focusInlineComposeEditor(root) {
    var editor = root.querySelector('[data-email-inline-compose-editor]');
    if (!editor) return;
    editor.focus();
    if (typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined') {
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  /* Field edits and the editor body write straight to state.inlineCompose —
   * no re-render here, same reasoning as wireComposeEvents: repainting the
   * panel while the user is typing would move the caret out from under them. */
  function wireInlineComposeEvents(root, state, render) {
    var panel = root.querySelector('[data-email-inline-compose-panel]');
    if (!panel) return;

    MORPH.unwired(panel, '[data-email-inline-compose-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        if (!state.inlineCompose) return;
        state.inlineCompose[input.getAttribute('data-email-inline-compose-field')] = input.value;
      });
    });

    var editor = panel.querySelector('[data-email-inline-compose-editor]');
    if (editor) {
      MORPH.on(editor, 'input', function () {
        if (!state.inlineCompose) return;
        state.inlineCompose.bodyHtml = editor.innerHTML;
      });
    }

    var sendBtn = panel.querySelector('[data-email-inline-compose-send]');
    if (sendBtn) {
      MORPH.on(sendBtn, 'click', function (event) {
        event.stopPropagation();
        sendInlineCompose(root, state, render);
      });
    }
  }

  function sendInlineCompose(root, state, render) {
    var ic = state.inlineCompose;
    if (!ic || ic.sending) return;

    var row = findRow(state, ic.messageId);
    if (!row) {
      closeInlineCompose(state);
      render();
      return;
    }

    var to = ic.mode === 'reply' ? [{ name: row.sender, email: rowSenderEmail(row) }] : parseAddresses(ic.to);
    if (!to.length) {
      showEmailToast(root, 'Add at least one recipient');
      return;
    }

    var panel = root.querySelector('[data-email-inline-compose-panel]');
    var editor = panel && panel.querySelector('[data-email-inline-compose-editor]');
    var quote = panel && panel.querySelector('.tma-dash__email-inline-quote');
    var bodyHtml = (editor ? editor.innerHTML : ic.bodyHtml || '') + (quote ? quote.outerHTML : '');
    var subject = ic.mode === 'forward' ? getForwardSubject(row.subject) : getReplySubject(row.subject);

    window.clearTimeout(ic._saveTimer);
    ic.sending = true;
    render();

    api().send({
      to: to,
      cc: ic.mode === 'reply-all' ? parseAddresses(ic.cc) : [],
      subject: subject,
      bodyHtml: bodyHtml,
      inReplyTo: ic.messageId,
    }).then(function () {
      closeInlineCompose(state);
      showEmailToast(root, 'Message sent');

      // Sent mail only shows up locally after a sync, so refresh the folder
      // the user is looking at.
      reloadMessages(root, state, render);
    }).catch(function (err) {
      ic.sending = false;
      reportMailError(state, err);
      render();
    });
  }

  function renderEmailHeaderReadingBack(state) {
    if (!(state.layoutStyle === 'single' || isEmailMobile()) || !state.reading) return '';
    var label = state.folder === 'templates' ? 'Templates' : 'Inbox';
    return (
      '<div class="tma-dash__email-header-reading-back">' +
      '<button type="button" class="tma-dash__email-header-reading-back-btn" data-email-back aria-label="Back to ' + esc(label) + '">' +
      '<img src="' + ICONS.CaretLeft + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailHeaderReadingTools(state) {
    var topbarActions = DETAIL_TOPBAR_ACTIONS.filter(function (action) { return action.id !== 'spam'; });
    var actions = topbarActions.map(renderDetailTopbarBtn).join('');
    if (!actions) return '';
    return (
      '<div class="tma-dash__email-header-reading-tools">' +
      '<div class="tma-dash__email-header-reading-tools-group" role="toolbar" aria-label="Message actions">' +
      actions +
      '</div>' +
      '</div>'
    );
  }

  function renderEmailHeaderBulkClose() {
    return (
      '<div class="tma-dash__email-header-bulk-close">' +
      '<button type="button" class="tma-dash__email-header-reading-back-btn" data-email-bulk-clear aria-label="Clear selection">' +
      '<img src="' + ICONS.X + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailHeaderBulkBtn(action, state) {
    var extraAttrs = '';
    if (action.id === 'more') {
      extraAttrs =
        ' data-email-bulk-more-toggle aria-haspopup="menu" aria-expanded="' +
        (state.bulkMoreMenuOpen ? 'true' : 'false') +
        '"';
    }
    return renderEmailIconTooltipBtn({
      tipId: 'email-header-bulk-tip-' + action.id,
      label: action.label,
      className: 'tma-dash__email-detail-topbar-btn tma-dash__email-header-bulk-btn',
      attrs: ' data-email-bulk-action="' + esc(action.id) + '"' + extraAttrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderEmailHeaderBulkTools(state) {
    return (
      '<div class="tma-dash__email-header-bulk-tools">' +
      '<div class="tma-dash__email-header-reading-tools-group" role="toolbar" aria-label="Bulk actions">' +
      BULK_ACTIONS.map(function (action) { return renderEmailHeaderBulkBtn(action, state); }).join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderDetailTopbarActions(state) {
    return renderEmailHeaderReadingBack(state) + renderEmailHeaderReadingTools(state);
  }

  function renderDetailTopbar(state) {
    if (isEmailMobile()) return '';
    var back = renderDetailBack(state, true);
    var nav = renderDetailNav(state);
    var topbarActions = DETAIL_TOPBAR_ACTIONS;
    var actions = topbarActions.map(renderDetailTopbarBtn).join('');
    if (!back && !nav && !actions) return '';
    return (
      '<div class="tma-dash__email-detail-topbar">' +
      '<div class="tma-dash__email-detail-topbar-start">' + back + actions + '</div>' +
      (nav ? '<div class="tma-dash__email-detail-topbar-end">' + nav + '</div>' : '') +
      '</div>'
    );
  }

  function renderEmailTooltipMarkup(tipId, label) {
    return (
      '<div id="' + esc(tipId) + '" class="tma-tooltip tma-tooltip--compact tma-tooltip--bottom tma-tooltip-trigger__tip" role="tooltip" aria-hidden="true" style="--tooltip-font-size:12px;--tooltip-line-height:16px;--tooltip-padding-x:8px;--tooltip-padding-y:4px;--tooltip-radius:12px;">' +
      '<div class="tma-tooltip__surface"><div class="tma-tooltip__content tma-tooltip__content--inline"><span class="tma-tooltip__text">' + esc(label) + '</span></div></div>' +
      '<span class="tma-tooltip__arrow" aria-hidden="true"></span>' +
      '</div>'
    );
  }

  function renderEmailIconTooltipBtn(opts) {
    return (
      '<button type="button" class="' + opts.className + ' tma-tooltip-trigger"' +
      ' aria-label="' + esc(opts.label) + '"' +
      ' aria-describedby="' + esc(opts.tipId) + '"' +
      ' data-tooltip-trigger data-tooltip-type="email-action" data-tooltip-position="bottom"' +
      ' data-tooltip-initial-delay="500" data-tooltip-rehover-delay="0" data-tooltip-rehover-window="30000"' +
      (opts.attrs || '') +
      '>' +
      opts.innerHtml +
      renderEmailTooltipMarkup(opts.tipId, opts.label) +
      '</button>'
    );
  }

  function renderLayoutToggle(state) {
    return (
      '<div class="tma-dash__email-layout-toggle" role="group" aria-label="Inbox layout">' +
      renderEmailIconTooltipBtn({
        tipId: 'email-layout-tip-split',
        label: 'Inbox with preview pane',
        className: 'tma-dash__email-layout-btn' + (state.layoutStyle === 'split' ? ' tma-dash__email-layout-btn--active' : ''),
        attrs:
          ' data-email-layout="split" aria-pressed="' + (state.layoutStyle === 'split' ? 'true' : 'false') + '"',
        innerHtml:
          '<img src="' + ICONS.SidebarSimple + '" alt="">' +
          '<span class="tma-dash__email-layout-btn-label">Split</span>',
      }) +
      renderEmailIconTooltipBtn({
        tipId: 'email-layout-tip-single',
        label: 'Inbox list only',
        className: 'tma-dash__email-layout-btn' + (state.layoutStyle === 'single' ? ' tma-dash__email-layout-btn--active' : ''),
        attrs:
          ' data-email-layout="single" aria-pressed="' + (state.layoutStyle === 'single' ? 'true' : 'false') + '"',
        innerHtml:
          '<img src="' + ICONS.List + '" alt="">' +
          '<span class="tma-dash__email-layout-btn-label">List</span>',
      }) +
      '</div>'
    );
  }

  function renderEmailListFilterBtn(state) {
    var bulkCount = selectedEmailCount(state);
    if (bulkCount > 0) return '';
    return renderEmailIconTooltipBtn({
      tipId: 'email-filter-tip',
      label: 'Filter',
      className: 'tma-dash__email-filter',
      attrs: ' data-email-filter',
      innerHtml: '<img src="' + ICONS.FunnelSimple + '" alt="">',
    });
  }

  function renderEmailListRefreshBtn(state) {
    var cls = 'tma-dash__email-refresh-btn' + (state.refreshing ? ' tma-dash__email-refresh-btn--spinning' : '');
    return renderEmailIconTooltipBtn({
      tipId: 'email-refresh-tip',
      label: 'Refresh',
      className: cls,
      attrs: ' data-email-refresh' + (state.refreshing ? ' aria-busy="true"' : ''),
      innerHtml: '<img src="' + ICONS.ArrowsClockwise + '" alt="">',
    });
  }

  function renderListHeadActions(state, opts) {
    opts = opts || {};
    var bulkCount = selectedEmailCount(state);
    var html =
      '<div class="tma-dash__email-list-head-actions">' +
      (opts.templateCount != null
        ? '<span class="tma-dash__email-template-list-count">' + opts.templateCount + '</span>'
        : '') +
      renderLayoutToggle(state);
    if (opts.showFilter !== false) {
      html += renderEmailListFilterBtn(state);
    }
    html += '</div>';
    return html;
  }

  function renderListMobileHead(state) {
    return (
      '<div class="tma-dash__email-list-mobile-head">' +
      '<span class="tma-dash__email-list-mobile-title">' + esc(getFolderLabel(state)) + '</span>' +
      '<div class="tma-dash__email-list-mobile-actions">' +
      renderEmailListFilterBtn(state) +
      '</div>' +
      '</div>'
    );
  }

  function emailLabels(state) {
    return (state && state.labels) || [];
  }

  function renderLabelTag(tone, sizeCls) {
    var cls = 'tma-dash__email-label-tag tma-dash__email-label-tag--' + esc(tone);
    if (sizeCls) cls += ' ' + sizeCls;
    return '<span class="' + cls + '" aria-hidden="true"></span>';
  }

  function getEmailLabel(labelId, state) {
    var labels = emailLabels(state);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].id === labelId) return labels[i];
    }
    return null;
  }

  function getRowLabelIds(rowId, state) {
    var row = findRow(state, rowId);
    return (row && row.labels) || [];
  }

  function labelMessageCount(labelId, state) {
    return rowsOf(state).filter(function (row) {
      return rowHasLabel(row.id, labelId, state);
    }).length;
  }

  function renderDetailLabelChip(name, tone, opts) {
    opts = opts || {};
    var cls = 'tma-dash__email-detail-label-chip tma-dash__email-detail-label-chip--' + esc(tone);
    var removeBtn = '';
    if (opts.removable && opts.rowId && opts.labelId) {
      removeBtn =
        '<button type="button" class="tma-dash__email-detail-label-remove"' +
        ' data-email-detail-label-remove data-email-row-id="' + esc(opts.rowId) + '"' +
        ' data-email-label-id="' + esc(opts.labelId) + '"' +
        ' aria-label="Remove ' + esc(name) + '">' +
        '<img src="' + ICONS.X + '" alt="">' +
        '</button>';
    }
    return '<span class="' + cls + '"><span class="tma-dash__email-detail-label-chip-text">' + esc(name) + '</span>' + removeBtn + '</span>';
  }

  function getFolderLabelName(folder) {
    for (var i = 0; i < FOLDERS.length; i++) {
      if (FOLDERS[i].id === folder) return FOLDERS[i].label;
    }
    return folder;
  }

  function isDetailChipHidden(state, rowId, chipId) {
    return !!(state.hiddenDetailChips[rowId] && state.hiddenDetailChips[rowId][chipId]);
  }

  function renderInboxRowLabelChips(rowId, state) {
    var ids = getRowLabelIds(rowId, state);
    if (!ids.length) return '';
    return (
      '<span class="tma-dash__email-row-labels">' +
      ids
        .map(function (labelId) {
          var label = getEmailLabel(labelId, state);
          return label ? renderDetailLabelChip(label.name, label.tone) : '';
        })
        .join('') +
      '</span>'
    );
  }

  function renderDetailLabelChipsHtml(row, state) {
    var chips = [];
    var folderName = getFolderLabelName(state.folder);

    if (state.folder !== 'templates' && folderName) {
      chips.push(renderDetailLabelChip(folderName, 'neutral'));
    }

    if (row.email && !isDetailChipHidden(state, row.id, 'address')) {
      chips.push(
        renderDetailLabelChip(row.email, 'yellow', {
          removable: true,
          rowId: row.id,
          labelId: 'address',
        })
      );
    }

    getRowLabelIds(row.id, state).forEach(function (labelId) {
      var label = getEmailLabel(labelId, state);
      if (label) {
        chips.push(
          renderDetailLabelChip(label.name, label.tone, {
            removable: true,
            rowId: row.id,
            labelId: labelId,
          })
        );
      }
    });

    return chips.join('');
  }

  function renderDetailSubjectStar(row, state) {
    var starred = isRowStarred(row, state);
    return renderEmailIconTooltipBtn({
      tipId: 'email-detail-tip-star-' + row.id,
      label: starred ? 'Remove star' : 'Add star',
      className: 'tma-dash__email-detail-star' + (starred ? ' tma-dash__email-detail-star--active' : ''),
      attrs: ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
      innerHtml: '<img src="' + ICONS.Star + '" alt="">',
    });
  }

  function renderDetailSubject(subject, row, state) {
    var important = isRowImportant(row, state);
    var importantLabel = important ? 'Mark as not important' : 'Mark as important';
    var labelsHtml = renderDetailLabelChipsHtml(row, state);
    var mobile = isEmailMobile();
    return (
      '<div class="tma-dash__email-detail-subject">' +
      '<span class="tma-dash__email-detail-subject-text">' + esc(subject) + '</span>' +
      '<span class="tma-dash__email-detail-subject-trailing">' +
      (mobile
        ? (labelsHtml ? '<span class="tma-dash__email-detail-subject-labels">' + labelsHtml + '</span>' : '') +
          renderDetailSubjectStar(row, state)
        : renderEmailIconTooltipBtn({
            tipId: 'email-detail-tip-important',
            label: importantLabel,
            className: 'tma-dash__email-detail-important' + (important ? ' tma-dash__email-detail-important--active' : ''),
            attrs:
              ' data-email-important="' + esc(row.id) + '" aria-pressed="' + (important ? 'true' : 'false') + '"',
            innerHtml: '<img src="' + ICONS.Important + '" alt="">',
          }) +
          (labelsHtml ? '<span class="tma-dash__email-detail-subject-labels">' + labelsHtml + '</span>' : '')) +
      '</span>' +
      '</div>'
    );
  }

  function renderEmailLabelsSection(state) {
    return (
      '<div class="tma-dash__email-labels-section">' +
      '<div class="tma-dash__email-labels-head">' +
      '<span class="tma-dash__email-labels-title">Labels</span>' +
      '<button type="button" class="tma-dash__email-labels-create" data-email-label-create aria-label="Create label">' +
      '<img src="' + ICONS.Plus + '" alt="">' +
      '</button>' +
      '</div>' +
      '<nav class="tma-dash__email-labels" aria-label="Labels">' +
      emailLabels(state).map(function (label) {
        var active = state.activeLabelId === label.id;
        var count = labelMessageCount(label.id, state);
        var cls = 'tma-dash__email-label-item';
        if (active) cls += ' tma-dash__email-label-item--active';
        return (
          '<button type="button" class="' + cls + '" data-email-sidebar-label="' + esc(label.id) + '">' +
          renderLabelTag(label.tone) +
          '<span class="tma-dash__email-label-item-name">' + esc(label.name) + '</span>' +
          (count ? '<span class="tma-dash__email-label-item-count">' + count + '</span>' : '') +
          '</button>'
        );
      }).join('') +
      '</nav>' +
      '</div>'
    );
  }

  var BULK_ACTIONS = [
    { id: 'archive', label: 'Archive', icon: 'Archive' },
    { id: 'spam', label: 'Spam', icon: 'WarningOctagon' },
    { id: 'delete', label: 'Delete', icon: 'Trash' },
    { id: 'read', label: 'Mark as read', icon: 'EnvelopeSimpleOpen' },
    { id: 'move', label: 'Move to', icon: 'FolderSimple' },
    { id: 'more', label: 'More', icon: 'DotsThree' },
  ];

  var BULK_MORE_SECTIONS = [
    {
      items: [
        { id: 'unread', label: 'Mark as unread', icon: 'EnvelopeSimple' },
        { id: 'snooze', label: 'Snooze', icon: 'Clock' },
      ],
    },
    {
      items: [
        { id: 'label', label: 'Label as', icon: 'Tag', submenu: true },
        { id: 'add-star', label: 'Add star', icon: 'Star' },
        { id: 'remove-star', label: 'Remove star', icon: 'Star', filled: true },
        { id: 'important', label: 'Mark as important', icon: 'Flag' },
        { id: 'not-important', label: 'Mark as not important', icon: 'Flag', filled: true },
        { id: 'forward-attachment', label: 'Forward as attachment', icon: 'PaperclipHorizontal' },
        { id: 'filter-like', label: 'Filter messages like these', icon: 'FunnelSimple' },
        { id: 'mute', label: 'Mute', icon: 'SpeakerSlash' },
      ],
    },
    {
      items: [
        { id: 'share-feedback', label: 'Share to help improve TMA', icon: 'ChatCircleDots' },
      ],
    },
    {
      items: [
        { id: 'advanced-toolbar', label: 'Switch to advanced toolbar', icon: 'ArrowsHorizontal' },
      ],
    },
  ];


  /* Folder ids match the server's; counts arrive with the bootstrap payload
   * rather than being baked in here. */
  var FOLDERS = [
    { id: 'compose', label: 'Compose', icon: 'PencilSimpleLine', compose: true },
    { id: 'inbox', label: 'Inbox', icon: 'Tray' },
    { id: 'sent', label: 'Sent', icon: 'PaperPlaneRight' },
    { id: 'draft', label: 'Draft', icon: 'FileText' },
    { id: 'spam', label: 'Spam', icon: 'WarningOctagon' },
    { id: 'trash', label: 'Trash', icon: 'Trash' },
    { id: 'archive', label: 'Archive', icon: 'Archive' },
    { id: 'templates', label: 'Templates', icon: 'SquaresFour', countKey: 'templates' },
  ];

  /* ── message store ───────────────────────────────────────────────
   * Rows come from /portal/mail/messages and live on state.rows. The old
   * hard-coded INBOX array is gone, along with the parallel readIds /
   * starredIds / rowLabels maps that shadowed it — a row now carries its own
   * flags, exactly as the server sent them, so there is one source of truth
   * per message instead of four.
   */

  function rowsOf(state) {
    return (state && state.rows) || [];
  }

  function findRow(state, id) {
    return rowsOf(state).filter(function (row) { return row.id === id; })[0] || null;
  }

  function api() {
    return window.TMAEmailAPI;
  }

  /* Surfaces a failed write. A 409 means the OAuth grant is gone or too
   * narrow, which the sidebar turns into a Reconnect prompt; anything else is
   * a transient failure worth one toast. */
  /* The message worth showing a reader, without leaking a stack or a status. */
  function errorText(err) {
    return (err && err.message) || '';
  }

  function reportMailError(state, err) {
    if (err && err.reconnect) {
      // The grant is dead, but the mail already on screen is still real and
      // still readable. Flag it as a banner instead of replacing the list —
      // one failed body fetch should not throw away a loaded inbox.
      state.reconnectNeeded = true;
      state.mailError = err.message;
      if (!rowsOf(state).length) state.connected = false;
      if (state.render) state.render();
      return;
    }

    if (state.root) showEmailToast(state.root, (err && err.message) || 'Something went wrong');
  }

  /* Loads the current folder. Search and label filtering are parameters
   * rather than post-filters, so results cover the whole mailbox instead of
   * only the page already in memory. */
  function reloadMessages(root, state, render) {
    // Templates are portal-local and have no server listing.
    if (state.folder === 'templates') return;

    // Changing folder, label or search starts a new listing — page 5 of the
    // inbox says nothing about page 5 of Sent.
    var context = [state.folder, state.activeLabelId || '', state.search || ''].join('|');
    if (state._listContext !== context) {
      state._listContext = context;
      state.page = 1;
    }

    var token = ++state.loadToken;
    state.loading = true;
    render();

    api().listMessages({
      folder: state.folder,
      search: state.search,
      label: state.activeLabelId,
      page: state.page,
      perPage: state.perPage,
    }).then(function (data) {
      // A slower earlier request must not overwrite a newer folder's rows.
      if (token !== state.loadToken) return;

      state.rows = (data && data.messages) || [];
      state.hasMore = !!(data && data.hasMore);
      state.total = (data && data.total) || 0;
      state.page = (data && data.page) || 1;
      state.perPage = (data && data.perPage) || state.perPage;
      state.lastPage = (data && data.lastPage) || 1;
      if (data && data.perPageOptions) state.perPageOptions = data.perPageOptions;
      state.loading = false;
      state.loadError = null;

      // Keep the reading pane pointed at something that still exists.
      if (state.selectedId && !findRow(state, state.selectedId)) {
        state.selectedId = state.rows.length ? state.rows[0].id : null;
      }

      render();
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      state.loading = false;
      state.loadError = (err && err.message) || 'Could not load messages';
      state.rows = [];
      reportMailError(state, err);
      render();
    });
  }

  /* How often the page asks the provider whether anything has arrived. A
   * mailbox has to feel live, so this is the fast inbox-only check — see
   * MailSynchronizer::quickCheck — not the full folder walk. */
  var MAIL_POLL_INTERVAL = 5000;

  /* How often the *full* pass runs instead: every folder, plus the reads,
   * moves and deletions a plain inbox listing cannot report. Expensive, so it
   * is measured in polls rather than run on every tick. */
  var MAIL_FULL_SYNC_EVERY = 12; // ≈ 60s

  /* True while the tab has nothing to gain from being polled at all. Note this
   * no longer includes composing: mail must keep *arriving* while the user
   * writes — only the repaint is held back (see mailRepaintShouldWait), which
   * is what would actually disturb them. */
  function mailPollShouldWait(state) {
    return (
      document.hidden ||
      !state.connected ||
      state.folder === 'templates' ||
      // A mailbox that needs reconnecting will answer 409 to every single
      // attempt. Polling it on a five-second timer produced a 409 in the
      // console every five seconds for as long as the page stayed open, and
      // not one of them could have succeeded — reconnecting is the only thing
      // that clears it, and the banner already says so.
      state.reconnectNeeded
    );
  }

  /* True while a re-render would do more harm than good: it would yank the
   * caret out of whatever the user is mid-typing. The sync still runs; the
   * list just paints once they are done. */
  function mailRepaintShouldWait(state) {
    return state.composeDrafts.length > 0 || !!state.inlineCompose;
  }

  /* Cheap enough to run every tick: same ids in the same order, with the
   * same read/starred/label state, is "nothing changed" even if the server
   * handed back fresh objects. */
  function sameMessageList(a, b) {
    a = a || [];
    b = b || [];
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (
        a[i].id !== b[i].id ||
        a[i].unread !== b[i].unread ||
        a[i].starred !== b[i].starred ||
        (a[i].labels || []).join(',') !== (b[i].labels || []).join(',')
      ) {
        return false;
      }
    }
    return true;
  }

  function scheduleMailPoll(root, state, render) {
    window.clearTimeout(state._mailPollTimer);
    state._mailPollTimer = window.setTimeout(function () {
      pollNewMail(root, state, render);
    }, MAIL_POLL_INTERVAL);
  }

  /* Quiet background refresh: pulls the provider's change feed since the
   * last cursor (cheap — see MailSynchronizer::incremental) and repaints
   * only if the list actually changed, so an inbox with nothing new never
   * flickers or steals the user's scroll position. No loading spinner, no
   * error toast — the manual Sync button already covers that. */
  function pollNewMail(root, state, render) {
    if (mailPollShouldWait(state)) {
      scheduleMailPoll(root, state, render);
      return;
    }

    // One poll at a time. Without this a slow provider means each tick starts
    // another sync on top of the last, and the pile-up is what gets the
    // account throttled — at which point new mail stops arriving entirely.
    if (state._mailPollBusy) {
      scheduleMailPoll(root, state, render);
      return;
    }
    state._mailPollBusy = true;

    var token = ++state.loadToken;

    // The cheap inbox check on most ticks; the full folder walk occasionally,
    // since reads, moves and deletions made in Outlook never show up in a
    // plain inbox listing.
    state._mailPollTick = (state._mailPollTick || 0) + 1;
    var full = state._mailPollTick % MAIL_FULL_SYNC_EVERY === 0;

    api().sync({ fast: !full }).then(function () {
      // A sync that goes through means the grant is alive again — resume
      // polling without needing a reload.
      state.reconnectNeeded = false;
    }).catch(function (err) {
      // A dead grant is terminal until the user reconnects, so record it and
      // let mailPollShouldWait stop the timer. Every other failure is
      // transient — fall through to listMessages with whatever is local.
      if (err && err.reconnect) {
        state.reconnectNeeded = true;
        state.mailError = err.message;
      }
    }).then(function () {
      // Repainting mid-compose would move the caret, so the list is left alone
      // until the compose window closes. The sync above still ran, so the mail
      // is already stored — it just paints a moment later.
      if (mailRepaintShouldWait(state)) return null;

      return api().listMessages({
        folder: state.folder,
        search: state.search,
        label: state.activeLabelId,
        page: state.page,
        perPage: state.perPage,
      });
    }).then(function (data) {
      if (!data) return;

      // A folder switch, search, or manual reload started after this poll
      // began owns the screen now — don't stomp on it.
      if (token !== state.loadToken) return;

      var incoming = (data && data.messages) || [];
      if (sameMessageList(state.rows, incoming)) return;

      state.rows = incoming;
      state.hasMore = !!(data && data.hasMore);
      state.total = (data && data.total) || 0;
      state.lastPage = (data && data.lastPage) || 1;
      if (data && data.perPageOptions) state.perPageOptions = data.perPageOptions;

      // Keep the reading pane pointed at something that still exists.
      if (state.selectedId && !findRow(state, state.selectedId)) {
        state.selectedId = state.rows.length ? state.rows[0].id : null;
      }

      render();
    }).catch(function () {
      // Silent — this is a background refresh, not a user action.
    }).then(function () {
      state._mailPollBusy = false;
      scheduleMailPoll(root, state, render);
    });
  }

  /* First load: connection state, folder counts, labels, then the inbox. */
  function bootstrapMailbox(root, state, render) {
    state.loading = true;

    api().bootstrap().then(function (data) {
      state.connected = !!(data && data.connected);
      state.account = (data && data.account) || null;
      state.folderCounts = (data && data.folders) || {};
      state.labels = (data && data.labels) || [];

      if (!state.connected) {
        state.loading = false;
        state.rows = [];
        render();
        return;
      }

      reloadMessages(root, state, render);
    }).catch(function (err) {
      state.loading = false;
      state.connected = false;
      state.loadError = (err && err.message) || 'Could not reach the mailbox';
      reportMailError(state, err);
      render();
    });
  }

  /* Opens a message: loads its whole conversation and marks it read.
   *
   * The reading pane used to fetch just the one message, so a reply arrived
   * with none of the conversation it belonged to — every earlier message was
   * simply absent. This pulls the thread instead; the opened message comes
   * back with its body, the rest carry `bodyLoaded: false` and are fetched by
   * expandThreadMessage() as the reader opens them. */
  function openMailMessage(root, state, render, id) {
    var row = findRow(state, id);
    if (!row) return;

    state.selectedId = id;
    if (row.unread) markRowRead(state, id);

    // A thread already covering this message stays as it is, so re-opening
    // does not throw away which messages the reader had expanded.
    if (threadCoversSelection(state)) {
      render();
      return;
    }

    state.thread = null;
    state.threadError = null;
    state.threadErrorId = null;
    state.bodyLoading = true;
    var token = ++state.threadToken;
    render();

    api().getThread(id).then(function (data) {
      // A slower earlier request must not overwrite a thread the reader has
      // since opened.
      if (token !== state.threadToken) return;

      var messages = (data && data.messages) || [];

      state.thread = {
        rootId: id,
        threadId: data && data.threadId,
        subject: (data && data.subject) || row.subject,
        messages: messages,
        // Newest expanded, everything before it collapsed — the shape both
        // Gmail and Outlook use, so a long thread opens on the message that
        // prompted it rather than on its own history.
        expanded: defaultThreadExpansion(messages, id),
        showQuoted: {},
      };

      // Keep the list row in step with what the thread reported.
      var opened = messages.filter(function (m) { return m.id === id; })[0];
      if (opened) {
        Object.keys(opened).forEach(function (key) { row[key] = opened[key]; });
      }

      state.bodyLoading = false;
      render();
    }).catch(function (err) {
      if (token !== state.threadToken) return;
      state.bodyLoading = false;
      state.threadError = errorText(err) || 'This conversation could not be loaded.';
      state.threadErrorId = id;
      reportMailError(state, err);
      render();
    });
  }

  /* True when the loaded thread actually covers the selected message.
   *
   * Selection moves without going through openMailMessage in several places —
   * a reload whose selected row has vanished, an archive, a folder change — and
   * a thread left over from the previous message would otherwise be rendered
   * against the new one. */
  function threadCoversSelection(state) {
    if (!state.thread || !state.selectedId) return false;

    return state.thread.messages.some(function (m) { return m.id === state.selectedId; });
  }

  /* Loads the conversation for whatever is selected, if it is not already
   * loaded. Called after each render rather than at every place that moves the
   * selection, so no future caller can forget to. */
  function ensureThreadLoaded(root, state, render) {
    if (state.folder === 'templates') return;
    if (!state.selectedId || state.bodyLoading) return;
    // A failure is remembered against the message it happened on, so the
    // error is not retried in a loop — but selecting a different message
    // still gets a fresh attempt.
    if (state.threadError && state.threadErrorId === state.selectedId) return;
    if (threadCoversSelection(state)) return;

    openMailMessage(root, state, render, state.selectedId);
  }

  /* Which messages start open: the one that was clicked, plus the newest, plus
   * anything still unread — a reader should never have to hunt for the message
   * they came in for. */
  function defaultThreadExpansion(messages, openedId) {
    var expanded = {};
    if (!messages.length) return expanded;

    expanded[openedId] = true;
    expanded[messages[messages.length - 1].id] = true;

    messages.forEach(function (m) {
      if (m.unread) expanded[m.id] = true;
    });

    return expanded;
  }

  /* Expand or collapse every message in the conversation at once. Expanding
   * pulls any body that has not been fetched yet, so "Expand all" really does
   * show the whole conversation rather than a column of empty cards. */
  function setThreadExpansion(root, state, render, open) {
    var thread = state.thread;
    if (!thread) return;

    thread.messages.forEach(function (message) {
      thread.expanded[message.id] = open;

      if (!open || message.bodyLoaded || message._loading) return;

      message._loading = true;

      api().getMessage(message.id).then(function (data) {
        var full = data && data.message;
        message._loading = false;
        if (full) {
          Object.keys(full).forEach(function (key) { message[key] = full[key]; });
        }
        render();
      }).catch(function (err) {
        message._loading = false;
        message._error = errorText(err) || 'This message could not be loaded.';
        render();
      });
    });

    render();
  }

  /* Pulls one thread message's body the first time it is expanded. */
  function expandThreadMessage(root, state, render, id) {
    var thread = state.thread;
    if (!thread) return;

    var open = !thread.expanded[id];
    thread.expanded[id] = open;

    var message = thread.messages.filter(function (m) { return m.id === id; })[0];

    if (!open || !message || message.bodyLoaded || message._loading) {
      render();
      return;
    }

    message._loading = true;
    render();

    api().getMessage(id).then(function (data) {
      var full = data && data.message;
      message._loading = false;

      if (full) {
        Object.keys(full).forEach(function (key) { message[key] = full[key]; });
      }

      render();
    }).catch(function (err) {
      message._loading = false;
      message._error = errorText(err) || 'This message could not be loaded.';
      render();
    });
  }

  function isRowUnread(row, state) {
    return !!(row && row.unread);
  }

  /* Read state is optimistic: the row flips immediately and the provider
   * catches up. A failed write is not worth interrupting reading for, so it
   * is logged rather than surfaced — the next sync corrects it. */
  function markRowRead(state, id) {
    setRowRead(state, id, true);
  }

  function markRowUnread(state, id) {
    setRowRead(state, id, false);
  }

  function setRowRead(state, id, read) {
    var row = findRow(state, id);
    if (!row || !!row.unread === !read) return;
    row.unread = !read;
    api().setFlags(id, { read: read }).catch(function (err) {
      row.unread = read;
      reportMailError(state, err);
    });
  }

  function syncEmailRowReadClasses(rowEl, unread) {
    if (!rowEl) return;
    rowEl.classList.toggle('tma-dash__email-row--unread', unread);
    rowEl.classList.toggle('tma-dash__email-row--read', !unread);
  }

  function isRowChecked(row, state) {
    return !!state.checkedIds[row.id];
  }

  function isRowStarred(row, state) {
    return !!(row && row.starred);
  }

  function isRowImportant(row, state) {
    return !!(row && row.important);
  }

  function rowHasLabel(rowId, labelId, state) {
    var row = findRow(state, rowId);
    return !!(row && row.labels && row.labels.indexOf(labelId) !== -1);
  }

  function rowHasAnyLabel(rowId, state) {
    var row = findRow(state, rowId);
    return !!(row && row.labels && row.labels.length);
  }

  function labelPopupTargetIds(state) {
    if (state.labelPopupBulk) return Object.keys(state.checkedIds);
    if (state.labelPopupRowId) return [state.labelPopupRowId];
    return [];
  }

  function isLabelCheckedForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    if (!ids.length) return false;
    return ids.every(function (id) {
      return rowHasLabel(id, labelId, state);
    });
  }

  function isLabelIndeterminateForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    if (ids.length <= 1) return false;
    var count = ids.filter(function (id) {
      return rowHasLabel(id, labelId, state);
    }).length;
    return count > 0 && count < ids.length;
  }

  function toggleLabelForTargets(labelId, state) {
    var ids = labelPopupTargetIds(state);
    // Mixed selections resolve to "apply to all", matching the checkbox's
    // indeterminate-to-checked step.
    var applied = !isLabelCheckedForTargets(labelId, state);

    ids.forEach(function (id) {
      var row = findRow(state, id);
      if (!row) return;
      if (!row.labels) row.labels = [];

      var at = row.labels.indexOf(labelId);
      if (applied && at === -1) row.labels.push(labelId);
      else if (!applied && at !== -1) row.labels.splice(at, 1);

      api().setLabel(id, labelId, applied).catch(function (err) {
        // Put the label back the way it was; the popup re-reads from the row.
        var undo = row.labels.indexOf(labelId);
        if (applied && undo !== -1) row.labels.splice(undo, 1);
        else if (!applied && undo === -1) row.labels.push(labelId);
        reportMailError(state, err);
      });
    });
  }

  function syncLabelMenuChecks(root, state) {
    root.querySelectorAll('[data-email-label-option]').forEach(function (btn) {
      var labelId = btn.getAttribute('data-email-label-option');
      var checkbox = btn.querySelector('input[type="checkbox"]');
      var checked = isLabelCheckedForTargets(labelId, state);
      var indeterminate = isLabelIndeterminateForTargets(labelId, state);
      btn.setAttribute('aria-checked', checked ? 'true' : indeterminate ? 'mixed' : 'false');
      if (checkbox) {
        checkbox.checked = checked;
        checkbox.indeterminate = indeterminate;
      }
    });
  }

  function syncRowLabelButtons(root, state) {
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      var id = btn.getAttribute('data-email-label');
      btn.classList.toggle('tma-dash__email-row-action--active', rowHasAnyLabel(id, state));
    });
  }

  function renderEmailLabelMenu(state) {
    var items = emailLabels(state).map(function (label) {
      var checked = isLabelCheckedForTargets(label.id, state);
      var indeterminate = isLabelIndeterminateForTargets(label.id, state);
      return (
        '<button type="button" class="tma-dash__email-label-option" role="menuitemcheckbox"' +
        ' data-email-label-option="' + esc(label.id) + '"' +
        ' aria-checked="' + (checked ? 'true' : indeterminate ? 'mixed' : 'false') + '">' +
        '<input type="checkbox" class="tma-dash__check tma-dash__email-label-check"' +
        (checked ? ' checked' : '') + ' tabindex="-1" aria-hidden="true">' +
        renderLabelTag(label.tone) +
        '<span class="tma-dash__email-label-name">' + esc(label.name) + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="tma-dash__email-label-menu tma-dash__menu" data-email-label-menu role="menu" aria-label="Labels"' +
      (state.labelPopupOpen ? '' : ' hidden') +
      '>' +
      '<div class="tma-dash__email-label-menu-head">Label as</div>' +
      '<div class="tma-dash__email-label-menu-list">' + items + '</div>' +
      '<div class="tma-dash__email-label-menu-divider" role="separator"></div>' +
      '<button type="button" class="tma-dash__email-label-create" role="menuitem" data-email-label-create>' +
      '<img src="' + ICONS.Plus + '" alt="" aria-hidden="true">' +
      '<span>Create new</span>' +
      '</button>' +
      '</div>'
    );
  }

  function renderEmailRowFrontActions(row, state) {
    var starred = isRowStarred(row, state);
    var important = isRowImportant(row, state);
    var starLabel = starred ? 'Remove star' : 'Add star';
    var importantLabel = important ? 'Mark as not important' : 'Mark as important';
    return (
      '<div class="tma-dash__email-row-front-actions">' +
      renderEmailIconTooltipBtn({
        tipId: 'email-row-tip-star-' + row.id,
        label: starLabel,
        className: 'tma-dash__email-row-action' + (starred ? ' tma-dash__email-row-action--active' : ''),
        attrs:
          ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
        innerHtml: '<img src="' + ICONS.Star + '" alt="">',
      }) +
      renderEmailIconTooltipBtn({
        tipId: 'email-row-tip-important-' + row.id,
        label: importantLabel,
        className: 'tma-dash__email-row-action' + (important ? ' tma-dash__email-row-action--active' : ''),
        attrs:
          ' data-email-important="' + esc(row.id) + '" aria-pressed="' + (important ? 'true' : 'false') + '"',
        innerHtml: '<img src="' + ICONS.Important + '" alt="">',
      }) +
      '</div>'
    );
  }

  function renderEmailRowHoverActions(row, state) {
    var unread = isRowUnread(row, state);
    var actions = [
      { id: 'archive', label: 'Archive', icon: 'Archive' },
      { id: 'delete', label: 'Delete', icon: 'Trash' },
      { id: 'read', label: unread ? 'Mark as read' : 'Mark as unread', icon: unread ? 'EnvelopeSimpleOpen' : 'EnvelopeSimple' },
      { id: 'snooze', label: 'Snooze', icon: 'Clock' },
    ];

    return (
      '<div class="tma-dash__email-row-hover-actions">' +
      actions
        .map(function (action) {
          return renderEmailIconTooltipBtn({
            tipId: 'email-row-tip-' + action.id + '-' + row.id,
            label: action.label,
            className: 'tma-dash__email-row-action',
            attrs:
              ' data-email-row-hover="' + esc(action.id) + '" data-email-row-id="' + esc(row.id) + '"',
            innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
          });
        })
        .join('') +
      '</div>'
    );
  }

  function selectedEmailCount(state) {
    return Object.keys(state.checkedIds).length;
  }

  function renderEmailBulkBtn(action, state) {
    var tipId = 'email-bulk-tip-' + action.id;
    var extraAttrs = '';
    if (action.id === 'more') {
      extraAttrs =
        ' data-email-bulk-more-toggle aria-haspopup="menu" aria-expanded="' +
        (state.bulkMoreMenuOpen ? 'true' : 'false') +
        '"';
    }
    return renderEmailIconTooltipBtn({
      tipId: tipId,
      label: action.label,
      className: 'tma-dash__email-bulk-btn',
      attrs: ' data-email-bulk-action="' + esc(action.id) + '"' + extraAttrs,
      innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
    });
  }

  function renderEmailBulkMoreMenuItem(item) {
    var iconCls = 'tma-dash__email-bulk-more-icon';
    if (item.filled) iconCls += ' tma-dash__email-bulk-more-icon--filled';
    var chevron = item.submenu
      ? '<img class="tma-dash__email-bulk-more-chevron" src="' + ICONS.ArrowLineRight + '" alt="" aria-hidden="true">'
      : '';
    return (
      '<button type="button" class="tma-dash__email-bulk-more-item" role="menuitem" data-email-bulk-more-item="' + esc(item.id) + '">' +
      '<img class="' + iconCls + '" src="' + esc(ICONS[item.icon]) + '" alt="">' +
      '<span class="tma-dash__email-bulk-more-label">' + esc(item.label) + '</span>' +
      chevron +
      '</button>'
    );
  }

  function renderEmailBulkMoreMenu(state) {
    var html = BULK_MORE_SECTIONS.map(function (section, index) {
      var block =
        '<div class="tma-dash__email-bulk-more-section">' +
        section.items.map(renderEmailBulkMoreMenuItem).join('') +
        '</div>';
      if (index < BULK_MORE_SECTIONS.length - 1) {
        block += '<div class="tma-dash__email-bulk-more-divider" role="separator"></div>';
      }
      return block;
    }).join('');

    return (
      '<div class="tma-dash__email-bulk-more-menu tma-dash__menu" data-email-bulk-more-menu role="menu" aria-label="More actions"' +
      (state.bulkMoreMenuOpen ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  function renderEmailListBulk(state) {
    var count = selectedEmailCount(state);
    return (
      '<div class="tma-dash__email-list-bulk" data-email-bulk' + (count === 0 ? ' hidden' : '') + '>' +
      BULK_ACTIONS.map(function (action) { return renderEmailBulkBtn(action, state); }).join('') +
      '</div>'
    );
  }

  function clearEmailSelection(state) {
    state.checkedIds = {};
  }

  function updateEmailListBulk(root, state) {
    var count = selectedEmailCount(state);
    var bulk = root.querySelector('[data-email-bulk]');
    var filter = root.querySelector('[data-email-filter]');
    if (bulk) bulk.hidden = count === 0 || isEmailMobile();
    if (filter) filter.hidden = count > 0;
    if (count === 0) {
      closeEmailBulkMoreMenu(root, state);
      if (state.labelPopupBulk) closeEmailLabelPopup(root, state);
    }
    ensureEmailMobileHeader(root, state);
  }

  function closeEmailBulkMoreMenu(root, state) {
    if (!state.bulkMoreMenuOpen) return;
    state.bulkMoreMenuOpen = false;
    var menu = root.querySelector('[data-email-bulk-more-menu]');
    root.querySelectorAll('[data-email-bulk-more-toggle]').forEach(function (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
    });
    if (menu) menu.hidden = true;
    if (isEmailBulkActive(state)) ensureEmailMobileHeader(root, state);
  }

  function positionEmailProfilePopup(anchor, menu) {
    var rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.top = '-9999px';
    menu.style.left = '-9999px';
    var menuRect = menu.getBoundingClientRect();
    var top = rect.bottom + 8;
    var left = rect.right - menuRect.width;
    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 8);
    }
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function positionEmailPopupMenu(anchor, menu) {
    var rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.top = '-9999px';
    menu.style.left = '-9999px';
    var menuRect = menu.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 4);
    }
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function closeEmailLabelPopup(root, state) {
    if (!state.labelPopupOpen) return;
    state.labelPopupOpen = false;
    state.labelPopupRowId = null;
    state.labelPopupBulk = false;
    var menu = root.querySelector('[data-email-label-menu]');
    if (menu) menu.hidden = true;
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openEmailLabelPopup(root, state, anchor, opts) {
    opts = opts || {};
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailBulkMoreMenu(root, state);
    closeEmailProfileMenu(root, state);
    state.labelPopupOpen = true;
    state.labelPopupRowId = opts.rowId || null;
    state.labelPopupBulk = !!opts.bulk;
    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
    if (anchor && anchor.hasAttribute('data-email-label')) {
      anchor.setAttribute('aria-expanded', 'true');
    }
    var menu = root.querySelector('[data-email-label-menu]');
    if (menu && anchor) {
      positionEmailPopupMenu(anchor, menu);
      syncLabelMenuChecks(root, state);
    }
  }

  function openEmailBulkMoreMenu(root, state, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailProfileMenu(root, state);
    closeEmailLabelPopup(root, state);
    state.bulkMoreMenuOpen = true;
    toggle.setAttribute('aria-expanded', 'true');
    var menu = root.querySelector('[data-email-bulk-more-menu]');
    if (menu) positionEmailPopupMenu(toggle, menu);
  }

  function rowListLines(row) {
    if (row.subject && row.body) {
      return { subject: row.subject, body: row.body };
    }

    var preview = row.preview || row.body || row.subject || '';
    var splitAt = preview.indexOf(' – ');
    if (splitAt !== -1) {
      return {
        subject: preview.slice(0, splitAt),
        body: preview.slice(splitAt + 3),
      };
    }

    return {
      subject: row.subject || preview,
      body: row.body || preview,
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function brandSrc(name) {
    if (name === 'FacebookLogo' || name === 'ThreadsLogo') return ICON + name + '.svg';
    return BRAND + name + '.svg';
  }

  function rowIcon(row) {
    if (!row.brand) return '';
    return '<span class="tma-dash__email-row-icon"><img src="' + esc(brandSrc(row.brand)) + '" alt=""></span>';
  }

  function messageHeadIcon(row) {
    if (row.brand) {
      return '<span class="tma-dash__email-message-avatar tma-dash__email-message-avatar--brand">' + rowIcon(row) + '</span>';
    }
    // A real photo from the sender's portal account; falls back to initials
    // on error so a dead URL never leaves an empty circle.
    if (row.avatarUrl) {
      return (
        '<span class="tma-dash__email-message-avatar">' +
        '<img src="' + esc(row.avatarUrl) + '" alt=""' +
        ' onerror="this.closest(\'.tma-dash__email-message-avatar\').classList.add(\'tma-dash__email-message-avatar--initial\');this.remove();">' +
        '</span>'
      );
    }
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-message-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    return '<span class="tma-dash__email-message-avatar">' +
      '<img src="' + esc(senderInitials(row)) + '" alt="" aria-hidden="true">' +
      '</span>';
  }

  function getMessageRecipient(row) {
    if (row.to) {
      if (typeof row.to === 'string') {
        return { label: row.to, email: row.to, isMe: row.to === PROFILE.email };
      }
      var isMe = row.to.isMe || row.to.email === PROFILE.email;
      return {
        name: row.to.name,
        email: row.to.email,
        isMe: isMe,
        label: isMe ? 'me' : row.to.name || row.to.email || 'me',
      };
    }
    return {
      isMe: true,
      label: 'me',
      name: PROFILE.name,
      email: PROFILE.email,
    };
  }

  function renderMessageHeaderDetails(row, metaEmail, metaDate, subject) {
    var recipient = getMessageRecipient(row);
    var toValue = recipient.isMe ? PROFILE.email : recipient.email || recipient.label;
    return (
      '<div class="tma-dash__email-header-details" data-email-header-details-panel hidden>' +
      '<dl class="tma-dash__email-header-details-list">' +
      '<div class="tma-dash__email-header-details-row">' +
      '<dt>from:</dt>' +
      '<dd><strong>' + esc(row.sender) + '</strong> &lt;' + esc(metaEmail) + '&gt;</dd>' +
      '</div>' +
      '<div class="tma-dash__email-header-details-row">' +
      '<dt>to:</dt><dd>' + esc(toValue) + '</dd>' +
      '</div>' +
      '<div class="tma-dash__email-header-details-row">' +
      '<dt>date:</dt><dd>' + esc(metaDate) + '</dd>' +
      '</div>' +
      '<div class="tma-dash__email-header-details-row">' +
      '<dt>subject:</dt><dd>' + esc(subject) + '</dd>' +
      '</div>' +
      '</dl>' +
      '</div>'
    );
  }

  function renderMessageHead(row, metaEmail, metaDate, subject, headKey, state) {
    headKey = headKey || 'current';
    var mobile = isEmailMobile() && headKey === 'current';
    var recipient = getMessageRecipient(row);
    var messageActions = mobile ? DETAIL_MESSAGE_ACTIONS_MOBILE : DETAIL_MESSAGE_ACTIONS;
    var headCls = 'tma-dash__email-message-head' + (mobile ? ' tma-dash__email-message-head--mobile' : '');
    return (
      '<div class="' + headCls + '">' +
      '<div class="tma-dash__email-message-head-main">' +
      messageHeadIcon(row) +
      '<div class="tma-dash__email-message-head-identity">' +
      '<div class="tma-dash__email-message-head-line">' +
      '<span class="tma-dash__email-message-head-name">' + esc(row.sender) + '</span>' +
      '</div>' +
      '<div class="tma-dash__email-message-head-recipient">' +
      '<button type="button" class="tma-dash__email-message-head-to" data-email-header-details-toggle aria-expanded="false">' +
      '<span class="tma-dash__email-message-head-to-label">to ' + esc(recipient.label) + '</span>' +
      '<span class="tma-dash__email-message-head-to-caret-wrap" aria-hidden="true">' +
      '<img src="' + ICONS.CaretDown + '" alt="" class="tma-dash__email-message-head-to-caret">' +
      '</span>' +
      '</button>' +
      renderMessageHeaderDetails(row, metaEmail, metaDate, subject) +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-message-head-side">' +
      (mobile
        ? '<time class="tma-dash__email-detail-date tma-dash__email-detail-date--inline">' + esc(metaDate) + '</time>'
        : '<time class="tma-dash__email-detail-date">' + esc(metaDate) + '</time>') +
      '<div class="tma-dash__email-detail-actions">' +
      messageActions.map(function (action) {
        var attrs = '';
        if (headKey === 'current') {
          if (action.id === 'reply') attrs = ' data-email-inline-compose="reply"';
          if (action.id === 'forward') attrs = ' data-email-inline-compose="forward"';
          if (action.id === 'star') {
            var starred = isRowStarred(row, state);
            attrs =
              ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"';
          }
        }
        var cls = 'tma-dash__email-action';
        if (action.id === 'star') {
          cls += isRowStarred(row, state) ? ' tma-dash__email-row-action--active' : '';
        }
        return renderEmailIconTooltipBtn({
          tipId: 'email-detail-tip-' + headKey + '-' + action.id,
          label: action.label,
          className: cls,
          attrs: attrs,
          innerHtml: '<img src="' + esc(ICONS[action.icon]) + '" alt="">',
        });
      }).join('') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* The signed-in user, filled in from current-user.js. Starts blank rather
   * than with a stand-in, so a hardcoded name/photo is never briefly shown as
   * if it were real. */
  var PROFILE = {
    name: '',
    email: '',
    avatar: null,
  };

  /* current-user.js owns photo-or-initials resolution, so the mailbox chrome
   * draws exactly what the rest of the shell draws. */
  function profileAvatarSrc() {
    if (window.TMACurrentUser && window.TMACurrentUser.avatarSrc) {
      return window.TMACurrentUser.avatarSrc(PROFILE.avatar, PROFILE.name);
    }
    return PROFILE.avatar || '';
  }

  /* ── mailbox backfill progress ──────────────────────────────────
   * A corner panel while the mailbox history downloads, using the same
   * chrome as the File Library's upload panel so the two read as one thing.
   * Polls the server, hides itself when there is nothing left to pull, and
   * can be dismissed — the download continues on the queue either way.
   */
  var syncPanel = null;
  var syncTimer = null;
  var syncDismissed = false;
  var syncCollapsed = false;

  function stopSyncPolling() {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  }

  function hideSyncPanel() {
    if (syncPanel) { syncPanel.remove(); syncPanel = null; }
  }

  function ensureSyncPanel() {
    if (syncPanel) return syncPanel;
    syncPanel = document.createElement('section');
    syncPanel.className = 'tma-portal-upload tma-mail-sync';
    syncPanel.setAttribute('aria-label', 'Mailbox sync');
    syncPanel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mail-sync-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-mail-sync-action');
      if (action === 'collapse') { syncCollapsed = !syncCollapsed; }
      if (action === 'close') { syncDismissed = true; stopSyncPolling(); hideSyncPanel(); }
    });
    document.body.appendChild(syncPanel);
    return syncPanel;
  }

  function renderSyncPanel(data) {
    var synced = (data && data.synced) || 0;
    var total = data && data.total ? data.total : null;
    var pct = total ? Math.max(0, Math.min(100, Math.round((synced / total) * 100))) : null;
    var finished = !!(data && data.done);

    var title = finished
      ? 'Mailbox up to date'
      : 'Downloading mailbox…';

    var meta = total
      ? synced.toLocaleString() + ' of ' + total.toLocaleString() + ' messages'
      : synced.toLocaleString() + ' messages synced';

    var panel = ensureSyncPanel();
    panel.innerHTML =
      '<header class="tma-portal-upload__head">' +
      '<span class="tma-portal-upload__title">' + esc(title) + '</span>' +
      '<span class="tma-portal-upload__head-actions">' +
      '<button type="button" class="tma-portal-upload__icon tma-mail-sync__icon" data-mail-sync-action="collapse" aria-label="' +
      (syncCollapsed ? 'Expand' : 'Collapse') + '">' +
      '<img src="' + (syncCollapsed ? ICONS.CaretUp : ICONS.CaretDown) + '" alt="" aria-hidden="true"></button>' +
      '<button type="button" class="tma-portal-upload__icon tma-mail-sync__icon" data-mail-sync-action="close" aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt="" aria-hidden="true"></button>' +
      '</span></header>' +
      (syncCollapsed ? '' :
        '<ul class="tma-portal-upload__list">' +
        '<li class="tma-portal-upload__item' + (finished ? ' tma-portal-upload__item--completed' : '') + '">' +
        '<div class="tma-portal-upload__row">' +
        '<span class="tma-portal-upload__name">' + esc(meta) + '</span>' +
        '</div>' +
        // A div, not a span: the bar needs a block box or its height collapses.
        // With no provider total we still show motion, via an indeterminate bar.
        '<div class="tma-portal-upload__bar' + (pct === null && !finished ? ' tma-mail-sync__bar--indeterminate' : '') + '">' +
        '<span class="tma-portal-upload__fill" style="width:' + (finished ? 100 : (pct === null ? 100 : pct)) + '%"></span>' +
        '</div>' +
        '<div class="tma-portal-upload__meta">' +
        '<span>' + (pct === null ? (finished ? 'Complete' : 'Working…') : pct + '%') + '</span>' +
        '<span>' + esc(finished ? 'All folders' : 'Keeps going in the background') + '</span>' +
        '</div>' +
        '</li></ul>');
  }

  function pollSyncStatus() {
    if (syncDismissed) return;

    api().syncStatus().then(function (data) {
      if (syncDismissed) return;

      if (!data || !data.connected) { hideSyncPanel(); return; }

      // Nothing left to download and nothing on screen: stay out of the way.
      if (data.done && !syncPanel) return;

      renderSyncPanel(data);

      if (data.done) {
        // Leave the finished state up briefly, then clear it.
        stopSyncPolling();
        setTimeout(function () { if (!syncDismissed) hideSyncPanel(); }, 6000);
        return;
      }

      syncTimer = setTimeout(pollSyncStatus, 5000);
    }).catch(function () {
      // A failed poll is not worth surfacing; try again later.
      syncTimer = setTimeout(pollSyncStatus, 15000);
    });
  }

  /* End the portal session. Delegates to the shell's shared sign-out handler
   * when it is present, so there is one implementation of the POST + CSRF
   * dance; falls back to doing it here if this view is loaded on its own. */
  function signOut() {
    var shared = document.querySelector('[data-action="sign-out"]');
    if (shared) { shared.click(); return; }

    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    var done = function () { window.location.href = '/auth/login'; };
    fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }).then(done, done);
  }

  var profileBound = false;

  /* Keep PROFILE in step with the signed-in user, and repaint once the real
   * details land (the first render happens before /me resolves). */
  function bindCurrentUser(rerender) {
    if (profileBound || !window.TMACurrentUser || !window.TMACurrentUser.onChange) return;
    profileBound = true;

    window.TMACurrentUser.onChange(function (me) {
      if (!me) return;
      PROFILE.name = me.name || '';
      PROFILE.email = me.email || '';
      PROFILE.avatar = me.avatar || null;
      if (typeof rerender === 'function') rerender();
    });
  }

  function renderEmailProfileCard(variant) {
    var wrapCls = 'tma-dash__email-profile-wrap tma-dash__email-profile-wrap--' + variant;
    var profileCls = 'tma-dash__email-profile tma-dash__email-profile--' + variant;
    return (
      '<div class="' + wrapCls + '">' +
      '<div class="' + profileCls + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="' + esc(PROFILE.name) + ' avatar" width="40" height="40">' +
      '<span class="tma-dash__email-profile-meta">' +
      '<span class="tma-dash__email-profile-name" title="' + esc(PROFILE.name) + '">' + esc(PROFILE.name) + '</span>' +
      '<span class="tma-dash__email-profile-email" title="' + esc(PROFILE.email) + '">' + esc(PROFILE.email) + '</span>' +
      '</span>' +
      '</div>' +
      '</div>'
    );
  }

  function renderEmailHeaderProfileBtn(state) {
    return (
      '<button type="button" class="tma-dash__email-header-profile-btn" data-email-profile-sidebar-toggle' +
      ' aria-label="Open account menu" aria-expanded="' + (state.profileSidebarOpen ? 'true' : 'false') + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="' + esc(PROFILE.name) + '" width="32" height="32">' +
      '</button>'
    );
  }

  function renderEmailProfilePopup(state) {
    if (!isEmailMobile()) return '';
    return (
      '<div class="tma-dash__email-profile-popup-card tma-dash__menu" data-email-profile-popup-card role="menu"' +
      ' aria-label="Account"' + (state.profileSidebarOpen ? '' : ' hidden') + '>' +
      renderEmailProfileCard('popup') +
      '<nav class="tma-dash__email-profile-popup-actions" aria-label="Account actions">' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="settings">Settings</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="sign-out">Sign out</button>' +
      '</nav>' +
      '</div>'
    );
  }

  function closeEmailProfileSidebar(state) {
    state.profileSidebarOpen = false;
  }

  function openEmailProfileSidebar(root, state) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailProfileMenu(root, state);
    state.mobileNavOpen = false;
    state.profileSidebarOpen = true;
  }

  function renderEmailProfile(isOpen, variant) {
    var wrapCls = 'tma-dash__email-profile-wrap';
    var profileCls = 'tma-dash__email-profile';
    var menuCls = 'tma-dash__email-profile-menu tma-dash__menu';
    if (variant === 'topbar') {
      wrapCls += ' tma-dash__email-profile-wrap--topbar';
      profileCls += ' tma-dash__email-profile--topbar';
      menuCls += ' tma-dash__email-profile-menu--topbar';
    }
    if (variant === 'sidebar') {
      wrapCls += ' tma-dash__email-profile-wrap--sidebar';
      profileCls += ' tma-dash__email-profile--sidebar';
      menuCls += ' tma-dash__email-profile-menu--sidebar';
    }
    return (
      '<div class="' + wrapCls + '">' +
      '<button type="button" class="' + profileCls + '"' +
      ' data-email-profile-toggle aria-haspopup="menu"' +
      ' aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="' + esc(PROFILE.name) + ' avatar" width="24" height="24">' +
      '<span class="tma-dash__email-profile-meta">' +
      // The rail is too narrow for a full name and work address, so the value
      // is on the element itself — hovering shows what the ellipsis hides.
      '<span class="tma-dash__email-profile-name" title="' + esc(PROFILE.name) + '">' + esc(PROFILE.name) + '</span>' +
      '<span class="tma-dash__email-profile-email" title="' + esc(PROFILE.email) + '">' + esc(PROFILE.email) + '</span>' +
      '</span>' +
      '<img class="tma-dash__email-profile-caret" src="' + ICONS.CaretDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="' + menuCls + '"' +
      ' data-email-profile-menu role="menu"' + (isOpen ? '' : ' hidden') + '>' +
      '<div class="tma-dash__email-profile-menu-head">' +
      '<img class="tma-dash__email-profile-menu-avatar" src="' +
      esc(profileAvatarSrc()) + '" alt="" width="40" height="40">' +
      '<div class="tma-dash__email-profile-menu-meta">' +
      '<span class="tma-dash__email-profile-menu-name">' + esc(PROFILE.name) + '</span>' +
      '<span class="tma-dash__email-profile-menu-email">' + esc(PROFILE.email) + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-profile-menu-divider" role="separator"></div>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="settings">Settings</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-email-profile-action="sign-out">Sign out</button>' +
      '</div>' +
      '</div>'
    );
  }

  /* The server already applied folder, label, and search when it built
   * state.rows, so there is nothing left to filter here. Kept as a function
   * because every render site calls it. */
  function filteredInbox(state) {
    return rowsOf(state);
  }

  /* Counts come from the server, which sees the whole mailbox — counting
   * loaded rows would only ever report the current page. */
  function getInboxUnreadCount(state) {
    var counts = state && state.folderCounts && state.folderCounts.inbox;
    return counts ? counts.unread : 0;
  }

  function folderCount(folder, state) {
    if (folder.compose) return null;

    // Templates are a portal-local feature with no provider equivalent, so
    // they still count themselves.
    if (folder.countKey === 'templates') {
      return window.TMAEmailTemplates ? window.TMAEmailTemplates.list().length : 0;
    }

    var counts = state.folderCounts && state.folderCounts[folder.id];
    if (!counts) return null;

    // Inbox and Spam badge what is unread; the rest badge what is there,
    // which is how both Gmail and Outlook read.
    if (folder.id === 'inbox' || folder.id === 'spam') {
      return counts.unread || null;
    }

    return counts.total || null;
  }

  function renderEmailSidebar(state) {
    var sidebarCls = 'tma-dash__email-sidebar';
    if (state.mobileNavOpen) sidebarCls += ' tma-dash__email-sidebar--open';
    return (
      '<div class="' + sidebarCls + '">' +
      (isEmailMobile() ? '' : renderEmailProfile(!!state.profileMenuOpen, 'sidebar')) +
      '<div class="tma-dash__email-sidebar-nav">' +
      renderFolders(state) +
      renderEmailLabelsSection(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderSplitResizeHandle(state) {
    if (state.layoutStyle !== 'split') return '';
    return (
      '<div class="tma-dash__email-split-resizer" data-email-split-resizer role="separator"' +
      ' aria-orientation="vertical" aria-label="Resize inbox and message panes" aria-valuemin="22"' +
      ' aria-valuemax="78" aria-valuenow="' + Math.round(state.splitListRatio * 100) + '" tabindex="0"></div>'
    );
  }

  function renderEmailPanel(state) {
    var panelCls = 'tma-dash__email-panel';
    if (isEmailMobile()) {
      panelCls += ' tma-dash__email-panel--mobile';
      if (isSingleReading(state)) panelCls += ' tma-dash__email-panel--mobile-reading';
    } else if (state.layoutStyle === 'single') {
      panelCls += ' tma-dash__email-panel--single';
      if (isSingleReading(state)) panelCls += ' tma-dash__email-panel--reading';
    }
    var panelStyle = '';
    if (!isEmailMobile() && state.layoutStyle === 'split') {
      panelStyle =
        ' style="--email-split-list:' + Math.round((state.splitListRatio || SPLIT_RATIO_DEFAULT) * 1000) / 10 + '%"';
    }
    return (
      '<div class="tma-dash__email-panel-fit">' +
      '<div class="' + panelCls + '"' + panelStyle + '>' +
      renderList(state) +
      renderSplitResizeHandle(state) +
      renderDetail(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderFolders(state) {
    return (
      '<nav class="tma-dash__email-folders" aria-label="Mail folders">' +
      FOLDERS.filter(function (folder) {
        return !(isEmailMobile() && folder.compose);
      }).map(function (folder) {
        var active = !folder.compose && state.folder === folder.id && !state.activeLabelId;
        var cls = 'tma-dash__email-folder';
        if (folder.compose) cls += ' tma-dash__email-folder--compose';
        if (active) cls += ' tma-dash__email-folder--active';
        var count = folderCount(folder, state);
        var countHtml =
          count === null
            ? ''
            : '<span class="tma-dash__email-folder-count">' + count + '</span>';
        return (
          '<button type="button" class="' + cls + '" data-email-folder="' + esc(folder.id) + '">' +
          '<img src="' + esc(ICONS[folder.icon]) + '" alt="">' +
          '<span class="tma-dash__email-folder-label">' + esc(folder.label) + '</span>' +
          countHtml +
          '</button>'
        );
      }).join('') +
      '</nav>'
    );
  }

  function templateThumbClass(template) {
    if (template.thumb === 'invoice') return 'tma-dash__email-template-thumb--invoice';
    if (template.thumb === 'auth') return 'tma-dash__email-template-thumb--auth';
    return 'tma-dash__email-template-thumb--invoice';
  }

  function renderTemplateList(state) {
    var templates = window.TMAEmailTemplates ? window.TMAEmailTemplates.list() : [];
    return (
      '<div class="tma-dash__email-list tma-dash__email-list--templates">' +
      '<div class="tma-dash__email-list-head tma-dash__email-list-head--templates">' +
      '<span class="tma-dash__email-template-list-title">Templates</span>' +
      renderListHeadActions(state, { templateCount: templates.length, showFilter: false }) +
      '</div>' +
      '<div class="tma-dash__email-list-body">' +
      templates
        .map(function (template) {
          var active = state.selectedTemplateId === template.id;
          return (
            '<button type="button" class="tma-dash__email-template-row' + (active ? ' tma-dash__email-template-row--active' : '') + '" data-email-template="' + esc(template.id) + '">' +
            '<span class="tma-dash__email-template-thumb ' + templateThumbClass(template) + '" aria-hidden="true"></span>' +
            '<span class="tma-dash__email-row-text">' +
            '<span class="tma-dash__email-row-sender">' + esc(template.name) + '</span>' +
            '<span class="tma-dash__email-row-preview">' + esc(template.preview) + '</span>' +
            '</span>' +
            '<span class="tma-dash__email-template-category">' + esc(template.category) + '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderList(state) {
    if (state.folder === 'templates') return renderTemplateList(state);

    var rows = filteredInbox(state);
    var allChecked = rows.length > 0 && rows.every(function (row) { return isRowChecked(row, state); });
    var bulkCount = selectedEmailCount(state);
    return (
      '<div class="tma-dash__email-list">' +
      renderListMobileHead(state) +
      '<div class="tma-dash__email-list-head">' +
      '<label class="tma-dash__email-list-check">' +
      '<input type="checkbox" class="tma-dash__check" data-email-selectall' + (allChecked ? ' checked' : '') + ' aria-label="Select all">' +
      '</label>' +
      renderEmailListRefreshBtn(state) +
      renderEmailListBulk(state) +
      renderEmailBulkMoreMenu(state) +
      renderEmailLabelMenu(state) +
      renderListHeadActions(state, { showFilter: !isEmailMobile() }) +
      '</div>' +
      renderReconnectBanner(state) +
      '<div class="tma-dash__email-list-body">' +
      renderListState(state, rows) +
      '</div>' +
      renderMailPagination(state) +
      '</div>'
    );
  }

  /* Pager for the folder listing. The mailbox mirror can hold tens of
   * thousands of messages, so the list is a real server-side page — this shows
   * where you are, lets you step through, and sets how many land per page. */
  function renderMailPagination(state) {
    if (state.folder === 'templates' || state.search) return '';
    var total = state.total || 0;
    if (!total) return '';

    var perPage = state.perPage || 50;
    var page = state.page || 1;
    var last = state.lastPage || 1;
    var first = ((page - 1) * perPage) + 1;
    var upto = Math.min(page * perPage, total);

    var options = (state.perPageOptions || [25, 50, 100, 200]).map(function (n) {
      return '<option value="' + n + '"' + (n === perPage ? ' selected' : '') + '>' + n + '</option>';
    }).join('');

    function navBtn(target, label, disabled, icon) {
      return '<button type="button" class="tma-dash__email-page-btn" data-email-page="' + target + '"' +
        (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        '<img src="' + icon + '" alt="" aria-hidden="true"></button>';
    }

    return (
      '<div class="tma-dash__email-pagination" data-email-pagination>' +
      '<div class="tma-dash__email-pagination-size">' +
      '<label for="tma-email-perpage">Per page</label>' +
      '<select id="tma-email-perpage" class="tma-dash__email-perpage" data-email-perpage>' + options + '</select>' +
      '</div>' +
      '<span class="tma-dash__email-pagination-range">' +
      first.toLocaleString() + '–' + upto.toLocaleString() + ' of ' + total.toLocaleString() +
      '</span>' +
      '<div class="tma-dash__email-pagination-nav">' +
      navBtn(1, 'First page', page <= 1, ICONS.ArrowLineLeft) +
      navBtn(page - 1, 'Previous page', page <= 1, ICONS.CaretLeft) +
      '<span class="tma-dash__email-pagination-page">Page ' + page.toLocaleString() + ' of ' + last.toLocaleString() + '</span>' +
      navBtn(page + 1, 'Next page', page >= last, ICONS.CaretRight) +
      navBtn(last, 'Last page', page >= last, ICONS.ArrowLineRight) +
      '</div>' +
      '</div>'
    );
  }

  /* Shown above a list that still has mail in it when the mailbox connection
   * has failed: what is on screen is real but may be stale, and nothing new
   * will arrive until the account is reconnected. */
  function renderReconnectBanner(state) {
    if (!state.reconnectNeeded || !rowsOf(state).length) return '';

    return (
      '<div class="tma-dash__email-reconnect" role="status">' +
      '<span>' + esc(state.mailError || 'This mailbox needs to be reconnected.') + '</span>' +
      '<button type="button" class="tma-dash__email-settings-btn" data-email-open-settings>Fix it</button>' +
      '</div>'
    );
  }

  /* Loading, disconnected, error and empty all get an honest state — never a
   * placeholder message that could be mistaken for real mail. */
  function renderListState(state, rows) {
    function notice(title, body, actionHtml) {
      return (
        '<div class="tma-dash__email-list-empty">' +
        '<p class="tma-dash__email-list-empty-title">' + esc(title) + '</p>' +
        (body ? '<p class="tma-dash__email-list-empty-body">' + esc(body) + '</p>' : '') +
        (actionHtml || '') +
        '</div>'
      );
    }

    if (state.connected === false) {
      return notice(
        'No mailbox connected',
        'Connect Google or Microsoft to read and send mail here.',
        '<button type="button" class="tma-dash__email-settings-btn tma-dash__email-settings-btn--primary"' +
        ' data-email-open-settings>Open email settings</button>'
      );
    }

    if (state.loading) {
      return notice('Loading messages…');
    }

    if (state.loadError) {
      return notice('Could not load messages', state.loadError);
    }

    if (!rows.length) {
      return state.search
        ? notice('No results', 'Nothing in this mailbox matches “' + state.search + '”.')
        : notice('Nothing here', 'This folder is empty.');
    }

    return rows.map(function (row) { return buildInboxRowHtml(row, state); }).join('');
  }

  /* Plain-text mail, and the fallback whenever no HTML part was sent.
   *
   * Newlines are the only structure a text body has, so they have to survive:
   * collapsing them into one paragraph turned every plain-text message —
   * including most automated notifications — into an unreadable wall. */
  function renderMessageBodyText(bodyText) {
    return (
      '<div class="tma-dash__email-body tma-dash__email-body--text">' +
      '<pre class="tma-dash__email-body-plain">' + esc(bodyText || '') + '</pre>' +
      '</div>'
    );
  }

  /* The message's attachments, under the body.
   *
   * Images get a thumbnail you can click to open full size; everything else is
   * a labelled row. Both go through the authenticated attachment endpoint —
   * the file is streamed from the provider, never guessed at locally. */
  /* The message's attachments, in their own section under the body — never
   * mixed into it. Each card previews (image thumbnail, or the file-type icon
   * from the same set the File Library uses) and offers Download and
   * Open/Preview separately, since a click should never trigger a surprise
   * download (see openAttachmentLightbox). */
  function renderAttachments(row) {
    var items = (row && row.attachments) || [];
    // Keyed by message, not stored as "the attachments currently on screen":
    // a thread renders several messages at once, each with its own files, so a
    // single shared array would hand every card the last one's attachments.
    var ownerId = (row && row.id) || '';
    state_attachmentsByMessage[ownerId] = items;
    if (!items.length) return '';

    // Gmail-style tiles: a big preview area (the real image, or — since this
    // stack has no Imagick/Ghostscript to rasterise a PDF server-side — its
    // first page rendered client-side via pdf.js, see wireAttachmentPdfPreviews),
    // a filename strip fixed under it, and download/open actions that only
    // appear on hover. The whole tile opens the lightbox; the hover button
    // downloads directly without opening it first.
    var cards = items.map(function (a, i) {
      var isImage = attachmentIsImage(a);
      var isPdf = !isImage && attachmentIsPdf(a);
      // The fallback icon is wired as a real listener (see wireAttachmentPreviews),
      // not an inline onerror string: JSON.stringify()'s own double quotes would
      // terminate this double-quoted HTML attribute early and silently truncate
      // the handler, so it never actually ran.
      var preview = isImage
        ? '<img src="' + esc(attachmentUrl(a, true)) + '" alt="" loading="lazy"' +
          ' data-email-attachment-fallback-icon="' + esc(attachmentIconSrc(a)) + '">'
        : '<img class="tma-dash__email-attachment-tile-icon-img" src="' + esc(attachmentIconSrc(a)) + '" alt="">';

      return (
        '<div class="tma-dash__email-attachment-tile' + (isImage ? '' : ' tma-dash__email-attachment-tile--icon') + '"' +
        ' data-email-attachment-index="' + i + '" data-email-attachment-open="' + i + '" role="button" tabindex="0"' +
        (isPdf ? ' data-email-attachment-pdf="' + esc(attachmentUrl(a, true)) + '"' : '') + '>' +
        '<div class="tma-dash__email-attachment-tile-preview">' + preview +
        // Hovering (or focusing) the tile covers the preview with the full
        // filename — see .tma-dash__email-attachment-tile-caption — so a
        // long or ambiguous name never needs a separate tooltip to read.
        '<div class="tma-dash__email-attachment-tile-caption" aria-hidden="true"><span>' + esc(a.name) + '</span></div>' +
        '<div class="tma-dash__email-attachment-tile-corner" aria-hidden="true"></div>' +
        '<div class="tma-dash__email-attachment-tile-hover">' +
        '<a class="tma-dash__email-attachment-tile-btn" href="' + esc(attachmentUrl(a, false)) + '" download="' + esc(a.name) + '"' +
        ' aria-label="Download ' + esc(a.name) + '" data-email-attachment-download>' +
        '<img src="' + ICONS.ArrowLineDown + '" alt="">' +
        '</a>' +
        '</div>' +
        '</div>' +
        '<div class="tma-dash__email-attachment-tile-bar">' +
        '<img class="tma-dash__email-attachment-tile-bar-icon" src="' + esc(attachmentIconSrc(a)) + '" alt="">' +
        '<span class="tma-dash__email-attachment-tile-name" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    // Embedded pictures are counted separately in the heading. They stay
    // listed — a sender pasting a real document into the body gives it a
    // Content-ID exactly as a signature logo has one, and hiding the first to
    // tidy away the second loses genuine paperwork — but saying how many of
    // the files are pictures already shown above stops a signature's four
    // logos reading as four documents nobody sent.
    var inlineCount = items.filter(function (a) { return a.inline; }).length;
    var fileCount = items.length - inlineCount;

    var heading = items.length + ' attachment' + (items.length === 1 ? '' : 's');
    if (inlineCount && fileCount) {
      heading = fileCount + ' attachment' + (fileCount === 1 ? '' : 's') +
        ' · ' + inlineCount + ' embedded image' + (inlineCount === 1 ? '' : 's');
    } else if (inlineCount) {
      heading = inlineCount + ' embedded image' + (inlineCount === 1 ? '' : 's');
    }

    return (
      '<div class="tma-dash__email-attachments" data-email-attachments' +
      ' data-email-attachments-owner="' + esc(ownerId) + '">' +
      '<div class="tma-dash__email-attachments-head">' +
      '<img src="' + ICONS.PaperclipHorizontal + '" alt="" aria-hidden="true">' +
      heading +
      '</div>' +
      '<div class="tma-dash__email-attachments-list">' + cards + '</div>' +
      '</div>'
    );
  }

  /* ── attachment lightbox ──────────────────────────────────────
   * Reuses the File Library's lightbox CSS (.tma-portal-lightbox*) so a
   * preview looks identical whether it was opened from Files or from Mail —
   * this is a new, small controller rather than calling into portal-files.js
   * directly, since that module's gallery/permissions are tied to the Vault's
   * file model, not a mail attachment.
   */
  var mailLightbox = null;

  function closeAttachmentLightbox() {
    if (!mailLightbox) return;
    document.removeEventListener('keydown', mailLightbox._key);
    mailLightbox.remove();
    mailLightbox = null;
    document.body.style.overflow = '';
  }

  function attachmentLightboxStage(a) {
    if (attachmentIsImage(a)) {
      return '<img class="tma-portal-lightbox__img tma-dash__email-lightbox-img" src="' + esc(attachmentUrl(a, true)) + '" alt="' + esc(a.name) + '" data-email-lightbox-zoom>';
    }
    if (attachmentIsPdf(a)) {
      return '<iframe class="tma-portal-lightbox__frame" src="' + esc(attachmentUrl(a, true)) + '" title="' + esc(a.name) + '"></iframe>';
    }
    if (/^audio\//.test(a.mime || '')) {
      return '<div class="tma-portal-lightbox__audio"><img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="64" height="64">' +
        '<audio src="' + esc(attachmentUrl(a, true)) + '" controls autoplay></audio></div>';
    }
    if (/^video\//.test(a.mime || '')) {
      return '<video class="tma-portal-lightbox__media" src="' + esc(attachmentUrl(a, true)) + '" controls autoplay playsinline></video>';
    }
    // Office documents, archives, and anything else a browser cannot render
    // safely inline: an honest "here's what it is" card, not a fake viewer.
    return (
      '<div class="tma-portal-lightbox__nopreview">' +
      '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="72" height="72">' +
      '<p class="tma-portal-lightbox__nopreview-title">' + esc(a.name) + '</p>' +
      '<p class="tma-portal-lightbox__nopreview-text">' + esc(attachmentTypeLabel(a)) + ' · ' + esc(formatBytes(a.size)) +
      ' · no in-browser preview for this file type</p>' +
      '</div>'
    );
  }

  function openAttachmentLightbox(items, index) {
    closeAttachmentLightbox();

    var idx = index;
    var lb = document.createElement('div');
    lb.className = 'tma-portal-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    document.body.appendChild(lb);
    document.body.style.overflow = 'hidden';
    mailLightbox = lb;

    function paint() {
      var a = items[idx];
      var many = items.length > 1;
      lb.innerHTML =
        '<div class="tma-portal-lightbox__backdrop" data-lb-close></div>' +
        '<div class="tma-portal-lightbox__head">' +
        '<span class="tma-portal-lightbox__title" title="' + esc(a.name) + '">' +
        '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" width="18" height="18">' + esc(a.name) + '</span>' +
        '<div class="tma-portal-lightbox__head-actions">' +
        '<a class="tma-portal-tool" data-lb-download href="' + esc(attachmentUrl(a, false)) + '" download="' + esc(a.name) + '">' +
        '<img src="' + ICONS.ArrowLineDown + '" alt="" width="16" height="16"><span>Download</span></a>' +
        '<button type="button" class="tma-portal-tool tma-portal-tool--icon" data-lb-close aria-label="Close">' +
        '<img src="' + ICONS.X + '" alt="" width="16" height="16"></button>' +
        '</div></div>' +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--prev" data-lb-prev aria-label="Previous"><img src="' + ICONS.CaretLeft + '" alt="" width="24" height="24"></button>' : '') +
        (many ? '<button type="button" class="tma-portal-lightbox__nav tma-portal-lightbox__nav--next" data-lb-next aria-label="Next"><img src="' + ICONS.CaretRight + '" alt="" width="24" height="24"></button>' : '') +
        '<div class="tma-portal-lightbox__stage" data-lb-stage>' + attachmentLightboxStage(a) + '</div>' +
        '<div class="tma-portal-lightbox__foot">' + (many ? (idx + 1) + ' of ' + items.length + ' &middot; ' : '') + esc(formatBytes(a.size)) + '</div>';
    }

    function go(delta) {
      var next = idx + delta;
      if (next < 0 || next >= items.length) return;
      idx = next;
      paint();
    }

    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-close]')) { closeAttachmentLightbox(); return; }
      if (e.target.closest('[data-lb-prev]')) { go(-1); return; }
      if (e.target.closest('[data-lb-next]')) { go(1); return; }
      // Click-to-zoom for images: a simple toggle rather than full pinch/pan,
      // enough to inspect detail on a scanned document or photo.
      var zoomImg = e.target.closest('[data-email-lightbox-zoom]');
      if (zoomImg) { zoomImg.classList.toggle('is-zoomed'); return; }
    });

    lb._key = function (e) {
      if (document.querySelector('.tma-portal-modal')) return;
      if (e.key === 'Escape') closeAttachmentLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', lb._key);

    paint();
  }

  /* Delegated so it works whichever branch of the detail render is showing. */
  function wireAttachmentPreviews(root) {
    MORPH.unwired(root, '[data-email-attachments]').forEach(function (section) {
      if (section._wired) return;
      section._wired = true;

      function openFrom(target) {
        // The download button sits inside the tile it downloads — let its own
        // native download proceed rather than also opening the lightbox.
        if (target.closest('[data-email-attachment-download]')) return;
        var btn = target.closest('[data-email-attachment-open]');
        if (!btn) return;
        var index = parseInt(btn.getAttribute('data-email-attachment-open'), 10);
        // Which message's files these are — a thread has several sections on
        // screen at once, so the owner has to come from the section itself.
        var owner = section.getAttribute('data-email-attachments-owner') || '';
        var items = state_attachmentsByMessage[owner] || [];
        if (!items.length || isNaN(index)) return;
        openAttachmentLightbox(items, index);
      }

      section.addEventListener('click', function (e) { openFrom(e.target); });
      // The tile is a div (role="button"), which — unlike a real <button> —
      // needs its own Enter/Space handling to be keyboard-operable.
      section.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('[data-email-attachment-download]')) return;
        if (!e.target.closest('[data-email-attachment-open]')) return;
        e.preventDefault();
        openFrom(e.target);
      });

      // A broken preview (the fake/expired-token case, or any transient
      // provider hiccup) falls back to the file-type icon. `error` does not
      // bubble, so this has to be bound on the capture phase to delegate.
      section.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || !img.matches || !img.matches('[data-email-attachment-fallback-icon]')) return;
        var tile = img.closest('.tma-dash__email-attachment-tile');
        if (tile) tile.classList.add('tma-dash__email-attachment-tile--icon');
        var fallback = document.createElement('img');
        fallback.className = 'tma-dash__email-attachment-tile-icon-img';
        fallback.src = img.getAttribute('data-email-attachment-fallback-icon');
        fallback.alt = '';
        img.replaceWith(fallback);
      }, true);
    });
  }

  // Set right before the attachments section renders (see renderMessageBody
  // caller) so the lightbox and the click handler always agree on which
  // message's attachments are on screen, without threading the array through
  // every intermediate render function.
  /* Attachments currently on screen, keyed by the message they belong to.
   *
   * Not threaded through every intermediate render function, and not a single
   * "last row" array either: a thread paints several messages at once, so the
   * lightbox has to be able to ask which card was clicked. */
  var state_attachmentsByMessage = {};

  /* The state currently being rendered.
   *
   * Same reasoning as state_attachmentsByMessage above: a handful of leaf render
   * helpers need one field off the state (the user's signature, their timezone
   * preferences) and threading an extra argument through every caller in
   * between costs more than it explains. Set once at the top of render().
   */
  var state_active = null;

  /* One of the user's mail preferences, or a fallback before settings load. */
  function mailPreference(key, fallback) {
    var prefs = (state_active && state_active.settings && state_active.settings.preferences) || {};
    return prefs[key] === undefined || prefs[key] === null ? fallback : prefs[key];
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  /* ── attachment type detection ────────────────────────────────
   * One shared table for the human-readable type label; the icon itself comes
   * from window.TMAFileIcons, the same lookup the File Library uses, so a
   * given extension draws identically everywhere in the portal. */
  var ATTACHMENT_TYPE_LABELS = {
    pdf: 'PDF',
    doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word',
    xls: 'Excel', xlsx: 'Excel', ods: 'Excel',
    csv: 'CSV',
    ppt: 'PowerPoint', pptx: 'PowerPoint', odp: 'PowerPoint',
    jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', webp: 'Image',
    bmp: 'Image', tiff: 'Image', tif: 'Image', heic: 'Image', heif: 'Image',
    avif: 'Image', svg: 'Image',
    mp4: 'Video', mov: 'Video', webm: 'Video', mkv: 'Video', avi: 'Video', m4v: 'Video',
    mp3: 'Audio', wav: 'Audio', ogg: 'Audio', m4a: 'Audio', flac: 'Audio', aac: 'Audio',
    zip: 'Archive', rar: 'Archive', '7z': 'Archive', tar: 'Archive', gz: 'Archive',
    txt: 'Text', md: 'Text', log: 'Text',
  };

  function attachmentExt(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function attachmentTypeLabel(attachment) {
    var ext = attachmentExt(attachment && attachment.name);
    return ATTACHMENT_TYPE_LABELS[ext] || (ext ? ext.toUpperCase() : 'File');
  }

  function attachmentIconSrc(attachment) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(null, attachment.name);
    return ICONS.PaperclipHorizontal;
  }

  function attachmentIsImage(attachment) {
    return /^image\//.test((attachment && attachment.mime) || '') || /^(jpg|jpeg|png|gif|webp|bmp|tiff|tif|heic|heif|avif)$/i.test(attachmentExt(attachment && attachment.name));
  }

  function attachmentIsPdf(attachment) {
    return (attachment && attachment.mime) === 'application/pdf' || attachmentExt(attachment && attachment.name) === 'pdf';
  }

  var ATTACHMENT_BASE = (window.__TMA_SITE_ROOT || '') + '/portal/mail/attachments/';

  function attachmentUrl(attachment, inline) {
    return ATTACHMENT_BASE + encodeURIComponent(attachment.id) + (inline ? '?inline=1' : '');
  }

  /* pdf.js ships as ESM and weighs ~1.7 MB with its worker, so it's pulled in
     on first use rather than at page load — see portal-work.js's identical
     loader for the signature editor. Rendering the attachment's own first
     page client-side sidesteps the lack of Imagick/Ghostscript server-side. */
  var attachmentPdfjsPromise = null;
  function loadAttachmentPdfjs() {
    if (attachmentPdfjsPromise) return attachmentPdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    attachmentPdfjsPromise = import(root + '/js/vendor/pdf.min.mjs').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf.worker.min.mjs';
      return lib;
    }).catch(function (err) {
      attachmentPdfjsPromise = null; // let a later attempt retry
      throw err;
    });
    return attachmentPdfjsPromise;
  }

  function renderAttachmentPdfThumb(tile, url) {
    var iconImg = tile.querySelector('.tma-dash__email-attachment-tile-icon-img');
    if (!iconImg) return;
    loadAttachmentPdfjs()
      .then(function (pdfjs) { return pdfjs.getDocument({ url: url, withCredentials: true }).promise; })
      .then(function (pdf) { return pdf.getPage(1); })
      .then(function (page) {
        var targetWidth = tile.clientWidth || 210;
        var scale = targetWidth / page.getViewport({ scale: 1 }).width;
        var viewport = page.getViewport({ scale: scale });
        var dpr = window.devicePixelRatio || 1;
        var canvas = document.createElement('canvas');
        canvas.className = 'tma-dash__email-attachment-tile-pdf-canvas';
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          if (!iconImg.parentNode) return; // tile re-rendered while we were loading
          tile.classList.remove('tma-dash__email-attachment-tile--icon');
          iconImg.replaceWith(canvas);
        });
      })
      // A corrupt/unreadable PDF, or the worker failing to load, just leaves
      // the icon in place — never worth surfacing as an error to the user.
      .catch(function () {});
  }

  function wireAttachmentPdfPreviews(root) {
    root.querySelectorAll('[data-email-attachment-pdf]').forEach(function (tile) {
      if (tile._pdfPreviewWired) return;
      tile._pdfPreviewWired = true;
      renderAttachmentPdfThumb(tile, tile.getAttribute('data-email-attachment-pdf'));
    });
  }

  /* Compact chips under a list row — Gmail's own inbox does exactly this: a
   * small icon-and-name pill per file, not a full thumbnail, so a page of 50
   * rows never has to render dozens of image previews at once. */
  function renderRowAttachmentChips(row) {
    if (!row.hasAttachments) return '';

    var items = row.attachmentsPreview || [];
    var known = row.attachmentCount;

    // We only know real filenames/types for messages already opened once
    // (see toRow() — nothing here ever asks the provider for this). Anything
    // else still gets a line, just without per-file detail yet.
    if (!items.length) {
      return (
        '<div class="tma-dash__email-row-attachments">' +
        '<span class="tma-dash__email-attachment-chip tma-dash__email-attachment-chip--generic">' +
        '<img src="' + ICONS.PaperclipHorizontal + '" alt="" aria-hidden="true">' +
        '<span>' + (known ? known + ' attachment' + (known === 1 ? '' : 's') : 'Attachment') + '</span>' +
        '</span></div>'
      );
    }

    var LIMIT = 3;
    var shown = items.slice(0, LIMIT);
    var more = (known || items.length) - shown.length;

    // Each chip we have real data for opens straight into the same lightbox
    // the full message view uses (see wireListRows) instead of just opening
    // the message — a shortcut Gmail's own inbox offers too.
    var chips = shown.map(function (a, i) {
      return (
        '<span class="tma-dash__email-attachment-chip" title="' + esc(a.name) + '" data-email-row-attachment-open="' + i + '">' +
        '<img src="' + esc(attachmentIconSrc(a)) + '" alt="" aria-hidden="true">' +
        '<span>' + esc(a.name) + '</span>' +
        '</span>'
      );
    }).join('');

    if (more > 0) {
      // "+more" can only jump into the lightbox when the extra files are
      // ones we actually have data for (items goes up to the server's cap of
      // 8); beyond that it falls back to opening the message, same as before.
      var moreOpen = items.length > shown.length ? ' data-email-row-attachment-open="' + shown.length + '"' : '';
      chips += '<span class="tma-dash__email-attachment-chip tma-dash__email-attachment-chip--more"' + moreOpen + '>+' + more + ' more</span>';
    }

    return '<div class="tma-dash__email-row-attachments">' + chips + '</div>';
  }

  /* Grow the message frame to its content so nothing is cut off.
   *
   * Re-measures after images finish loading, since a picture that arrives late
   * changes the height. Falls back to leaving the CSS height alone if the
   * document cannot be read for any reason. */
  function sizeMessageFrames(root) {
    root.querySelectorAll('[data-email-body-frame]').forEach(function (frame) {
      var fit = function () {
        try {
          var doc = frame.contentDocument;
          if (!doc || !doc.body) return;
          var h = Math.max(
            doc.body.scrollHeight,
            doc.documentElement ? doc.documentElement.scrollHeight : 0
          );
          if (h > 0) frame.style.height = (h + 16) + 'px';
        } catch (e) { /* cross-origin or torn down; keep the CSS height */ }
      };

      fit();
      frame.addEventListener('load', fit);

      try {
        var d = frame.contentDocument;
        if (d) {
          d.querySelectorAll('img').forEach(function (img) {
            if (!img.complete) {
              img.addEventListener('load', fit);
              img.addEventListener('error', fit);
            }
          });
        }
      } catch (e) { /* ignore */ }

      // A couple of late passes catch fonts and slow images without needing a
      // resize observer inside a document we deliberately cannot script.
      setTimeout(fit, 250);
      setTimeout(fit, 1200);
    });
  }

  /* Gives the sandboxed document a readable default and stops remote images
   * from silently reporting that the message was opened. */
  function wrapEmailBodyHtml(html) {
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="referrer" content="no-referrer">' +
      '<style>' +
      // :where() keeps these at zero specificity, so anything the sender
      // specified wins. Previously these overrode the message's own styling
      // and every email came out looking the same.
      ':where(html,body){margin:0;padding:0;}' +
      ':where(body){font-family:Inter,system-ui,sans-serif;font-size:14px;' +
      'line-height:1.5;color:#1c1c1c;}' +
      // Pictures are held to the pane width so they cannot force the message
      // sideways; wide tables keep their real layout and scroll instead of
      // being squashed into something the sender never designed.
      ':where(img){max-width:100%;height:auto;}' +
      '</style></head><body>' + html + '</body></html>'
    );
  }

  /* ── quoted history ──────────────────────────────────────────────
   * A reply carries the message it answers, and usually everything before
   * that, appended to its own text. Showing all of it inline is what made
   * replies so hard to follow: the two lines someone actually wrote sit on top
   * of screens of history they did not.
   *
   * The split happens here rather than inside the body frame, because that
   * frame deliberately cannot run scripts — so a toggle inside it could never
   * work. Both halves are kept; nothing is discarded.
   */

  /* Where mail clients mark the start of quoted history. */
  var QUOTE_SELECTORS = [
    '.gmail_quote',
    '.gmail_extra',
    'blockquote[type="cite"]',
    '#divRplyFwdMsg',          // Outlook's "From: … Sent: …" reply header
    '#appendonsend',           // Outlook's marker for everything it appended
    '.OutlookMessageHeader',
    'div[name="quote"]',       // Zimbra, Roundcube
    '.yahoo_quoted',
    '.protonmail_quote',
    '.moz-cite-prefix',        // Thunderbird
  ];

  /* Splits a body into what the sender wrote and the history they quoted.
   *
   * Parsed with DOMParser into a detached document: nothing is ever inserted
   * into the live page, no scripts run, and the sandboxed frame still does the
   * actual rendering. Returns the original untouched when there is no quote to
   * separate, so an ordinary message costs nothing. */
  function splitQuotedHtml(html) {
    var none = { main: html, quoted: '', hasQuote: false };
    if (!html || typeof DOMParser === 'undefined') return none;

    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      return none;
    }
    if (!doc || !doc.body) return none;

    var marker = null;
    for (var i = 0; i < QUOTE_SELECTORS.length && !marker; i++) {
      try {
        marker = doc.body.querySelector(QUOTE_SELECTORS[i]);
      } catch (e) { /* a selector this browser dislikes is simply skipped */ }
    }

    // Outlook separates the reply from its history with a horizontal rule
    // rather than a class, so that is worth catching too — but only when it is
    // in the back half of the message, so a rule used as decoration in a
    // newsletter is not mistaken for a quote boundary.
    if (!marker) {
      var rules = doc.body.querySelectorAll('hr');
      if (rules.length) {
        var last = rules[rules.length - 1];
        if (last.parentNode === doc.body && indexOfNode(last) > childCount(doc.body) / 2) {
          marker = last;
        }
      }
    }

    if (!marker) return none;

    // Everything from the marker onward is history. Walk up to the marker's
    // top-level ancestor first, so a quote nested inside a wrapper takes the
    // whole wrapper with it rather than leaving its container behind.
    var top = marker;
    while (top.parentNode && top.parentNode !== doc.body) top = top.parentNode;

    var quoted = doc.createElement('div');
    while (top.nextSibling) quoted.appendChild(top.nextSibling);
    quoted.insertBefore(top, quoted.firstChild);

    var main = doc.body.innerHTML;

    // A reply that is *only* quoted history (a bare forward, say) has nothing
    // to collapse — hiding all of it would leave an empty message.
    if (!main.replace(/<[^>]*>/g, '').trim()) return none;

    return { main: main, quoted: quoted.innerHTML, hasQuote: true };
  }

  function indexOfNode(node) {
    var i = 0;
    while ((node = node.previousSibling) !== null) i++;
    return i;
  }

  function childCount(node) {
    return node.childNodes ? node.childNodes.length : 0;
  }

  /* ── thread rendering ────────────────────────────────────────────
   * Every message in the conversation as its own card, oldest at the top.
   * Collapsed messages show a single summary line; the newest, the one that
   * was opened, and anything unread start expanded.
   */
  function renderEmailThread(state, threadActions) {
    // Only ever the conversation the selected message is actually in — a
    // thread left over from the previously open message must not be painted
    // against this one. ensureThreadLoaded replaces it on the next tick.
    var thread = threadCoversSelection(state) ? state.thread : null;

    if (state.threadError && state.threadErrorId === state.selectedId) {
      return (
        '<div class="tma-dash__email-thread">' +
        '<div class="tma-dash__email-thread-error" role="alert">' +
        esc(state.threadError) +
        '</div></div>'
      );
    }

    if (!thread || !thread.messages.length) {
      return (
        '<div class="tma-dash__email-thread">' +
        '<div class="tma-dash__email-thread-loading">Loading conversation…</div>' +
        '</div>'
      );
    }

    var messages = thread.messages;
    var lastIndex = messages.length - 1;

    var cards = messages.map(function (message, index) {
      return renderThreadMessage(message, state, {
        expanded: !!thread.expanded[message.id],
        isLast: index === lastIndex,
        showQuoted: !!thread.showQuoted[message.id],
      });
    }).join('');

    return (
      '<div class="tma-dash__email-thread" data-email-thread>' +
      (messages.length > 1 ? renderThreadSummary(thread, state) : '') +
      cards +
      (threadActions || '') +
      '</div>'
    );
  }

  /* A count and an expand/collapse-all control, so a long conversation can be
   * opened out in one action instead of card by card. */
  function renderThreadSummary(thread, state) {
    var total = thread.messages.length;
    var openCount = thread.messages.filter(function (m) {
      return thread.expanded[m.id];
    }).length;
    var allOpen = openCount === total;

    return (
      '<div class="tma-dash__email-thread-summary">' +
      '<span class="tma-dash__email-thread-count">' + total + ' messages in this conversation</span>' +
      '<button type="button" class="tma-dash__email-thread-expand-all" data-email-thread-toggle-all="' +
      (allOpen ? 'collapse' : 'expand') + '">' +
      (allOpen ? 'Collapse all' : 'Expand all') +
      '</button>' +
      '</div>'
    );
  }

  /* One message in the thread. */
  function renderThreadMessage(message, state, opts) {
    var metaEmail = message.email || '';
    var metaDate = formatMessageDate(message);
    var subject = message.subject || '';

    if (!opts.expanded) {
      return (
        '<article class="tma-dash__email-message tma-dash__email-message--collapsed"' +
        ' data-email-thread-message="' + esc(message.id) + '">' +
        '<button type="button" class="tma-dash__email-message-collapsed-btn"' +
        ' data-email-thread-expand="' + esc(message.id) + '"' +
        ' aria-expanded="false">' +
        messageHeadIcon(message) +
        '<span class="tma-dash__email-message-collapsed-name">' + esc(message.sender || metaEmail) + '</span>' +
        '<span class="tma-dash__email-message-collapsed-snippet">' + esc(message.body || '') + '</span>' +
        (message.hasAttachments
          ? '<img class="tma-dash__email-message-collapsed-clip" src="' + ICONS.PaperclipHorizontal + '" alt="Has attachments">'
          : '') +
        '<time class="tma-dash__email-message-collapsed-date">' + esc(metaDate) + '</time>' +
        '</button>' +
        '</article>'
      );
    }

    return (
      '<article class="tma-dash__email-message tma-dash__email-message--expanded' +
      (opts.isLast ? ' tma-dash__email-message--current' : '') + '"' +
      ' data-email-thread-message="' + esc(message.id) + '">' +
      renderThreadMessageHead(message, metaEmail, metaDate, subject, state) +
      renderThreadMessageBody(message, opts) +
      renderAttachments(message) +
      '</article>'
    );
  }

  /* The head of an expanded card. Reuses the existing message head so a thread
   * card and the old single-message view stay visually identical; the whole
   * head doubles as the collapse control. */
  function renderThreadMessageHead(message, metaEmail, metaDate, subject, state) {
    return (
      '<div class="tma-dash__email-message-head-wrap" data-email-thread-collapse="' + esc(message.id) + '"' +
      ' role="button" tabindex="0" aria-expanded="true">' +
      renderMessageHead(message, metaEmail, metaDate, subject, 'thread-' + message.id, state) +
      '</div>'
    );
  }

  function renderThreadMessageBody(message, opts) {
    if (message._loading) {
      return '<div class="tma-dash__email-body"><p class="tma-dash__email-body-loading">Loading message…</p></div>';
    }

    if (message._error) {
      return (
        '<div class="tma-dash__email-body">' +
        '<p class="tma-dash__email-body-error" role="alert">' + esc(message._error) + '</p>' +
        '</div>'
      );
    }

    // Nothing fetched yet — the card was rendered before its body arrived.
    if (!message.bodyLoaded && !message.bodyHtml && !message.bodyText) {
      return renderMessageBodyText(message.body || '');
    }

    if (!message.bodyHtml) {
      return renderMessageBodyText(message.bodyText || message.body || '');
    }

    var split = splitQuotedHtml(message.bodyHtml);
    var shown = split.hasQuote && !opts.showQuoted ? split.main : message.bodyHtml;

    var quoteToggle = split.hasQuote
      ? '<button type="button" class="tma-dash__email-quote-toggle"' +
        ' data-email-thread-quote="' + esc(message.id) + '"' +
        ' aria-expanded="' + (opts.showQuoted ? 'true' : 'false') + '">' +
        (opts.showQuoted ? 'Hide quoted text' : 'Show quoted text') +
        '</button>'
      : '';

    return (
      '<div class="tma-dash__email-body tma-dash__email-body--html">' +
      '<iframe class="tma-dash__email-body-frame" sandbox="allow-same-origin"' +
      ' referrerpolicy="no-referrer" title="Message content" data-email-body-frame' +
      ' srcdoc="' + esc(wrapEmailBodyHtml(shown)) + '"></iframe>' +
      quoteToggle +
      '</div>'
    );
  }

  /* The send time in the reader's own timezone.
   *
   * `sentAt` is an ISO instant; the two preformatted labels the server also
   * sends are built from a UTC Carbon, so on their own they show a 9pm message
   * as 1am the following day for anyone west of UTC — which is how a message
   * ends up looking like it never arrived. */
  function formatMessageDate(message) {
    if (!message.sentAt) return message.dateLabel || message.time || '';

    var when = new Date(message.sentAt);
    if (isNaN(when.getTime())) return message.dateLabel || message.time || '';

    try {
      return when.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (e) {
      return message.dateLabel || message.time || '';
    }
  }

  function renderTemplateDetail(state) {
    if (!window.TMAEmailTemplates) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty"><p>No templates available</p></div>';
    }
    var template = window.TMAEmailTemplates.get(state.selectedTemplateId);
    if (!template) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty"><p>Select a template</p></div>';
    }

    var hasMobile = window.TMAEmailTemplates.hasMobile(template.id);
    var viewport = state.templateViewport === 'mobile' && hasMobile ? 'mobile' : 'desktop';
    var viewportToggle = hasMobile
      ? '<div class="tma-dash__email-template-viewport" role="group" aria-label="Preview viewport">' +
        '<button type="button" class="tma-dash__email-template-viewport-btn' + (viewport === 'desktop' ? ' tma-dash__email-template-viewport-btn--active' : '') + '" data-email-template-viewport="desktop">Desktop</button>' +
        '<button type="button" class="tma-dash__email-template-viewport-btn' + (viewport === 'mobile' ? ' tma-dash__email-template-viewport-btn--active' : '') + '" data-email-template-viewport="mobile">Mobile</button>' +
        '</div>'
      : '';

    return (
      '<div class="tma-dash__email-detail tma-dash__email-detail--template">' +
      renderDetailBack(state) +
      '<div class="tma-dash__email-detail-subject">' + esc(template.subject) + '</div>' +
      '<div class="tma-dash__email-template-meta">' +
      '<span class="tma-dash__email-template-meta-category">' + esc(template.category) + '</span>' +
      '<div class="tma-dash__email-template-meta-actions">' + viewportToggle +
      '<button type="button" class="tma-dash__email-template-use" data-email-use-template="' + esc(template.id) + '">Use template</button></div>' +
      '</div>' +
      '<div class="tma-dash__email-detail-scroll tma-dash__email-template-preview' + (viewport === 'mobile' ? ' tma-dash__email-template-preview--mobile' : '') + '">' +
      window.TMAEmailTemplates.renderBody(template.id, { viewport: viewport }) +
      '</div>' +
      '</div>'
    );
  }

  function renderDetail(state) {
    if (state.folder === 'templates') return renderTemplateDetail(state);
    syncInlineCompose(state);
    var row = findRow(state, state.selectedId);
    if (!row) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty"><p>Select a message</p></div>';
    }

    var lines = rowListLines(row);
    // The conversation's subject once it has loaded — a thread is titled by
    // what it is about, not by the "Re: Re: Fwd:" the newest reply happens to
    // carry.
    var subject = (state.thread && state.thread.subject) || lines.subject;
    var metaEmail = row.email || '';
    var metaDate = formatMessageDate(row);
    var mobile = isEmailMobile();
    var threadActions = renderDetailThreadActions(state, row, metaEmail, metaDate, subject, lines.body);
    var inlineActive = !!(state.inlineCompose && state.inlineCompose.messageId === row.id);
    var scrollThreadActions = !mobile || inlineActive ? threadActions : null;
    var body = renderEmailThread(state, scrollThreadActions);

    return (
      '<div class="tma-dash__email-detail' + (mobile ? ' tma-dash__email-detail--mobile' : '') + '">' +
      renderDetailTopbar(state) +
      '<div class="tma-dash__email-detail-subject-bar">' +
      renderDetailSubject(subject, row, state) +
      '</div>' +
      '<div class="tma-dash__email-detail-scroll">' + body + '</div>' +
      (mobile && threadActions && !inlineActive
        ? '<div class="tma-dash__email-detail-mobile-footer">' + threadActions + '</div>'
        : '') +
      '</div>'
    );
  }

  /* A new compose window starts blank. Only an explicitly chosen template, or
   * a reply/forward that set one, may put a subject here — the mock's stand-in
   * invoice subject used to be the fallback, so every blank message the user
   * started was pre-addressed about an invoice they had not mentioned. */
  function getComposeSubject(draft) {
    if (draft.templateId && window.TMAEmailTemplates) {
      var template = window.TMAEmailTemplates.get(draft.templateId);
      if (template) return template.subject;
    }
    return draft.subject || '';
  }

  function createComposeDraft(state, opts) {
    opts = opts || {};
    return {
      id: 'compose-' + state.nextComposeId++,
      templateId: opts.templateId || null,
      // Addresses are held as the raw comma-separated text the user typed and
      // only parsed on send, so a half-typed address is never destroyed by a
      // re-render.
      to: opts.to || '',
      cc: '',
      bcc: '',
      subject: opts.subject || '',
      bodyHtml: opts.bodyHtml || '',
      showCc: false,
      minimized: false,
      expanded: false,
      sending: false,
      // Set once the draft has been saved server-side, so autosave updates
      // the same record instead of creating a new one each keystroke.
      serverId: null,
      mode: opts.mode || 'new',
      inReplyTo: opts.inReplyTo || null,
    };
  }

  /* "a@b.com, Name <c@d.com>" → the array the send endpoint expects. */
  function parseAddresses(text) {
    return String(text || '')
      .split(',')
      .map(function (part) { return part.trim(); })
      .filter(Boolean)
      .map(function (part) {
        var match = part.match(/^(.*?)\s*<([^>]+)>$/);
        if (match) return { name: match[1].replace(/^"|"$/g, '').trim() || null, email: match[2].trim() };
        return { email: part };
      })
      .filter(function (address) { return address.email.indexOf('@') !== -1; });
  }

  function findComposeDraft(state, id) {
    return state.composeDrafts.filter(function (draft) { return draft.id === id; })[0] || null;
  }

  function openCompose(state, opts) {
    var draft = createComposeDraft(state, opts);
    state.composeDrafts.push(draft);
    state.focusedComposeId = draft.id;
    return draft;
  }

  function minimizeCompose(state, id) {
    state.composeDrafts.forEach(function (draft) {
      if (draft.id === id) draft.minimized = true;
    });
  }

  function restoreCompose(state, id) {
    state.composeDrafts.forEach(function (draft) {
      if (draft.id === id) draft.minimized = false;
    });
    state.focusedComposeId = id;
  }

  function closeCompose(state, id) {
    state.composeDrafts = state.composeDrafts.filter(function (draft) {
      return draft.id !== id;
    });
    if (state.focusedComposeId === id) {
      var open = state.composeDrafts.filter(function (draft) { return !draft.minimized; });
      state.focusedComposeId = open.length ? open[open.length - 1].id : null;
    }
  }

  function toggleComposeExpand(state, id) {
    state.composeDrafts.forEach(function (draft) {
      if (draft.id === id) draft.expanded = !draft.expanded;
    });
    state.focusedComposeId = id;
  }

  function renderComposeWindowHead(draft) {
    var title = getComposeSubject(draft);
    return (
      '<div class="tma-dash__email-compose-window-head">' +
      '<span class="tma-dash__email-compose-window-title">' + esc(title) + '</span>' +
      '<div class="tma-dash__email-compose-window-actions">' +
      '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-minimize="' + esc(draft.id) + '" aria-label="Minimize">' +
      '<img src="' + ICONS.Minus + '" alt=""></button>' +
      '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-expand="' + esc(draft.id) + '" aria-label="' + (draft.expanded ? 'Restore size' : 'Expand') + '">' +
      '<img src="' + (draft.expanded ? ICONS.CornersIn : ICONS.ArrowsOutSimple) + '" alt=""></button>' +
      '<button type="button" class="tma-dash__email-compose-window-btn" data-email-compose-close="' + esc(draft.id) + '" aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>' +
      '</div></div>'
    );
  }

  function renderComposeWindows(state) {
    var open = state.composeDrafts.filter(function (draft) { return !draft.minimized; });
    if (!open.length) return '';

    return (
      '<div class="tma-dash__email-compose-stack">' +
      open
        .map(function (draft, index) {
          var cls = 'tma-dash__email-compose-window';
          if (draft.expanded) cls += ' tma-dash__email-compose-window--expanded';
          if (draft.id === state.focusedComposeId) cls += ' tma-dash__email-compose-window--focused';
          var stackIndex = open.length - 1 - index;
          return (
            '<div class="' + cls + '" data-email-compose-window="' + esc(draft.id) + '" style="--compose-stack:' + stackIndex + '">' +
            renderComposeWindowHead(draft) +
            '<div class="tma-dash__email-compose-window-body">' +
            renderComposeContent(draft) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderComposeDock(state) {
    var minimized = state.composeDrafts.filter(function (draft) { return draft.minimized; });
    if (!minimized.length) return '';

    return (
      '<div class="tma-dash__email-compose-dock">' +
      minimized
        .map(function (draft) {
          return (
            '<button type="button" class="tma-dash__email-compose-tab" data-email-compose-restore="' + esc(draft.id) + '">' +
            '<span class="tma-dash__email-compose-tab-label">' + esc(getComposeSubject(draft)) + '</span>' +
            '<span class="tma-dash__email-compose-tab-close" data-email-compose-close="' + esc(draft.id) + '" role="presentation" aria-hidden="true">' +
            '<img src="' + ICONS.X + '" alt=""></span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── compose toolbar menus ───────────────────────────────────────
   * The caret buttons (Text style, Text colour) and More open a small popup
   * built here rather than in the main render, so opening one does not
   * re-render the compose window and throw away the selection the command is
   * about to be applied to.
   */

  var composeMenuEl = null;

  function closeComposeMenu() {
    if (!composeMenuEl) return;
    composeMenuEl.remove();
    composeMenuEl = null;
  }

  function composeMenuItems(kind) {
    if (kind === 'style') {
      return COMPOSE_FONT_SIZES.map(function (size) {
        return { label: size.label, cmd: 'fontSize', value: size.value };
      });
    }

    if (kind === 'color') {
      return COMPOSE_COLORS.map(function (color) {
        return { label: color.label, cmd: 'foreColor', value: color.value, swatch: color.value };
      }).concat(
        [{ separator: true, label: 'Highlight' }],
        COMPOSE_HIGHLIGHTS.map(function (color) {
          // hiliteColor is the standards name; backColor is what older engines
          // answer to. Both are attempted when the command runs.
          return { label: color.label, cmd: 'hiliteColor', value: color.value, swatch: color.value };
        })
      );
    }

    return COMPOSE_MORE_TOOLS;
  }

  function openComposeMenu(button, kind) {
    closeComposeMenu();

    var items = composeMenuItems(kind);

    var menu = document.createElement('div');
    menu.className = 'tma-dash__email-compose-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(function (item) {
      if (item.separator) {
        return '<div class="tma-dash__email-compose-menu-sep">' + esc(item.label) + '</div>';
      }

      return (
        '<button type="button" class="tma-dash__email-compose-menu-item" role="menuitem"' +
        ' data-email-compose-menu-cmd="' + esc(item.cmd) + '"' +
        (item.value ? ' data-email-compose-menu-value="' + esc(item.value) + '"' : '') + '>' +
        (item.swatch
          ? '<span class="tma-dash__email-compose-menu-swatch" style="background:' + esc(item.swatch) + '"></span>'
          : '') +
        esc(item.label) +
        '</button>'
      );
    }).join('');

    document.body.appendChild(menu);
    composeMenuEl = menu;

    var rect = button.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    // Kept on screen when the button sits near the right edge.
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  }

  /* Runs a formatting command against the editor that owns the selection.
   *
   * execCommand is deprecated but remains the only thing every browser
   * implements for contenteditable rich text, and it is what the rest of this
   * toolbar already uses. */
  function applyComposeCommand(cmd, value) {
    if (cmd === 'createLink') {
      var url = window.prompt('Link URL');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }

    if (cmd === 'hiliteColor') {
      // Not universally supported under that name; fall back to backColor.
      if (!document.execCommand('hiliteColor', false, value)) {
        document.execCommand('backColor', false, value);
      }
      return;
    }

    document.execCommand(cmd, false, value === undefined ? null : value);
  }

  /* Reflects the formatting at the cursor back onto the toolbar, so Bold looks
   * pressed while the caret sits in bold text. */
  function syncComposeToolbarState(root) {
    root.querySelectorAll('[data-email-compose-tool-state]').forEach(function (btn) {
      var cmd = btn.getAttribute('data-email-compose-tool-state');
      var on = false;

      try {
        on = document.queryCommandState(cmd);
      } catch (e) { /* an engine that will not answer simply shows unpressed */ }

      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('tma-dash__email-compose-tool--active', on);
    });
  }

  function wireComposeEvents(root, state, render) {
    MORPH.unwired(root, '[data-email-compose-window]').forEach(function (windowEl) {
      windowEl.addEventListener('mousedown', function () {
        var id = windowEl.getAttribute('data-email-compose-window');
        if (state.focusedComposeId !== id) {
          state.focusedComposeId = id;
          render();
        }
      });
    });

    MORPH.unwired(root, '[data-email-compose-minimize]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        minimizeCompose(state, btn.getAttribute('data-email-compose-minimize'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-expand]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleComposeExpand(state, btn.getAttribute('data-email-compose-expand'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-close]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        closeCompose(state, btn.getAttribute('data-email-compose-close'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-restore]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        if (event.target.closest('[data-email-compose-close]')) return;
        restoreCompose(state, btn.getAttribute('data-email-compose-restore'));
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-discard]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-email-compose-discard');
        var draft = findComposeDraft(state, id);

        // Drop the server-side copy too, or the message reappears in Drafts.
        if (draft && draft.serverId) {
          api().deleteDraft(draft.serverId).catch(function () {});
        }

        closeCompose(state, id);
        render();
      });
    });

    /* Field edits write straight to the draft. No re-render on input —
     * repainting the window would move the caret out from under the user. */
    MORPH.unwired(root, '[data-email-compose-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        var draft = findComposeDraft(state, input.getAttribute('data-email-compose-id'));
        if (!draft) return;
        draft[input.getAttribute('data-email-compose-field')] = input.value;
        scheduleDraftSave(state, draft);
      });
    });

    MORPH.unwired(root, '[data-email-compose-body]').forEach(function (body) {
      body.addEventListener('input', function () {
        var draft = findComposeDraft(state, body.getAttribute('data-email-compose-body'));
        if (!draft) return;
        draft.bodyHtml = body.innerHTML;
        scheduleDraftSave(state, draft);
      });
    });

    MORPH.unwired(root, '[data-email-compose-cc]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var draft = findComposeDraft(state, btn.getAttribute('data-email-compose-cc'));
        if (!draft) return;
        draft.showCc = !draft.showCc;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-compose-save]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var draft = findComposeDraft(state, btn.getAttribute('data-email-compose-save'));
        if (!draft) return;
        saveComposeDraft(state, draft).then(function () {
          showEmailToast(root, 'Draft saved');
        }).catch(function (err) {
          reportMailError(state, err);
        });
      });
    });

    MORPH.unwired(root, '[data-email-compose-send]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        sendCompose(root, state, render, btn.getAttribute('data-email-compose-send'));
      });
    });
  }

  /* Autosave, debounced so a burst of typing is one write. */
  function scheduleDraftSave(state, draft) {
    window.clearTimeout(draft._saveTimer);
    draft._saveTimer = window.setTimeout(function () {
      saveComposeDraft(state, draft).catch(function () {
        // Autosave is best-effort; Send is what the user is judged on, and
        // it sends the live field values rather than the saved copy.
      });
    }, 1200);
  }

  function saveComposeDraft(state, draft) {
    return api().saveDraft({
      id: draft.serverId,
      to: parseAddresses(draft.to),
      cc: parseAddresses(draft.cc),
      bcc: parseAddresses(draft.bcc),
      subject: draft.subject,
      bodyHtml: draft.bodyHtml,
      mode: draft.mode,
      inReplyTo: draft.inReplyTo,
    }).then(function (data) {
      if (data && data.draft) draft.serverId = data.draft.id;
      return data;
    });
  }

  function sendCompose(root, state, render, id) {
    var draft = findComposeDraft(state, id);
    if (!draft || draft.sending) return;

    var to = parseAddresses(draft.to);
    if (!to.length) {
      showEmailToast(root, 'Add at least one recipient');
      return;
    }

    window.clearTimeout(draft._saveTimer);
    draft.sending = true;
    render();

    api().send({
      to: to,
      cc: parseAddresses(draft.cc),
      bcc: parseAddresses(draft.bcc),
      subject: draft.subject || '',
      bodyHtml: draft.bodyHtml || '',
      draftId: draft.serverId,
      inReplyTo: draft.inReplyTo,
    }).then(function () {
      closeCompose(state, id);
      showEmailToast(root, 'Message sent');

      // Sent mail only shows up locally after a sync, so refresh the folder
      // the user is looking at.
      reloadMessages(root, state, render);
    }).catch(function (err) {
      draft.sending = false;
      reportMailError(state, err);
      render();
    });
  }

  /* Font sizes the "Text style" menu offers, as execCommand's 1–7 scale. */
  var COMPOSE_FONT_SIZES = [
    { label: 'Small', value: '2' },
    { label: 'Normal', value: '3' },
    { label: 'Large', value: '5' },
    { label: 'Huge', value: '6' },
  ];

  /* Text and highlight colours. Deliberately a short, legible set rather than
   * a full picker — this is a mail composer, not a design tool. */
  var COMPOSE_COLORS = [
    { label: 'Default', value: '#1c1c1c' },
    { label: 'Grey', value: '#667085' },
    { label: 'Red', value: '#b42318' },
    { label: 'Orange', value: '#b54708' },
    { label: 'Green', value: '#027a48' },
    { label: 'Blue', value: '#175cd3' },
    { label: 'Purple', value: '#6941c6' },
  ];

  var COMPOSE_HIGHLIGHTS = [
    { label: 'None', value: 'transparent' },
    { label: 'Yellow', value: '#fef7c3' },
    { label: 'Green', value: '#d3f8df' },
    { label: 'Blue', value: '#d1e9ff' },
    { label: 'Pink', value: '#fce7f6' },
  ];

  /* The tools behind the "More" button: the formatting that does not earn a
   * permanent slot on a narrow toolbar but still has to work. */
  var COMPOSE_MORE_TOOLS = [
    { label: 'Numbered list', cmd: 'insertOrderedList' },
    { label: 'Indent', cmd: 'indent' },
    { label: 'Outdent', cmd: 'outdent' },
    { label: 'Align left', cmd: 'justifyLeft' },
    { label: 'Align centre', cmd: 'justifyCenter' },
    { label: 'Align right', cmd: 'justifyRight' },
    { label: 'Remove link', cmd: 'unlink' },
    { label: 'Clear formatting', cmd: 'removeFormat' },
  ];

  function renderComposeToolbar() {
    var groups = [
      [
        { icon: 'ArrowUUpLeft', label: 'Undo', cmd: 'undo' },
        { icon: 'ArrowUUpRight', label: 'Redo', cmd: 'redo' },
      ],
      [
        { icon: 'TextT', label: 'Text style', caret: true, menu: 'style' },
        { icon: 'TextAa', label: 'Text colour', caret: true, menu: 'color' },
      ],
      [
        { icon: 'TextB', label: 'Bold', cmd: 'bold', state: 'bold' },
        { icon: 'TextItalic', label: 'Italic', cmd: 'italic', state: 'italic' },
        { icon: 'TextUnderline', label: 'Underline', cmd: 'underline', state: 'underline' },
        { icon: 'TextStrikethrough', label: 'Strikethrough', cmd: 'strikeThrough', state: 'strikeThrough' },
        { icon: 'ListBullets', label: 'Bulleted list', cmd: 'insertUnorderedList', state: 'insertUnorderedList' },
      ],
      [
        { icon: 'Link', label: 'Insert link', cmd: 'createLink' },
        { icon: 'DotsThree', label: 'More', menu: 'more' },
      ],
    ];

    return (
      '<div class="tma-dash__email-compose-toolbar">' +
      '<div class="tma-dash__email-compose-toolbar-left">' +
      groups
        .map(function (group, index) {
          var html =
            '<div class="tma-dash__email-compose-toolbar-group">' +
            group
              .map(function (item) {
                return (
                  '<button type="button" class="tma-dash__email-compose-tool' + (item.caret ? ' tma-dash__email-compose-tool--caret' : '') + '"' +
                  (item.cmd ? ' data-email-compose-tool-cmd="' + esc(item.cmd) + '"' : '') +
                  (item.menu ? ' data-email-compose-tool-menu="' + esc(item.menu) + '"' : '') +
                  // Marks the buttons whose pressed state tracks the cursor,
                  // so the toolbar shows what the text under it actually is.
                  (item.state ? ' data-email-compose-tool-state="' + esc(item.state) + '" aria-pressed="false"' : '') +
                  ' aria-label="' + esc(item.label) + '">' +
                  '<img src="' + esc(ICONS[item.icon]) + '" alt="">' +
                  (item.caret ? '<img class="tma-dash__email-compose-tool-caret" src="' + ICONS.CaretDown + '" alt="">' : '') +
                  '</button>'
                );
              })
              .join('') +
            '</div>';
          if (index < groups.length - 1) {
            html += '<span class="tma-dash__email-compose-toolbar-sep" aria-hidden="true"></span>';
          }
          return html;
        })
        .join('') +
      '</div>' +
      '<button type="button" class="tma-dash__email-compose-tool tma-dash__email-compose-tool--expand" aria-label="Expand editor">' +
      '<img src="' + ICONS.ArrowsOutSimple + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  /* The body a compose window opens with.
   *
   * Only a template the user actually picked, plus their configured signature.
   * This used to fall through to rendering the 'invoice' template into *every*
   * new message — a blank compose window arrived carrying a full invoice for a
   * client nobody had selected, which the user then had to delete by hand. */
  function defaultComposeBody(draft) {
    if (draft.templateId && window.TMAEmailTemplates) {
      return (
        '<div class="tma-dash__email-compose-template-body">' +
        window.TMAEmailTemplates.renderBody(draft.templateId) +
        '</div>'
      );
    }
    return composeSignatureHtml();
  }

  /* The user's configured signature, kept in its own block so it stays
   * identifiable rather than merging into whatever they type above it. */
  function composeSignatureHtml() {
    var signature = mailPreference('signature', '');
    if (!signature) return '';

    return (
      '<div class="tma-dash__email-compose-signature" data-email-signature>' +
      '<br>' + signature +
      '</div>'
    );
  }

  /* A real form: the recipient chips, static subject span and read-only body
   * the mock used are now inputs bound to the draft. */
  function renderComposeContent(draft) {
    var bodyHtml = draft.bodyHtml || defaultComposeBody(draft);

    function addressRow(field, label) {
      return (
        '<div class="tma-dash__email-compose-to">' +
        '<span class="tma-dash__email-compose-label">' + esc(label) + '</span>' +
        '<div class="tma-dash__email-compose-recipients">' +
        '<input type="text" class="tma-dash__email-compose-input"' +
        ' data-email-compose-field="' + esc(field) + '" data-email-compose-id="' + esc(draft.id) + '"' +
        ' value="' + esc(draft[field] || '') + '"' +
        ' autocomplete="off" spellcheck="false"' +
        ' aria-label="' + esc(label) + '" placeholder="name@example.com">' +
        '</div>' +
        (field === 'to'
          ? '<button type="button" class="tma-dash__email-compose-expand"' +
            ' data-email-compose-cc="' + esc(draft.id) + '"' +
            ' aria-expanded="' + (draft.showCc ? 'true' : 'false') + '"' +
            ' aria-label="Show Cc and Bcc">' +
            '<img src="' + ICONS.ArrowLineUpDown + '" alt="">' +
            '</button>'
          : '') +
        '</div>'
      );
    }

    return (
      '<div class="tma-dash__email-compose">' +
      '<div class="tma-dash__email-compose-headers">' +
      addressRow('to', 'To') +
      (draft.showCc ? addressRow('cc', 'Cc') + addressRow('bcc', 'Bcc') : '') +
      '<div class="tma-dash__email-compose-subject">' +
      '<span class="tma-dash__email-compose-label">Subject</span>' +
      '<input type="text" class="tma-dash__email-compose-input"' +
      ' data-email-compose-field="subject" data-email-compose-id="' + esc(draft.id) + '"' +
      ' value="' + esc(getComposeSubject(draft)) + '"' +
      ' aria-label="Subject" placeholder="Subject">' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-compose-editor">' +
      renderComposeToolbar() +
      '<div class="tma-dash__email-compose-body" contenteditable="true" role="textbox"' +
      ' aria-multiline="true" aria-label="Message body"' +
      ' data-email-compose-body="' + esc(draft.id) + '">' + bodyHtml + '</div>' +
      '<div class="tma-dash__email-compose-footer">' +
      '<div class="tma-dash__email-compose-attach">' +
      [
        { icon: 'Trash', label: 'Discard draft', discard: true },
        { icon: 'Image', label: 'Insert image' },
        { icon: 'Paperclip', label: 'Attach file' },
      ]
        .map(function (item) {
          var attrs = item.discard
            ? ' data-email-compose-discard="' + esc(draft.id) + '"'
            : '';
          return (
            '<button type="button" class="tma-dash__email-compose-attach-btn"' + attrs + ' aria-label="' + esc(item.label) + '">' +
            '<img src="' + esc(ICONS[item.icon]) + '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__email-compose-send">' +
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--late"' +
      ' data-email-compose-save="' + esc(draft.id) + '">Save draft</button>' +
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--primary"' +
      ' data-email-compose-send="' + esc(draft.id) + '"' + (draft.sending ? ' disabled' : '') + '>' +
      (draft.sending ? 'Sending…' : 'Send') + '</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* ── settings ────────────────────────────────────────────────────
   * The profile menu used to send the user to /settings, which meant leaving
   * the mailbox to change anything about it. It now opens here, over the
   * page, built from the same tma-dash__settings-* rows and switch the
   * Account settings rail uses.
   */

  function settingsSwitch(checked, label, attrs) {
    return '<label class="tma-dash__settings-switch">' +
      '<input class="tma-dash__settings-switch-input" type="checkbox"' + (checked ? ' checked' : '') +
      (attrs ? ' ' + attrs : '') +
      ' role="switch" aria-label="' + esc(label) + '">' +
      '<span class="tma-dash__settings-switch-ui" aria-hidden="true">' +
      '<span class="tma-dash__settings-switch-track"></span>' +
      '<span class="tma-dash__settings-switch-thumb"></span></span></label>';
  }

  function settingsRow(label, desc, control) {
    return (
      '<div class="tma-dash__settings-row">' +
      '<span class="tma-dash__settings-row-copy">' +
      '<span class="tma-dash__settings-row-label">' + esc(label) + '</span>' +
      (desc ? '<span class="tma-dash__settings-row-desc">' + esc(desc) + '</span>' : '') +
      '</span>' + (control || '') + '</div>'
    );
  }

  function renderMailboxSection(state) {
    var accounts = (state.settings && state.settings.accounts) || [];

    if (!accounts.length) {
      return (
        '<div class="tma-dash__email-settings-empty">' +
        '<p>No mailbox is connected.</p>' +
        '<a class="tma-dash__email-settings-btn tma-dash__email-settings-btn--primary"' +
        ' href="' + esc(api().connectUrl('google')) + '">Connect Google</a>' +
        '<a class="tma-dash__email-settings-btn"' +
        ' href="' + esc(api().connectUrl('microsoft')) + '">Connect Microsoft</a>' +
        '</div>'
      );
    }

    return accounts.map(function (account) {
      var name = account.provider === 'google' ? 'Google' : 'Microsoft';

      // The two states worth calling out: a grant too narrow to act on, and
      // a sync that actually failed.
      var warning = '';
      if (account.syncEnabled && !account.canWrite) {
        warning =
          '<p class="tma-dash__email-settings-warning">Connected for reading only. ' +
          'Reconnect to send and organise mail.</p>';
      } else if (account.status === 'error' && account.error) {
        warning = '<p class="tma-dash__email-settings-warning">' + esc(account.error) + '</p>';
      }

      var synced = account.syncedAt
        ? 'Last synced ' + new Date(account.syncedAt).toLocaleString()
        : 'Not synced yet';

      return (
        '<div class="tma-dash__email-settings-account">' +
        settingsRow(
          name + ' — ' + (account.email || 'unknown'),
          account.syncEnabled ? synced : 'Mail sync is off',
          settingsSwitch(account.syncEnabled, 'Sync mail from ' + name,
            'data-email-settings-sync="' + esc(account.provider) + '"')
        ) +
        warning +
        '<div class="tma-dash__email-settings-account-actions">' +
        '<button type="button" class="tma-dash__email-settings-btn" data-email-settings-syncnow>Sync now</button>' +
        '<a class="tma-dash__email-settings-btn" href="' + esc(api().connectUrl(account.provider)) + '">Reconnect</a>' +
        '</div></div>'
      );
    }).join('');
  }

  function renderEmailSettings(state) {
    if (!state.settingsOpen) return '';

    var prefs = (state.settings && state.settings.preferences) || {};
    var loading = !state.settings;

    return (
      '<div class="tma-dash__email-settings" data-email-settings role="dialog" aria-modal="true"' +
      ' aria-label="Email settings">' +
      '<button type="button" class="tma-dash__email-settings-scrim" data-email-settings-close aria-label="Close settings"></button>' +
      '<div class="tma-dash__email-settings-card">' +
      '<div class="tma-dash__email-settings-head">' +
      '<h2 class="tma-dash__email-settings-title">Email settings</h2>' +
      '<button type="button" class="tma-dash__email-settings-close" data-email-settings-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>' +
      '</div>' +

      (loading
        ? '<div class="tma-dash__email-settings-body"><p>Loading…</p></div>'
        : '<div class="tma-dash__email-settings-body">' +
          '<h3 class="tma-dash__email-settings-section">Mailbox</h3>' +
          renderMailboxSection(state) +

          '<h3 class="tma-dash__email-settings-section">Reading</h3>' +
          settingsRow('Conversation view', 'Group replies into a single thread.',
            settingsSwitch(prefs.conversationView, 'Conversation view',
              'data-email-pref="conversationView"')) +
          settingsRow('Preview pane', 'Show the message beside the list.',
            settingsSwitch(prefs.previewPane, 'Preview pane', 'data-email-pref="previewPane"')) +
          settingsRow('Read receipts', 'Ask senders to confirm you opened their mail.',
            settingsSwitch(prefs.readReceipts, 'Read receipts', 'data-email-pref="readReceipts"')) +

          '<h3 class="tma-dash__email-settings-section">Sending</h3>' +
          settingsRow('Undo send window', 'Seconds to cancel a message after sending.',
            '<input type="number" class="tma-dash__email-settings-number" min="0" max="30"' +
            ' value="' + esc(prefs.undoSendSeconds == null ? 5 : prefs.undoSendSeconds) + '"' +
            ' data-email-pref-number="undoSendSeconds" aria-label="Undo send window in seconds">') +

          '<div class="tma-dash__email-settings-field">' +
          '<label class="tma-dash__settings-row-label" for="tma-mail-signature">Signature</label>' +
          '<textarea id="tma-mail-signature" class="tma-dash__email-settings-textarea" rows="4"' +
          ' data-email-pref-text="signature"' +
          ' placeholder="Appended to messages you send">' + esc(prefs.signature || '') + '</textarea>' +
          '</div>' +
          '</div>') +

      '</div></div>'
    );
  }

  function openEmailSettings(root, state, render) {
    state.settingsOpen = true;
    render();

    // The panel is modal, so Escape has to work wherever focus happens to be.
    // The page's other Escape handling is bound to the email mount, which a
    // click on the scrim or a blurred field leaves behind.
    if (!state._settingsEscBound) {
      state._settingsEscBound = true;
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !state.settingsOpen) return;
        event.preventDefault();
        state.settingsOpen = false;
        if (state.render) state.render();
      });
    }

    // Move focus into the dialog so screen readers land there and the first
    // Escape is heard even if the trigger button is gone.
    window.requestAnimationFrame(function () {
      var card = root.querySelector('[data-email-settings] .tma-dash__email-settings-close');
      if (card) card.focus();
    });

    api().getSettings().then(function (data) {
      state.settings = data;
      render();
    }).catch(function (err) {
      state.settingsOpen = false;
      reportMailError(state, err);
      render();
    });
  }

  /* Preferences save on change — there is no Save button to forget. */
  function saveEmailPreference(root, state, key, value) {
    if (!state.settings) return;
    state.settings.preferences[key] = value;

    var payload = {};
    payload[key] = value;

    api().saveSettings({ preferences: payload }).then(function (data) {
      state.settings = data;
    }).catch(function (err) {
      reportMailError(state, err);
    });
  }

  function wireEmailSettings(root, state, render) {
    MORPH.unwired(root, '[data-email-open-settings]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEmailSettings(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-settings-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settingsOpen = false;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-settings-sync]').forEach(function (input) {
      input.addEventListener('change', function () {
        var provider = input.getAttribute('data-email-settings-sync');
        api().saveSettings({ provider: provider, syncEnabled: input.checked })
          .then(function (data) {
            state.settings = data;
            render();
            // Turning sync on backfills the mailbox, so reload what it found.
            if (input.checked) bootstrapMailbox(root, state, render);
          })
          .catch(function (err) {
            input.checked = !input.checked;
            reportMailError(state, err);
          });
      });
    });

    MORPH.unwired(root, '[data-email-settings-syncnow]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Syncing…';

        api().sync().then(function (data) {
          if (data && data.folders) state.folderCounts = data.folders;
          showEmailToast(root, 'Synced ' + (data && data.synced ? data.synced : 0) + ' messages');
          reloadMessages(root, state, render);
          return api().getSettings();
        }).then(function (data) {
          state.settings = data;
          render();
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Sync now';
          reportMailError(state, err);
        });
      });
    });

    MORPH.unwired(root, '[data-email-pref]').forEach(function (input) {
      input.addEventListener('change', function () {
        saveEmailPreference(root, state, input.getAttribute('data-email-pref'), input.checked);
      });
    });

    MORPH.unwired(root, '[data-email-pref-number]').forEach(function (input) {
      input.addEventListener('change', function () {
        var value = Math.max(0, Math.min(30, parseInt(input.value, 10) || 0));
        input.value = value;
        saveEmailPreference(root, state, input.getAttribute('data-email-pref-number'), value);
      });
    });

    MORPH.unwired(root, '[data-email-pref-text]').forEach(function (input) {
      // Signatures are long; save on blur rather than per keystroke.
      input.addEventListener('blur', function () {
        saveEmailPreference(root, state, input.getAttribute('data-email-pref-text'), input.value);
      });
    });
  }

  function syncEmailUrl(folder) {
    var next = folder === 'templates' ? '/email/templates' : '/email';
    var current = window.location.pathname.replace(/\/$/, '') || '/';
    if (current === next) return;
    history.pushState(
      { navId: 'email', view: 'email', title: 'Email', crumb: folder === 'templates' ? 'Email / Templates' : 'Email' },
      '',
      next
    );
  }

  function closeEmailProfileMenu(root, state) {
    if (!state.profileMenuOpen) return;
    state.profileMenuOpen = false;
    state.profileMenuVariant = null;
    var dash = getEmailDashRoot(root);
    var scopes = [root];
    if (dash && scopes.indexOf(dash) === -1) scopes.push(dash);
    scopes.forEach(function (scope) {
      scope.querySelectorAll('[data-email-profile-menu]').forEach(function (menu) {
        menu.hidden = true;
      });
      scope.querySelectorAll('[data-email-profile-toggle]').forEach(function (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function openEmailProfileMenu(root, state, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    closeEmailBulkMoreMenu(root, state);
    closeEmailLabelPopup(root, state);
    state.profileMenuOpen = true;
    state.profileMenuVariant = toggle.closest('[data-email-header-profile]') ? 'topbar' : 'sidebar';
    toggle.setAttribute('aria-expanded', 'true');
    var wrap = toggle.closest('.tma-dash__email-profile-wrap');
    var menu = wrap && wrap.querySelector('[data-email-profile-menu]');
    if (menu) {
      menu.hidden = false;
      menu.style.minWidth = Math.max(Math.round(toggle.getBoundingClientRect().width), 260) + 'px';
      positionEmailPopupMenu(toggle, menu);
    }
  }

  function getEmailDashRoot(root) {
    return root.closest('.tma-dash');
  }

  function renderEmailSearchMarkup(state) {
    var searchCls = 'tma-dash__email-search';
    if (state.searchFocused || state.search) searchCls += ' tma-dash__email-search--focused';
    if (state.search) searchCls += ' tma-dash__email-search--has-value';
    if (state.searchLoading) searchCls += ' tma-dash__email-search--loading';

    return (
      '<div class="' + searchCls + '" role="search" aria-label="Search mail">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="" aria-hidden="true">' +
      '<input type="search" class="tma-dash__email-search-input" data-email-search placeholder="Search in mail" value="' + esc(state.search || '') + '" aria-label="Search in mail">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-email-search-clear><img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      '<kbd class="tma-dash__kbd" data-email-search-shortcut aria-hidden="true">/</kbd>' +
      '</div>'
    );
  }

  function updateEmailSearchWrap(scope, state) {
    var searchWrap = scope.querySelector('.tma-dash__email-search');
    if (!searchWrap) return;
    searchWrap.classList.toggle('tma-dash__email-search--focused', !!(state.searchFocused || state.search));
    searchWrap.classList.toggle('tma-dash__email-search--has-value', !!state.search);
    searchWrap.classList.toggle('tma-dash__email-search--loading', !!state.searchLoading);
  }

  function ensureEmailHeaderSearch(root, state) {
    var dash = getEmailDashRoot(root);
    if (!dash) return null;
    var header = dash.querySelector('.tma-dash__header');
    if (!header) return null;

    var slot = header.querySelector('.tma-dash__header-center');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'tma-dash__header-center';
      var right = header.querySelector('.tma-dash__header-right');
      header.insertBefore(slot, right);
    }

    header.querySelectorAll('.tma-dash__header-center').forEach(function (el) {
      if (el !== slot) el.remove();
    });

    if (!slot._defaultSearchHtml && slot.querySelector('[data-action="open-search"]')) {
      slot._defaultSearchHtml = slot.innerHTML;
    }

    slot.className = 'tma-dash__header-center';
    slot.setAttribute('data-email-header-search', '');

    var activeSearch = slot.querySelector('[data-email-search]');
    if (activeSearch && document.activeElement === activeSearch) {
      updateEmailSearchWrap(slot, state);
    } else {
      slot.innerHTML = renderEmailSearchMarkup(state);
    }

    slot.hidden = false;
    return slot;
  }

  function syncEmailHeaderSearch(root, state) {
    var view = root.closest('[data-view="email"]');
    var onEmailPage = view && !view.hidden;
    if (onEmailPage) {
      ensureEmailHeaderSearch(root, state);
    } else {
      restoreHeaderSearch(root);
    }
  }

  function teardownEmailMobileHeader(dash) {
    if (!dash) return;
    dash.classList.remove(
      'tma-dash--email-mobile',
      'tma-dash--email-mobile-reading',
      'tma-dash--email-profile-sidebar-open',
      'tma-dash--email-compose-open'
    );
    var profileSlot = dash.querySelector('[data-email-header-profile]');
    if (profileSlot) {
      profileSlot.hidden = true;
      profileSlot.innerHTML = '';
    }
    var readingBackSlot = dash.querySelector('[data-email-header-reading-back]');
    if (readingBackSlot) {
      readingBackSlot.hidden = true;
      readingBackSlot.innerHTML = '';
    }
    var readingToolsSlot = dash.querySelector('[data-email-header-reading-tools]');
    if (readingToolsSlot) {
      readingToolsSlot.hidden = true;
      readingToolsSlot.innerHTML = '';
    }
    var legacyReadingSlot = dash.querySelector('[data-email-header-reading-actions]');
    if (legacyReadingSlot) legacyReadingSlot.remove();
    var settingsBtn = dash.querySelector('[data-email-settings]');
    if (settingsBtn) settingsBtn.remove();
  }

  function restoreHeaderSearch(root) {
    var dash = root && root.classList && root.classList.contains('tma-dash') ? root : getEmailDashRoot(root);
    if (!dash) return;
    teardownEmailMobileHeader(dash);
    var header = dash.querySelector('.tma-dash__header');
    if (!header) return;

    header.querySelectorAll('.tma-dash__header-center').forEach(function (el, index) {
      if (index > 0) el.remove();
    });

    var slot = header.querySelector('.tma-dash__header-center');
    if (!slot) return;

    header.querySelectorAll('.tma-dash__email-search').forEach(function (el) {
      if (!slot.contains(el)) {
        var wrap = el.closest('.tma-dash__header-center');
        if (wrap) wrap.remove();
      }
    });

    if (!slot._defaultSearchHtml) {
      slot.removeAttribute('data-email-header-search');
      return;
    }

    slot.innerHTML = slot._defaultSearchHtml;
    slot.removeAttribute('data-email-header-search');
  }

  function rowListAvatarInner(row) {
    if (row.brand) {
      return '<span class="tma-dash__email-row-icon"><img src="' + esc(brandSrc(row.brand)) + '" alt=""></span>';
    }
    // The sender's real photo, when we have one. Falls back to initials on a
    // load error so a dead URL never leaves an empty circle. Wired as a real
    // listener (see wireListRows), not an inline onerror string — embedding a
    // JSON.stringify()'d value there put literal double quotes inside this
    // double-quoted attribute, which silently truncated the handler.
    if (row.avatarUrl) {
      var initial = (row.sender || '?').charAt(0).toUpperCase();
      return (
        '<span class="tma-dash__email-row-avatar">' +
        '<img src="' + esc(row.avatarUrl) + '" alt="" data-email-row-avatar-fallback="' + esc(initial) + '">' +
        '</span>'
      );
    }
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-row-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    // No photo for this sender — draw the portal's initials avatar, coloured
    // per address so each correspondent is recognisable at a glance.
    return '<span class="tma-dash__email-row-avatar">' +
      '<img src="' + esc(senderInitials(row)) + '" alt="" aria-hidden="true">' +
      '</span>';
  }

  /* Initials avatar for a message's sender, via the shared generator. */
  function senderInitials(row) {
    var name = row.sender || row.email || '?';
    var seed = row.email || name;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsFor) {
      return window.TMACurrentUser.initialsFor(name, seed);
    }
    return '';
  }

  function rowListAvatar(row, state) {
    var inner = rowListAvatarInner(row);
    if (!isEmailMobile()) return inner;

    var checked = state && isRowChecked(row, state);
    var btnCls = 'tma-dash__email-row-avatar-btn';
    if (checked) btnCls += ' tma-dash__email-row-avatar-btn--selected';

    return (
      '<button type="button" class="' + btnCls + '" data-email-avatar-select' +
      ' aria-pressed="' + (checked ? 'true' : 'false') + '"' +
      ' aria-label="Select ' + esc(row.sender) + '">' +
      inner +
      (checked
        ? '<span class="tma-dash__email-row-avatar-check" aria-hidden="true"><img src="' + ICONS.Check + '" alt=""></span>'
        : '') +
      '</button>'
    );
  }

  function isEmailRowSelectTarget(el) {
    return !!(
      el.closest('[data-email-check]') ||
      el.closest('.tma-dash__email-list-check') ||
      el.closest('[data-email-avatar-select]')
    );
  }

  function renderEmailRowMobileStar(row, state) {
    var starred = isRowStarred(row, state);
    return renderEmailIconTooltipBtn({
      tipId: 'email-row-tip-star-mobile-' + row.id,
      label: starred ? 'Remove star' : 'Add star',
      className:
        'tma-dash__email-row-action tma-dash__email-row-star-mobile' +
        (starred ? ' tma-dash__email-row-action--active' : ''),
      attrs: ' data-email-star="' + esc(row.id) + '" aria-pressed="' + (starred ? 'true' : 'false') + '"',
      innerHtml: '<img src="' + ICONS.Star + '" alt="">',
    });
  }

  function renderEmailMobileChrome(state) {
    var html = '';
    if (state.mobileNavOpen || state.profileSidebarOpen) {
      html += '<button type="button" class="tma-dash__email-mobile-scrim" data-email-mobile-scrim aria-label="Close menu"></button>';
    }
    if (isEmailMobile() && !isSingleReading(state)) {
      html +=
        '<button type="button" class="tma-dash__email-mobile-fab" data-email-mobile-compose aria-label="Compose">' +
        '<img src="' + ICONS.PencilSimpleLine + '" alt="">' +
        '<span>Compose</span>' +
        '</button>';
    }
    return html;
  }

  function ensureEmailMobileHeader(root, state) {
    var dash = getEmailDashRoot(root);
    if (!dash) return;
    var mobile = isEmailMobile();
    var reading = mobile && isSingleReading(state);
    var bulkActive = isEmailBulkActive(state);

    dash.classList.toggle('tma-dash--email-mobile', mobile);
    dash.classList.toggle('tma-dash--email-mobile-reading', reading);
    dash.classList.toggle('tma-dash--email-mobile-bulk', bulkActive);
    dash.classList.toggle('tma-dash--email-profile-sidebar-open', !!state.profileSidebarOpen);
    dash.classList.toggle(
      'tma-dash--email-compose-open',
      mobile && state.composeDrafts.some(function (draft) { return !draft.minimized; })
    );

    var headerLeft = dash.querySelector('.tma-dash__header-left');
    if (headerLeft) {
      var legacyMenuBtn = headerLeft.querySelector('[data-email-mobile-menu]');
      if (legacyMenuBtn) legacyMenuBtn.remove();

      var readingBackSlot = headerLeft.querySelector('[data-email-header-reading-back]');
      if (!readingBackSlot) {
        readingBackSlot = document.createElement('div');
        readingBackSlot.setAttribute('data-email-header-reading-back', '');
        readingBackSlot.hidden = true;
        var toggleBtn = headerLeft.querySelector('[data-action="toggle-sidebar"]');
        if (toggleBtn) headerLeft.insertBefore(readingBackSlot, toggleBtn.nextSibling);
        else headerLeft.appendChild(readingBackSlot);
      }

      var legacyReadingSlot = headerLeft.querySelector('[data-email-header-reading-actions]');
      if (legacyReadingSlot) legacyReadingSlot.remove();

      if (reading) {
        readingBackSlot.hidden = false;
        readingBackSlot.innerHTML = renderEmailHeaderReadingBack(state);
      } else if (bulkActive) {
        readingBackSlot.hidden = false;
        readingBackSlot.innerHTML = renderEmailHeaderBulkClose();
      } else {
        readingBackSlot.hidden = true;
        readingBackSlot.innerHTML = '';
      }
    }

    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();

    var headerRight = dash.querySelector('.tma-dash__header-right');
    if (headerRight) {
      var readingToolsSlot = headerRight.querySelector('[data-email-header-reading-tools]');
      if (!readingToolsSlot) {
        readingToolsSlot = document.createElement('div');
        readingToolsSlot.setAttribute('data-email-header-reading-tools', '');
        readingToolsSlot.hidden = true;
        headerRight.insertBefore(readingToolsSlot, headerRight.firstChild);
      }

      var profileSlot = headerRight.querySelector('[data-email-header-profile]');
      if (!profileSlot) {
        profileSlot = document.createElement('div');
        profileSlot.setAttribute('data-email-header-profile', '');
        headerRight.insertBefore(profileSlot, readingToolsSlot.nextSibling);
      }

      if (reading) {
        readingToolsSlot.hidden = false;
        readingToolsSlot.innerHTML = renderEmailHeaderReadingTools(state);
        profileSlot.hidden = true;
        profileSlot.innerHTML = '';
      } else if (bulkActive) {
        readingToolsSlot.hidden = false;
        readingToolsSlot.innerHTML = renderEmailHeaderBulkTools(state);
        profileSlot.hidden = true;
        profileSlot.innerHTML = '';
      } else {
        readingToolsSlot.hidden = true;
        readingToolsSlot.innerHTML = '';
        if (mobile) {
          profileSlot.hidden = false;
          profileSlot.innerHTML = renderEmailHeaderProfileBtn(state);
        } else {
          profileSlot.hidden = true;
          profileSlot.innerHTML = '';
        }
      }
    }
  }

  // Subject stands on its own line now (see .tma-dash__email-row-content in
  // CSS) — the preview text runs in the separate .snippet line below it, not
  // concatenated here with a " - " separator the way it used to be.
  function renderRowSubjectBody(lines) {
    var subject = lines.subject || '';
    return (
      '<span class="tma-dash__email-row-subject">' +
      '<span class="tma-dash__email-row-subject-text">' + esc(subject) + '</span>' +
      '</span>'
    );
  }

  function ensureEmailToast(dash) {
    if (!dash || dash.querySelector('[data-email-toast]')) return;
    var toast = document.createElement('div');
    toast.className = 'tma-dash__email-toast';
    toast.setAttribute('data-email-toast', '');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    toast.innerHTML =
      '<img src="' + ICONS.CheckCircle + '" alt="">' +
      '<span data-email-toast-text></span>';
    dash.appendChild(toast);
  }

  function showEmailToast(root, message) {
    var dash = getEmailDashRoot(root) || root.closest('.tma-dash');
    if (!dash) return;
    ensureEmailToast(dash);
    var toast = dash.querySelector('[data-email-toast]');
    var text = dash.querySelector('[data-email-toast-text]');
    if (!toast || !text) return;
    text.textContent = message;
    toast.hidden = false;
    window.requestAnimationFrame(function () {
      toast.classList.add('tma-dash__email-toast--visible');
    });
    window.clearTimeout(dash._emailToastTimer);
    dash._emailToastTimer = window.setTimeout(function () {
      toast.classList.remove('tma-dash__email-toast--visible');
      window.setTimeout(function () {
        toast.hidden = true;
      }, 240);
    }, 2800);
  }

  function animateEmailRowDismiss(wrap, destination, callback) {
    if (!wrap) {
      if (callback) callback();
      return;
    }
    var track = wrap.querySelector('[data-email-row-swipe-track]');
    var max = wrap.offsetWidth || 0;
    var isDelete = destination === 'trash';
    wrap.style.setProperty('--email-swipe-row-h', wrap.offsetHeight + 'px');
    wrap.classList.remove('is-dragging', 'is-open-left', 'is-open-right');
    wrap.classList.add(isDelete ? 'is-deleting' : 'is-archiving');
    if (isDelete) {
      wrap.style.setProperty('--email-swipe-delete-width', max + 'px');
      wrap.classList.add('is-delete-wide');
      if (track) track.style.transform = 'translateX(-' + max + 'px)';
    } else {
      wrap.style.setProperty('--email-swipe-archive-width', max + 'px');
      wrap.classList.add('is-archive-wide');
      if (track) track.style.transform = 'translateX(' + max + 'px)';
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (callback) callback();
    }

    window.setTimeout(function () {
      wrap.classList.add('is-dismissing--collapse');
      function onCollapseEnd(e) {
        if (e.target !== wrap || e.propertyName !== 'max-height') return;
        wrap.removeEventListener('transitionend', onCollapseEnd);
        finish();
      }
      wrap.addEventListener('transitionend', onCollapseEnd);
      window.setTimeout(finish, 360);
    }, 280);
    window.setTimeout(finish, 720);
  }

  function commitEmailRowAction(root, state, render, id, destination) {
    dismissEmailRow(state, id, destination);
    if (destination === 'trash') showEmailToast(root, 'Message deleted');
    else if (destination === 'archive') showEmailToast(root, 'Message archived');
    if (state.folder === 'inbox') updateInboxList(root, state, render);
    else render();
    var dashRoot = getEmailDashRoot(root);
    if (dashRoot && typeof dashRoot._syncTabBarBadges === 'function') dashRoot._syncTabBarBadges();
  }

  function applyEmailRowAction(root, state, render, id, destination, wrap) {
    if (!id || (wrap && (wrap.classList.contains('is-deleting') || wrap.classList.contains('is-archiving')))) return;
    closeEmailRowSwipes(root);
    if ((destination === 'trash' || destination === 'archive') && wrap) {
      animateEmailRowDismiss(wrap, destination, function () {
        commitEmailRowAction(root, state, render, id, destination);
      });
      return;
    }
    commitEmailRowAction(root, state, render, id, destination);
  }

  /* Moving a message out of the current folder drops it from the list and
   * tells the provider. On failure the row is put back, because a message
   * that silently stayed where it was would otherwise look archived. */
  function dismissEmailRow(state, id, destination) {
    if (!id) return;

    var rows = rowsOf(state);
    var at = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { at = i; break; }
    }
    if (at === -1) return;

    var row = rows[at];
    rows.splice(at, 1);
    delete state.checkedIds[id];
    if (state.selectedId === id) {
      state.selectedId = null;
      state.reading = false;
    }

    adjustFolderCount(state, state.folder, -1, row.unread);
    adjustFolderCount(state, destination, 1, row.unread);

    api().move(id, destination).then(function (data) {
      if (data && data.folders) state.folderCounts = data.folders;
    }).catch(function (err) {
      rows.splice(at, 0, row);
      adjustFolderCount(state, state.folder, 1, row.unread);
      adjustFolderCount(state, destination, -1, row.unread);
      reportMailError(state, err);
      if (state.render) state.render();
    });
  }

  /* One toolbar action across a selection.
   *
   * The mock only ever wired read/unread here; archive, spam and delete drew
   * a button that did nothing. All of them now go through /portal/mail/bulk,
   * which applies them message by message and reports how many failed. */
  function applyBulkAction(root, state, render, ids, action) {
    if (!ids.length) return;

    var removes = ['archive', 'spam', 'trash', 'delete'].indexOf(action) !== -1;

    // Snapshot enough to restore the list if the call fails.
    var before = rowsOf(state).slice();

    if (removes) {
      state.rows = rowsOf(state).filter(function (row) {
        return ids.indexOf(row.id) === -1;
      });
      clearEmailSelection(state);
    } else {
      ids.forEach(function (id) {
        var row = findRow(state, id);
        if (!row) return;
        if (action === 'read' || action === 'unread') row.unread = action === 'unread';
        if (action === 'star' || action === 'unstar') row.starred = action === 'star';
      });
    }

    render();

    api().bulk(ids, action).then(function (data) {
      if (data && data.folders) state.folderCounts = data.folders;

      if (data && data.failed) {
        showEmailToast(root, data.failed + ' of ' + ids.length + " couldn't be updated");
        reloadMessages(root, state, render);
        return;
      }

      render();
    }).catch(function (err) {
      state.rows = before;
      reportMailError(state, err);
      render();
    });
  }

  /* Keeps the sidebar badges honest between server round trips. */
  function adjustFolderCount(state, folder, delta, wasUnread) {
    if (!state.folderCounts || !state.folderCounts[folder]) return;
    var counts = state.folderCounts[folder];
    counts.total = Math.max(0, (counts.total || 0) + delta);
    if (wasUnread) counts.unread = Math.max(0, (counts.unread || 0) + delta);
  }

  function buildEmailRowSwipeWrap(row, state, rowHtml) {
    var rowId = row.id;
    return (
      '<div class="tma-dash__email-row-swipe" data-email-row-swipe="' + esc(rowId) + '">' +
      '<div class="tma-dash__email-row-swipe-actions tma-dash__email-row-swipe-actions--left" aria-hidden="true">' +
      '<button type="button" class="tma-dash__email-row-swipe-action tma-dash__email-row-swipe-action--archive"' +
      ' data-email-row-swipe-action="archive" data-email-row-id="' + esc(rowId) + '" aria-label="Archive">Archive</button>' +
      '</div>' +
      '<div class="tma-dash__email-row-swipe-actions tma-dash__email-row-swipe-actions--right" aria-hidden="true">' +
      '<button type="button" class="tma-dash__email-row-swipe-action tma-dash__email-row-swipe-action--delete"' +
      ' data-email-row-swipe-action="delete" data-email-row-id="' + esc(rowId) + '" aria-label="Delete">' +
      '<img class="tma-dash__email-row-swipe-delete-icon" src="' + ICONS.Trash + '" alt="" width="24" height="24">' +
      '</button></div>' +
      '<div class="tma-dash__email-row-swipe-track" data-email-row-swipe-track tabindex="0" role="group" aria-label="Email message">' +
      rowHtml +
      '</div></div>'
    );
  }

  function closeEmailRowSwipes(root, except) {
    if (!root) return;
    root.querySelectorAll('[data-email-row-swipe]').forEach(function (wrap) {
      if (except && wrap === except) return;
      if (!wrap.classList.contains('is-open-left') && !wrap.classList.contains('is-open-right')) return;
      wrap.classList.remove('is-open-left', 'is-open-right', 'is-delete-wide', 'is-archive-wide', 'is-dragging');
      wrap.style.removeProperty('--email-swipe-delete-width');
      wrap.style.removeProperty('--email-swipe-archive-width');
      var track = wrap.querySelector('[data-email-row-swipe-track]');
      if (track) track.style.transform = '';
    });
  }

  function bindEmailRowSwipes(root, state, render) {
    if (!isEmailMobile()) return;

    root.querySelectorAll('[data-email-row-swipe]').forEach(function (wrap) {
      if (wrap.dataset.swipeBound) return;
      wrap.dataset.swipeBound = '1';

      var track = wrap.querySelector('[data-email-row-swipe-track]');
      if (!track) return;

      var startX = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;

      function swipeMaxWidth() {
        return wrap.offsetWidth || 0;
      }

      function archiveSnapWidth() {
        return 100;
      }

      function deleteSnapWidth() {
        return 72;
      }

      function syncArchiveReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--email-swipe-archive-width');
          wrap.classList.remove('is-archive-wide');
          return 0;
        }
        wrap.style.setProperty('--email-swipe-archive-width', width + 'px');
        wrap.classList.toggle('is-archive-wide', width >= max * 0.92);
        return width;
      }

      function resetArchiveReveal() {
        wrap.style.removeProperty('--email-swipe-archive-width');
        wrap.classList.remove('is-archive-wide');
      }

      function syncDeleteReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--email-swipe-delete-width');
          wrap.classList.remove('is-delete-wide');
          return 0;
        }
        wrap.style.setProperty('--email-swipe-delete-width', width + 'px');
        wrap.classList.toggle('is-delete-wide', width >= max * 0.92);
        return width;
      }

      function resetDeleteReveal() {
        wrap.style.removeProperty('--email-swipe-delete-width');
        wrap.classList.remove('is-delete-wide');
      }

      function setOffset(px) {
        var max = swipeMaxWidth();
        var clamped = Math.max(-max, Math.min(max, px));

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          resetDeleteReveal();
          resetArchiveReveal();
          wrap.classList.remove('is-open-left', 'is-open-right');
          return 0;
        }

        if (clamped > 0) {
          resetDeleteReveal();
          var archiveReveal = syncArchiveReveal(clamped);
          track.style.transform = 'translateX(' + archiveReveal + 'px)';
          wrap.classList.toggle('is-open-left', archiveReveal > 8);
          wrap.classList.remove('is-open-right');
          return archiveReveal;
        }

        resetArchiveReveal();
        var deleteReveal = syncDeleteReveal(Math.abs(clamped));
        track.style.transform = 'translateX(-' + deleteReveal + 'px)';
        wrap.classList.remove('is-open-left');
        wrap.classList.toggle('is-open-right', deleteReveal > 8);
        return -deleteReveal;
      }

      function snapOpen(direction) {
        closeEmailRowSwipes(root, wrap);
        if (direction === 'left') {
          var snap = archiveSnapWidth();
          syncArchiveReveal(snap);
          track.style.transform = 'translateX(' + snap + 'px)';
          wrap.classList.add('is-open-left');
        } else if (direction === 'right') {
          var deleteSnap = deleteSnapWidth();
          syncDeleteReveal(deleteSnap);
          track.style.transform = 'translateX(-' + deleteSnap + 'px)';
          wrap.classList.add('is-open-right');
        }
      }

      function closeSwipe() {
        wrap.classList.remove('is-open-left', 'is-open-right', 'is-delete-wide', 'is-archive-wide', 'is-dragging');
        resetDeleteReveal();
        resetArchiveReveal();
        track.style.transform = '';
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isEmailRowSelectTarget(e.target)) return;
        if (e.target.closest('.tma-dash__email-row-action')) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        startOffset = match ? parseFloat(match[1]) : 0;
        wrap.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var delta = e.clientX - startX;
        if (Math.abs(delta) > 6) moved = true;
        setOffset(startOffset + delta);
      });

      function openEmailRowFromSwipe(wrap, id) {
        if (!id) return;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      }

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove('is-dragging');
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);

        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        var current = match ? parseFloat(match[1]) : 0;
        var max = swipeMaxWidth();
        var id = wrap.getAttribute('data-email-row-swipe');
        var wasTap = !moved;

        if (current >= max * 0.75) {
          applyEmailRowAction(root, state, render, id, 'archive', wrap);
          return;
        }
        if (current <= -max * 0.75) {
          applyEmailRowAction(root, state, render, id, 'trash', wrap);
          return;
        }

        if (current > max * 0.35) snapOpen('left');
        else if (current < -max * 0.35) snapOpen('right');
        else closeSwipe();

        if (
          moved &&
          (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right'))
        ) {
          wrap.dataset.swipeMoved = '1';
          window.requestAnimationFrame(function () {
            delete wrap.dataset.swipeMoved;
          });
          return;
        }

        if (!wasTap) return;
        if (isEmailRowSelectTarget(e.target)) return;
        if (e.target.closest('.tma-dash__email-row-action')) return;
        if (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right')) {
          closeEmailRowSwipes(root);
          return;
        }
        wrap.dataset.tapHandled = '1';
        window.requestAnimationFrame(function () {
          delete wrap.dataset.tapHandled;
        });
        openEmailRowFromSwipe(wrap, id);
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);
    });

    MORPH.unwired(root, '[data-email-row-swipe-action]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-email-row-swipe-action');
        var id = btn.getAttribute('data-email-row-id');
        var wrap = btn.closest('[data-email-row-swipe]');
        applyEmailRowAction(root, state, render, id, action === 'delete' ? 'trash' : 'archive', wrap);
      });
    });

    if (!root.dataset.emailSwipeDismissBound) {
      root.dataset.emailSwipeDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-email-row-swipe]')) closeEmailRowSwipes(root);
      });
    }
  }

  function buildInboxRowHtml(row, state) {
    var active = state.selectedId === row.id;
    var unread = isRowUnread(row, state);
    var checked = isRowChecked(row, state);
    var lines = rowListLines(row);
    var rowCls = 'tma-dash__email-row';
    if (active) rowCls += ' tma-dash__email-row--active';
    if (unread) rowCls += ' tma-dash__email-row--unread';
    else rowCls += ' tma-dash__email-row--read';
    if (checked) rowCls += ' tma-dash__email-row--selected';

    var rowHtml =
      '<div class="' + rowCls + '" data-email-row="' + esc(row.id) + '" role="button" tabindex="0">' +
      '<label class="tma-dash__email-list-check">' +
      '<input type="checkbox" class="tma-dash__check" data-email-check' + (checked ? ' checked' : '') + ' aria-label="Select ' + esc(row.sender) + '">' +
      '</label>' +
      renderEmailRowFrontActions(row, state) +
      rowListAvatar(row, state) +
      '<div class="tma-dash__email-row-content">' +
      '<div class="tma-dash__email-row-head">' +
      '<span class="tma-dash__email-row-sender">' + esc(row.sender) + '</span>' +
      renderInboxRowLabelChips(row.id, state) +
      '</div>' +
      renderRowSubjectBody(lines) +
      '<div class="tma-dash__email-row-snippet">' + esc(lines.body) + '</div>' +
      renderRowAttachmentChips(row) +
      '</div>' +
      '<div class="tma-dash__email-row-side">' +
      '<div class="tma-dash__email-row-actions-bar">' +
      renderEmailRowHoverActions(row, state) +
      '</div>' +
      '<div class="tma-dash__email-row-side-top">' +
      '<span class="tma-dash__email-row-time">' + esc(row.time) + '</span>' +
      (unread ? '<span class="tma-dash__email-row-unread" aria-hidden="true"></span>' : '') +
      '</div>' +
      renderEmailRowMobileStar(row, state) +
      '</div>' +
      '</div>';

    if (isEmailMobile() && state.folder === 'inbox') {
      return buildEmailRowSwipeWrap(row, state, rowHtml);
    }
    return rowHtml;
  }

  function updateInboxList(root, state, render) {
    if (state.folder !== 'inbox') {
      render();
      return;
    }

    var listBody = root.querySelector('.tma-dash__email-list-body');
    if (!listBody) {
      render();
      return;
    }

    var rows = filteredInbox(state);
    MORPH.patch(listBody, rows.map(function (row) {
      return buildInboxRowHtml(row, state);
    }).join(''));

    var selectAll = root.querySelector('[data-email-selectall]');
    if (selectAll) {
      var allChecked = rows.length > 0 && rows.every(function (row) { return isRowChecked(row, state); });
      selectAll.checked = allChecked;
      selectAll.indeterminate = false;
    }

    wireListRows(root, state, render);
  }

  function wireListRows(root, state, render) {
    // A broken sender photo falls back to initials. Bound once on root (rows
    // are re-created every render) via capture, since `error` does not bubble.
    if (!root._avatarFallbackWired) {
      root._avatarFallbackWired = true;
      root.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || !img.matches || !img.matches('[data-email-row-avatar-fallback]')) return;
        var wrap = img.parentNode;
        if (!wrap) return;
        wrap.classList.add('tma-dash__email-row-avatar--initial');
        wrap.textContent = img.getAttribute('data-email-row-avatar-fallback') || '?';
      }, true);
    }

    MORPH.unwired(root, '[data-email-row]').forEach(function (rowEl) {
      rowEl.addEventListener('click', function (event) {
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        var swipeWrap = rowEl.closest('[data-email-row-swipe]');
        if (swipeWrap && swipeWrap.dataset.tapHandled) return;
        if (swipeWrap && swipeWrap.dataset.swipeMoved) return;
        if (swipeWrap && (swipeWrap.classList.contains('is-open-left') || swipeWrap.classList.contains('is-open-right'))) {
          closeEmailRowSwipes(root);
          return;
        }
        var chip = event.target.closest('[data-email-row-attachment-open]');
        if (chip) {
          var chipRow = findRow(state, rowEl.getAttribute('data-email-row'));
          var chipItems = (chipRow && chipRow.attachmentsPreview) || [];
          var chipIndex = parseInt(chip.getAttribute('data-email-row-attachment-open'), 10);
          if (chipItems.length && !isNaN(chipIndex)) openAttachmentLightbox(chipItems, chipIndex);
          return;
        }
        var id = rowEl.getAttribute('data-email-row');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });

      rowEl.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        event.preventDefault();
        var id = rowEl.getAttribute('data-email-row');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });
    });

    var selectAll = root.querySelector('[data-email-selectall]');
    var rowChecks = Array.prototype.slice.call(root.querySelectorAll('[data-email-check]'));

    function syncRowCheck(cb, id) {
      if (cb.checked) state.checkedIds[id] = true;
      else delete state.checkedIds[id];
      var rowEl = cb.closest('[data-email-row]');
      if (rowEl) {
        rowEl.classList.toggle('tma-dash__email-row--selected', cb.checked);
        syncEmailRowAvatarSelect(rowEl, cb.checked);
      }
      updateEmailListBulk(root, state);
    }

    function syncEmailRowAvatarSelect(rowEl, checked) {
      var avatarBtn = rowEl.querySelector('[data-email-avatar-select]');
      if (!avatarBtn) return;
      avatarBtn.classList.toggle('tma-dash__email-row-avatar-btn--selected', checked);
      avatarBtn.setAttribute('aria-pressed', checked ? 'true' : 'false');
      var check = avatarBtn.querySelector('.tma-dash__email-row-avatar-check');
      if (checked && !check) {
        avatarBtn.insertAdjacentHTML(
          'beforeend',
          '<span class="tma-dash__email-row-avatar-check" aria-hidden="true"><img src="' + ICONS.Check + '" alt=""></span>'
        );
      } else if (!checked && check) {
        check.remove();
      }
    }

    function syncSelectAll() {
      if (!selectAll) return;
      var checked = rowChecks.filter(function (cb) { return cb.checked; }).length;
      selectAll.checked = checked === rowChecks.length && rowChecks.length > 0;
      selectAll.indeterminate = checked > 0 && checked < rowChecks.length;
    }

    rowChecks.forEach(function (cb) {
      var rowEl = cb.closest('[data-email-row]');
      var id = rowEl ? rowEl.getAttribute('data-email-row') : '';

      MORPH.on(cb, 'click', function (event) {
        event.stopPropagation();
      });

      MORPH.on(cb, 'change', function (event) {
        event.stopPropagation();
        syncRowCheck(cb, id);
        syncSelectAll();
      });
    });

    MORPH.unwired(root, '[data-email-avatar-select]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      MORPH.on(btn, 'click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var rowEl = btn.closest('[data-email-row]');
        if (!rowEl) return;
        var id = rowEl.getAttribute('data-email-row');
        var cb = rowEl.querySelector('[data-email-check]');
        if (!cb) return;
        cb.checked = !cb.checked;
        syncRowCheck(cb, id);
        syncSelectAll();
      });
    });

    if (selectAll) {
      MORPH.on(selectAll, 'change', function () {
        rowChecks.forEach(function (cb) {
          var rowEl = cb.closest('[data-email-row]');
          var id = rowEl ? rowEl.getAttribute('data-email-row') : '';
          cb.checked = selectAll.checked;
          syncRowCheck(cb, id);
        });
        selectAll.indeterminate = false;
      });
      syncSelectAll();
    }

    MORPH.unwired(root, '[data-email-refresh]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (state.refreshing) return;
        state.refreshing = true;
        render();

        api().sync().then(function (data) {
          if (data && data.folders) state.folderCounts = data.folders;
        }).catch(function (err) {
          reportMailError(state, err);
        }).then(function () {
          state.refreshing = false;
          reloadMessages(root, state, render);
        });
      });
    });

    MORPH.unwired(root, '[data-email-star]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-star');
        var starRow = findRow(state, id);
        if (!starRow) return;
        starRow.starred = !starRow.starred;
        var starred = !!starRow.starred;
        api().setFlags(id, { starred: starred }).catch(function (err) {
          starRow.starred = !starred;
          reportMailError(state, err);
          render();
        });
        MORPH.unwired(root, '[data-email-star="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-row-action--active', starred);
          el.classList.toggle('tma-dash__email-detail-star--active', starred);
          el.setAttribute('aria-pressed', starred ? 'true' : 'false');
          el.setAttribute('aria-label', starred ? 'Remove star' : 'Add star');
        });
        pulseEmailActionBtn(btn);
      });
    });

    MORPH.unwired(root, '[data-email-important]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-important');
        var impRow = findRow(state, id);
        if (!impRow) return;
        impRow.important = !impRow.important;
        var important = !!impRow.important;
        api().setFlags(id, { important: important }).catch(function (err) {
          impRow.important = !important;
          reportMailError(state, err);
          render();
        });
        MORPH.unwired(root, '[data-email-important="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-detail-important--active', important);
          el.classList.toggle('tma-dash__email-row-action--active', important);
          el.setAttribute('aria-pressed', important ? 'true' : 'false');
          el.setAttribute('aria-label', important ? 'Mark as not important' : 'Mark as important');
        });
        pulseEmailActionBtn(btn);
      });
    });

    MORPH.unwired(root, '[data-email-detail-label-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var rowId = btn.getAttribute('data-email-row-id');
        var labelId = btn.getAttribute('data-email-label-id');
        if (!rowId || !labelId) return;
        if (labelId === 'address') {
          if (!state.hiddenDetailChips[rowId]) state.hiddenDetailChips[rowId] = {};
          state.hiddenDetailChips[rowId].address = true;
        } else {
          var labelRow = findRow(state, rowId);
          var at = labelRow && labelRow.labels ? labelRow.labels.indexOf(labelId) : -1;
          if (at !== -1) {
            labelRow.labels.splice(at, 1);
            api().setLabel(rowId, labelId, false).catch(function (err) {
              labelRow.labels.push(labelId);
              reportMailError(state, err);
              render();
            });
          }
        }
        render();
      });
    });

    MORPH.unwired(root, '[data-email-label]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-label');
        if (state.labelPopupOpen && state.labelPopupRowId === id && !state.labelPopupBulk) {
          closeEmailLabelPopup(root, state);
        } else {
          openEmailLabelPopup(root, state, btn, { rowId: id });
        }
      });
    });

    MORPH.unwired(root, '[data-email-label-option]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var labelId = btn.getAttribute('data-email-label-option');
        toggleLabelForTargets(labelId, state);
        syncLabelMenuChecks(root, state);
        syncRowLabelButtons(root, state);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-sidebar-label]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var labelId = btn.getAttribute('data-email-sidebar-label');
        if (state.activeLabelId === labelId) state.activeLabelId = null;
        else state.activeLabelId = labelId;
        state.folder = 'inbox';
        state.reading = false;
        state.mobileNavOpen = false;
        syncEmailUrl('inbox');
        reloadMessages(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-row-hover]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var action = btn.getAttribute('data-email-row-hover');
        var id = btn.getAttribute('data-email-row-id');
        var rowEl = root.querySelector('[data-email-row="' + id + '"]');
        if (!id || !rowEl) return;

        if (action === 'read') {
          if (isRowUnread(findRow(state, id), state)) {
            markRowRead(state, id);
            syncEmailRowReadClasses(rowEl, false);
          } else {
            markRowUnread(state, id);
            syncEmailRowReadClasses(rowEl, true);
          }
          var readBtn = rowEl.querySelector('[data-email-row-hover="read"]');
          if (readBtn) {
            var nowUnread = isRowUnread(findRow(state, id), state);
            readBtn.setAttribute('aria-label', nowUnread ? 'Mark as read' : 'Mark as unread');
            var readIcon = readBtn.querySelector('img');
            if (readIcon) readIcon.src = nowUnread ? ICONS.EnvelopeSimpleOpen : ICONS.EnvelopeSimple;
          }
          return;
        }
      });
    });

    bindEmailRowSwipes(root, state, render);
  }

  function closeEmailHeaderDetails(root) {
    root.querySelectorAll('[data-email-header-details-toggle][aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('tma-dash__email-message-head-to--open');
      var wrap = btn.closest('.tma-dash__email-message-head-recipient');
      if (!wrap) return;
      var panel = wrap.querySelector('[data-email-header-details-panel]');
      if (!panel) return;
      panel.hidden = true;
      panel.style.top = '';
      panel.style.left = '';
    });
  }

  function openEmailHeaderDetails(root, toggle) {
    if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
    var wrap = toggle.closest('.tma-dash__email-message-head-recipient');
    if (!wrap) return;
    var panel = wrap.querySelector('[data-email-header-details-panel]');
    if (!panel) return;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.classList.add('tma-dash__email-message-head-to--open');
    positionEmailPopupMenu(toggle, panel);
  }

  function wireEvents(root, state, render) {
    // Selection can move without going through openMailMessage; this catches
    // those cases rather than leaving the pane on a stale conversation.
    ensureThreadLoaded(root, state, render);
    // Grow any open message to its full height (see sizeMessageFrames).
    sizeMessageFrames(root);
    wireAttachmentPreviews(root);
    wireAttachmentPdfPreviews(root);

    // Pager: step pages, or change how many messages a page holds. Both refetch
    // from the server — the mailbox is far too large to page in memory.
    MORPH.unwired(root, '[data-email-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var target = parseInt(btn.getAttribute('data-email-page'), 10);
        if (!target || target === state.page) return;
        state.page = Math.max(1, Math.min(target, state.lastPage || 1));
        state.checkedIds = {};
        reloadMessages(root, state, render);
      });
    });

    var perPageSelect = MORPH.unwiredOne(root, '[data-email-perpage]');
    if (perPageSelect) {
      perPageSelect.addEventListener('change', function () {
        var n = parseInt(perPageSelect.value, 10);
        if (!n) return;
        state.perPage = n;
        state.page = 1;
        state.checkedIds = {};
        saveMailPerPage(n);
        reloadMessages(root, state, render);
      });
    }

    if (!root._emailToolbarBound) {
      root._emailToolbarBound = true;

      // mousedown, not click: execCommand needs the selection that's still
      // live in the editor the instant before the button would steal focus.
      // preventDefault on every branch is what keeps the caret in the editor —
      // without it the button takes focus, the selection collapses, and the
      // command applies to nothing.
      root.addEventListener('mousedown', function (event) {
        var menuBtn = event.target.closest('[data-email-compose-tool-menu]');
        if (menuBtn) {
          event.preventDefault();
          var kind = menuBtn.getAttribute('data-email-compose-tool-menu');
          // Clicking the open menu's own button closes it.
          if (composeMenuEl && composeMenuEl._kind === kind) {
            closeComposeMenu();
            return;
          }
          openComposeMenu(menuBtn, kind);
          if (composeMenuEl) composeMenuEl._kind = kind;
          return;
        }

        var toolBtn = event.target.closest('[data-email-compose-tool-cmd]');
        if (!toolBtn) return;
        event.preventDefault();
        closeComposeMenu();
        applyComposeCommand(toolBtn.getAttribute('data-email-compose-tool-cmd'));
        syncComposeToolbarState(root);
      });

      // Menu items live on document.body, outside root, so they need their own
      // listener — and the same mousedown timing for the same reason.
      document.addEventListener('mousedown', function (event) {
        var item = event.target.closest('[data-email-compose-menu-cmd]');
        if (item) {
          event.preventDefault();
          applyComposeCommand(
            item.getAttribute('data-email-compose-menu-cmd'),
            item.getAttribute('data-email-compose-menu-value') || undefined
          );
          closeComposeMenu();
          syncComposeToolbarState(root);
          return;
        }

        // A click anywhere else dismisses an open menu.
        if (composeMenuEl && !event.target.closest('.tma-dash__email-compose-menu') &&
            !event.target.closest('[data-email-compose-tool-menu]')) {
          closeComposeMenu();
        }
      });

      // Keep the pressed states honest as the caret moves or the user types.
      document.addEventListener('selectionchange', function () {
        if (!root.querySelector('[data-email-compose-body]')) return;
        syncComposeToolbarState(root);
      });

      // Keyboard shortcuts fire the browser's own commands, which the toolbar
      // then has to catch up with.
      root.addEventListener('keyup', function (event) {
        if (event.target.closest('[data-email-compose-body]')) syncComposeToolbarState(root);
      });
    }

    if (!root._emailProfileBound) {
      root._emailProfileBound = true;

      root.addEventListener('click', function (event) {
        var headerToggle = event.target.closest('[data-email-header-details-toggle]');
        if (headerToggle) {
          event.preventDefault();
          event.stopPropagation();
          var headerOpen = headerToggle.getAttribute('aria-expanded') === 'true';
          closeEmailHeaderDetails(root);
          if (!headerOpen) openEmailHeaderDetails(root, headerToggle);
          return;
        }

        // ── thread controls ──
        var quoteBtn = event.target.closest('[data-email-thread-quote]');
        if (quoteBtn) {
          event.preventDefault();
          var quoteId = quoteBtn.getAttribute('data-email-thread-quote');
          if (state.thread) {
            state.thread.showQuoted[quoteId] = !state.thread.showQuoted[quoteId];
            render();
          }
          return;
        }

        var toggleAll = event.target.closest('[data-email-thread-toggle-all]');
        if (toggleAll) {
          event.preventDefault();
          setThreadExpansion(root, state, render, toggleAll.getAttribute('data-email-thread-toggle-all') === 'expand');
          return;
        }

        var expandBtn = event.target.closest('[data-email-thread-expand]');
        if (expandBtn) {
          event.preventDefault();
          expandThreadMessage(root, state, render, expandBtn.getAttribute('data-email-thread-expand'));
          return;
        }

        // Collapsing an open card: the whole head is the control, so clicks on
        // the actions inside it (star, reply, the recipient disclosure) must
        // not also fold the message away underneath the reader.
        var collapseEl = event.target.closest('[data-email-thread-collapse]');
        if (collapseEl && !event.target.closest('.tma-dash__email-detail-actions') &&
            !event.target.closest('[data-email-header-details-panel]')) {
          event.preventDefault();
          expandThreadMessage(root, state, render, collapseEl.getAttribute('data-email-thread-collapse'));
          return;
        }

        var inlineComposeBtn = event.target.closest('[data-email-inline-compose]');
        if (inlineComposeBtn && !inlineComposeBtn.closest('[data-email-inline-compose-panel]')) {
          var composeMode = inlineComposeBtn.getAttribute('data-email-inline-compose');
          if (composeMode === 'reply' || composeMode === 'reply-all' || composeMode === 'forward') {
            openInlineCompose(state, composeMode);
            render();
            window.requestAnimationFrame(function () {
              focusInlineComposeEditor(root);
            });
            return;
          }
        }

        var inlineComposeClose = event.target.closest('[data-email-inline-compose-close]');
        if (inlineComposeClose) {
          closeInlineCompose(state);
          render();
          return;
        }

        var toggle = event.target.closest('[data-email-profile-toggle]');
        if (toggle) {
          event.stopPropagation();
          if (state.profileSidebarOpen) closeEmailProfileSidebar(state);
          if (state.profileMenuOpen) closeEmailProfileMenu(root, state);
          else openEmailProfileMenu(root, state, toggle);
          return;
        }

        var actionBtn = event.target.closest('[data-email-profile-action]');
        if (actionBtn) {
          closeEmailProfileMenu(root, state);
          closeEmailProfileSidebar(state);
          var action = actionBtn.getAttribute('data-email-profile-action');
          // Opens over the mailbox instead of navigating to /settings.
          if (action === 'settings') {
            openEmailSettings(root, state, render);
            return;
          }
          // Signing out is a POST to Fortify with the CSRF token — navigating
          // to a URL only *looked* like signing out and left the session live.
          if (action === 'sign-out') {
            signOut();
            return;
          }
          render();
          return;
        }

        if (state.profileMenuOpen && !event.target.closest('[data-email-profile-menu]') && !event.target.closest('[data-email-profile-toggle]')) {
          closeEmailProfileMenu(root, state);
        }

        if (
          state.profileSidebarOpen &&
          !event.target.closest('[data-email-profile-popup-card]') &&
          !event.target.closest('[data-email-profile-sidebar-toggle]')
        ) {
          closeEmailProfileSidebar(state);
          render();
        }

        if (state.bulkMoreMenuOpen && !event.target.closest('[data-email-bulk-more-menu]') && !event.target.closest('[data-email-bulk-more-toggle]')) {
          closeEmailBulkMoreMenu(root, state);
        }

        if (state.labelPopupOpen && !event.target.closest('[data-email-label-menu]') && !event.target.closest('[data-email-label]')) {
          closeEmailLabelPopup(root, state);
        }

        if (!event.target.closest('[data-email-row-swipe]')) {
          closeEmailRowSwipes(root);
        }

        if (
          !event.target.closest('[data-email-header-details-toggle]') &&
          !event.target.closest('[data-email-header-details-panel]')
        ) {
          closeEmailHeaderDetails(root);
        }
      });

      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        // Settings sits above everything else, so it closes first.
        if (state.settingsOpen) {
          state.settingsOpen = false;
          render();
          return;
        }
        if (root.querySelector('[data-email-header-details-toggle][aria-expanded="true"]')) {
          closeEmailHeaderDetails(root);
          return;
        }
        if (state.labelPopupOpen) closeEmailLabelPopup(root, state);
        else if (state.bulkMoreMenuOpen) closeEmailBulkMoreMenu(root, state);
        else if (state.profileMenuOpen) closeEmailProfileMenu(root, state);
        else if (state.profileSidebarOpen) {
          closeEmailProfileSidebar(state);
          render();
        }
      });
    }

    if (!root._emailPopupBound) {
      root._emailPopupBound = true;
      window.addEventListener('resize', function () {
        if (state.bulkMoreMenuOpen) {
          var bulkToggle = root.querySelector('[data-email-bulk-more-toggle]');
          var bulkMenu = root.querySelector('[data-email-bulk-more-menu]');
          if (bulkToggle && bulkMenu) positionEmailPopupMenu(bulkToggle, bulkMenu);
        }
        if (state.labelPopupOpen) {
          var labelAnchor = state.labelPopupRowId
            ? root.querySelector('[data-email-label="' + state.labelPopupRowId + '"]')
            : root.querySelector('[data-email-bulk-more-item="label"]');
          var labelMenu = root.querySelector('[data-email-label-menu]');
          if (labelAnchor && labelMenu) positionEmailPopupMenu(labelAnchor, labelMenu);
        }
        if (state.profileMenuOpen) {
          var dashRoot = getEmailDashRoot(root);
          var profileToggle =
            (dashRoot && dashRoot.querySelector('[data-email-profile-toggle][aria-expanded="true"]')) ||
            root.querySelector('[data-email-profile-toggle][aria-expanded="true"]');
          var profileWrap = profileToggle && profileToggle.closest('.tma-dash__email-profile-wrap');
          var profileMenu = profileWrap && profileWrap.querySelector('[data-email-profile-menu]');
          if (profileToggle && profileMenu) {
            profileMenu.style.minWidth = Math.round(profileToggle.getBoundingClientRect().width) + 'px';
            positionEmailPopupMenu(profileToggle, profileMenu);
          }
        }
        if (state.profileSidebarOpen) {
          var dashRootProfile = getEmailDashRoot(root);
          var headerProfileToggle =
            dashRootProfile && dashRootProfile.querySelector('[data-email-profile-sidebar-toggle]');
          var profilePopup = root.querySelector('[data-email-profile-popup-card]');
          if (headerProfileToggle && profilePopup) {
            positionEmailProfilePopup(headerProfileToggle, profilePopup);
          }
        }
        var headerToggle = root.querySelector('[data-email-header-details-toggle][aria-expanded="true"]');
        if (headerToggle) {
          var headerPanel = headerToggle.closest('.tma-dash__email-message-head-recipient');
          headerPanel = headerPanel && headerPanel.querySelector('[data-email-header-details-panel]');
          if (headerPanel) positionEmailPopupMenu(headerToggle, headerPanel);
        }
      });
    }

    if (!root._emailSearchBound) {
      root._emailSearchBound = true;
      var dash = getEmailDashRoot(root);
      if (dash) {
        var searchTimer = null;
        dash.addEventListener('focusin', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.searchFocused = true;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
        });
        dash.addEventListener('focusout', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.searchFocused = false;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
        });
        dash.addEventListener('input', function (event) {
          if (!event.target.matches('[data-email-search]')) return;
          state.search = event.target.value;
          state.searchFocused = true;
          state.searchLoading = true;
          var slot = dash.querySelector('.tma-dash__header-center');
          if (slot) updateEmailSearchWrap(slot, state);
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () {
            state.searchLoading = false;
            var slotEl = dash.querySelector('.tma-dash__header-center');
            if (slotEl) updateEmailSearchWrap(slotEl, state);
            reloadMessages(root, state, render);
          }, 180);
        });
        dash.addEventListener('click', function (event) {
          if (event.target.closest('[data-email-search-clear]')) {
            event.preventDefault();
            clearTimeout(searchTimer);
            state.search = '';
            state.searchFocused = true;
            state.searchLoading = false;
            var slot = dash.querySelector('.tma-dash__header-center');
            if (slot) {
              var searchInput = slot.querySelector('[data-email-search]');
              if (searchInput) searchInput.value = '';
              updateEmailSearchWrap(slot, state);
            }
            reloadMessages(root, state, render);
            var focusInput = dash.querySelector('[data-email-search]');
            if (focusInput) focusInput.focus();
            return;
          }
          var searchWrap = event.target.closest('.tma-dash__email-search');
          if (searchWrap && !event.target.matches('[data-email-search]') && !event.target.closest('[data-email-search-clear]')) {
            var slot = dash.querySelector('.tma-dash__header-center');
            if (!state.searchFocused && !state.search) {
              state.searchFocused = true;
              if (slot) updateEmailSearchWrap(slot, state);
            }
            var searchInput = searchWrap.querySelector('[data-email-search]');
            if (searchInput) searchInput.focus();
          }
          if (event.target.closest('[data-email-search-shortcut]')) {
            event.preventDefault();
            var searchInput = dash.querySelector('[data-email-search]');
            if (searchInput) searchInput.focus();
          }
        });
      }
    }

    MORPH.unwired(root, '[data-email-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var folder = btn.getAttribute('data-email-folder');
        if (folder === 'compose') {
          openCompose(state, {});
          render();
          return;
        }
        state.folder = folder;
        state.activeLabelId = null;
        state.reading = false;
        state.mobileNavOpen = false;
        state.selectedId = null;
        clearEmailSelection(state);
        if (folder === 'templates' || folder === 'inbox') syncEmailUrl(folder);
        reloadMessages(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-email-bulk-more-item]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var item = btn.getAttribute('data-email-bulk-more-item');
        var ids = Object.keys(state.checkedIds);
        if (!ids.length) return;

        if (item === 'label') {
          closeEmailBulkMoreMenu(root, state);
          openEmailLabelPopup(root, state, btn, { bulk: true });
          return;
        }

        var MORE_ACTIONS = {
          'unread': 'unread',
          'add-star': 'star',
          'remove-star': 'unstar',
        };

        if (MORE_ACTIONS[item]) {
          applyBulkAction(root, state, render, ids, MORE_ACTIONS[item]);
        }

        closeEmailBulkMoreMenu(root, state);
      });
    });

    var dashBulk = getEmailDashRoot(root);
    if (dashBulk && !dashBulk._emailBulkHeaderBound) {
      dashBulk._emailBulkHeaderBound = true;
      dashBulk.addEventListener('click', function (event) {
        var clearBtn = event.target.closest('[data-email-bulk-clear]');
        if (clearBtn) {
          event.preventDefault();
          event.stopPropagation();
          clearEmailSelection(state);
          render();
          return;
        }

        var bulkBtn = event.target.closest('[data-email-bulk-action]');
        if (!bulkBtn) return;
        event.stopPropagation();
        var action = bulkBtn.getAttribute('data-email-bulk-action');
        var ids = Object.keys(state.checkedIds);
        if (!ids.length) return;

        if (action === 'more') {
          if (state.bulkMoreMenuOpen) {
            closeEmailBulkMoreMenu(root, state);
          } else {
            openEmailBulkMoreMenu(root, state, bulkBtn);
          }
          ensureEmailMobileHeader(root, state);
          return;
        }

        closeEmailBulkMoreMenu(root, state);

        // 'move' opens a picker rather than acting directly; everything else
        // maps straight onto a bulk action.
        if (action === 'move') {
          openEmailLabelPopup(root, state, bulkBtn, { bulk: true });
          return;
        }

        applyBulkAction(root, state, render, ids, action);
      });
    }

    MORPH.unwired(root, '[data-email-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedTemplateId = btn.getAttribute('data-email-template');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-mobile-scrim]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mobileNavOpen = false;
        closeEmailProfileSidebar(state);
        render();
      });
    });

    MORPH.unwired(root, '[data-email-mobile-compose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompose(state, {});
        state.mobileNavOpen = false;
        render();
      });
    });

    var dashMobile = getEmailDashRoot(root);
    if (dashMobile) {
      if (!dashMobile._emailProfileSidebarBound) {
        dashMobile._emailProfileSidebarBound = true;
        dashMobile.addEventListener('click', function (event) {
          var profileSidebarToggle = event.target.closest('[data-email-profile-sidebar-toggle]');
          if (!profileSidebarToggle) return;
          event.stopPropagation();
          if (state.profileSidebarOpen) closeEmailProfileSidebar(state);
          else openEmailProfileSidebar(root, state);
          render();
        });
      }
    }

    if (!root._emailMobileResizeBound) {
      root._emailMobileResizeBound = true;
      var mobileMq = window.matchMedia(EMAIL_MOBILE_MQ);
      var wasMobile = isEmailMobile();
      var onMobileBreakpoint = function () {
        var mobile = isEmailMobile();
        if (mobile !== wasMobile) {
          wasMobile = mobile;
          if (!mobile && state.mobileNavOpen) state.mobileNavOpen = false;
          if (!mobile && state.profileSidebarOpen) closeEmailProfileSidebar(state);
          render();
          return;
        }
        if (!mobile && state.mobileNavOpen) {
          state.mobileNavOpen = false;
          render();
        }
        if (!mobile && state.profileSidebarOpen) {
          closeEmailProfileSidebar(state);
          render();
        }
      };
      window.addEventListener('resize', onMobileBreakpoint);
      if (typeof mobileMq.addEventListener === 'function') {
        mobileMq.addEventListener('change', onMobileBreakpoint);
      } else if (typeof mobileMq.addListener === 'function') {
        mobileMq.addListener(onMobileBreakpoint);
      }
    }

    MORPH.unwired(root, '[data-email-layout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var layout = btn.getAttribute('data-email-layout');
        if (layout !== 'split' && layout !== 'single') return;
        if (state.layoutStyle === layout) return;
        state.layoutStyle = layout;
        saveLayoutStyle(layout);
        if (layout === 'split') {
          state.reading = false;
        } else if (state.selectedId || (state.folder === 'templates' && state.selectedTemplateId)) {
          state.reading = true;
        } else {
          state.reading = false;
        }
        render();
      });
    });

    var dashRoot = getEmailDashRoot(root);
    var eventRoot = dashRoot || root;

    eventRoot.querySelectorAll('[data-email-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.reading = false;
        render();
      });
    });

    MORPH.unwired(root, '[data-email-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var nav = getDetailNavState(state);
        if (!nav) return;
        var dir = btn.getAttribute('data-email-nav');
        var id = dir === 'prev' ? nav.prevId : nav.nextId;
        if (!id) return;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        openMailMessage(root, state, render, id);
      });
    });

    MORPH.unwired(root, '[data-email-use-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompose(state, { templateId: btn.getAttribute('data-email-use-template') });
        syncEmailUrl('inbox');
        render();
      });
    });

    MORPH.unwired(root, '[data-email-template-viewport]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.templateViewport = btn.getAttribute('data-email-template-viewport');
        render();
      });
    });

    wireListRows(root, state, render);
    attachSplitResizer(root, state);
  }

  function isEmailSplitResizeEnabled() {
    return window.matchMedia('(min-width: 861px)').matches;
  }

  function applySplitListRatio(panel, ratio) {
    panel.style.setProperty('--email-split-list', Math.round(ratio * 1000) / 10 + '%');
  }

  function attachSplitResizer(root, state) {
    if (root._emailSplitDragCleanup) {
      root._emailSplitDragCleanup();
      root._emailSplitDragCleanup = null;
    }

    var panel = root.querySelector('.tma-dash__email-panel:not(.tma-dash__email-panel--single)');
    var resizer = root.querySelector('[data-email-split-resizer]');
    if (!panel || !resizer || !isEmailSplitResizeEnabled()) return;

    if (typeof state.splitListRatio !== 'number') {
      state.splitListRatio = loadSplitListRatio();
    }

    applySplitListRatio(panel, state.splitListRatio);
    resizer.setAttribute('aria-valuenow', String(Math.round(state.splitListRatio * 100)));

    var dragging = false;

    function updateRatio(clientX) {
      var rect = panel.getBoundingClientRect();
      if (rect.width <= 0) return;
      var ratio = clampSplitRatio((clientX - rect.left) / rect.width);
      state.splitListRatio = ratio;
      applySplitListRatio(panel, ratio);
      resizer.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('tma-dash__email-panel--split-dragging');
      resizer.classList.remove('tma-dash__email-split-resizer--dragging');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      saveSplitListRatio(state.splitListRatio);
    }

    function onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      panel.classList.add('tma-dash__email-panel--split-dragging');
      resizer.classList.add('tma-dash__email-split-resizer--dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      if (typeof resizer.setPointerCapture === 'function') {
        resizer.setPointerCapture(event.pointerId);
      }
      updateRatio(event.clientX);
    }

    function onPointerMove(event) {
      if (!dragging) return;
      event.preventDefault();
      updateRatio(event.clientX);
    }

    function onPointerUp(event) {
      if (!dragging) return;
      if (typeof resizer.releasePointerCapture === 'function' && resizer.hasPointerCapture(event.pointerId)) {
        resizer.releasePointerCapture(event.pointerId);
      }
      stopDrag();
    }

    function onKeyDown(event) {
      var step = 0.04;
      if (event.key === 'ArrowLeft') {
        state.splitListRatio = clampSplitRatio(state.splitListRatio - step);
      } else if (event.key === 'ArrowRight') {
        state.splitListRatio = clampSplitRatio(state.splitListRatio + step);
      } else if (event.key === 'Home') {
        state.splitListRatio = SPLIT_RATIO_MIN;
      } else if (event.key === 'End') {
        state.splitListRatio = SPLIT_RATIO_MAX;
      } else {
        return;
      }
      event.preventDefault();
      applySplitListRatio(panel, state.splitListRatio);
      resizer.setAttribute('aria-valuenow', String(Math.round(state.splitListRatio * 100)));
      saveSplitListRatio(state.splitListRatio);
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    resizer.addEventListener('keydown', onKeyDown);

    root._emailSplitDragCleanup = function () {
      stopDrag();
      resizer.removeEventListener('pointerdown', onPointerDown);
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      resizer.removeEventListener('keydown', onKeyDown);
    };
  }

  function pulseEmailActionBtn(btn) {
    if (!btn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btn.classList.remove('tma-dash__email-row-action--pulse', 'tma-dash__email-detail-important--pulse');
    void btn.offsetWidth;
    if (btn.classList.contains('tma-dash__email-detail-important')) {
      btn.classList.add('tma-dash__email-detail-important--pulse');
    } else {
      btn.classList.add('tma-dash__email-row-action--pulse');
    }
    window.setTimeout(function () {
      btn.classList.remove('tma-dash__email-row-action--pulse', 'tma-dash__email-detail-important--pulse');
    }, 420);
  }

  function mount(root, opts) {
    opts = opts || {};
    var path = window.location.pathname.replace(/\/$/, '');
    var initialFolder = opts.folder || (path === '/email/templates' ? 'templates' : 'inbox');

    if (root._emailState && root._emailRender) {
      if (opts.folder) root._emailState.folder = opts.folder;
      root._emailToggleMobileNav = function () {
        closeEmailProfileSidebar(root._emailState);
        root._emailState.mobileNavOpen = !root._emailState.mobileNavOpen;
        root._emailRender();
      };
      root._emailCloseMobileNav = function () {
        var state = root._emailState;
        if (!state.mobileNavOpen && !state.profileSidebarOpen) return;
        state.mobileNavOpen = false;
        closeEmailProfileSidebar(state);
        root._emailRender();
      };
      root._emailRender();
      return;
    }

    var state = {
      folder: initialFolder,
      // Nothing is selected until the first page of real mail arrives.
      selectedId: null,
      selectedTemplateId: 'auth-sign-in',
      composeDrafts: [],
      nextComposeId: 1,
      focusedComposeId: null,
      templateViewport: 'desktop',
      profileMenuOpen: false,
      search: '',
      searchFocused: false,
      searchLoading: false,

      /* Server-backed mailbox state. Rows carry their own read/star/label
       * flags, so the old shadow maps (readIds, starredIds, rowLabels,
       * removedIds) are gone — checkedIds stays because selection is a
       * property of this view, not of the message. */
      rows: [],
      checkedIds: {},
      folderCounts: {},
      labels: [],
      account: null,
      connected: null,
      loading: true,
      loadError: null,
      loadToken: 0,
      hasMore: false,
      // Server-side paging: the mailbox can hold far more mail than one page.
      page: 1,
      perPage: loadMailPerPage(),
      lastPage: 1,
      total: 0,
      perPageOptions: [25, 50, 100, 200],
      bodyLoading: false,
      /* The open conversation: every message in it, which are expanded, and
       * which have had their quoted history revealed. Null until a message is
       * opened. */
      thread: null,
      threadError: null,
      /* Which message the error belongs to, so selecting another one retries
       * instead of inheriting the failure. */
      threadErrorId: null,
      threadToken: 0,
      refreshing: false,
      settingsOpen: false,
      settings: null,

      hiddenDetailChips: {},
      activeLabelId: null,
      bulkMoreMenuOpen: false,
      labelPopupOpen: false,
      labelPopupRowId: null,
      labelPopupBulk: false,
      layoutStyle: loadLayoutStyle(),
      splitListRatio: loadSplitListRatio(),
      reading: false,
      inlineCompose: null,
      mobileNavOpen: false,
      profileSidebarOpen: false,
    };

    function render() {
      state_active = state;
      if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
      closeEmailBulkMoreMenu(root, state);
      closeEmailLabelPopup(root, state);
      syncEmailHeaderSearch(root, state);
      ensureEmailMobileHeader(root, state);
      MORPH.patch(root,
        '<div class="tma-dash__email-page">' +
        renderEmailMobileChrome(state) +
        renderEmailProfilePopup(state) +
        '<div class="tma-dash__email-fit">' +
        '<div class="tma-dash__email-layout">' +
        renderEmailSidebar(state) +
        renderEmailPanel(state) +
        '</div>' +
        '</div>' +
        renderComposeWindows(state) +
        renderComposeDock(state) +
        renderEmailSettings(state) +
        '</div>');
      wireEvents(root, state, render);
      wireComposeEvents(root, state, render);
      wireInlineComposeEvents(root, state, render);
      wireEmailSettings(root, state, render);
      if (state.inlineCompose) {
        window.requestAnimationFrame(function () {
          focusInlineComposeEditor(root);
        });
      }
      if (state.profileMenuOpen) {
        var profileToggle = root.querySelector('.tma-dash__email-profile-wrap--sidebar [data-email-profile-toggle]');
        if (profileToggle) openEmailProfileMenu(root, state, profileToggle);
        else state.profileMenuOpen = false;
      }
      if (state.profileSidebarOpen) {
        var dashRoot = getEmailDashRoot(root);
        var headerProfileToggle =
          dashRoot && dashRoot.querySelector('[data-email-profile-sidebar-toggle]');
        var profilePopup = root.querySelector('[data-email-profile-popup-card]');
        if (headerProfileToggle && profilePopup) {
          positionEmailProfilePopup(headerProfileToggle, profilePopup);
        } else {
          state.profileSidebarOpen = false;
        }
      }
      var dash = getEmailDashRoot(root);
      var searchInput = dash && dash.querySelector('[data-email-search]');
      if (searchInput && state.searchFocused) {
        searchInput.focus();
        var len = searchInput.value.length;
        if (typeof searchInput.setSelectionRange === 'function') searchInput.setSelectionRange(len, len);
      }
      if (window.PortalTooltip) window.PortalTooltip.init();
      var dashRoot = getEmailDashRoot(root);
      if (dashRoot) ensureEmailToast(dashRoot);
      if (dashRoot && typeof dashRoot._syncTabBarBadges === 'function') dashRoot._syncTabBarBadges();
    }

    root._emailState = state;
    root._emailRender = render;

    // Handlers that only hold `state` still need to repaint and to reach the
    // toast host, so both travel with it.
    state.root = root;
    state.render = render;
    state.reload = function () { reloadMessages(root, state, render); };

    root._emailToggleMobileNav = function () {
      closeEmailProfileSidebar(state);
      state.mobileNavOpen = !state.mobileNavOpen;
      render();
    };
    root._emailCloseMobileNav = function () {
      if (!state.mobileNavOpen && !state.profileSidebarOpen) return;
      state.mobileNavOpen = false;
      closeEmailProfileSidebar(state);
      render();
    };

    // Paint the shell first (sidebar, chrome, loading state), then fill it
    // from the server — the page should never look blank while it waits.
    bindCurrentUser(render);
    render();
    bootstrapMailbox(root, state, render);
    // Show how far the mailbox history has downloaded, bottom-right.
    stopSyncPolling();
    pollSyncStatus();

    // New mail shows up on its own, like a real inbox — quiet background
    // poll, no spinner, no toast.
    scheduleMailPoll(root, state, render);
    if (!root._mailPollVisibilityBound) {
      root._mailPollVisibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        // Catch up immediately instead of waiting out whatever's left of
        // the interval from before the tab was hidden.
        if (!document.hidden) pollNewMail(root, state, render);
      });
    }
  }

  window.TMAEmail = {
    mount: mount,
    restoreHeaderSearch: restoreHeaderSearch,
    getInboxUnreadCount: getInboxUnreadCount,
  };
})();
