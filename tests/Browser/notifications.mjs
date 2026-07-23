/*
 * Verify the live notifications / activity / right-sidebar system.
 *
 * The right sidebar's three sections load real data; the header bell/clock
 * popups render from the same stores; only one popup is open at a time; the
 * bell badge is the real unread count and clears on "mark all read"; and
 * clicking a notification opens its record without a full page reload.
 *
 * Seed with scratchpad/seed.php (admin e2e@example.com + 6 notifications,
 * 5 activity rows, 2 clients), serve on :8899, then: node tests/Browser/notifications.mjs
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
const check = (cond, msg) => { if (!cond) fail.push(msg); else console.log('  ok:', msg); };

// ── login ──────────────────────────────────────────────────────────
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
console.log('logged in ->', page.url());

// ── right sidebar sections load real data (§1, §5) ─────────────────
await page.waitForSelector('[data-rb-body="notifications"] .tma-dash__notice', { timeout: 20000 });
const sidebar = await page.evaluate(() => ({
  notif: [...document.querySelectorAll('[data-rb-body="notifications"] .tma-dash__notice')].map((n) => n.textContent),
  acts: document.querySelectorAll('[data-rb-body="activities"] .tma-dash__activity').length,
  clients: [...document.querySelectorAll('[data-rb-body="clients"] .tma-dash__contact')].map((n) => n.textContent),
  systemIcon: !!document.querySelector('[data-rb-body="notifications"] .tma-dash__notice-icon'),
  actorAvatar: !!document.querySelector('[data-rb-body="notifications"] .tma-dash__rb-avatar'),
  brokenImg: [...document.querySelectorAll('.tma-dash__rightbar img')].some((i) => i.complete && i.naturalWidth === 0),
}));
check(sidebar.notif.some((t) => /Tom shared/.test(t)), 'sidebar Notifications shows the real "Tom shared" item');
check(sidebar.acts >= 1, `sidebar Activities has rows (${sidebar.acts})`);
check(sidebar.clients.some((t) => /Bruce Wayne/.test(t)), 'sidebar Clients shows a real client');
check(sidebar.systemIcon, 'a system notification renders a circular icon (§3)');
check(sidebar.actorAvatar, 'a person notification renders an avatar (§3)');
check(!sidebar.brokenImg, 'no broken images in the sidebar (§3)');

// ── bell badge = real unread count (§11) ───────────────────────────
await page.waitForFunction(() => {
  const b = document.querySelector('[data-action="toggle-notifications-popup"] .tma-dash__icon-btn-badge');
  return b && !b.hidden && b.textContent.trim() !== '';
}, { timeout: 10000 });
const badge = await page.$eval('[data-action="toggle-notifications-popup"] .tma-dash__icon-btn-badge', (b) => b.textContent.trim());
check(badge === '6', `bell badge shows unread count (got "${badge}", expected 6)`);

// ── open notifications popup: person vs system rendering (§3, §6) ──
await page.click('[data-action="toggle-notifications-popup"]');
await page.waitForSelector('[data-popup-panel="notifications"]:not([hidden]) [data-notification-id]', { timeout: 8000 });
const popup = await page.evaluate(() => {
  const panel = document.querySelector('[data-popup-panel="notifications"]');
  return {
    items: panel.querySelectorAll('[data-notification-id]').length,
    hasSystemIcon: !!panel.querySelector('.tma-dash__header-popup-icon'),
    hasAvatar: !!panel.querySelector('.tma-dash__header-popup-avatar'),
    seeAll: !!panel.querySelector('[data-popup-action="see-all-notifications"]'),
    markAll: !!panel.querySelector('[data-popup-action="mark-notifications-read"]'),
  };
});
check(popup.items >= 6, `popup lists notifications (${popup.items})`);
check(popup.hasSystemIcon, 'popup shows a circular system icon (§3)');
check(popup.hasAvatar, 'popup shows a person avatar (§3)');
check(popup.seeAll, 'popup has "See all notifications" (§6)');
check(popup.markAll, 'popup has "Mark all as read"');

// ── single open: clicking Activities closes Notifications (§2) ─────
await page.click('[data-action="toggle-activities-popup"]');
await page.waitForTimeout(300);
const single = await page.evaluate(() => ({
  notifHidden: document.querySelector('[data-popup-panel="notifications"]').hidden,
  actsShown: !document.querySelector('[data-popup-panel="activities"]').hidden,
  both: document.querySelector('[data-header-popups]').classList.contains('tma-dash__header-popups--both'),
}));
check(single.notifHidden, 'opening Activities closed the Notifications popup (§2)');
check(single.actsShown, 'Activities popup is now open (§2)');
check(!single.both, 'the two popups never share the "--both" state (§2)');

// clicking the open icon again closes it
await page.click('[data-action="toggle-activities-popup"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => document.querySelector('[data-header-popups]').hidden), 'clicking the open icon again closes the popup (§2)');

// ── mark all read clears the badge (§11) ───────────────────────────
await page.click('[data-action="toggle-notifications-popup"]');
await page.waitForSelector('[data-popup-action="mark-notifications-read"]:not([disabled])', { timeout: 5000 });
await page.click('[data-popup-action="mark-notifications-read"]');
await page.waitForFunction(() => {
  const b = document.querySelector('[data-action="toggle-notifications-popup"] .tma-dash__icon-btn-badge');
  return !b || b.hidden || b.textContent.trim() === '';
}, { timeout: 8000 });
const unreadAfter = await page.evaluate(async () => (await (await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' } })).json()).unread);
check(unreadAfter === 0, `mark-all-read set unread to 0 on the server (got ${unreadAfter})`);

// ── clicking a notification opens its record without a reload (§15,§25) ──
await page.evaluate(() => { window.__navProbe = 'alive'; });
// Ensure the notifications popup is open (mark-all left it open; be robust either way).
const popupOpen = await page.evaluate(() => !document.querySelector('[data-popup-panel="notifications"]').hidden);
if (!popupOpen) await page.click('[data-action="toggle-notifications-popup"]');
await page.waitForSelector('[data-popup-panel="notifications"]:not([hidden]) [data-notification-id]', { timeout: 8000 });
// the client.assigned notification links to the clients view
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-popup-panel="notifications"] [data-notification-id]')]
    .find((n) => (n.getAttribute('data-action-url') || '').includes('/clients'));
  if (!el) return false;
  el.click();
  return true;
});
check(clicked, 'found a notification linking to a record');
await page.waitForTimeout(800);
const nav = await page.evaluate(() => ({
  probe: window.__navProbe,
  clientsView: !document.querySelector('.tma-dash__view[data-view="clients"]')?.hidden,
  popupClosed: document.querySelector('[data-header-popups]').hidden,
}));
check(nav.probe === 'alive', 'no full page reload — the SPA navigated in place (§25)');
check(nav.clientsView, 'the Clients view opened from the notification (§15)');
check(nav.popupClosed, 'the popup closed after navigating');

if (errors.length) fail.push('console/page errors: ' + errors.join(' | '));

await browser.close();

if (fail.length) {
  console.error('\nFAILURES:\n - ' + fail.join('\n - '));
  process.exit(1);
}
console.log('\nAll notification UI checks passed.');
