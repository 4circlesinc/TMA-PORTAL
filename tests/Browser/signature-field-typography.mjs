// Drives the field typography controls in the signature editor. See README.md.
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

// New draft
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
await page.fill('[data-sig-r-email="0"]', 'bart@example.com');
await page.click('[data-sig-wizard-next]');
await page.waitForTimeout(4200);

// Place a Full name field: it should show the REAL name, not a label.
await page.click('[data-sig-field="name"]');
await page.waitForTimeout(700);
await page.click('[data-sig-field="date"]');
await page.waitForTimeout(700);
await page.click('[data-sig-field="email"]');
await page.waitForTimeout(900);

const read = () => page.evaluate(() => {
  const v = document.querySelector('[data-sig-placed] .tma-portal-sig-field__value');
  const lbl = document.querySelector('[data-sig-placed] .tma-portal-sig-field__label');
  const box = document.querySelector('[data-sig-placed]');
  return {
    valueText: v ? v.textContent : null,
    labelShown: !!lbl,
    fontPx: v ? v.style.fontSize : null,
    textAlign: v ? v.style.textAlign : null,
    overflows: v && box ? (v.scrollWidth > box.clientWidth) : null,
  };
});

console.log('[1] after placing name field:', JSON.stringify(await read()));
console.log('[2] size slider present:', !!(await page.$('[data-sig-field-size]')));
console.log('[3] align buttons:', (await page.$$('[data-sig-field-align]')).length);

// Bigger text
const slider = await page.$('[data-sig-field-size]');
await slider.evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); });
await page.waitForTimeout(800);
console.log('[4] after size -> 20pt:', JSON.stringify(await read()));
console.log('    pt label:', await page.textContent('[data-sig-field-size-label]').catch(()=>null));

// Right align
await page.click('[data-sig-field-align="right"]');
await page.waitForTimeout(700);
console.log('[5] after right align:', JSON.stringify(await read()));

// Persist: next step saves, then come back
await page.click('[data-sig-wizard-next]');
await page.waitForTimeout(1800);
await page.click('[data-sig-wizard-back]').catch(async () => { await page.click('text=Previous step'); });
await page.waitForTimeout(4000);
console.log('[6] after save + return:', JSON.stringify(await read()));

// Select the name field so the typography panel is on screen.
const boxes = await page.$$('[data-sig-placed]');
await boxes[0].click();
await page.waitForTimeout(700);
const align = await page.$('[data-sig-field-align="center"]');
await align.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await align.click();
await page.waitForTimeout(600);
console.log('[7] centre align applied:', await page.evaluate(() => {
  const v = document.querySelector('[data-sig-placed].is-selected .tma-portal-sig-field__value');
  return v ? v.style.textAlign : null;
}));

console.log('errors:', errs.length ? errs : 'none');
await b.close();
