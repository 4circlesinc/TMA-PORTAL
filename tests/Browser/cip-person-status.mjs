import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * A person's status in post-approval, beside the application's.
 *
 * Each person on a post-approval file wears the application's own lane
 * statuses, read off the file, their own documents and any NIC or passport
 * step recorded for them alone (PersonStatus). The rules are pinned in
 * CipPersonStatusTest; this is the part only a browser shows:
 *
 *  - the table's family rows and the profile wear the same words and
 *    colours as the application's chip, and never "Not started";
 *  - a person whose documents are all accepted reads Apply for COR while
 *    the application, waiting on the rest of the family, still reads
 *    Approved;
 *  - the chip opens the whole lane, pressable where a step is theirs to
 *    take and grey where the application or their documents decide;
 *  - a dated step asks for its day in the dialog, and a submission whose
 *    documents are not Ready for submission is refused in a dialog that
 *    lists them, each with its status;
 *  - recording it, on the file's own page, moves that person and nobody
 *    else, and pressing the chip again offers the step after it;
 *  - an outcome of their own (Denied) asks for no date, and can be taken
 *    back into step with the application.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL) and two seeded families:
 *
 *   TMA_APP_COR   a file at Approved; TMA_PERSON_READY is someone on it
 *                 whose COR documents are all accepted, TMA_PERSON_OPEN
 *                 someone whose are not
 *   TMA_APP_NIC   a file at Apply for NIC; TMA_PERSON_NIC_READY has their
 *                 NIC documents accepted, TMA_PERSON_NIC_OPEN owes theirs
 *
 * See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const need = (name) => {
  if (!process.env[name]) throw new Error(`${name} is required`);

  return process.env[name];
};
const APP_COR = need('TMA_APP_COR');
const PERSON_READY = need('TMA_PERSON_READY');
const PERSON_OPEN = need('TMA_PERSON_OPEN');
const APP_NIC = need('TMA_APP_NIC');
const PERSON_NIC_READY = need('TMA_PERSON_NIC_READY');
const PERSON_NIC_OPEN = need('TMA_PERSON_NIC_OPEN');

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

const menu = page.locator('.tma-portal-context-menu').last();
const modal = page.locator('.tma-portal-modal__card').last();
const personChip = (person) => page.locator(`[data-cip-person-status-chip][data-cip-person="${person}"]`).first();
// Chips are drawn in capitals by the stylesheet, so words are compared, not case.
const says = (text, words) => String(text || '').trim().toLowerCase() === words.toLowerCase();
const chipText = async (person) => (await personChip(person).innerText()).trim();
const toastText = async () => (await page.locator('.tma-toast-floating-host').innerText().catch(() => '')).trim();
const park = () => page.mouse.move(700, 880);

async function openTable() {
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-clients-list-tab="post_approval"]', { timeout: 30000 });
  await page.click('[data-clients-list-tab="post_approval"]');
  await page.waitForSelector(`[data-cip-family-expand="${APP_COR}"]`, { timeout: 30000 });
  await page.waitForTimeout(600);
}

async function expand(app) {
  const button = page.locator(`[data-cip-family-expand="${app}"]`);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await page.waitForSelector(`tr.tma-cip-table__member-row[data-cip-app="${app}"]`, { timeout: 8000 });
  await page.waitForTimeout(300);
}

