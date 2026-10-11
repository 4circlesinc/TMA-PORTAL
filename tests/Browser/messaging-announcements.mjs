import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

// Answering a group message privately, and announcements in a group: posted
// now, or written for later and posted by the scheduler.
//
// What only a browser can check: the menu offers "Reply privately" on
// somebody else's message and takes you to the direct conversation with their
// message already quoted; the quote names the group on both sides and leads
// back to it; the announcement dialog posts, refuses a time that has passed,
// schedules, lists and cancels; and an announcement posted by the scheduler,
// from outside any browser, arrives in two open threads with no reload.
//
// Two live sessions and Reverb, same setup as messaging-realtime.mjs, plus
// TMA_DB so the script can bring a scheduled time forward. See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const USER_A = process.env.TMA_EMAIL || 'e2e@example.com';      // Test User, runs the group
const USER_B = process.env.TMA_EMAIL_B || 'user0@example.com';  // Ana Ruiz
const GROUP = process.env.TMA_GROUP || 'TM Antoine Advisory and Partners';
const DB = process.env.TMA_DB;
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

if (!DB) {
  console.error('Set TMA_DB to the throwaway sqlite path.');
  process.exit(1);
}

function loginCode() {
  const hits = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

/* The scheduler's side of things, run the way cron would run it. */
function artisan(...args) {
  return execFileSync('php', ['artisan', ...args], {
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();

  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  // A fresh browser is a new device: the six digits come from the mail log.
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
  }
  const stay = page.locator('form:has(input[name="stay"][value="yes"]) button[type="submit"]');
  if (await stay.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      stay.first().click(),
    ]);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(900, 600);
  await page.waitForTimeout(1500);
  return page;
}

// By the row's own name, not anything it says: a group's preview names
// whoever spoke last, which is how "Test User" would find the wrong row.
const row = (page, name) => page
  .locator(`.tma-dash__messages-row:has(.tma-dash__messages-row-name-text:text-is("${name}"))`)
  .first();
const thread = (page) => page.textContent('[data-messages-chat-body]');

const send = async (page, text) => {
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(text);
  await page.click('[data-messages-composer-send]');
};

async function eventually(page, ms, probe) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await probe()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/* The message menu of the bubble carrying `text`. */
async function openMenuOn(page, text) {
  const bubble = page.locator('.tma-dash__messages-bubble-row', { hasText: text }).last();
  await bubble.hover();
  await page.waitForTimeout(200);
  await bubble.locator('[data-messages-menu]').first().click({ force: true });
  await page.waitForTimeout(300);
}

async function openAnnouncement(page) {
  await page.click('[data-messages-conversation-menu]');
  await page.click('[data-conv-action="announce"]');
  await page.waitForSelector('.tma-portal-modal [data-messages-announce-body]', { timeout: 5000 });
  // The waiting list is fetched behind the dialog.
  await page.waitForTimeout(700);
}

/* A datetime-local value `minutes` from now, in the browser's own zone. */
const localInput = (page, minutes) => page.evaluate((m) => {
  const d = new Date(Date.now() + m * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}, minutes);

let a, b;
try {
  step(1, 'Sign both people in, and have Ana say something in the group');
  a = await session(USER_A);
  b = await session(USER_B);

  const said = 'I am not able to make it ' + Date.now();
  await row(b, GROUP).click();
  await b.waitForTimeout(1000);
  await send(b, said);

  await row(a, GROUP).click();
  check(await eventually(a, 6000, async () => (await thread(a)).includes(said)), 'A reads it in the group');

  step(2, 'The menu offers a private reply on her message, not on your own');
  const own = 'Noted ' + Date.now();
  await send(a, own);
  await a.waitForTimeout(800);
  await openMenuOn(a, own);
  check((await a.locator('[data-menu-action="reply-private"]').count()) === 0, 'no "Reply privately" on your own message');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(200);

  await openMenuOn(a, said);
  const offer = a.locator('[data-menu-action="reply-private"]');
  check((await offer.count()) === 1 && (await offer.textContent()) === 'Reply privately', '"Reply privately" on hers');

  step(3, 'It opens the conversation with her alone, her message already quoted');
  await offer.click();
  await a.waitForSelector('.tma-dash__messages-reply-preview-label', { timeout: 6000 });
  check((await a.textContent('.tma-dash__messages-reply-preview-label')) === 'Replying privately to Ana Ruiz',
    'the composer says who is being answered, privately');
  check((await a.textContent('.tma-dash__messages-reply-preview-text')).includes('I am not able to make it'),
    'and quotes what she said');
  check(!(await thread(a)).includes(own), 'this is not the group any more');

  const reply = 'Is everything all right? ' + Date.now();
  await send(a, reply);
  const quoteA = a.locator('.tma-dash__messages-bubble-row', { hasText: reply }).last()
    .locator('.tma-dash__messages-bubble-quote-name');
  check(await eventually(a, 5000, async () => (await quoteA.count()) > 0 && (await quoteA.textContent()).includes(GROUP)),
    'the sent quote names the group it came from');

  step(4, 'She reads it the same way, and the group never sees it');
  // B is still in the group: the reply must not be there.
  await b.waitForTimeout(1500);
  check(!(await thread(b)).includes(reply), 'nothing arrived in the group');
  await row(b, 'Test User').click();
  const quoteB = b.locator('.tma-dash__messages-bubble-row', { hasText: reply }).last()
    .locator('.tma-dash__messages-bubble-quote-name');
  check(await eventually(b, 6000, async () => (await quoteB.count()) > 0 && (await quoteB.textContent()) === `Ana Ruiz · ${GROUP}`),
    'her copy carries "Ana Ruiz · group"');

  step(5, 'The quote leads back to the group');
  await a.locator('.tma-dash__messages-bubble-row', { hasText: reply }).last()
    .locator('.tma-dash__messages-bubble-quote').click();
  check(await eventually(a, 6000, async () => {
    const text = await thread(a);
    return text.includes(said) && text.includes(own) && !text.includes(reply);
  }), 'clicking it opens the group at her message');

  step(6, 'An announcement, posted now');
  await openAnnouncement(a);
  const news = 'The office is closed on Friday ' + Date.now();
  await a.fill('[data-messages-announce-body]', news);
  await a.click('[data-messages-announce-save]');
  check(await eventually(a, 5000, async () => (await a.locator('.tma-portal-modal').count()) === 0), 'the dialog closes');

  const marked = (page, text) => page
    .locator('.tma-dash__messages-bubble--announcement', { hasText: text })
    .locator('.tma-dash__messages-bubble-announcement');
  check(await eventually(a, 5000, async () => (await marked(a, news).count()) === 1), 'A sees it marked as an announcement');
  check(await eventually(b, 6000, async () => (await row(b, GROUP).textContent()).includes('Announcement: The office is closed')),
    "B's chat list says it is an announcement, live");
  await row(b, GROUP).click();
  check(await eventually(b, 6000, async () => (await marked(b, news).count()) === 1), 'B sees it marked in the thread');

  const icon = await marked(b, news).locator('.tma-dash__messages-bubble-announcement-icon').evaluate((el) => {
    const style = getComputedStyle(el);
    return { w: style.width, mask: (style.maskImage || style.webkitMaskImage || '').slice(0, 20) };
  });
  check(icon.w === '14px' && icon.mask.startsWith('url("data:image/svg'), `the megaphone is drawn (${icon.w}, ${icon.mask})`);

  step(7, 'A time that has passed is refused, in the dialog');
  await openAnnouncement(a);
  const later = 'Payroll closes at noon ' + Date.now();
  await a.fill('[data-messages-announce-body]', later);
  await a.selectOption('[data-messages-announce-when]', 'later');
  check(await a.isVisible('[data-messages-announce-at]'), 'choosing a set time shows the date and time');
  check((await a.textContent('[data-messages-announce-save]')).trim() === 'Schedule', 'the button says Schedule');

  await a.fill('[data-messages-announce-at]', await localInput(a, -90));
  await a.click('[data-messages-announce-save]');
  check(await eventually(a, 3000, async () =>
    (await a.isVisible('[data-messages-announce-error]'))
      && (await a.textContent('[data-messages-announce-error]')).includes('Choose a time that has not passed')),
  'the dialog says so and stays open');

  step(8, 'Scheduled, it waits in the dialog and not in the thread');
  await a.fill('[data-messages-announce-at]', await localInput(a, 120));
  await a.click('[data-messages-announce-save]');
  check(await eventually(a, 5000, async () => (await a.locator('.tma-portal-modal').count()) === 0), 'the dialog closes');
  check(await eventually(a, 3000, async () => (await a.textContent('[data-messages-toast-text]')).includes('Announcement scheduled for')),
    'a line says when it will go out');
  check(!(await thread(a)).includes(later), 'nothing was posted yet');

  await openAnnouncement(a);
  const waitingRows = a.locator('[data-messages-scheduled]');
  check((await waitingRows.count()) === 1 && (await waitingRows.first().textContent()).includes('Payroll closes at noon'),
    'reopening the dialog lists it under Scheduled');
  await a.keyboard.press('Escape');

  step(9, 'When its time comes the scheduler posts it, and both threads get it with no reload');
  await a.evaluate(() => { window.__sentinel = 'still here'; });
  artisan('tinker', '--execute', 'App\\Models\\ScheduledMessage::query()->update(["send_at" => now()->subMinute()]);');
  const ran = artisan('messaging:send-scheduled');
  check(/Posted 1 scheduled message/.test(ran), `the command posted it (${ran.trim()})`);

  check(await eventually(a, 8000, async () => (await marked(a, later).count()) === 1), "A's open thread shows it, marked");
  check(await eventually(b, 8000, async () => (await marked(b, later).count()) === 1), "B's open thread shows it, marked");
  check((await a.evaluate(() => window.__sentinel)) === 'still here', 'A never reloaded');

  // Posted once: a second pass finds nothing.
  check(/Posted 0 scheduled message/.test(artisan('messaging:send-scheduled')), 'a second pass posts nothing more');

  await openAnnouncement(a);
  check((await a.locator('[data-messages-scheduled]').count()) === 0, 'nothing is left waiting');

  step(10, 'One that is waiting can be cancelled');
  await a.fill('[data-messages-announce-body]', 'Change of plan ' + Date.now());
  await a.selectOption('[data-messages-announce-when]', 'later');
  await a.fill('[data-messages-announce-at]', await localInput(a, 180));
  await a.click('[data-messages-announce-save]');
  await eventually(a, 5000, async () => (await a.locator('.tma-portal-modal').count()) === 0);

  await openAnnouncement(a);
  check((await a.locator('[data-messages-scheduled]').count()) === 1, 'it is listed');
  await a.click('[data-messages-scheduled-cancel]');
  check(await eventually(a, 4000, async () => (await a.locator('[data-messages-scheduled]').count()) === 0), 'Cancel takes it off the list');
  await a.screenshot({ path: new URL('./messaging-announcements.png', import.meta.url).pathname });
  await a.keyboard.press('Escape');

  artisan('tinker', '--execute', 'App\\Models\\ScheduledMessage::query()->update(["send_at" => now()->subMinute()]);');
  check(/Posted 0 scheduled message/.test(artisan('messaging:send-scheduled')), 'and it is never posted');

  log('\nwrote messaging-announcements.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
