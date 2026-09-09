import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * The intake wizard's draft: it saves itself, and it says so.
 *
 * PHPUnit pins the endpoint. This pins the half that only exists in a
 * browser: that typing actually triggers a save without anybody pressing
 * anything, that the pressed button reports back, and — the one that matters
 * most — that leaving the form and coming back returns the work rather than
 * an empty page.
 *
 * Needs an account that may create applications and FEATURE_CIP on.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

/*
 * The sign-in code, read out of the mail log.
 *
 * A fresh browser is a new device every run, so the challenge is not
 * avoidable — and the six digits cannot be grepped loosely, because the
 * postcard's own CSS is full of them (#000000). The code is the one in the
 * big letter-spaced cell, so that is what this matches.
 */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];

  return hits.length ? hits[hits.length - 1][1] : null;
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();

/* A thrown handler is why "it does nothing" — surface it rather than infer. */
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

/* Every draft write the page makes, so "is it autosaving" is answered by
   what went over the wire and not by what the screen says. */
const draftPosts = [];
page.on('request', r => {
  if (r.url().includes('/portal/cip/applications/draft')) draftPosts.push(r.method());
});

/* `phase` is 'pre-approval' or 'post-approval' — both are new filings, and
   the point of this test is that both of them draft. */
async function openWizard(phase = 'pre-approval') {
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30 && !(await page.locator('[data-head-dropdown-toggle]').count()); i++) await page.waitForTimeout(500);
  const toggles = page.locator('[data-head-dropdown-toggle]');
  for (let i = 0; i < await toggles.count(); i++) {
    if ((await toggles.nth(i).innerText()).includes('Create New Application')) { await toggles.nth(i).click(); break; }
  }
  await page.waitForTimeout(500);
  await page.click(`[data-head-dropdown-item="create-${phase}"]`);
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  await page.waitForTimeout(600);
}

