/*
 * TMA - Weekly schedule widget (shared by Clients + Calendar pages)
 * Global: window.TMASchedule
 */
(function () {
  'use strict';

  var AVATAR = '/TMA-PORTAL/images/avatars/';
  var TMA = '/TMA-PORTAL/images/icons/tma/';

  var ICONS = {
    ArrowLineLeft: TMA + 'ArrowLineLeft-16.svg',
    ArrowLineRight: TMA + 'ArrowLineRight-16.svg',
  };

  var SCHEDULE_START = 8;
  var SCHEDULE_END = 19;
  var DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TIME_LABELS = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM'];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function addDays(date, days) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatDateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseDateKey(key) {
    var parts = String(key).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatWeekLabel(weekStart) {
    return MONTHS[weekStart.getMonth()] + ' ' + weekStart.getDate();
  }

  function formatDayLabel(date) {
    var dayIndex = date.getDay();
    var labelIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    return DAY_NAMES[labelIndex] + ' ' + date.getDate();
  }

  function formatTimeLabel(decimal) {
    var hour = Math.floor(decimal);
    var minute = Math.round((decimal - hour) * 60);
    var suffix = hour >= 12 ? 'PM' : 'AM';
    var displayHour = hour % 12;
    if (displayHour === 0) displayHour = 12;
    if (minute === 0) return displayHour + ' ' + suffix;
    return displayHour + ':' + pad2(minute) + ' ' + suffix;
  }

  function formatTimeRange(start, end) {
    return formatTimeLabel(start) + ' - ' + formatTimeLabel(end);
  }

  function dayIndexInWeek(date, weekStart) {
    for (var i = 0; i < 7; i++) {
      if (sameDay(addDays(weekStart, i), date)) return i;
    }
    return -1;
  }

  function renderEventAvatars(event) {
    if (!event.avatars || !event.avatars.length) return '';
    var html =
      '<span class="tma-dash__clients-event-avatars">' +
      event.avatars
        .map(function (a) {
          return (
            '<span class="tma-dash__clients-event-avatar">' +
            '<img src="' +
            AVATAR +
            esc(a) +
            '.png" alt="">' +
            '</span>'
          );
        })
        .join('');
    if (event.extra) {
      html += '<span class="tma-dash__clients-event-avatar tma-dash__clients-event-avatar--more">+' + esc(event.extra) + '</span>';
    }
    html += '</span>';
    return html;
  }

  function eventStyle(event) {
    var span = SCHEDULE_END - SCHEDULE_START;
    var top = ((event.start - SCHEDULE_START) / span) * 100;
    var height = ((event.end - event.start) / span) * 100;
    var colPct = 100 / 7;
    var inset = 2;
    var left = event.day * colPct + inset;
    var width = colPct - inset * 2;
    var compact = event.end - event.start < 1.25;
    return (
      'top:' +
      top.toFixed(2) +
      '%;height:' +
      height.toFixed(2) +
      '%;left:' +
      left.toFixed(2) +
      '%;width:' +
      width.toFixed(2) +
      '%;--event-compact:' +
      (compact ? '1' : '0')
    );
  }

  function render(opts) {
    opts = opts || {};
    var title = opts.title || 'Schedule';
    var weekStart = opts.weekStart ? new Date(opts.weekStart.getTime()) : startOfWeek(new Date());
    var events = opts.events || [];
    var selectedEventId = opts.selectedEventId || null;
    var today = opts.today || new Date();
    var todayIndex = dayIndexInWeek(today, weekStart);
    var showNow = opts.showNow !== false && todayIndex >= 0;
    var weekDate = opts.weekDate || formatWeekLabel(weekStart);
    var extraClass = opts.standalone ? ' tma-dash__clients-schedule--standalone' : '';
    var dayLabels = [];
    var i;

    for (i = 0; i < 7; i++) {
      dayLabels.push(formatDayLabel(addDays(weekStart, i)));
    }

    var nowHour = today.getHours() + today.getMinutes() / 60;
    var nowLabel =
      opts.nowLabel ||
      pad2(today.getHours() % 12 || 12) + ':' + pad2(today.getMinutes());
    var nowTop = ((nowHour - SCHEDULE_START) / (SCHEDULE_END - SCHEDULE_START)) * 100;

    return (
      '<div class="tma-dash__clients-schedule' +
      extraClass +
      '" data-schedule-root>' +
      '<div class="tma-dash__clients-schedule-head">' +
      '<span class="tma-dash__clients-schedule-title">' +
      esc(title) +
      '</span>' +
      '<div class="tma-dash__clients-schedule-nav">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-schedule-prev aria-label="Previous week">' +
      '<img src="' +
      ICONS.ArrowLineLeft +
      '" alt="">' +
      '</button>' +
      '<span class="tma-dash__clients-schedule-date">' +
      esc(weekDate) +
      '</span>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-schedule-next aria-label="Next week">' +
      '<img src="' +
      ICONS.ArrowLineRight +
      '" alt="">' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-today-btn" data-schedule-today>Today</button>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__clients-schedule-body">' +
      '<div class="tma-dash__clients-schedule-scroll">' +
      '<div class="tma-dash__clients-schedule-times">' +
      TIME_LABELS.map(function (label) {
        return '<span>' + esc(label) + '</span>';
      }).join('') +
      '</div>' +
      '<div class="tma-dash__clients-schedule-grid-wrap">' +
      '<div class="tma-dash__clients-schedule-days">' +
      dayLabels
        .map(function (label, index) {
          var isToday = index === todayIndex;
          return (
            '<span class="tma-dash__clients-schedule-day' +
            (isToday ? ' tma-dash__clients-schedule-day--today' : '') +
            '">' +
            (isToday
              ? '<span class="tma-dash__clients-schedule-today-tag">' + esc(label) + '</span>'
              : esc(label)) +
            '</span>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__clients-schedule-canvas"' +
      (todayIndex >= 0 ? ' style="--schedule-today-col:' + todayIndex + '"' : '') +
      '>' +
      '<div class="tma-dash__clients-schedule-lines" aria-hidden="true">' +
      dayLabels
        .map(function (_, index) {
          return (
            '<span class="tma-dash__clients-schedule-vline" style="left:' +
            (((index + 0.5) / 7) * 100).toFixed(2) +
            '%"></span>'
          );
        })
        .join('') +
      '</div>' +
      (showNow
        ? '<div class="tma-dash__clients-schedule-now" style="top:' +
          nowTop.toFixed(2) +
          '%">' +
          '<span class="tma-dash__clients-schedule-now-label">' +
          esc(nowLabel) +
          '</span>' +
          '<span class="tma-dash__clients-schedule-now-line"></span>' +
          '</div>'
        : '') +
      events
        .map(function (event) {
          var selected = selectedEventId && event.id === selectedEventId;
          var duration = event.end - event.start;
          var compactCls = duration < 1.25 ? ' tma-dash__clients-event--compact' : '';
          return (
            '<button type="button" class="tma-dash__clients-event tma-dash__clients-event--' +
            esc(event.tone || 'blue') +
            compactCls +
            (selected ? ' tma-dash__clients-event--selected' : '') +
            '" style="' +
            eventStyle(event) +
            '" data-schedule-event="' +
            esc(event.id) +
            '" aria-pressed="' +
            (selected ? 'true' : 'false') +
            '">' +
            '<span class="tma-dash__clients-event-title">' +
            esc(event.title) +
            '</span>' +
            '<span class="tma-dash__clients-event-time">' +
            esc(event.time || formatTimeRange(event.start, event.end)) +
            '</span>' +
            renderEventAvatars(event) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function wire(root, handlers) {
    if (!root || !handlers) return;
    var scheduleRoot = root.querySelector('[data-schedule-root]') || root;

    var prev = scheduleRoot.querySelector('[data-schedule-prev]');
    var next = scheduleRoot.querySelector('[data-schedule-next]');
    var today = scheduleRoot.querySelector('[data-schedule-today]');

    if (prev && handlers.onPrev) prev.addEventListener('click', handlers.onPrev);
    if (next && handlers.onNext) next.addEventListener('click', handlers.onNext);
    if (today && handlers.onToday) today.addEventListener('click', handlers.onToday);

    scheduleRoot.querySelectorAll('[data-schedule-event]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (handlers.onEventClick) handlers.onEventClick(btn.getAttribute('data-schedule-event'));
      });
    });
  }

  window.TMASchedule = {
    render: render,
    wire: wire,
    startOfWeek: startOfWeek,
    addDays: addDays,
    sameDay: sameDay,
    formatDateKey: formatDateKey,
    parseDateKey: parseDateKey,
    formatWeekLabel: formatWeekLabel,
    formatDayLabel: formatDayLabel,
    formatTimeLabel: formatTimeLabel,
    formatTimeRange: formatTimeRange,
    dayIndexInWeek: dayIndexInWeek,
    SCHEDULE_START: SCHEDULE_START,
    SCHEDULE_END: SCHEDULE_END,
  };
})();
