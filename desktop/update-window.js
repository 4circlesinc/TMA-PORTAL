/*
 * The updating screen.
 *
 * An update used to happen entirely out of sight: the only sign of one was the
 * dock progress bar, and then the app vanished and came back. On a slow
 * connection that is a long silence followed by what looks like a crash.
 *
 * A separate window rather than an overlay on the portal, for the same reason
 * as the call panel: the page it would sit on is about to be thrown away and
 * relaunched, and the swap happens after the main window has gone.
 */
const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');

const { surfaceOptions, reveal } = require('./update-surface');

const WIDTH = 340;
const HEIGHT = 230;

let panel = null;

/** Opens the screen, or returns the one already up. */
function show(version) {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('update:version', version);
    return panel;
  }

  panel = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    center: true,
    resizable: false,
    // Closable and minimisable — an update takes minutes and there is no reason
    // to hold the screen hostage for them. Closing only dismisses the progress;
    // the download carries on and the app still restarts when it is done.
    closable: true,
    minimizable: true,
    // Full screen makes no sense for a fixed 340pt panel, and `maximizable`
    // false is what greys out the green button rather than leaving it to zoom
    // a window that cannot resize.
    maximizable: false,
    fullscreenable: false,
    // Not always-on-top: that is for something you must deal with now, and this
    // is something you watch or ignore.
    alwaysOnTop: false,
    // What the panel is made of, and the one place the platform split lives.
    ...surfaceOptions(process.platform, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The download runs in the main process and reports here; a throttled
      // renderer would stop repainting the bar the moment the window blurs.
      backgroundThrottling: false,
    },
  });

  panel.loadFile(path.join(__dirname, 'update-window.html'));

  panel.webContents.once('did-finish-load', () => {
    panel.webContents.send('update:version', version);
    // Not panel.show(): Windows will not give a tray app the foreground, and a
    // progress screen behind the user's work is the same as no progress screen.
    reveal(panel, process.platform);
  });

  panel.on('closed', () => { panel = null; });

  return panel;
}

/** @param {'downloading'|'installing'|'restarting'} phase */
function setPhase(phase) {
  if (panel && !panel.isDestroyed()) panel.webContents.send('update:phase', phase);
}

/** @param {number} fraction 0..1 */
function setProgress(fraction) {
  if (panel && !panel.isDestroyed()) panel.webContents.send('update:progress', fraction);
}

function close() {
  if (panel && !panel.isDestroyed()) panel.close();
  panel = null;
}

const isOpen = () => !!panel && !panel.isDestroyed();

module.exports = { show, setPhase, setProgress, close, isOpen, WIDTH, HEIGHT };
