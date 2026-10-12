import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Adding a post-approval application records the Unit's decision with it.
 *
 * A firm bringing its existing files into the portal adds them straight
 * into post-approval, and each is a file the Unit approved or one it
 * denied. Add asks for that decision in the dialog every other decision is
 * recorded in: the day, Approved or Denied, the notes and the Unit's letter
 * as a PDF. Approved enters the lane and stands on Approved; the service
 * provider is asked for the Stage 1 documents and then sent the approval
 * with its letter. Denied lands on Denied and is sent the denial with its
 * letter, alone. The emails are pinned in CipIntakeTest and
 * CipApplicationDraftTest; this is the question itself, which only a
 * browser shows:
 *
 *  - Add on a complete post-approval filing opens Record decision, with the
 *    decision date, Approved or Denied, notes and the letter to give;
 *  - it will not go on without an outcome, or without the letter;
 *  - Cancel files nothing, and the next Add asks again;
 *  - an Add the server refuses asks again, with what was answered and the
 *    letter that was chosen still in place;
 *  - a letter the server will not take is said so in its own words, and is
 *    not put back for the next Add;
 *  - Approved files it once: the application reads Approved, on the day
 *    that was given, with the letter on file;
 *  - Denied does the same for Denied;
 *  - Skip adds an application that has no decision yet: it stands on
 *    Post-Approval with nothing recorded.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL) and TMA_PROVIDER, the uuid of a service
 * provider that account may file under. It files three applications each run
 * under fresh names and numbers. See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const PROVIDER = process.env.TMA_PROVIDER;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const SHOTS = process.env.TMA_SHOTS || '';

if (!PROVIDER) throw new Error('TMA_PROVIDER (a service provider uuid) is required');

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
const filings = [];
page.on('response', r => {
  if (r.request().method() === 'POST' && /\/portal\/cip\/applications$/.test(new URL(r.url()).pathname)) filings.push(r.status());
});

const modal = page.locator('.tma-portal-modal__card').last();

/*
 * A complete post-approval draft, written through the draft endpoint the
 * form autosaves to, so Save has nothing left to ask for but the answer.
 */
