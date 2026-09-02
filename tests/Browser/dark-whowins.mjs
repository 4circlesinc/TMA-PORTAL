/*
 * Debug helper: log in dark, goto a page, and for each "selector :: property"
 * passed via WHO env (semicolon-separated), enumerate every stylesheet rule
 * that matches the element and declares the property, in cascade order.
 * Usage: WHO='.tma-dash__header::background-color;.tma-tab__label::color' PAGE=overview node tests/Browser/dark-whowins.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const PAGE = process.env.PAGE || 'overview';
const WHO = (process.env.WHO || '').split(';').filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('tma.themeMode', 'dark'); } catch (e) {} });
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
}
await page.goto(`${BASE}/${PAGE}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

for (const q of WHO) {
  const [sel, prop] = q.split('::');
  const out = await page.evaluate(([sel, prop]) => {
    const el = document.querySelector(sel);
    if (!el) return ['NO ELEMENT ' + sel];
    const rows = ['computed ' + prop + ' = ' + getComputedStyle(el).getPropertyValue(prop)];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      const file = (sheet.href || 'inline').split('/').pop();
      const walk = (list, media) => {
        for (const r of list) {
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, r.media ? r.media.mediaText : media);
          if (!r.selectorText || !r.style) continue;
          const v = r.style.getPropertyValue(prop) || (prop.endsWith('-color') && r.style.getPropertyValue(prop.replace('-color', '')));
          if (!v) continue;
          try { if (!el.matches(r.selectorText)) continue; } catch (e) { continue; }
          rows.push(`${file}${media ? ' @media ' + media : ''} :: ${r.selectorText} { ${prop}: ${v}${r.style.getPropertyPriority(prop) ? ' !important' : ''} }`);
        }
      };
      walk(rules, '');
    }
    return rows;
  }, [sel, prop]);
  console.log('### ' + q);
  for (const r of out) console.log('  ' + r);
}
await browser.close();
