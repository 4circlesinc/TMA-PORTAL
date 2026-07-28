import { chromium } from 'playwright';

// Phase 1 of the Messages rework: delivery state, message action placement,
// the right-click menu, closing a chat, the repositioned inbox toolbar, the
// conversation menu, and conversation swipe/right-click actions.
//
// Delivery is spelled out in words rather than ticks — "Sent", "Delivered",
// and "Seen" on its own line under the bubble.
//
// Two contexts, because the states are only meaningful between two people: a
// message is "delivered" when the *other* client acknowledges it and "seen"
// when they open it.
//
// See README.md for setup. Needs the messaging seed.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const USER_A = process.env.TMA_EMAIL || 'e2e@example.com';
const USER_B = process.env.TMA_EMAIL_B || 'user0@example.com'; // Ana Ruiz

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

const contexts = {};

async function session(email, track) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts[email] = context;
  const page = await context.newPage();
  if (track) {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/403|404|favicon/.test(m.text())) errors.push('console: ' + m.text());
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
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
}

// Delivery state of the newest outgoing message. The states are words now, not
// tick glyphs — "Sent" and "Delivered" inside the bubble, and "Seen" on its own
// line underneath it, outside the bubble.
const lastOutStatus = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tma-dash__messages-bubble-row--out')];
    const row = rows[rows.length - 1];
    if (!row) return null;

    const el = row.querySelector('.tma-dash__messages-bubble-status');
    const receipt = row.querySelector('.tma-dash__messages-bubble-receipt');
    const cls = el ? [...el.classList].find((c) => c.includes('--')) || '' : '';

    return {
      state: receipt ? 'read' : cls.split('--').pop(),
      // The label without the "·" separator the stylesheet adds.
      label: el ? el.textContent.trim() : '',
      receipt: receipt ? receipt.textContent.trim() : '',
      colour: el ? getComputedStyle(el).color : '',
    };
  });

