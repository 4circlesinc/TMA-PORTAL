/*
 * Verify notifications arrive live over Reverb (§24, §25).
 *
 * Opens the portal, waits for the websocket, then creates a notification for
 * the signed-in user from a *separate* server process (tinker). The bell badge
 * and the store must update with no reload and no scroll reset — a sentinel set
 * on window has to survive.
 *
 * Requires Reverb running and the app server pointed at it (see the header of
 * notifications.mjs plus REVERB_HOST/PORT/SCHEME). The DB path is passed in
 * via E2E_DB. Run: E2E_DB=/path/e2e.sqlite node tests/Browser/notification-realtime.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8899';
const DB = process.env.E2E_DB;
if (!DB) throw new Error('set E2E_DB to the sqlite path');

const REVERB = {
  DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '',
  BROADCAST_CONNECTION: 'reverb', REVERB_APP_ID: '10001', REVERB_APP_KEY: 'localkey',
  REVERB_APP_SECRET: 'localsecret', REVERB_HOST: '127.0.0.1', REVERB_PORT: '8080', REVERB_SCHEME: 'http',
};

function fireNotification() {
  const php = "\\App\\Support\\Notifications\\Notifier::send([" +
    "'user'=>\\App\\Models\\User::where('email','e2e@example.com')->first()," +
    "'actor'=>\\App\\Models\\User::where('email','tom@example.com')->first()," +
    "'type'=>'message.received','title'=>'Realtime ping','action_url'=>'/social/messages']);";
  execFileSync('php', ['artisan', 'tinker', '--execute=' + php], { env: { ...process.env, ...REVERB }, stdio: 'ignore' });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const IGNORE = /Origin not allowed|realtime disabled|broadcasting\/auth/i;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');
console.log('logged in');

// Wait for the websocket to connect and the notification store to be primed.
await page.waitForFunction(() => window.TMAMessagingRealtime && window.TMAMessagingRealtime.connected, { timeout: 15000 })
  .catch(() => {});
const connected = await page.evaluate(() => !!(window.TMAMessagingRealtime && window.TMAMessagingRealtime.connected));
check(connected, 'websocket connected');

await page.waitForFunction(() => window.TMANotifications && window.TMANotifications.state.loaded, { timeout: 10000 });
const before = await page.evaluate(() => window.TMANotifications.state.unread);
await page.evaluate(() => { window.__rtProbe = 'alive'; });

// Give the channel subscription a beat to complete, then fire from the server.
await page.waitForTimeout(1500);
fireNotification();

// The badge and store must move without any reload.
const arrived = await page.waitForFunction((n) => window.TMANotifications.state.unread > n, before, { timeout: 12000 })
  .then(() => true).catch(() => false);
check(arrived, 'a server-fired notification arrived live (unread went up)');

const after = await page.evaluate(() => ({
  unread: window.TMANotifications.state.unread,
  hasItem: window.TMANotifications.state.items.some((i) => i.title === 'Realtime ping'),
  probe: window.__rtProbe,
  badge: (document.querySelector('[data-action="toggle-notifications-popup"] .tma-dash__icon-btn-badge') || {}).textContent,
}));
check(after.unread === before + 1, `unread incremented by one (${before} -> ${after.unread})`);
check(after.hasItem, 'the new item is in the store (smooth append, no refetch)');
check(after.probe === 'alive', 'no page reload — the live update was applied in place (§25)');
check(String(after.badge || '').trim() === String(after.unread), `bell badge reflects the new count (${after.badge})`);

if (errors.length) fail.push('console/page errors: ' + errors.join(' | '));
await browser.close();
if (fail.length) { console.error('\nFAILURES:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('\nReal-time notification checks passed.');
