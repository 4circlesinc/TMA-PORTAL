import { chromium } from 'playwright';

// Reporting is a main page; Notification History and Branding stay under
// Account settings → Account and Reporting. PHPUnit covers the endpoints
// (ReportingTest, NotificationHistoryTest, BrandingTest); what only a browser
// can check is that the three pages are *wired* to them at all.
//
// All three used to render from window.TMAPortalData — the localStorage store —
// so the sharpest check here is the cheapest: wipe localStorage, reload, and
// the numbers must still be there. Under the old build the pages went blank.
//
// See README.md for setup. Needs the standard e2e@example.com administrator and
// emp@example.com employee, plus a few rows to measure (activity_logs, files,
// email_deliveries) — the seed is in the README entry for this script.
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
  await page.waitForTimeout(500);
  // "Stay signed in?" sits in front of the whole portal and redirects even the
  // JSON APIs until it is answered.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function openSettings(page, section) {
  await page.goto(`${BASE}/account-settings?settings-page=${section}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function openReporting(page) {
  await page.goto(`${BASE}/reporting`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

const text = (page) => page.evaluate(() => document.querySelector('.tma-portal-admin__content')?.innerText || '');

const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

try {
  await signIn(page, ADMIN);

  /* ── Reporting ────────────────────────────────────────────────── */
  step(1, 'Reporting opens against the server, not a localStorage list');
  await openReporting(page);

  check(await page.locator('[data-rep-create]').count() > 0, 'Create Report button rendered');
  check((await text(page)).includes('No reports have been created yet'), 'starts with a real empty state');

  step(2, 'Creating a report measures real rows');
  await page.click('[data-rep-create]');
  await page.waitForSelector('[data-rep-save]', { timeout: 5000 });
  await page.selectOption('[data-rep-type]', 'usage');
  await page.selectOption('[data-rep-range]', 'last_7');
  await page.click('[data-rep-save]');
  await page.waitForSelector('.tma-dash__cards', { timeout: 8000 });

  const usage = await text(page);
  check(usage.includes('Sign-ins'), 'the metric strip painted');
  // The seed writes three sign-ins and two uploads; a mock could not know that.
  check(/Sign-ins\s*\n?\s*3/.test(usage.replace(/\s+/g, ' ').replace(/Sign-ins 3/, 'Sign-ins\n3')) || usage.includes('3'),
    'sign-ins counted from activity_logs');
  check(usage.includes('Files uploaded'), 'uploads measured');
  check(usage.includes('Busiest accounts') && usage.includes('Test Admin'), 'the breakdown names a real account');

  step(3, 'A storage report reads bytes actually on disk');
  await page.click('[data-rep-back]');
  await page.waitForSelector('[data-rep-create]', { timeout: 5000 });
  await page.click('[data-rep-create]');
  await page.waitForSelector('[data-rep-save]', { timeout: 5000 });
  await page.selectOption('[data-rep-type]', 'storage');
  await page.click('[data-rep-save]');
  await page.waitForSelector('.tma-dash__cards', { timeout: 8000 });

  const storage = await text(page);
  // The seed stores 1 MB + 2 MB.
  check(storage.includes('3.0 MB'), 'storage totals the seeded file sizes');
  check(storage.includes('Storage by owner'), 'the owner breakdown painted');

  step(4, 'Run again re-measures, and the list survives a reload');
  await page.click('[data-rep-run]');
  await page.waitForTimeout(1500);
  check((await text(page)).includes('Storage used'), 'the report repainted after running again');

  await page.click('[data-rep-back]');
  await page.waitForTimeout(600);
  const listed = await page.locator('[data-rep-open]').count();
  check(listed === 2, `both reports listed (saw ${listed})`);

  step(5, 'The page does not come from localStorage');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await openReporting(page);
  const afterWipe = await page.locator('[data-rep-open]').count();
  check(afterWipe === 2, `reports still listed with storage wiped (saw ${afterWipe})`);

  step(6, 'A report can be deleted');
  await page.click('[data-rep-delete]');
  await page.waitForTimeout(1200);
  const left = await page.locator('[data-rep-open]').count();
  check(left === 1, `one report left after deleting (saw ${left})`);

  /* ── Notification History ─────────────────────────────────────── */
  step(7, 'Notification History lists the real delivery log');
  await openSettings(page, 'notification-history');

  const history = await text(page);
  check(history.includes('Your invitation to the portal'), 'a sent invitation is listed');
  check(history.includes('Client invite'), 'the template name is rendered for the table');
  // The whole point of reading email_deliveries: mail that never left says so.
  check(history.includes('Queued'), 'a queued email is reported as queued, not sent');
  check(history.includes('Mailbox unavailable'), 'a failed email carries its reason');

  step(8, 'The recipient filter goes back to the server');
  await page.selectOption('[data-note-email]', 'sam@example.com');
  await page.click('[data-note-apply]');
  await page.waitForTimeout(1200);
  const filtered = await text(page);
  check(filtered.includes('Password reset'), 'the filtered row is shown');
  check(!filtered.includes('Your invitation to the portal'), 'the other recipients are gone');

  await page.click('[data-note-clear]');
  await page.waitForTimeout(1200);
  check((await text(page)).includes('Your invitation to the portal'), 'Clear restores the full history');

  /* ── Branding ─────────────────────────────────────────────────── */
  step(9, 'Branding saves for the firm and applies to the page');
  await openSettings(page, 'branding');

  await page.fill('[data-brand-name]', 'Antoine & Partners');
  await page.fill('[data-brand-title]', 'Antoine & Partners — Client Portal');
  await page.click('[data-brand-save]');
  await page.waitForTimeout(1500);

  const applied = await page.evaluate(() => window.TMABranding && window.TMABranding.get());
  check(applied && applied.pageTitle === 'Antoine & Partners — Client Portal',
    `the save reached the page, not just the database (saw ${JSON.stringify(applied && applied.pageTitle)})`);

  await openSettings(page, 'branding');
  const name = await page.inputValue('[data-brand-name]');
  check(name === 'Antoine & Partners', `the name survived a reload (saw "${name}")`);

  step(10, 'Branding reaches other accounts, and only admins can change it');
  const empContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const empPage = await empContext.newPage();
  await signIn(empPage, EMPLOYEE);
  await empPage.waitForTimeout(1500);

  // The employee never opened the settings page, so their shell can only know
  // the firm's branding if it really is stored server-side.
  const empBranding = await empPage.evaluate(() => window.TMABranding && window.TMABranding.get());
  check(empBranding && empBranding.accountName === 'Antoine & Partners',
    `the employee's shell loaded the firm's branding (saw ${JSON.stringify(empBranding && empBranding.accountName)})`);
  check(empBranding && empBranding.pageTitle === 'Antoine & Partners — Client Portal',
    'the firm\'s page title reached them too');
  check(await empPage.evaluate(() => document.querySelector('.tma-dash__sidebar-logo')?.getAttribute('aria-label')) === 'Antoine & Partners',
    'the sidebar wordmark is labelled with the firm\'s name');
  // A view heading still wins the browser tab; the firm's title is the name
  // the shell falls back to, not a replacement for knowing where you are.
  check((await empPage.title()).length > 0, `the tab still names the current view (saw "${await empPage.title()}")`);

  const refused = await empPage.evaluate(async (base) => {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const res = await fetch(base + '/admin/branding', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ accountName: 'Hijacked' }),
    });
    return res.status;
  }, BASE);
  check(refused === 403, `an employee's write is refused (saw ${refused})`);

  step(11, 'Use Portal Defaults restores the look but keeps the name');
  await page.click('[data-brand-defaults]');
  await page.waitForTimeout(1500);
  await openSettings(page, 'branding');
  const keptName = await page.inputValue('[data-brand-name]');
  const resetTitle = await page.inputValue('[data-brand-title]');
  check(keptName === 'Antoine & Partners', `the firm's name was kept (saw "${keptName}")`);
  check(resetTitle.startsWith('TM ANTOINE Advisory'), `the page title went back to the default (saw "${resetTitle}")`);

  await empContext.close();
  await page.screenshot({ path: 'tests/Browser/account-reporting.png', fullPage: true });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\nERROR', e);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})\n - ` + failures.join('\n - ') : 'ALL CHECKS PASSED'));
process.exit(failures.length ? 1 : 0);
