/*
 * Dark-mode audit, part 2: interactive surfaces — popups, dialogs, context
 * menus, the file viewer, compose, and the auth pages. Same probe as
 * dark-audit.mjs, one screenshot per state.
 *   AUDIT_OUT=<dir> node tests/Browser/dark-audit-2.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth/i;
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) console.log('  pageerror:', String(e).slice(0, 200)); });

await page.addInitScript(() => { try { localStorage.setItem('tma.themeMode', 'dark'); } catch (e) {} });

const PROBE_SRC = fs.readFileSync('tests/Browser/dark-audit.mjs', 'utf8');
const PROBE = new Function('return (' + PROBE_SRC.split('const PROBE = ')[1].split(';\n\nconst report')[0] + ')')();

const report = {};
const shot = async (name) => {
  await page.waitForTimeout(900);
  const res = await page.evaluate(PROBE);
  report[name] = res;
  await page.screenshot({ path: `${OUT}/dark2-${name}.png` });
  console.log(`${name}: theme=${res.theme} issues=${res.issues.length}`);
};
const tryStep = async (name, fn) => {
  try { await fn(); await shot(name); } catch (e) { report[name] = { error: String(e).slice(0, 200) }; console.log(`${name}: ERROR ${String(e).slice(0, 140)}`); }
  // dismiss whatever opened
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
};

// ── auth pages first (no session needed) ───────────────────────────
await tryStep('auth-login', async () => {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
});
await tryStep('auth-login-email', async () => {
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
});

// ── login ──────────────────────────────────────────────────────────
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await page.screenshot({ path: `${OUT}/dark2-auth-stay.png` });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
}
if (page.url().includes('/auth/login')) throw new Error('login failed');
console.log('logged in');
await page.waitForTimeout(2000);

// ── header popups ──────────────────────────────────────────────────
await tryStep('search-popup', async () => {
  await page.click('.tma-dash__search');
  await page.waitForTimeout(300);
  await page.keyboard.type('con');
});
await tryStep('notifications-popup', async () => {
  await page.click('[data-action="toggle-notifications-popup"]');
});
await tryStep('activities-popup', async () => {
  await page.click('[data-action="toggle-activities-popup"]');
});
await tryStep('profile-menu', async () => {
  await page.click('.tma-dash__profile-badge, [data-action="toggle-profile-menu"], .tma-dash__sidebar-profile');
});

// ── calendar: new event + week view ────────────────────────────────
await tryStep('calendar-new-event', async () => {
  await page.goto(`${BASE}/calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('text=New event');
});
await tryStep('calendar-week', async () => {
  await page.click('.tma-tab-group--segmented .tma-tab:has-text("Week")');
  await page.waitForTimeout(800);
});

// ── files: context menu + viewer ───────────────────────────────────
await tryStep('files-context-menu', async () => {
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-files-table tbody tr', { timeout: 15000 });
  await page.click('.tma-portal-files-table tbody tr', { button: 'right' });
});
await tryStep('files-viewer-pdf', async () => {
  await page.dblclick('.tma-portal-files-table tbody tr:has-text("Dark Audit Docs")');
  await page.waitForSelector('.tma-portal-files-table tbody tr:has-text("Contract.pdf")', { timeout: 15000 });
  await page.dblclick('.tma-portal-files-table tbody tr:has-text("Contract.pdf")');
  await page.waitForTimeout(3500);
});
await tryStep('files-upload-menu', async () => {
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const btn = page.locator('.tma-portal-toolbar button, .tma-dash__files-toolbar button').first();
  await btn.click();
});

// ── email compose ──────────────────────────────────────────────────
await tryStep('email-compose', async () => {
  await page.goto(`${BASE}/email`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('text=New Mail');
  await page.waitForTimeout(800);
});

// ── users filter/sort popover ──────────────────────────────────────
await tryStep('users-add-menu', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('.tma-dash__users [data-action], .tma-dash__users button', { timeout: 5000 });
});

// ── feed composer ──────────────────────────────────────────────────
await tryStep('feed', async () => {
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});

// ── settings: theme panel via deep link ────────────────────────────
await tryStep('settings-theme', async () => {
  await page.goto(`${BASE}/account-settings?settings-page=theme`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});

fs.writeFileSync(`${OUT}/dark-audit-2.json`, JSON.stringify(report, null, 2));
console.log('wrote', `${OUT}/dark-audit-2.json`);
await browser.close();
