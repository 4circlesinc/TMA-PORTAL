/* Does a non-messages notification actually raise a banner now? */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const HOST_BRIDGE = require('./host-bridge');

const STORE = fs.readFileSync('../public/js/notify-store.js', 'utf8');
let failures = 0;
const check = (l, g, w) => { const ok = g === w; if (!ok) failures++; console.log(`${ok?'PASS':'FAIL'}  ${l}: expected ${JSON.stringify(w)}, got ${JSON.stringify(g)}`); };

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, p, cb) => cb(p === 'notifications'));

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL('data:text/html,<title>t</title>');

  // Capture what the store hands to the OS instead of really notifying.
  await win.webContents.executeJavaScript(`
    window.__raised = [];
    window.Notification = function (title, opts) { window.__raised.push({ title, body: opts.body, silent: opts.silent }); this.close = function(){}; };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
    document.hasFocus = function () { return false; };   // backgrounded
    window.__TMA_SITE_ROOT = '';
  `, true);

  await win.webContents.executeJavaScript(STORE, true);
  await win.webContents.executeJavaScript(
    "window.TMADesktopNotify.applyPrefs({ enabled: true, preview: true })", true);

  const raise = (module, title, message) => win.webContents.executeJavaScript(
    `window.TMADesktopNotify.notify(${JSON.stringify({ id: module + Math.random(), module, title, message, createdAt: 't' })}); window.__raised.length`, true);

  check('email raises a banner', await raise('email', 'New email from Dana', 'Contract'), 1);
  check('messages still raises', await raise('messages', 'Dana', 'hi'), 2);
  check('calendar raises', await raise('calendar', 'Event moved', 'Tomorrow'), 3);
  check('files raises', await raise('files', 'File shared', 'Deed.pdf'), 4);

  const first = await win.webContents.executeJavaScript('window.__raised[0]', true);
  check('email banner keeps its title', first.title, 'New email from Dana');
  check('email banner shows the preview', first.body, 'Contract');

  // Preview off must not leak content, and must not call everything a message.
  await win.webContents.executeJavaScript(
    "window.TMADesktopNotify.applyPrefs({ enabled: true, preview: false })", true);
  await raise('email', 'New email', 'secret subject');
  const quiet = await win.webContents.executeJavaScript('window.__raised[window.__raised.length-1]', true);
  check('preview off hides the subject', quiet.body, 'New email');

  /*
   * Sound. The banner used to be hard-coded silent because messages.js played
   * the tone — which it only did for messages, and only for a conversation it
   * had already loaded, so everything else arrived in silence.
   */
  const js = (expr) => win.webContents.executeJavaScript(expr, true);
  const lastSilent = () => js('window.__raised[window.__raised.length-1].silent');

  await js("window.TMADesktopNotify.applyPrefs({ enabled: true, preview: true })");

  await raise('email', 'New email', 'Contract');
  check('an email banner is not silenced', await lastSilent(), false);

  await raise('calendar', 'Event moved', 'Tomorrow');
  check('a calendar banner is not silenced', await lastSilent(), false);

  check('willSound() while backgrounded', await js('window.TMADesktopNotify.willSound()'), true);

  // Switching notification sounds off must silence the banner, not just the
  // in-app tone — otherwise turning it off makes no difference in background.
  await js('window.TMAMessagingSettings = { notificationSounds: false }');
  await raise('email', 'New email', 'Contract');
  check('sounds off silences the banner', await lastSilent(), true);
  check('willSound() is false with sounds off', await js('window.TMADesktopNotify.willSound()'), false);

  // Unset is on: someone who never opened the setting should still hear it.
  await js('window.TMAMessagingSettings = {}');
  await raise('email', 'New email', 'Contract');
  check('unset preference still sounds', await lastSilent(), false);

  // In the foreground the page owns the tone, so the banner must not claim it.
  // Assignments must not evaluate to a function: executeJavaScript sends the
  // result back over IPC, and a function cannot be cloned — the promise then
  // never settles and the run hangs rather than failing.
  await js('document.hasFocus = function () { return true; }; void 0;');
  check('willSound() is false when in front', await js('window.TMADesktopNotify.willSound()'), false);

  await js('document.hasFocus = function () { return false; }; void 0;');
  await js("window.TMADesktopNotify.applyPrefs({ enabled: false, preview: true })");
  check('willSound() is false when notifications are off', await js('window.TMADesktopNotify.willSound()'), false);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
