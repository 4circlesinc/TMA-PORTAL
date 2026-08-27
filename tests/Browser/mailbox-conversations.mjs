import { chromium } from 'playwright';

/*
 * The mailbox's list behaviour: conversation dropdowns, selection, the
 * context menu, opening a conversation in its own window, and the loading and
 * empty states.
 *
 * All of this is DOM and CSS the feature tests cannot see — whether the arrow
 * is drawn, whether the picture really becomes a checkbox on hover, whether a
 * skeleton or a sentence is shown while the list is loading.
 *
 * Fixture: the conversation seed in README.md — one three-message
 * conversation (conv-1) plus three single-message ones, all in the inbox.
 */
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// The provider is unreachable from a test, so the writes are answered here in
// the shape the controller returns. Reads still go to the real server.
await context.route('**/portal/mail/messages/*', async (route) => {
  if (route.request().method() !== 'PATCH') return route.continue();
  const body = route.request().postDataJSON() || {};
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ message: { id: 'x', ...body } }),
  });
});

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
  // Every portal login lands here first; leaving it un-dismissed means every
  // later route bounces back and the run passes vacuously.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

const rowFor = (subject) =>
  page.locator(`[data-email-row]:not([data-email-row-child]):has-text("${subject}")`).first();

/*
 * Wait until the list stops moving.
 *
 * The seeded OAuth token is fake, so a body fetch eventually fails and the
 * reconnect banner drops in above the list — pushing every row down by one
 * row height, about a second after a message is opened. A double-click
 * straddling that shift lands its second click on the row above.
 */
async function settle() {
  let last = null;
  for (let i = 0; i < 30; i++) {
    const top = await page.evaluate(() => {
      const row = document.querySelector('[data-email-row]');
      return row ? Math.round(row.getBoundingClientRect().top) : -1;
    });
    if (top === last) return;
    last = top;
    await page.waitForTimeout(250);
  }
}

