import { chromium } from 'playwright';

// Phase 8 — the rest of real time: typing indicators, presence, and unread
// counts that move without a reload.
//
// Everything here needs two live sessions and a working socket, so it needs
// Reverb up alongside the app server:
//   php artisan reverb:start --host=127.0.0.1 --port=8080
//   REVERB_HOST=127.0.0.1 REVERB_PORT=8080 php artisan serve --port=8899
//
// See README.md for the seed.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';

// A types, B watches — so B has to be the seeded account with *many*
// conversations. Several checks need B sitting in a thread other than the one
// A is typing in, which Ana Ruiz (one conversation) cannot do.
const USER_A = process.env.TMA_EMAIL_B || 'user0@example.com'; // Ana Ruiz
const USER_B = process.env.TMA_EMAIL || 'e2e@example.com';     // Test User
const NAME_A = 'Ana Ruiz';
const NAME_B = 'Test User';

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

// Address conversations by name — sending reorders the list, so an index is
// not a stable handle.
async function openByName(page, name) {
  await page.click(`.tma-dash__messages-row:has(.tma-dash__messages-row-name:text-is("${name}"))`);
  await page.waitForTimeout(600);
}

async function typeInComposer(page, text) {
  const input = page.locator('[data-messages-composer-input]');
  await input.click();
  await input.type(text, { delay: 40 });
}

const headerPresence = (page) =>
  page.locator('.tma-dash__messages-chat-presence').first().innerText().catch(() => '');

const rowPreview = (page, name) =>
  page
    .locator(`.tma-dash__messages-row:has(.tma-dash__messages-row-name:text-is("${name}")) .tma-dash__messages-row-preview`)
    .first()
    .innerText()
    .catch(() => '');

