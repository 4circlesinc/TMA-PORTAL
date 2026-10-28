import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// Settings › Service Provider Emails: one switch per kind of CIP notice a
// staff member is copied on.
//
// What only a browser can check: the Notifications row opens the page and
// says how many are on, an untouched page reads the way the server answers
// it for the account (on for an officer, off for an administrator), a switch
// saves and survives a reload, the "all" switch moves every row, a client
// never sees the row, the rail entry or the page, and the page lays out at
// phone width without a sideways scroll.
//
// Seed: tests/Browser/fixtures/provider-emails-seed.php on a throwaway
// database with FEATURE_CIP=true (the seed clears each account's
// preferences, so run it before every pass). Screenshots land in SHOTS when
// it is set.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8957';
const ADMIN = process.env.TMA_EMAIL || 'e2e@example.com';
const OFFICER = process.env.TMA_EMAIL_B || 'rita@example.com';
const CLIENT = process.env.TMA_EMAIL_C || 'gil@example.com';
const SHOTS = process.env.SHOTS || '';
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

const KINDS = [
  'new', 'review_application', 'assessment_feedback', 'update_required', 'ready_to_submit',
  'pending_review', 'non_compliant', 'background_check', 'dd_query', 'delayed', 'granted', 'denied',
  'post_approval', 'apply_for_cor', 'pending_cor', 'cor_received', 'apply_for_nic', 'pending_nic',
  'nic_received', 'apply_for_passport', 'pending_passport', 'passport_received', 'passport_delivered',
  'post_approved', 'post_denied', 'closed',
  'new_appeal', 'appeal_ready', 'appeal_submitted', 'comment',
];

function loginCode() {
  const hits = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1440, height: 950 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(email + ' pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/403|404|422|favicon|WebSocket|ws:\/\/|reverb/i.test(m.text())) errors.push(email + ' console: ' + m.text());
  });
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
  }
  const stay = page.locator('form:has(input[name="stay"][value="yes"]) button[type="submit"]');
  if (await stay.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      stay.first().click(),
    ]);
  }
  return page;
}

