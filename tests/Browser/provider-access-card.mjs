import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * A service provider's Access card.
 *
 * The card lists everyone at the firm who can reach its records, and a firm
 * with a dozen people pushed every card under it off the screen. It shows six
 * now and the rest scroll inside the card. Six rows is a measurement, not a
 * number: a row is as tall as its meta line wraps, so the cap is set to the
 * foot of the sixth row as drawn, and only a browser can say where that is.
 *
 * Pinned here:
 *
 *  - a firm with nine members shows exactly six rows, whole, and the list
 *    scrolls to the other three;
 *  - the card's header carries the count, so the hidden three are announced;
 *  - a repaint keeps the same list element and its scroll position (the
 *    morph drops the inline height on every repaint; it has to come back);
 *  - a narrower window, where rows wrap, still ends on the sixth row;
 *  - a firm with three members has no cap and no scrolling;
 *  - the card offers one notification email or everyone: choosing a member
 *    says so, marks their row, survives a reload, and leaves the select on
 *    what was saved; choosing everyone again clears the mark; the list does
 *    not blink away or lose its place while it saves.
 *
 * The emails themselves are pinned in CompanyNotificationEmailTest; this is
 * the control, which only a browser draws.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an administrator
 * (TMA_STAFF_EMAIL), a provider company with nine members (TMA_COMPANY_MANY,
 * its uid) and one with three (TMA_COMPANY_FEW). It leaves the firms as it
 * found them, with nobody chosen. See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const MANY = process.env.TMA_COMPANY_MANY || 'galaxy';
const FEW = process.env.TMA_COMPANY_FEW || 'orbit';
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

const LIST = '.tma-dash__clients-detail [data-company-members-list]';

