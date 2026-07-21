import { chromium } from 'playwright';

/*
 * The reading pane as a conversation.
 *
 * The pane used to render only the message that was clicked — a reply arrived
 * with none of the thread it belonged to, and the quoted history it carried
 * was dumped inline underneath it. This drives the real page: opening a
 * message must show every message in the conversation as its own card, older
 * ones collapsed, and the quoted history hidden behind a toggle that still
 * reveals it.
 *
 * It also pins the compose window opening blank, which it did not: every new
 * message arrived pre-filled with a stand-in invoice nobody had asked for.
 *
 * See README.md for setup. Needs the seeded three-message thread.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';

const failures = [];
const errors = [];
const log = (...a) => console.log(...a);

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  const emailBtn = page.locator('text=Sign in with Email');
  if (await emailBtn.count()) await emailBtn.first().click();
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

step(1, 'Sign in and open the mailbox');
await signIn();
await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-email-row]', { timeout: 15000 });
check(true, 'inbox rendered');

step(2, 'Open the conversation');
await page.locator('[data-email-row]').first().click();
await page.waitForSelector('[data-email-thread]', { timeout: 15000 });

const cards = await page.locator('[data-email-thread-message]').count();
check(cards === 3, `all three messages render as cards (got ${cards})`);

const collapsed = await page.locator('.tma-dash__email-message--collapsed').count();
check(collapsed >= 1, `older messages start collapsed (got ${collapsed})`);

const expanded = await page.locator('.tma-dash__email-message--expanded').count();
check(expanded >= 1, `the newest message starts expanded (got ${expanded})`);

step(3, 'Every message is identified by sender and time');
const names = await page.locator(
  '.tma-dash__email-message-collapsed-name, .tma-dash__email-message-head-name'
).allTextContents();
check(names.some((n) => n.includes('Dana')), 'sender names shown per message');

const dates = await page.locator(
  '.tma-dash__email-message-collapsed-date, .tma-dash__email-detail-date'
).count();
check(dates >= 3, `each message shows its own date (got ${dates})`);

step(4, 'Expanding a collapsed message reveals its body');
await page.locator('[data-email-thread-expand]').first().click();
await page.waitForTimeout(600);
const expandedAfter = await page.locator('.tma-dash__email-message--expanded').count();
check(expandedAfter > expanded, `expanding opens the message (${expanded} -> ${expandedAfter})`);

step(5, 'Quoted history is collapsed but still reachable');
// The middle message carries an Outlook reply header plus a blockquote.
await page.locator('[data-email-thread-toggle-all="expand"]').click().catch(() => {});
await page.waitForTimeout(800);

const quoteToggle = page.locator('[data-email-thread-quote]');
const hasQuoteToggle = await quoteToggle.count();
check(hasQuoteToggle >= 1, `quoted history is hidden behind a toggle (got ${hasQuoteToggle})`);

if (hasQuoteToggle) {
  const frameBefore = await page.locator('[data-email-body-frame]').first().getAttribute('srcdoc');
  check(
    !String(frameBefore).includes('Original message text here'),
    'quoted text is not rendered until asked for'
  );

  await quoteToggle.first().click();
  await page.waitForTimeout(500);

  const revealed = await page.locator('[data-email-body-frame]').evaluateAll(
    (frames) => frames.map((f) => f.getAttribute('srcdoc') || '').join('')
  );
  check(
    revealed.includes('Original message text here'),
    'the full quoted history is still available on request'
  );
}

step(6, 'A new compose window starts empty');
await page.locator('[data-email-folder="compose"]').first().click();
await page.waitForSelector('[data-email-compose-body]', { timeout: 8000 });

const subject = await page.locator('[data-email-compose-field="subject"]').first().inputValue();
const to = await page.locator('[data-email-compose-field="to"]').first().inputValue();
const bodyText = (await page.locator('[data-email-compose-body]').first().innerText()).trim();

check(subject === '', `subject starts empty (got "${subject}")`);
check(to === '', `To starts empty (got "${to}")`);
check(
  !/invoice/i.test(bodyText),
  `body carries no stand-in invoice (got "${bodyText.slice(0, 60)}")`
);

step(7, 'Compose formatting tools act on the selection');
const editor = page.locator('[data-email-compose-body]').first();
await editor.click();
await page.keyboard.type('hello world');
// ControlOrMeta, not Control: on macOS plain Ctrl+A moves the caret to the
// start of the line instead of selecting, so the command would apply to an
// empty selection and the check would fail for the wrong reason.
await page.keyboard.press('ControlOrMeta+A');
await page.locator('[data-email-compose-tool-cmd="bold"]').first().click();
await page.waitForTimeout(300);

const html = await editor.innerHTML();
check(/<b>|<strong>|font-weight/i.test(html), `bold applied to the selection (got ${html.slice(0, 80)})`);

step(8, 'The More menu exposes the rest of the formatting');
await page.locator('[data-email-compose-tool-menu="more"]').first().click();
await page.waitForTimeout(300);
const menuItems = await page.locator('[data-email-compose-menu-cmd]').count();
check(menuItems > 0, `More opens a menu of commands (got ${menuItems})`);

log('\n' + '='.repeat(60));
if (errors.length) {
  log('Console/page errors:');
  errors.slice(0, 10).forEach((e) => log('  ! ' + e));
}
if (failures.length) {
  log(`FAILED (${failures.length}):`);
  failures.forEach((f) => log('  - ' + f));
} else {
  log('All checks passed.');
}

await browser.close();
process.exit(failures.length ? 1 : 0);
