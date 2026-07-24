import { chromium } from 'playwright';

// Users table: /admin/users must load and render real rows (no error empty state).
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const apiCalls = [];
page.on('response', async (res) => {
  if (res.url().includes('/admin/users') && !res.url().includes('pending-count')) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    apiCalls.push({ url: res.url(), status: res.status(), body: body.slice(0, 400) });
  }
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
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  log('[1] Sign in');
  await signIn();

  log('[2] Open /users');
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-users]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const api = apiCalls[apiCalls.length - 1];
  log('    API:', api ? `${api.status} ${api.url}` : 'NONE');
  if (api) log('    body:', api.body);
  check(!!api, 'GET /admin/users was requested');
  check(api && api.status === 200, 'GET /admin/users returned 200');

  const state = await page.evaluate(() => {
    const el = document.querySelector('[data-users]');
    const text = (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      mounted: !!(el && el.hasAttribute('data-users-mounted')),
      className: el ? el.className : null,
      text: text.slice(0, 300),
      rowCount: el ? el.querySelectorAll('[data-users-body] .tma-dash__ctr, .tma-dash__uavatar-tile').length : 0,
      hasError: /Unable to load users|Staff access required|Administrator access|Could not load users|Could not reach/i.test(text),
      hasTMAUsers: typeof window.TMAUsers !== 'undefined',
    };
  });
  log('    UI state:', JSON.stringify(state, null, 2));

  check(state.hasTMAUsers, 'TMAUsers is loaded');
  check(state.mounted, 'users root is mounted');
  check(!state.hasError, 'no load-error empty state');
  check(state.rowCount >= 1, 'at least one user row rendered (got ' + state.rowCount + ')');

  await page.screenshot({ path: 'tests/Browser/users-table.png', fullPage: true });

  // Overview → Users tab
  log('[3] Overview Users tab');
  await page.goto(`${BASE}/overview?tab=users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const overview = await page.evaluate(() => {
    const btn = document.querySelector('[data-overview-tab="Users"]');
    if (btn) btn.click();
    return true;
  });
  await page.waitForTimeout(1500);
  const ov = await page.evaluate(() => {
    const el = document.querySelector('[data-users-overview]');
    const text = (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      exists: !!el,
      mounted: !!(el && el.hasAttribute('data-users-mounted')),
      text: text.slice(0, 300),
      rowCount: el ? el.querySelectorAll('[data-users-body] .tma-dash__ctr').length : 0,
      hasError: /Unable to load users|Staff access|Could not load|Could not reach/i.test(text),
    };
  });
  log('    Overview users:', JSON.stringify(ov, null, 2));
  check(ov.exists && ov.mounted, 'overview users mount exists');
  check(!ov.hasError, 'overview users has no error state');
  check(ov.rowCount >= 1, 'overview users shows rows (got ' + ov.rowCount + ')');
  await page.screenshot({ path: 'tests/Browser/users-table-overview.png', fullPage: true });

  if (errors.length) {
    log('\nJS errors:');
    errors.forEach((e) => log('  -', e));
  }
  check(errors.filter((e) => /Users:|users\.js|TMAUsers/i.test(e)).length === 0, 'no users-related JS errors');
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('\nFAILED:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK users table');
