/*
 * Settings Phase 1 — Theme, Privacy and Plugins now persist to the account
 * instead of only this browser.
 *
 * The point of the script is the half PHPUnit can't see: that a click in a
 * panel actually reaches /me/preferences, and that a *different browser
 * profile* (empty localStorage, same account) gets the saved look applied on
 * a page that isn't Settings.
 *
 * Needs the standard e2e@example.com account and a server on :8899.
 * Run: node tests/Browser/settings-personal-prefs.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();

const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|Failed to load resource/i;
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/login')) throw new Error('login failed');

  // "Stay signed in?" sits in front of the whole portal — every request
  // redirects here until it is answered, including the JSON APIs, which is
  // why an unanswered gate shows up as HTML where JSON was expected.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(400);
  }
}

const prefs = (page) => page.evaluate(async () =>
  (await (await fetch('/me/preferences', { headers: { Accept: 'application/json' } })).json()));

/* The switch input sits under its own track/thumb spans, so a real click
   lands on the decoration and Playwright waits forever. The markup wraps the
   input in a <label>, so activating that toggles it the way a user does.
   Settings also mounts twice (desktop + mobile) — hence :visible. */
const toggleSwitch = (page, sel) =>
  page.locator(`${sel}:visible`).first().evaluate((el) => el.closest('label').click());

// ── context 1: drive the panels ────────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

await signIn(page);
console.log('logged in');

// Put the account back to shipped defaults so the run doesn't depend on what
// a previous run left behind.
await page.evaluate(async () => {
  const xsrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  await fetch('/me/preferences', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrf },
    body: JSON.stringify({
      themeMode: 'system', fontScale: 3, accentColor: 'indigo',
      cookieFunctional: true, cookieAnalytics: true, cookieMarketing: true,
      historyDays: 30, plugins: null,
    }),
  });
  localStorage.clear();
});

const base = await prefs(page);
check(base.themeMode === 'system' && base.fontScale === 3 && base.accentColor === 'indigo',
  'the account reads back the shipped theme defaults');
check(base.plugins === null, 'plugins reset to uncustomized (client catalog)');

// ── Theme panel writes to the account ──────────────────────────────
await page.goto(`${BASE}/account-settings?settings-page=theme`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-theme-mode="dark"]', { timeout: 8000 });

await page.click('[data-theme-mode="dark"]');
await page.click('[data-font-scale="5"]');
await page.click('[data-accent-color="green"]');
await page.waitForTimeout(900); // past the 400ms write-through debounce

const afterTheme = await prefs(page);
check(afterTheme.themeMode === 'dark', `theme mode saved to the account (${afterTheme.themeMode})`);
check(afterTheme.fontScale === 5, `font scale saved to the account (${afterTheme.fontScale})`);
check(afterTheme.accentColor === 'green', `accent colour saved to the account (${afterTheme.accentColor})`);

// The header's own dark-mode toggle has to save the same way the panel does —
// it used to write localStorage and stop there.
await page.click('[data-action="toggle-theme"]');
await page.waitForTimeout(900);
const afterToggle = await prefs(page);
check(afterToggle.themeMode === 'light',
  `the header dark-mode toggle saves too (${afterToggle.themeMode})`);

// ── Privacy panel ──────────────────────────────────────────────────
await page.goto(`${BASE}/account-settings?settings-page=privacy`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-settings-action="open-cookies"]', { timeout: 8000 });
await page.click('[data-settings-action="open-cookies"]');
await page.waitForSelector('[data-settings-cookie="analytics"]', { state: 'visible', timeout: 5000 });
await toggleSwitch(page, '[data-settings-cookie="analytics"]');
await page.waitForTimeout(900);

const afterCookies = await prefs(page);
check(afterCookies.cookieAnalytics === false, 'a cookie switch saves to the account');
check(afterCookies.cookieFunctional === true, 'the other cookie switches are left alone');

