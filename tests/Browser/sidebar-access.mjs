import { chromium } from 'playwright';

/*
 * Two things PHPUnit cannot see, both in the sidebar.
 *
 * 1. Folder Shortcuts icon box. A shortcut with no custom stamp renders the
 *    folder as a bare <img> carrying BOTH .tma-folder-icon__base (width:100%)
 *    and .tma-dash__nav-icon (a fixed box). portal-files.css loads after
 *    dashboard.css, so at equal specificity the 100% won and the folder grew
 *    to the full width of the sidebar. Only a computed box catches that.
 *
 * 2. Role gating. A client must not be offered Clients/Users/Email/Feed, and
 *    a staff account must keep them — including the sidebar's own tab row and
 *    shortcuts list, which an over-eager prune once deleted for everyone.
 *
 * Needs three seeded accounts (Administrator, Employee, Client). See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const failures = [];
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
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  // "Stay signed in?" sits in front of the whole portal — every request
  // redirects here until it is answered, including the JSON APIs, which is
  // why an unanswered gate shows up as HTML where JSON was expected.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(400);
  }
}

// Create a client, assign the signed-in user to it, and add an org folder —
// the two groups from the screenshot ("Assigned Clients", "Organization
// Folders"). Run as an administrator.
async function seedFolders(page, uid, name, org) {
  return page.evaluate(async ([base, uid, name, org]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };
    await fetch(base + '/portal/clients', { method: 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify({ uid, name, profile: { firstName: name } }) });
    const a = await fetch(base + '/portal/clients/' + uid + '/assignments', { credentials: 'same-origin', headers: h }).then((r) => r.json());
    for (const u of (a.assignable || [])) {
      await fetch(base + '/portal/clients/' + uid + '/assignments', { method: 'POST', credentials: 'same-origin', headers: h,
        body: JSON.stringify({ userId: u.id, level: 'editor' }) });
    }
    await fetch(base + '/portal/file-library/organization-folders', { method: 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify({ name: org, audience: 'all_staff', role: 'viewer' }) });
    return true;
  }, [BASE, uid, name, org]);
}

/* A fresh account opens on the collapsed 72px rail, where the tab labels are
   visibility:hidden. On desktop the toggle button is hidden and the rail
   expands on hover instead (the "Hover Overlay" sidebar style), so drive it
   the way a person would — and keep the pointer there, because the CSS is
   `:not(:has(.tma-dash__sidebar:hover, :focus-within))`. */
async function expandSidebar(page) {
  await page.hover('.tma-dash__sidebar');
  await page.waitForTimeout(500);
}

async function openShortcuts(page) {
  await expandSidebar(page);
  await page.click('.tma-dash__sidebar .tma-dash__tab:has-text("Folder Shortcuts")');
  await page.waitForSelector('[data-shortcuts]', { timeout: 8000 });
  await page.waitForTimeout(900);
}

// The computed box of every folder icon in the shortcuts shelf.
async function shortcutIconBoxes(page) {
  return page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('[data-shortcuts] .tma-dash__nav-item--shortcut .tma-dash__nav-icon'),
    (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }
  ));
}

const ts = Date.now();
const NAME = 'Zeta ' + ts;
const UID = 'zeta-' + ts;
const ORG = 'QA Templates ' + ts;

