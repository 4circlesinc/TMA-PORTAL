import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__messages-row');
await page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
await page.waitForTimeout(1800);

const row = page.locator('.tma-dash__messages-bubble-row--out').last();
await row.scrollIntoViewIfNeeded();
const box = await row.boundingBox();
console.log('row box:', JSON.stringify(box));

console.log('track present:', await row.locator('[data-messages-swipe-track]').count());
console.log('swipe attr:', await row.getAttribute('data-messages-swipe'));
console.log('bound flag:', await row.evaluate((el) => el.dataset.messagesSwipeBound || 'NOT BOUND'));

// Drag left (own message → swipe left to reply).
const y = box.y + box.height / 2;
const startX = box.x + box.width - 20;
await page.mouse.move(startX, y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(startX - i * 8, y, { steps: 1 });
  await page.waitForTimeout(20);
}
await page.waitForTimeout(150);
console.log('transform mid-drag:', await row.locator('[data-messages-swipe-track]').evaluate((el) => el.style.transform || 'none'));
await page.mouse.up();
await page.waitForTimeout(700);

console.log('reply preview after swipe:', await page.locator('.tma-dash__messages-reply-preview').count());
await browser.close();
