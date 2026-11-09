import { chromium } from 'playwright';
import { tinyPdfBuffer } from './fixtures/tiny-pdf.mjs';
import { attachFamilyDocuments } from './helpers/cip-required-docs.mjs';
import { deflateSync } from 'node:zlib';

/*
 * A NEW application filed on a line that cannot carry it.
 *
 * cip-offline.mjs edits a filed application with the network switched off.
 * This files a new one on the line that actually loses them: the filing
 * request does not get through, every small request does. That is the case
 * where the old form deleted the draft as it parked the filing (the DELETE
 * got through), and the filing, which does not re-send scans the draft
 * already held, was then refused for documents the reader had attached.
 *
 * What it pins, in the portal itself against a real server:
 *   - the draft autosaves, the filing is parked naming that draft, and the
 *     draft is NOT deleted;
 *   - the table shows the filing once, "Saved offline", without the draft's
 *     own row beside it;
 *   - on the bad line it keeps waiting with a reason, not "Not sent";
 *   - opened from the table it opens on the draft, its scans in place;
 *   - when the line comes back it files by itself, completing that same
 *     draft row, and its row and a toast naming it appear.
 *
 * Same setup as cip-intake.mjs (an administrator or officer, a provider, the
 * module on). The administrator must not have signed in before on the
 * throwaway database, or the sign-in asks for an emailed code.
 */

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const SHOTS = process.env.SHOTS || '';

function png(size) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) { const row = y * (1 + size * 3); for (let x = 0; x < size; x++) { raw[row + 1 + x * 3] = 200; raw[row + 2 + x * 3] = 210; raw[row + 3 + x * 3] = 220; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pdf = () => tinyPdfBuffer();

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

let browser;
try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ channel: 'chrome' }); }
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 960 } });
await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
const page = await context.newPage();
async function until(fn, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await fn()) return true; await page.waitForTimeout(250); }
  return false;
}