async function openSettings(page, id) {
  await page.goto(`${BASE}/account-settings?settings-page=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-tma-access') === 'ready', null, { timeout: 15000 });
  await page.waitForSelector('.tma-portal-admin__nav', { state: 'attached', timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(700);
}

const prefs = (page) => page.evaluate(async () => {
  const r = await fetch('/me/preferences', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  return r.json();
});

/* Settings mounts twice (the older view and the rail's embed), so every
   question is about the copy on screen. */
const panel = '[data-settings-panel="provider-emails"]:visible';

async function switches(page) {
  return page.evaluate(() => {
    const out = {};
    const host = [...document.querySelectorAll('[data-settings-panel="provider-emails"]')].find((el) => el.offsetParent !== null);
    if (!host) return null;
    host.querySelectorAll('[data-settings-copy]').forEach((el) => { out[el.getAttribute('data-settings-copy')] = el.checked; });
    const all = host.querySelector('[data-settings-copy-all]');
    return { kinds: out, all: all ? all.checked : null };
  });
}

/* A real click on the switch input never lands; the label wraps it. */
async function flip(page, selector) {
  await page.locator(`${panel} ${selector}`).first().evaluate((el) => el.closest('label').click());
}

async function rowValue(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-settings-row-value="open-provider-emails"]')].find((n) => n.offsetParent !== null);
    return el ? el.textContent.trim() : null;
  });
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/* ── an officer: every switch starts on ─────────────────────────────── */
step(1, 'Officer: the Notifications row opens the page, every switch on');
const officer = await session(OFFICER);
await openSettings(officer, 'notifications');
const offRow = officer.locator('[data-settings-action="open-provider-emails"]:visible');
check(await offRow.count() === 1, 'the Service provider emails row is on Notifications');
check(await rowValue(officer) === 'On', 'the row says On');
await shot(officer, '1-officer-notifications');
await offRow.first().click();
await officer.waitForSelector(panel, { timeout: 8000 });
await officer.mouse.move(1000, 700);
await officer.waitForTimeout(400);
check(await officer.locator('.tma-portal-admin__nav-item.is-active[data-admin-nav="provider-emails"]').count() === 1, 'the rail marks Service Provider Emails');
let state = await switches(officer);
check(state && Object.keys(state.kinds).join() === KINDS.join(), 'one switch per kind, in the server\'s order');
check(state && Object.values(state.kinds).every(Boolean), 'every switch is on');
check(state && state.all === true, 'the all switch is on');
await shot(officer, '2-officer-page');

step(2, 'Officer: one switch off saves, and the row says Custom');
await flip(officer, '[data-settings-copy="delayed"]');
await officer.waitForTimeout(1200);
let server = await prefs(officer);
check(server.cipCopies && server.cipCopies.delayed === false, 'the server has Delayed off');
check(KINDS.filter((k) => k !== 'delayed').every((k) => server.cipCopies[k] === true), 'every other kind is still on');
check(server.notifyProviderCopies === true, 'notifyProviderCopies still answers true (some are on)');
state = await switches(officer);
check(state.all === false, 'the all switch is off once one row is');
await openSettings(officer, 'provider-emails');
await officer.waitForSelector(panel, { timeout: 8000 });
state = await switches(officer);
check(state.kinds.delayed === false && state.kinds.new === true, 'a reload keeps Delayed off and New on');
await openSettings(officer, 'notifications');
check(await rowValue(officer) === 'Custom', 'the Notifications row says Custom');

step(3, 'Officer: the all switch turns everything off, then on');
await openSettings(officer, 'provider-emails');
await officer.waitForSelector(panel, { timeout: 8000 });
await flip(officer, '[data-settings-copy-all]');
await officer.waitForTimeout(300);
state = await switches(officer);
check(state.all === true && Object.values(state.kinds).every(Boolean), 'all on: every row moves with it');
await flip(officer, '[data-settings-copy-all]');
await officer.waitForTimeout(1200);
state = await switches(officer);
check(state.all === false && Object.values(state.kinds).every((v) => !v), 'all off: every row moves with it');
server = await prefs(officer);
check(Object.values(server.cipCopies).every((v) => v === false), 'the server has every kind off');
check(server.notifyProviderCopies === false, 'notifyProviderCopies answers false');
await flip(officer, '[data-settings-copy-all]');
await officer.waitForTimeout(1200);
server = await prefs(officer);
check(Object.values(server.cipCopies).every((v) => v === true), 'and back on at the server');

/* ── an administrator: every switch starts off ─────────────────────── */
step(4, 'Administrator: an untouched page reads off');
const admin = await session(ADMIN);
await openSettings(admin, 'notifications');
check(await rowValue(admin) === 'Off', 'the Notifications row says Off');
await openSettings(admin, 'provider-emails');
await admin.waitForSelector(panel, { timeout: 8000 });
state = await switches(admin);
check(state && Object.values(state.kinds).every((v) => !v), 'every switch is off');
check(state && state.all === false, 'the all switch is off');
await shot(admin, '3-admin-page');
server = await prefs(admin);
check(Object.values(server.cipCopies).every((v) => v === false), 'the server agrees: every kind off');

step(5, 'Administrator: turning one on saves only that one');
await flip(admin, '[data-settings-copy="granted"]');
await admin.waitForTimeout(1200);
server = await prefs(admin);
check(server.cipCopies.granted === true, 'Approved is on at the server');
check(KINDS.filter((k) => k !== 'granted').every((k) => server.cipCopies[k] === false), 'the rest stay off');
await openSettings(admin, 'notifications');
check(await rowValue(admin) === 'Custom', 'the Notifications row says Custom');

/* ── a client: nothing to see ──────────────────────────────────────── */
step(6, 'Client: no row, no rail entry, and a deep link does not open the page');
const client = await session(CLIENT);
await openSettings(client, 'notifications');
check(await client.locator('[data-settings-action="open-provider-emails"]:visible').count() === 0, 'no Service provider emails row');
check(await client.locator('[data-admin-nav="provider-emails"]').count() === 0, 'no rail entry');
await openSettings(client, 'provider-emails');
check(await client.locator(panel).count() === 0, 'the deep link does not draw the page');
await shot(client, '4-client-deeplink');

/* ── phone width ────────────────────────────────────────────────────── */
step(7, 'Officer on a phone: the page lays out without a sideways scroll');
const phone = await session(OFFICER, { width: 390, height: 844 });
await openSettings(phone, 'notifications');
await shot(phone, '5a-phone-notifications');
await phone.locator('[data-settings-action="open-provider-emails"]:visible').first().click();
await phone.waitForSelector(panel, { timeout: 8000 });
check(true, 'the Notifications row opens the page on a phone');
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, `no sideways scroll (${overflow}px)`);
check(await phone.locator('[data-admin-back]:visible').count() === 1, 'the rail\'s back button is there');
const labels = await phone.locator(`${panel} .tma-dash__settings-notifications-group-label`).allTextContents();
check(labels.join('|') === 'Applications|Post-approval|Appeals|Comments', 'the four group headings show');
await shot(phone, '5-phone-page');
await phone.locator('[data-admin-back]:visible').click();
await phone.waitForTimeout(400);
check(await phone.locator('[data-admin-nav="provider-emails"]:visible').count() === 1, 'back lands on the menu, which lists the page');
await shot(phone, '6-phone-menu');

step(8, 'No page errors');
check(errors.length === 0, errors.length ? errors.join('\n      ') : 'none');

await browser.close();
log(`\n${failures.length ? `${failures.length} FAILED` : 'ALL PASSED'}`);
process.exit(failures.length ? 1 : 0);
