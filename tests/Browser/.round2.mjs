import { chromium } from 'playwright';
import { deflateSync } from 'node:zlib';
const BASE = process.env.TMA_BASE_URL;
function png(w,h){const t=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const x of b)c=t[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
const ch=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(ty,'ascii'),d]);const s=Buffer.alloc(4);s.writeUInt32BE(crc(b));return Buffer.concat([l,b,s]);};
const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
const raw=Buffer.alloc(h*(1+w*3));for(let y=0;y<h;y++){const r=y*(1+w*3);for(let x=0;x<w;x++){raw[r+1+x*3]=150;raw[r+2+x*3]=170;raw[r+3+x*3]=200;}}
return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),ch('IHDR',ih),ch('IDAT',deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const pdf=()=>Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

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

const out = {};
// ── the wizard layout ──
await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 30 && !(await page.locator('[data-head-dropdown-toggle]').count()); i++) await page.waitForTimeout(500);
const toggles = page.locator('[data-head-dropdown-toggle]');
for (let i = 0; i < await toggles.count(); i++) {
  if ((await toggles.nth(i).innerText()).includes('Create New Application')) { await toggles.nth(i).click(); break; }
}
await page.waitForTimeout(500);
await page.click('[data-head-dropdown-item="create-new"]');
await page.waitForSelector('[data-cip-form]', { state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);
out.layout = await page.evaluate(() => {
  const photo = document.querySelector('[data-cip-photo-btn="passportPhoto"]');
  const drops = document.querySelector('.tma-portal-drops');
  const grid = document.querySelector('.tma-portal-form-grid--person');
  const firstInput = document.querySelector('[data-cip-field="firstName"]');
  return {
    photo: photo ? { w: photo.offsetWidth, h: photo.offsetHeight } : null,
    dropCols: drops ? getComputedStyle(drops).gridTemplateColumns.split(' ').length : 0,
    personCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    inputFont: firstInput ? getComputedStyle(firstInput).fontSize : null,
  };
});
await page.screenshot({ path: 'tests/Browser/.wiz.png', fullPage: false });

// file it (photo+bio+birth) to get an application with a Passport drawer
await page.fill('[data-cip-field="firstName"]', 'Drawer');
await page.fill('[data-cip-field="lastName"]', 'Test');
await page.selectOption('[data-cip-field="gender"]', 'Male');
await page.fill('[data-cip-field="dateOfBirth"]', '1990-01-01');
await page.selectOption('[data-cip-field="countryOfBirth"]', 'Saint Lucia');
await page.selectOption('[data-cip-field="countryOfResidence"]', 'Saint Lucia');
await page.fill('[data-cip-field="occupation"]', 'Tester');
await page.fill('[data-cip-field="passportNumber"]', 'SL0000001');
await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
await page.selectOption('[data-cip-field="sponsored"]', '0');
await page.setInputFiles('[data-cip-photo="passportPhoto"]', { name: 'p.png', mimeType: 'image/png', buffer: png(600,600) });
await page.setInputFiles('[data-cip-file="passportBioPage"]', { name: 'bio.pdf', mimeType: 'application/pdf', buffer: pdf() });
await page.setInputFiles('[data-cip-file="birthCertificate"]', { name: 'birth.pdf', mimeType: 'application/pdf', buffer: pdf() });
await page.waitForTimeout(800);
const created = page.waitForResponse(r => r.url().includes('/portal/cip/applications') && r.request().method() === 'POST', { timeout: 30000 });
await page.click('[data-cip-save]');
const res = await created;
const body = await res.json().catch(()=>({}));
out.filed = { status: res.status(), number: body?.application?.number };
console.log(JSON.stringify(out, null, 1));
console.log('ERRS', JSON.stringify(errs));
await b.close();
