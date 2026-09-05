'use strict';

/*
 * Compose popped out of the mailbox reading pane.
 *
 * The page asks for /email/compose with window.open. That must become another
 * BrowserWindow of this app — same session, same preload — never Safari or
 * Chrome. window-open in main.js recognises the URL with isComposePopoutUrl
 * and sizes the window from windowOptions.
 */

function composePath(url) {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return '';
  }
}

function isComposePopoutUrl(url, portalOrigin) {
  if (!url || !portalOrigin) return false;
  try {
    if (new URL(url).origin !== new URL(portalOrigin).origin) return false;
  } catch {
    return false;
  }
  return composePath(url) === '/email/compose';
}

function windowOptions(preloadPath) {
  return {
    width: 760,
    height: 820,
    minWidth: 520,
    minHeight: 480,
    title: 'New Email',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: true,
    // The main window hides its native bar and draws a brand one. This is a
    // real OS window, so it keeps traffic lights / caption buttons of its own.
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  };
}

module.exports = { isComposePopoutUrl, windowOptions };
