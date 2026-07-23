/*
 * TMA - Approved calendar colour palette.
 * Global: window.TMACalendarColours
 * Mirrors App\Support\Calendar\CalendarColours::PALETTE - keep in sync.
 *
 * Every hue resolves to an existing design token, so a calendar's colour is
 * identical in the sidebar, the week grid, the month dots, the agenda, and
 * the detail panel.
 */
(function (global) {
  'use strict';

  /*
   * The `purple` key is historical — the calendar has always called this tone
   * "purple" — but the design system has no purple: --color-violet is aliased
   * to --color-primary (#03a5e9, brand blue) and --color-purple is a legacy
   * alias marked do-not-use. Pointing it at either made this entry render
   * indistinguishably from `blue`, so it maps to --color-primary-dark, the
   * deep brand blue the calendar's own event tint (--color-2) is derived
   * from. The key stays for stored values and existing CSS; the label says
   * what it actually looks like.
   */
  var PALETTE = [
    { key: 'blue', label: 'Blue', token: '--color-blue' },
    { key: 'purple', label: 'Deep blue', token: '--color-primary-dark' },
    { key: 'green', label: 'Green', token: '--color-green' },
    { key: 'teal', label: 'Teal', token: '--color-mint' },
    { key: 'pink', label: 'Pink', token: '--color-pink' },
    { key: 'red', label: 'Red', token: '--color-red' },
  ];

  var KEYS = PALETTE.reduce(function (set, c) { set[c.key] = true; return set; }, {});

  function isValid(colour) {
    return !!colour && KEYS.hasOwnProperty(colour);
  }

  function normalise(colour) {
    return isValid(colour) ? colour : 'blue';
  }

  function label(colour) {
    var match = PALETTE.filter(function (c) { return c.key === normalise(colour); })[0];
    return match ? match.label : 'Blue';
  }

  /* The CSS custom property a colour maps to, for inline swatches. */
  function token(colour) {
    var match = PALETTE.filter(function (c) { return c.key === normalise(colour); })[0];
    return match ? match.token : '--color-blue';
  }

  global.TMACalendarColours = {
    PALETTE: PALETTE,
    isValid: isValid,
    normalise: normalise,
    label: label,
    token: token,
  };
})(typeof window !== 'undefined' ? window : this);
