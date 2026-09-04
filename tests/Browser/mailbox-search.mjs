import { chromium } from 'playwright';

/*
 * The mailbox drawer's search, on a phone.
 *
 * Three things went wrong here at once, and each is pinned:
 *  - the field lost every letter after the first. The popup was rebuilt, input
 *    included, after each debounced search, so the focused field was thrown
 *    away mid-word (and a field focused from a timer is not one the user
 *    tapped, so the phone's keyboard went with it). The input node is held
 *    across a whole word here and must still be the active element with the
 *    full word in it at the end;
 *  - nothing came back. The lookup asked for perPage=8, which is not an inbox
 *    page size, so the validator refused every request. Rows must now show the
 *    seeded subject with an envelope icon, the sender, and an arrival time;
 *  - it read as the site search: the site's recent queries, page-style rows,
 *    a "Search" placeholder. The mail popup must say "Search in mail", offer
 *    none of the site's recent searches, and Enter must filter the list the
 *    way the header's Search in mail field does.
 *
 * The site search shares the popup, so the last step types into it on a
 * desktop viewport and expects the same stable field and an envelope row.
 *
 * See README.md for setup. Needs the mailbox fixture (a connected account
 * with a fake token, and the three inbox messages).
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const OUT = process.env.TMA_SHOT_DIR || 'tests/Browser';

const log = (...a) => console.log(...a);
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

// Noise the harness itself produces: the fixture's OAuth token is fake (409
// reconnect answers, failed sender-photo lookups) and there is no websocket
// server behind the page.
const NOISE = [/409/, /WebSocket|ws:\/\/|wss:\/\//i, /Failed to load resource/, /net::ERR/, /reconnect/i, /reverb|pusher/i];
function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
}
const real = (errors) => errors.filter((t) => !NOISE.some((re) => re.test(t)));

const MOUNT = '[data-email-sidebar-search-mount]';
const INPUT = `${MOUNT} [data-search-input]`;
const ROWS = `${MOUNT} [data-search-result]`;
const LIST_ROWS = '.tma-dash__email-row[data-email-row]';

const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      // The choice is a hidden input plus a plain submit, not a named button.
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

async function openInbox(page) {
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector(LIST_ROWS, { timeout: 15000 });
}

async function openDrawerSearch(page) {
  await page.click('.tma-dash__header-left [data-action="toggle-sidebar"]');
  await page.waitForSelector('.tma-dash__email-sidebar--open', { timeout: 5000 });
  await page.click('[data-email-sidebar-search-toggle]');
  await page.waitForSelector(INPUT, { state: 'visible', timeout: 5000 });
}

/* Types slower than the popup's debounce, so every letter runs a search of
   its own — the exact rhythm that used to throw the field away. */
async function typeAndWait(page, word, rowsSel, expectText) {
  await page.keyboard.type(word, { delay: 170 });
  await page.waitForFunction(
    ({ sel, text }) => Array.from(document.querySelectorAll(sel)).some((b) => b.textContent.includes(text)),
    { sel: rowsSel, text: expectText },
    { timeout: 12000 },
  );
}

function describeRows(page, rowsSel) {
  return page.$$eval(rowsSel, (els) => els.map((el) => {
    const q = (s) => el.querySelector(s);
    return {
      text: el.textContent.trim().replace(/\s+/g, ' '),
      icon: q('img.tma-search-popup__row-icon') ? q('img.tma-search-popup__row-icon').getAttribute('src') : '',
      sub: q('.tma-search-popup__row-subtext') ? q('.tma-search-popup__row-subtext').textContent : '',
      meta: q('.tma-search-popup__row-meta') ? q('.tma-search-popup__row-meta').textContent : '',
      highlight: q('.tma-search-popup__highlight') ? q('.tma-search-popup__highlight').textContent : '',
    };
  }));
}

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await phone.newPage();
const errors = [];
watch(page, errors);

const desktop = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const dpage = await desktop.newPage();
const derrors = [];
watch(dpage, derrors);