let a, b;
try {
  step(1, 'Sign both people in');
  a = await session(USER_A);
  b = await session(USER_B);
  check(true, `A = ${USER_A}, B = ${USER_B}`);

  step(2, 'Both sockets connected, and each subscribed to its own fan-out channel');
  for (const [label, s] of [['A', a], ['B', b]]) {
    const state = await s.page.evaluate(() => ({
      connected: !!(window.TMAMessagingRealtime && window.TMAMessagingRealtime.connected),
      channels: window.TMAMessagingRealtime ? Object.keys(window.TMAMessagingRealtime.channels) : [],
    }));
    check(state.connected, `${label}: websocket connected`);
    check(
      state.channels.some((c) => c.startsWith('private-messaging.user.')),
      `${label}: subscribed to its own channel (${state.channels.filter((c) => c.startsWith('private-messaging.user.')).join(',') || 'none'})`
    );
  }

  // --------------------------------------------------------------- typing

  step(3, 'A typing shows an indicator in B’s open thread');
  await openByName(a.page, NAME_B);
  await openByName(b.page, NAME_A);

  const presenceBefore = await headerPresence(b.page);
  await typeInComposer(a.page, 'drafting something');
  await b.page.waitForTimeout(1200);

  const presenceDuring = await headerPresence(b.page);
  check(/typing/i.test(presenceDuring), `B’s header reads "${presenceDuring.trim()}"`);
  check(presenceDuring !== presenceBefore, `it replaced the presence line ("${presenceBefore.trim()}")`);

  step(4, 'The indicator does not echo back to the typist');
  const ownPresence = await headerPresence(a.page);
  check(!/typing/i.test(ownPresence), `A’s own header does not say typing ("${ownPresence.trim()}")`);

  step(5, 'Sending retracts it');
  await a.page.keyboard.press('Enter');
  await b.page.waitForTimeout(1200);
  const presenceAfterSend = await headerPresence(b.page);
  check(!/typing/i.test(presenceAfterSend), `B’s header is back to "${presenceAfterSend.trim()}"`);

  step(6, 'A lost stop event expires on its own');
  // Type, then sever the socket so the stop can never arrive. The indicator
  // has to clear on the receiver's own timer or it would stick forever.
  await typeInComposer(a.page, 'about to vanish');
  await b.page.waitForTimeout(1000);
  check(/typing/i.test(await headerPresence(b.page)), 'indicator is showing');

  await a.page.evaluate(() => {
    if (window.TMAMessagingRealtime && window.TMAMessagingRealtime.socket) {
      window.TMAMessagingRealtime.socket.close();
    }
    // Stop the composer announcing again, and block the retraction.
    window.TMAMessagingAPI.typing = () => Promise.resolve();
  });
  await b.page.waitForTimeout(9000);
  const presenceExpired = await headerPresence(b.page);
  check(!/typing/i.test(presenceExpired), `expired without a stop event ("${presenceExpired.trim()}")`);

  // Clear A's composer *server-side* as well. Typing persists a draft, and a
  // draft outlives the run — an earlier version of this script left one
  // behind and the next run failed on a "Draft:" preview it did not expect.
  await a.page.evaluate(async () => {
    const el = document.querySelector('[data-messages-composer-input]');
    if (el) { el.textContent = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await a.page.waitForTimeout(1200);
  await a.page.reload({ waitUntil: 'networkidle' });
  await a.page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.page.waitForTimeout(1500);

  step(7, 'Typing shows in the chat list, not just the open thread');
  // B looks at a *different* conversation, so the indicator has to reach the
  // list row rather than the header.
  await openByName(b.page, 'Ben Carter');
  await openByName(a.page, NAME_B);
  await typeInComposer(a.page, 'over here');
  await b.page.waitForTimeout(1200);

  const listPreview = await rowPreview(b.page, NAME_A);
  check(/typing/i.test(listPreview), `B’s "${NAME_A}" row reads "${listPreview.trim()}"`);

  await a.page.evaluate(() => {
    const el = document.querySelector('[data-messages-composer-input]');
    if (el) { el.textContent = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await b.page.waitForTimeout(1200);

  // ------------------------------------------------------- live unread

  step(8, 'A message lands in a thread B does not have open and moves the badge');
  // B is on "Ben Carter"; A sends to their shared thread.
  const badgeBefore = await b.page.evaluate(() => window.TMAMessages.getInboxUnreadCount({}));

  await typeInComposer(a.page, 'unread ping');
  await a.page.keyboard.press('Enter');
  await b.page.waitForTimeout(2500);

  const badgeAfter = await b.page.evaluate(() => window.TMAMessages.getInboxUnreadCount({}));
  check(badgeAfter > badgeBefore, `unread rose ${badgeBefore} → ${badgeAfter} with no reload`);

  const unreadRow = await b.page
    .locator(`.tma-dash__messages-row:has(.tma-dash__messages-row-name:text-is("${NAME_A}")) .tma-badge`)
    .first().innerText().catch(() => '');
  check(unreadRow.trim() !== '', `the row itself shows a badge ("${unreadRow.trim()}")`);

  const preview = await rowPreview(b.page, NAME_A);
  check(preview.includes('unread ping'), `and its preview updated ("${preview.trim()}")`);

  step(9, 'Opening it clears the badge');
  await openByName(b.page, NAME_A);
  await b.page.waitForTimeout(1500);
  const badgeCleared = await b.page.evaluate(() => window.TMAMessages.getInboxUnreadCount({}));
  check(badgeCleared < badgeAfter, `unread fell back to ${badgeCleared}`);

  // ------------------------------------------------------- presence

  step(10, 'Going offline and coming back both reach B live');
  await openByName(b.page, NAME_A);
  await b.page.waitForTimeout(800);

  const presenceStart = await headerPresence(b.page);
  check(/online/i.test(presenceStart), `B starts by seeing A online ("${presenceStart.trim()}")`);

  // Signing out is a real transition — closing the tab would only let the
  // presence TTL lapse, which is not what is being tested here.
  await a.page.evaluate(async () => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    const token = document.querySelector('meta[name="csrf-token"]');
    const input = document.createElement('input');
    input.name = '_token';
    input.value = token ? token.getAttribute('content') : '';
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  });
  await a.page.waitForTimeout(2500);
  await b.page.waitForTimeout(2500);

  const presenceOffline = await headerPresence(b.page);
  check(
    !/^online$/i.test(presenceOffline.trim()),
    `B sees A go offline on sign-out ("${presenceOffline.trim()}")`
  );

  await a.context.close();
  a = await session(USER_A);
  await b.page.waitForTimeout(3000);

  const presenceBack = await headerPresence(b.page);
  check(/online/i.test(presenceBack), `and back online on sign-in ("${presenceBack.trim()}")`);

  // ----------------------------------------------- personal state sync

  step(11, 'Pinning in one tab reaches the same user’s other tab');
  // B is the account with enough conversations to pin one that is not open.
  const b2 = await b.context.newPage();
  await b2.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await b2.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await b2.waitForTimeout(1500);

  const pinSelector =
    '.tma-dash__messages-row:has(.tma-dash__messages-row-name:text-is("Chloe Diaz"))';

  const pinnedBefore = await b2.locator(`${pinSelector} .tma-dash__messages-row-pin`).count();

  await b.page.click(`${pinSelector}`, { button: 'right' });
  await b.page.waitForTimeout(500);
  await b.page.click('text=/^Pin/', { timeout: 8000 });
  await b2.waitForTimeout(2500);

  const pinnedAfter = await b2.locator(`${pinSelector} .tma-dash__messages-row-pin`).count();
  check(
    pinnedAfter > pinnedBefore,
    `the second tab shows the pin without a reload (${pinnedBefore} → ${pinnedAfter})`
  );

  step(12, 'Scroll stability still holds while all this is arriving');
  // B has the deep-history thread; park it mid-scroll and let A send into a
  // different conversation, which is exactly what fires an inbox update.
  await openByName(b.page, 'Opal Reyes');
  await b.page.waitForTimeout(1000);

  const thread = b.page.locator('[data-messages-chat-body]');
  await thread.evaluate((el) => { el.scrollTop = 400; });
  await b.page.waitForTimeout(300);
  const scrollBefore = await thread.evaluate((el) => el.scrollTop);

  await openByName(a.page, NAME_B);
  await typeInComposer(a.page, 'while you are scrolled up');
  await a.page.keyboard.press('Enter');
  await b.page.waitForTimeout(2500);

  const scrollAfter = await thread.evaluate((el) => el.scrollTop);
  check(
    Math.abs(scrollAfter - scrollBefore) < 8,
    `thread held position through a live inbox update (${scrollBefore} → ${scrollAfter})`
  );
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\n!! ' + err.stack);
} finally {
  await browser.close();
}

log('\n' + '='.repeat(60));
if (failures.length) {
  log(`${failures.length} CHECK(S) FAILED`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('ALL CHECKS PASSED');
