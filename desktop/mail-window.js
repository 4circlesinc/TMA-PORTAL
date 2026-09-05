'use strict';

/*
 * A conversation opened in its own window from the mailbox.
 *
 * Double-click (or "Open in new window") asks for /portal/mail/window/{uuid}
 * with window.open. That must become another BrowserWindow of this app — same
 * session, same preload, same brand title bar as the main window — never
 * Safari or Chrome. window-open in main.js recognises the URL with
 * isMailWindowUrl and sizes the window from windowOptions.
 */

const titlebar = require('./titlebar');

function mailWindowPath(url) {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return '';
  }
}

function isMailWindowUrl(url, portalOrigin) {
  if (!url || !portalOrigin) return false;
  try {
    if (new URL(url).origin !== new URL(portalOrigin).origin) return false;
  } catch {
    return false;
  }
  return /^\/portal\/mail\/window\/[^/]+$/.test(mailWindowPath(url));
}

function windowOptions(preloadPath) {
  return {
    width: 1000,
    height: 880,
    minWidth: 520,
    minHeight: 480,
    title: 'Mail',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: true,
    frame: true,
    ...titlebar.windowOptions(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  };
}

module.exports = { isMailWindowUrl, windowOptions };
