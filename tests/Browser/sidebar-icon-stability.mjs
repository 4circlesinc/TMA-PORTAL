/*
 * Hover-sidebar icon stability (Instagram-style).
 *
 * Place the pointer over each rail icon while collapsed, expand the sidebar
 * without moving the pointer, and assert the icon's screen box did not move.
 * Labels/width may change; the icon column must not.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE || 'http://127.0.0.1:8899';
const TOLERANCE_PX = 1.5;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');

await page.waitForSelector('.tma-dash__sidebar [data-nav="calendar"]', { timeout: 20000 });

// Force hover style + collapsed rail (default), and clear any stuck hover.
await page.evaluate(() => {
  const root = document.querySelector('.tma-dash');
  root.classList.remove('tma-dash--sidebar-standard');
  root.classList.add('is-sidebar-collapsed');
  localStorage.setItem('tma.sidebarStyle', 'hover');
});
await page.mouse.move(1400, 500);
await page.waitForTimeout(350);

const targets = [
  { key: 'dash-dashboard', sel: '[data-nav="dash-dashboard"] .tma-dash__nav-icon, [data-nav="dash-dashboard"] .tma-dash__nav-icon-wrap' },
  { key: 'dash-project-overview', sel: '[data-nav="dash-project-overview"] .tma-dash__nav-icon, [data-nav="dash-project-overview"] .tma-dash__nav-icon-wrap' },
  { key: 'clients', sel: '[data-nav="clients"] .tma-dash__nav-icon, [data-nav="clients"] .tma-dash__nav-icon-wrap' },
  { key: 'email', sel: '[data-nav="email"] .tma-dash__nav-icon, [data-nav="email"] .tma-dash__nav-icon-wrap' },
  { key: 'so-messages', sel: '[data-nav="so-messages"] .tma-dash__nav-icon, [data-nav="so-messages"] .tma-dash__nav-icon-wrap' },
  { key: 'so-feed', sel: '[data-nav="so-feed"] .tma-dash__nav-icon, [data-nav="so-feed"] .tma-dash__nav-icon-wrap' },
  { key: 'calendar', sel: '[data-nav="calendar"] .tma-dash__nav-icon, [data-nav="calendar"] .tma-dash__nav-icon-wrap' },
  { key: 'signatures', sel: '[data-nav="signatures"] .tma-dash__nav-icon, [data-nav="signatures"] .tma-dash__nav-icon-wrap' },
  { key: 'folders', sel: '[data-expand="folders"] .tma-dash__nav-icon, [data-expand="folders"] .tma-dash__nav-icon-wrap' },
  { key: 'users', sel: '[data-nav="users"] .tma-dash__nav-icon, [data-nav="users"] .tma-dash__nav-icon-wrap' },
  { key: 'projects', sel: '[data-expand="projects"] .tma-dash__nav-icon, [data-expand="projects"] .tma-dash__nav-icon-wrap' },
  { key: 'workflows', sel: '[data-expand="workflows"] .tma-dash__nav-icon, [data-expand="workflows"] .tma-dash__nav-icon-wrap' },
  { key: 'logo', sel: '.tma-dash__sidebar-logo' },
  { key: 'tabs-row', sel: '.tma-dash__nav-section--tabs' },
  { key: 'profile-avatar', sel: '.tma-dash__profile-avatar' },
  // Logout sits on the trailing edge and may travel horizontally as the
  // rail widens; only its vertical position must stay put.
  { key: 'logout', sel: '[data-sidebar-profile-action="logout"]', allowX: true },
];

function boxOf(sel) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
}

const failures = [];

// Structural: logo box height must not change on expand.
const logoCollapsed = await boxOf('.tma-dash__sidebar-logo');
await page.hover('.tma-dash__sidebar');
await page.waitForTimeout(450);
const logoExpanded = await boxOf('.tma-dash__sidebar-logo');
await page.mouse.move(1400, 500);
await page.waitForTimeout(350);

if (!logoCollapsed || !logoExpanded) {
  failures.push('logo box missing');
} else if (Math.abs(logoCollapsed.h - logoExpanded.h) > TOLERANCE_PX) {
  failures.push(`logo height changed: ${logoCollapsed.h.toFixed(1)} → ${logoExpanded.h.toFixed(1)}`);
} else {
  console.log(`  ✓ logo height stable (${logoCollapsed.h.toFixed(1)}px)`);
}

// Content must not shift (overlay expand).
const mainBefore = await boxOf('.tma-dash__main');
await page.hover('.tma-dash__sidebar');
await page.waitForTimeout(450);
const mainAfter = await boxOf('.tma-dash__main');
await page.mouse.move(1400, 500);
await page.waitForTimeout(350);
if (mainBefore && mainAfter && Math.abs(mainBefore.x - mainAfter.x) > TOLERANCE_PX) {
  failures.push(`main content shifted: x ${mainBefore.x.toFixed(1)} → ${mainAfter.x.toFixed(1)}`);
} else {
  console.log('  ✓ main content x stable (overlay)');
}

for (const t of targets) {
  await page.mouse.move(1400, 500);
  await page.waitForTimeout(300);

  const before = await boxOf(t.sel);
  if (!before) {
    console.log(`  ⚠ skip ${t.key} (not in DOM)`);
    continue;
  }

  // Hover the icon itself so expansion is triggered from that point.
  const handle = await page.$(t.sel);
  if (!handle) {
    console.log(`  ⚠ skip ${t.key} (no handle)`);
    continue;
  }
  const bb = await handle.boundingBox();
  if (!bb) {
    console.log(`  ⚠ skip ${t.key} (no box)`);
    continue;
  }

  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(500);

  const after = await boxOf(t.sel);
  if (!after) {
    failures.push(`${t.key} disappeared after expand`);
    continue;
  }

  const dx = Math.abs(after.x - before.x);
  const dy = Math.abs(after.y - before.y);
  const ok = (t.allowX || dx <= TOLERANCE_PX) && dy <= TOLERANCE_PX;
  console.log(
    `  ${ok ? '✓' : '✗'} ${t.key}: Δx=${dx.toFixed(2)} Δy=${dy.toFixed(2)}` +
      ` (${before.x.toFixed(1)},${before.y.toFixed(1)} → ${after.x.toFixed(1)},${after.y.toFixed(1)})`
  );
  if (!ok) {
    failures.push(`${t.key} moved by Δx=${dx.toFixed(2)} Δy=${dy.toFixed(2)}`);
  }

  await page.mouse.move(1400, 500);
  await page.waitForTimeout(300);
}

// Calendar click-through: expand under the pointer, click, land on calendar.
await page.mouse.move(1400, 500);
await page.waitForTimeout(300);
const calIcon = await page.$('[data-nav="calendar"] .tma-dash__nav-icon, [data-nav="calendar"] .tma-dash__nav-icon-wrap');
const calBox = calIcon && (await calIcon.boundingBox());
if (calBox) {
  await page.mouse.move(calBox.x + calBox.width / 2, calBox.y + calBox.height / 2);
  await page.waitForTimeout(500);
  await Promise.all([
    page.waitForURL(/\/calendar/, { timeout: 8000 }).catch(() => null),
    page.mouse.click(calBox.x + calBox.width / 2, calBox.y + calBox.height / 2),
  ]);
  const onCal = page.url().includes('/calendar');
  console.log(`  ${onCal ? '✓' : '✗'} calendar click-through after expand`);
  if (!onCal) failures.push('clicking calendar icon after expand did not open Calendar');
}

await browser.close();

if (failures.length) {
  console.error('\nFAIL:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK — sidebar icons stay fixed through hover expand.');
