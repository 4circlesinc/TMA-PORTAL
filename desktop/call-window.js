/*
 * The incoming-call panel.
 *
 * A ringing call should not drag the whole app in front of whatever someone is
 * doing — it should behave like every other call app on the machine: a small
 * panel in the top-right corner naming the caller, with Accept and Decline.
 * The app itself only comes forward if the call is answered.
 *
 * The panel is a separate window on purpose. It floats above full-screen apps
 * and across Spaces, which the portal page — living inside the main window —
 * can never do.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const WIDTH = 300;
const HEIGHT = 370;
const MARGIN = 16;

let panel = null;

function topRight() {
  // workArea, not bounds: it already excludes the menu bar and the Dock.
  const { workArea } = screen.getPrimaryDisplay();

  return {
    x: Math.round(workArea.x + workArea.width - WIDTH - MARGIN),
    y: Math.round(workArea.y + MARGIN),
  };
}

/**
 * @param {{name: string, avatar: string, media: string}} call
 */
function show(call) {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('call:info', call);
    return panel;
  }

  panel = new BrowserWindow({
    ...topRight(),
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // A call has to be visible over whatever is in front, including a
    // full-screen app on another Space.
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'call-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  panel.loadFile(path.join(__dirname, 'call-window.html'));

  panel.webContents.once('did-finish-load', () => {
    panel.webContents.send('call:info', call);
    // Inactive: the panel must not steal the keyboard from whatever the user
    // is typing in. Clicking it focuses it, which is when it needs focus.
    panel.showInactive();
  });

  panel.on('closed', () => { panel = null; });

  return panel;
}

function close() {
  if (panel && !panel.isDestroyed()) panel.close();
  panel = null;
}

const isOpen = () => !!panel && !panel.isDestroyed();

module.exports = { show, close, isOpen, WIDTH, HEIGHT, topRight };
