/*
 * The page in a browser under the edge's 429: it stops asking until the edge lets it.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/edge-rate-limit.mjs
 *
 * Standard throwaway server (e2e@example.com, FEATURE_CIP=true,
 * MAIL_MAILER=log). Laravel Cloud's edge blocks an IP that sends more than
 * 100 requests a minute, for five minutes; every screen said "Request failed"
 * and kept asking, and every reload asked for everything again. The edge is
 * played here by answering the page's fetches 429 with no X-RateLimit-*
 * headers (the portal's own throttle always sends them).
 *
 * Checks: the portal's own 429 is left alone; the edge's 429 reads as "Too
 * many requests" (not "Request failed") and is said once in a toast; while
 * cooling, reads are not sent; a send still goes; a reload during the
 * cool-down asks once instead of ~50 times; a reload after the edge lets go
 * asks normally; the probe ends a cool-down on its own; hidden screens'
 * pictures are lazy and the ones in view are all drawn.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const MESSAGE = 'Too many requests from this network. Trying again shortly.';
const code = () => { const t = readFileSync(LOG, 'utf8'); const h = [...t.matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)]; return h.length ? h[h.length - 1][1] : null; };
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + m); if (!ok) fails++; };
let browser;
try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ channel: 'chrome' }); }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
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
check(await page.evaluate(() => !!window.TMARateLimit && !window.TMARateLimit.coolingDown()), 'the rate limiter is loaded and calm');

// Pictures: hidden screens' icons wait; every picture in view is drawn.
const pics = await page.evaluate(() => {
  const m = window.TMALazyPictures && window.TMALazyPictures.mark;
  let inView = 0, broken = 0, eagerHidden = 0;
  for (const im of document.images) {
    const src = im.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) continue;
    const r = im.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && im.offsetParent !== null && r.bottom > 0 && r.top < innerHeight;
    if (shown) { inView++; if (im.complete && im.naturalWidth === 0) broken++; }
    else if (/^(\/?images\/|\/media\/avatars\/)/.test(src) && im.loading !== 'lazy') eagerHidden++;
  }
  return {
    inView, broken, eagerHidden,
    icon: m && m('<span><img class="x" src="images/icons/tma/Line-16.svg" alt=""></span>'),
    face: m && m('<img alt="" src="' + location.origin + '/media/avatars/a.jpg">'),
    blob: m && m('<img src="blob:abc">'),
    group: m && m('<img src="/portal/messaging/conversations/7/photo?v=2" alt="">'),
    attachment: m && m('<img src="/portal/messaging/attachments/9" alt="">'),
    own: m && m('<img loading="eager" src="images/a.svg">'),
  };
});
check(pics.icon && pics.icon.includes('<img loading="lazy" class="x"'), 'a portal icon written as HTML is given loading="lazy"');
check(pics.face && pics.face.includes('loading="lazy"'), 'so is a face on this origin');
check(pics.group && pics.group.includes('loading="lazy"'), "and a group's photo");
check(pics.attachment === '<img src="/portal/messaging/attachments/9" alt="">', "a chat's photo is left to load as before");
check(pics.blob === '<img src="blob:abc">' && pics.own === '<img loading="eager" src="images/a.svg">', 'blob: pictures and an <img> that says loading= are left alone');
check(pics.inView > 10 && pics.broken === 0, `every picture in view is drawn (${pics.inView} shown, ${pics.broken} broken)`);
check(pics.eagerHidden < 20, `hidden screens' pictures wait to be shown (${pics.eagerHidden} still eager)`);

// The portal's own throttle on one route (X-RateLimit-Limit) is not the edge.
await page.route('**/portal/notifications/count', r => r.fulfill({ status: 429, headers: { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0', 'Retry-After': '30' }, body: '{"message":"Too Many Attempts."}' }));
const own = await page.evaluate(async () => { const r = await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' } }); return { status: r.status, body: await r.text(), cooling: window.TMARateLimit.coolingDown() }; });
check(own.status === 429 && /Too Many Attempts/.test(own.body) && !own.cooling, "the portal's own 429 passes through and does not cool the page");
await page.unroute('**/portal/notifications/count');

// The edge refuses every fetch from here on.
let edgeHits = 0, writeHits = 0, refusing = true;
const edge = r => {
  const req = r.request();
  if (!refusing || !['fetch', 'xhr'].includes(req.resourceType())) return r.continue();
  if (req.method() === 'GET' || req.method() === 'HEAD') edgeHits++; else writeHits++;
  return r.fulfill({ status: 429, headers: { 'Content-Type': 'text/plain' }, body: 'error code: 1015' });
};
await page.route(u => u.origin === new URL(BASE).origin, edge);

const first = await page.evaluate(async () => { try { await window.TMAMessagingAPI.conversations(); return 'no error'; } catch (e) { return e.message; } });
check(first === MESSAGE, `a screen's error says "${first}", not "Request failed"`);
check(await page.evaluate(() => window.TMARateLimit.coolingDown()), 'the page is cooling down');
await page.waitForTimeout(400);
const toast = await page.evaluate(() => { const h = document.querySelector('[data-toast-floating-host]'); return h && h.hasAttribute('data-visible') ? h.textContent.trim() : null; });
check(toast && toast.includes('Too many requests'), `one toast says why (${toast})`);

const before = edgeHits;
const held = await page.evaluate(async () => {
  const urls = ['/portal/notifications/count', '/portal/mail', '/portal/calendar/events', '/me', '/portal/cip/applications?perPage=150&page=1'];
  const out = [];
  for (let i = 0; i < 20; i++) { const r = await fetch(urls[i % urls.length], { headers: { Accept: 'application/json' } }); out.push(r.status + (r.headers.get('X-TMA-Held') ? 'h' : '')); }
  return out;
});
check(edgeHits === before && held.every(s => s === '429h'), `while cooling, 20 reads are answered without asking (${edgeHits - before} sent)`);

const sendsBefore = writeHits;
await page.evaluate(() => fetch('/portal/messaging/heartbeat', { method: 'POST', headers: { 'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') || {}).content || '', Accept: 'application/json' } }).catch(() => null));
check(writeHits === sendsBefore + 1, 'a write still goes out while cooling');
check(await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('tma.rateLimit')).until > Date.now(); } catch (e) { return false; } }), 'the cool-down is kept for a reload and the other tabs');

