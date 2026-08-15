import { chromium } from 'playwright';

// The CIP intake wizard (§2, §3). PHPUnit pins the endpoint; this pins that
// the form is wired to it — the steps advance, a missing answer stops the
// step, the region appears from the country, and filing lands a numbered
// draft. Needs an account that may create applications and FEATURE_CIP on.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })).newPage();

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('text=Yes, stay signed in')]);
    await page.waitForTimeout(700);
  }

  step(1, 'The wizard opens from Create New Application');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  // The hub loads its directory first; the create control lives in the head.
  for (let i = 0; i < 30 && !(await page.locator('[data-head-dropdown-toggle]').count()); i++) await page.waitForTimeout(500);
  const toggles = page.locator('[data-head-dropdown-toggle]');
  for (let i = 0; i < await toggles.count(); i++) {
    if ((await toggles.nth(i).innerText()).includes('Create New Application')) { await toggles.nth(i).click(); break; }
  }
  await page.waitForTimeout(500);
  await page.click('[data-head-dropdown-item="create-new"]');
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  check(await page.locator('[data-cip-field="firstName"]').count() > 0, 'the form rendered');
  check(await page.locator('[data-cip-save]').count() > 0, 'the toolbar carries Add');

  step(2, 'Add with nothing filled in refuses, and says how much is missing');
  await page.click('[data-cip-save]');
  await page.waitForTimeout(600);
  check(await page.locator('.tma-portal-field__error').count() > 0, 'missing answers are named');
  check((await page.locator('[data-cip-form]').innerText()).includes('still needed'), 'a summary says how many');

  step(3, 'The whole form is on one page');
  const formText = await page.locator('[data-cip-form]').innerText();
  check(formText.includes('Main applicant') && formText.includes('Investment'), 'both sections visible at once');
  check(await page.locator('[data-cip-next], [data-cip-back]').count() === 0, 'no step buttons');

  step(4, 'The region follows the country of residence');
  await page.fill('[data-cip-field="firstName"]', 'John');
  await page.fill('[data-cip-field="lastName"]', 'Smith');
  await page.selectOption('[data-cip-field="gender"]', 'Male');
  await page.fill('[data-cip-field="dateOfBirth"]', '1985-04-12');
  await page.selectOption('[data-cip-field="countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="countryOfResidence"]', 'United Arab Emirates');
  await page.waitForTimeout(500);
  check((await page.locator('[data-cip-region]').innerText()).includes('Middle East'), 'region derived as Middle East');
  await page.fill('[data-cip-field="occupation"]', 'Engineer');
  await page.fill('[data-cip-field="passportNumber"]', 'X1234567');

  step(5, 'Investment: Other asks what it is');
  await page.selectOption('[data-cip-field="investmentType"]', 'other');
  await page.waitForTimeout(400);
  check(await page.locator('[data-cip-field="investmentTypeOther"]').count() > 0, 'the specify field appears for Other');
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
  await page.waitForTimeout(400);
  check(await page.locator('[data-cip-field="investmentTypeOther"]').count() === 0, 'and goes away again');

  if (await page.locator('[data-cip-field="providerId"]').count()) {
    const value = await page.$eval('[data-cip-field="providerId"] option:nth-child(2)', o => o.value);
    await page.selectOption('[data-cip-field="providerId"]', value);
  }
  await page.selectOption('[data-cip-field="sponsored"]', '0');

  step(6, 'Filing creates a numbered draft');
  const created = page.waitForResponse(r => r.url().includes('/portal/cip/applications') && r.request().method() === 'POST', { timeout: 20000 });
  await page.click('[data-cip-save]');
  const res = await created;
  check(res.status() === 201, `filed (HTTP ${res.status()})`);
  const body = await res.json().catch(() => ({}));
  check(/^[A-Z]{2,8}\d{2}-\d{5}$/.test(body?.application?.number || ''), `numbered ${body?.application?.number}`);
  check(body?.application?.status === 'draft', 'starts as a draft');
  check(body?.application?.applicant?.region === 'Middle East', 'region stored server-side');

  await page.screenshot({ path: 'tests/Browser/cip-intake.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
  await page.screenshot({ path: 'tests/Browser/cip-intake.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
