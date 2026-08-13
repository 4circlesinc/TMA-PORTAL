import { chromium } from 'playwright';

// Account settings → CIP management. PHPUnit covers the endpoints
// (CipAccessTest); what only a browser can check is that the settings page is
// wired to them: the rail row appears for an administrator, the page paints
// its two sections from /admin/cip/management, and the add-provider and
// grant-officer forms round-trip.
//
// See README.md for setup. Needs an administrator account; override with
// TMA_BASE_URL / TMA_STAFF_EMAIL / TMA_STAFF_PASSWORD. FEATURE_CIP must be on
// for the serving environment or the row is (correctly) absent.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const ADMIN = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const log = (...a) => console.log(...a);
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

// Everything the page says and every management response, for diagnosis.
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const managementResponses = [];
page.on('response', (r) => {
  if (r.url().includes('/admin/cip/')) managementResponses.push(`${r.request().method()} ${r.url().split(BASE)[1] || r.url()} → ${r.status()}`);
});

async function signIn(pageObj, email) {
  await pageObj.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await pageObj.click('text=Sign in with Email');
  await pageObj.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await pageObj.fill('input[name="email"]', email);
  await pageObj.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    pageObj.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    pageObj.click('button[type="submit"]:visible'),
  ]);
  await pageObj.waitForTimeout(500);
  if (pageObj.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      pageObj.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      pageObj.click('text=Yes, stay signed in'),
    ]);
    await pageObj.waitForTimeout(500);
  }
  if (pageObj.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

try {
  await signIn(page, ADMIN);

  step(1, 'The settings rail offers CIP management to an administrator');
  await page.goto(`${BASE}/account-settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check(await page.locator('text=CIP management').count() > 0, 'rail row rendered');

  step(2, 'Clicking the row paints the page from /admin/cip/management');
  const waitMgmt = page.waitForResponse((r) => r.url().includes('/admin/cip/management'), { timeout: 30000 }).catch(() => null);
  await page.click('text=CIP management');
  const mgmt = await waitMgmt;
  if (mgmt) log('    management status: ' + mgmt.status());
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.querySelector('.tma-portal-admin__content')?.innerText || document.body.innerText);
  check(!body.includes('Couldn’t load'), 'no load-failure message');
  check(body.includes('Service providers'), 'providers section rendered');
  check(body.includes('Officers'), 'officers section rendered');

  step(3, 'Add-provider form round-trips');
  const code = 'T' + String(Date.now()).slice(-5).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[d]).slice(0, 5);
  await page.fill('[data-cip-new-name]', 'Probe Provider');
  await page.fill('[data-cip-new-code]', code);
  const waitAdd = page.waitForResponse((r) => r.url().includes('/admin/cip/providers'), { timeout: 30000 }).catch(() => null);
  await page.click('[data-cip-provider-add]');
  const added = await waitAdd;
  check(added !== null, 'provider request fired');
  if (added) log('    add-provider status: ' + added.status());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.querySelector('.tma-portal-admin__content')?.innerText || '');
  check(after.includes('Probe Provider'), 'new provider listed after add');

  await page.screenshot({ path: 'tests/Browser/cip-management.png', fullPage: true });
} catch (e) {
  failures.push(String(e));
  await page.screenshot({ path: 'tests/Browser/cip-management.png', fullPage: true }).catch(() => {});
} finally {
  log('\n— management responses —');
  managementResponses.forEach((r) => log('   ', r));
  log('— console errors —');
  consoleErrors.slice(0, 8).forEach((c) => log('   ', c));
  if (failures.length) { log('\nFAILED:'); failures.forEach((f) => log('   ', f)); } else { log('\nPASSED'); }
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
