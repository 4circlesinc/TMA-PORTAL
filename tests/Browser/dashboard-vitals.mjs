// Core Web Vitals for the portal dashboard, measured in a real Chromium.
//
// The dashboard paints a skeleton and then swaps in each tile's rows as its
// data lands. Whatever moves in that swap is what the browser scores as
// cumulative layout shift, and a lab number is the only way to know whether
// a change to the skeleton or the rows made the board steadier. This script
// signs in once, keeps the browser's signed-in state on disk so the emailed
// sign-in code is only needed the first time, then loads the dashboard a few
// times in fresh pages and reports CLS, LCP, TTFB, the bundle fetch and the
// script time for each run, with the medians.
//
// Run:  node tests/Browser/dashboard-vitals.mjs
//   BASE=http://localhost:8001   the portal to measure
//   EMAIL / PASSWORD             the account (admin@localhost / password12345)
//   RUNS=3                       how many dashboard loads
//   AB=none | rows               rows: serve the stylesheet with every
//                                "min-height:58px" removed, which is the
//                                dashboard as it was before the rows were
//                                given the skeleton's height. The repo is
//                                not touched; the stylesheet is rewritten
//                                on its way into the browser.
//
// The browser cache is cleared before each run, because the bundle is served
// immutable and every run after the first would otherwise be a cache hit.
// The server stays warm; this compares builds, it does not measure a first
// visit to a cold server. The stylesheet goes through the same route handler
// in both modes so the two are not separated by the cost of interception.
//
// A first sign-in from a new browser asks for an emailed code. Locally that
// email goes to the app container's stdout, so the script reads it from
// `docker compose logs`. This is a report, not an assertion: it exits 0 once
// it has printed and exits 1 only when it could not sign in.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://localhost:8001').replace(/\/$/, '');
const EMAIL = process.env.EMAIL || 'admin@localhost';
const PASSWORD = process.env.PASSWORD || 'password12345';
const RUNS = Math.max(1, parseInt(process.env.RUNS || '3', 10) || 3);
const AB = process.env.AB || 'none';
const SETTLE_MS = 6000;
const VIEWPORT = { width: 1440, height: 900 };
const ROW_RULE = 'min-height:58px';

if (!['none', 'rows'].includes(AB)) {
  console.error(`AB must be "none" or "rows", not "${AB}"`);
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const STATE_DIR = path.join(HERE, '.state');
const STATE_FILE = path.join(STATE_DIR, `${EMAIL}.json`);
const rel = (p) => path.relative(REPO, p);

/* ── Sign-in ──────────────────────────────────────────────────────────── */

// The code is in the sign-in email, and the local stack writes mail to the
// container's stdout. On this Docker Desktop the log reader is unsound past
// a point: --since returns nothing although the daemon timestamps are right,
// and a tail much beyond a few thousand lines comes back as an old slice of
// the file. A 4000 line tail is read instead, which is the last dozen or so
// emails, and they are told apart by their Date header. The template carries
// "000000" placeholders of its own, so only a code that is not that counts,
// and the last one in an email wins.
function newestCodeEmail(service) {
  let out = '';
  try {
    out = execFileSync('docker', ['compose', 'logs', '--tail', '4000', '--no-log-prefix', service], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const marker = 'Subject: Your sign-in code';
  const at = out.lastIndexOf(marker);
  if (at < 0) return null;
  const mail = out.slice(at).split('\n').slice(0, 120).join('\n');
  const codes = [...mail.matchAll(/(?:>|^\s*)(\d{6})(?:<\/td>|\s*$)/gm)]
    .map((m) => m[1])
    .filter((c) => c !== '000000');
  if (!codes.length) return null;
  const date = (mail.match(/^Date: (.+)$/m) || [])[1] || '';
  return { code: codes[codes.length - 1], date };
}

const newestCode = () => newestCodeEmail('app') || newestCodeEmail('queue');

// The server sends a fresh code unless one went out in the last 30 s, in
// which case the earlier code is still the live one for ten minutes. So:
// wait a while for an email newer than the one seen before the password
// was submitted, and failing that take the newest there is.
async function enterEmailedCode(page, seenBefore) {
  const isNew = (m) => m && !(seenBefore && m.code === seenBefore.code && m.date === seenBefore.date);
  const deadline = Date.now() + 20_000;
  let mail = newestCode();
  while (!isNew(mail) && Date.now() < deadline) {
    await page.waitForTimeout(1500);
    mail = newestCode();
  }
  if (!mail) throw new Error('no sign-in code email in `docker compose logs app`; the code is only readable from the container\'s stdout');
  if (!isNew(mail)) console.log(`no new code email within 20 s; trying the newest one (${mail.date || 'undated'})`);

  const digits = page.locator('.tma-auth__otp-digit');
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(mail.code[i]);
  await page.locator('input[name="trust_device"]').check();
  // A right code can still end on this page when the server fails while
  // completing the sign-in, and that is a different report from a refusal.
  let posted = null;
  const onResponse = (r) => { if (r.request().method() === 'POST' && r.url().includes('/auth/login-code')) posted = r.status(); };
  page.on('response', onResponse);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}),
    page.click('form[data-tfa-form] button[type="submit"]'),
  ]);
  page.off('response', onResponse);
  if (posted && posted >= 500) {
    throw new Error(`POST /auth/login-code answered ${posted} for code ${mail.code}; read the app container's log for the exception`);
  }
  if (page.url().includes('/auth/login-code')) {
    const why = await page.locator('[role="alert"]').first().textContent().catch(() => '');
    throw new Error(`the sign-in code ${mail.code} was refused${why ? ': ' + why.trim() : ''}`);
  }
}

