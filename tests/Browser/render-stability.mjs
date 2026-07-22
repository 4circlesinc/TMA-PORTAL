/*
 * Render stability on the Dashboard.
 *
 * The portal used to rebuild a whole view on every render (`el.innerHTML = …`),
 * which destroyed and recreated every node underneath it — including each
 * Recent Files thumbnail and the profile photo. That is what "Recent Files
 * blinks" and "profile pictures load forever" actually were: not slow requests,
 * but elements being thrown away and rebuilt several times per visit.
 *
 * These checks measure the cause rather than the appearance:
 *
 *   1. Recent Files rows survive a re-render as the *same DOM nodes*.
 *   2. Images are not re-requested once loaded.
 *   3. A local action (opening Edit Dashboard) does not refetch server data.
 *   4. Returning to the Dashboard shows data immediately — no second skeleton.
 *   5. Clicking a row fires its handler exactly once (no stacked listeners).
 *
 * Usage: node tests/Browser/render-stability.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8899';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Reverb rejects the throwaway dev origin. Thumbnail 404s are fixture noise:
// the seed points every file at one PDF, so the image rows genuinely have no
// thumbnail to serve — the row's onerror fallback to a type icon is the correct
// behaviour and is what the user sees.
const IGNORE = /Origin not allowed|realtime disabled|Reverb|WebSocket|\/thumb\b/i;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push(String(e)); });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // A failed resource load reports a generic message; the URL is only on the
  // location, so both have to be tested to filter fixture noise.
  const where = m.location()?.url || '';
  if (IGNORE.test(m.text()) || IGNORE.test(where)) return;
  errors.push(`${m.text()} ${where}`.trim());
});

// Every request the page makes, so duplicates are countable.
const requests = [];
page.on('request', (r) => requests.push(r.url()));
const countMatching = (re) => requests.filter((u) => re.test(u)).length;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail: detail ?? '' });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');

// Wait for Recent Files to hold real rows rather than skeletons.
await page.waitForSelector('[data-home-file]', { timeout: 30000 });
await page.waitForTimeout(2500);

// The morph library has to actually be on the page, or everything below passes
// for the wrong reason.
check('TMAMorph is loaded', await page.evaluate(() => !!window.TMAMorph));

/* --- 1. Node identity survives a re-render ---------------------------- */

// Tag every Recent Files row, force the view to render again, then see how many
// of the tags survived. Under innerHTML rebuilding, all of them are lost.
await page.evaluate(() => {
  document.querySelectorAll('[data-home-file]').forEach((el, i) => { el.__tag = 'row' + i; });
  const img = document.querySelector('.tma-portal-hello__avatar');
  if (img) img.__tag = 'avatar';
});

const rowCount = await page.$$eval('[data-home-file]', (n) => n.length);

// Re-render through the view dispatcher, the same path a background refresh
// takes. rerender() must actually run, or every check below passes for the
// wrong reason — so it is asserted, not assumed.
const rerendered = await page.evaluate(() =>
  window.TMAPortalViews.activate('dashboard', document));
check('re-render actually ran', rerendered === true, `activate returned ${rerendered}`);
await page.waitForTimeout(600);

const survived = await page.$$eval('[data-home-file]',
  (nodes) => nodes.filter((n) => n.__tag).length);
check('Recent Files rows survive a re-render',
  rowCount > 0 && survived === rowCount, `${survived}/${rowCount} nodes kept`);

const avatarKept = await page.evaluate(
  () => document.querySelector('.tma-portal-hello__avatar')?.__tag === 'avatar');
check('profile photo element survives a re-render', avatarKept);

/* --- 2. Images are not re-requested ----------------------------------- */

const imgRe = /\.(png|jpg|jpeg|svg|webp|gif)(\?|$)|\/thumb/i;
const imagesBefore = countMatching(imgRe);
await page.evaluate(() => window.TMAPortalViews.activate('dashboard', document));
await page.waitForTimeout(1200);
const imagesAfter = countMatching(imgRe);
check('no image re-requests on re-render', imagesAfter === imagesBefore,
  `${imagesAfter - imagesBefore} new image requests`);

/* --- 3. A local action does not refetch server data ------------------- */

const dataRe = /section=recent|section=favorites|dashboard\/metrics/;
const dataBefore = countMatching(dataRe);

await page.click('[data-home-edit]');
await page.waitForTimeout(900);
// Close the modal again however it exposes itself.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const dataAfter = countMatching(dataRe);
check('opening Edit Dashboard refetches nothing', dataAfter === dataBefore,
  `${dataAfter - dataBefore} extra data requests`);

/* --- 4. Revisiting shows data, not a second skeleton ------------------ */

// Navigate away and back, sampling fast enough to catch a skeleton frame.
await page.click('[data-nav-id="email"], a[href*="email"]').catch(() => {});
await page.waitForTimeout(1200);

let sawSkeleton = false;
const sampler = setInterval(async () => {
  try {
    const n = await page.evaluate(() =>
      document.querySelectorAll('.tma-portal-file-row--skeleton').length);
    if (n > 0) sawSkeleton = true;
  } catch { /* navigating */ }
}, 60);

await page.click('[data-nav-id="dashboard"], a[href*="overview"]').catch(() => {});
await page.waitForTimeout(2500);
clearInterval(sampler);

const backWithRows = await page.$$eval('[data-home-file]', (n) => n.length);
check('returning to Dashboard shows no second skeleton', !sawSkeleton && backWithRows > 0,
  `skeleton=${sawSkeleton} rows=${backWithRows}`);

/* --- 5. Handlers fire once, not once per render ----------------------- */

// Count navigations triggered by a single click. A stacked listener would run
// the handler N times for one click.
const fired = await page.evaluate(async () => {
  // Render a few more times; each pass re-runs the wiring code, which is what
  // used to stack duplicate listeners on surviving nodes.
  for (let i = 0; i < 3; i++) {
    window.TMAPortalViews.activate('dashboard', document);
    await new Promise((r) => setTimeout(r, 120));
  }

  let calls = 0;
  const original = window.TMADashboard.navigate;
  window.TMADashboard.navigate = function (...args) { calls++; };

  document.querySelector('[data-home-file]')?.click();
  await new Promise((r) => setTimeout(r, 250));

  window.TMADashboard.navigate = original;
  return calls;
});
check('row click fires its handler exactly once', fired === 1, `handler ran ${fired}x`);

/* --- console --------------------------------------------------------- */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
