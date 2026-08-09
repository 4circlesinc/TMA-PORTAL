import { chromium } from 'playwright';

// The Client hub table at directory scale: scrolling, the toolbar, the
// checkboxes, select-all, page size, and pagination that can actually reach
// the end. Written against ~11k rows because every one of these behaved fine
// with five and fell over with eleven thousand.
//
// Setup: the standard throwaway sqlite server (README) seeded with a large
// client directory. See client-referrals.mjs for the sidebar/SPA gotchas that
// apply here too.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const CLIENT_ROW = '.tma-dash__ctable--clients .tma-dash__ctr--body';
// Scope to this table's own bar: the SPA shell carries every page's markup,
// so a bare [data-direction="next"] also finds hidden views' pagination.
const PAG = '[data-clients-pagination]';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|realtime/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// The hover-overlay sidebar expands over the toolbar's left edge.
async function restMouse() {
  await page.mouse.move(1250, 640);
  await page.waitForTimeout(400);
}

async function openFilterField(field) {
  await restMouse();
  await page.click('[data-clients-filter]');
  await page.waitForTimeout(300);
  await page.click(`[data-clients-filter-field="${field}"]`);
  await page.waitForTimeout(350);
}

const rowCount = () => page.locator(CLIENT_ROW).count();

try {
  step(1, 'Signing in and loading the directory');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
  }
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForSelector(CLIENT_ROW, { timeout: 60000 });

  step(2, 'The total is stated at the top');
  const countEl = page.locator('[data-clients-count]');
  check(await countEl.isVisible(), 'a count is shown above the table');
  const countText = (await countEl.textContent()).trim();
  const total = Number(countText.replace(/[^0-9]/g, ''));
  check(total > 1000, `it reports the whole directory, not the page (${countText})`);
  const countBox = await countEl.boundingBox();
  const tableBox = await page.locator('.tma-dash__ctable--clients').boundingBox();
  check(countBox.y < tableBox.y, 'and it sits above the table, not below it');

  step(3, 'Default page size is 100');
  const size = (await page.locator(PAG + ' [data-clients-page-size] .tma-pagination__label').textContent()).trim();
  check(size === '100', `page size defaults to 100 (got ${size})`);
  check(await rowCount() === 100, `100 rows are drawn (got ${await rowCount()})`);

  step(4, 'Pagination reports the page count and can reach the last page');
  const results = (await page.locator(PAG + ' [data-clients-results-count]').textContent()).trim();
  check(/page \d+ of [\d,]+/.test(results), `the bar states which page of how many ("${results}")`);
  const lastPage = Number(results.split('of')[1].replace(/[^0-9]/g, ''));
  check(lastPage > 5, `there are more pages than the old five-button window (${lastPage})`);

  await restMouse();
  await page.click(PAG + ' [data-direction="last"]');
  await page.waitForTimeout(700);
  const onLast = (await page.locator(PAG + ' [data-clients-results-count]').textContent()).trim();
  check(onLast.includes(`page ${lastPage.toLocaleString()} of`), `Last jumps to page ${lastPage} ("${onLast}")`);
  check(await page.locator(PAG + ' [data-direction="next"]').isDisabled(), 'Next is disabled on the last page');
  check(await rowCount() > 0, 'the last page actually has rows on it');

  await page.click(PAG + ' [data-direction="first"]');
  await page.waitForTimeout(700);
  check((await page.locator(PAG + ' [data-clients-results-count]').textContent()).includes('page 1 of'), 'First returns to page 1');

  step(5, 'The page-size control cycles and the table follows');
  await page.click(PAG + ' [data-clients-page-size]');
  await page.waitForTimeout(700);
  const newSize = Number((await page.locator(PAG + ' [data-clients-page-size] .tma-pagination__label').textContent()).trim());
  check(newSize !== 100, `page size changed (now ${newSize})`);
  check(await rowCount() === newSize, `the table draws ${newSize} rows to match`);
  await page.click(PAG + ' [data-clients-page-size]');
  await page.waitForTimeout(700);

  step(6, 'The table scrolls sideways instead of overflowing the page');
  const scroller = page.locator('[data-clients-scroll]');
  check(await scroller.count() === 1, 'the table has its own scroll container');
  const overflowsBody = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflowsBody, 'the page body does not scroll horizontally');
  const canScroll = await page.evaluate(() => {
    const el = document.querySelector('[data-clients-scroll]');
    return { scrollable: el.scrollWidth >= el.clientWidth, clipped: getComputedStyle(el).overflowX };
  });
  check(canScroll.clipped === 'auto', `the container owns the horizontal scroll (${canScroll.clipped})`);

  step(7, 'Row checkboxes select, and the toolbar reacts');
  await restMouse();
  const firstCheck = page.locator(`${CLIENT_ROW} [data-clients-check]`).first();
  await firstCheck.check();
  await page.waitForTimeout(250);
  check(await firstCheck.isChecked(), 'a row checkbox ticks');
  const bulk = page.locator('[data-clients-bulk]');
  check(await bulk.isVisible(), 'the bulk bar appears once something is selected');
  check((await page.locator('[data-clients-selection-count]').textContent()).trim() === '1 Selected',
    'and it counts one');

  await firstCheck.uncheck();
  await page.waitForTimeout(250);
  check(!(await bulk.isVisible()), 'unticking hides the bulk bar again');

  step(8, 'Select-all covers the page, and clears again');
  const selectAll = page.locator('[data-clients-selectall]');
  await selectAll.check();
  await page.waitForTimeout(500);
  const boxes = await page.locator(`${CLIENT_ROW} [data-clients-check]`).count();
  const ticked = await page.locator(`${CLIENT_ROW} [data-clients-check]:checked`).count();
  check(boxes === ticked, `every checkbox on the page is ticked (${ticked}/${boxes})`);
  const selLabel = (await page.locator('[data-clients-selection-count]').textContent()).trim();
  check(selLabel === `${boxes} Selected`, `the toolbar agrees (${selLabel})`);

  await selectAll.uncheck();
  await page.waitForTimeout(500);
  check(await page.locator(`${CLIENT_ROW} [data-clients-check]:checked`).count() === 0, 'select-all clears everything');

  step(9, 'Client type counts match what filtering returns');
  await openFilterField('clientType');
  const typeValues = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-clients-filter-value]')).map((b) => ({
      value: b.getAttribute('data-clients-filter-value'),
      label: b.querySelector('.tma-filter-popover__item-label')?.textContent.trim(),
      meta: b.querySelector('.tma-filter-popover__item-meta')?.textContent.trim(),
    })));
  const company = typeValues.find((v) => v.value === 'company');
  const priv = typeValues.find((v) => v.value === 'private');
  check(!!company?.meta && Number(company.meta) > 0, `Company shows a count (${company?.meta})`);
  check(!!priv?.meta && Number(priv.meta) > 0, `Private shows a count (${priv?.meta})`);

  await page.click('[data-clients-filter-value="company"]');
  await page.waitForTimeout(800);
  const companyShown = Number((await page.locator('[data-clients-count]').textContent()).replace(/of.*$/, '').replace(/[^0-9]/g, ''));
  check(companyShown === Number(company.meta),
    `filtering by Company returns exactly its count (${companyShown} vs ${company.meta})`);

  await restMouse();
  await page.click('[data-clients-reset-filters]');
  await page.waitForTimeout(600);

  step(10, 'Filter popovers fit long names and scroll');
  await openFilterField('referral');
  const pop = page.locator('[data-clients-popover="values"]');
  const geom = await page.evaluate(() => {
    const el = document.querySelector('[data-clients-popover="values"]');
    const r = el.getBoundingClientRect();
    const items = Array.from(el.querySelectorAll('.tma-filter-popover__item'));
    const overflowing = items.filter((i) => i.getBoundingClientRect().right > r.right + 1).length;
    return {
      width: Math.round(r.width), height: Math.round(r.height),
      scrollable: el.scrollHeight > el.clientHeight,
      inViewport: r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
      overflowing,
      items: items.length,
    };
  });
  check(await pop.isVisible(), 'the values popover opens');
  check(geom.overflowing === 0, `no item spills outside the panel (${geom.overflowing} of ${geom.items})`);
  check(geom.inViewport, 'the panel stays inside the viewport');
  check(geom.width >= 240, `it is at least the minimum width (${geom.width}px)`);
  const longest = await page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('[data-clients-popover="values"] .tma-filter-popover__item-label'))
      .map((l) => l.scrollWidth - l.clientWidth)));
  check(longest <= 0, `no label is clipped horizontally (worst overflow ${longest}px)`);
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/clients-table.png', fullPage: false }).catch(() => {});
} finally {
  await browser.close();
}

log('\n' + '─'.repeat(56));
errors.forEach((e) => log('  ! ' + e));
if (failures.length) {
  log(`✗ ${failures.length} failed`);
  failures.forEach((f) => log('  - ' + f));
  process.exit(1);
}
log('✓ all checks passed');
