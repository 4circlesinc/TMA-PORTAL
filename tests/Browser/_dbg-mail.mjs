import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8931';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
console.log(JSON.stringify(await page.evaluate(async () => {
  const res = await fetch('/css/dashboard.css');
  const text = await res.text();
  const sheet = new CSSStyleSheet();
  await sheet.replace(text);
  // Walk for container rules mentioning front-actions.
  const hits = [];
  const walk = (rules, path) => {
    for (const r of rules) {
      const kind = r.constructor.name;
      if (r.cssRules) walk(r.cssRules, path + '>' + kind + '(' + (r.conditionText || '') + ')');
      else if (r.selectorText && r.selectorText.includes('front-actions')) hits.push(path + ' :: ' + r.selectorText + ' { ' + r.style.cssText + ' }');
    }
  };
  walk(sheet.cssRules, '');
  return { total: sheet.cssRules.length, hits };
}), null, 2));
await browser.close();
