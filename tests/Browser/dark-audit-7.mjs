/*
 * Dark-mode audit, part 7: masked-span icons. Masked icons paint via
 * background-color; a black paint on the dark theme is invisible. Flags any
 * visible element with a mask-image whose effective background luminance is
 * dark while dark mode is on. Also walks inline <svg> glyphs with dark
 * fill/stroke. AUDIT_OUT=<dir> node tests/Browser/dark-audit-7.mjs [pages...]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'overview', 'calendar', 'call-recordings', 'citizenship-applications',
  'email', 'email/templates', 'folders/all', 'folders/recent', 'folders/recycle',
  'people', 'people/employees', 'reporting', 'account', 'account-settings',
  'signatures', 'social/feed', 'social/messages',
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

const PROBE = () => {
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
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
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.width > 64 || r.height < 6 || r.height > 64) continue;
    if (r.bottom < 0 || r.top > innerHeight * 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const mask = cs.webkitMaskImage && cs.webkitMaskImage !== 'none' ? cs.webkitMaskImage : (cs.maskImage !== 'none' ? cs.maskImage : null);
    if (mask && /url\(/.test(mask)) {
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0.3 && lum(bg) < 0.35) {
        flags.push({ kind: 'mask', sel: path(el), paint: cs.backgroundColor, mask: mask.slice(0, 60) });
      }
      continue;
    }
    if (el.tagName === 'svg') {
      const fill = parse(cs.fill) || parse(cs.color);
      const hasStroke = cs.stroke && cs.stroke !== 'none';
      const stroke = hasStroke ? parse(cs.stroke) : null;
      const f = cs.filter === 'none' ? '' : cs.filter;
      if (/invert/.test(f)) continue;
      const darkFill = fill && lum(fill) < 0.3;
      const darkStroke = stroke && lum(stroke) < 0.3;
      if ((darkFill && !hasStroke) || (darkStroke && !fill) || (darkFill && darkStroke)) {
        flags.push({ kind: 'svg', sel: path(el), fill: cs.fill, stroke: cs.stroke });
      }
    }
  }
  return flags.slice(0, 80);
};

const report = {};
for (const p of PAGES) {
  try {
    await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const flags = await page.evaluate(PROBE);
    report[p] = flags;
    console.log(`${p}: masked/svg=${flags.length}`);
  } catch (e) { report[p] = { error: String(e).slice(0, 160) }; console.log(p, 'ERROR'); }
}
fs.writeFileSync(`${OUT}/dark-audit-7.json`, JSON.stringify(report, null, 2));
console.log('wrote dark-audit-7.json');
await browser.close();
