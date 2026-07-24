import { chromium } from 'playwright';

// Pinning and the Important view: every inbox row grows a pin button in its
// hover action bar (alongside archive / delete, which this also exercises —
// they used to be dead chrome), pinning floats the row to the top of the
// folder and survives a reload (the ordering is the server's, not a client
// trick), and the sidebar gains an Important item that lists important mail
// across folders with an unread badge.
//
// Needs the mailbox fixture (m1/m2/m3 inbox + one sent) with m2 marked
// important; see the README.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

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

// Archiving talks to the provider, whose token is fake here — stub the move
// route so the hover-archive check measures the UI wiring, not a dead token.
// Note the stub leaves the *server's* inbox untouched, so the poll will
// eventually put the row back; the check below reads the immediate effect.
let moveRequests = 0;
await context.route('**/portal/mail/messages/*/move', (route) => {
  moveRequests++;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ message: {}, folders: null }),
  });
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
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

function rowSubjects() {
  return page.$$eval('[data-email-row] .tma-dash__email-row-subject, [data-email-row] .tma-dash__email-row-head + div', (els) =>
    els.map((el) => el.textContent.trim()));
}

async function rowIds() {
  return page.$$eval('[data-email-row]', (els) => els.map((el) => el.getAttribute('data-email-row')));
}

try {
  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  step(2, 'The sidebar has an Important item between Inbox and Sent');
  const folderIds = await page.$$eval('[data-email-folder]', (els) =>
    els.map((el) => el.getAttribute('data-email-folder')));
  const inboxAt = folderIds.indexOf('inbox');
  check(folderIds.includes('important'), `Important is in the folder list (saw: ${folderIds.join(', ')})`);
  check(folderIds[inboxAt + 1] === 'important', 'it sits directly under Inbox');

  const importantBadge = (await page.textContent('[data-email-folder="important"]')).trim();
  check(/1/.test(importantBadge), `Important badges its unread count (saw "${importantBadge}")`);

  step(3, 'Rows carry a pin button in the hover bar, next to archive and delete');
  const ids = await rowIds();
  check(ids.length >= 3, `three inbox rows loaded (${ids.length})`);
  const pinButtons = await page.$$('[data-email-row-hover="pin"]');
  check(pinButtons.length >= ids.length, `each row renders a pin button (${pinButtons.length} for ${ids.length} rows)`);

  step(4, 'Pinning the last row floats it to the top with a visible pin marker');
  const lastId = ids[ids.length - 1];
  await page.hover(`[data-email-row="${lastId}"]`);
  await page.click(`[data-email-row="${lastId}"] [data-email-row-hover="pin"]`);
  await page.waitForTimeout(600);

  const afterPin = await rowIds();
  check(afterPin[0] === lastId, 'the pinned row is now first');
  const marker = await page.$(`[data-email-row="${lastId}"] .tma-dash__email-row-pinned`);
  check(!!marker, 'the row shows the pin marker beside its timestamp');

  const serverRow = await page.evaluate(async (id) => {
    const res = await fetch('/portal/mail/messages?folder=inbox', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return (data.messages || [])[0] || null;
  }, lastId);
  check(!!serverRow && serverRow.id === lastId && serverRow.pinned === true,
    'the server lists it first and pinned — no provider round trip involved');

  step(5, 'The pin survives a reload (ordering is the server\'s)');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });
  const reloaded = await rowIds();
  check(reloaded[0] === lastId, 'the pinned row is still first after a reload');

  step(6, 'Unpinning puts it back among the rest');
  await page.hover(`[data-email-row="${lastId}"]`);
  await page.click(`[data-email-row="${lastId}"] [data-email-row-hover="pin"]`);
  await page.waitForTimeout(600);
  const afterUnpin = await rowIds();
  check(afterUnpin[afterUnpin.length - 1] === lastId, 'the unpinned row returned to its place');

  step(7, 'The Important view lists important mail only');
  await page.click('[data-email-folder="important"]');
  await page.waitForTimeout(800);
  const importantRows = await page.$$eval('[data-email-row]', (els) =>
    els.map((el) => el.textContent));
  check(importantRows.length === 1, `exactly one important message (${importantRows.length})`);
  check((importantRows[0] || '').includes('Invoice #1042'), 'and it is the seeded important one');
  await page.screenshot({ path: 'tests/Browser/mail-pins-important.png' });

  step(8, 'The hover archive button actually archives (it used to be dead)');
  await page.click('[data-email-folder="inbox"]');
  await page.waitForTimeout(1200);
  const beforeArchive = await rowIds();
  const target = beforeArchive[0];
  await page.hover(`[data-email-row="${target}"]`);
  await page.waitForTimeout(400);
  // The hover bar scales in and Playwright's actionability check races the
  // animation; the pin steps already proved the bar appears on hover, so
  // here the click is dispatched on the element — it's the handler under test.
  await page.$eval(
    `[data-email-row="${target}"] [data-email-row-hover="archive"]`,
    (el) => el.click()
  );
  const rowLeft = await page.waitForFunction(
    (id) => !document.querySelector(`[data-email-row="${id}"]`),
    target,
    { timeout: 3000 }
  ).then(() => true).catch(() => false);
  check(rowLeft, 'the archived row left the inbox list');
  check(moveRequests > 0, `the move endpoint was called (${moveRequests})`);

  await page.screenshot({ path: 'tests/Browser/mail-pins-final.png' });
} catch (e) {
  failures.push(`fatal: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/mail-pins-error.png' }).catch(() => {});
}

const relevantErrors = errors.filter((e) =>
  !e.includes('401') && !e.includes('409') && !e.includes('502') && !e.includes('Failed to load resource')
  && !e.includes('realtime disabled') && !e.includes('WebSocket')
);

log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s)`);
failures.forEach((f) => log(`  ✗ ${f}`));
if (relevantErrors.length) {
  log('\nConsole/page errors:');
  relevantErrors.forEach((e) => log(`  ! ${e}`));
}

await browser.close();
process.exit(failures.length === 0 && relevantErrors.length === 0 ? 0 : 1);
