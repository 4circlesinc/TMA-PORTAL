/*
 * Can the app load the portal's front door at all?
 *
 * `protocol.handle('https')` replaces the scheme handler for the whole
 * session, so the main document goes through it too — not just the bundled
 * icons it exists for. That makes every navigation the asset cache's problem,
 * including the one that happens before anybody has signed in.
 *
 * And that is the case no local test could ever have caught: the dev server is
 * http, the handler is registered for https, so against localhost the handler
 * is not in the path at all. It only runs against a real deploy.
 *
 * Run with: npm run test:navigation
 */
const { app, BrowserWindow, protocol, net } = require('electron');

const assetCache = require('./asset-cache');

const PORTAL = process.env.TMA_PORTAL_URL || 'https://portal.tmantoinelaw.com';

protocol.registerSchemesAsPrivileged([
  { scheme: 'https', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 60000).unref();

/* Each probe destroys its window, and Electron quits an app that has none —
   silently, mid-run, with the checks that had passed already printed and the
   rest never reported. */
app.on('window-all-closed', () => {});

/**
 * Load a url in a fresh window and say what actually came up.
 *
 * `did-finish-load` alone is not the question. A 502 finishes loading too, and
 * so does an empty document — the first version of this test passed against
 * the broken handler for exactly that reason. What distinguishes a working
 * front door from a broken one is the HTTP status, where the navigation
 * *ended*, and whether there is a page there at all.
 */
function load(url) {
  return new Promise(resolve => {
    const win = new BrowserWindow({ show: false });
    let settled = false;
    let status = 0;

    const done = async result => {
      if (settled) return;
      settled = true;
      let text = '';
      try {
        text = await win.webContents.executeJavaScript('document.body ? document.body.innerText.trim().length : 0');
      } catch { /* a window with no document */ }
      setTimeout(() => win.destroy(), 0);
      resolve({ ...result, status, text });
    };

    win.webContents.on('did-navigate', (_e, _url, code) => { status = code; });
    win.webContents.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      done({ ok: false, code, description, url: validatedURL });
    });
    win.webContents.on('did-finish-load', () => done({ ok: true, url: win.webContents.getURL() }));

    win.loadURL(url).catch(() => {});
  });
}

app.whenReady().then(async () => {
  const origin = new URL(PORTAL).origin;

  /*
   * That `net.fetch` throws on a manual redirect rather than returning one.
   *
   * This is the fact the bug was made of, and it is the reason the handler
   * must never forward Chromium's `redirect: 'manual'`. Asserted rather than
   * assumed: if a future Electron starts returning an opaque redirect here,
   * this is the line that says so.
   */
  const manual = await net.fetch(`${origin}/`, { redirect: 'manual' })
    .then(res => `returned ${res.status}`)
    .catch(err => `threw: ${err.message}`);
  check('a manual redirect throws, which is why we never forward one',
    manual, 'threw: Redirect was cancelled');

  /*
   * What the front door does with no handler in the way. Everything below has
   * to match this — the asset cache is an optimisation, and an optimisation
   * that changes what the app can reach is a bug by definition.
   */
  const before = await load(`${origin}/`);
  console.log(`  without the handler: ${before.status} at ${before.url} (${before.text} chars)`);
  check('the front door loads with no asset cache installed', before.ok, true);
  check('and lands on the sign-in page', /\/auth\/(login|sign-in)|\/sign-in/.test(before.url), true);

  const status = await assetCache.install(origin);
  console.log(`asset cache: ${status.active ? 'ACTIVE' : 'off'} — ${status.reason}`);

  const after = await load(`${origin}/`);
  console.log(`  with the handler:    ${after.status} at ${after.url} (${after.text} chars)`);
  if (!after.ok) console.log(`   → ${after.description} (${after.code})`);
  check('the front door still loads with the asset cache in the path', after.ok, true);
  // What a rejected handler used to produce: no status at all (ERR_UNEXPECTED),
  // or a 502 with an empty body. Either fails both of the checks below.
  check('with the same status', after.status, before.status);
  /*
   * Deliberately NOT asserted: that the address matches. A navigation that
   * redirects ends up showing the right page at the original address, because
   * the redirect is followed inside the handler and neither Electron API can
   * report it back — see the note on networkFetch. Pinning it here would be
   * pinning a bug we cannot fix without taking the app off the website.
   */
  check('and a page on it', after.text > 0, true);

  const login = await load(`${origin}/auth/login`);
  if (!login.ok) console.log(`   → ${login.description} (${login.code})`);
  check('a page that does not redirect loads either way', login.ok && login.text > 0, true);

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  app.exit(failures ? 1 : 0);
}).catch(err => {
  console.error(err);
  app.exit(2);
});
