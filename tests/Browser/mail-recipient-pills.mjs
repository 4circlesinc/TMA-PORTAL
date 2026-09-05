import { chromium } from 'playwright';

/*
 * Recipient pills on To / Cc / Bcc.
 *
 * Every address in a compose window, a reply-all or a forward is a pill; the
 * input after the pills only holds the address being typed. Enter, Tab, a
 * comma, a paste and leaving the field all turn text into pills; Backspace
 * on an empty input takes the last pill back; the × removes one; a typeahead
 * pick lands as a pill. A plain reply opens the same full composer, with its
 * recipient as an editable pill plus Subject and Cc/Bcc. The draft keeps the
 * "Name <a@b>, c@d" string the send path reads, and half-typed text survives
 * a re-render.
 *
 * See README.md for setup. Needs the seeded thread, a colleague named Dana
 * Reed and a connected mailbox.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';

const failures = [];
const errors = [];
const log = (...a) => console.log(...a);
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// The provider is unreachable from a test: sends are answered here and the
// payload the client built is what gets checked.
const sends = [];
await context.route('**/portal/mail/send', (route) => {
  sends.push(route.request().postDataJSON() || {});
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});
await context.route('**/portal/mail/drafts', (route) => {
  if (route.request().method() !== 'POST') return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: { id: 'd1' } }) });
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

// Pills of the field an input sits in: "email" or "Name <email>" per pill.
const pillsOf = (selector) => page.evaluate((sel) => {
  const input = document.querySelector(sel);
  const field = input && input.closest('[data-email-recipients]');
  return field ? Array.from(field.querySelectorAll('[data-email-recipient]')).map((p) => p.getAttribute('title')) : [];
}, selector);

const TO = '[data-email-compose-field="to"]';
const CC = '[data-email-compose-field="cc"]';

