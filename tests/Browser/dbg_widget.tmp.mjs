import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

await page.goto('http://127.0.0.1:8899/auth/login', { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
await page.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const section = await page.evaluate(() => {
  const sec = document.querySelector('[aria-label="Recent files"]');
  return sec ? sec.outerHTML.slice(0, 1500) : 'NOT FOUND';
});
console.log('Recent files section HTML:\n', section);
console.log('\nConsole errors:', JSON.stringify(consoleErrors, null, 2));
await browser.close();
