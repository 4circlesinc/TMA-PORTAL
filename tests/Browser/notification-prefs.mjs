/*
 * Verify read-management (§20) and notification preferences (§21):
 *   - dismissing a notification removes it and drops the unread count,
 *   - the "Unread" filter shows only unread items,
 *   - Settings → Notifications renders the per-module grid, locks Security's
 *     portal toggle, and persists a change to the server.
 *
 * Same seed/serve as notifications.mjs (reset read state first).
 * Run: node tests/Browser/notification-prefs.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth/i;
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

// ── dismiss removes an item and lowers the unread count (§20) ───────
await page.click('[data-action="toggle-notifications-popup"]');
await page.waitForSelector('[data-popup-panel="notifications"]:not([hidden]) [data-notification-id]', { timeout: 8000 });
const before = await page.evaluate(() => window.TMANotifications.state.unread);
await page.hover('[data-popup-panel="notifications"] [data-notification-id]');
await page.click('[data-popup-panel="notifications"] [data-notification-dismiss]');
await page.waitForTimeout(500);
const afterUnread = await page.evaluate(async () => (await (await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' } })).json()).unread);
check(afterUnread === before - 1, `dismissing removed an unread item (${before} -> ${afterUnread})`);

// ── Unread filter shows only unread (§20) ──────────────────────────
// Mark the first item read (opening marks read), then filter to unread.
const total = await page.evaluate(() => document.querySelectorAll('[data-popup-panel="notifications"] [data-notification-id]').length);
await page.evaluate(async () => {
  // mark one read via the store without navigating
  const first = window.TMANotifications.state.items.find((i) => !i.read);
  if (first) await window.TMANotifications.markRead(first.id);
});
await page.waitForTimeout(300);
await page.click('[data-popup-action="toggle-unread"]');
await page.waitForTimeout(300);
const unreadView = await page.evaluate(() => ({
  shown: document.querySelectorAll('[data-popup-panel="notifications"] [data-notification-id]').length,
  allUnread: [...document.querySelectorAll('[data-popup-panel="notifications"] [data-notification-id]')]
    .every((n) => n.classList.contains('tma-dash__header-popup-item--unread')),
}));
check(unreadView.allUnread && unreadView.shown < total, `Unread filter shows only unread items (${unreadView.shown}/${total})`);
await page.click('[data-popup-action="toggle-unread"]'); // turn off

// ── Settings → Notifications: per-module grid + persistence (§21) ──
await page.evaluate(() => document.querySelector('.tma-dash')._portalNavigate('/account-settings?settings-page=notifications'));
await page.waitForSelector('[data-notif-prefs] .tma-dash__notifprefs-row', { timeout: 10000 });
const grid = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-notif-prefs] .tma-dash__notifprefs-row:not(.tma-dash__notifprefs-row--head)')];
  const secPortal = document.querySelector('[data-notif-pref="security:portal"]');
  return {
    rows: rows.length,
    securityLocked: secPortal ? (secPortal.disabled && secPortal.checked) : false,
    hasFiles: !!document.querySelector('[data-notif-pref="files:portal"]'),
  };
});
check(grid.rows >= 8, `preferences grid lists modules (${grid.rows})`);
check(grid.securityLocked, 'Security portal delivery is locked on (§21)');
check(grid.hasFiles, 'Files module row is present');

// toggle Files → portal off and confirm it persisted server-side
await page.uncheck('[data-notif-pref="files:portal"]', { force: true });
await page.waitForTimeout(500);
const persisted = await page.evaluate(async () => {
  const d = await (await fetch('/portal/notifications/preferences', { headers: { Accept: 'application/json' } })).json();
  return d.preferences.files.portal;
});
check(persisted === false, 'toggling Files→Portal off persisted to the server (§21)');

if (errors.length) fail.push('console/page errors: ' + errors.join(' | '));

await browser.close();
if (fail.length) { console.error('\nFAILURES:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('\nAll read-management & preferences checks passed.');
