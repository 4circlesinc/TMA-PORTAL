import { chromium } from 'playwright';

/**
 * The Dashboard's two complaints, and the presence board's.
 *
 * 1. Leaving the Dashboard and coming back re-fetched six endpoints and
 *    re-rendered the whole board each time one answered, and the Default
 *    Folders strip was force-refreshed — which replaced every card's contents
 *    with an empty list until the previews came back. What only a browser can
 *    check is that the *same DOM nodes* survive the round trip: a re-render
 *    that happens to produce identical HTML still destroys images and scroll
 *    position, and no server assertion can tell the two apart. So this stamps
 *    the live nodes before navigating away and looks for the stamps after.
 *
 * 2. The Employees card painted an offline colleague green whenever their work
 *    plan said "in office". The badge text and the colour disagreed, and only a
 *    *computed* colour catches it — the class name alone looked reasonable.
 *
 * Needs the standard throwaway server, an Administrator (`presence.view` is
 * admin-only, so an employee gets no board at all), and one colleague who is
 * offline with an "in office" work plan for today.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/dashboard-stability.mjs
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb|WebSocket/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(800);
  // "Stay signed in?" sits in front of the whole portal, redirecting even the
  // JSON APIs until it is answered.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

/** Park the pointer off the hover-overlay sidebar before touching anything. */
async function parkPointer() {
  await page.mouse.move(1200, 700);
}

