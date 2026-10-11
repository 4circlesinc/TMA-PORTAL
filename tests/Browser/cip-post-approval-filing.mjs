import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Adding a post-approval application asks, once, whether it was approved
 * or denied.
 *
 * A firm bringing its existing files into the portal adds them straight
 * into post-approval, and each is one of two things. Approved enters the
 * lane and stands on Approved; the service provider is asked for the Stage 1
 * documents and then told the application was approved. Denied lands on
 * Denied and is sent the denial alone. The emails are pinned in
 * CipIntakeTest and CipApplicationDraftTest; this is the question itself,
 * which only a browser shows:
 *
 *  - Save on a complete post-approval filing asks "Was this application
 *    approved or denied?", with Approved and Denied to press and nothing
 *    else to choose but Cancel;
 *  - Cancel files nothing, and the next Save asks again;
 *  - a refused Add forgets the answer, so the next one asks again;
 *  - Approved files it, and the application reads Approved;
 *  - Denied files it, and the application reads Denied.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL) and TMA_PROVIDER, the uuid of a service
 * provider that account may file under. It files two applications each run
 * under fresh numbers. See README.
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

  return { status: body.status, label: body.statusLabel, decision: body.decision, phase: body.phase, decidedAt: body.decidedAt };
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

  step(1, 'Save on a post-approval filing asks whether it was approved or denied');
  const first = await seedDraft('Ansel', number());
  console.log(`      draft: ${JSON.stringify(first)}`);
  check(first.status === 200 && !!first.id, 'a complete post-approval draft is on file');
  await openDraft(first.id);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 }).catch(() => {});
  const asked = await modal.count() ? (await modal.innerText()).replace(/\s+/g, ' ').trim() : '';
  if (!asked) console.log(`      toast: ${(await page.locator('.tma-toast-floating-host').innerText().catch(() => '')).trim()}`);
  check(/Was this application approved or denied\?/.test(asked), `the question is asked ("${asked.slice(0, 90)}")`);
  const buttons = (await modal.locator('.tma-portal-modal__foot button').allInnerTexts()).map(t => t.trim());
  check(buttons.join(' | ') === 'Cancel | Denied | Approved', `with Cancel, Denied and Approved to press (${buttons.join(' | ')})`);
  check(await modal.locator('[data-outcome="post_approval"]').count() === 0, 'and no undecided answer among them');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-approval-filing-question.png` });

  step(2, 'Cancel files nothing, and the next Save asks again');
  await modal.locator('[data-outcome-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 8000 });
  await page.waitForTimeout(600);
  check(filings.length === 0, 'nothing was filed');
  check((await record(first.id)).status === 'draft', 'the application is still a draft');
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  check(/approved or denied/.test(await modal.innerText()), 'the question comes back');

  step(3, 'A refused Add forgets the answer, so the next one asks again');
  /*
   * The server is made to refuse this one press. Kept, the answer rode
   * along with whatever was typed next: a form corrected into a different
   * applicant was filed as Denied, and emailed, with no question asked.
   */
  await page.route('**/portal/cip/applications', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();

    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Refused.', errors: { cipNumber: ['That number is already on file.'] } }),
    });
  }, { times: 1 });
  await modal.locator('[data-outcome="denied"]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  check(filings.length === 1 && filings[0] === 422, `the press was refused (${filings.join(',')})`);
  check((await record(first.id)).status === 'draft', 'and nothing was filed');
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 }).catch(() => {});
  check(await modal.count() === 1 && /approved or denied/.test(await modal.innerText()), 'the next Add asks again instead of reusing Denied');

  step(4, 'Approved files it, and the application reads Approved');
  await modal.locator('[data-outcome="approved"]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-cip-save]') || !document.querySelector('[data-cip-save]').offsetParent, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check(filings.length === 2 && filings[1] === 201, `filed once (${filings.join(',')})`);
  const approved = await record(first.id);
  console.log(`      record: ${JSON.stringify(approved)}`);
  check(approved.status === 'post_approved' && approved.label === 'Approved', 'the application stands on Approved');
  check(approved.decision === 'post_approved' && !!approved.decidedAt, 'with the decision and its day recorded');
  check(approved.phase === 'post_approval', 'in the post-approval lane');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-approval-filing-approved.png` });

  step(5, 'Denied files it, and the application reads Denied');
  const second = await seedDraft('Bruno', number());
  check(second.status === 200 && !!second.id && second.id !== first.id, 'a second draft is on file');
  await openDraft(second.id);
  await page.click('[data-cip-save]');
  await modal.waitFor({ timeout: 8000 });
  await modal.locator('[data-outcome="denied"]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-cip-save]') || !document.querySelector('[data-cip-save]').offsetParent, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check(filings.length === 3 && filings[2] === 201, `filed once more (${filings.join(',')})`);
  const denied = await record(second.id);
  console.log(`      record: ${JSON.stringify(denied)}`);
  check(denied.status === 'post_denied' && denied.label === 'Denied', 'the application stands on Denied');
  check(denied.decision === 'post_denied' && !!denied.decidedAt, 'with the decision and its day recorded');

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll post-approval filing checks passed.');
process.exit(failures.length ? 1 : 0);
