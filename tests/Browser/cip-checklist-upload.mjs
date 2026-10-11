import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tinyPdfBuffer } from './fixtures/tiny-pdf.mjs';

/*
 * Upload from the Documents checklist on an application.
 *
 * The checklist said which documents were still owed and then sent the
 * reader somewhere else to supply them. Each line that may be filed to now
 * carries an Upload control beside its name, the twin of the Download one:
 * hidden until the line is hovered or focused, and filed through the same
 * door the drops use (POST /portal/cip/documents/{id}/file).
 *
 * Which lines may be filed to is the server's answer (`canUpload`: an empty
 * slot, one sent back for an update, or the open Additional documents box,
 * never once the package is locked); CipDocumentUploadController and its
 * tests own that rule. Only a browser shows the rest, pinned here:
 *
 *  - a line still owed has the control, and a document already accepted
 *    does not;
 *  - it is invisible until the line is hovered, then it is there;
 *  - pressing it opens the file chooser, for a PDF or an image;
 *  - while the file is on its way the line says so and takes no second one;
 *  - once filed, the line is ticked, shows the document's status, offers
 *    Download, and the Upload control is gone, with no reload;
 *  - nothing else on the checklist moved.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL) and TMA_APP, the uuid of an application
 * whose main applicant has at least one accepted document and one empty
 * optional slot, package not confirmed. `fixtures/confirm-ready-seed.php`
 * makes exactly that. The check files a document, so seed a fresh
 * application for each run. See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const APP = process.env.TMA_APP;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

if (!APP) throw new Error('TMA_APP (an application uuid) is required');

/* The sign-in code, read out of the mail log (see cip-draft-autosave.mjs). */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];

  return hits.length ? hits[hits.length - 1][1] : null;
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const uploads = [];
page.on('response', r => { if (r.request().method() === 'POST' && /\/portal\/cip\/documents\/[^/]+\/file$/.test(r.url())) uploads.push(r.status()); });

const ROW = 'li.tma-dash__clients-checklist-row';
const UPLOAD = '.tma-dash__clients-checklist-upload';
/* What each line of the checklist shows, read off the page. */
const lines = () => page.locator(ROW).evaluateAll(rows => rows.map(r => ({
  label: (r.querySelector('.tma-dash__clients-checklist-label')?.textContent || '').replace(/\s+/g, ' ').replace(/Optional|\*/g, '').trim(),
  status: (r.querySelector('.tma-portal-status')?.textContent || '').trim(),
  ticked: !!r.querySelector('.tma-dash__check')?.checked,
  upload: r.querySelector('.tma-dash__clients-checklist-upload')?.getAttribute('data-cip-slot-file-btn') || null,
  download: !!r.querySelector('a.tma-dash__clients-checklist-download'),
})));
const says = (a, b) => String(a || '').toLowerCase() === b.toLowerCase();
const shown = (el) => el.evaluate(n => Number(getComputedStyle(n).opacity));

