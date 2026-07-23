import { chromium } from 'playwright';

// Phase 4 in a real browser. Real Google/Microsoft can't be exercised from a
// test, so the seed provides a connected Google calendar carrying a conflict;
// this drives the sidebar's provider controls, the conflict resolver, the sync
// settings panel and the audit history against the real page and API. See
// README.md — needs the Phase 4 seed (a ConnectedAccount + a google-source
// calendar with one conflicted event).
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

// Wide enough that the sidebar stays visible alongside an open panel (the
// layout hides it at <=1500px).
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|realtime|WebSocket/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'The connected calendar shows its sync status in the sidebar');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  check(
    await page.locator('.tma-dash__calendar-item-name:has-text("Work (Google)")').isVisible(),
    'the Google calendar is listed',
  );
  check(
    await page.locator('.tma-dash__calendar-item-meta--error').first().isVisible().catch(() => false),
    'its sync error is shown against that row, not as a page error',
  );

  step(2, 'The sidebar menu exposes the provider controls');
  const cals = await api(page, '/portal/calendar/calendars');
  const google = cals.body.calendars.find((c) => c.name === 'Work (Google)');
  check(!!google && google.sync && google.sync.provider === 'google', 'the calendar reports provider sync state');

  await page.hover(`[data-calendar-id="${google.id}"]`);
  await page.click(`[data-calendar-id="${google.id}"] [data-calendar-menu]`);
  await page.waitForTimeout(400);
  check(await page.locator('[data-calendar-sync-now]').isVisible(), 'a "Sync now" action is offered');
  check(await page.locator('[data-calendar-conflicts]').isVisible(), 'a conflicts action is offered');
  check(await page.locator('[data-calendar-history]').isVisible(), 'a history action is offered');

  step(3, 'Reviewing and resolving the conflict');
  await page.click(`[data-calendar-conflicts="${google.id}"]`);
  await page.waitForTimeout(1200);

  check(
    await page.locator('text=Client meeting (their version)').first().isVisible().catch(() => false),
    'the live (provider) version is shown',
  );
  check(
    await page.locator('text=Client meeting (my version)').first().isVisible().catch(() => false),
    'the overwritten local version is shown beside it — nothing lost silently',
  );

  // Restore the local version.
  await page.click('[data-conflict-keep="yours"]');
  await page.waitForTimeout(1400);

  const afterResolve = await api(page, `/portal/calendar/sync/${google.id}/conflicts`);
  check((afterResolve.body.conflicts || []).length === 0, 'the conflict is cleared once resolved');

  const events = await api(page, '/portal/calendar/events?from=2026-07-20T00:00:00%2B00:00&to=2026-07-25T00:00:00%2B00:00');
  const titles = events.body.events.map((e) => e.title);
  check(titles.includes('Client meeting (my version)'), 'the restored local version is now live');

  step(4, 'Sync settings show status and direction');
  // Close the conflicts panel first — a hover-revealed menu button needs a
  // hover, and the sidebar has to be clear of the panel.
  await page.click('[data-calendar-panel-close]');
  await page.waitForTimeout(400);
  await page.hover(`[data-calendar-id="${google.id}"]`);
  await page.click(`[data-calendar-id="${google.id}"] [data-calendar-menu]`);
  await page.waitForTimeout(400);
  await page.click(`[data-calendar-sync-settings="${google.id}"]`);
  await page.waitForTimeout(800);

  check(await page.locator('[data-sync-direction]').isVisible(), 'the direction selector is shown');
  check(
    (await page.locator('[data-sync-direction]').inputValue()) === 'two_way',
    'it reflects the calendar’s two-way direction',
  );

  // Switch to import-only through the UI.
  await page.selectOption('[data-sync-direction]', 'import');
  await page.waitForTimeout(1200);
  const afterDir = await api(page, '/portal/calendar/calendars');
  const updated = afterDir.body.calendars.find((c) => c.name === 'Work (Google)');
  check(updated.sync.direction === 'import', 'the direction change persisted to the server');

  step(5, 'Audit history records what happened');
  // A real audited action: create an event on this calendar.
  await api(page, '/portal/calendar/events', {
    method: 'POST',
    json: {
      calendarId: google.id,
      title: 'Audited event',
      startsAt: '2026-07-24T10:00:00+00:00',
      endsAt: '2026-07-24T11:00:00+00:00',
    },
  });

  const history = await api(page, `/portal/calendar/calendars/${google.id}/history`);
  check(history.status === 200, 'the history endpoint responds');
  const labels = (history.body.history || []).map((h) => h.label);
  check(
    (history.body.history || []).some((h) => h.action === 'event.created'),
    'the event-created action is recorded',
  );
  check(
    labels.some((l) => (l || '').includes('Audited event')),
    'the trail reads in plain language ("… created Audited event")',
  );

  step(6, 'The connect panel lists connectable accounts');
  await page.click('[data-calendar-panel-close]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[data-calendar-add-menu]');
  await page.waitForTimeout(400);
  await page.click('[data-calendar-connect]');
  await page.waitForTimeout(1000);

  check(
    await page.locator('text=work@gmail.com').first().isVisible().catch(() => false),
    'the connected Google account is offered to connect calendars from',
  );
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await page.screenshot({ path: 'tests/Browser/calendar-sync.png', fullPage: true }).catch(() => {});
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
log('All calendar sync + conflict + history checks passed.');
