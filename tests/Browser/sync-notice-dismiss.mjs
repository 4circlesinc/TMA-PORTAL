import { chromium } from 'playwright';

/**
 * Closing the File Library's "…synced 1d ago" line, permanently.
 *
 * The line had no close button at all, so a library synced yesterday reported
 * that fact above the file list for ever. Closing it now hides it on the
 * ACCOUNT, not in the browser — the check that matters here is the second
 * browser context, which has never seen this page before and must still find
 * it hidden. A localStorage-only dismissal passes every other assertion in
 * this file and fails that one.
 *
 * Needs a connected library whose last sync succeeded (see README).
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
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb/i;

async function openPortal(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
  });

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

  return page;
}

/** The File Library, waited until its sync poll has had a chance to paint. */
async function openLibrary(page) {
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-files-body]', { timeout: 20000 });
  await page.waitForTimeout(2500);
}

const stripVisible = (page) => page.isVisible('[data-sync-strip]').catch(() => false);

try {
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openPortal(first);

  step(1, 'The synced line shows, with a way to close it');
  await openLibrary(page);
  check(await stripVisible(page), 'the sync line is on screen');
  const text = (await page.textContent('[data-sync-strip]').catch(() => '')) || '';
  check(/synced/i.test(text), `it reports the last sync (got "${text.trim().slice(0, 50)}")`);
  check(await page.isVisible('[data-sync-dismiss]'), 'it has a close button');

  step(2, 'Closing it hides it immediately');
  await page.click('[data-sync-dismiss]');
  await page.waitForTimeout(600);
  check(!(await stripVisible(page)), 'gone as soon as it is closed');

  step(3, 'It stays closed across a reload');
  await openLibrary(page);
  check(!(await stripVisible(page)), 'still gone after a full page load');

  step(4, 'It was saved to the account, not just this browser');
  const saved = await page.evaluate(async () => {
    const r = await fetch('/me/preferences', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    return (await r.json()).fileSyncNoticeDismissed;
  });
  check(saved === true, `the account records it as dismissed (got ${JSON.stringify(saved)})`);

  step(5, 'A brand-new browser finds it already closed');
  // The real test of "forever": empty localStorage, same account.
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const fresh = await openPortal(second);
  await openLibrary(fresh);
  check(!(await stripVisible(fresh)), 'hidden in a browser that has never seen this page');

  step(6, 'No console errors');
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((e) => log('      ' + e));

  await page.screenshot({ path: 'tests/Browser/sync-notice-dismiss.png' });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR ' + e.message);
} finally {
  await browser.close();
  log(failures.length ? `\nFAILED (${failures.length})\n- ` + failures.join('\n- ') : '\nPASSED');
  process.exit(failures.length ? 1 : 0);
}
