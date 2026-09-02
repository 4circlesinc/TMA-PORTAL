// Scratch driver: screenshot the mobile/tablet responsive pass.
// Usage: TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/_scratch-responsive-check.mjs
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const OUT = process.env.TMA_SHOT_DIR || 'tests/Browser';

const browser = await chromium.launch();

async function login(page) {
  await page.goto(BASE + '/auth/login', { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(600);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

async function shoot(ctxName, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);

  // Dashboard / header
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/_scratch-resp-${ctxName}-home.png` });

  // CIP applications list
  await page.goto(BASE + '/citizenship-applications', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/_scratch-resp-${ctxName}-cip.png`, fullPage: false });

  // Open first application detail if a card is there
  const row = page.locator('.tma-cip-table tbody tr[data-cip-open]').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/_scratch-resp-${ctxName}-cip-detail.png` });
  }

  // Settings
  await page.goto(BASE + '/account-settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/_scratch-resp-${ctxName}-settings.png` });

  console.log(ctxName, 'errors:', errors.length ? errors : 'none');
  await context.close();
}

await shoot('phone', { width: 390, height: 844 });
await shoot('tablet', { width: 834, height: 1112 });
await browser.close();
