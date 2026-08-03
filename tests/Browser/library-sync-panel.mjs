import { chromium } from 'playwright';

/**
 * The File Library sync panel's position.
 *
 * It is the "we are importing from SharePoint" indicator, and like the mailbox
 * one it must survive navigation and sit in the bottom-right corner. It used to
 * carry a hand-measured `bottom: calc(... + 92px)` so it would clear the upload
 * panel, which meant that with no upload running it floated in the middle of
 * the right-hand edge instead of the corner. Both panels now share one docked
 * stack, so this measures the rendered geometry rather than trusting the CSS.
 *
 * Only needs a signed-in staff account — the panels are driven directly here
 * because a real SharePoint import cannot be summoned inside a browser test.
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
// Reverb is not running in this harness and says so loudly; it has nothing to
// do with where a panel sits.
const IGNORE = /realtime disabled|Origin not allowed|4009/i;
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

  // Login lands on a "stay signed in?" interstitial before the portal proper.
  // Skipping it leaves every later goto() bouncing back here.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

/*
 * Answer the status poll with a library mid-import.
 *
 * Stubbing the endpoint rather than poking at internals: the panel is built by
 * the poll handler, so this exercises the code that actually runs in front of
 * the user, and the payload is the one the controller really returns.
 */
async function stubSyncing() {
  await context.route('**/sync-status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      connections: [{
        name: 'Citizenship Applications', status: 'syncing',
        items: 985, itemsTotal: 5948, failedItems: 0, initialImport: true, lastError: null,
      }],
    }),
  }));
}

const waitForSyncPanel = () => page.waitForSelector('.tma-portal-sync-panel', { timeout: 20000 });

const boxOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, w: r.width, h: r.height };
}, sel);