const memberChips = (app) => page.locator(`tr.tma-cip-table__member-row[data-cip-app="${app}"] .tma-portal-status`).allInnerTexts();
// The Status column's own chip; a second copy rides beside the name for touch widths.
const rowChip = (app) => page.locator(`.tma-cip-table__status-cell [data-cip-status-chip][data-cip-app="${app}"]`).first();

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

  await openTable();

  step(1, 'An Approved file: its people wear the application\'s own words');
  const fileLabel = (await rowChip(APP_COR).innerText()).trim();
  check(says(fileLabel, 'Approved'), `the application reads Approved (${fileLabel})`);
  await expand(APP_COR);
  const corChips = (await memberChips(APP_COR)).map(t => t.trim());
  console.log(`      family: ${corChips.join(' | ')}`);
  check(corChips.length === 3, 'three family rows');
  check(!corChips.some(t => /not started|documents pending|processing/i.test(t)), 'nobody reads Not started or any retired status');
  check(says(await chipText(PERSON_OPEN), 'Approved'), 'a person still owing documents reads Approved, like the file');
  check(says(await chipText(PERSON_READY), 'Apply for COR'), 'the person whose documents are all accepted reads Apply for COR');

  const tone = (el) => el.evaluate(n => [...n.classList].find(c => /^tma-portal-status--(?!inline)/.test(c)));
  check((await tone(personChip(PERSON_OPEN))) === 'tma-portal-status--laurel', 'in the same colour the application\'s Approved wears');
  // Under the Status column: the person's chip lines up with the file's.
  const fileBox = await rowChip(APP_NIC).boundingBox();
  const personBox = await personChip(PERSON_OPEN).boundingBox();
  const table = await page.locator('.tma-cip-table').first().boundingBox();
  check(Math.abs(fileBox.x - personBox.x) < 4, `a person's chip sits under the Status column (${Math.round(personBox.x)} vs ${Math.round(fileBox.x)})`);
  check(personBox.x + personBox.width <= table.x + table.width + 1, 'and is not cut off by the edge of the table');
  await page.screenshot({ path: 'tests/Browser/cip-person-status.png' });

  step(2, 'The chip opens the whole lane; COR is the application\'s to record');
  await personChip(PERSON_READY).click();
  await menu.waitFor({ timeout: 5000 });
  const rows = (await menu.locator('.tma-portal-context-menu__label').allInnerTexts()).map(t => t.trim());
  console.log(`      lane: ${rows.join(' › ')}`);
  check(rows.indexOf('Pending COR') > -1 && rows.indexOf('Closed') > rows.indexOf('Pending COR'), 'the lane is listed in order, through to Closed');
  check(await menu.locator('[data-cip-status-to="pending_cor"]').count() === 0, 'Pending COR is not pressable for one person');
  check(await menu.locator('.tma-portal-context-menu__item--muted:has-text("Pending COR")').count() === 1, 'it is shown greyed');
  check(await menu.locator('[data-cip-status-to="post_denied"]').count() === 1, 'Denied, an outcome of their own, is pressable');
  await page.keyboard.press('Escape');
  await park();

  step(3, 'A submission step for one person is refused while their documents are not ready');
  await expand(APP_NIC);
  check((await memberChips(APP_NIC)).every(t => says(t, 'Apply for NIC')), 'the whole family reads Apply for NIC');
  await personChip(PERSON_NIC_OPEN).click();
  await menu.waitFor({ timeout: 5000 });
  await menu.locator('[data-cip-status-to="pending_nic"]').click();
  await modal.waitFor({ timeout: 5000 });
  const dateField = modal.locator('[data-cip-person-stage-date]');
  check(await dateField.count() === 1, 'the dialog asks for the day');
  check((await modal.locator('label[for="cip-person-stage-date"]').innerText()).trim() === 'NIC submission date', 'and calls it NIC submission date');
  await modal.locator('[data-cip-save-person-status]').click();
  /*
   * Refused, in a dialog that lists what is not Ready for submission. It
   * used to be one sentence in a toast with every document strung along
   * it, cut off at the edge of the screen on a real file.
   */
  const notReady = page.locator('.tma-portal-modal__card.tma-cip-not-ready');
  await notReady.waitFor({ timeout: 15000 });
  check((await notReady.locator('.tma-portal-modal__title').innerText()).trim() === 'Documents not ready', 'refused in a dialog, Documents not ready');
  const waiting = await notReady.locator('.tma-dash__clients-checklist-row').evaluateAll(rows => rows.map(r => ({
    label: r.querySelector('.tma-dash__clients-checklist-label').textContent.trim(),
    status: r.querySelector('.tma-portal-status').textContent.trim(),
  })));
  console.log(`      listed: ${waiting.map(w => `${w.label} (${w.status})`).join(' | ').slice(0, 160)}`);
  check(waiting.length > 0 && waiting.some(w => /R3 Form/.test(w.label)), 'which lists the documents by name');
  check(waiting.every(w => says(w.status, 'Pending upload')), 'each with the status it wears on the checklist');
  check(await notReady.locator('.tma-cip-not-ready__group').count() === 1, 'this person\'s alone');
  check(!/Not yet Ready/.test(await toastText()), 'and no sentence in a toast');
  await notReady.locator('[data-cip-not-ready-close]').click();
  await page.waitForTimeout(300);
  check(await page.locator('.tma-portal-modal').count() === 0, 'Close puts it away');
  check(says(await chipText(PERSON_NIC_OPEN), 'Apply for NIC'), 'and the person has not moved');
  await park();

  step(4, 'On the file\'s own page, with their documents accepted, the step is recorded for that person alone');
  await page.locator(`tr.tma-cip-table__member-row[data-cip-app="${APP_NIC}"]`).first().click();
  await personChip(PERSON_NIC_READY).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const header = (await page.locator('[data-cip-status-chip]:visible').first().innerText()).trim();
  check(says(header, 'Apply for NIC'), `the application's chip reads Apply for NIC (${header})`);
  await personChip(PERSON_NIC_READY).click();
  await menu.waitFor({ timeout: 5000 });
  await menu.locator('[data-cip-status-to="pending_nic"]').click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('[data-cip-person-stage-date]').fill('2026-10-01');
  await modal.locator('[data-cip-save-person-status]').click();
  await page.waitForFunction(
    (person) => {
      const chip = document.querySelector(`[data-cip-person-status-chip][data-cip-person="${person}"]`);

      return chip && chip.textContent.trim().toLowerCase() === 'pending nic';
    },
    PERSON_NIC_READY,
    { timeout: 15000 },
  );
  check(true, 'their chip reads Pending NIC');
  await park();
  await page.waitForTimeout(1500);

  step(5, 'Pressed again, the chip offers what comes next, not the step just taken');
  /*
   * The picker reads the record the move returned, not the table row the
   * page was opened from. From the row it went on offering Pending NIC,
   * and posting it again threw the typed date away.
   */
  await personChip(PERSON_NIC_READY).click();
  await menu.waitFor({ timeout: 5000 });
  check(await menu.locator('[data-cip-status-to="apply_for_passport"]').count() === 1, 'NIC received (Apply for Passport) is the row to press');
  check(await menu.locator('[data-cip-status-to="pending_nic"]').count() === 0, 'Pending NIC is no longer one');
  check(await menu.locator('[data-cip-status-to="apply_for_nic"]').count() === 1, 'and Apply for NIC is offered as the way back');
  await page.keyboard.press('Escape');
  await park();

  const detail = await page.evaluate(async ({ app }) => {
    const res = await fetch(`/portal/cip/applications/${app}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const body = (await res.json()).application;

    return {
      status: body.statusLabel,
      people: [body.applicant].concat(body.dependents || []).map(p => ({
        id: p.id,
        label: p.statusLabel,
        next: (p.availableStatuses || []).map(s => s.value),
      })),
    };
  }, { app: APP_NIC });
  const open = detail.people.find(p => p.id === PERSON_NIC_OPEN);
  check(says(detail.status, 'Apply for NIC'), 'the application has not moved');
  check(open && says(open.label, 'Apply for NIC'), 'nor has the rest of the family');
  check(open && !open.next.includes('pending_nic'), 'and Pending NIC is not offered to the person whose documents are outstanding');

  await openTable();
  await expand(APP_NIC);
  check(says(await chipText(PERSON_NIC_READY), 'Pending NIC'), 'back on the table, their row reads Pending NIC');
  check(says(await chipText(PERSON_NIC_OPEN), 'Apply for NIC'), 'beside a family still on Apply for NIC');

  step(6, 'An outcome of their own asks for no date, and can be taken back');
  await expand(APP_COR);
  await personChip(PERSON_OPEN).click();
  await menu.waitFor({ timeout: 5000 });
  await menu.locator('[data-cip-status-to="post_denied"]').click();
  await modal.waitFor({ timeout: 5000 });
  check(await modal.locator('[data-cip-person-stage-date]').count() === 0, 'no date is asked for');
  await modal.locator('[data-cip-save-person-status]').click();
  await page.waitForFunction(
    (person) => {
      const chip = document.querySelector(`[data-cip-person-status-chip][data-cip-person="${person}"]`);

      return chip && chip.textContent.trim().toLowerCase() === 'denied';
    },
    PERSON_OPEN,
    { timeout: 15000 },
  );
  check(true, 'that person reads Denied');
  await page.locator(`[data-cip-family-expand="${APP_COR}"]`).click();
  await page.waitForTimeout(400);
  check(says(await rowChip(APP_COR).innerText(), 'Approved'), 'the application is still Approved');
  await expand(APP_COR);
  await park();
  await page.waitForTimeout(600);
  await personChip(PERSON_OPEN).click();
  await menu.waitFor({ timeout: 5000 });
  const back = menu.locator('[data-cip-status-to="post_approved"]');
  check(await back.count() === 1, 'Approved is offered as the way back into step');
  await back.click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('[data-cip-save-person-status]').click();
  await page.waitForFunction(
    (person) => {
      const chip = document.querySelector(`[data-cip-person-status-chip][data-cip-person="${person}"]`);

      return chip && chip.textContent.trim().toLowerCase() === 'approved';
    },
    PERSON_OPEN,
    { timeout: 15000 },
  );
  check(true, 'and they read Approved with the file again');

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll person status checks passed.');
process.exit(failures.length ? 1 : 0);
