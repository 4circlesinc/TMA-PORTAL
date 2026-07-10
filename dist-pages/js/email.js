/*
 * TMA — Email page ( /email )
 * Global: window.TMAEmail
 */
(function () {
  'use strict';

  var AVATAR = '/TMA-PORTAL/images/avatars/';
  var ICON = '/TMA-PORTAL/images/icons/phosphor/';
  var BRAND = '/TMA-PORTAL/images/icons/brands/';

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
    ArrowLineUpDown: '/TMA-PORTAL/images/icons/tma/ArrowLineUpDown.svg',
    EnvelopeSimpleOpen: ICON + 'EnvelopeSimpleOpen.svg',
    FolderSimple: ICON + 'FolderSimple.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    Clock: ICON + 'Clock.svg',
    Tag: ICON + 'Tag.svg',
    Important: ICON + 'TagChevron.svg',
    ArrowLineRight: ICON + 'ArrowLineRight.svg',
    PaperclipHorizontal: ICON + 'PaperclipHorizontal.svg',
    SpeakerSlash: ICON + 'SpeakerSlash.svg',
    ChatCircleDots: ICON + 'ChatCircleDots.svg',
    ArrowsHorizontal: ICON + 'ArrowsHorizontal.svg',
    Flag: ICON + 'Flag.svg',
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    XCircle: '/TMA-PORTAL/images/icons/tma/Xcircle.svg',
    Loading16: '/TMA-PORTAL/images/icons/tma/Loading-16.svg',
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
      var label = getEmailLabel(state.activeLabelId);
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

  function renderInlineComposeAvatar() {
    return (
      '<span class="tma-dash__email-message-avatar">' +
      '<img src="' + AVATAR + esc(PROFILE.avatar) + '.png" alt="">' +
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
    var composeSubject = isReply ? getReplySubject(subject) : getForwardSubject(subject);
    return (
      '<div class="tma-dash__email-thread-actions">' +
      '<div class="tma-dash__email-inline-compose" data-email-inline-compose-panel>' +
      '<div class="tma-dash__email-inline-compose-head">' +
      renderInlineComposeAvatar() +
      '<div class="tma-dash__email-inline-compose-fields">' +
      '<div class="tma-dash__email-inline-compose-row">' +
      '<span class="tma-dash__email-inline-compose-label">To</span>' +
      (isReply
        ? '<span class="tma-dash__email-inline-compose-value">' + esc(row.sender) + ' &lt;' + esc(metaEmail) + '&gt;</span>'
        : '<input type="text" class="tma-dash__email-inline-compose-input" placeholder="Recipients" aria-label="To">') +
      '</div>' +
      (!isReply
        ? '<div class="tma-dash__email-inline-compose-row">' +
          '<span class="tma-dash__email-inline-compose-label">Subject</span>' +
          '<span class="tma-dash__email-inline-compose-value">' + esc(composeSubject) + '</span>' +
          '</div>'
        : '') +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-editor-wrap">' +
      '<div class="tma-dash__email-inline-compose-editor" contenteditable="true" data-email-inline-compose-editor data-placeholder="Compose your ' + (isReply ? 'reply' : 'message') + '" aria-label="Message body" role="textbox"></div>' +
      (isReply
        ? renderReplyQuote(row, metaEmail, metaDate, bodyText)
        : renderForwardQuote(row, metaEmail, metaDate, subject, bodyText)) +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-bar">' +
      renderComposeToolbar() +
      '</div>' +
      '<div class="tma-dash__email-inline-compose-actions">' +
      '<button type="button" class="tma-dash__email-inline-compose-send">Send</button>' +
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
    state.inlineCompose = { mode: mode, messageId: state.selectedId };
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

  var EMAIL_LABELS = [
    { id: 'work', name: 'Work', tone: 'blue' },
    { id: 'personal', name: 'Personal', tone: 'green' },
    { id: 'important', name: 'Important', tone: 'red' },
    { id: 'finance', name: 'Finance', tone: 'orange' },
    { id: 'updates', name: 'Updates', tone: 'gray' },
    { id: 'travel', name: 'Travel', tone: 'indigo' },
  ];

  function renderLabelTag(tone, sizeCls) {
    var cls = 'tma-dash__email-label-tag tma-dash__email-label-tag--' + esc(tone);
    if (sizeCls) cls += ' ' + sizeCls;
    return '<span class="' + cls + '" aria-hidden="true"></span>';
  }

  function getEmailLabel(labelId) {
    for (var i = 0; i < EMAIL_LABELS.length; i++) {
      if (EMAIL_LABELS[i].id === labelId) return EMAIL_LABELS[i];
    }
    return null;
  }

  function getRowLabelIds(rowId, state) {
    if (!state.rowLabels[rowId]) return [];
    return Object.keys(state.rowLabels[rowId]);
  }

  function labelMessageCount(labelId, state) {
    return INBOX.filter(function (row) {
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
          var label = getEmailLabel(labelId);
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
      var label = getEmailLabel(labelId);
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
      EMAIL_LABELS.map(function (label) {
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

  var RECIPIENTS = [
    { type: 'avatar', label: 'ByeWind', avatar: 'AvatarByewind' },
    { type: 'brand', label: 'Slack', brand: 'Slack24' },
    { type: 'email', label: 'byewind@twitter.com' },
  ];

  var COMPOSE_SUBJECT = 'Invoice #VL25000355 — TM ANTOINE Advisory';

  var FOLDERS = [
    { id: 'compose', label: 'Compose', icon: 'PencilSimpleLine', compose: true },
    { id: 'inbox', label: 'Inbox', icon: 'Tray', countKey: 'inbox' },
    { id: 'sent', label: 'Sent', icon: 'PaperPlaneRight', count: 48 },
    { id: 'draft', label: 'Draft', icon: 'FileText', count: 3 },
    { id: 'spam', label: 'Spam', icon: 'WarningOctagon', count: 2 },
    { id: 'trash', label: 'Trash', icon: 'Trash', count: 6 },
    { id: 'archive', label: 'Archive', icon: 'Archive', count: 19 },
    { id: 'templates', label: 'Templates', icon: 'SquaresFour', countKey: 'templates' },
  ];

  var INBOX = [
    { id: 'byewind', sender: 'ByeWind', subject: 'Tonight', body: 'Are you free tonight?', time: '19:28', avatar: 'AvatarByewind' },
    {
      id: 'slack',
      sender: 'Slack',
      subject: 'Invite your team to Slack',
      body: "We're glad to see that you've started using Slack. Join TM ANTOINE Advisory Community on Slack.",
      time: '18:30',
      brand: 'Slack24',
      email: 'no-reply@email.slackhq.com',
      dateLabel: 'Today, 18:30',
      slack: true,
    },
    { id: 'natali', sender: 'Natali Craig', subject: 'Hi', body: 'Hi', time: '17:52', avatar: 'AvatarFemale06' },
    {
      id: 'drew',
      sender: 'Drew Cano',
      subject: "Let's go fishing!",
      body: "Hey, You wanna join me and Fred at the lake tomorrow? It'll be awesome.",
      time: '10:12',
      dateLabel: 'Today, 10:12',
      email: 'drewcano@example.com',
      avatar: 'AvatarMale01',
      to: { name: 'Fred Miller', email: 'fred@example.com' },
      repliedTo: {
        sender: 'Fred Miller',
        email: 'fred@example.com',
        date: 'Yesterday, 4:30 PM',
        subject: 'Lake trip this weekend?',
        body: 'Weather looks perfect for fishing Saturday. Let me know if you are in.',
        avatar: 'AvatarMale02',
        to: { name: 'Drew Cano', email: 'drewcano@example.com' },
      },
    },
    {
      id: 'behance',
      sender: 'Behance',
      subject: 'You have a new follower',
      body: 'Someone started following your work on Behance.',
      time: '06:30',
      brand: 'Behance40',
    },
    {
      id: 'orlando',
      sender: 'Orlando Diggs',
      subject: 'Hey man',
      body: "Nah man sorry i don't. Should i get it?",
      time: 'Mar 12',
      avatar: 'AvatarMale03',
    },
    {
      id: 'chatgpt',
      sender: 'ChatGPT',
      subject: 'Welcome to ChatGPT',
      body: 'Welcome to ChatGPT — your AI assistant is ready when you are.',
      time: 'Mar 12',
      brand: 'ChatGPT24',
    },
    {
      id: 'andi',
      sender: 'Andi Lane',
      subject: 'Re: New mail settings',
      body: 'Will you answer him asap?',
      time: 'Mar 11',
      dateLabel: 'Mar 11',
      email: 'andilane@example.com',
      avatar: 'AvatarFemale01',
      to: { name: 'TM ANTOINE Advisory', email: 'notifications@tmantoine.com' },
      repliedTo: {
        sender: 'TM ANTOINE Advisory',
        email: 'notifications@tmantoine.com',
        date: 'Mar 10',
        subject: 'New mail settings',
        body: 'We updated your mail settings. Please review the changes and confirm they look correct.',
        brand: 'Slack24',
        to: { name: 'Andi Lane', email: 'andilane@example.com' },
      },
    },
    {
      id: 'facebook',
      sender: 'Facebook',
      subject: 'You have a new follower',
      body: 'Someone new is following your profile.',
      time: 'Mar 10',
      brand: 'FacebookLogo',
    },
    {
      id: 'youtube',
      sender: 'YouTube',
      subject: 'The most popular videos of 2026',
      body: 'See what everyone watched this year on YouTube.',
      time: 'Mar 9',
      brand: 'Youtube24',
    },
    {
      id: 'kate',
      sender: 'Kate Morrison',
      subject: 'First version',
      body: 'I think we should use the first version.',
      time: 'Mar 9',
      avatar: 'AvatarFemale04',
    },
    {
      id: 'threads',
      sender: 'Threads',
      subject: 'You have a new follower',
      body: 'Someone started following you on Threads.',
      time: 'Mar 8',
      brand: 'ThreadsLogo',
    },
    {
      id: 'koray',
      sender: 'Koray Okumus',
      subject: 'Search box interaction',
      body: "Let's talk about the search box interaction again",
      time: 'Mar 7',
      avatar: 'AvatarMale04',
    },
  ];

  function isRowUnread(row, state) {
    return !state.readIds[row.id];
  }

  function markRowRead(state, id) {
    if (id) state.readIds[id] = true;
  }

  function markRowUnread(state, id) {
    if (id) delete state.readIds[id];
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
    return !!state.starredIds[row.id];
  }

  function isRowImportant(row, state) {
    return !!state.importantIds[row.id];
  }

  function rowHasLabel(rowId, labelId, state) {
    return !!(state.rowLabels[rowId] && state.rowLabels[rowId][labelId]);
  }

  function rowHasAnyLabel(rowId, state) {
    return !!(state.rowLabels[rowId] && Object.keys(state.rowLabels[rowId]).length);
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
    var allChecked = isLabelCheckedForTargets(labelId, state);
    ids.forEach(function (id) {
      if (!state.rowLabels[id]) state.rowLabels[id] = {};
      if (allChecked) delete state.rowLabels[id][labelId];
      else state.rowLabels[id][labelId] = true;
      if (!Object.keys(state.rowLabels[id]).length) delete state.rowLabels[id];
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
    var items = EMAIL_LABELS.map(function (label) {
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
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-message-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    var initial = (row.sender || '?').charAt(0).toUpperCase();
    return '<span class="tma-dash__email-message-avatar tma-dash__email-message-avatar--initial" aria-hidden="true">' + esc(initial) + '</span>';
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

  var PROFILE = {
    name: 'Vernon Francis',
    email: 'vfrancis@tmantoinelaw.com',
    avatar: 'AvatarByewind',
  };

  function renderEmailProfileCard(variant) {
    var wrapCls = 'tma-dash__email-profile-wrap tma-dash__email-profile-wrap--' + variant;
    var profileCls = 'tma-dash__email-profile tma-dash__email-profile--' + variant;
    return (
      '<div class="' + wrapCls + '">' +
      '<div class="' + profileCls + '">' +
      '<img class="tma-dash__email-profile-avatar" src="' +
      AVATAR + esc(PROFILE.avatar) + '.png" alt="' + esc(PROFILE.name) + ' avatar" width="40" height="40">' +
      '<span class="tma-dash__email-profile-meta">' +
      '<span class="tma-dash__email-profile-name">' + esc(PROFILE.name) + '</span>' +
      '<span class="tma-dash__email-profile-email">' + esc(PROFILE.email) + '</span>' +
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
      AVATAR + esc(PROFILE.avatar) + '.png" alt="' + esc(PROFILE.name) + '" width="32" height="32">' +
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
      AVATAR + esc(PROFILE.avatar) + '.png" alt="' + esc(PROFILE.name) + ' avatar" width="24" height="24">' +
      '<span class="tma-dash__email-profile-meta">' +
      '<span class="tma-dash__email-profile-name">' + esc(PROFILE.name) + '</span>' +
      '<span class="tma-dash__email-profile-email">' + esc(PROFILE.email) + '</span>' +
      '</span>' +
      '<img class="tma-dash__email-profile-caret" src="' + ICONS.CaretDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="' + menuCls + '"' +
      ' data-email-profile-menu role="menu"' + (isOpen ? '' : ' hidden') + '>' +
      '<div class="tma-dash__email-profile-menu-head">' +
      '<img class="tma-dash__email-profile-menu-avatar" src="' +
      AVATAR + esc(PROFILE.avatar) + '.png" alt="" width="40" height="40">' +
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

  function filteredInbox(state) {
    var rows = INBOX.filter(function (row) {
      return !(state.removedIds && state.removedIds[row.id]);
    });
    if (state.activeLabelId) {
      rows = rows.filter(function (row) {
        return rowHasLabel(row.id, state.activeLabelId, state);
      });
    }
    var q = (state.search || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (row) {
      var lines = rowListLines(row);
      return (
        row.sender.toLowerCase().indexOf(q) !== -1 ||
        lines.subject.toLowerCase().indexOf(q) !== -1 ||
        lines.body.toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function getInboxUnreadCount(state) {
    var readIds = (state && state.readIds) || { slack: true };
    return INBOX.filter(function (row) {
      if (state && state.removedIds && state.removedIds[row.id]) return false;
      return !readIds[row.id];
    }).length;
  }

  function folderCount(folder, state) {
    if (folder.compose) return null;
    if (folder.countKey === 'inbox') {
      return INBOX.filter(function (row) {
        if (state.removedIds && state.removedIds[row.id]) return false;
        return isRowUnread(row, state);
      }).length;
    }
    if (folder.countKey === 'templates') {
      return window.TMAEmailTemplates ? window.TMAEmailTemplates.list().length : 0;
    }
    if (typeof folder.count === 'number') return folder.count;
    return null;
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
      renderEmailListBulk(state) +
      renderEmailBulkMoreMenu(state) +
      renderEmailLabelMenu(state) +
      renderListHeadActions(state, { showFilter: !isEmailMobile() }) +
      '</div>' +
      '<div class="tma-dash__email-list-body">' +
      rows.map(function (row) { return buildInboxRowHtml(row, state); }).join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderSlackBody() {
    return (
      '<div class="tma-dash__email-body">' +
      '<p>We\'re glad to see that you\'ve started using Slack. Join <strong>TM ANTOINE Advisory Community</strong> on Slack.</p>' +
      '<p>Your team name is <strong>TM ANTOINE Advisory Community</strong></p>' +
      '<p>Slack is a place where your team comes together to collaborate, stay connected, and get things done. ' +
      'From project kickoffs to quick questions, Slack keeps everyone in sync — no matter where they\'re working from.</p>' +
      '<button type="button" class="tma-dash__email-cta">Invite People</button>' +
      '<div class="tma-dash__email-avatar-grid" aria-hidden="true">' +
      ['AvatarFemale06', 'AvatarMale01', 'AvatarFemale04', 'AvatarMale03']
        .map(function (a) {
          return '<img src="' + AVATAR + a + '.png" alt="">';
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__email-signin-card">' +
      '<div class="tma-dash__email-signin-info">' +
      '<img src="' + BRAND + 'Slack24.svg" alt="">' +
      '<div>' +
      '<div class="tma-dash__email-signin-title">TM ANTOINE Advisory Community</div>' +
      '<div>Workspace URL: TM-ANTOINE-community</div>' +
      '<div>Email: byewind@live.com</div>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="tma-dash__email-signin-btn">Sign In</button>' +
      '</div>' +
      '<p class="tma-dash__email-copyright">©2026 Slack Technologies, LLC, a Salesforce company.</p>' +
      '</div>'
    );
  }

  function threadRowFromPrior(prior, fallbackTo) {
    return {
      sender: prior.sender || '',
      email: prior.email,
      avatar: prior.avatar,
      brand: prior.brand,
      to: prior.to || fallbackTo,
    };
  }

  function renderMessageBodyText(bodyText) {
    return '<div class="tma-dash__email-body"><p>' + esc(bodyText || '') + '</p></div>';
  }

  function renderEmailThread(row, messageHead, metaEmail, metaDate, subject, bodyText, threadActions, innerBodyHtml, state) {
    innerBodyHtml = innerBodyHtml || renderMessageBodyText(bodyText);
    var html = '<div class="tma-dash__email-thread">';
    if (row.repliedTo) {
      var prior = row.repliedTo;
      var priorRow = threadRowFromPrior(prior, { name: row.sender, email: metaEmail });
      var priorEmail = prior.email || '';
      var priorDate = prior.date || '';
      var priorSubject = prior.subject || subject;
      html +=
        '<article class="tma-dash__email-message tma-dash__email-message--prior">' +
        renderMessageHead(priorRow, priorEmail, priorDate, priorSubject, 'prior', state) +
        renderMessageBodyText(prior.body) +
        '</article>';
    }
    html +=
      '<article class="tma-dash__email-message tma-dash__email-message--current">' +
      messageHead +
      innerBodyHtml +
      '</article>' +
      (threadActions || '') +
      '</div>';
    return html;
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
    var row = INBOX.filter(function (r) { return r.id === state.selectedId; })[0];
    if (!row) {
      return '<div class="tma-dash__email-detail tma-dash__email-detail--empty"><p>Select a message</p></div>';
    }

    var lines = rowListLines(row);
    var subject = lines.subject;
    var metaEmail = row.email || (row.sender.toLowerCase().replace(/\s+/g, '') + '@example.com');
    var metaDate = row.dateLabel || row.time;
    var mobile = isEmailMobile();
    var messageHead = renderMessageHead(row, metaEmail, metaDate, subject, 'current', state);
    var threadActions = renderDetailThreadActions(state, row, metaEmail, metaDate, subject, lines.body);
    var inlineActive = !!(state.inlineCompose && state.inlineCompose.messageId === row.id);
    var scrollThreadActions = !mobile || inlineActive ? threadActions : null;
    var body = row.slack
      ? renderEmailThread(row, messageHead, metaEmail, metaDate, subject, lines.body, scrollThreadActions, renderSlackBody(), state)
      : renderEmailThread(row, messageHead, metaEmail, metaDate, subject, lines.body, scrollThreadActions, null, state);

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

  function getComposeSubject(draft) {
    if (draft.templateId && window.TMAEmailTemplates) {
      var template = window.TMAEmailTemplates.get(draft.templateId);
      if (template) return template.subject;
    }
    if (draft.subject) return draft.subject;
    return COMPOSE_SUBJECT;
  }

  function createComposeDraft(state, opts) {
    opts = opts || {};
    return {
      id: 'compose-' + state.nextComposeId++,
      templateId: opts.templateId || null,
      subject: opts.subject || '',
      minimized: false,
      expanded: false,
    };
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

  function wireComposeEvents(root, state, render) {
    root.querySelectorAll('[data-email-compose-window]').forEach(function (windowEl) {
      windowEl.addEventListener('mousedown', function () {
        var id = windowEl.getAttribute('data-email-compose-window');
        if (state.focusedComposeId !== id) {
          state.focusedComposeId = id;
          render();
        }
      });
    });

    root.querySelectorAll('[data-email-compose-minimize]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        minimizeCompose(state, btn.getAttribute('data-email-compose-minimize'));
        render();
      });
    });

    root.querySelectorAll('[data-email-compose-expand]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleComposeExpand(state, btn.getAttribute('data-email-compose-expand'));
        render();
      });
    });

    root.querySelectorAll('[data-email-compose-close]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        closeCompose(state, btn.getAttribute('data-email-compose-close'));
        render();
      });
    });

    root.querySelectorAll('[data-email-compose-restore]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        if (event.target.closest('[data-email-compose-close]')) return;
        restoreCompose(state, btn.getAttribute('data-email-compose-restore'));
        render();
      });
    });

    root.querySelectorAll('[data-email-compose-discard]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeCompose(state, btn.getAttribute('data-email-compose-discard'));
        render();
      });
    });
  }

  function renderRecipientChip(recipient) {
    if (!window.TMATag) return '';

    if (recipient.type === 'avatar') {
      return window.TMATag.renderTag({
        label: recipient.label,
        iconClass: 'tma-tag__icon--avatar',
        leftIcon: '<img src="' + AVATAR + esc(recipient.avatar) + '.png" alt="">',
      });
    }

    if (recipient.type === 'brand') {
      return window.TMATag.renderTag({
        label: recipient.label,
        leftIcon: '<img src="' + esc(BRAND + recipient.brand + '.svg') + '" alt="">',
      });
    }

    return window.TMATag.renderTag({
      label: recipient.label,
      removable: false,
      rightIcon: '<img class="tma-tag__caret" src="' + ICONS.CaretDown + '" alt="">',
    });
  }

  function renderComposeToolbar() {
    var groups = [
      [
        { icon: 'ArrowUUpLeft', label: 'Undo' },
        { icon: 'ArrowUUpRight', label: 'Redo' },
      ],
      [
        { icon: 'TextT', label: 'Text style', caret: true },
        { icon: 'TextAa', label: 'Text color', caret: true },
      ],
      [
        { icon: 'TextB', label: 'Bold' },
        { icon: 'TextItalic', label: 'Italic' },
        { icon: 'TextUnderline', label: 'Underline' },
        { icon: 'TextStrikethrough', label: 'Strikethrough' },
        { icon: 'ListBullets', label: 'Bulleted list' },
      ],
      [
        { icon: 'Link', label: 'Insert link' },
        { icon: 'DotsThree', label: 'More' },
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
                  '<button type="button" class="tma-dash__email-compose-tool' + (item.caret ? ' tma-dash__email-compose-tool--caret' : '') + '" aria-label="' + esc(item.label) + '">' +
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

  function defaultComposeBody(draft) {
    if (draft.templateId && window.TMAEmailTemplates) {
      return (
        '<div class="tma-dash__email-compose-template-body">' +
        window.TMAEmailTemplates.renderBody(draft.templateId) +
        '</div>'
      );
    }
    if (window.TMAEmailTemplates) {
      return (
        '<div class="tma-dash__email-compose-template-body">' +
        window.TMAEmailTemplates.renderBody('invoice') +
        '</div>'
      );
    }
    return '';
  }

  function renderComposeContent(draft) {
    var subject = getComposeSubject(draft);
    var bodyHtml = defaultComposeBody(draft);

    return (
      '<div class="tma-dash__email-compose">' +
      '<div class="tma-dash__email-compose-headers">' +
      '<div class="tma-dash__email-compose-to">' +
      '<span class="tma-dash__email-compose-label">To</span>' +
      '<div class="tma-dash__email-compose-recipients">' +
      RECIPIENTS.map(renderRecipientChip).join('') +
      '</div>' +
      '<button type="button" class="tma-dash__email-compose-expand" aria-label="Show Cc and Bcc">' +
      '<img src="' + ICONS.ArrowLineUpDown + '" alt="">' +
      '</button>' +
      '</div>' +
      '<div class="tma-dash__email-compose-subject">' +
      '<span class="tma-dash__email-compose-label">Subject</span>' +
      '<span class="tma-dash__email-compose-subject-value">' + esc(subject) + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__email-compose-editor">' +
      renderComposeToolbar() +
      '<div class="tma-dash__email-compose-body">' + bodyHtml + '</div>' +
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
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--late">Send late</button>' +
      '<button type="button" class="tma-dash__email-compose-send-btn tma-dash__email-compose-send-btn--primary">Send</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
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
    if (row.avatar) {
      return (
        '<span class="tma-dash__email-row-avatar">' +
        '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
        '</span>'
      );
    }
    var initial = (row.sender || '?').charAt(0).toUpperCase();
    return '<span class="tma-dash__email-row-avatar tma-dash__email-row-avatar--initial" aria-hidden="true">' + esc(initial) + '</span>';
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

  function renderRowSubjectBody(lines) {
    var subject = lines.subject || '';
    var body = lines.body || '';
    var html =
      '<span class="tma-dash__email-row-subject">' +
      '<span class="tma-dash__email-row-subject-text">' + esc(subject) + '</span>';
    if (body && body !== subject) {
      html += '<span class="tma-dash__email-row-body"> — ' + esc(body) + '</span>';
    }
    return html + '</span>';
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

  function dismissEmailRow(state, id, destination) {
    if (!id) return;
    if (!state.removedIds) state.removedIds = {};
    state.removedIds[id] = destination;
    delete state.checkedIds[id];
    if (state.selectedId === id) {
      state.selectedId = null;
      state.reading = false;
    }
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
        state.selectedId = id;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        markRowRead(state, id);
        render();
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

    root.querySelectorAll('[data-email-row-swipe-action]').forEach(function (btn) {
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
    listBody.innerHTML = rows.map(function (row) {
      return buildInboxRowHtml(row, state);
    }).join('');

    var selectAll = root.querySelector('[data-email-selectall]');
    if (selectAll) {
      var allChecked = rows.length > 0 && rows.every(function (row) { return isRowChecked(row, state); });
      selectAll.checked = allChecked;
      selectAll.indeterminate = false;
    }

    wireListRows(root, state, render);
  }

  function wireListRows(root, state, render) {
    root.querySelectorAll('[data-email-row]').forEach(function (rowEl) {
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
        var id = rowEl.getAttribute('data-email-row');
        state.selectedId = id;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        markRowRead(state, id);
        render();
      });

      rowEl.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (isEmailRowSelectTarget(event.target)) return;
        if (event.target.closest('.tma-dash__email-row-action')) return;
        event.preventDefault();
        var id = rowEl.getAttribute('data-email-row');
        state.selectedId = id;
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        markRowRead(state, id);
        render();
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

      cb.addEventListener('click', function (event) {
        event.stopPropagation();
      });

      cb.addEventListener('change', function (event) {
        event.stopPropagation();
        syncRowCheck(cb, id);
        syncSelectAll();
      });
    });

    root.querySelectorAll('[data-email-avatar-select]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (event) {
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
      selectAll.addEventListener('change', function () {
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

    root.querySelectorAll('[data-email-star]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-star');
        if (state.starredIds[id]) delete state.starredIds[id];
        else state.starredIds[id] = true;
        var starred = !!state.starredIds[id];
        root.querySelectorAll('[data-email-star="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-row-action--active', starred);
          el.classList.toggle('tma-dash__email-detail-star--active', starred);
          el.setAttribute('aria-pressed', starred ? 'true' : 'false');
          el.setAttribute('aria-label', starred ? 'Remove star' : 'Add star');
        });
        pulseEmailActionBtn(btn);
      });
    });

    root.querySelectorAll('[data-email-important]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var id = btn.getAttribute('data-email-important');
        if (state.importantIds[id]) delete state.importantIds[id];
        else state.importantIds[id] = true;
        var important = !!state.importantIds[id];
        root.querySelectorAll('[data-email-important="' + id + '"]').forEach(function (el) {
          el.classList.toggle('tma-dash__email-detail-important--active', important);
          el.classList.toggle('tma-dash__email-row-action--active', important);
          el.setAttribute('aria-pressed', important ? 'true' : 'false');
          el.setAttribute('aria-label', important ? 'Mark as not important' : 'Mark as important');
        });
        pulseEmailActionBtn(btn);
      });
    });

    root.querySelectorAll('[data-email-detail-label-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var rowId = btn.getAttribute('data-email-row-id');
        var labelId = btn.getAttribute('data-email-label-id');
        if (!rowId || !labelId) return;
        if (labelId === 'address') {
          if (!state.hiddenDetailChips[rowId]) state.hiddenDetailChips[rowId] = {};
          state.hiddenDetailChips[rowId].address = true;
        } else if (state.rowLabels[rowId]) {
          delete state.rowLabels[rowId][labelId];
          if (!Object.keys(state.rowLabels[rowId]).length) delete state.rowLabels[rowId];
        }
        render();
      });
    });

    root.querySelectorAll('[data-email-label]').forEach(function (btn) {
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

    root.querySelectorAll('[data-email-label-option]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var labelId = btn.getAttribute('data-email-label-option');
        toggleLabelForTargets(labelId, state);
        syncLabelMenuChecks(root, state);
        syncRowLabelButtons(root, state);
        render();
      });
    });

    root.querySelectorAll('[data-email-sidebar-label]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var labelId = btn.getAttribute('data-email-sidebar-label');
        if (state.activeLabelId === labelId) state.activeLabelId = null;
        else state.activeLabelId = labelId;
        state.folder = 'inbox';
        state.reading = false;
        state.mobileNavOpen = false;
        syncEmailUrl('inbox');
        render();
      });
    });

    root.querySelectorAll('[data-email-row-hover]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var action = btn.getAttribute('data-email-row-hover');
        var id = btn.getAttribute('data-email-row-id');
        var rowEl = root.querySelector('[data-email-row="' + id + '"]');
        if (!id || !rowEl) return;

        if (action === 'read') {
          if (isRowUnread({ id: id }, state)) {
            markRowRead(state, id);
            syncEmailRowReadClasses(rowEl, false);
          } else {
            markRowUnread(state, id);
            syncEmailRowReadClasses(rowEl, true);
          }
          var readBtn = rowEl.querySelector('[data-email-row-hover="read"]');
          if (readBtn) {
            var nowUnread = isRowUnread({ id: id }, state);
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

        var inlineComposeBtn = event.target.closest('[data-email-inline-compose]');
        if (inlineComposeBtn && !inlineComposeBtn.closest('[data-email-inline-compose-panel]')) {
          var composeMode = inlineComposeBtn.getAttribute('data-email-inline-compose');
          if (composeMode === 'reply' || composeMode === 'forward') {
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
          if (action === 'settings') window.location.href = '/settings';
          if (action === 'sign-out') window.location.href = '/sign-in';
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
            updateInboxList(root, state, render);
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
            updateInboxList(root, state, render);
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

    root.querySelectorAll('[data-email-folder]').forEach(function (btn) {
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
        if (folder === 'templates' || folder === 'inbox') syncEmailUrl(folder);
        render();
      });
    });

    root.querySelectorAll('[data-email-bulk-more-item]').forEach(function (btn) {
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

        if (item === 'unread') {
          ids.forEach(function (id) {
            markRowUnread(state, id);
            syncEmailRowReadClasses(root.querySelector('[data-email-row="' + id + '"]'), true);
          });
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

        if (action === 'read') {
          ids.forEach(function (id) {
            markRowRead(state, id);
            syncEmailRowReadClasses(root.querySelector('[data-email-row="' + id + '"]'), false);
          });
        }
      });
    }

    root.querySelectorAll('[data-email-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedTemplateId = btn.getAttribute('data-email-template');
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        render();
      });
    });

    root.querySelectorAll('[data-email-mobile-scrim]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mobileNavOpen = false;
        closeEmailProfileSidebar(state);
        render();
      });
    });

    root.querySelectorAll('[data-email-mobile-compose]').forEach(function (btn) {
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

    root.querySelectorAll('[data-email-layout]').forEach(function (btn) {
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

    root.querySelectorAll('[data-email-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var nav = getDetailNavState(state);
        if (!nav) return;
        var dir = btn.getAttribute('data-email-nav');
        var id = dir === 'prev' ? nav.prevId : nav.nextId;
        if (!id) return;
        state.selectedId = id;
        markRowRead(state, id);
        if (state.layoutStyle === 'single' || isEmailMobile()) state.reading = true;
        render();
      });
    });

    root.querySelectorAll('[data-email-use-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompose(state, { templateId: btn.getAttribute('data-email-use-template') });
        syncEmailUrl('inbox');
        render();
      });
    });

    root.querySelectorAll('[data-email-template-viewport]').forEach(function (btn) {
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
      selectedId: 'slack',
      selectedTemplateId: 'auth-sign-in',
      composeDrafts: [],
      nextComposeId: 1,
      focusedComposeId: null,
      templateViewport: 'desktop',
      profileMenuOpen: false,
      search: '',
      searchFocused: false,
      searchLoading: false,
      readIds: { slack: true },
      removedIds: {},
      checkedIds: {},
      starredIds: {},
      importantIds: { slack: true, andi: true },
      hiddenDetailChips: {},
      rowLabels: {
        slack: { work: true },
        drew: { personal: true },
        andi: { work: true, important: true },
        behance: { updates: true },
        kate: { work: true },
        koray: { work: true, travel: true },
        facebook: { updates: true },
        youtube: { travel: true },
      },
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
      if (window.PortalTooltip && window.PortalTooltip.hideAll) window.PortalTooltip.hideAll();
      closeEmailBulkMoreMenu(root, state);
      closeEmailLabelPopup(root, state);
      syncEmailHeaderSearch(root, state);
      ensureEmailMobileHeader(root, state);
      root.innerHTML =
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
        '</div>';
      wireEvents(root, state, render);
      wireComposeEvents(root, state, render);
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
    render();
  }

  window.TMAEmail = {
    mount: mount,
    restoreHeaderSearch: restoreHeaderSearch,
    getInboxUnreadCount: getInboxUnreadCount,
  };
})();