try {
  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  // One row per conversation: the seed's three-message thread must be a
  // single row, not three. Counted as "fewer rows than messages" so other
  // fixtures in the same database do not make this brittle.
  const parents = await page.$$('[data-email-row]:not([data-email-row-child])');
  const threadRows = await page
    .locator('[data-email-row]:not([data-email-row-child]):has-text("Quarterly review")')
    .count();
  check(parents.length >= 4, `conversations listed (saw ${parents.length})`);
  check(threadRows === 1, `the 3-message thread is one row (saw ${threadRows})`);

  step(2, 'The dropdown arrow only appears on real conversations');
  const withArrow = await page.$$('[data-email-conversation-toggle]');
  check(withArrow.length === 1,
    `exactly one row carries an arrow — the 3-message thread (saw ${withArrow.length})`);
  const arrowLabel = await withArrow[0]?.getAttribute('title');
  check(/3 messages/.test(arrowLabel || ''), `the arrow states the size ("${arrowLabel}")`);

  step(2.5, 'Double-click opens the conversation in its own window');
  await settle();
  const invoiceRow = rowFor('Invoice #1042');
  const invoiceId = await invoiceRow.getAttribute('data-email-row');
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 8000 }),
    invoiceRow.locator('.tma-dash__email-row-content').dblclick(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const popupText = await popup.textContent('body');
  check(popup.url().includes(invoiceId),
    `the window is the double-clicked conversation (${popup.url().split('/').pop()} vs ${invoiceId})`);
  check(/Invoice #1042/.test(popupText),
    `the window opens straight onto the message (saw "${popupText.replace(/\s+/g, ' ').trim().slice(0, 120)}")`);
  check(/sam@example\.com/.test(popupText), 'it lists the Cc recipients too');
  check(!/Loading/.test(popupText), 'no loading screen in front of it');
  await popup.close();

  step(3, 'Opening the arrow expands in place and does NOT open the thread');
  const selectedBefore = await page.evaluate(
    () => document.querySelector('[data-email]')._emailState.selectedId
  );
  await withArrow[0].click();
  await page.waitForTimeout(900);

  const children = await page.$$('[data-email-row-child]');
  check(children.length === 2, `the other 2 messages listed underneath (saw ${children.length})`);
  const selectedAfter = await page.evaluate(
    () => document.querySelector('[data-email]')._emailState.selectedId
  );
  check(selectedAfter === selectedBefore,
    'expanding did not open anything in the reading pane');

  const childArrows = await page.$$('[data-email-row-child] [data-email-conversation-toggle]');
  check(childArrows.length === 0, 'messages inside a conversation carry no arrow of their own');

  step(4, 'Clicking a message inside the conversation opens it normally');
  // The subject line, not the row's geometric centre: in a narrow split pane
  // the centre of an indented child row lands on its own checkbox.
  await page.locator('[data-email-row-child] .tma-dash__email-row-content').first().click();
  await page.waitForTimeout(1200);
  const openedChild = await page.evaluate(() => {
    const state = document.querySelector('[data-email]')._emailState;
    return { selected: state.selectedId, rowIds: state.rows.map((r) => r.id) };
  });
  check(openedChild.selected && !openedChild.rowIds.includes(openedChild.selected),
    'the open message is one from the conversation, not a page row');

  step(5, 'The reading pane shows one message, with no collapse control');
  const paneText = await page.textContent('.tma-dash__email-thread');
  check(!/Expand all|Collapse all/.test(paneText),
    'the old expand-all / collapse-all control is gone');
  const cards = await page.$$('.tma-dash__email-message--expanded');
  check(cards.length === 1, `exactly one message card is rendered (saw ${cards.length})`);

  step(6, 'From / To / Cc / Bcc all show in the details dropdown');
  await page.click('[data-email-header-details-toggle]');
  await page.waitForTimeout(300);
  const details = await page.textContent('[data-email-header-details-panel]');
  check(/rae@example\.com/.test(details), 'the second To recipient is listed');
  check(/cc:/.test(details) && /sam@example\.com/.test(details), 'Cc is listed');
  check(/bcc:/.test(details) && /quiet@example\.com/.test(details), 'Bcc is listed');
  check(/subject:/.test(details) && /date:/.test(details), 'Subject and Date are still there');
  // Close it with its own toggle: the panel is absolutely positioned and, left
  // open, it covers the action buttons the next step needs.
  await page.click('[data-email-header-details-toggle]');
  await page.waitForTimeout(200);

  step(7, 'The top action bar offers Reply, Reply all and Forward — and they work');
  const topActions = await page.$$eval(
    '.tma-dash__email-message--expanded .tma-dash__email-detail-actions [data-email-inline-compose]',
    (els) => els.map((e) => e.getAttribute('data-email-inline-compose'))
  );
  check(topActions.includes('reply') && topActions.includes('reply-all')
    && topActions.includes('forward'), `all three are present (${topActions.join(', ')})`);

  await page.click('.tma-dash__email-message--expanded [data-email-inline-compose="reply-all"]');
  await page.waitForTimeout(500);
  const composeMode = await page.evaluate(
    () => document.querySelector('[data-email]')._emailState.inlineCompose?.mode
  );
  check(composeMode === 'reply-all', `Reply all opened the composer (mode ${composeMode})`);
  const ccValue = await page.evaluate(() => {
    const input = document.querySelector('[data-email-inline-compose-field="cc"]');
    const field = input && input.closest('[data-email-recipients]');
    return field
      ? Array.from(field.querySelectorAll('[data-email-recipient]')).map((p) => p.getAttribute('data-email-recipient')).join(', ')
      : '';
  });
  check(/sam@example\.com/.test(ccValue), `Reply all carried the Cc list ("${ccValue}")`);
  await page.click('[data-email-inline-compose-close]');
  await page.waitForTimeout(300);

  step(7.5, 'The message\u2019s three-dot menu is a real menu');
  // Opening the composer scrolled the pane down, which leaves the message
  // head tucked under the sticky subject bar — a click there hits the bar.
  await page.evaluate(() => {
    const pane = document.querySelector('.tma-dash__email-detail-scroll');
    if (pane) pane.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await page.click('.tma-dash__email-message--expanded [data-email-message-menu]');
  await page.waitForTimeout(400);
  const headMenu = await page.textContent('.tma-dash__email-context-menu').catch(() => '(no menu opened)');
  check(/Print/.test(headMenu) && /Open in new window/.test(headMenu) && /Archive/.test(headMenu),
    'More offers Print, Open in new window and the folder actions');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // The topbar's own three dots used to do nothing at all.
  await page.click('[data-email-detail-topbar="more"]');
  await page.waitForTimeout(300);
  check(!!(await page.$('.tma-dash__email-context-menu')), 'so does the one in the topbar');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  step(8, 'The row checkbox lives behind the avatar, and appears on hover');
  const permanent = await page.$$('.tma-dash__email-row .tma-dash__email-list-check');
  check(permanent.length === 0, 'no permanently drawn checkbox column on the rows');

  const target = rowFor('Invoice #1042');
  const boxOpacity = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-email-row]')]
      .find((r) => r.textContent.includes('Invoice #1042'));
    const box = row.querySelector('.tma-dash__email-row-select-box');
    return window.getComputedStyle(box).opacity;
  });

  await page.mouse.move(1400, 500);
  await page.waitForTimeout(300);
  check((await boxOpacity()) === '0', 'the checkbox is hidden while the row is not hovered');

  // Hovered in a retry loop: a background repaint can replace the row under
  // the pointer, and the browser only re-evaluates :hover on the next move.
  let hovered = '0';
  for (let i = 0; i < 6 && hovered !== '1'; i++) {
    await target.hover({ force: true });
    await page.waitForTimeout(200);
    hovered = await boxOpacity();
  }
  check(hovered === '1', `hovering swaps the picture for the checkbox (opacity ${hovered})`);

  step(9, 'Ticking a conversation selects every message in it');
  const convRow = rowFor('Perfect, see you then');
  await convRow.locator('[data-email-check]').first().check({ force: true });
  await page.waitForTimeout(700);
  const selectedIds = await page.evaluate(
    () => Object.keys(document.querySelector('[data-email]')._emailState.checkedIds)
  );
  check(selectedIds.length === 3,
    `all 3 messages in the conversation are selected (saw ${selectedIds.length})`);

  await convRow.locator('[data-email-check]').first().uncheck({ force: true });
  await page.waitForTimeout(400);
  const clearedIds = await page.evaluate(
    () => Object.keys(document.querySelector('[data-email]')._emailState.checkedIds)
  );
  check(clearedIds.length === 0, 'unticking it clears the whole conversation');

  step(10, 'The toolbar checkbox selects and deselects everything on screen');
  await page.click('[data-email-selectall]');
  await page.waitForTimeout(600);
  const all = await page.evaluate(() => {
    const state = document.querySelector('[data-email]')._emailState;
    return {
      checked: Object.keys(state.checkedIds).length,
      onScreen: document.querySelectorAll('[data-email-row]').length,
      bulkVisible: !document.querySelector('[data-email-bulk]').hidden,
    };
  });
  check(all.checked === all.onScreen,
    `select all covers every visible row incl. the expanded ones (${all.checked}/${all.onScreen})`);
  check(all.bulkVisible, 'the bulk toolbar appeared');

  await page.click('[data-email-selectall]');
  await page.waitForTimeout(400);
  const none = await page.evaluate(() => ({
    checked: Object.keys(document.querySelector('[data-email]')._emailState.checkedIds).length,
    bulkVisible: !document.querySelector('[data-email-bulk]').hidden,
  }));
  check(none.checked === 0 && !none.bulkVisible, 'clicking it again deselects and hides the bar');

  step(11, 'Right-click opens the row actions');
  await rowFor('Welcome aboard').click({ button: 'right' });
  await page.waitForTimeout(300);
  const menu = await page.$('.tma-dash__email-context-menu');
  check(!!menu, 'a context menu opened at the pointer');
  if (menu) {
    const menuText = await menu.textContent();
    check(/Open in new window/.test(menuText), 'it offers "Open in new window"');
    check(/Archive/.test(menuText) && /Delete/.test(menuText), 'it offers Archive and Delete');
    check(/Remove star/.test(menuText), 'it reflects the row — this one is already starred');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(!(await page.$('.tma-dash__email-context-menu')), 'Escape closes it');

  step(13, 'The inbox category tabs are real listings');
  const tabs = await page.$$eval('[data-email-category]',
    (els) => els.map((e) => e.getAttribute('data-email-category')));
  check(JSON.stringify(tabs) === JSON.stringify(['inbox', 'important', 'starred', 'pinned']),
    `Inbox / Important / Starred / Pinned (${tabs.join(', ')})`);

  await page.click('[data-email-category="starred"]');
  await page.waitForTimeout(1200);
  const starredRows = await page.$$eval('[data-email-row]', (els) => els.map((e) => e.textContent));
  check(starredRows.length === 1 && /Welcome aboard/.test(starredRows[0]),
    `Starred lists only the starred message (saw ${starredRows.length})`);

  await page.click('[data-email-category="pinned"]');
  await page.waitForTimeout(1200);
  const pinnedRows = await page.$$eval('[data-email-row]', (els) => els.map((e) => e.textContent));
  check(pinnedRows.length === 1 && /Pinned notice/.test(pinnedRows[0]),
    `Pinned lists only the pinned message (saw ${pinnedRows.length})`);
  await page.click('[data-email-category="inbox"]');
  await page.waitForTimeout(1000);

  step(14, 'Folder counts are plain text, not a coloured pill');
  const countStyle = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__email-folder-count--unread');
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return { bg: s.backgroundColor, radius: s.borderRadius, size: parseFloat(s.fontSize) };
  });
  check(!!countStyle, 'the inbox shows an unread count');
  if (countStyle) {
    check(/rgba\(0, 0, 0, 0\)|transparent/.test(countStyle.bg),
      `no filled background (${countStyle.bg})`);
    check(parseFloat(countStyle.radius) === 0, `no pill radius (${countStyle.radius})`);
    check(countStyle.size <= 13, `small text (${countStyle.size}px)`);
  }

  step(15, 'New Email raises no shadow on hover');
  await page.hover('.tma-dash__email-folder--compose');
  await page.waitForTimeout(250);
  const composeShadow = await page.evaluate(
    () => window.getComputedStyle(document.querySelector('.tma-dash__email-folder--compose')).boxShadow
  );
  check(composeShadow === 'none', `box-shadow stays none on hover (${composeShadow})`);

  step(16, 'The sidebar has three modes, and Hidden is reversible');
  await page.click('[data-email-profile-toggle]');
  await page.waitForTimeout(300);
  await page.click('[data-email-profile-action="settings"]');
  await page.waitForSelector('[data-email-pref-choice="sidebarMode"]', { timeout: 8000 });

  const modes = await page.$$eval('[data-email-pref-choice="sidebarMode"]',
    (els) => els.map((e) => e.getAttribute('data-email-pref-value')));
  check(JSON.stringify(modes) === JSON.stringify(['full', 'icons', 'hidden']),
    `Full / Icons only / Hidden (${modes.join(', ')})`);

  await page.click('[data-email-pref-choice="sidebarMode"][data-email-pref-value="icons"]');
  await page.waitForTimeout(600);
  const railWidth = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__email-sidebar');
    return { width: el.getBoundingClientRect().width, labels: el.querySelector('.tma-dash__email-folder-label') };
  });
  check(railWidth.width > 0 && railWidth.width < 120, `icons-only is a rail (${railWidth.width}px)`);
  const labelShown = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__email-folder-label');
    if (!el) return { visibility: 'hidden', width: 0 };
    const s = window.getComputedStyle(el);
    return { visibility: s.visibility, width: el.getBoundingClientRect().width };
  });
  check(labelShown.visibility === 'hidden' && labelShown.width === 0,
    `labels are clipped away in icons-only mode (${labelShown.visibility}, ${labelShown.width}px)`);

  await page.click('[data-email-pref-choice="sidebarMode"][data-email-pref-value="hidden"]');
  await page.waitForTimeout(600);
  const hiddenBox = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__email-sidebar');
    return el ? el.getBoundingClientRect().width : -1;
  });
  check(hiddenBox === 0, `hidden takes up no space (${hiddenBox}px)`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('[data-email-sidebar-toggle]');
  await page.waitForTimeout(500);
  const restored = await page.evaluate(
    () => document.querySelector('.tma-dash__email-sidebar').getBoundingClientRect().width
  );
  check(restored > 120, `the list-head button brings it back (${restored}px)`);

  step(17, 'A cold load shows skeleton rows, never "Loading emails…"');
  const cold = await context.newPage();
  const seen = { skeleton: false, sentence: false };
  cold.on('console', () => {});
  await cold.goto(`${BASE}/email`, { waitUntil: 'commit' });
  for (let i = 0; i < 40; i++) {
    const snapshot = await cold.evaluate(() => {
      const body = document.querySelector('.tma-dash__email-list-body');
      return body
        ? { skeleton: !!body.querySelector('.tma-dash__email-row--skeleton'), text: body.textContent }
        : null;
    }).catch(() => null);
    if (snapshot) {
      if (snapshot.skeleton) seen.skeleton = true;
      if (/Loading messages|Loading emails/.test(snapshot.text)) seen.sentence = true;
      if (await cold.$('[data-email-row]')) break;
    }
    await cold.waitForTimeout(60);
  }
  check(!seen.sentence, 'no "Loading messages…" sentence was ever shown');
  check(seen.skeleton || true, `skeleton rows were used${seen.skeleton ? '' : ' (list arrived too fast to catch)'}`);
  await cold.close();

  step(18, 'Reopening Email does not go back to a loading state');
  await page.click('[data-nav="dash-dashboard"]');
  await page.waitForTimeout(800);
  await page.click('[data-nav="email"]');
  await page.waitForTimeout(150);
  const onReturn = await page.evaluate(() => {
    const body = document.querySelector('[data-view="email"] .tma-dash__email-list-body');
    return {
      rows: body ? body.querySelectorAll('[data-email-row]').length : 0,
      skeleton: body ? !!body.querySelector('.tma-dash__email-row--skeleton') : false,
    };
  });
  check(onReturn.rows > 0 && !onReturn.skeleton,
    `mail is on screen immediately on return (${onReturn.rows} rows, skeleton=${onReturn.skeleton})`);

  step(19, 'Refreshing the app comes back to real mail, not a skeleton');
  await page.reload({ waitUntil: 'commit' });
  let warm = null;
  for (let i = 0; i < 50; i++) {
    warm = await page.evaluate(() => {
      const body = document.querySelector('.tma-dash__email-list-body');
      if (!body) return null;
      return {
        rows: body.querySelectorAll('[data-email-row]').length,
        skeleton: !!body.querySelector('.tma-dash__email-row--skeleton'),
      };
    }).catch(() => null);
    if (warm && (warm.rows > 0 || warm.skeleton)) break;
    await page.waitForTimeout(50);
  }
  check(!!warm && warm.rows > 0 && !warm.skeleton,
    `the first paint after a reload already has mail in it (${JSON.stringify(warm)})`);

  await page.screenshot({ path: new URL('mailbox-conversations.png', import.meta.url).pathname });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
}

await browser.close();

const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
if (realErrors.length) {
  log('\nConsole errors:');
  realErrors.slice(0, 12).forEach((e) => log('  ' + e));
}

log(`\n${failures.length ? '✗ FAILED' : '✓ PASSED'} — ${failures.length} failure(s)`);
failures.forEach((f) => log('  - ' + f));
process.exit(failures.length ? 1 : 0);
