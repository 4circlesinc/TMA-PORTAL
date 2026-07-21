import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8899/auth/login', { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);

const result = await page.evaluate(async () => {
  const r = await fetch('/portal/files/?section=recent&perPage=24', { headers: { Accept: 'application/json' } });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 3000) };
});
console.log('STATUS:', result.status);
console.log('BODY:', result.body);
await browser.close();
