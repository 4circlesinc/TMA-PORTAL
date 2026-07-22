/*
 * Which logo the sidebar shows, in every state it has.
 *
 * The rule is one sentence — open shows the wordmark, the collapsed rail shows
 * the mark — but there are four ways to be open or closed across two sidebar
 * styles, and the hover overlay used to be the one that got it wrong. Each
 * state is asserted from *computed* display, so a rule that is overridden
 * somewhere later in the cascade fails here rather than in someone's eyes.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899';
const SHOT = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

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

await page.waitForSelector('.tma-dash__sidebar-logo', { timeout: 20000 });

const shown = () => page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector('.tma-dash__sidebar-logo ' + sel);
    return el ? getComputedStyle(el).display !== 'none' : false;
  };
  return { wordmark: vis('.tma-dash__logo-expanded'), mark: vis('.tma-dash__logo-collapsed') };
});

const setStyle = (style) => page.evaluate((s) => {
  const root = document.querySelector('.tma-dash');
  root.classList.toggle('tma-dash--sidebar-standard', s === 'standard');
  root.classList.toggle('is-sidebar-collapsed', s !== 'standard-expanded');
}, style);

const failures = [];
const check = (state, got, wantWordmark) => {
  const ok = got.wordmark === wantWordmark && got.mark === !wantWordmark;
  console.log(`  ${ok ? '✓' : '✗'} ${state}: ${got.wordmark ? 'wordmark' : ''}${got.mark ? 'mark' : ''}${!got.wordmark && !got.mark ? 'neither' : ''}`);
  if (!ok) failures.push(`${state} should show the ${wantWordmark ? 'wordmark' : 'mark'}`);
};

// Hover style (the default): rests as a rail, expands on hover.
await setStyle('hover');
await page.mouse.move(1400, 500);
await page.waitForTimeout(400);
check('hover style, resting rail', await shown(), false);

await page.hover('.tma-dash__sidebar');
await page.waitForTimeout(700);
check('hover style, hover-expanded', await shown(), true);
if (SHOT) await page.locator('.tma-dash__sidebar').screenshot({ path: SHOT });

// Standard style: click-to-collapse, no hover involvement.
await page.mouse.move(1400, 500);
await setStyle('standard-expanded');
await page.waitForTimeout(400);
check('standard style, expanded', await shown(), true);

await setStyle('standard');
await page.waitForTimeout(400);
check('standard style, collapsed rail', await shown(), false);

// Mobile doesn't use either logo: the drawer swaps the whole logo block out
// for .tma-dash__sidebar-mobile-head. Asserted so a future change to the
// desktop rules can't quietly resurrect a logo above the mobile head.
await setStyle('hover');
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(400);

const logoBlockHidden = await page.evaluate(() => {
  const el = document.querySelector('.tma-dash__sidebar .tma-dash__sidebar-logo');
  return !el || getComputedStyle(el).display === 'none';
});
console.log(`  ${logoBlockHidden ? '✓' : '✗'} mobile drawer: logo block hidden, mobile head owns the top`);
if (!logoBlockHidden) failures.push('mobile drawer should hide the sidebar logo block entirely');

await browser.close();

if (failures.length) {
  console.error('\nFAIL:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK — the mark appears only in the collapsed rail.');
