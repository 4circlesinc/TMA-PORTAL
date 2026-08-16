import { chromium } from 'playwright';

/*
 * Every warm-booted screen, proved the way warm-home.mjs proves the
 * dashboard: visit once so the snapshots are taken, then come back with
 * every data endpoint dead. Whatever paints can only be the store's —
 * an empty list, an error card or a skeleton is warm boot failing, because
 * the network was never going to answer.
 *
 * Screens live in one SPA shell, so the dead pass navigates with the
 * portal's own router rather than reloading per screen.
 *
 * Standard throwaway server; leaves a feed post behind.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await context.addInitScript(() => { window.TMADesktop = { isDesktop: true }; });
const page = await context.newPage();
page.on('pageerror', e => console.log('  pageerror:', String(e).slice(0, 160)));

async function until(fn, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const go = (nav, view, title) => page.evaluate(({ nav, view, title }) => {
  window.TMADashboard.navigate({ navId: nav, view, title, crumb: title });
}, { nav, view, title });

const visibleText = () => page.evaluate(() => {
  const views = [...document.querySelectorAll('[data-view]')];
  const seen = views.find(v => v.getBoundingClientRect().width > 0 && v.getBoundingClientRect().height > 0);
  return seen ? seen.innerText : document.body.innerText;
});

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(700);
  }

  step(1, 'Substance to keep: a feed post');
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const stamp = `Warm boot proof ${Date.now().toString(36)}`;
  const posted = await page.evaluate(async (text) => {
    // A post needs a channel; a fresh database has none, so make one.
    let channels = (await window.TMAFeedAPI.channels()).channels || [];
    if (!channels.length) {
      await window.TMAFeedAPI.createChannel({ name: 'General', type: 'public', visibility: 'org' });
      channels = (await window.TMAFeedAPI.channels()).channels || [];
    }
    if (!channels.length) return 'no channel';
    await window.TMAFeedAPI.createPost({ channelId: channels[0].id, body: text, status: 'published' });
    return 'ok';
  }, stamp).catch((e) => String(e));
  check(posted === 'ok', `a post to keep (${posted})`);

  step(2, 'Visit each screen so it snapshots itself');
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'domcontentloaded' });
  await until(async () => (await visibleText()).includes(stamp), 10000);
  await go('so-messages', 'messages', 'Messages');
  await page.waitForTimeout(2000);
  await go('dash-project-overview', 'overview', 'Overview');
  await page.waitForTimeout(2500);
  await go('calendar', 'calendar', 'Calendar');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/people/employees`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const snaps = await page.evaluate(async () => ({
    feed: !!(await window.TMAStore.get('feed:warm')),
    messages: !!(await window.TMAStore.get('messages:warm')),
    overview: !!(await window.TMAStore.get('overview:warm')),
    calendar: !!(await window.TMAStore.get('calendar:warm')),
    employees: !!(await window.TMAStore.get('people:employees')),
  }));
  Object.entries(snaps).forEach(([k, v]) => check(v, `snapshot taken: ${k}`));

  step(3, 'Dead reload, then walk the screens');
  await context.route(/\/(me$|me\/|portal\/)/, (route) => route.abort());
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const feedShown = await until(() => page.evaluate((t) =>
    document.body.innerText.includes(t), stamp), 8000);
  check(feedShown, 'the feed shows its kept post');

  await go('so-messages', 'messages', 'Messages');
  await page.waitForTimeout(1500);
  const messagesText = await visibleText();
  check(!messagesText.includes('could not be loaded'),
    'messages shows no error card over its kept list');
  check(!messagesText.includes('Loading conversations'),
    'and no loading state');

  await go('calendar', 'calendar', 'Calendar');
  await page.waitForTimeout(2000);
  const calText = await visibleText();
  check(!calText.includes('Couldn’t load your calendars'),
    'the calendar shows its kept grid, not an error');

  await page.goto(`${BASE}/people/employees`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const peopleText = await visibleText();
  check(!peopleText.includes('Couldn’t load this list'),
    'people shows its kept rows, not an error');
  // Substance is parity: whatever named the rows online must name them dead.
  const kept = await page.evaluate(async () => {
    const snap = await window.TMAStore.get('people:employees');
    return snap && snap.items && snap.items[0] ? (snap.items[0].name || snap.items[0].email) : null;
  });
  if (kept) {
    // Body text, not the first sized view — a direct page load leaves more
    // than one view with a box in this shell.
    const wholePage = await page.evaluate(() => document.body.innerText);
    check(wholePage.includes(kept), `and the kept rows have substance ("${kept}")`);
  } else {
    console.log('    (employees list is empty in this database — parity check skipped)');
  }
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
