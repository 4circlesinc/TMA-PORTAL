import { chromium } from 'playwright';

// The account settings rail, read as each account type actually sees it.
//
// /account-settings is the one settings home, so every account loads it — but
// the rail it draws is a single static list in portal-admin.js and nothing
// pruned it, so employees and clients were offered the firm's Admin Overview,
// security policy, branding, billing, storage and Advanced Preferences beside
// their own profile. PHPUnit can check the capability matrix; only a browser
// can check what the rail actually paints, what global search offers, and what
// a deep link into an admin section renders.
//
// Needs the three standard accounts (e2e@example.com Administrator,
// emp@example.com Employee, client@example.com Client). See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const ADMIN = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const EMPLOYEE = process.env.TMA_EMPLOYEE_EMAIL || 'emp@example.com';
const CLIENT = process.env.TMA_CLIENT_EMAIL || 'client@example.com';

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

async function openSettings(page, deepLink) {
  const url = deepLink
    ? `${BASE}/account-settings?settings-page=${deepLink}`
    : `${BASE}/account-settings`;
  await page.goto(url, { waitUntil: 'networkidle' });
  // The rail repaints once /me answers; wait for the access module to settle
  // rather than for a fixed beat.
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-tma-access') === 'ready',
    { timeout: 10000 },
  );
  await page.waitForTimeout(500);
}

// Every section the rail is currently offering, including the ones inside a
// collapsed group (they are only in the DOM once expanded, so read the source
// list through the group toggles too).
async function railSections(page) {
  const groups = await page.locator('.tma-portal-admin__nav [data-admin-group]').all();
  for (const g of groups) await g.click().catch(() => {});
  await page.waitForTimeout(250);
  return page.$$eval('.tma-portal-admin__nav [data-admin-nav]',
    (els) => els.map((e) => e.getAttribute('data-admin-nav')));
}

const ADMIN_ONLY = [
  'admin-overview', 'background-ops', 'reporting', 'notification-history',
  'branding', 'clienthub-access', 'service-teams', 'custom-fields',
  'security-insights', 'signin-policy', 'security-policy',
  'alert-settings', 'device-security',
  'connection-manager', 'storage-usage',
  'permissions', 'default-folders', 'folder-templates',
];

const PERSONAL = ['profile', 'theme', 'time', 'notifications', 'privacy',
  'account-security', 'payment', 'plugins', 'connectors'];

// Every nav item still in the sidebar, by its data-nav id. portal-access.js
// *removes* the nodes rather than hiding them, so this is the real list.
async function sidebarNav(page) {
  // 'domcontentloaded', not 'networkidle': the dashboard falls back to polling
  // for messages when Reverb is not running, so the network never goes idle.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-tma-access') === 'ready',
    { timeout: 10000 },
  );
  await page.waitForTimeout(400);
  return page.$$eval('.tma-dash__sidebar [data-nav]',
    (els) => els.map((e) => e.getAttribute('data-nav')));
}

