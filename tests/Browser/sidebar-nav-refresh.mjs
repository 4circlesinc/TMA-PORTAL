/*
 * Sidebar navigation + refresh.
 *
 * Four behaviours that only exist in a browser:
 *
 * 1. Opening a submenu must not change the spacing of the rows around it. The
 *    rail spreads itself to the window's height (dashboard.js fitNavSpacing),
 *    and it used to pay for an open submenu by squeezing every other row.
 * 2. A collapsed rail has no room for a submenu, so a group icon must go
 *    straight to the section's first page instead of toggling a hidden list.
 * 3. Re-selecting the page you are already on refetches it.
 * 4. Pull-to-refresh: a touch drag from the top of the content refetches the
 *    same way. Driven through CDP because Playwright's mouse API cannot
 *    produce touch events.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE || 'http://127.0.0.1:8912';
const TOLERANCE_PX = 0.75;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  hasTouch: true,
});
const page = await context.newPage();
const failures = [];

function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

/* ── sign in ─────────────────────────────────────── */
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
// Login lands on the stay-signed-in interstitial, not the portal.
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('text=Yes, stay signed in'),
  ]);
}
if (page.url().includes('/auth/login')) throw new Error('login failed');
await page.waitForSelector('[data-expand="folders"]', { timeout: 20000 });
await page.waitForTimeout(1200);

// Park the pointer clear of the sidebar: the hover-overlay style expands over
// the left strip and would answer for the collapsed rail.
await page.mouse.move(1400, 500);

/* ── 1. submenu must not compress the menu ───────── */
async function railGeometry() {
  return page.evaluate(() => {
    const rows = ['dash-dashboard', 'dash-project-overview', 'clients', 'cbi', 'email']
      .map((id) => document.querySelector(`.tma-dash__sidebar [data-nav="${id}"]`))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect().top);
    const gaps = rows.slice(1).map((top, i) => top - rows[i]);
    const nav = document.querySelector('.tma-dash__sidebar-nav');
    return {
      gaps,
      gap: getComputedStyle(nav).getPropertyValue('--dash-nav-gap').trim(),
      dashboardTop: rows[0],
    };
  });
}

// Standard style, expanded rail: the layout the complaint was about.
await page.evaluate(() => {
  const root = document.querySelector('.tma-dash');
  root.classList.add('tma-dash--sidebar-standard');
  root.classList.remove('is-sidebar-collapsed');
  localStorage.setItem('tma.sidebarStyle', 'standard');
  localStorage.setItem('tma.sidebarCollapsed', '0');
});
await page.waitForTimeout(400);

const closed = await railGeometry();
await page.click('[data-expand="folders"]');
await page.waitForTimeout(500);
const opened = await railGeometry();
const subnavOpen = await page.isVisible('[data-subnav="folders"] [data-nav="folders-all"]');

check('submenu opens', subnavOpen);
check(
  'row spacing unchanged with a submenu open',
  closed.gaps.every((g, i) => Math.abs(g - opened.gaps[i]) <= TOLERANCE_PX),
  `${JSON.stringify(closed.gaps)} vs ${JSON.stringify(opened.gaps)}`
);
check(
  'nav gap variable unchanged',
  closed.gap === opened.gap,
  `${closed.gap} vs ${opened.gap}`
);

// A second group open must not move things either.
await page.click('[data-expand="people"]');
await page.waitForTimeout(500);
const twoOpen = await railGeometry();
check(
  'row spacing unchanged with two submenus open',
  closed.gaps.every((g, i) => Math.abs(g - twoOpen.gaps[i]) <= TOLERANCE_PX),
  `${JSON.stringify(closed.gaps)} vs ${JSON.stringify(twoOpen.gaps)}`
);

await page.click('[data-expand="folders"]');
await page.click('[data-expand="people"]');
await page.waitForTimeout(300);