/* Throw away whatever an earlier run or step left on the server. */
async function clearDraft() {
  if (!(await page.locator('[data-cip-draft-discard]').count())) return;
  await page.click('[data-cip-draft-discard]');
  await page.waitForTimeout(400);
  await page.click('[data-draft-discard]');
  await page.waitForTimeout(1000);
}

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  // A new device every run: answer the emailed code, then trust it so the
  // later re-opens in this run are not each challenged again.
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    /* Six single-digit boxes that feed one hidden field — typed, not filled,
       because the page builds the value from key events. */
    const digits = page.locator('.tma-auth__otp-digit');
    await digits.first().click();
    await page.keyboard.type(code, { delay: 40 });
    const trust = page.locator('input[type="checkbox"]').first();
    if (await trust.count()) await trust.check().catch(() => {});
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(700);
  }

  step(1, 'The wizard opens, and carries Save as draft beside Cancel and Add');
  await openWizard();
  await clearDraft();
  check(await page.locator('[data-cip-cancel]').count() > 0, 'Cancel is in the head');
  check(await page.locator('[data-cip-save]').count() > 0, 'Add is in the head');
  check(await page.locator('[data-cip-draft-save]').count() > 0, 'Save as draft is in the head');

  step(2, 'Typing saves on its own, with nothing pressed');
  draftPosts.length = 0;
  await page.fill('[data-cip-field="firstName"]', 'Autosaved');
  await page.fill('[data-cip-field="lastName"]', 'Applicant');
  // The wizard waits for the typing to stop, then writes once.
  await page.waitForTimeout(2600);
  check(draftPosts.filter(m => m === 'POST').length > 0,
    `a draft was POSTed without pressing anything (${draftPosts.join(',') || 'nothing sent'})`);
  const line = await page.locator('[data-cip-draft-status]').innerText().catch(() => '');
  check(/Draft saved/.test(line), `the form says when it saved ("${line.trim()}")`);

  step(3, 'A burst of typing is one save, not one per key');
  draftPosts.length = 0;
  await page.fill('[data-cip-field="occupation"]', 'Engineer');
  await page.waitForTimeout(2600);
  check(draftPosts.filter(m => m === 'POST').length === 1,
    `one write for one edit (${draftPosts.filter(m => m === 'POST').length})`);

  step(4, 'Save as draft answers out loud');
  await page.fill('[data-cip-field="passportNumber"]', 'X1234567');
  await page.click('[data-cip-draft-save]');
  // The toast is its own element — a looser [class*=toast] also matches the
  // empty host it is rendered into, which reads as "no toast".
  await page.waitForSelector('.tma-toast', { timeout: 5000 }).catch(() => {});
  const toast = await page.locator('.tma-toast').first().innerText().catch(() => '');
  check(/Draft saved/i.test(toast), `pressing it says so ("${toast.trim().slice(0, 60)}")`);

  step(5, 'Leaving and coming back returns the work');
  await page.click('[data-cip-cancel]');
  await page.waitForTimeout(1200);
  await openWizard();
  const first = await page.inputValue('[data-cip-field="firstName"]').catch(() => '');
  check(first === 'Autosaved', `the name came back ("${first}")`);
  const notice = await page.locator('[data-cip-draft-resumed]').innerText().catch(() => '');
  check(/Picked up where you left off/.test(notice), 'the reader is told it resumed');
  check(/files aren’t saved|files aren't saved/i.test(notice),
    'and that the scans have to be chosen again');

  step(6, 'A post-approval filing drafts too, and keeps its own');
  await openWizard('post-approval');
  await clearDraft();
  draftPosts.length = 0;
  await page.fill('[data-cip-field="firstName"]', 'PostApproval');
  await page.waitForTimeout(2600);
  check(draftPosts.filter(m => m === 'POST').length > 0, 'the post-approval form autosaves as well');
  await openWizard('pre-approval');
  const stillPre = await page.inputValue('[data-cip-field="firstName"]').catch(() => '');
  check(stillPre === 'Autosaved',
    `the two phases keep separate drafts (pre-approval still "${stillPre}")`);

  step(7, 'The draft is in the applications table, wearing a Draft chip');
  /*
   * The point of the whole change: a half-typed application is a row the firm
   * can see, not a private note. Read from the rendered table rather than the
   * API — the API is asserted below, and what a reader is owed here is the
   * chip actually saying Draft.
   */
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const table = await page.locator('table').first().innerText().catch(() => '');
  check(/Autosaved/.test(table), `the half-typed applicant is listed (${table.slice(0, 120).replace(/\s+/g, ' ')})`);
  check(/\bDRAFT\b/i.test(table), 'and the row says Draft');
  check(!/NEW APPLICATION/i.test(table), 'not New Applications, which is what the old label said');

  step(8, 'Draft is the whole status vocabulary — the picker offers nothing else');
  /*
   * Read from the API rather than the menu: the row's picker is built from
   * what the server says the file may become, so this asks the question the
   * menu asks and does not depend on which chip was clicked.
   */
  const listing = await page.evaluate(async () => {
    const res = await fetch('/portal/cip/applications', {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    const json = await res.json();
    const row = (json.applications || []).find(a => a.status === 'draft');

    return row ? { status: row.status, next: row.nextStatuses, over: row.overrideStatuses, locked: row.lockedStatuses } : null;
  });
  check(!!listing, 'the draft row came back from the listing');
  if (listing) {
    const offered = []
      .concat(listing.next || [], listing.over || [], listing.locked || [])
      .map(s => (typeof s === 'string' ? s : s && s.value))
      .filter(Boolean);
    check(offered.length === 0, `no other status is offered (${offered.join(',') || 'none'})`);
  }

  step(9, 'Start over empties the form and the draft');
  await openWizard('pre-approval');
  await page.click('[data-cip-draft-discard]');
  await page.waitForTimeout(400);
  await page.click('[data-draft-discard]');
  await page.waitForTimeout(1500);
  check((await page.inputValue('[data-cip-field="firstName"]')) === '', 'the form is empty again');
  await openWizard();
  check((await page.inputValue('[data-cip-field="firstName"]')) === '',
    'and stays empty on the next open');

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' | ') || 'none'})`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.log(`\n✗ ${e.message}`);
  await page.screenshot({ path: 'tests/browser/cip-draft-autosave-fail.png' }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
