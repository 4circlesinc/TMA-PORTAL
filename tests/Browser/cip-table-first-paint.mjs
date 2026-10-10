import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/*
 * The applications table is on screen before the server has answered.
 *
 * On the desktop the portal's store is on disk, and the table keeps the last
 * answer for each tab there. Opening the app paints that copy at once and
 * patches the fresh rows over it, where it used to sit on the skeleton for as
 * long as the listing took. This pins the order of events, which is the only
 * thing that makes it worth having: rows first, answer second, and the answer
 * arriving as an update to the rows already there rather than a redraw.
 *
 * The listing is held back three seconds so "before the answer" is not a race
 * the test can win by luck. The desktop is stood in for by the one flag the
 * store reads (window.TMADesktop.isDesktop); a second, ordinary browser is the
 * control, because there nothing is kept on disk and the wait is real.
 *
 * Same server and seed as `cip-table-quiet.mjs`.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const DB = process.env.TMA_DB;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const HOLD = 3000;

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

function colleague(php) {
  return execFileSync('php', ['artisan', 'tinker', '--execute', php], {
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '', FEATURE_CIP: 'true', BROADCAST_CONNECTION: 'log' },
    encoding: 'utf8',
  }).trim().split('\n').pop().trim();
}

function loginCode() {
  const log = readFileSync(LOG, 'utf8');
  const all = [...log.matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(700);
  }
}

/*
 * Open the table with the listing held back, and say what was on screen when.
 * `answered` is stamped by the route the moment the held response is let go,
 * so "rows before the answer" is read off the same clock as the rows.
 */
async function open(page) {
  const seen = { answeredAt: null };
  await page.unroute('**/portal/cip/applications?**').catch(() => {});
  await page.route('**/portal/cip/applications?**', async route => {
    await new Promise(r => setTimeout(r, HOLD));
    if (seen.answeredAt === null) seen.answeredAt = Date.now();
    // A held request can outlive the page that made it.
    return route.continue().catch(() => {});
  });

  const started = Date.now();
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });

  let rowsAt = null;
  let early = null;
  try {
    await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: HOLD + 6000 });
    rowsAt = Date.now();
    early = await page.evaluate(() => {
      document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').forEach(tr => { tr.__stamp = tr.getAttribute('data-cip-app'); });
      return {
        rows: document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length,
        count: document.querySelector('.tma-dash__toolbar-count')?.innerText.replace(/\s+/g, ' ').trim() || '',
        tabs: [...document.querySelectorAll('[data-clients-list-tab]')].map(t => t.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
      };
    });
  } catch (e) { /* reported by the caller */ }

  const beforeAnswer = rowsAt !== null && (seen.answeredAt === null || rowsAt < seen.answeredAt);

  // Let the held answer land and be painted.
  await page.waitForTimeout(Math.max(0, HOLD - (Date.now() - started)) + 2500);

  const settled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]')];
    return {
      rows: rows.length,
      kept: rows.filter(tr => tr.__stamp && tr.__stamp === tr.getAttribute('data-cip-app')).length,
      text: rows.map(tr => tr.innerText.replace(/\s+/g, ' ').trim().toLowerCase()).join(' || '),
      count: document.querySelector('.tma-dash__toolbar-count')?.innerText.replace(/\s+/g, ' ').trim() || '',
    };
  });

  return { ms: rowsAt === null ? null : rowsAt - started, beforeAnswer, early, settled };
}

const browser = await chromium.launch();
const accept = () => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } };

