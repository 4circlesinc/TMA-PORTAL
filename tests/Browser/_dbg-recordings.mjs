import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const OUT = '/private/tmp/claude-501/-Users-vernonfrancis-Github-TMA-PORTAL/64cd9ad0-9da5-43b2-921c-9fb32ed83099/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
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
await page.goto(`${BASE}/call-recordings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/_recordings-page.png` });
// open the detail modal
await page.click('.call-recordings__row').catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/_recordings-detail.png` });
// messages background + FAB
await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-messages-row]');
await page.click('[data-messages-row]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/_messages-page.png` });
await browser.close();
console.log('shots written');
