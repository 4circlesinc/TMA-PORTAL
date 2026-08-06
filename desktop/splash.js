'use strict';

/*
 * The loading screen.
 *
 * It used to be a page the window loaded *before* the portal, which meant the
 * portal replaced it the moment the first bytes committed — long before the
 * page had painted. What you saw was the splash, then a half-built shell
 * filling in: sidebar, then labels, then icons, then content. That staged
 * assembly is what makes an app read as a web page in a frame.
 *
 * So it is a layer over the window instead, not a page inside it. The portal
 * loads underneath, invisibly, and the layer is only taken away once the page
 * is actually painted. Nothing half-built is ever on screen.
 *
 * It comes back for every main-frame navigation and every reload, because a
 * reload has exactly the same problem as a cold start.
 */
const { WebContentsView } = require('electron');
const path = require('node:path');

// How long the layer may stay before it is taken away regardless. A page that
// never fires did-finish-load must not leave someone staring at a logo.
const MAX_MS = 15000;

// Matches the fade in splash.html. Removing the view before the fade finishes
// makes the transition a cut.
const FADE_MS = 260;

/**
 * @param {Electron.BrowserWindow} win
 */
function attach(win) {
  let view = null;
  let timer = null;
  let leaving = null;

  const fit = () => {
    if (!view || !win || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };

  function show() {
    if (!win || win.isDestroyed()) return;

    // Already up: cancel any pending exit rather than stacking a second layer.
    if (view) {
      if (leaving) { clearTimeout(leaving); leaving = null; }
      view.webContents.executeJavaScript("document.body.classList.remove('is-leaving'); void 0;", true)
        .catch(() => {});
      fit();
      return;
    }

    view = new WebContentsView({
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    view.setBackgroundColor('#136da0');
    view.webContents.loadFile(path.join(__dirname, 'splash.html'));

    win.contentView.addChildView(view);
    fit();
    win.on('resize', fit);

    timer = setTimeout(hide, MAX_MS);
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!view || leaving) return;

    const going = view;

    // Faded out rather than cut, so the page appears to arrive rather than the
    // splash to vanish.
    going.webContents.executeJavaScript("document.body.classList.add('is-leaving'); void 0;", true)
      .catch(() => {});

    leaving = setTimeout(() => {
      leaving = null;
      if (view !== going) return;
      view = null;

      try {
        if (win && !win.isDestroyed()) {
          win.removeListener('resize', fit);
          win.contentView.removeChildView(going);
        }
        going.webContents.close();
      } catch {
        // The window went away mid-fade; nothing left to tidy.
      }
    }, FADE_MS);
  }

  return { show, hide, fit, isUp: () => !!view };
}

module.exports = { attach, MAX_MS, FADE_MS };
