import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Confirm submission says it has been confirmed.
 *
 * The press locks the package and the server answers with the application
 * as it now stands. The page used to throw that answer away and repaint
 * from the record it held BEFORE the press, so the bar went on offering
 * Confirm submission until the page was reloaded. It read as the button
 * having done nothing, and a second press sent the confirmation again.
 *
 * Only a browser shows this: the server was right all along (the rule and
 * its answer are pinned in CipConfirmationTest), it was the screen that was
 * not told. Pinned here:
 *
 *  - before the press the bar offers Confirm submission;
 *  - the moment the dialog closes the button is gone, with no reload, and
 *    the bar says the package is confirmed and locked;
 *  - so the confirmation is sent once, and there is nothing left to press
 *    a second time;
 *  - the Timeline shows the day it was confirmed;
 *  - a reload shows the same thing, so what was painted was the truth.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an account that
 * may confirm (TMA_STAFF_EMAIL; an administrator, or a contact of the
 * application's service provider) and TMA_APP, the uuid of an application at
 * Ready to submit whose package is ready and not yet confirmed. The check
 * confirms it, so it needs a fresh one each run. See README.
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
const confirms = [];
page.on('response', r => { if (r.request().method() === 'POST' && /\/confirm$/.test(r.url())) confirms.push(r.status()); });

const modal = page.locator('.tma-portal-modal__card').last();
const button = page.locator('[data-cip-confirm]');
const bar = async () => (await page.locator('.tma-dash__clients-appbar').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

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

  step(1, 'A ready application offers Confirm submission');
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`tr[data-cip-app="${APP}"]`, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator(`tr[data-cip-app="${APP}"] .tma-cip-table__number`).first().click();
  await button.first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  check(/Confirm submission/.test(await bar()), `the bar reads "${await bar()}"`);

  step(2, 'Confirming it says so at once, with no reload');
  await button.first().click();
  await modal.waitFor({ timeout: 5000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Confirm submission', 'the dialog asks first');
  await modal.locator('[data-cip-save-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  /*
   * Read on the very next frame, not after a wait: the bar is told by the
   * answer to the press itself. The re-read of the whole record comes
   * behind it and must not be what the reader is left waiting for.
   */
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  check(await button.count() === 0, 'the Confirm submission button is gone');
  const after = await bar();
  check(/confirmed and locked/i.test(after), `the bar says it is confirmed ("${after}")`);
  check(!/Confirm submission/.test(after), 'and no longer offers to confirm');
  const toast = (await page.locator('.tma-toast-floating-host').innerText().catch(() => '')).trim();
  check(/Submission confirmed/.test(toast), `the toast says so too ("${toast.slice(0, 60)}")`);
  check(confirms.length === 1 && confirms[0] === 200, `the confirmation was sent once (${confirms.join(',')})`);
  await page.screenshot({ path: 'tests/Browser/cip-confirm-submission.png' });

  step(3, 'It stays that way while the record is read again');
  await page.waitForTimeout(3500);
  check(await button.count() === 0, 'still no Confirm submission button');
  check(/confirmed and locked/i.test(await bar()), `the bar still says confirmed ("${await bar()}")`);
  const timeline = (await page.locator('body').innerText()).match(/Package confirmed\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/);
  check(!!timeline, `the Timeline shows the day it was confirmed (${timeline ? timeline[1] : 'no date'})`);
  check(confirms.length === 1, 'nothing was sent a second time');

  step(4, 'A reload shows the same');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tma-dash__clients-appbar').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  check(await button.count() === 0, 'no Confirm submission button');
  check(/confirmed and locked/i.test(await bar()), `the bar says confirmed ("${await bar()}")`);

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll confirm submission checks passed.');
process.exit(failures.length ? 1 : 0);
