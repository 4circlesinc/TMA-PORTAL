/* TMA — DatePicker renderer */
(function () {
  'use strict';

  const svg = window.TMADatePickerIcons.svg;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const CALENDAR_ROWS = [
    [
      { day: 30, muted: true },
      { day: 31, muted: true },
      { day: 1 },
      { day: 2 },
      { day: 3 },
      { day: 4 },
      { day: 5 },
    ],
    [
      { day: 6 },
      { day: 7 },
      { day: 8 },
      { day: 9 },
      { day: 10, selected: true },
      { day: 11 },
      { day: 12 },
    ],
    [
      { day: 13 },
      { day: 14 },
      { day: 15 },
      { day: 16 },
      { day: 17 },
      { day: 18 },
      { day: 19 },
    ],
    [
      { day: 20 },
      { day: 21 },
      { day: 22 },
      { day: 23 },
      { day: 24 },
      { day: 25 },
      { day: 26 },
    ],
    [
      { day: 27 },
      { day: 28 },
      { day: 1, muted: true },
      { day: 2, muted: true },
      { day: 3, muted: true },
      { day: 4, muted: true },
      { day: 5, muted: true },
    ],
  ];

  const YEARS = [2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
  const YEARS_GUIDANCE = Array.from({ length: 23 }, (_, i) => 2011 + i);

  const HOURS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const MINUTES = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];
  const SECONDS = MINUTES;

  function tag(text, className, active) {
    const wrapCls = className ? ` class="${className}"` : '';
    const innerCls = active
      ? 'tma-date-picker__tag tma-date-picker__tag--active'
      : 'tma-date-picker__tag';
    return `<span${wrapCls}><span class="${innerCls}">${text}</span></span>`;
  }

  function renderDateSegments(month, day, year, faded, activeSegment) {
    const groupCls = faded
      ? 'tma-date-picker__date-group tma-date-picker__date-group--faded'
      : 'tma-date-picker__date-group';
    return `<div class="${groupCls}">${tag(month, '', activeSegment === 'month')}<span class="tma-date-picker__sep">/</span>${tag(day, '', activeSegment === 'day')}<span class="tma-date-picker__sep">/</span>${tag(year, '', activeSegment === 'year')}</div>`;
  }

  function renderHeader(opts) {
    const type = opts.type || 'date-only';
    const time = opts.time || '04 : 08 AM';
    const start = opts.startDate || { month: '10', day: '22', year: '2026' };
    const end = opts.endDate || { month: '10', day: '22', year: '2026' };
    const endFaded = opts.endFaded !== false;

    let inner = '';

    const activeSegment = opts.activeSegment || null;

    if (type === 'date-only' || type === 'date-and-time') {
      inner += `<div class="tma-date-picker__header-main">${renderDateSegments(start.month, start.day, start.year, false, activeSegment)}</div>`;
      if (type === 'date-and-time') {
        const timeCls = opts.activeTime
          ? 'tma-date-picker__time tma-date-picker__time--active'
          : 'tma-date-picker__time';
        inner += tag(time, timeCls, opts.activeTime);
      }
    } else {
      inner += `<div class="tma-date-picker__header-main">${renderDateSegments(start.month, start.day, start.year, false, activeSegment)}<span class="tma-date-picker__dash">-</span>${renderDateSegments(end.month, end.day, end.year, endFaded)}</div>`;
      if (type === 'date-range-and-time') {
        const timeCls = opts.activeTime
          ? 'tma-date-picker__time tma-date-picker__time--active'
          : 'tma-date-picker__time';
        inner += tag(time, timeCls, opts.activeTime);
      }
    }

    return `<div class="tma-date-picker__header">${inner}</div>`;
  }

  function renderToolbar(opts) {
    const view = opts.view || 'calendar';
    const month = opts.monthLabel != null
      ? opts.monthLabel
      : (view === 'year' ? '' : 'Feb');
    const pills = opts.pills || (view === 'time'
      ? ['System time', 'Last selection']
      : (view === 'year' ? ['This year', 'Last selection'] : ['Today', 'Last selection']));
    const hideNav = opts.hideMonthNav === true;

    return `<div class="tma-date-picker__toolbar">
      <div class="tma-date-picker__pills">
        ${pills.map((p) => `<span class="tma-date-picker__pill">${p}</span>`).join('')}
      </div>
      ${hideNav ? '' : `<div class="tma-date-picker__month-nav">
        <button type="button" class="tma-date-picker__nav-btn" aria-label="Previous">${svg('ArrowLineLeft20', 'tma-date-picker__nav-icon', 20, 20)}</button>
        ${month ? `<span class="tma-date-picker__month-label">${month}</span>` : '<span class="tma-date-picker__month-label tma-date-picker__month-label--spacer" aria-hidden="true"></span>'}
        <button type="button" class="tma-date-picker__nav-btn" aria-label="Next">${svg('ArrowLineRight20', 'tma-date-picker__nav-icon', 20, 20)}</button>
      </div>`}
    </div>`;
  }

  function cellClass(cell, opts) {
    const classes = ['tma-date-picker__cell'];
    if (cell.muted) classes.push('tma-date-picker__cell--muted');
    if (cell.weekday) classes.push('tma-date-picker__cell--weekday');
    if (cell.selected) classes.push('tma-date-picker__cell--selected');
    else if (cell.today) classes.push('tma-date-picker__cell--today');
    else if (cell.hover) classes.push('tma-date-picker__cell--hover');

    const rangeStart = opts.rangeStart;
    const rangeEnd = opts.rangeEnd;
    if (rangeStart != null && rangeEnd != null && !cell.muted && !cell.weekday) {
      const d = cell.day;
      if (d >= rangeStart && d <= rangeEnd) {
        classes.push('tma-date-picker__cell--in-range');
        if (d === rangeStart) classes.push('tma-date-picker__cell--range-start');
        if (d === rangeEnd) classes.push('tma-date-picker__cell--range-end');
      }
    }

    return classes.join(' ');
  }

  function renderCalendarBody(opts) {
    const rows = opts.calendarRows || CALENDAR_ROWS;
    const weekdayRow = `<div class="tma-date-picker__grid-row">${WEEKDAYS.map((w) => `<span class="${cellClass({ weekday: true }, opts)}">${w}</span>`).join('')}</div>`;
    const dayRows = rows.map((row) => {
      const cells = row.map((cell) => {
        const c = { ...cell };
        if (opts.selectedDay === c.day && !c.muted) c.selected = true;
        if (opts.hoverDay === c.day && !c.muted) c.hover = true;
        if (opts.todayDay === c.day && !c.muted) c.today = true;
        if (c.selected && opts.rangeStart != null) delete c.selected;
        return `<span class="${cellClass(c, opts)}">${c.day}</span>`;
      }).join('');
      return `<div class="tma-date-picker__grid-row">${cells}</div>`;
    }).join('');

    return `<div class="tma-date-picker__body">${weekdayRow}${dayRows}</div>`;
  }

  function renderMonthBody(opts) {
    const selected = opts.selectedMonth || 'Feb';
    const rows = [];
    for (let i = 0; i < MONTHS.length; i += 4) {
      rows.push(MONTHS.slice(i, i + 4));
    }
    const grid = rows.map((row) => {
      const cells = row.map((m) => {
        const cls = ['tma-date-picker__cell'];
        if (m === selected) cls.push('tma-date-picker__cell--selected');
        return `<span class="${cls.join(' ')}">${m}</span>`;
      }).join('');
      return `<div class="tma-date-picker__grid-row">${cells}</div>`;
    }).join('');

    return `<div class="tma-date-picker__body">${grid}</div>`;
  }

  function renderYearBody(opts) {
    const selected = opts.selectedYear || 2026;
    const years = opts.years || YEARS;
    const rows = [];
    for (let i = 0; i < years.length; i += 4) {
      rows.push(years.slice(i, i + 4));
    }
    const grid = rows.map((row) => {
      const cells = row.map((y) => {
        const cls = ['tma-date-picker__cell'];
        if (y === selected) cls.push('tma-date-picker__cell--selected');
        return `<span class="${cls.join(' ')}">${y}</span>`;
      }).join('');
      return `<div class="tma-date-picker__grid-row">${cells}</div>`;
    }).join('');

    const scrollbar = opts.showScrollbar
      ? '<span class="tma-date-picker__scrollbar tma-date-picker__scrollbar--year" aria-hidden="true"></span>'
      : '';

    return `<div class="tma-date-picker__body tma-date-picker__body--year">${grid}${scrollbar}</div>`;
  }

  function renderTimeBody(opts) {
    const selectedHour = opts.selectedHour || '04';
    const selectedMinute = opts.selectedMinute || '08';
    const selectedSecond = opts.selectedSecond || '08';
    const period = opts.period || 'AM';
    const showSeconds = opts.showSeconds === true;

    const hourRows = [];
    for (let i = 0; i < HOURS.length; i += 4) {
      hourRows.push(HOURS.slice(i, i + 4));
    }
    const minuteRows = [];
    for (let i = 0; i < MINUTES.length; i += 4) {
      minuteRows.push(MINUTES.slice(i, i + 4));
    }
    const secondRows = [];
    for (let i = 0; i < SECONDS.length; i += 4) {
      secondRows.push(SECONDS.slice(i, i + 4));
    }

    const renderCol = (rows, selected) => rows.map((row) => {
      const cells = row.map((v) => {
        const cls = ['tma-date-picker__cell'];
        if (v === selected) cls.push('tma-date-picker__cell--selected');
        return `<span class="${cls.join(' ')}">${v}</span>`;
      }).join('');
      return `<div class="tma-date-picker__grid-row">${cells}</div>`;
    }).join('');

    const scrollbar = opts.showScrollbar
      ? '<span class="tma-date-picker__scrollbar" aria-hidden="true"></span>'
      : '';

    return `<div class="tma-date-picker__body tma-date-picker__time-body${showSeconds ? ' tma-date-picker__time-body--seconds' : ''}">
      <div class="tma-date-picker__ampm">
        <span class="tma-date-picker__ampm-btn${period === 'AM' ? ' tma-date-picker__ampm-btn--active' : ''}">AM</span>
        <span class="tma-date-picker__ampm-btn${period === 'PM' ? ' tma-date-picker__ampm-btn--active' : ''}">PM</span>
      </div>
      <div class="tma-date-picker__time-col">${renderCol(hourRows, selectedHour)}</div>
      <div class="tma-date-picker__time-col">${renderCol(minuteRows, selectedMinute)}</div>
      ${showSeconds ? `<div class="tma-date-picker__time-col">${renderCol(secondRows, selectedSecond)}</div>` : ''}
      ${scrollbar}
    </div>`;
  }

  function renderFooter(showBack, backWithIcon) {
    if (!showBack) return '';
    if (backWithIcon) {
      return `<div class="tma-date-picker__footer tma-date-picker__footer--icon-back"><button type="button" class="tma-date-picker__back">${svg('ArrowLineLeft20', 'tma-date-picker__back-icon', 20, 20)}<span>Back</span></button></div>`;
    }
    return `<div class="tma-date-picker__footer"><button type="button" class="tma-date-picker__back">Back</button></div>`;
  }

  function renderHeaderBar(opts) {
    const type = opts.type || 'date-only';
    const time = opts.time || '04 : 08 AM';
    const start = opts.startDate || { month: '10', day: '22', year: '2026' };
    const end = opts.endDate || { month: '10', day: '22', year: '2026' };
    const endFaded = opts.endFaded !== false;
    const activeTime = opts.activeTime === true;

    let inner = '';
    if (type === 'date-only' || type === 'date-and-time') {
      inner += renderDateSegments(start.month, start.day, start.year, false);
      if (type === 'date-and-time') {
        inner += tag(time, activeTime ? 'tma-date-picker__time tma-date-picker__time--active' : 'tma-date-picker__time', activeTime);
      }
    } else {
      inner += `${renderDateSegments(start.month, start.day, start.year, false)}<span class="tma-date-picker__dash">-</span>${renderDateSegments(end.month, end.day, end.year, endFaded)}`;
      if (type === 'date-range-and-time') {
        inner += tag(time, activeTime ? 'tma-date-picker__time tma-date-picker__time--active' : 'tma-date-picker__time', activeTime);
      }
    }

    return `<div class="tma-date-picker__header-bar" role="presentation">${inner}</div>`;
  }

  function renderDateInput(opts) {
    opts = opts || {};
    const label = opts.label || 'Date';
    const placeholder = opts.placeholder || 'Pick a date';
    const width = opts.width || 200;
    const attrs = opts.attrs || '';
    return `<div class="tma-date-input" style="width:${width}px"${attrs}>
      <div class="tma-date-input__label-row"><span class="tma-date-input__label">${label}</span></div>
      <div class="tma-date-input__value-row">
        <span class="tma-date-input__placeholder">${placeholder}</span>
        ${svg('ArrowLineUpDown16', 'tma-date-input__icon', 16, 16)}
      </div>
    </div>`;
  }

  function renderDatePicker(opts) {
    opts = opts || {};
    const type = opts.type || 'date-only';
    const view = opts.view || 'calendar';
    const extraClass = opts.className || '';
    const hitAreas = opts.hitAreas ? ' tma-date-picker--hit-areas' : '';
    const hitScale = opts.hitScale === 2 ? ' tma-date-picker--hit-areas-2x' : opts.hitScale === 1.5 ? ' tma-date-picker--hit-areas-lg' : '';
    const bordered = opts.bordered ? ' tma-date-picker--bordered' : '';
    const guidance = opts.guidance ? ' tma-date-picker--guidance' : '';
    const attrs = opts.attrs || '';

    let body = '';
    if (view === 'month') body = renderMonthBody(opts);
    else if (view === 'year') body = renderYearBody({ ...opts, years: opts.years || (opts.guidance ? YEARS_GUIDANCE : YEARS) });
    else if (view === 'time') body = renderTimeBody(opts);
    else body = renderCalendarBody(opts);

    const monthLabel = opts.monthLabel != null
      ? opts.monthLabel
      : (view === 'year' ? '' : 'Feb');
    const headerOpts = { ...opts, type };
    if (view === 'year' && opts.guidance) {
      headerOpts.activeSegment = 'year';
    }

    return `<div class="tma-date-picker${hitAreas}${hitScale}${bordered}${guidance}${extraClass ? ` ${extraClass}` : ''}" role="group" aria-label="Date picker"${attrs}>
      ${renderHeader(headerOpts)}
      ${renderToolbar({ ...opts, view, monthLabel })}
      ${body}
      ${renderFooter(opts.showBack, opts.backWithIcon)}
    </div>`;
  }

  window.TMADatePicker = {
    renderDatePicker,
    renderDateInput,
    renderHeaderBar,
    MONTHS,
    WEEKDAYS,
    CALENDAR_ROWS,
    YEARS,
    YEARS_GUIDANCE,
    buildCalendarGrid,
    mountInteractive,
    attachField,
    attachDocExample,
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function buildCalendarGrid(year, month) {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const dim = daysInMonth(year, month);
    const prevDim = daysInMonth(year, month - 1);
    const cells = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({ day: prevDim - i, muted: true, monthOffset: -1 });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({ day: d, muted: false, monthOffset: 0 });
    }
    let next = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ day: next++, muted: true, monthOffset: 1 });
    }

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }

  function sameDate(a, b) {
    return a && b
      && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function compareDates(a, b) {
    return a.getFullYear() - b.getFullYear()
      || a.getMonth() - b.getMonth()
      || a.getDate() - b.getDate();
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateParts(d) {
    return {
      month: String(d.getMonth() + 1),
      day: String(d.getDate()),
      year: String(d.getFullYear()),
    };
  }

  function formatTime(hour, minute, period) {
    return `${pad(hour)} : ${pad(minute)} ${period}`;
  }

  function snapshotState(s) {
    return {
      view: s.view,
      year: s.year,
      month: s.month,
      startDate: new Date(s.startDate),
      endDate: new Date(s.endDate),
      rangeComplete: s.rangeComplete,
      rangeAnchor: s.rangeAnchor ? new Date(s.rangeAnchor) : null,
      activeRangeSide: s.activeRangeSide,
      hour: s.hour,
      minute: s.minute,
      period: s.period,
      hoverDay: null,
    };
  }

  function createDefaultState(type, initial) {
    const now = new Date();
    const start = initial?.start ? new Date(initial.start) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = initial?.end ? new Date(initial.end) : new Date(start);
    const hasTime = type === 'date-and-time' || type === 'date-range-and-time';

    return {
      type,
      view: 'calendar',
      year: start.getFullYear(),
      month: start.getMonth(),
      startDate: start,
      endDate: end,
      rangeComplete: type.includes('range') ? Boolean(initial?.end) : false,
      rangeAnchor: null,
      activeRangeSide: 'start',
      hour: initial?.hour ?? (hasTime ? (now.getHours() % 12 || 12) : 4),
      minute: initial?.minute ?? (hasTime ? now.getMinutes() : 8),
      period: initial?.period ?? ((hasTime ? now.getHours() : 4) >= 12 ? 'PM' : 'AM'),
      hoverDay: null,
      lastCommitted: null,
    };
  }

  function stateToRenderOpts(state) {
    const start = dateParts(state.startDate);
    const end = dateParts(state.endDate);
    const calendarRows = buildCalendarGrid(state.year, state.month);
    const today = new Date();
    const isRange = state.type.includes('range');
    const showRange = isRange && state.rangeComplete;
    const rangeStart = showRange ? Math.min(state.startDate.getDate(), state.endDate.getDate()) : null;
    const rangeEnd = showRange
      && state.startDate.getMonth() === state.endDate.getMonth()
      && state.startDate.getFullYear() === state.endDate.getFullYear()
      ? Math.max(state.startDate.getDate(), state.endDate.getDate())
      : null;

    const opts = {
      type: state.type,
      view: state.view,
      interactive: true,
      className: 'tma-date-picker--interactive',
      startDate: start,
      endDate: end,
      endFaded: isRange && !state.rangeComplete,
      time: formatTime(state.hour, state.minute, state.period),
      monthLabel: state.view === 'year' ? String(state.year) : MONTHS[state.month],
      selectedMonth: MONTHS[state.month],
      selectedYear: state.year,
      selectedHour: pad(state.hour),
      selectedMinute: pad(state.minute),
      period: state.period,
      calendarRows,
      showBack: state.view !== 'calendar',
      hoverDay: state.hoverDay,
      todayDay: state.year === today.getFullYear() && state.month === today.getMonth()
        ? today.getDate()
        : null,
    };

    if (showRange && rangeStart != null && rangeEnd != null) {
      opts.rangeStart = rangeStart;
      opts.rangeEnd = rangeEnd;
      opts.selectedDay = null;
    } else if (!isRange) {
      opts.selectedDay = state.year === state.startDate.getFullYear()
        && state.month === state.startDate.getMonth()
        ? state.startDate.getDate()
        : null;
    } else {
      opts.selectedDay = null;
    }

    return opts;
  }

  function renderInteractiveDatePicker(state) {
    const opts = stateToRenderOpts(state);
    const type = opts.type || 'date-only';
    const view = opts.view || 'calendar';

    function renderInteractiveHeader() {
      const time = opts.time;
      const start = opts.startDate;
      const end = opts.endDate;
      const endFaded = opts.endFaded !== false;
      let inner = '';

      function segments(parts, faded, side) {
        const groupCls = faded
          ? 'tma-date-picker__date-group tma-date-picker__date-group--faded'
          : 'tma-date-picker__date-group';
        return `<div class="${groupCls}" data-dp-header="date" data-dp-side="${side}">
          <span data-dp-header="month" data-dp-side="${side}"><span class="tma-date-picker__tag">${parts.month}</span></span>
          <span class="tma-date-picker__sep">/</span>
          <span data-dp-header="day" data-dp-side="${side}"><span class="tma-date-picker__tag">${parts.day}</span></span>
          <span class="tma-date-picker__sep">/</span>
          <span data-dp-header="year" data-dp-side="${side}"><span class="tma-date-picker__tag">${parts.year}</span></span>
        </div>`;
      }

      if (type === 'date-only' || type === 'date-and-time') {
        inner += `<div class="tma-date-picker__header-main">${segments(start, false, 'start')}</div>`;
        if (type === 'date-and-time') {
          inner += `<span class="tma-date-picker__time" data-dp-header="time"><span class="tma-date-picker__tag">${time}</span></span>`;
        }
      } else {
        inner += `<div class="tma-date-picker__header-main">${segments(start, false, 'start')}<span class="tma-date-picker__dash">-</span>${segments(end, endFaded, 'end')}</div>`;
        if (type === 'date-range-and-time') {
          inner += `<span class="tma-date-picker__time" data-dp-header="time" data-dp-side="${state.activeRangeSide || 'start'}"><span class="tma-date-picker__tag">${time}</span></span>`;
        }
      }

      return `<div class="tma-date-picker__header">${inner}</div>`;
    }

    function renderInteractiveToolbar() {
      const pills = view === 'time'
        ? ['System time', 'Last selection']
        : ['Today', 'Last selection'];

      return `<div class="tma-date-picker__toolbar">
        <div class="tma-date-picker__pills">
          ${pills.map((p, i) => `<button type="button" class="tma-date-picker__pill" data-dp-pill="${i === 0 ? 'primary' : 'last'}">${p}</button>`).join('')}
        </div>
        <div class="tma-date-picker__month-nav">
          <button type="button" class="tma-date-picker__nav-btn" data-dp-nav="prev" aria-label="Previous">${svg('ArrowLineLeft20', 'tma-date-picker__nav-icon', 20, 20)}</button>
          <span class="tma-date-picker__month-label">${opts.monthLabel}</span>
          <button type="button" class="tma-date-picker__nav-btn" data-dp-nav="next" aria-label="Next">${svg('ArrowLineRight20', 'tma-date-picker__nav-icon', 20, 20)}</button>
        </div>
      </div>`;
    }

    function renderInteractiveCalendarBody() {
      const rows = opts.calendarRows || CALENDAR_ROWS;
      const weekdayRow = `<div class="tma-date-picker__grid-row">${WEEKDAYS.map((w) => `<span class="${cellClass({ weekday: true }, opts)}">${w}</span>`).join('')}</div>`;
      const dayRows = rows.map((row) => {
        const cells = row.map((cell) => {
          const c = { ...cell };
          if (opts.selectedDay === c.day && !c.muted) c.selected = true;
          if (opts.hoverDay === c.day && !c.muted) c.hover = true;
          if (opts.todayDay === c.day && !c.muted && opts.selectedDay !== c.day) c.today = true;
          if (c.selected && opts.rangeStart != null) delete c.selected;
          const attrs = ` data-dp-day="${c.day}" data-dp-muted="${c.muted ? '1' : '0'}" data-dp-month-offset="${c.monthOffset || 0}"`;
          return `<button type="button" class="${cellClass(c, opts)}"${attrs}>${c.day}</button>`;
        }).join('');
        return `<div class="tma-date-picker__grid-row">${cells}</div>`;
      }).join('');

      return `<div class="tma-date-picker__body">${weekdayRow}${dayRows}</div>`;
    }

    function renderInteractiveMonthBody() {
      const selected = opts.selectedMonth || 'Feb';
      const rows = [];
      for (let i = 0; i < MONTHS.length; i += 4) rows.push(MONTHS.slice(i, i + 4));
      const grid = rows.map((row) => {
        const cells = row.map((m) => {
          const cls = ['tma-date-picker__cell'];
          if (m === selected) cls.push('tma-date-picker__cell--selected');
          return `<button type="button" class="${cls.join(' ')}" data-dp-month="${m}">${m}</button>`;
        }).join('');
        return `<div class="tma-date-picker__grid-row">${cells}</div>`;
      }).join('');
      return `<div class="tma-date-picker__body">${grid}</div>`;
    }

    function renderInteractiveYearBody() {
      const selected = opts.selectedYear || state.year;
      const startYear = selected - 4;
      const years = Array.from({ length: 12 }, (_, i) => startYear + i);
      const rows = [];
      for (let i = 0; i < years.length; i += 4) rows.push(years.slice(i, i + 4));
      const grid = rows.map((row) => {
        const cells = row.map((y) => {
          const cls = ['tma-date-picker__cell'];
          if (y === selected) cls.push('tma-date-picker__cell--selected');
          return `<button type="button" class="${cls.join(' ')}" data-dp-year="${y}">${y}</button>`;
        }).join('');
        return `<div class="tma-date-picker__grid-row">${cells}</div>`;
      }).join('');
      return `<div class="tma-date-picker__body">${grid}</div>`;
    }

    function renderInteractiveTimeBody() {
      const hourRows = [];
      for (let i = 0; i < HOURS.length; i += 4) hourRows.push(HOURS.slice(i, i + 4));
      const minuteValues = Array.from({ length: 60 }, (_, i) => pad(i));
      const minuteRows = [];
      for (let i = 0; i < minuteValues.length; i += 4) minuteRows.push(minuteValues.slice(i, i + 4));

      const renderCol = (rows, attr, selected) => rows.map((row) => {
        const cells = row.map((v) => {
          const cls = ['tma-date-picker__cell'];
          if (v === selected) cls.push('tma-date-picker__cell--selected');
          return `<button type="button" class="${cls.join(' ')}" data-dp-${attr}="${v}">${v}</button>`;
        }).join('');
        return `<div class="tma-date-picker__grid-row">${cells}</div>`;
      }).join('');

      return `<div class="tma-date-picker__body tma-date-picker__time-body tma-date-picker__time-body--scroll">
        <div class="tma-date-picker__ampm">
          <button type="button" class="tma-date-picker__ampm-btn${opts.period === 'AM' ? ' tma-date-picker__ampm-btn--active' : ''}" data-dp-period="AM">AM</button>
          <button type="button" class="tma-date-picker__ampm-btn${opts.period === 'PM' ? ' tma-date-picker__ampm-btn--active' : ''}" data-dp-period="PM">PM</button>
        </div>
        <div class="tma-date-picker__time-col tma-date-picker__time-col--scroll">${renderCol(hourRows, 'hour', opts.selectedHour)}</div>
        <div class="tma-date-picker__time-col tma-date-picker__time-col--scroll">${renderCol(minuteRows, 'minute', opts.selectedMinute)}</div>
      </div>`;
    }

    let body = '';
    if (view === 'month') body = renderInteractiveMonthBody();
    else if (view === 'year') body = renderInteractiveYearBody();
    else if (view === 'time') body = renderInteractiveTimeBody();
    else body = renderInteractiveCalendarBody();

    const footer = opts.showBack
      ? '<div class="tma-date-picker__footer"><button type="button" class="tma-date-picker__back" data-dp-back>Back</button></div>'
      : '';

    return `<div class="tma-date-picker tma-date-picker--interactive" role="group" aria-label="Date picker">
      ${renderInteractiveHeader()}
      ${renderInteractiveToolbar()}
      ${body}
      ${footer}
    </div>`;
  }

  function formatFieldValue(state) {
    const { type, startDate, endDate, hour, minute, period, rangeComplete } = state;
    const start = `${pad(startDate.getMonth() + 1)}/${pad(startDate.getDate())}/${startDate.getFullYear()}`;
    const time = formatTime(hour, minute, period);

    if (type === 'date-only') return start;
    if (type === 'date-and-time') return `${start} ${time}`;
    if (type === 'date-range') {
      if (!rangeComplete) return start;
      const end = `${pad(endDate.getMonth() + 1)}/${pad(endDate.getDate())}/${endDate.getFullYear()}`;
      return `${start} – ${end}`;
    }
    if (!rangeComplete) return `${start} ${time}`;
    const end = `${pad(endDate.getMonth() + 1)}/${pad(endDate.getDate())}/${endDate.getFullYear()}`;
    return `${start} ${time} – ${end} ${time}`;
  }

  function to24Hour(hour, minute, period) {
    let h = hour % 12;
    if (period === 'PM') h += 12;
    return `${pad(h)}:${pad(minute)}`;
  }

  function formatHiddenValue(state) {
    const { type, startDate, endDate, hour, minute, period, rangeComplete } = state;
    const startISO = toISODate(startDate);
    const startTime = to24Hour(hour, minute, period);

    if (type === 'date-only') return startISO;
    if (type === 'date-and-time') return `${startISO}T${startTime}`;
    if (type === 'date-range') {
      return rangeComplete ? `${startISO}/${toISODate(endDate)}` : startISO;
    }
    return rangeComplete
      ? `${startISO}T${startTime}/${toISODate(endDate)}T${startTime}`
      : `${startISO}T${startTime}`;
  }

  function mountInteractive(root, options) {
    if (!root) return null;

    const state = createDefaultState(options.type || 'date-only', options.value);
    const onChange = typeof options.onChange === 'function' ? options.onChange : null;
    const onRequestClose = typeof options.onRequestClose === 'function' ? options.onRequestClose : null;
    const closeOnSelect = options.closeOnSelect !== false;

    function paint() {
      root.innerHTML = renderInteractiveDatePicker(state);
    }

    function emitChange() {
      state.lastCommitted = snapshotState(state);
      if (onChange) {
        onChange({
          display: formatFieldValue(state),
          value: formatHiddenValue(state),
          state,
        });
      }
    }

    function selectDate(y, m, d) {
      const picked = new Date(y, m, d);
      if (!state.type.includes('range')) {
        state.startDate = picked;
        state.year = y;
        state.month = m;
        emitChange();
        return true;
      }

      if (!state.rangeAnchor) {
        state.startDate = picked;
        state.endDate = picked;
        state.rangeAnchor = picked;
        state.rangeComplete = false;
        state.year = y;
        state.month = m;
        emitChange();
        return false;
      }

      let start = state.rangeAnchor;
      let end = picked;
      if (compareDates(end, start) < 0) [start, end] = [end, start];
      state.startDate = start;
      state.endDate = end;
      state.rangeAnchor = null;
      state.rangeComplete = true;
      state.year = start.getFullYear();
      state.month = start.getMonth();
      emitChange();
      return true;
    }

    function maybeClose(done) {
      if (!done || !closeOnSelect) return;
      if (state.type.includes('range') && !state.rangeComplete) return;
      onRequestClose?.();
    }

    function handleClick(e) {
      const el = e.target.closest('[data-dp-day],[data-dp-month],[data-dp-year],[data-dp-hour],[data-dp-minute],[data-dp-period],[data-dp-nav],[data-dp-back],[data-dp-pill],[data-dp-header]');
      if (!el || !root.contains(el)) return;

      if (el.matches('[data-dp-header]')) {
        const segment = el.getAttribute('data-dp-header');
        const side = el.getAttribute('data-dp-side');
        if (side === 'end' && state.type.includes('range')) state.activeRangeSide = 'end';
        else if (side === 'start') state.activeRangeSide = 'start';

        if (segment === 'month') state.view = 'month';
        else if (segment === 'year') state.view = 'year';
        else if (segment === 'time') state.view = 'time';
        paint();
        return;
      }

      if (el.matches('[data-dp-back]')) {
        state.view = 'calendar';
        paint();
        return;
      }

      if (el.matches('[data-dp-nav]')) {
        if (state.view === 'year') {
          state.year += el.getAttribute('data-dp-nav') === 'next' ? 12 : -12;
        } else if (state.view === 'month' || state.view === 'calendar') {
          const delta = el.getAttribute('data-dp-nav') === 'next' ? 1 : -1;
          const d = new Date(state.year, state.month + delta, 1);
          state.year = d.getFullYear();
          state.month = d.getMonth();
        }
        paint();
        return;
      }

      if (el.matches('[data-dp-pill]')) {
        if (el.getAttribute('data-dp-pill') === 'primary') {
          const now = new Date();
          if (state.view === 'time') {
            state.hour = now.getHours() % 12 || 12;
            state.minute = now.getMinutes();
            state.period = now.getHours() >= 12 ? 'PM' : 'AM';
          } else {
            selectDate(now.getFullYear(), now.getMonth(), now.getDate());
            state.view = 'calendar';
          }
          paint();
          emitChange();
        } else if (state.lastCommitted) {
          Object.assign(state, snapshotState(state.lastCommitted));
          paint();
          emitChange();
        }
        return;
      }

      if (el.matches('[data-dp-month]')) {
        state.month = MONTHS.indexOf(el.getAttribute('data-dp-month'));
        state.view = 'calendar';
        paint();
        return;
      }

      if (el.matches('[data-dp-year]')) {
        state.year = Number(el.getAttribute('data-dp-year'));
        state.view = 'calendar';
        paint();
        return;
      }

      if (el.matches('[data-dp-hour]')) {
        state.hour = Number(el.getAttribute('data-dp-hour'));
        paint();
        emitChange();
        return;
      }

      if (el.matches('[data-dp-minute]')) {
        state.minute = Number(el.getAttribute('data-dp-minute'));
        paint();
        emitChange();
        return;
      }

      if (el.matches('[data-dp-period]')) {
        state.period = el.getAttribute('data-dp-period');
        paint();
        emitChange();
        return;
      }

      if (el.matches('[data-dp-day]')) {
        const day = Number(el.getAttribute('data-dp-day'));
        const offset = Number(el.getAttribute('data-dp-month-offset') || 0);
        const y = state.year;
        const m = state.month + offset;
        const d = new Date(y, m, day);

        if (state.type.includes('range')) {
          if (!state.rangeAnchor) {
            selectDate(d.getFullYear(), d.getMonth(), d.getDate());
            paint();
            return;
          }
          const done = selectDate(d.getFullYear(), d.getMonth(), d.getDate());
          state.view = 'calendar';
          paint();
          maybeClose(done);
          return;
        }

        selectDate(d.getFullYear(), d.getMonth(), d.getDate());
        state.view = 'calendar';
        paint();
        maybeClose(true);
      }
    }

    function handleHover(e) {
      const el = e.target.closest('[data-dp-day]');
      if (!el || !root.contains(el) || el.getAttribute('data-dp-muted') === '1') {
        if (state.hoverDay != null) {
          state.hoverDay = null;
          paint();
        }
        return;
      }
      const day = Number(el.getAttribute('data-dp-day'));
      if (state.hoverDay !== day) {
        state.hoverDay = day;
        paint();
      }
    }

    const api = {
      state,
      paint,
      getValue() {
        return {
          display: formatFieldValue(state),
          value: formatHiddenValue(state),
        };
      },
      setValue(initial) {
        Object.assign(state, createDefaultState(state.type, initial));
        paint();
        emitChange();
      },
      destroy() {
        root.removeEventListener('click', handleClick);
        root.removeEventListener('mouseover', handleHover);
      },
    };

    root.addEventListener('click', handleClick);
    root.addEventListener('mouseover', handleHover);
    paint();
    return api;
  }

  function attachField(container, options) {
    if (!container) return null;

    const type = options.type || 'date-only';
    const name = options.name || '';
    const label = options.label || '';
    const placeholder = options.placeholder || 'Select date';
    const closeOnSelect = options.closeOnSelect !== false && !type.includes('range');

    container.classList.add('tma-date-picker-field');
    container.innerHTML = `
      ${label ? `<label class="tma-date-picker-field__label">${label}</label>` : ''}
      <button type="button" class="tma-date-picker-field__trigger" data-empty aria-haspopup="dialog">${placeholder}</button>
      ${name ? `<input type="hidden" name="${name}" value="">` : ''}
      <div class="tma-date-picker-field__popover" role="dialog" aria-label="${label || 'Date picker'}">
        <div class="tma-date-picker-field__popover-inner"></div>
      </div>
    `;

    const trigger = container.querySelector('.tma-date-picker-field__trigger');
    const hidden = container.querySelector('input[type="hidden"]');
    const popoverInner = container.querySelector('.tma-date-picker-field__popover-inner');
    let picker = null;

    function open() {
      document.querySelectorAll('.tma-date-picker-field[data-open]').forEach((el) => {
        if (el !== container) el.removeAttribute('data-open');
      });
      container.setAttribute('data-open', 'true');
      ensurePicker();
    }

    function close() {
      container.removeAttribute('data-open');
    }

    function syncTrigger(payload) {
      const display = payload.display;
      trigger.textContent = display;
      trigger.removeAttribute('data-empty');
      if (hidden) hidden.value = payload.value;
      if (typeof options.onChange === 'function') options.onChange(payload);
      if (closeOnSelect && !type.includes('range')) close();
      if (type.includes('range') && picker?.state.rangeComplete && closeOnSelect) close();
    }

    function ensurePicker() {
      if (picker) return picker;
      picker = mountInteractive(popoverInner, {
        type,
        value: options.value,
        closeOnSelect,
        onRequestClose: close,
        onChange: syncTrigger,
      });
      return picker;
    }

    trigger.addEventListener('click', () => {
      if (container.hasAttribute('data-open')) close();
      else {
        open();
        ensurePicker();
      }
    });

    document.addEventListener('click', (e) => {
      if (!container.hasAttribute('data-open')) return;
      if (!container.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && container.hasAttribute('data-open')) close();
    });

    if (options.defaultNow) {
      ensurePicker();
      syncTrigger(picker.getValue());
    } else if (options.value) {
      ensurePicker();
      syncTrigger(picker.getValue());
    }

    function remountPicker(initial) {
      picker?.destroy();
      picker = mountInteractive(popoverInner, {
        type,
        value: initial,
        closeOnSelect,
        onRequestClose: close,
        onChange: syncTrigger,
      });
      return picker;
    }

    const api = {
      open,
      close,
      getValue() {
        return picker ? picker.getValue() : { display: '', value: '' };
      },
      setDisplay(display, hiddenValue) {
        const text = display || '';
        trigger.textContent = text || placeholder;
        if (text) trigger.removeAttribute('data-empty');
        else trigger.setAttribute('data-empty', '');
        if (hidden) hidden.value = hiddenValue != null ? hiddenValue : text;
      },
      setToNow() {
        remountPicker({ start: new Date() });
        syncTrigger(picker.getValue());
      },
      destroy() {
        picker?.destroy();
        container.innerHTML = '';
        container.classList.remove('tma-date-picker-field');
        delete container._datePickerApi;
      },
    };

    container._datePickerApi = api;
    return api;
  }

  function attachDocExample(root, options) {
    if (!root) return null;

    const type = options.type || 'date-only';
    const label = options.label || 'Date';
    const placeholder = options.placeholder || 'Pick a date';
    const inputAttrs = options.inputAttrs || ' data-node-id="33304:16627"';
    const pickerAttrs = options.pickerAttrs || ' data-node-id="33304:16628"';

    root.innerHTML = `
      <button type="button" class="tma-date-input tma-date-picker-doc-example__input"${inputAttrs} data-empty aria-haspopup="dialog" aria-expanded="true">
        <span class="tma-date-input__label-row"><span class="tma-date-input__label">${label}</span></span>
        <span class="tma-date-input__value-row">
          <span class="tma-date-input__placeholder">${placeholder}</span>
          ${svg('ArrowLineUpDown16', 'tma-date-input__icon', 16, 16)}
        </span>
      </button>
      <div class="tma-date-picker-doc__example-picker"${pickerAttrs}>
        <div class="tma-date-picker-doc-example__picker-inner"></div>
      </div>
    `;

    root.classList.add('tma-date-picker-doc-example');
    root.setAttribute('data-open', 'true');

    const input = root.querySelector('.tma-date-picker-doc-example__input');
    const placeholderEl = root.querySelector('.tma-date-input__placeholder');
    const pickerRoot = root.querySelector('.tma-date-picker-doc-example__picker-inner');

    function syncInput(payload) {
      placeholderEl.textContent = payload.display;
      input.removeAttribute('data-empty');
      input.setAttribute('data-filled', 'true');
      if (typeof options.onChange === 'function') options.onChange(payload);
    }

    const picker = mountInteractive(pickerRoot, {
      type,
      value: options.value,
      closeOnSelect: false,
      onChange: syncInput,
    });

    input.addEventListener('click', () => {
      root.setAttribute('data-open', 'true');
      input.setAttribute('aria-expanded', 'true');
    });

    return {
      picker,
      input,
      getValue() {
        return picker.getValue();
      },
    };
  }
})();
