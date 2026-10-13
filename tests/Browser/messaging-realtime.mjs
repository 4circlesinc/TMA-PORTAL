import { chromium } from 'playwright';
import { readFileSync } from 'fs';

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
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const hits = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
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
  // A separate context per user: separate cookies, separate session.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();

  // What the Messages page costs to wire up, and how many sockets it holds.
  const wire = { signOffs: 0, sockets: [] };
  page.on('request', (r) => { if (r.url().includes('/broadcasting/auth')) wire.signOffs += 1; });
  page.on('websocket', (ws) => { wire.sockets.push(ws); });
  wire.open = () => wire.sockets.filter((ws) => !ws.isClosed()).length;

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

  // Counted for the Messages page alone: the page before it had a socket
  // and sign-offs of its own, and leaving it does not always report a close.
  wire.signOffs = 0;
  wire.sockets = [];
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(900, 600);
  await page.waitForTimeout(1500);
  return { context, page, wire };
}

const send = async (page, text) => {
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(text);
  await page.click('[data-messages-composer-send]');
};

/* Poll a page for up to `ms`, never touching it otherwise. */
async function eventually(page, ms, probe) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await probe()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

let a, b;
try {
  step(1, 'Sign both people in');
  a = await session(USER_A);
  b = await session(USER_B);
  check(true, `A = ${USER_A}, B = ${USER_B}`);

  step(2, 'The websocket actually connected');
  const socketState = await a.page.evaluate(() => {
    const rt = window.TMAMessagingRealtime;
    const names = rt ? Object.keys(rt.channels) : [];
    return {
      enabled: !!(rt && rt.connected),
      socketId: rt && rt.socketId,
      channels: names.length,
      subscribed: names.filter((name) => rt.channels[name].subscribed).length,
    };
  });
  check(socketState.enabled, `A's socket is connected (id ${socketState.socketId})`);
  check(socketState.channels > 0, `A subscribed to ${socketState.channels} conversation channels`);
  check(socketState.subscribed === socketState.channels,
    `every channel is confirmed (${socketState.subscribed} of ${socketState.channels})`);
  // Each conversation registers nine listeners, and each of those used to
  // post its own sign-off and send its own subscribe frame.
  check(a.wire.signOffs > 0 && a.wire.signOffs <= socketState.channels,
    `one sign-off per channel (${a.wire.signOffs} for ${socketState.channels})`);

  // The inbox column itself: a flex column whose bar sits at the bottom. A
  // rule added for something inside a bubble once took its class and undid it.
  const column = await a.page.evaluate(() => {
    const all = document.querySelectorAll('.tma-dash__messages-list');
    const el = all[0];
    const foot = el.querySelector('.tma-dash__messages-list-foot').getBoundingClientRect();
    const style = getComputedStyle(el);
    return { count: all.length, display: style.display, direction: style.flexDirection, gap: Math.round(el.getBoundingClientRect().bottom - foot.bottom) };
  });
  check(column.count === 1 && column.display === 'flex' && column.direction === 'column' && column.gap >= 0 && column.gap <= 2,
    `the inbox column is a flex column with its bar at the bottom (${column.display} ${column.direction}, ${column.gap}px)`);

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

  step(5, "A's read receipt raises the Seen line under B's message, live");
  let readTick = false;
  for (let i = 0; i < 30; i++) {
    const count = await b.page.locator('.tma-dash__messages-bubble-receipt').count();
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

  step(9, 'A reply that lands while A is in another conversation is there when A comes back');
  // The thread was read once, so it is shown from memory when reopened. The
  // arrival used to move only its row: the list said there was a reply and
  // the conversation did not have it until the page was reloaded.
  const rowAna = a.page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first();
  // A draft another run left in the box stands in the row where the preview
  // goes, and the row is what the first check reads.
  const box = a.page.locator('[data-messages-composer-input]');
  if ((await box.textContent()).trim()) {
    await box.fill('');
    await a.page.waitForTimeout(900);
  }
  await a.page.locator('.tma-dash__messages-row', { hasText: 'Peer 01' }).first().click();
  await a.page.waitForTimeout(1000);

  const away = 'sent while away ' + Date.now();
  await send(b.page, away);
  const rowMoved = await eventually(a.page, 8000, async () => (await rowAna.textContent()).includes('sent while away'));
  check(rowMoved, "A's chat list shows the reply while A reads someone else");

  await rowAna.click();
  const inThread = await eventually(a.page, 5000,
    async () => (await a.page.textContent('[data-messages-chat-body]')).includes(away));
  check(inThread, 'reopening the conversation shows the reply, with no reload');

  step(10, 'A reconnect leaves one socket, and it still hears');
  // The replaced socket's close used to be taken for the connection dropping
  // and a second socket was opened beside the new one. The server then cut
  // off whichever went unanswered, about once a minute, with its channels.
  await a.page.evaluate(() => window.TMAMessagingRealtime.reconnect());
  await a.page.waitForTimeout(3500);
  const after = await a.page.evaluate(() => {
    const rt = window.TMAMessagingRealtime;
    const names = Object.keys(rt.channels);
    return { connected: rt.connected, channels: names.length, subscribed: names.filter((n) => rt.channels[n].subscribed).length };
  });
  check(a.wire.open() === 1, `the tab holds one socket after reconnecting (${a.wire.open()})`);
  check(after.connected && after.subscribed === after.channels,
    `every channel is back on it (${after.subscribed} of ${after.channels})`);

  const afterwards = 'after the reconnect ' + Date.now();
  await send(b.page, afterwards);
  const heard = await eventually(a.page, 6000,
    async () => (await a.page.textContent('[data-messages-chat-body]')).includes(afterwards));
  check(heard, 'A saw a message sent after the reconnect');

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
