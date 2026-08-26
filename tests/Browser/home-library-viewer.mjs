import { chromium } from 'playwright';

/**
 * Clicking a file on the Dashboard opens it, in the lightbox.
 *
 * The Recent Files / Shared-with-me tables named every row but had nowhere to
 * take you: a filename click navigated to the folder the file lives in and
 * left the reader to find it again. They now open the shared viewer
 * (window.TMAPortalLightbox), the same one the Overview → Files table, the
 * Feed and Messages use.
 *
 * What only a browser can show is that the *stage* is right for each kind:
 * pdf.js actually paints a canvas, a photo paints an <img>, a text file paints
 * its text, and a type with no in-browser preview gets the honest card with a
 * download rather than a blank screen. It also pins the two rules around it —
 * the set the arrows step through is the table the row was clicked in, and a
 * folder row still navigates instead of opening a viewer.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
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

const lightbox = () => page.locator('.tma-lightbox');
const title = async () => (await page.textContent('.tma-lightbox__title').catch(() => '')) || '';

/* The desktop sidebar can be set to Hover Overlay and expands over the left of
   the table, so the pointer is parked on the right before every click. */
async function park() { await page.mouse.move(1400, 500); }

async function openFile(name) {
  await park();
  await page.locator(`[data-home-lib-open]:text-is("${name}")`).first().click();
  await page.waitForSelector('.tma-lightbox', { timeout: 8000 });
  await page.waitForTimeout(600);
}

async function closeLightbox() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

try {
  step(1, 'Open the Dashboard');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  check(await page.evaluate(() => !!window.TMAPortalLightbox),
    'the shared lightbox is on the page');

  step(2, 'A PDF opens in the lightbox and pdf.js paints it');
  await openFile('Engagement letter.pdf');
  check(await lightbox().count() === 1, 'the lightbox opened');
  check((await title()).trim() === 'Engagement letter.pdf',
    `it names the file that was clicked (got "${(await title()).trim()}")`);
  check(await page.locator('[data-lb-doc="pdf"]').count() === 1, 'the stage is a PDF document');
  await page.waitForSelector('.tma-lightbox__doc canvas', { timeout: 15000 }).catch(() => {});
  const canvases = await page.locator('.tma-lightbox__doc canvas').count();
  check(canvases > 0, `a page was actually rendered (${canvases} canvas(es))`);
  check(await page.locator('[data-lb-download]').count() === 1, 'it offers the download');

  step(3, 'The arrows step through the rest of the table, not the whole library');
  const strip = await page.locator('[data-lb-thumb]').count();
  const files = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=recent&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return ((await r.json()).files || []).length;
  });
  check(strip === files, `the filmstrip holds the tab's files and no folders (${strip} of ${files})`);
  const labels = await page.locator('[data-lb-thumb]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')));
  check(!labels.some((l) => l === 'Lightbox Test'), 'the folder row is not in the set');

  step(4, 'A photo paints as an image');
  await page.locator('[data-lb-thumb]').nth(labels.indexOf('Site photo.png')).click();
  await page.waitForTimeout(1200);
  check((await title()).trim() === 'Site photo.png', 'stepping to the photo updates the title');
  const img = await page.evaluate(() => {
    const el = document.querySelector('.tma-lightbox img[data-lb-zoom]');
    return el ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  });
  check(!!img && img.w > 0 && img.h > 0,
    `the photo decoded (${img ? img.w + '×' + img.h : 'no image'})`);

  step(5, 'Escape closes it');
  await closeLightbox();
  check(await lightbox().count() === 0, 'the lightbox is gone');

  step(6, 'A text file shows its text');
  await openFile('Meeting notes.txt');
  await page.waitForTimeout(1200);
  const text = (await page.textContent('[data-lb-doc="text"]').catch(() => '')) || '';
  check(text.includes('Lightbox notes'), `the note is on screen (got "${text.trim().slice(0, 40)}")`);
  await closeLightbox();

  step(7, 'A type with no in-browser preview says so, and still downloads');
  await openFile('Quarterly report.docx');
  check(await page.locator('.tma-lightbox__nopreview').count() === 1,
    'the honest no-preview card, not a blank stage');
  check(await page.locator('[data-lb-download]').count() === 1, 'the download is still offered');
  await closeLightbox();

  step(8, 'A folder row still navigates, it is not a viewer');
  await park();
  await page.locator('[data-home-lib-row][data-type="folder"] [data-home-lib-open]').first().click();
  await page.waitForTimeout(1500);
  check(await lightbox().count() === 0, 'no lightbox for a folder');
  const inLibrary = await page.evaluate(() =>
    !!document.querySelector('[data-view="folders"]:not([hidden])'));
  check(inLibrary, 'it opened the File Library instead');

  step(9, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((e) => log('      ' + e));
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/home-library-lightbox.png' }).catch(() => {});
} finally {
  await browser.close();
  log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
  failures.forEach((f) => log(`  - ${f}`));
  process.exit(failures.length ? 1 : 0);
}
