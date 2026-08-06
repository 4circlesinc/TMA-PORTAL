/*
 * The sidebar's *first paint*, before /me answers.
 *
 * The role-gated rows (Overview, Client hub, Email, Feed, Users, Templates)
 * are one static list shared by every account, so portal-access.js used to
 * hold them with `visibility:hidden` until /me came back. That reserved their
 * space: for the length of a round trip the menu painted with six blank gaps
 * in it, icons and labels both missing.
 *
 * App\Support\PortalShell now bakes the reader's capabilities into the shell,
 * so the nav is settled before the sidebar has parsed. This asserts that —
 * with /me deliberately stalled, which is the only way to see the state a
 * fast local server flashes past.
 *
 * Run against a throwaway database with the three standard accounts:
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/sidebar-first-paint.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const PASSWORD = process.env.TMA_PASSWORD || 'password12345';

// How long /me is held back. Long enough that anything waiting on it is
// unmistakably still waiting when we measure.
const STALL_MS = 4000;

const ACCOUNTS = [
  { email: 'e2e@example.com', label: 'Administrator', expect: ['Dashboard', 'Overview', 'Client hub', 'Email', 'Messages', 'Feed', 'Calendar', 'Signatures', 'File Library', 'Users', 'Templates', 'Projects', 'Workflows', 'People', 'Settings'] },
  { email: 'emp@example.com', label: 'Employee' },
  { email: 'client@example.com', label: 'Client' },
];

const fail = [];
function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) fail.push(message);
}

async function login(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
  // The stay-signed-in interstitial holds the session until answered, so
  // every later goto lands back on it and the shell never renders.
  if (page.url().includes('/auth/stay-signed-in')) {
    await page.click('text=Yes, stay signed in');
    await page.waitForTimeout(800);
  }
}

/* Every top-level sidebar row, and whether it is actually drawing anything.
   A row that is present but blank is the bug: it takes up its full height and
   shows neither icon nor label. */
async function readNav(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.tma-dash__sidebar [data-list="main"] > .tma-dash__nav-item');
    return [...rows].map((row) => {
      const cs = getComputedStyle(row);
      const label = row.querySelector('span:not([class])');
      const icon = row.querySelector('.tma-dash__nav-icon');
      const box = row.getBoundingClientRect();
      const painted = cs.visibility !== 'hidden' && cs.display !== 'none' && box.height > 0;
      return {
        nav: row.getAttribute('data-nav') || row.getAttribute('data-expand'),
        text: (label?.textContent || '').trim(),
        height: Math.round(box.height),
        painted,
        // The gap in the screenshot: space reserved, nothing drawn in it.
        blank: box.height > 0 && cs.visibility === 'hidden',
        maskInlined: icon ? (getComputedStyle(icon).maskImage || '').startsWith('url("data:') : null,
      };
    });
  });
}

const browser = await chromium.launch();
let exitCode = 0;

for (const account of ACCOUNTS) {
  console.log(`\n== ${account.label} (${account.email})`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  await login(page, account.email);

  // Stall /me so the pre-answer state is observable rather than a flicker.
  await page.route('**/me', async (route) => {
    await new Promise((r) => setTimeout(r, STALL_MS));
    await route.continue();
  });

  const started = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__sidebar [data-list="main"] .tma-dash__nav-item');

  const early = await readNav(page);
  const elapsed = Date.now() - started;

  const blanks = early.filter((r) => r.blank);
  const visible = early.filter((r) => r.painted).map((r) => r.text);

  console.log(`  measured ${elapsed}ms in, /me still stalled (${STALL_MS}ms)`);
  console.log(`  rows drawn: ${visible.join(', ') || '(none)'}`);
  if (blanks.length) console.log(`  BLANK ROWS: ${blanks.map((r) => r.nav + ` (${r.height}px)`).join(', ')}`);

  check(elapsed < STALL_MS, 'sidebar measured before /me could have answered');
  check(blanks.length === 0, 'no row reserves space while drawing nothing');
  check(visible.length > 0, 'the menu is not empty before /me');

  const missingIcon = early.filter((r) => r.painted && r.maskInlined === false);
  check(missingIcon.length === 0,
    `every drawn row's icon comes from the stylesheet${missingIcon.length ? ` (fetching: ${missingIcon.map((r) => r.nav).join(', ')})` : ''}`);

  if (account.expect) {
    const missing = account.expect.filter((label) => !visible.includes(label));
    check(missing.length === 0, `all ${account.expect.length} rows present at first paint${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  }

  await page.screenshot({ path: new URL(`sidebar-first-paint-${account.label.toLowerCase()}.png`, import.meta.url).pathname, clip: { x: 0, y: 0, width: 300, height: 1000 } });

  // Once /me lands the menu must not change again — a row appearing or
  // vanishing here means the shell and /me disagreed.
  await page.waitForFunction(() => document.documentElement.getAttribute('data-tma-access') === 'ready', { timeout: 15000 });
  await page.waitForTimeout(500);
  const settled = (await readNav(page)).filter((r) => r.painted).map((r) => r.text);

  const same = settled.length === visible.length && settled.every((t, i) => t === visible[i]);
  check(same, `the menu is unchanged after /me answers${same ? '' : `\n       before: ${visible.join(', ')}\n       after:  ${settled.join(', ')}`}`);

  await ctx.close();
}

await browser.close();

if (fail.length) {
  console.log(`\n${fail.length} check(s) failed:`);
  fail.forEach((f) => console.log(`  - ${f}`));
  exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
process.exit(exitCode);
