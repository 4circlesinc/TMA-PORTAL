import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * The status menu is a way forward, and says what it is waiting on.
 *
 * Brief sections 5 to 7: at Apply for COR the provider confirms submission,
 * then the COR submission date is recorded and the file is Pending COR, then
 * the COR received date and it is Apply for NIC. Each of those dates has a
 * button in the strip at the top of the application. The status menus,
 * where a reader goes to move a file on, drew every one of those statuses
 * greyed with nothing beside them, on the application's chip and on each
 * person's, so the lane read as a list that could not be pressed.
 *
 * Only a browser shows this: the rules are pinned in CipPostApprovalTest,
 * this is what the menu draws from them. Pinned here:
 *
 *  - while documents are still to be accepted the menus say so, in one line,
 *    on the application's chip and on a person who is already at Apply for
 *    COR ahead of their family;
 *  - at Apply for COR, unconfirmed, they say to confirm submission first,
 *    and stop saying it the moment it is confirmed, with no reload;
 *  - once confirmed, Pending COR is a row to press on a person's chip, it
 *    opens the COR submission date and records it for the application;
 *  - Apply for NIC is then a row to press on the application's chip, which
 *    opens the COR received date;
 *  - the steps after the next one stay greyed, in order;
 *  - a file put on Updates Required by hand at the NIC stage is offered
 *    Apply for NIC as the way back, as a plain change of status with no
 *    date, and not the COR received date a second time.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an administrator
 * (TMA_STAFF_EMAIL) and the families from fixtures/next-step-seed.php, whose
 * last line is the environment below. The check records dates on one of
 * them, so seed fresh ones each run. See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const need = (name) => { const v = process.env[name]; if (!v) throw new Error(`${name} is required (see fixtures/next-step-seed.php)`); return v; };
