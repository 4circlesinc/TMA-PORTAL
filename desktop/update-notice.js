'use strict';

/*
 * The two things a Windows user has to be told about an update, and the two
 * moments macOS covers for free.
 *
 * "There is one waiting."  On a Mac the menu bar is on screen whether or not a
 * window is, so relabelling the app menu to "Install Update 0.8.29…" is a sign
 * that is simply always there. Windows keeps that same menu inside a window
 * that is usually hidden, and the tray copy of it only exists while someone is
 * right-clicking. So an offer that opened behind another app — see reveal() in
 * update-surface.js for why that happens — left no trace at all.
 *
 * "One is installing."  The macOS install is a `ditto` of an already-unpacked
 * bundle: a few seconds between the app going away and coming back. On Windows
 * the artifact is an NSIS installer run with /S, which unpacks ninety-odd
 * megabytes into Program Files with no interface of its own, and by then this
 * app has quit and taken the progress panel with it. Half a minute of nothing,
 * ending in the app reappearing, is indistinguishable from a crash.
 *
 * A toast is the right answer to both because it outlives the process. The
 * install notice is posted immediately before `app.quit()` and is still sitting
 * in the Action Center while the installer works and while the app is gone.
 */

const { Notification } = require('electron');

const IS_MAC = process.platform === 'darwin';

/**
 * Posts one, or does nothing it can be blamed for.
 *
 * Nothing here is important enough to fail an update over: a machine with
 * notifications turned off still gets the offer window, the tray tooltip and
 * both menus.
 */
function post({ title, body, onClick, silent = false }) {
  if (!Notification.isSupported()) return false;

  try {
    const note = new Notification({ title, body, silent });
    if (typeof onClick === 'function') note.on('click', onClick);
    note.show();
    return true;
  } catch {
    return false;
  }
}

/**
 * A new version was found while the user was in another app.
 *
 * macOS does not get this one: the offer window comes to the front there on its
 * own, so a banner saying the same thing is a second interruption for one
 * event.
 *
 * @param {string} version
 * @param {() => void} onClick  surface the offer that is already open
 */
function available(version, onClick) {
  if (IS_MAC) return false;

  return post({
    title: 'Update available',
    body: `TM ANTOINE Portal ${version} is ready to install.`,
    onClick,
  });
}

/**
 * The last thing on screen before the app goes away to be replaced.
 *
 * Silent on purpose — the user pressed Update Now a second ago and knows what
 * they asked for; this is here so the empty half-minute that follows reads as
 * progress rather than a crash.
 *
 * @param {string} version
 */
function installing(version) {
  if (IS_MAC) return false;

  return post({
    title: `Installing update ${version}`,
    body: 'TM ANTOINE Portal will close and reopen by itself. This takes about a minute.',
    silent: true,
  });
}

module.exports = { available, installing, post };
