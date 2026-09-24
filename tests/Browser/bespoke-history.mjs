/*
 * Bespoke AI: a refresh starts a new chat, and the history rail groups,
 * pins and resizes.
 *
 * The bug this pins down: the conversation id lived in localStorage, so a
 * refresh silently resumed the last thread and expanding the launcher to
 * the full page carried that thread across with it. A reload is the reader
 * saying "start again".
 *
 * Seed + serve (throwaway SQLite, never the live Postgres) — see
 * bespoke-actions.mjs for the same recipe; this file needs a handful of
 * conversations dated across the buckets.
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/bespoke-history.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
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
  try { await page.screenshot({ path: 'tests/Browser/_scratch-bespoke-history-fail.png' }); } catch (e) { /* ignore */ }
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

// A previous run may have left a chat pinned; this test asserts on the
// groups, so it starts from a known state rather than yesterday's.
await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const r = await fetch('/portal/bespoke/conversations', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const j = await r.json();
  for (const c of (j.conversations || []).filter((c) => c.pinned)) {
    await fetch('/portal/bespoke/conversations/' + c.uuid, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ pinned: false }),
    });
  }
});

// ── the history rail ─────────────────────────────────────────────────────
await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-bespoke-page__item', { timeout: 8000 });

const groups = await page.$$eval('.tma-bespoke-page__group', (n) => n.map((e) => e.textContent.trim()));
console.log('  groups:', JSON.stringify(groups));
check(groups.includes('Today'), 'history has a Today group');
check(groups.includes('Yesterday'), 'history has a Yesterday group');
check(groups.includes('Previous 7 days'), 'history has a Previous 7 days group');
check(groups.includes('Previous 30 days'), 'history has a Previous 30 days group');
check(groups.some((g) => /\d{4}/.test(g)), 'older chats group under a month and year');

// ── refresh starts a new chat ────────────────────────────────────────────
await page.click('.tma-bespoke-page__item:not(.tma-bespoke-page__group)');
await page.waitForTimeout(800);
const opened = page.url();
check(/\/bespoke-ai\/[0-9a-f-]{36}$/.test(opened), 'clicking a chat opens it at its own URL');

const beforeCount = await page.$$eval('.tma-bespoke__row', (n) => n.length);
check(beforeCount > 0, 'the opened chat shows its messages');

// A reload of the BARE page is the reader starting again.
await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const afterRows = await page.$$eval('.tma-bespoke__row', (n) => n.length);
const afterTitle = await page.$eval('[data-bespoke-page-title]', (e) => e.textContent.trim());
check(afterRows === 0, `refreshing lands on an empty chat (rows=${afterRows})`);
check(afterTitle === 'New chat', `refreshing shows "New chat" (got "${afterTitle}")`);

// The deep link still works: it is the reader asking for that thread.
await page.goto(opened, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const deepRows = await page.$$eval('.tma-bespoke__row', (n) => n.length);
check(deepRows > 0, 'a chat URL still opens that chat');

// ── the launcher does not leak its thread to the page ────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const stored = await page.evaluate(() => {
  try { return localStorage.getItem('tma.bespoke.conversationId'); } catch (e) { return 'unreadable'; }
});
check(stored === null, `the conversation id is not left in localStorage (got ${JSON.stringify(stored)})`);

// ── pin from the right-click menu ────────────────────────────────────────
await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-bespoke-page__item', { timeout: 8000 });
const firstTitle = await page.$eval('.tma-bespoke-page__item .tma-bespoke-page__item-title', (e) => e.textContent.trim());
await page.click('.tma-bespoke-page__item', { button: 'right' });
await page.waitForSelector('.tma-bespoke-menu', { timeout: 4000 });
const items = await page.$$eval('.tma-bespoke-menu__item', (n) => n.map((e) => e.textContent.trim()));
check(items.join(',') === 'Pin to top,Rename,Delete', `right-click offers pin, rename and delete (${items.join(', ')})`);

await page.locator('.tma-bespoke-menu__item').first().click();
await page.waitForTimeout(1000);
const pinnedGroups = await page.$$eval('.tma-bespoke-page__group', (n) => n.map((e) => e.textContent.trim()));
check(pinnedGroups[0] === 'Pinned', `a pinned chat gets its own group at the top (${pinnedGroups[0]})`);
const pinnedFirst = await page.$eval('.tma-bespoke-page__item .tma-bespoke-page__item-title', (e) => e.textContent.trim());
check(pinnedFirst.includes(firstTitle), 'the pinned chat is the one that was pinned');

// Unpin puts it back.
await page.click('.tma-bespoke-page__item', { button: 'right' });
await page.waitForSelector('.tma-bespoke-menu', { timeout: 4000 });
const unpinLabel = await page.$eval('.tma-bespoke-menu__item', (e) => e.textContent.trim());
check(unpinLabel === 'Unpin', `a pinned chat offers Unpin (${unpinLabel})`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check(await page.$('.tma-bespoke-menu') === null, 'Escape closes the menu');

// ── the rail resizes ─────────────────────────────────────────────────────
const railBefore = await page.$eval('.tma-bespoke-page__rail', (e) => e.getBoundingClientRect().width);
const handle = await page.$('[data-bespoke-page-resizer]');
check(!!handle, 'the rail has a resize handle');
const box = await handle.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
const railAfter = await page.$eval('.tma-bespoke-page__rail', (e) => e.getBoundingClientRect().width);
check(railAfter > railBefore + 40, `dragging widens the rail (${Math.round(railBefore)} -> ${Math.round(railAfter)})`);

// And it is remembered.
await page.goto(`${BASE}/bespoke-ai`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const railKept = await page.$eval('.tma-bespoke-page__rail', (e) => e.getBoundingClientRect().width);
check(Math.abs(railKept - railAfter) < 24, `the width is remembered (${Math.round(railKept)})`);

await page.screenshot({ path: 'tests/Browser/bespoke-history.png' });

// Leave the account as it was found.
await page.evaluate(async () => {
  const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const r = await fetch('/portal/bespoke/conversations', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const j = await r.json();
  for (const c of (j.conversations || []).filter((c) => c.pinned)) {
    await fetch('/portal/bespoke/conversations/' + c.uuid, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ pinned: false }),
    });
  }
});

if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
if (fail.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  - ' + f));
} else {
  console.log('\nall passed');
}
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
