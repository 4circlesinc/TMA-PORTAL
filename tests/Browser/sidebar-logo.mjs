/*
 * Which logo the sidebar shows, in every state it has.
 *
 * Desktop always shows the mark (never the wordmark), including the hover-
 * expanded overlay. Mobile hides the whole logo block for the mobile head.
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
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && Number(cs.opacity) > 0.5;
  };
  return { wordmark: vis('.tma-dash__logo-expanded'), mark: vis('.tma-dash__logo-collapsed') };
});

const setStyle = (style) => page.evaluate((s) => {
  const root = document.querySelector('.tma-dash');
  root.classList.toggle('tma-dash--sidebar-standard', s === 'standard');
  root.classList.toggle('is-sidebar-collapsed', s !== 'standard-expanded');
}, style);

const failures = [];
const checkMarkOnly = (state, got) => {
  const ok = got.mark && !got.wordmark;
  console.log(`  ${ok ? '✓' : '✗'} ${state}: ${got.mark ? 'mark' : ''}${got.wordmark ? 'wordmark' : ''}${!got.wordmark && !got.mark ? 'neither' : ''}`);
  if (!ok) failures.push(`${state} should show the mark only`);
};

await setStyle('hover');
await page.mouse.move(1400, 500);
await page.waitForTimeout(400);
checkMarkOnly('hover style, resting rail', await shown());

await page.hover('.tma-dash__sidebar');
await page.waitForTimeout(700);
checkMarkOnly('hover style, hover-expanded', await shown());
if (SHOT) await page.locator('.tma-dash__sidebar').screenshot({ path: SHOT });

await page.mouse.move(1400, 500);
await setStyle('standard-expanded');
await page.waitForTimeout(400);
checkMarkOnly('standard style, expanded', await shown());

await setStyle('standard');
await page.waitForTimeout(400);
checkMarkOnly('standard style, collapsed rail', await shown());

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
console.log('\nOK — sidebar always shows the logo mark on desktop.');
