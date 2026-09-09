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

/* The document slots this form is asking for, by field name. */
async function docSlots() {
  const names = await page.locator('[data-cip-file]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-cip-file')));

  return names.filter(Boolean);
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

  step(5, 'Create New Application is always a NEW application');
  /*
   * The bug this pins, reported from the screen: pressing Create New
   * Application handed back the reader's existing draft, so there was no way
   * to start a second one — the form arrived full of somebody they had
   * finished with. A draft is a row in the table now, and reopening it is
   * something the reader asks for by clicking it.
   */
  await page.click('[data-cip-cancel]');
  await page.waitForTimeout(1200);
  await openWizard();
  const fresh = await page.inputValue('[data-cip-field="firstName"]').catch(() => '');
  check(fresh === '', `the form is blank ("${fresh}")`);
  check(await page.locator('[data-cip-draft-resumed]').count() === 0,
    'and says nothing about picking up where anybody left off');

  step(5.5, 'The draft is reopened by clicking its row');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const draftRow = page.locator('tr[data-cip-draft], [data-cip-draft]').first();
  check(await draftRow.count() > 0, 'the draft row is there to click');
  await draftRow.click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  await page.waitForTimeout(1500);
  const reopened = await page.inputValue('[data-cip-field="firstName"]').catch(() => '');
  check(/^autosaved$/i.test(reopened), `it opens on the answers that were typed ("${reopened}")`);
  const notice = await page.locator('[data-cip-draft-resumed]').innerText().catch(() => '');
  // Worded by whatever the draft actually kept — the point is that the reader
  // is told where they are and what, if anything, is still outstanding.
  check(/where you left off/i.test(notice), `the resume is announced ("${notice.replace(/\s+/g, ' ').slice(0, 90)}")`);

  step(5.55, 'Back from a draft returns to the table it was opened from');
  /*
   * Every other application belongs to a client, so Back means their profile.
   * A draft has barely any of one — often not even a name yet — and it was
   * reached by clicking its row, so a profile strands the reader somewhere
   * they have never been. Cancel is the same helper and the same journey.
   */
  const backTitle = await page.locator('[data-clients-back]').first().getAttribute('title').catch(() => '');
  check(/CIP Applications/.test(backTitle || ''), `the arrow says where it goes ("${backTitle}")`);
  await page.locator('[data-clients-back]').first().click();
  await page.waitForTimeout(2500);
  check(await page.locator('table').count() > 0, 'and lands on the applications table');
  check(await page.locator('[data-cip-draft]').count() > 0, 'with the draft row still in it');

  // Back into the draft for the checks that follow.
  await page.locator('[data-cip-draft]').first().click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  await page.waitForTimeout(1500);

  step(5.58, 'A scan chosen with nothing else typed is still saved');
  /*
   * The autosave was wired to the text fields and the dependent buttons
   * only, so choosing a photo or a document changed nothing it noticed. The
   * photo appeared to survive because a later keystroke flushed it; a
   * document chosen last — which is what filling a form from paper looks
   * like — was never saved at all, and the reopened draft asked for it
   * again. Nothing is typed here on purpose: the file must be the whole
   * change.
   */
  draftPosts.length = 0;
  const slots = await docSlots();
  if (slots.length) {
    await page.setInputFiles(`[data-cip-file="${slots[0]}"]`, {
      name: 'scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
    });
    await page.waitForTimeout(3000);
    check(draftPosts.filter(m => m === 'POST').length > 0,
      'choosing a document saves the draft on its own');
    const filed = await page.evaluate(async () => {
      const res = await fetch('/portal/cip/applications/draft?phase=pre_approval', {
        credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      const json = await res.json();

      return (json.draft && json.draft.filed) || [];
    });
    check(filed.includes(slots[0]), `and the server keeps it (${filed.join(',') || 'nothing filed'})`);
  }

  step(5.6, 'A reopened draft goes on saving itself');
  draftPosts.length = 0;
  await page.fill('[data-cip-field="occupation"]', 'Architect');
  await page.waitForTimeout(2600);
  check(draftPosts.filter(m => m === 'POST').length > 0, 'typing in a reopened draft still autosaves');

  step(6, 'A post-approval filing drafts too, and keeps its own');
  await openWizard('post-approval');
  await clearDraft();
  draftPosts.length = 0;
  await page.fill('[data-cip-field="firstName"]', 'PostApproval');
  await page.waitForTimeout(2600);
  check(draftPosts.filter(m => m === 'POST').length > 0, 'the post-approval form autosaves as well');
  const drafts = await page.evaluate(async () => {
    const res = await fetch('/portal/cip/applications', {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    const json = await res.json();

    return (json.applications || []).filter(a => a.status === 'draft').map(a => a.phase);
  });
  check(drafts.includes('pre_approval') && drafts.includes('post_approval'),
    `the two phases keep separate drafts (${drafts.join(',') || 'none'})`);

  step(6.5, 'A resumed draft asks for ITS OWN phase’s documents');
  /*
   * The wizard fetches its document requirements as it opens, keyed on the
   * phase — and a draft opened by id carried no phase, so a post-approval
   * draft was drawn with the thirty-slot PRE-approval checklist instead of
   * its own short post-approval one. The two lists barely overlap, so
   * comparing what a reopened draft asks for against what a NEW form of the
   * same phase asks for is what catches it.
   */
  const newPostDocs = await docSlots();
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const postRow = page.locator('[data-cip-draft]').filter({ hasText: /postapproval/i }).first();
  check(await postRow.count() > 0, 'the post-approval draft is in the table');
  await postRow.click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  await page.waitForTimeout(2000);
  const resumedPostDocs = await docSlots();
  check(resumedPostDocs.length > 0 && resumedPostDocs.join() === newPostDocs.join(),
    `it asks for the same documents a new post-approval form asks for (${resumedPostDocs.length} vs ${newPostDocs.length})`);

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
  check(/autosaved/i.test(table), `the half-typed applicant is listed (${table.slice(0, 120).replace(/\s+/g, ' ')})`);
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
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('tr[data-cip-draft], [data-cip-draft]').first().click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('[data-cip-draft-discard]');
  await page.waitForTimeout(400);
  await page.click('[data-draft-discard]');
  await page.waitForTimeout(1500);
  check((await page.inputValue('[data-cip-field="firstName"]')) === '', 'the form is empty again');
  const left = await page.evaluate(async () => {
    const res = await fetch('/portal/cip/applications', {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    const json = await res.json();

    return (json.applications || []).filter(a => a.status === 'draft').length;
  });
  check(left === 1, `the discarded draft is gone from the table (${left} left)`);

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