const APP_WAITING = need('TMA_APP_WAITING');
const PERSON_AHEAD = need('TMA_PERSON_AHEAD');
const APP_UNCONFIRMED = need('TMA_APP_UNCONFIRMED');
const PERSON_UNCONFIRMED = need('TMA_PERSON_UNCONFIRMED');
const APP_CONFIRMED = need('TMA_APP_CONFIRMED');
const PERSON_CONFIRMED = need('TMA_PERSON_CONFIRMED');
const SHOTS = process.env.TMA_SHOTS || '';

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
const personChip = (person) => page.locator(`[data-cip-person-status-chip][data-cip-person="${person}"]:visible`).first();
const fileChip = () => page.locator('.tma-dash__clients-detail [data-cip-status-chip]:visible, [data-cip-status-chip]:visible').first();
// Chips are drawn in capitals by the stylesheet, so words are compared, not case.
const says = (text, words) => String(text || '').trim().toLowerCase() === words.toLowerCase();
const park = () => page.mouse.move(700, 880);
const note = async () => (await menu.locator('[data-cip-status-hold]').allInnerTexts()).map(t => t.trim()).join(' | ');
const pressable = (status) => menu.locator(`[data-cip-status-to="${status}"]`).count();
const greyed = (label) => menu.locator(`.tma-portal-context-menu__item--muted:has-text("${label}")`).count();
const bar = async () => (await page.locator('.tma-dash__clients-appbar').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

async function openApplication(app, tab) {
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-clients-list-tab="post_approval"]', { timeout: 30000 });
  await page.click('[data-clients-list-tab="post_approval"]');
  await page.waitForSelector(`tr[data-cip-app="${app}"]`, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator(`tr[data-cip-app="${app}"] .tma-cip-table__number`).first().click();
  await page.locator('.tma-dash__cip-strip').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  if (tab) {
    await page.locator(`[data-clients-tab="${tab}"]`).first().click();
    await page.waitForTimeout(600);
  }
}

async function openMenu(chip) {
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await menu.waitFor({ timeout: 5000 });
}

async function closeMenu() {
  await page.keyboard.press('Escape');
  await park();
  await page.waitForTimeout(200);
}

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

  step(1, 'Documents still to be accepted: the menus say what they are waiting on');
  await openApplication(APP_WAITING, 'applicant');
  check(says(await personChip(PERSON_AHEAD).innerText(), 'Apply for COR'), 'the person whose documents are all accepted reads Apply for COR');
  await openMenu(personChip(PERSON_AHEAD));
  check(await pressable('pending_cor') === 0 && await greyed('Pending COR') === 1, 'Pending COR is greyed on their chip');
  check(await note() === 'Waiting for the rest of the family\'s documents.', `and the menu says whose it is waiting on ("${await note()}")`);
  const menuBox = await menu.boundingBox();
  const widest = await menu.locator('.tma-portal-context-menu__label').evaluateAll(ls => Math.max(...ls.map(l => l.getBoundingClientRect().width)));
  check(menuBox.width < widest + 80, `the sentence wraps to the menu rather than stretching it (${Math.round(menuBox.width)}px)`);
  const noteBox = await menu.locator('[data-cip-status-hold]').boundingBox();
  const firstRow = await menu.locator('.tma-portal-context-menu__label').first().boundingBox();
  check(noteBox.y < firstRow.y, 'and sits above the lane it explains');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/next-step-waiting.png` });
  await closeMenu();
  await openMenu(fileChip());
  check(await pressable('pending_cor') === 0, 'nor is it pressable on the application\'s chip');
  check(/Every document must be Ready for submission first\./.test(await note()), 'which says the same');
  await closeMenu();

  step(2, 'Apply for COR, unconfirmed: confirm submission comes first');
  await openApplication(APP_UNCONFIRMED, 'dependents');
  check(/Confirm submission/.test(await bar()), `the strip offers Confirm submission ("${await bar()}")`);
  await openMenu(personChip(PERSON_UNCONFIRMED));
  check(await pressable('pending_cor') === 0 && await greyed('Pending COR') === 1, 'Pending COR is greyed until the package is confirmed');
  check(await note() === 'Confirm submission first.', `the menu says so ("${await note()}")`);
  await closeMenu();
  await openMenu(fileChip());
  check(/Confirm submission first\./.test(await note()), 'on the application\'s chip too');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/next-step-unconfirmed.png` });
  await closeMenu();

  /*
   * Confirming answers with the record as it now stands, and the menu is
   * drawn from that answer: the step it was waiting on is offered at once,
   * and the sentence about confirming first does not linger beside it.
   */
  await page.locator('[data-cip-confirm]').first().click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('[data-cip-save-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await openMenu(personChip(PERSON_UNCONFIRMED));
  check(await pressable('pending_cor') === 1, 'once confirmed, Pending COR can be pressed with no reload');
  check(await note() === '', `and the menu no longer says to confirm first ("${await note()}")`);
  await closeMenu();
  // The application's own chip is the menu that carried the sentence.
  await openMenu(fileChip());
  check(await pressable('pending_cor') === 1, 'on the application\'s chip too');
  check(await note() === '', `with no sentence left beside it ("${await note()}")`);
  await closeMenu();

  step(3, 'Confirmed: Pending COR is a row to press on a person\'s chip');
  await openApplication(APP_CONFIRMED, 'dependents');
  check(/Record COR submission/.test(await bar()), `the strip offers Record COR submission ("${await bar()}")`);
  await openMenu(personChip(PERSON_CONFIRMED));
  const lane = (await menu.locator('.tma-portal-context-menu__label').allInnerTexts()).map(t => t.trim());
  console.log(`      lane: ${lane.join(' › ')}`);
  check(await pressable('pending_cor') === 1, 'Pending COR can be pressed');
  check(await greyed('COR Received') === 1 && await greyed('Apply for NIC') === 1 && await greyed('Passport Delivered') === 1, 'the steps after it stay greyed');
  check(lane.indexOf('Pending COR') > -1 && lane.indexOf('COR Received') === lane.indexOf('Pending COR') + 1, 'in the lane\'s own order');
  check(await note() === '', 'and nothing is said to be waiting');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/next-step-pressable.png` });
  await menu.locator('[data-cip-status-to="pending_cor"]').click();
  await modal.waitFor({ timeout: 5000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Record COR submission', 'it opens Record COR submission');
  check((await modal.locator('label[for="cip-stage-date"]').innerText()).trim() === 'COR submission date', 'and asks for the COR submission date');
  await modal.locator('[data-cip-stage-date]').fill('2026-10-05');
  await modal.locator('[data-cip-save-stage]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.waitForFunction(
    (person) => {
      const chip = [...document.querySelectorAll(`[data-cip-person-status-chip][data-cip-person="${person}"]`)].find(n => n.offsetParent);

      return chip && chip.textContent.trim().toLowerCase() === 'pending cor';
    },
    PERSON_CONFIRMED,
    { timeout: 15000 },
  );
  check(true, 'the person reads Pending COR');
  check(says(await fileChip().innerText(), 'Pending COR'), 'and so does the application: the step was recorded for the file');
  await park();
  await page.waitForTimeout(2500);

  step(4, 'Pending COR: COR Received is the row to press on the application\'s chip');
  check(/Record COR received/.test(await bar()), `the strip offers Record COR received ("${await bar()}")`);
  await openMenu(fileChip());
  check(await pressable('cor_received') === 1, 'COR Received can be pressed');
  check(await pressable('apply_for_nic') === 0 && await greyed('Apply for NIC') === 1, 'Apply for NIC, the step after, is greyed');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/next-step-file-menu.png` });
  await menu.locator('[data-cip-status-to="cor_received"]').click();
  await modal.waitFor({ timeout: 5000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Record COR received', 'it opens Record COR received');
  await modal.locator('[data-cip-stage-date]').fill('2026-10-09');
  await modal.locator('[data-cip-stage-cor]').fill('COR-2026-0099');
  await modal.locator('[data-cip-save-stage]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const chip = [...document.querySelectorAll('[data-cip-status-chip]')].find(n => n.offsetParent);

      return chip && chip.textContent.trim().toLowerCase() === 'cor received';
    },
    null,
    { timeout: 15000 },
  );
  check(true, 'the application reads COR Received');
  await openMenu(fileChip());
  check(await pressable('apply_for_nic') === 1, 'Apply for NIC can be pressed once the COR is in');
  await menu.locator('[data-cip-status-to="apply_for_nic"]').click();
  await modal.waitFor({ timeout: 5000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Change status', 'moving on to Apply for NIC asks for no date');
  await modal.locator('[data-cip-save-status]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const chip = [...document.querySelectorAll('[data-cip-status-chip]')].find(n => n.offsetParent);

      return chip && chip.textContent.trim().toLowerCase() === 'apply for nic';
    },
    null,
    { timeout: 15000 },
  );
  check(true, 'the application reads Apply for NIC');

  const recorded = await page.evaluate(async (app) => {
    const res = await fetch(`/portal/cip/applications/${app}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const body = (await res.json()).application;

    return { status: body.status, sent: body.corSubmittedAt, received: body.corReceivedAt, number: body.corNumber };
  }, APP_CONFIRMED);
  check(recorded.sent === '2026-10-05' && recorded.received === '2026-10-09', `both days were stored with the moves (${recorded.sent}, ${recorded.received})`);
  check(recorded.number === 'COR-2026-0099', 'with the certificate number');
  await park();
  await page.waitForTimeout(2500);

  step(5, 'Updates Required by hand: the way back is a row to press, and asks for no date');
  await openMenu(fileChip());
  await menu.locator('[data-cip-status-to="update_required"]').click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('[data-cip-save-status]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const chip = [...document.querySelectorAll('[data-cip-status-chip]')].find(n => n.offsetParent);

      return chip && chip.textContent.trim().toLowerCase() === 'updates required';
    },
    null,
    { timeout: 15000 },
  );
  await park();
  await page.waitForTimeout(2500);
  check(!/Record COR received/.test(await bar()), `the strip does not offer the COR received date again ("${await bar()}")`);
  await openMenu(fileChip());
  check(await pressable('apply_for_nic') === 1, 'Apply for NIC is the row back');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/next-step-return.png` });
  await menu.locator('[data-cip-status-to="apply_for_nic"]').click();
  await modal.waitFor({ timeout: 5000 });
  check((await modal.locator('.tma-portal-modal__title').innerText()).trim() === 'Change status', 'it is a plain change of status');
  check(await modal.locator('[data-cip-stage-date]').count() === 0, 'with no date asked for');
  await modal.locator('[data-cip-save-status]').click();
  await page.waitForFunction(() => !document.querySelector('.tma-portal-modal'), null, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const chip = [...document.querySelectorAll('[data-cip-status-chip]')].find(n => n.offsetParent);

      return chip && chip.textContent.trim().toLowerCase() === 'apply for nic';
    },
    null,
    { timeout: 15000 },
  );
  const back = await page.evaluate(async (app) => {
    const res = await fetch(`/portal/cip/applications/${app}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const body = (await res.json()).application;

    return { status: body.status, received: body.corReceivedAt };
  }, APP_CONFIRMED);
  check(back.status === 'apply_for_nic' && back.received === '2026-10-09', `the file is back at Apply for NIC with its COR received date untouched (${back.received})`);

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll next step menu checks passed.');
process.exit(failures.length ? 1 : 0);
