import { chromium } from 'playwright';

/**
 * Clicking a file on the Dashboard opens it — in the File Library's viewer.
 *
 * The Recent Files / Shared-with-me tables named every row but had nowhere to
 * take you: a filename click navigated to the folder the file lives in and
 * left the reader to find it again. They now hand the file to
 * TMAFileActions.open, the same seam a client's Documents tab opens through,
 * so it is the same window from every list — the file's comments, versions,
 * review controls and details, not a second lighter viewer that only knew how
 * to show the bytes.
 *
 * What only a browser can show is that the *stage* is right for each kind:
 * pdf.js actually paints a canvas, a photo paints an <img>, a text file paints
 * its text, and a type with no in-browser preview gets the honest card with a
 * download rather than a blank screen. It also pins the three rules around it
 * — the panel is the full one, the rail steps through the table the row was
 * clicked in, and a folder row still navigates instead of opening a viewer.
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

const viewer = () => page.locator('.tma-portal-viewer');
const title = async () => (await page.textContent('.tma-portal-viewer__name').catch(() => '')) || '';

/* The desktop sidebar can be set to Hover Overlay and expands over the left of
   the table, so the pointer is parked on the right before every click. */
async function park() { await page.mouse.move(1400, 500); }

async function openFile(name) {
  await park();
  await page.locator(`[data-home-lib-open]:text-is("${name}")`).first().click();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 10000 });
  await page.waitForTimeout(900);
}

async function closeViewer() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

try {
  step(1, 'Open the Dashboard');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  check(await page.evaluate(() => !!(window.TMAFileActions && window.TMAFileActions.open)),
    'the File Library exposes its viewer to other lists');

  step(2, 'A PDF opens in the File Library viewer and pdf.js paints it');
  await openFile('Engagement letter.pdf');
  check(await viewer().count() === 1, 'the File Library viewer opened');
  check((await title()).trim() === 'Engagement letter.pdf',
    `it names the file that was clicked (got "${(await title()).trim()}")`);
  check(await page.locator('[data-lb-pdf]').count() === 1, 'the stage is the viewer’s own PDF reader');
  await page.waitForSelector('.tma-portal-viewer canvas', { timeout: 20000 }).catch(() => {});
  const canvases = await page.locator('.tma-portal-viewer canvas').count();
  check(canvases > 0, `a page was actually rendered (${canvases} canvas(es))`);

  step(3, 'It is the full panel, not a bare preview');
  check(await page.locator('.tma-portal-viewer__tools').count() === 1,
    'the viewer’s own toolbar');
  // The details panel starts closed here exactly as it does inside the File
  // Library — `viewerPrefs.panel` is false until asked for — so it is opened
  // the way a reader opens it rather than asserted on the collapsed markup.
  await page.locator('[data-lb-act="panel"]').first().click();
  await page.waitForTimeout(1200);
  check(await page.locator('.tma-portal-viewer__tabs:visible').count() === 1,
    'the file’s own panel opens from the toolbar');
  const tabs = await page.locator('.tma-portal-viewer__tabs button:visible').evaluateAll(
    (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
  check(tabs.length >= 3, `with the library's own tabs (${tabs.join(' | ')})`);
  check(await page.locator('[data-lb-panel-body]:visible').count() === 1,
    'and the panel body beside the file');
  // A PDF's left rail is its page thumbnails, so the file-stepping rail is
  // checked on the photograph below rather than here.
  await closeViewer();

  step(4, 'A photo paints as an image, beside the rest of the table');
  await openFile('Site photo.png');
  await page.waitForTimeout(1200);
  const img = await page.evaluate(() => {
    const el = document.querySelector('.tma-portal-viewer__img');
    return el ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  });
  check(!!img && img.w > 0 && img.h > 0,
    `the photo decoded (${img ? img.w + '×' + img.h : 'no image'})`);

  const rail = await page.locator('[data-lb-go]').count();
  const files = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=recent&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return ((await r.json()).files || []).length;
  });
  check(rail === files, `the rail holds the tab's files and no folders (${rail} of ${files})`);
  const labels = await page.locator('[data-lb-go]').evaluateAll(
    (els) => els.map((e) => (e.getAttribute('title') || '').trim()));
  check(!labels.some((l) => l === 'Lightbox Test'), 'the folder row is not in the set');

  step(5, 'The rail really steps to another file');
  const pdfAt = labels.indexOf('Engagement letter.pdf');
  check(pdfAt > -1, 'the PDF is in the rail');
  if (pdfAt > -1) {
    await page.locator('[data-lb-go]').nth(pdfAt).click();
    await page.waitForTimeout(2000);
    check((await title()).trim() === 'Engagement letter.pdf',
      `the panel moved to it (got "${(await title()).trim()}")`);
  }

  step(6, 'Escape closes it');
  await closeViewer();
  check(await viewer().count() === 0, 'the viewer is gone');

  step(7, 'A text file shows its text');
  await openFile('Meeting notes.txt');
  await page.waitForTimeout(1500);
  const text = (await page.textContent('[data-lb-text]').catch(() => '')) || '';
  check(text.includes('Lightbox notes'), `the note is on screen (got "${text.trim().slice(0, 40)}")`);
  await closeViewer();

  step(8, 'A type with no in-browser preview says so, and still downloads');
  await openFile('Quarterly report.docx');
  check(await page.locator('.tma-portal-viewer__nopreview').count() === 1,
    'the honest no-preview card, not a blank stage');
  check(await page.locator('[data-lb-act="download"]').count() > 0,
    'the download is still offered');
  await closeViewer();

  step(9, 'A folder row still navigates, it is not a viewer');
  await park();
  await page.locator('[data-home-lib-row][data-type="folder"] [data-home-lib-open]').first().click();
  await page.waitForTimeout(1500);
  check(await viewer().count() === 0, 'no viewer for a folder');
  const inLibrary = await page.evaluate(() =>
    !!document.querySelector('[data-view="folders"]:not([hidden])'));
  check(inLibrary, 'it opened the File Library instead');

  step(10, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((e) => log('      ' + e));
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/home-library-viewer.png' }).catch(() => {});
} finally {
  await browser.close();
  log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
  failures.forEach((f) => log(`  - ${f}`));
  process.exit(failures.length ? 1 : 0);
}
