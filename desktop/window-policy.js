/*
 * Closing the window backgrounds the app instead of ending it.
 *
 * This is what makes messages and calls keep arriving after the red button,
 * and what makes reopening instant — the page is hidden, never destroyed, so
 * nothing reloads and the websocket is never dropped.
 *
 * It lives in its own file because it is the one behaviour here that is easy
 * to break silently and impossible to notice by looking: a window that is
 * destroyed instead of hidden still looks completely normal until someone
 * misses a call. test-bridge.js drives a real window through it.
 */

/**
 * @param {Electron.BrowserWindow} win
 * @param {() => boolean} isQuitting  true once the app is genuinely going away
 *                                    (⌘Q, or a restart to finish an update)
 * @param {() => void} [onHide]       housekeeping before the window goes
 */
function installCloseToBackground(win, isQuitting, onHide = () => {}) {
  win.on('close', (event) => {
    onHide();

    if (isQuitting()) return; // let it through — this really is the end

    event.preventDefault();
    win.hide();
  });
}

module.exports = { installCloseToBackground };
