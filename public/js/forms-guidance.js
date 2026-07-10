/* TMA — Forms interactive guidance (Figma 32257:116552) */
(function () {
  'use strict';

  const IN = window.TMAInput;
  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  const COLS = {
    default: 232,
    hover: 472,
    disabled: 712,
    focus: 952,
    progress: 1192,
    done: 1432,
    error: 1672,
  };

  const COL_HEADERS = [
    ['default', 'Default'],
    ['hover', 'Hover'],
    ['disabled', 'Disabled'],
    ['focus', 'Focus'],
    ['progress', 'In progress'],
    ['done', 'Done'],
    ['error', 'Error'],
  ];

  const STATES = ['default', 'hover', 'disabled', 'focus', 'progress', 'done', 'error'];

  const ROWS = {
    headers: 0,
    rule: 76,
    inputLabel: 144,
    row1: 116,
    row2: 252,
    rule2: 212,
    textareaSimple: 408,
    textareaCounter: 544,
    titleInput: 684,
    select: 848,
    controlsLabel: 1248,
    controlsStart: 1112,
  };

  const RULE_LINES = [76, 212, 368, 504, 644, 808, 1072];
  const FIELD_W = 200;

  function board(w, h, html) {
    return `<div class="tma-forms-guidance-page__board-wrap"><div class="tma-forms-guidance-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function place(left, top, html) {
    return `<div class="tma-forms-guidance-page__item" style="left:${left}px;top:${top}px;width:${FIELD_W}px">${html}</div>`;
  }

  function placeFree(left, top, html, w) {
    const width = w != null ? `width:${w}px;` : '';
    return `<div class="tma-forms-guidance-page__item" style="left:${left}px;top:${top}px;${width}">${html}</div>`;
  }

  function lbl(text, left, top) {
    return `<p class="tma-forms-guidance-page__label" style="left:${left}px;top:${top}px">${text}</p>`;
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

  function lineH(left, top, width) {
    return `<span class="tma-forms-guidance-page__callout-line tma-forms-guidance-page__callout-line--h" style="left:${left}px;top:${top}px;width:${width}px"></span>`;
  }

  function lineV(left, top, height) {
    return `<span class="tma-forms-guidance-page__callout-line tma-forms-guidance-page__callout-line--v" style="left:${left}px;top:${top}px;height:${height}px"></span>`;
  }

  function section(title, body) {
    return `<section class="tma-forms-guidance-page__section"><h2 class="tma-forms-guidance-page__section-title">${title}</h2>${body}</section>`;
  }

  function renderColumnHeaders() {
    return COL_HEADERS.map(([key, label]) =>
      `<p class="tma-forms-guidance-page__col-header" style="left:${COLS[key]}px;top:${ROWS.headers}px">${label}</p>`,
    ).join('');
  }

  function renderHorizontalRules() {
    return RULE_LINES.map((top) =>
      `<span class="tma-forms-guidance-page__rule" style="top:${top}px"></span>`,
    ).join('');
  }

  function renderFieldMatrix(variant, row) {
    return STATES.map((state) =>
      place(COLS[state], row, IN.renderGuidanceField({ variant, state })),
    ).join('');
  }

  function renderControlsRow(top, state) {
    let col = COLS.default;
    if (state === 'hover') col = COLS.hover;
    if (state === 'disabled') col = 714;
    const opacity = state === 'disabled' ? ' tma-forms-guidance-page__controls--disabled' : '';
    const opts = { state: state === 'disabled' ? 'disabled' : (state === 'hover' ? 'hover' : 'default') };
    return `<div class="tma-forms-guidance-page__controls${opacity}" style="left:${col}px;top:${top}px">
      ${IN.renderRadio({ selected: true, ...opts })}
      ${IN.renderRadio({ selected: false, ...opts })}
      ${IN.renderCheckbox({ checked: 'checked', ...opts })}
      ${IN.renderCheckbox({ checked: 'unchecked', ...opts })}
      ${IN.renderCheckbox({ checked: 'indeterminate', ...opts })}
      ${IN.renderSwitch({ on: true, ...opts })}
      ${IN.renderSwitch({ on: false, ...opts })}
    </div>`;
  }

  function renderControlsBlock() {
    return renderControlsRow(ROWS.controlsStart, 'default')
      + renderControlsRow(ROWS.controlsStart, 'hover')
      + renderControlsRow(ROWS.controlsStart, 'disabled');
  }

  function renderButtonsBoard() {
    return board(792, 244, [
      note('Social Media button', 0, 10),
      note('Form button', 0, 146),
      note('Global Notification', 668, 136),
      lbl('Click', 295, 50),
      lbl('Open the Apple account login window.', 351, 68),
      lbl('Click', 259, 192),
      placeFree(0, 40, IN.renderAppleButton(), 271),
      placeFree(240, 210, IN.renderFormButtonGroup('default'), 240),
      placeFree(480, 210, IN.renderFormButtonGroup('loading'), 240),
      placeFree(668, 190, IN.renderSavedToast(), 120),
      lineH(291, 58, 60),
      lineH(218, 210, 42),
      lineH(608, 210, 60),
    ].join(''));
  }

  function renderMatrixBoard() {
    return board(2162, 1384, [
      renderColumnHeaders(),
      renderHorizontalRules(),
      note('Input', 0, ROWS.inputLabel),
      note('Radio, Checkbox, Switch', 0, ROWS.controlsLabel),
      note('Title get smaller when in focus.', 994, 223),
      noteList([
        'The error message is displayed below the form.',
        'The error will push the content down.',
      ], 1922, 179, 240),
      noteList([
        'Some forms need to check what you enter.',
        'The check will occur when the form loses focus.',
      ], 1192, 836, 209),
      renderFieldMatrix('1row', ROWS.row1),
      renderFieldMatrix('title-vertical', ROWS.row2),
      renderFieldMatrix('textarea', ROWS.textareaSimple),
      renderFieldMatrix('textarea-counter', ROWS.textareaCounter),
      renderFieldMatrix('title-input', ROWS.titleInput),
      renderFieldMatrix('select', ROWS.select),
      place(COLS.focus, ROWS.select + 60, IN.renderSelectDropdown()),
      renderControlsBlock(),
      lineV(1870, 179, 42),
      lineV(1150, 836, 42),
      '<img class="tma-forms-guidance-page__resize-cursor" src="../images/cursors/CursorsResizeNorthWestSouthEast.png" width="32" height="32" alt="" style="left:652px;top:436px" aria-hidden="true">',
      '<img class="tma-forms-guidance-page__resize-cursor" src="../images/cursors/CursorsResizeNorthWestSouthEast.png" width="32" height="32" alt="" style="left:652px;top:605px" aria-hidden="true">',
    ].join(''));
  }

  function renderFooter() {
    if (!tsSvg) {
      return `<footer class="tma-forms-guidance-page__footer"><p class="tma-forms-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p></footer>`;
    }
    return `<footer class="tma-forms-guidance-page__footer">
      <div class="tma-forms-guidance-page__footer-brand">
        <div class="tma-forms-guidance-page__footer-wordmark">
          ${tsSvg('TMALogoMark', '', 28, 28)}
          ${tsSvg('TMALogoWordmark', '', 53, 12)}
          ${tsSvg('TMALogoSuffix', '', 15, 12)}
        </div>
        <p class="tma-forms-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-forms-guidance-page__footer-social">
        <a class="tma-forms-guidance-page__footer-link" href="https://www.figma.com/@tma" target="_blank" rel="noopener noreferrer" aria-label="Figma">${tsSvg('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-forms-guidance-page__footer-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${tsSvg('TMALogoMark', '', 28, 28)}</a>
        <a class="tma-forms-guidance-page__footer-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="X">${tsSvg('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-forms-guidance-page__footer-link" href="https://www.instagram.com/tma.design/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${tsSvg('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-forms-guidance-page__footer-link" href="https://www.threads.net/@tma.design" target="_blank" rel="noopener noreferrer" aria-label="Threads">${tsSvg('ThreadsLogo', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountGuidance(container) {
    if (!container || !IN) return;
    container.innerHTML = [
      section('Buttons', renderButtonsBoard()),
      section('Input states', renderMatrixBoard()),
      renderFooter(),
    ].join('');
  }

  window.TMAFormsGuidance = {
    mountGuidance,
    renderButtonsBoard,
    renderMatrixBoard,
    section,
  };
})();
