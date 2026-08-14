/*
 * The floating call window, from the shell's side.
 *
 * Once a call is answered it moves itself into a document picture-in-picture
 * window so it can be left open above whatever else the person is working in.
 * That window is Chromium's, and it is asked for through the ordinary
 * window-open path — which this app deliberately locks down, sending anything
 * that is not the portal to the system browser.
 *
 * So there are two things to hold still, and this checks both:
 *
 *   1. our rule recognises the request (call-window.js), and
 *   2. Electron really does route the request through setWindowOpenHandler, so
 *      denying it really does stop a call popping out. Without this half, the
 *      rule above could be quietly deleted as "dead code" by someone who could
 *      not see what it was for.
 *
 * Run with: env -u ELECTRON_RUN_AS_NODE electron test-call-float.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const callWindow = require('./call-window');

let failures = 0;

function check(label, ok) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 30000).unref();

/* The API is only offered to a secure context, and a data: URL is not one —
 * a file on disk is. */
const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tma-pip-')), 'host.html');
fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>host</title>');

/** Ask the page for a floating window; resolve with what happened. */
function requestFloat(win) {
  return win.webContents.executeJavaScript(`
    (async () => {
      try {
        const w = await documentPictureInPicture.requestWindow({ width: 320, height: 200 });
        w.document.body.innerHTML = 'call';
        return 'opened';
      } catch (e) { return 'refused: ' + (e && e.name); }
    })()
  `, true /* this stands in for the click on Answer */);
}

app.whenReady().then(async () => {
  /* ── 1. The rule itself ── */
  const { isPictureInPictureRequest: isPip } = callWindow;

  check('a document picture-in-picture request is recognised',
    isPip({ url: 'about:blank', frameName: '', disposition: 'other' }) === true);
  check('and so is one identified only by its disposition',
    isPip({ url: '', disposition: 'other' }) === true);
  check('an ordinary link to another site is not one',
    isPip({ url: 'https://example.com/x', disposition: 'foreground-tab' }) === false);
  check('nor is a portal page opened in a new window',
    isPip({ url: 'https://portal.example.com/clients', disposition: 'new-window' }) === false);
  check('and a request with nothing in it is not one',
    isPip() === false);

  /* ── 2. What Electron actually does with it ── */
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadFile(page);

  const seen = [];
  win.webContents.setWindowOpenHandler((details) => {
    seen.push(details);
    // The app's real rule, applied exactly as main.js applies it.
    return isPip(details) ? { action: 'allow' } : { action: 'deny' };
  });

  const allowed = await requestFloat(win);
  check('the request reaches the window-open handler at all', seen.length === 1);
  check(`the shell's own rule lets the call pop out (${allowed})`, allowed === 'opened');
  check('and it arrived looking like a blank pop-up, which is why the rule exists',
    seen.length === 1 && (seen[0].url === 'about:blank' || seen[0].disposition === 'other'));

  await win.webContents.executeJavaScript(
    'documentPictureInPicture.window && documentPictureInPicture.window.close()', true,
  ).catch(() => {});

  // Now the same request with the rule taken away: this is what the app did
  // before, and it is what a call popping out has to never go back to.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denied = await requestFloat(win);
  check(`a handler that denies it really does block the window (${denied})`,
    denied !== 'opened');

  fs.rmSync(path.dirname(page), { recursive: true, force: true });

  console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nOK');
  app.exit(failures ? 1 : 0);
});
