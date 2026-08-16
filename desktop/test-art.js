/*
 * Art that is missing *in the app* and not in a browser.
 *
 * The portal sweep (tests/Browser/missing-art.mjs) drives Chromium straight at
 * the server and reports nothing. The app is not that: every request in it
 * goes through `protocol.handle('https')`, and a bundled file is answered from
 * disk instead of from the deploy. So an icon can be perfectly correct on the
 * server and still not arrive here, and only running the real handler can say
 * which.
 *
 * This boots the app's own asset cache against a portal, signs in, walks the
 * screens, and reports three things per screen: images that decoded to
 * nothing, requests that failed, and — the one a browser can never tell you —
 * which of those were answered from the bundle rather than the network.
 *
 * Run with: npm run test:art        (add TMA_PORTAL_URL=… for another deploy)
 */
const { app, BrowserWindow, protocol, session } = require('electron');

const assetCache = require('./asset-cache');

const PORTAL = process.env.TMA_PORTAL_URL || 'http://127.0.0.1:8907';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const SCREENS = [
  '/', '/overview', '/clients', '/cbi', '/email', '/social/messages',
  '/social/feed', '/calendar', '/signatures', '/folders', '/workflows',
  '/people', '/users', '/account-settings',
];

/*
 * `protocol.handle` may only replace a scheme the app has declared privileged
 * before it is ready — the same registration main.js does.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'https', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const wait = ms => new Promise(r => setTimeout(r, ms));

/* What the app failed to fetch, and what it answered from disk. */
const failed = new Map();
const fromBundle = new Set();

/** The audit, run inside the page. Mirrors tests/Browser/missing-art.mjs. */
const AUDIT = `(() => {
  const seen = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const broken = [...document.images]
    .filter(img => seen(img) && img.complete && img.naturalWidth === 0)
    .map(img => img.getAttribute('src') || '(no src)');
  const blank = [];
  document.querySelectorAll('span, i, div').forEach(el => {
    if (!seen(el)) return;
    const cs = getComputedStyle(el);
    const mask = cs.maskImage || cs.webkitMaskImage;
    if (!/icon|glyph|logo|mark/i.test(el.className || '')) return;
    if ((!mask || mask === 'none') && cs.backgroundImage === 'none'
        && !el.querySelector('img, svg') && !el.textContent.trim()) {
      blank.push(String(el.className).slice(0, 80));
    }
  });
  return { broken: [...new Set(broken)], blank: [...new Set(blank)] };
})()`;

app.whenReady().then(async () => {
  const origin = new URL(PORTAL).origin;

  const status = await assetCache.install(origin);
  console.log(`asset cache: ${status.active ? 'ACTIVE' : 'off'} — ${status.reason}` +
    (status.active ? `  (${status.count} of ${status.total} from disk, ${status.stale} from the network)` : ''));

  /*
   * Which requests were answered from the bundle. The handler above does not
   * announce itself, so this reads the response headers: the bundle stamps a
   * one-year immutable cache, and the portal does not.
   */
  session.defaultSession.webRequest.onCompleted({ urls: ['*://*/*'] }, details => {
    if (details.statusCode >= 400) failed.set(`${details.statusCode} ${new URL(details.url).pathname}`, true);
  });
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, cb) => {
    const cc = (details.responseHeaders?.['cache-control'] || details.responseHeaders?.['Cache-Control'] || [])[0] || '';
    if (cc.includes('immutable')) fromBundle.add(new URL(details.url).pathname);
    cb({});
  });

  const win = new BrowserWindow({ show: false, width: 1440, height: 960 });
  const page = win.webContents;

  await page.loadURL(`${PORTAL}/auth/login`);
  await wait(1500);
  await page.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('button, a')].find(e => /Sign in with Email/i.test(e.textContent));
      if (b) b.click();
    })()`);
  await wait(1200);
  await page.executeJavaScript(`
    (() => {
      document.querySelector('input[name="email"]').value = ${JSON.stringify(EMAIL)};
      document.querySelector('input[name="email"]').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('input[name="password"]').value = ${JSON.stringify(PASSWORD)};
      document.querySelector('input[name="password"]').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').submit();
    })()`);
  await wait(3000);
  if (page.getURL().includes('stay-signed-in')) {
    await page.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('button, a')].find(e => /stay signed in/i.test(e.textContent));
        if (b) b.click();
      })()`);
    await wait(2500);
  }

  const report = [];
  for (const path of SCREENS) {
    await page.loadURL(PORTAL + path);
    await wait(2500);
    const found = await page.executeJavaScript(AUDIT);
    if (found.broken.length || found.blank.length) report.push({ path, ...found });
    console.log(`${path.padEnd(20)} broken:${found.broken.length}  blank:${found.blank.length}`);
  }

  console.log('\n── failed requests ──');
  if (!failed.size) console.log('  none');
  [...failed.keys()].sort().forEach(k => console.log('  ' + k));

  console.log(`\n── served from the bundle ── ${fromBundle.size} path(s)`);

  console.log('\n── detail ──');
  if (!report.length) console.log('  nothing missing');
  report.forEach(r => {
    console.log(`\n${r.path}`);
    r.broken.slice(0, 20).forEach(s => console.log('  broken img:', s));
    r.blank.slice(0, 20).forEach(s => console.log('  blank icon:', s));
  });

  app.exit(report.length ? 1 : 0);
}).catch(err => {
  console.error(err);
  app.exit(2);
});
