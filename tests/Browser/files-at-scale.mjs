import { chromium } from 'playwright';

/**
 * The Dashboard and a client-folder root, at the size the firm actually has.
 *
 * Both "would not load" in August 2026 and neither had a browser test, because
 * every file-library drive until now ran against a handful of seeded rows —
 * where the faults are invisible. They only appear at production scale:
 *
 *  1. The presenter's primed maps are sparse, so "primed, and this row has
 *     none" read as "not primed" and every row re-queried; the §17 package
 *     check lazy-loaded a CIP slot five times per row on top. Fifty rows of
 *     Recent cost 364 queries — 104s against the remote database, past any
 *     request timeout, so the Dashboard's card sat empty for ever.
 *  2. Opening Clients asked for all eleven thousand rows at once
 *     (perPage=0). Server-side it never returned; even once it did, the
 *     answer was 19MB and the browser reconciled eleven thousand rows.
 *
 * So this measures rather than asserts shape: the card must fill, the folder
 * must open, the pager must actually reach the far end of the listing, and
 * the page must still be responsive once it has.
 *
 * Harness — the standard throwaway server plus a big library (see README):
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/files-at-scale.mjs
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_PASSWORD || 'password12345';
/** Generous on purpose: this is a "did it load at all" line, not a benchmark. */
const BUDGET_MS = Number(process.env.TMA_BUDGET_MS || 20000);

const failures = [];
const errors = [];
const log = (...a) => console.log(...a);

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb|WebSocket|favicon/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
});

/** Every portal XHR and how long it took — the evidence for a slow panel. */
const timings = [];
page.on('request', (r) => { r.__t0 = Date.now(); });
page.on('requestfinished', (r) => {
  const url = r.url().replace(BASE, '');
  if (url.includes('/portal/')) timings.push({ url, ms: Date.now() - r.__t0 });
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  // "Stay signed in?" sits in front of the whole portal, redirecting the JSON
  // APIs too until it is answered.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
  // A seeded account that has never completed onboarding never reaches the
  // portal at all, and every check below then fails for the wrong reason.
  if (/verify|profile-setup|onboarding/.test(page.url())) {
    throw new Error(`account not portal-ready: ${page.url()}`);
  }
}

/** Park the pointer clear of the hover-overlay sidebar before touching the page. */
const parkPointer = () => page.mouse.move(1300, 800);

const rowCount = () => page.locator('[data-files-body] [data-id]').count();
const pagerText = () => page.locator('[data-files-pagination] .tma-pagination-bar__results')
  .first().textContent().catch(() => '');

/** First few row labels — what proves two pages are not the same page. */
const firstRows = () => page.evaluate(() => [...document.querySelectorAll('[data-files-body] [data-id]')]
  .slice(0, 3).map((n) => n.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)));