try {
  step(1, 'Sign in and settle the Dashboard');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="employees"]', { timeout: 25000 });
  // Let every loader answer once, so what follows is a settled board.
  await page.waitForTimeout(4000);
  await parkPointer();

  step(2, 'The Employees card tells the truth about who is here');
  const badge = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-tile-id="employees"] .tma-portal-employee'));
    const row = rows.find((r) => /Bea Adams/.test(r.textContent || ''));
    if (!row) return null;
    const b = row.querySelector('.tma-portal-employee__badge');
    const avatar = row.querySelector('.tma-portal-employee__avatar');
    return {
      text: (b.textContent || '').trim(),
      classes: b.className,
      colour: getComputedStyle(b).color,
      background: getComputedStyle(b).backgroundColor,
      dot: getComputedStyle(avatar, '::after').backgroundColor,
      sub: (row.querySelector('.tma-portal-employee__sub')?.textContent || '').trim(),
    };
  });

  check(!!badge, 'the offline colleague is on the board');
  if (badge) {
    log(`      badge="${badge.text}" colour=${badge.colour} bg=${badge.background} dot=${badge.dot}`);
    check(badge.text === 'Offline', `the badge reads "Offline" (got "${badge.text}")`);
    check(/--offline/.test(badge.classes), 'and carries the offline tone, not the work-plan one');

    // The green is #1b7a52 / rgb(27,122,82) in light theme. Any green here is
    // the bug: this person's work plan says "in office" but they are not here.
    const green = /rgb\(\s*(1[0-9]|2[0-9]|3[0-9])\s*,\s*(1[0-2][0-9]|1[3-6][0-9])\s*,\s*([5-9][0-9]|1[0-9][0-9])\s*\)/;
    check(!green.test(badge.colour), 'the badge is not painted the online green');
    check(!green.test(badge.background), 'nor is its background');
    check(!green.test(badge.dot), 'and the presence dot is grey, not green');

    step(3, 'Last seen reads as a sentence, not a timestamp');
    log(`      sub="${badge.sub}"`);
    check(/Last seen \d+ minutes ago/.test(badge.sub),
      `the sub-line says how long ago (got "${badge.sub}")`);
    check(!/\d{4}-\d{2}-\d{2}|GMT|T\d{2}:/.test(badge.sub), 'and carries no raw timestamp');
  }

  step(4, 'The Employees card scrolls instead of growing');
  const scroller = await page.evaluate(() => {
    const el = document.querySelector('[data-tile-id="employees"] .tma-portal-employees');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { maxHeight: cs.maxHeight, overflowY: cs.overflowY, height: el.getBoundingClientRect().height };
  });
  check(!!scroller && scroller.maxHeight !== 'none', `the list has a height ceiling (${scroller?.maxHeight})`);
  check(!!scroller && /auto|scroll/.test(scroller.overflowY), 'and scrolls inside the card');

  step(5, 'Stamp the live nodes, then leave the Dashboard');
  const stamped = await page.evaluate(() => {
    const marks = {};
    const stamp = (key, el) => {
      if (!el) return;
      el.__stableMark = key;
      marks[key] = true;
    };
    stamp('recent', document.querySelector('[data-tile-id="recentFiles"]'));
    stamp('employees', document.querySelector('[data-tile-id="employees"]'));
    stamp('defaults', document.querySelector('[data-key="home-defaults"]'));
    stamp('library', document.querySelector('[data-key="home-library"]'));
    return {
      marks: Object.keys(marks),
      defaultCards: document.querySelectorAll('.tma-portal-default-folder').length,
      defaultRows: document.querySelectorAll('.tma-portal-default-folder .tma-portal-file-row').length,
      recentRows: document.querySelectorAll('[data-tile-id="recentFiles"] [data-home-file]').length,
    };
  });
  log(`      marked ${stamped.marks.join(', ')}; ${stamped.defaultCards} default cards, ` +
    `${stamped.defaultRows} rows inside them, ${stamped.recentRows} recent files`);
  check(stamped.marks.includes('employees'), 'the Employees card is on the board to begin with');

  // Watch what the board asks the server for on the way back.
  // Every endpoint the board can reach for. The browse URL is `/portal/files/?…`
  // with a slash before the query, so a pattern anchored on `/portal/files?`
  // silently matches none of the three section fetches.
  const calls = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/portal\/files\/?\?|\/portal\/files\/shortcuts|\/portal\/dashboard\/|\/portal\/file-library\/settings/.test(u)) {
      calls.push(u);
    }
  });

  await page.click('.tma-dash__nav-item[data-nav="calendar"]');
  await page.waitForTimeout(1500);
  await parkPointer();

  step(6, 'Come straight back — nothing blanks, nothing is rebuilt');
  await page.click('.tma-dash__nav-item[data-nav="dash-dashboard"]');
  // Deliberately short: the old behaviour blanked the Default Folders within a
  // few hundred milliseconds of arriving, so a long wait would miss it.
  await page.waitForTimeout(400);

  const mid = await page.evaluate(() => ({
    defaultCards: document.querySelectorAll('.tma-portal-default-folder').length,
    defaultRows: document.querySelectorAll('.tma-portal-default-folder .tma-portal-file-row').length,
    emptyNotes: Array.from(document.querySelectorAll('.tma-portal-default-folder .tma-portal-panel__note'))
      .filter((n) => /Nothing in this folder yet/.test(n.textContent || '')).length,
    recentRows: document.querySelectorAll('[data-tile-id="recentFiles"] [data-home-file]').length,
    skeletons: document.querySelectorAll('[data-tile-id] .tma-skeleton').length,
  }));
  log(`      immediately after: ${mid.defaultCards} cards, ${mid.defaultRows} rows, ` +
    `${mid.emptyNotes} "nothing here" notes, ${mid.recentRows} recent files, ${mid.skeletons} skeletons`);

  check(mid.defaultCards === stamped.defaultCards,
    `the Default Folders card keeps its folders (${stamped.defaultCards} → ${mid.defaultCards})`);
  check(mid.defaultRows >= stamped.defaultRows,
    `and their contents do not empty out (${stamped.defaultRows} → ${mid.defaultRows})`);
  check(mid.emptyNotes === 0, 'no card falls back to "Nothing in this folder yet"');
  check(mid.recentRows === stamped.recentRows,
    `Recent Files keeps its rows (${stamped.recentRows} → ${mid.recentRows})`);
  check(mid.skeletons === 0, 'and no tile drops back to a skeleton');

  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const mark = (sel) => document.querySelector(sel)?.__stableMark || null;
    return {
      recent: mark('[data-tile-id="recentFiles"]'),
      employees: mark('[data-tile-id="employees"]'),
      defaults: mark('[data-key="home-defaults"]'),
      library: mark('[data-key="home-library"]'),
      defaultCards: document.querySelectorAll('.tma-portal-default-folder').length,
      recentRows: document.querySelectorAll('[data-tile-id="recentFiles"] [data-home-file]').length,
    };
  });

  step(7, 'The very same elements are still there');
  check(after.employees === 'employees', 'the Employees card is the same node, not a rebuild');
  check(after.defaults === 'defaults' || stamped.defaultCards === 0,
    'the Default Folders section is the same node');
  check(after.library === 'library', 'the Recent Files table is the same node');
  if (stamped.recentRows > 0) {
    check(after.recent === 'recent', 'the Recent Files tile is the same node');
  }
  check(after.defaultCards === stamped.defaultCards, 'and the folder count settled unchanged');

  step(8, 'Coming back inside the freshness window asks the server for nothing');
  log(`      ${calls.length} data request(s): ${calls.map((u) => new URL(u).pathname).join(', ') || 'none'}`);
  check(calls.length === 0,
    `a revisit seconds later re-fetches nothing (${calls.length} request(s))`);

  step(9, 'Asking for a refresh explicitly still refetches');
  calls.length = 0;
  await page.click('.tma-dash__nav-item[data-nav="dash-dashboard"]');
  await page.waitForTimeout(2500);
  log(`      ${calls.length} data request(s) after re-selecting the page`);
  check(calls.length > 0, 're-selecting the page you are on is a refresh, not a no-op');

  const stillThere = await page.evaluate(() => ({
    employees: document.querySelector('[data-tile-id="employees"]')?.__stableMark || null,
    defaultCards: document.querySelectorAll('.tma-portal-default-folder').length,
  }));
  check(stillThere.employees === 'employees', 'and the refresh patches in place rather than rebuilding');
  check(stillThere.defaultCards === stamped.defaultCards, 'with the Default Folders still on screen');
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.stack}`);
  await page.screenshot({ path: 'tests/Browser/dashboard-stability-error.png' }).catch(() => {});
}

await page.screenshot({ path: 'tests/Browser/dashboard-stability.png', fullPage: false }).catch(() => {});
await browser.close();

if (errors.length) {
  log('\nPage errors:');
  errors.slice(0, 10).forEach((e) => log(`  ! ${e}`));
}

log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
failures.forEach((f) => log(`  - ${f}`));
process.exit(failures.length ? 1 : 0);