async function seedDraft(first, number) {
  return page.evaluate(async ({ provider, first, last, number }) => {
    const xsrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const pdf = () => new File([`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF ${Math.random()}`], 'scan.pdf', { type: 'application/pdf' });
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 600;
    const g = canvas.getContext('2d');
    g.fillStyle = '#c8d2dc'; g.fillRect(0, 0, 600, 600);
    g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(200, 150, 200, 260);
    const photo = await new Promise(res => canvas.toBlob(b => res(new File([b], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9));

    const body = new FormData();
    const fields = {
      providerId: provider, phase: 'post_approval', cipNumber: number,
      firstName: first, lastName: last, gender: 'Male', dateOfBirth: '1985-04-12',
      countryOfBirth: 'Lebanon', countryOfResidence: 'United Arab Emirates', occupation: 'Engineer',
      passportNumber: 'X' + number.replace(/\D/g, '').slice(-7),
      investmentType: 'national_economic_fund', sponsored: '0',
      submissionId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    };
    Object.keys(fields).forEach(k => body.append(k, fields[k]));
    body.append('passportPhoto', photo);
    body.append('oathOfAllegiance[]', pdf());
    body.append('proofOfPayment[]', pdf());

    const res = await fetch('/portal/cip/applications/draft', {
      method: 'POST', body, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest' },
    });
    const json = await res.json().catch(() => null);

    return { status: res.status, id: json && json.draft && (json.draft.id || json.draft.uuid), keys: json && json.draft ? Object.keys(json.draft).slice(0, 12) : json };
  }, { provider: PROVIDER, first, last: FAMILY, number });
}

const record = (id) => page.evaluate(async (id) => {
  const res = await fetch(`/portal/cip/applications/${id}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const body = (await res.json()).application || {};

  return {
    status: body.status, label: body.statusLabel, decision: body.decision, phase: body.phase, decidedAt: body.decidedAt,
    letter: body.decisionLetter ? (body.decisionLetter.fileName || true) : null,
  };
}, id);

async function openDraft(id) {
  await page.goto(`${BASE}/citizenship-applications/applications/${encodeURIComponent(id)}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cip-save]', { timeout: 30000 });
  await page.waitForTimeout(2500);
}

const number = () => `10T${Math.floor(1 + Math.random() * 8)}V${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}P`;
// A family name of this run's own: the same applicant filed twice is
// refused as already on file, which is a different dialog from this one.
const FAMILY = 'Verran' + Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

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
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const letter = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF ' + name) });
  const pick = (value) => modal.locator(`label.tma-portal-radio:has(input[data-cip-decision-type][value="${value}"])`).click();
  const picked = () => modal.locator('[data-cip-decision-type]:checked').evaluateAll(els => els.map(e => e.value).join(','));
  const toast = async () => (await page.locator('.tma-toast-floating-host').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const gone = () => page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 8000 });
  const filed = () => page.waitForFunction(() => !document.querySelector('[data-cip-save]') || !document.querySelector('[data-cip-save]').offsetParent, null, { timeout: 30000 }).catch(() => {});

  step(1, 'Add on a post-approval filing opens Record decision');
  const first = await seedDraft('Ansel', number());
  console.log(`      draft: ${JSON.stringify({ status: first.status, id: first.id })}`);
  check(first.status === 200 && !!first.id, 'a complete post-approval draft is on file');
  await openDraft(first.id);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 }).catch(() => {});
  const title = await modal.count() ? (await modal.locator('.tma-portal-modal__title').innerText()).trim() : '';
  if (!title) console.log(`      toast: ${await toast()}`);
  check(title === 'Record decision', `the portal's own decision dialog opens ("${title}")`);
  check(await modal.locator('[data-cip-decided]').count() === 1, 'it asks for the decision date');
  check(await modal.locator('[data-cip-decision-type]').count() === 2, 'Approved or Denied');
  check(await modal.locator('[data-cip-decision-note]').count() === 1, 'the decision notes');
  check(await modal.locator('[data-cip-decision-letter]').count() === 1 && /Decision letter \(PDF\)\s*\*/.test((await modal.locator('[data-cip-decision-drop]').innerText()).replace(/\s+/g, ' ')), 'and the decision letter as a PDF, required');
  check(await modal.locator('[data-cip-status-drop]').count() === 0, 'with no loose attachment to file before there is an application');
  const buttons = (await modal.locator('.tma-portal-modal__foot button').allInnerTexts()).map(t => t.trim());
  check(buttons.join(' | ') === 'Cancel | Skip | Add', `Cancel, Skip and Add to press (${buttons.join(' | ')})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-approval-filing-question.png` });

  step(2, 'It will not go on without an outcome, or without the letter');
  await modal.locator('[data-cip-save-decision]').click();
  await page.waitForTimeout(500);
  check(await modal.count() === 1 && /Choose Approved or Denied/.test(await toast()), `no outcome: "${(await toast()).slice(0, 60)}"`);
  await pick('denied');
  await modal.locator('[data-cip-save-decision]').click();
  await page.waitForTimeout(500);
  check(await modal.count() === 1 && /Upload the decision letter as a PDF/.test(await toast()), `no letter: "${(await toast()).slice(-60)}"`);
  check(filings.length === 0, 'and nothing was filed');

  step(3, 'Cancel files nothing, and the next Add asks again');
  await modal.locator('[data-cip-cancel-decision]').click();
  await gone();
  await page.waitForTimeout(600);
  check(filings.length === 0, 'nothing was filed');
  check((await record(first.id)).status === 'draft', 'the application is still a draft');
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Record decision', 'the dialog comes back');
  check((await picked()) === '', 'with no outcome carried over from a dialog that was cancelled');

  step(4, 'A refused Add asks again, with the answer and the letter still in place');
  /*
   * The server is made to refuse this one press. The outcome is not reused
   * silently, which would file whatever was typed next under it; the
   * dialog is opened again, filled in as it was left.
   */
  await page.route('**/portal/cip/applications', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();

    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Refused.', errors: { cipNumber: ['That number is already on file.'] } }),
    });
  }, { times: 1 });
  await pick('denied');
  await modal.locator('[data-cip-decided]').fill('2026-09-18');
  await modal.locator('[data-cip-decision-note]').fill('Refused on the source of funds.');
  await modal.locator('[data-cip-decision-letter]').setInputFiles(letter('denial.pdf'));
  check(/denial\.pdf/.test(await modal.locator('[data-cip-decision-letter-list]').innerText()), 'the chosen letter is listed');
  await modal.locator('[data-cip-save-decision]').click();
  await gone();
  await page.waitForTimeout(1200);
  check(filings.length === 1 && filings[0] === 422, `the press was refused (${filings.join(',')})`);
  check((await record(first.id)).status === 'draft', 'and nothing was filed');
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 }).catch(() => {});
  check(await modal.count() === 1, 'the next Add asks again instead of filing under the old answer');
  check((await picked()) === 'denied', 'the outcome that was given is still marked');
  check(await modal.locator('[data-cip-decided]').inputValue() === '2026-09-18', 'the date is still there');
  check(await modal.locator('[data-cip-decision-note]').inputValue() === 'Refused on the source of funds.', 'and the notes');
  check(/denial\.pdf/.test(await modal.locator('[data-cip-decision-letter-list]').innerText().catch(() => '')), 'and the letter is still chosen');

  step(5, 'A letter the server will not take is said so, and is not offered again');
  /*
   * The decision is asked in a dialog, so the form has no control to mark
   * for it: the refusal used to read "Check one answer." with nothing
   * marked, and the next Add put the same letter back.
   */
  await page.route('**/portal/cip/applications', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();

    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Refused.', errors: { decision_letter: ['That letter is too large. Keep it under 10MB.'] } }),
    });
  }, { times: 1 });
  await modal.locator('[data-cip-save-decision]').click();
  await gone();
  await page.waitForTimeout(1200);
  check(filings.length === 2 && filings[1] === 422, `the press was refused (${filings.join(',')})`);
  check(/That letter is too large\. Keep it under 10MB\./.test(await toast()), `the reason is said ("${(await toast()).slice(-60)}")`);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  check(!/denial\.pdf/.test(await modal.locator('[data-cip-decision-letter-list]').innerText().catch(() => '')), 'the refused letter is not put back');
  check(await modal.locator('[data-cip-decided]').inputValue() === '2026-09-18' && (await picked()) === 'denied', 'while the rest of the answer is');

  step(6, 'Approved files it, on the day given, with the letter on file');
  await pick('granted');
  await modal.locator('[data-cip-decided]').fill('2026-09-21');
  await modal.locator('[data-cip-decision-note]').fill('Approved in principle.');
  await modal.locator('[data-cip-decision-letter]').setInputFiles(letter('approval.pdf'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-approval-filing-filled.png` });
  await modal.locator('[data-cip-save-decision]').click();
  await gone();
  await filed();
  await page.waitForTimeout(1500);
  check(filings.length === 3 && filings[2] === 201, `filed once (${filings.join(',')})`);
  const approved = await record(first.id);
  console.log(`      record: ${JSON.stringify(approved)}`);
  check(approved.status === 'post_approved' && approved.label === 'Approved', 'the application stands on Approved');
  check(approved.decision === 'post_approved' && approved.decidedAt === '2026-09-21', 'the decision is recorded on the day that was given');
  check(!!approved.letter, `the letter is on the file (${approved.letter})`);
  check(approved.phase === 'post_approval', 'in the post-approval lane');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-approval-filing-approved.png` });

  step(7, 'Denied files it the same way');
  const second = await seedDraft('Bruno', number());
  check(second.status === 200 && !!second.id && second.id !== first.id, 'a second draft is on file');
  await openDraft(second.id);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  check((await picked()) === '' && (await modal.locator('[data-cip-decision-note]').inputValue()) === '', 'a new application starts from an empty dialog');
  await pick('denied');
  await modal.locator('[data-cip-decided]').fill('2026-09-25');
  await modal.locator('[data-cip-decision-letter]').setInputFiles(letter('denial.pdf'));
  await modal.locator('[data-cip-save-decision]').click();
  await gone();
  await filed();
  await page.waitForTimeout(1500);
  check(filings.length === 4 && filings[3] === 201, `filed once more (${filings.join(',')})`);
  const denied = await record(second.id);
  console.log(`      record: ${JSON.stringify(denied)}`);
  check(denied.status === 'post_denied' && denied.label === 'Denied', 'the application stands on Denied');
  check(denied.decision === 'post_denied' && denied.decidedAt === '2026-09-25', 'the decision is recorded on the day that was given');
  check(!!denied.letter, 'the letter is on the file');

  step(8, 'Skip adds an application that has no decision yet');
  const third = await seedDraft('Cosmo', number());
  check(third.status === 200 && !!third.id && third.id !== second.id, 'a third draft is on file');
  await openDraft(third.id);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  // Pressed with the dialog untouched: no outcome, no date change, no letter.
  await modal.locator('[data-cip-skip-decision]').click();
  await gone();
  await filed();
  await page.waitForTimeout(1500);
  check(filings.length === 5 && filings[4] === 201, `filed once (${filings.join(',')})`);
  const undecided = await record(third.id);
  console.log(`      record: ${JSON.stringify(undecided)}`);
  check(undecided.status === 'post_approval' && undecided.phase === 'post_approval', 'the application stands on Post-Approval');
  check(!undecided.decision && !undecided.decidedAt && !undecided.letter, 'with no decision, no decision date and no letter recorded');

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll post-approval filing checks passed.');
process.exit(failures.length ? 1 : 0);
