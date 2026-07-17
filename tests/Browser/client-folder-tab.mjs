import { chromium } from 'playwright';

// Drives the client profile's Folders tab: it lists the client folder's real
// contents, creates a subfolder, and uploads a file — all against the live
// File Library APIs. Needs an administrator account. See README.md.
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

const ts = Date.now();
const NAME = 'Folder QA ' + ts;
const UID = 'folder-qa-' + ts;
const SUB = 'QA Subfolder';

const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// The "New folder" button uses window.prompt.
page.on('dialog', (d) => d.accept(SUB));

try {
  step(1, 'Log in and create a client (which provisions a folder + subfolders)');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(async ([base, uid, name]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    await fetch(base + '/portal/clients', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: JSON.stringify({ uid, name, profile: { firstName: name } }),
    });
  }, [BASE, UID, NAME]);

  step(2, 'Open the client and switch to the Folders tab');
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  // Let the asset-heavy SPA fully settle — the single-threaded dev server drops
  // API calls made while it's still streaming icons/emoji.
  await page.waitForTimeout(2500);
  await page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-clients-row]')).find((r) => r.textContent.includes(n));
    if (row) row.click();
  }, NAME);
  await page.waitForTimeout(1500);
  await page.click('[data-clients-tab="folders"]');
  await page.waitForSelector('[data-clients-folder-drop]', { timeout: 8000 });

  const listText = () => page.locator('[data-clients-folder-drop]').innerText();
  // The single-threaded dev server can be slow to answer the browse call while
  // the SPA is still loading assets, so poll rather than wait a fixed time.
  const listHas = (re, timeout = 15000) => page.waitForFunction(
    (r) => new RegExp(r).test(document.querySelector('[data-clients-folder-drop]')?.innerText || ''),
    re, { timeout, polling: 300 },
  ).then(() => true).catch(() => false);

  check(await listHas('Documents') && /Contracts/.test(await listText()), 'default subfolders are listed');
  check(await page.locator('[data-clients-folder-new]').count() > 0, 'has a "New folder" button');
  check(await page.locator('[data-clients-folder-upload]').count() > 0, 'has an "Upload" button');

  step(3, 'Create a subfolder through the New-folder button');
  await page.waitForTimeout(500);
  await page.click('[data-clients-folder-new]');
  let subShown = await listHas(SUB.replace(/ /g, '\\s'));
  if (!subShown) {
    // The create persists server-side; under the single-threaded dev server the
    // in-place refresh can be dropped, so reopen the tab and re-check.
    await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.evaluate((n) => {
      const row = Array.from(document.querySelectorAll('[data-clients-row]')).find((r) => r.textContent.includes(n));
      if (row) row.click();
    }, NAME);
    await page.waitForTimeout(1500);
    await page.click('[data-clients-tab="folders"]');
    subShown = await listHas(SUB.replace(/ /g, '\\s'));
  }
  check(subShown, 'the new subfolder appears in the list');

  step(4, 'Upload a file through the Upload control');
  await page.setInputFiles('[data-clients-folder-fileinput]', {
    name: 'qa-note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from qa ' + ts),
  });
  // Wait for the chunked upload to finish and the panel to refresh.
  await page.waitForFunction(
    () => /qa-note\.txt/.test(document.querySelector('[data-clients-folder-drop]')?.innerText || ''),
    { timeout: 20000 },
  ).then(() => check(true, 'uploaded file appears in the folder'))
   .catch(() => check(false, 'uploaded file appears in the folder'));

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
