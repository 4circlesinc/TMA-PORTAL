'use strict';

/*
 * The notification-area icon. Windows and Linux only.
 *
 * macOS has the Dock: an app with no windows is still visible, still clickable,
 * still quittable. Windows has nothing of the sort — close the last window with
 * `backgroundOnClose` on and the app is running with no icon anywhere, no way
 * to reach it, and no way to quit it short of Task Manager. It would look
 * exactly like a crash while it quietly went on ringing for calls.
 *
 * So the tray is not decoration here; it is the entire reason the same
 * close-to-background behaviour is safe to ship off the Mac.
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');

let tray = null;

/**
 * @param {object} handlers
 * @param {() => void} handlers.onShow      bring the main window back
 * @param {() => void} handlers.onQuit      really quit, not background
 * @param {() => Electron.MenuItemConstructorOptions} handlers.updateItem
 */
function install({ onShow, onQuit, updateItem }) {
  if (process.platform === 'darwin' || tray) return null;

  // 16px, with a 32px sibling Electron resolves by filename for 200% displays.
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);

  paintTooltip();

  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Portal', click: onShow },
      { type: 'separator' },
      updateItem(),
      { type: 'separator' },
      { label: 'Quit TM ANTOINE Portal', click: onQuit },
    ]));
  };

  rebuild();

  // Left click is how people expect to reopen a tray app on Windows; the
  // context menu is right click, which Electron wires up on its own.
  tray.on('click', onShow);

  app.on('before-quit', () => {
    if (!tray) return;
    tray.destroy();
    tray = null;
  });

  return { rebuild };
}

/*
 * What the tooltip has to say, and why it says two things.
 *
 * Unread count: the taskbar button gets its own overlay separately — this is
 * the one that stays visible with no window open.
 *
 * Waiting update: on macOS the menu bar relabels itself to "Install Update
 * 0.8.29…" and is on screen whether or not a window is, so a deferred update
 * announces itself permanently and for free. Windows keeps that same menu
 * inside a window that is usually hidden, and the tray copy of it only exists
 * while someone is right-clicking — so after one "Later" there was nothing on
 * screen anywhere saying an update was still waiting. The tooltip is the one
 * surface Windows gives a tray app that a passing glance can reach.
 */
let unread = 0;
let waiting = null;

function paintTooltip() {
  if (!tray) return;

  // The update leads: it is the thing the user has to act on, and the count is
  // already on the taskbar button.
  const parts = ['TM ANTOINE Portal'];
  if (waiting) parts.push(`update to ${waiting} ready`);
  if (unread > 0) parts.push(`${unread} unread`);

  tray.setToolTip(parts.join(' — '));
}

/** @param {number} count */
function setTooltipCount(count) {
  unread = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
  paintTooltip();
}

/** @param {string|null} version  the version deferred, or null once none is */
function setUpdateWaiting(version) {
  waiting = version || null;
  paintTooltip();
}

module.exports = { install, setTooltipCount, setUpdateWaiting };
