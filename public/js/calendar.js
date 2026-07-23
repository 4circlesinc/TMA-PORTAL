/*
 * TMA - Calendar page ( /calendar )
 * Global: window.TMACalendar
 *
 * Real, server-backed replacement for the localStorage calendar prototype.
 * Calendars, events, visibility, colours and sharing all live behind
 * /portal/calendar; nothing is seeded and nothing is kept in localStorage.
 *
 * Rendering goes through TMAMorph so a save, a visibility toggle or a
 * background refresh updates only what changed — scroll position, the open
 * panel, and in-flight typing all survive. Listener wiring must therefore use
 * TMAMorph.unwired/on, never a bare addEventListener walk, or handlers stack
 * on the nodes that survived the patch.
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
    DotsThree: ICON + 'DotsThreeVertical.svg',
    CaretDown: ICON + 'CaretDown.svg',
    DownloadSimple: ICON + 'DownloadSimple.svg',
    ArrowsClockwise: ICON + 'ArrowsClockwise.svg',
    ArrowLineLeft: TMA + 'ArrowLineLeft-16.svg',
    ArrowLineRight: TMA + 'ArrowLineRight-16.svg',
  };

  var ROOT = window.__TMA_SITE_ROOT || '';
  var BASE = ROOT + '/portal/calendar';
  var VIEWS = ['week', 'month', 'agenda'];

  var SCHED = window.TMASchedule;

  function morph() { return window.TMAMorph; }

  /*
   * The colour palette lives in calendar-colours.js, loaded as a sibling
   * script. If that file ever fails to load — a stale static export, a cache
   * miss, a blocked request — this used to hard-crash the whole page on the
   * first colours().normalise(). A missing palette should degrade to "plain
   * blue", not a white screen, so fall back to a self-contained shim with the
   * same interface. Kept minimal on purpose; calendar-colours.js remains the
   * source of truth when present.
   */
  var COLOUR_FALLBACK = (function () {
    var PALETTE = [
      { key: 'blue', label: 'Blue', token: '--color-blue' },
      { key: 'purple', label: 'Deep blue', token: '--color-primary-dark' },
      { key: 'green', label: 'Green', token: '--color-green' },
      { key: 'teal', label: 'Teal', token: '--color-mint' },
      { key: 'pink', label: 'Pink', token: '--color-pink' },
      { key: 'red', label: 'Red', token: '--color-red' },
    ];
    var keys = PALETTE.reduce(function (s, c) { s[c.key] = c; return s; }, {});
    return {
      PALETTE: PALETTE,
      isValid: function (c) { return !!c && Object.prototype.hasOwnProperty.call(keys, c); },
      normalise: function (c) { return (c && keys[c]) ? c : 'blue'; },
      label: function (c) { return (keys[c] || keys.blue).label; },
      token: function (c) { return (keys[c] || keys.blue).token; },
    };
  })();

  function colours() { return window.TMACalendarColours || COLOUR_FALLBACK; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function net(url, opts) {
    if (window.TMAFilesNet && window.TMAFilesNet.fetchJSON) {
      return window.TMAFilesNet.fetchJSON(url, opts);
    }
    return Promise.reject(new Error('Network helper unavailable'));
  }

  function showToast(message, options) {
    var opts = options || {};
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(message, {
        size: 'big',
        state: opts.state === 'failure' ? 'failure' : 'successful',
        durationMs: 3000,
      });
      return;
    }
    if (window.TMAPortalUI && window.TMAPortalUI.toast) window.TMAPortalUI.toast(message);
  }

  function errorMessage(err, fallback) {
    return (err && err.message) || fallback;
  }

  /* ── date helpers ────────────────────────────────────────── */

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  function formatMonthLabel(date) {
    return MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function formatLongDate(date) {
    return DAYS[date.getDay()] + ', ' + MONTHS[date.getMonth()] + ' ' + date.getDate();
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /*
   * The server speaks ISO instants; the grid speaks local wall-clock. These
   * two are the only places that cross the boundary, so a rendering bug can
   * never silently shift an event by a timezone offset.
   */
  function toLocalDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function decimalHour(date) {
    return date.getHours() + date.getMinutes() / 60;
  }

  /* Local date + decimal hour back into an ISO instant for the API. */
  function toIso(dateKey, hour) {
    var parts = String(dateKey).split('-');
    var h = Math.floor(hour);
    var m = Math.round((hour - h) * 60);
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), h, m, 0, 0);
    return d.toISOString();
  }

  function dateKeyOf(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function formatDuration(minutes) {
    if (minutes <= 0) return '';
    if (minutes < 60) return minutes + ' min';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (m === 0) return h + (h === 1 ? ' hour' : ' hours');
    return h + ' hr ' + m + ' min';
  }

  function buildTimeOptions() {
    var opts = [];
    for (var h = 7; h <= 20; h++) {
      for (var m = 0; m < 60; m += 30) {
        if (h === 20 && m > 0) break;
        var decimal = h + m / 60;
        opts.push({ value: decimal, label: SCHED.formatTimeLabel(decimal) });
      }
    }
    return opts;
  }

  var TIME_OPTIONS = buildTimeOptions();

  /* ── state ───────────────────────────────────────────────── */

  var state = {
    el: null,
    view: 'week',
    weekStart: SCHED ? SCHED.startOfWeek(new Date()) : new Date(),
    monthDate: startOfMonth(new Date()),
    sidebarOpen: true,

    calendars: [],
    sections: [],
    events: [],
    defaultCalendar: null,
    timezone: 'UTC',
    canCreate: false,

    // Separate flags: the first paint shows skeletons, later refreshes leave
    // the existing grid on screen so events never blink out mid-sync.
    loading: true,
    refreshing: false,
    error: null,

    selectedEventId: null,
    panel: null,          // { mode:'view'|'create'|'edit'|'calendar', ... }
    menuFor: null,        // calendar uuid whose actions menu is open
    busy: {},             // uuid -> true while a write is in flight
    preferencesApplied: false,
  };

  function render() {
    if (!state.el) return;
    morph().patch(state.el, renderPage());
    wire();
    syncPanelShell();
  }

  function syncPanelShell() {
    var dash = state.el && state.el.closest('.tma-dash');
    if (!dash) return;
    dash.classList.toggle('tma-dash--calendar-panel-open', !!state.panel);
  }

  /* ── data ────────────────────────────────────────────────── */

  function windowRange() {
    /*
     * Always fetch a padded window around what's on screen. The month grid
     * shows leading/trailing days from the neighbouring months, and paging a
     * week at a time should not refetch, so a month of slack on each side
     * keeps navigation instant without a second request.
     */
    var anchor = state.view === 'month' ? state.monthDate : state.weekStart;
    var from = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    var to = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  function loadCalendars() {
    return net(BASE + '/calendars').then(function (data) {
      state.calendars = (data && data.calendars) || [];
      state.sections = (data && data.sections) || [];
      state.defaultCalendar = data && data.defaultCalendar;
      state.timezone = (data && data.timezone) || 'UTC';
      state.canCreate = !!(data && data.canCreate);

      /*
       * Remembered chrome arrives with the list. Applied only on the first
       * load — a background refresh must never yank the view out from under
       * someone who has since switched it.
       */
      var prefs = data && data.preferences;
      if (prefs && !state.preferencesApplied) {
        state.preferencesApplied = true;
        if (VIEWS.indexOf(prefs.view) !== -1) state.view = prefs.view;
        if (typeof prefs.sidebarOpen === 'boolean') state.sidebarOpen = prefs.sidebarOpen;
        if (state.view === 'month') state.monthDate = startOfMonth(state.weekStart);
      }
    });
  }

  function loadEvents() {
    var range = windowRange();
    var url = BASE + '/events?from=' + encodeURIComponent(range.from) +
      '&to=' + encodeURIComponent(range.to);
    return net(url).then(function (data) {
      state.events = (data && data.events) || [];
      // The page has fresher data than the badge cache; hand it over rather
      // than letting a second request go out for the same information.
      primeTodayCount(state.events);
    });
  }

  /*
   * A full reload. `background` keeps whatever is already rendered on screen
   * while it runs, which is what stops the grid flashing on every save.
   */
  function load(background) {
    if (background) {
      state.refreshing = true;
    } else {
      state.loading = true;
    }
    state.error = null;
    render();

    return Promise.all([loadCalendars(), loadEvents()])
      .then(function () {
        state.loading = false;
        state.refreshing = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.refreshing = false;
        state.error = errorMessage(err, 'Couldn’t load your calendars.');
        render();
      });
  }

  /* Refetch only the events, for navigation and visibility changes. */
  function refreshEvents() {
    state.refreshing = true;
    render();
    return loadEvents()
      .then(function () {
        state.refreshing = false;
        render();
      })
      .catch(function (err) {
        state.refreshing = false;
        showToast(errorMessage(err, 'Couldn’t load events'), { state: 'failure' });
        render();
      });
  }

  /* ── lookups ─────────────────────────────────────────────── */

  function getCalendar(id) {
    for (var i = 0; i < state.calendars.length; i++) {
      if (state.calendars[i].id === id) return state.calendars[i];
    }
    return null;
  }

  function getEvent(id) {
    var i;

    for (i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) return state.events[i];
    }

    /*
     * A recurring master has no row of its own in the grid — it is present
     * only as generated occurrences with composite ids. Holding the master's
     * uuid (which is what saving a new series hands back) would otherwise
     * match nothing and silently blank the open panel, so fall back to the
     * first occurrence of that series.
     */
    for (i = 0; i < state.events.length; i++) {
      if (state.events[i].seriesId === id) return state.events[i];
    }

    return null;
  }

  function visibleCalendars() {
    return state.calendars.filter(function (c) { return c.visible; });
  }

  /* Calendars the user may actually add an event to. */
  function writableCalendars() {
    return state.calendars.filter(function (c) {
      return ['contributor', 'editor', 'manager', 'owner'].indexOf(c.role) !== -1;
    });
  }

  function eventColour(event) {
    var cal = getCalendar(event.calendarId);
    return colours().normalise(event.colour || (cal && cal.colour));
  }

  /* ── sidebar ─────────────────────────────────────────────── */

  function renderColourSwatch(colour, extraClass) {
    return '<span class="tma-dash__calendar-swatch' + (extraClass ? ' ' + extraClass : '') +
      ' tma-dash__calendar-swatch--' + esc(colours().normalise(colour)) + '" aria-hidden="true"></span>';
  }

  /*
   * The detail panel's colour mark keeps its own class rather than reusing the
   * sidebar swatch: it is a 12px rounded square, not a 10px dot, and sharing
   * one element would have silently restyled it.
   */
  function renderDetailMark(colour) {
    return '<span class="tma-dash__calendar-detail-mark tma-dash__calendar-detail-mark--' +
      esc(colours().normalise(colour)) + '" aria-hidden="true"></span>';
  }

  function renderCalendarRow(cal) {
    var busy = !!state.busy[cal.id];
    var menuOpen = state.menuFor === cal.id;

    /*
     * The source badge is the sync status line from the brief. Local
     * calendars say nothing — a badge on every row would be noise.
     */
    var badge = '';
    if (cal.source === 'google') badge = 'Google';
    else if (cal.source === 'microsoft') badge = 'Microsoft';
    else if (cal.source === 'ics_subscription') badge = 'Subscribed';
    else if (cal.source === 'ics_import') badge = 'Imported';

    /*
     * A failing feed reports itself against its own row. Section 24: a sync
     * failure must not present as a page-level error, and the calendar stays
     * usable while it is broken.
     */
    var sync = cal.sync;
    if (sync) {
      if (sync.status === 'syncing') badge = 'Syncing…';
      else if (sync.status === 'error') badge = 'Sync failed';
      else if (sync.status === 'disabled') badge = 'Paused';
    }

    var owner = !cal.isOwner && cal.ownerName ? cal.ownerName : '';

    return (
      '<li class="tma-dash__calendar-item' + (busy ? ' is-busy' : '') + '" data-calendar-id="' + esc(cal.id) + '">' +
      '<label class="tma-dash__calendar-item-main">' +
      '<input type="checkbox" class="tma-dash__check" data-calendar-toggle="' + esc(cal.id) + '"' +
      (cal.visible ? ' checked' : '') + (busy ? ' disabled' : '') +
      ' aria-label="Show ' + esc(cal.name) + '">' +
      renderColourSwatch(cal.colour) +
      '<span class="tma-dash__calendar-item-text">' +
      '<span class="tma-dash__calendar-item-name">' + esc(cal.name) + '</span>' +
      (owner || badge
        ? '<span class="tma-dash__calendar-item-meta' +
          (sync && sync.status === 'error' ? ' tma-dash__calendar-item-meta--error' : '') + '"' +
          (sync && sync.error ? ' title="' + esc(sync.error) + '"' : '') + '>' +
          esc(owner) + (owner && badge ? ' · ' : '') + esc(badge) +
          '</span>'
        : '') +
      '</span></label>' +
      '<button type="button" class="tma-dash__tool-btn tma-dash__calendar-item-menu"' +
      ' data-calendar-menu="' + esc(cal.id) + '" aria-haspopup="true" aria-expanded="' + (menuOpen ? 'true' : 'false') + '"' +
      ' aria-label="Actions for ' + esc(cal.name) + '">' +
      '<img src="' + ICONS.DotsThree + '" alt="">' +
      '</button>' +
      (menuOpen ? renderCalendarMenu(cal) : '') +
      '</li>'
    );
  }

  function renderCalendarMenu(cal) {
    var items = [];

    // Colour is the one action every subscriber has, because a personal
    // override is always allowed even without permission on the calendar.
    items.push('<div class="tma-dash__calendar-menu-label">Colour</div>');
    items.push('<div class="tma-dash__calendar-menu-colours">' +
      colours().PALETTE.map(function (c) {
        return '<button type="button" class="tma-dash__calendar-colour-btn' +
          (cal.colour === c.key ? ' is-active' : '') +
          '" data-calendar-colour="' + esc(cal.id) + '" data-colour="' + esc(c.key) + '"' +
          ' title="' + esc(c.label) + '" aria-label="' + esc(c.label) + '">' +
          renderColourSwatch(c.key) + '</button>';
      }).join('') + '</div>');

    if (cal.role === 'manager' || cal.role === 'owner') {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-share="' + esc(cal.id) + '">Share…</button>');
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-edit-cal="' + esc(cal.id) + '">Calendar settings</button>');
    }

    // Export needs real detail; availability-only access has none to give.
    if (['titles', 'details', 'contributor', 'editor', 'manager', 'owner'].indexOf(cal.role) > 0) {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-export="' + esc(cal.id) + '">Export as .ics</button>');
    }

    var owns = cal.role === 'manager' || cal.role === 'owner';

    // ICS subscription controls.
    if (cal.sync && cal.source === 'ics_subscription' && owns) {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-refresh="' + esc(cal.id) + '">Refresh now</button>');
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-sub-toggle="' + esc(cal.id) +
        '" data-enabled="' + (cal.sync.status === 'disabled' ? '1' : '0') + '">' +
        (cal.sync.status === 'disabled' ? 'Resume syncing' : 'Pause syncing') + '</button>');
    }

    // Provider (Google/Microsoft) controls.
    if (cal.sync && cal.sync.provider && cal.sync.provider !== 'ics_subscription' && owns) {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-sync-now="' + esc(cal.id) + '">Sync now</button>');
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-sync-settings="' + esc(cal.id) + '">Sync settings</button>');
      if (cal.sync.status === 'error') {
        items.push('<button type="button" class="tma-dash__menu-item" data-calendar-conflicts="' + esc(cal.id) + '">Review conflicts</button>');
      } else {
        items.push('<button type="button" class="tma-dash__menu-item" data-calendar-conflicts="' + esc(cal.id) + '">Conflicts</button>');
      }
      items.push('<button type="button" class="tma-dash__menu-item tma-dash__menu-item--danger" data-calendar-disconnect="' + esc(cal.id) + '">Disconnect</button>');
    }

    // History is available to anyone who manages the calendar.
    if (owns) {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-history="' + esc(cal.id) + '">History</button>');
    }

    // The personal calendar is the guaranteed home for new events, so it can
    // be neither unsubscribed nor deleted.
    if (!cal.isSystem) {
      items.push('<button type="button" class="tma-dash__menu-item" data-calendar-unsubscribe="' + esc(cal.id) + '">Remove from my list</button>');
    }

    if (cal.canDelete) {
      items.push('<button type="button" class="tma-dash__menu-item tma-dash__menu-item--danger" data-calendar-delete="' + esc(cal.id) + '">Delete calendar</button>');
    }

    return '<div class="tma-dash__menu tma-dash__calendar-menu" data-calendar-menu-panel>' + items.join('') + '</div>';
  }

  function renderSidebar() {
    if (!state.sidebarOpen) return '';

    var body;

    if (state.loading) {
      body = window.TMASkeleton
        ? window.TMASkeleton.rows(5, { compact: true })
        : '<p class="tma-dash__calendar-empty">Loading…</p>';
    } else if (state.error) {
      body = '<p class="tma-dash__calendar-empty">' + esc(state.error) + '</p>' +
        '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-retry>Try again</button>';
    } else {
      var groups = state.sections.map(function (section) {
        var rows = state.calendars.filter(function (c) { return c.section === section.key; });
        if (!rows.length) return '';
        return (
          '<section class="tma-dash__calendar-group" data-calendar-section="' + esc(section.key) + '">' +
          '<h3 class="tma-dash__calendar-group-title">' + esc(section.label) + '</h3>' +
          '<ul class="tma-dash__calendar-list">' + rows.map(renderCalendarRow).join('') + '</ul>' +
          '</section>'
        );
      }).join('');

      body = groups || '<p class="tma-dash__calendar-empty">No calendars yet.</p>';
    }

    return (
      '<aside class="tma-dash__calendar-sidebar" data-calendar-sidebar>' +
      '<div class="tma-dash__calendar-sidebar-head">' +
      '<h2 class="tma-dash__calendar-sidebar-title">Calendars</h2>' +
      (state.canCreate
        ? '<div class="tma-dash__calendar-add-wrap">' +
          '<button type="button" class="tma-dash__tool-btn" data-calendar-add-menu' +
          ' aria-haspopup="true" aria-expanded="' + (state.addMenuOpen ? 'true' : 'false') +
          '" aria-label="Add calendar"><img src="' + ICONS.Plus + '" alt=""></button>' +
          (state.addMenuOpen
            ? '<div class="tma-dash__menu tma-dash__calendar-menu" data-calendar-add-panel>' +
              '<button type="button" class="tma-dash__menu-item" data-calendar-add>New calendar</button>' +
              '<button type="button" class="tma-dash__menu-item" data-calendar-browse>Add a colleague’s or group calendar</button>' +
              '<button type="button" class="tma-dash__menu-item" data-calendar-connect>Connect Google or Microsoft</button>' +
              '<button type="button" class="tma-dash__menu-item" data-calendar-import>Import from file (.ics)</button>' +
              '<button type="button" class="tma-dash__menu-item" data-calendar-subscribe>Subscribe by URL</button>' +
              '</div>'
            : '') +
          '</div>'
        : '') +
      '</div>' +
      body +
      '</aside>'
    );
  }

  /* ── main views ──────────────────────────────────────────── */

  /*
   * Map an API event onto the shape TMASchedule expects. The widget is shared
   * with the Clients page, so its contract (day index + decimal hours) is
   * fixed and the adaptation happens here rather than in the widget.
   */
  function toScheduleEvent(event) {
    var starts = toLocalDate(event.startsAt);
    var ends = toLocalDate(event.endsAt);
    if (!starts || !ends) return null;

    var day = SCHED.dayIndexInWeek(
      new Date(starts.getFullYear(), starts.getMonth(), starts.getDate()),
      state.weekStart
    );
    if (day < 0) return null;

    var start = event.allDay ? SCHED.SCHEDULE_START : decimalHour(starts);
    var end = event.allDay ? SCHED.SCHEDULE_END : decimalHour(ends);

    // An event running past midnight is clipped to the day it starts on;
    // the grid has no representation for a block that leaves its column.
    if (end <= start) end = Math.min(start + 1, SCHED.SCHEDULE_END);

    return {
      id: event.id,
      title: event.title,
      day: day,
      start: start,
      end: end,
      tone: eventColour(event),
      time: event.allDay ? 'All day' : SCHED.formatTimeRange(start, end),
    };
  }

  function renderWeekView() {
    var events = state.events.map(toScheduleEvent).filter(Boolean).sort(function (a, b) {
      return a.day !== b.day ? a.day - b.day : a.start - b.start;
    });

    return SCHED.render({
      title: 'My schedule',
      standalone: true,
      weekStart: state.weekStart,
      events: events,
      selectedEventId: state.selectedEventId,
    });
  }

  function renderMonthView() {
    var gridStart = SCHED.startOfWeek(startOfMonth(state.monthDate));

    // Bucket by local date key once, rather than scanning every event per cell.
    var byDate = {};
    state.events.forEach(function (event) {
      var d = toLocalDate(event.startsAt);
      if (!d) return;
      var key = dateKeyOf(d);
      (byDate[key] = byDate[key] || []).push(event);
    });

    var cells = [];
    for (var i = 0; i < 42; i++) {
      var date = SCHED.addDays(gridStart, i);
      var key = dateKeyOf(date);
      var dayEvents = byDate[key] || [];
      var inMonth = date.getMonth() === state.monthDate.getMonth();
      var isToday = SCHED.sameDay(date, new Date());

      cells.push(
        '<button type="button" class="tma-dash__calendar-month-day' +
        (inMonth ? '' : ' tma-dash__calendar-month-day--muted') +
        (isToday ? ' tma-dash__calendar-month-day--today' : '') +
        '" data-calendar-day="' + esc(key) + '">' +
        '<span class="tma-dash__calendar-month-day-num">' + esc(date.getDate()) + '</span>' +
        (dayEvents.length
          ? '<span class="tma-dash__calendar-month-dots" aria-label="' + dayEvents.length + ' events">' +
            dayEvents.slice(0, 3).map(function (e) {
              return '<span class="tma-dash__calendar-month-dot tma-dash__calendar-month-dot--' +
                esc(eventColour(e)) + '"></span>';
            }).join('') +
            '</span>'
          : '') +
        '</button>'
      );
    }

    return (
      '<div class="tma-dash__calendar-month" data-calendar-month-root>' +
      '<div class="tma-dash__calendar-month-head">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-month-prev aria-label="Previous month">' +
      '<img src="' + ICONS.ArrowLineLeft + '" alt=""></button>' +
      '<span class="tma-dash__calendar-month-label">' + esc(formatMonthLabel(state.monthDate)) + '</span>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-month-next aria-label="Next month">' +
      '<img src="' + ICONS.ArrowLineRight + '" alt=""></button>' +
      '<button type="button" class="tma-dash__clients-today-btn" data-calendar-month-today>Today</button>' +
      '</div>' +
      '<div class="tma-dash__calendar-month-weekdays">' +
      ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) {
        return '<span>' + esc(d) + '</span>';
      }).join('') +
      '</div>' +
      '<div class="tma-dash__calendar-month-grid">' + cells.join('') + '</div>' +
      '</div>'
    );
  }

  function renderAgendaView() {
    var nav =
      '<div class="tma-dash__calendar-agenda-nav">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-agenda-prev aria-label="Previous week">' +
      '<img src="' + ICONS.ArrowLineLeft + '" alt=""></button>' +
      '<span class="tma-dash__clients-schedule-date">' + esc(SCHED.formatWeekLabel(state.weekStart)) + '</span>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-agenda-next aria-label="Next week">' +
      '<img src="' + ICONS.ArrowLineRight + '" alt=""></button>' +
      '<button type="button" class="tma-dash__clients-today-btn" data-calendar-agenda-today>Today</button>' +
      '</div>';

    var weekEnd = SCHED.addDays(state.weekStart, 7);
    var inWeek = state.events.filter(function (event) {
      var d = toLocalDate(event.startsAt);
      return d && d >= state.weekStart && d < weekEnd;
    }).sort(function (a, b) {
      return new Date(a.startsAt) - new Date(b.startsAt);
    });

    if (!inWeek.length) {
      return (
        '<div class="tma-dash__calendar-agenda" data-calendar-agenda-root>' + nav +
        '<p class="tma-dash__calendar-empty">No events this week. Click <strong>New event</strong> to add one.</p>' +
        '</div>'
      );
    }

    var groups = {};
    var order = [];
    inWeek.forEach(function (event) {
      var key = dateKeyOf(toLocalDate(event.startsAt));
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(event);
    });

    return (
      '<div class="tma-dash__calendar-agenda" data-calendar-agenda-root>' + nav +
      order.map(function (key) {
        var parts = key.split('-');
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return (
          '<section class="tma-dash__calendar-agenda-day">' +
          '<h3 class="tma-dash__calendar-agenda-date">' + esc(formatLongDate(date)) + '</h3>' +
          '<div class="tma-dash__calendar-agenda-list">' +
          groups[key].map(function (event) {
            var starts = toLocalDate(event.startsAt);
            var ends = toLocalDate(event.endsAt);
            return (
              '<button type="button" class="tma-dash__calendar-agenda-item tma-dash__calendar-agenda-item--' +
              esc(eventColour(event)) +
              (state.selectedEventId === event.id ? ' tma-dash__calendar-agenda-item--selected' : '') +
              '" data-calendar-event="' + esc(event.id) + '">' +
              '<span class="tma-dash__calendar-agenda-time">' +
              esc(event.allDay ? 'All day' : SCHED.formatTimeRange(decimalHour(starts), decimalHour(ends))) +
              '</span>' +
              '<span class="tma-dash__calendar-agenda-title">' + esc(event.title) + '</span>' +
              '</button>'
            );
          }).join('') +
          '</div></section>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderMainView() {
    if (state.loading) {
      return '<div class="tma-dash__calendar-loading">' +
        (window.TMASkeleton ? window.TMASkeleton.rows(8) : 'Loading…') + '</div>';
    }

    if (state.error) {
      return '<div class="tma-dash__calendar-error">' +
        '<p class="tma-dash__calendar-empty">' + esc(state.error) + '</p>' +
        '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-calendar-retry>Try again</button>' +
        '</div>';
    }

    if (!visibleCalendars().length) {
      return '<div class="tma-dash__calendar-error">' +
        '<p class="tma-dash__calendar-empty">No calendars are showing. Tick one in the sidebar to see its events.</p>' +
        '</div>';
    }

    if (state.view === 'month') return renderMonthView();
    if (state.view === 'agenda') return renderAgendaView();
    return renderWeekView();
  }

  /* ── event panel ─────────────────────────────────────────── */

  function renderDetailLink(icon, text, block) {
    if (!text) return '';
    return (
      '<li class="tma-dash__calendar-detail-link">' +
      '<img class="tma-dash__calendar-detail-link-icon" src="' + esc(icon) + '" alt="" width="20" height="20">' +
      '<span class="tma-dash__calendar-detail-link-text' + (block ? ' tma-dash__calendar-detail-link-text--block' : '') + '">' +
      esc(text) + '</span></li>'
    );
  }

  function renderPanelView(event) {
    var starts = toLocalDate(event.startsAt);
    var ends = toLocalDate(event.endsAt);
    var minutes = Math.round((ends - starts) / 60000);
    var cal = getCalendar(event.calendarId);

    var head =
      '<div class="tma-dash__calendar-panel-head tma-dash__calendar-panel-head--view">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button>' +
      '<div class="tma-dash__calendar-panel-head-actions">' +
      (event.private
        ? ''
        : '<button type="button" class="tma-dash__clients-icon-btn" data-event-export="' + esc(event.id) +
          '" aria-label="Export as .ics" title="Export as .ics">' +
          '<img src="' + ICONS.DownloadSimple + '" alt=""></button>') +
      (event.canEdit
        ? '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-edit="' + esc(event.id) + '" aria-label="Edit event">' +
          '<img src="' + ICONS.PencilSimpleLine + '" alt=""></button>' +
          '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-delete-event="' + esc(event.id) + '" aria-label="Delete event">' +
          '<img src="' + ICONS.Trash + '" alt=""></button>'
        : '') +
      '</div>' +
      '</div>';

    // An availability-only viewer gets the time block and nothing else — the
    // server already withheld the detail, so there is nothing here to hide.
    if (event.private) {
      return (
        '<aside class="tma-dash__calendar-panel tma-dash__calendar-panel--view" data-calendar-panel>' + head +
        '<div class="tma-dash__calendar-panel-body tma-dash__calendar-panel-body--view">' +
        '<p class="tma-dash__calendar-detail-eyebrow">' + esc(cal ? cal.name : 'Calendar') + '</p>' +
        '<div class="tma-dash__calendar-detail-hero">' +
        renderDetailMark(eventColour(event)) +
        '<h1 class="tma-dash__calendar-detail-title">Busy</h1></div>' +
        '<p class="tma-dash__calendar-detail-when">' + esc(formatLongDate(starts)) + '</p>' +
        '<p class="tma-dash__calendar-detail-time">' +
        esc(SCHED.formatTimeRange(decimalHour(starts), decimalHour(ends))) + '</p>' +
        '<p class="tma-dash__calendar-detail-muted">You can see when this person is busy, but not what the event is.</p>' +
        '</div></aside>'
      );
    }

    var links = [
      renderDetailLink(ICONS.MapPin, event.location),
      renderDetailLink(ICONS.Note, event.description, true),
      renderDetailLink(ICONS.Users, event.organizerName ? event.organizerName + ' (organizer)' : ''),
    ].filter(Boolean).join('');

    return (
      '<aside class="tma-dash__calendar-panel tma-dash__calendar-panel--view" data-calendar-panel>' + head +
      '<div class="tma-dash__calendar-panel-body tma-dash__calendar-panel-body--view">' +
      '<p class="tma-dash__calendar-detail-eyebrow">' + esc(cal ? cal.name : 'Calendar') + '</p>' +
      '<div class="tma-dash__calendar-detail-hero">' +
      renderDetailMark(eventColour(event)) +
      '<h1 class="tma-dash__calendar-detail-title' + (event.completed ? ' tma-dash__calendar-detail-title--completed' : '') + '">' +
      esc(event.title) + '</h1></div>' +
      '<p class="tma-dash__calendar-detail-when">' + esc(formatLongDate(starts)) + '</p>' +
      '<p class="tma-dash__calendar-detail-time">' +
      esc(event.allDay ? 'All day' : SCHED.formatTimeRange(decimalHour(starts), decimalHour(ends))) +
      (!event.allDay && formatDuration(minutes) ? ' · ' + esc(formatDuration(minutes)) : '') + '</p>' +
      (event.recurring
        ? '<p class="tma-dash__calendar-detail-repeat">' +
          esc(describeRule(event.recurrenceRule) || 'Repeats') + '</p>'
        : '') +
      (links ? '<ul class="tma-dash__calendar-detail-links">' + links + '</ul>' : '') +
      renderAttendees(event) +
      '</div>' +
      renderRsvp(event) +
      (event.canEdit
        ? '<div class="tma-dash__calendar-panel-footer">' +
          '<button type="button" class="tma-dash__calendar-panel-complete' +
          (event.completed ? ' tma-dash__calendar-panel-complete--done' : '') +
          '" data-calendar-complete="' + esc(event.id) + '"' + (event.completed ? ' aria-pressed="true"' : '') + '>' +
          esc(event.completed ? 'Completed' : 'Mark completed') + '</button></div>'
        : '') +
      '</aside>'
    );
  }

  /* ── attendees and RSVP ──────────────────────────────────── */

  var RESPONSE_LABELS = {
    accepted: 'Accepted',
    tentative: 'Tentative',
    declined: 'Declined',
    needs_action: 'Awaiting reply',
  };

  /*
   * The guest list. `attendees` is null until the event has been fetched with
   * them (the week query deliberately omits them), so a null list means "not
   * loaded" and an empty array means "nobody invited" — rendering them the
   * same way would flash "No guests" onto every event on open.
   */
  function renderAttendees(event) {
    if (!event.attendees) return '';
    if (!event.attendees.length) return '';

    var rows = event.attendees.map(function (a) {
      return (
        '<li class="tma-dash__calendar-attendee" data-attendee-id="' + esc(a.id) + '">' +
        '<span class="tma-dash__calendar-attendee-who">' +
        '<span class="tma-dash__calendar-attendee-name">' + esc(a.name) + '</span>' +
        (a.type === 'group' ? '<span class="tma-dash__calendar-share-meta">Group</span>' : '') +
        '</span>' +
        '<span class="tma-dash__calendar-attendee-response tma-dash__calendar-attendee-response--' +
        esc(a.response) + '">' + esc(RESPONSE_LABELS[a.response] || a.response) + '</span>' +
        (event.canEdit
          ? '<button type="button" class="tma-dash__tool-btn" data-attendee-remove="' + esc(a.id) +
            '" title="Remove guest" aria-label="Remove guest"><img src="' + ICONS.X + '" alt=""></button>'
          : '') +
        '</li>'
      );
    }).join('');

    var counts = { accepted: 0, tentative: 0, declined: 0, needs_action: 0 };
    event.attendees.forEach(function (a) { counts[a.response] = (counts[a.response] || 0) + 1; });

    return (
      '<div class="tma-dash__calendar-attendees">' +
      '<h3 class="tma-dash__calendar-group-title">Guests</h3>' +
      '<p class="tma-dash__calendar-share-meta">' +
      counts.accepted + ' accepted · ' + counts.tentative + ' tentative · ' +
      counts.declined + ' declined · ' + counts.needs_action + ' awaiting' +
      '</p>' +
      '<ul class="tma-dash__calendar-attendee-list">' + rows + '</ul>' +
      '</div>'
    );
  }

  /*
   * Accept / Tentative / Decline, shown only to someone who is actually on the
   * guest list — including via a group, which is why `myResponse` is resolved
   * server-side rather than by looking for the viewer's own row.
   */
  function renderRsvp(event) {
    if (!event.attendees || !event.myInvitation) return '';

    var current = event.myInvitation.response;

    return (
      '<div class="tma-dash__calendar-rsvp">' +
      '<span class="tma-dash__clients-form-label">Going?</span>' +
      '<div class="tma-dash__calendar-rsvp-buttons">' +
      [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']].map(function (pair) {
        return '<button type="button" class="tma-dash__calendar-rsvp-btn' +
          (current === pair[0] ? ' is-active' : '') +
          '" data-rsvp="' + esc(pair[0]) + '" data-rsvp-event="' + esc(event.id) + '">' +
          esc(pair[1]) + '</button>';
      }).join('') +
      '</div></div>'
    );
  }

  /* ── recurrence ──────────────────────────────────────────── */

  var WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  var WEEKDAY_LABELS = { MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S' };

  var REPEAT_PRESETS = [
    ['NONE', 'Does not repeat'],
    ['DAILY', 'Daily'],
    ['WEEKDAYS', 'Every weekday'],
    ['WEEKLY', 'Weekly'],
    ['MONTHLY', 'Monthly'],
    ['YEARLY', 'Yearly'],
    ['CUSTOM', 'Custom…'],
  ];

  function draftRecurrence(draft) {
    return draft.recurrence || { freq: 'NONE', interval: 1, byDay: [], count: null, until: null };
  }

  /* Which preset a stored rule corresponds to, so reopening an event shows
   * the same choice the user made rather than always falling to Custom. */
  function recurrencePreset(rec) {
    if (!rec || !rec.freq || rec.freq === 'NONE') return 'NONE';

    var days = rec.byDay || [];
    var plain = (rec.interval || 1) === 1 && !rec.count && !rec.until;

    if (rec.freq === 'WEEKLY' && days.length === 5 &&
        WEEKDAY_CODES.slice(0, 5).every(function (d) { return days.indexOf(d) !== -1; })) {
      return plain ? 'WEEKDAYS' : 'CUSTOM';
    }

    if (plain && !days.length) return rec.freq;
    return 'CUSTOM';
  }

  /* Plain-language summary. Mirrors RecurrenceRule::describe() on the server. */
  function describeRule(rule) {
    if (!rule) return '';

    var spec = parseRule(rule);
    var n = spec.interval || 1;

    var out = {
      DAILY: n > 1 ? 'Every ' + n + ' days' : 'Daily',
      WEEKLY: n > 1 ? 'Every ' + n + ' weeks' : 'Weekly',
      MONTHLY: n > 1 ? 'Every ' + n + ' months' : 'Monthly',
      YEARLY: n > 1 ? 'Every ' + n + ' years' : 'Yearly',
    }[spec.freq] || 'Repeats';

    var days = spec.byDay || [];
    if (days.length) {
      var weekdays = WEEKDAY_CODES.slice(0, 5);
      var isWeekdays = days.length === 5 && weekdays.every(function (d) { return days.indexOf(d) !== -1; });
      out += isWeekdays
        ? ' on weekdays'
        : ' on ' + days.map(function (d) {
          return { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }[d] || d;
        }).join(', ');
    }

    if (spec.count) out += ', ' + spec.count + ' times';
    else if (spec.until) {
      var until = toLocalDate(spec.until);
      if (until) out += ', until ' + formatLongDate(until);
    }

    return out;
  }

  function renderRecurrenceField(draft) {
    var rec = draftRecurrence(draft);
    var preset = recurrencePreset(rec);

    var custom = preset === 'CUSTOM'
      ? '<div class="tma-dash__calendar-recur-custom">' +

        '<div class="tma-dash__calendar-recur-row">' +
        '<span class="tma-dash__clients-form-label">Every</span>' +
        '<input type="number" min="1" max="366" class="tma-dash__clients-field-input tma-dash__calendar-recur-interval"' +
        ' data-recur-interval value="' + esc(rec.interval || 1) + '">' +
        '<select class="tma-dash__clients-field-select" data-recur-freq>' +
        [['DAILY', 'days'], ['WEEKLY', 'weeks'], ['MONTHLY', 'months'], ['YEARLY', 'years']]
          .map(function (p) {
            return '<option value="' + p[0] + '"' + (rec.freq === p[0] ? ' selected' : '') + '>' +
              esc(p[1]) + '</option>';
          }).join('') +
        '</select></div>' +

        (rec.freq === 'WEEKLY'
          ? '<div class="tma-dash__calendar-recur-days">' +
            WEEKDAY_CODES.map(function (d) {
              return '<button type="button" class="tma-dash__calendar-recur-day' +
                ((rec.byDay || []).indexOf(d) !== -1 ? ' is-active' : '') +
                '" data-recur-day="' + d + '" aria-pressed="' +
                ((rec.byDay || []).indexOf(d) !== -1 ? 'true' : 'false') +
                '" title="' + esc(d) + '">' + esc(WEEKDAY_LABELS[d]) + '</button>';
            }).join('') +
            '</div>'
          : '') +

        '<div class="tma-dash__calendar-recur-row">' +
        '<span class="tma-dash__clients-form-label">Ends</span>' +
        '<select class="tma-dash__clients-field-select" data-recur-end>' +
        [['never', 'Never'], ['count', 'After'], ['until', 'On date']].map(function (p) {
          var current = rec.count ? 'count' : (rec.until ? 'until' : 'never');
          return '<option value="' + p[0] + '"' + (current === p[0] ? ' selected' : '') + '>' +
            esc(p[1]) + '</option>';
        }).join('') +
        '</select>' +
        (rec.count
          ? '<input type="number" min="1" max="1000" class="tma-dash__clients-field-input tma-dash__calendar-recur-interval"' +
            ' data-recur-count value="' + esc(rec.count) + '"><span class="tma-dash__calendar-share-meta">times</span>'
          : '') +
        (rec.until
          ? '<input type="date" class="tma-dash__clients-field-input" data-recur-until value="' +
            esc(String(rec.until).slice(0, 10)) + '">'
          : '') +
        '</div></div>'
      : '';

    return (
      '<div class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Repeat</span>' +
      '<select class="tma-dash__clients-field-select" data-recur-preset>' +
      REPEAT_PRESETS.map(function (p) {
        return '<option value="' + p[0] + '"' + (preset === p[0] ? ' selected' : '') + '>' +
          esc(p[1]) + '</option>';
      }).join('') +
      '</select>' +
      custom +
      '</div>'
    );
  }

  /* Turn the preset choice into the recurrence spec the API takes. */
  function recurrenceFromPreset(preset, existing) {
    if (preset === 'NONE') return { freq: 'NONE', interval: 1, byDay: [], count: null, until: null };
    if (preset === 'WEEKDAYS') {
      return { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], count: null, until: null };
    }
    if (preset === 'CUSTOM') {
      // Carry whatever was already chosen into the custom editor rather than
      // resetting it, so opening Custom doesn't discard the current setting.
      return Object.assign({ freq: 'WEEKLY', interval: 1, byDay: [], count: null, until: null },
        existing && existing.freq !== 'NONE' ? existing : {});
    }
    return { freq: preset, interval: 1, byDay: [], count: null, until: null };
  }

  /*
   * Editing or deleting one instance of a series is ambiguous, so the choice
   * is asked rather than assumed. Rendered as a small overlay on the panel to
   * stay inside the calendar's own chrome.
   */
  function renderScopePrompt() {
    var prompt = state.scopePrompt;
    if (!prompt) return '';

    var verb = prompt.action === 'delete' ? 'Delete' : 'Save';

    return (
      '<div class="tma-dash__calendar-scope" role="dialog" aria-modal="true" aria-label="Which events?">' +
      '<div class="tma-dash__calendar-scope-card">' +
      '<h3 class="tma-dash__calendar-scope-title">' + esc(verb) + ' recurring event</h3>' +
      '<p class="tma-dash__calendar-share-meta">This event repeats. What should this apply to?</p>' +
      '<div class="tma-dash__calendar-scope-actions">' +
      [['this', 'This event only'], ['following', 'This and following events'], ['all', 'All events in the series']]
        .map(function (p) {
          return '<button type="button" class="tma-dash__calendar-panel-btn" data-scope-pick="' + p[0] + '">' +
            esc(p[1]) + '</button>';
        }).join('') +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-scope-cancel>Cancel</button>' +
      '</div></div></div>'
    );
  }

  /*
   * Guests on the create/edit form. Held as a draft list and sent after the
   * event exists, because an invitation needs an event to point at.
   */
  function renderGuestPicker(draft) {
    var guests = draft.guests || [];
    var panel = state.panel || {};

    var chips = guests.map(function (g) {
      return '<span class="tma-dash__calendar-guest-chip">' +
        esc(g.name) + (g.type === 'group' ? ' (group)' : '') +
        '<button type="button" class="tma-dash__calendar-guest-remove" data-invite-remove="' + esc(g.id) +
        '" aria-label="Remove ' + esc(g.name) + '">×</button></span>';
    }).join('');

    var results = '';
    if (panel.inviteQuery) {
      var people = (panel.inviteResults && panel.inviteResults.people || []).map(function (p) {
        return '<button type="button" class="tma-dash__calendar-share-result" data-invite-add-user="' + esc(p.id) +
          '" data-invite-name="' + esc(p.name) + '">' +
          '<span class="tma-dash__calendar-share-name">' + esc(p.name) + '</span>' +
          '<span class="tma-dash__calendar-share-meta">' + esc(p.email || '') + '</span></button>';
      }).join('');

      var groups = (panel.inviteResults && panel.inviteResults.groups || []).map(function (g) {
        return '<button type="button" class="tma-dash__calendar-share-result" data-invite-add-group="' + esc(g.id) +
          '" data-invite-name="' + esc(g.name) + '">' +
          '<span class="tma-dash__calendar-share-name">' + esc(g.name) + '</span>' +
          '<span class="tma-dash__calendar-share-meta">Group</span></button>';
      }).join('');

      results = (people || groups)
        ? '<div class="tma-dash__calendar-share-results">' + groups + people + '</div>'
        : '<p class="tma-dash__calendar-empty">No matches.</p>';
    }

    return (
      '<div class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Guests</span>' +
      (chips ? '<div class="tma-dash__calendar-guest-chips">' + chips + '</div>' : '') +
      '<input type="search" class="tma-dash__clients-field-input" data-invite-search' +
      ' value="' + esc(panel.inviteQuery || '') + '" placeholder="Invite staff or a group" autocomplete="off">' +
      results +
      renderAvailabilityStrip() +
      '</div>'
    );
  }

  /*
   * Free/busy for the guests picked so far. Only ever shows whether someone is
   * busy — the server withholds everything else, and this must not imply more.
   */
  function renderAvailabilityStrip() {
    var panel = state.panel || {};
    if (!panel.availability || !panel.availability.length) return '';

    var rows = panel.availability.map(function (person) {
      var label = person.status === 'unknown'
        ? 'No visibility'
        : (person.blocks.length ? 'Busy at this time' : 'Free');

      return '<li class="tma-dash__calendar-avail-row tma-dash__calendar-avail-row--' + esc(person.status) + '">' +
        '<span class="tma-dash__calendar-attendee-name">' + esc(person.name) + '</span>' +
        '<span class="tma-dash__calendar-share-meta">' + esc(label) + '</span></li>';
    }).join('');

    return (
      '<div class="tma-dash__calendar-avail">' +
      '<h3 class="tma-dash__calendar-group-title">Availability</h3>' +
      '<ul class="tma-dash__calendar-avail-list">' + rows + '</ul>' +
      (panel.suggestion
        ? '<button type="button" class="tma-dash__calendar-panel-btn" data-use-suggestion>' +
          'Use first free slot' + '</button>'
        : '') +
      '</div>'
    );
  }

  function renderTimeSelect(name, value) {
    return (
      '<select class="tma-dash__clients-field-select" data-calendar-field="' + esc(name) + '">' +
      TIME_OPTIONS.map(function (opt) {
        return '<option value="' + opt.value + '"' +
          (Math.abs(Number(value) - opt.value) < 0.001 ? ' selected' : '') + '>' +
          esc(opt.label) + '</option>';
      }).join('') +
      '</select>'
    );
  }

  function renderEventForm(draft, isEdit) {
    var targets = writableCalendars();

    /*
     * The event's own calendar must always be an option, even when the user
     * cannot normally add events to it — a contributor editing their own
     * event on a colleague's calendar would otherwise find it missing, and
     * the browser would select the first entry instead, silently moving the
     * event to a different calendar on save.
     */
    if (draft.calendarId && !targets.some(function (c) { return c.id === draft.calendarId; })) {
      var current = getCalendar(draft.calendarId);
      if (current) targets = [current].concat(targets);
    }

    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">' + esc(isEdit ? 'Edit event' : 'New event') + '</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<form class="tma-dash__calendar-form" data-calendar-form novalidate>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Title</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-calendar-field="title" value="' +
      esc(draft.title) + '" placeholder="Event title" required></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Calendar</span>' +
      '<select class="tma-dash__clients-field-select" data-calendar-field="calendarId">' +
      targets.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (draft.calendarId === c.id ? ' selected' : '') + '>' +
          esc(c.name) + '</option>';
      }).join('') +
      '</select></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Date</span>' +
      '<input type="date" class="tma-dash__clients-field-input" data-calendar-field="date" value="' +
      esc(draft.date) + '" required></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full tma-dash__calendar-form-check">' +
      '<input type="checkbox" class="tma-dash__check" data-calendar-field="allDay"' +
      (draft.allDay ? ' checked' : '') + '>' +
      '<span class="tma-dash__clients-form-label">All day</span></label>' +

      '<div class="tma-dash__clients-form-grid"' + (draft.allDay ? ' hidden' : '') + ' data-calendar-times>' +
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">Start</span>' + renderTimeSelect('start', draft.start) + '</label>' +
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">End</span>' + renderTimeSelect('end', draft.end) + '</label>' +
      '</div>' +

      '<div class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Colour</span>' +
      '<div class="tma-dash__calendar-colour-row">' +
      '<button type="button" class="tma-dash__calendar-colour-btn' + (!draft.colour ? ' is-active' : '') +
      '" data-event-colour="" title="Calendar colour" aria-label="Use the calendar’s colour">' +
      '<span class="tma-dash__calendar-swatch tma-dash__calendar-swatch--inherit" aria-hidden="true"></span></button>' +
      colours().PALETTE.map(function (c) {
        return '<button type="button" class="tma-dash__calendar-colour-btn' +
          (draft.colour === c.key ? ' is-active' : '') +
          '" data-event-colour="' + esc(c.key) + '" title="' + esc(c.label) + '" aria-label="' + esc(c.label) + '">' +
          renderColourSwatch(c.key) + '</button>';
      }).join('') +
      '</div></div>' +

      renderRecurrenceField(draft) +
      renderGuestPicker(draft) +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Location</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-calendar-field="location" value="' +
      esc(draft.location || '') + '" placeholder="Add a location"></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Notes</span>' +
      '<textarea class="tma-dash__clients-field-input tma-dash__clients-field-textarea" data-calendar-field="description" rows="4" placeholder="Add notes or agenda">' +
      esc(draft.description || '') + '</textarea></label>' +

      '</form>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-calendar-save' +
      (state.busy.save ? ' disabled' : '') + '>' +
      esc(state.busy.save ? 'Saving…' : (isEdit ? 'Save changes' : 'Create event')) + '</button>' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>' +
      '</div></aside>'
    );
  }

  function renderCalendarForm(draft, isEdit) {
    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">' + esc(isEdit ? 'Calendar settings' : 'New calendar') + '</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<form class="tma-dash__calendar-form" data-calendar-cal-form novalidate>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Name</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-cal-field="name" value="' +
      esc(draft.name) + '" placeholder="Calendar name" required></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Description</span>' +
      '<textarea class="tma-dash__clients-field-input tma-dash__clients-field-textarea" data-cal-field="description" rows="3" placeholder="What is this calendar for?">' +
      esc(draft.description || '') + '</textarea></label>' +

      '<div class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Colour</span>' +
      '<div class="tma-dash__calendar-colour-row">' +
      colours().PALETTE.map(function (c) {
        return '<button type="button" class="tma-dash__calendar-colour-btn' +
          (draft.colour === c.key ? ' is-active' : '') +
          '" data-cal-colour="' + esc(c.key) + '" title="' + esc(c.label) + '" aria-label="' + esc(c.label) + '">' +
          renderColourSwatch(c.key) + '</button>';
      }).join('') +
      '</div></div>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Type</span>' +
      '<select class="tma-dash__clients-field-select" data-cal-field="calendar_type"' +
      (draft.isSystem ? ' disabled' : '') + '>' +
      [['personal', 'Personal'], ['shared', 'Shared'], ['group', 'Group'], ['department', 'Department'],
        ['project', 'Project'], ['client', 'Client'], ['organization', 'Organization']]
        .map(function (pair) {
          return '<option value="' + pair[0] + '"' + (draft.calendar_type === pair[0] ? ' selected' : '') + '>' +
            esc(pair[1]) + '</option>';
        }).join('') +
      '</select></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Who can see it</span>' +
      '<select class="tma-dash__clients-field-select" data-cal-field="visibility"' +
      (draft.isSystem ? ' disabled' : '') + '>' +
      [['private', 'Private — only me and people I share it with'],
        ['shared', 'Shared — people I share it with'],
        ['all_staff', 'All staff can find it']]
        .map(function (pair) {
          return '<option value="' + pair[0] + '"' + (draft.visibility === pair[0] ? ' selected' : '') + '>' +
            esc(pair[1]) + '</option>';
        }).join('') +
      '</select></label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">What they can do</span>' +
      '<select class="tma-dash__clients-field-select" data-cal-field="default_role">' +
      [['availability', 'See availability only'], ['titles', 'View event titles'],
        ['details', 'View full event details'], ['contributor', 'Add events'],
        ['editor', 'Edit events'], ['manager', 'Manage sharing']]
        .map(function (pair) {
          return '<option value="' + pair[0] + '"' + (draft.default_role === pair[0] ? ' selected' : '') + '>' +
            esc(pair[1]) + '</option>';
        }).join('') +
      '</select></label>' +

      '</form>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-calendar-cal-save' +
      (state.busy.calSave ? ' disabled' : '') + '>' +
      esc(state.busy.calSave ? 'Saving…' : (isEdit ? 'Save changes' : 'Create calendar')) + '</button>' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>' +
      '</div></aside>'
    );
  }

  /* ── sharing panel ───────────────────────────────────────── */

  var ROLE_LABELS = {
    availability: 'See availability only',
    titles: 'View event titles',
    details: 'View full event details',
    contributor: 'Add events',
    editor: 'Edit and delete events',
    manager: 'Manage sharing',
    owner: 'Full administration',
  };

  function renderRoleSelect(value, attr, id) {
    return (
      '<select class="tma-dash__clients-field-select tma-dash__calendar-role-select" ' + attr + '="' + esc(id) + '">' +
      Object.keys(ROLE_LABELS).map(function (role) {
        return '<option value="' + esc(role) + '"' + (value === role ? ' selected' : '') + '>' +
          esc(ROLE_LABELS[role]) + '</option>';
      }).join('') +
      '</select>'
    );
  }

  function renderSharePanel() {
    var panel = state.panel;
    var cal = getCalendar(panel.calendarId);
    if (!cal) return '';

    var body;

    if (panel.loading) {
      body = window.TMASkeleton ? window.TMASkeleton.rows(3, { compact: true }) : '<p>Loading…</p>';
    } else if (panel.error) {
      body = '<p class="tma-dash__calendar-empty">' + esc(panel.error) + '</p>';
    } else {
      var rows = (panel.members || []).map(function (m) {
        var key = m.type === 'group' ? m.groupId : m.userId;
        return (
          '<li class="tma-dash__calendar-share-row" data-share-row="' + esc(key) + '">' +
          '<span class="tma-dash__calendar-share-who">' +
          '<span class="tma-dash__calendar-share-name">' + esc(m.name) + '</span>' +
          '<span class="tma-dash__calendar-share-meta">' +
          esc(m.type === 'group' ? 'Group' : (m.email || '')) + '</span>' +
          '</span>' +
          renderRoleSelect(m.role, m.type === 'group' ? 'data-share-group-role' : 'data-share-user-role', key) +
          '<button type="button" class="tma-dash__tool-btn" title="Remove access" aria-label="Remove access"' +
          ' ' + (m.type === 'group' ? 'data-share-group-remove' : 'data-share-user-remove') + '="' + esc(key) + '">' +
          '<img src="' + ICONS.X + '" alt=""></button>' +
          '</li>'
        );
      }).join('');

      // Search results, split into people and groups.
      var results = '';
      if (panel.query) {
        var people = (panel.results.people || []).map(function (p) {
          return '<button type="button" class="tma-dash__calendar-share-result" data-share-add-user="' + esc(p.id) + '">' +
            '<span class="tma-dash__calendar-share-name">' + esc(p.name) + '</span>' +
            '<span class="tma-dash__calendar-share-meta">' + esc(p.email || '') + '</span></button>';
        }).join('');

        var groups = (panel.results.groups || []).map(function (g) {
          return '<button type="button" class="tma-dash__calendar-share-result" data-share-add-group="' + esc(g.id) + '">' +
            '<span class="tma-dash__calendar-share-name">' + esc(g.name) + '</span>' +
            '<span class="tma-dash__calendar-share-meta">Group</span></button>';
        }).join('');

        results = (people || groups)
          ? '<div class="tma-dash__calendar-share-results">' + groups + people + '</div>'
          : '<p class="tma-dash__calendar-empty">No matches.</p>';
      }

      body =
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Add people or groups</span>' +
        '<input type="search" class="tma-dash__clients-field-input" data-share-search' +
        ' value="' + esc(panel.query || '') + '" placeholder="Search staff or groups" autocomplete="off">' +
        '</label>' +
        results +
        '<div class="tma-dash__calendar-share-level">' +
        '<span class="tma-dash__clients-form-label">New people get</span>' +
        renderRoleSelect(panel.newRole || 'details', 'data-share-new-role', 'new') +
        '</div>' +
        '<h3 class="tma-dash__calendar-group-title">Who has access</h3>' +
        '<p class="tma-dash__calendar-share-owner">' + esc(panel.owner || 'Owner') + ' · owner</p>' +
        (rows
          ? '<ul class="tma-dash__calendar-share-list">' + rows + '</ul>'
          : '<p class="tma-dash__calendar-empty">Not shared with anyone yet.</p>');
    }

    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">Share “' + esc(cal.name) + '”</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<div class="tma-dash__calendar-panel-body">' + body + '</div>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>' +
      '</div></aside>'
    );
  }

  /* ── ICS import wizard ───────────────────────────────────── */

  function renderImportPanel() {
    var panel = state.panel;
    var targets = writableCalendars();
    var body;

    if (panel.result) {
      // Step three: what actually happened.
      var r = panel.result;
      body =
        '<div class="tma-dash__calendar-import-result">' +
        '<h3 class="tma-dash__calendar-group-title">Import finished</h3>' +
        '<ul class="tma-dash__calendar-import-counts">' +
        '<li><strong>' + r.imported + '</strong> imported</li>' +
        '<li><strong>' + r.updated + '</strong> updated</li>' +
        '<li><strong>' + r.skipped + '</strong> skipped</li>' +
        '<li><strong>' + r.failed + '</strong> failed</li>' +
        '</ul>' +
        (r.errors && r.errors.length
          ? '<details class="tma-dash__calendar-import-errors"><summary>What didn’t import</summary><ul>' +
            r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') +
            '</ul></details>'
          : '') +
        '</div>';
    } else if (panel.preview) {
      // Step two: choose destination and which events.
      var rows = panel.preview.events.map(function (e) {
        var starts = toLocalDate(e.startsAt);
        return (
          '<li class="tma-dash__calendar-import-row">' +
          '<label class="tma-dash__calendar-import-check">' +
          '<input type="checkbox" class="tma-dash__check" data-import-event="' + esc(e.key) + '"' +
          (panel.excluded[e.key] ? '' : ' checked') + '>' +
          '<span class="tma-dash__calendar-attendee-who">' +
          '<span class="tma-dash__calendar-attendee-name">' + esc(e.title) + '</span>' +
          '<span class="tma-dash__calendar-share-meta">' +
          esc(starts ? formatLongDate(starts) : '') +
          (e.allDay ? ' · All day' : (starts ? ' · ' + SCHED.formatTimeLabel(decimalHour(starts)) : '')) +
          (e.recurrenceLabel ? ' · ' + esc(e.recurrenceLabel) : '') +
          '</span></span></label></li>'
        );
      }).join('');

      var chosen = panel.preview.events.length - Object.keys(panel.excluded).length;

      body =
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Import into</span>' +
        '<select class="tma-dash__clients-field-select" data-import-calendar>' +
        targets.map(function (c) {
          return '<option value="' + esc(c.id) + '"' +
            (panel.calendarId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') +
        '</select></label>' +

        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">If an event is already here</span>' +
        '<select class="tma-dash__clients-field-select" data-import-duplicate>' +
        [['skip', 'Skip it'], ['update', 'Update it']].map(function (p) {
          return '<option value="' + p[0] + '"' + (panel.onDuplicate === p[0] ? ' selected' : '') + '>' +
            esc(p[1]) + '</option>';
        }).join('') +
        '</select></label>' +

        '<p class="tma-dash__calendar-share-meta">' +
        panel.preview.summary.total + ' event' + (panel.preview.summary.total === 1 ? '' : 's') +
        ' found · ' + panel.preview.summary.recurring + ' recurring' +
        (panel.preview.summary.unreadable
          ? ' · ' + panel.preview.summary.unreadable + ' unreadable'
          : '') +
        '</p>' +

        '<div class="tma-dash__calendar-import-toolbar">' +
        '<button type="button" class="tma-dash__calendar-panel-btn" data-import-all>Select all</button>' +
        '<button type="button" class="tma-dash__calendar-panel-btn" data-import-none>Select none</button>' +
        '<span class="tma-dash__calendar-share-meta">' + chosen + ' selected</span>' +
        '</div>' +

        '<ul class="tma-dash__calendar-import-list">' + rows + '</ul>';
    } else {
      // Step one: choose a file.
      body =
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Calendar file</span>' +
        '<input type="file" accept=".ics,text/calendar" class="tma-dash__clients-field-input" data-import-file>' +
        '</label>' +
        '<p class="tma-dash__calendar-share-meta">Choose an .ics file exported from another calendar.</p>' +
        (panel.error ? '<p class="tma-dash__calendar-empty">' + esc(panel.error) + '</p>' : '');
    }

    var actions = panel.result
      ? '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-calendar-panel-close>Done</button>'
      : (panel.preview
        ? '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-import-commit' +
          (panel.busy ? ' disabled' : '') + '>' + (panel.busy ? 'Importing…' : 'Import') + '</button>' +
          '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>'
        : '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>');

    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">Import calendar</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<div class="tma-dash__calendar-panel-body">' +
      (panel.busy && !panel.preview ? '<p class="tma-dash__calendar-share-meta">Reading the file…</p>' : body) +
      '</div>' +
      '<div class="tma-dash__calendar-panel-actions">' + actions + '</div>' +
      '</aside>'
    );
  }

  function renderBrowsePanel() {
    var panel = state.panel;
    var body;

    if (panel.loading) {
      body = window.TMASkeleton ? window.TMASkeleton.rows(4, { compact: true }) : '<p>Loading…</p>';
    } else if (panel.error) {
      body = '<p class="tma-dash__calendar-empty">' + esc(panel.error) + '</p>';
    } else if (!panel.calendars.length) {
      body = '<p class="tma-dash__calendar-empty">' +
        (panel.query ? 'No calendars match that.' : 'There are no other calendars you can add.') +
        '</p>';
    } else {
      body = '<ul class="tma-dash__calendar-share-list">' +
        panel.calendars.map(function (c) {
          return '<li class="tma-dash__calendar-share-row">' +
            renderColourSwatch(c.colour) +
            '<span class="tma-dash__calendar-share-who">' +
            '<span class="tma-dash__calendar-share-name">' + esc(c.name) + '</span>' +
            '<span class="tma-dash__calendar-share-meta">' +
            esc(c.ownerName || '') + (c.ownerName ? ' · ' : '') + esc(ROLE_LABELS[c.role] || c.role) +
            '</span></span>' +
            '<button type="button" class="tma-dash__calendar-panel-btn" data-browse-add="' + esc(c.id) + '">Add</button>' +
            '</li>';
        }).join('') + '</ul>';
    }

    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">Add a calendar</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<div class="tma-dash__calendar-panel-body">' +
      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Search</span>' +
      '<input type="search" class="tma-dash__clients-field-input" data-browse-search' +
      ' value="' + esc(panel.query || '') + '" placeholder="Colleague, team or calendar name" autocomplete="off">' +
      '</label>' +
      body +
      '</div>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>' +
      '</div></aside>'
    );
  }

  function renderSubscribePanel() {
    var panel = state.panel;

    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">Subscribe to a calendar</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<div class="tma-dash__calendar-panel-body">' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Calendar URL</span>' +
      '<input type="url" class="tma-dash__clients-field-input" data-sub-url' +
      ' placeholder="https://example.com/calendar.ics" value="' + esc(panel.url || '') + '">' +
      '</label>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Name</span>' +
      '<input type="text" class="tma-dash__clients-field-input" data-sub-name' +
      ' placeholder="e.g. Public holidays" value="' + esc(panel.name || '') + '"></label>' +

      '<div class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Colour</span>' +
      '<div class="tma-dash__calendar-colour-row">' +
      colours().PALETTE.map(function (c) {
        return '<button type="button" class="tma-dash__calendar-colour-btn' +
          (panel.colour === c.key ? ' is-active' : '') +
          '" data-sub-colour="' + esc(c.key) + '" title="' + esc(c.label) + '" aria-label="' + esc(c.label) + '">' +
          renderColourSwatch(c.key) + '</button>';
      }).join('') +
      '</div></div>' +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Check for changes</span>' +
      '<select class="tma-dash__clients-field-select" data-sub-frequency>' +
      [[60, 'Every hour'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Once a day']]
        .map(function (p) {
          return '<option value="' + p[0] + '"' + (Number(panel.frequency) === p[0] ? ' selected' : '') + '>' +
            esc(p[1]) + '</option>';
        }).join('') +
      '</select></label>' +

      '<p class="tma-dash__calendar-share-meta">Subscribed calendars are read-only — changes come from the source.</p>' +
      (panel.error ? '<p class="tma-dash__calendar-empty">' + esc(panel.error) + '</p>' : '') +

      '</div>' +
      '<div class="tma-dash__calendar-panel-actions">' +
      '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-sub-save' +
      (panel.busy ? ' disabled' : '') + '>' + (panel.busy ? 'Adding…' : 'Subscribe') + '</button>' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Cancel</button>' +
      '</div></aside>'
    );
  }

  /* ── provider connect / sync / conflicts / history ───────── */

  function panelShell(title, body, actions) {
    return (
      '<aside class="tma-dash__calendar-panel" data-calendar-panel>' +
      '<div class="tma-dash__calendar-panel-head">' +
      '<h2 class="tma-dash__calendar-panel-title">' + esc(title) + '</h2>' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-calendar-panel-close aria-label="Close">' +
      '<img src="' + ICONS.X + '" alt=""></button></div>' +
      '<div class="tma-dash__calendar-panel-body">' + body + '</div>' +
      '<div class="tma-dash__calendar-panel-actions">' + actions + '</div></aside>'
    );
  }

  function renderConnectPanel() {
    var panel = state.panel;
    var body;

    if (panel.loading) {
      body = window.TMASkeleton ? window.TMASkeleton.rows(3, { compact: true }) : '<p>Loading…</p>';
    } else if (panel.error) {
      body = '<p class="tma-dash__calendar-empty">' + esc(panel.error) + '</p>';
    } else if (!panel.accounts || !panel.accounts.length) {
      // No connected Google/Microsoft account yet, or the feature is off.
      body = '<p class="tma-dash__calendar-empty">' +
        (panel.anyEnabled
          ? 'Connect a Google or Microsoft account under Settings → Security first, then come back here.'
          : 'Calendar sync isn’t switched on for this portal yet.') +
        '</p>';
    } else if (panel.account && panel.providerCalendars) {
      // Step two: pick which of the account's calendars to add.
      if (!panel.account.canWrite) {
        body = '<div class="tma-dash__calendar-sync-note">This connection can only read calendars. ' +
          'Reconnect and allow calendar access to sync changes both ways.</div>';
      } else { body = ''; }

      body += (panel.providerCalendars.length
        ? '<ul class="tma-dash__calendar-share-list">' +
          panel.providerCalendars.map(function (c) {
            return '<li class="tma-dash__calendar-share-row">' +
              '<span class="tma-dash__calendar-share-who">' +
              '<span class="tma-dash__calendar-share-name">' + esc(c.name) + '</span>' +
              '<span class="tma-dash__calendar-share-meta">' + (c.primary ? 'Primary' : '') +
              (c.canWrite ? '' : (c.primary ? ' · read-only' : 'read-only')) + '</span></span>' +
              '<button type="button" class="tma-dash__calendar-panel-btn" data-connect-calendar="' + esc(c.id) +
              '" data-connect-name="' + esc(c.name) + '">Add</button></li>';
          }).join('') + '</ul>'
        : '<p class="tma-dash__calendar-empty">Every calendar from this account is already added.</p>');
    } else {
      // Step one: choose which connected account.
      body = '<p class="tma-dash__clients-form-label">Choose an account</p>' +
        '<ul class="tma-dash__calendar-share-list">' +
        panel.accounts.map(function (a) {
          return '<li class="tma-dash__calendar-share-row">' +
            '<span class="tma-dash__calendar-share-who">' +
            '<span class="tma-dash__calendar-share-name">' + esc(a.email) + '</span>' +
            '<span class="tma-dash__calendar-share-meta">' +
            (a.provider === 'google' ? 'Google' : 'Microsoft') +
            (a.canWrite ? '' : ' · read-only') + '</span></span>' +
            (a.canRead
              ? '<button type="button" class="tma-dash__calendar-panel-btn" data-connect-account="' + esc(a.id) + '">Choose</button>'
              : '<span class="tma-dash__calendar-share-meta">Reconnect for calendar access</span>') +
            '</li>';
        }).join('') + '</ul>';
    }

    return panelShell('Connect a calendar', body,
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>');
  }

  var SYNC_STATUS_LABELS = {
    ok: 'Up to date', syncing: 'Syncing…', error: 'Sync error', disabled: 'Paused',
  };

  function renderSyncSettingsPanel() {
    var panel = state.panel;
    var cal = getCalendar(panel.calendarId);
    if (!cal || !cal.sync) return '';

    var canWrite = cal.sync.canWrite;

    var body =
      '<p class="tma-dash__calendar-share-meta">Connected to ' +
      esc(cal.sync.accountEmail || cal.sync.provider) + '</p>' +
      '<p class="tma-dash__calendar-sync-status tma-dash__calendar-sync-status--' + esc(cal.sync.status || 'ok') + '">' +
      esc(SYNC_STATUS_LABELS[cal.sync.status] || 'Up to date') +
      (cal.sync.syncedAt ? ' · last synced ' + esc(fmtWhen(cal.sync.syncedAt)) : '') + '</p>' +
      (cal.sync.error ? '<p class="tma-dash__calendar-empty">' + esc(cal.sync.error) + '</p>' : '') +

      '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
      '<span class="tma-dash__clients-form-label">Sync direction</span>' +
      '<select class="tma-dash__clients-field-select" data-sync-direction' + (canWrite ? '' : ' disabled') + '>' +
      [['two_way', 'Two-way — changes flow both ways'],
        ['import', 'Import only — changes come in, nothing goes out'],
        ['export', 'Export only — portal events go out, nothing comes in']]
        .map(function (p) {
          return '<option value="' + p[0] + '"' + (cal.sync.direction === p[0] ? ' selected' : '') + '>' +
            esc(p[1]) + '</option>';
        }).join('') +
      '</select>' +
      (canWrite ? '' : '<span class="tma-dash__calendar-share-meta">This connection is read-only, so only import is available.</span>') +
      '</label>';

    return panelShell('Sync settings', body,
      '<button type="button" class="tma-dash__calendar-panel-btn tma-dash__calendar-panel-btn--primary" data-sync-now="' + esc(cal.id) + '">Sync now</button>' +
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>');
  }

  function renderConflictsPanel() {
    var panel = state.panel;
    var body;

    if (panel.loading) {
      body = window.TMASkeleton ? window.TMASkeleton.rows(2, { compact: true }) : '<p>Loading…</p>';
    } else if (!panel.conflicts || !panel.conflicts.length) {
      body = '<p class="tma-dash__calendar-empty">No conflicts — nothing was changed in both places.</p>';
    } else {
      body = panel.conflicts.map(function (c) {
        var yours = c.yours || {};
        var cur = c.current || {};
        return (
          '<div class="tma-dash__calendar-conflict" data-conflict="' + esc(c.id) + '">' +
          '<h3 class="tma-dash__calendar-group-title">' + esc(cur.title || yours.title || 'Event') + '</h3>' +
          '<div class="tma-dash__calendar-conflict-cols">' +
          '<div class="tma-dash__calendar-conflict-col">' +
          '<p class="tma-dash__calendar-share-meta">Now (from the provider)</p>' +
          '<p class="tma-dash__calendar-attendee-name">' + esc(cur.title || '') + '</p>' +
          '<p class="tma-dash__calendar-share-meta">' + esc(conflictWhen(cur)) + '</p>' +
          '<button type="button" class="tma-dash__calendar-panel-btn" data-conflict-keep="theirs" data-conflict-id="' + esc(c.id) + '">Keep this</button>' +
          '</div>' +
          '<div class="tma-dash__calendar-conflict-col">' +
          '<p class="tma-dash__calendar-share-meta">Your version</p>' +
          '<p class="tma-dash__calendar-attendee-name">' + esc(yours.title || '') + '</p>' +
          '<p class="tma-dash__calendar-share-meta">' + esc(conflictWhen(yours)) + '</p>' +
          '<button type="button" class="tma-dash__calendar-panel-btn" data-conflict-keep="yours" data-conflict-id="' + esc(c.id) + '">Restore this</button>' +
          '</div></div></div>'
        );
      }).join('');
    }

    return panelShell('Conflicts', body,
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>');
  }

  function renderHistoryPanel() {
    var panel = state.panel;
    var body;

    if (panel.loading) {
      body = window.TMASkeleton ? window.TMASkeleton.rows(6, { compact: true }) : '<p>Loading…</p>';
    } else if (!panel.history || !panel.history.length) {
      body = '<p class="tma-dash__calendar-empty">No history yet.</p>';
    } else {
      body = '<ul class="tma-dash__calendar-history">' +
        panel.history.map(function (h) {
          return '<li class="tma-dash__calendar-history-row">' +
            '<span class="tma-dash__calendar-attendee-name">' + esc(h.label) + '</span>' +
            '<span class="tma-dash__calendar-share-meta">' + esc(fmtWhen(h.at)) + '</span></li>';
        }).join('') + '</ul>';
    }

    return panelShell('History', body,
      '<button type="button" class="tma-dash__calendar-panel-btn" data-calendar-panel-close>Done</button>');
  }

  function conflictWhen(v) {
    var s = toLocalDate(v.startsAt);
    return s ? formatLongDate(s) + ' · ' + SCHED.formatTimeLabel(decimalHour(s)) : '';
  }

  function fmtWhen(iso) {
    var d = toLocalDate(iso);
    if (!d) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return formatLongDate(d);
  }

  function renderPanel() {
    if (!state.panel) return '';

    if (state.panel.mode === 'import') return renderImportPanel();
    if (state.panel.mode === 'subscribe') return renderSubscribePanel();
    if (state.panel.mode === 'browse') return renderBrowsePanel();
    if (state.panel.mode === 'connect') return renderConnectPanel();
    if (state.panel.mode === 'sync-settings') return renderSyncSettingsPanel();
    if (state.panel.mode === 'conflicts') return renderConflictsPanel();
    if (state.panel.mode === 'history') return renderHistoryPanel();

    if (state.panel.mode === 'view') {
      var event = getEvent(state.panel.eventId);
      if (!event) return '';
      return renderPanelView(event);
    }

    if (state.panel.mode === 'share') {
      return renderSharePanel();
    }

    if (state.panel.mode === 'calendar') {
      return renderCalendarForm(state.panel.draft, !!state.panel.calendarId);
    }

    return renderEventForm(state.panel.draft, state.panel.mode === 'edit');
  }

  /* ── page ────────────────────────────────────────────────── */

  function renderViewToggle() {
    return (
      '<div class="tma-tab-group tma-tab-group--segmented tma-dash__calendar-view-tabs" role="group" aria-label="Calendar view" data-calendar-view-tabs>' +
      VIEWS.map(function (v, index) {
        return '<button type="button" class="tma-tab' + (state.view === v ? ' is-active' : '') +
          '" data-tab-index="' + index + '" data-tab-key="' + esc(v) + '">' +
          '<span class="tma-tab__label">' + esc(v.charAt(0).toUpperCase() + v.slice(1)) + '</span>' +
          '<span class="tma-tab__indicator" aria-hidden="true"></span></button>';
      }).join('') +
      '</div>'
    );
  }

  function renderPage() {
    var canAddEvent = writableCalendars().length > 0;

    return (
      '<div class="tma-dash__calendar" data-node-id="calendar-page">' +
      '<div class="tma-dash__calendar-toolbar">' +
      '<div class="tma-dash__calendar-toolbar-left">' +
      '<button type="button" class="tma-dash__tool-btn" data-calendar-sidebar-toggle' +
      ' aria-pressed="' + (state.sidebarOpen ? 'true' : 'false') + '" aria-label="Toggle calendar list">' +
      '<img src="' + ICONS.CaretDown + '" alt=""></button>' +
      renderViewToggle() +
      (state.refreshing ? '<span class="tma-dash__calendar-syncing" role="status">Syncing…</span>' : '') +
      '</div>' +
      (canAddEvent
        ? '<button type="button" class="tma-dash__clients-add-btn tma-dash__clients-add-btn--toolbar" data-calendar-new>' +
          '<img src="' + ICONS.Plus + '" alt=""> New event</button>'
        : '') +
      '</div>' +
      '<div class="tma-dash__calendar-layout' + (state.panel ? ' tma-dash__calendar-layout--panel-open' : '') +
      (state.sidebarOpen ? ' tma-dash__calendar-layout--sidebar-open' : '') + '">' +
      renderSidebar() +
      '<div class="tma-dash__calendar-main">' + renderMainView() + '</div>' +
      renderPanel() +
      '</div>' +
      renderScopePrompt() +
      '</div>'
    );
  }

  /* ── drafts ──────────────────────────────────────────────── */

  function defaultDraft(dateKey) {
    var writable = writableCalendars();
    var fallback = writable.length ? writable[0].id : null;
    return {
      title: '',
      calendarId: state.defaultCalendar || fallback,
      date: dateKey || dateKeyOf(new Date()),
      start: 9,
      end: 10,
      allDay: false,
      colour: '',
      location: '',
      description: '',
      recurrence: { freq: 'NONE', interval: 1, byDay: [], count: null, until: null },
      guests: [],
    };
  }

  function draftFromEvent(event) {
    var starts = toLocalDate(event.startsAt);
    var ends = toLocalDate(event.endsAt);
    return {
      title: event.title,
      calendarId: event.calendarId,
      date: dateKeyOf(starts),
      start: decimalHour(starts),
      end: decimalHour(ends),
      allDay: !!event.allDay,
      colour: event.colour || '',
      location: event.location || '',
      description: event.description || '',
      recurrence: parseRule(event.recurrenceRule),
      guests: [],
    };
  }

  /*
   * The server sends the RRULE string; the form works in the shape the
   * picker renders. Kept deliberately small — it only needs to understand
   * what RecurrenceRule::build() can produce.
   */
  function parseRule(rule) {
    var spec = { freq: 'NONE', interval: 1, byDay: [], count: null, until: null };
    if (!rule) return spec;

    String(rule).split(';').forEach(function (chunk) {
      var pair = chunk.split('=');
      if (pair.length !== 2) return;
      var key = pair[0].toUpperCase();
      var value = pair[1];

      if (key === 'FREQ') spec.freq = value.toUpperCase();
      else if (key === 'INTERVAL') spec.interval = Math.max(1, Number(value) || 1);
      else if (key === 'BYDAY') {
        spec.byDay = value.split(',').filter(function (d) {
          return WEEKDAY_CODES.indexOf(d.toUpperCase()) !== -1;
        }).map(function (d) { return d.toUpperCase(); });
      } else if (key === 'COUNT') spec.count = Number(value) || null;
      else if (key === 'UNTIL') {
        // Compact UNTIL (20260801T000000Z) needs separators before Date parses it.
        var m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
        spec.until = m ? m[1] + '-' + m[2] + '-' + m[3] : value;
      }
    });

    return spec;
  }

  function readEventForm(form) {
    var get = function (name) { return form.querySelector('[data-calendar-field="' + name + '"]'); };
    var allDayEl = get('allDay');
    return {
      title: (get('title') || {}).value ? get('title').value.trim() : '',
      calendarId: (get('calendarId') || {}).value || null,
      date: (get('date') || {}).value || '',
      start: Number((get('start') || {}).value || 9),
      end: Number((get('end') || {}).value || 10),
      allDay: !!(allDayEl && allDayEl.checked),
      location: (get('location') || {}).value ? get('location').value.trim() : '',
      description: (get('description') || {}).value ? get('description').value.trim() : '',
      // Held in state rather than the DOM: the swatches are buttons, not inputs.
      colour: state.panel && state.panel.draft ? state.panel.draft.colour : '',
      // Likewise the guest chips — they are not form controls.
      guests: state.panel && state.panel.draft ? (state.panel.draft.guests || []) : [],
      /*
       * And the recurrence spec, which is spread across a preset select, day
       * toggles and conditional inputs. Omitting it here silently reset every
       * save to "does not repeat".
       */
      recurrence: state.panel && state.panel.draft ? state.panel.draft.recurrence : null,
    };
  }

  function readCalendarForm(form) {
    var get = function (name) { return form.querySelector('[data-cal-field="' + name + '"]'); };
    return {
      name: (get('name') || {}).value ? get('name').value.trim() : '',
      description: (get('description') || {}).value ? get('description').value.trim() : '',
      calendar_type: (get('calendar_type') || {}).value || 'shared',
      visibility: (get('visibility') || {}).value || 'private',
      default_role: (get('default_role') || {}).value || 'details',
      colour: state.panel && state.panel.draft ? state.panel.draft.colour : 'blue',
    };
  }

  /* ── actions ─────────────────────────────────────────────── */

  function saveEvent(scope) {
    var form = state.el.querySelector('[data-calendar-form]');
    if (!form || state.busy.save) return;

    var draft = readEventForm(form);

    /*
     * Editing one instance of a series is ambiguous — this occurrence, this
     * and everything after, or all of them? Ask rather than guess. Creating
     * is never ambiguous, and neither is a plain event.
     */
    if (!scope && state.panel.mode === 'edit') {
      var editing = getEvent(state.panel.eventId);
      if (editing && (editing.isOccurrence || editing.recurring)) {
        /*
         * Showing the prompt re-renders, and a re-render writes the draft
         * back over the form. Without this the edit being confirmed would be
         * the *original* values, not the ones just typed.
         */
        syncDraftFromForm();
        state.scopePrompt = { action: 'save' };
        render();
        return;
      }
    }

    if (!draft.title) return showToast('Please enter a title', { state: 'failure' });
    if (!draft.date) return showToast('Please choose a date', { state: 'failure' });
    if (!draft.calendarId) return showToast('Please choose a calendar', { state: 'failure' });
    if (!draft.allDay && draft.end <= draft.start) {
      return showToast('End time must be after start time', { state: 'failure' });
    }

    var payload = {
      calendarId: draft.calendarId,
      title: draft.title,
      description: draft.description,
      location: draft.location,
      allDay: draft.allDay,
      colour: draft.colour || null,
      startsAt: toIso(draft.date, draft.allDay ? 0 : draft.start),
      endsAt: toIso(draft.date, draft.allDay ? 0 : draft.end),
      recurrence: draftRecurrence(draft),
    };

    if (scope) payload.scope = scope;

    var isEdit = state.panel.mode === 'edit';
    var url = isEdit ? BASE + '/events/' + encodeURIComponent(state.panel.eventId) : BASE + '/events';

    state.busy.save = true;
    render();

    net(url, { method: isEdit ? 'PATCH' : 'POST', json: payload })
      .then(function (data) {
        state.busy.save = false;
        var saved = data && data.event;
        if (!saved) throw new Error('Save failed');

        /*
         * Splice the saved event into place rather than refetching, so the
         * grid never blinks. The date may have moved out of the loaded
         * window, in which case the follow-up refresh picks it up.
         */
        upsertEvent(saved);
        state.selectedEventId = saved.id;

        var starts = toLocalDate(saved.startsAt);
        if (starts) {
          state.weekStart = SCHED.startOfWeek(starts);
          state.monthDate = startOfMonth(starts);
        }

        // Guests are invited after the event exists — an invitation needs
        // something to point at.
        var guests = draft.guests || [];
        if (guests.length) {
          inviteToEvent(saved.id, {
            userIds: guests.filter(function (g) { return g.type === 'user'; }).map(function (g) { return g.id; }),
            groupIds: guests.filter(function (g) { return g.type === 'group'; }).map(function (g) { return g.id; }),
          });
        }

        state.panel = { mode: 'view', eventId: saved.id };
        render();
        showToast(isEdit ? 'Event updated' : 'Event created');
        loadEventDetail(saved.id);
        refreshEvents();
      })
      .catch(function (err) {
        state.busy.save = false;
        render();
        showToast(errorMessage(err, 'Couldn’t save the event'), { state: 'failure' });
      });
  }

  function upsertEvent(saved) {
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === saved.id) {
        state.events[i] = saved;
        return;
      }
    }
    state.events.push(saved);
  }

  function deleteEvent(id, scope) {
    var event = getEvent(id);
    if (!event) return;

    // Same ambiguity as editing: ask which occurrences this removes.
    if (!scope && (event.isOccurrence || event.recurring)) {
      state.scopePrompt = { action: 'delete', eventId: id };
      render();
      return;
    }

    // Optimistic: drop it now, restore it if the server refuses.
    var snapshot = state.events.slice();
    state.events = state.events.filter(function (e) { return e.id !== id; });
    state.selectedEventId = null;
    state.panel = null;
    render();

    net(BASE + '/events/' + encodeURIComponent(id), {
      method: 'DELETE',
      json: scope ? { scope: scope } : undefined,
    })
      .then(function () {
        showToast('Event deleted');
        // A series change alters more than the one row that was removed.
        if (scope) refreshEvents();
      })
      .catch(function (err) {
        state.events = snapshot;
        render();
        showToast(errorMessage(err, 'Couldn’t delete the event'), { state: 'failure' });
      });
  }

  function toggleComplete(id) {
    net(BASE + '/events/' + encodeURIComponent(id) + '/complete', { method: 'POST' })
      .then(function (data) {
        if (data && data.event) {
          upsertEvent(data.event);
          render();
          showToast(data.event.completed ? 'Event completed' : 'Event marked incomplete');
        }
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t update the event'), { state: 'failure' });
      });
  }

  function setCalendarVisible(id, visible) {
    var cal = getCalendar(id);
    if (!cal) return;

    // Flip locally first so the checkbox responds instantly, then reconcile.
    cal.visible = visible;
    state.busy[id] = true;
    render();

    net(BASE + '/calendars/' + encodeURIComponent(id) + '/subscription', {
      method: 'PUT',
      json: { visible: visible },
    })
      .then(function () {
        delete state.busy[id];
        return refreshEvents();
      })
      .catch(function (err) {
        cal.visible = !visible;
        delete state.busy[id];
        render();
        showToast(errorMessage(err, 'Couldn’t change that calendar'), { state: 'failure' });
      });
  }

  function setCalendarColour(id, colour) {
    var cal = getCalendar(id);
    if (!cal) return;

    var previous = cal.colour;
    cal.colour = colour;
    state.menuFor = null;
    render();

    net(BASE + '/calendars/' + encodeURIComponent(id) + '/subscription', {
      method: 'PUT',
      json: { colour: colour },
    })
      .then(function (data) {
        if (data && data.calendar) replaceCalendar(data.calendar);
        render();
      })
      .catch(function (err) {
        cal.colour = previous;
        render();
        showToast(errorMessage(err, 'Couldn’t change the colour'), { state: 'failure' });
      });
  }

  function replaceCalendar(updated) {
    for (var i = 0; i < state.calendars.length; i++) {
      if (state.calendars[i].id === updated.id) {
        state.calendars[i] = updated;
        return;
      }
    }
    state.calendars.push(updated);
  }

  function unsubscribeCalendar(id) {
    var cal = getCalendar(id);
    if (!cal) return;

    state.menuFor = null;
    var snapshot = state.calendars.slice();
    state.calendars = state.calendars.filter(function (c) { return c.id !== id; });
    render();

    net(BASE + '/calendars/' + encodeURIComponent(id) + '/subscribe', { method: 'DELETE' })
      .then(function () {
        showToast('“' + cal.name + '” removed from your list');
        return refreshEvents();
      })
      .catch(function (err) {
        state.calendars = snapshot;
        render();
        showToast(errorMessage(err, 'Couldn’t remove that calendar'), { state: 'failure' });
      });
  }

  function deleteCalendar(id) {
    var cal = getCalendar(id);
    if (!cal) return;

    state.menuFor = null;
    render();

    net(BASE + '/calendars/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {
        showToast('“' + cal.name + '” deleted');
        return load(true);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t delete that calendar'), { state: 'failure' });
      });
  }

  function saveCalendar() {
    var form = state.el.querySelector('[data-calendar-cal-form]');
    if (!form || state.busy.calSave) return;

    var draft = readCalendarForm(form);
    if (!draft.name) return showToast('Please enter a name', { state: 'failure' });

    var isEdit = !!state.panel.calendarId;
    var url = isEdit
      ? BASE + '/calendars/' + encodeURIComponent(state.panel.calendarId)
      : BASE + '/calendars';

    state.busy.calSave = true;
    render();

    net(url, { method: isEdit ? 'PATCH' : 'POST', json: draft })
      .then(function (data) {
        state.busy.calSave = false;
        if (data && data.calendar) replaceCalendar(data.calendar);
        state.panel = null;
        render();
        showToast(isEdit ? 'Calendar updated' : 'Calendar created');
        return refreshEvents();
      })
      .catch(function (err) {
        state.busy.calSave = false;
        render();
        showToast(errorMessage(err, 'Couldn’t save the calendar'), { state: 'failure' });
      });
  }

  /* ── sharing actions ─────────────────────────────────────── */

  function openSharePanel(calendarId) {
    state.menuFor = null;
    state.panel = {
      mode: 'share',
      calendarId: calendarId,
      loading: true,
      members: [],
      results: { people: [], groups: [] },
      query: '',
      newRole: 'details',
    };
    render();

    net(BASE + '/calendars/' + encodeURIComponent(calendarId) + '/members')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'share') return;
        state.panel.loading = false;
        state.panel.members = (data && data.members) || [];
        state.panel.owner = data && data.owner && data.owner.name;
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'share') return;
        state.panel.loading = false;
        state.panel.error = errorMessage(err, 'Couldn’t load sharing.');
        render();
      });
  }

  var shareSearchTimer = null;

  function searchShareTargets(query) {
    if (shareSearchTimer) clearTimeout(shareSearchTimer);

    if (!query) {
      if (state.panel) state.panel.results = { people: [], groups: [] };
      render();
      return;
    }

    // Debounced: typing a name should not fire a request per keystroke.
    shareSearchTimer = setTimeout(function () {
      net(BASE + '/discover?q=' + encodeURIComponent(query))
        .then(function (data) {
          if (!state.panel || state.panel.mode !== 'share') return;
          state.panel.results = {
            people: (data && data.people) || [],
            groups: (data && data.groups) || [],
          };
          render();
        })
        .catch(function () { /* a failed lookup just shows nothing */ });
    }, 250);
  }

  function shareWith(payload) {
    var panel = state.panel;
    if (!panel) return;

    net(BASE + '/calendars/' + encodeURIComponent(panel.calendarId) + '/members', {
      method: 'POST',
      json: Object.assign({ role: panel.newRole || 'details' }, payload),
    })
      .then(function () {
        // Clear the search so the list, not the results, is what's on screen.
        panel.query = '';
        panel.results = { people: [], groups: [] };
        showToast('Calendar shared');
        return reloadShareMembers();
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t share the calendar'), { state: 'failure' });
      });
  }

  function reloadShareMembers() {
    var panel = state.panel;
    if (!panel || panel.mode !== 'share') return Promise.resolve();

    return net(BASE + '/calendars/' + encodeURIComponent(panel.calendarId) + '/members')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'share') return;
        state.panel.members = (data && data.members) || [];
        render();
      });
  }

  function revokeShare(kind, id) {
    var panel = state.panel;
    if (!panel) return;

    var url = BASE + '/calendars/' + encodeURIComponent(panel.calendarId) +
      (kind === 'group' ? '/group-members/' : '/members/') + encodeURIComponent(id);

    net(url, { method: 'DELETE' })
      .then(function () {
        showToast('Access removed');
        return reloadShareMembers();
      })
      .then(function () { return load(true); })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t remove access'), { state: 'failure' });
      });
  }

  /* ── attendees and RSVP actions ──────────────────────────── */

  /*
   * The week/month queries omit attendees on purpose, so opening an event
   * fetches the full record once. The list already on screen is patched with
   * it rather than replaced, so the panel doesn't blank while it loads.
   */
  function loadEventDetail(id) {
    net(BASE + '/events/' + encodeURIComponent(id))
      .then(function (data) {
        if (data && data.event) {
          upsertEvent(data.event);
          render();
        }
      })
      .catch(function () { /* the summary stays on screen */ });
  }

  function inviteToEvent(id, payload) {
    net(BASE + '/events/' + encodeURIComponent(id) + '/attendees', { method: 'POST', json: payload })
      .then(function (data) {
        if (data && data.event) {
          upsertEvent(data.event);
          render();
          showToast('Invitation sent');
        }
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t invite them'), { state: 'failure' });
      });
  }

  function removeAttendee(eventId, attendeeId) {
    net(BASE + '/events/' + encodeURIComponent(eventId) + '/attendees/' + encodeURIComponent(attendeeId), {
      method: 'DELETE',
    })
      .then(function (data) {
        if (data && data.event) {
          upsertEvent(data.event);
          render();
        }
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t remove the guest'), { state: 'failure' });
      });
  }

  function respondToEvent(eventId, response) {
    net(BASE + '/events/' + encodeURIComponent(eventId) + '/respond', {
      method: 'POST',
      json: { response: response },
    })
      .then(function (data) {
        if (data && data.event) {
          upsertEvent(data.event);
          render();
          showToast(response === 'declined' ? 'You declined' : 'Response sent');
        }
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t send your response'), { state: 'failure' });
      });
  }

  var inviteSearchTimer = null;

  function searchInviteTargets(query) {
    if (inviteSearchTimer) clearTimeout(inviteSearchTimer);

    if (!query) {
      if (state.panel) state.panel.inviteResults = { people: [], groups: [] };
      render();
      return;
    }

    inviteSearchTimer = setTimeout(function () {
      net(BASE + '/discover?q=' + encodeURIComponent(query))
        .then(function (data) {
          if (!state.panel || !state.panel.draft) return;
          state.panel.inviteResults = {
            people: (data && data.people) || [],
            groups: (data && data.groups) || [],
          };
          render();
        })
        .catch(function () { /* a failed lookup just shows nothing */ });
    }, 250);
  }

  /*
   * Pull what's currently typed in the event form back into the draft.
   *
   * Anything that re-renders the form must call this first. A re-render
   * writes the draft over every input that isn't focused, so mutating one
   * field and rendering would discard everything else the user had entered.
   *
   * Returns false when there is no form to read, so callers can bail.
   */
  function syncDraftFromForm() {
    var panel = state.panel;
    if (!panel || !panel.draft) return false;

    var form = state.el.querySelector('[data-calendar-form]');
    if (!form) return false;

    // readEventForm already carries colour, guests and recurrence across,
    // since none of those are form controls.
    panel.draft = readEventForm(form);

    return true;
  }

  /*
   * Recurrence lives in the draft, not the DOM, because the fields it renders
   * change with the choice.
   */
  function updateDraftRecurrence(mutate) {
    var panel = state.panel;
    if (!panel || !panel.draft) return;

    var current = draftRecurrence(panel.draft);
    syncDraftFromForm();

    panel.draft.recurrence = mutate(current);
    render();
  }

  /* Browse calendars the user could add to their list but hasn't. */
  function openBrowsePanel() {
    state.panel = { mode: 'browse', loading: true, query: '', calendars: [] };
    render();
    loadBrowse('');
  }

  var browseTimer = null;

  function loadBrowse(query) {
    if (browseTimer) clearTimeout(browseTimer);

    browseTimer = setTimeout(function () {
      net(BASE + '/discover?q=' + encodeURIComponent(query))
        .then(function (data) {
          if (!state.panel || state.panel.mode !== 'browse') return;
          state.panel.loading = false;
          state.panel.calendars = (data && data.calendars) || [];
          render();
        })
        .catch(function (err) {
          if (!state.panel || state.panel.mode !== 'browse') return;
          state.panel.loading = false;
          state.panel.error = errorMessage(err, 'Couldn’t load calendars.');
          render();
        });
    }, query ? 250 : 0);
  }

  function addCalendarToList(calendarId) {
    net(BASE + '/calendars/' + encodeURIComponent(calendarId) + '/subscribe', { method: 'POST' })
      .then(function () {
        showToast('Added to your calendars');
        // Drop it from the browse list — it is no longer addable.
        if (state.panel && state.panel.mode === 'browse') {
          state.panel.calendars = state.panel.calendars.filter(function (c) { return c.id !== calendarId; });
        }
        return load(true);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t add that calendar'), { state: 'failure' });
      });
  }

  function addDraftGuest(guest) {
    var panel = state.panel;
    if (!panel || !panel.draft) return;

    // Keep whatever is currently typed; re-rendering the guest list must not
    // discard a half-written title.
    syncDraftFromForm();

    panel.draft.guests = panel.draft.guests || [];
    if (!panel.draft.guests.some(function (g) { return String(g.id) === String(guest.id) && g.type === guest.type; })) {
      panel.draft.guests.push(guest);
    }

    panel.inviteQuery = '';
    panel.inviteResults = { people: [], groups: [] };
    render();
    refreshDraftAvailability();
  }

  /* Free/busy for the guests on the draft, over the slot being chosen. */
  function refreshDraftAvailability() {
    var panel = state.panel;
    if (!panel || !panel.draft) return;

    var guests = panel.draft.guests || [];
    if (!guests.length) {
      panel.availability = null;
      panel.suggestion = null;
      render();
      return;
    }

    var params = ['from=' + encodeURIComponent(toIso(panel.draft.date, 0)),
      'to=' + encodeURIComponent(toIso(panel.draft.date, 23.99)),
      'slotMinutes=' + Math.max(5, Math.round((panel.draft.end - panel.draft.start) * 60))];

    guests.forEach(function (g) {
      params.push((g.type === 'group' ? 'groupIds[]=' : 'userIds[]=') + encodeURIComponent(g.id));
    });

    net(BASE + '/availability?' + params.join('&'))
      .then(function (data) {
        if (!state.panel || !state.panel.draft) return;
        state.panel.availability = (data && data.availability) || [];
        state.panel.suggestion = data && data.suggestion;
        render();
      })
      .catch(function () { /* availability is advisory; never block the form */ });
  }

  /* ── ICS actions ─────────────────────────────────────────── */

  function exportCalendar(calendarId) {
    state.menuFor = null;
    render();
    // A plain navigation, so the browser's own download handling applies.
    window.location.href = BASE + '/ics/' + encodeURIComponent(calendarId) + '/export';
  }

  function exportEvent(eventId) {
    // A virtual occurrence has no row of its own to export; the series does.
    var seriesPart = eventId.indexOf('@') !== -1 ? eventId.split('@')[0] : eventId;
    window.location.href = BASE + '/ics/events/' + encodeURIComponent(seriesPart) + '/export';
  }

  function previewImport(file) {
    var panel = state.panel;
    if (!panel || !file) return;

    panel.busy = true;
    panel.error = null;
    render();

    var form = new FormData();
    form.append('file', file);

    net(BASE + '/ics/preview', { method: 'POST', body: form })
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'import') return;
        state.panel.busy = false;
        state.panel.preview = data;
        state.panel.file = file;
        state.panel.excluded = {};
        var writable = writableCalendars();
        state.panel.calendarId = state.defaultCalendar ||
          (writable.length ? writable[0].id : null);
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'import') return;
        state.panel.busy = false;
        state.panel.error = errorMessage(err, 'Couldn’t read that file.');
        render();
      });
  }

  function commitImport() {
    var panel = state.panel;
    if (!panel || !panel.preview || panel.busy) return;

    if (!panel.calendarId) return showToast('Choose a calendar to import into', { state: 'failure' });

    var keys = panel.preview.events
      .map(function (e) { return e.key; })
      .filter(function (k) { return !panel.excluded[k]; });

    if (!keys.length) return showToast('Select at least one event', { state: 'failure' });

    panel.busy = true;
    render();

    var form = new FormData();
    form.append('file', panel.file);
    form.append('calendarId', panel.calendarId);
    form.append('onDuplicate', panel.onDuplicate || 'skip');
    keys.forEach(function (k) { form.append('keys[]', k); });

    net(BASE + '/ics/import', { method: 'POST', body: form })
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'import') return;
        state.panel.busy = false;
        state.panel.result = data && data.result;
        render();
        return load(true);
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'import') return;
        state.panel.busy = false;
        render();
        showToast(errorMessage(err, 'Couldn’t import that file'), { state: 'failure' });
      });
  }

  function saveSubscription() {
    var panel = state.panel;
    if (!panel || panel.busy) return;

    var root = state.el;
    var url = (root.querySelector('[data-sub-url]') || {}).value || '';
    var name = (root.querySelector('[data-sub-name]') || {}).value || '';
    var frequency = (root.querySelector('[data-sub-frequency]') || {}).value;

    if (!url.trim()) return showToast('Enter a calendar URL', { state: 'failure' });
    if (!name.trim()) return showToast('Give the calendar a name', { state: 'failure' });

    panel.busy = true;
    panel.error = null;
    render();

    net(BASE + '/ics/subscribe', {
      method: 'POST',
      json: {
        url: url.trim(),
        name: name.trim(),
        colour: panel.colour || 'blue',
        frequency: Number(frequency) || 1440,
      },
    })
      .then(function () {
        state.panel = null;
        showToast('Subscribed — events will appear shortly');
        return load(true);
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'subscribe') return;
        state.panel.busy = false;
        state.panel.error = errorMessage(err, 'Couldn’t subscribe to that URL.');
        render();
      });
  }

  function refreshSubscription(calendarId) {
    state.menuFor = null;
    render();

    net(BASE + '/ics/' + encodeURIComponent(calendarId) + '/refresh', { method: 'POST' })
      .then(function () {
        showToast('Refreshing in the background');
        // Give the worker a moment, then pick up whatever landed.
        setTimeout(function () { load(true); }, 2500);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t refresh that calendar'), { state: 'failure' });
      });
  }

  function toggleSubscription(calendarId, enable) {
    state.menuFor = null;
    render();

    net(BASE + '/ics/' + encodeURIComponent(calendarId) + '/enabled', {
      method: 'PUT',
      json: { enabled: enable },
    })
      .then(function () {
        showToast(enable ? 'Syncing resumed' : 'Syncing paused');
        return load(true);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t change that subscription'), { state: 'failure' });
      });
  }

  /* ── provider sync actions ───────────────────────────────── */

  function openConnectPanel() {
    state.addMenuOpen = false;
    state.panel = { mode: 'connect', loading: true, accounts: [] };
    render();

    net(BASE + '/sync/accounts')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'connect') return;
        state.panel.loading = false;
        state.panel.accounts = (data && data.accounts) || [];
        state.panel.anyEnabled = !!(data && (data.googleEnabled || data.microsoftEnabled));
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'connect') return;
        state.panel.loading = false;
        state.panel.error = errorMessage(err, 'Couldn’t load your connected accounts.');
        render();
      });
  }

  function chooseConnectAccount(accountId) {
    var panel = state.panel;
    if (!panel) return;
    panel.account = (panel.accounts || []).filter(function (a) { return String(a.id) === String(accountId); })[0];
    panel.loading = true;
    render();

    net(BASE + '/sync/accounts/' + encodeURIComponent(accountId) + '/calendars')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'connect') return;
        state.panel.loading = false;
        state.panel.providerCalendars = (data && data.calendars) || [];
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'connect') return;
        state.panel.loading = false;
        state.panel.error = errorMessage(err, 'Couldn’t list that account’s calendars.');
        render();
      });
  }

  function connectProviderCalendar(externalId, name) {
    var panel = state.panel;
    if (!panel || !panel.account) return;

    net(BASE + '/sync/accounts/' + encodeURIComponent(panel.account.id) + '/connect', {
      method: 'POST',
      json: { externalId: externalId, name: name, direction: panel.account.canWrite ? 'two_way' : 'import' },
    })
      .then(function () {
        state.panel = null;
        showToast('Calendar connected — events will appear shortly');
        return load(true);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t connect that calendar'), { state: 'failure' });
      });
  }

  function openSyncSettings(calendarId) {
    state.menuFor = null;
    state.panel = { mode: 'sync-settings', calendarId: calendarId };
    render();
  }

  function setSyncDirection(calendarId, direction) {
    net(BASE + '/sync/' + encodeURIComponent(calendarId), { method: 'PUT', json: { direction: direction } })
      .then(function (data) {
        if (data && data.calendar) replaceCalendar(data.calendar);
        render();
        showToast('Sync direction updated');
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t change the direction'), { state: 'failure' });
      });
  }

  function syncNow(calendarId) {
    state.menuFor = null;
    render();

    net(BASE + '/sync/' + encodeURIComponent(calendarId) + '/run', { method: 'POST' })
      .then(function () {
        showToast('Syncing in the background');
        setTimeout(function () { load(true); }, 3000);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t start the sync'), { state: 'failure' });
      });
  }

  function disconnectCalendar(calendarId) {
    var cal = getCalendar(calendarId);
    if (!cal) return;
    state.menuFor = null;

    // Keeping the events (purge=false) is the safe default; the confirm makes
    // the choice explicit.
    var purge = !window.confirm(
      'Disconnect “' + cal.name + '”?\n\nOK keeps the events already synced as a normal calendar.\n' +
      'Cancel to keep it connected.'
    );
    // confirm() returned false → user cancelled entirely.
    if (purge && !window.confirm('Keep the events already synced in? OK to keep, Cancel to delete them too.')) {
      // They chose to delete the events as well.
      return doDisconnect(calendarId, true);
    }
    if (purge) return; // cancelled

    doDisconnect(calendarId, false);
  }

  function doDisconnect(calendarId, purge) {
    net(BASE + '/sync/' + encodeURIComponent(calendarId) + (purge ? '?purge=1' : ''), { method: 'DELETE' })
      .then(function () {
        showToast('Calendar disconnected');
        return load(true);
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t disconnect that calendar'), { state: 'failure' });
      });
  }

  function openConflicts(calendarId) {
    state.menuFor = null;
    state.panel = { mode: 'conflicts', calendarId: calendarId, loading: true, conflicts: [] };
    render();

    net(BASE + '/sync/' + encodeURIComponent(calendarId) + '/conflicts')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'conflicts') return;
        state.panel.loading = false;
        state.panel.conflicts = (data && data.conflicts) || [];
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'conflicts') return;
        state.panel.loading = false;
        state.panel.error = errorMessage(err, 'Couldn’t load conflicts.');
        render();
      });
  }

  function resolveConflict(eventId, keep) {
    net(BASE + '/events/' + encodeURIComponent(eventId) + '/resolve-conflict', {
      method: 'POST',
      json: { keep: keep },
    })
      .then(function () {
        if (state.panel && state.panel.mode === 'conflicts') {
          state.panel.conflicts = state.panel.conflicts.filter(function (c) { return c.id !== eventId; });
          render();
        }
        showToast(keep === 'yours' ? 'Your version restored' : 'Kept the synced version');
        refreshEvents();
      })
      .catch(function (err) {
        showToast(errorMessage(err, 'Couldn’t resolve that conflict'), { state: 'failure' });
      });
  }

  function openHistory(calendarId) {
    state.menuFor = null;
    state.panel = { mode: 'history', calendarId: calendarId, loading: true, history: [] };
    render();

    net(BASE + '/calendars/' + encodeURIComponent(calendarId) + '/history')
      .then(function (data) {
        if (!state.panel || state.panel.mode !== 'history') return;
        state.panel.loading = false;
        state.panel.history = (data && data.history) || [];
        render();
      })
      .catch(function (err) {
        if (!state.panel || state.panel.mode !== 'history') return;
        state.panel.loading = false;
        state.panel.error = errorMessage(err, 'Couldn’t load history.');
        render();
      });
  }

  function savePreference(key, value) {
    var payload = {};
    payload[key] = value;
    // Best-effort: chrome preferences must never block the page.
    net(ROOT + '/me/preferences', { method: 'PUT', json: payload }).catch(function () {});
  }

  function setView(view) {
    if (VIEWS.indexOf(view) === -1 || view === state.view) return;
    state.view = view;
    if (view === 'month') state.monthDate = startOfMonth(state.weekStart);
    savePreference('calendarView', view);
    render();
    refreshEvents();
  }

  /* ── wiring ──────────────────────────────────────────────── */

  function wire() {
    var root = state.el;
    var M = morph();

    /*
     * The tab group initialises itself once per element. Re-running init on
     * every render would stack its internal listeners on the same node, since
     * morph preserves it across patches.
     */
    var freshTabs = M.unwiredOne(root, '[data-calendar-view-tabs]', 'init');
    if (freshTabs && window.PortalTabGroup && window.PortalTabGroup.init) {
      window.PortalTabGroup.init(root);
    }

    var tabs = root.querySelector('[data-calendar-view-tabs]');
    if (tabs) {
      M.on(tabs, 'tma-tab-change', function (e) {
        setView(e.detail && e.detail.key);
      });
    }

    M.unwired(root, '[data-calendar-sidebar-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sidebarOpen = !state.sidebarOpen;
        savePreference('calendarSidebarOpen', state.sidebarOpen);
        render();
      });
    });

    M.unwired(root, '[data-calendar-retry]').forEach(function (btn) {
      btn.addEventListener('click', function () { load(false); });
    });

    M.unwired(root, '[data-calendar-new]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.panel = { mode: 'create', draft: defaultDraft(dateKeyOf(new Date())) };
        state.selectedEventId = null;
        render();
      });
    });

    /* Add menu: new / browse / import / subscribe. */

    M.unwired(root, '[data-calendar-add-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.addMenuOpen = !state.addMenuOpen;
        render();
      });
    });

    M.unwired(root, '[data-calendar-import]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.addMenuOpen = false;
        state.panel = { mode: 'import', excluded: {}, onDuplicate: 'skip' };
        render();
      });
    });

    M.unwired(root, '[data-calendar-connect]').forEach(function (btn) {
      btn.addEventListener('click', openConnectPanel);
    });

    /* Provider connect flow. */

    M.unwired(root, '[data-connect-account]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        chooseConnectAccount(btn.getAttribute('data-connect-account'));
      });
    });

    M.unwired(root, '[data-connect-calendar]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        connectProviderCalendar(btn.getAttribute('data-connect-calendar'), btn.getAttribute('data-connect-name'));
      });
    });

    /* Provider sync controls. */

    M.unwired(root, '[data-calendar-sync-now], [data-sync-now]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        syncNow(btn.getAttribute('data-calendar-sync-now') || btn.getAttribute('data-sync-now'));
      });
    });

    M.unwired(root, '[data-calendar-sync-settings]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openSyncSettings(btn.getAttribute('data-calendar-sync-settings'));
      });
    });

    M.unwired(root, '[data-sync-direction]').forEach(function (select) {
      select.addEventListener('change', function () {
        if (state.panel) setSyncDirection(state.panel.calendarId, select.value);
      });
    });

    M.unwired(root, '[data-calendar-disconnect]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        disconnectCalendar(btn.getAttribute('data-calendar-disconnect'));
      });
    });

    M.unwired(root, '[data-calendar-conflicts]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openConflicts(btn.getAttribute('data-calendar-conflicts'));
      });
    });

    M.unwired(root, '[data-conflict-keep]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        resolveConflict(btn.getAttribute('data-conflict-id'), btn.getAttribute('data-conflict-keep'));
      });
    });

    M.unwired(root, '[data-calendar-history]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openHistory(btn.getAttribute('data-calendar-history'));
      });
    });

    M.unwired(root, '[data-calendar-subscribe]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.addMenuOpen = false;
        state.panel = { mode: 'subscribe', colour: 'blue', frequency: 1440 };
        render();
      });
    });

    M.unwired(root, '[data-calendar-browse]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.addMenuOpen = false;
        // Reuses the share panel's search, pointed at "add to my list".
        openBrowsePanel();
      });
    });

    /* Import wizard. */

    M.unwired(root, '[data-import-file]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) previewImport(input.files[0]);
      });
    });

    M.unwired(root, '[data-import-calendar]').forEach(function (select) {
      select.addEventListener('change', function () {
        if (state.panel) state.panel.calendarId = select.value;
      });
    });

    M.unwired(root, '[data-import-duplicate]').forEach(function (select) {
      select.addEventListener('change', function () {
        if (state.panel) state.panel.onDuplicate = select.value;
      });
    });

    M.unwired(root, '[data-import-event]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!state.panel) return;
        var key = input.getAttribute('data-import-event');
        if (input.checked) delete state.panel.excluded[key];
        else state.panel.excluded[key] = true;
        render();
      });
    });

    M.unwired(root, '[data-import-all]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.panel) return;
        state.panel.excluded = {};
        render();
      });
    });

    M.unwired(root, '[data-import-none]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.panel || !state.panel.preview) return;
        state.panel.excluded = {};
        state.panel.preview.events.forEach(function (e) { state.panel.excluded[e.key] = true; });
        render();
      });
    });

    M.unwired(root, '[data-import-commit]').forEach(function (btn) {
      btn.addEventListener('click', commitImport);
    });

    /* Subscribe. */

    M.unwired(root, '[data-sub-save]').forEach(function (btn) {
      btn.addEventListener('click', saveSubscription);
    });

    M.unwired(root, '[data-sub-colour]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.panel) return;
        // Keep what's typed; only the colour changes.
        state.panel.url = (root.querySelector('[data-sub-url]') || {}).value || '';
        state.panel.name = (root.querySelector('[data-sub-name]') || {}).value || '';
        state.panel.colour = btn.getAttribute('data-sub-colour');
        render();
      });
    });

    /* Export and subscription controls. */

    M.unwired(root, '[data-calendar-export]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        exportCalendar(btn.getAttribute('data-calendar-export'));
      });
    });

    M.unwired(root, '[data-calendar-refresh]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        refreshSubscription(btn.getAttribute('data-calendar-refresh'));
      });
    });

    M.unwired(root, '[data-calendar-sub-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleSubscription(
          btn.getAttribute('data-calendar-sub-toggle'),
          btn.getAttribute('data-enabled') === '1',
        );
      });
    });

    M.unwired(root, '[data-event-export]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        exportEvent(btn.getAttribute('data-event-export'));
      });
    });

    /* Recurrence controls. */

    M.unwired(root, '[data-recur-preset]').forEach(function (select) {
      select.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          return recurrenceFromPreset(select.value, rec);
        });
      });
    });

    M.unwired(root, '[data-recur-freq]').forEach(function (select) {
      select.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          // Leaving weekly makes per-day selection meaningless.
          return Object.assign({}, rec, {
            freq: select.value,
            byDay: select.value === 'WEEKLY' ? rec.byDay : [],
          });
        });
      });
    });

    M.unwired(root, '[data-recur-interval]').forEach(function (input) {
      input.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          return Object.assign({}, rec, { interval: Math.max(1, Number(input.value) || 1) });
        });
      });
    });

    M.unwired(root, '[data-recur-day]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var day = btn.getAttribute('data-recur-day');
        updateDraftRecurrence(function (rec) {
          var days = (rec.byDay || []).slice();
          var at = days.indexOf(day);
          if (at === -1) days.push(day); else days.splice(at, 1);
          // Keep them in week order regardless of click order.
          days.sort(function (a, b) { return WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b); });
          return Object.assign({}, rec, { byDay: days });
        });
      });
    });

    M.unwired(root, '[data-recur-end]').forEach(function (select) {
      select.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          // COUNT and UNTIL are mutually exclusive; only one survives.
          if (select.value === 'count') {
            return Object.assign({}, rec, { count: rec.count || 10, until: null });
          }
          if (select.value === 'until') {
            var when = state.panel && state.panel.draft ? state.panel.draft.date : null;
            return Object.assign({}, rec, { count: null, until: when });
          }
          return Object.assign({}, rec, { count: null, until: null });
        });
      });
    });

    M.unwired(root, '[data-recur-count]').forEach(function (input) {
      input.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          return Object.assign({}, rec, { count: Math.max(1, Number(input.value) || 1), until: null });
        });
      });
    });

    M.unwired(root, '[data-recur-until]').forEach(function (input) {
      input.addEventListener('change', function () {
        updateDraftRecurrence(function (rec) {
          return Object.assign({}, rec, { until: input.value || null, count: null });
        });
      });
    });

    /* Which part of a series an edit or delete applies to. */

    M.unwired(root, '[data-scope-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var prompt = state.scopePrompt;
        if (!prompt) return;
        var scope = btn.getAttribute('data-scope-pick');
        state.scopePrompt = null;
        render();
        if (prompt.action === 'delete') deleteEvent(prompt.eventId, scope);
        else saveEvent(scope);
      });
    });

    M.unwired(root, '[data-scope-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.scopePrompt = null;
        render();
      });
    });

    M.unwired(root, '[data-calendar-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.addMenuOpen = false;
        state.panel = {
          mode: 'calendar',
          calendarId: null,
          draft: {
            name: '', description: '', colour: 'blue',
            calendar_type: 'shared', visibility: 'private', default_role: 'details',
          },
        };
        render();
      });
    });

    M.unwired(root, '[data-calendar-panel-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.panel = null;
        render();
      });
    });

    /* Sidebar: show/hide, actions menu, colours, removal. */

    M.unwired(root, '[data-calendar-toggle]').forEach(function (input) {
      input.addEventListener('change', function () {
        setCalendarVisible(input.getAttribute('data-calendar-toggle'), input.checked);
      });
    });

    M.unwired(root, '[data-calendar-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-calendar-menu');
        state.menuFor = state.menuFor === id ? null : id;
        render();
      });
    });

    M.unwired(root, '[data-calendar-colour]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setCalendarColour(btn.getAttribute('data-calendar-colour'), btn.getAttribute('data-colour'));
      });
    });

    M.unwired(root, '[data-calendar-unsubscribe]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        unsubscribeCalendar(btn.getAttribute('data-calendar-unsubscribe'));
      });
    });

    M.unwired(root, '[data-calendar-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-delete');
        var cal = getCalendar(id);
        if (!cal) return;
        if (!window.confirm('Delete “' + cal.name + '” and all of its events?')) return;
        deleteCalendar(id);
      });
    });

    M.unwired(root, '[data-calendar-edit-cal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cal = getCalendar(btn.getAttribute('data-calendar-edit-cal'));
        if (!cal) return;
        state.menuFor = null;
        state.panel = {
          mode: 'calendar',
          calendarId: cal.id,
          draft: {
            name: cal.name,
            description: cal.description || '',
            colour: cal.officialColour || cal.colour,
            calendar_type: cal.type,
            visibility: cal.visibility,
            default_role: cal.role === 'owner' ? 'details' : cal.role,
            isSystem: cal.isSystem,
          },
        };
        render();
      });
    });

    /* Event interactions. */

    M.unwired(root, '[data-calendar-event]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calendar-event');
        state.selectedEventId = id;
        state.panel = { mode: 'view', eventId: id };
        render();
        loadEventDetail(id);
      });
    });

    /* Sharing. */

    M.unwired(root, '[data-calendar-share]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openSharePanel(btn.getAttribute('data-calendar-share'));
      });
    });

    M.unwired(root, '[data-share-search]').forEach(function (input) {
      input.addEventListener('input', function () {
        if (!state.panel) return;
        state.panel.query = input.value.trim();
        searchShareTargets(state.panel.query);
      });
    });

    M.unwired(root, '[data-share-new-role]').forEach(function (select) {
      select.addEventListener('change', function () {
        if (state.panel) state.panel.newRole = select.value;
      });
    });

    M.unwired(root, '[data-share-add-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        shareWith({ userId: Number(btn.getAttribute('data-share-add-user')) });
      });
    });

    M.unwired(root, '[data-share-add-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        shareWith({ groupId: btn.getAttribute('data-share-add-group') });
      });
    });

    // Changing an existing level is the same call as sharing — the server
    // updates the grant rather than stacking a second one.
    M.unwired(root, '[data-share-user-role]').forEach(function (select) {
      select.addEventListener('change', function () {
        var previousRole = state.panel && state.panel.newRole;
        if (state.panel) state.panel.newRole = select.value;
        shareWith({ userId: Number(select.getAttribute('data-share-user-role')) });
        if (state.panel) state.panel.newRole = previousRole;
      });
    });

    M.unwired(root, '[data-share-group-role]').forEach(function (select) {
      select.addEventListener('change', function () {
        var previousRole = state.panel && state.panel.newRole;
        if (state.panel) state.panel.newRole = select.value;
        shareWith({ groupId: select.getAttribute('data-share-group-role') });
        if (state.panel) state.panel.newRole = previousRole;
      });
    });

    M.unwired(root, '[data-share-user-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        revokeShare('user', btn.getAttribute('data-share-user-remove'));
      });
    });

    M.unwired(root, '[data-share-group-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        revokeShare('group', btn.getAttribute('data-share-group-remove'));
      });
    });

    /* Guests and RSVP. */

    M.unwired(root, '[data-attendee-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.panel || !state.panel.eventId) return;
        removeAttendee(state.panel.eventId, btn.getAttribute('data-attendee-remove'));
      });
    });

    M.unwired(root, '[data-rsvp]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        respondToEvent(btn.getAttribute('data-rsvp-event'), btn.getAttribute('data-rsvp'));
      });
    });

    M.unwired(root, '[data-invite-search]').forEach(function (input) {
      input.addEventListener('input', function () {
        if (!state.panel) return;
        state.panel.inviteQuery = input.value.trim();
        searchInviteTargets(state.panel.inviteQuery);
      });
    });

    M.unwired(root, '[data-invite-add-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addDraftGuest({ type: 'user', id: Number(btn.getAttribute('data-invite-add-user')),
          name: btn.getAttribute('data-invite-name') });
      });
    });

    M.unwired(root, '[data-invite-add-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addDraftGuest({ type: 'group', id: btn.getAttribute('data-invite-add-group'),
          name: btn.getAttribute('data-invite-name') });
      });
    });

    M.unwired(root, '[data-invite-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-invite-remove');
        if (!state.panel || !state.panel.draft) return;
        state.panel.draft.guests = (state.panel.draft.guests || []).filter(function (g) {
          return String(g.id) !== key;
        });
        render();
        refreshDraftAvailability();
      });
    });

    M.unwired(root, '[data-use-suggestion]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = state.panel;
        if (!panel || !panel.suggestion || !panel.draft) return;

        var starts = toLocalDate(panel.suggestion.startsAt);
        var ends = toLocalDate(panel.suggestion.endsAt);
        if (!starts || !ends) return;

        syncDraftFromForm();

        panel.draft.date = dateKeyOf(starts);
        panel.draft.start = decimalHour(starts);
        panel.draft.end = decimalHour(ends);
        render();
        refreshDraftAvailability();
      });
    });

    /*
     * Changing the slot re-checks who is free in it.
     *
     * These go through syncDraftFromForm() rather than poking one field,
     * because refreshDraftAvailability() re-renders — and a re-render writes
     * the draft back over every input that isn't focused. Setting only `date`
     * meant changing the date silently wiped the title the user had just
     * typed, which then failed validation on save with no obvious cause.
     */
    M.unwired(root, '[data-calendar-field="date"]', 'avail').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!syncDraftFromForm()) return;
        state.panel.draft.date = input.value;
        refreshDraftAvailability();
      });
    });

    ['start', 'end'].forEach(function (field) {
      M.unwired(root, '[data-calendar-field="' + field + '"]', 'avail').forEach(function (select) {
        select.addEventListener('change', function () {
          if (!syncDraftFromForm()) return;
          state.panel.draft[field] = Number(select.value);
          refreshDraftAvailability();
        });
      });
    });

    M.unwired(root, '[data-calendar-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var event = getEvent(btn.getAttribute('data-calendar-edit'));
        if (!event) return;
        state.panel = { mode: 'edit', eventId: event.id, draft: draftFromEvent(event) };
        render();
      });
    });

    M.unwired(root, '[data-calendar-delete-event]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteEvent(btn.getAttribute('data-calendar-delete-event'));
      });
    });

    M.unwired(root, '[data-calendar-complete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleComplete(btn.getAttribute('data-calendar-complete'));
      });
    });

    M.unwired(root, '[data-calendar-save]').forEach(function (btn) {
      // No argument: saveEvent decides whether the scope prompt is needed.
      btn.addEventListener('click', function () { saveEvent(); });
    });

    M.unwired(root, '[data-browse-search]').forEach(function (input) {
      input.addEventListener('input', function () {
        if (!state.panel) return;
        state.panel.query = input.value.trim();
        loadBrowse(state.panel.query);
      });
    });

    M.unwired(root, '[data-browse-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addCalendarToList(btn.getAttribute('data-browse-add'));
      });
    });

    M.unwired(root, '[data-calendar-cal-save]').forEach(function (btn) {
      btn.addEventListener('click', saveCalendar);
    });

    /*
     * Colour choices live in state, not the DOM, so the form can re-render
     * (for the busy state) without losing an unsaved pick.
     */
    M.unwired(root, '[data-event-colour]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!syncDraftFromForm()) return;
        state.panel.draft.colour = btn.getAttribute('data-event-colour');
        render();
      });
    });

    M.unwired(root, '[data-cal-colour]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.panel || !state.panel.draft) return;
        state.panel.draft = Object.assign(readCalendarForm(root.querySelector('[data-calendar-cal-form]')), {
          colour: btn.getAttribute('data-cal-colour'),
          isSystem: state.panel.draft.isSystem,
        });
        render();
      });
    });

    // All-day hides the time selects without discarding what's in them.
    M.unwired(root, '[data-calendar-field="allDay"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var times = root.querySelector('[data-calendar-times]');
        if (times) times.hidden = input.checked;
      });
    });

    /* Month grid. */

    M.unwired(root, '[data-calendar-month-prev]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.monthDate = addMonths(state.monthDate, -1);
        render();
        refreshEvents();
      });
    });

    M.unwired(root, '[data-calendar-month-next]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.monthDate = addMonths(state.monthDate, 1);
        render();
        refreshEvents();
      });
    });

    M.unwired(root, '[data-calendar-month-today]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.monthDate = startOfMonth(new Date());
        state.weekStart = SCHED.startOfWeek(new Date());
        render();
        refreshEvents();
      });
    });

    M.unwired(root, '[data-calendar-day]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-calendar-day');
        var parts = key.split('-');
        state.weekStart = SCHED.startOfWeek(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        setView('week');
      });
    });

    M.unwired(root, '[data-calendar-day]', 'dbl').forEach(function (btn) {
      btn.addEventListener('dblclick', function (e) {
        e.preventDefault();
        if (!writableCalendars().length) return;
        state.panel = { mode: 'create', draft: defaultDraft(btn.getAttribute('data-calendar-day')) };
        state.selectedEventId = null;
        render();
      });
    });

    /* Agenda nav. */

    M.unwired(root, '[data-calendar-agenda-prev]').forEach(function (btn) {
      btn.addEventListener('click', function () { stepWeek(-7); });
    });
    M.unwired(root, '[data-calendar-agenda-next]').forEach(function (btn) {
      btn.addEventListener('click', function () { stepWeek(7); });
    });
    M.unwired(root, '[data-calendar-agenda-today]').forEach(function (btn) {
      btn.addEventListener('click', function () { goToday(); });
    });

    /* Week grid, via the shared schedule widget. */

    /*
     * Wired here rather than through SCHED.wire(): that helper binds with a
     * bare addEventListener walk, which was safe under innerHTML but would
     * stack handlers on every node morph preserves.
     */
    var scheduleRoot = root.querySelector('[data-schedule-root]');
    if (scheduleRoot) {
      var prev = M.unwiredOne(scheduleRoot, '[data-schedule-prev]');
      var next = M.unwiredOne(scheduleRoot, '[data-schedule-next]');
      var today = M.unwiredOne(scheduleRoot, '[data-schedule-today]');

      if (prev) prev.addEventListener('click', function () { stepWeek(-7); });
      if (next) next.addEventListener('click', function () { stepWeek(7); });
      if (today) today.addEventListener('click', goToday);

      M.unwired(scheduleRoot, '[data-schedule-event]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-schedule-event');
          state.selectedEventId = id;
          state.panel = { mode: 'view', eventId: id };
          render();
        });
      });
    }

    /* An outside click closes any open menu. */
    if (!wire.documentBound) {
      wire.documentBound = true;
      document.addEventListener('click', function (e) {
        var inside = e.target.closest && e.target.closest(
          '[data-calendar-menu-panel], [data-calendar-menu],' +
          '[data-calendar-add-panel], [data-calendar-add-menu]'
        );
        if (inside) return;
        if (!state.menuFor && !state.addMenuOpen) return;
        state.menuFor = null;
        state.addMenuOpen = false;
        render();
      });
    }
  }

  function stepWeek(days) {
    state.weekStart = SCHED.addDays(state.weekStart, days);
    state.monthDate = startOfMonth(state.weekStart);
    render();
    refreshEvents();
  }

  function goToday() {
    state.weekStart = SCHED.startOfWeek(new Date());
    state.monthDate = startOfMonth(new Date());
    render();
    refreshEvents();
  }

  /* ── mount ───────────────────────────────────────────────── */

  function mount(root) {
    if (!root || !SCHED) return;

    state.el = root;
    state.weekStart = SCHED.startOfWeek(new Date());
    state.monthDate = startOfMonth(new Date());

    load(false);
  }

  /* ── today's event count (nav + home shortcut badges) ─────── */

  /*
   * The shell's badge helpers (dashboard.js, portal-home.js) call this
   * synchronously while painting nav, long before — or entirely without —
   * the calendar page being mounted. It therefore answers from a cache and
   * refreshes it in the background: the badge is absent on the very first
   * paint and correct from then on, rather than showing a made-up number.
   */
  var todayCount = { value: 0, fetchedAt: 0, inFlight: false };
  var COUNT_TTL_MS = 60000;

  function refreshTodayCount() {
    if (todayCount.inFlight) return;
    if (Date.now() - todayCount.fetchedAt < COUNT_TTL_MS) return;

    todayCount.inFlight = true;

    var start = new Date();
    start.setHours(0, 0, 0, 0);
    var end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);

    var url = BASE + '/events?from=' + encodeURIComponent(start.toISOString()) +
      '&to=' + encodeURIComponent(end.toISOString());

    net(url)
      .then(function (data) {
        todayCount.value = ((data && data.events) || []).length;
        todayCount.fetchedAt = Date.now();
        todayCount.inFlight = false;
        // Let the shell repaint its badge now that a real number exists.
        document.dispatchEvent(new CustomEvent('tma-calendar-count', {
          detail: { count: todayCount.value },
        }));
      })
      .catch(function () {
        todayCount.inFlight = false;
        todayCount.fetchedAt = Date.now();
      });
  }

  function getTodayEventCount() {
    refreshTodayCount();
    return todayCount.value;
  }

  /* Recount from events the page already holds, avoiding a second request. */
  function primeTodayCount(events) {
    var todayKey = dateKeyOf(new Date());
    var count = 0;

    events.forEach(function (event) {
      var d = toLocalDate(event.startsAt);
      if (d && dateKeyOf(d) === todayKey) count++;
    });

    todayCount.value = count;
    todayCount.fetchedAt = Date.now();
    document.dispatchEvent(new CustomEvent('tma-calendar-count', { detail: { count: count } }));
  }

  window.TMACalendar = {
    mount: mount,
    getTodayEventCount: getTodayEventCount,
  };
})();