// A reload while the edge still refuses: one probe, not the whole boot.
edgeHits = 0;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
check(edgeHits <= 4, `a reload during the cool-down asks ${edgeHits} time(s) (the boot asks ~50)`);
check(await page.evaluate(() => window.TMARateLimit.coolingDown()), 'and stays cooling while refused');

// The edge lets go; a reload asks once, is answered, and the page is back.
refusing = false;
let asked = 0;
const counter = r => { if (['fetch', 'xhr'].includes(r.request().resourceType())) asked++; return r.continue(); };
await page.unroute(u => u.origin === new URL(BASE).origin, edge);
await page.route(u => u.origin === new URL(BASE).origin, counter);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
check(!(await page.evaluate(() => window.TMARateLimit.coolingDown())), 'after the edge lets go, the first answer ends the cool-down');
check(asked > 15, `and the page loads as usual (${asked} requests)`);
check(await page.evaluate(() => localStorage.getItem('tma.rateLimit') === null), 'for every tab');
await page.unroute(u => u.origin === new URL(BASE).origin, counter);

// The probe on its own: a fresh refusal, the edge lets go, the next read after 15 s ends it.
refusing = true;
await page.route(u => u.origin === new URL(BASE).origin, edge);
await page.evaluate(() => fetch('/portal/notifications/count').catch(() => null));
check(await page.evaluate(() => window.TMARateLimit.coolingDown()), 'refused again');
refusing = false;
const early = await page.evaluate(async () => (await fetch('/portal/notifications/count')).headers.get('X-TMA-Held'));
check(early === '1', 'a read inside the first 15 s is still held');
await page.waitForTimeout(15500);
const probe = await page.evaluate(async () => { const r = await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' } }); return { status: r.status, cooling: window.TMARateLimit.coolingDown() }; });
check(probe.status === 200 && !probe.cooling, `the probe after 15 s is answered and ends the cool-down (${probe.status})`);
await page.unroute(u => u.origin === new URL(BASE).origin, edge);

check(errors.length === 0, 'no page errors ' + errors.join(' | '));
console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
