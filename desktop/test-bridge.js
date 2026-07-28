/*
 * Verifies everything the page publishes reaches the main process, without
 * needing a signed-in portal:
 *
 *   fake page state -> host-bridge -> <html data-tma-*> -> preload -> IPC
 *
 * Run with: npm test
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const HOST_BRIDGE = require('./host-bridge');
const { parseManifest, compareVersions } = require('./updater');
const { installCloseToBackground } = require('./window-policy');

// Stands in for notify-store.js and messaging-calls.js.
const PAGE = `
  <meta charset="utf-8"><title>bridge test</title>
  <script>
    function store(key, initial) {
      var subs = [];
      var s = {};
      s[key] = initial;
      return {
        state: s,
        subscribe: function (fn) { subs.push(fn); },
        refreshCount: function () { return Promise.resolve(s); },
        set: function (v) { s[key] = v; subs.forEach(function (fn) { fn(s); }); },
      };
    }
    window.TMANotifications = store('unread', 3);
    window.TMAActivities = store('newCount', 4);

    // messaging-calls.js writes this attribute directly.
    window.setCallPhase = function (phase) {
      if (phase) document.documentElement.setAttribute('data-tma-call', phase);
      else document.documentElement.removeAttribute('data-tma-call');
    };
  </script>
`;

const seen = { badge: [], call: [], focus: 0 };

ipcMain.on('tma:badge', (_e, n) => seen.badge.push(n));
ipcMain.on('tma:call', (_e, phase) => seen.call.push(phase));
ipcMain.on('tma:focus', () => { seen.focus += 1; });

let failures = 0;

function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const settle = () => new Promise((r) => setTimeout(r, 250));
const last = (arr) => arr[arr.length - 1];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });

  const run = (js) => win.webContents.executeJavaScript(js, true);

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  await run(HOST_BRIDGE);
  await settle();

  check('badge: 3 unread + 4 activity', last(seen.badge), 7);

  await run('window.TMANotifications.set(8)');
  await settle();
  check('badge: follows a realtime bump', last(seen.badge), 12);

  await run('window.TMANotifications.set(0); window.TMAActivities.set(0)');
  await settle();
  check('badge: clears when read', last(seen.badge), 0);

  // Call state is relayed on load as idle, which is what clears a stale ring
  // after a navigation. A focus request is an event, so it must not replay.
  check('call: idle on load', last(seen.call), '');
  check('focus: not replayed on load', seen.focus, 0);

  await run('window.setCallPhase("ringing")');
  await settle();
  check('call: ringing', last(seen.call), 'ringing');

  await run('window.setCallPhase("active")');
  await settle();
  check('call: answered', last(seen.call), 'active');

  await run('window.setCallPhase("")');
  await settle();
  check('call: hung up', last(seen.call), '');

  // The portal calls window.focus() when a notification is clicked.
  await run('window.focus()');
  await settle();
  check('focus: relayed from window.focus()', seen.focus, 1);

  testUpdater();
  await testCloseToBackground();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});

/*
 * The behaviour the whole background-app feature rests on. win.close() is
 * exactly what the red button calls — note that window.close() from page
 * script is NOT: the spec makes that a no-op for a window the script did not
 * open, so it looks like this is broken when it is not.
 */
async function testCloseToBackground() {
  let quitting = false;

  const win = new BrowserWindow({ show: false });
  installCloseToBackground(win, () => quitting);

  await win.loadURL('data:text/html,<title>bg</title>');
  win.show();

  win.close();
  await settle();

  check('close: window survives', win.isDestroyed(), false);
  check('close: window is hidden', win.isVisible(), false);

  // And the page behind it is untouched, which is why reopening does not
  // reload and the websocket is never dropped.
  const stillThere = await win.webContents.executeJavaScript('document.title').catch(() => null);
  check('close: page still loaded', stillThere, 'bg');

  win.show();
  check('reopen: shows the same window', win.isVisible(), true);

  // Quit must still be able to end it, or the app becomes unquittable.
  quitting = true;
  win.close();
  await settle();

  check('quit: window really closes', win.isDestroyed(), true);
}

/*
 * The updater decides whether to replace the app the user is running, off a
 * file fetched over the network. Both halves of that decision are here.
 */
function testUpdater() {
  // Real output from electron-builder. The `files:` list repeats url/sha512
  // for the dmg, so a naive line match picks the wrong artifact and hash.
  const manifest = [
    'version: 0.3.0',
    'files:',
    '  - url: TM ANTOINE Portal-0.3.0-arm64-mac.zip',
    '    sha512: ZIPHASH==',
    '    size: 96094319',
    '  - url: TM ANTOINE Portal-0.3.0-arm64.dmg',
    '    sha512: DMGHASH==',
    '    size: 100294070',
    'path: TM ANTOINE Portal-0.3.0-arm64-mac.zip',
    'sha512: ZIPHASH==',
    "releaseDate: '2026-07-28T22:03:27.032Z'",
  ].join('\n');

  const parsed = parseManifest(manifest);

  check('manifest: version', parsed.version, '0.3.0');
  check('manifest: takes the zip, not the dmg', parsed.file, 'TM ANTOINE Portal-0.3.0-arm64-mac.zip');
  check('manifest: takes the top-level hash', parsed.sha512, 'ZIPHASH==');
  check('manifest: rejects junk', parseManifest('not a manifest'), null);

  check('version: newer', compareVersions('0.3.0', '0.2.0') > 0, true);
  check('version: same', compareVersions('0.2.0', '0.2.0'), 0);
  check('version: older is never offered', compareVersions('0.1.9', '0.2.0') < 0, true);
  check('version: 0.10 beats 0.9', compareVersions('0.10.0', '0.9.0') > 0, true);
  check('version: patch counts', compareVersions('1.0.1', '1.0') > 0, true);
}
