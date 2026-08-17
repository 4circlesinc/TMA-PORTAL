import { chromium } from 'playwright';
const BASE = process.env.TMA_BASE_URL;
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 })).newPage();
const errs=[]; page.on('pageerror', e=>errs.push(String(e).slice(0,160)));
page.on('dialog', d => d.accept('Certificates'));
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation().catch(()=>{}), page.click('button[type="submit"]:visible')]);
await page.waitForTimeout(800);
if (page.url().includes('/auth/stay-signed-in')) { await Promise.all([page.waitForNavigation().catch(()=>{}), page.click('text=Yes, stay signed in')]); await page.waitForTimeout(800); }
const out = {};

// ── admin screen: checkbox + folder ──
await page.goto(`${BASE}/account-settings?settings-page=cip-documents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
out.adminRow = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Passport photo/.test(r.innerText));
  if (!row) return null;
  const box = row.querySelector('.tma-dash__check, [data-cipdoc-required]');
  return { text: row.innerText.replace(/\s+/g,' ').trim().slice(0,90),
           hasCheck: !!box, checked: box ? (box.getAttribute('aria-checked') || box.className.includes('checked') || box.checked) : null };
});
// untick birth certificate's required box → optional
out.toggle = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Birth certificate/.test(r.innerText));
  const box = row && row.querySelector('[data-cipdoc-required], .tma-dash__check');
  if (box) { box.click(); return true; } return false;
});
await page.waitForTimeout(2500);
out.afterToggle = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Birth certificate/.test(r.innerText));
  const box = row && row.querySelector('[data-cipdoc-required], .tma-dash__check');
  return box ? (box.getAttribute('aria-checked') || String(box.checked)) : null;
});
// set a folder on Medical certificate via the folder button (dialog answers "Certificates")
out.folderBtn = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Medical certificate/.test(r.innerText));
  const btn = row && row.querySelector('[data-cipdoc-folder]');
  if (btn) { btn.click(); return true; } return false;
});
await page.waitForTimeout(2500);
out.afterFolder = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find(r => /Medical certificate/.test(r.innerText));
  return row ? row.innerText.replace(/\s+/g,' ').trim().slice(0,110) : null;
});
await page.screenshot({ path: 'tests/Browser/.admin2.png', fullPage: false });

// ── detail tabs: the checklist reflects settings on read ──
await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: 60000 });
await page.waitForTimeout(2200);
await page.fill('[data-clients-search]', 'GAL26-00001');
await page.waitForFunction(() => document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length === 1, { timeout: 20000 });
await page.waitForTimeout(500);
await page.click('.tma-cip-table tbody tr[data-cip-open] td:first-child');
await page.waitForTimeout(3500);
await page.click('[data-clients-tab="applicant"]').catch(()=>{});
await page.waitForTimeout(1500);
out.detailChecklist = await page.evaluate(() =>
  [...document.querySelectorAll('.tma-dash__clients-checklist li')].map(li => li.innerText.replace(/\s+/g,' ').trim().slice(0,50)));
await page.screenshot({ path: 'tests/Browser/.detail2.png', fullPage: false });
out.errs = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
