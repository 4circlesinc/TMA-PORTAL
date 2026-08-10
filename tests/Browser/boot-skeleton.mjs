/*
 * The main area's *first paint*, before the JS bundle has run.
 *
 * The shell used to serve an empty Dashboard mount, so from first paint until
 * portal-home.js mounted the main area was a blank white page with a couple of
 * disconnected placeholder rows around it. The shell now carries a boot
 * skeleton inside the mount: dashboard-shaped on "/" (hero, KPI cards, panel
 * tiles), view-agnostic rows on every other entry path, and the staff-only KPI
 * row is pruned through portal-access.js ([data-boot-needs]) so a client never
 * sees placeholder cards for a row they don't get.
 *
 * The state only exists until the deferred bundle executes, so the script
 * stalls every script except portal-access.js (undeferred, in <head> — it must
 * run for real, it is what prunes the KPI placeholder) and samples inside that
 * window. `waitUntil` must be 'commit': DOMContentLoaded only fires after
 * deferred scripts run, which is exactly what is being held back.
 *
 * Needs the standard accounts (e2e@example.com, client@example.com), and the
 * throwaway server must be started with `--no-reload` — without it artisan
 * serve strips the DB_* environment overrides from its workers and quietly
 * serves whatever database .env points at.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/boot-skeleton.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const PASSWORD = 'password12345';
const SHOTS = process.env.SHOTS_DIR || '.';
const STALL_MS = 6000;

const fail = [];
function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) fail.push(message);
}

async function login(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
  if (page.url().includes('/auth/stay-signed-in')) {
    await page.click('text=Yes, stay signed in');
    await page.waitForTimeout(800);
  }
}

async function stallScripts(context) {
  await context.route('**/build/*.js', async (route) => {
    await new Promise((r) => setTimeout(r, STALL_MS));
    await route.continue().catch(() => {});
  });
  await context.route('**/js/*.js', async (route) => {
    if (route.request().url().includes('portal-access')) return route.continue();
    await new Promise((r) => setTimeout(r, STALL_MS));
    await route.continue().catch(() => {});
  });
}

async function bootState(context, path, shot) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('[data-boot-skeleton]', { state: 'attached', timeout: 8000 });
  await page.waitForTimeout(400); // let stylesheets settle; bundle is stalled far longer
  const state = await page.evaluate(() => {
    const skel = document.querySelector('[data-boot-skeleton]');
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && box.height > 0;
    };
    const chip = document.querySelector('.tma-dash__profile-avatar');
    return {
      preBoot: typeof window.TMADashboard === 'undefined' && document.readyState !== 'complete',
      generic: skel.className.includes('tma-boot-skel--generic'),
      helloVisible: vis(skel.querySelector('.tma-portal-hello')),
      kpisVisible: vis(document.querySelector('[data-boot-needs="overview.view"]')),
      genericRowsVisible: vis(skel.querySelector('.tma-boot-skel__generic .tma-portal-file-row')),
      panelsVisible: vis(skel.querySelector('.tma-portal-home-grid .tma-portal-panel')),
      railRows: document.querySelectorAll('.tma-dash__rb-skel').length,
      chipColor: chip ? getComputedStyle(chip).backgroundColor : null,
    };
  });
  await page.screenshot({ path: `${SHOTS}/${shot}` });
  return { page, state };
}

const browser = await chromium.launch();

/* ── administrator ── */
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await login(page, 'e2e@example.com');
  await page.close();
  await stallScripts(context);

  console.log('administrator, boot "/"');
  const home = await bootState(context, '/', 'boot-admin-home.png');
  check(home.state.preBoot, 'sampled before the bundle ran');
  check(!home.state.generic, 'dashboard path keeps the dashboard-shaped variant');
  check(home.state.helloVisible, 'hero placeholder painted');
  check(home.state.kpisVisible, 'staff sees the KPI placeholder row');
  check(home.state.panelsVisible, 'panel placeholders painted');
  check(home.state.railRows >= 9, `right rail carries 3 rows per section (${home.state.railRows})`);
  await home.page.close();

  console.log('administrator, boot "/email"');
  const mail = await bootState(context, '/email', 'boot-admin-email.png');
  check(mail.state.preBoot, 'sampled before the bundle ran');
  check(mail.state.generic, 'non-dashboard path switches to the generic variant');
  check(!mail.state.kpisVisible, 'no KPI cards on a non-dashboard path');
  check(!mail.state.helloVisible, 'no greeting on a non-dashboard path');
  check(mail.state.genericRowsVisible, 'generic rows painted instead');
  await mail.page.close();
  await context.close();

  /* Settled: no stall — the skeleton must be gone and the real board in. */
  const settledCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p2 = await settledCtx.newPage();
  await login(p2, 'e2e@example.com');
  await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1500);
  const settled = await p2.evaluate(() => ({
    skeletonGone: !document.querySelector('[data-boot-skeleton]'),
    helloReal: (document.querySelector('.tma-portal-hello__title') || {}).textContent || '',
  }));
  console.log('administrator, settled "/"');
  check(settled.skeletonGone, 'portal-home replaced the boot skeleton');
  check(/Hello/.test(settled.helloReal), `real greeting rendered ("${settled.helloReal}")`);
  await p2.screenshot({ path: `${SHOTS}/settled-admin-home.png` });
  await settledCtx.close();
}

/* ── client ── */
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await login(page, 'client@example.com');
  await page.close();
  await stallScripts(context);

  console.log('client, boot "/"');
  const home = await bootState(context, '/', 'boot-client-home.png');
  check(home.state.preBoot, 'sampled before the bundle ran');
  check(!home.state.kpisVisible, 'client never sees the staff KPI placeholder row');
  check(home.state.helloVisible, 'hero placeholder painted');
  check(home.state.panelsVisible, 'panel placeholders painted');
  await home.page.close();
  await context.close();
}

await browser.close();

if (fail.length) { console.log(`\n${fail.length} failure(s)`); process.exit(1); }
console.log('\nall checks passed');
