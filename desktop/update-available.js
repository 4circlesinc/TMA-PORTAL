/*
 * "A new version is available" — the window that replaced dialog.showMessageBox.
 *
 * A native message box cannot carry a disclosure triangle, so asking someone to
 * accept an update meant telling them a version number and nothing about what
 * they were accepting. This is the same glass panel as the progress screen,
 * with the release notes folded away behind More details.
 *
 * show() resolves to what the person chose, so the updater reads as it did with
 * the dialog it replaced:
 *
 *   const choice = await updateAvailable.show({ version, notes });
 *   if (choice !== 'update') return;
 */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const WIDTH = 380;
const COLLAPSED = 216; // opening size; the panel then follows its content

const IS_MAC = process.platform === 'darwin';

/** Same material as update-window.js — see the note there for why. */
function material() {
  if (IS_MAC) {
    return {
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 13, y: 13 },
    };
  }

  return {
    backgroundMaterial: 'acrylic',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#8a8a8a', height: 34 },
  };
}

let panel = null;

/**
 * @param {{version: string, notes?: string[]}} release
 * @returns {Promise<'update'|'later'>} 'later' if the window is simply closed.
 */
function show({ version, notes = [] }) {
  if (panel && !panel.isDestroyed()) panel.close();

  return new Promise((resolve) => {
    let answered = false;

    const win = new BrowserWindow({
      width: WIDTH,
      height: COLLAPSED,
      show: false,
      center: true,
      resizable: false,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      ...material(),
      webPreferences: {
        preload: path.join(__dirname, 'update-available-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    panel = win;

    /*
     * Every handler below closes over `win` rather than reading the module's
     * `panel`. They are not the same thing for long: opening a second offer
     * reassigns `panel`, and then the *first* window's closed handler runs and
     * nulls it — leaving the live window with its own listeners guarding
     * against a null and silently ignoring its own buttons.
     */
    const settle = (choice) => {
      if (answered) return;
      answered = true;
      resolve(choice);
    };

    // Closing the window is a decision too — the same one as Later. Without
    // this the promise never settles and the update silently hangs.
    win.on('closed', () => {
      if (panel === win) panel = null;
      settle('later');
    });

    const onChoice = (event, choice) => {
      if (win.isDestroyed() || event.sender !== win.webContents) return;
      settle(choice === 'update' ? 'update' : 'later');
      win.close();
    };

    /*
     * The panel grows and shrinks as the notes are disclosed. The renderer
     * measures, because only it knows how tall the list wrapped to — a height
     * guessed here would clip the last bullet on any wrap.
     */
    const onResize = (event, height) => {
      if (win.isDestroyed() || event.sender !== win.webContents) return;
      const wanted = Math.round(Math.min(Math.max(height, 150), 560));
      const [, current] = win.getContentSize();
      if (Math.abs(current - wanted) <= 1) return;

      /*
       * Not animated. An animated resize on a transparent, vibrant window
       * leaves the newly exposed strip unpainted on macOS — the window grows
       * and the disclosed notes are simply not drawn in it, which looks like
       * the drawer opened empty. invalidate() forces the frame that the resize
       * should have triggered.
       */
      win.setContentSize(WIDTH, wanted, false);
      win.webContents.invalidate();
    };

    ipcMain.on('update-available:choice', onChoice);
    ipcMain.on('update-available:height', onResize);

    win.on('closed', () => {
      ipcMain.removeListener('update-available:choice', onChoice);
      ipcMain.removeListener('update-available:height', onResize);
    });

    win.loadFile(path.join(__dirname, 'update-available.html'));

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('update-available:release', { version, notes });
      win.show();
    });
  });
}

function close() {
  if (panel && !panel.isDestroyed()) panel.close();
  panel = null;
}

const isOpen = () => !!panel && !panel.isDestroyed();

module.exports = { show, close, isOpen, WIDTH, COLLAPSED };
