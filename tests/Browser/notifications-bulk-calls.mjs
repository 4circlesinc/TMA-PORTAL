/*
 * Browser check for this change:
 *   1. Overview → Notifications: no count badge on the filter, a live header
 *      count, and working bulk selection (read / unread / delete).
 *   2. Messages → Calls: person rows with avatars, direction arrows and call
 *      buttons that actually place a call.
 *   3. A message from another user arrives as a notification whose link opens
 *      that conversation.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const failures = [];
const errors = [];
const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|favicon/i;

function step(n, m) { console.log(`\n[${n}] ${m}`); }
function check(ok, m) { console.log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  // Fresh sessions land on the stay-signed-in prompt before the portal.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[name="stay"][value="yes"]'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

await signIn(page, 'e2e@example.com');
console.log('logged in ->', page.url());

// ── 1. Overview → Notifications ────────────────────────────────────
step(1, 'Overview → Notifications');
await page.goto(`${BASE}/overview?tab=notifications`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__notifpage-row', { timeout: 15000 });

const head = await page.evaluate(() => ({
  count: document.querySelector('[data-notifpage-count]')?.textContent.trim(),
  filterBadge: !!document.querySelector('[data-notifpage-unread] .tma-dash__actlog-filter-count'),
  rows: document.querySelectorAll('.tma-dash__notifpage-row').length,
  checks: document.querySelectorAll('[data-notifpage-check]').length,
  selectAll: !!document.querySelector('[data-notifpage-selectall]'),
  bulkHidden: document.querySelector('[data-notifpage-bulkbar]')?.hidden,
}));
check(!head.filterBadge, 'no count badge on the filter button');
check(head.count === '5 unread', `header count reads the unread total (got "${head.count}")`);
check(head.rows === 5 && head.checks === 5, 'every row has a checkbox');
check(head.selectAll, 'select-all checkbox in the toolbar');
check(head.bulkHidden === true, 'bulk actions hidden until something is picked');

// pick two, mark them read
await page.click('.tma-dash__notifpage-row:nth-child(1) [data-notifpage-check]');
await page.click('.tma-dash__notifpage-row:nth-child(2) [data-notifpage-check]');
const picked = await page.evaluate(() => ({
  label: document.querySelector('[data-notifpage-selection]')?.textContent.trim(),
  hidden: document.querySelector('[data-notifpage-bulkbar]')?.hidden,
  indeterminate: document.querySelector('[data-notifpage-selectall]')?.indeterminate,
}));
check(picked.hidden === false && picked.label === '2 Selected', `bulk bar shows "${picked.label}"`);
check(picked.indeterminate === true, 'select-all goes indeterminate on a partial pick');

await page.click('[data-notifpage-bulk="read"]');
await page.waitForTimeout(900);
const afterRead = await page.evaluate(() => ({
  count: document.querySelector('[data-notifpage-count]')?.textContent.trim(),
  unreadRows: document.querySelectorAll('.tma-dash__header-popup-item--unread').length,
  hidden: document.querySelector('[data-notifpage-bulkbar]')?.hidden,
}));
check(afterRead.count === '3 unread', `count drops after a bulk read (got "${afterRead.count}")`);
check(afterRead.unreadRows === 3, 'two rows lost their unread state');
check(afterRead.hidden === true, 'selection clears once the action runs');

// select all, mark unread, then delete two
await page.click('[data-notifpage-selectall]');
await page.click('[data-notifpage-bulk="unread"]');
await page.waitForTimeout(900);
const afterUnread = await page.evaluate(() => document.querySelector('[data-notifpage-count]')?.textContent.trim());
check(afterUnread === '5 unread', `bulk unread restores the count (got "${afterUnread}")`);

await page.click('.tma-dash__notifpage-row:nth-child(1) [data-notifpage-check]');
await page.click('[data-notifpage-bulk="delete"]');
await page.waitForTimeout(900);
const afterDelete = await page.evaluate(() => ({
  rows: document.querySelectorAll('.tma-dash__notifpage-row').length,
  count: document.querySelector('[data-notifpage-count]')?.textContent.trim(),
}));
check(afterDelete.rows === 4, 'bulk delete removes the row');
check(afterDelete.count === '4 unread', `count follows the delete (got "${afterDelete.count}")`);

// the count survives a fresh load — it is the server's number, not a local tally
await page.goto(`${BASE}/overview?tab=notifications`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__notifpage-row', { timeout: 15000 });
const reloaded = await page.evaluate(() => document.querySelector('[data-notifpage-count]')?.textContent.trim());
check(reloaded === '4 unread', `count survives a reload (got "${reloaded}")`);

// ── 2. Messages → Calls ────────────────────────────────────────────
step(2, 'Messages → Calls');
await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-messages-nav-calls]', { timeout: 15000 });
await page.click('[data-messages-nav-calls]');
await page.waitForSelector('.tma-dash__call-row', { timeout: 15000 });

const calls = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tma-dash__call-row')];
  return {
    n: rows.length,
    oldIcon: document.querySelectorAll('.tma-dash__call-icon').length,
    avatars: rows.filter((r) => r.querySelector('.tma-dash__messages-row-avatar')).length,
    dirs: rows.map((r) => r.querySelector('.tma-dash__call-dir')?.className || ''),
    metas: rows.map((r) => r.querySelector('.tma-dash__messages-person-meta')?.textContent.trim()),
    audioBtns: document.querySelectorAll('[data-calls-start][data-calls-media="audio"]').length,
    videoBtns: document.querySelectorAll('[data-calls-start][data-calls-media="video"]').length,
    dirColour: getComputedStyle(rows[1].querySelector('.tma-dash__call-dir')).backgroundColor,
    dirMask: getComputedStyle(rows[1].querySelector('.tma-dash__call-dir')).webkitMaskImage
      || getComputedStyle(rows[1].querySelector('.tma-dash__call-dir')).maskImage,
  };
});
check(calls.n === 3, `three call rows (got ${calls.n})`);
check(calls.oldIcon === 0, 'the old naked phone glyph is gone');
check(calls.avatars === 3, 'every call row leads with the person, like the chat list');
check(calls.metas.some((m) => /Missed/.test(m)) && calls.metas.some((m) => /No answer/.test(m)),
  `outcomes read as words (${calls.metas.join(' | ')})`);
check(/--in-missed/.test(calls.dirs[1]), 'a missed incoming call gets the incoming arrow');
check(calls.dirColour === 'rgb(192, 57, 43)', `missed arrow is red (got ${calls.dirColour})`);
check(/ArrowDownLeft/.test(calls.dirMask), `the arrow mask actually resolves (got ${calls.dirMask})`);
check(calls.audioBtns === 3 && calls.videoBtns === 3, 'each row can start a voice or video call');

// the call button places a call rather than opening the chat
await page.evaluate(() => {
  window.__calls = [];
  window.TMAMessagingCalls.start = (id, media, name) => window.__calls.push({ id, media, name });
});
await page.click('.tma-dash__call-row:nth-child(1) [data-calls-media="video"]');
await page.waitForTimeout(300);
const placed = await page.evaluate(() => ({
  calls: window.__calls,
  stillOnLog: !!document.querySelector('.tma-dash__call-row'),
}));
check(placed.calls.length === 1 && placed.calls[0].media === 'video',
  `the video button places a video call (${JSON.stringify(placed.calls)})`);
check(placed.calls[0].name === 'Tom Ashley', 'the call is addressed to the person in the row');
check(placed.stillOnLog, 'calling does not navigate away from the log');

// the row itself still opens the conversation
await page.click('.tma-dash__call-row:nth-child(1) [data-calls-open]');
await page.waitForTimeout(1200);
const opened = await page.evaluate(() => ({
  onChats: !!document.querySelector('.tma-dash__messages-row'),
  header: document.querySelector('.tma-dash__messages-chat-name')?.textContent.trim()
    || document.querySelector('.tma-dash__messages-chat-header')?.textContent.trim(),
}));
check(opened.onChats, 'opening a call row returns the column to the chat list');
check(/Tom/.test(opened.header || ''), `the conversation opened (header: "${opened.header}")`);

// ── 3. A message from someone else becomes a notification ──────────
step(3, 'an incoming message reaches the bell');
// The recipient has to be *away* from the thread: someone reading the
// conversation is not someone who needs telling about it, and the page marks
// it read on their behalf.
await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const tomPage = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await signIn(tomPage, 'tom@example.com');
await tomPage.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
await tomPage.waitForSelector('[data-messages-row]', { timeout: 15000 });
await tomPage.click('[data-messages-row]');
await tomPage.waitForTimeout(1200);
await tomPage.click('[contenteditable="true"]');
await tomPage.keyboard.type('Filed this morning, all done.');
await tomPage.keyboard.press('Enter');
await tomPage.waitForTimeout(1500);

await page.goto(`${BASE}/overview?tab=notifications`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__notifpage-row', { timeout: 15000 });
const arrived = await page.evaluate(() => {
  const first = document.querySelector('.tma-dash__notifpage-row .tma-dash__header-popup-item');
  return {
    title: first?.querySelector('.tma-dash__header-popup-title')?.textContent.trim(),
    desc: first?.querySelector('.tma-dash__header-popup-desc')?.textContent.trim(),
    url: first?.getAttribute('data-action-url'),
    unread: first?.className.includes('--unread'),
    count: document.querySelector('[data-notifpage-count]')?.textContent.trim(),
  };
});
check(arrived.title === 'Tom Ashley', `the message notification is from the sender (got "${arrived.title}")`);
check(arrived.desc === 'Filed this morning, all done.', `it previews the message (got "${arrived.desc}")`);
check(/^\/social\/messages\?conversation=/.test(arrived.url || ''), `it points at the conversation (${arrived.url})`);
check(arrived.unread === true, 'it arrives unread');
check(arrived.count === '5 unread', `the header count includes it (got "${arrived.count}")`);

// clicking it opens that conversation in place
await page.click('.tma-dash__notifpage-row:nth-child(1) .tma-dash__header-popup-item');
await page.waitForTimeout(2000);
const landed = await page.evaluate(() => ({
  view: document.querySelector('.tma-dash__view:not([hidden])')?.getAttribute('data-view'),
  header: document.querySelector('.tma-dash__messages-chat-name')?.textContent.trim(),
  lastBubble: [...document.querySelectorAll('.tma-dash__messages-bubble-copy')].pop()?.textContent.trim(),
}));
check(landed.view === 'messages', `the notification opened Messages (view: ${landed.view})`);
check(/Tom/.test(landed.header || ''), `on the right conversation (header: "${landed.header}")`);
check(/Filed this morning/.test(landed.lastBubble || ''), `showing the message it was about (${landed.lastBubble})`);

// reading the thread settles its notification
await page.waitForTimeout(1500);
const settled = await page.evaluate(async () => {
  const r = await fetch('/portal/notifications/count', { headers: { Accept: 'application/json' } });
  return (await r.json()).unread;
});
check(settled === 4, `opening the conversation cleared its notification (unread now ${settled})`);

// ── report ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
if (errors.length) { console.log('JS errors:'); errors.forEach((e) => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILED (${failures.length}):`); failures.forEach((f) => console.log('  ✗ ' + f)); }
else console.log('all checks passed');
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