try {
  /* ── staff ─────────────────────────────────────────────────────── */
  const admin = await browser.newPage();
  await admin.setViewportSize({ width: 1440, height: 900 });

  step(1, 'Administrator: seed an assigned client folder + an organization folder');
  await signIn(admin, 'e2e@example.com');
  await admin.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(600);
  await seedFolders(admin, UID, NAME, ORG);

  step(2, 'Employee: the Folder Shortcuts shelf renders at icon size');
  const emp = await browser.newPage();
  await emp.setViewportSize({ width: 1440, height: 900 });
  await signIn(emp, 'emp@example.com');
  await emp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await emp.waitForTimeout(700);

  check(await emp.locator('.tma-dash__sidebar .tma-dash__tab:has-text("Folder Shortcuts")').count() > 0,
    'the sidebar still has its Main Menu / Folder Shortcuts tab row');

  await openShortcuts(emp);
  const labels = (await emp.locator('[data-shortcuts] .tma-dash__group-label').allTextContents()).map((s) => s.trim());
  log('    groups:', JSON.stringify(labels));
  check(labels.some((l) => /Assigned Clients/i.test(l)), 'has an "Assigned Clients" group');
  check(labels.some((l) => /Organization Folders/i.test(l)), 'has an "Organization Folders" group');

  const boxes = await shortcutIconBoxes(emp);
  log('    icon boxes:', JSON.stringify(boxes));
  check(boxes.length > 0, 'shortcut rows actually rendered folder icons');
  // The bug produced a folder as wide as the sidebar (~250px+). The box is
  // 20px on desktop; allow a little slack rather than pinning the exact token.
  check(boxes.every((b) => b.w > 0 && b.w <= 32 && b.h > 0 && b.h <= 32),
    'every folder icon sits in a nav-icon-sized box (<=32px), not full width');
  check(boxes.every((b) => Math.abs(b.w - b.h) <= 1), 'folder icons stay square');

  // The label has to survive next to the icon — the giant art pushed it out.
  const firstRow = emp.locator('[data-shortcuts] .tma-dash__nav-item--shortcut').first();
  check((await firstRow.innerText()).trim().length > 0, 'the shortcut row still shows its folder name');

  step(3, 'Employee: staff nav is intact');
  for (const nav of ['clients', 'email', 'users', 'so-feed']) {
    check(await emp.locator(`.tma-dash__sidebar [data-nav="${nav}"]`).count() > 0, `employee keeps [data-nav="${nav}"]`);
  }

  /* ── client ────────────────────────────────────────────────────── */
  step(4, 'Client: the staff nav is gone but their own sidebar works');
  const cli = await browser.newPage();
  await cli.setViewportSize({ width: 1440, height: 900 });
  await signIn(cli, 'client@example.com');
  await cli.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await cli.waitForTimeout(900);

  for (const nav of ['clients', 'email', 'users', 'so-feed', 'dash-project-overview', 'templates']) {
    check(await cli.locator(`.tma-dash__sidebar [data-nav="${nav}"]`).count() === 0, `client does not see [data-nav="${nav}"]`);
  }
  for (const nav of ['dash-dashboard', 'so-messages', 'calendar', 'signatures', 'account-settings']) {
    check(await cli.locator(`.tma-dash__sidebar [data-nav="${nav}"]`).count() > 0, `client keeps [data-nav="${nav}"]`);
  }

  check(await cli.locator('.tma-dash__sidebar .tma-dash__tab:has-text("Folder Shortcuts")').count() > 0,
    'client keeps the Folder Shortcuts tab row');
  check(await cli.locator('.tma-dash__sidebar .tma-dash__profile').count() > 0,
    'client keeps the sidebar profile block');

  // The hold CSS must have been released, or the whole nav stays invisible.
  check(await cli.evaluate(() => document.documentElement.getAttribute('data-tma-access')) === 'ready',
    'the access hold was released (nav is visible, not stuck hidden)');

  step(5, 'Client: the Folder Shortcuts shelf is sane');
  await openShortcuts(cli);
  const cliBoxes = await shortcutIconBoxes(cli);
  log('    icon boxes:', JSON.stringify(cliBoxes));
  check(cliBoxes.every((b) => b.w > 0 && b.w <= 32 && b.h > 0 && b.h <= 32),
    'any client folder icon is nav-icon sized too');
  const shelf = (await cli.locator('[data-shortcuts]').innerText()).trim();
  log('    shelf:', JSON.stringify(shelf.slice(0, 120)));
  check(!/Organization Folders/i.test(shelf), 'client is not offered the organization folders');

  /* ── the collapsed rail ────────────────────────────────────────── */
  step(6, 'Employee: icons keep their box in the collapsed rail');
  // Move the pointer off the sidebar and it falls back to the 72px rail —
  // where an unconstrained folder would be even more obvious.
  await emp.mouse.move(1200, 600);
  await emp.waitForTimeout(700);
  const railBoxes = await shortcutIconBoxes(emp);
  log('    icon boxes:', JSON.stringify(railBoxes));
  check(railBoxes.every((b) => b.w > 0 && b.w <= 32 && b.h > 0 && b.h <= 32),
    'collapsed rail keeps folder icons at icon size');
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})\n - ` + failures.join('\n - ') : 'All checks passed'));
process.exit(failures.length ? 1 : 0);
