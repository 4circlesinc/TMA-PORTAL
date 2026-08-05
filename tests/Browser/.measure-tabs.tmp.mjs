import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1440, height: 900 } });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
await page.waitForTimeout(1200);
if (page.url().includes('/auth/login')) { console.log('LOGIN FAILED'); process.exit(1); }

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const measure = async (label) => {
  const data = await page.evaluate(() => {
    const sb = document.querySelector('.tma-dash__sidebar');
    const tabs = document.querySelector('.tma-dash__tabs');
    const active = document.querySelector('.tma-dash__tab--active');
    const icon = document.querySelector('.tma-dash__nav-item .tma-dash__nav-icon');
    const item = document.querySelector('.tma-dash__nav-item');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), c: +((r.left + r.right) / 2).toFixed(1) }; };
    const cs = (el, ...props) => { if (!el) return null; const s = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, s[p]])); };
    return {
      root: document.querySelector('.tma-dash')?.className,
      sidebar: box(sb),
      tabsRow: box(tabs),
      activeTab: box(active),
      activeText: active?.textContent?.trim(),
      navIcon: box(icon),
      navItem: box(item),
      tabsStyle: cs(tabs, 'marginLeft', 'justifyContent', 'gap', 'display', 'width'),
      tabStyle: cs(active, 'paddingLeft', 'paddingRight', 'maxWidth', 'textOverflow'),
    };
  });
  const sb = data.sidebar, tabsRow = data.tabsRow, at = data.activeTab, ic = data.navIcon;
  console.log(`\n===== ${label} =====`);
  console.log('root class :', data.root);
  console.log('sidebar    :', JSON.stringify(sb));
  console.log('tabs row   :', JSON.stringify(tabsRow), data.tabsStyle && JSON.stringify(data.tabsStyle));
  console.log(`active tab : "${data.activeText}"`, JSON.stringify(at), data.tabStyle && JSON.stringify(data.tabStyle));
  console.log('nav icon   :', JSON.stringify(ic));
  if (sb && at) {
    const sbCenter = (sb.l + sb.r) / 2;
    console.log(`>> sidebar center ${sbCenter.toFixed(1)} | active-tab center ${at.c} | offset ${(at.c - sbCenter).toFixed(1)}px`);
  }
  if (sb && ic) {
    const sbCenter = (sb.l + sb.r) / 2;
    console.log(`>> nav-icon center ${ic.c} | offset from sidebar center ${(ic.c - sbCenter).toFixed(1)}px`);
  }
  if (at && ic) console.log(`>> tab center - icon center = ${(at.c - ic.c).toFixed(1)}px`);
};

await measure('EXPANDED');

// Collapse the rail.
const toggle = page.locator('[data-sidebar-toggle], .tma-dash__sidebar-toggle, [data-action="toggle-sidebar"]').first();
if (await toggle.count()) {
  await toggle.click();
  await page.waitForTimeout(900);
  await measure('COLLAPSED (rail)');
} else {
  console.log('\n(no sidebar toggle found — selectors tried: [data-sidebar-toggle], .tma-dash__sidebar-toggle, [data-action="toggle-sidebar"])');
  const cands = await page.evaluate(() => [...document.querySelectorAll('.tma-dash__sidebar button, .tma-dash button')].slice(0, 25).map(b => ({ cls: b.className, attrs: [...b.attributes].map(a => a.name + '=' + a.value).join(' ') })));
  console.log(JSON.stringify(cands, null, 1));
}

await page.screenshot({ path: '/private/tmp/claude-501/-Users-vernonfrancis-Github-TMA-PORTAL/5c4ce155-40d1-474d-b44b-a02e081bce42/scratchpad/sidebar.png', clip: { x: 0, y: 0, width: 320, height: 700 } });
await browser.close();
