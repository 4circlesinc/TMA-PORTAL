import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * What opening an application costs, and when its page is there.
 *
 * Two pages "took too long": the application's details and its edit form. The
 * time was not in the browser. One read of the record ran a query for every
 * filed document, four or five of them each, so a real family's file was
 * several hundred round trips; and the pages asked for that record more than
 * once, three times over on the edit form.
 *
 * The server half is pinned by CipDetailScaleTest. This pins what only shows
 * in a browser: how many times each page asks, what one ask costs (read off
 * the Server-Timing header the portal sends), and that a row the reader has
 * pointed at opens on its tabs without waiting for the record at all.
 *
 * Needs the `cip-table-quiet.mjs` server and seed, with at least one
 * application that has a client record, a family and filed documents.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const HOLD = 3000;
const ROW = '.tma-cip-table tbody tr[data-cip-open]:not([data-cip-open=""])';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

function loginCode() {
  const all = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

/* Every data request from here to stop(), with what the server said it cost. */
function watch() {
  const seen = [];
  const onResponse = r => {
    const req = r.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const timing = r.headers()['server-timing'] || '';
    const queries = Number((timing.match(/desc="(\d+) queries"/) || [])[1] || 0);
    seen.push({ path: new URL(r.url()).pathname, queries });
  };
  page.on('response', onResponse);
  return {
    stop() { page.off('response', onResponse); return seen; },
  };
}

const count = (seen, test) => seen.filter(r => test.test(r.path)).length;
const worst = (seen, test) => Math.max(0, ...seen.filter(r => test.test(r.path)).map(r => r.queries));

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(700);
  }

  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(ROW, { timeout: 60000 });
  await page.waitForTimeout(3500);
  const subject = await page.evaluate(sel => {
    const tr = document.querySelector(sel);
    return { uid: tr.getAttribute('data-cip-open'), app: tr.getAttribute('data-cip-app') };
  }, ROW);
  const RECORD = new RegExp(`/portal/cip/clients/${subject.uid}/application$`);
  const BY_ID = new RegExp(`/portal/cip/applications/${subject.app}$`);
  const ASSIGNED = new RegExp(`/portal/clients/${subject.uid}/assignments$`);

  step(1, 'A row the reader points at opens on its tabs, not on a wait');
  // Clean slate for this one file, so the copy can only have come from the hover.
  await page.evaluate(uid => window.TMAStore.invalidate('cip:application:' + uid), subject.uid);
  let w = watch();
  await page.hover(`.tma-cip-table tbody tr[data-cip-open="${subject.uid}"] td:nth-child(2)`);
  await page.waitForTimeout(1200);
  const hovered = w.stop();
  check(count(hovered, RECORD) === 1, `resting on the row asked for its record once (${count(hovered, RECORD)})`);

  // From here the record is held back: whatever paints, paints without it.
  let answered = false;
  await page.route(url => RECORD.test(new URL(url).pathname), async route => {
    await new Promise(r => setTimeout(r, HOLD));
    answered = true;
    return route.continue().catch(() => {});
  });
  const t0 = Date.now();
  await page.click(`.tma-cip-table tbody tr[data-cip-open="${subject.uid}"] td:first-child`);
  let tabsAt = null;
  try {
    await page.waitForSelector('[data-clients-tab]', { timeout: HOLD - 600 });
    tabsAt = Date.now() - t0;
  } catch (e) { /* reported below */ }
  check(tabsAt !== null && !answered, `the tabs were up ${tabsAt}ms after the click, with the record still held for ${HOLD}ms`);
  const tabs = await page.locator('[data-clients-tab]').count();
  check(tabs >= 3, `as an application, with its own tabs (${tabs})`);
  await page.waitForTimeout(HOLD + 1500);
  await page.unroute(url => RECORD.test(new URL(url).pathname)).catch(() => {});
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  const detailsUrl = page.url();

  step(2, 'Opening the details page asks for each thing once');
  w = watch();
  await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-clients-tab]', { timeout: 30000 });
  await page.waitForTimeout(3500);
  const details = w.stop();
  const records = count(details, RECORD);
  // The page revalidates when the directory lands behind it, which is a second
  // read by design; a third is the same question asked again for nothing.
  check(records >= 1 && records <= 2, `the record, ${records} time(s) (it was three)`);
  check(count(details, ASSIGNED) === 1, `who is assigned, ${count(details, ASSIGNED)} time(s) (it was four)`);
  const recordCost = worst(details, RECORD);
  check(recordCost > 0 && recordCost <= 70, `one read of the record cost ${recordCost} queries (139 before, and more with every document filed)`);

  step(3, 'Opening the edit form asks for the record once');
  w = watch();
  await page.goto(`${BASE}/citizenship-applications/applications/${subject.app}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cip-form]', { timeout: 40000 });
  await page.waitForTimeout(3500);
  const edit = w.stop();
  check(count(edit, BY_ID) === 1, `by its own address, ${count(edit, BY_ID)} time(s) (it was three)`);
  const editCost = worst(edit, BY_ID);
  check(editCost > 0 && editCost <= 70, `at ${editCost} queries`);
  const filled = await page.evaluate(() => {
    const field = document.querySelector('[data-cip-form] [data-cip-field="firstName"], [data-cip-form] input[name="firstName"]');
    return field ? field.value : '';
  });
  check(filled.length > 0, `and the form is filled in from it (first name: ${filled || 'empty'})`);

  step(4, 'Nothing broke');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.screenshot({ path: 'tests/Browser/cip-application-open.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
