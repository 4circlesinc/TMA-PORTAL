import { chromium } from 'playwright';

/**
 * Thumbnails, everywhere a file is listed.
 *
 * Lists used to show a type glyph and nothing else: a folder of passports,
 * scans and photographs read as one repeated green picture mark. Two things
 * changed. Every list now draws the server's image thumbnail through one
 * shared helper (TMAFileThumbs), and PDFs — which this stack cannot rasterise
 * server-side, no ghostscript — have page one painted in the browser by pdf.js
 * and swapped in over the icon.
 *
 * The PDF path is the one only a browser can check: the markup ships the icon,
 * and the thumbnail only exists after pdf.js has rendered. Each check below
 * therefore waits for a `data:` src, which is what proves a page was really
 * painted rather than a URL merely being emitted.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/file-thumbnails.mjs
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

/* Every range request pdf.js makes for a document preview, so "painted once"
   can be checked at the network rather than taken on trust. */
const pdfBytes = new Set();
const pdfLog = [];
let pdfRequests = 0;
page.on('request', (r) => {
  if (!/\/files\/[^/]+\/preview/.test(r.url())) return;
  pdfRequests += 1;
  pdfBytes.add(r.url() + '#' + (r.headers().range || ''));
  pdfLog.push((r.headers().range || 'whole file') + ' @' + Date.now());
});

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

/* Every <img> that is showing a real preview, by the file it belongs to. The
   row's own name is read from its nearest labelled ancestor. */
async function previews() {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('img').forEach((img) => {
      const row = img.closest('[data-files-row], [data-home-lib-row], [data-clients-row], [data-cbi-row], .tma-portal-file-card, .tma-portal-file-row');
      if (!row) return;
      const name = (row.textContent || '').trim().split('\n')[0].trim();
      out.push({
        name: name,
        src: img.getAttribute('src') || '',
        cls: img.className,
        painted: (img.getAttribute('src') || '').startsWith('data:image'),
        real: img.classList.contains('tma-file-thumb'),
        w: img.clientWidth,
        h: img.clientHeight,
      });
    });
    return out;
  });
}

/* pdf.js renders after the row is on screen, so every check waits for the
   painted page rather than sampling once. */
async function waitForPainted(nameFragment, timeout) {
  const until = Date.now() + (timeout || 20000);
  for (;;) {
    const found = (await previews()).find(
      (p) => p.name.includes(nameFragment) && p.painted);
    if (found) return found;
    if (Date.now() > until) return null;
    await page.waitForTimeout(500);
  }
}

async function park() { await page.mouse.move(1400, 500); }

