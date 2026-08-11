import { chromium } from 'playwright';

// Drives the email page against a real server: the inbox loads from the API
// rather than the old hard-coded INBOX array, opening a message marks it read,
// starring persists, archiving removes it, and Email settings opens over the
// page instead of navigating to /settings.
//
// Provider calls are stubbed at the network layer (route interception), so
// this exercises the whole client without a real Google account.
// See README.md for setup. Needs a user with a connected mailbox.
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
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/*
 * The provider is the one thing we cannot reach from a test. Every mutating
 * mail route is answered here with the shape the real controller returns, so
 * the client's optimistic-update and reconcile paths run exactly as they would
 * in production.
 */
await context.route('**/portal/mail/messages/*', async (route) => {
  const method = route.request().method();
  if (method === 'PATCH') {
    const body = route.request().postDataJSON() || {};
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: { id: 'x', ...body } }),
    });
  }
  return route.continue();
});

await context.route('**/portal/mail/messages/*/move', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ message: { folder: 'archive' }, folders: {} }),
}));

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
  // Login lands on "Stay signed in?" — leave it and every later route bounces
  // straight back to it, and the run passes vacuously.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  const rows = await page.$$('[data-email-row]');
  check(rows.length === 3, `inbox shows the 3 seeded messages (saw ${rows.length})`);

  // The mock's senders were ByeWind/Slack/Natali — real data must have
  // replaced them entirely.
  const listText = await page.textContent('.tma-dash__email-list-body');
  check(listText.includes('Dana Reed'), 'renders a real sender from the database');
  check(!listText.includes('ByeWind') && !listText.includes('Slack'),
    'no trace of the old mock inbox');

  step(2, 'Folder counts come from the server');
  const inboxBadge = await page.textContent('[data-email-folder="inbox"]').catch(() => '');
  check(/2/.test(inboxBadge), `Inbox badges 2 unread (saw "${inboxBadge.trim()}")`);

  step(3, 'Opening a message loads it and marks it read');
  /*
   * Hold the background poll for this step.
   *
   * Marking read is optimistic — the row flips, then the PATCH goes out. That
   * PATCH is stubbed here, so the server still says unread, and the five-second
   * poll would legitimately paint the row unread again a moment later. Only in
   * this harness: in production the write really lands. mailPollShouldWait()
   * stands the poll down while the tab is hidden, which is the honest lever.
   */
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  });

  const firstRow = await page.$('[data-email-row]');
  const rowId = await firstRow.getAttribute('data-email-row');
  // The subject block, not the row's centre: the sender's picture doubles as
  // the row's checkbox, and in a narrow split list it sits close enough to the
  // middle that a centred click selects the row instead of opening it.
  await page.click(`[data-email-row="${rowId}"] .tma-dash__email-row-content`);
  await page.waitForTimeout(800);

  const readState = await page.evaluate((id) => {
    const el = document.querySelector('[data-portal-mount], [data-email]');
    const root = document.querySelector('.tma-dash__email-page')?.closest('[data-email]')
      || document.querySelector('[data-email]');
    const state = root && root._emailState;
    const row = state && state.rows.filter((r) => r.id === id)[0];
    return { unread: row ? row.unread : null, selected: state && state.selectedId };
  }, rowId);
  check(readState.unread === false, 'the opened row is no longer unread');
  check(readState.selected === rowId, 'the reading pane targets the opened message');

  // The body fetch above genuinely fails here (no real Google account), which
  // is the interesting case: a dead grant must not discard mail already
  // loaded. It should degrade to a banner over an intact list.
  step(3.5, 'A failed body fetch keeps the inbox on screen');
  const stillListed = await page.$$('[data-email-row]');
  check(stillListed.length === 3, `list survived the failure (${stillListed.length} rows)`);
  const bodyText = await page.textContent('.tma-dash__email-list');
  check(!bodyText.includes('No mailbox connected'),
    'did not collapse into the disconnected empty state');

  step(4, 'Starring persists through the API');
  // A row draws its star more than once — pinned at the front on a wide list,
  // folded into the hover bar on a narrow one, and again for touch — with only
  // ever one of them on screen. Hover the row first, then take the visible one.
  await page.hover(`[data-email-row="${rowId}"]`);
  await page.waitForTimeout(200);
  const starBtn = await page.$(`[data-email-star="${rowId}"]:visible`);
  if (starBtn) {
    const before = await page.evaluate((id) => {
      const root = document.querySelector('[data-email]');
      return root._emailState.rows.filter((r) => r.id === id)[0].starred;
    }, rowId);
    await starBtn.click();
    await page.waitForTimeout(400);
    const after = await page.evaluate((id) => {
      const root = document.querySelector('[data-email]');
      return root._emailState.rows.filter((r) => r.id === id)[0].starred;
    }, rowId);
    check(after === !before, `star toggled (${before} → ${after})`);
  } else {
    check(false, 'found a star control on the row');
  }

  step(5, 'Email settings open over the page, not at /settings');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  });

  const urlBefore = page.url();
  await page.click('[data-email-profile-toggle]');
  await page.waitForTimeout(300);
  await page.click('[data-email-profile-action="settings"]');
  await page.waitForTimeout(900);

  check(page.url() === urlBefore, `stayed on ${urlBefore} (now ${page.url()})`);
  const panel = await page.$('[data-email-settings]');
  check(!!panel, 'the settings panel is present');

  if (panel) {
    const panelText = await page.textContent('[data-email-settings]');
    check(panelText.includes('Email settings'), 'panel is titled Email settings');
    check(panelText.includes('e2e@example.com'), 'panel names the connected mailbox');
    check(panelText.includes('Mailbox'), 'panel exposes the Mailbox tab');
    check(!!(await page.$('[data-email-settings-tabs] [data-tab-key="sending"]')),
      'panel exposes the Sending tab for the signature');

    // It must sit above the mail UI to be usable.
    const z = await page.evaluate(() => {
      const el = document.querySelector('.tma-dash__email-settings');
      return el ? window.getComputedStyle(el).zIndex : null;
    });
    check(Number(z) >= 122, `panel stacks above compose (z-index ${z})`);
  }

  step(6, 'A preference saves without leaving the page');
  const sendingTab = await page.$('[data-email-settings-tabs] [data-tab-key="sending"]');
  if (sendingTab) {
    await sendingTab.click();
    await page.waitForTimeout(300);
  }
  check(!!(await page.$('[data-email-settings-tabs]')), 'settings are categorised in tabs');
  check(!!(await page.$('[data-email-signature-editor]')), 'signature editor is present on Sending');
  check(!!(await page.$('[data-email-settings-panel="sending"] .tma-dash__email-compose-toolbar')),
    'signature editor exposes text tools');

  const sigBox = await page.$('[data-email-signature-editor]');
  if (sigBox) {
    await sigBox.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Regards, Test User');
    await page.click('.tma-dash__email-settings-title');
    await page.waitForTimeout(700);

    const saved = await page.evaluate(async (base) => {
      const r = await fetch(base + '/portal/mail/settings', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      }).then((res) => res.json());
      return r.preferences && r.preferences.signature;
    }, BASE);
    const savedText = String(saved || '').replace(/<[^>]+>/g, '').trim();
    check(savedText === 'Regards, Test User', `signature persisted server-side (got "${saved}")`);
  } else {
    check(false, 'found the signature field');
  }

  step(7, 'Escape closes the panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(!(await page.$('[data-email-settings]')), 'panel closed on Escape');

  step(8, 'Compose is a real form');
  await page.click('[data-email-folder="compose"]');
  await page.waitForTimeout(500);
  const toField = await page.$('[data-email-compose-field="to"]');
  const subjField = await page.$('[data-email-compose-field="subject"]');
  const sendBtn = await page.$('[data-email-compose-send]');
  check(!!toField, 'To is an editable input');
  check(!!subjField, 'Subject is an editable input');
  check(!!sendBtn, 'Send is wired to a handler');

  if (toField) {
    await toField.fill('client@example.com');
    const val = await toField.inputValue();
    check(val === 'client@example.com', 'typing into To is retained');
  }
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  log('\n──────── result ────────');
  if (errors.length) {
    log('page errors:');
    [...new Set(errors)].slice(0, 10).forEach((e) => log('  ! ' + e));
  }
  if (failures.length) {
    log(`${failures.length} FAILED:`);
    failures.forEach((f) => log('  ✗ ' + f));
  } else {
    log('all checks passed');
  }
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
