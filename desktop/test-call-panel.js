/*
 * The incoming-call panel: the real window, the real HTML, the real preload.
 *
 * Run with: npm run test:call
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const callWindow = require('./call-window');

let failures = 0;

function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const CALL = { name: 'Vernon Francis', avatar: '', media: 'video' };

app.whenReady().then(async () => {
  // Something for the panel to sit in front of, standing in for the portal.
  const main = new BrowserWindow({ show: false, width: 900, height: 600 });
  await main.loadURL('data:text/html,<title>portal</title>');

  const panel = callWindow.show(CALL);
  await new Promise((resolve) => panel.webContents.once('did-finish-load', resolve));
  await settle();

  check('panel opens', callWindow.isOpen(), true);
  check('panel is visible', panel.isVisible(), true);

  // The whole point: ringing must not pull focus from what the user is doing.
  check('panel does not steal focus', panel.isFocused(), false);
  check('main window stays closed', main.isVisible(), false);

  check('panel floats above everything', panel.isAlwaysOnTop(), true);

  // Top-right of the work area, clear of the menu bar.
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = panel.getBounds();
  check('sits at the right edge', bounds.x + bounds.width <= workArea.x + workArea.width, true);
  check('sits at the top', bounds.y >= workArea.y, true);
  check('is in the top half', bounds.y < workArea.y + workArea.height / 2, true);

  const read = (id) => panel.webContents.executeJavaScript(
    `document.getElementById(${JSON.stringify(id)}).textContent`, true,
  );

  check('names the caller', await read('name'), 'Vernon Francis');
  check('says what kind of call', await read('kind'), 'TM ANTOINE video call');
  check('falls back to initials', await read('avatar'), 'VF');

  // A second call for the same panel updates it rather than stacking windows.
  callWindow.show({ name: 'Dana Reed', avatar: '', media: 'audio' });
  await settle();
  check('reuses one panel', BrowserWindow.getAllWindows().filter((w) => w !== main).length, 1);
  check('updates the caller', await read('name'), 'Dana Reed');
  check('updates the call kind', await read('kind'), 'TM ANTOINE audio call');

  // Clicking Accept has to reach the main process, or the button does nothing.
  const accepted = new Promise((resolve) => ipcMain.once('call:accept', () => resolve(true)));
  await panel.webContents.executeJavaScript('document.getElementById("accept").click()', true);
  check('accept reaches the app', await Promise.race([accepted, settle(1500)]), true);

  const declined = new Promise((resolve) => ipcMain.once('call:decline', () => resolve(true)));
  await panel.webContents.executeJavaScript('document.getElementById("decline").click()', true);
  check('decline reaches the app', await Promise.race([declined, settle(1500)]), true);

  callWindow.close();
  await settle();
  check('panel closes when the call ends', callWindow.isOpen(), false);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
