// The per-field settings must be findable, not just present. See README.md.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: parseInt(process.env.VW||'1500',10), height: parseInt(process.env.VH||'950',10) } });
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
await page.waitForTimeout(4200);

const controls = async (tag) => console.log(tag, JSON.stringify({
  sizeSlider: !!(await page.$('[data-sig-field-size]')),
  align: (await page.$$('[data-sig-field-align]')).length,
  hint: (await page.textContent('.tma-portal-sig-wizard__assign-note').catch(()=>null)),
}));

await controls('[1] before placing anything:');
await page.click('[data-sig-field="name"]');
await page.waitForTimeout(900);
await controls('[2] right after placing a field:');

// Deselect by clicking empty document space.
await page.click('[data-sig-page-host="0"]', { position: { x: 60, y: 60 } });
await page.waitForTimeout(700);
await controls('[3] after deselecting:');

// Reselect
await page.click('[data-sig-placed]');
await page.waitForTimeout(700);
await controls('[4] after clicking the field again:');

// Save, leave, and reopen the draft: controls must be there without hunting.
await page.click('[data-sig-wizard-next]');
await page.waitForTimeout(1800);
await page.click('text=Previous step');
await page.waitForTimeout(4200);
await controls('[5] after save + reopening the editor:');

// The real question: are they on screen without hunting?
// The panel must scroll on its own, without moving the document.
const scrolls = await page.evaluate(() => {
  const body = document.querySelector('.tma-portal-sig-wizard__fields-body');
  const pane = document.querySelector('[data-sig-canvas-scroll]');
  const docBefore = pane.scrollTop;
  body.scrollTop = body.scrollHeight;
  return {
    panelScrolled: body.scrollTop > 0,
    panelScrollable: body.scrollHeight > body.clientHeight,
    documentMoved: pane.scrollTop !== docBefore,
    toolsAboveCards: (() => {
      const t = document.querySelector('.tma-portal-sig-wizard__fields-tools');
      const c = document.querySelector('.tma-portal-sig-wizard__field-list');
      if (!t || !c) return null;
      return t.getBoundingClientRect().top < c.getBoundingClientRect().top;
    })(),
  };
});
console.log('[7] panel scroll independent of the document:', JSON.stringify(scrolls));

// Back to the top so the visibility check reflects a fresh selection.
await page.evaluate(() => { document.querySelector('.tma-portal-sig-wizard__fields-body').scrollTop = 0; });

const vis = await page.evaluate(() => {
  const out = {};
  const inView = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  };
  out.sizeSlider = inView('[data-sig-field-size]');
  out.alignRight = inView('[data-sig-field-align="right"]');
  const foot = document.querySelector('.tma-portal-sig-wizard__fields-foot');
  out.footScrolls = foot ? foot.scrollHeight > foot.clientHeight : null;
  return out;
});
console.log('[6] visible without scrolling:', JSON.stringify(vis));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
console.log('errors:', errs.length ? errs : 'none');

await b.close();
