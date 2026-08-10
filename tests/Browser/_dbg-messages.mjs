import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('text=Yes, stay signed in'),
  ]);
}
await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(3000);
const rows = await page.locator('.tma-dash__messages-row').count();
console.log('rows:', rows);
const navBtns = await page.locator('.tma-dash__messages-nav-btn').allTextContents();
console.log('nav:', JSON.stringify(navBtns));
await page.screenshot({ path: '/private/tmp/claude-501/-Users-vernonfrancis-Github-TMA-PORTAL/64cd9ad0-9da5-43b2-921c-9fb32ed83099/scratchpad/_messages-debug.png' });
await browser.close();
