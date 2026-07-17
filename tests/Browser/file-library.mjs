import { chromium } from 'playwright';

// Drives the new File Library wiring in a real browser: an assigned client
// folder and an organization folder show up as labelled groups in the Folder
// Shortcuts sidebar tab, and the client profile's "Open folder" action lands
// in the File Library. Needs an administrator account. See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];
function step(n, m) { log(`\n[${n}] ${m}`); }
function check(ok, m) { log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

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

// Do the data setup through the same APIs the app uses, from the page context.
async function apiSetup(page, base, uid, name, org) {
  return page.evaluate(async ([base, uid, name, org]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };
    const j = (r) => r.json();
    await fetch(base + '/portal/clients', { method: 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify({ uid, name, profile: { firstName: name } }) });
    // Assign the signed-in admin to this client so it enters "Assigned Clients".
    const a = await fetch(base + '/portal/clients/' + uid + '/assignments', { credentials: 'same-origin', headers: h }).then(j);
    const me = (a.assignable || []).find((u) => u.email === 'e2e@example.com');
    await fetch(base + '/portal/clients/' + uid + '/assignments', { method: 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify({ userId: me.id, level: 'editor' }) });
    await fetch(base + '/portal/file-library/organization-folders', { method: 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify({ name: org, audience: 'all_staff', role: 'viewer' }) });
    return true;
  }, [base, uid, name, org]);
}

const ts = Date.now();
const NAME = 'Zeta ' + ts;
const UID = 'zeta-' + ts;
const ORG = 'QA Templates ' + ts;

const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'Log in and set up an assigned client + an organization folder');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await apiSetup(page, BASE, UID, NAME, ORG);

  step(2, 'Folder Shortcuts tab shows the labelled auto-groups');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('.tma-dash__sidebar .tma-dash__tab:has-text("Folder Shortcuts")');
  await page.waitForSelector('[data-shortcuts]', { timeout: 8000 });
  await page.waitForTimeout(800);

  const labels = await page.locator('[data-shortcuts] .tma-dash__group-label').allTextContents();
  log('    groups:', JSON.stringify(labels.map((s) => s.trim())));
  check(labels.some((l) => /Assigned Clients/i.test(l)), 'has an "Assigned Clients" group');
  check(labels.some((l) => /Organization Folders/i.test(l)), 'has an "Organization Folders" group');

  const shortcutText = await page.locator('[data-shortcuts]').innerText();
  check(shortcutText.includes(NAME), 'assigned client folder is listed by name');
  check(shortcutText.includes(ORG), 'organization folder is listed by name');

  step(3, 'Client profile has an Open-folder action that reaches the File Library');
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // Open this client's detail (search narrows the table first).
  await page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-clients-row]'))
      .find((r) => r.textContent.includes(n));
    if (row) row.click();
  }, NAME);
  await page.waitForTimeout(800);
  const openBtn = page.locator('[data-clients-open-folder]').first();
  check(await openBtn.count() > 0, 'profile shows an Open-folder action');
  if (await openBtn.count()) {
    await openBtn.click();
    await page.waitForTimeout(1000);
    const dash = page.locator('.tma-dash');
    const view = await dash.getAttribute('data-active-view').catch(() => null);
    const crumb = (await page.locator('.tma-dash__crumb, .tma-dash__page-title').allTextContents().catch(() => [])).join(' ');
    const inFiles = (view === 'folders') || /Folders|Files/i.test(crumb) || page.url().includes('/folders');
    check(inFiles, 'Open folder navigates into the File Library');
  }

  step(4, 'No unexpected console/page errors');
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
