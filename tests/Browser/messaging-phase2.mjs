import { chromium } from 'playwright';

// Phase 2: the emoji picker and message reactions.
//
// The picker used to draw 21 SVG assets, 18 of which were malformed XML
// (unclosed <g> groups) and rendered as broken-image placeholders — the
// "question marks". Emoji are native Unicode text now, which is also what
// makes categories, search and recents possible.
//
// Reactions rendered as pills before this phase but had no backend at all.
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

async function session(email, track) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  if (track) {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      // 422 is expected: step 13 deliberately posts a non-emoji reaction and
      // requires the server to refuse it.
      if (m.type() === 'error' && !/403|404|422|favicon/.test(m.text())) {
        errors.push('console: ' + m.text());
      }
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

let a, b;
try {
  step(1, 'Sign in and open a conversation');
  a = await session(USER_A, true);
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1500);
  check(await a.locator('.tma-dash__messages-bubble').count() > 0, 'thread loaded');

  step(2, 'The emoji dataset is real, and nothing renders as an image');
  const dataset = await a.evaluate(() => {
    const d = window.TMAEmojiData;
    if (!d) return null;
    return {
      groups: d.groups.length,
      total: d.groups.reduce((n, g) => n + g.items.length, 0),
      quick: d.quick.length,
      // Every entry must be a real character, never an empty string or "?"
      malformed: d.groups
        .flatMap((g) => g.items)
        .filter((i) => !i.c || i.c === '?' || i.c.charCodeAt(0) === 0xfffd).length,
      duplicates:
        d.groups.flatMap((g) => g.items.map((i) => i.c)).length -
        new Set(d.groups.flatMap((g) => g.items.map((i) => i.c))).size,
    };
  });
  check(!!dataset, 'emoji dataset is loaded');
  check(dataset?.total > 400, `${dataset?.total} emoji available (was 21)`);
  check(dataset?.groups >= 6, `${dataset?.groups} categories`);
  check(dataset?.malformed === 0, `no malformed or replacement characters (${dataset?.malformed})`);
  check(dataset?.duplicates === 0, `no duplicate entries (${dataset?.duplicates})`);

  step(3, 'The picker opens with categories and no broken images');
  await a.click('[data-messages-composer-emoji]');
  await a.waitForTimeout(700);
  check(await a.locator('[data-messages-emoji-picker]').isVisible(), 'picker opened');
  check(await a.locator('[data-messages-emoji-char]').count() > 20, 'a category of emoji is shown');
  check(
    await a.locator('[data-messages-emoji-picker] img').count() === 0,
    'the picker contains no <img> at all — nothing can break',
  );
  check(await a.locator('[data-messages-emoji-category]').count() >= 6, 'category tabs are present');

  step(4, 'Search finds emoji by name');
  await a.fill('[data-messages-emoji-search]', 'cat');
  await a.waitForTimeout(600);
  const catCount = await a.locator('[data-messages-emoji-char]').count();
  check(catCount > 3 && catCount < 60, `"cat" narrowed to ${catCount} results`);

  await a.fill('[data-messages-emoji-search]', 'zzzznothing');
  await a.waitForTimeout(500);
  check(
    await a.locator('.tma-dash__messages-emoji-empty').count() === 1,
    'a search with no matches says so rather than showing nothing',
  );
  await a.fill('[data-messages-emoji-search]', '');
  await a.waitForTimeout(500);

  step(5, 'Switching category changes the grid');
  const firstGrid = await a.locator('[data-messages-emoji-char]').first().getAttribute('data-messages-emoji-char');
  await a.locator('[data-messages-emoji-category]').nth(2).click();
  await a.waitForTimeout(500);
  const secondGrid = await a.locator('[data-messages-emoji-char]').first().getAttribute('data-messages-emoji-char');
  check(firstGrid !== secondGrid, `category switch changed the grid (${firstGrid} → ${secondGrid})`);

  step(6, 'Inserting an emoji puts it in the composer');
  const chosen = await a.locator('[data-messages-emoji-char]').first().getAttribute('data-messages-emoji-char');
  await a.locator('[data-messages-emoji-char]').first().click();
  await a.waitForTimeout(500);
  const composed = await a.textContent('[data-messages-composer-input]');
  check(composed.includes(chosen), `composer received ${chosen}`);

  step(7, 'A used emoji shows up under Recent');
  await a.evaluate(() => document.body.click());
  await a.waitForTimeout(300);
  await a.click('[data-messages-composer-emoji]');
  await a.waitForTimeout(700);

  // Wait for the tab rather than counting on the spot — the picker re-renders
  // asynchronously after the insert, and a bare count races that.
  const recentTab = await a
    .waitForSelector('[data-messages-emoji-category="recent"]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(recentTab, 'a Recent category appeared after using an emoji');
  await a.locator('[data-messages-emoji-category="recent"]').click();
  await a.waitForTimeout(500);
  const recents = await a.locator('[data-messages-emoji-char]').allTextContents();
  check(recents.includes(chosen), `${chosen} is listed under Recent`);

  step(8, 'Sending an emoji message round-trips through the server');
  await a.evaluate(() => document.body.click());
  await a.waitForTimeout(300);
  const marker = 'emoji probe ' + Date.now();
  await a.click('[data-messages-composer-input]');
  await a.keyboard.type(marker);
  await a.click('[data-messages-composer-send]');
  await a.waitForTimeout(1500);

  const sent = await a.textContent('[data-messages-chat-body]');
  check(sent.includes(chosen), `the inserted emoji ${chosen} survived the send`);
  check(sent.includes(marker), 'the text survived alongside it');

  step(9, 'Reacting to a message');
  const target = a.locator('.tma-dash__messages-bubble-row').last();
  await target.click({ button: 'right' });
  await a.waitForTimeout(600);
  check(
    await a.locator('.tma-dash__messages-quick-reaction').count() > 4,
    'the context menu offers a quick reaction row',
  );

  const reactEmoji = await a
    .locator('[data-messages-quick-emoji]').first().getAttribute('data-messages-quick-emoji');
  await a.locator('[data-messages-quick-emoji]').first().click();
  await a.waitForTimeout(1500);

  check(
    await a.locator('.tma-dash__messages-reaction').count() > 0,
    `reaction ${reactEmoji} appears on the message`,
  );

  step(10, 'The reaction persisted server-side');
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await a.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await a.waitForTimeout(1800);
  check(
    await a.locator('.tma-dash__messages-reaction').count() > 0,
    'reaction survived a full reload',
  );

  step(11, 'Clicking a reaction shows who reacted');
  // Scope to the message this run reacted to — other messages may carry
  // reactions from earlier runs or from the other participant.
  const reactedRow = a.locator('.tma-dash__messages-bubble-row', { has: a.locator('.tma-dash__messages-reaction') }).last();
  await reactedRow.locator('.tma-dash__messages-reaction').first().click();
  await a.waitForTimeout(600);
  check(
    await a.locator('.tma-dash__messages-reaction-details').count() === 1,
    'the who-reacted panel opened',
  );
  const names = await a.textContent('.tma-dash__messages-reaction-details');
  check(/Test User/.test(names), `it names the reactor (${names.trim().slice(0, 40)})`);
  check(
    await a.locator('.tma-dash__messages-reaction-detail.is-mine').count() === 1,
    "the viewer's own reaction is marked as theirs",
  );

  step(12, 'Removing a reaction from that panel');
  const beforeRemoval = await reactedRow.locator('.tma-dash__messages-reaction').count();
  await a.locator('.tma-dash__messages-reaction-detail.is-mine').click();
  await a.waitForTimeout(1500);
  const remaining = await reactedRow.locator('.tma-dash__messages-reaction').count();
  check(remaining < beforeRemoval, `reaction removed from that message (${beforeRemoval} → ${remaining})`);

  const persisted = await a.evaluate(async (base) => {
    const list = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const conv = list.conversations.find((c) => c.name === 'Ana Ruiz');
    const thread = await fetch(base + '/portal/messaging/conversations/' + conv.id + '/messages', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    // Only this viewer's own reactions should have gone.
    return thread.messages.reduce(
      (n, m) => n + (m.reactions || []).filter((r) => r.mine).length, 0
    );
  }, BASE);
  check(persisted === 0, `no reactions of my own remain server-side (${persisted})`);

  step(13, 'Reactions are rejected when they are not emoji');
  const rejected = await a.evaluate(async (base) => {
    const list = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const conv = list.conversations.find((c) => c.name === 'Ana Ruiz');
    const thread = await fetch(base + '/portal/messaging/conversations/' + conv.id + '/messages', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const id = thread.messages[thread.messages.length - 1].id;
    const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    const res = await fetch(base + '/portal/messaging/messages/' + id + '/reactions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
      },
      body: JSON.stringify({ emoji: '<script>alert(1)</script>' }),
    });
    return res.status;
  }, BASE);
  check(rejected === 422, `free text refused as a reaction (${rejected})`);

  await a.screenshot({ path: new URL('./messaging-phase2.png', import.meta.url).pathname });
  log('\nwrote messaging-phase2.png');
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