try {
  step(1, 'Sign in and open a new compose window');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-email-folder="compose"]', { timeout: 20000 });
  // The seeded token cannot sync, so the sync toast would sit over the
  // compose window's Send for the whole run.
  await page.addStyleTag({ content: '.tma-sync-toast-host { display: none !important; }' });
  await page.click('[data-email-folder="compose"]');
  await page.waitForSelector(TO, { timeout: 10000 });
  const to = page.locator(TO).first();

  step(2, 'Enter turns a typed address into a pill');
  await to.click();
  await to.type('client@example.com');
  await to.press('Enter');
  await page.waitForTimeout(150);
  check((await pillsOf(TO)).join() === 'client@example.com', `pill added (${(await pillsOf(TO)).join(', ')})`);
  check((await to.inputValue()) === '', 'the input is clear again');

  step(3, 'A typeahead pick lands as a Name <email> pill');
  await to.type('Dana', { delay: 40 });
  await page.waitForSelector('[data-email-suggest-menu]', { timeout: 8000 });
  await page.click('[data-email-suggest-index="0"]');
  await page.waitForTimeout(200);
  let pills = await pillsOf(TO);
  check(pills.length === 2 && /Dana Reed <dana@example\.com>/.test(pills[1]), `pick became a pill (${pills.join(', ')})`);
  check((await to.inputValue()) === '', 'the typed name is gone from the input');
  const label = await page.textContent('[data-email-recipient="dana@example.com"] > span');
  check(label.trim() === 'Dana Reed', `the pill shows the name (${label.trim()})`);

  step(4, 'An address already in the field is not added twice');
  await to.type('dana@example.com');
  await to.press('Enter');
  await page.waitForTimeout(150);
  check((await pillsOf(TO)).length === 2, 'still two pills');

  step(5, 'A pasted list becomes pills, the tail keeps being typed, Tab commits it');
  await to.fill('a@b.test, c@d.test');
  await page.waitForTimeout(150);
  pills = await pillsOf(TO);
  check(pills.length === 3 && pills[2] === 'a@b.test', `the finished address became a pill (${pills.join(', ')})`);
  check((await to.inputValue()) === 'c@d.test', `the tail stays in the input ("${await to.inputValue()}")`);
  await to.press('Tab');
  await page.waitForTimeout(150);
  pills = await pillsOf(TO);
  check(pills.length === 4 && pills[3] === 'c@d.test', 'Tab committed the tail');

  step(6, 'Backspace on an empty input takes the last pill back; × removes one');
  await to.click();
  await to.press('Backspace');
  await page.waitForTimeout(100);
  pills = await pillsOf(TO);
  check(pills.length === 3 && pills[2] === 'a@b.test', `Backspace removed c@d.test (${pills.join(', ')})`);
  await page.click('[data-email-recipient="a@b.test"] [data-email-recipient-remove]');
  await page.waitForTimeout(100);
  pills = await pillsOf(TO);
  check(pills.length === 2, `× removed a@b.test (${pills.join(', ')})`);

  step(7, 'The draft holds the address string the send path reads');
  const draftTo = await page.evaluate(() => document.querySelector('[data-email]')._emailState.composeDrafts[0].to);
  check(draftTo === 'client@example.com, Dana Reed <dana@example.com>', `draft.to = "${draftTo}"`);

  step(8, 'Pills and half-typed text survive a re-render');
  await to.type('half');
  await page.click('[data-email-compose-cc]');
  await page.waitForSelector(CC, { timeout: 5000 });
  await page.waitForTimeout(200);
  check((await pillsOf(TO)).length === 2, 'both pills are still there');
  check((await to.inputValue()) === 'half', `the half-typed text is still there ("${await to.inputValue()}")`);
  await to.fill('');

  step(9, 'A comma commits in Cc');
  const cc = page.locator(CC).first();
  await cc.click();
  await cc.type('cc@x.test,');
  await page.waitForTimeout(150);
  check((await pillsOf(CC)).join() === 'cc@x.test', `Cc pill (${(await pillsOf(CC)).join(', ')})`);
  check((await cc.inputValue()) === '', 'the comma did not stay behind');

  step(10, 'Send takes what is still typed along with the pills');
  await to.click();
  await to.type('last@x.test');
  await page.fill('[data-email-compose-field="subject"]', 'Pills');
  await page.screenshot({ path: 'tests/Browser/mail-recipient-pills.png' });
  await page.click('[data-email-compose-send]');
  await page.waitForTimeout(800);
  const sent = sends[sends.length - 1];
  const sentTo = sent ? sent.to.map((a) => a.email) : [];
  check(!!sent, 'the send request went out');
  check(sentTo.join() === 'client@example.com,dana@example.com,last@x.test', `to = ${sentTo.join(', ')}`);
  check(sent && sent.to[1].name === 'Dana Reed', 'the name travelled with the address');
  check(sent && sent.cc.map((a) => a.email).join() === 'cc@x.test', `cc = ${sent && sent.cc.map((a) => a.email).join(', ')}`);

  step(11, 'A reply uses the full composer with To, Subject, and Cc/Bcc');
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });
  await page.locator('[data-email-row]:not([data-email-row-child]):has-text("Quarterly review")').first()
    .locator('.tma-dash__email-row-content').click();
  await page.waitForSelector('.tma-dash__email-message--expanded', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.click('.tma-dash__email-message--expanded [data-email-inline-compose="reply"]');
  await page.waitForSelector('[data-email-compose-window]', { timeout: 8000 });
  const replyPills = await pillsOf(TO);
  check(replyPills.length === 1 && /@/.test(replyPills[0]), `reply To is one pill (${replyPills.join(', ')})`);
  const replySubject = await page.inputValue('[data-email-compose-field="subject"]');
  check(/^re:/i.test(replySubject), `reply Subject is Re: ("${replySubject}")`);
  check(!!(await page.$('[data-email-compose-cc]')), 'Cc and Bcc can be shown');
  await page.click('[data-email-compose-window] [data-email-compose-close]');
  await page.waitForSelector('[data-email-compose-window]', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(300);

  step(12, 'Reply all carries To and Cc as editable pills, and sends them');
  await page.click('.tma-dash__email-message--expanded [data-email-inline-compose="reply-all"]');
  await page.waitForSelector('[data-email-compose-field="cc"]', { timeout: 8000 });
  const raTo = await pillsOf(TO);
  const raCc = await pillsOf(CC);
  check(raTo.length >= 1, `To pills (${raTo.join(', ')})`);
  check(/sam@example\.com/.test(raCc.join()), `Cc pill carries the thread's Cc (${raCc.join(', ')})`);
  const ito = page.locator(TO).first();
  await ito.click();
  await ito.type('extra@x.test');
  await ito.press('Enter');
  await page.waitForTimeout(150);
  const raTo2 = await pillsOf(TO);
  check(raTo2.length === raTo.length + 1 && raTo2[raTo2.length - 1] === 'extra@x.test', 'an added address became a pill');
  const icState = await page.evaluate(() => {
    const s = document.querySelector('[data-email]')._emailState;
    const d = (s.composeDrafts || []).filter((x) => !x.minimized).pop();
    return d ? { to: d.to, cc: d.cc } : null;
  });
  check(icState && /extra@x\.test/.test(icState.to) && /sam@example\.com/.test(icState.cc),
    `compose draft to/cc updated ("${icState && icState.to}" / "${icState && icState.cc}")`);
  await page.click('[data-email-compose-body]');
  await page.keyboard.type('Thanks all');
  await page.click('[data-email-compose-send]');
  await page.waitForTimeout(800);
  const ra = sends[sends.length - 1];
  check(ra && ra.mode === 'reply-all', 'reply-all send went out');
  check(ra && ra.to.some((a) => a.email === 'extra@x.test'), `to carries the added pill (${ra && ra.to.map((a) => a.email).join(', ')})`);
  check(ra && ra.cc.some((a) => a.email === 'sam@example.com'), `cc carries the pill (${ra && ra.cc.map((a) => a.email).join(', ')})`);

  await page.screenshot({ path: 'tests/Browser/mail-recipient-pills-reply.png' });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
  await page.screenshot({ path: 'tests/Browser/mail-recipient-pills-error.png' }).catch(() => {});
} finally {
  const noise = errors.filter((e) => !/portal\/mail\/(messages|sync|status)|reconnect|401|403|409|500|net::ERR/i.test(e));
  log('\n──────── result ────────');
  if (noise.length) log('console errors:\n  ' + noise.join('\n  '));
  log(`${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s)`);
  failures.forEach((f) => log(`  ✗ ${f}`));
  await browser.close();
  process.exit(failures.length === 0 ? 0 : 1);
}