try {
  step(1, 'Sign in and open the File Library with a library mid-import');
  await stubSyncing();
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.TMAUpload, { timeout: 15000 });
  await waitForSyncPanel();

  step(2, 'The sync panel sits in the bottom-right corner');
  const vp = page.viewportSize();
  const sync = await boxOf('.tma-portal-sync-panel');
  check(!!sync, 'the sync panel is on screen');

  // "Far bottom right": within one comfortable gutter of both edges. The bug
  // put its bottom ~110px up, which this catches.
  const fromBottom = vp.height - sync.bottom;
  const fromRight = vp.width - sync.right;
  log(`      ${Math.round(fromBottom)}px from the bottom, ${Math.round(fromRight)}px from the right`);
  check(fromBottom <= 40, `anchored to the bottom edge (${Math.round(fromBottom)}px ≤ 40)`);
  check(fromRight <= 40, `anchored to the right edge (${Math.round(fromRight)}px ≤ 40)`);

  step(3, 'It survives navigating to another page');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.TMAUpload, { timeout: 15000 });
  await waitForSyncPanel();
  const after = await boxOf('.tma-portal-sync-panel');
  check(!!after, 'still shown after navigation');
  check(vp.height - after.bottom <= 40, 'still on the bottom edge after navigation');

  step(4, 'With an upload running the two stack instead of overlapping');
  // The upload panel's own markup, added to the dock the way ensurePanel()
  // does. A real upload needs a file picker, which a headless run cannot drive.
  await page.evaluate(() => {
    document.querySelector('.tma-portal-dock').insertAdjacentHTML(
      'afterbegin',
      '<section class="tma-portal-upload" aria-label="Uploads">'
      + '<div class="tma-portal-upload__head">'
      + '<span class="tma-portal-upload__title">Uploads</span></div>'
      + '<ul class="tma-portal-upload__list"><li class="tma-portal-upload__item">'
      + '<div class="tma-portal-upload__row"><span class="tma-portal-upload__name">Brief.pdf</span></div>'
      + '</li></ul></section>');
  });
  await page.waitForTimeout(200);

  const up = await boxOf('.tma-portal-dock > .tma-portal-upload:not(.tma-portal-sync-panel)');
  const sync2 = await boxOf('.tma-portal-sync-panel');
  check(!!up && !!sync2, 'both panels are on screen');
  // The sync panel keeps the corner; the upload panel goes above it.
  check(vp.height - sync2.bottom <= 40, 'the sync panel still owns the corner');
  check(up.bottom <= sync2.top + 1, `the upload panel sits above it (${Math.round(up.bottom)} ≤ ${Math.round(sync2.top)})`);

  step(5, 'The mailbox sync card joins the same stack');
  // It carries .tma-portal-upload too, so it used to be pushed up 108px by a
  // :has() rule that the LIBRARY panel also triggered. Same dock, no offsets.
  await page.evaluate(() => {
    document.querySelector('.tma-portal-dock').insertAdjacentHTML(
      'beforeend',
      '<section class="tma-portal-upload tma-mail-sync" aria-label="Mailbox sync">'
      + '<div class="tma-portal-upload__head">'
      + '<span class="tma-portal-upload__title">Syncing mailbox</span></div></section>');
  });
  await page.waitForTimeout(200);

  const mail = await boxOf('.tma-mail-sync');
  const sync3 = await boxOf('.tma-portal-sync-panel');
  const up3 = await boxOf('.tma-portal-dock > .tma-portal-upload:not(.tma-portal-sync-panel):not(.tma-mail-sync)');
  check(!!mail, 'the mailbox card is on screen');
  check(vp.height - sync3.bottom <= 40, 'the library sync panel still owns the corner');
  // Uploads on top, mailbox, then the library sync panel in the corner.
  check(up3.bottom <= mail.top + 1 && mail.bottom <= sync3.top + 1,
    'all three stack without overlapping');
  await page.screenshot({ path: 'tests/Browser/library-sync-panel.png' });

  step(6, 'Progress reads as a share of the library total');
  const detailText = async () => (await page.textContent('.tma-portal-sync-panel__body')) || '';
  check((await detailText()).includes('985 of 5,948 items'),
    `shows "985 of 5,948 items" (got "${(await detailText()).trim()}")`);

  // Graph gives no total until folders have been discovered; before then the
  // panel must not invent one.
  await context.unroute('**/sync-status');
  await context.route('**/sync-status', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ connections: [{
      name: 'Citizenship Applications', status: 'syncing',
      items: 12, itemsTotal: null, failedItems: 0, initialImport: true, lastError: null,
    }] }),
  }));
  await page.waitForFunction(
    () => (document.querySelector('.tma-portal-sync-panel__body') || {}).textContent === '12 items so far',
    { timeout: 20000 },
  ).then(() => check(true, 'falls back to "12 items so far" with no total known'))
    .catch(async () => check(false, `no-total fallback (got "${(await detailText()).trim()}")`));

  await stubSyncing();

  step(7, 'The minimise caret matches the close button, not a hard black glyph');
  const chrome = await page.evaluate(() => {
    const caret = document.querySelector('.tma-portal-sync-panel__caret');
    const close = document.querySelector('.tma-portal-sync-panel [data-sync-close]');
    if (!caret || !close) return null;
    const cs = getComputedStyle(caret);
    return {
      // A masked span paints via background-color, so that IS the icon colour.
      caretColour: cs.backgroundColor,
      masked: (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none',
      closeColour: getComputedStyle(close).color,
      box: caret.getBoundingClientRect().width,
    };
  });
  check(!!chrome, 'the caret and close button are both present');
  check(chrome.masked, 'the caret is a masked span, so it can be tinted');
  check(chrome.caretColour === chrome.closeColour,
    `caret matches the close button (${chrome.caretColour} vs ${chrome.closeColour})`);
  check(chrome.box > 0 && chrome.box <= 16, `the caret is icon-sized (${chrome.box}px)`);
  await page.screenshot({ path: 'tests/Browser/library-sync-panel.png' });

  step(8, 'It can be minimised, and stays minimised across pages');
  // Start from a clean panel: the earlier steps left injected siblings behind.
  await page.evaluate(() => document.querySelectorAll(
    '.tma-mail-sync, .tma-portal-dock > .tma-portal-upload:not(.tma-portal-sync-panel)'
  ).forEach((n) => n.remove()));

  const openBox = await boxOf('.tma-portal-sync-panel');
  const detailVisible = () => page.isVisible('.tma-portal-sync-panel__body');
  check(await detailVisible(), 'the detail line shows when open');

  await page.click('[data-sync-collapse]');
  await page.waitForTimeout(250);
  const shutBox = await boxOf('.tma-portal-sync-panel');
  check(!(await detailVisible()), 'minimising hides the detail line');
  check(shutBox.h < openBox.h, `the panel actually shrank (${Math.round(shutBox.h)} < ${Math.round(openBox.h)})`);
  check(await page.isVisible('.tma-portal-sync-panel .tma-portal-upload__title'),
    'the title stays visible, so progress is still readable');
  check(vp.height - shutBox.bottom <= 40, 'minimised, it stays in the corner');
  // A long library name must not wrap the collapsed panel onto two lines.
  check(shutBox.h <= 52, `minimised to a single line (${Math.round(shutBox.h)}px ≤ 52)`);
  // A long name must end in an ellipsis, not be chopped mid-word. The title is
  // a flex row, so the truncation has to be on the text element inside it.
  const clip = await page.evaluate(() => {
    const el = document.querySelector('.tma-portal-sync-panel__label');
    if (!el) return null;
    return {
      ellipsis: getComputedStyle(el).textOverflow,
      overflowing: el.scrollWidth > el.clientWidth,
    };
  });
  check(!!clip && clip.ellipsis === 'ellipsis', 'the name truncates with an ellipsis');
  check(!!clip && clip.overflowing, 'the long name really is being truncated here');
  await page.screenshot({ path: 'tests/Browser/library-sync-panel-minimised.png' });

  // The poll repaints every few seconds — it must not spring back open.
  await page.waitForTimeout(6000);
  check(!(await detailVisible()), 'a repaint does not re-expand it');

  step(9, 'Minimised survives navigation, and it can be restored');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.TMAUpload, { timeout: 15000 });
  await waitForSyncPanel();
  check(!(await detailVisible()), 'still minimised on the next page');

  await page.click('[data-sync-collapse]');
  await page.waitForTimeout(250);
  check(await detailVisible(), 'clicking again restores it');

  step(10, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  if (errors.length) errors.slice(0, 5).forEach((e) => log('      ' + e));
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR ' + e.message);
  await page.screenshot({ path: 'tests/Browser/library-sync-panel-error.png' }).catch(() => {});
} finally {
  await browser.close();
  log(failures.length ? `\nFAILED (${failures.length})\n- ` + failures.join('\n- ') : '\nPASSED');
  process.exit(failures.length ? 1 : 0);
}
