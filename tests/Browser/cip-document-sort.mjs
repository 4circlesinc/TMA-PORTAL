import { chromium } from 'playwright';

/*
 * The Order control on Templates → Document requirements.
 *
 * The checklists are kept in the firm's own arrangement — dragged, or nudged
 * with the carets, written to sort_order. This control lets a reader take the
 * same rows A-Z without disturbing that. The whole point is that it is a
 * *view*: PHPUnit can pin the preference round-tripping, but only a browser
 * can show that switching to A-Z and back hands the arrangement over
 * untouched, which is the failure worth fearing here — a "sort" that quietly
 * renumbers the firm's order is not reversible, and nobody would notice until
 * the arrangement was already gone.
 *
 * The seed's manual order is Zebra, Apple, Mango, chosen so that alphabetical
 * and manual can never be mistaken for one another. A test seeded in an order
 * that happens to be alphabetical agrees with a broken toggle.
 *
 * It also checks the reorder controls stand down under A-Z. They write
 * positions taken from the rows as displayed, so leaving them live under a
 * sorted view is an invitation to overwrite the arrangement by dragging what
 * looks like a row into what looks like a gap.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const MANUAL = ['Zebra form', 'Apple letter', 'Mango deed'];
const ALPHA = ['Apple letter', 'Mango deed', 'Zebra form'];

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

/** The document names as the table actually prints them, top to bottom. */
const labels = () => page.evaluate(() => [...document.querySelectorAll(
  '.tma-portal-table--cipdocs tbody tr td.tma-portal-cell--wrap strong',
)].map(el => el.textContent.trim()));

const pill = name => page.locator(`[data-cipdoc-sort="${name}"]`);

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(700);
  }

  /* ── The arrangement, as kept ──────────────────── */

  step(1, 'The page opens on the firm’s own order');
  await page.goto(`${BASE}/templates/documents`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-table--cipdocs tbody tr', { timeout: 30000 });
  await page.waitForTimeout(400);

  check(JSON.stringify(await labels()) === JSON.stringify(MANUAL),
    `rows read ${MANUAL.join(', ')} (got ${(await labels()).join(', ')})`);
  check(await pill('manual').getAttribute('aria-pressed') === 'true', 'Custom is the pressed pill');
  check(await pill('alpha').getAttribute('aria-pressed') === 'false', 'A–Z is not');

  // The arrangement is only arrangeable while the screen IS the arrangement.
  check(await page.locator('[data-cipdoc-up]').count() > 0, 'the carets are here to nudge with');
  check(await page.locator('.tma-portal-icon-btn--grip').count() > 0, 'and the grip to drag by');

  /* ── Read A-Z ──────────────────────────────────── */

  step(2, 'A–Z reorders what is shown, and stands the arranging down');
  await pill('alpha').click();
  await page.waitForTimeout(500);

  check(JSON.stringify(await labels()) === JSON.stringify(ALPHA),
    `rows read ${ALPHA.join(', ')} (got ${(await labels()).join(', ')})`);
  check(await pill('alpha').getAttribute('aria-pressed') === 'true', 'A–Z is now the pressed pill');
  check(await page.locator('[data-cipdoc-up]').count() === 0, 'no carets to nudge a sorted row with');
  check(await page.locator('[data-cipdoc-row]').count() === 0, 'and no row offers itself to a drag');

  /*
   * The saved order is the server's answer, not the screen's. Asking the
   * endpoint directly is the only way to tell a view from a write: a toggle
   * that had renumbered sort_order would still *look* right here.
   */
  const savedUnderAlpha = await page.evaluate(async () => {
    const r = await fetch('/portal/cip/requirements', { headers: { Accept: 'application/json' } });
    const d = await r.json();
    return (d.types.find(t => t.value === 'principal_applicant')?.requirements || []).map(x => x.label);
  });
  check(JSON.stringify(savedUnderAlpha) === JSON.stringify(MANUAL),
    `the saved order is still ${MANUAL.join(', ')} (got ${savedUnderAlpha.join(', ')})`);

  /* ── The choice is remembered ──────────────────── */

  step(3, 'The reading survives a reload, and the account remembers it');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-table--cipdocs tbody tr', { timeout: 30000 });
  await page.waitForTimeout(600);

  check(JSON.stringify(await labels()) === JSON.stringify(ALPHA), 'still A–Z after a reload');

  const stored = await page.evaluate(async () => {
    const r = await fetch('/me/preferences', { headers: { Accept: 'application/json' } });
    return (await r.json()).cipDocumentSort;
  });
  check(stored === 'alpha', `the account holds it (cipDocumentSort = ${stored})`);

  /* ── And handed back ───────────────────────────── */

  step(4, 'Custom gives the arrangement back exactly as it was');
  await pill('manual').click();
  await page.waitForTimeout(500);

  check(JSON.stringify(await labels()) === JSON.stringify(MANUAL),
    `rows read ${MANUAL.join(', ')} again (got ${(await labels()).join(', ')})`);
  check(await page.locator('[data-cipdoc-up]').count() > 0, 'the carets are back');
  check(await page.locator('[data-cipdoc-row]').count() > 0, 'and so is the drag');

  /* ── Sorting is not a tick ─────────────────────── */

  step(5, 'Nothing that was ticked was changed by any of it');
  const ticked = await page.evaluate(() =>
    [...document.querySelectorAll('.tma-portal-table--cipdocs tbody tr')].map(tr => ({
      name: tr.querySelector('td.tma-portal-cell--wrap strong')?.textContent.trim(),
      boxes: [...tr.querySelectorAll('input[type="checkbox"]')].map(b => b.checked),
    })));
  // Every row was seeded required + pre-approval, and a view has no business
  // touching either.
  check(ticked.length === 3 && ticked.every(r => r.boxes[0] === true && r.boxes[1] === true),
    'each row is still Required and Pre-approval');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.log(`\n✗ ${e.message}`);
} finally {
  await page.screenshot({ path: 'tests/Browser/cip-document-sort.png', fullPage: true }).catch(() => {});
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