try {
  step(1, 'Sign in');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  check(await page.evaluate(() => !!window.TMAFileThumbs),
    'the shared thumbnail helper is on the page');

  step(2, 'Dashboard → Recent Files');
  await page.waitForTimeout(2500);
  let shown = await previews();
  const photo = shown.find((p) => p.name.includes('Passport photo.png'));
  check(!!photo && /\/files\/.*thumb|thumb/.test(photo.src) && photo.real,
    `the photograph draws the server's thumbnail (${photo ? photo.src.split('/').pop() : 'no row'})`);

  const pdfRow = await waitForPainted('Engagement letter.pdf');
  check(!!pdfRow, 'the PDF is painted by pdf.js into the row');
  check(!!pdfRow && pdfRow.cls.includes('tma-file-thumb--doc'),
    'and is marked as a document thumbnail (cropped from the top)');

  shown = await previews();
  const docx = shown.find((p) => p.name.includes('Quarterly report.docx'));
  check(!!docx && !docx.painted && /\.svg$/.test(docx.src),
    `a .docx keeps its type icon — nothing can preview it (${docx ? docx.src.split('/').pop() : 'no row'})`);

  /*
   * Every PDF gets a picture, including one whose first page is blank.
   *
   * That page is read twice — the fast range-fed pass, then the whole file —
   * because an empty render is what a scan looks like when pdf.js has not
   * fetched its image yet, and treating empty as "no preview" is what put a
   * red PDF mark on every scan in the portal. After a complete read, whatever
   * came back is the document.
   */
  const blank = await waitForPainted('Cover sheet.pdf');
  check(!!blank, 'a PDF whose first page is blank is still painted, not iconed');

  step(3, 'File Library → list');
  await page.goto(`${BASE}/folders/all?folder=${process.env.TMA_FOLDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-files-row]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const libPdf = await waitForPainted('Engagement letter.pdf');
  check(!!libPdf, 'the PDF row shows page one');
  shown = await previews();
  const libPhoto = shown.find((p) => p.name.includes('Passport photo.png'));
  check(!!libPhoto && libPhoto.real, 'the photograph shows its thumbnail');

  step(4, 'File Library → grid');
  await park();
  // One SPA shell holds every page's markup, so the same toggle exists three
  // times over in hidden views; only the visible one can be clicked.
  const gridBtn = page.locator('button[aria-label="Grid view"]:visible').first();
  if (await gridBtn.count()) {
    await gridBtn.click();
    await page.waitForTimeout(2000);
    const card = await waitForPainted('Engagement letter.pdf');
    check(!!card, 'the PDF card shows page one too');
    const cardShown = (await previews()).find((p) => p.name.includes('Engagement letter.pdf'));
    check(!!cardShown && cardShown.h > 20, `the card thumbnail has real height (${cardShown ? cardShown.h : 0}px)`);
  } else {
    check(false, 'found the grid view toggle');
  }

  step(5, 'Client hub → the client’s documents');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await park();
  // The client opens from the right-hand Clients list; its Documents tab is
  // the panel under test.
  await page.locator('.tma-dash__contact-name:visible', { hasText: 'Chen Wei' }).first().click();
  await page.waitForTimeout(3000);
  await page.locator('[data-clients-tab]:visible', { hasText: 'Documents' }).first().click();
  await page.waitForTimeout(3000);
  const clientPdf = await waitForPainted('Chen Wei — Passport bio page.pdf', 25000);
  check(!!clientPdf, 'the client document row shows page one of the PDF');
  const clientPhoto = (await previews()).find((p) => p.name.includes('Chen Wei — Passport photo.png'));
  check(!!clientPhoto && clientPhoto.real,
    'and the photograph is the photograph, not a green picture mark');
  check(!!clientPhoto && clientPhoto.w >= 32,
    `the preview fills the row tile (${clientPhoto ? clientPhoto.w : 0}px)`);

  step(6, 'A page is painted once, not on every repaint');
  /*
   * The lists here re-render constantly — every background poll morphs the
   * DOM and the fresh markup carries the icon again. Without the cache the
   * viewer would re-fetch and re-render the same PDF every few seconds, which
   * is the difference between this feature being free and being a bandwidth
   * leak. Counted at the network, which is the only place it shows.
   */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  await waitForPainted('Engagement letter.pdf');

  // Counted inside one page load: the cache lives as long as the page, and a
  // reload is entitled to paint again. Settle first — pdf.js finishes reading
  // the file a moment after the picture is on screen, and those bytes belong
  // to the first paint, not to the repaint under test.
  await page.waitForTimeout(2500);
  const before = pdfRequests;
  const seenBefore = new Set(pdfLog);
  await park();
  await page.click('[data-tab-key="shared"]');
  await page.waitForTimeout(1200);
  await page.click('[data-tab-key="recent"]');
  await page.waitForTimeout(2500);

  const repainted = (await previews()).find(
    (p) => p.name.includes('Engagement letter.pdf') && p.painted);
  check(!!repainted, 'the thumbnail is back on the row after the table re-renders');
  check(pdfRequests === before,
    `and cost nothing to put there (${pdfRequests - before} new requests for the document` +
    (pdfRequests === before ? '' : ': ' + pdfLog.filter((r) => !seenBefore.has(r)).join(', ')) + ')');

  step(7, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 5).forEach((e) => log('      ' + e));
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/file-thumbnails.png' }).catch(() => {});
} finally {
  await browser.close();
  log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
  failures.forEach((f) => log(`  - ${f}`));
  process.exit(failures.length ? 1 : 0);
}
