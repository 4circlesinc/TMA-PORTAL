/*
 * The apps under a 429: the edge refusing a connection that asked too much.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/app-rate-limit.mjs
 *
 * Runs the page as the iPhone app does (window.TMADesktop), against the
 * standard throwaway server (e2e@example.com, FEATURE_CIP=true, MAIL_MAILER=log)
 * with at least one conversation. The edge's 429 is played by intercepting the
 * threads' requests. Before rate-limit.js the offline download walked every
 * conversation through the refusals and the catch-up walkers restarted on
 * every failed /me, which kept the whole connection refused; now one 429
 * stops the download, the walkers stand back for the cool-down, a screen gets
 * the copy it held, and a message the person sends still goes.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const code = () => { const t = readFileSync(LOG, 'utf8'); const h = [...t.matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)]; return h.length ? h[h.length - 1][1] : null; };
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + m); if (!ok) fails++; };
let browser;
try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ channel: 'chrome' }); }
const ctx = await browser.newContext({ viewport: { width: 402, height: 778 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {}
  window.TMADesktop = { isDesktop: true, isIOS: true, platform: 'ios', store: 'app-store', version: '0.1.0',
    keepFiles: function (f, each, done) { setTimeout(function () { done && done(); }, 10); }, readKeptFile: function () { return Promise.resolve(null); },
    clearFiles: function () {}, setEdgeBack: function () {}, haptic: function () {}, glassChrome: false, setGlassChrome: function () {}, canGoBack: true };
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
await page.goto(BASE + '/auth/login', { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
await page.waitForTimeout(900);
if (page.url().includes('/auth/login-code')) {
  await page.waitForTimeout(900);
  await page.locator('.tma-auth__otp-digit').first().click();
  await page.keyboard.type(code(), { delay: 30 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(900);
}
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
}
await page.waitForTimeout(4000);
check(await page.evaluate(() => !!window.TMARateLimit && !window.TMARateLimit.coolingDown()), 'the rate-limit switch is loaded and calm');
// A real conversation to send in at the end, noted before the fake list
// below is kept as this device's copy of the inbox.
const realConversation = await page.evaluate(async () => {
  const list = await window.TMAMessagingAPI.conversations();
  const first = ((list && list.conversations) || [])[0];
  return first ? first.id : null;
});

// Fifty conversations, and the edge refusing every thread: Cloudflare's own 429.
const fake = Array.from({ length: 50 }, (_, i) => ({ id: 'c' + i, type: 'direct', name: 'Person ' + i, timestamp: new Date(Date.now() - i * 1000).toISOString() }));
let threadAsks = 0, syncAsks = 0;
await page.route('**/portal/messaging/conversations', r => r.request().method() === 'GET'
  ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: fake, me: { id: 1 }, settings: {}, tabCounts: {} }) })
  : r.continue());
await page.route('**/portal/messaging/conversations/*/messages*', r => { threadAsks++; r.fulfill({ status: 429, headers: { 'Retry-After': '20', 'Content-Type': 'text/html' }, body: 'error code: 1015' }); });
await page.route('**/portal/*/sync*', r => { syncAsks++; r.continue(); });
await page.route('**/portal/*/*/sync*', r => { syncAsks++; r.continue(); });

await page.evaluate(() => window.TMAOfflineDownload && window.TMAOfflineDownload.run());
await page.waitForTimeout(6000);
check(threadAsks <= 2, `refused once, the download stops instead of walking all 50 threads (asked ${threadAsks})`);
check(await page.evaluate(() => window.TMARateLimit.coolingDown()), 'and the app is cooling down (Retry-After honoured)');
const until = await page.evaluate(() => window.TMARateLimit.until() - Date.now());
check(until > 10000 && until <= 60000, `cool-down length from Retry-After/minimum (${Math.round(until / 1000)}s)`);

// While cooling, the walkers and a new download run stand back.
const before = syncAsks; const asksBefore = threadAsks;
await page.evaluate(() => { [window.TMACipSync, window.TMAFilesSync, window.TMAClientsSync].forEach(w => w && w.run()); return window.TMAOfflineDownload.run(); });
await page.waitForTimeout(3000);
check(syncAsks === before, `the catch-up walkers skip while cooling (${syncAsks - before} asks)`);
check(threadAsks === asksBefore, 'a new download run does not start while cooling');

// A screen's read answered 429 gets the kept copy instead of a failure.
const kept = await page.evaluate(async () => {
  await window.TMAStore.put('http:/portal/notifications/count', { status: 200, type: 'application/json', body: '{"count":7}', at: Date.now() });
  const res = await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  return { status: res.status, kept: res.headers.get('x-tma-kept'), body: await res.text() };
});
check(kept.status === 200 && kept.kept === '1' && /7/.test(kept.body), 'while cooling, a screen gets the copy it held, not "Request failed"');

// A person's send still goes through.
await page.unroute('**/portal/messaging/conversations'); await page.unroute('**/portal/messaging/conversations/*/messages*');
const sent = await page.evaluate(async (id) => {
  try {
    if (!id) return 'no conversation to send in';
    const r = await window.TMAMessagingAPI.send(id, { body: 'still sends', nonce: window.TMAMessagingAPI.newNonce() });
    return !!(r && r.message);
  } catch (e) { return 'error ' + e.message; }
}, realConversation);
check(sent === true, `a message the person sends still goes (${sent})`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
