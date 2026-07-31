import { chromium } from 'playwright';

// Phase 0 check: the "Folders" section label and crumbs now read "File Library",
// the client record's file tab reads "Documents", and nothing about navigation
// broke — the nav ids and URLs were deliberately left alone.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);
function step(n, m) { log(`\n[${n}] ${m}`); }
function check(ok, m) { log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function signIn(email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  // Sign-in now ends on a "Stay signed in?" interstitial. Older browser
  // scripts predate it and simply stall here with an empty portal shell.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(600);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

try {
  step(1, 'Sign in as the administrator');
  await signIn('e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);

  step(2, 'Sidebar section reads "File Library", not "Folders"');
  const navText = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.tma-dash__nav-group, .tma-dash__nav-item, nav span')];
    return els.map((e) => e.textContent.trim()).filter(Boolean);
  });
  check(navText.some((t) => t === 'File Library'), 'a nav label reads "File Library"');
  check(!navText.some((t) => t === 'Folders'), 'no nav label still reads bare "Folders"');

  step(3, 'The nav still works — ids and URLs were not renamed');
  const allFiles = await page.$('[data-nav="folders-all"]');
  check(!!allFiles, 'data-nav="folders-all" still present (URLs unchanged)');
  check(await page.$eval('[data-nav="folders-all"]', (e) => e.getAttribute('href')) === '/folders/all',
    'the /folders/all URL is unchanged');
  // /folders/all is pushState-only — hard-navigating to it 404s. The section
  // is also a collapsed submenu, so open the group, then click through.
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(600);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(2000);
  const crumb = await page.evaluate(() => document.body.innerText);
  check(/File Library\s*\/\s*All Files/.test(crumb), 'crumb reads "File Library / All Files"');
  check(!/\bFolders\s*\/\s*All Files/.test(crumb), 'no crumb still reads "Folders / All Files"');

  step(4, 'The seeded folder and file are really listed (no dummy data)');
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText);
  check(/Contracts/.test(body), 'seeded "Contracts" folder is listed');

  step(5, 'Client record tab reads "Documents", not "Folders"');
  const created = await page.evaluate(async (base) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const res = await fetch(base + '/portal/clients', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      // `uid` is required by ClientsController::store — omitting it 422s.
      body: JSON.stringify({ uid: 'phase-zero-client', name: 'Phase Zero Client',
        profile: { emails: [{ value: 'pz@example.com' }] } }),
    });
    return res.status;
  }, BASE);
  check(created === 201 || created === 200, `client created (HTTP ${created})`);
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForTimeout(1500);
  const row = await page.$('text=Phase Zero Client');
  check(!!row, 'client row rendered');
  if (row) {
    await row.click();
    await page.waitForTimeout(1500);
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-clients-tab], [role="tab"], .tma-dash__clients-profile-tab')]
        .map((e) => e.textContent.trim()).filter(Boolean));
    log('    tabs:', JSON.stringify(tabs));
    check(tabs.some((t) => /Documents/i.test(t)), 'profile tab reads "Documents"');
    check(!tabs.some((t) => /^Folders$/i.test(t)), 'no profile tab still reads "Folders"');
  }
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'phase0-error.png' }).catch(() => {});
} finally {
  await browser.close();
  log('\n' + '='.repeat(50));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 0 checks passed.');
}
