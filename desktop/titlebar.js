'use strict';

/*
 * The brand-blue title bar.
 *
 * macOS will not tint a native title bar. `backgroundColor` only paints the web
 * area before the page loads, and the frame itself is drawn by AppKit in the
 * system appearance — verified, not assumed. The only way to a coloured bar is
 * to hide the native one (`titleBarStyle: 'hidden'`) and draw our own.
 *
 * Drawing it means putting something into the portal page, which is the risky
 * part: that page is the real web app, served to browsers too. So none of this
 * lives in the portal's stylesheets. It is injected at runtime by the shell and
 * exists only inside the app — a browser never sees it, and no portal CSS file
 * can be broken by it.
 *
 * Windows works the same way with one addition: its minimise/maximise/close
 * buttons stay native and are drawn by the OS over the right-hand end of the
 * strip, so `titleBarOverlay` has to be given the same blue or they sit in a
 * grey box on top of it.
 */

const HEIGHT = 38;

const IS_MAC = process.platform === 'darwin';

// --color-primary from public/css/tokens.css. The one the design system calls
// primary, not --color-blue (#7dbbff), which is the lighter badge blue.
const BLUE = '#03a5e9';

/**
 * Pushes the page down by the bar's height.
 *
 * `.tma-dash` is `height: 100vh`, so padding alone would make every portal
 * screen a bar taller than the window and hand it a scrollbar it never had.
 * The shell has to shrink by exactly what the padding adds.
 */
const CSS = `
  body { padding-top: ${HEIGHT}px !important; }

  .tma-dash {
    height: calc(100vh - ${HEIGHT}px) !important;
    min-height: calc(100vh - ${HEIGHT}px) !important;
  }

  /*
   * Body padding moves everything in normal flow, but position:fixed anchors to
   * the viewport and ignores it. Parts of the shell become fixed at top:0 — and
   * then sit *under* the bar. The sidebar was the visible one: its logo is the
   * first thing in it, so the logo went half-missing.
   *
   * Each rule below mirrors the exact selector and breakpoint that makes the
   * element fixed in dashboard.css. The offset cannot be set unconditionally,
   * because these same elements are position:relative in their other states,
   * where an offset would shove them down instead.
   *
   * Deliberately absent: .tma-dash__mmenu and .tma-dash__scrim. Those are
   * takeovers and are supposed to cover the bar — see the note above.
   */
  @media (min-width: 1025px) {
    /* Hover-style rail, collapsed — dashboard.css "held fixed in both states". */
    .tma-dash.is-sidebar-collapsed:not(.tma-dash--sidebar-standard) .tma-dash__sidebar {
      top: ${HEIGHT}px !important;
    }
  }

  @media (max-width: 1024px) {
    /* Narrow window: the rail and rightbar become drawers and the header pins. */
    .tma-dash__sidebar,
    .tma-dash__rightbar,
    .tma-dash__header {
      top: ${HEIGHT}px !important;
    }
  }

  #tma-desktop-titlebar {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: ${HEIGHT}px;
    /*
     * Above ordinary content and scrims, deliberately below the portal's
     * full-viewport takeovers — the signature wizard is 280 and the layer
     * scale runs to 2000. Those are position:fixed with inset:0, so they
     * ignore the body padding above and start at the very top of the window;
     * a bar sitting over them would clip their headers and close buttons.
     * Letting them cover the bar instead costs nothing but the blue strip
     * while they are open, which is what a takeover is meant to do.
     */
    z-index: 200;
    background: ${BLUE};
    color: #fff;
    display: flex;
    align-items: center;
    /* Traffic lights sit at the left on macOS; Windows puts its caption
       buttons at the right. Either way the controls need to clear them. */
    padding: 0 ${IS_MAC ? '12px 0 84px' : '138px 0 8px'};
    font: 600 13px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
    letter-spacing: 0.01em;
    /* The whole strip is the drag handle, standing in for the frame we hid. */
    -webkit-app-region: drag;
    -webkit-user-select: none;
    user-select: none;
  }

  #tma-desktop-titlebar .tma-tb-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    /* Carved out of the drag region, or the buttons swallow their own clicks. */
    -webkit-app-region: no-drag;
  }

  #tma-desktop-titlebar .tma-tb-btn {
    all: unset;
    box-sizing: border-box;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    color: #fff;
    opacity: 0.82;
    transition: background-color 120ms ease, opacity 120ms ease;
  }

  #tma-desktop-titlebar .tma-tb-btn:hover { opacity: 1; background: rgba(255,255,255,0.18); }
  #tma-desktop-titlebar .tma-tb-btn:active { background: rgba(255,255,255,0.28); }

  #tma-desktop-titlebar .tma-tb-btn[disabled] {
    opacity: 0.32;
    pointer-events: none;
  }

  #tma-desktop-titlebar .tma-tb-btn svg {
    width: 15px;
    height: 15px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Centred on the window, not on what is left over beside the controls —
     otherwise the title drifts as buttons enable and disable. */
  #tma-desktop-titlebar .tma-tb-title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: 52%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    pointer-events: none;
  }
`;