/* ── 2. collapsed rail navigates to the default page ─ */
await page.evaluate(() => {
  const root = document.querySelector('.tma-dash');
  root.classList.add('tma-dash--sidebar-standard', 'is-sidebar-collapsed');
  localStorage.setItem('tma.sidebarCollapsed', '1');
});
await page.mouse.move(1400, 500);
await page.waitForTimeout(300);

await page.click('[data-expand="folders"]');
await page.waitForTimeout(1500);
check(
  'collapsed File Library opens All Files',
  new URL(page.url()).pathname === '/folders/all',
  page.url()
);
check(
  'All Files is the active row',
  await page.evaluate(() => !!document.querySelector('[data-nav="folders-all"].tma-dash__nav-item--active'))
);

await page.click('[data-expand="people"]');
await page.waitForTimeout(1500);
check(
  'collapsed People opens its first page',
  new URL(page.url()).pathname === '/people',
  page.url()
);

/* ── 3. re-selecting the current page refetches ──── */
const calls = [];
page.on('request', (r) => calls.push(r.url()));

function since(mark, fragment) {
  return calls.slice(mark).filter((u) => u.includes(fragment)).length;
}

// Back to an expanded rail so the leaf rows are clickable.
await page.evaluate(() => {
  document.querySelector('.tma-dash').classList.remove('is-sidebar-collapsed');
  localStorage.setItem('tma.sidebarCollapsed', '0');
});
await page.click('[data-nav="clients"]');
await page.waitForTimeout(2500);

let mark = calls.length;
await page.click('[data-nav="clients"]');
await page.waitForTimeout(2500);
check(
  'clicking Client hub again refetches clients',
  since(mark, '/portal/clients') > 0,
  `${since(mark, '/portal/clients')} requests`
);

await page.click('[data-nav="users"]');
await page.waitForTimeout(2500);
mark = calls.length;
await page.click('[data-nav="users"]');
await page.waitForTimeout(2500);
check(
  'clicking Users again refetches users',
  since(mark, '/admin/users') > 0,
  `${since(mark, '/admin/users')} requests`
);

/* ── 4. pull to refresh ──────────────────────────── */
await page.click('[data-nav="clients"]');
await page.waitForTimeout(2500);

const cdp = await context.newCDPSession(page);
const start = await page.evaluate(() => {
  const main = document.querySelector('.tma-dash__main');
  main.scrollTop = 0;
  const r = main.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 60) };
});

mark = calls.length;
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: start.x, y: start.y }],
});
for (let i = 1; i <= 12; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x, y: start.y + i * 20 }],
  });
  await page.waitForTimeout(20);
}
const indicator = await page.evaluate(() => {
  const el = document.querySelector('[data-pull-refresh]');
  if (!el) return null;
  const s = getComputedStyle(el);
  return { opacity: parseFloat(s.opacity), transform: s.transform, ready: el.classList.contains('tma-pull-refresh--ready') };
});
check('pull shows the indicator', !!indicator && indicator.opacity > 0.5, JSON.stringify(indicator));
check('pull past the threshold arms the refresh', !!indicator && indicator.ready);

await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchEnd',
  touchPoints: [],
});
await page.waitForTimeout(2500);
check(
  'pull to refresh refetches the page data',
  since(mark, '/portal/clients') > 0,
  `${since(mark, '/portal/clients')} requests`
);
check(
  'the indicator hides again',
  await page.evaluate(() => {
    const el = document.querySelector('[data-pull-refresh]');
    return !el || parseFloat(getComputedStyle(el).opacity) < 0.05;
  })
);

// A short drag is a scroll, not a refresh.
mark = calls.length;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
for (let i = 1; i <= 3; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + i * 8 }] });
  await page.waitForTimeout(20);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(1500);
check(
  'a short drag does not refresh',
  since(mark, '/portal/clients') === 0,
  `${since(mark, '/portal/clients')} requests`
);

await page.screenshot({ path: 'tests/Browser/sidebar-nav-refresh.png' });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
