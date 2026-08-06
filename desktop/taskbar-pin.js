'use strict';

/*
 * Asking to be pinned to the Windows taskbar.
 *
 * The app cannot do this itself, and that is not an oversight in this file.
 * Windows deliberately removed programmatic pinning: the "Pin to taskbar" shell
 * verb has been blocked for applications since Windows 10, and the supported
 * API that replaced it (TaskbarManager.RequestPinCurrentAppAsync) is for MSIX
 * packaged apps only, which an NSIS install is not. The registry-and-shortcut
 * workarounds that still circulate write into a serialised blob the shell owns;
 * on Windows 11 they do nothing, and when they do land they can leave the
 * taskbar in a state the user cannot fix. Nothing here attempts one.
 *
 * So the honest implementation is to ask, once, and say exactly which two
 * clicks to make. The installer's finish page carries the same line for anyone
 * who reads it — build/installer.nsh — but that page is a wall of text people
 * dismiss on their way to the app, so it is repeated here where the taskbar
 * button they need to right-click is actually on screen in front of them.
 */

const { dialog, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const settings = require('./settings');

/**
 * Long enough for the window to be up and the portal painted, so the app is
 * plainly *there* on the taskbar when it is pointed at. Asking during the
 * splash means pointing at something that has not appeared yet.
 */
const DELAY = 6000;

/**
 * Whether the app is already pinned.
 *
 * Pinned taskbar items are still kept as ordinary shortcuts in this folder on
 * Windows 10 and 11, even though the taskbar's own ordering lives elsewhere —
 * so its contents answer "is it pinned" even though writing to it would not
 * make it so.
 */
function isPinned() {
  try {
    const dir = path.join(
      app.getPath('appData'),
      'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar',
    );

    return fs.readdirSync(dir)
      .some((file) => file.toLowerCase().startsWith(app.getName().toLowerCase()));
  } catch {
    // No such folder, or no permission to read it. Not knowing is not a reason
    // to nag: the ask is one-time either way, and a wrong "not pinned" only
    // costs one dismissible dialog.
    return false;
  }
}

/**
 * Asks once, on the first launch of a fresh install.
 *
 * @param {object} options
 * @param {Electron.BrowserWindow|null} options.parent  so it is a sheet, not a
 *                                                      window someone finds later
 * @returns {boolean} whether it will ask — for the tests, since the dialog itself
 *                    blocks and cannot be asserted on
 */
function promptOnFirstRun({ parent = null } = {}) {
  if (process.platform !== 'win32') return false;

  // In a dev run the "app" is Electron itself, and pinning that is meaningless.
  if (!app.isPackaged) return false;

  // The installer passes this when it relaunches after an update. Someone who
  // has been running the app for months does not need to be told where the
  // taskbar is; this is for the install that just happened.
  if (process.argv.includes('--updated')) return false;

  if (settings.get('taskbarPinPrompted')) return false;
  if (isPinned()) return false;

  /*
   * Recorded here, at the decision, rather than when the dialog opens.
   *
   * The two are six seconds apart, and someone who closes the app inside that
   * window would otherwise arrive at the same dialog on every launch until they
   * happened to leave it open long enough — the exact nagging this is trying to
   * be the opposite of. The cost is that a crash inside those six seconds
   * spends the one ask, which is the same trade notifications.js makes.
   */
  settings.set('taskbarPinPrompted', true);

  const timer = setTimeout(() => {
    try {
      dialog.showMessageBox(parent, {
        type: 'info',
        message: 'Keep the portal one click away',
        detail: 'Right-click the app on your taskbar and choose “Pin to taskbar”.'
          + '\n\nWindows only allows this from the taskbar itself, so the app cannot do it for you.',
        buttons: ['Got it'],
        defaultId: 0,
        noLink: true,
      });
    } catch {
      // A dialog that will not open is not a reason to fail a launch.
    }
  }, DELAY);

  // Never the reason the process stays alive.
  if (typeof timer.unref === 'function') timer.unref();

  return true;
}

module.exports = { promptOnFirstRun, isPinned, DELAY };
