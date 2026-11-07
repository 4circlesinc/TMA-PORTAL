/*
 * Phone screens: a history entry for every screen a section opens inside
 * itself on a phone (a Settings page, a group of sections, an option list).
 *
 * Everything that means "back" then steps back exactly one screen: the
 * header's back button, the iPhone's edge swipe (WebKit's own back gesture,
 * which slides the screen away under the finger and shows the one before),
 * Safari's swipe, and Android's back button. Without entries those skipped
 * every screen and left the section altogether. Swiping forward reopens.
 *
 *   var screen = TMAPhoneScreens.open(close, reopen)
 *       A screen is opening. Call it before changing the page, so the
 *       snapshot WebKit keeps for the swipe is the screen underneath.
 *       close() hides it again; reopen(screen) shows it when swiped forward.
 *   TMAPhoneScreens.back()
 *       The header's back button: the same as a swipe. False when no screen
 *       is open, and the caller closes things itself.
 *   TMAPhoneScreens.closed(screen)
 *       The screen closed itself (a choice was made); its entry goes too.
 *   TMAPhoneScreens.handlePop(event)
 *       dashboard.js asks first on popstate; true means it was a screen
 *       moving within the section, not a different page of the portal.
 *
 * Global: window.TMAPhoneScreens
 */
(function () {
  'use strict';

  if (window.TMAPhoneScreens) return;

  var stacks = {};      // path -> screens, index i is the screen at depth i + 1
  var at = { path: location.pathname, depth: depthOf(history.state) };
  var pendingPops = 0;  // history.back() calls for screens that closed themselves
  var queued = [];      // screens opened while those pops were still landing

  function depthOf(state) {
    return state && typeof state.tmaScreen === 'number' ? state.tmaScreen : 0;
  }

  function stack(path) {
    if (!stacks[path]) stacks[path] = [];
    return stacks[path];
  }

  function push(screen) {
    var list = stack(at.path);
    list.length = at.depth; // a new screen drops the ones ahead of it
    list.push(screen);
    at.depth = list.length;
    screen.depth = at.depth;
    var state = {};
    var current = history.state;
    if (current && typeof current === 'object') {
      for (var key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) state[key] = current[key];
      }
    }
    state.tmaScreen = at.depth;
    try {
      history.pushState(state, '', location.href);
    } catch (e) { /* history unavailable: back buttons still close */ }
  }

  function open(close, reopen) {
    var screen = { close: close, reopen: reopen || null, open: true, depth: 0 };
    if (pendingPops) queued.push(screen);
    else push(screen);
    return screen;
  }

  function back() {
    if (pendingPops || at.depth === 0) return false;
    var list = stacks[at.path] || [];
    var top = list[at.depth - 1];
    if (!top || !top.open) return false;
    history.back();
    return true;
  }

  function closed(screen) {
    if (!screen || !screen.open) return;
    screen.open = false;
    var waiting = queued.indexOf(screen);
    if (waiting !== -1) { queued.splice(waiting, 1); return; }
    if (screen.depth !== at.depth || location.pathname !== at.path) return;
    pendingPops += 1;
    history.back();
  }

  function run(fn, screen) {
    try { fn(screen); } catch (e) { /* one screen failing must not strand the rest */ }
  }

  function handlePop(event) {
    var target = depthOf(event && event.state);
    var path = location.pathname;

    if (pendingPops) {
      pendingPops -= 1;
      at = { path: path, depth: target };
      if (!pendingPops && queued.length) {
        var waiting = queued;
        queued = [];
        waiting.forEach(function (screen) { if (screen.open) push(screen); });
      }
      return true;
    }

    // Another page of the portal, or this one reached from another: the
    // route's own popstate shows it.
    if (path !== at.path || (target === 0 && at.depth === 0)) {
      at = { path: path, depth: target };
      return false;
    }

    var list = stacks[path] || [];
    var d;
    if (target < at.depth) {
      for (d = at.depth; d > target; d--) {
        var leaving = list[d - 1];
        if (leaving && leaving.open) {
          leaving.open = false;
          run(leaving.close, leaving);
        }
      }
    } else {
      for (d = at.depth + 1; d <= target; d++) {
        var returning = list[d - 1];
        if (returning && !returning.open && returning.reopen) {
          returning.open = true;
          run(returning.reopen, returning);
        }
      }
    }
    at.depth = target;
    return true;
  }

  /* dashboard.js went to another page of the portal (a new entry of its own). */
  function left() {
    at = { path: location.pathname, depth: depthOf(history.state) };
  }

  window.TMAPhoneScreens = {
    open: open,
    back: back,
    closed: closed,
    handlePop: handlePop,
    left: left,
    depth: function () { return at.depth; },
  };
})();
