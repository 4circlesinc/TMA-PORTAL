/*
 * Dark-mode audit, part 6: camouflaged icons. For every visible <img> glyph,
 * draw it to a canvas and measure the mean luminance of its opaque pixels,
 * then apply the element's computed invert()/brightness() filters. A glyph
 * that ends up dark (<0.35) while dark mode is on is invisible ink — flag it.
 * Colored art (file-type badges, brand marks, avatars) passes untouched.
 *   AUDIT_OUT=<dir> node tests/Browser/dark-audit-6.mjs [pages...]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'overview', 'calendar', 'call-recordings', 'citizenship-applications',
  'email', 'email/templates', 'folders/all', 'folders/recent', 'folders/recycle',
  'people', 'people/employees', 'people/clients',
  'reporting', 'account', 'account-settings', 'signatures',
  'social/feed', 'social/messages',
  'templates', 'templates/email', 'templates/letters',
  'users', 'users/new', 'workflows', 'workflows/feedback', 'workflows/updates',
];

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
console.log('logged in');

const PROBE = async () => {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const pageBg = parse(getComputedStyle(document.querySelector('.tma-dash') || document.body).backgroundColor) || [22, 22, 22, 1];
  const groundLum = (el) => {
    const stack = [];
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.99) { acc = c; break; } }
    }
    if (!acc) stack.push(pageBg);
    let bg = stack.pop();
    while (stack.length) bg = over(stack.pop(), bg);
    return (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
  };
  const path = (el) => {
    const bits = [];
    for (let n = el; n && bits.length < 5 && n.nodeType === 1; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      const cls = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) s += '.' + cls;
      bits.unshift(s);
    }
    return bits.join(' > ');
  };
  const flags = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const img of document.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.width < 8 || r.width > 64 || r.height < 8 || r.height > 64) continue;
    if (r.bottom < 0 || r.top > innerHeight * 2) continue;
    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (!img.complete || !img.naturalWidth) continue;
    // mean luminance of opaque pixels
    let lum;
    try {
      canvas.width = Math.min(img.naturalWidth, 48);
      canvas.height = Math.min(img.naturalHeight, 48);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 64) continue;
        sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        n++;
      }
      if (!n) continue;
      lum = sum / n;
    } catch (e) { continue; } // cross-origin: skip
    // apply computed filter chain (invert/brightness only, good enough)
    const filter = cs.filter === 'none' ? '' : cs.filter;
    let eff = lum;
    for (const [, fn, arg] of filter.matchAll(/(invert|brightness)\(([\d.]+)\)/g)) {
      const v = parseFloat(arg);
      if (fn === 'invert') eff = eff * (1 - v) + (1 - eff) * v;
      if (fn === 'brightness') eff = Math.min(1, eff * v);
    }
    const ground = groundLum(img);
    // linearize both scalars, then WCAG-ish ratio; camouflage = low contrast
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const le = lin(eff), lg = lin(ground);
    const cr = (Math.max(le, lg) + 0.05) / (Math.min(le, lg) + 0.05);
    if (cr < 2.0) {
      flags.push({ sel: path(img), src: (img.getAttribute('src') || '').slice(0, 80), eff: +eff.toFixed(2), ground: +ground.toFixed(2), filter: filter || 'none' });
    }
  }
  return flags;
};

const report = {};
for (const p of PAGES) {
  try {
    await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const flags = await page.evaluate(PROBE);
    report[p] = flags;
    console.log(`${p}: dark-icons=${flags.length}`);
  } catch (e) { report[p] = { error: String(e).slice(0, 160) }; console.log(p, 'ERROR'); }
}
fs.writeFileSync(`${OUT}/dark-audit-6.json`, JSON.stringify(report, null, 2));
console.log('wrote dark-audit-6.json');
await browser.close();
