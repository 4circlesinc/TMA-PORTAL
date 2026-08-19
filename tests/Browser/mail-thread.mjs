import { chromium } from 'playwright';

/*
 * Reading a conversation.
 *
 * The pane shows the message that is open, in full. Moving between the other
 * messages in the conversation is the *list's* job — the row carries a
 * dropdown arrow, and picking a message from it opens that message here. The
 * pane used to stack the whole thread as collapsed cards with its own
 * expand-all control, which was a second, competing way to do the same thing;
 * mailbox-conversations.mjs covers the dropdown that replaced it.
 *
 * What is checked here is the reading itself: one card, identified by sender
 * and time, with quoted history hidden behind a toggle that still reveals it,
 * and attachments listed under the message they belong to.
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
  // Login lands on "Stay signed in?" — leave it and every later route bounces
  // straight back to it, and the run passes vacuously.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForLoadState('networkidle');
  }
}

step(1, 'Sign in and open the mailbox');
await signIn();
await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-email-row]', { timeout: 15000 });
check(true, 'inbox rendered');

step(2, 'Open the conversation');
// Targeted by subject rather than position: the inbox holds other fixtures,
// and "the first row" is whichever one happens to be newest.
const conversationRow = page
  .locator('[data-email-row]:not([data-email-row-child])', { hasText: 'Quarterly review' })
  .first();
await conversationRow.locator('.tma-dash__email-row-content').click();
await page.waitForSelector('[data-email-thread]', { timeout: 15000 });
await page.waitForTimeout(800);

const cards = await page.locator('[data-email-thread-message]').count();
check(cards === 1, `the pane holds only the open message (got ${cards})`);
check(
  (await page.locator('.tma-dash__email-message--collapsed').count()) === 0,
  'no collapsed sibling cards — the list dropdown navigates the thread now'
);
check(
  (await page.locator('[data-email-thread-toggle-all]').count()) === 0,
  'and no expand-all control competing with it'
);
check(
  (await page.locator('.tma-dash__email-thread-note').count()) === 0,
  'no conversation-size note in the reading pane'
);

step(3, 'The open message is identified by sender and time');
const names = await page.locator('.tma-dash__email-message-head-name').allTextContents();
check(names.some((n) => n.includes('Dana')), `the sender is named (got ${JSON.stringify(names)})`);
check(
  (await page.locator('.tma-dash__email-detail-date').count()) >= 1,
  'the message shows its own date'
);

step(4, 'The rest of the conversation is reached from the list dropdown');
await conversationRow.locator('[data-email-conversation-toggle]').click();
await page.waitForTimeout(1000);
const siblings = await page.locator('[data-email-row-child]').count();
check(siblings === 2, `the other two messages are listed under the row (got ${siblings})`);

step(5, 'Quoted history is collapsed but still reachable');
// The middle message carries an Outlook reply header plus a blockquote, so it
// is the one worth opening — its body arrives from the server on demand.
await page
  .locator('[data-email-row-child]', { hasText: 'Re: Quarterly review' })
  .first()
  .locator('.tma-dash__email-row-content')
  .click();
await page.waitForTimeout(1500);

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

step(6, 'Attachments are listed under the message they belong to');
// A separate fixture message, because attachments hang off one message in the
// thread rather than the thread as a whole — the section has to be able to say
// which message's files it is showing.
await page
  .locator('[data-email-row]:not([data-email-row-child])', { hasText: 'With attachments' })
  .first()
  .locator('.tma-dash__email-row-content')
  .click();
await page.waitForSelector('[data-email-thread]', { timeout: 15000 });
await page.waitForTimeout(1200);

const tiles = await page.locator('[data-email-attachment-open]').count();
check(tiles === 3, `every attachment gets a tile (got ${tiles})`);

const fileNames = await page.locator('.tma-dash__email-attachment-tile-name').allTextContents();
check(
  fileNames.includes('contract.pdf') && fileNames.includes('photo.png'),
  `attachments are named (got ${JSON.stringify(fileNames)})`
);

// An embedded signature image stays listed — a pasted document carries a
// Content-ID exactly as a logo does — but is counted apart from real files.
const heading = (await page.locator('.tma-dash__email-attachments-head').first().innerText()).trim();
check(
  /embedded image/i.test(heading),
  `embedded images are distinguished from attachments (got "${heading}")`
);

step(7, 'A new compose window starts empty');
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

step(8, 'Compose formatting tools act on the selection');
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

step(9, 'The More menu exposes the rest of the formatting');
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
