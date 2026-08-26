import { chromium } from 'playwright';

/**
 * Bulk actions and the row menu on the dashboard's file tables.
 *
 * Recent Files and Shared-with-me rendered a checkbox per row, a select-all
 * header and a three-dot button — and nothing was wired to any of them. They
 * were decoration: clicking a checkbox did nothing, and the three-dot button
 * opened no menu. This drives the real controls and checks something happens.
 *
 * The actions themselves belong to the File Library (window.TMAFileActions);
 * what is under test here is that the dashboard tables reach them, with the
 * right items, and that selection survives the re-render each click triggers.
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
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(800);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

const rows = () => page.locator('[data-home-lib-row]');
const toolbarVisible = () => page.isVisible('[data-home-lib-toolbar]').catch(() => false);
const selectionText = async () =>
  (await page.textContent('.tma-dash__toolbar-selection').catch(() => '')) || '';

try {
  step(1, 'Open the dashboard and find Recent Files');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  const n = await rows().count();
  // Two is the minimum this run needs: one to delete at the end, one to leave.
  check(n >= 2, `the recent files table has rows (${n})`);

  check(await page.evaluate(() => !!window.TMAFileActions),
    'the File Library exposes its actions for other lists to use');

  step(2, 'The bulk toolbar is hidden until something is selected');
  check(!(await toolbarVisible()), 'no toolbar with an empty selection');

  step(3, 'Selecting a row reveals the toolbar');
  await page.locator('[data-home-lib-check]').first().check();
  await page.waitForTimeout(400);
  check(await toolbarVisible(), 'the toolbar appears');
  check((await selectionText()).includes('1 Selected'), `reads "1 Selected" (got "${(await selectionText()).trim()}")`);

  // The click re-renders the table; a selection that does not survive that is
  // the classic failure here.
  check(await page.locator('[data-home-lib-check]').first().isChecked(),
    'the checkbox stays checked through the re-render');

  step(4, 'Select-all picks up every row');
  await page.locator('[data-home-lib-all]').check();
  await page.waitForTimeout(400);
  check((await selectionText()).includes(`${n} Selected`),
    `reads "${n} Selected" (got "${(await selectionText()).trim()}")`);

  step(5, 'A partial selection shows the header box as indeterminate');
  await page.locator('[data-home-lib-check]').first().uncheck();
  await page.waitForTimeout(400);
  const headerState = await page.evaluate(() => {
    const el = document.querySelector('[data-home-lib-all]');
    return el ? { checked: el.checked, indeterminate: el.indeterminate } : null;
  });
  check(!!headerState && headerState.indeterminate,
    'the header checkbox is indeterminate, not plain unchecked');

  step(6, 'Delete asks for confirmation instead of acting silently');
  await page.click('[data-home-lib-bulk="delete"]');
  await page.waitForTimeout(600);
  // The page keeps other dialogs in the DOM, so ask for the VISIBLE one.
  const confirmText = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('.tma-portal-modal, [role="dialog"]')]
      .filter((el) => el.offsetParent !== null);
    return shown.map((el) => el.textContent).join(' ');
  });
  check(/recycle bin/i.test(confirmText), `a confirm dialog appeared (got "${confirmText.trim().slice(0, 70)}")`);
  // Back out — this test is about wiring, not about destroying the fixtures.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  step(7, 'The three-dot row menu opens');
  await page.locator('[data-home-lib-menu]').first().click();
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('.tma-portal-context-menu');
    if (!el) return null;
    return {
      items: [...el.querySelectorAll('[data-ctx]')].map((b) => b.textContent.trim()),
      onScreen: el.getBoundingClientRect().width > 0,
    };
  });
  check(!!menu, 'the row menu opened');
  check(!!menu && menu.onScreen, 'it is actually on screen, not just in the DOM');
  check(!!menu && menu.items.length > 0, `it offers actions (${menu ? menu.items.join(', ') : 'none'})`);

  step(8, 'A row-menu action runs from here, not just renders');
  // The menu is the File Library's own. Its actions could still reach for that
  // view's state (current folder, its selection) and quietly do nothing when
  // driven from the dashboard — opening the menu proves only that it opened.
  const favLabel = 'Add to favourites';
  const clicked = await page.evaluate((label) => {
    const el = document.querySelector('.tma-portal-context-menu');
    if (!el) return false;
    const btn = [...el.querySelectorAll('[data-ctx]')]
      .find((b) => b.textContent.trim() === label);
    if (!btn) return false;
    btn.click();
    return true;
  }, favLabel);
  check(clicked, `clicked "${favLabel}" in the row menu`);
  await page.waitForTimeout(1500);

  const favourited = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=favorites&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const j = await r.json();
    return ((j.files || []).concat(j.folders || [])).length;
  });
  check(favourited > 0, `the action reached the server (${favourited} favourite(s))`);

  step(9, 'Shared with me has the same controls');
  await page.keyboard.press('Escape');
  await page.click('[data-tab-key="shared"]');
  await page.waitForTimeout(800);
  const sharedHasTable = await page.locator('[data-home-lib-row], .tma-portal-panel__note, [class*="empty"]').count();
  check(sharedHasTable > 0, 'the shared tab rendered');
  // Switching tabs must not carry the recent selection across.
  check(!(await toolbarVisible()), 'the selection does not follow you to the other tab');

  step(10, 'The type pills narrow the table, and the controls follow');
  /*
   * The tabs and the type filters are both pill groups in the strip's head:
   * which list you are looking at, and which kind of file you want out of it.
   * The pill only appears for a type that is actually in the list, so a filter
   * can never empty the table — and Select all must pick up the rows on screen
   * rather than the ones the filter hid, or a bulk delete would take files the
   * reader cannot see.
   */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.mouse.move(1400, 500);

  const pills = await page.evaluate(() => {
    const head = document.querySelector('.tma-portal-home-library__head');
    if (!head) return null;
    return {
      pillGroups: head.querySelectorAll('.tma-tab-group--pill').length,
      tabIcons: head.querySelectorAll('[data-tab-key] .tma-tab__icon').length,
      types: Array.from(head.querySelectorAll('[data-home-lib-filter]')).map((b) => ({
        key: b.getAttribute('data-home-lib-filter'),
        icon: !!b.querySelector('.tma-tab__icon'),
      })),
    };
  });
  check(!!pills && pills.pillGroups === 2, 'the tabs and the type filters are both pill groups');
  check(!!pills && pills.tabIcons === 2, 'each tab carries its own icon');

  const typed = (pills && pills.types) || [];
  const keys = typed.map((t) => t.key || 'all');
  check(typed.filter((t) => t.key).every((t) => t.icon), 'every type pill carries its file mark');

  /*
   * The whole row, whatever is in the list.
   *
   * This first shipped offering only the types already present, and on a board
   * of PDFs and photographs that meant no Word pill and no Excel pill at all —
   * the row cannot teach you what you can narrow by if it only shows you what
   * you already have. A type with nothing behind it is allowed; picking it
   * says so.
   */
  ['all', 'pdf', 'word', 'excel', 'powerpoint', 'image', 'text'].forEach((k) => {
    check(keys.includes(k), `${k} is offered whether or not the list has one`);
  });

  const emptyType = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=recent&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const cats = ((await r.json()).files || []).map((f) => f.category);
    return ['excel', 'powerpoint', 'audio', 'archive'].find((c) => !cats.includes(c)) || null;
  });
  if (emptyType) {
    await page.click(`[data-home-lib-filter="${emptyType}"]`);
    await page.waitForTimeout(900);
    const said = ((await page.textContent('[data-home-lib-table]')) || '').replace(/\s+/g, ' ');
    check(/No .* files here/.test(said) && /Pick All/.test(said),
      `a type with nothing behind it says so, and offers the way back (got "${said.trim().slice(0, 60)}")`);
    check(!/No recent files/.test(said), 'and does not claim the whole tab is empty');
    await page.click('[data-home-lib-filter="all"], [data-home-lib-filter=""]');
    await page.waitForTimeout(900);
  }

  const before10 = await rows().count();
  const firstType = typed.filter((t) => t.key)[0];
  if (firstType) {
    await page.click(`[data-home-lib-filter="${firstType.key}"]`);
    await page.waitForTimeout(800);
    const narrowed = await rows().count();
    check(narrowed > 0 && narrowed < before10,
      `filtering to ${firstType.key} narrows the table (${before10} → ${narrowed})`);

    await page.locator('[data-home-lib-all]').check();
    await page.waitForTimeout(600);
    check((await selectionText()).includes(`${narrowed} Selected`),
      `Select all picks up only what is on screen (got "${(await selectionText()).trim()}")`);

    // The same pill again clears the filter, and the selection with it.
    await page.click(`[data-home-lib-filter="${firstType.key}"]`);
    await page.waitForTimeout(800);
    check(await rows().count() === before10, 'clicking the pill again shows everything');
    check(!(await toolbarVisible()), 'and drops a selection the reader can no longer see');
  }

  step(11, 'A bulk delete really deletes — dialog to server');
  // The sidebar can be set to Hover Overlay and expands over the checkbox
  // column; the previous step's last click left the pointer on the left of the
  // board, which is enough to hold it open over this one's first click.
  await page.mouse.move(1400, 500);
  // Reload for a clean selection. Earlier steps deliberately left rows picked
  // (the selection is per-tab and survives switching), so carrying that in
  // would delete more than the one row this step is about.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 });

  const before = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=recent&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return ((await r.json()).files || []).map((f) => f.name);
  });

  /*
   * A FILE row, not simply the first row.
   *
   * Recent lists folders before files, and binning a folder takes everything
   * inside it with it — this step then counted four files leaving where it
   * expected one and reported a delete that had worked perfectly as a failure.
   */
  await page.locator('[data-home-lib-row][data-type="file"] [data-home-lib-check]').first().check();
  await page.waitForTimeout(400);
  await page.click('[data-home-lib-bulk="delete"]');
  await page.waitForTimeout(500);
  await page.click('.tma-portal-modal button:has-text("Move to bin")');
  await page.waitForTimeout(2500);

  const after = await page.evaluate(async () => {
    const r = await fetch('/portal/files/?section=recent&perPage=40',
      { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return ((await r.json()).files || []).map((f) => f.name);
  });

  check(after.length === before.length - 1,
    `one file left the library (${before.length} → ${after.length})`);
  check(!(await toolbarVisible()), 'the selection clears once the action lands');

  step(12, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((e) => log('      ' + e));

  await page.screenshot({ path: 'tests/Browser/home-library-actions.png' });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR ' + e.message);
  await page.screenshot({ path: 'tests/Browser/home-library-actions-error.png' }).catch(() => {});
} finally {
  await browser.close();
  log(failures.length ? `\nFAILED (${failures.length})\n- ` + failures.join('\n- ') : '\nPASSED');
  process.exit(failures.length ? 1 : 0);
}
