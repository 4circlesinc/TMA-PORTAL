/*
 * TMA — explorer-style selection for file lists.
 * Global: window.TMAFileSelect
 *
 * Every list of files and folders in the portal used to carry a column of
 * checkboxes: a box to tick per row, a box in the header to tick them all, and
 * a bulk toolbar behind them. Nothing else people file things with works that
 * way. Finder, Explorer, Drive and SharePoint all select on a plain click,
 * extend with Shift, add and subtract with Ctrl (Cmd on a Mac), open on a
 * double-click, and put the actions on the right button.
 *
 * The rules are the same wherever files are listed, so they live here once
 * rather than in each list. This module owns no DOM and no state of its own —
 * it is handed the ids on screen, the caller's own selection map and the mouse
 * event, and answers with the selection that should replace it. What a caller
 * stores against a selected id is the caller's business (the File Library
 * keeps {type, name}, the dashboard keeps `true`), which is what `value` is
 * for.
 *
 * The anchor — where a Shift range measures from — is the one thing that has
 * to survive between clicks, so callers hand in an object to keep it in.
 */
(function () {
  'use strict';

  function key(id) { return String(id); }

  function indexOf(ids, id) {
    for (var i = 0; i < ids.length; i++) {
      if (key(ids[i]) === key(id)) return i;
    }

    return -1;
  }

  /* Ctrl on Windows and Linux, Cmd on a Mac — the platform's own "and also
     this one" key, never both hard-coded as Ctrl. */
  function additive(e) { return !!(e && (e.ctrlKey || e.metaKey)); }

  function copyOf(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { out[k] = map[k]; });

    return out;
  }

  function valueFor(fn, id) {
    return typeof fn === 'function' ? fn(id) : true;
  }

  var TMAFileSelect = {
    /** Ctrl (or Cmd) is held: the click adds to or subtracts from the selection. */
    additive: additive,

    /**
     * The selection after a click on `id`.
     *
     * @param {object} opts
     *   ids      {string[]} every row id, in the order they are drawn — a
     *            Shift range is a slice of this, so it must be the reading
     *            order, not the order they arrived in.
     *   selected {object}   the current selection map. Never mutated.
     *   id       {string}   the row that was clicked.
     *   event    {MouseEvent}
     *   anchor   {object}   `{ id: … }`, carried between clicks and updated
     *            here. A fresh object each render would make every Shift-click
     *            a range of one.
     *   value    {function} (id) → what to store against a selected id.
     *            Defaults to `true`.
     * @return {object} the selection map to replace the old one with.
     */
    click: function (opts) {
      var ids = opts.ids || [];
      var id = opts.id;
      var e = opts.event || {};
      var anchor = opts.anchor || {};
      var current = opts.selected || {};
      var next;

      var at = indexOf(ids, id);
      if (at === -1) return copyOf(current);

      if (e.shiftKey) {
        /*
         * A range, measured from the anchor.
         *
         * With no anchor yet — the first click in a list is a Shift-click —
         * the range is the row itself, which is also where the anchor lands.
         * The anchor deliberately does NOT move on a Shift-click: holding
         * Shift and clicking further down again re-measures from the same
         * start, the way it does everywhere else, rather than growing the
         * range one row at a time.
         */
        var from = indexOf(ids, anchor.id);
        if (from === -1) { from = at; anchor.id = key(id); }

        var lo = Math.min(from, at);
        var hi = Math.max(from, at);

        // Ctrl+Shift keeps what was already picked and adds the range to it;
        // Shift alone replaces the selection with the range.
        next = additive(e) ? copyOf(current) : {};
        for (var i = lo; i <= hi; i++) {
          next[key(ids[i])] = valueFor(opts.value, ids[i]);
        }

        return next;
      }

      if (additive(e)) {
        next = copyOf(current);
        if (next[key(id)]) delete next[key(id)];
        else next[key(id)] = valueFor(opts.value, id);
        anchor.id = key(id);

        return next;
      }

      // A plain click is always "just this one", including on a row that is
      // already part of a wider selection — the selection collapses to it.
      next = {};
      next[key(id)] = valueFor(opts.value, id);
      anchor.id = key(id);

      return next;
    },

    /**
     * The selection a right-click should act on.
     *
     * Right-clicking inside a selection acts on the whole selection; anywhere
     * else it takes the row first, then opens. Nobody expects a menu opened
     * over one file to delete the four above it.
     */
    context: function (opts) {
      var current = opts.selected || {};
      var id = opts.id;
      var anchor = opts.anchor || {};

      if (current[key(id)]) return copyOf(current);

      var next = {};
      next[key(id)] = valueFor(opts.value, id);
      anchor.id = key(id);

      return next;
    },

    /** Everything on screen, for Ctrl+A. */
    all: function (ids, value) {
      var next = {};
      (ids || []).forEach(function (id) { next[key(id)] = valueFor(value, id); });

      return next;
    },

    /**
     * Is this the keyboard pressing a control rather than a pointer clicking it?
     *
     * Enter and Space on a focused button raise a click with no pointer behind
     * it, and `detail` — how many clicks in the streak — is 0 for exactly
     * those. Keyboard users get the old behaviour (activate opens the file);
     * a mouse selects and opens on the second click.
     */
    fromKeyboard: function (e) { return !!e && e.detail === 0; },

    /**
     * Stop Shift-click painting a blue streak of text across the rows.
     *
     * `user-select: none` on the list handles the general case, but a caller
     * that cannot set it (or wants a name to stay copyable) can call this from
     * mousedown instead.
     */
    guard: function (e) {
      if (e && e.shiftKey) e.preventDefault();
    },
  };

  window.TMAFileSelect = TMAFileSelect;
})();