async function openCompany(uid) {
  await page.goto(`${BASE}/citizenship-applications/companies/${uid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__clients-detail .tma-dash__clients-card', { timeout: 30000 });
  await page.waitForSelector(`${LIST} .tma-dash__clients-assigned`, { timeout: 30000 });
  await page.mouse.move(1000, 860);
  await page.waitForTimeout(800);
}

/* What the list shows: its box, each row's box, and how far it scrolls. */
const measure = () => page.evaluate((sel) => {
  const list = document.querySelector(sel);
  if (!list) return null;
  const box = list.getBoundingClientRect();
  const rows = [...list.children].map((row) => {
    const r = row.getBoundingClientRect();
    return { top: r.top - box.top, bottom: r.bottom - box.top };
  });

  return {
    height: box.height,
    clientHeight: list.clientHeight,
    scrollHeight: list.scrollHeight,
    scrollTop: list.scrollTop,
    rows,
    whole: rows.filter(r => r.top >= -0.5 && r.bottom <= box.height + 0.5).length,
    cut: rows.filter(r => r.top < box.height - 0.5 && r.bottom > box.height + 0.5).length,
  };
}, LIST);

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

  step(1, 'Nine members: six on show, the rest scroll');
  await openCompany(MANY);
  let m = await measure();
  check(m && m.rows.length === 9, `the list holds all nine members (${m && m.rows.length})`);
  check(m.whole === 6, `six rows are on show, whole (${m.whole})`);
  check(m.cut === 0, `and no row is cut through (${m.cut})`);
  check(Math.abs(m.rows[5].bottom - m.height) <= 1, `the list ends at the foot of the sixth row (${Math.round(m.rows[5].bottom)} of ${Math.round(m.height)}px)`);
  check(m.scrollHeight > m.clientHeight + 40, `the other three are below, by scrolling (${m.scrollHeight} against ${m.clientHeight})`);
  const count = await page.locator('.tma-dash__clients-card:has(> .tma-dash__clients-access-block) .tma-dash__clients-card-count').first().innerText().catch(() => '');
  check(count.trim() === '9', `the card's header says how many there are ("${count.trim()}")`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/provider-access-six.png` });

  step(2, 'Scrolling reaches the last member');
  await page.evaluate((sel) => { const l = document.querySelector(sel); l.scrollTop = l.scrollHeight; }, LIST);
  await page.waitForTimeout(200);
  m = await measure();
  check(m.scrollTop > 0, `the list scrolls (${Math.round(m.scrollTop)}px)`);
  check(m.rows[8].bottom <= m.height + 1, 'and its last row comes into view');
  const lastName = await page.locator(`${LIST} .tma-dash__clients-assigned`).nth(8).locator('.tma-dash__clients-assigned-title').innerText();
  check(lastName.trim().length > 0, `which names a member (${lastName.trim()})`);

  step(3, 'A repaint keeps the list where it was');
  await page.evaluate((sel) => { document.querySelector(sel).__kept = true; }, LIST);
  const before = (await measure()).scrollTop;
  // What a members reload does: one repaint while loading, where the add
  // form above the list goes, and one when the answer lands and it is back.
  const repainted = await page.evaluate(() => {
    const root = document.querySelector('.tma-dash__clients');
    const hub = root && root._clientsController;
    if (!hub) return false;
    hub.state.companyMembersLoading = true;
    hub.render();
    const gone = !root.querySelector('[data-company-member-email]');
    hub.state.companyMembersLoading = false;
    hub.render();

    return gone && !!root.querySelector('[data-company-member-email]');
  });
  check(repainted, 'the card repainted with and without its add form');
  await page.waitForTimeout(200);
  const kept = await page.evaluate((sel) => !!document.querySelector(sel).__kept, LIST);
  m = await measure();
  check(kept, 'the same list element is still there');
  check(Math.abs(m.scrollTop - before) <= 1, `at the same scroll position (${Math.round(m.scrollTop)} against ${Math.round(before)})`);
  check(Math.abs(m.clientHeight - (m.rows[5].bottom - m.rows[0].top)) <= 1, 'and still six rows tall');

  step(4, 'A narrow window wraps the rows and still ends on the sixth');
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(900);
  await page.evaluate((sel) => { const l = document.querySelector(sel); if (l) { l.scrollTop = 0; l.scrollIntoView({ block: 'center' }); } }, LIST);
  await page.waitForTimeout(300);
  m = await measure();
  check(m && m.rows.length === 9, 'the list is still drawn');
  check(m.whole === 6 && m.cut === 0, `six whole rows, none cut (${m.whole} whole, ${m.cut} cut)`);
  check(Math.abs(m.rows[5].bottom - m.height) <= 1, `ending at the foot of the sixth (${Math.round(m.rows[5].bottom)} of ${Math.round(m.height)}px)`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/provider-access-six-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 900 });

  step(5, 'Three members: no cap, nothing to scroll');
  await openCompany(FEW);
  m = await measure();
  check(m && m.rows.length === 3, `the list holds three members (${m && m.rows.length})`);
  check(m.whole === 3 && m.scrollHeight <= m.clientHeight + 1, 'all three on show, and the list does not scroll');
  const style = await page.evaluate((sel) => document.querySelector(sel).style.maxHeight, LIST);
  check(style === '', `no measured height is left on a short list ("${style}")`);

  step(6, 'One notification email, or everyone');
  await openCompany(MANY);
  const NOTIFY = '.tma-dash__clients-detail [data-company-notify-email]';
  const select = page.locator(NOTIFY).first();
  const toast = () => page.locator('.tma-toast-floating-host').filter({ hasText: /Emails go to/ }).last();
  const marked = () => page.locator(`${LIST} .tma-dash__clients-assigned-meta`).filter({ hasText: 'Notification email' });
  const options = await select.locator('option').allInnerTexts();
  check(await select.count() === 1, 'the card has the select');
  check(options[0] === 'Email everyone with access', `which opens on everyone ("${options[0]}")`);
  check(options.length === 10 && options.slice(1).every(o => o.startsWith('Email only ')), `and offers each of the nine addresses (${options.length - 1})`);
  check(await select.inputValue() === '', 'nobody is chosen to begin with');
  check(await marked().count() === 0, 'and no row is marked');
  const aboveList = await page.evaluate(([a, b]) => {
    const s = document.querySelector(a).getBoundingClientRect();
    const l = document.querySelector(b).getBoundingClientRect();
    return s.bottom <= l.top;
  }, [NOTIFY, LIST]);
  check(aboveList, 'it sits above the list, under the add form');

  // Scrolled down first: saving must not put the reader back at the top.
  await page.evaluate((sel) => { const l = document.querySelector(sel); l.scrollTop = 120; l.__kept = true; }, LIST);
  const target = options.findIndex(o => o === 'Email only cara@galaxy.example.com');
  check(target > 0, 'Cara is among them');
  await select.selectOption({ index: target });
  await toast().waitFor({ timeout: 8000 }).catch(() => {});
  const said = (await toast().innerText().catch(() => '')).trim();
  check(/Emails go to cara@galaxy\.example\.com only/.test(said), `the page says where the emails go now ("${said}")`);
  await page.waitForTimeout(400);
  check(await marked().count() === 1, 'exactly one row is marked');
  const markedRow = await marked().first().innerText();
  check(/cara@galaxy\.example\.com/.test(markedRow), `and it is hers (${markedRow.replace(/\s+/g, ' ').trim()})`);
  check(/^Email only cara@/.test(await select.locator('option:checked').innerText()), 'the select shows her address');
  check(!(await select.isDisabled()), 'and can be used again');
  m = await measure();
  const sameList = await page.evaluate((sel) => !!document.querySelector(sel).__kept, LIST);
  check(sameList && Math.abs(m.scrollTop - 120) <= 1, `the list kept its place while it saved (${Math.round(m.scrollTop)}px)`);
  check(m.whole >= 5 && Math.abs(m.clientHeight - (m.rows[5].bottom - m.rows[0].top)) <= 1, 'and is still six rows tall');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/provider-access-notify.png` });

  await openCompany(MANY);
  check(/^Email only cara@/.test(await page.locator(NOTIFY).first().locator('option:checked').innerText()), 'a reload shows the same choice');
  check(await marked().count() === 1, 'and the same row marked');

  // The other firm is untouched by this one's choice.
  await openCompany(FEW);
  check(await page.locator(NOTIFY).first().inputValue() === '', 'the other firm still emails everyone');
  check(await marked().count() === 0, 'with no row marked');

  await openCompany(MANY);
  await page.locator(NOTIFY).first().selectOption({ index: 0 });
  await page.locator('.tma-toast-floating-host').filter({ hasText: 'Emails go to everyone with access' }).last().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  check(await marked().count() === 0, 'choosing everyone again clears the mark');
  check(await page.locator(NOTIFY).first().inputValue() === '', 'and the select is back on everyone');

  check(pageErrors.length === 0, `no script errors (${pageErrors.join(' | ') || 'none'})`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.log(`\n    ✗ threw: ${e.message}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/provider-access-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
