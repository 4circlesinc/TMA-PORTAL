// Fields panel scrolling + the date-format picker. See README.md.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const b = await chromium.launch();
// Short viewport, like the screenshot: this is where the panel overflows.
const page = await b.newPage({ viewport: { width: 1400, height: 720 } });
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}).catch(()=>{}), page.click('button[type="submit"]:visible')]);
await page.waitForTimeout(700);
if (page.url().includes('login-code')) {
  const code = execSync(`grep -oE '>[0-9]{6}<' storage/logs/laravel.log | tail -1 | tr -d '><'`).toString().trim();
  await page.click('[data-otp] input:not([type=hidden])').catch(()=>{});
  await page.keyboard.type(code, { delay: 40 });
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}).catch(()=>{}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(800);
}
if (page.url().includes('stay-signed-in')) {
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}).catch(()=>{}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(800);
}
await page.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('[data-sig-new-dropdown] [data-head-dropdown-toggle]');
await page.waitForTimeout(250);
await page.click('[data-sig-new-dropdown] [data-head-dropdown-item="send"]');
await page.waitForTimeout(1000);
(await page.$$('[data-sig-pick]'))[0].click();
await page.click('[data-sig-new-create]');
await page.waitForTimeout(1000);
await page.fill('[data-sig-r-name="0"]', 'Vernon Francis');
await page.fill('[data-sig-r-email="0"]', 'vf@example.com');
await page.click('[data-sig-wizard-next]');
await page.waitForTimeout(4200);
await page.click('[data-sig-field="date"]');
await page.waitForTimeout(900);

const body = await page.$eval('.tma-portal-sig-wizard__fields-body', el => ({
  scrollable: el.scrollHeight > el.clientHeight,
  overflowY: getComputedStyle(el).overflowY,
}));
console.log('[1] body scrolls:', JSON.stringify(body));

// Scroll the body to the bottom; the heading must stay put.
const headBefore = await page.$eval('.tma-portal-sig-wizard__fields-title', el => Math.round(el.getBoundingClientRect().top));
await page.$eval('.tma-portal-sig-wizard__fields-body', el => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(500);
const headAfter = await page.$eval('.tma-portal-sig-wizard__fields-title', el => Math.round(el.getBoundingClientRect().top));
console.log('[2] "Fields" heading top before/after scroll:', headBefore, headAfter, '-> stayed =', headBefore === headAfter);
console.log('[3] alignment buttons visible after scroll:', await page.$eval('[data-sig-field-align="right"]', el => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}));

// Date format picker
const sel = await page.$('[data-sig-field-date-format]');
console.log('[4] date format picker present:', !!sel);
if (sel) {
  console.log('    options:', await sel.$$eval('option', os => os.map(o => o.textContent.trim())));
  const readDate = () => page.$eval('[data-sig-placed] .tma-portal-sig-field__value', el => el.textContent);
  console.log('[5] default preview:', JSON.stringify(await readDate()));
  await sel.selectOption({ index: 3 });
  await page.waitForTimeout(700);
  console.log('[6] after choosing ISO:', JSON.stringify(await readDate()));
}

await b.close();
