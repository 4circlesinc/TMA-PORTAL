import { chromium } from 'playwright';

// Drives the Calendar page against a real server. The calendar is now
// server-backed, so the things worth proving in a browser are the ones
// PHPUnit can't see: the sidebar groups real calendars into sections, an
// event created through the panel survives a reload, hiding a calendar
// removes its events from the grid *without* deleting anything, and none of
// it reloads the page. See README.md for setup. Needs a staff account.
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

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

// Read through the same API the page uses, so persistence checks don't
// depend on how the grid happens to render.
const apiCalendars = (page) => page.evaluate(async (base) => {
  const r = await fetch(base + '/portal/calendar/calendars', {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  }).then((res) => res.json());
  return r.calendars || [];
}, BASE);

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const unique = 'Budget review ' + Date.now();

try {
  step(1, 'Opening the Calendar page');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // A brand-new account is provisioned a Personal calendar on first visit.
  const sidebar = page.locator('[data-calendar-sidebar]');
  check(await sidebar.isVisible(), 'the calendar sidebar renders');
  check(await page.locator('.tma-dash__calendar-group-title:has-text("My Calendars")').isVisible(),
    'calendars are grouped under "My Calendars"');
  check(await page.locator('.tma-dash__calendar-item-name:has-text("Personal")').isVisible(),
    'a Personal calendar was provisioned automatically');

  // The old build seeded eleven fake events. Nothing should be invented now.
  const seeded = await page.locator('[data-schedule-event]').count();
  check(seeded === 0, `no invented events on a fresh account (found ${seeded})`);

  step(2, 'Creating an event through the panel');
  await page.click('[data-calendar-new]');
  await page.waitForSelector('[data-calendar-field="title"]', { timeout: 8000 });
  await page.fill('[data-calendar-field="title"]', unique);
  await page.fill('[data-calendar-field="location"]', 'Boardroom 2');
  await page.click('[data-calendar-save]');
  await page.waitForTimeout(1200);

  check(await page.locator(`text=${unique}`).first().isVisible(),
    'the new event appears without a page reload');

  step(3, 'Confirming it is server-backed, not local state');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check(await page.locator(`text=${unique}`).first().isVisible(),
    'the event survives a reload');

  step(4, 'Hiding a calendar removes its events but keeps the calendar');
  const before = await page.locator('[data-schedule-event]').count();
  check(before > 0, `the grid shows the event (${before})`);

  await page.uncheck('[data-calendar-toggle]');
  await page.waitForTimeout(1200);

  const after = await page.locator('[data-schedule-event]').count();
  check(after === 0, `hiding the calendar clears its events from the grid (${after})`);
  check(await page.locator('.tma-dash__calendar-item-name:has-text("Personal")').isVisible(),
    'the calendar itself is still listed');

  const stillThere = await apiCalendars(page);
  check(stillThere.some((c) => c.name === 'Personal'),
    'the calendar still exists server-side after being hidden');
  check(stillThere.every((c) => c.visible === false),
    'the hidden state persisted to the server');

  step(5, 'Showing it again brings the events back');
  await page.check('[data-calendar-toggle]');
  await page.waitForTimeout(1200);
  const restored = await page.locator('[data-schedule-event]').count();
  check(restored === before, `events return when the calendar is shown (${restored})`);

  step(6, 'Switching views does not reload the page');
  await page.evaluate(() => { window.__tmaStillHere = true; });
  await page.click('[data-calendar-view-tabs] [data-tab-key="month"]');
  await page.waitForTimeout(900);
  check(await page.locator('[data-calendar-month-root]').isVisible(), 'the month view renders');
  check(await page.evaluate(() => window.__tmaStillHere === true),
    'switching view did not reload the page');

  await page.click('[data-calendar-view-tabs] [data-tab-key="agenda"]');
  await page.waitForTimeout(900);
  check(await page.locator('[data-calendar-agenda-root]').isVisible(), 'the agenda view renders');
  check(await page.locator(`text=${unique}`).first().isVisible(), 'the event shows in the agenda');

  step(7, 'The remembered view comes back on reload');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  check(await page.locator('[data-calendar-agenda-root]').isVisible(),
    'the calendar reopens in the view it was left in');

  step(8, 'Deleting the event');
  await page.click(`[data-calendar-event]:has-text("${unique}")`);
  await page.waitForTimeout(600);
  await page.click('[data-calendar-delete-event]');
  await page.waitForTimeout(1200);
  check(!(await page.locator(`text=${unique}`).first().isVisible().catch(() => false)),
    'the event is gone from the view');
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await page.screenshot({ path: 'tests/Browser/calendar.png', fullPage: true }).catch(() => {});
  await browser.close();
}

log('\n' + '─'.repeat(60));
if (errors.length) {
  log('Page errors:');
  errors.forEach((e) => log('  ! ' + e));
}
if (failures.length) {
  log(`FAILED (${failures.length})`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('All calendar checks passed.');