try {
  step(1, 'Sign in');
  await signIn();
  await parkPointer();

  step(2, 'Dashboard — Recent Files fills');
  const dashStart = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const tile = page.locator('[data-tile-id="recentFiles"]').first();
  await tile.waitFor({ timeout: BUDGET_MS });

  let filled = false;
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline) {
    const text = await tile.innerText().catch(() => '');
    // The card is server-backed and starts empty; anything beyond its own
    // heading means the listing answered.
    if (text.replace(/Recent Files/i, '').trim().length > 20) { filled = true; break; }
    await page.waitForTimeout(250);
  }
  const dashMs = Date.now() - dashStart;
  check(filled, `Recent Files card filled in ${dashMs}ms`);
  const tileText = await tile.innerText().catch(() => '');
  check(!/Failed to load|Could not load/i.test(tileText), 'Recent Files reports no load error');

  step(3, 'File Library opens');
  const libStart = Date.now();
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-files-body] [data-id]', { timeout: BUDGET_MS });
  check(true, `File Library painted in ${Date.now() - libStart}ms`);

  step(4, 'Clients — the whole client list');
  await parkPointer();
  const openStart = Date.now();
  // Double-click the row, not the name — a double-click on the name renames.
  await page.locator('[data-files-body] [data-files-row]')
    .filter({ has: page.locator('[data-files-name][title="Clients"]') })
    .first().locator('.tma-portal-cell--type').dblclick();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-files-body] [data-id]').length > 5,
    { timeout: BUDGET_MS },
  );
  const openMs = Date.now() - openStart;
  const shown = await rowCount();
  check(openMs < BUDGET_MS, `Clients opened in ${openMs}ms with ${shown} rows`);

  // The page must stay usable once open: a listing that blocks the main
  // thread for seconds "loaded" by every assertion above and none that matter.
  const rafStart = Date.now();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const rafMs = Date.now() - rafStart;
  check(rafMs < 500, `Main thread free after paint (${rafMs}ms to next frame)`);

  step(5, 'The pager reaches the far end');
  const summary = (await pagerText()) || '';
  log(`    pager: ${summary}`);
  const totalItems = Number((summary.match(/^([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0);
  const pages = Number((summary.match(/of ([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0);
  check(totalItems > shown, `Pager states the whole listing (${totalItems}) not just the page (${shown})`);
  check(pages > 1, `Listing spans ${pages} pages`);

  const p1 = await firstRows();
  await page.click('[data-files-direction="next"]');
  await page.waitForFunction(
    () => /page 2 of /.test(document.querySelector('[data-files-pagination] .tma-pagination-bar__results')?.textContent || ''),
    { timeout: BUDGET_MS },
  );
  const p2 = await firstRows();
  check(JSON.stringify(p1) !== JSON.stringify(p2), 'Page 2 shows different rows from page 1');

  // Last is what the clients table's pager got wrong: with a hundred pages
  // the end of the listing was unreachable however long you pressed Next.
  await page.click('[data-files-direction="last"]');
  await page.waitForFunction(
    (n) => new RegExp(`page ${n.toLocaleString()} of `).test(
      document.querySelector('[data-files-pagination] .tma-pagination-bar__results')?.textContent || '',
    ),
    pages,
    { timeout: BUDGET_MS },
  );
  check(await rowCount() > 0, `Last page (${pages}) is reachable and has rows`);

  step(6, 'Page size cycles, and the server agrees with the label');
  await page.click('[data-files-page-size]');
  await page.waitForTimeout(1500);
  const sized = await page.evaluate(() => ({
    label: Number(document.querySelector('[data-files-page-size] .tma-pagination__label')?.textContent),
    rows: document.querySelectorAll('[data-files-body] [data-id]').length,
  }));
  check(sized.rows === sized.label, `Page size ${sized.label} served ${sized.rows} rows`);

  step(7, 'Search still narrows the whole folder, not the page');
  await page.fill('[data-files-search]', 'CLIENT 07777');
  await page.waitForTimeout(1800);
  const found = await rowCount();
  check(found > 0 && found < 10, `Search reached a row on a far page (${found} matched)`);

  step(8, 'Slowest portal requests');
  timings.sort((a, b) => b.ms - a.ms);
  for (const t of timings.slice(0, 6)) log(`    ${String(t.ms).padStart(7)}ms  ${t.url}`);
  const worst = timings[0];
  check(!worst || worst.ms < BUDGET_MS, `Slowest request under ${BUDGET_MS}ms (${worst ? worst.ms : 0}ms)`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/files-at-scale-error.png' }).catch(() => {});
} finally {
  await page.screenshot({ path: 'tests/Browser/files-at-scale.png' }).catch(() => {});
  await browser.close();
}

if (errors.length) {
  log('\nconsole errors:');
  for (const e of [...new Set(errors)].slice(0, 10)) log(`    ${e}`);
}

log(failures.length ? `\nFAIL (${failures.length})` : '\nPASS');
for (const f of failures) log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