const draftDeletes = [];
page.on('request', (req) => {
  if (req.method() === 'DELETE' && req.url().includes('/portal/cip/applications/draft')) draftDeletes.push(req.url());
});
const toasts = [];
await page.exposeFunction('__toast', (t) => toasts.push(t));

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
  console.log('signed in at', page.url());

  step(1, 'A new application, typed while online: its draft autosaves');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-head-dropdown-item="create-pre-approval"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1200);
  // Every toast the portal shows, kept.
  await page.evaluate(() => {
    const wrap = (host, k) => {
      if (!host || typeof host[k] !== 'function') return;
      const f = host[k];
      host[k] = function (m) { window.__toast(String(m)); return f.apply(this, arguments); };
    };
    wrap(window.TMAPortalUI, 'toast');
    wrap(window.TMAPortalUI, 'toastError');
    wrap(window.TMAToast, 'showFloatingToast');
  });
  await page.locator('button:visible', { hasText: 'Create New Application' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-head-dropdown-item="create-pre-approval"]:visible').first().click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });

  await page.fill('[data-cip-field="firstName"]', 'Omar');
  await page.fill('[data-cip-field="lastName"]', 'Haddad');
  await page.selectOption('[data-cip-field="gender"]', 'Male');
  await page.fill('[data-cip-field="dateOfBirth"]', '1979-05-14');
  await page.selectOption('[data-cip-field="countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="countryOfResidence"]', 'United Arab Emirates');
  await page.fill('[data-cip-field="occupation"]', 'Engineer');
  await page.fill('[data-cip-field="passportNumber"]', 'L1234567');
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
  await page.selectOption('[data-cip-field="sponsored"]', '0');
  if (await page.locator('[data-cip-field="providerId"] option').count() > 1) {
    const value = await page.$eval('[data-cip-field="providerId"] option:nth-child(2)', o => o.value);
    await page.selectOption('[data-cip-field="providerId"]', value);
  }
  await page.setInputFiles('[data-cip-photo="passportPhoto"]', { name: 'passport.png', mimeType: 'image/png', buffer: png(600) });
  await page.setInputFiles('[data-cip-file="passportBioPage"]', { name: 'bio.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await page.setInputFiles('[data-cip-file="birthCertificate"]', { name: 'birth.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await attachFamilyDocuments(page, 0, { pdf: pdf(), png: png(600) });

  const saved = await until(async () => /Draft saved/i.test(await page.locator('[data-cip-draft-status]').first().innerText().catch(() => '')), 45000);
  check(saved, 'the draft autosaved to the server, scans and all');

  step(2, 'The line is flaky: the filing does not get through, small requests do');
  await page.route('**/portal/cip/applications', (route) => {
    if (route.request().method() === 'POST') return route.abort('connectionreset');
    return route.fallback();
  });
  await page.click('[data-cip-save]');
  check(await until(async () => (await page.evaluate(() => window.TMAQueue.all())).length === 1, 20000), 'the filing is parked on this device');
  const queued = (await page.evaluate(() => window.TMAQueue.all()))[0];
  const part = (n) => ((queued.parts || []).find((p) => p.name === n) || {}).value;
  const draftId = part('draftId');
  check(!!draftId, 'the parked filing names its draft (' + draftId + ')');
  check(queued.repeatable === true, 'and is marked safe to repeat (it carries its submission key)');
  check(await until(() => toasts.some((t) => /Saved on this device/.test(t)), 5000), 'the reader is told it is on this device');
  await page.waitForTimeout(1500);
  check(draftDeletes.length === 0, 'the draft on the server was NOT deleted (' + draftDeletes.length + ' DELETE requests)');

  const draftNow = await page.evaluate(async (id) => {
    const r = await fetch('/portal/cip/applications/' + id, { headers: { Accept: 'application/json' } });
    return r.ok ? (await r.json()).application : { missing: r.status };
  }, draftId);
  check(draftNow && draftNow.status === 'draft', 'the server still holds the draft (' + (draftNow.status || JSON.stringify(draftNow)) + ')');

  step(3, 'The table shows it once, as saved on this device');
  check(await until(async () => (await page.locator('tr[data-cip-queued]:visible').count()) === 1, 15000), 'one "saved on this device" row');
  const rowText = await page.locator('tr[data-cip-queued]:visible').first().innerText().catch(() => '');
  check(/OMAR|Omar/.test(rowText) && /Saved offline/i.test(rowText), 'it names the applicant and says Saved offline (' + rowText.replace(/\s+/g, ' ').trim() + ')');
  await page.waitForTimeout(1500);
  const sameName = await page.locator('table.tma-cip-table:visible tbody tr').filter({ hasText: /OMAR HADDAD|Omar Haddad/i }).count();
  check(sameName === 1, 'the draft is not shown a second time beside it (' + sameName + ' rows for the name)');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/offline-1-queued-row.png' });

  // Still trying, not given up: the line is still bad after its retries.
  await page.waitForTimeout(7000);
  const still = (await page.evaluate(() => window.TMAQueue.all()))[0];
  check(still && still.state === 'waiting', 'after its retries on the bad line it is still waiting, not "Not sent" (' + (still && still.state) + ': ' + (still && still.error) + ')');

  step(4, 'Opened from the table, it opens on its draft, scans in place');
  await page.locator('tr[data-cip-queued]:visible').first().click();
  check(await until(async () => (await page.locator('[data-cip-form]:visible').count()) > 0, 20000), 'the form opened');
  await page.waitForTimeout(1500);
  const formApp = await page.evaluate(() => window.TMACipIntakeRecord && window.TMACipIntakeRecord.id);
  check(formApp === draftId, 'on the draft itself (' + formApp + ')');
  check((await page.inputValue('[data-cip-field="firstName"]:visible')).toUpperCase() === 'OMAR', 'with the queued answers');
  const photoFiled = await page.locator('[data-cip-form]:visible img').count();
  check(photoFiled > 0, 'and the photo the draft already held (' + photoFiled + ' images)');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/offline-2-form-on-draft.png' });

  step(5, 'The internet comes back: it files by itself and lands in the table');
  await page.unroute('**/portal/cip/applications');
  // Back to the table through the hub's router.
  await page.evaluate(() => { history.pushState({}, '', '/citizenship-applications'); window.TMAClients.syncRoute(window.TMAClients.routeFromPath('/citizenship-applications')); });
  await page.waitForTimeout(800);
  if (await page.locator('.tma-portal-modal:visible').count()) {
    console.log('    (a modal on leaving: ' + (await page.locator('.tma-portal-modal:visible').first().innerText()).replace(/\s+/g, ' ').slice(0, 120) + ')');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await until(async () => (await page.evaluate(() => window.TMAQueue.all())).length === 0, 30000), 'the queue emptied by itself');
  const filed = await page.evaluate(async (id) => {
    const r = await fetch('/portal/cip/applications/' + id, { headers: { Accept: 'application/json' } });
    return r.ok ? (await r.json()).application : { missing: r.status };
  }, draftId);
  check(filed && filed.status && filed.status !== 'draft', 'the draft row became the filed application (' + filed.status + ', ' + filed.number + ')');
  check(await until(() => toasts.some((t) => t === 'Application ' + filed.number + ' created'), 8000), 'the toast names it: ' + toasts.filter((t) => /Application/.test(t)).join(' | '));
  check(await until(async () => (await page.locator('table.tma-cip-table:visible tbody tr').filter({ hasText: filed.number }).count()) === 1, 15000), 'and its row is in the table under ' + filed.number);
  check((await page.locator('tr[data-cip-queued]:visible').count()) === 0, 'the "saved on this device" row is gone');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/offline-3-filed.png' });
} catch (err) {
  failures.push('threw: ' + err.message);
  console.error(err);
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
