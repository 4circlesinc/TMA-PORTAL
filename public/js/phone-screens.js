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
 *   TMAPhoneScreens.showing()
 *       How many screens are open on this page.
 *
 * The left-edge swipe means back while a screen is open, and on any page
 * that is itself one step into a section (an application, a client, an open
 * folder or file: detailPage). On a section's own page it opens the menu
 * (dashboard.js). The iPhone app's back swipe is switched to match
 * (TMADesktop.setEdgeBack), so the two never both move.
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

  function showing() {
    var list = stacks[at.path] || [];
    var n = 0;
    for (var i = 0; i < at.depth && i < list.length; i++) {
      if (list[i] && list[i].open) n += 1;
    }
    return n;
  }

  /*
   * The pages the menu leads to, by their addresses. Anything beneath one
   * of them (an application under CIP Applications) is a step into it.
   */
  var roots = null;
  function sectionRoots() {
    if (roots && roots.length) return roots;
    var found = [];
    var links = document.querySelectorAll('.tma-dash__nav-item[href^="/"], .tma-dash__nav-leaf[href^="/"], [data-nav][href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
      if (found.indexOf(href) === -1) found.push(href);
    }
    roots = found;
    return roots;
  }

  /*
   * This page is a detail of a section, not the section itself: an
   * application, a client, a company (beneath the section's address), or a
   * folder or file open in the File Library (named in the query). On a phone
   * the left edge is back there, the way it is on every app's detail screen;
   * it used to open the menu over the application instead.
   */
  function detailPage() {
    if (history.length < 2) return false;
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var query = location.search || '';
    var list = sectionRoots();
    if (!list.length) return false;
    if (/[?&](folder|file)=/.test(query)) return true;
    for (var i = 0; i < list.length; i++) {
      if (path === list[i]) return false;
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j] !== '/' && path.indexOf(list[j] + '/') === 0) return true;
    }
    return false;
  }

  var edgeBack = null;
  /* Tell the iPhone app whether its edge swipe is back right now. */
  function syncEdge() {
    var on = showing() > 0 || detailPage();
    if (on === edgeBack) return;
    edgeBack = on;
    var host = window.TMADesktop;
    if (host && typeof host.setEdgeBack === 'function') {
      try { host.setEdgeBack(on); } catch (e) { /* the menu keeps the edge */ }
    }
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
    syncEdge();
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
    syncEdge();
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
      syncEdge();
      return true;
    }

    // Another page of the portal, or this one reached from another: the
    // route's own popstate shows it.
    if (path !== at.path || (target === 0 && at.depth === 0)) {
      at = { path: path, depth: target };
      syncEdge();
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
    syncEdge();
    return true;
  }

  /* dashboard.js went to another page of the portal (a new entry of its own). */
  function left() {
    at = { path: location.pathname, depth: depthOf(history.state) };
    syncEdge();
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function () {
      var result = original.apply(this, arguments);
      // After the page has moved, not before: syncEdge reads the address.
      try { setTimeout(syncEdge, 0); } catch (e) { /* the swipe keeps its last state */ }
      return result;
    };
  });

  window.TMAPhoneScreens = {
    open: open,
    back: back,
    closed: closed,
    handlePop: handlePop,
    left: left,
    showing: showing,
    detailPage: detailPage,
    sync: syncEdge,
    depth: function () { return at.depth; },
  };
  syncEdge();
})();
