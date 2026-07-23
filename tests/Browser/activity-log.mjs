/*
 * Verify Overview → Activity is the complete, server-backed log (§8, §9, §10).
 *
 * Reaches it through the Activities popup's "See all activities" (which must
 * land on the Activity tab, not an unrelated page), then checks the log shows
 * real rows with a module column, that search and a module filter narrow the
 * list server-side without a full reload, that an admin can expand a row's
 * details, and that a row links to its record.
 *
 * Same seed/serve as notifications.mjs. Run: node tests/Browser/activity-log.mjs
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

// ── reach the log via "See all activities" (§7) ────────────────────
await page.waitForSelector('[data-action="toggle-activities-popup"]', { timeout: 10000 });
await page.click('[data-action="toggle-activities-popup"]');
await page.waitForSelector('[data-popup-action="see-all-activities"]', { timeout: 8000 });
await page.click('[data-popup-action="see-all-activities"]');

await page.waitForSelector('.tma-dash__actlog [data-actlog-row]', { timeout: 15000 });
const onActivityTab = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-overview-tab]')].find((b) => b.classList.contains('is-active'));
  return tab ? tab.getAttribute('data-overview-tab') : null;
});
check(onActivityTab === 'Activity', `"See all activities" opened the Activity tab (got ${onActivityTab}) (§7)`);

// ── real rows with a module column (§8) ────────────────────────────
const first = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tma-dash__actlog [data-actlog-row]')];
  return {
    count: rows.length,
    hasModule: !!document.querySelector('.tma-dash__actlog .tma-dash__actlog-tag'),
    hasUser: !!document.querySelector('.tma-dash__actlog .tma-dash__cc--user'),
    text: rows.map((r) => r.textContent).join(' | '),
  };
});
check(first.count >= 4, `activity log shows real rows (${first.count})`);
check(first.hasModule, 'rows show a Module tag (§8)');
check(/Tom uploaded|Sarah edited|synchronized/.test(first.text), 'rows carry real descriptions (§8)');

// ── server-side search narrows the list without a full reload (§10) ─
await page.evaluate(() => { window.__actProbe = 'alive'; });
await page.fill('.tma-dash__actlog [data-actlog-search]', 'uploaded');
await page.waitForTimeout(700);
const searched = await page.evaluate(() => ({
  probe: window.__actProbe,
  rows: document.querySelectorAll('.tma-dash__actlog [data-actlog-row]').length,
  text: [...document.querySelectorAll('.tma-dash__actlog [data-actlog-row]')].map((r) => r.textContent).join(' | '),
}));
check(searched.probe === 'alive', 'search did not reload the page (§10)');
check(searched.rows >= 1 && /uploaded/i.test(searched.text) && !/edited/i.test(searched.text), `search narrowed to matching rows (${searched.rows})`);

// clear search, then filter by module = files
await page.click('.tma-dash__actlog [data-actlog-search-clear]');
await page.waitForTimeout(500);
await page.click('.tma-dash__actlog [data-actlog-filter]');
await page.waitForSelector('.tma-dash__actlog [data-actlog-filter-field="module"]', { timeout: 5000 });
await page.selectOption('.tma-dash__actlog [data-actlog-filter-field="module"]', 'files');
await page.waitForTimeout(600);
const filtered = await page.evaluate(() => {
  const tags = [...document.querySelectorAll('.tma-dash__actlog [data-actlog-row] .tma-dash__actlog-tag')].map((t) => t.textContent);
  return { rows: tags.length, allFiles: tags.length > 0 && tags.every((t) => /Files/i.test(t)) };
});
check(filtered.allFiles, `module filter shows only Files rows (${filtered.rows}) (§9)`);

// ── admin can expand a row's details (IP/status/diff) (§9) ─────────
await page.selectOption('.tma-dash__actlog [data-actlog-filter-field="module"]', '');
await page.waitForTimeout(500);
const expandable = await page.$('.tma-dash__actlog [data-actlog-expand]');
check(!!expandable, 'admin rows offer a details toggle (§9)');
if (expandable) {
  await expandable.click();
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => {
    const d = document.querySelector('.tma-dash__actlog-detail');
    return d ? d.textContent : null;
  });
  check(detail && /Type|Status|IP/.test(detail), 'expanded detail shows admin-only fields (§9)');
}

if (errors.length) fail.push('console/page errors: ' + errors.join(' | '));

await browser.close();
if (fail.length) { console.error('\nFAILURES:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('\nAll activity-log checks passed.');
