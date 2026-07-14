/* TMA - Component state panel (Figma 30484:299251) */
(function () {
  'use strict';

  const IN = window.TMAInput;
  const DOC = window.TMAInteractiveGuidanceDoc;
  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;
  const biSvg = window.TMAButtonInstancesIcons && window.TMAButtonInstancesIcons.svg;
  const bgSvg = window.TMAButtonGroupDocIcons && window.TMAButtonGroupDocIcons.svg;
  const tagSvg = window.TMATagIcons && window.TMATagIcons.svg;
  const popSvg = window.TMAPopoverIcons && window.TMAPopoverIcons.svg;
  const cardSvg = window.TMACardIcons && window.TMACardIcons.svg;

  const CURSOR_BASE = '../images/cursors/';
  const AVATAR_BASE = '../images/avatars/';

  const G = 116;
  const gy = (y) => y + G;

  const COLS = {
    default: 232,
    hover: 472,
    disabled: 712,
    focus: 952,
    progress: 1192,
    done: 1432,
    error: 1672,
    active: 1912,
  };

  const COL_HEADERS = [
    ['default', 'Default'],
    ['hover', 'Hover'],
    ['disabled', 'Disabled'],
    ['focus', 'Focus'],
    ['progress', 'In progress'],
    ['done', 'Done'],
    ['error', 'Error'],
    ['active', 'Active'],
  ];

  const FIELD_STATES = ['default', 'hover', 'disabled', 'focus', 'progress', 'done', 'error'];
  const FIELD_W = 200;
  const BOARD_W = 2162;
  const BOARD_H = 3185;

  const ROWS = {
    searchFilled: gy(116),
    searchOutline: gy(164),
    searchLabel: gy(154),
    inputLabel: gy(300),
    input1row: gy(272),
    titleVertical: gy(408),
    textarea: gy(562),
    textareaCounter: gy(714),
    titleInput: gy(866),
    select: gy(1034),
    controlsLabel: gy(1446),
    controlsRule: gy(1270),
    cursors: gy(1681),
    scrollbar: gy(1793),
    iconButtons: gy(1953),
    buttons: gy(2126),
    tag: gy(2378),
    avatar: gy(2480),
    avatarName: gy(2584),
    breadcrumb: gy(2718),
    textLink: gy(2827),
    popoverItem: gy(2943),
    tableTitle: gy(3041),
    tab: gy(3173),
  };

  const RULE_LINES = [
    76,
    gy(232), gy(368), gy(522), gy(674), gy(826), gy(994),
    gy(1270), gy(1622), gy(1753), gy(1913), gy(2085), gy(2338),
    gy(2440), gy(2544), gy(2678), gy(2786), gy(2885), gy(3001), gy(3121),
  ];

  function svg(key, cls, w, h) {
    const sources = [tsSvg, biSvg, bgSvg, tagSvg, popSvg, cardSvg];
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i]) {
        const result = sources[i](key, cls, w, h);
        if (result) return result;
      }
    }
    return (window.TMAInputIcons && window.TMAInputIcons.svg(key, cls, w, h)) || '';
  }

  function cursorImg(kind, left, top) {
    const files = {
      default: 'CursorsDefault.png',
      hand: 'CursorsHandPointing.png',
      disabled: 'CursorsDefault.png',
      resize: 'CursorsResizeNorthWestSouthEast.png',
    };
    const modifiers = {
      hand: ' tma-cs-cursor--hand',
      disabled: ' tma-cs-cursor--disabled',
      resize: ' tma-cs-cursor--resize',
    };
    const file = files[kind] || files.default;
    const mod = modifiers[kind] || '';
    return `<img class="tma-cs-cursor${mod}" src="${CURSOR_BASE}${file}" width="32" height="32" alt="" style="left:${left}px;top:${top}px" aria-hidden="true">`;
  }

  function resizeCursor(left, top) {
    return `<img class="tma-forms-guidance-page__resize-cursor" src="${CURSOR_BASE}CursorsResizeNorthWestSouthEast.png" width="32" height="32" alt="" style="left:${left}px;top:${top}px" aria-hidden="true">`;
  }

  function avatarImg(file, cls) {
    return `<img class="${cls}" src="${AVATAR_BASE}${file}" alt="" width="24" height="24">`;
  }

  function board(html) {
    return `<div class="tma-forms-guidance-page__board-wrap tma-cs-board-wrap"><div class="tma-forms-guidance-page__board" style="width:${BOARD_W}px;height:${BOARD_H}px">${html}</div></div>`;
  }

  function place(left, top, html, w) {
    const width = w != null ? w : FIELD_W;
    return `<div class="tma-forms-guidance-page__item" style="left:${left}px;top:${top}px;width:${width}px">${html}</div>`;
  }

  function placeFree(left, top, html, w) {
    const width = w != null ? `width:${w}px;` : '';
    return `<div class="tma-forms-guidance-page__item" style="left:${left}px;top:${top}px;${width}">${html}</div>`;
  }

  function lbl(text, top, left) {
    const x = left != null ? left : 0;
    return `<p class="tma-forms-guidance-page__label" style="left:${x}px;top:${top}px">${text}</p>`;
  }

  function note(text, left, top, width) {
    const style = width
      ? `left:${left}px;top:${top}px;width:${width}px`
      : `left:${left}px;top:${top}px`;
    if (String(text).includes('<')) {
      return `<div class="tma-forms-guidance-page__note" style="${style}">${text}</div>`;
    }
    return `<p class="tma-forms-guidance-page__note" style="${style}">${text}</p>`;
  }

  function noteList(items, left, top, width) {
    const lis = items.map((i) => `<li>${i}</li>`).join('');
    const w = width ? `width:${width}px;` : '';
    return `<ul class="tma-forms-guidance-page__list" style="left:${left}px;top:${top}px;${w}">${lis}</ul>`;
  }

  function lineV(left, top, height) {
    return `<span class="tma-forms-guidance-page__callout-line tma-forms-guidance-page__callout-line--v" style="left:${left}px;top:${top}px;height:${height}px"></span>`;
  }

  function renderColumnHeaders() {
    return COL_HEADERS.map(([key, label]) =>
      `<p class="tma-forms-guidance-page__col-header" style="left:${COLS[key]}px;top:0">${label}</p>`,
    ).join('');
  }

  function renderHorizontalRules() {
    return RULE_LINES.map((top) =>
      `<span class="tma-forms-guidance-page__rule" style="top:${top}px"></span>`,
    ).join('');
  }

  function renderFieldMatrix(variant, row) {
    return FIELD_STATES.map((state) =>
      place(COLS[state], row, IN.renderGuidanceField({ variant, state })),
    ).join('');
  }

  function renderSearchMatrix(variant, row) {
    return FIELD_STATES.map((state) =>
      place(COLS[state], row, IN.renderGuidanceSearch({ variant, state, wide: ['focus', 'progress', 'done', 'error'].includes(state) }), variant === 'outline' && ['focus', 'progress', 'done', 'error'].includes(state) ? 180 : 160),
    ).join('');
  }

  function renderControlsColumn(col, state) {
    const opacity = state === 'disabled' ? ' tma-cs-controls--disabled' : '';
    const opts = { state: state === 'disabled' ? 'disabled' : (state === 'hover' ? 'hover' : 'default') };
    const items = [
      { top: gy(1310), html: IN.renderRadio({ selected: true, ...opts }) },
      { top: gy(1350), html: IN.renderRadio({ selected: false, ...opts }) },
      { top: gy(1390), html: IN.renderCheckbox({ checked: 'checked', ...opts }) },
      { top: gy(1430), html: IN.renderCheckbox({ checked: 'unchecked', ...opts }) },
      { top: gy(1470), html: IN.renderCheckbox({ checked: 'indeterminate', ...opts }) },
      { top: gy(1510), html: IN.renderSwitch({ on: true, ...opts }) },
      { top: gy(1550), html: IN.renderSwitch({ on: false, ...opts }) },
    ];
    return items.map((item) =>
      `<div class="tma-cs-controls${opacity}" style="left:${col}px;top:${item.top}px">${item.html}</div>`,
    ).join('');
  }

  function renderControlsBlock() {
    return renderControlsColumn(COLS.default, 'default')
      + renderControlsColumn(COLS.hover, 'hover')
      + renderControlsColumn(COLS.disabled, 'disabled');
  }

  function renderCursor(kind, left, top) {
    return cursorImg(kind, left, top);
  }

  function renderScrollbar(state, left, top) {
    const hover = state === 'hover';
    return `<span class="tma-cs-scrollbar${hover ? ' tma-cs-scrollbar--hover' : ''}" style="left:${left}px;top:${top}px" aria-hidden="true"></span>`;
  }

  function renderIconBtn(iconKey, state, left, top) {
    const cls = [
      'tma-cs-icon-btn',
      state === 'hover' ? 'tma-cs-icon-btn--hover' : '',
      state === 'active' ? 'tma-cs-icon-btn--active' : '',
    ].filter(Boolean).join(' ');
    const icon = svg(iconKey, 'tma-cs-icon-btn__svg', 16, 16);
    return `<div class="${cls}" style="left:${left}px;top:${top}px">${icon}</div>`;
  }

  function renderIconOnly(iconKey, left, top) {
    const icon = svg(iconKey, 'tma-cs-icon-only__svg', 16, 16);
    return `<div class="tma-cs-icon-only" style="left:${left}px;top:${top}px">${icon}</div>`;
  }

  function renderIconOnlyLarge(iconKey, left, top, size) {
    const px = size || 24;
    const icon = svg(iconKey, 'tma-cs-icon-only__svg', px, px);
    return `<div class="tma-cs-icon-only tma-cs-icon-only--lg" style="left:${left}px;top:${top}px">${icon}</div>`;
  }

  const ICON_ROW1 = ['CaretLeftDuotone16', 'BellDuotone16'];
  const ICON_ROW2 = ['PlusCircleDuotone16', 'GearSixDuotone16', 'TrashDuotone16', 'CaretLeftDuotone16'];

  function renderIconButtonColumn(col, state) {
    const y1 = gy(1953);
    const y2 = gy(1989);
    const y3 = gy(2029);
    const y4 = gy(2025);
    const btnStep = 32;
    const html = [];

    ICON_ROW1.forEach((key, i) => {
      html.push(renderIconBtn(key, state, col + i * btnStep, y1));
    });
    ICON_ROW2.forEach((key, i) => {
      html.push(renderIconBtn(key, state, col + i * btnStep, y2));
    });
    html.push(renderIconOnly('ArrowLineDown16', col + 6, y3));
    html.push(renderIconOnly('ArrowLineRight16', col + 42, y3));
    html.push(renderIconOnlyLarge('CheckCircleFill24', col + 74, y4, 24));

    return html.join('');
  }

  function renderActiveIconButton() {
    return renderIconBtn('BellDuotone16', 'active', COLS.active, gy(1953));
  }

  function renderTextButton(state, left, top) {
    const cls = [
      'tma-cs-text-btn',
      state === 'hover' ? 'tma-cs-text-btn--hover' : '',
      state === 'disabled' ? 'tma-cs-text-btn--disabled' : '',
      state === 'focus' ? 'tma-cs-text-btn--focus' : '',
      state === 'active' ? 'tma-cs-text-btn--active' : '',
      state === 'filled' ? 'tma-cs-text-btn--filled' : '',
    ].filter(Boolean).join(' ');
    const slot = '<span class="tma-cs-text-btn__slot" aria-hidden="true"></span>';
    return `<div class="${cls}" style="left:${left}px;top:${top}px">${slot}<span class="tma-cs-text-btn__label">Button</span>${slot}</div>`;
  }

  function renderTagState(state, left, top) {
    const cls = [
      'tma-cs-tag',
      state === 'hover' ? 'tma-cs-tag--hover' : '',
      state === 'disabled' ? 'tma-cs-tag--disabled' : '',
      state === 'active' ? 'tma-cs-tag--active' : '',
    ].filter(Boolean).join(' ');
    const dot = `<span class="tma-cs-tag__dot">${svg('Dot12', 'tma-cs-tag__dot-svg', 12, 12)}</span>`;
    const close = state !== 'disabled'
      ? `<button type="button" class="tma-cs-tag__close" aria-label="Remove Tag">${svg('Close12', 'tma-cs-tag__close-svg', 12, 12)}</button>`
      : '';
    return `<span class="${cls}" style="left:${left}px;top:${top}px">${dot}<span class="tma-cs-tag__label">Tag</span>${close}</span>`;
  }

  function renderAvatarByewind(state, left, top) {
    const cls = [
      'tma-cs-avatar tma-cs-avatar--photo',
      state === 'hover' ? 'tma-cs-avatar--hover' : '',
    ].filter(Boolean).join(' ');
    return `<span class="${cls}" style="left:${left}px;top:${top}px">${avatarImg('AvatarByewind.png', 'tma-cs-avatar__photo')}</span>`;
  }

  function renderAvatarDefault(state, left, top) {
    const cls = [
      'tma-cs-avatar tma-cs-avatar--default',
      state === 'hover' ? 'tma-cs-avatar--hover tma-cs-avatar--default-hover' : '',
    ].filter(Boolean).join(' ');
    const icon = svg('User16', 'tma-cs-avatar__icon', 12, 12);
    return `<span class="${cls}" style="left:${left}px;top:${top}px">${icon}</span>`;
  }

  function renderAvatarNophoto(state, left, top) {
    const cls = [
      'tma-cs-avatar tma-cs-avatar--nophoto',
      state === 'hover' ? 'tma-cs-avatar--nophoto-hover' : '',
    ].filter(Boolean).join(' ');
    const textCls = state === 'hover' ? 'tma-cs-avatar__letter tma-cs-avatar__letter--hover' : 'tma-cs-avatar__letter';
    return `<span class="${cls}" style="left:${left}px;top:${top}px"><span class="${textCls}">F</span></span>`;
  }

  function renderAvatarRow(state, col) {
    const top = ROWS.avatar;
    return renderAvatarByewind(state, col, top)
      + renderAvatarDefault(state, col + 32, top)
      + renderAvatarNophoto(state, col + 64, top);
  }

  function renderAvatarNameState(state) {
    const cls = [
      'tma-cs-avatar-name',
      state === 'hover' ? 'tma-cs-avatar-name--hover' : '',
    ].filter(Boolean).join(' ');
    const avatarCls = 'tma-cs-avatar tma-cs-avatar--photo' + (state === 'hover' ? ' tma-cs-avatar--hover' : '');
    return `<span class="${cls}">
      <span class="${avatarCls}">${avatarImg('AvatarByewind.png', 'tma-cs-avatar__photo')}</span>
      <span class="tma-cs-avatar-name__text">ByeWind</span>
      <span class="tma-cs-avatar-name__time">19:28</span>
    </span>`;
  }

  function renderBreadcrumbState(state, left, top) {
    const muted = state === 'default';
    const cls = muted ? 'tma-cs-breadcrumb tma-cs-breadcrumb--muted' : 'tma-cs-breadcrumb';
    const current = state === 'hover' ? 'Button' : 'Default';
    const currentCls = state === 'hover' ? 'tma-cs-breadcrumb__current tma-cs-breadcrumb__current--hover' : 'tma-cs-breadcrumb__current';
    return `<nav class="${cls}" style="left:${left}px;top:${top}px" aria-label="Breadcrumb">
      <span class="tma-cs-breadcrumb__segment">Dashboards</span>
      <span class="tma-cs-breadcrumb__sep">/</span>
      <span class="${currentCls}">${current}</span>
    </nav>`;
  }

  function renderTextLinkSegments(left, top, state) {
    const cls = state === 'default' ? 'tma-cs-text-segments tma-cs-text-segments--muted' : 'tma-cs-text-segments';
    return `<div class="${cls}" style="left:${left}px;top:${top}px">
      <span>About</span><span>Support</span><span>Contact Us</span>
    </div>`;
  }

  function renderTextLinkState(state, left, top) {
    const cls = [
      'tma-cs-text-link',
      state === 'hover' ? 'tma-cs-text-link--hover' : '',
      state === 'disabled' ? 'tma-cs-text-link--disabled' : '',
      state === 'active' ? 'tma-cs-text-link--active' : '',
    ].filter(Boolean).join(' ');
    return `<a class="${cls}" href="#" style="left:${left}px;top:${top}px">Text link</a>`;
  }

  function renderPopoverItemState(state, left, top) {
    const cls = [
      'tma-cs-popover-item',
      state === 'hover' ? 'tma-cs-popover-item--hover' : '',
      state === 'disabled' ? 'tma-cs-popover-item--disabled' : '',
      state === 'active' ? 'tma-cs-popover-item--active' : '',
    ].filter(Boolean).join(' ');
    return `<div class="${cls}" style="left:${left}px;top:${top}px">Popover item</div>`;
  }

  function renderTableTitleState(state, left, top) {
    const cls = [
      'tma-cs-table-title',
      state === 'hover' ? 'tma-cs-table-title--hover' : '',
      state === 'disabled' ? 'tma-cs-table-title--disabled' : '',
      state === 'active' ? 'tma-cs-table-title--active' : '',
    ].filter(Boolean).join(' ');
    return `<div class="${cls}" style="left:${left}px;top:${top}px">Table title</div>`;
  }

  function renderTabState(state, left, top) {
    const active = state === 'active' || state === 'default';
    const hover = state === 'hover';
    const disabled = state === 'disabled';
    const cls = [
      'tma-cs-tab',
      active ? 'tma-cs-tab--active' : '',
      hover ? 'tma-cs-tab--hover' : '',
      disabled ? 'tma-cs-tab--disabled' : '',
      state === 'focus' ? 'tma-cs-tab--focus' : '',
    ].filter(Boolean).join(' ');
    const line = active ? '<span class="tma-cs-tab__line" aria-hidden="true"></span>' : '';
    return `<div class="${cls}" style="left:${left}px;top:${top}px"><span class="tma-cs-tab__label">Text</span>${line}</div>`;
  }

  function renderIconButtonGroup(state, left, top) {
    return renderIconButtonColumn(left, state);
  }

  function renderMatrixBoard() {
    const selectDropdown = place(COLS.focus, ROWS.select + 60, IN.renderSelectDropdown());
    const resizeCursors = [
      resizeCursor(652, gy(592)),
      resizeCursor(652, gy(757)),
    ].join('');

    return board([
      renderColumnHeaders(),
      renderHorizontalRules(),
      lbl('Search', ROWS.searchLabel),
      lbl('Input', ROWS.inputLabel),
      lbl('Radio, Checkbox, Switch', ROWS.controlsLabel),
      lbl('Cursors', gy(1697)),
      lbl('Scrollbar', gy(1833)),
      lbl('Icon &amp; Icon button', gy(2001)),
      lbl('Button', ROWS.buttons - 14),
      lbl('Tag', ROWS.tag - 14),
      lbl('Avatar', ROWS.avatar - 14),
      lbl('Avatar name', ROWS.avatarName - 14),
      lbl('Breadcrumb', gy(2736)),
      lbl('Text link', gy(2843)),
      lbl('Popover Item', ROWS.popoverItem - 14),
      lbl('Table Title', ROWS.tableTitle - 14),
      lbl('Tab', ROWS.tab - 14),
      note('Title get smaller when in focus.', 994, gy(379)),
      noteList([
        'The error message is displayed below the form.',
        'The error will push the content down.',
      ], 1922, gy(335), 240),
      renderSearchMatrix('filled', ROWS.searchFilled),
      renderSearchMatrix('outline', ROWS.searchOutline),
      renderFieldMatrix('1row', ROWS.input1row),
      renderFieldMatrix('title-vertical', ROWS.titleVertical),
      renderFieldMatrix('textarea', ROWS.textarea),
      renderFieldMatrix('textarea-counter', ROWS.textareaCounter),
      renderFieldMatrix('title-input', ROWS.titleInput),
      renderFieldMatrix('select', ROWS.select),
      selectDropdown,
      renderControlsBlock(),
      resizeCursors,
      lineV(1870, gy(335), 42),
      renderCursor('default', COLS.default, ROWS.cursors),
      renderCursor('hand', COLS.hover, ROWS.cursors),
      renderCursor('disabled', COLS.disabled, ROWS.cursors),
      renderScrollbar('default', COLS.default, ROWS.scrollbar),
      renderScrollbar('hover', COLS.hover, ROWS.scrollbar),
      renderIconButtonGroup('default', COLS.default, ROWS.iconButtons),
      renderIconButtonGroup('hover', COLS.hover, ROWS.iconButtons),
      renderActiveIconButton(),
      renderTextButton('default', COLS.default, ROWS.buttons),
      renderTextButton('hover', COLS.hover, ROWS.buttons + 36),
      renderTextButton('focus', COLS.focus, ROWS.buttons + 72),
      renderTextButton('filled', COLS.done, ROWS.buttons + 108),
      renderTextButton('active', COLS.active, ROWS.buttons + 144),
      renderTagState('default', COLS.default, ROWS.tag),
      renderTagState('hover', COLS.hover, ROWS.tag),
      renderTagState('disabled', COLS.disabled, ROWS.tag),
      renderTagState('active', COLS.active, ROWS.tag),
      renderAvatarRow('default', COLS.default),
      renderAvatarRow('hover', COLS.hover),
      placeFree(COLS.default, ROWS.avatarName, renderAvatarNameState('default'), 180),
      placeFree(COLS.hover, ROWS.avatarName, renderAvatarNameState('hover'), 180),
      renderBreadcrumbState('default', COLS.default, ROWS.breadcrumb),
      renderBreadcrumbState('hover', COLS.hover, ROWS.breadcrumb),
      renderTextLinkSegments(COLS.default, ROWS.textLink, 'default'),
      renderTextLinkSegments(COLS.hover, ROWS.textLink, 'hover'),
      renderPopoverItemState('default', COLS.default, ROWS.popoverItem),
      renderPopoverItemState('hover', COLS.hover, ROWS.popoverItem),
      renderPopoverItemState('active', COLS.active, ROWS.popoverItem),
      renderTableTitleState('default', COLS.default, ROWS.tableTitle),
      renderTableTitleState('hover', COLS.hover, ROWS.tableTitle),
      renderTableTitleState('active', COLS.active, ROWS.tableTitle),
      renderTabState('default', COLS.default, ROWS.tab - 24),
      renderTabState('hover', COLS.hover, ROWS.tab - 24),
      renderTabState('disabled', COLS.disabled, ROWS.tab - 24),
      renderTabState('active', COLS.active, ROWS.tab - 24),
    ].join(''));
  }

  function renderComponentState() {
    const intro = `<section class="ig-doc__section ig-doc__section--plain ig-component-state__intro">
      <p class="ig-component-state__intro-text">I didn't put all the state of the component into the component, because most of the design is not needed, just let the development know.</p>
      <p class="ig-component-state__intro-text">You can find all the state of the component here.</p>
    </section>`;

    return `<article class="ig-doc ig-component-state tma-forms-guidance-page" data-node-id="30484:299251">
      <header class="ig-doc__hero">
        <h2 class="ig-doc__title">Component state</h2>
      </header>
      ${intro}
      <section class="ig-doc__section ig-doc__section--flush ig-component-state__matrix">
        ${renderMatrixBoard()}
      </section>
      ${DOC ? DOC.renderDocFooter() : ''}
    </article>`;
  }

  window.TMAInteractiveGuidanceComponentState = {
    renderComponentState,
    renderMatrixBoard,
  };
})();