const ICONS = {
  back: '<path d="M10 3 L5 8 L10 13"/>',
  forward: '<path d="M6 3 L11 8 L6 13"/>',
  // Circular arrow: an arc left open at the top right, with the head on it.
  reload: '<path d="M13 8a5 5 0 1 1-1.7-3.7"/><path d="M13 2.5V5.4H10.1"/>',
};

/**
 * Re-asserted on every load and in-page navigation rather than done once: the
 * portal is a single-page app whose views reconcile through TMAMorph, and a
 * node it did not put there is not guaranteed to survive a re-render.
 *
 * Navigation runs through the page's own session history rather than new IPC.
 * It is the same history the Go menu drives through webContents, so Back here
 * and Back there land in the same place — and it keeps the preload's surface
 * exactly as small as it is, which is the point of that file.
 *
 * Whether there is anywhere to go back or forward *to* is not knowable in the
 * page (history.length counts entries, not position), so the main process
 * passes it in and the buttons are rebuilt with it on every navigation.
 */
function script({ canGoBack, canGoForward }) {
  const button = (name, label, enabled) => `
    <button class="tma-tb-btn" data-tb="${name}" title="${label}" aria-label="${label}"
      ${enabled ? '' : 'disabled'}>
      <svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>
    </button>`;

  return `
  (() => {
    let bar = document.getElementById('tma-desktop-titlebar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tma-desktop-titlebar';
      document.body.appendChild(bar);
    }

    bar.innerHTML = ${JSON.stringify(
    '<div class="tma-tb-nav">'
      + button('back', 'Back', canGoBack).trim()
      + button('forward', 'Forward', canGoForward).trim()
      + button('reload', 'Reload', true).trim()
      + '</div><span class="tma-tb-title"></span>',
  )};

    const nav = bar.querySelector('.tma-tb-nav');
    const title = bar.querySelector('.tma-tb-title');
    const paint = () => { title.textContent = document.title || 'TM ANTOINE Portal'; };
    paint();

    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tb]');
      if (!btn) return;
      const action = btn.getAttribute('data-tb');
      if (action === 'back') history.back();
      else if (action === 'forward') history.forward();
      else location.reload();
    });

    // The title carries the unread count — "(388) Dashboard" — so it changes
    // without a navigation. Watch the element, once per document.
    if (!document.documentElement.dataset.tmaTbWatching) {
      document.documentElement.dataset.tmaTbWatching = '1';
      const el = document.querySelector('title');
      if (el) new MutationObserver(() => {
        const t = document.getElementById('tma-desktop-titlebar');
        const s = t && t.querySelector('.tma-tb-title');
        if (s) s.textContent = document.title || 'TM ANTOINE Portal';
      }).observe(el, { childList: true });
    }
  })();
`;
}

/**
 * Options for the BrowserWindow. On macOS the traffic lights are nudged to sit
 * centred in a 38px bar rather than the 28px one they are placed for by
 * default; on Windows the native caption buttons are told to match the blue.
 */
function windowOptions() {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 12 },
    };
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BLUE, symbolColor: '#ffffff', height: HEIGHT },
  };
}

/**
 * Draws the bar, and re-draws it to pick up a changed Back/Forward state.
 *
 * Cheap enough to run on every navigation: it replaces one small subtree and
 * touches no stylesheet.
 */
async function refresh(webContents) {
  try {
    const history = webContents.navigationHistory;

    await webContents.executeJavaScript(script({
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    }), true);
  } catch {
    // A page that went away mid-injection is not worth reporting; the next
    // navigation draws it again.
  }
}

/**
 * The full pass, for a freshly loaded document.
 *
 * insertCSS is deliberately *not* part of refresh(): a stylesheet inserted this
 * way lives as long as the document does, so re-inserting it on every in-page
 * navigation would stack a fresh copy each time — and the portal navigates by
 * pushState, so that is most of them.
 */
async function apply(webContents) {
  try {
    await webContents.insertCSS(CSS);
  } catch {
    // As above — a page that went away takes its stylesheet with it.
  }

  await refresh(webContents);
}

module.exports = { apply, refresh, windowOptions, HEIGHT, BLUE };
