import { chromium } from 'playwright';

// Account settings > Client hub management > Client hub access.
//
// The panel used to be two localStorage toggles. It is now the firm's real
// client-hub capability grid, and the whole point is that a toggle *bites* —
// so this drives the screen as an administrator, saves a revoked capability,
// and then signs in as the employee it was revoked from to confirm the
// Clients row has actually left their sidebar. PHPUnit checks the matrix;
// only a browser can check that the screen paints, saves and repaints, and
// that the nav agrees afterwards.
//
// Step 1 reads the matrix defaults, so it wants an untouched
// `clienthub.access` row — the run puts the grants back as it finishes, but
// re-seed if it ever aborts mid-way.
//
// Needs the three standard accounts (e2e@example.com Administrator,
// emp@example.com Employee, client@example.com Client). See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const ADMIN = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const EMPLOYEE = process.env.TMA_EMPLOYEE_EMAIL || 'emp@example.com';

const log = (...a) => console.log(...a);
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  // The stay-signed-in gate sits in front of the whole portal.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(400);
  }
}

async function openPanel(page) {
  await page.goto(`${BASE}/account-settings?settings-page=clienthub-access`, { waitUntil: 'networkidle' });
  // The rail repaints once /me answers; the panel then fetches its own data.
  await page.waitForSelector('[data-hub-cap="clients.view"]', { timeout: 10000 });
}

const admin = await browser.newContext();
const adminPage = await admin.newPage();
const consoleErrors = [];
adminPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

try {
  step(1, 'The panel loads from the server, not from localStorage');
  await signIn(adminPage, ADMIN);
  await openPanel(adminPage);

  const caps = await adminPage.$$eval('[data-hub-cap]', (els) =>
    els.map((e) => ({ id: e.getAttribute('data-hub-cap'), on: e.checked, disabled: e.disabled })));
  check(caps.length === 5, `five capability toggles rendered (got ${caps.length})`);
  check(caps.every((c) => !c.disabled), 'an administrator may edit every one');

  const byId = Object.fromEntries(caps.map((c) => [c.id, c.on]));
  check(byId['clients.view'] === true, 'clients.view starts granted (matrix default)');
  check(byId['clients.viewAll'] === false, 'clients.viewAll starts revoked (matrix default)');

  const expiry = await adminPage.$eval('[data-hub-expiry]', (e) => e.value);
  check(expiry === '7', `invitation expiry starts at the 7-day default (got ${expiry})`);

  step(2, 'Turning reach off follows through to the permissions beneath it');
  // The switch's own track sits over the input, so the click has to be forced
  // (or aimed at the label) — the same shape every settings toggle has.
  await adminPage.uncheck('[data-hub-cap="clients.view"]', { force: true });
  const dependents = await adminPage.$$eval(
    '[data-hub-cap]:not([data-hub-cap="clients.view"])',
    (els) => els.map((e) => e.disabled));
  check(dependents.every(Boolean), 'the other four disable themselves');
  const noteShown = await adminPage.$eval('[data-hub-reach-note]', (e) => !e.hidden);
  check(noteShown, 'and the screen says why');

  step(3, 'Saving persists across a reload');
  await adminPage.click('[data-hub-save]');
  await adminPage.waitForTimeout(800);
  await openPanel(adminPage);
  const reachAfter = await adminPage.$eval('[data-hub-cap="clients.view"]', (e) => e.checked);
  check(reachAfter === false, 'clients.view is still revoked after a full reload');

  step(4, 'The employee it was revoked from loses the Clients page');
  const emp = await browser.newContext();
  const empPage = await emp.newPage();
  await signIn(empPage, EMPLOYEE);
  await empPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await empPage.waitForFunction(
    () => document.documentElement.getAttribute('data-tma-access') === 'ready',
    null, { timeout: 10000 },
  );
  const clientsRow = await empPage.$('[data-nav="clients"]');
  check(clientsRow === null, 'the Clients row is gone from the sidebar');

  const pageStatus = await empPage.evaluate(async (base) => {
    const r = await fetch(base + '/clients', { credentials: 'same-origin' });
    return r.status;
  }, BASE);
  check(pageStatus === 404, `and the page itself refuses (got ${pageStatus})`);
  await emp.close();

  step(5, 'The administrator can always let them back in');
  await openPanel(adminPage);
  await adminPage.check('[data-hub-cap="clients.view"]', { force: true });
  await adminPage.waitForTimeout(100);
  const reEnabled = await adminPage.$$eval(
    '[data-hub-cap]:not([data-hub-cap="clients.view"])',
    (els) => els.every((e) => !e.disabled));
  check(reEnabled, 'the dependent permissions re-enable');
  await adminPage.click('[data-hub-save]');
  await adminPage.waitForTimeout(800);

  const emp2 = await browser.newContext();
  const empPage2 = await emp2.newPage();
  await signIn(empPage2, EMPLOYEE);
  await empPage2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await empPage2.waitForFunction(
    () => document.documentElement.getAttribute('data-tma-access') === 'ready',
    null, { timeout: 10000 },
  );
  check(await empPage2.$('[data-nav="clients"]') !== null, 'the Clients row is back');
  await emp2.close();

  step(6, 'Nothing threw along the way');
  // Reverb's origin allow-list is environment config, not this page.
  const noisy = consoleErrors.filter((t) => !/favicon|Failed to load resource|realtime disabled|Origin not allowed/i.test(t));
  check(noisy.length === 0, `console clean (${noisy.length} errors)${noisy.length ? ': ' + noisy[0] : ''}`);
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await browser.close();
}

log(`\n${failures.length ? '✗ ' + failures.length + ' failure(s)' : '✓ all checks passed'}`);
failures.forEach((f) => log('  - ' + f));
process.exit(failures.length ? 1 : 0);
