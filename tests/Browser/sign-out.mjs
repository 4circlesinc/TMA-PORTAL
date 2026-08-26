/*
 * Signing out, in one click.
 *
 * It was reported as needing two: the first click "just refreshed the page"
 * and left the reader signed in. None of that is reachable from PHPUnit —
 * the server side is correct and always was, and a curl of POST /auth/logout
 * ends the session cleanly even with a remembered cookie. What was wrong only
 * exists in a browser, between the click and the navigation.
 *
 * Four things this holds:
 *
 *   - One click ends the session. Not "changes the page" — the check reads the
 *     portal back afterwards and requires it to send you to sign in, because a
 *     page that navigated while still authenticated is exactly the bug.
 *   - One click POSTs once, and so do three. The handler used to have no
 *     re-entry guard, so an impatient second click started a second sign-out.
 *   - Back does not return to the portal. It navigated with location.href, so
 *     the signed-in page was one Back press away from someone who had left.
 *   - The click reaches sign-out and nothing else. The listener is on the
 *     capture phase now; a document-level bubbling listener is the *last* to
 *     hear a click, so every other handler on the way up had already acted —
 *     including portal-live.js, which reloads the page when /me reports a
 *     different capability set, and a destroyed session is exactly that.
 *
 * Needs the standard e2e account, and the bundle rebuilt — the shell serves
 * public/build/app-*.js, not the individual files, so an edit to
 * public/js/sign-out.js is invisible until `node scripts/build-assets.mjs`
 * has run. That alone will make this test pass against old code.
 *
 *   node scripts/build-assets.mjs
 *   TMA_BASE_URL=http://127.0.0.1:8911 node tests/Browser/sign-out.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const PASSWORD = 'password12345';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';

const fail = [];
function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) fail.push(message);
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);

  // Stay-signed-in stands between the login and everything else, and it is two
  // forms rather than two buttons.
  if (page.url().includes('stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
  }

  await page.waitForTimeout(2500);
}

// Dispatched rather than driven by the mouse: the button lives in the sidebar
// profile row, which is off-viewport in a collapsed rail, and what is under
// test is the handler, not where the button sits.
const press = (page, times = 1) => page.evaluate((n) => {
  const b = document.querySelector('[data-action="sign-out"]');
  for (let i = 0; i < n; i += 1) b.click();
}, times);

const browser = await chromium.launch();

/* ── one click is the whole of it ─────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/auth/logout')) posts += 1;
  });

  await signIn(page);
  check(!!(await page.$('[data-action="sign-out"]')), 'the shell has a sign-out button');

  await press(page);
  await page.waitForTimeout(3500);

  check(new URL(page.url()).pathname === '/auth/login', 'one click lands on sign in');
  check(posts === 1, `one click POSTs once (${posts})`);

  // The session, not the page. Navigating while still authenticated is the bug.
  const landed = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/`, { credentials: 'same-origin', redirect: 'follow' });
    return new URL(r.url).pathname;
  }, BASE);
  check(landed === '/auth/login', `the portal now sends you to sign in (${landed})`);

  await ctx.close();
}

/* ── and an impatient reader still signs out once ─────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/auth/logout')) posts += 1;
  });

  await signIn(page);
  await press(page, 3);
  await page.waitForTimeout(3500);

  check(posts === 1, `three clicks still POST once (${posts})`);
  check(new URL(page.url()).pathname === '/auth/login', 'and still land on sign in');

  await ctx.close();
}

/* ── the portal is not one Back press away ────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await signIn(page);
  await press(page);
  await page.waitForTimeout(3500);

  await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(800);

  check(new URL(page.url()).pathname !== '/', `back does not return to the portal (${new URL(page.url()).pathname})`);

  await ctx.close();
}

await browser.close();

console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASS');
process.exit(fail.length ? 1 : 0);
