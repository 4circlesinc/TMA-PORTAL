/*
 * The Fee Calculator (/calculator), opened as a client: the role that reaches
 * the least of the portal, so if it opens for them it opens for everyone.
 *
 * What only a browser can prove: the sidebar row is there and paints the
 * page, a hard refresh on /calculator serves the shell rather than a 404, and
 * the arithmetic on screen is the firm's standalone calculator's. The oracle
 * below is that page's own calcDepFee, ported line for line; the chips, the
 * breakdown and the total have to agree with it as the spouse answer and the
 * dependants change (the 5th dependant flips to $10,000 the moment a spouse
 * is included, and back to their age's fee when the spouse goes). Add and
 * Remove stop at 15 and at 1, the entries survive leaving the page and
 * coming back with nothing double-bound, a reload starts clean, the page
 * fits a phone, and window.TMAFeeCalculator.compute is cross-checked
 * against the oracle on a few hundred random applications.
 *
 * Standard throwaway server plus a Client account (client@example.com).
 *   TMA_BASE_URL=http://127.0.0.1:8931 node tests/Browser/fee-calculator.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_CLIENT_EMAIL || 'client@example.com';
const PASSWORD = process.env.TMA_CLIENT_PASSWORD || 'password12345';
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

/* The six digits in the postcard's letter-spaced cell, the last one logged. */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];

  return hits.length ? hits[hits.length - 1][1] : null;
}

/* The standalone calculator's rule, verbatim. */
function oracleDepFee(depNumber, ageVal, spouseYes) {
  if (!ageVal) return null;
  if (depNumber > 4 && spouseYes) return 10000;
  return ageVal === 'Under 18' ? 5000 : 10000;
}

function oracle(spouseYes, ages) {
  const base = spouseYes ? 45000 : 30000;
  let depTotal = 0;
  let counted = 0;
  const fees = ages.map((age, i) => {
    const fee = oracleDepFee(i + 1, age, spouseYes);
    if (fee !== null) { depTotal += fee; counted += 1; }
    return fee;
  });

  return { base, fees, depTotal, counted, total: base + depTotal };
}

const money = (n) => '$' + n.toLocaleString('en-US');

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

/* A thrown handler is why "it does nothing": surface it rather than infer. */
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function signIn() {
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
    const digits = page.locator('.tma-auth__otp-digit');
    await digits.first().click();
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
  if (page.url().includes('/auth/')) throw new Error(`sign-in did not reach the portal: ${page.url()}`);
}

/* Open the page by its address: a hard refresh, which is what a bookmark does. */
async function openByUrl() {
  await page.goto(`${BASE}/calculator`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-fee-total]', { timeout: 25000 });
  await page.waitForTimeout(300);
}

