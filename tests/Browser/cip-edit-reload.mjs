import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Edit application, opened by its address.
 *
 * The in-app Edit button always worked. Reloading the page, or following a
 * link to /citizenship-applications/applications/{id}/edit, used to mount
 * the wizard as a brand-new blank form under an "Edit application" head
 * whose Save then filed a second application: the shell handed the hub two
 * fields of the parsed route and normalised the address to the list, and
 * the hub's re-sync after the directory loaded read the list back off it.
 *
 * Needs: the standard throwaway server with FEATURE_CIP=true, an account
 * that may reach the file (TMA_STAFF_EMAIL, a Reviewing Officer who did
 * not file it is the strongest check), and TMA_APP, the uuid of a filed
 * application with documents. See README.
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const draftPosts = [];
page.on('request', r => {
  if (r.method() === 'POST' && r.url().includes('/portal/cip/applications')) draftPosts.push(r.url());
});

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

  console.log('\n[1] The edit address opens the application it names');
  await page.goto(`${BASE}/citizenship-applications/applications/${encodeURIComponent(APP)}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cip-form]', { timeout: 30000 });
  // The directory arrives after the form; the re-sync it triggers must not
  // put the list back.
  await page.waitForTimeout(6000);

  check(page.url().includes(`/applications/${APP}/edit`), `the address stays on the edit (${page.url()})`);
  check(await page.locator('[data-cip-form]').count() === 1, 'the form is still on screen');
  const first = await page.locator('[data-cip-field="firstName"]').inputValue().catch(() => null);
  check(!!first, `the applicant's answers are in the form (${first})`);
  check(await page.locator('.tma-portal-drop.is-filled').count() > 0, 'the filed documents show as filed');
  check(await page.locator('[data-cip-draft-status]').count() === 0, 'it is not a new form that autosaves a draft');
  check(draftPosts.length === 0, 'nothing was posted');
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
