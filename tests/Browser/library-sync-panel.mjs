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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

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
        items: 431, failedItems: 0, initialImport: true, lastError: null,
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

  step(5, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  if (errors.length) errors.slice(0, 5).forEach((e) => log('      ' + e));

  await page.screenshot({ path: 'tests/Browser/library-sync-panel.png' });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR ' + e.message);
  await page.screenshot({ path: 'tests/Browser/library-sync-panel-error.png' }).catch(() => {});
} finally {
  await browser.close();
  log(failures.length ? `\nFAILED (${failures.length})\n- ` + failures.join('\n- ') : '\nPASSED');
  process.exit(failures.length ? 1 : 0);
}
