import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// @mentions in a group conversation, and the group's own picture.
//
// What only a browser can check: the list opens at the caret as "@" is typed
// and filters as the name is, Enter picks a name instead of sending the
// message, the name lands as text where the "@term" was, the sent bubble
// marks it, and the person addressed sees an "@" beside the unread count
// without reloading. Then the picture: choosing one goes through the crop,
// and the group is drawn as that picture, not as a cluster of its members.
//
// See README.md for the seed. Needs the firm chat's six staff: the e2e
// administrator, Rita Officer, Omar Officer, Bea Admin, Ann, Ann Marie Joseph.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';
const OTHER = process.env.TMA_EMAIL_B || 'rita@example.com';
const GROUP = process.env.TMA_GROUP || 'TM Antoine Advisory and Partners';
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

/*
 * The sign-in code, read out of the mail log. A fresh browser is a new
 * device, and the code is the six digits in the big letter-spaced cell: the
 * postcard's own CSS is full of other six-digit runs.
 */
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

async function session(email, track) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();
  if (track) {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/403|404|422|favicon|WebSocket|ws:\/\//.test(m.text())) errors.push('console: ' + m.text());
    });
  }
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    // Six single-digit boxes feeding one hidden field: typed, not filled.
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
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(600);
  return page;
}

const api = (page, path, options) => page.evaluate(async ([base, path, options]) => {
  const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  const res = await fetch(base + path, {
    method: (options && options.method) || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
    },
    body: options && options.json ? JSON.stringify(options.json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, [BASE, path, options || null]);

const INPUT = '[data-messages-composer-input]';
const MENU = '[data-messages-mention-menu]';

const menu = (page) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el || el.hidden) return null;
  return Array.from(el.querySelectorAll('[data-messages-mention-pick]')).map((b) => ({
    name: b.querySelector('.tma-dash__feed-mention-name').textContent,
    active: b.classList.contains('tma-dash__menu-item--active'),
  }));
}, MENU);

const composed = (page) => page.$eval(INPUT, (el) => el.textContent);
const bubbles = (page) => page.$$eval('.tma-dash__messages-bubble-copy', (els) => els.map((el) => ({
  text: el.textContent,
  marked: Array.from(el.querySelectorAll('.tma-dash__messages-mention')).map((m) => m.textContent),
})));