try {
  // ── The desktop: the store is on disk. ────────────────────────────────
  const desktop = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await desktop.addInitScript(accept);
  await desktop.addInitScript(() => { window.TMADesktop = { isDesktop: true }; });
  const app = await desktop.newPage();
  const errors = [];
  app.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await signIn(app);

  step(1, 'A first start has nothing to paint from, and waits for the answer');
  const first = await open(app);
  check(first.ms !== null && !first.beforeAnswer, `the rows waited for the listing (${first.ms}ms)`);
  const ROWS = first.settled.rows;
  check(ROWS >= 10, `${ROWS} applications listed`);
  // Long enough for the answer, and the other tabs fetched behind it, to be written down.
  await app.waitForTimeout(HOLD + 2500);

  step(2, 'The next start paints the table before the server has answered');
  const second = await open(app);
  check(second.beforeAnswer, `rows on screen ${second.ms}ms in, with the listing still held for ${HOLD}ms`);
  check(second.early && second.early.rows === ROWS, `all of them (${second.early ? second.early.rows : 0}/${ROWS})`);
  check(second.early && second.early.count.includes(String(ROWS)), `with the count beside them (${second.early ? second.early.count : 'gone'})`);
  check(second.early && /\d/.test(second.early.tabs), 'and the tabs already counted');
  check(second.settled.kept === ROWS, `the answer was patched over the same rows (${second.settled.kept}/${ROWS})`);

  step(3, 'What changed while the app was closed arrives as an update');
  const NEWCOMER = 'Latecomer' + String(Date.now()).slice(-6);
  colleague(`
    $admin = App\\Models\\User::where('email','${EMAIL}')->first();
    $new = App\\Support\\Cip\\Applications::create(App\\Models\\CipProvider::first(), $admin);
    App\\Models\\CipPerson::create(['application_id' => $new->id, 'role' => 'main_applicant', 'first_name' => 'Zoe', 'last_name' => '${NEWCOMER}']);
    echo 'done';`);
  const third = await open(app);
  check(third.beforeAnswer && third.early.rows === ROWS, `the copy from last time is painted first (${third.early ? third.early.rows : 0} rows, ${third.ms}ms)`);
  check(third.settled.rows === ROWS + 1 && third.settled.text.includes(NEWCOMER.toLowerCase()),
    `then the application filed meanwhile appears (${third.settled.rows})`);
  check(third.settled.kept === ROWS, `beside the rows already there, which were not rebuilt (${third.settled.kept}/${ROWS})`);
  check(third.settled.count.includes(String(ROWS + 1)), `and the count follows (${third.settled.count})`);

  step(4, 'A tab opened for the first time this start is there too');
  await app.unroute('**/portal/cip/applications?**').catch(() => {});
  await app.waitForTimeout(2500);
  const fourth = await open(app);
  check(fourth.beforeAnswer, `the default tab again (${fourth.ms}ms)`);
  let preAnswered = false;
  await app.unroute('**/portal/cip/applications?**').catch(() => {});
  await app.route('**/portal/cip/applications?**', async route => {
    await new Promise(r => setTimeout(r, HOLD));
    preAnswered = true;
    // A held request can outlive the page that made it.
    return route.continue().catch(() => {});
  });
  // Before the other tabs' own fetches (held too) can have answered.
  await app.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await app.waitForSelector('[data-clients-list-tab="pre_approval"]', { timeout: 20000 });
  await app.click('[data-clients-list-tab="pre_approval"]');
  let preRows = 0;
  try {
    await app.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: HOLD - 600 });
    preRows = await app.locator('.tma-cip-table tbody tr[data-cip-open]').count();
  } catch (e) { /* counted as zero */ }
  check(preRows > 0 && !preAnswered, `Pre-Approval painted from the store, ${preRows} rows, before any listing answered`);
  await app.waitForTimeout(HOLD + 1500);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.screenshot({ path: 'tests/Browser/cip-table-first-paint.png', fullPage: false });

  // ── A browser: memory only, by the firm's decision. ───────────────────
  step(5, 'In a browser nothing is kept between loads, so the wait is the real one');
  const web = await browser.newContext({ viewport: { width: 1500, height: 900 }, storageState: await desktop.storageState() });
  await web.addInitScript(accept);
  const tab = await web.newPage();
  await open(tab);
  await tab.waitForTimeout(1500);
  const again = await open(tab);
  check(again.ms !== null && !again.beforeAnswer, `the rows waited for the listing (${again.ms}ms)`);
  const onDisk = await tab.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('tma-portal');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) { resolve(0); return; }
      const count = db.transaction('cache', 'readonly').objectStore('cache').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => resolve(-1);
    };
    req.onerror = () => resolve(-1);
  }));
  check(onDisk === 0, `and nothing about a client was written to the browser's disk (${onDisk} entries)`);
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
