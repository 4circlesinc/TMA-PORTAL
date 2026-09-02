/* Dark audit 5: mobile viewport, classic shell, standalone pages, legal, 404. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('tma.themeMode', 'dark'); } catch (e) {} });

const PROBE_SRC = fs.readFileSync('tests/Browser/dark-audit.mjs', 'utf8');
const PROBE = new Function('return (' + PROBE_SRC.split('const PROBE = ')[1].split(';\n\nconst report')[0] + ')')();

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
}
console.log('logged in (mobile)');

const report = {};
const shot = async (name) => {
  await page.waitForTimeout(1500);
  const res = await page.evaluate(PROBE);
  report[name] = res;
  await page.screenshot({ path: `${OUT}/dark5-${name}.png` });
  console.log(`${name}: issues=${(res.issues || []).length}`);
};

for (const p of ['overview', 'calendar', 'folders/all', 'social/messages', 'email', 'users', 'account-settings']) {
  try {
    await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded' });
    await shot('m-' + p.replace(/\//g, '-'));
  } catch (e) { report['m-' + p] = { error: String(e).slice(0, 160) }; console.log(p, 'ERROR'); }
}

// mobile main menu (tabbar "Menu")
try {
  await page.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('.tma-dash__tab-btn[data-tab="menu"], .tma-dash__tabbar >> text=Menu');
  await shot('m-tabbar-menu');
} catch (e) { console.log('tabbar menu ERROR', String(e).slice(0, 100)); }

// desktop-size: classic + standalone + legal + 404
const page2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
await page2.addInitScript(() => { try { localStorage.setItem('tma.themeMode', 'dark'); } catch (e) {} });
// reuse session cookies
const cookies = await ctx.cookies();
await page2.context().addCookies(cookies);
for (const p of ['classic', 'account-info', 'privacy-policy', 'terms-of-service', 'definitely-not-a-page']) {
  try {
    await page2.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(1800);
    const res = await page2.evaluate(PROBE);
    report[p] = res;
    await page2.screenshot({ path: `${OUT}/dark5-${p.replace(/\//g, '-')}.png` });
    console.log(`${p}: issues=${(res.issues || []).length}`);
  } catch (e) { report[p] = { error: String(e).slice(0, 160) }; console.log(p, 'ERROR', String(e).slice(0, 100)); }
}
fs.writeFileSync(`${OUT}/dark-audit-5.json`, JSON.stringify(report, null, 2));
await browser.close();
