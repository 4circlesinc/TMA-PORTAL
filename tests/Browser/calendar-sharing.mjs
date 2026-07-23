import { chromium } from 'playwright';

// Phase 2 in a real browser: create a group on the People page, share a
// calendar with it, confirm a member of that group actually sees the calendar
// and its events, and invite + RSVP on an event. See README.md for setup.
// Needs an administrator (e2e@example.com) and a second staff account
// (bea@example.com), both with password12345.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const ADMIN = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const OTHER = process.env.TMA_OTHER_EMAIL || 'bea@example.com';
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

// Talk to the same API the pages use, for setup and for assertions that
// shouldn't depend on how a list happens to render.
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

const admin = await browser.newPage();
const other = await browser.newPage();
for (const p of [admin, other]) {
  p.on('console', (m) => {
    if (m.type() === 'error' && !/403|404|realtime|WebSocket/.test(m.text())) errors.push('console: ' + m.text());
  });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

const groupName = 'Marketing ' + Date.now();
const eventTitle = 'Campaign kickoff ' + Date.now();

try {
  step(1, 'Creating a group through the People page');
  await signIn(admin, ADMIN);

  /*
   * There is no served shell for /people/*, so that URL 404s on a cold load —
   * the People views exist only inside an already-loaded shell and are reached
   * by pushState. Navigate the way the sidebar does.
   */
  await admin.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(800);
  await admin.evaluate(() => window.TMADashboard.navigate({
    navId: 'people-groups', view: 'people',
    title: 'Distribution Groups', crumb: 'People / Distribution Groups',
  }));
  await admin.waitForTimeout(1500);

  check(
    await admin.locator('.tma-portal-head__title', { hasText: 'Groups' }).first().isVisible(),
    'the Groups screen renders',
  );

  await admin.click('[data-people-new-group]');
  await admin.waitForSelector('[data-group-name]', { timeout: 8000 });
  await admin.fill('[data-group-name]', groupName);

  // Pick the colleague by address — the picker is ordered by name, so an
  // index would silently select whoever happens to sort there.
  await admin.locator('label.tma-portal-check-row', { hasText: OTHER })
    .locator('[data-group-member]').check();
  await admin.click('[data-group-create]');
  await admin.waitForTimeout(1500);

  check(await admin.locator(`text=${groupName}`).first().isVisible(), 'the new group appears in the list');

  // Server-backed, not page-local state: leave the screen entirely, come
  // back, and it must still be there.
  await admin.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(800);
  await admin.evaluate(() => window.TMADashboard.navigate({
    navId: 'people-groups', view: 'people',
    title: 'Distribution Groups', crumb: 'People / Distribution Groups',
  }));
  await admin.waitForTimeout(1500);
  check(await admin.locator(`text=${groupName}`).first().isVisible(), 'the group survives a full page reload');

  const groups = await api(admin, '/portal/groups');
  const group = (groups.body.groups || []).find((g) => g.name === groupName);
  check(!!group, 'the group is readable through the API');
  check(group && group.memberCount === 2, `the group has both members (${group && group.memberCount})`);

  step(2, 'Sharing a calendar with the group');
  await admin.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(1200);

  // A team calendar plus an event on it.
  const made = await api(admin, '/portal/calendar/calendars', {
    method: 'POST',
    json: { name: 'Campaigns', colour: 'green', calendar_type: 'group', visibility: 'private' },
  });
  const calendarId = made.body.calendar.id;
  check(!!calendarId, 'a team calendar was created');

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 11, 0, 0);

  const evt = await api(admin, '/portal/calendar/events', {
    method: 'POST',
    json: {
      calendarId,
      title: eventTitle,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      location: 'Boardroom 2',
    },
  });
  const eventId = evt.body.event.id;
  check(!!eventId, 'an event was created on it');

  // Before sharing: the colleague must not see it.
  await signIn(other, OTHER);
  const beforeShare = await api(other, '/portal/calendar/calendars');
  check(
    !(beforeShare.body.calendars || []).some((c) => c.name === 'Campaigns'),
    'the colleague cannot see the private calendar before it is shared',
  );

  // Share with the group through the sidebar's Share panel.
  await admin.reload({ waitUntil: 'networkidle' });
  await admin.waitForTimeout(1400);
  await admin.click(`[data-calendar-id="${calendarId}"] [data-calendar-menu]`);
  await admin.waitForTimeout(400);
  await admin.click(`[data-calendar-share="${calendarId}"]`);
  await admin.waitForSelector('[data-share-search]', { timeout: 8000 });

  await admin.fill('[data-share-search]', groupName.split(' ')[0]);
  await admin.waitForSelector('[data-share-add-group]', { timeout: 8000 });
  await admin.click('[data-share-add-group]');
  await admin.waitForTimeout(1400);

  check(
    await admin.locator('.tma-dash__calendar-share-list').locator(`text=${groupName}`).first().isVisible(),
    'the group is listed as having access',
  );

  step(3, 'A group member gains access through the group alone');
  const afterShare = await api(other, '/portal/calendar/discover');
  check(
    (afterShare.body.calendars || []).some((c) => c.name === 'Campaigns'),
    'the colleague can now discover the calendar via the group',
  );

  // Add it to their list and confirm the events come with it.
  const sub = await api(other, `/portal/calendar/calendars/${calendarId}/subscribe`, { method: 'POST' });
  check(sub.status === 200, 'the colleague can add the shared calendar to their list');

  await other.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await other.waitForTimeout(1500);
  check(
    await other.locator(`text=${eventTitle}`).first().isVisible().catch(() => false),
    'the group-shared event shows on the colleague’s calendar',
  );

  step(4, 'Inviting the colleague and responding');
  const invited = await api(admin, `/portal/calendar/events/${eventId}/attendees`, {
    method: 'POST',
    json: { groupIds: [group.id] },
  });
  check(invited.status === 200, 'the whole group was invited');

  // The colleague opens the event and replies.
  const detail = await api(other, `/portal/calendar/events/${eventId}`);
  check(
    detail.body.event.myInvitation && detail.body.event.myInvitation.viaGroup === true,
    'the colleague is recognised as invited through the group',
  );

  const replied = await api(other, `/portal/calendar/events/${eventId}/respond`, {
    method: 'POST',
    json: { response: 'accepted' },
  });
  check(replied.status === 200, 'the colleague can accept');

  const organizerView = await api(admin, `/portal/calendar/events/${eventId}`);
  const accepted = (organizerView.body.event.attendees || []).filter((a) => a.response === 'accepted');
  check(accepted.length === 1, `the organizer sees the acceptance (${accepted.length})`);

  step(5, 'Availability never leaks event detail');
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0);
  const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0);
  const avail = await api(
    admin,
    `/portal/calendar/availability?from=${encodeURIComponent(from.toISOString())}` +
      `&to=${encodeURIComponent(to.toISOString())}&userIds[]=1`,
  );
  check(avail.status === 200, 'availability responds');
  check(
    !JSON.stringify(avail.body).includes(eventTitle),
    'no event title appears anywhere in the availability response',
  );

  step(6, 'Revoking the group removes the access it granted');
  await api(admin, `/portal/calendar/calendars/${calendarId}/group-members/${group.id}`, { method: 'DELETE' });

  const afterRevoke = await api(other, '/portal/calendar/calendars');
  check(
    !(afterRevoke.body.calendars || []).some((c) => c.name === 'Campaigns'),
    'the calendar drops off the colleague’s list when the group loses access',
  );
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await admin.screenshot({ path: 'tests/Browser/calendar-sharing.png', fullPage: true }).catch(() => {});
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
log('All calendar sharing checks passed.');
