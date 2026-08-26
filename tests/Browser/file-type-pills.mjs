import { chromium } from 'playwright';

/**
 * The File Library's type pills, under the tools.
 *
 * The same six the Dashboard's file tables offer, wearing the same marks, so a
 * reader who narrows to Word on the board narrows to Word here. They write the
 * toolbar's own `filterType`, which the "All types" menu also writes — this
 * checks the two never disagree, because two controls for one value is exactly
 * where a filter starts lying about what it is showing.
 *
 * Two things it was written to catch, neither of which a server test can see:
 *
 *   - The library repaints through TMAMorph, which KEEPS these nodes. Binding
 *     per render rather than per element stacked a second handler on every
 *     repaint, so a click toggled the filter twice and the pill appeared to
 *     refuse to switch off. Pressing one twice is the assertion.
 *   - The row must not appear in the recycle bin, which is a list of things on
 *     their way out rather than a library to browse by type.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 TMA_FOLDER=<folder uuid> \
 *     node tests/Browser/file-type-pills.mjs
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const FOLDER = process.env.TMA_FOLDER || '';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
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
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
});

const rows = () => page.locator('[data-files-row]');
/* The desktop sidebar can be set to Hover Overlay and expands over the left of
   the page, where these pills are. */
async function park() { await page.mouse.move(1400, 500); }

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(800);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  step(1, 'Open a folder in the File Library');
  await signIn();
  await page.goto(`${BASE}/folders/all${FOLDER ? '?folder=' + FOLDER : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-files-row]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await park();

  step(2, 'The pills sit under the tools, and carry their marks');
  const shape = await page.evaluate(() => {
    const page_ = document.querySelector('.tma-portal-page--files');
    if (!page_) return null;
    const row = page_.querySelector('.tma-portal-files__types');
    const toolbar = page_.querySelector('.tma-portal-files__toolbar');
    return {
      there: !!row,
      // Node.DOCUMENT_POSITION_FOLLOWING: the row comes after the toolbar.
      belowTools: !!(row && toolbar && (toolbar.compareDocumentPosition(row) & 4)),
      keys: Array.from(page_.querySelectorAll('[data-files-type-pill]')).map((b) => b.getAttribute('data-files-type-pill')),
      marks: Array.from(page_.querySelectorAll('[data-files-type-pill]'))
        .every((b) => !!b.querySelector('.tma-portal-type-pill__icon')),
    };
  });
  check(!!shape && shape.there, 'the row is drawn');
  check(!!shape && shape.belowTools, 'below the tools, not in them');
  check(!!shape && shape.marks, 'every pill carries its file mark');
  ['pdf', 'word', 'excel', 'powerpoint', 'image', 'archive'].forEach((k) => {
    check(!!shape && shape.keys.includes(k), `${k} is offered`);
  });

  step(3, 'Pressing one narrows the listing');
  const before = await rows().count();
  await park();
  await page.click('[data-files-type-pill="pdf"]');
  await page.waitForTimeout(2500);
  const narrowed = await rows().count();
  check(narrowed > 0 && narrowed < before, `PDF narrows the folder (${before} → ${narrowed})`);
  check(await page.locator('[data-files-type-pill="pdf"].is-active').count() === 1, 'and the pill reads as pressed');

  step(4, 'The toolbar menu and the pills are one filter, not two');
  // The button's own label, not the menu behind it — the menu lists every type
  // whatever is chosen, so reading the whole thing would pass on any filter.
  const menuSays = ((await page.textContent(
    '[data-files-filter-menu] [data-head-dropdown-toggle]')) || '').trim();
  check(menuSays === 'PDF', `the "All types" menu agrees (says "${menuSays}")`);

  step(5, 'Pressing it again clears it — once, not twice');
  /*
   * The bug this catches: bound per render instead of per element, the click
   * ran the toggle twice and the listing never came back.
   */
  await park();
  await page.click('[data-files-type-pill="pdf"]');
  await page.waitForTimeout(2500);
  check(await rows().count() === before, `the whole folder is back (${await rows().count()} of ${before})`);
  check(await page.locator('.tma-portal-type-pill.is-active').count() === 0, 'and no pill is left pressed');

  step(6, 'The recycle bin has no type row');
  await park();
  await page.goto(`${BASE}/folders/recycle`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  check(await page.locator('.tma-portal-files__types').count() === 0,
    'a list of things on their way out is not browsed by type');

  step(7, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((e) => log('      ' + e));
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/file-type-pills.png' }).catch(() => {});
} finally {
  await browser.close();
  log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
  failures.forEach((f) => log(`  - ${f}`));
  process.exit(failures.length ? 1 : 0);
}