// ── Plugins panel: toggle, then remove ─────────────────────────────
await page.goto(`${BASE}/account-settings?settings-page=plugins`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-settings-plugin]', { timeout: 8000 });

// Settings mounts twice (desktop + mobile), so every count here is scoped to
// the copy actually on screen.
const rows = page.locator('[data-settings-plugin]:visible');
const firstId = await rows.first().getAttribute('data-settings-plugin');
const countBefore = await rows.count();
await toggleSwitch(page, `[data-settings-plugin-toggle="${firstId}"]`);
await page.waitForTimeout(900);

const afterToggleP = await prefs(page);
const saved = (afterToggleP.plugins || []).find((p) => p.id === firstId);
check(!!saved && saved.enabled === true, `enabling ${firstId} saved to the account`);
check((afterToggleP.plugins || []).length === countBefore,
  'the whole plugin list is stored, not just the one touched');

// Removal used to be replayed over the shipped catalog, so it came back on
// the next load. It must stick now — both on the server and after a reload.
await page.locator(`[data-settings-plugin-menu="${firstId}"]:visible`).first().click();
await page.waitForSelector(`[data-settings-plugin-dropdown="${firstId}"]:not([hidden])`, { timeout: 5000 });
await page.locator(`[data-settings-plugin-dropdown="${firstId}"]:not([hidden]) [data-settings-plugin-action="remove"]`)
  .first().click();
await page.waitForTimeout(900);

const afterRemove = await prefs(page);
check(!(afterRemove.plugins || []).some((p) => p.id === firstId),
  `removing ${firstId} saved to the account`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-settings-plugin]', { timeout: 8000 });
await page.waitForTimeout(800);
check(await page.locator(`[data-settings-plugin="${firstId}"]:visible`).count() === 0,
  `${firstId} is still gone after a reload`);
check(await page.locator('[data-settings-plugin]:visible').count() === countBefore - 1,
  'exactly one plugin was removed');

// ── context 2: a clean browser must inherit the saved look ─────────
// This is the whole point of the phase: localStorage is empty here, and the
// page opened is the dashboard, not Settings.
const fresh = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page2 = await fresh.newPage();
page2.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror(fresh): ' + e); });

await signIn(page2);
await page2.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page2.waitForSelector('.tma-dash', { timeout: 8000 });

// Put the account back on dark so there is something visible to inherit.
await page.goto(`${BASE}/account-settings?settings-page=theme`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-theme-mode="dark"]', { timeout: 8000 });
await page.click('[data-theme-mode="dark"]');
await page.waitForTimeout(900);

await page2.reload({ waitUntil: 'networkidle' });
await page2.waitForSelector('.tma-dash', { timeout: 8000 });
await page2.waitForFunction(
  () => document.querySelector('.tma-dash')?.getAttribute('data-font-scale') === '5',
  { timeout: 8000 },
).catch(() => {});

const applied = await page2.evaluate(() => {
  const dash = document.querySelector('.tma-dash');
  return {
    theme: dash.getAttribute('data-theme'),
    fontScale: dash.getAttribute('data-font-scale'),
    accent: dash.getAttribute('data-accent'),
  };
});
check(applied.fontScale === '5', `font scale followed the account to a new browser (${applied.fontScale})`);
check(applied.accent === 'green', `accent colour followed the account (${applied.accent})`);
check(applied.theme === 'dark', `dark mode followed the account (${applied.theme})`);

// Hydration replays the values through the same setters a click uses; that
// must not bounce straight back as a save.
const beforeIdle = await prefs(page2);
await page2.reload({ waitUntil: 'networkidle' });
await page2.waitForTimeout(1500);
const afterIdle = await prefs(page2);
check(JSON.stringify(beforeIdle) === JSON.stringify(afterIdle),
  'a plain page load does not rewrite the account preferences');

console.log('\n' + (fail.length ? 'FAILURES:\n  ' + fail.join('\n  ') : 'all checks passed'));
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
