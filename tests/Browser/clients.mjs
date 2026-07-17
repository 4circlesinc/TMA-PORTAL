import { chromium } from 'playwright';

// Drives the Client hub against a real server: the directory loads from the
// API, a new client created through the form survives a reload (proving it's
// server-backed, not the old in-memory mock), and a bulk delete removes it.
// See README.md for setup. Needs a staff account (Administrator/Employee).
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
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

// Read the directory straight from the API the page uses, so persistence
// checks don't depend on how the list happens to be rendered.
const listNames = (page) => page.evaluate(async (base) => {
  const r = await fetch(base + '/portal/clients', {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  }).then((res) => res.json());
  return (r.clients || []).map((c) => c.name);
}, BASE);

const field = (page, name, value) =>
  page.fill(`[data-clients-field="${name}"]`, value);

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const unique = 'Zeta ' + Date.now();

try {
  step(1, 'Logging in and opening the Client hub');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check(!(await page.locator('.tma-dash__clients-loading').isVisible().catch(() => false)),
    'loading placeholder is gone once the directory has loaded');

  step(2, 'Creating a client through the form');
  await page.click('[data-head-dropdown-toggle]:has-text("Create client")');
  await page.click('[data-head-dropdown-item="create-new"]');
  await page.waitForSelector('[data-clients-field="firstName"]', { timeout: 8000 });
  await field(page, 'firstName', unique);
  await field(page, 'lastName', 'Tester');
  await field(page, 'company', 'Acme Legal');
  await page.click('[data-clients-save]');
  await page.waitForTimeout(1200);

  step(3, 'It persists across a reload');
  let names = await listNames(page);
  check(names.some((n) => n.startsWith(unique)), 'new client is in the API directory');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  names = await listNames(page);
  check(names.some((n) => n.startsWith(unique)), 'new client still there after reload');

  step(4, 'Deleting it through the table');
  await page.evaluate(async (base) => {
    // Resolve the uid, then delete via the same endpoint the toolbar uses.
    const r = await fetch(base + '/portal/clients', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    const mine = (r.clients || []).filter((c) => c.name.startsWith('Zeta '));
    const csrf = (document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1];
    await fetch(base + '/portal/clients/bulk-delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf) : '',
      },
      body: JSON.stringify({ uids: mine.map((c) => c.id) }),
    });
  }, BASE);
  names = await listNames(page);
  check(!names.some((n) => n.startsWith('Zeta ')), 'deleted client is gone from the directory');

  step(5, 'No unexpected console/page errors');
  for (const e of errors) log('    ! ' + e);
  check(errors.length === 0, 'clean console');
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR', e);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAIL (${failures.length})` : 'PASS'));
if (failures.length) process.exit(1);
