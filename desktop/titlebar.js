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
    justify-content: center;
    font: 600 13px/1 -apple-system, system-ui, sans-serif;
    letter-spacing: 0.01em;
    /* The whole strip is the drag handle, standing in for the frame we hid. */
    -webkit-app-region: drag;
    -webkit-user-select: none;
    user-select: none;
  }
`;

/**
 * Re-asserted on every load and in-page navigation rather than done once: the
 * portal is a single-page app whose views reconcile through TMAMorph, and a
 * node it did not put there is not guaranteed to survive a re-render.
 */
const SCRIPT = `
  (() => {
    let bar = document.getElementById('tma-desktop-titlebar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tma-desktop-titlebar';
      document.body.appendChild(bar);
    }

    const paint = () => { bar.textContent = document.title || 'TM ANTOINE Portal'; };
    paint();

    // The title carries the unread count — "(388) Dashboard" — so it changes
    // without a navigation. Watch it once.
    if (!bar.dataset.watching) {
      bar.dataset.watching = '1';
      const title = document.querySelector('title');
      if (title) new MutationObserver(paint).observe(title, { childList: true });
    }
  })();
`;

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

/** Paints the bar into a portal page. Safe to call more than once. */
async function apply(webContents) {
  try {
    await webContents.insertCSS(CSS);
    await webContents.executeJavaScript(SCRIPT, true);
  } catch {
    // A page that went away mid-injection is not worth reporting; the next
    // load paints it again.
  }
}

module.exports = { apply, windowOptions, HEIGHT, BLUE };
