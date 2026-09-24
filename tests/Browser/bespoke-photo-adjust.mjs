/*
 * A 2×2 stays adjustable after the turn that made it.
 *
 * The reply promises Adjust, but the editor used to live only in the live
 * turn: reopening the chat left a flat thumbnail and no way to re-frame.
 * The crop now records the upload it was cut from, and the tile carries an
 * Adjust that re-opens the editor against those original pixels.
 *
 * Seed + serve as in bespoke-actions.mjs, then:
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/bespoke-photo-adjust.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const t = readFileSync(LOG, 'utf8');
  const h = [...t.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return h.length ? h[h.length - 1][1] : null;
}
try { writeFileSync(LOG, ''); } catch (e) { /* no log yet */ }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|favicon/i;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

async function onFailure(err) {
  console.log('STEP FAILED:', String(err).split('\n')[0]);
  try { await page.screenshot({ path: 'tests/Browser/_scratch-adjust-fail.png' }); } catch (e) { /* ignore */ }
  if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
  process.exit(1);
}
process.on('uncaughtException', onFailure);
process.on('unhandledRejection', onFailure);

// ── sign in ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login-code')) {
  await page.waitForTimeout(900);
  const code = loginCode();
  if (!code) throw new Error(`no sign-in code in ${LOG}`);
  await page.locator('.tma-auth__otp-digit').first().click();
  await page.keyboard.type(code, { delay: 40 });
  const trust = page.locator('input[type="checkbox"]').first();
  if (await trust.count()) await trust.check().catch(() => {});
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(900);
}
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/')) throw new Error('login failed: ' + page.url());
console.log('logged in');

await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// ── a chat holding a photo and its 2×2 ───────────────────────────────────
// Built through the real endpoints, the way the browser builds it.
const made = await page.evaluate(async () => {
  const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const conversationId = crypto.randomUUID();

  function shot(w, h, face) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    if (face) {
      x.fillStyle = '#d8a77f';
      x.beginPath(); x.ellipse(w * 0.5, h * 0.42, w * 0.16, h * 0.22, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2b2b2b'; x.fillRect(w * 0.3, h * 0.72, w * 0.4, h * 0.28);
    }
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  }

  async function put(blob, name, extra) {
    const fd = new FormData();
    fd.append('file', blob, name);
    fd.append('conversationId', conversationId);
    for (const [k, v] of Object.entries(extra || {})) fd.append(k, v);
    const r = await fetch('/portal/bespoke/attachments', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-XSRF-TOKEN': csrf },
    });
    return (await r.json()).attachment;
  }

  // A turn, so the derived file has a message to hang from.
  const original = await put(await shot(1000, 700, true), 'scan.jpg', {});
  await fetch('/portal/bespoke/chat', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrf },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'crop the passport photo out this image' }],
      conversationId, attachments: [original.id],
    }),
  });
  const crop = await put(await shot(600, 600, true), 'scan-2x2.jpg', { kind: 'derived', sourceId: original.id });

  return { conversationId, originalId: original.id, cropId: crop.id, cropSource: crop.sourceId };
});

check(made.cropSource === made.originalId, 'the saved 2×2 records the photo it was cut from');

// ── reopen the chat: the crop is still adjustable ────────────────────────
await page.goto(`${BASE}/bespoke-ai/${made.conversationId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const tiles = await page.$$eval('.tma-bespoke__preview', (n) => n.length);
check(tiles > 0, `the reopened chat shows its files (${tiles})`);

const adjust = page.locator('[data-bespoke-preview-adjust]').first();
await adjust.waitFor({ state: 'visible', timeout: 6000 });
check(await adjust.count() > 0, 'the 2×2 tile carries an Adjust button after a reopen');

const adjustCount = await page.locator('[data-bespoke-preview-adjust]').count();
check(adjustCount === 1, `only the derived crop offers Adjust, not the upload (${adjustCount})`);

// ── it re-opens the editor, against the ORIGINAL ─────────────────────────
// Collect every attachment fetched from here on. The editor loads the
// original to re-frame from; the tile it then files fetches the new crop,
// so this asks "was the original fetched", not "what was fetched last".
const fetched = [];
page.on('request', (r) => {
  const u = r.url();
  if (/\/portal\/bespoke\/attachments\/[0-9a-f-]{36}$/.test(u)) fetched.push(u.split('/').pop());
});

await adjust.click();
await page.waitForSelector('[data-bespoke-photo-stage]', { timeout: 10000 });
await page.waitForTimeout(2500);

check(fetched.includes(made.originalId),
  `re-framing loads the original photo to cut from (fetched ${fetched.length})`);

const editorShown = await page.$eval('[data-bespoke-photo-editor]', (e) => !e.hidden);
check(editorShown, 'the framing editor is open');

const makingHidden = await page.$eval('[data-bespoke-photo-making]',
  (e) => getComputedStyle(e).display === 'none');
check(makingHidden, 'the generating animation has gone once the editor is up');

const canvasSquare = await page.$eval('[data-bespoke-photo-canvas]',
  (c) => c.width === c.height && c.width > 0);
check(canvasSquare, 'the canvas is square, so the photo is not stretched');

await page.screenshot({ path: 'tests/Browser/bespoke-photo-adjust.png' });

if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
if (fail.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  - ' + f));
} else {
  console.log('\nall passed');
}
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
