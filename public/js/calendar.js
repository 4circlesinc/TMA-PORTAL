/*
 * TMA - Calendar page ( /calendar )
 * Global: window.TMACalendar
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';
  var ICONS = {
    Plus: ICON + 'Plus.svg',
    X: ICON + 'X.svg',
    Trash: ICON + 'Trash.svg',
    PencilSimpleLine: ICON + 'PencilSimpleLine.svg',
    MapPin: ICON + 'MapPin.svg',
    Note: ICON + 'Note.svg',
    Users: ICON + 'Users.svg',
    ArrowLineLeft: TMA + 'ArrowLineLeft-16.svg',
    ArrowLineRight: TMA + 'ArrowLineRight-16.svg',
  };

  var STORE_KEY = 'tma.calendar.events';
  var VIEW_STORE_KEY = 'tma.calendar.view';
  var VIEWS = ['week', 'month', 'agenda'];

  var SCHED = window.TMASchedule;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function uid() {
    return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function loadView() {
    try {
      var saved = localStorage.getItem(VIEW_STORE_KEY);
      if (VIEWS.indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return 'week';
  }

  function saveView(view) {
    try {
      localStorage.setItem(VIEW_STORE_KEY, view);
    } catch (e) { /* ignore */ }
  }

  function loadEvents() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) { /* ignore */ }
    return seedEvents();
  }

  function saveEvents(events) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(events));
    } catch (e) { /* ignore */ }
  }

  function seedEvents() {
    var weekStart = SCHED.startOfWeek(new Date());
    var templates = [
      {
        title: 'Cloud project meeting',
        day: 0,
        start: 8,
        end: 10,
        tone: 'blue',
        location: 'Conference Room A',
        description: 'Review cloud migration milestones and assign next sprint tasks.',
        avatars: ['AvatarByewind', 'AvatarMale04'],
      },
      {
        title: 'Test the prototypes',
        day: 0,
        start: 8.5,
        end: 10,
        tone: 'purple',
        location: 'Design Studio',
        description: 'Walk through interactive prototypes with the product team.',
      },
      {
        title: 'Design feedback',
        day: 1,
        start: 8.5,
        end: 9.83,
        tone: 'blue',
        location: 'Zoom',
        description: 'Collect feedback on the latest dashboard mockups.',
        avatars: ['AvatarFemale04'],
      },
      {
        title: 'Requirements discussion',
        day: 2,
        start: 10.5,
        end: 12.5,
        tone: 'blue',
        location: 'Boardroom 2',
        description: 'Finalize scope for the client portal release.',
        avatars: ['AvatarByewind', 'AvatarMale01'],
      },
      {
        title: 'Meeting with Emma',
        day: 3,
        start: 10.5,
        end: 12.5,
        tone: 'purple',
        location: 'Café on 5th',
        description: 'Quarterly check-in and roadmap alignment.',
        avatars: ['Avatar3d04'],
      },
      {
        title: 'Meeting with John',
        day: 3,
        start: 14.5,
        end: 16.5,
        tone: 'purple',
        location: 'Office - Desk 12',
        description: 'Discuss contract terms and delivery timeline.',
        avatars: ['AvatarMale02'],
      },
      {
        title: 'New Product meeting',
        day: 3,
        start: 15.5,
        end: 18,
        tone: 'blue',
        location: 'Main Hall',
        description: 'Launch planning for the new advisory product line.',
        avatars: ['AvatarAbstract04', 'AvatarFemale02', 'AvatarMale03'],
      },
      {
        title: 'Team Lunch',
        day: 3,
        start: 13,
        end: 14,
        tone: 'purple',
        location: 'Riverfront Bistro',
        description: 'Informal team lunch - all welcome.',
      },
      {
        title: 'Project Kick off',
        day: 4,
        start: 14.5,
        end: 16,
        tone: 'purple',
        location: 'Conference Room B',
        description: 'Kick off the advisory portal redesign project.',
        avatars: ['AvatarMale05', 'Avatar3d03'],
      },
      {
        title: 'Drew birthday',
        day: 6,
        start: 11,
        end: 16,
        tone: 'purple',
        location: 'Rooftop Lounge',
        description: 'Birthday celebration for Drew - snacks provided.',
        avatars: ['AvatarByewind', 'AvatarMale01'],
        extra: 9,
      },
      {
        title: 'Test',
        day: 6,
        start: 14,
        end: 15,
        tone: 'blue',
        location: 'Lab 3',
        description: 'QA session for calendar and scheduling flows.',
        avatars: ['AvatarFemale01', 'AvatarMale02', 'Avatar3d04'],
        extra: 6,
      },
    ];

    return templates.map(function (tpl) {
      var date = SCHED.addDays(weekStart, tpl.day);
      return {
        id: uid(),
        title: tpl.title,
        date: SCHED.formatDateKey(date),
        start: tpl.start,
        end: tpl.end,
        tone: tpl.tone,
        location: tpl.location || '',
        description: tpl.description || '',
        avatars: tpl.avatars || null,
        extra: tpl.extra || null,
      };
    });
  }

  function eventsForWeek(events, weekStart) {
    return events
      .map(function (event) {
        var day = SCHED.dayIndexInWeek(SCHED.parseDateKey(event.date), weekStart);
        if (day < 0) return null;
        return Object.assign({}, event, { day: day });
      })
      .filter(Boolean)
      .sort(function (a, b) {
        if (a.day !== b.day) return a.day - b.day;
        return a.start - b.start;
      });
  }

  function eventsForMonth(events, monthDate) {
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    return events
      .filter(function (event) {
        var d = SCHED.parseDateKey(event.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .sort(function (a, b) {
        var da = SCHED.parseDateKey(a.date);
        var db = SCHED.parseDateKey(b.date);
        if (da.getTime() !== db.getTime()) return da - db;
        return a.start - b.start;
      });
  }

  function getEvent(events, id) {
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === id) return events[i];
    }
    return null;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  function formatMonthLabel(date) {
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function formatLongDate(dateKey) {
    var d = SCHED.parseDateKey(dateKey);
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function buildTimeOptions() {
    var opts = [];
    var h;
    var m;
    for (h = 7; h <= 20; h++) {
      for (m = 0; m < 60; m += 30) {
        if (h === 20 && m > 0) break;
        var decimal = h + m / 60;
        opts.push({ value: decimal, label: SCHED.formatTimeLabel(decimal) });
      }
    }
    return opts;
  }

  var TIME_OPTIONS = buildTimeOptions();

  var AVATAR_NAMES = {
    AvatarByewind: 'ByeWind',
    AvatarMale01: 'Drew Cano',
    AvatarMale02: 'John Smith',
    AvatarMale03: 'Orlando Diggs',
    AvatarMale04: 'Koray Okumus',
    AvatarMale05: 'James Wilson',
    AvatarFemale01: 'Andi Lane',
    AvatarFemale02: 'Aliah Davis',
    AvatarFemale04: 'Kate Morrison',
    AvatarFemale05: 'Melody Macy',
    AvatarFemale06: 'Natali Craig',
    Avatar3d03: 'Sophia Martinez',
    Avatar3d04: 'Emma Smith',
    AvatarAbstract04: 'Samuel Anderson',
  };

  function avatarDisplayName(key) {
    return AVATAR_NAMES[key] || key.replace(/^Avatar/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  }

  function formatDuration(start, end) {
    var mins = Math.round((end - start) * 60);
    if (mins <= 0) return '';
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (m === 0) return h + (h === 1 ? ' hour' : ' hours');
    return h + ' hr ' + m + ' min';
  }

  function defaultDraft(dateKey) {
    return {
      title: '',
      date: dateKey || SCHED.formatDateKey(new Date()),
      start: 9,
      end: 10,
      tone: 'blue',
      location: '',
      description: '',
    };
  }

  function showToast(message, options) {
    if (!window.TMAToast || !window.TMAToast.showFloatingToast) return;
    var opts = options || {};
    window.TMAToast.showFloatingToast(message, {
      size: 'big',
      state: opts.state === 'failure' ? 'failure' : 'successful',
      durationMs: 3000,
    });
  }

  function renderViewToggle(view) {
    return (
      '<div class="tma-tab-group tma-tab-group--segmented tma-dash__calendar-view-tabs" role="group" aria-label="Calendar view" data-calendar-view-tabs>' +
      VIEWS.map(function (v, index) {
        var label = v.charAt(0).toUpperCase() + v.slice(1);
        return (
          '<button type="button" class="tma-tab' +
          (view === v ? ' is-active' : '') +
          '" data-tab-index="' +
          index +
          '" data-tab-key="' +
          esc(v) +
          '">' +
          '<span class="tma-tab__label">' +
          esc(label) +
          '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderMonthView(state) {
    var monthStart = startOfMonth(state.monthDate);
    var gridStart = SCHED.startOfWeek(monthStart);
    var monthEvents = eventsForMonth(state.events, state.monthDate);
    var eventDates = {};
    monthEvents.forEach(function (event) {
      eventDates[event.date] = (eventDates[event.date] || 0) + 1;
    });

    var cells = [];
    var i;
    for (i = 0; i < 42; i++) {
      var date = SCHED.addDays(gridStart, i);
      var inMonth = date.getMonth() === state.monthDate.getMonth();
      var isToday = SCHED.sameDay(date, new Date());
      var dateKey = SCHED.formatDateKey(date);
      var count = eventDates[dateKey] || 0;
      cells.push(
        '<button type="button" class="tma-dash__calendar-month-day' +
          (inMonth ? '' : ' tma-dash__calendar-month-day--muted') +
          (isToday ? ' tma-dash__calendar-month-day--today' : '') +
          (state.selectedEventId && monthEvents.some(function (e) {
            return e.id === state.selectedEventId && e.date === dateKey;
          })
            ? ' tma-dash__calendar-month-day--selected'
            : '') +
          '" data-calendar-day="' +
          esc(dateKey) +
          '">' +
          '<span class="tma-dash__calendar-month-day-num">' +
          esc(date.getDate()) +
          '</span>' +
          (count
            ? '<span class="tma-dash__calendar-month-dots" aria-label="' +
              count +
              ' events">' +
              Array(Math.min(count, 3))
                .fill('<span class="tma-dash__calendar-month-dot"></span>')
                .join('') +
              '</span>'
            : '') +
          '</button>'
      );
    }

    return (
      '<div class="tma-dash__calendar-month" data-calendar-month-root>' +
      '<div class="tma-dash__calendar-month-head">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-month-prev aria-label="Previous month">' +
      '<img src="' +
      ICONS.ArrowLineLeft +
      '" alt="">' +
      '</button>' +
      '<span class="tma-dash__calendar-month-label">' +
      esc(formatMonthLabel(state.monthDate)) +
      '</span>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-month-next aria-label="Next month">' +
      '<img src="' +
      ICONS.ArrowLineRight +
      '" alt="">' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-today-btn" data-calendar-month-today>Today</button>' +
      '</div>' +
      '<div class="tma-dash__calendar-month-weekdays">' +
      ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
        .map(function (d) {
          return '<span>' + esc(d) + '</span>';
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__calendar-month-grid">' +
      cells.join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderAgendaView(state) {
    var weekEvents = eventsForWeek(state.events, state.weekStart);
    var nav =
      '<div class="tma-dash__calendar-agenda-nav">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-agenda-prev aria-label="Previous week">' +
      '<img src="' +
      ICONS.ArrowLineLeft +
      '" alt="">' +
      '</button>' +
      '<span class="tma-dash__clients-schedule-date">' +
      esc(SCHED.formatWeekLabel(state.weekStart)) +
      '</span>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-agenda-next aria-label="Next week">' +
      '<img src="' +
      ICONS.ArrowLineRight +
      '" alt="">' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-today-btn" data-calendar-agenda-today>Today</button>' +
      '</div>';

    if (!weekEvents.length) {
      return (
        '<div class="tma-dash__calendar-agenda" data-calendar-agenda-root>' +
        nav +
        '<p class="tma-dash__calendar-empty">No events this week. Click <strong>New event</strong> to add one.</p>' +
        '</div>'
      );
    }

    var groups = {};
    weekEvents.forEach(function (event) {
      if (!groups[event.date]) groups[event.date] = [];
      groups[event.date].push(event);
    });

    var html =
      '<div class="tma-dash__calendar-agenda" data-calendar-agenda-root>' +
      nav +
      Object.keys(groups)
        .sort()
        .map(function (dateKey) {
          return (
            '<section class="tma-dash__calendar-agenda-day">' +
            '<h3 class="tma-dash__calendar-agenda-date">' +
            esc(formatLongDate(dateKey)) +
            '</h3>' +
            '<div class="tma-dash__calendar-agenda-list">' +
            groups[dateKey]
              .map(function (event) {
                var selected = state.selectedEventId === event.id;
                return (
                  '<button type="button" class="tma-dash__calendar-agenda-item tma-dash__calendar-agenda-item--' +
                  esc(event.tone || 'blue') +
                  (selected ? ' tma-dash__calendar-agenda-item--selected' : '') +
                  '" data-calendar-event="' +
                  esc(event.id) +
                  '">' +
                  '<span class="tma-dash__calendar-agenda-time">' +
                  esc(SCHED.formatTimeRange(event.start, event.end)) +
                  '</span>' +
                  '<span class="tma-dash__calendar-agenda-title">' +
                  esc(event.title) +
                  '</span>' +
                  '</button>'
                );
              })
              .join('') +
            '</div></section>'
          );
        })
        .join('') +
      '</div>';
    return html;
  }

  function renderTimeSelect(name, value) {
    return (
      '<select class="tma-dash__clients-field-select" data-calendar-field="' +
      esc(name) +
      '">' +
      TIME_OPTIONS.map(function (opt) {
        return (
          '<option value="' +
          opt.value +
          '"' +
          (Number(value) === opt.value ? ' selected' : '') +
          '>' +
          esc(opt.label) +
          '</option>'
        );
      }).join('') +
      '</select>'
    );
  }

  function renderDetailLink(icon, text, block) {
    if (!text) return '';
    return (
      '<li class="tma-dash__calendar-detail-link">' +
      '<img class="tma-dash__calendar-detail-link-icon" src="' +
      esc(icon) +
      '" alt="" width="20" height="20">' +
      '<span class="tma-dash__calendar-detail-link-text' +
      (block ? ' tma-dash__calendar-detail-link-text--block' : '') +
      '">' +
      esc(text) +
      '</span></li>'
    );
  }

  function renderParticipantSummary(event) {
    if (!event.avatars || !event.avatars.length) return '';
    var names = event.avatars.map(avatarDisplayName).join(', ');
    if (event.extra) names += ' +' + event.extra + ' others';
    return names;
  }

  function renderPanelViewContent(event) {
    var duration = formatDuration(event.start, event.end);
    var tone = event.tone || 'blue';
    var links = [
      renderDetailLink(ICONS.MapPin, event.location),
      renderDetailLink(ICONS.Note, event.description, true),
      renderDetailLink(ICONS.Users, renderParticipantSummary(event)),
    ]
      .filter(Boolean)
      .join('');

    return (
      '<div class="tma-dash__calendar-panel-body tma-dash__calendar-panel-body--view">' +
      '<p class="tma-dash__calendar-detail-eyebrow">My schedule</p>' +
      '<div class="tma-dash__calendar-detail-hero">' +
      '<span class="tma-dash__calendar-detail-mark tma-dash__calendar-detail-mark--' +
      esc(tone) +
      '" aria-hidden="true"></span>' +
      '<h1 class="tma-dash__calendar-detail-title' +
      (event.completed ? ' tma-dash__calendar-detail-title--completed' : '') +
      '">' +
      esc(event.title) +
      '</h1></div>' +
      '<p class="tma-dash__calendar-detail-when">' +
      esc(formatLongDate(event.date)) +
      '</p>' +
      '<p class="tma-dash__calendar-detail-time">' +
      esc(SCHED.formatTimeRange(event.start, event.end)) +
      (duration ? ' · ' + esc(duration) : '') +
      '</p>' +
      (links ? '<ul class="tma-dash__calendar-detail-links">' + links + '</ul>' : '') +
      '</div>'
    );
  }

  function renderPanelViewFooter(event) {
    return (
      '<div class="tma-dash__calendar-panel-footer">' +
      '<button type="button" class="tma-dash__calendar-panel-complete' +
      (event.completed ? ' tma-dash__calendar-panel-complete--done' : '') +
      '" data-calendar-complete="' +
      esc(event.id) +
      '"' +
      (event.completed ? ' aria-pressed="true"' : '') +
      '>' +
      esc(event.completed ? 'Completed' : 'Mark completed') +
      '</button></div>'
    );
  }

  function renderPanelViewHeader(event) {
    return (
      '<div class="tma-dash__calendar-panel-head tma-dash__calendar-panel-head--view">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' +
      ICONS.X +
      '" alt="">' +
      '</button>' +
      '<div class="tma-dash__calendar-panel-head-actions">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-edit="' +
      esc(event.id) +
      '" aria-label="Edit event">' +
      '<img src="' +
      ICONS.PencilSimpleLine +
      '" alt="">' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-delete="' +
      esc(event.id) +
      '" aria-label="Delete event">' +
      '<img src="' +
      ICONS.Trash +
      '" alt="">' +
      '</button>' +
      '</div></div>'
    );
  }

  function renderPanel(state) {
    if (!state.panel) return '';

    if (state.panel.mode === 'view') {
      var event = getEvent(state.events, state.panel.eventId);
      if (!event) return '';
      return (
        '<aside class="tma-dash__calendar-panel tma-dash__calendar-panel--view" data-calendar-panel>' +
        renderPanelViewHeader(event) +
        renderPanelViewContent(event) +
        renderPanelViewFooter(event) +
        '</aside>'
      );
    }

    var draft = state.panel.draft || defaultDraft();
    var isEdit = state.panel.mode === 'edit';
    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">' +
      esc(isEdit ? 'Edit event' : 'New event') +
      '</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' +
      ICONS.X +
      '" alt="">' +
      '</button></div>' +
      '<form class="tma-dash__calendar-form" data-calendar-form novalidate>' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Title</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-calendar-field="title" value="' +
      esc(draft.title) +
      '" placeholder="Event title" required>' +
      '</label>' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Date</span>' +
      '<input type="date" class="tma-dash__clients-field-input" data-calendar-field="date" value="' +
      esc(draft.date) +
      '" required>' +
      '</label>' +
      '<div class="tma-dash__clients-form-grid">' +
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">Start</span>' +
      renderTimeSelect('start', draft.start) +
      '</label>' +
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">End</span>' +
      renderTimeSelect('end', draft.end) +
      '</label>' +
      '</div>' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Color</span>' +
      '<select class="tma-dash__clients-field-select" data-calendar-field="tone">' +
      '<option value="blue"' +
      (draft.tone === 'blue' ? ' selected' : '') +
      '>Blue</option>' +
      '<option value="purple"' +
      (draft.tone === 'purple' ? ' selected' : '') +
      '>Purple</option>' +
      '</select></label>' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Location</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-calendar-field="location" value="' +
      esc(draft.location || '') +
      '" placeholder="Add a location">' +
      '</label>' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Notes</span>' +
      '<textarea class="tma-dash__clients-field-input tma-dash__clients-field-textarea" data-calendar-field="description" rows="4" placeholder="Add notes or agenda">' +
      esc(draft.description || '') +
      '</textarea></label>' +
      '</form>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-calendar-save>' +
      esc(isEdit ? 'Save changes' : 'Create event') +
      '</button>' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>' +
      '</div></aside>'
    );
  }

  function renderMainView(state) {
    if (state.view === 'month') return renderMonthView(state);
    if (state.view === 'agenda') return renderAgendaView(state);

    var weekEvents = eventsForWeek(state.events, state.weekStart);
    return SCHED.render({
      title: 'My schedule',
      standalone: true,
      weekStart: state.weekStart,
      events: weekEvents,
      selectedEventId: state.selectedEventId,
    });
  }

  function renderPage(state) {
    return (
      '<div class="tma-dash__calendar" data-node-id="calendar-page">' +
      '<div class="tma-dash__calendar-toolbar">' +
      renderViewToggle(state.view) +
      '<button type="button" class="tma-dash__clients-add-btn tma-dash__clients-add-btn--toolbar" data-calendar-new>' +
      '<img src="' +
      ICONS.Plus +
      '" alt=""> New event</button>' +
      '</div>' +
      '<div class="tma-dash__calendar-layout' +
      (state.panel ? ' tma-dash__calendar-layout--panel-open' : '') +
      '">' +
      '<div class="tma-dash__calendar-main">' +
      renderMainView(state) +
      '</div>' +
      renderPanel(state) +
      '</div></div>'
    );
  }

  function readDraft(form) {
    var draft = {};
    var titleEl = form.querySelector('[data-calendar-field="title"]');
    var dateEl = form.querySelector('[data-calendar-field="date"]');
    var startEl = form.querySelector('[data-calendar-field="start"]');
    var endEl = form.querySelector('[data-calendar-field="end"]');
    var toneEl = form.querySelector('[data-calendar-field="tone"]');
    var locationEl = form.querySelector('[data-calendar-field="location"]');
    var descriptionEl = form.querySelector('[data-calendar-field="description"]');
    draft.title = titleEl ? titleEl.value.trim() : '';
    draft.date = dateEl ? dateEl.value : '';
    draft.start = startEl ? Number(startEl.value) : 9;
    draft.end = endEl ? Number(endEl.value) : 10;
    draft.tone = toneEl ? toneEl.value : 'blue';
    draft.location = locationEl ? locationEl.value.trim() : '';
    draft.description = descriptionEl ? descriptionEl.value.trim() : '';
    return draft;
  }

  function wireEvents(root, state, render) {
    var viewTabs = root.querySelector('[data-calendar-view-tabs]');
    if (viewTabs) {
      if (window.PortalTabGroup && window.PortalTabGroup.init) {
        window.PortalTabGroup.init(root);
      }
      viewTabs.addEventListener('tma-tab-change', function (event) {
        var nextView = event.detail && event.detail.key;
        if (!nextView || nextView === state.view) return;
        state.view = nextView;
        saveView(state.view);
        if (state.view === 'month') {
          state.monthDate = startOfMonth(state.weekStart);
        }
        render();
      });
    }

    var newBtn = root.querySelector('[data-calendar-new]');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        state.panel = { mode: 'create', draft: defaultDraft(SCHED.formatDateKey(new Date())) };
        state.selectedEventId = null;
        render();
      });
    }

    root.querySelectorAll('[data-calendar-panel-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.panel = null;
        render();
      });
    });

    root.querySelectorAll('[data-calendar-event]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-event');
        state.selectedEventId = id;
        state.panel = { mode: 'view', eventId: id };
        render();
      });
    });

    root.querySelectorAll('[data-calendar-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-edit');
        var event = getEvent(state.events, id);
        if (!event) return;
        state.panel = {
          mode: 'edit',
          eventId: id,
          draft: {
            title: event.title,
            date: event.date,
            start: event.start,
            end: event.end,
            tone: event.tone || 'blue',
            location: event.location || '',
            description: event.description || '',
          },
        };
        render();
      });
    });

    root.querySelectorAll('[data-calendar-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-delete');
        state.events = state.events.filter(function (event) {
          return event.id !== id;
        });
        saveEvents(state.events);
        state.selectedEventId = null;
        state.panel = null;
        render();
        showToast('Event deleted');
      });
    });

    root.querySelectorAll('[data-calendar-complete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-complete');
        var wasCompleted = false;
        state.events = state.events.map(function (event) {
          if (event.id !== id) return event;
          wasCompleted = !!event.completed;
          return Object.assign({}, event, { completed: !event.completed });
        });
        saveEvents(state.events);
        showToast(wasCompleted ? 'Event marked incomplete' : 'Event completed');
        render();
      });
    });

    var saveBtn = root.querySelector('[data-calendar-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var form = root.querySelector('[data-calendar-form]');
        if (!form) return;
        var draft = readDraft(form);
        if (!draft.title) {
          showToast('Please enter a title', { state: 'failure' });
          return;
        }
        if (!draft.date) {
          showToast('Please choose a date', { state: 'failure' });
          return;
        }
        if (draft.end <= draft.start) {
          showToast('End time must be after start time', { state: 'failure' });
          return;
        }

        if (state.panel.mode === 'edit') {
          state.events = state.events.map(function (event) {
            if (event.id !== state.panel.eventId) return event;
            return Object.assign({}, event, draft);
          });
          state.selectedEventId = state.panel.eventId;
          state.panel = { mode: 'view', eventId: state.panel.eventId };
          showToast('Event updated');
        } else {
          var created = Object.assign({ id: uid() }, draft);
          state.events.push(created);
          state.selectedEventId = created.id;
          state.panel = { mode: 'view', eventId: created.id };
          showToast('Event created');
        }

        saveEvents(state.events);
        state.weekStart = SCHED.startOfWeek(SCHED.parseDateKey(draft.date));
        state.monthDate = startOfMonth(SCHED.parseDateKey(draft.date));
        render();
      });
    }

    var monthRoot = root.querySelector('[data-calendar-month-root]');
    if (monthRoot) {
      var monthPrev = monthRoot.querySelector('[data-calendar-month-prev]');
      var monthNext = monthRoot.querySelector('[data-calendar-month-next]');
      var monthToday = monthRoot.querySelector('[data-calendar-month-today]');
      if (monthPrev) {
        monthPrev.addEventListener('click', function () {
          state.monthDate = addMonths(state.monthDate, -1);
          render();
        });
      }
      if (monthNext) {
        monthNext.addEventListener('click', function () {
          state.monthDate = addMonths(state.monthDate, 1);
          render();
        });
      }
      if (monthToday) {
        monthToday.addEventListener('click', function () {
          state.monthDate = startOfMonth(new Date());
          state.weekStart = SCHED.startOfWeek(new Date());
          render();
        });
      }
      monthRoot.querySelectorAll('[data-calendar-day]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var dateKey = btn.getAttribute('data-calendar-day');
          state.weekStart = SCHED.startOfWeek(SCHED.parseDateKey(dateKey));
          state.view = 'week';
          saveView(state.view);
          render();
        });
        btn.addEventListener('dblclick', function (event) {
          event.preventDefault();
          var dateKey = btn.getAttribute('data-calendar-day');
          state.panel = { mode: 'create', draft: defaultDraft(dateKey) };
          state.selectedEventId = null;
          render();
        });
      });
    }

    var agendaRoot = root.querySelector('[data-calendar-agenda-root]');
    if (agendaRoot) {
      var agendaPrev = agendaRoot.querySelector('[data-calendar-agenda-prev]');
      var agendaNext = agendaRoot.querySelector('[data-calendar-agenda-next]');
      var agendaToday = agendaRoot.querySelector('[data-calendar-agenda-today]');
      if (agendaPrev) {
        agendaPrev.addEventListener('click', function () {
          state.weekStart = SCHED.addDays(state.weekStart, -7);
          render();
        });
      }
      if (agendaNext) {
        agendaNext.addEventListener('click', function () {
          state.weekStart = SCHED.addDays(state.weekStart, 7);
          render();
        });
      }
      if (agendaToday) {
        agendaToday.addEventListener('click', function () {
          state.weekStart = SCHED.startOfWeek(new Date());
          render();
        });
      }
    }

    var scheduleRoot = root.querySelector('[data-schedule-root]');
    if (scheduleRoot && SCHED.wire) {
      SCHED.wire(scheduleRoot, {
        onPrev: function () {
          state.weekStart = SCHED.addDays(state.weekStart, -7);
          if (state.view === 'month') state.monthDate = startOfMonth(state.weekStart);
          render();
        },
        onNext: function () {
          state.weekStart = SCHED.addDays(state.weekStart, 7);
          if (state.view === 'month') state.monthDate = startOfMonth(state.weekStart);
          render();
        },
        onToday: function () {
          state.weekStart = SCHED.startOfWeek(new Date());
          state.monthDate = startOfMonth(new Date());
          render();
        },
        onEventClick: function (id) {
          state.selectedEventId = id;
          state.panel = { mode: 'view', eventId: id };
          render();
        },
      });
    }
  }

  function mount(root) {
    if (!root || !SCHED) return;

    var state = {
      view: loadView(),
      weekStart: SCHED.startOfWeek(new Date()),
      monthDate: startOfMonth(new Date()),
      events: loadEvents(),
      selectedEventId: null,
      panel: null,
    };

    if (!localStorage.getItem(STORE_KEY)) {
      saveEvents(state.events);
    }

    function syncPanelShell(state) {
      var dash = root.closest('.tma-dash');
      if (!dash) return;
      dash.classList.toggle('tma-dash--calendar-panel-open', !!state.panel);
    }

    function render() {
      root.innerHTML = renderPage(state);
      wireEvents(root, state, render);
      syncPanelShell(state);
    }

    render();
  }

  function getTodayEventCount() {
    var todayKey = SCHED.formatDateKey(new Date());
    return loadEvents().filter(function (event) {
      return event.date === todayKey;
    }).length;
  }

  window.TMACalendar = { mount: mount, getTodayEventCount: getTodayEventCount };
})();
