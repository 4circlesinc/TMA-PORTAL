import { chromium } from 'playwright';

// Drives the Messages page against a real server. The page used to be a pure
// mock — a hard-coded THREADS array with a scripted ByeWind conversation — so
// the first thing this pins is that what renders came from the API.
//
// The headline regression it guards is the chat-list scroll: scrolling the
// list down and opening a conversation near the bottom used to snap the list
// back to the top, because every action re-rendered the whole subtree.
//
// See README.md for setup. Needs the messaging seed (two+ users, several
// conversations, one with deep history).
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

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
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

// Read conversations straight from the API the page uses, so persistence
// checks don't depend on how the list happens to render.
const apiConversations = (page) => page.evaluate(async (base) => {
  const r = await fetch(base + '/portal/messaging/conversations', {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  }).then((res) => res.json());
  return r.conversations || [];
}, BASE);

const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|favicon/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'Sign in and open Messages');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(800);

  const rowCount = await page.locator('.tma-dash__messages-row').count();
  check(rowCount > 5, `chat list rendered ${rowCount} conversations`);

  step(2, 'The list is server data, not the old mock');
  const bodyText = await page.textContent('.tma-dash__messages-list-body');
  check(!/ByeWind/.test(bodyText), 'no "ByeWind" — the hard-coded mock thread is gone');
  check(!/Natali Craig|Drew Cano|Koray Okumus/.test(bodyText), 'no other mock names present');

  const fromApi = await apiConversations(page);
  const apiNames = fromApi.map((c) => c.name);
  check(apiNames.length === rowCount, `API returned ${apiNames.length} conversations, list shows ${rowCount}`);
  check(
    apiNames.length > 0 && bodyText.includes(apiNames[0]),
    `first API conversation ("${apiNames[0]}") appears in the list`,
  );

  step(3, 'Chat-list scroll position survives opening a conversation');
  const listBox = await page.evaluate(() => {
    const el = document.querySelector('[data-messages-list-body]');
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  check(
    listBox.scrollHeight > listBox.clientHeight + 40,
    `list overflows (${listBox.scrollHeight}px content in ${listBox.clientHeight}px) so the bug can reproduce`,
  );

  // Scroll near the bottom and open a row that is visible there.
  await page.evaluate(() => {
    const el = document.querySelector('[data-messages-list-body]');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(250);

  const scrollBefore = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop,
  );
  check(scrollBefore > 0, `list scrolled down to ${Math.round(scrollBefore)}px`);

  // Pick the last row, which is only reachable when scrolled down.
  const lastRow = page.locator('.tma-dash__messages-row').last();
  const lastRowName = (await lastRow.textContent()).trim().slice(0, 24);
  await lastRow.click();
  await page.waitForTimeout(900);

  const scrollAfter = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop,
  );
  check(
    Math.abs(scrollAfter - scrollBefore) < 8,
    `list stayed at ${Math.round(scrollAfter)}px after opening "${lastRowName}" (was ${Math.round(scrollBefore)}px)`,
  );

  const activeVisible = await page.locator('.tma-dash__messages-row--active').count();
  check(activeVisible === 1, 'the opened conversation is marked active');

  step(4, 'Messages load for the opened conversation');
  await page.waitForSelector('.tma-dash__messages-bubble', { timeout: 10000 });
  const bubbles = await page.locator('.tma-dash__messages-bubble').count();
  check(bubbles > 0, `thread rendered ${bubbles} messages`);

  step(5, 'Sending a message');
  const unique = 'e2e probe ' + Date.now();
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(unique);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(1200);

  const afterSend = await page.textContent('[data-messages-chat-body]');
  check(afterSend.includes(unique), 'sent message appears in the thread');

  const scrollAfterSend = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop,
  );
  check(
    Math.abs(scrollAfterSend - scrollBefore) < 8,
    `list scroll still ${Math.round(scrollAfterSend)}px after sending`,
  );

  step(6, 'The message persisted (survives a reload)');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Re-open the same conversation and look for the message.
  const reopened = page.locator('.tma-dash__messages-row', { hasText: lastRowName.split('\n')[0] }).first();
  if (await reopened.count()) {
    await reopened.click();
    await page.waitForTimeout(1200);
  }
  const afterReload = await page.textContent('[data-messages-chat-body]');
  check(afterReload.includes(unique), 'message is still there after a full reload — it was written to the server');

  step(7, 'Replying quotes the original');
  const targetBubble = page.locator('.tma-dash__messages-bubble-row').last();
  await targetBubble.hover();
  await page.waitForTimeout(200);
  const replyBtn = targetBubble.locator('[data-messages-reply]');
  if (await replyBtn.count()) {
    await replyBtn.first().click({ force: true });
    await page.waitForTimeout(400);
    const preview = await page.locator('.tma-dash__messages-reply-preview').count();
    check(preview === 1, 'reply preview appears above the composer');

    const replyText = 'e2e reply ' + Date.now();
    await page.click('[data-messages-composer-input]');
    await page.keyboard.type(replyText);
    await page.click('[data-messages-composer-send]');
    await page.waitForTimeout(1200);

    const quotes = await page.locator('.tma-dash__messages-bubble-quote').count();
    check(quotes > 0, 'the sent reply renders a quoted original');
    check(
      (await page.locator('.tma-dash__messages-reply-preview').count()) === 0,
      'reply preview cleared after sending',
    );
  } else {
    check(false, 'reply control found on a message bubble');
  }

  step(8, 'Drafts stay with their own conversation');
  // Address conversations by name, never by position: sending reorders the
  // list, so "the first row" is not a stable way to name one.
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.tma-dash__messages-row')].map((el) =>
      (el.querySelector('.tma-dash__messages-row-name')?.textContent || '').trim(),
    ),
  );
  const draftHome = names[0];
  const draftAway = names.find((n) => n && n !== draftHome);
  const openByName = async (name) => {
    await page.locator('.tma-dash__messages-row', { hasText: name }).first().click();
    await page.waitForTimeout(1100);
  };

  await openByName(draftHome);
  const draftText = 'draft-probe-' + Date.now();
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(draftText);
  await page.waitForTimeout(1000); // let the debounced save run

  await openByName(draftAway);
  const otherComposer = await page.textContent('[data-messages-composer-input]');
  check(
    !otherComposer.includes(draftText),
    `draft for "${draftHome}" did not leak into "${draftAway}"`,
  );

  await openByName(draftHome);
  const restored = await page.textContent('[data-messages-composer-input]');
  check(restored.includes(draftText), `draft restored on returning to "${draftHome}"`);

  step(8.1, 'Drafts survive a reload (they are stored server-side)');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await openByName(draftHome);
  const afterReloadDraft = await page.textContent('[data-messages-composer-input]');
  check(afterReloadDraft.includes(draftText), 'draft came back from the server after a reload');

  // Clear it so re-runs start clean.
  await page.click('[data-messages-composer-input]');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1000);

  step(9, 'Older messages page in');
  // The deep-history conversation is the one seeded with 45 messages.
  const deep = fromApi.find((c) => c.name === 'Opal Reyes');
  if (deep) {
    const deepRow = page.locator('.tma-dash__messages-row', { hasText: 'Opal Reyes' }).first();
    await deepRow.click();
    await page.waitForTimeout(1200);

    const before = await page.locator('.tma-dash__messages-bubble').count();
    const loadMore = page.locator('[data-messages-load-more]');
    check(await loadMore.count() > 0, `"load earlier" offered (${before} of 45 loaded)`);

    if (await loadMore.count()) {
      await loadMore.click();
      await page.waitForTimeout(1500);
      const after = await page.locator('.tma-dash__messages-bubble').count();
      check(after > before, `older messages loaded (${before} → ${after})`);
    }
  } else {
    check(false, 'deep-history conversation present in the seed');
  }

  step(9.5, 'Unread counts are real message counts, not one-per-conversation');
  // The chat list eager-loads only the newest message per conversation for the
  // preview. Counting unread over that collection silently capped every row at
  // 1, so the sidebar badge read "conversations with something new". Any row
  // with 2+ unread is what that bug made impossible.
  const unreadFromApi = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    const rows = (r.conversations || []).filter((c) => !c.archived);
    return { total: rows.reduce((n, c) => n + (c.unread || 0), 0), max: Math.max(0, ...rows.map((c) => c.unread || 0)) };
  }, BASE);

  check(unreadFromApi.max > 1, `at least one conversation reports multiple unread (max ${unreadFromApi.max})`);

  const navBadge = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__nav-item[data-nav="so-messages"] .tma-dash__nav-count');
    return el && !el.hidden ? el.textContent.trim() : '';
  });
  const expected = unreadFromApi.total > 99 ? '99+' : String(unreadFromApi.total);
  check(
    navBadge === expected || unreadFromApi.total === 0,
    `sidebar badge (${navBadge || 'hidden'}) matches the summed unread (${expected})`,
  );

  step(9.6, 'Unread badges use the blue token, not indigo');
  const badgeColour = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__messages-row .tma-badge--number');
    return el ? { cls: el.className, bg: getComputedStyle(el).backgroundColor } : null;
  });
  check(!!badgeColour, 'an unread badge is rendered');
  if (badgeColour) {
    check(/tma-badge--blue/.test(badgeColour.cls), 'badge carries the blue modifier');
    check(
      badgeColour.bg === 'rgb(125, 187, 255)',
      `badge background is --color-blue #7dbbff (got ${badgeColour.bg})`,
    );
  }

  step(10, 'Calling is cleanly unavailable, not silently dead');
  const disabledCalls = await page.locator('.tma-dash__messages-chat-actions button[disabled]').count();
  check(disabledCalls === 2, `voice and video call buttons are disabled (${disabledCalls} found)`);

  step(11, 'Authorization: a conversation you are not in is not readable');
  const forbidden = await page.evaluate(async (base) => {
    const res = await fetch(base + '/portal/messaging/conversations/00000000-0000-4000-8000-000000000000/messages', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return res.status;
  }, BASE);
  check(forbidden === 404, `unknown conversation returns ${forbidden} (not data)`);

  await page.screenshot({ path: new URL('./messaging.png', import.meta.url).pathname, fullPage: false });
  log('\nwrote messaging.png');
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
