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
const { BrowserWindow } = require('electron');
const path = require('node:path');

const WIDTH = 420;
const HEIGHT = 280;

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
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    // Nothing here is cancellable once it starts, so there is no reason to let
    // it end up behind the window it is replacing.
    alwaysOnTop: true,
    backgroundColor: '#03a5e9',
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
    panel.show();
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
