import { chromium } from 'playwright';

// The three controls in the chat-list header. All were dead chrome: the
// "search" was a <span> with no input behind it, the compose button had no
// handler, and the gear did nothing.
//
// This covers what each is now expected to do — search filters conversations
// and surfaces people you haven't spoken to, compose opens a real conversation,
// and the gear is the Messages Settings panel (the spec's single settings
// entry point, not a second one).
//
// See README.md for setup. Needs the messaging seed.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|favicon/.test(m.text())) errors.push('console: ' + m.text());
});

const rowCount = () => page.locator('.tma-dash__messages-row').count();

try {
  step(1, 'Sign in and open Messages');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const total = await rowCount();
  check(total > 5, `chat list has ${total} conversations`);

  step(2, 'Search is a real input, and finds a conversation');
  // Phase 6 replaced live row-filtering with a dedicated search mode: the
  // column shows grouped results rather than a narrowed conversation list.
  const field = page.locator('[data-messages-search]');
  check(await field.count() === 1, 'search field exists as an <input>');

  await field.click();
  await page.keyboard.type('Ana');
  await page.waitForTimeout(1800);

  const names = await page.textContent('[data-messages-list-body]');
  check(names.includes('Ana Ruiz'), 'the matching conversation is found');
  check(
    await page.locator('.tma-dash__messages-search-group').count() > 0,
    'results are grouped by kind',
  );

  step(3, 'Typing does not steal focus or reset the caret');
  const focusHeld = await page.evaluate(() =>
    document.activeElement?.hasAttribute('data-messages-search'),
  );
  check(focusHeld, 'search field still has focus after re-render');
  const caret = await page.evaluate(() => document.activeElement?.selectionStart);
  check(caret === 3, `caret stayed at the end (position ${caret})`);

  step(4, 'Exiting search restores the full list');
  await page.click('[data-messages-search-exit]');
  await page.waitForTimeout(900);
  check(await rowCount() === total, `back to ${total} conversations`);

  step(5, 'Search surfaces people with no conversation yet');
  // "Zoe Winters" is seeded deliberately with no conversation — she can only
  // be reached by the People group of the search.
  await page.locator('[data-messages-search]').click();
  await page.keyboard.type('Zoe');
  await page.waitForTimeout(1800);

  const listText = await page.textContent('[data-messages-list-body]');
  check(/People/.test(listText), 'a People group appears');
  check(listText.includes('Zoe Winters'), 'someone with no existing conversation is findable');
  check(
    await page.locator('[data-messages-start]').count() > 0,
    'that person is offered as a startable conversation',
  );

  await page.click('[data-messages-search-exit]');
  await page.waitForTimeout(700);

  step(6, 'The "/" shortcut focuses search');
  await page.click('.tma-dash__messages-chat-body', { position: { x: 10, y: 10 } }).catch(() => {});
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  check(
    await page.evaluate(() => document.activeElement?.hasAttribute('data-messages-search')),
    'pressing / put the cursor in search',
  );
  await page.keyboard.press('Escape');

  step(7, 'The compose button opens a working new-message panel');
  await page.click('[data-messages-compose]');
  await page.waitForTimeout(1200);
  check(await page.locator('[data-messages-panel]').count() === 1, 'new-message panel opened');

  const people = await page.locator('[data-messages-start]').count();
  check(people > 0, `panel listed ${people} people`);

  await page.locator('[data-messages-compose-search]').click();
  await page.keyboard.type('Ben');
  await page.waitForTimeout(1200);
  const narrowed = await page.locator('[data-messages-start]').count();
  check(narrowed > 0 && narrowed < people, `people search narrowed ${people} → ${narrowed}`);

  step(8, 'Picking a person opens that conversation');
  // Scope to real people: the panel's first row is now the "New group" action.
  const chosen = (
    await page.locator('[data-messages-start] .tma-dash__messages-person-name').first().textContent()
  ).trim();
  await page.locator('[data-messages-start]').first().click();
  await page.waitForTimeout(2000);

  check(await page.locator('[data-messages-panel]').count() === 0, 'panel closed after choosing');
  const header = await page.textContent('.tma-dash__messages-chat-head');
  check(header.includes(chosen), `conversation with "${chosen}" is open`);

  // And it is a real conversation — sending into it works.
  const probe = 'toolbar probe ' + Date.now();
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(probe);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(1500);
  check(
    (await page.textContent('[data-messages-chat-body]')).includes(probe),
    'a message sends in the newly opened conversation',
  );

  step(9, 'The gear opens Messages Settings and changes persist');
  await page.click('[data-messages-settings]');
  await page.waitForTimeout(700);
  check(await page.locator('[data-messages-panel]').count() === 1, 'settings panel opened');

  const settingCount = await page.locator('[data-messages-setting]').count();
  check(settingCount >= 8, `panel exposes ${settingCount} settings`);

  // Toggle read receipts off and confirm it round-trips to the server.
  const receipts = page.locator('[data-messages-setting="readReceipts"]');
  const before = await receipts.isChecked();
  await receipts.click();
  await page.waitForTimeout(1200);

  const persisted = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/settings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.settings.readReceipts;
  }, BASE);
  check(persisted === !before, `readReceipts saved server-side (${before} → ${persisted})`);

  // Put it back.
  await receipts.click();
  await page.waitForTimeout(1000);

  step(10, 'Only one settings entry point, and Escape closes the panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(await page.locator('[data-messages-panel]').count() === 0, 'Escape closed the panel');
  check(
    await page.locator('[data-messages-settings]').count() === 1,
    'exactly one settings control in the header',
  );

  await page.screenshot({ path: new URL('./messaging-toolbar.png', import.meta.url).pathname });
  log('\nwrote messaging-toolbar.png');
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