try {
  /* ── the sidebar ────────────────────────────────────────────────── */
  step(0, 'The Users page is gone from the employee sidebar');
  const emp0 = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await signIn(emp0, EMPLOYEE);
  const empNav = await sidebarNav(emp0);
  // The account-management table — status, sign-in history, approve/suspend/
  // delete per row. Employees browse colleagues through People instead.
  check(!empNav.includes('users'), `"Users" is not in the sidebar (has: ${empNav.join(', ')})`);
  // The Overview page reopened to employees in Aug 2026 — the administration
  // it carries (Users tab, Recycle Bin, the settings-rail Admin Overview
  // panel) stays behind its own capabilities.
  check(empNav.includes('dash-project-overview'), '"Overview" is in the employee sidebar');
  // The whole People section is administration now — the directory and both
  // address books included.
  check(!empNav.some((id) => id.startsWith('people-')), 'no People screen is in the sidebar');
  check(empNav.includes('clients') && empNav.includes('email'),
    'the staff tooling they do run is untouched');
  await emp0.close();

  step('0b', 'An employee sees only the clients they are assigned to');
  const emp1 = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await signIn(emp1, EMPLOYEE);
  await emp1.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  // Wait for the list to paint rather than a fixed beat — it arrives from the
  // API well after DOMContentLoaded.
  await emp1.waitForSelector('text=Acme Corp', { timeout: 15000 }).catch(() => {});
  const clientList = await emp1.locator('body').innerText();
  check(/Acme Corp/.test(clientList), 'their assigned client is listed');
  check(!/Rival Ltd/.test(clientList), 'a client they are not assigned to is not');

  // The list is filtered; the URL is the way past it.
  const direct = await emp1.evaluate(() => fetch('/portal/clients/rival', {
    credentials: 'same-origin', headers: { Accept: 'application/json' },
  }).then((r) => r.status));
  check(direct === 404, `opening an unassigned client by uid gives 404 (got ${direct})`);
  await emp1.close();

  /* ── administrators keep everything ─────────────────────────────── */
  step(1, 'An administrator still sees the whole rail');
  const admin = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await signIn(admin, ADMIN);
  await openSettings(admin);
  const adminSections = await railSections(admin);
  const missing = ADMIN_ONLY.filter((id) => !adminSections.includes(id));
  check(missing.length === 0, `every administration section is present (missing: ${missing.join(', ') || 'none'})`);
  check(PERSONAL.every((id) => adminSections.includes(id)), 'the personal sections are there too');

  step(2, 'A deep link into an admin section opens it for an administrator');
  await openSettings(admin, 'security-policy');
  check(
    (await admin.locator('.tma-portal-admin__page-title').innerText()).includes('Security policy'),
    'a hard refresh at ?settings-page=security-policy lands on the policy page, not the profile',
  );

  /* ── employees ──────────────────────────────────────────────────── */
  step(3, 'An employee is offered their own settings and nothing else');
  const employee = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await signIn(employee, EMPLOYEE);
  await openSettings(employee);
  const empSections = await railSections(employee);
  const leaked = ADMIN_ONLY.filter((id) => empSections.includes(id));
  check(leaked.length === 0, `no administration section is offered (leaked: ${leaked.join(', ') || 'none'})`);
  check(PERSONAL.every((id) => empSections.includes(id)),
    `their own settings are all still there (has: ${empSections.join(', ')})`);

  step(4, 'An employee deep-linking into an admin section gets their own profile');
  // A stale bookmark, a shared link, or simply typing the URL. The rail is
  // hidden from them, so this is the way back in — it must not render the
  // panel anyway. `[data-pf-root]` is the profile page and nothing else.
  for (const section of ['security-policy', 'branding', 'admin-overview', 'permissions']) {
    await openSettings(employee, section);
    const body = await employee.locator('.tma-portal-admin__content').innerText();
    const onProfile = await employee.locator('.tma-portal-admin__content [data-pf-root]').count();
    check(onProfile > 0 && !/Trusted domains|Edit Account Name|Signature requests remaining|Auto Remediation/i.test(body),
      `?settings-page=${section} falls back to the profile instead of the admin panel`);
  }

  step(5, 'Global search no longer offers an employee the admin sections');
  await openSettings(employee);
  await employee.click('[data-action="open-search"]');
  await employee.waitForSelector('[data-search-input]', { timeout: 5000 });
  await employee.fill('[data-search-input]', 'security policy');
  await employee.waitForTimeout(700);
  const empResults = await employee.locator('[data-search-body]').innerText();
  check(!/Security policy/i.test(empResults), 'searching "security policy" returns no admin result');
  await employee.fill('[data-search-input]', 'branding');
  await employee.waitForTimeout(700);
  check(!/Company Branding/i.test(await employee.locator('[data-search-body]').innerText()),
    'searching "branding" returns no admin result');

  step(6, 'An administrator can still find an admin section by searching');
  // The index is built before /me answers, so this is the check that the
  // sections are pushed back in once the capabilities land.
  await openSettings(admin);
  await admin.click('[data-action="open-search"]');
  await admin.waitForSelector('[data-search-input]', { timeout: 5000 });
  await admin.fill('[data-search-input]', 'security policy');
  await admin.waitForTimeout(700);
  check(/Security policy/i.test(await admin.locator('[data-search-body]').innerText()),
    'searching "security policy" finds it for an administrator');
  await admin.keyboard.press('Escape');

  step(7, 'The Clients page hides the client-hub management menu from employees');
  await employee.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await employee.waitForTimeout(1200);
  const empHub = await employee.locator('[data-clients-page-actions] :text("Manage client hub")').count();
  check(empHub === 0, 'the "Manage client hub" dropdown is absent');
  const empCreate = await employee.locator('[data-clients-page-actions] :text("Create client")').count();
  check(empCreate > 0, 'the "Create client" dropdown is still there — employees still run the hub');

  step(8, 'An administrator keeps the client-hub management menu');
  await admin.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await admin.waitForTimeout(1200);
  check(await admin.locator('[data-clients-page-actions] :text("Manage client hub")').count() > 0,
    'the "Manage client hub" dropdown is present for an administrator');

  /* ── clients ────────────────────────────────────────────────────── */
  step(9, 'A client is offered their own settings and nothing else');
  const client = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await signIn(client, CLIENT);
  await openSettings(client);
  const clientSections = await railSections(client);
  const clientLeaked = ADMIN_ONLY.filter((id) => clientSections.includes(id));
  check(clientLeaked.length === 0, `no administration section is offered (leaked: ${clientLeaked.join(', ') || 'none'})`);
  check(PERSONAL.every((id) => clientSections.includes(id)),
    `their own settings are all still there (has: ${clientSections.join(', ')})`);

  step(10, 'A client can still change their own password');
  await openSettings(client, 'account-security');
  const secBody = await client.locator('.tma-portal-admin__content').innerText();
  check(/password/i.test(secBody), 'Account security still renders for a client');

  step(11, 'An administrator keeps the Users page, People and every client');
  const adminNav = await sidebarNav(admin);
  check(adminNav.includes('users'), '"Users" is still in the administrator sidebar');
  check(adminNav.includes('dash-project-overview'), '"Overview" is still there');
  check(adminNav.includes('people-employees'), 'People is still there');

  await admin.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('text=Rival Ltd', { timeout: 15000 }).catch(() => {});
  const adminClients = await admin.locator('body').innerText();
  check(/Acme Corp/.test(adminClients) && /Rival Ltd/.test(adminClients),
    'an administrator still sees every client');

  step(12, 'Searching for a colleague still works for both');
  // People results used to be read from /admin/users, which is now closed to
  // employees — the index has to fall back to the People directory or the
  // search box quietly stops finding anyone.
  // Both still find colleagues, by different routes, and that is correct: the
  // employee's hit comes from *messaging* search (`messaging.contactAll` is
  // still theirs, or they could not message anyone) and opens Messages. The
  // directory index they lost was the one that opened People / Users.
  for (const [who, page] of [['an employee', employee], ['an administrator', admin]]) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.click('[data-action="open-search"]');
    await page.waitForSelector('[data-search-input]', { timeout: 5000 });
    await page.fill('[data-search-input]', 'Test Admin');
    await page.waitForTimeout(1500);
    const hits = await page.locator('[data-search-body]').innerText();
    check(/Test Admin/i.test(hits), `${who} can still reach a colleague through search`);
    await page.keyboard.press('Escape');
  }

  step(13, 'Search does not hand an employee a client they are not assigned to');
  await employee.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await employee.waitForTimeout(1500);
  await employee.click('[data-action="open-search"]');
  await employee.waitForSelector('[data-search-input]', { timeout: 5000 });
  await employee.fill('[data-search-input]', 'Rival');
  await employee.waitForTimeout(1500);
  const rivalHits = await employee.locator('[data-search-body]').innerText();
  check(!/Rival Ltd/.test(rivalHits), '"Rival Ltd" is not offered');
  await employee.keyboard.press('Escape');

  await admin.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await admin.waitForTimeout(1500);
  await admin.click('[data-action="open-search"]');
  await admin.waitForSelector('[data-search-input]', { timeout: 5000 });
  await admin.fill('[data-search-input]', 'Rival');
  await admin.waitForTimeout(1500);
  check(/Rival Ltd/.test(await admin.locator('[data-search-body]').innerText()),
    'an administrator still finds it');
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await browser.close();
}

log('\n' + '─'.repeat(60));
if (failures.length) {
  log(`${failures.length} failure(s):`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('All checks passed.');
