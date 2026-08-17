import { chromium } from 'playwright';
const BASE = process.env.TMA_BASE_URL;
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 })).newPage();
const errs=[]; page.on('pageerror', e=>errs.push(String(e).slice(0,160)));
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation().catch(()=>{}), page.click('button[type="submit"]:visible')]);
await page.waitForTimeout(800);
if (page.url().includes('/auth/stay-signed-in')) { await Promise.all([page.waitForNavigation().catch(()=>{}), page.click('text=Yes, stay signed in')]); await page.waitForTimeout(800); }
await page.goto(`${BASE}/account-settings?settings-page=cip-documents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Medical certificate/.test(r.innerText));
  row.querySelector('[data-cipdoc-folder]').click();
});
await page.waitForTimeout(900);
const modal = await page.evaluate(() => {
  const pick = document.querySelector('[data-cipdoc-folder-pick]');
  return { options: pick ? [...pick.options].map(o => o.text) : null,
           note: document.querySelector('.tma-portal-note')?.innerText.slice(0,120) };
});
await page.selectOption('[data-cipdoc-folder-pick]', '__new__');
await page.waitForTimeout(300);
await page.fill('[data-cipdoc-folder-name]', 'Certificates');
await page.click('[data-cipdoc-folder-save]');
await page.waitForTimeout(2500);
const row = await page.evaluate(() => {
  const r = [...document.querySelectorAll('tr')].find(x => /Medical certificate/.test(x.innerText));
  return r ? r.innerText.replace(/\s+/g,' ').trim().slice(0,120) : null;
});
await page.screenshot({ path: 'tests/Browser/.admin3.png', fullPage: false });
console.log(JSON.stringify({ modal, row, errs }, null, 1));
await b.close();
