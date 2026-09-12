/*
 * The office map in Status settings must draw: Leaflet loads from the portal
 * itself (public/js/vendor/leaflet), never from a CDN the Content-Security-
 * Policy refuses, and tiles arrive from openstreetmap.org.
 *
 * Runs against the Docker stack (admin@localhost / password). The new-device
 * sign-in code is only in the app container's stdout, so it is read from
 * `docker compose logs app`. Rebuild the bundle first (node scripts/build-assets.mjs).
 *
 *   TMA_BASE_URL=http://127.0.0.1:8001 node tests/Browser/presence-map.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8001';
const SHOT = process.env.TMA_SHOT || '';
const EMAIL = process.env.TMA_EMAIL || 'admin@localhost';
const PASSWORD = process.env.TMA_PASSWORD || 'password';

function loginCode(since) {
  let text = '';
  try {
    text = execSync(`docker compose logs --since ${since} --no-log-prefix app`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return null; }
  const html = [...text.matchAll(/letter-spacing:\s*\.24em[^>]*>\s*(\d{6})\s*</g)].map((m) => m[1]);
  if (html.length) return html[html.length - 1];
  const plain = text.split('\n').map((l) => l.trim()).filter((l) => /^\d{6}$/.test(l) && l !== '000000');
  return plain.length ? plain[plain.length - 1] : null;
}

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
const cspRefusals = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e));
page.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to (load|execute|apply)/i.test(t)) cspRefusals.push(t);
});

process.on('unhandledRejection', async (err) => { console.log('STEP FAILED:', String(err).split('\n')[0]); process.exit(1); });
process.on('uncaughtException', async (err) => { console.log('STEP FAILED:', String(err).split('\n')[0]); process.exit(1); });

// ── sign in ──────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
if (page.url().includes('/auth/login-code')) {
  let code = null;
  for (let i = 0; i < 10 && !code; i++) {
    await page.waitForTimeout(800);
    code = loginCode(startedAt);
  }
  if (!code) throw new Error('no sign-in code in docker compose logs app');
  await page.locator('.tma-auth__otp-digit').first().click();
  await page.keyboard.type(code, { delay: 40 });
  const trust = page.locator('input[type="checkbox"]').first();
  if (await trust.count()) await trust.check().catch(() => {});
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(900);
}
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]')]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/')) throw new Error('login failed: ' + page.url());
console.log('logged in');

// ── open Status settings ─────────────────────────────────────────────────
await page.waitForSelector('[data-presence-indicator]', { timeout: 20000 });
await page.waitForFunction(() => !!(window.TMAPresence), null, { timeout: 15000 });
await page.click('[data-presence-indicator]');
await page.waitForSelector('[data-presence-settings]', { state: 'visible', timeout: 8000 });
await page.click('[data-presence-settings]');
await page.waitForSelector('[data-presence-settings-modal] [data-loc-office-map]', { timeout: 10000 });

// ── the map draws ────────────────────────────────────────────────────────
const drew = await page.waitForSelector('[data-loc-office-map].leaflet-container', { timeout: 15000 }).then(() => true).catch(() => false);
check(drew, 'office map has a Leaflet container');
const fallback = await page.locator('[data-loc-office-map] .tma-presence-loc__map-fallback').count();
check(fallback === 0, 'no "Map unavailable" fallback');

const sources = await page.evaluate(() => ({
  css: (document.getElementById('tma-leaflet-css') || {}).href || '',
  script: [...document.scripts].map((s) => s.src).find((s) => /leaflet/.test(s)) || '',
  L: !!window.L,
}));
check(sources.L, 'window.L is defined');
check(sources.script.startsWith(new URL(BASE).origin), 'leaflet.js served from the portal origin: ' + sources.script);
check(sources.css.startsWith(new URL(BASE).origin), 'leaflet.css served from the portal origin: ' + sources.css);

const tiles = await page.waitForFunction(() => document.querySelectorAll('[data-loc-office-map] .leaflet-tile-loaded').length > 0, null, { timeout: 20000 }).then(() => true).catch(() => false);
check(tiles, 'at least one OpenStreetMap tile loaded');

// ── clicking the map places a pin ────────────────────────────────────────
const box = await page.locator('[data-loc-office-map]').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
const pinned = await page.waitForSelector('[data-loc-office-map] .leaflet-marker-icon', { timeout: 8000 }).then(() => true).catch(() => false);
check(pinned, 'clicking the map places a marker');
const coords = await page.locator('[data-loc-office-coords]').textContent();
check(/-?\d+\.\d+,\s*-?\d+\.\d+/.test(coords || ''), 'coordinates are shown: ' + (coords || '').trim());
const markerSrc = await page.locator('[data-loc-office-map] .leaflet-marker-icon').first().getAttribute('src');
check((markerSrc || '').startsWith('js/vendor/leaflet/') || (markerSrc || '').startsWith('/js/vendor/leaflet/') || (markerSrc || '').startsWith(new URL(BASE).origin + '/js/vendor/leaflet/'), 'marker icon served from the portal: ' + markerSrc);

check(cspRefusals.length === 0, 'no Content-Security-Policy refusals' + (cspRefusals.length ? ': ' + cspRefusals[0] : ''));
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

if (SHOT) { await page.waitForTimeout(1500); await page.locator('[data-presence-settings-modal]').screenshot({ path: SHOT }); }

await browser.close();
if (fail.length) { console.log('\nFAILED:'); fail.forEach((f) => console.log('  ✗', f)); process.exit(1); }
console.log('\nall checks passed');