// The code page and the stay-signed-in page can come in either order, and
// either can be skipped, so this settles whatever the server puts in front
// of the dashboard.
async function settleAuthPages(page, seenBefore) {
  for (let hop = 0; hop < 5; hop++) {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const url = page.url();
    if (url.includes('/auth/login-code')) {
      await enterEmailedCode(page, seenBefore);
      continue;
    }
    if (url.includes('/auth/stay-signed-in')) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}),
        page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
      ]);
      continue;
    }
    return;
  }
}

async function signInFresh(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  const seenBefore = newestCode();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await settleAuthPages(page, seenBefore);
  if (page.url().includes('/auth/')) {
    const why = await page.locator('.tma-auth__error, [role="alert"]').first().textContent().catch(() => '');
    throw new Error(`still on ${page.url()} after signing in as ${EMAIL}${why ? ': ' + why.trim() : ''}`);
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  await context.storageState({ path: STATE_FILE });
  await page.close();
  return { context, how: `signed in with the password and emailed code; state saved to ${rel(STATE_FILE)}` };
}

// Saved state carries the session, the remember-me cookie and the trusted
// device cookie, so a later run skips the code. Proof that it still works is
// landing on the dashboard rather than the sign-in page.
async function signedInContext(browser) {
  if (fs.existsSync(STATE_FILE)) {
    const context = await browser.newContext({ viewport: VIEWPORT, storageState: STATE_FILE });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await settleAuthPages(page, newestCode());
    const ok = !page.url().includes('/auth/');
    await page.close();
    if (ok) {
      await context.storageState({ path: STATE_FILE });
      return { context, how: `reused saved state ${rel(STATE_FILE)}` };
    }
    await context.close();
    console.log(`saved state ${rel(STATE_FILE)} no longer signs in; signing in again`);
  }
  return signInFresh(browser);
}

/* ── Measurement ──────────────────────────────────────────────────────── */

// Registered before any document script so the buffered observers see the
// first paint. Everything is kept on window.__vitals for the page to read
// back once the board has settled.
const INIT = () => {
  performance.setResourceTimingBufferSize(4000);
  const v = (window.__vitals = { shifts: [], lcp: null });
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    const classes = [...(el.classList || [])].slice(0, 3).map((c) => '.' + c).join('');
    return el.tagName.toLowerCase() + classes + (el.id ? '#' + el.id : '');
  };
  const rect = (r) => (r ? { y: Math.round(r.y), height: Math.round(r.height) } : null);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      v.shifts.push({
        value: e.value,
        startTime: Math.round(e.startTime),
        sources: (e.sources || []).map((s) => ({
          node: describe(s.node), before: rect(s.previousRect), after: rect(s.currentRect),
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const e = entries[entries.length - 1];
    if (!e) return;
    const text = ((e.element && e.element.textContent) || e.url || '').trim().replace(/\s+/g, ' ');
    v.lcp = {
      startTime: Math.round(e.renderTime || e.loadTime || e.startTime),
      size: e.size,
      element: describe(e.element),
      text: text.slice(0, 80),
    };
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

// CLS as the browser reports it in the field: the largest session window,
// where a session closes after a 1 s gap or 5 s of length. The plain sum is
// kept beside it because on a board that settles over several seconds the
// two can differ, and the sum is what "every shift, ever" means.
function sessionCls(shifts) {
  let best = 0, current = 0, windowStart = 0, previous = 0;
  for (const s of shifts) {
    if (current > 0 && s.startTime - previous <= 1000 && s.startTime - windowStart <= 5000) {
      current += s.value;
    } else {
      current = s.value;
      windowStart = s.startTime;
    }
    previous = s.startTime;
    best = Math.max(best, current);
  }
  return best;
}

// FONT_DELAY=<ms> holds the Inter woff2 from fonts.gstatic.com for that long,
// to reproduce a reader whose font arrives after first paint. The shell loads
// Inter with display=swap, so text paints in the fallback and reflows when the
// real font lands; on a fast local link that lands before first paint and the
// reflow never shows. WATERFALL=1 prints every request of each run in start
// order, which is how to see what actually gates the LCP element.
const FONT_DELAY_MS = parseInt(process.env.FONT_DELAY || '0', 10) || 0;
const WATERFALL = !!process.env.WATERFALL;
// ME_DELAY=<ms> holds /me, to reproduce production where it answers after first paint.
const ME_DELAY_MS = parseInt(process.env.ME_DELAY || '0', 10) || 0;

async function measure(context, n) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.disable');
  await cdp.send('Performance.enable');
  await page.addInitScript(INIT);
  if (ME_DELAY_MS > 0) {
    await page.route((u) => u.pathname === '/me', async (route) => {
      await new Promise((r) => setTimeout(r, ME_DELAY_MS));
      await route.continue();
    });
  }
  if (FONT_DELAY_MS > 0) {
    await page.route('**/fonts.gstatic.com/**', async (route) => {
      await new Promise((r) => setTimeout(r, FONT_DELAY_MS));
      await route.continue();
    });
  }

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  // The sidebar is a hover overlay for a fresh account; park the pointer in
  // the content so it never opens.
  await page.mouse.move(1000, 700);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const bundle = performance.getEntriesByType('resource')
      .find((r) => r.name.includes('/build/app-') && /\.js(\?|$)/.test(r.name));
    return {
      url: location.href,
      shifts: window.__vitals.shifts,
      lcp: window.__vitals.lcp,
      nav: nav ? { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : null,
      bundle: bundle ? { duration: bundle.duration, transferSize: bundle.transferSize, encodedBodySize: bundle.encodedBodySize } : null,
      waterfall: performance.getEntriesByType('resource')
        .filter((r) => /fetch|xmlhttprequest|css|link|font|script/.test(r.initiatorType) || /fonts\.|\/build\//.test(r.name))
        .map((r) => ({
          name: r.name.replace(location.origin, ''), type: r.initiatorType,
          start: Math.round(r.startTime), end: Math.round(r.responseEnd), size: r.transferSize,
        })),
    };
  });
  const { metrics } = await cdp.send('Performance.getMetrics');
  if (WATERFALL) {
    console.log(`\n  waterfall, run ${n} (start -> end ms, wire bytes)${FONT_DELAY_MS ? `, fonts.gstatic delayed ${FONT_DELAY_MS} ms` : ''}`);
    for (const r of data.waterfall.slice().sort((a, b) => a.start - b.start)) {
      const name = r.name.length > 88 ? r.name.slice(0, 85) + '...' : r.name;
      console.log(`    ${String(r.start).padStart(5)} -> ${String(r.end).padStart(5)}  ${String(r.size).padStart(7)}  ${r.type.padEnd(14)} ${name}`);
    }
    if (data.lcp) console.log(`    LCP ${data.lcp.startTime} ms  ${data.lcp.element}`);
  }
  const metricMs = (name) => ((metrics.find((m) => m.name === name) || { value: 0 }).value) * 1000;
  await page.close();

  if (data.url.includes('/auth/')) throw new Error(`run ${n} landed on ${data.url}; the session did not hold`);

  const shifts = data.shifts.slice().sort((a, b) => a.startTime - b.startTime);
  return {
    run: n,
    url: data.url,
    cls: sessionCls(shifts),
    clsSum: shifts.reduce((t, s) => t + s.value, 0),
    shiftCount: shifts.length,
    shifts,
    lcp: data.lcp,
    lcpMs: data.lcp ? data.lcp.startTime : null,
    ttfbMs: data.nav ? data.nav.ttfb : null,
    dclMs: data.nav ? data.nav.dcl : null,
    loadMs: data.nav ? data.nav.load : null,
    bundle: data.bundle,
    bundleMs: data.bundle ? data.bundle.duration : null,
    scriptMs: metricMs('ScriptDuration'),
    compileMs: metricMs('V8CompileDuration'),
  };
}

/* ── Report ───────────────────────────────────────────────────────────── */

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const ms = (x) => (Number.isFinite(x) ? `${Math.round(x)} ms` : 'n/a');
const kb = (b) => (Number.isFinite(b) ? `${(b / 1024).toFixed(0)} kB` : 'n/a');
const score = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
const rectText = (r) => (r ? `y ${r.y} h ${r.height}` : 'gone');
const shiftLine = (s) =>
  `${score(s.value)}  ${String(s.startTime).padStart(6)} ms  ` +
  (s.sources.length
    ? s.sources.map((src) => `${src.node || '(removed)'} ${rectText(src.before)} -> ${rectText(src.after)}`).join(' | ')
    : '(no sources)');

const browser = await chromium.launch();
let cssStripped = null;
let exitCode = 0;

try {
  const { context, how } = await signedInContext(browser);

  await context.route('**/build/app-*.css', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    if (AB === 'rows') {
      const parts = body.split(ROW_RULE);
      cssStripped = parts.length - 1;
      body = parts.join('');
    }
    const headers = { ...res.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    await route.fulfill({ status: res.status(), headers, body });
  });

  const modeText = AB === 'rows'
    ? `rows (stylesheet served with every "${ROW_RULE}" removed)`
    : 'none (stylesheet as built)';
  console.log(`dashboard vitals  ${BASE}/  as ${EMAIL}  viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`mode: ${modeText}`);
  console.log(`runs: ${RUNS}, each a new page with the browser cache cleared, waited to network idle plus ${SETTLE_MS / 1000} s`);
  console.log(`sign-in: ${how}\n`);

  const runs = [];
  for (let n = 1; n <= RUNS; n++) {
    const r = await measure(context, n);
    runs.push(r);
    console.log(
      `run ${n}  CLS ${score(r.cls)} (sum ${score(r.clsSum)}, ${r.shiftCount} shifts)  LCP ${ms(r.lcpMs)}  TTFB ${ms(r.ttfbMs)}  ` +
      `DCL ${ms(r.dclMs)}  load ${ms(r.loadMs)}  bundle ${ms(r.bundleMs)} (${kb(r.bundle && r.bundle.transferSize)} wire, ${kb(r.bundle && r.bundle.encodedBodySize)} body)  ` +
      `script ${ms(r.scriptMs)}  compile ${ms(r.compileMs)}`,
    );
  }

  if (AB === 'rows' && !cssStripped) {
    console.log(`\nWARNING: the stylesheet had no "${ROW_RULE}" to remove, so this A/B measured the same CSS as the baseline`);
  } else if (AB === 'rows') {
    console.log(`\nstylesheet: ${cssStripped} occurrence(s) of "${ROW_RULE}" removed on each fetch`);
  }

  const medians = {
    cls: median(runs.map((r) => r.cls)),
    clsSum: median(runs.map((r) => r.clsSum)),
    lcpMs: median(runs.map((r) => r.lcpMs)),
    ttfbMs: median(runs.map((r) => r.ttfbMs)),
    bundleMs: median(runs.map((r) => r.bundleMs)),
    scriptMs: median(runs.map((r) => r.scriptMs)),
    compileMs: median(runs.map((r) => r.compileMs)),
  };
  console.log(
    `\nmedian  CLS ${score(medians.cls)} (sum ${score(medians.clsSum)})  LCP ${ms(medians.lcpMs)}  TTFB ${ms(medians.ttfbMs)}  ` +
    `bundle ${ms(medians.bundleMs)}  script ${ms(medians.scriptMs)}  compile ${ms(medians.compileMs)}`,
  );

  // The run whose CLS is the median is the one worth reading shift by shift;
  // with an even count the lower of the two middle runs is taken.
  const byCls = runs.slice().sort((a, b) => a.cls - b.cls);
  const medianRun = byCls[Math.floor((byCls.length - 1) / 2)];
  const top = medianRun.shifts.slice().sort((a, b) => b.value - a.value).slice(0, 12);
  console.log(`\ntop ${top.length} shifts of run ${medianRun.run} (median CLS):`);
  console.log('score   time       nodes (y/height before -> after)');
  for (const s of top) console.log(shiftLine(s));
  if (!top.length) console.log('(no layout shifts recorded)');

  const lcp = medianRun.lcp;
  console.log(
    lcp
      ? `\nLCP: ${lcp.element || '(unknown element)'} at ${ms(lcp.startTime)}, ${lcp.size} px²  "${lcp.text}"`
      : '\nLCP: no largest-contentful-paint entry was recorded',
  );

  const out = {
    mode: AB,
    base: BASE,
    account: EMAIL,
    viewport: VIEWPORT,
    settleMs: SETTLE_MS,
    signIn: how,
    cssStripped,
    runs: runs.map((r) => ({
      run: r.run, cls: r.cls, clsSum: r.clsSum, shiftCount: r.shiftCount, lcpMs: r.lcpMs, ttfbMs: r.ttfbMs,
      dclMs: r.dclMs, loadMs: r.loadMs, bundleMs: r.bundleMs, bundle: r.bundle, scriptMs: r.scriptMs, compileMs: r.compileMs, lcp: r.lcp,
    })),
    medians,
    medianRun: medianRun.run,
    topShifts: top,
    lcp,
  };
  console.log('\nVITALS_JSON=' + JSON.stringify(out));
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await browser.close();
}

process.exit(exitCode);
