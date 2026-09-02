/* Dark audit 4: retry missed detail screens with looser selectors. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
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
console.log('logged in');

const report = {};
const shot = async (name) => {
  await page.waitForTimeout(1200);
  const res = await page.evaluate(PROBE);
  report[name] = res;
  await page.screenshot({ path: `${OUT}/dark4-${name}.png` });
  console.log(`${name}: issues=${res.issues.length}`);
};
const tryStep = async (name, fn) => {
  try { await fn(); await shot(name); } catch (e) { report[name] = { error: String(e).slice(0, 160) }; console.log(`${name}: ERROR ${String(e).slice(0, 140)}`); }
  await page.keyboard.press('Escape').catch(() => {});
};

await tryStep('user-detail', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.click('.tma-dash__users .tma-dash__ctr--body:has-text("Bea")', { timeout: 8000 });
  await page.waitForTimeout(1500);
});
await tryStep('template-editor', async () => {
  await page.goto(`${BASE}/templates`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.click('tr:has-text("Confirm email address") td', { timeout: 8000 });
  await page.waitForTimeout(2000);
});
await tryStep('reporting', async () => {
  await page.goto(`${BASE}/reporting`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
});
await tryStep('workflows-detail', async () => {
  await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});
fs.writeFileSync(`${OUT}/dark-audit-4.json`, JSON.stringify(report, null, 2));
await browser.close();
