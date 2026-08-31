import { chromium } from 'playwright';

// The CBI development preview at /dev/cbi against a real server with real
// synced data. What only a browser can check: the standalone shell paints,
// the stage tabs filter, search narrows the table, an application opens into
// the workspace view with its panels, a portal comment posts and survives a
// reload, and — the module being dark — a non-admin gets a 404, not a page.
// See README.md for the harness; needs the standard e2e@example.com admin
// (and optionally emp@example.com to prove the 404).
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  // The "Stay signed in?" interstitial fronts the whole portal — even JSON
  // APIs redirect until it is answered (memory: browser-testing gotchas).
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'Logging in as admin and opening /dev/cbi');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/dev/cbi`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check(await page.locator('.tma-portal-head__title').count() === 1, 'page head painted');
  check((await page.locator('.cbi-shell__flag').textContent() || '').includes('Development'), 'development-preview flag visible');

  step(2, 'Applications table paints real rows');
  await page.waitForSelector('.cbi-table tbody tr', { timeout: 15000 });
  const rowCount = await page.locator('.cbi-table tbody tr').count();
  check(rowCount > 0, `table shows ${rowCount} application row(s)`);
  const total = await page.locator('.tma-pagination-bar__results').textContent();
  log(`    pagination: ${total?.trim()}`);
  await page.screenshot({ path: 'tests/Browser/cbi-list.png', fullPage: false });

  step(3, 'Stage tabs filter the list');
  const stages = ['applications', 'assessment', 'tracker', 'closed'];
  for (const s of stages) {
    await page.click(`.tma-tab[data-tab-key="${s}"]`);
    await page.waitForTimeout(900);
    const on = await page.locator(`.tma-tab[data-tab-key="${s}"].is-active`).count();
    check(on === 1, `stage tab '${s}' activates`);
  }
  // The All tab must actually clear the stage filter — an empty key would be
  // swallowed by tab-group.js, so it carries the literal key 'all'.
  await page.click('.tma-tab[data-tab-key="all"]');
  await page.waitForTimeout(1200);
  check(await page.locator('.tma-tab[data-tab-key="all"].is-active').count() === 1, 'All tab activates');
  check(await page.locator('.cbi-table thead th', { hasText: 'Stage' }).count() === 1,
    'All view restores the Stage column (proves the filter cleared)');

  step(4, 'Search narrows the table');
  const firstName = (await page.locator('.cbi-table tbody tr td[data-cbi-name]').first().textContent() || '').trim();
  const needle = firstName.split(/\s+/)[0] || '';
  if (needle.length > 2) {
    await page.fill('[data-cbi-search]', needle);
    await page.waitForTimeout(1200);
    const names = await page.locator('.cbi-table tbody tr td[data-cbi-name]').allTextContents();
    check(names.length > 0 && names.every((n) => n.toLowerCase().includes(needle.toLowerCase())),
      `every result matches '${needle}' (${names.length} rows)`);
    await page.fill('[data-cbi-search]', '');
    await page.waitForTimeout(1000);
  } else {
    log('    (skipped — first row has no usable name)');
  }

  step(5, 'Opening an application workspace');
  await page.click('.cbi-table tbody tr');
  await page.waitForSelector('.cbi-overview-grid', { timeout: 10000 });
  check(page.url().includes('#/app/'), 'hash route points at the application');
  check(await page.locator('.tma-portal-head__title').count() === 1, 'applicant title painted');
  const panels = await page.locator('.tma-portal-section__title').allTextContents();
  log(`    panels: ${panels.map((p) => p.trim()).join(' · ')}`);
  // The Applicant panel deliberately hides itself when a record carries no
  // personal fields (common on COR-tracker rows), so it isn't asserted.
  check(panels.some((p) => p.includes('Case')), 'Case panel present');
  check(panels.some((p) => p.includes('Comments')), 'Comments panel present');
  check(panels.some((p) => p.includes('Activity')), 'Activity panel present');
  await page.screenshot({ path: 'tests/Browser/cbi-detail.png', fullPage: true });

  step(6, 'Posting a portal comment');
  const marker = 'E2E note ' + Date.now();
  await page.click('.tma-tab[data-tab-key="comments"]');
  await page.waitForTimeout(300);
  await page.fill('[data-cbi-comment-input]', marker);
  await page.click('[data-cbi-action="post-comment"]');
  await page.waitForTimeout(1200);
  let bodies = await page.locator('.cbi-comment__body').allTextContents();
  check(bodies.some((b) => b.includes(marker)), 'comment appears in the thread');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.cbi-overview-grid', { timeout: 10000 });
  await page.click('.tma-tab[data-tab-key="comments"]');
  await page.waitForSelector('.cbi-comment__body', { timeout: 10000 });
  bodies = await page.locator('.cbi-comment__body').allTextContents();
  check(bodies.some((b) => b.includes(marker)), 'comment survives a reload (server-backed)');

  step(7, 'Back to the list via the hash route');
  await page.click('[data-cbi-action="back"]');
  await page.waitForSelector('.cbi-table tbody tr', { timeout: 10000 });
  check(!page.url().includes('#/app/'), 'back returns to the list');

  step(8, '/cbi is a CIP Applications bookmark, not a second listing');
  // The shell used to mount the CBI table at /cbi. Cutover sends that URL
  // to /citizenship-applications; verification of the mirror stays on /dev/cbi.
  await page.goto(`${BASE}/cbi`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const cbiListing = await page.locator('.cbi-table, tr[data-cbi-open]').count();
  check(cbiListing === 0, '/cbi does not mount the CBI table');
  check(await page.locator('.tma-dash__nav-item[data-nav="cbi"]').count() === 0, 'sidebar has no CBI row');

  step(9, 'A non-admin gets a 404, not a page');
  const emp = await browser.newPage();
  const canTry = await (async () => {
    try { await signIn(emp, 'emp@example.com'); return true; } catch { return false; }
  })();
  if (canTry) {
    const res = await emp.goto(`${BASE}/dev/cbi`, { waitUntil: 'domcontentloaded' });
    check(res.status() === 404, `employee sees ${res.status()} (expected 404)`);
    const spa = await emp.goto(`${BASE}/cbi`, { waitUntil: 'domcontentloaded' });
    const spaOk = spa.status() === 404 || (spa.url() && spa.url().includes('citizenship-applications'));
    check(spaOk, `employee /cbi sees ${spa.status()} ${spa.url()} (404 or CIP Applications)`);
    const api = await emp.evaluate(async (base) => {
      const r = await fetch(base + '/portal/cbi/summary', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      });
      return r.status;
    }, BASE);
    check(api === 404, `employee API status ${api} (expected 404)`);
    // The sidebar must not even hint the module exists to a non-admin.
    await emp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await emp.waitForSelector('.tma-dash__nav-item[data-nav="clients"], .tma-dash__nav-item[data-nav="calendar"]', { timeout: 20000 }).catch(() => {});
    await emp.waitForTimeout(1000);
    check(await emp.locator('.tma-dash__nav-item[data-nav="cbi"]').count() === 0, 'employee sidebar has no CBI row');
  } else {
    log('    (skipped — no emp@example.com account seeded)');
  }
  await emp.close();
} catch (e) {
  failures.push('fatal: ' + e.message);
} finally {
  await browser.close();
}

log('\n────────────────────────────');
if (errors.length) log('page errors:\n  ' + errors.join('\n  '));
if (failures.length) {
  log(`FAILED (${failures.length}):\n  ` + failures.join('\n  '));
  process.exit(1);
}
log('CBI browser test: all checks passed');
