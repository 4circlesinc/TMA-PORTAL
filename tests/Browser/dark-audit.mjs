/*
 * Dark-mode audit: walk every SPA page with the seeded dark-theme admin,
 * screenshot each, and report (a) text whose computed colour nearly matches
 * the background it sits on, and (b) large light-opaque boxes on the dark
 * page. Output: PNGs + issues JSON in the scratchpad dir given by AUDIT_OUT.
 *
 * Serve: throwaway SQLite on :8907 (see darkseed.php). Run:
 *   AUDIT_OUT=<dir> node tests/Browser/dark-audit.mjs [pages...]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';
const THEME = process.env.AUDIT_THEME || 'dark';
const ACCOUNT = process.env.AUDIT_ACCOUNT || 'e2e@example.com';
const PREFIX = process.env.AUDIT_PREFIX || ('dark' === THEME ? 'dark' : THEME);
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'overview', 'calendar', 'call-recordings', 'citizenship-applications',
  'email', 'email/templates',
  'folders/all', 'folders/clients', 'folders/personal', 'folders/shared',
  'folders/shared-with-me', 'folders/favorites', 'folders/recent',
  'folders/filebox', 'folders/recycle',
  'people', 'people/employees', 'people/clients', 'people/prospects',
  'people/shared-address-book', 'people/personal-address-book',
  'people/distribution-groups', 'people/resend-welcome-emails',
  'reporting', 'account', 'account-settings', 'signatures',
  'social/feed', 'social/messages',
  'templates', 'templates/email', 'templates/letters',
  'users', 'users/new', 'workflows', 'workflows/feedback', 'workflows/updates',
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth/i;
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) console.log('  pageerror:', String(e).slice(0, 200)); });

// force dark locally too, in case hydration is slow on first paint
await page.addInitScript((t) => { try { localStorage.setItem('tma.themeMode', t); } catch (e) {} }, THEME);

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', ACCOUNT);
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
if (page.url().includes('/auth/login')) throw new Error('login failed');
console.log('logged in ->', page.url());

const PROBE = () => {
  const out = [];
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const over = (top, under) => { // composite top onto opaque under
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const pageBg = parse(getComputedStyle(document.querySelector('.tma-dash') || document.body).backgroundColor) || [22, 22, 22, 1];
  const bgOf = (el) => {
    let acc = null; // stack of translucent bgs, top-down
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.99) { acc = c; break; } }
    }
    let bg = acc || pageBg;
    if (!acc) stack.push(pageBg);
    bg = stack.pop();
    while (stack.length) bg = over(stack.pop(), bg);
    return bg;
  };
  const contrast = (a, b) => { const l1 = lum(a) + 0.05, l2 = lum(b) + 0.05; return l1 > l2 ? l1 / l2 : l2 / l1; };
  const seen = new Set();
  const path = (el) => {
    const bits = [];
    for (let n = el; n && bits.length < 4 && n.nodeType === 1; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      const cls = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) s += '.' + cls;
      bits.unshift(s);
    }
    return bits.join(' > ');
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight * 3) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    // (b) big light opaque boxes
    const bgc = parse(cs.backgroundColor);
    if (document.documentElement.getAttribute('data-theme') === 'dark' && bgc && bgc[3] > 0.85 && lum(bgc) > 0.5 && r.width > 120 && r.height > 48) {
      const key = 'box:' + path(el);
      if (!seen.has(key)) { seen.add(key); out.push({ kind: 'light-box', sel: path(el), bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height) }); }
    }
    // (a) direct text with poor contrast
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasText) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const eff = fg[3] < 1 ? over(fg, bg) : fg;
    const ratio = contrast(eff, bg);
    if (ratio < 2.2) {
      const key = 'txt:' + path(el);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind: 'low-contrast', sel: path(el), text: el.textContent.trim().slice(0, 60), color: cs.color, bgUsed: `rgb(${bg.map(Math.round).join(',')})`, ratio: +ratio.toFixed(2) });
      }
    }
  }
  return { theme: (document.querySelector('.tma-dash') || {}).getAttribute?.('data-theme') || null, issues: out.slice(0, 120) };
};

const report = {};
for (const p of PAGES) {
  const slug = p.replace(/\//g, '-');
  try {
    await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const res = await page.evaluate(PROBE);
    report[p] = res;
    await page.screenshot({ path: `${OUT}/${PREFIX}-${slug}.png`, fullPage: false });
    console.log(`${p}: theme=${res.theme} issues=${res.issues.length}`);
  } catch (e) {
    report[p] = { error: String(e).slice(0, 200) };
    console.log(`${p}: ERROR ${String(e).slice(0, 120)}`);
  }
}
fs.writeFileSync(`${OUT}/${PREFIX}-audit.json`, JSON.stringify(report, null, 2));
console.log('wrote', `${OUT}/${PREFIX}-audit.json`);
await browser.close();