const totalText = async () => (await page.locator('[data-fee-total]').innerText()).trim();
const chips = () => page.locator('[data-fee-chip]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
const lines = () => page.locator('.fee-calc__line').evaluateAll((els) =>
  els.map((e) => [...e.children].map((c) => c.textContent.trim()).join(' ')));
const rowCount = () => page.locator('[data-fee-dependant]').count();

async function setSpouse(yes) {
  await page.selectOption('[data-fee-spouse]', yes ? 'yes' : 'no');
  await page.waitForTimeout(80);
}

async function setAge(index, age) {
  await page.locator('[data-fee-age]').nth(index).selectOption(age);
  await page.waitForTimeout(80);
}

/* Click a sidebar row, then park the pointer over the page: the rail is a
   hover overlay for a new account and stays open over the content while the
   pointer rests on it, which is where the next click would land. */
async function clickNav(id) {
  await page.click(`.tma-dash__nav-item[data-nav="${id}"]`);
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(600);
}

async function clickTimes(selector, n) {
  for (let i = 0; i < n; i++) await page.click(selector);
  await page.waitForTimeout(120);
}

/* The screen against the oracle for one application. */
async function agrees(label, spouseYes, ages) {
  const o = oracle(spouseYes, ages);
  const shownChips = await chips();
  const wantChips = o.fees.map((f) => money(f === null ? 0 : f));
  check(JSON.stringify(shownChips) === JSON.stringify(wantChips),
    `${label}: dependant fees read ${shownChips.join(' ')} (want ${wantChips.join(' ')})`);
  const shownTotal = await totalText();
  check(shownTotal === money(o.total), `${label}: total reads ${shownTotal} (want ${money(o.total)})`);
  const shownLines = await lines();
  const wantLines = [`Base fee (${spouseYes ? 'Applicant + Spouse' : 'Applicant only'}) ${money(o.base)}`];
  if (o.depTotal > 0) wantLines.push(`Dependant fees (${o.counted}) ${money(o.depTotal)}`);
  check(JSON.stringify(shownLines) === JSON.stringify(wantLines),
    `${label}: breakdown reads "${shownLines.join(' | ')}" (want "${wantLines.join(' | ')}")`);
}

try {
  await signIn();

  step(1, 'A client opens /calculator by its address and gets the page, not a 404');
  await openByUrl();
  check(new URL(page.url()).pathname === '/calculator', `stays at /calculator (${page.url()})`);
  const row = page.locator('.tma-dash__nav-item[data-nav="calculator"]');
  check(await row.count() === 1, 'the sidebar carries the Fee Calculator row');
  check(await row.isVisible(), 'the row is visible to a client');
  check((await row.getAttribute('class') || '').includes('tma-dash__nav-item--active'), 'the row is marked active');
  check((await page.locator('[data-page-title]').innerText()).trim() === 'Fee Calculator', 'the header names the page');
  check(await page.locator('.tma-portal-head__title').count() === 0, 'the page does not repeat its title');
  const iconMask = await row.locator('.tma-dash__nav-icon').evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  check(/data:image\/svg\+xml/.test(iconMask), 'the row icon resolves to inlined artwork');
  check((await page.locator('[data-mrow][data-nav="calculator"]').count()) === 1, 'the phone menu carries the row too');

  step(2, 'A fresh application: one dependant row, nothing chosen, $30,000');
  check(await rowCount() === 1, 'one dependant row');
  await agrees('fresh', false, ['']);
  check(await page.locator('[data-fee-remove]').isDisabled(), 'Remove is off at one row');
  check(!(await page.locator('[data-fee-add]').isDisabled()), 'Add is on');

  step(3, 'Adding a spouse raises the base fee to $45,000');
  await setSpouse(true);
  await agrees('with spouse', true, ['']);

  step(4, 'Five dependants with a spouse: the 5th costs $10,000 whatever their age');
  await clickTimes('[data-fee-add]', 4);
  check(await rowCount() === 5, 'five dependant rows');
  const ages = ['Under 18', '18 and Over', 'Under 18', 'Under 18', 'Under 18'];
  for (let i = 0; i < ages.length; i++) await setAge(i, ages[i]);
  await agrees('five with spouse', true, ages);
  check((await chips())[4] === '$10,000', 'the 5th dependant, under 18, is charged $10,000');
  const labels = await page.locator('[data-fee-dependant] .fee-calc__row-label').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(labels.join(',') === 'Dependant 1,Dependant 2,Dependant 3,Dependant 4,Dependant 5', `rows are numbered in order (${labels.join(',')})`);

  step(5, 'Without the spouse the same five go by age again');
  await setSpouse(false);
  await agrees('five alone', false, ages);
  check((await chips())[4] === '$5,000', 'the 5th dependant is back to $5,000');

  step(6, 'An age left unchosen counts nothing');
  await setAge(2, '');
  await agrees('one unchosen', false, ['Under 18', '18 and Over', '', 'Under 18', 'Under 18']);
  await setAge(2, 'Under 18');

  step(7, 'Add stops at 15, Remove stops at 1, and the remaining entry is kept');
  await clickTimes('[data-fee-add]', 10);
  check(await rowCount() === 15, `fifteen rows (${await rowCount()})`);
  check(await page.locator('[data-fee-add]').isDisabled(), 'Add is off at fifteen');
  await page.locator('[data-fee-add]').evaluate((b) => b.click());
  await page.waitForTimeout(100);
  check(await rowCount() === 15, 'a forced click past fifteen adds nothing');
  await clickTimes('[data-fee-remove]', 14);
  check(await rowCount() === 1, `one row after removing (${await rowCount()})`);
  check(await page.locator('[data-fee-remove]').isDisabled(), 'Remove is off at one');
  await agrees('back to one', false, ['Under 18']);

  step(8, 'Leaving and coming back keeps the entries, with nothing bound twice');
  await clickNav('dash-dashboard');
  await clickNav('calculator');
  check(new URL(page.url()).pathname === '/calculator', 'the address follows the row');
  check(await page.locator('[data-fee-age]').first().inputValue() === 'Under 18', 'the dependant\'s age is still there');
  await agrees('returned', false, ['Under 18']);
  await clickTimes('[data-fee-add]', 1);
  check(await rowCount() === 2, `one click adds one row, not two (${await rowCount()})`);
  await setSpouse(true);
  await agrees('returned, spouse', true, ['Under 18', '']);

  step(9, 'A reload starts a clean application');
  await openByUrl();
  check(await rowCount() === 1, 'one row again');
  await agrees('reloaded', false, ['']);

  step(10, 'The module agrees with the standalone rule on random applications');
  const mismatches = await page.evaluate(() => {
    function depFee(n, age, spouse) {
      if (!age) return null;
      if (n > 4 && spouse) return 10000;
      return age === 'Under 18' ? 5000 : 10000;
    }
    const options = ['', 'Under 18', '18 and Over'];
    let bad = 0;
    for (let t = 0; t < 500; t++) {
      const spouse = Math.random() < 0.5;
      const count = 1 + Math.floor(Math.random() * 15);
      const ages = Array.from({ length: count }, () => options[Math.floor(Math.random() * 3)]);
      const base = spouse ? 45000 : 30000;
      let want = base;
      const fees = ages.map((a, i) => { const f = depFee(i + 1, a, spouse); if (f !== null) want += f; return f; });
      const got = window.TMAFeeCalculator.compute(spouse, ages);
      if (got.total !== want || got.base !== base || JSON.stringify(got.fees) !== JSON.stringify(fees)) bad += 1;
    }
    return bad;
  });
  check(mismatches === 0, `${mismatches} of 500 random applications disagree`);
  check(await page.evaluate(() => window.TMAFeeCalculator.MAX_DEPENDANTS) === 15, 'the cap is 15');

  step(11, 'On a phone the page fits the screen');
  await page.setViewportSize({ width: 390, height: 844 });
  await openByUrl();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no sideways scroll (${overflow}px over)`);
  await clickTimes('[data-fee-add]', 2);
  await setAge(1, '18 and Over');
  await agrees('phone', false, ['', '18 and Over', '']);
  await page.mouse.move(300, 700);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/Browser/fee-calculator-phone.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await openByUrl();
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/Browser/fee-calculator.png' });

  step(12, 'No script errors along the way');
  const noise = /Origin not allowed|favicon|net::ERR_|Failed to load resource|ResizeObserver/i;
  const real = pageErrors.filter((m) => !noise.test(m));
  check(real.length === 0, real.length ? `page errors: ${real.join(' | ')}` : 'no page errors');
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.error(e);
  await page.screenshot({ path: 'tests/Browser/fee-calculator-fail.png' }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall good');
process.exit(failures.length ? 1 : 0);