try {
  step(1, 'The drawer offers a mail search, not the site one');
  await signIn(page);
  await page.evaluate(() => {
    try {
      localStorage.setItem('tma.search.recent', JSON.stringify([{ type: 'query', label: 'Site only thing' }]));
      localStorage.removeItem('tma.search.mail.recent');
      localStorage.removeItem('tma.search.visited');
    } catch (e) { /* ignore */ }
  });
  await openInbox(page);
  await openDrawerSearch(page);

  const head = ((await page.textContent('[data-email-sidebar-search-toggle]').catch(() => '')) || '').trim();
  check(head === 'Search in mail', `the drawer button says "Search in mail" (got "${head}")`);
  const placeholder = await page.getAttribute(INPUT, 'placeholder');
  check(placeholder === 'Search in mail', `the field's placeholder is "Search in mail" (got "${placeholder}")`);
  check(
    await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT),
    'the field has focus on opening',
  );
  const initialText = await page.textContent(`${MOUNT} [data-search-body]`);
  check(!initialText.includes('Site only thing'), "the site's recent searches are not offered here");

  step(2, 'A whole word can be typed, one letter at a time');
  const input = await page.$(INPUT);
  await typeAndWait(page, 'review', ROWS, 'Quarterly review');
  check(
    await input.evaluate((el) => el.isConnected && el === document.activeElement),
    'the input is the same node and still focused after the word',
  );
  const typed = await input.inputValue();
  check(typed === 'review', `the field holds the whole word (got "${typed}")`);
  await page.screenshot({ path: `${OUT}/mailbox-search.png` });

  step(3, 'Results are the matching emails');
  const rows = await describeRows(page, ROWS);
  const quarterly = rows.find((r) => r.text.includes('Quarterly review'));
  check(!!quarterly, 'the seeded subject is a result');
  check(
    !!rows[0] && rows[0].text.startsWith('Search mail for'),
    `the first row searches the whole mailbox (got "${rows[0] && rows[0].text}")`,
  );
  check(!!quarterly && /EnvelopeSimple/.test(quarterly.icon), 'a mail row wears the envelope icon');
  check(!!quarterly && quarterly.sub.includes('Dana Reed'), 'the sender sits under the subject');
  check(!!quarterly && quarterly.meta.trim().length > 0, 'the arrival time is on the row');
  check(!!quarterly && quarterly.highlight.toLowerCase() === 'review', 'the keyword is lit in the subject');
  check(!rows.some((r) => /Dashboard|Site only thing|Clients/.test(r.text)), 'no site pages among the results');
  check(!rows.some((r) => r.text.includes('Invoice')), 'an email that does not match is not listed');

  step(4, 'Picking a result opens that email');
  await page.click(`${ROWS}:has-text("Quarterly review")`);
  await page.waitForFunction(() => {
    const mount = document.querySelector('[data-email]');
    const st = mount && mount._emailState;
    if (!st || !st.reading) return false;
    const row = st.rows.find((r) => r.subject === 'Quarterly review');
    return !!row && st.selectedId === row.id;
  }, null, { timeout: 10000 });
  check(true, 'the picked message is the one open');
  check(!(await page.$('.tma-dash__email-sidebar--open')), 'the drawer closed behind it');

  step(5, 'Enter filters the list like the header field');
  await openInbox(page);
  await openDrawerSearch(page);
  await typeAndWait(page, 'invoice', ROWS, 'Invoice #1042');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const mount = document.querySelector('[data-email]');
    const st = mount && mount._emailState;
    return !!st && st.search === 'invoice' && !st.loading && !st.listRefreshing && st.rows.length === 1;
  }, null, { timeout: 12000 });
  const subjects = await page.$$eval(LIST_ROWS, (els) => els.map((el) => el.textContent));
  check(
    subjects.length === 1 && subjects[0].includes('Invoice #1042'),
    `only the matching email is listed (${subjects.length} row(s))`,
  );
  check(!(await page.$('.tma-dash__email-sidebar--open')), 'the drawer closed');
  const headerValue = await page.inputValue('[data-email-search]').catch(() => null);
  check(headerValue === 'invoice', `the header field shows the query (got "${headerValue}")`);

  step(6, "Recent searches are the mailbox's own");
  await openDrawerSearch(page);
  const recentText = await page.textContent(`${MOUNT} [data-search-body]`);
  check(recentText.includes('invoice') && recentText.includes('review'), 'the two mail searches are remembered');
  check(!recentText.includes('Site only thing'), "the site's recent searches stay out");
  const siteRecent = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('tma.search.recent') || '[]').map((r) => r.label); } catch (e) { return []; }
  });
  check(siteRecent.length === 1 && siteRecent[0] === 'Site only thing', 'mail searches did not leak into the site list');
  await page.keyboard.press('Escape');
  check(!(await page.$(INPUT)), 'Escape closes the search');

  step(7, 'The site search types the same way and shows mail with the envelope');
  await signIn(dpage);
  await dpage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1500);
  await dpage.click('[data-action="open-search"]');
  const SITE_INPUT = '[data-dash-search-mount] [data-search-input]';
  const SITE_ROWS = '[data-dash-search-mount] [data-search-result]';
  await dpage.waitForSelector(SITE_INPUT, { state: 'visible', timeout: 5000 });
  const dinput = await dpage.$(SITE_INPUT);
  await typeAndWait(dpage, 'review', SITE_ROWS, 'Quarterly review');
  check(
    await dinput.evaluate((el) => el.isConnected && el === document.activeElement),
    'the site field is the same node and still focused',
  );
  check((await dinput.inputValue()) === 'review', 'the site field holds the whole word');
  const siteRows = await describeRows(dpage, SITE_ROWS);
  const siteHit = siteRows.find((r) => r.text.includes('Quarterly review'));
  check(!!siteHit && /EnvelopeSimple/.test(siteHit.icon), 'the mail hit wears the envelope in the site search too');
  check(!!siteHit && siteHit.sub.includes('Dana Reed'), 'and carries its sender');

  step(8, 'No page errors');
  const bad = real(errors).concat(real(derrors));
  check(bad.length === 0, bad.length ? 'console: ' + bad.join(' | ') : 'clean console');
} catch (e) {
  failures.push('threw: ' + e.message);
  log(e.stack);
  await page.screenshot({ path: `${OUT}/mailbox-search-error.png` }).catch(() => {});
}

await browser.close();

if (failures.length) {
  log('\nFAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
log('\nAll checks passed.');