let a, b;
try {
  step(1, 'Sign both people in');
  a = await session(USER_A, true);
  b = await session(USER_B, false);
  check(true, `A = ${USER_A}, B = ${USER_B}`);

  step(2, 'Inbox layout: search on top, compose and settings below the list');
  // The requirement is search at the top and the two actions reachable at the
  // bottom — not where exactly they live. Compose is a floating button and
  // settings sits in the bottom nav bar; both are outside the scrolling list.
  const layout = await a.evaluate(() => {
    const head = document.querySelector('.tma-dash__messages-list-head');
    const body = document.querySelector('[data-messages-list-body]');
    const compose = document.querySelector('[data-messages-compose]');
    const settings = document.querySelector('[data-messages-settings]');
    if (!head || !body) return null;

    const bodyBox = body.getBoundingClientRect();
    const midY = bodyBox.top + bodyBox.height / 2;

    return {
      searchInHead: !!head.querySelector('[data-messages-search]'),
      composeInHead: !!head.querySelector('[data-messages-compose]'),
      composeBelowMiddle: compose ? compose.getBoundingClientRect().top > midY : false,
      settingsBelowMiddle: settings ? settings.getBoundingClientRect().top > midY : false,
      // Neither may scroll away with the conversations.
      composeOutsideList: compose ? !body.contains(compose) : false,
      settingsOutsideList: settings ? !body.contains(settings) : false,
      composeCount: document.querySelectorAll('[data-messages-compose]').length,
      settingsCount: document.querySelectorAll('[data-messages-settings]').length,
    };
  });
  check(layout?.searchInHead, 'search is at the top');
  check(!layout?.composeInHead, 'compose is no longer at the top');
  check(layout?.composeBelowMiddle && layout?.settingsBelowMiddle, 'both sit in the lower half');
  check(
    layout?.composeOutsideList && layout?.settingsOutsideList,
    'neither scrolls away with the conversation list',
  );
  check(layout?.composeCount === 1, `exactly one compose control (${layout?.composeCount})`);
  check(layout?.settingsCount === 1, `exactly one settings control (${layout?.settingsCount})`);

  step(3, 'Both stay reachable when the list is scrolled');
  await a.evaluate(() => {
    const el = document.querySelector('[data-messages-list-body]');
    el.scrollTop = el.scrollHeight;
  });
  await a.waitForTimeout(300);
  check(
    await a.locator('[data-messages-compose]').isVisible(),
    'compose still visible after scrolling the list to the bottom',
  );
  check(
    await a.locator('[data-messages-settings]').isVisible(),
    'settings still visible too',
  );

  step(4, 'Open the shared conversation on both sides');
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1500);
  check(await a.locator('.tma-dash__messages-bubble').count() > 0, "A opened Ana Ruiz's thread");

  step(5, 'Delivery state appears only on the sender\'s own messages, which sit on the right');
  const incomingTicks = await a.locator(
    '.tma-dash__messages-bubble-row--in .tma-dash__messages-bubble-status, ' +
    '.tma-dash__messages-bubble-row--in .tma-dash__messages-bubble-receipt',
  ).count();
  check(incomingTicks === 0, `no delivery state on incoming messages (${incomingTicks} found)`);

  // Side matters as much as the state: your own messages carry it *and*
  // belong on the right. These were inverted once — own messages rendered on
  // the left, which made the ticks look like they were on the recipient's.
  const placement = await a.evaluate(() => {
    const body = document.querySelector('[data-messages-chat-body]').getBoundingClientRect();
    const mid = body.left + body.width / 2;
    const rows = [...document.querySelectorAll('.tma-dash__messages-bubble-row')];
    let mineLeft = 0;
    let theirsRight = 0;
    let mine = 0;
    let theirs = 0;
    rows.forEach((r) => {
      const box = r.getBoundingClientRect();
      const onRight = box.left + box.width / 2 >= mid;
      if (r.classList.contains('tma-dash__messages-bubble-row--out')) {
        mine += 1;
        if (!onRight) mineLeft += 1;
      } else {
        theirs += 1;
        if (onRight) theirsRight += 1;
      }
    });
    return { mine, theirs, mineLeft, theirsRight };
  });
  check(placement.mine > 0 && placement.mineLeft === 0, `all ${placement.mine} of my messages are on the right`);
  check(placement.theirs === 0 || placement.theirsRight === 0, `all ${placement.theirs} incoming messages are on the left`);

  step(6, 'A sends while B is offline → "Sent"');
  // "Elsewhere" has to mean *disconnected*, not merely on another screen: with
  // the websocket up, an open page acknowledges receipt the instant a message
  // arrives, so the sent-only state would never be observable. Closing B's
  // context is the only honest way to hold it.
  await contexts[USER_B].close();
  await a.waitForTimeout(500);

  const probe = 'delivery probe ' + Date.now();
  await a.click('[data-messages-composer-input]');
  await a.keyboard.type(probe);
  await a.click('[data-messages-composer-send]');
  await a.waitForTimeout(2000);

  let status = await lastOutStatus(a);
  check(status?.state === 'sent', `state is "sent" (got ${status?.state})`);
  check(/^·?\s*Sent$/.test(status?.label || ''), `bubble reads "Sent" (got "${status?.label}")`);

  step(7, "B's client comes back and receives it → \"Delivered\"");
  // B signs in again and lands on the list *without* opening the thread:
  // received, not read.
  b = await session(USER_B, false);
  await b.waitForTimeout(2000);

  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(2000);

  status = await lastOutStatus(a);
  check(status?.state === 'delivered', `state is "delivered" (got ${status?.state})`);
  check(/Delivered$/.test(status?.label || ''), `bubble reads "Delivered" (got "${status?.label}")`);

  step(8, 'B opens the conversation → "Seen", under the bubble');
  await b.locator('.tma-dash__messages-row', { hasText: 'Test User' }).first().click();
  await b.waitForTimeout(2500);

  // This script asserts the delivery *state machine*, so it re-reads deliberately
  // rather than waiting on a transport. Live propagation of the same change is
  // covered by messaging-realtime.mjs, which runs against a real Reverb server.
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(2000);

  status = await lastOutStatus(a);
  check(status?.state === 'read', `state became "read" (got ${status?.state})`);
  check(/Seen$/.test(status?.receipt || ''), `receipt reads "Seen" (got "${status?.receipt}")`);
  check(status?.label === '', 'the in-bubble word is gone once it says Seen');

  step(9, 'Seen sits under the bubble and outside it, once');
  const receiptBox = await a.evaluate(() => {
    const rows = [...document.querySelectorAll('.tma-dash__messages-bubble-row--out')];
    const row = rows[rows.length - 1];
    const bubble = row?.querySelector('.tma-dash__messages-bubble');
    const receipt = row?.querySelector('.tma-dash__messages-bubble-receipt');
    if (!bubble || !receipt) return null;
    const b = bubble.getBoundingClientRect();
    const r = receipt.getBoundingClientRect();
    return {
      below: r.top >= b.bottom - 1,
      hasIcon: !!receipt.querySelector('svg'),
      total: document.querySelectorAll('.tma-dash__messages-bubble-receipt').length,
    };
  });
  check(receiptBox?.below, 'the Seen line is below the bubble, not inside it');
  check(receiptBox?.hasIcon, 'the Seen line carries the eye icon');
  // Everything above the newest read message has been read too, so repeating
  // the line on each of them would say one thing many times.
  check(receiptBox?.total === 1, `exactly one Seen line in the thread (${receiptBox?.total})`);

  step(10, 'Message tools sit over the top of the bubble, not below or beside it');
  const bubbleRow = a.locator('.tma-dash__messages-bubble-row--out').last();
  await bubbleRow.hover();
  await a.waitForTimeout(400);
  const geometry = await a.evaluate(() => {
    const rows = [...document.querySelectorAll('.tma-dash__messages-bubble-row--out')];
    const row = rows[rows.length - 1];
    const bubble = row?.querySelector('.tma-dash__messages-bubble');
    const actions = row?.querySelector('.tma-dash__messages-bubble-actions');
    if (!bubble || !actions) return null;
    const b = bubble.getBoundingClientRect();
    const x = actions.getBoundingClientRect();
    return {
      // Pinned over the message's top edge, overlapping it horizontally.
      aboveTop: Math.round(b.top - x.top),
      horizontalOverlap: Math.round(Math.min(b.right, x.right) - Math.max(b.left, x.left)),
      buttons: actions.querySelectorAll('button').length,
    };
  });
  check(geometry?.aboveTop > 0, `tools rise ${geometry?.aboveTop}px above the bubble's top edge`);
  check(
    geometry?.horizontalOverlap > 0,
    `tools sit over the message, overlapping it by ${geometry?.horizontalOverlap}px`,
  );
  check(geometry?.buttons >= 3, `react, reply and more are all present (${geometry?.buttons})`);

  step(11, 'Right-clicking a message opens its menu');
  await bubbleRow.click({ button: 'right' });
  await a.waitForTimeout(600);
  const menuItems = await a.locator('[data-menu-action]').allTextContents();
  check(menuItems.length > 0, `context menu opened with ${menuItems.length} actions`);
  check(menuItems.some((t) => /reply/i.test(t)), 'menu offers Reply');
  check(menuItems.some((t) => /copy/i.test(t)), 'menu offers Copy text');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  check(await a.locator('[data-menu-action]').count() === 0, 'Escape closed the menu');

  step(12, 'The chat three-dot menu is functional');
  await a.click('[data-messages-conversation-menu]');
  await a.waitForTimeout(600);
  const convItems = await a.locator('[data-conv-action]').allTextContents();
  check(convItems.length >= 6, `conversation menu opened with ${convItems.length} actions`);
  for (const want of ['pin', 'mute', 'archive', 'unread', 'export', 'clear']) {
    check(
      await a.locator(`[data-conv-action="${want}"]`).count() === 1,
      `menu offers "${want}"`,
    );
  }
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);

  step(13, 'Right-clicking a conversation row offers the same actions');
  await a.locator('.tma-dash__messages-row').first().click({ button: 'right' });
  await a.waitForTimeout(600);
  check(await a.locator('[data-conv-action]').count() >= 6, 'row right-click opened the conversation menu');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);

  step(14, 'Pin from the menu persists');
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click({ button: 'right' });
  await a.waitForTimeout(500);
  await a.click('[data-conv-action="pin"]');
  await a.waitForTimeout(1500);

  const pinned = await a.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return (r.conversations || []).filter((c) => c.pinned).length;
  }, BASE);
  check(pinned > 0, `pin saved server-side (${pinned} pinned)`);

  step(15, 'Closing the chat keeps the inbox exactly where it was');
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1200);
  await a.evaluate(() => {
    const el = document.querySelector('[data-messages-list-body]');
    el.scrollTop = Math.floor(el.scrollHeight / 2);
  });
  await a.waitForTimeout(300);
  const scrollBefore = await a.evaluate(() => document.querySelector('[data-messages-list-body]').scrollTop);

  await a.click('[data-messages-close]');
  await a.waitForTimeout(1000);

  check(
    await a.locator('.tma-dash__messages-chat--empty').count() === 1,
    'chat column returned to its empty state',
  );
  check(await a.locator('.tma-dash__messages-row').count() > 0, 'the inbox column is still there');
  const scrollAfter = await a.evaluate(() => document.querySelector('[data-messages-list-body]').scrollTop);
  check(
    Math.abs(scrollAfter - scrollBefore) < 8,
    `inbox scroll held at ${Math.round(scrollAfter)}px (was ${Math.round(scrollBefore)}px)`,
  );

  step(16, 'Escape closes the chat too');
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1200);
  check(await a.locator('.tma-dash__messages-chat--empty').count() === 0, 'a conversation is open');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(800);
  check(
    await a.locator('.tma-dash__messages-chat--empty').count() === 1,
    'Escape returned to the empty state',
  );

  step(17, 'Escape does not discard a draft mid-sentence');
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1200);
  await a.click('[data-messages-composer-input]');
  await a.keyboard.type('half-written thought');
  await a.waitForTimeout(400);
  await a.keyboard.press('Escape');
  await a.waitForTimeout(600);
  check(
    await a.locator('.tma-dash__messages-chat--empty').count() === 0,
    'the conversation stayed open while a draft was unsent',
  );

  await a.screenshot({ path: new URL('./messaging-phase1.png', import.meta.url).pathname });
  log('\nwrote messaging-phase1.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
