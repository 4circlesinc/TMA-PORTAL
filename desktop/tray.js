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

  tray.setToolTip('TM ANTOINE Portal');

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

/**
 * Unread count, drawn over the tray icon. The taskbar button gets its own
 * overlay separately — this is the one that stays visible with no window open.
 */
function setTooltipCount(count) {
  if (!tray) return;
  tray.setToolTip(count > 0
    ? `TM ANTOINE Portal — ${count} unread`
    : 'TM ANTOINE Portal');
}

module.exports = { install, setTooltipCount };
