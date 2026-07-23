import { chromium } from 'playwright';

// Phase 3 in a real browser: recurring events on the grid, the this/following/
// all prompt, and the ICS import wizard end to end. See README.md for setup.
// Needs a staff account (e2e@example.com / password12345).
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

const api = (page, path, opts) => page.evaluate(async ([base, p, o]) => {
  const csrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const res = await fetch(base + p, {
    method: (o && o.method) || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: o && o.json ? JSON.stringify(o.json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, [BASE, path, opts || null]);

const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|realtime|WebSocket/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// Monday of the current week, so the assertions don't depend on today.
const now = new Date();
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const dayKey = (offset) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

try {
  step(1, 'Creating a weekly recurring event through the form');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.click('[data-calendar-new]');
  await page.waitForSelector('[data-calendar-field="title"]', { timeout: 8000 });
  await page.fill('[data-calendar-field="title"]', 'Weekly standup');
  await page.fill('[data-calendar-field="date"]', dayKey(0));

  check(await page.locator('[data-recur-preset]').isVisible(), 'the repeat picker is on the form');
  await page.selectOption('[data-recur-preset]', 'WEEKLY');
  await page.waitForTimeout(300);

  await page.click('[data-calendar-save]');
  await page.waitForTimeout(1500);

  check(
    await page.locator('.tma-dash__calendar-detail-repeat').isVisible().catch(() => false),
    'the detail panel says the event repeats',
  );

  step(2, 'The series expands across following weeks');
  // Jump forward two weeks: the occurrence must be generated, not stored.
  await page.click('[data-calendar-panel-close]');
  await page.waitForTimeout(400);
  await page.click('[data-schedule-next]');
  await page.waitForTimeout(900);
  await page.click('[data-schedule-next]');
  await page.waitForTimeout(1200);

  check(
    await page.locator('text=Weekly standup').first().isVisible().catch(() => false),
    'the occurrence two weeks out is on the grid',
  );

  // Only one row exists, however many occurrences are drawn.
  const stored = await api(page, '/portal/calendar/events?from=' +
    encodeURIComponent(new Date(monday.getTime() - 86400000).toISOString()) +
    '&to=' + encodeURIComponent(new Date(monday.getTime() + 28 * 86400000).toISOString()));
  const drawn = stored.body.events.filter((e) => e.title === 'Weekly standup');
  check(drawn.length >= 4, `the series draws several occurrences (${drawn.length})`);
  check(drawn.every((e) => e.isOccurrence), 'each is a generated occurrence');
  check(new Set(drawn.map((e) => e.id)).size === drawn.length, 'each occurrence has its own id');

  step(3, 'Editing one occurrence asks which events it applies to');
  await page.click('[data-schedule-event]');
  await page.waitForTimeout(700);
  await page.click('[data-calendar-edit]');
  await page.waitForSelector('[data-calendar-field="title"]', { timeout: 8000 });
  await page.fill('[data-calendar-field="title"]', 'Weekly standup (moved)');
  await page.click('[data-calendar-save]');
  await page.waitForTimeout(600);

  check(
    await page.locator('.tma-dash__calendar-scope').isVisible().catch(() => false),
    'the this / following / all prompt appears',
  );

  await page.click('[data-scope-pick="this"]');
  await page.waitForTimeout(1600);

  const afterEdit = await api(page, '/portal/calendar/events?from=' +
    encodeURIComponent(new Date(monday.getTime() - 86400000).toISOString()) +
    '&to=' + encodeURIComponent(new Date(monday.getTime() + 28 * 86400000).toISOString()));

  const moved = afterEdit.body.events.filter((e) => e.title === 'Weekly standup (moved)');
  const untouched = afterEdit.body.events.filter((e) => e.title === 'Weekly standup');

  check(moved.length === 1, `exactly one occurrence was renamed (${moved.length})`);
  check(untouched.length >= 3, `the rest of the series is untouched (${untouched.length})`);

  step(4, 'Exporting the calendar as .ics');
  const cals = await api(page, '/portal/calendar/calendars');
  const personal = cals.body.calendars.find((c) => c.name === 'Personal');

  const download = await page.evaluate(async ([base, id]) => {
    const res = await fetch(`${base}/portal/calendar/ics/${id}/export`, { credentials: 'same-origin' });
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  }, [BASE, personal.id]);

  check(download.status === 200, 'the export responds');
  check((download.type || '').includes('text/calendar'), 'it is served as text/calendar');
  check(download.body.includes('BEGIN:VCALENDAR'), 'the file is a VCALENDAR');
  // One VEVENT for the series plus one for the detached occurrence — not one
  // per drawn instance.
  const vevents = (download.body.match(/BEGIN:VEVENT/g) || []).length;
  check(vevents === 2, `the series exports as a rule, not expanded copies (${vevents} VEVENTs)`);
  check(download.body.includes('RRULE:'), 'the recurrence rule is preserved');

  step(5, 'Importing an .ics file through the wizard');
  await page.click('[data-calendar-panel-close]').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('[data-calendar-add-menu]');
  await page.waitForTimeout(400);
  await page.click('[data-calendar-import]');
  await page.waitForSelector('[data-import-file]', { timeout: 8000 });

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Browser Test//EN',
    'BEGIN:VEVENT', 'UID:imported-1@example.com',
    'DTSTART:20260901T090000Z', 'DTEND:20260901T100000Z',
    'SUMMARY:Imported board meeting', 'LOCATION:Boardroom 2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:imported-2@example.com',
    'DTSTART:20260902T090000Z', 'DTEND:20260902T093000Z',
    'SUMMARY:Imported sync', 'RRULE:FREQ=WEEKLY;COUNT=4', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  await page.setInputFiles('[data-import-file]', {
    name: 'import.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics),
  });
  await page.waitForTimeout(1500);

  check(
    await page.locator('[data-import-commit]').isVisible().catch(() => false),
    'the preview lists the file’s events',
  );
  check(
    await page.locator('text=Imported board meeting').first().isVisible().catch(() => false),
    'an event from the file is shown by name',
  );

  await page.click('[data-import-commit]');
  await page.waitForTimeout(2000);

  check(
    await page.locator('text=Import finished').isVisible().catch(() => false),
    'the result screen appears',
  );

  const imported = await api(page, '/portal/calendar/events?from=2026-08-30T00:00:00%2B00:00' +
    '&to=2026-10-05T00:00:00%2B00:00');
  const names = imported.body.events.map((e) => e.title);
  check(names.includes('Imported board meeting'), 'the one-off event was imported');
  check(
    names.filter((t) => t === 'Imported sync').length === 4,
    'the imported recurring event expands to its four occurrences',
  );

  step(6, 'A subscription URL pointing inside the network is refused');
  const sneaky = await api(page, '/portal/calendar/ics/subscribe', {
    method: 'POST',
    json: { url: 'http://169.254.169.254/latest/meta-data/', name: 'Metadata' },
  });
  check(sneaky.status === 422, `the metadata address is rejected (${sneaky.status})`);
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await page.screenshot({ path: 'tests/Browser/calendar-ics.png', fullPage: true }).catch(() => {});
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
log('All calendar ICS + recurrence checks passed.');
