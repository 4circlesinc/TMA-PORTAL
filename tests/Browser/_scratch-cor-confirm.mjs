import { chromium } from 'playwright';

/*
 * As the PROVIDER CONTACT: the application stands at Apply for COR with
 * canConfirm true. Does the screen offer Confirm submission, and does the
 * press lock the COR package?
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => log('PAGEERROR:', e.message));
page.on('response', async (r) => {
  if (r.url().includes('/confirm') && r.request().method() === 'POST') {
    log('CONFIRM RESPONSE', r.status(), (await r.text().catch(() => '')).slice(0, 300));
  }
});

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'prov@example.com');
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
log('signed in as provider contact, at', page.url());

await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tests/Browser/_scratch-prov-list.png', fullPage: true });

// open their application
const row = page.locator('.tma-cip-table__row:visible, tr:visible', { hasText: 'GAL26' }).first();
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: 'tests/Browser/_scratch-prov-app.png', fullPage: true });

const confirmBtn = page.locator('[data-cip-confirm]:visible');
log('confirm buttons visible:', await confirmBtn.count());
const note = await page.locator('.tma-dash__clients-appbar-note:visible').allTextContents().catch(() => []);
log('appbar notes:', JSON.stringify(note));

if (await confirmBtn.count()) {
  await confirmBtn.first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/Browser/_scratch-prov-dialog.png' });
  const save = page.locator('[data-cip-save-confirm]:visible');
  log('dialog save button:', await save.count());
  if (await save.count()) {
    await save.click();
    await page.waitForTimeout(2500);
    log('pressed confirm');
  }
}

await browser.close();
