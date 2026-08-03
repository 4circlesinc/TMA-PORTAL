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
  check(n >= 3, `the recent files table has rows (${n})`);

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

  step(8, 'Shared with me has the same controls');
  await page.keyboard.press('Escape');
  await page.click('[data-tab-key="shared"]');
  await page.waitForTimeout(800);
  const sharedHasTable = await page.locator('[data-home-lib-row], .tma-portal-panel__note, [class*="empty"]').count();
  check(sharedHasTable > 0, 'the shared tab rendered');
  // Switching tabs must not carry the recent selection across.
  check(!(await toolbarVisible()), 'the selection does not follow you to the other tab');

  step(9, 'A bulk delete really deletes — dialog to server');
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

  await page.locator('[data-home-lib-check]').first().check();
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

  step(10, 'No console errors');
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
