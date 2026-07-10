/* TMA — DatePicker interactive guidance (Figma 33304:16630) */
(function () {
  'use strict';

  const DP = window.TMADatePicker;
  const dpSvg = window.TMADatePickerIcons.svg;
  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  function g(opts) {
    return DP.renderDatePicker({ bordered: true, guidance: true, ...opts });
  }

  function board(w, h, html) {
    return `<div class="tma-date-picker-guidance-page__board-wrap"><div class="tma-date-picker-guidance-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function picker(left, top, html) {
    return `<div class="tma-date-picker-guidance-page__picker" style="left:${left}px;top:${top}px">${html}</div>`;
  }

  function headerBar(left, top, html) {
    return `<div class="tma-date-picker-guidance-page__header-bar" style="left:${left}px;top:${top}px">${html}</div>`;
  }

  function lbl(text, left, top, regular) {
    const cls = regular
      ? 'tma-date-picker-guidance-page__label tma-date-picker-guidance-page__label--regular'
      : 'tma-date-picker-guidance-page__label';
    return `<p class="${cls}" style="left:${left}px;top:${top}px">${text}</p>`;
  }

  function note(text, left, top, width) {
    const style = width
      ? `left:${left}px;top:${top}px;width:${width}px`
      : `left:${left}px;top:${top}px`;
    if (String(text).includes('<')) {
      return `<div class="tma-date-picker-guidance-page__note" style="${style}">${text}</div>`;
    }
    return `<p class="tma-date-picker-guidance-page__note" style="${style}">${text}</p>`;
  }

  function list(items, left, top, width) {
    const lis = items.map((i) => `<li>${i}</li>`).join('');
    const w = width ? `width:${width}px;` : '';
    return `<ul class="tma-date-picker-guidance-page__list" style="left:${left}px;top:${top}px;${w}">${lis}</ul>`;
  }

  function lineH(left, top, width) {
    return `<span class="tma-date-picker-guidance-page__callout-line tma-date-picker-guidance-page__callout-line--h" style="left:${left}px;top:${top}px;width:${width}px"></span>`;
  }

  function lineV(left, top, height) {
    return `<span class="tma-date-picker-guidance-page__callout-line tma-date-picker-guidance-page__callout-line--v" style="left:${left}px;top:${top}px;height:${height}px"></span>`;
  }

  function hitRect(left, top, w, h) {
    return `<span class="tma-date-picker-guidance-page__hit-rect" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"></span>`;
  }

  function hitLabel(text, left, top) {
    return `<p class="tma-date-picker-guidance-page__hit-label" style="left:${left}px;top:${top}px">${text}</p>`;
  }

  function section(title, body, subtitle) {
    const sub = subtitle
      ? `<p class="tma-date-picker-guidance-page__section-subtitle">${subtitle}</p>`
      : '';
    return `<section class="tma-date-picker-guidance-page__section"><h2 class="tma-date-picker-guidance-page__section-title">${title}</h2>${sub}${body}</section>`;
  }

  function renderSelectDateOnly() {
    return section('Select date only', board(2545, 512, [
      lbl('Select date', 178, 0),
      lbl('Input status', 868, 0),
      lbl('Month selection', 1288, 0),
      lbl('Year selection', 1948, 0),
      note('There is no confirm action button; closing the DatePicker confirms the final selection.', 178, 420, 362),
      list([
        'Activated when you click the blank area at the top of the input field.',
        'When entered, the date below will be positioned to the date entered.',
      ], 868, 420, 360),
      list([
        'Click the month in the top input box to activate.',
        'By default, the current month is selected.',
      ], 1288, 420),
      list([
        'Click the year in the top input box to activate.',
        'The current year is selected by default.',
      ], 1948, 420),
      note('<p>Currently selected date</p><p>The default is Today.</p>', 0, 66),
      note('Hover state', 0, 201),
      note('Today', 0, 239),
      note('Selected state', 0, 279),
      lbl('Top area', 574, 61),
      note('Select the last confirmed selection.', 574, 117),
      lbl('Date selection area', 574, 219),
      note('Click the month to enter the month selection interface', 1679, 68, 187),
      note('Year switch', 1679, 116),
      note('Step back to the selection date', 1679, 361),
      lineH(163, 67, 411),
      lineH(88, 201, 486),
      lineH(38, 239, 536),
      lineH(85, 279, 489),
      lineH(542, 71, 636),
      lineH(542, 127, 636),
      lineH(355, 219, 823),
      lineH(1360, 78, 319),
      lineH(1360, 126, 319),
      lineH(1360, 371, 319),
      picker(178, 40, g({
        type: 'date-only',
        selectedDay: 10,
        hoverDay: 3,
        todayDay: 17,
      })),
      picker(868, 40, g({
        type: 'date-only',
        selectedDay: 10,
      })),
      picker(1288, 40, g({
        type: 'date-only',
        view: 'month',
        selectedMonth: 'Feb',
        showBack: true,
        backWithIcon: true,
      })),
      picker(1948, 40, g({
        type: 'date-only',
        view: 'year',
        selectedYear: 2026,
        years: DP.YEARS_GUIDANCE,
        showBack: true,
        backWithIcon: true,
        showScrollbar: true,
      })),
    ].join('')));
  }

  function renderSelectDateAndTime() {
    return section('Select date and time', board(2250, 460, [
      lbl('DatePicker with time', 0, 0),
      lbl('Time selection', 428, 0),
      lbl('Choose hours', 838, 0),
      lbl('Choose minutes', 1248, 0),
      lbl('Time selection with seconds - Choose seconds', 1649, 0),
      note('<p>Click on Time activation in the top input box.</p><p>By default, the current time is displayed.</p>', 428, 420, 360),
      note('Selectable or inputable.', 838, 420),
      note('Selectable or inputable.', 1248, 420),
      note('Selectable or inputable.', 1649, 420),
      note('Click', 366, 44),
      picker(0, 40, g({ type: 'date-and-time', selectedDay: 10 })),
      picker(428, 40, g({
        type: 'date-and-time',
        view: 'time',
        activeTime: true,
        showBack: true,
        backWithIcon: true,
      })),
      picker(838, 40, g({
        type: 'date-and-time',
        view: 'time',
        activeTime: true,
        showBack: true,
        backWithIcon: true,
        selectedHour: '04',
      })),
      picker(1248, 40, g({
        type: 'date-and-time',
        view: 'time',
        activeTime: true,
        showBack: true,
        backWithIcon: true,
        selectedMinute: '08',
      })),
      picker(1649, 40, g({
        type: 'date-and-time',
        view: 'time',
        activeTime: true,
        showBack: true,
        backWithIcon: true,
        showSeconds: true,
        selectedSecond: '08',
        hideMonthNav: true,
      })),
    ].join('')));
  }

  function renderSelectDateRange() {
    return section('Select date range', board(1557, 495, [
      lbl('DatePicker with date range', 0, 0),
      lbl('Select a Start Date', 439, 0),
      lbl('Select an End Date', 940, 0),
      list([
        'The first click defaults to selecting the start date.',
        'Clicking the same date again will change the selection end date.',
      ], 439, 423, 360),
      note('Second click', 827, 225),
      note('Click', 379, 299),
      lineH(815, 235, 120),
      picker(0, 40, g({
        type: 'date-range',
        rangeStart: 10,
        rangeEnd: 22,
        selectedDay: null,
        endFaded: true,
      })),
      picker(439, 40, g({
        type: 'date-range',
        rangeStart: 10,
        rangeEnd: 10,
        selectedDay: null,
        endFaded: false,
      })),
      picker(940, 40, g({
        type: 'date-range',
        rangeStart: 10,
        rangeEnd: 22,
        selectedDay: null,
        endFaded: false,
      })),
    ].join('')));
  }

  function renderSelectDateRangeAndTime() {
    return section('Select date range and time', board(678, 360, [
      picker(0, 0, g({
        type: 'date-range-and-time',
        rangeStart: 10,
        rangeEnd: 22,
        selectedDay: null,
        endFaded: false,
      })),
      note('<p>When the start date is activated, the time of the start date is selected.</p><p>When the end date is activated, the time of the end date is selected.</p>', 420, 19, 258),
      lineH(347, 28, 73),
    ].join('')));
  }

  function renderHitAreas() {
    const uniqueRects = [
      [9, 50, 39, 56], [52, 50, 39, 56], [97, 50, 39, 56], [129, 50, 245, 56],
      [234, 50, 39, 56], [411, 50, 39, 56], [454, 50, 39, 56], [492, 50, 39, 56],
      [531, 50, 148, 56], [584, 50, 39, 56], [679, 50, 97, 56], [708, 50, 39, 56],
      [906, 50, 39, 56], [945, 50, 14, 56], [966, 50, 14, 56], [1038, 50, 39, 56],
      [1077, 50, 113, 56], [1328, 50, 39, 56], [1367, 50, 14, 56], [1388, 50, 14, 56],
      [1460, 50, 39, 56], [1499, 50, 16, 56], [1515, 50, 97, 56],
    ];

    return section(
      'The click range in the top area',
      board(1612, 254, [
        hitLabel('Day', 31, 0),
        hitLabel('Day', 433, 0),
        hitLabel('End date input', 932, 0),
        hitLabel('End date input', 1095, 0),
        hitLabel('End date input', 1354, 0),
        hitLabel('End date input', 1469, 0),
        hitLabel('Input', 9, 135),
        hitLabel('Month', 52, 135),
        hitLabel('Year', 97, 135),
        hitLabel('Input', 234, 135),
        hitLabel('Month', 454, 135),
        hitLabel('Year', 499, 135),
        hitLabel('Input', 411, 135),
        hitLabel('Input', 584, 135),
        hitLabel('Time', 708, 135),
        hitLabel('Start date input', 796, 135),
        hitLabel('Start date input', 909, 135),
        hitLabel('Start date input', 1218, 135),
        hitLabel('Start date input', 1331, 135),
        hitLabel('Time', 1550, 135),
        list([
          'Click different places in the top area to allow the DatePicker to enter different states.Just like the Windows folder navigation.',
          'Click outside the input field to exit the input field while keeping the valid input content.',
        ], 0, 182, 604),
        headerBar(14, 50, DP.renderHeaderBar({ type: 'date-only' })),
        headerBar(416, 50, DP.renderHeaderBar({ type: 'date-and-time' })),
        headerBar(830, 50, DP.renderHeaderBar({ type: 'date-range', endFaded: true })),
        headerBar(1252, 50, DP.renderHeaderBar({ type: 'date-range-and-time', endFaded: true })),
        ...uniqueRects.map(([l, t, w, h]) => hitRect(l, t, w, h)),
        lineV(23, 18, 117),
        lineV(445, 18, 117),
        lineV(68, 110, 25),
        lineV(490, 110, 25),
        lineV(115, 110, 25),
        lineV(537, 110, 25),
      ].join('')),
      'If the click area is too small, make the component 1.5 or 2 times larger.',
    );
  }

  function renderFooter() {
    if (!tsSvg) {
      return `<footer class="tma-date-picker-guidance-page__footer"><p class="tma-date-picker-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p></footer>`;
    }
    return `<footer class="tma-date-picker-guidance-page__footer">
      <div class="tma-date-picker-guidance-page__footer-brand">
        <div class="tma-date-picker-guidance-page__footer-wordmark">
          ${tsSvg('TMALogoMark', '', 28, 28)}
          ${tsSvg('TMALogoWordmark', '', 72, 12)}
          ${tsSvg('TMALogoSuffix', '', 40, 12)}
        </div>
        <p class="tma-date-picker-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-date-picker-guidance-page__footer-social">
        <a class="tma-date-picker-guidance-page__footer-link" href="https://www.figma.com/@tma" target="_blank" rel="noopener noreferrer" aria-label="Figma">${tsSvg('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-date-picker-guidance-page__footer-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${tsSvg('TMALogoMark', '', 28, 28)}</a>
        <a class="tma-date-picker-guidance-page__footer-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="X">${tsSvg('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-date-picker-guidance-page__footer-link" href="https://www.instagram.com/tma.design/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${tsSvg('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-date-picker-guidance-page__footer-link" href="https://www.threads.net/@tma.design" target="_blank" rel="noopener noreferrer" aria-label="Threads">${tsSvg('ThreadsLogo', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountGuidance(root) {
    if (!root || !DP) return;
    root.innerHTML = [
      renderSelectDateOnly(),
      renderSelectDateAndTime(),
      renderSelectDateRange(),
      renderSelectDateRangeAndTime(),
      renderHitAreas(),
      renderFooter(),
    ].join('');
  }

  window.TMADatePickerGuidance = { mountGuidance };
})();
