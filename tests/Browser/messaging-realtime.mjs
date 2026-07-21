import { chromium } from 'playwright';

// Two people, two browser sessions, one conversation: what one sends must
// appear in the other's open thread with no reload and no polling.
//
// Needs Reverb running alongside the app server:
//   php artisan reverb:start --host=127.0.0.1 --port=8080
//   REVERB_HOST=127.0.0.1 REVERB_PORT=8080 php artisan serve --port=8899
//
// See README.md for the seed.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const USER_A = process.env.TMA_EMAIL || 'e2e@example.com';
const USER_B = process.env.TMA_EMAIL_B || 'user0@example.com'; // Ana Ruiz

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email) {
  // A separate context per user: separate cookies, separate session.
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

let a, b;
try {
  step(1, 'Sign both people in');
  a = await session(USER_A);
  b = await session(USER_B);
  check(true, `A = ${USER_A}, B = ${USER_B}`);

  step(2, 'The websocket actually connected');
  const socketState = await a.page.evaluate(() => ({
    enabled: !!(window.TMAMessagingRealtime && window.TMAMessagingRealtime.connected),
    socketId: window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId,
    channels: window.TMAMessagingRealtime
      ? Object.keys(window.TMAMessagingRealtime.channels).length
      : 0,
  }));
  check(socketState.enabled, `A's socket is connected (id ${socketState.socketId})`);
  check(socketState.channels > 0, `A subscribed to ${socketState.channels} conversation channels`);

  step(3, 'Open the shared conversation on both sides');
  // A opens the conversation with B; B opens the one with A.
  await a.page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.page.waitForTimeout(1200);
  await b.page.locator('.tma-dash__messages-row', { hasText: 'Test User' }).first().click();
  await b.page.waitForTimeout(1200);

  const aBubbles = await a.page.locator('.tma-dash__messages-bubble').count();
  const bBubbles = await b.page.locator('.tma-dash__messages-bubble').count();
  check(aBubbles > 0 && bBubbles > 0, `both threads loaded (A ${aBubbles}, B ${bBubbles})`);

  step(4, 'B sends — A receives it live, with no reload');
  const live = 'realtime probe ' + Date.now();
  await b.page.click('[data-messages-composer-input]');
  await b.page.keyboard.type(live);
  await b.page.click('[data-messages-composer-send]');

  // Wait for it to arrive on A's side without touching A's page at all.
  let arrived = false;
  for (let i = 0; i < 30; i++) {
    const text = await a.page.textContent('[data-messages-chat-body]');
    if (text.includes(live)) { arrived = true; break; }
    await a.page.waitForTimeout(200);
  }
  check(arrived, `A saw B's message within ${arrived ? '<6' : '6+'}s without reloading`);

  step(5, "A's read receipt turns B's tick over, live");
  let readTick = false;
  for (let i = 0; i < 30; i++) {
    const count = await b.page.locator('.tma-dash__messages-bubble-status--read').count();
    if (count > 0) { readTick = true; break; }
    await b.page.waitForTimeout(200);
  }
  check(readTick, "B's message shows as read once A had it open");

  step(6, 'An edit propagates');
  const edited = 'edited live ' + Date.now();
  const lastOwn = b.page.locator('.tma-dash__messages-bubble-row--out').last();
  await lastOwn.hover();
  await b.page.waitForTimeout(200);
  await lastOwn.locator('[data-messages-menu]').first().click({ force: true });
  await b.page.waitForTimeout(400);

  const editItem = b.page.locator('[data-menu-action="edit"]');
  if (await editItem.count()) {
    await editItem.click();
    await b.page.waitForTimeout(400);
    await b.page.click('[data-messages-composer-input]');
    await b.page.keyboard.press('Control+A');
    await b.page.keyboard.press('Backspace');
    await b.page.keyboard.type(edited);
    await b.page.click('[data-messages-composer-send]');

    let editSeen = false;
    for (let i = 0; i < 30; i++) {
      const text = await a.page.textContent('[data-messages-chat-body]');
      if (text.includes(edited)) { editSeen = true; break; }
      await a.page.waitForTimeout(200);
    }
    check(editSeen, 'A saw the edited text live');
  } else {
    check(false, 'edit action offered on own recent message');
  }

  step(7, 'A delete propagates');
  const lastOwnAgain = b.page.locator('.tma-dash__messages-bubble-row--out').last();
  await lastOwnAgain.hover();
  await b.page.waitForTimeout(200);
  await lastOwnAgain.locator('[data-messages-menu]').first().click({ force: true });
  await b.page.waitForTimeout(400);

  const delItem = b.page.locator('[data-menu-action="delete"]');
  if (await delItem.count()) {
    await delItem.click();
    let deleteSeen = false;
    for (let i = 0; i < 30; i++) {
      const text = await a.page.textContent('[data-messages-chat-body]');
      if (text.includes('This message was deleted')) { deleteSeen = true; break; }
      await a.page.waitForTimeout(200);
    }
    check(deleteSeen, 'A saw the message become a deleted placeholder live');
  } else {
    check(false, 'delete action offered on own message');
  }

  step(8, 'A non-member cannot subscribe to the channel');
  // Ask the app to authorise a channel for a conversation B is not in.
  const authStatus = await b.page.evaluate(async (base) => {
    const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const res = await fetch(base + '/broadcasting/auth', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
      },
      body: JSON.stringify({
        socket_id: '123.456',
        channel_name: 'private-conversation.00000000-0000-4000-8000-000000000000',
      }),
    });
    return res.status;
  }, BASE);
  check(authStatus === 403, `channel auth for a foreign conversation refused (${authStatus})`);

  await a.page.screenshot({ path: new URL('./messaging-realtime.png', import.meta.url).pathname });
  log('\nwrote messaging-realtime.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
