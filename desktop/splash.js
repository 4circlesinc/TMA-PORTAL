'use strict';

/*
 * The loading screen.
 *
 * The window is shown as soon as it can paint, but the portal behind it takes a
 * moment — on a cold start or a slow connection, several seconds of an empty
 * frame. This fills that with something that says the app is starting.
 *
 * Deliberately *not* a separate window. A splash panel is another thing on the
 * desktop to position, keep on top and remember to dismiss, and it flashes as
 * it hands over. Loading it into the main window means there is only ever one
 * window, and the portal replaces this in place the moment it commits.
 */
const path = require('node:path');

/**
 * Paints the loading screen into a window, then hands back so the caller can
 * start the real load.
 *
 * @param {Electron.BrowserWindow} win
 * @param {() => void} then Called once the screen is up.
 */
function showIn(win, then) {
  if (!win || win.isDestroyed()) return;

  // Waited for, so the portal's load cannot cancel a screen that never drew —
  // which on a fast connection is the difference between a splash and a flicker.
  win.webContents.once('did-finish-load', () => {
    if (typeof then === 'function') then();
  });

  win.loadFile(path.join(__dirname, 'splash.html')).catch(() => {
    // If even the local file will not load, go straight to the portal.
    if (typeof then === 'function') then();
  });
}

module.exports = { showIn };
