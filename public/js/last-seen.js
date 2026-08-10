/*
 * TMA - "Last seen" phrasing, in the browser.
 * Global: window.TMALastSeen
 *
 * The mirror of App\Support\Presence\LastSeen. The server formats a label at
 * the moment it answers; this re-derives the same sentence from the ISO
 * timestamp beside it, so a board that polls every 30 seconds — or does not
 * poll at all while somebody reads it — never shows "5 minutes ago" twenty
 * minutes later.
 *
 * Keep the two in step. If one grows a case the other doesn't have, the same
 * person reads two different answers depending on which surface they are on.
 *
 * Times render on the reader's wall clock. i18n.js patches Date/Intl to the
 * time zone chosen in Settings, so plain Date formatting here is already in
 * the right zone — do not reach for a second one.
 */
(function () {
  'use strict';

  /* Beyond this a weekday name stops being a useful anchor. */
  var RECENT_DAYS = 7;
  var MINUTE = 60000;
  var HOUR = 3600000;

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function isYesterday(when, now) {
    var y = new Date(now.getTime());
    y.setDate(y.getDate() - 1);
    return sameDay(when, y);
  }

  function plural(n, unit) {
    return n + ' ' + unit + (n === 1 ? '' : 's');
  }

  function timeOfDay(when) {
    try {
      return when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return when.getHours() + ':' + String(when.getMinutes()).padStart(2, '0');
    }
  }

  function weekday(when) {
    try {
      return when.toLocaleDateString([], { weekday: 'long' });
    } catch (e) {
      return '';
    }
  }

  function longDate(when) {
    try {
      return when.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return when.toDateString();
    }
  }

  function shortDate(when) {
    try {
      return when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return when.toDateString();
    }
  }

  /**
   * "just now" / "5 minutes ago" / "yesterday at 8:15 PM" / "Friday at 8:15 PM"
   * / "August 2, 2026 at 8:15 PM".
   *
   * An absent timestamp is "recently", not "never" and not blank — the caller
   * without one is usually looking at somebody who hides their detail, and the
   * missing data should not read as its own state.
   */
  function relative(value, nowValue) {
    var when = toDate(value);
    if (!when) return 'recently';

    var now = toDate(nowValue) || new Date();
    var delta = now.getTime() - when.getTime();

    // A clock a little ahead of ours is not a reason to print nonsense.
    if (delta < MINUTE) return 'just now';
    if (delta < HOUR) return plural(Math.floor(delta / MINUTE), 'minute') + ' ago';
    if (sameDay(when, now)) return plural(Math.floor(delta / HOUR), 'hour') + ' ago';

    var at = timeOfDay(when);
    if (isYesterday(when, now)) return 'yesterday at ' + at;

    if (delta < RECENT_DAYS * 24 * HOUR) {
      var day = weekday(when);
      if (day) return day + ' at ' + at;
    }

    return longDate(when) + ' at ' + at;
  }

  /** The same sentence with its prefix: "Last seen 5 minutes ago". */
  function label(value, nowValue) {
    return 'Last seen ' + relative(value, nowValue);
  }

  /** Dense-table form: "Just now", "5 min ago", "Yesterday", "Aug 2, 2026". */
  function short(value, nowValue) {
    var when = toDate(value);
    if (!when) return null;

    var now = toDate(nowValue) || new Date();
    var delta = now.getTime() - when.getTime();

    if (delta < MINUTE) return 'Just now';
    if (delta < HOUR) return Math.floor(delta / MINUTE) + ' min ago';
    if (sameDay(when, now)) return plural(Math.floor(delta / HOUR), 'hour') + ' ago';
    if (isYesterday(when, now)) return 'Yesterday';

    if (delta < RECENT_DAYS * 24 * HOUR) {
      var day = weekday(when);
      if (day) return day;
    }

    return shortDate(when);
  }

  /**
   * The label for a presence payload, whatever shape it arrived in.
   *
   * Prefers the ISO instant so the answer stays true as time passes, and falls
   * back to whatever sentence the server already wrote when there isn't one
   * (a subject who hides their last-seen sends the label without the time).
   */
  function forPresence(p) {
    if (!p) return 'Last seen recently';
    if (p.online) return 'Online';
    var at = p.lastSeenAt || p.last_seen_at || null;
    if (at) return label(at);
    return p.lastSeen || p.label || 'Last seen recently';
  }

  window.TMALastSeen = {
    relative: relative,
    label: label,
    short: short,
    forPresence: forPresence,
  };
})();
