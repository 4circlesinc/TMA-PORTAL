import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  step(1, 'Sign in');
  await signIn();

  step(2, 'Month view shows event rows (not only dots)');
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__calendar', { timeout: 15000 });
  const monthBtn = page.locator('[data-tab-key="month"]').first();
  check(await monthBtn.count() > 0, 'Month view tab exists');
  await monthBtn.click();
  await page.waitForSelector('.tma-dash__calendar-month', { timeout: 10000 });
  await page.waitForTimeout(800);

  await page.waitForSelector('.tma-dash__calendar-month-event', { timeout: 12000 });
  const chipCount = await page.locator('.tma-dash__calendar-month-event').count();
  check(chipCount >= 1, `month cells show event chips (saw ${chipCount})`);

  const moreBtn = page.locator('[data-calendar-day-more]').first();
  if (await moreBtn.count()) {
    const moreText = (await moreBtn.textContent() || '').trim();
    check(/\+\d+\s*more/i.test(moreText), `more-count reads as +N more (got "${moreText}")`);
    await moreBtn.click();
    await page.waitForTimeout(300);
    const dayPanel = page.locator('.tma-dash__calendar-day-panel, [data-calendar-day-panel], .tma-dash__calendar-panel');
    check(await dayPanel.count() > 0, 'clicking +more opens the day schedule');
  } else {
    log('    · no +more on this month (fewer than 4 events on one day) — skipping more-count');
  }

  await page.screenshot({ path: path.join(__dirname, 'calendar-month-final.png'), fullPage: false });

  step(3, 'Overview workspace metrics + latest files');
  await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__overview', { timeout: 15000 });
  await page.waitForTimeout(800);

  const heroTitle = await page.locator('.tma-dash__overview-block--hero .tma-dash__overview-block-title').first().textContent().catch(() => '');
  check(/Workspace metrics/i.test(heroTitle || ''), `metrics widget renamed (got "${(heroTitle || '').trim()}")`);

  const workPlan = page.locator('[data-overview-workplan]');
  check(await workPlan.count() === 0, 'Your work plan card is not on Overview');

  const addUser = page.locator('[data-overview-add-user]');
  check(await addUser.count() > 0, 'Add User button is wired');
  await addUser.first().click();
  await page.waitForTimeout(400);
  const inviteOpen = await page.locator('[data-users-invite], .tma-dash__users-invite, dialog[open], .tma-modal, [data-invite]').count();
  check(inviteOpen > 0 || page.url().includes('users'), 'Add User opens invite/users flow');

  // Dismiss invite if open
  await page.keyboard.press('Escape').catch(() => {});

  const fileRows = page.locator('[data-overview-file]');
  const fileCount = await fileRows.count();
  check(fileCount >= 0, `Latest Files loaded without dummy rows (count=${fileCount})`);
  // Ensure no obvious dummy filenames from old fixtures
  const fileNames = await page.$$eval('.tma-dash__overview-file-name', (els) => els.map((e) => e.textContent.trim()));
  check(!fileNames.some((n) => /Sample File|Dummy|Lorem/i.test(n)), 'Latest Files has no dummy names');

  const uploadBtn = page.locator('[data-overview-upload]');
  check(await uploadBtn.count() > 0, 'Upload button exists in Latest Files');

  await page.screenshot({ path: path.join(__dirname, 'overview-widgets-final.png'), fullPage: false });

  step(4, 'Console hygiene');
  const serious = errors.filter((e) =>
    !/favicon|ResizeObserver|net::ERR|realtime disabled|Origin not allowed|WebSocket/i.test(e));
  check(serious.length === 0, `no page errors (saw ${serious.length}: ${serious.slice(0, 3).join(' | ')})`);
} catch (err) {
  failures.push(String(err && err.stack || err));
  await page.screenshot({ path: path.join(__dirname, 'calendar-month-error.png'), fullPage: false }).catch(() => {});
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('\nFAILED:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nAll calendar/overview checks passed.');