async function openGroup(page) {
  await page.click(`.tma-dash__messages-row:has-text("${GROUP}")`);
  await page.waitForSelector(INPUT, { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function clearComposer(page) {
  await page.click(INPUT);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
}

let a;
let b;
try {
  step(1, 'Sign in, and open the firm group');
  a = await session(EMAIL, true);
  await openGroup(a);
  // A run that stopped half way leaves its draft behind in the box.
  await clearComposer(a);
  const before = (await bubbles(a)).length;
  check(true, `signed in as ${EMAIL}`);

  step(2, 'Typing "@" opens the list at the message box');
  await a.click(INPUT);
  await a.keyboard.type('Hello @');
  await a.waitForFunction((sel) => { const el = document.querySelector(sel); return el && !el.hidden; }, MENU, { timeout: 5000 }).catch(() => {});
  let list = await menu(a);
  log('    list:', list && list.map((i) => i.name).join(' | '));
  check(!!list && list.length > 1, 'the list is open');
  check(list?.[0]?.name === '@all', '"@all" comes first');
  check(list?.[0]?.active === true, 'and is the one Enter would pick');
  check(!list?.some((i) => i.name === 'Test Admin'), 'the reader is not offered their own name');
  check(await a.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-messages-composer-input')), 'the caret is still in the message box');

  const placed = await a.evaluate(([menuSel, inputSel]) => {
    const m = document.querySelector(menuSel).getBoundingClientRect();
    const i = document.querySelector(inputSel).getBoundingClientRect();
    return { above: m.bottom <= i.top + 1, onScreen: m.top >= 0 && m.left >= 0 && m.width > 150 };
  }, [MENU, INPUT]);
  check(placed.above && placed.onScreen, 'it opens upward, above the box, on screen');
  await a.screenshot({ path: join(HERE, 'messaging-mentions.png') });

  step(3, 'The list follows the name as it is typed');
  await a.keyboard.type('an');
  await a.waitForTimeout(250);
  list = await menu(a);
  log('    list:', list && list.map((i) => i.name).join(' | '));
  check(list?.length === 2 && list.every((i) => /^Ann/.test(i.name)), 'only Ann and Ann Marie Joseph are left');
  check(!list?.some((i) => i.name === '@all'), '"@all" has dropped out: "an" is not the start of it');

  step(4, 'Arrow keys move, and Enter picks the name instead of sending');
  await a.keyboard.press('ArrowDown');
  await a.waitForTimeout(150);
  list = await menu(a);
  check(list?.[1]?.active === true, 'the second name is selected');
  check((await composed(a)) === 'Hello @an', 'the text is untouched while choosing');
  await a.keyboard.press('Enter');
  await a.waitForTimeout(300);
  check((await composed(a)) === 'Hello @Ann Marie Joseph ', `the name replaced "@an" ("${await composed(a)}")`);
  check((await menu(a)) === null, 'the list has closed');
  check((await bubbles(a)).length === before, 'nothing was sent');

  step(5, 'Sending marks the name in the bubble');
  await a.keyboard.type('the figures are in');
  await a.keyboard.press('Enter');
  await a.waitForFunction((n) => document.querySelectorAll('.tma-dash__messages-bubble-copy').length > n, before, { timeout: 8000 });
  await a.waitForTimeout(900);
  let last = (await bubbles(a)).pop();
  check(last.text === 'Hello @Ann Marie Joseph the figures are in', `sent as written ("${last.text}")`);
  check(last.marked.length === 1 && last.marked[0] === '@Ann Marie Joseph', 'the whole name is marked, not just "@Ann"');

  step(6, 'Clicking "@all" addresses everyone');
  await a.click(INPUT);
  await a.keyboard.type('@al');
  await a.waitForTimeout(250);
  list = await menu(a);
  check(list?.[0]?.name === '@all', '"@al" still offers "@all"');
  await a.click(`${MENU} [data-messages-mention-pick="0"]`);
  await a.waitForTimeout(300);
  check((await composed(a)) === '@all ', `it lands as text ("${await composed(a)}")`);
  check(await a.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-messages-composer-input')), 'and the caret stayed in the box');
  await a.keyboard.type('lunch is here');
  await a.keyboard.press('Enter');
  await a.waitForTimeout(1200);
  last = (await bubbles(a)).pop();
  check(last.text === '@all lunch is here' && last.marked[0] === '@all', 'the bubble marks "@all"');

  step(7, 'Escape shuts the list and keeps what was typed');
  await a.click(INPUT);
  await a.keyboard.type('ask @ri');
  await a.waitForTimeout(250);
  check(((await menu(a)) || []).some((i) => i.name === 'Rita Officer'), 'the list offers Rita Officer');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(200);
  check((await menu(a)) === null, 'Escape closes it');
  check((await composed(a)) === 'ask @ri', 'the text is still there');
  await clearComposer(a);

  // Clicking away shuts it too, and still shuts the emoji picker, which
  // shares the handler.
  await a.keyboard.type('@');
  await a.waitForTimeout(250);
  check((await menu(a)) !== null, 'the list is open again for a new "@"');
  // The middle of the thread's left edge: clear of the chat head above it
  // and of the bubbles.
  const away = await a.$eval('[data-messages-chat-body]', (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + 6, y: box.top + box.height / 2 };
  });
  await a.mouse.click(away.x, away.y);
  await a.waitForTimeout(200);
  check((await menu(a)) === null, 'a click elsewhere closes it');
  await a.click('[data-messages-composer-emoji]');
  await a.waitForSelector('[data-messages-emoji-picker]:not([hidden])', { timeout: 5000 }).catch(() => {});
  await a.mouse.click(away.x, away.y);
  await a.waitForTimeout(200);
  check(await a.$eval('[data-messages-emoji-picker]', (el) => el.hidden), 'and still closes the emoji picker');
  await clearComposer(a);

  step(8, 'An address is not a mention, and a name typed by hand is');
  await a.keyboard.type('write to me@');
  await a.waitForTimeout(250);
  check((await menu(a)) === null, 'an "@" inside a word opens nothing');
  await clearComposer(a);
  await a.keyboard.type('@Rita Officer can you call the client');
  await a.waitForTimeout(200);
  check((await menu(a)) === null, 'the list is shut once the name is past its first word');
  await a.keyboard.press('Enter');
  await a.waitForTimeout(1200);
  last = (await bubbles(a)).pop();
  check(last.marked[0] === '@Rita Officer', 'the typed name is marked all the same');

  step(9, 'The person addressed sees "@" beside the unread count');
  b = await session(OTHER, false);
  const row = await b.evaluate((group) => {
    const el = Array.from(document.querySelectorAll('.tma-dash__messages-row')).find((r) => r.textContent.includes(group));
    const meta = el && el.querySelector('.tma-dash__messages-row-meta');
    const mark = meta && meta.querySelector('.tma-dash__messages-row-mention');
    const parts = meta ? Array.from(meta.children).map((c) => c.getBoundingClientRect()) : [];
    return {
      mark: !!mark,
      text: meta ? meta.textContent.replace(/\s+/g, '') : '',
      // Side by side: the mark and the count share a line.
      inline: parts.length === 2 && Math.abs(parts[0].top - parts[1].top) < 4 && parts[0].right <= parts[1].left + 1,
    };
  }, GROUP);
  log('    row meta:', JSON.stringify(row));
  check(row.mark, 'the row carries the "@" mark');
  // Three on a fresh database; more when an earlier run's are still unread.
  check(/^@[3-9]\d*$|^@\d{2,}$/.test(row.text), `with the count of what is unread ("${row.text}")`);
  check(row.inline, 'the two sit side by side');

  const notes = await api(b, '/portal/notifications');
  // Unread only: an earlier run against the same database leaves its own,
  // already read.
  const mine = (notes.body?.items || []).filter((n) => n.type === 'message.mention' && !n.read);
  log('    notifications:', mine.map((n) => n.message).join(' || '));
  check(mine.length === 1, 'one mention notification for the conversation, not one a message');
  check(/mentioned you: @Rita Officer can you call the client/.test(mine[0]?.message || ''), 'it says who mentioned them and what was said');

  step(10, 'Opening the conversation settles it');
  await openGroup(b);
  await b.waitForTimeout(1200);
  const opened = await b.evaluate((group) => {
    const el = Array.from(document.querySelectorAll('.tma-dash__messages-row')).find((r) => r.textContent.includes(group));
    return { mark: !!el.querySelector('.tma-dash__messages-row-mention') };
  }, GROUP);
  check(!opened.mark, 'the "@" mark is gone once it is read');
  const seen = await bubbles(b);
  check(seen.filter((x) => x.marked.length).length >= 3, 'all three mentions are marked in the thread they read');

  step(11, 'Editing a name in marks it for everyone');
  const thread = await api(a, '/portal/messaging/conversations');
  const groupId = thread.body.conversations.find((c) => c.name === GROUP).id;
  const history = await api(a, `/portal/messaging/conversations/${groupId}/messages`);
  const target = history.body.messages.filter((m) => m.direction === 'out').pop();
  const edited = await api(a, `/portal/messaging/messages/${target.id}`, {
    method: 'PATCH', json: { body: '@Rita Officer and @Omar Officer can you call the client' },
  });
  check(edited.status === 200 && edited.body.message.mentions.length === 2, 'the edit names two people');
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.mouse.move(1000, 700);
  await openGroup(a);
  last = (await bubbles(a)).pop();
  check(last.marked.join(',') === '@Rita Officer,@Omar Officer', `both are marked (${last.marked.join(',')})`);

  step(12, 'The group can be given a picture of its own');
  await a.click('[data-messages-open-profile]');
  await a.waitForSelector('.tma-dash__messages-member', { timeout: 10000 });
  // Only a group nobody has given a picture yet can show this; a second run
  // against the same database starts with the first run's picture.
  if (!thread.body.conversations.find((c) => c.id === groupId).photo) {
    check(!!(await a.$('.tma-dash__messages-profile-avatar--group')), 'with none set, the group is its members\' faces');
  }

  const [chooser] = await Promise.all([
    a.waitForEvent('filechooser', { timeout: 5000 }),
    a.click('[data-messages-group-photo]'),
  ]);
  await chooser.setFiles(join(HERE, 'fixtures', 'message-large.png'));
  await a.waitForSelector('.tma-cropper [data-cr-apply]', { timeout: 8000 });
  check(true, 'choosing a picture opens the crop');
  await a.click('.tma-cropper [data-cr-apply]');
  await a.waitForFunction(() => {
    const img = document.querySelector('.tma-dash__messages-profile-avatar img');
    return img && img.naturalWidth > 0;
  }, null, { timeout: 10000 }).catch(() => {});
  await a.mouse.move(1000, 700);
  await a.waitForTimeout(800);

  const picture = await a.evaluate(async (group) => {
    const head = document.querySelector('.tma-dash__messages-profile-avatar');
    const headImg = head && head.querySelector('img');
    const rowEl = Array.from(document.querySelectorAll('.tma-dash__messages-row')).find((r) => r.textContent.includes(group));
    const rowAvatar = rowEl.querySelector('.tma-dash__messages-row-avatar');
    const rowImg = rowAvatar && rowAvatar.querySelector('img');
    const res = headImg ? await fetch(headImg.src, { credentials: 'same-origin' }) : null;
    const blob = res ? await res.blob() : null;
    const bitmap = blob ? await createImageBitmap(blob) : null;
    return {
      headIsPhoto: !!headImg && !head.classList.contains('tma-dash__messages-profile-avatar--group'),
      // clientWidth is the disc inside its ring.
      headFills: headImg ? Math.round(headImg.getBoundingClientRect().width) >= head.clientWidth - 1 : false,
      rowIsPhoto: !!rowImg && !rowAvatar.classList.contains('tma-dash__messages-cluster'),
      rowFills: rowImg ? Math.round(rowImg.getBoundingClientRect().width) >= rowAvatar.clientWidth - 1 : false,
      clusters: rowEl.querySelectorAll('.tma-dash__messages-cluster-face').length,
      type: res && res.headers.get('content-type'),
      bytes: blob && blob.size,
      width: bitmap && bitmap.width,
      height: bitmap && bitmap.height,
    };
  }, GROUP);
  log('    picture:', JSON.stringify(picture));
  check(picture.headIsPhoto && picture.headFills, 'the conversation info shows the picture, whole');
  check(picture.rowIsPhoto && picture.rowFills && picture.clusters === 0, 'the chat list shows it too, in place of the faces');
  check(picture.width === picture.height && picture.width > 0, `it went up square (${picture.width}x${picture.height})`);
  check(picture.bytes > 0 && picture.bytes < 1891343, `and smaller than the 1.9 MB file that was chosen (${picture.bytes} bytes)`);

  await a.click('[data-messages-profile-back]');
  await a.waitForSelector(INPUT, { timeout: 8000 });
  const headPhoto = await a.evaluate(() => {
    const contact = document.querySelector('.tma-dash__messages-chat-head');
    return !!(contact && contact.querySelector('.tma-dash__messages-row-avatar img') && !contact.querySelector('.tma-dash__messages-cluster-face'));
  });
  check(headPhoto, 'and so does the chat head');

  step(13, 'A conversation between two people has no list');
  const people = await api(a, `/portal/messaging/conversations/${groupId}/mentionable`);
  const rita = people.body.people.find((p) => p.name === 'Rita Officer');
  const direct = await api(a, '/portal/messaging/conversations', { method: 'POST', json: { userId: rita.id } });
  const directId = direct.body.conversation.id;
  await api(a, `/portal/messaging/conversations/${directId}/messages`, { method: 'POST', json: { body: 'A word in private' } });
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.mouse.move(1000, 700);
  await a.click('.tma-dash__messages-row:has-text("Rita Officer")');
  await a.waitForSelector(INPUT, { timeout: 10000 });
  await a.click(INPUT);
  await a.keyboard.type('@');
  await a.waitForTimeout(500);
  check((await menu(a)) === null, 'typing "@" there opens nothing');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nconsole / page errors:');
  errors.forEach((e) => log('  ' + e));
  failures.push(errors.length + ' console or page error(s)');
}

log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