try {
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
    const trust = page.locator('input[type="checkbox"]').first();
    if (await trust.count()) await trust.check().catch(() => {});
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]')]);
    await page.waitForTimeout(700);
  }

  step(1, 'The checklist offers Upload on the lines still owed, and only those');
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`tr[data-cip-app="${APP}"]`, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator(`tr[data-cip-app="${APP}"] .tma-cip-table__number`).first().click();
  await page.locator('[data-clients-tab="applicant"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-clients-tab="applicant"]').first().click();
  await page.locator(ROW).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);

  const before = await lines();
  const owed = before.filter(l => says(l.status, 'Pending upload'));
  const accepted = before.filter(l => says(l.status, 'Ready for submission'));
  console.log(`      ${before.length} lines: ${accepted.length} accepted, ${owed.length} still owed`);
  check(owed.length > 0 && accepted.length > 0, 'the application has both kinds of line');
  check(owed.every(l => !!l.upload), 'every line still owed has an Upload control');
  check(accepted.every(l => !l.upload), 'no accepted document has one');
  check(accepted.every(l => l.download), 'and the accepted ones still offer Download');

  // An ordinary slot (one answer), not the open Additional documents box.
  const target = owed.find(l => !/^Additional documents$/i.test(l.label)) || owed[0];
  const row = page.locator(`${ROW}:has(${UPLOAD}[data-cip-slot-file-btn="${target.upload}"])`);
  const button = row.locator(UPLOAD);
  console.log(`      filing: ${target.label}`);

  step(2, 'It is hidden until the line is hovered');
  await page.mouse.move(700, 880);
  await page.waitForTimeout(250);
  check(await shown(button) === 0, 'not drawn at rest');
  await row.locator('.tma-dash__clients-checklist-label').hover();
  await page.waitForTimeout(250);
  check(await shown(button) === 1, 'hovering the name shows it');
  check(await button.evaluate(b => getComputedStyle(b.querySelector('.tma-dash__search-spinner')).display === 'none'), 'with the arrow, and no loader, at rest');
  check((await button.getAttribute('title')) === 'Upload', 'it says Upload');
  const box = await button.boundingBox();
  check(!!box && box.width >= 24 && box.height >= 24, `and is big enough to press (${box ? Math.round(box.width) + '×' + Math.round(box.height) : 'no box'})`);
  // Straight after the name, where the pointer is, not across the row.
  const name = await row.locator('.tma-dash__clients-checklist-label').boundingBox();
  const gap = Math.round(box.x - (name.x + name.width));
  check(gap >= 0 && gap <= 24, `it sits right after the name (${gap}px away)`);
  const line = await row.boundingBox();
  const chip = await row.locator('.tma-portal-status').boundingBox();
  check(Math.abs((chip.x + chip.width) - (line.x + line.width)) <= 2, 'and the status stays at the right edge of the line');
  await row.screenshot({ path: 'tests/Browser/cip-checklist-upload.png' });

  step(3, 'Pressing it opens the file chooser');
  const chooserP = page.waitForEvent('filechooser', { timeout: 8000 });
  await button.click();
  const chooser = await chooserP;
  const accept = await chooser.element().getAttribute('accept');
  check(/\.pdf/.test(accept || '') && /image/.test(accept || ''), `for a PDF or an image (${accept})`);

  step(4, 'The line says it is sending, and takes no second file meanwhile');
  // Held back a moment so the in-between state can be read.
  await page.route('**/portal/cip/documents/*/file', async (route) => {
    await new Promise(r => setTimeout(r, 1500));
    await route.continue();
  });
  await chooser.setFiles({ name: 'credentials.pdf', mimeType: 'application/pdf', buffer: tinyPdfBuffer() });
  await page.mouse.move(700, 880);
  await page.waitForTimeout(400);
  check((await button.getAttribute('aria-busy')) === 'true' && await button.isDisabled(), 'the control is busy and disabled');
  check((await button.getAttribute('title')) === 'Uploading…', 'and says Uploading…');
  // The search bar's loader, turning, in place of the arrow.
  const loader = await button.evaluate((b) => {
    const spin = b.querySelector('.tma-dash__search-spinner');
    const arrow = b.querySelector(':scope > img');
    const img = spin && spin.querySelector('img');

    return {
      spinnerShown: !!spin && getComputedStyle(spin).display !== 'none',
      arrowHidden: !!arrow && getComputedStyle(arrow).display === 'none',
      turning: !!img && getComputedStyle(img).animationName === 'tma-dash-spin',
      visible: Number(getComputedStyle(b).opacity) === 1,
    };
  });
  check(loader.spinnerShown && loader.arrowHidden, 'the arrow gives place to the loader');
  check(loader.turning, 'which is turning, the way the search bar\'s does');
  check(loader.visible, 'and stays in view though the pointer has moved off the line');
  // A second file offered to the same line while the first is on its way.
  await page.locator(`[data-cip-slot-file="${target.upload}"]`).setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: tinyPdfBuffer() });
  /*
   * The re-read of the whole record is held back, so what the line shows
   * in between is the upload's own answer. It used to go on saying Pending
   * upload with a live control until that read landed.
   */
  await page.route('**/portal/cip/clients/*/application', async (route) => {
    await new Promise(r => setTimeout(r, 2500));
    await route.continue();
  });
  await page.waitForFunction(() => /Document uploaded/.test(document.querySelector('.tma-toast-floating-host')?.textContent || ''), null, { timeout: 20000 });
  await page.unroute('**/portal/cip/documents/*/file');

  step(5, 'Filed: the line is ticked, shows its status, and the Upload control is gone');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  const atOnce = (await lines()).find(l => l.label === target.label);
  check(!!atOnce && atOnce.ticked && !atOnce.upload, 'at once, before the record has been read again');
  check(!!atOnce && says(atOnce.status, 'Application review'), `already reading Application review (${atOnce && atOnce.status})`);
  await page.unroute('**/portal/cip/clients/*/application');
  // Download arrives with the re-read, which brings the file's address.
  await page.waitForFunction((label) => {
    const rows = [...document.querySelectorAll('li.tma-dash__clients-checklist-row')];
    const r = rows.find(x => (x.querySelector('.tma-dash__clients-checklist-label')?.textContent || '').includes(label));

    return r && r.querySelector('.tma-dash__check')?.checked && r.querySelector('a.tma-dash__clients-checklist-download');
  }, target.label, { timeout: 20000 });
  const after = await lines();
  const filed = after.find(l => l.label === target.label);
  check(!!filed && filed.ticked, 'the line is ticked');
  check(!!filed && says(filed.status, 'Application review'), `it reads Application review (${filed && filed.status})`);
  check(!!filed && !filed.upload, 'the Upload control is gone from it');
  check(!!filed && filed.download, 'and Download is offered instead');
  check(uploads.length === 1 && uploads[0] === 200, `one file was sent, once (${uploads.join(',')})`);

  step(6, 'Nothing else on the checklist moved');
  const others = (list) => list.filter(l => l.label !== target.label).map(l => `${l.label}|${l.status}|${l.ticked}|${!!l.upload}`).join('\n');
  check(others(before) === others(after), 'every other line is as it was');
  check(after.length === before.length, `the same ${after.length} lines`);

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll checklist upload checks passed.');
process.exit(failures.length ? 1 : 0);
