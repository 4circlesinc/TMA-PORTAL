// Drives continuous page scrolling in the signature editor. See README.md.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
const noise = t => t.includes('realtime disabled') || t.includes('Origin not allowed');
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type()==='error' && !noise(m.text())) errs.push('console: '+m.text()); });

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
await page.waitForTimeout(4500);

const sheets = await page.$$('[data-sig-page-host]');
console.log('[1] page sheets rendered:', sheets.length, '(fixture PDF has 2)');

const painted = await page.$$eval('[data-sig-canvas]', cs => cs.map(c => {
  const d = c.getContext('2d').getImageData(0,0,c.width,Math.min(c.height,300)).data;
  let ink = 0; for (let i=0;i<d.length;i+=4) if (d[i]<200||d[i+1]<200||d[i+2]<200) ink++;
  return { w: c.width, ink };
}));
console.log('[2] each page painted:', JSON.stringify(painted));

const pane = await page.$('[data-sig-canvas-scroll]');
const info = await pane.evaluate(el => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
console.log('[3] pane scrollable:', JSON.stringify(info), 'scrollable =', info.scrollH > info.clientH);

// Scroll down to page 2 and confirm the rail follows.
await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(900);
console.log('[4] active thumb after scrolling to bottom:', await page.$$eval('[data-sig-page]', bs => bs.findIndex(b => b.classList.contains('is-active'))));

// Click thumbnail 1 -> should scroll back up, not re-render.
await page.click('[data-sig-page="0"]');
await page.waitForTimeout(1400);
console.log('[5] scrollTop after clicking page 1 thumb:', await pane.evaluate(el => Math.round(el.scrollTop)));

// Place a field on page 2 by dropping onto its layer.
const layer2 = await page.$('[data-sig-field-layer="1"]');
await layer2.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
const box = await layer2.boundingBox();
await page.click('[data-sig-field="name"]');
await page.waitForTimeout(900);
const pages = await page.$$eval('[data-sig-placed]', els => els.map(e => e.closest('[data-sig-page-host]').getAttribute('data-sig-page-host')));
console.log('[6] placed field landed on page index:', JSON.stringify(pages));


console.log('errors:', errs.length ? errs : 'none');
await b.close();
